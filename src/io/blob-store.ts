// The model store of the browser, by content (the launcher's layout,
// engine/crates/rt-app/README.md), written once over a tiny file-system
// interface: the OPFS worker (io/model-worker.ts) runs it on the origin's
// private file system with sync access handles, the tests run it on memory.
//
//   blobs/<sha256>             a complete file, verified against its name
//   blobs/<sha256>.part        a file being downloaded
//   blobs/<sha256>.part.json   {total, contiguous, hash, damaged, actual}
//   installed.json             {"installed": [keys]}
//   imported/<key>.json        the manifest of an imported model
//
// Writes go in order: a chunk is written at `contiguous` (or at 0, which
// starts the file over), and the SHA-256 state advances with it and is saved
// in the .part.json after the chunk, so a download cut by closing the page
// resumes from the last byte that is both written and hashed, and `finish`
// does not read gigabytes back. A file whose bytes are all there but whose
// hash is another one stays `.part`, marked damaged, until it is deleted.

import { SHA256_RE, Sha256, type Sha256State } from '../core/sha256';
import { validateManifest, type BlobInfo, type ImportedModel } from '../core/models';

/** The few file operations the store needs, on paths relative to the store's folder. */
export interface BlobFs {
  /** Size in bytes, or null when the file does not exist. */
  size(path: string): Promise<number | null>;
  readText(path: string): Promise<string | null>;
  /** Replaces the whole file (creates folders as needed). */
  writeText(path: string, text: string): Promise<void>;
  /** Writes at an offset, creating the file. */
  writeAt(path: string, offset: number, bytes: Uint8Array): Promise<void>;
  readAt(path: string, offset: number, length: number): Promise<Uint8Array>;
  truncate(path: string, size: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** File names in a folder (not recursive); [] when it does not exist. */
  list(dir: string): Promise<string[]>;
  /** Lets go of whatever is held open for a file (sync access handles lock it). */
  release?(path: string): Promise<void>;
}

export type FinishResult = { ok: true } | { ok: false; reason: 'mismatch'; actual: string } | { ok: false; reason: 'incomplete'; contiguous: number };

export class StoreError extends Error {
  constructor(
    readonly code: 'offset' | 'damaged' | 'conflict' | 'bad-sha' | 'bad-key' | 'too-long' | 'missing',
    message: string,
  ) {
    super(message);
  }
}

interface PartState {
  total: number;
  contiguous: number;
  hash: Sha256State | null;
  damaged: boolean;
  actual: string | null;
}

const KEY_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
const checkSha = (sha: string): string => {
  if (!SHA256_RE.test(sha)) throw new StoreError('bad-sha', `not a sha256: ${sha}`);
  return sha;
};
const checkKey = (key: string): string => {
  if (!KEY_RE.test(key) || key.includes('..')) throw new StoreError('bad-key', `not a model key: ${key}`);
  return key;
};

const blob = (sha: string) => `blobs/${sha}`;
const part = (sha: string) => `blobs/${sha}.part`;
const partJson = (sha: string) => `blobs/${sha}.part.json`;

/** How much a finish that has to re-read the file reads at a time. */
const READ_CHUNK = 8 * 1024 * 1024;

export interface LocalBlobStore {
  status(sha: string): Promise<BlobInfo>;
  blobs(): Promise<BlobInfo[]>;
  write(sha: string, offset: number, bytes: Uint8Array, total: number): Promise<BlobInfo>;
  finish(sha: string, total: number, onProgress?: (done: number) => void): Promise<FinishResult>;
  deleteBlob(sha: string): Promise<void>;
  /** Lets go of an open partial file (a paused download). */
  release(sha: string): Promise<void>;
  installed(): Promise<string[]>;
  /** Marks a model installed; every one of `shas` must be complete. */
  install(key: string, shas: readonly string[]): Promise<string[]>;
  uninstall(key: string, deleteShas: readonly string[]): Promise<string[]>;
  imported(): Promise<ImportedModel[]>;
  putImported(model: ImportedModel): Promise<void>;
  /** Bytes the store holds (complete and partial). */
  usage(): Promise<number>;
}

export function createBlobStore(fs: BlobFs): LocalBlobStore {
  // The SHA-256 of a part being written, kept between chunks (it is also saved in the .part.json).
  const hashes = new Map<string, Sha256>();

  const readPart = async (sha: string): Promise<PartState | null> => {
    const text = await fs.readText(partJson(sha));
    if (text === null) return null;
    try {
      const v = JSON.parse(text) as PartState;
      if (typeof v.contiguous !== 'number' || typeof v.total !== 'number') return null;
      return { total: v.total, contiguous: v.contiguous, hash: v.hash ?? null, damaged: v.damaged === true, actual: v.actual ?? null };
    } catch {
      return null;
    }
  };
  const writePart = (sha: string, p: PartState) => fs.writeText(partJson(sha), JSON.stringify(p));

  const status = async (sha: string): Promise<BlobInfo> => {
    checkSha(sha);
    const size = await fs.size(blob(sha));
    if (size !== null) return { sha256: sha, state: 'complete', contiguous: size, total: size, damaged: false };
    const p = await readPart(sha);
    const partSize = await fs.size(part(sha));
    if (p && partSize !== null) {
      // A state that claims more than the file holds (the page died between the two writes) is not trusted.
      const contiguous = Math.min(p.contiguous, partSize);
      const trusted = contiguous === p.contiguous;
      return { sha256: sha, state: 'partial', contiguous: trusted ? contiguous : 0, total: p.total, damaged: p.damaged, actual: p.actual };
    }
    if (partSize !== null) return { sha256: sha, state: 'partial', contiguous: 0, total: p?.total ?? null, damaged: false };
    return { sha256: sha, state: 'missing', contiguous: 0, total: null, damaged: false };
  };

  return {
    status,

    async blobs() {
      const names = await fs.list('blobs');
      const shas = new Set<string>();
      for (const n of names) {
        const sha = n.slice(0, 64);
        if (SHA256_RE.test(sha) && (n.length === 64 || n === `${sha}.part` || n === `${sha}.part.json`)) shas.add(sha);
      }
      return Promise.all([...shas].sort().map(status));
    },

    async write(sha, offset, bytes, total) {
      checkSha(sha);
      if (!Number.isInteger(total) || total <= 0) throw new StoreError('conflict', 'a size is needed');
      if ((await fs.size(blob(sha))) !== null) return status(sha);
      let p = await readPart(sha);
      if (p?.damaged) throw new StoreError('damaged', `${sha} is damaged: delete it first`);
      if (p && p.total !== total) {
        if (offset !== 0) throw new StoreError('conflict', `${sha}: the size changed`);
        p = null;
      }
      const at = p ? Math.min(p.contiguous, (await fs.size(part(sha))) ?? 0) : 0;
      if (offset !== 0 && offset !== at) throw new StoreError('offset', `${sha}: write at ${at}, not ${offset}`);
      if (offset + bytes.length > total) throw new StoreError('too-long', `${sha}: past its size`);
      let hash = hashes.get(sha);
      if (offset === 0) {
        hash = new Sha256();
        if ((await fs.size(part(sha))) !== null) await fs.truncate(part(sha), 0);
      } else if (!hash || hash.length !== offset) {
        // A new session: the state saved with the last chunk (or nothing to resume from).
        try {
          hash = p?.hash ? Sha256.restore(p.hash) : undefined;
        } catch {
          hash = undefined;
        }
        if (!hash || hash.length !== offset) throw new StoreError('offset', `${sha}: no hash state at ${offset}; start again at 0`);
      }
      await fs.writeAt(part(sha), offset, bytes);
      hash.update(bytes);
      hashes.set(sha, hash);
      const next: PartState = { total, contiguous: offset + bytes.length, hash: hash.save(), damaged: false, actual: null };
      await writePart(sha, next);
      return { sha256: sha, state: 'partial', contiguous: next.contiguous, total, damaged: false };
    },

    async finish(sha, total, onProgress) {
      checkSha(sha);
      if ((await fs.size(blob(sha))) !== null) return { ok: true };
      const p = await readPart(sha);
      const size = (await fs.size(part(sha))) ?? 0;
      const contiguous = p ? Math.min(p.contiguous, size) : 0;
      if (!p || contiguous < total) return { ok: false, reason: 'incomplete', contiguous };
      if (size > total) await fs.truncate(part(sha), total);
      let digest: string | null = null;
      try {
        const h = hashes.get(sha) ?? (p.hash ? Sha256.restore(p.hash) : null);
        if (h && h.length === total) digest = h.digest();
      } catch {
        digest = null;
      }
      if (digest === null) {
        // No usable state (an older part): read the file back and hash it.
        const h = new Sha256();
        for (let at = 0; at < total; at += READ_CHUNK) {
          h.update(await fs.readAt(part(sha), at, Math.min(READ_CHUNK, total - at)));
          onProgress?.(Math.min(total, at + READ_CHUNK));
        }
        digest = h.digest();
      }
      hashes.delete(sha);
      if (digest !== sha) {
        await writePart(sha, { ...p, contiguous: total, hash: null, damaged: true, actual: digest });
        return { ok: false, reason: 'mismatch', actual: digest };
      }
      await fs.release?.(part(sha));
      await fs.rename(part(sha), blob(sha));
      await fs.remove(partJson(sha));
      return { ok: true };
    },

    async deleteBlob(sha) {
      checkSha(sha);
      hashes.delete(sha);
      await fs.release?.(part(sha));
      await fs.remove(blob(sha));
      await fs.remove(part(sha));
      await fs.remove(partJson(sha));
    },

    async release(sha) {
      checkSha(sha);
      await fs.release?.(part(sha));
    },

    async installed() {
      const text = await fs.readText('installed.json');
      if (!text) return [];
      try {
        const v = JSON.parse(text) as { installed?: unknown };
        return Array.isArray(v.installed) ? v.installed.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)) : [];
      } catch {
        return [];
      }
    },

    async install(key, shas) {
      checkKey(key);
      for (const sha of shas) if ((await fs.size(blob(checkSha(sha)))) === null) throw new StoreError('missing', `${key}: ${sha} is not complete`);
      const list = await this.installed();
      const next = list.includes(key) ? list : [...list, key];
      await fs.writeText('installed.json', JSON.stringify({ installed: next }));
      return next;
    },

    async uninstall(key, deleteShas) {
      checkKey(key);
      const list = (await this.installed()).filter((k) => k !== key);
      await fs.writeText('installed.json', JSON.stringify({ installed: list }));
      await fs.remove(`imported/${key}.json`);
      for (const sha of deleteShas) await this.deleteBlob(sha);
      return list;
    },

    async imported() {
      const out: ImportedModel[] = [];
      for (const name of await fs.list('imported')) {
        if (!name.endsWith('.json')) continue;
        const text = await fs.readText(`imported/${name}`);
        if (!text) continue;
        try {
          const r = validateManifest(JSON.parse(text), { requireSha: true });
          if (r.ok && `${r.model.key}.json` === name) out.push(r.model);
        } catch {
          // A damaged manifest is left out (and left on disk).
        }
      }
      return out;
    },

    async putImported(model) {
      checkKey(model.key);
      await fs.writeText(`imported/${model.key}.json`, JSON.stringify(model, null, 2));
    },

    async usage() {
      let n = 0;
      for (const name of await fs.list('blobs')) n += (await fs.size(`blobs/${name}`)) ?? 0;
      return n;
    },
  };
}

/** A BlobFs in memory: the tests' file system, and the store when the browser has no private file system. */
export function memoryFs(): BlobFs & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    files,
    size: async (p) => files.get(p)?.length ?? null,
    readText: async (p) => {
      const f = files.get(p);
      return f ? dec.decode(f) : null;
    },
    writeText: async (p, text) => {
      files.set(p, enc.encode(text));
    },
    writeAt: async (p, offset, bytes) => {
      const f = files.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(Math.max(f.length, offset + bytes.length));
      out.set(f);
      out.set(bytes, offset);
      files.set(p, out);
    },
    readAt: async (p, offset, length) => (files.get(p) ?? new Uint8Array(0)).slice(offset, offset + length),
    truncate: async (p, size) => {
      const f = files.get(p);
      if (f) files.set(p, f.slice(0, size));
    },
    rename: async (from, to) => {
      const f = files.get(from);
      if (!f) throw new Error(`no ${from}`);
      files.set(to, f);
      files.delete(from);
    },
    remove: async (p) => {
      files.delete(p);
    },
    list: async (dir) => [...files.keys()].filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/')).map((k) => k.slice(dir.length + 1)),
  };
}

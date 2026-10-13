// The BlobFs of io/blob-store.ts on the origin private file system (OPFS),
// for the model worker only: sync access handles (`createSyncAccessHandle`)
// exist only in dedicated workers, and they are what writes a chunk of a
// multi-GB file at its offset without copying the file. The handle of a file
// being downloaded stays open between chunks (it locks the file, so a second
// tab gets an error instead of corrupting it) and is closed when the file is
// finished, paused, renamed or deleted.

import type { BlobFs } from './blob-store';

/** The parts of the OPFS API used here (typed locally: the DOM lib of the project has no worker types). */
interface SyncHandle {
  read(buffer: Uint8Array, options?: { at?: number }): number;
  write(buffer: Uint8Array, options?: { at?: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createSyncAccessHandle(): Promise<SyncHandle>;
  move?(name: string): Promise<void>;
}
interface DirHandle {
  kind: 'directory';
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterableIterator<string>;
}

const isNotFound = (e: unknown) => e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

/** The store's folder (`models/` under the origin's private root) as a BlobFs. */
export async function opfsFs(rootName = 'models'): Promise<BlobFs> {
  const storage = (navigator as unknown as { storage?: { getDirectory?: () => Promise<DirHandle> } }).storage;
  if (!storage?.getDirectory) throw new Error('opfs');
  const root = await (await storage.getDirectory()).getDirectoryHandle(rootName, { create: true });
  const open = new Map<string, SyncHandle>();
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const split = (path: string): { dir: string[]; name: string } => {
    const parts = path.split('/').filter(Boolean);
    return { dir: parts.slice(0, -1), name: parts[parts.length - 1] };
  };
  const dirOf = async (parts: string[], create: boolean): Promise<DirHandle | null> => {
    let d = root;
    for (const p of parts) {
      try {
        d = await d.getDirectoryHandle(p, { create });
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    }
    return d;
  };
  const fileOf = async (path: string, create: boolean): Promise<{ dir: DirHandle; handle: FileHandle } | null> => {
    const { dir, name } = split(path);
    const d = await dirOf(dir, create);
    if (!d) return null;
    try {
      return { dir: d, handle: await d.getFileHandle(name, { create }) };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  };
  /** The open handle of a file, opened (and created) when needed. */
  const handleOf = async (path: string, create = true): Promise<SyncHandle | null> => {
    const cached = open.get(path);
    if (cached) return cached;
    const f = await fileOf(path, create);
    if (!f) return null;
    const h = await f.handle.createSyncAccessHandle();
    open.set(path, h);
    return h;
  };
  const release = async (path: string) => {
    const h = open.get(path);
    if (!h) return;
    open.delete(path);
    try {
      h.flush();
    } finally {
      h.close();
    }
  };
  /** Small files (JSON) are opened, used and closed at once. */
  const once = async <T>(path: string, create: boolean, fn: (h: SyncHandle) => T): Promise<T | null> => {
    if (open.has(path)) return fn(open.get(path)!);
    const f = await fileOf(path, create);
    if (!f) return null;
    const h = await f.handle.createSyncAccessHandle();
    try {
      return fn(h);
    } finally {
      h.close();
    }
  };

  return {
    async size(path) {
      const h = open.get(path);
      if (h) return h.getSize();
      const f = await fileOf(path, false);
      if (!f) return null;
      return (await f.handle.getFile()).size;
    },
    async readText(path) {
      return once(path, false, (h) => {
        const buf = new Uint8Array(h.getSize());
        h.read(buf, { at: 0 });
        return dec.decode(buf);
      });
    },
    async writeText(path, text) {
      await once(path, true, (h) => {
        const bytes = enc.encode(text);
        h.truncate(0);
        h.write(bytes, { at: 0 });
        h.flush();
      });
    },
    async writeAt(path, offset, bytes) {
      const h = (await handleOf(path))!;
      let done = 0;
      while (done < bytes.length) done += h.write(bytes.subarray(done), { at: offset + done });
      h.flush();
    },
    async readAt(path, offset, length) {
      const h = await handleOf(path, false);
      if (!h) return new Uint8Array(0);
      const buf = new Uint8Array(Math.max(0, Math.min(length, h.getSize() - offset)));
      h.read(buf, { at: offset });
      return buf;
    },
    async truncate(path, size) {
      const h = await handleOf(path, false);
      if (!h) return;
      h.truncate(size);
      h.flush();
    },
    async rename(from, to) {
      await release(from);
      await release(to);
      const src = await fileOf(from, false);
      if (!src) throw new Error(`no ${from}`);
      const target = split(to);
      if (typeof src.handle.move === 'function' && split(from).dir.join('/') === target.dir.join('/')) {
        await src.handle.move(target.name);
        return;
      }
      // No move(): copy in pieces, then delete the source.
      const a = await src.handle.createSyncAccessHandle();
      const dst = (await fileOf(to, true))!;
      const b = await dst.handle.createSyncAccessHandle();
      try {
        b.truncate(0);
        const size = a.getSize();
        const buf = new Uint8Array(8 * 1024 * 1024);
        for (let at = 0; at < size; ) {
          const n = a.read(buf, { at });
          if (n <= 0) break;
          b.write(buf.subarray(0, n), { at });
          at += n;
        }
        b.flush();
      } finally {
        a.close();
        b.close();
      }
      await src.dir.removeEntry(src.handle.name);
    },
    async remove(path) {
      await release(path);
      const { dir, name } = split(path);
      const d = await dirOf(dir, false);
      if (!d) return;
      try {
        await d.removeEntry(name);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },
    async list(dir) {
      const d = await dirOf(dir.split('/').filter(Boolean), false);
      if (!d) return [];
      const out: string[] = [];
      for await (const name of d.keys()) out.push(name);
      return out;
    },
    release,
  };
}

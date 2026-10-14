// The Repackshot plugin package (.rpk, phase P6): what goes in comes out, a wrong key and an altered package fail
// cleanly (the GCM tag, or the header's SHA-256 before anything is decrypted), and the tools pack and unpack a folder
// without ever writing the key.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeContainer, encodeContainer, newKeyBytes, packRpk, parseKey, readRpk, RpkError, sha256Hex, toBase64, unpackRpk, validEntryName, verifyRpk, type RpkFile } from '../src/plugins/rpk';

const FIXTURE = 'tests/fixtures/plugins/invert';
const enc = new TextEncoder();
const files: RpkFile[] = [
  { name: 'manifest.json', bytes: enc.encode('{"id":"x"}') },
  { name: 'plugin.js', bytes: enc.encode('self.postMessage(1)') },
  { name: 'presets/one.json', bytes: new Uint8Array([0, 1, 2, 250, 255]) },
  { name: 'module.wasm', bytes: new Uint8Array(70_000).map((_, i) => (i * 31) & 255) },
];
const meta = { id: 'test-invert', version: '1.0.0', abi: 1 };

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof RpkError) return err.code;
    throw err;
  }
  return 'OK';
}

/** A package with one byte of the ciphertext flipped, and (when `fix`) its header's SHA-256 rewritten to match. */
async function flipped(pkg: Uint8Array, at: number, fix: boolean): Promise<Uint8Array> {
  const { header, ciphertext } = readRpk(pkg);
  const ct = ciphertext.slice();
  ct[at] ^= 0x40;
  const h = fix ? { ...header, sha256: await sha256Hex(ct) } : header;
  const hb = enc.encode(JSON.stringify(h));
  const out = new Uint8Array(8 + hb.length + ct.length);
  out.set(enc.encode('RPK1'));
  new DataView(out.buffer).setUint32(4, hb.length, true);
  out.set(hb, 8);
  out.set(ct, 8 + hb.length);
  return out;
}

/** A package whose clear header says something else (`patch`), SHA-256 and length untouched. */
function reheadered(pkg: Uint8Array, patch: Record<string, unknown>): Uint8Array {
  const { header, ciphertext } = readRpk(pkg);
  const hb = enc.encode(JSON.stringify({ ...header, ...patch }));
  const out = new Uint8Array(8 + hb.length + ciphertext.length);
  out.set(enc.encode('RPK1'));
  new DataView(out.buffer).setUint32(4, hb.length, true);
  out.set(hb, 8);
  out.set(ciphertext, 8 + hb.length);
  return out;
}

describe('.rpk: the package', () => {
  it('pack → decrypt gives back the same files, in the same order, byte for byte', async () => {
    const key = newKeyBytes();
    const pkg = await packRpk(meta, files, key);
    expect(String.fromCharCode(...pkg.subarray(0, 4))).toBe('RPK1');
    const { header, files: out } = await unpackRpk(pkg, key);
    expect(header).toMatchObject({ id: 'test-invert', version: '1.0.0', abi: 1 });
    expect(out.map((f) => f.name)).toEqual(files.map((f) => f.name));
    out.forEach((f, i) => expect(f.bytes).toEqual(files[i].bytes));
    // The header is clear and names the ciphertext: its length and SHA-256, and a 12-byte nonce.
    const { ciphertext } = readRpk(pkg);
    expect(header.bytes).toBe(ciphertext.length);
    expect(header.sha256).toBe(await sha256Hex(ciphertext));
    // Nothing of the plain contents is readable in the package.
    const text = new TextDecoder('latin1').decode(pkg);
    expect(text).not.toContain('self.postMessage');
    expect(text).not.toContain('presets/one.json');
  });

  it('two packs of the same files under the same key differ (a new nonce each time)', async () => {
    const key = newKeyBytes();
    const a = await packRpk(meta, files, key);
    const b = await packRpk(meta, files, key);
    expect(readRpk(a).header.nonce).not.toBe(readRpk(b).header.nonce);
    expect(readRpk(a).header.sha256).not.toBe(readRpk(b).header.sha256);
  });

  it('a wrong key fails cleanly with the GCM tag', async () => {
    const pkg = await packRpk(meta, files, newKeyBytes());
    expect(await code(unpackRpk(pkg, newKeyBytes()))).toBe('KEY');
  });

  it('a flipped byte is caught by the header SHA-256 before anything is decrypted', async () => {
    const key = newKeyBytes();
    const pkg = await packRpk(meta, files, key);
    const bad = await flipped(pkg, 100, false);
    let decrypts = 0;
    const real = globalThis.crypto.subtle;
    const spy = new Proxy(real, {
      get(target, prop) {
        if (prop === 'decrypt') return (...a: Parameters<SubtleCrypto['decrypt']>) => (decrypts++, target.decrypt(...a));
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
      },
    });
    expect(await code(unpackRpk(bad, key, { subtle: spy }))).toBe('DAMAGED');
    expect(decrypts).toBe(0);
    expect(await code(verifyRpk(bad))).toBe('DAMAGED');
    // The good package goes through the same spy and is decrypted once.
    expect(await code(unpackRpk(pkg, key, { subtle: spy }))).toBe('OK');
    expect(decrypts).toBe(1);
  });

  it('a flipped byte with its SHA-256 rewritten to match fails with the GCM tag', async () => {
    const key = newKeyBytes();
    const pkg = await packRpk(meta, files, key);
    for (const at of [0, 5000, readRpk(pkg).ciphertext.length - 1]) expect(await code(unpackRpk(await flipped(pkg, at, true), key)), `byte ${at}`).toBe('KEY');
  });

  it('a header edited by hand (another version, another id) does not open: the header is authenticated', async () => {
    const key = newKeyBytes();
    const pkg = await packRpk(meta, files, key);
    expect(await code(unpackRpk(reheadered(pkg, { version: '9.9.9' }), key))).toBe('KEY');
    expect(await code(unpackRpk(reheadered(pkg, { id: 'other' }), key))).toBe('KEY');
  });

  it('not a package, a broken header and a short package each say so', async () => {
    const key = newKeyBytes();
    const pkg = await packRpk(meta, files, key);
    expect(await code(unpackRpk(enc.encode('PK\u0003\u0004 a zip'), key))).toBe('NOT_RPK');
    expect(await code(unpackRpk(reheadered(pkg, { sha256: 'nope' }), key))).toBe('HEADER');
    expect(await code(unpackRpk(pkg.subarray(0, pkg.length - 1), key))).toBe('DAMAGED');
    const longer = new Uint8Array(pkg.length + 1);
    longer.set(pkg);
    expect(await code(unpackRpk(longer, key))).toBe('DAMAGED');
  });

  it('an activation key is 32 bytes of base64, standard or URL-safe, white space ignored', () => {
    const key = newKeyBytes();
    const b64 = toBase64(key);
    expect(parseKey(b64)).toEqual(key);
    expect(parseKey(`  ${b64.slice(0, 20)}\n${b64.slice(20)}  `)).toEqual(key);
    expect(parseKey(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))).toEqual(key);
    expect(() => parseKey(toBase64(key.subarray(0, 31)))).toThrow(RpkError);
    expect(() => parseKey('not a key!')).toThrow(/32 bytes/);
  });
});

describe('.rpk: the container', () => {
  it('round-trips names and bytes, and refuses names that leave the package', () => {
    expect(decodeContainer(encodeContainer(files)).map((f) => f.name)).toEqual(files.map((f) => f.name));
    for (const bad of ['../x', 'a/../b', '/abs', 'a\\b', '', '.hidden', 'a//b', 'a/./b']) {
      expect(validEntryName(bad), bad).toBe(false);
      expect(() => encodeContainer([{ name: bad, bytes: new Uint8Array() }]), bad).toThrow(RpkError);
    }
    expect(() => encodeContainer([files[0], files[0]])).toThrow(/twice/);
    expect(validEntryName('presets/stocks/cn-01.json')).toBe(true);
  });

  it('a container cut short or with bytes after its last file is refused', () => {
    const c = encodeContainer(files);
    expect(() => decodeContainer(c.subarray(0, c.length - 1))).toThrow(RpkError);
    const longer = new Uint8Array(c.length + 3);
    longer.set(c);
    expect(() => decodeContainer(longer)).toThrow(/after the last file/);
  });
});

describe('tools/plugin-pack.mjs and tools/plugin-unpack.mjs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rpk-'));
  const node = (...args: string[]) => spawnSync(process.execPath, args, { encoding: 'utf8' });

  it('pack a folder with a new key (printed, never written), unpack it with that key, and refuse another', () => {
    const out = join(dir, 'invert.rpk');
    const packed = node('tools/plugin-pack.mjs', FIXTURE, out, '--new-key');
    expect(packed.status, packed.stderr).toBe(0);
    const key = /key\s+(\S+)/.exec(packed.stdout)?.[1] ?? '';
    expect(parseKey(key)).toHaveLength(32);
    // The registry pins the file's SHA-256 and size; the tool prints both.
    const bytes = readFileSync(out);
    expect(packed.stdout).toContain(`bytes   ${bytes.length}`);
    // The key is in no file the tool wrote.
    for (const f of readdirSync(dir)) if (statSync(join(dir, f)).isFile()) expect(new TextDecoder('latin1').decode(readFileSync(join(dir, f)))).not.toContain(key);
    const back = join(dir, 'back');
    const opened = node('tools/plugin-unpack.mjs', out, back, '--key', key);
    expect(opened.status, opened.stderr).toBe(0);
    for (const name of ['manifest.json', 'plugin.js', 'recipes.json', 'logo.svg', 'LICENCE.txt']) expect(readFileSync(join(back, name))).toEqual(readFileSync(join(FIXTURE, name)));
    const wrong = node('tools/plugin-unpack.mjs', out, join(dir, 'wrong'), '--key', toBase64(newKeyBytes()));
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain('KEY');
    expect(() => readdirSync(join(dir, 'wrong'))).toThrow();
  });

  it('pack refuses a folder whose manifest is not valid, and asks for exactly one way of giving the key', () => {
    const none = node('tools/plugin-pack.mjs', FIXTURE, join(dir, 'x.rpk'));
    expect(none.status).toBe(2);
    const bad = node('tools/plugin-pack.mjs', 'tests/fixtures', join(dir, 'y.rpk'), '--new-key');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('no manifest.json');
  });
});

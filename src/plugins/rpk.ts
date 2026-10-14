// The Repackshot plugin package, `.rpk` (ARCHITECTURE.md §9, ROADMAP P6 decision 1). One file:
//
//   "RPK1"                          4 bytes, the magic
//   header length                   u32, little-endian
//   header                          UTF-8 JSON, in clear: { id, version, abi, bytes, sha256, nonce }
//   ciphertext                      `bytes` bytes: AES-256-GCM of the container, its 16-byte tag at the end
//
// `sha256` is the hex SHA-256 of the ciphertext and `nonce` the 12-byte GCM nonce in base64. The magic, the length
// and the header are the cipher's additional data, so a header edited by hand (another version, another id) does not
// open either. The container is flat: "RPKC", u32 version 1, u32 count, then per entry a u32 name length, the name
// (UTF-8, a relative path with `/`), a u32 data length and the data.
//
// The activation key is 32 random bytes, written in base64. It is never part of the package: the registry's
// `keyUrl` gives it, or the person types it. A package is checked (magic, header, length, SHA-256) before anything is
// decrypted, and decrypted only in memory.
//
// Shared by the application (src/plugins/) and the tools (tools/plugin-pack.mjs, tools/plugin-unpack.mjs, with
// Node's webcrypto): no imports, WebCrypto only, nothing of the DOM.

export const RPK_MAGIC = 'RPK1';
const CONTAINER_MAGIC = 'RPKC';
const CONTAINER_VERSION = 1;
/** Bytes of the GCM tag WebCrypto appends to the ciphertext. */
const TAG_BYTES = 16;
const NONCE_BYTES = 12;
export const KEY_BYTES = 32;
/** The largest header this reader accepts (it is a few hundred bytes). */
const MAX_HEADER = 64 * 1024;
const MAX_ENTRIES = 4096;
const MAX_NAME = 255;

/** The clear header of a package. */
export interface RpkHeader {
  id: string;
  version: string;
  /** The host ABI the plugin speaks (1). */
  abi: number;
  /** Length of the ciphertext, tag included. */
  bytes: number;
  /** Hex SHA-256 of the ciphertext. */
  sha256: string;
  /** The GCM nonce, base64 (12 bytes). */
  nonce: string;
}

export interface RpkFile {
  name: string;
  bytes: Uint8Array;
}

export type RpkErrorCode =
  /** Not a package: the magic is not RPK1. */
  | 'NOT_RPK'
  /** The header is not the JSON this format writes. */
  | 'HEADER'
  /** The ciphertext is not as long as the header says, or its SHA-256 is not the header's: damaged or altered. */
  | 'DAMAGED'
  /** The cipher refused it: the key is not this package's, or the package (its header) was altered. */
  | 'KEY'
  /** The text given as a key is not 32 bytes of base64. */
  | 'BAD_KEY'
  /** The decrypted container is not one this format writes. */
  | 'CONTAINER';

export class RpkError extends Error {
  readonly code: RpkErrorCode;
  constructor(code: RpkErrorCode, message: string) {
    super(message);
    this.name = 'RpkError';
    this.code = code;
  }
}

type Subtle = SubtleCrypto;

function subtleOf(subtle?: Subtle): Subtle {
  const s = subtle ?? (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!s) throw new Error('WebCrypto is not available');
  return s;
}

// ------------------------------------------------------------------ bytes, text, base64

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function u32(view: DataView, at: number): number {
  return view.getUint32(at, true);
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Standard or URL-safe base64, padding optional, white space ignored; null when it is not base64. */
export function fromBase64(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  const padded = clean.length % 4 === 0 ? clean : clean + '='.repeat(4 - (clean.length % 4));
  if (padded.length % 4 === 1) return null;
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A copy of `bytes` in an ArrayBuffer of its own (what WebCrypto takes without a shared or offset view). */
function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

export async function sha256Hex(bytes: Uint8Array, subtle?: Subtle): Promise<string> {
  return hex(new Uint8Array(await subtleOf(subtle).digest('SHA-256', own(bytes))));
}

// ------------------------------------------------------------------ the key

/** 32 random bytes from the platform's generator. */
export function newKeyBytes(): Uint8Array {
  const key = new Uint8Array(KEY_BYTES);
  globalThis.crypto.getRandomValues(key);
  return key;
}

/** A new activation key, as the person types it (base64). */
export function newKey(): string {
  return toBase64(newKeyBytes());
}

/** The key a person typed or a `keyUrl` answered, as bytes; a `BAD_KEY` error when it is not 32 bytes of base64. */
export function parseKey(text: string): Uint8Array {
  const bytes = fromBase64(text.trim());
  if (!bytes || bytes.length !== KEY_BYTES) throw new RpkError('BAD_KEY', `an activation key is ${KEY_BYTES} bytes of base64`);
  return bytes;
}

// ------------------------------------------------------------------ the container

const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;

/** Whether a name can stand in a container: a relative path of plain segments, no `..`, no leading dot or slash. */
export function validEntryName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME && NAME.test(name) && !name.split('/').some((s) => s === '.' || s === '..');
}

export function encodeContainer(files: readonly RpkFile[]): Uint8Array {
  if (files.length > MAX_ENTRIES) throw new RpkError('CONTAINER', `a package holds at most ${MAX_ENTRIES} files`);
  const seen = new Set<string>();
  const names = files.map((f) => {
    if (!validEntryName(f.name)) throw new RpkError('CONTAINER', `"${f.name}" is not a file name a package can hold`);
    if (seen.has(f.name)) throw new RpkError('CONTAINER', `"${f.name}" is in the package twice`);
    seen.add(f.name);
    return enc.encode(f.name);
  });
  const size = 12 + files.reduce((n, f, i) => n + 8 + names[i].length + f.bytes.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(enc.encode(CONTAINER_MAGIC), 0);
  view.setUint32(4, CONTAINER_VERSION, true);
  view.setUint32(8, files.length, true);
  let at = 12;
  files.forEach((f, i) => {
    view.setUint32(at, names[i].length, true);
    out.set(names[i], at + 4);
    at += 4 + names[i].length;
    view.setUint32(at, f.bytes.length, true);
    out.set(f.bytes, at + 4);
    at += 4 + f.bytes.length;
  });
  return out;
}

export function decodeContainer(bytes: Uint8Array): RpkFile[] {
  const bad = (why: string): never => {
    throw new RpkError('CONTAINER', `the package's contents are damaged: ${why}`);
  };
  if (bytes.length < 12) bad('too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dec.decode(bytes.subarray(0, 4)) !== CONTAINER_MAGIC) bad('no container');
  if (u32(view, 4) !== CONTAINER_VERSION) bad(`container version ${u32(view, 4)}`);
  const count = u32(view, 8);
  if (count > MAX_ENTRIES) bad(`${count} files`);
  const out: RpkFile[] = [];
  const seen = new Set<string>();
  let at = 12;
  for (let i = 0; i < count; i++) {
    if (at + 4 > bytes.length) bad('cut short');
    const nameLen = u32(view, at);
    if (nameLen > MAX_NAME || at + 4 + nameLen + 4 > bytes.length) bad('cut short');
    let name = '';
    try {
      name = dec.decode(bytes.subarray(at + 4, at + 4 + nameLen));
    } catch {
      bad('a name that is not UTF-8');
    }
    at += 4 + nameLen;
    const len = u32(view, at);
    if (at + 4 + len > bytes.length) bad('cut short');
    if (!validEntryName(name) || seen.has(name)) bad(`the name "${name}"`);
    seen.add(name);
    out.push({ name, bytes: bytes.slice(at + 4, at + 4 + len) });
    at += 4 + len;
  }
  if (at !== bytes.length) bad('bytes after the last file');
  return out;
}

// ------------------------------------------------------------------ the package

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The header from its JSON, every field checked; a `HEADER` error otherwise. */
export function parseHeader(json: unknown): RpkHeader {
  const bad = (why: string): never => {
    throw new RpkError('HEADER', `the package's header is not valid: ${why}`);
  };
  if (!isRecord(json)) return bad('not an object');
  const { id, version, abi, bytes, sha256, nonce } = json;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(id)) bad('id');
  if (typeof version !== 'string' || !/^[0-9A-Za-z.+-]{1,32}$/.test(version)) bad('version');
  if (typeof abi !== 'number' || !Number.isInteger(abi) || abi < 1) bad('abi');
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < TAG_BYTES) bad('bytes');
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) bad('sha256');
  if (typeof nonce !== 'string' || fromBase64(nonce)?.length !== NONCE_BYTES) bad('nonce');
  return { id: id as string, version: version as string, abi: abi as number, bytes: bytes as number, sha256: sha256 as string, nonce: nonce as string };
}

/** The parts of a package: its header, the bytes the cipher authenticates with it, and the ciphertext. */
export function readRpk(bytes: Uint8Array): { header: RpkHeader; aad: Uint8Array; ciphertext: Uint8Array } {
  if (bytes.length < 8 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== RPK_MAGIC) throw new RpkError('NOT_RPK', 'this file is not a Repackshot plugin (.rpk)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = u32(view, 4);
  if (len > MAX_HEADER || 8 + len > bytes.length) throw new RpkError('HEADER', 'the package\'s header is cut short');
  let json: unknown;
  try {
    json = JSON.parse(dec.decode(bytes.subarray(8, 8 + len)));
  } catch {
    throw new RpkError('HEADER', 'the package\'s header is not JSON');
  }
  const header = parseHeader(json);
  const ciphertext = bytes.subarray(8 + len);
  if (ciphertext.length !== header.bytes) throw new RpkError('DAMAGED', `the package holds ${ciphertext.length} bytes of the ${header.bytes} its header says: it is damaged or incomplete`);
  return { header, aad: bytes.subarray(0, 8 + len), ciphertext };
}

/** The header, once the length and the SHA-256 of the ciphertext are the header's. Nothing is decrypted. */
export async function verifyRpk(bytes: Uint8Array, subtle?: Subtle): Promise<RpkHeader> {
  const { header, ciphertext } = readRpk(bytes);
  if ((await sha256Hex(ciphertext, subtle)) !== header.sha256) throw new RpkError('DAMAGED', 'the package\'s contents are not the ones its header names: it is damaged or was altered');
  return header;
}

async function aesKey(key: Uint8Array, usage: 'encrypt' | 'decrypt', subtle?: Subtle): Promise<CryptoKey> {
  if (key.length !== KEY_BYTES) throw new RpkError('BAD_KEY', `an activation key is ${KEY_BYTES} bytes`);
  return subtleOf(subtle).importKey('raw', own(key), { name: 'AES-GCM' }, false, [usage]);
}

/** Packs and encrypts `files` under `key`; the nonce is new unless given (tests). */
export async function packRpk(meta: { id: string; version: string; abi: number }, files: readonly RpkFile[], key: Uint8Array, opts: { subtle?: Subtle; nonce?: Uint8Array } = {}): Promise<Uint8Array> {
  const nonce = opts.nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  if (nonce.length !== NONCE_BYTES) throw new Error(`a nonce is ${NONCE_BYTES} bytes`);
  const plain = encodeContainer(files);
  const subtle = subtleOf(opts.subtle);
  const ck = await aesKey(key, 'encrypt', subtle);
  // GCM adds its tag, so the ciphertext's length is known before encrypting; its hash only after. The cipher
  // authenticates every field of the header but the hash (`additionalData`), which is checked before decrypting.
  const bytes = plain.length + TAG_BYTES;
  const authHeader = { id: meta.id, version: meta.version, abi: meta.abi, bytes, sha256: '0'.repeat(64), nonce: toBase64(nonce) };
  parseHeader(authHeader);
  const aad = additionalData(authHeader);
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: own(nonce), additionalData: own(aad), tagLength: TAG_BYTES * 8 }, ck, own(plain)));
  const header: RpkHeader = { ...authHeader, sha256: await sha256Hex(ciphertext, subtle) };
  const headerBytes = enc.encode(JSON.stringify(header));
  const out = new Uint8Array(8 + headerBytes.length + ciphertext.length);
  out.set(enc.encode(RPK_MAGIC), 0);
  new DataView(out.buffer).setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  out.set(ciphertext, 8 + headerBytes.length);
  return out;
}

/**
 * The bytes the cipher authenticates with the ciphertext: the magic and every field of the header but the hash (the
 * hash is of the ciphertext, so it cannot be inside what made it), in a fixed order.
 */
function additionalData(h: RpkHeader): Uint8Array {
  return enc.encode(`${RPK_MAGIC}\n${JSON.stringify([h.id, h.version, h.abi, h.bytes, h.nonce])}`);
}

/**
 * Opens a package: the header and the SHA-256 are checked first (a `DAMAGED` error, nothing decrypted), then the
 * cipher (a `KEY` error for a wrong key or an altered header), then the container. Everything stays in memory.
 */
export async function unpackRpk(bytes: Uint8Array, key: Uint8Array, opts: { subtle?: Subtle } = {}): Promise<{ header: RpkHeader; files: RpkFile[] }> {
  const subtle = subtleOf(opts.subtle);
  const header = await verifyRpk(bytes, subtle);
  const { ciphertext } = readRpk(bytes);
  const ck = await aesKey(key, 'decrypt', subtle);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: own(fromBase64(header.nonce)!), additionalData: own(additionalData(header)), tagLength: TAG_BYTES * 8 }, ck, own(ciphertext)));
  } catch {
    throw new RpkError('KEY', 'the activation key does not open this package, or the package was altered');
  }
  return { header, files: decodeContainer(plain) };
}

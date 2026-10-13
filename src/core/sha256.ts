// SHA-256 (FIPS 180-4), streaming, written from the standard. `crypto.subtle`
// only hashes a whole buffer at once, and the AI model files are several GB
// that arrive in pieces over hours (with the page closed in between), so the
// download manager keeps a running state: `update` takes any number of bytes,
// `save` / `restore` turn the state into JSON stored next to a partial file,
// and `digest` finishes. Pure and synchronous: the browser runs it in a worker
// (io/model-worker.ts), the tests run it directly against the NIST vectors.

// Int32Array, not Uint32Array: V8 keeps int32 values unboxed, and the arithmetic is the same modulo 2^32.
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** The running state as JSON: the eight words, the bytes not yet in a block (hex), and the length so far. */
export interface Sha256State {
  h: number[];
  tail: string;
  length: number;
}

const toHex = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
};

const fromHex = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new Error('sha256: bad state');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export class Sha256 {
  private readonly h = new Int32Array(H0);
  private readonly w = new Int32Array(64);
  private readonly block = new Uint8Array(64);
  /** Bytes in `block` waiting for the rest of it. */
  private fill = 0;
  /** Bytes hashed so far (exact up to 2^53). */
  private total = 0;
  private finished = false;

  /** Bytes taken so far. */
  get length(): number {
    return this.total;
  }

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('sha256: update after digest');
    let i = 0;
    const n = data.length;
    this.total += n;
    if (this.fill > 0) {
      const take = Math.min(64 - this.fill, n);
      this.block.set(data.subarray(0, take), this.fill);
      this.fill += take;
      i = take;
      if (this.fill < 64) return this;
      this.compress(this.block, 0);
      this.fill = 0;
    }
    for (; i + 64 <= n; i += 64) this.compress(data, i);
    if (i < n) {
      this.block.set(data.subarray(i), 0);
      this.fill = n - i;
    }
    return this;
  }

  /** The digest, 32 bytes. The hash cannot be updated afterwards. */
  digestBytes(): Uint8Array {
    if (this.finished) throw new Error('sha256: digest twice');
    this.finished = true;
    const bits = this.total * 8;
    const pad = new Uint8Array(this.fill < 56 ? 64 : 128);
    pad.set(this.block.subarray(0, this.fill));
    pad[this.fill] = 0x80;
    const v = new DataView(pad.buffer);
    // The length in bits as a 64-bit big-endian number.
    v.setUint32(pad.length - 8, Math.floor(bits / 0x100000000));
    v.setUint32(pad.length - 4, bits >>> 0);
    for (let o = 0; o < pad.length; o += 64) this.compress(pad, o);
    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    for (let k = 0; k < 8; k++) ov.setUint32(k * 4, this.h[k] >>> 0);
    return out;
  }

  /** The digest in lower-case hex, the form of the file names and of ai-models.json. */
  digest(): string {
    return toHex(this.digestBytes());
  }

  save(): Sha256State {
    if (this.finished) throw new Error('sha256: save after digest');
    return { h: [...this.h].map((x) => x >>> 0), tail: toHex(this.block.subarray(0, this.fill)), length: this.total };
  }

  static restore(state: Sha256State): Sha256 {
    const s = new Sha256();
    if (!state || !Array.isArray(state.h) || state.h.length !== 8 || typeof state.length !== 'number' || !Number.isInteger(state.length) || state.length < 0) throw new Error('sha256: bad state');
    const tail = fromHex(state.tail ?? '');
    if (tail.length >= 64 || tail.length !== state.length % 64) throw new Error('sha256: bad state');
    for (let k = 0; k < 8; k++) {
      const x = state.h[k];
      if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > 0xffffffff) throw new Error('sha256: bad state');
      s.h[k] = x | 0;
    }
    s.block.set(tail);
    s.fill = tail.length;
    s.total = state.length;
    return s;
  }

  private compress(src: Uint8Array, o: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t++) {
      const j = o + t * 4;
      w[t] = (src[j] << 24) | (src[j + 1] << 16) | (src[j + 2] << 8) | src[j + 3];
    }
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15];
      const b = w[t - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[t] = (((w[t - 16] + s0) | 0) + ((w[t - 7] + s1) | 0)) | 0;
    }
    const h = this.h;
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (((((hh + S1) | 0) + ch) | 0) + ((K[t] + w[t]) | 0)) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
}

/** SHA-256 of one buffer, hex. */
export function sha256Hex(data: Uint8Array): string {
  return new Sha256().update(data).digest();
}

export const SHA256_RE = /^[0-9a-f]{64}$/;

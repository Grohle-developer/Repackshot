// The streaming SHA-256 of core/sha256.ts (phase U6) against the NIST test vectors (FIPS 180-4
// examples and the long-message vector), in one piece and in chunks of odd sizes, through a saved
// and restored state, and against Node's own implementation on random data.

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Sha256, sha256Hex } from '../src/core/sha256';

const enc = (s: string) => new TextEncoder().encode(s);

const VECTORS: [string, Uint8Array, string][] = [
  ['empty', enc(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', enc('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['448 bits', enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  [
    '896 bits',
    enc('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'),
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  ],
  ['a million a', new Uint8Array(1_000_000).fill(0x61), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
];

/** Feeds `data` in chunks whose sizes cycle through `sizes`. */
function chunked(data: Uint8Array, sizes: readonly number[]): string {
  const h = new Sha256();
  let i = 0;
  for (let k = 0; i < data.length; k++) {
    const n = sizes[k % sizes.length];
    h.update(data.subarray(i, i + n));
    i += n;
  }
  return h.digest();
}

function random(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 255;
  }
  return out;
}

describe('SHA-256', () => {
  for (const [name, data, want] of VECTORS) {
    it(`NIST vector: ${name}`, () => {
      expect(sha256Hex(data)).toBe(want);
    });
    it(`NIST vector in odd chunks: ${name}`, () => {
      expect(chunked(data, [1, 7, 63, 64, 65, 3, 129, 1000])).toBe(want);
      expect(chunked(data, [55])).toBe(want);
      expect(chunked(data, [56, 1])).toBe(want);
    });
  }

  it('a saved state goes on where it stopped (as after closing the page)', () => {
    const data = random(300_001, 7);
    for (const cut of [0, 1, 63, 64, 65, 1000, 299_999]) {
      const a = new Sha256().update(data.subarray(0, cut));
      const state = JSON.parse(JSON.stringify(a.save()));
      const b = Sha256.restore(state).update(data.subarray(cut));
      expect(b.digest(), `cut at ${cut}`).toBe(sha256Hex(data));
    }
  });

  it('matches Node on random data at every length around the block size', () => {
    for (let n = 0; n < 200; n++) {
      const data = random(n, n + 1);
      expect(sha256Hex(data), `length ${n}`).toBe(createHash('sha256').update(data).digest('hex'));
    }
    const big = random(5_000_011, 99);
    expect(chunked(big, [4 * 1024 * 1024 + 3, 17])).toBe(createHash('sha256').update(big).digest('hex'));
  });

  it('refuses a broken state and use after the digest', () => {
    expect(() => Sha256.restore({ h: [1, 2, 3], tail: '', length: 0 })).toThrow();
    expect(() => Sha256.restore({ h: [0, 0, 0, 0, 0, 0, 0, 0], tail: 'ab', length: 3 })).toThrow();
    const h = new Sha256().update(enc('abc'));
    h.digest();
    expect(() => h.update(enc('x'))).toThrow();
  });
});

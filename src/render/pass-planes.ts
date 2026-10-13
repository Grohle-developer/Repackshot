// The engine's exact passes on the page (phase X2, AI-POST.md §7.4; the contract is core/passes.ts): how the
// planes come out of rt.wasm tile by tile and are put together, and the reader of the launcher's `RPP1` file.
// No DOM and no workers here, so the tests run it in Node, with the real rt.wasm where it is built.
//
//   - Per tile, `rt_render_tile_passes` gives the exact planes (normal, depth, the ids, coc: one ray through
//     each pixel's centre) once, and `rt_render_tile_albedo` the albedo of every sample. `PassAccumulator`
//     adds the albedo samples in index order in f32 (a Float32Array rounds every sum) and divides by the
//     f32 reciprocal of their count, like `Film::resolve` and the image's `Accumulator`, so the planes are
//     the native engine's bit for bit (engine/tools/wasm-parity.mjs and tests/passes-wasm.test.ts).
//   - `RPP1` (engine/crates/rt-app/src/kept.rs): 32 bytes of header (magic, header length, width, height,
//     mask, samples, render id, 0), then the planes of the mask in key order, little-endian words.

import { PASS_CHANNELS, PASS_KEYS, type PassKey, type RenderPasses } from '../core/passes';
import type { Tile } from './tiles';

/** Bit of the albedo, the only pass that follows the samples. */
export const ALBEDO_BIT = 1;
/** The passes of the centre ray (all but the albedo). */
export const EXACT_BITS = ((1 << PASS_KEYS.length) - 1) & ~ALBEDO_BIT;

/** The known passes of a mask, in key order. */
export function keysOfMask(mask: number): PassKey[] {
  return PASS_KEYS.filter((_, i) => (mask >>> i) & 1);
}

/** Words per pixel of the known passes of `mask` together. */
export function wordsPerPixel(mask: number): number {
  return keysOfMask(mask).reduce((n, k) => n + PASS_CHANNELS[k], 0);
}

const isId = (k: PassKey) => k === 'partId' || k === 'materialId';

/** A plane of `n` pixels as the contract has it at the start: background (depth +∞, the rest 0). */
function blank(k: PassKey, n: number): Float32Array | Uint32Array {
  if (isId(k)) return new Uint32Array(n);
  const p = new Float32Array(n * PASS_CHANNELS[k]);
  if (k === 'depth') p.fill(Infinity);
  return p;
}

/** The passes of a render being rendered, tile by tile. */
export class PassAccumulator {
  readonly width: number;
  readonly height: number;
  /** The known passes asked for. */
  readonly mask: number;
  readonly tiles: readonly Tile[];
  /** Albedo sums, 3 per pixel (empty without the albedo). */
  readonly albedoSum: Float32Array;
  /** Albedo samples summed into each tile. */
  readonly albedoSamples: Int32Array;
  private readonly planes = new Map<PassKey, Float32Array | Uint32Array>();

  constructor(width: number, height: number, mask: number, tiles: readonly Tile[]) {
    this.width = width;
    this.height = height;
    this.mask = mask & ((1 << PASS_KEYS.length) - 1);
    this.tiles = tiles;
    const n = width * height;
    this.albedoSum = new Float32Array(this.mask & ALBEDO_BIT ? n * 3 : 0);
    this.albedoSamples = new Int32Array(tiles.length);
    for (const k of keysOfMask(this.mask & EXACT_BITS)) this.planes.set(k, blank(k, n));
  }

  /** The exact passes asked for. */
  get exactMask(): number {
    return this.mask & EXACT_BITS;
  }

  /**
   * Adds `count` albedo samples of tile `index` (each `w * h * 3` floats), which must continue where the
   * tile stopped (samples in index order, like the image); anything else is refused and false returned.
   */
  addAlbedo(index: number, first: number, count: number, data: Float32Array): boolean {
    const t = this.tiles[index];
    if (!(this.mask & ALBEDO_BIT) || !t || first !== this.albedoSamples[index] || count <= 0 || data.length < count * t.w * t.h * 3) return false;
    const stride = t.w * t.h * 3;
    const sum = this.albedoSum;
    for (let s = 0; s < count; s++) {
      for (let y = 0; y < t.h; y++) {
        let o = ((t.y + y) * this.width + t.x) * 3;
        let i = s * stride + y * t.w * 3;
        for (let x = 0; x < t.w * 3; x++) sum[o++] += data[i++];
      }
    }
    this.albedoSamples[index] += count;
    return true;
  }

  /** Puts the exact planes of tile `index` (`rt_render_tile_passes` of `exactMask`: planes in key order) in place. */
  setExact(index: number, words: Uint32Array): boolean {
    const t = this.tiles[index];
    const n = t ? t.w * t.h : 0;
    if (!t || words.length < n * wordsPerPixel(this.exactMask)) return false;
    let o = 0;
    for (const k of keysOfMask(this.exactMask)) {
      const c = PASS_CHANNELS[k];
      const plane = this.planes.get(k)!;
      // The plane's own words: a Float32Array view of a Uint32Array copies the bits as they are.
      const bits = plane instanceof Uint32Array ? plane : new Uint32Array(plane.buffer, plane.byteOffset, plane.length);
      for (let y = 0; y < t.h; y++) bits.set(words.subarray(o + y * t.w * c, o + (y + 1) * t.w * c), ((t.y + y) * this.width + t.x) * c);
      o += n * c;
    }
    return true;
  }

  /** The finished passes: the albedo divided by its sample count as `Film::resolve` does, the exact planes as they are. */
  resolve(): RenderPasses {
    const out: RenderPasses = { width: this.width, height: this.height };
    if (this.mask & ALBEDO_BIT) {
      const albedo = new Float32Array(this.albedoSum.length);
      for (const t of this.tiles) {
        const n = this.albedoSamples[t.index];
        if (n <= 0) continue;
        const inv = Math.fround(1 / n);
        for (let y = 0; y < t.h; y++) {
          const o = ((t.y + y) * this.width + t.x) * 3;
          for (let x = 0; x < t.w * 3; x++) albedo[o + x] = Math.fround(this.albedoSum[o + x] * inv);
        }
      }
      out.albedo = albedo;
    }
    for (const [k, plane] of this.planes) (out as unknown as Record<PassKey, Float32Array | Uint32Array>)[k] = plane;
    return out;
  }
}

// ------------------------------------------------------------------ rt.wasm, one tile

/** The exports of rt.wasm the passes use. */
export interface RtPassExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_render_tile_passes(handle: number, x: number, y: number, w: number, h: number, mask: number, out: number): number;
  rt_render_tile_albedo(handle: number, x: number, y: number, w: number, h: number, sample: number, out: number): number;
}

/** True when a compiled engine can render passes (an rt.wasm older than X2 cannot). */
export function hasPassExports(e: object): e is RtPassExports {
  const x = e as Partial<RtPassExports>;
  return typeof x.rt_render_tile_passes === 'function' && typeof x.rt_render_tile_albedo === 'function';
}

/** A buffer in wasm memory that grows as needed. */
export class Scratch {
  ptr = 0;
  len = 0;
  constructor(private readonly rt: RtPassExports) {}
  get(bytes: number): number {
    if (bytes > this.len) {
      if (this.ptr) this.rt.rt_free(this.ptr, this.len);
      this.ptr = this.rt.rt_alloc(bytes);
      this.len = bytes;
    }
    return this.ptr;
  }
  free(): void {
    if (this.ptr) this.rt.rt_free(this.ptr, this.len);
    this.ptr = 0;
    this.len = 0;
  }
}

/** The exact planes of a tile (`mask`'s known exact bits), copied out of wasm memory; a status other than 0 throws. */
export function tileExact(rt: RtPassExports, handle: number, t: { x: number; y: number; w: number; h: number }, mask: number, scratch: Scratch): Uint32Array {
  const words = t.w * t.h * wordsPerPixel(mask & EXACT_BITS);
  const ptr = scratch.get(Math.max(4, words * 4));
  const status = rt.rt_render_tile_passes(handle, t.x, t.y, t.w, t.h, mask & EXACT_BITS, ptr);
  if (status !== 0) throw new Error(`rt_render_tile_passes returned ${status}`);
  // A fresh view: rendering may grow the memory and detach the old buffer.
  return new Uint32Array(rt.memory.buffer, ptr, words).slice();
}

/** The albedo of sample `sample` of a tile into `out` at `offset` (w * h * 3 floats); a status other than 0 throws. */
export function tileAlbedo(rt: RtPassExports, handle: number, t: { x: number; y: number; w: number; h: number }, sample: number, scratch: Scratch, out: Float32Array, offset: number): void {
  const n = t.w * t.h * 3;
  const ptr = scratch.get(n * 4);
  const status = rt.rt_render_tile_albedo(handle, t.x, t.y, t.w, t.h, sample, ptr);
  if (status !== 0) throw new Error(`rt_render_tile_albedo returned ${status}`);
  out.set(new Float32Array(rt.memory.buffer, ptr, n), offset);
}

// ------------------------------------------------------------------ RPP1, the launcher's file

export const PASSES_MAGIC = 0x31505052; // "RPP1" little-endian
export const PASSES_HEADER = 32;

/** Reads `GET /api/render/<id>/passes` (engine/crates/rt-app/src/kept.rs): the render's id, the albedo's samples and the planes. */
export function parsePasses(buf: ArrayBuffer): { id: number; samples: number; passes: RenderPasses } {
  if (buf.byteLength < PASSES_HEADER) throw new Error('short passes');
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== PASSES_MAGIC) throw new Error('not a passes file');
  const u = (i: number) => v.getUint32(i, true);
  const header = u(4);
  if (header < PASSES_HEADER || header % 4 !== 0 || header > buf.byteLength) throw new Error('bad passes header');
  const width = u(8);
  const height = u(12);
  const mask = u(16);
  const n = width * height;
  const passes: RenderPasses = { width, height };
  let pos = header;
  for (const k of keysOfMask(mask)) {
    const len = n * PASS_CHANNELS[k];
    if (pos + len * 4 > buf.byteLength) throw new Error(`short passes data (${k})`);
    // The header is a multiple of 4 and so is every plane: aligned views; every browser is little-endian.
    (passes as unknown as Record<PassKey, Float32Array | Uint32Array>)[k] = isId(k) ? new Uint32Array(buf, pos, len) : new Float32Array(buf, pos, len);
    pos += len * 4;
  }
  return { id: u(24), samples: u(20), passes };
}

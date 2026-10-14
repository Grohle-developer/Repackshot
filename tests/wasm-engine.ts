// The real rt.wasm in Node, for the tests of the passes (phase X2): it renders an RSB tile by tile the way the
// worker pool does (src/render/worker.ts), through the page's own code (render/pass-planes.ts for the passes,
// render/tiles.ts for the image), so what the pool would hand back can be compared with the native engine's
// pinned hashes and with the three.js passes.
//
// rt.wasm comes from `npm run engine:build` (public/engine/rt.wasm, not in git); without it the tests that need
// it are skipped, unless REPACK_REQUIRE_RT_WASM or REPACK_REQUIRE_POST_WASM is set.

import { existsSync, readFileSync } from 'node:fs';
import { PASS_KEYS, type RenderPasses } from '../src/core/passes';
import { hasPassExports, PassAccumulator, Scratch, tileAlbedo, tileExact, type RtPassExports } from '../src/render/pass-planes';
import { Accumulator, tileGrid } from '../src/render/tiles';

const PATHS = [process.env.REPACK_RT_WASM, 'public/engine/rt.wasm', 'engine/target/wasm32-unknown-unknown/release/rt_wasm.wasm'].filter((p): p is string => !!p);
export const RT_WASM = PATHS.find((p) => existsSync(p)) ?? null;
if (!RT_WASM && (process.env.REPACK_REQUIRE_RT_WASM || process.env.REPACK_REQUIRE_POST_WASM)) throw new Error('rt.wasm is required: npm run engine:build');

export interface Rt extends RtPassExports {
  rt_scene_load(ptr: number, len: number): number;
  rt_scene_free(handle: number): number;
  rt_scene_error_len(): number;
  rt_scene_error_copy(ptr: number): void;
  rt_render_tile_rgba(handle: number, x: number, y: number, w: number, h: number, sample: number, out: number): number;
}

/** A fresh instance of the engine. */
export async function loadRt(path = RT_WASM): Promise<Rt> {
  if (!path) throw new Error('no rt.wasm');
  const { instance } = await WebAssembly.instantiate(readFileSync(path), {});
  const rt = instance.exports as unknown as Rt;
  if (!hasPassExports(rt)) throw new Error(`${path} renders no passes: npm run engine:build`);
  return rt;
}

/** Renders `samples` samples of an RSB and the passes of `mask`, as the pool does; frees the scene. */
export function renderWithPasses(rt: Rt, rsb: Uint8Array, width: number, height: number, samples: number, mask: number, opts: { lum2?: boolean } = {}): { image: Accumulator; passes: RenderPasses } {
  const ptr = rt.rt_alloc(rsb.length);
  new Uint8Array(rt.memory.buffer, ptr, rsb.length).set(rsb);
  const handle = rt.rt_scene_load(ptr, rsb.length);
  rt.rt_free(ptr, rsb.length);
  if (handle === 0) throw new Error('rt_scene_load failed');
  const image = new Accumulator(width, height, tileGrid(width, height), { lum2: opts.lum2 });
  const passes = new PassAccumulator(width, height, mask, image.tiles);
  const scratch = new Scratch(rt);
  const out = rt.rt_alloc(32 * 32 * 4 * 4);
  try {
    for (const t of image.tiles) {
      if (passes.exactMask) passes.setExact(t.index, tileExact(rt, handle, t, mask, scratch));
      const rgba = new Float32Array(t.w * t.h * 4 * samples);
      const albedo = new Float32Array(t.w * t.h * 3 * samples);
      for (let s = 0; s < samples; s++) {
        const status = rt.rt_render_tile_rgba(handle, t.x, t.y, t.w, t.h, s, out);
        if (status !== 0) throw new Error(`rt_render_tile_rgba returned ${status}`);
        rgba.set(new Float32Array(rt.memory.buffer, out, t.w * t.h * 4), s * t.w * t.h * 4);
        if (mask & 1) tileAlbedo(rt, handle, t, s, scratch, albedo, s * t.w * t.h * 3);
      }
      image.add(t.index, 0, samples, rgba);
      if (mask & 1) passes.addAlbedo(t.index, 0, samples, albedo);
    }
  } finally {
    rt.rt_free(out, 32 * 32 * 4 * 4);
    scratch.free();
    rt.rt_scene_free(handle);
  }
  return { image, passes: passes.resolve() };
}

/** FNV-1a over the little-endian bytes of 4-byte words (the engine's test hash). */
export function fnv1a(words: Float32Array | Uint32Array): number {
  const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  return h;
}

/** The mean RGB of the image as `Film::resolve` computes it (the sums times the f32 reciprocal of the count). */
export function resolveRgb(image: Accumulator, samples: number): Float32Array {
  const inv = Math.fround(1 / samples);
  const n = image.width * image.height;
  const out = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) out[p * 3 + c] = Math.fround(image.sum[p * 4 + c] * inv);
  return out;
}

/** The value of `const <name>: u32 = 0x…;` in an engine source file. */
export function pinned(file: string, name: string): number {
  const m = new RegExp(`${name}: u32 = 0x([0-9a-f_]+);`).exec(readFileSync(file, 'utf8'));
  if (!m) throw new Error(`${name} is not pinned in ${file}`);
  return Number.parseInt(m[1].replaceAll('_', ''), 16) >>> 0;
}

/** The pinned pass hashes of a scene (`PINNED_<prefix>PASS_*`), in the order of PASS_KEYS. */
export function pinnedPasses(prefix: '' | 'E5_'): number[] {
  const file = 'engine/crates/rt-core/src/render/passes_tests.rs';
  return ['ALBEDO', 'NORMAL', 'DEPTH', 'PART_ID', 'MATERIAL_ID', 'COC'].map((k) => pinned(file, `PINNED_${prefix}PASS_${k}`));
}

/** FNV-1a of every plane of `passes`, in the order of PASS_KEYS. */
export function passHashes(passes: RenderPasses): number[] {
  return PASS_KEYS.map((k) => fnv1a(passes[k]!));
}

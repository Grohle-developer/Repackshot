// The engine's own denoiser on the page (phase E5b-1): rt_post::denoise through `rt_denoise` of rt.wasm, run
// by the pool's workers on bands of rows. Each band carries HALO rows above and below it, so every band is
// exactly those rows of the whole image (rt_post::denoise::denoise_rows), whatever the number of workers: the
// pool's denoised image is the launcher's and `rt`'s bit for bit (engine/tools/wasm-parity.mjs --denoise).
//
// What it reads: the accumulated RGBA sums of `samples` samples, the sums of the squared luminance of every sample
// (Accumulator.lum2, the film's rule), and the guide passes (albedo, normal, depth, part and material ids) the
// workers render next to the image. Pure: no DOM and no workers, so the tests run it in Node with the real module.
//
// Two presets (U11, rt_post::denoise::Preset): FULL, the filter of a Render, and VIEWPORT, the lighter one the
// Full viewport denoises with while it accumulates (three passes instead of five, a 3 × 3 variance estimate), with
// its own halo, so its bands are smaller too.

import { passMask, type PassKey, type RenderPasses } from '../core/passes';

/** The passes the denoiser is guided by (rt_post::denoise::GUIDE_PASSES). */
export const DENOISE_GUIDES: readonly PassKey[] = ['albedo', 'normal', 'depth', 'partId', 'materialId'];
/** Their mask. */
export const DENOISE_GUIDE_MASK = passMask(DENOISE_GUIDES);
/** Rows a band holds around the rows it computes (rt_post::denoise::HALO, the full filter's). */
export const DENOISE_HALO = 72;
/** Words per pixel of a band's input (rt_wasm::DENOISE_WORDS): sums 4, lum2 1, albedo 3, normal 3, depth 1, ids 2. */
export const DENOISE_WORDS = 14;
/** No band under this many rows (each carries 2 × HALO more), as the launcher cuts them. */
export const MIN_BAND_ROWS = 192;

/** U11: the filter of a Render, or the viewport's lighter one. */
export type DenoisePreset = 'FULL' | 'VIEWPORT';
/** Per preset: its number for `rt_denoise_with`, its halo (`rt_denoise_halo`, Preset::halo) and the smallest band. */
export const DENOISE_PRESETS: Readonly<Record<DenoisePreset, { id: number; halo: number; minRows: number }>> = Object.freeze({
  FULL: { id: 0, halo: DENOISE_HALO, minRows: MIN_BAND_ROWS },
  VIEWPORT: { id: 1, halo: 24, minRows: 64 },
});

/** One band: image rows `y0 .. y1`, computed from rows `lo .. hi` (the band and its halo). */
export interface DenoiseBand {
  y0: number;
  y1: number;
  lo: number;
  hi: number;
}

/** The bands of an image `height` rows tall for `workers` workers (rt-app's `denoise_bands`, for the full filter). */
export function denoiseBands(height: number, workers: number, preset: DenoisePreset = 'FULL'): DenoiseBand[] {
  const { halo, minRows } = DENOISE_PRESETS[preset];
  const n = Math.max(1, Math.min(Math.max(1, Math.floor(workers)), Math.floor(height / minRows)));
  const out: DenoiseBand[] = [];
  for (let k = 0; k < n; k++) {
    const y0 = Math.floor((height * k) / n);
    const y1 = Math.floor((height * (k + 1)) / n);
    out.push({ y0, y1, lo: Math.max(0, y0 - halo), hi: Math.min(height, y1 + halo) });
  }
  return out;
}

/** True when `passes` holds every guide. */
export function hasGuides(passes: RenderPasses): boolean {
  return !!(passes.albedo && passes.normal && passes.depth && passes.partId && passes.materialId);
}

/**
 * The input of `rt_denoise` for rows `lo .. hi`: the planes one after another (sums, lum2, albedo, normal, depth,
 * part id, material id), little-endian words.
 */
export function packBand(width: number, sums: Float32Array, lum2: Float32Array, passes: RenderPasses, lo: number, hi: number): Uint32Array {
  const m = width * (hi - lo);
  const a = lo * width;
  const words = new Uint32Array(m * DENOISE_WORDS);
  const f = new Float32Array(words.buffer);
  f.set(sums.subarray(a * 4, (a + m) * 4), 0);
  f.set(lum2.subarray(a, a + m), m * 4);
  f.set(passes.albedo!.subarray(a * 3, (a + m) * 3), m * 5);
  f.set(passes.normal!.subarray(a * 3, (a + m) * 3), m * 8);
  f.set(passes.depth!.subarray(a, a + m), m * 11);
  words.set(passes.partId!.subarray(a, a + m), m * 12);
  words.set(passes.materialId!.subarray(a, a + m), m * 13);
  return words;
}

/** A band to denoise, as a worker gets it. */
export interface DenoiseJob {
  width: number;
  height: number;
  samples: number;
  band: DenoiseBand;
  input: Uint32Array;
  /** U11: the viewport's preset (absent: the full filter). */
  preset?: DenoisePreset;
  /** U11b: how much of the denoised image, 0..1 (absent: 1): noisy × (1 − s) + denoised × s, in the engine. */
  strength?: number;
}

/**
 * Denoises the image with `run` (a worker's `rt_denoise` of one band; any number of them in parallel): the RGBA
 * sums of the denoised image, coverage as it was. Null when the passes lack the guides.
 */
export async function denoiseImage(
  width: number,
  height: number,
  samples: number,
  sums: Float32Array,
  lum2: Float32Array,
  passes: RenderPasses,
  workers: number,
  run: (job: DenoiseJob, k: number) => Promise<Float32Array>,
  preset: DenoisePreset = 'FULL',
  strength = 1,
): Promise<Float32Array | null> {
  if (!hasGuides(passes) || lum2.length !== width * height) return null;
  const out = new Float32Array(width * height * 4);
  const s = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 1;
  await Promise.all(
    denoiseBands(height, workers, preset).map(async (band, k) => {
      const job: DenoiseJob = { width, height, samples, band, input: packBand(width, sums, lum2, passes, band.lo, band.hi), ...(preset === 'FULL' ? {} : { preset }), ...(s === 1 ? {} : { strength: s }) };
      const rows = await run(job, k);
      out.set(rows.subarray(0, width * (band.y1 - band.y0) * 4), band.y0 * width * 4);
    }),
  );
  return out;
}

/** The exports of rt.wasm the denoiser needs (E5b-1; absent in an older module). */
export interface RtDenoiseExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_denoise(width: number, height: number, originY: number, rows: number, samples: number, y0: number, y1: number, input: number, out: number): number;
  /** U11 (absent in an older module): `rt_denoise` with a preset number (DENOISE_PRESETS) and (U11b) a strength 0..1, and its halo. */
  rt_denoise_with?(preset: number, strength: number, width: number, height: number, originY: number, rows: number, samples: number, y0: number, y1: number, input: number, out: number): number;
  rt_denoise_halo?(preset: number): number;
}

export function hasDenoiseExport(rt: object): rt is RtDenoiseExports {
  return typeof (rt as { rt_denoise?: unknown }).rt_denoise === 'function';
}

/** One band through `rt_denoise` (or `rt_denoise_with` for the viewport's preset) of a module (what a worker does): its rows' RGBA sums. */
export function denoiseBand(rt: RtDenoiseExports, job: DenoiseJob): Float32Array {
  const { width, height, samples, band, input } = job;
  const preset = job.preset ?? 'FULL';
  const strength = job.strength ?? 1;
  const plain = preset === 'FULL' && strength === 1;
  if (!plain && typeof rt.rt_denoise_with !== 'function') throw new Error('this rt.wasm has no viewport denoiser (npm run engine:build)');
  const inLen = input.byteLength;
  const outLen = width * (band.y1 - band.y0) * 16;
  const inPtr = rt.rt_alloc(inLen);
  const outPtr = rt.rt_alloc(outLen);
  try {
    new Uint8Array(rt.memory.buffer, inPtr, inLen).set(new Uint8Array(input.buffer, input.byteOffset, inLen));
    const status = plain
      ? rt.rt_denoise(width, height, band.lo, band.hi - band.lo, samples, band.y0, band.y1, inPtr, outPtr)
      : rt.rt_denoise_with!(DENOISE_PRESETS[preset].id, strength, width, height, band.lo, band.hi - band.lo, samples, band.y0, band.y1, inPtr, outPtr);
    if (status !== 0) throw new Error(`rt_denoise returned ${status}`);
    // A fresh view: the call may have grown the memory.
    return new Float32Array(rt.memory.buffer, outPtr, outLen / 4).slice();
  } finally {
    rt.rt_free(inPtr, inLen);
    rt.rt_free(outPtr, outLen);
  }
}

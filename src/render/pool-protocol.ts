// Messages between the path tracer (main thread) and its workers.

import type { DenoisePreset } from './denoise';

export type WorkerRequest =
  /** Instantiate this compiled rt.wasm. */
  | { type: 'init'; module: WebAssembly.Module }
  /** Load an RSB (`full`) or update the loaded scene with one that has no meshes. */
  | { type: 'scene'; id: number; bytes: ArrayBuffer; full: boolean }
  /**
   * Render samples first .. first + count - 1 of these tiles (x, y, w, h, index each). With `passes` (a
   * core/passes.ts mask; Render only), also the albedo of every sample and, in the job whose `first` is 0,
   * the exact planes of every tile (phase X2).
   */
  | { type: 'job'; generation: number; tiles: Int32Array; first: number; count: number; passes?: number }
  /** Stop the job of this generation (only that one). */
  | { type: 'cancel'; generation: number }
  /** Convert accumulated RGBA sums of `samples` samples to 8-bit pixels, exactly. */
  | { type: 'tonemap'; id: number; sum: ArrayBuffer; samples: number; ev: number; tonemap: number }
  /**
   * E5b-1: denoise image rows `y0 .. y1` of a `width × height` image of `samples` samples, from rows `lo .. hi`
   * (`input`: render/denoise.ts `packBand`) with `rt_denoise`; U11: `preset` VIEWPORT, the viewport's lighter filter
   * (`rt_denoise_with`).
   */
  | { type: 'denoise'; id: number; width: number; height: number; samples: number; y0: number; y1: number; lo: number; hi: number; input: ArrayBuffer; preset?: DenoisePreset };

export type WorkerReply =
  | { type: 'ready'; version: number }
  | { type: 'failed'; reason: string }
  /** The scene is loaded; E5b-1: `caustics`, the caustic photons per sample it renders (0: none; `rt_scene_caustics`). */
  | { type: 'scene'; id: number; error: string | null; caustics?: number }
  /**
   * A tile's samples. With passes: `albedo`, `count` samples of `w * h * 3` floats each, and once (the job
   * with `first` 0) `exact`, the tile's exact planes in key order (render/pass-planes.ts).
   */
  | { type: 'tile'; generation: number; index: number; first: number; count: number; data: Float32Array; albedo?: Float32Array; exact?: Uint32Array }
  | { type: 'done'; generation: number }
  | { type: 'error'; generation: number; reason: string }
  | { type: 'pixels'; id: number; bytes: Uint8ClampedArray }
  /** E5b-1: the denoised RGBA sums of the rows asked for, or why not. */
  | { type: 'denoised'; id: number; data: Float32Array | null; error?: string };

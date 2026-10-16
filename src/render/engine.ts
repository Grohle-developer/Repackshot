// The web-side engine interface (ARCHITECTURE §5.0). Two implementations
// coexist: `preview` (three.js, render/preview.ts) and `pathtracer` (the Rust
// engine over a pool of wasm workers, render/pathtracer.ts). The user picks
// which one the viewport shows (Fast / Full); Render always uses the path
// tracer. main.ts wires both.

import type { PixelFilterFields } from '../core/antialias';
import type { CameraId } from '../core/camera';
import type { PassKey } from '../core/passes';
import type { FrameBox, LiveFrame } from '../core/live-frame';
import type { AdvancedSettings, FinishBy, RenderProgress } from '../core/render';
import type { NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';

export type { DisplayPrefs, NavigationPrefs } from '../core/settings';

/**
 * M2b: bit 0 of the engine's features (`rt_features` of rt.wasm, `features` of the launcher's `/api/info`): it reads
 * the texture data of the RSB (IMGS, the MATL texture blocks, the meshes' UVs), so the scene is written with them.
 */
export const ENGINE_FEATURE_TEXTURES = 1;

/** True when an engine of `features` reads the textures (M2b). */
export function readsTextures(features: number | undefined): boolean {
  return ((features ?? 0) & ENGINE_FEATURE_TEXTURES) !== 0;
}

/**
 * M3b: bit 1 of the engine's features: it runs the material programs (PROG, the compiled graph of a node material,
 * core/material-program.ts), so a node material is written as its program and not only as the mean of its outputs.
 * A program reads its images from IMGS and the meshes' UVs: the bit counts only with the textures' (bit 0).
 */
export const ENGINE_FEATURE_PROGRAMS = 2;

/** True when an engine of `features` runs the material programs (M3b; it reads the textures too). */
export function readsPrograms(features: number | undefined): boolean {
  const f = features ?? 0;
  return (f & ENGINE_FEATURE_PROGRAMS) !== 0 && (f & ENGINE_FEATURE_TEXTURES) !== 0;
}

export interface EngineStatus {
  samples: number;
  seconds: number;
  converged: boolean;
  device: string;
  /** Path tracer: workers in the pool. */
  workers?: number;
  /** Path tracer: the simd128 build of the engine is running. */
  simd?: boolean;
  /** Path tracer: resolution divisor of what is on screen (1, or 2 and 4 during a camera gesture). */
  scale?: number;
  /** Path tracer: frames presented during camera gestures since it started (for measuring). */
  frames?: number;
  /** Path tracer: milliseconds the last reduced-resolution frame took, from the change to the image. */
  frameMs?: number;
  /** Path tracer: a Render is running (the viewport shares the engine with it, or waits). */
  rendering?: boolean;
  /**
   * Path tracer, while a Render runs: SHARED, the viewport goes on with `share` of the threads or workers;
   * PAUSED, it waits until the Render is over (Settings ▸ Render engine ▸ While a render runs, or a pool of one).
   */
  renderShare?: 'SHARED' | 'PAUSED';
  /** Threads (native) or workers (pool) the viewport renders on while it shares, and how many there are. */
  share?: { n: number; of: number };
  /** Path tracer: why the view is not simply converging (the engine does not answer, refused it, or was restarted). */
  issue?: import('./watchdog').ViewportIssue;
  /** Path tracer: passes received since the engine started (for checks: it only grows). */
  passes?: number;
  /** Path tracer: times the watchdog started the view again. */
  watchdog?: number;
  /** Path tracer: the scene of the image on the canvas (full resolution), and the scene of the project now. */
  shownKey?: string;
  wantKey?: string;
  /** Path tracer: pixels of the image the samples above are counted on (for estimates). */
  pixels?: number;
  /** The native engine of the desktop launcher (render/native.ts) is rendering. */
  native?: boolean;
  /** Native engine: its render threads. */
  threads?: number;
  /** Native engine: its SIMD path (`avx2`, `sse2`, `neon`, `scalar`). */
  isa?: string;
  /** Path tracer (E5b-1): the image on screen is the engine's denoised one. */
  denoised?: boolean;
  /**
   * Path tracer (U11), the live denoise of the Full viewport: what it measured. `ms`, the last denoise's cost (the
   * pool; the launcher's own is in its state); `images`, the denoised images put on screen for this view;
   * `accumulated`, the samples of the newest pass (the pool: what the next denoise starts from); `at`, when the last
   * denoised image was put on screen (performance.now(), the pool).
   */
  liveDenoise?: { ms?: number; images: number; accumulated?: number; at?: number };
  /** Path tracer (E5b-1): the view renders caustics with this many photons per sample (absent: none). */
  caustics?: number;
  /**
   * Path tracer (E11): the pixel filter and edge samples the image on screen was asked to render with
   * (`RNDR.pixel_filter`, `RNDR.edge_supersample`), at full resolution.
   */
  pixelFilter?: PixelFilterFields;
  /**
   * Path tracer (E10): the view samples adaptively; its pixels have from `min` to `max` samples (`samples` is `max`),
   * `noise` is the relative error of the noisiest block at the last decision (-1 before it) and `eta` the seconds to
   * the noise target from the last pass (-1: unknown). The engine's numbers, as the meter prints them.
   */
  adaptive?: { min: number; max: number; noise: number; eta: number };
  /** Preview (E11): the multisampling it draws with now, and the most the device can do. */
  msaa?: { samples: number; max: number };
  /**
   * Preview (S4a): the particles of the ambient effects it draws (evaluated by rt.wasm's own simulator), of how many
   * the engine renders; `boxesOnly` when there is no rt.wasm and only the region boxes are drawn. Absent: no effect.
   */
  particles?: { shown: number; total: number; boxesOnly: boolean };
}

export interface RenderOptions {
  width: number;
  height: number;
  maxSamples: number;
  maxSeconds: number;
  /**
   * When to stop (render/schedule.ts). Absent: the samples or the time, whichever comes first,
   * with `maxSeconds` 0 meaning no time limit.
   */
  finishBy?: FinishBy;
  transparent: boolean;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
  /** Camera to render through (default: the active one, or the camera track at `time`). */
  camera?: CameraId;
  /** Animation: the instant whose pose is rendered, seconds. */
  time?: number;
  /** Engine settings of the window's Advanced section. */
  advanced?: AdvancedSettings;
  /** Path tracer: also hand back the accumulated linear sums (16-bit PNG, EXR). */
  keepLinear?: boolean;
  /**
   * Path tracer: also render these exact passes next to the image and hand them back (AI-POST.md §7.4,
   * phase X2); the image does not change. The launcher keeps them by the render's id for the AI.
   */
  passes?: readonly PassKey[];
  /**
   * With `passes`, the native engine: leave them in the launcher (it keeps them with the linear image by the
   * render's id for the AI post-processing, X3c) instead of reading them back; `renderId` says which.
   */
  passesInLauncher?: boolean;
  /** Render this project instead of the one on screen (Settings ▸ Measure performance renders the example). */
  state?: ProjectState;
  /**
   * U14, the queue's live view: asked as the image accumulates (the pool: as tiles come back; the launcher: after every
   * pass), the box to fit a picture of the render in when one is wanted now, else null; while it is null no picture is
   * made and no sums are copied for one. `image`: the number of the image it has now (the launcher's pass), so the
   * same image is not asked for twice.
   */
  frameBox?: (image?: number) => FrameBox | null;
  /** U14: the picture `frameBox` asked for. */
  onFrame?: (frame: LiveFrame) => void;
  /**
   * E10, Finish by Noise (core/render.ts `adaptiveOf`): sample adaptively to this noise target (a fraction), at most
   * `maxSamples` per pixel; with `finishBy` NOISE the render ends when every block is under it.
   */
  adaptive?: { noiseThreshold: number };
}

export interface PickHit {
  node: NodeId;
  face: number;
  point: [number, number, number];
  normal: [number, number, number];
}

export interface RenderEngine {
  readonly kind: 'preview' | 'pathtracer';
  mount(canvas: HTMLCanvasElement): void;
  /** Applies only what changed between `prev` and `state`. */
  sync(state: ProjectState, prev: ProjectState | null): void;
  resize(width: number, height: number, dpr: number): void;
  /** One step: a frame (preview) or one more sample (path tracer). */
  frame(): void;
  /** The truth about what is on screen; the meter prints exactly this. */
  status(): EngineStatus;
  render(opts: RenderOptions): Promise<ImageBitmap>;
  /** CSS pixels relative to the canvas. */
  pick(x: number, y: number): PickHit | null;
  dispose(): void;
}

// The path tracer behind RenderEngine (ARCHITECTURE §5.3): the Rust engine in
// a pool of Web Workers, each with its own rt.wasm (the simd128 build when
// the browser validates it) and its own copy of the scene. No
// SharedArrayBuffer: every worker receives the RSB as a transferable buffer,
// so it runs on any static host.
//
// The viewport (Full mode): the image covers the whole viewport, cut into
// 32 x 32 tiles interleaved by worker; passes of 1, 2, 4, 8, 16 samples; the
// main thread adds each tile's samples in order, tone maps the tiles that
// changed and paints them into a 2D canvas under the preview's (which keeps
// drawing the outline and the gizmo on top). Anything that reaches the image
// restarts it: a new generation, whose number drops whatever older tiles are
// still in flight. During a camera gesture it renders at ½ or ¼ of the
// viewport (chosen from the last frame's time) and scales the frame up; on
// release it goes back to full resolution and converges.
//
// Render: the same pool at the output size, within the sample and time
// budget (checked between passes, so every pixel has the same samples), and
// the exact 8-bit conversion of the engine, done by the workers in slices.
// While it runs the viewport stays live on a quarter of the workers (the
// render takes the others), or waits, as Settings ▸ Render engine ▸ While a
// render runs says; which worker renders a tile never changes its pixels, so
// the render is the same bits either way. Each worker holds one scene: the
// pool remembers which one it was last sent, and a worker that changes hands
// gets the other scene as an update (the meshes stay). A watchdog
// (render/watchdog.ts) starts the view again when its tiles stop coming or
// stop being drawn, and says so in the console.
// With `passes` a Render also hands back the exact passes of AI-POST.md §7.4
// (phase X2): its workers send each tile's exact planes with its first samples
// and the albedo of every sample, and they are put together like the image
// (render/pass-planes.ts); which worker renders a tile changes no pass either.
//
// Live denoise (U11): at full resolution the viewport renders the denoiser's
// guides and keeps the sums of its last pass; while the switch is on (the
// Viewport part of Advanced ▸ Denoise, the top bar, the meter), the view's
// workers denoise that pass by bands with the viewport's preset in between
// their tiles (the passes go on), the image is shown the moment it is back and
// the next denoise starts then, on the newest pass; the passes are kept about
// as long as a denoise (tiles.ts `livePassCap`). The switch never starts the
// image over: on, it denoises the last pass at once; off, the accumulated sums
// are on screen at the next frame.
//
// Live view (U14): while the queue's live view wants a picture of a Render
// (`frameBox`, at its cadence), the tile that just came back is followed by a
// picture of the accumulation as it is, each tile with its own samples, scaled
// to the view's box (render/live-frame.ts); while it wants none, nothing more
// is done than before.

import type { CameraState } from '../core/camera';
import { passMask, type PassKey, type RenderPasses } from '../core/passes';
import { adaptiveOf, advancedTouchesView, denoiseFraction, engineFieldsOf, type AdvancedSettings, type RenderProgress } from '../core/render';
import type { ViewportLimit as Limit } from '../core/settings';
import { DEFAULT_PIXEL_FILTER, pixelFilterFields, type PixelFilterFields, type PixelFilterSetting } from '../core/antialias';
import { DENOISE_IMAGE, DENOISE_KEEP_NOISY, denoiseIn, type CausticsMode, type CausticsQuality } from '../core/caustics';
import { DENOISE_GUIDE_MASK, denoiseImage, type DenoiseJob, type DenoisePreset } from './denoise';
import { fitFactor } from '../core/live-frame';
import { LivePicture } from './live-frame';
import type { ProjectState } from '../core/store';
import { readsCameras, readsIes, readsPrograms, readsTextures, type EngineStatus, type PickHit, type RenderEngine, type RenderOptions } from './engine';
import type { WorkerReply, WorkerRequest } from './pool-protocol';
import { ALBEDO_BIT, PassAccumulator } from './pass-planes';
import { abortError, adaptiveProgress, budgetLimits, budgetOf, budgetProgress, runAdaptive, runPasses, type PassBudget } from './schedule';
import { Accumulator, assignTiles, chooseScale, Generations, LIVE_ALBEDO_SAMPLES, livePassCap, MAX_PASS_SAMPLES, nextPass, scaledSize, TILE, type Tile, type TileResult } from './tiles';
import { AdaptiveState, BLOCK, rescaledPlane, rescaledSums, type BlockWork } from './adaptive';
import type { ViewportLimit } from '../core/settings';
import { DisplayCurve } from './tonemap';
import { bytesKey, Watchdog, WATCHDOG, type ViewportIssue } from './watchdog';
import { ScanCache, scanFrame } from './frame-scan';
import { autoExposure, ExposureMeter, meterExposure } from '../core/image-passes';

/** How an image is framed and sampled (io/rsb.ts `SceneView`; main.ts connects the two). */
export interface TracerView {
  width: number;
  height: number;
  maxSamples: number;
  maxSeconds: number;
  transparent?: boolean;
  camera?: string;
  cameraPatch?: Partial<Omit<CameraState, 'id'>>;
  viewport?: { viewW: number; viewH: number };
  /** Animation: the instant whose pose is rendered. */
  time?: number;
  /** Advanced engine settings (bounces, indirect clamp, seed). */
  advanced?: AdvancedSettings;
  /** The exact passes to render next to the image (`RNDR.passes`; Render only). */
  passes?: readonly PassKey[];
  /** E5b-1: `RNDR.denoise` of this view (core/render.ts `engineFieldsOf`). */
  denoise?: number;
  /** U11b: `RNDR.denoise_strength`, 0..1 (default 1): the denoised image blended with the noisy one. */
  denoiseStrength?: number;
  /** E11: `RNDR.pixel_filter` and `RNDR.edge_supersample` (Settings ▸ Render engine ▸ Edge smoothing; core/antialias.ts). */
  pixelFilter?: number;
  edgeSupersample?: number;
  /** E10: adaptive sampling to this noise target (a fraction; `RNDR.adaptive`, `RNDR.noise_threshold`). */
  adaptive?: { noiseThreshold: number };
  /** E5b-1: the caustics switch and quality (Automatic is decided by io/rsb.ts from the scene). */
  caustics?: { mode: CausticsMode; quality: CausticsQuality };
  /** M2b: the engine reads the textures (render/engine.ts `readsTextures`): the scene carries them. */
  textures?: boolean;
  /** M3b: the engine runs the material programs (render/engine.ts `readsPrograms`): node materials go as programs. */
  programs?: boolean;
  /** L5: the engine renders the IES lights (render/engine.ts `readsIes`): they go as such, not as the spot light that stands for them. */
  ies?: boolean;
  /** K3: the engine reads the interior cameras (render/engine.ts `readsCameras`): panoramas, the exterior factor, parts hidden to the camera. */
  cameras?: boolean;
}

export interface BuiltScene {
  /** Equal keys: equal MESH sections. */
  meshKey: string;
  /** RSB bytes, without the meshes for an update of a scene that has them. */
  bytes(meshes: boolean): Uint8Array;
}

/**
 * The project to the engine's scene: src/io/rsb.ts, handed in by main.ts (`render` depends on
 * `core` only).
 */
export interface SceneSource {
  build(state: ProjectState, view: TracerView): BuiltScene;
  /**
   * Exposure and `RNDR.tonemap` the image is converted with. K3: with `auto` the exposure is metered from the image
   * (core/image-passes.ts) and `exposureEv` is the compensation over it.
   */
  tone(state: ProjectState): { exposureEv: number; tonemap: number; auto?: boolean };
}

/** Why Full is or is not available. */
export type EngineAvailability = 'LOADING' | 'READY' | 'NO_WASM' | 'NO_WORKERS' | 'OUTDATED' | 'FAILED';

/** The smallest module with a simd128 instruction: `() -> v128 { i32x4.splat(i32.const 0) }`. */
export const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic, version
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type section: () -> v128
  0x03, 0x02, 0x01, 0x00, // function section: one function of type 0
  0x0a, 0x08, 0x01, 0x06, 0x00, 0x41, 0x00, 0xfd, 0x11, 0x0b, // code: i32.const 0, i32x4.splat, end
]);

export function simdSupported(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

function isWasm(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
}

/**
 * Fetches and compiles the engine: `engine/rt-simd.wasm` when the browser has simd128 (falling
 * back to the scalar build when that file is not there), else `engine/rt.wasm`. A missing file
 * (a 404, or a server that answers with its index page) is NO_WASM.
 */
export async function loadEngineModule(base: string, opts: { simd?: boolean } = {}): Promise<{ module: WebAssembly.Module; simd: boolean } | { error: EngineAvailability; detail: string }> {
  if (typeof Worker === 'undefined' || typeof WebAssembly !== 'object') return { error: 'NO_WORKERS', detail: 'Web Workers or WebAssembly are not available' };
  const get = async (name: string): Promise<Uint8Array | null> => {
    try {
      const res = await fetch(new URL(`engine/${name}`, base).href, { cache: 'no-cache' });
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return isWasm(bytes) ? bytes : null;
    } catch {
      return null;
    }
  };
  // Settings ▸ Render engine ▸ SIMD Off: the scalar build, even where simd128 exists.
  const simd = simdSupported() && opts.simd !== false;
  let bytes = simd ? await get('rt-simd.wasm') : null;
  const usedSimd = bytes !== null;
  bytes ??= await get('rt.wasm');
  if (!bytes) return { error: 'NO_WASM', detail: 'engine/rt.wasm is missing (npm run engine:build)' };
  try {
    return { module: await WebAssembly.compile(bytes as BufferSource), simd: usedSimd };
  } catch (err) {
    return { error: 'FAILED', detail: err instanceof Error ? err.message : String(err) };
  }
}

// ------------------------------------------------------------------ the pool

interface JobState {
  left: number;
  onTile: (r: TileResult) => void;
  done: (ok: boolean) => void;
}

/** Which scene a worker holds: its meshes and its update bytes (equal tags, equal scenes). */
export interface SceneTag {
  meshKey: string;
  update: Uint8Array;
}

/** Workers `from .. to - 1`. */
export function workerRange(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

/** Workers the viewport keeps while a Render runs: a quarter of the pool, at least one (none in a pool of one). */
export function viewportWorkers(size: number): number {
  return size < 2 ? 0 : Math.max(1, Math.floor(size / 4));
}

/** The workers and their messages. */
export class Pool {
  readonly size: number;
  /** The engine's version as its workers report it (`rt_version`: major << 16 | minor << 8 | patch). */
  version = 0;
  /** M2b: what the engine reads beyond the plain RSB, as its workers report it (`rt_features`; 0 before M2b). */
  features = 0;
  /** D1: this rt.wasm exports the denoiser (workers that do not say are taken to). */
  hasDenoiser = true;
  private readonly workers: Worker[];
  private sceneSeq = 0;
  private readonly scenes = new Map<number, { left: number; error: string | null; done: (error: string | null) => void }>();
  private readonly jobs = new Map<number, JobState>();
  private tonemapSeq = 0;
  private readonly tonemaps = new Map<number, (bytes: Uint8ClampedArray) => void>();
  private denoiseSeq = 0;
  private readonly denoises = new Map<number, (data: Float32Array | null, error?: string) => void>();
  /** E5b-1: the caustic photons per sample of the scene each worker holds (rt_scene_caustics). */
  private readonly caustics: number[];
  /** The generation each worker is rendering (null: none). */
  private readonly busy: (number | null)[];
  /** The scene each worker holds once it has read its messages (null: unknown), and the id of the last one sent. */
  private readonly tags: (SceneTag | null)[];
  private readonly lastScene: number[];

  private constructor(workers: Worker[]) {
    this.workers = workers;
    this.size = workers.length;
    this.busy = workers.map(() => null);
    this.caustics = workers.map(() => 0);
    this.tags = workers.map(() => null);
    this.lastScene = workers.map(() => 0);
    workers.forEach((w, i) => (w.onmessage = (e: MessageEvent<WorkerReply>) => this.receive(e.data, i)));
  }

  /** Starts `size` workers on a compiled engine; fails with the first worker's reason. */
  static async create(module: WebAssembly.Module, size: number, spawn: () => Worker): Promise<Pool> {
    const workers = Array.from({ length: size }, spawn);
    let version = 0;
    let features = 0;
    let denoise = true;
    try {
      await Promise.all(
        workers.map(
          (w) =>
            new Promise<void>((resolve, reject) => {
              w.onmessage = (e: MessageEvent<WorkerReply>) => {
                if (e.data.type === 'ready') {
                  version = e.data.version;
                  features = e.data.features ?? 0;
                  denoise = denoise && e.data.denoise !== false;
                  resolve();
                }
                else if (e.data.type === 'failed') reject(new Error(e.data.reason));
              };
              w.onerror = (e) => reject(new Error(e.message || 'worker failed to start'));
              w.postMessage({ type: 'init', module } satisfies WorkerRequest);
            }),
        ),
      );
    } catch (err) {
      workers.forEach((w) => w.terminate());
      throw err;
    }
    const pool = new Pool(workers);
    pool.version = version;
    pool.features = features;
    pool.hasDenoiser = denoise;
    return pool;
  }

  /** Every worker, 0 .. size - 1. */
  all(): number[] {
    return workerRange(0, this.size);
  }

  private receive(msg: WorkerReply, worker: number): void {
    switch (msg.type) {
      case 'scene': {
        // A worker that could not load its last scene holds who knows what: it gets the whole one next time.
        if (msg.error && this.lastScene[worker] === msg.id) this.tags[worker] = null;
        if (this.lastScene[worker] === msg.id) this.caustics[worker] = msg.error ? 0 : (msg.caustics ?? 0);
        const s = this.scenes.get(msg.id);
        if (!s) return;
        s.error ??= msg.error;
        if (--s.left === 0) {
          this.scenes.delete(msg.id);
          s.done(s.error);
        }
        return;
      }
      case 'tile':
        this.jobs.get(msg.generation)?.onTile(msg);
        return;
      case 'done': {
        if (this.busy[worker] === msg.generation) this.busy[worker] = null;
        const j = this.jobs.get(msg.generation);
        if (j && --j.left === 0) {
          this.jobs.delete(msg.generation);
          j.done(true);
        }
        return;
      }
      case 'error': {
        if (this.busy[worker] === msg.generation) this.busy[worker] = null;
        const j = this.jobs.get(msg.generation);
        if (j) {
          this.jobs.delete(msg.generation);
          j.done(false);
        }
        console.error(`path tracer: ${msg.reason}`);
        return;
      }
      case 'pixels':
        this.tonemaps.get(msg.id)?.(msg.bytes);
        this.tonemaps.delete(msg.id);
        return;
      case 'denoised':
        this.denoises.get(msg.id)?.(msg.data, msg.error);
        this.denoises.delete(msg.id);
        return;
    }
  }

  /** E5b-1: the caustic photons per sample the scene `worker` holds renders (0: none). */
  causticsOf(worker: number): number {
    return this.caustics[worker] ?? 0;
  }

  /**
   * E5b-1: the engine's denoiser on the RGBA sums of `samples` samples of a `width × height` image, with their
   * squared luminance and the guide passes, in bands of rows on `workers` (each band with its halo, so the bands
   * give exactly the whole image's rows), with the full filter or (U11) the viewport's. A worker takes its band in
   * between the tiles it renders. Rejects when a worker cannot (an older rt.wasm).
   */
  denoise(width: number, height: number, samples: number, sums: Float32Array, lum2: Float32Array, passes: RenderPasses, workers: readonly number[] = this.all(), preset: DenoisePreset = 'FULL', strength = 1, counts?: Float32Array): Promise<Float32Array | null> {
    const lane = workers.length > 0 ? workers : this.all();
    return denoiseImage(
      width,
      height,
      samples,
      sums,
      lum2,
      passes,
      lane.length,
      (job: DenoiseJob, k: number) => {
        const id = ++this.denoiseSeq;
        const w = this.workers[lane[k % lane.length]];
        return new Promise<Float32Array>((resolve, reject) => {
          this.denoises.set(id, (data, error) => (data ? resolve(data) : reject(new Error(error ?? 'denoise failed'))));
          const input = job.input.buffer as ArrayBuffer;
          w.postMessage({ type: 'denoise', id, width: job.width, height: job.height, samples: job.samples, ...job.band, input, ...(job.preset ? { preset: job.preset } : {}), ...(job.strength !== undefined ? { strength: job.strength } : {}) } satisfies WorkerRequest, [input]);
        });
      },
      preset,
      strength,
      counts,
    );
  }

  /** The scene `worker` will hold once it has read the messages sent so far (null: unknown). */
  tagOf(worker: number): SceneTag | null {
    return this.tags[worker];
  }

  /** A worker about to get other work: the generation it was rendering (if any) is cancelled, on every worker. */
  private free(workers: readonly number[], keep: number | null = null): void {
    for (const i of workers) {
      const g = this.busy[i];
      if (g !== null && g !== keep) this.cancel(g);
    }
  }

  /**
   * Loads (`full`) or updates the scene of `workers` (every worker by default); rejects with the first error.
   * A worker rendering another generation stops it (a worker drops its job when a scene comes). `tag` says
   * which scene it is, so the next caller knows what the worker holds.
   */
  scene(bytes: Uint8Array, full: boolean, workers: readonly number[] = this.all(), tag: SceneTag | null = null): Promise<void> {
    const id = ++this.sceneSeq;
    this.free(workers);
    return new Promise((resolve, reject) => {
      if (workers.length === 0) {
        resolve();
        return;
      }
      this.scenes.set(id, { left: workers.length, error: null, done: (e) => (e ? reject(new Error(e)) : resolve()) });
      for (const i of workers) {
        this.lastScene[i] = id;
        this.tags[i] = tag;
        // Every worker gets its own copy, transferred (no shared memory).
        const copy = bytes.slice().buffer;
        this.workers[i].postMessage({ type: 'scene', id, bytes: copy, full } satisfies WorkerRequest, [copy]);
      }
    });
  }

  /**
   * Renders samples `first .. first + count - 1` of the tiles on `workers` (every worker by default), tile i
   * on workers[i mod n]. Resolves true when every worker is done, false when the generation was cancelled.
   * A worker still rendering another generation stops it first. With a `passes` mask the tiles come back
   * with their passes (the exact planes when `first` is 0).
   */
  run(generation: number, tiles: readonly Tile[], first: number, count: number, onTile: (r: TileResult) => void, workers: readonly number[] = this.all(), passes = 0): Promise<boolean> {
    const parts = assignTiles(tiles, workers.length);
    const busy = parts.filter((p) => p.length > 0).length;
    if (busy === 0) return Promise.resolve(true);
    this.free(workers.filter((_, k) => parts[k].length > 0), generation);
    return new Promise((resolve) => {
      this.jobs.set(generation, { left: busy, onTile, done: resolve });
      parts.forEach((list, k) => {
        if (list.length === 0) return;
        const i = workers[k];
        this.busy[i] = generation;
        const packed = new Int32Array(list.length * 5);
        list.forEach((t, j) => packed.set([t.x, t.y, t.w, t.h, t.index], j * 5));
        this.workers[i].postMessage({ type: 'job', generation, tiles: packed, first, count, ...(passes ? { passes } : {}) } satisfies WorkerRequest, [packed.buffer]);
      });
    });
  }

  /**
   * E10: renders the blocks of a round of adaptive sampling (render/adaptive.ts `AdaptiveState.work`) on `workers`,
   * block k on workers[k mod n], sample j of each with the photon map of `iteration + j`; each comes back as a tile result
   * with its `block`. Resolves true when every worker is done, false when the generation was cancelled.
   */
  runBlocks(generation: number, items: readonly BlockWork[], iteration: number, onTile: (r: TileResult) => void, workers: readonly number[] = this.all()): Promise<boolean> {
    const n = Math.max(1, workers.length);
    const parts: BlockWork[][] = Array.from({ length: n }, () => []);
    items.forEach((b, k) => parts[k % n].push(b));
    const busy = parts.filter((p) => p.length > 0).length;
    if (busy === 0) return Promise.resolve(true);
    this.free(workers.filter((_, k) => parts[k].length > 0), generation);
    return new Promise((resolve) => {
      this.jobs.set(generation, { left: busy, onTile, done: resolve });
      parts.forEach((list, k) => {
        if (list.length === 0) return;
        const i = workers[k];
        this.busy[i] = generation;
        const packed = new Int32Array(list.length * 7);
        list.forEach((b, j) => packed.set([b.x, b.y, b.w, b.h, b.block, b.first, b.count], j * 7));
        this.workers[i].postMessage({ type: 'blocks', generation, items: packed, iteration } satisfies WorkerRequest, [packed.buffer]);
      });
    });
  }

  /** Stops the job of `generation` (exactly that one: a Render and the viewport run side by side); its `run` resolves false and its late tiles are dropped. */
  cancel(generation: number): void {
    const j = this.jobs.get(generation);
    if (j) {
      this.jobs.delete(generation);
      j.done(false);
    }
    this.workers.forEach((w, i) => {
      if (this.busy[i] !== generation) return;
      this.busy[i] = null;
      w.postMessage({ type: 'cancel', generation } satisfies WorkerRequest);
    });
  }

  /** The exact 8-bit image of RGBA sums of `samples` samples, converted in slices by the workers. */
  async tonemap(sum: Float32Array, width: number, height: number, samples: number, ev: number, tonemap: number): Promise<Uint8ClampedArray> {
    const out = new Uint8ClampedArray(width * height * 4);
    const rows = Math.ceil(height / this.size);
    await Promise.all(
      this.workers.map((w, i) => {
        const y0 = i * rows;
        const y1 = Math.min(height, y0 + rows);
        if (y1 <= y0) return Promise.resolve();
        const slice = sum.slice(y0 * width * 4, y1 * width * 4);
        const id = ++this.tonemapSeq;
        return new Promise<void>((resolve) => {
          this.tonemaps.set(id, (bytes) => {
            out.set(bytes, y0 * width * 4);
            resolve();
          });
          w.postMessage({ type: 'tonemap', id, sum: slice.buffer, samples, ev, tonemap } satisfies WorkerRequest, [slice.buffer]);
        });
      }),
    );
    return out;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
  }
}

// ------------------------------------------------------------------ the engine

/** Pixels of a finished render: straight RGBA, 8 bits. */
export interface RenderedPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  samples: number;
  seconds: number;
  /** With `keepLinear`: the RGBA sums of `samples` samples per pixel (premultiplied, linear). */
  sum?: Float32Array;
  /** The exposure and curve the 8-bit image was converted with. */
  exposureEv: number;
  tonemap: number;
  /** With `passes`: the exact passes of the image (AI-POST.md §7.4). */
  passes?: RenderPasses;
  /** The native engine: the launcher's id of this render, by which it keeps the image and its passes (AI-POST.md §7.3). */
  renderId?: number;
  /** E5b-1: `data` and `sum` are the engine's denoised image. */
  denoised?: boolean;
  /** E5b-1, with Advanced ▸ Also save without denoise: the same render before denoise (8-bit, and its sums with `keepLinear`). */
  noisy?: { data: Uint8ClampedArray; sum?: Float32Array };
}

/** What reaches the image, by reference: anything else (selection, names, the queue) does not restart it. */
export function touchesImage(s: ProjectState, p: ProjectState): boolean {
  return (
    s.scene !== p.scene ||
    s.materials !== p.materials ||
    s.studio !== p.studio ||
    s.environment !== p.environment ||
    // S4a: the ambient effects travel as FXAM sections.
    s.effects !== p.effects ||
    // Q1: the section view's plane travels as SECT.
    s.section !== p.section ||
    s.camera !== p.camera ||
    s.render.width !== p.render.width ||
    s.render.height !== p.render.height ||
    s.render.maxSamples !== p.render.maxSamples ||
    s.render.quality !== p.render.quality ||
    // Caustics and the other Advanced settings (E5b-1) reach the image; the denoise is the live switch (U11).
    advancedTouchesView(s.render.advanced, p.render.advanced) ||
    // E10: Finish by Noise samples the view adaptively, to its threshold.
    adaptiveKey(s) !== adaptiveKey(p) ||
    s.animation.clips !== p.animation.clips ||
    s.animation.shots !== p.animation.shots ||
    (s.animation.clips.length > 0 && (s.animation.playhead !== p.animation.playhead || s.animation.playing !== p.animation.playing))
  );
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Longest time `frame()` spends tone mapping tiles, so the interface stays responsive. */
const PRESENT_BUDGET_MS = 8;
/**
 * Changes closer together than this (a slider or a gizmo being dragged) render like a camera
 * gesture, at reduced resolution; this long after the last one the image goes back to full
 * resolution and converges.
 */
export const QUIET_MS = 250;

export class PathTracerEngine implements RenderEngine {
  readonly kind = 'pathtracer' as const;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private low: HTMLCanvasElement | null = null;
  private state: ProjectState | null = null;
  private active = false;
  private viewW = 0;
  private viewH = 0;
  private dpr = 1;
  /** Numbers for the generations of the viewport and of renders (one sequence: a number is never reused). */
  private readonly gens = new Generations();
  /** The viewport's generation now (0: none); only its tiles are taken. */
  private viewGen = 0;
  /** That generation has all its samples (or its time): it renders nothing more. */
  private viewDone = false;
  private acc: Accumulator | null = null;
  /** D1: the project the accumulation was started from, and what the Doctor reads of it (made when its samples double). */
  private accState: ProjectState | null = null;
  private readonly scans = new ScanCache();
  /** K3: the automatic exposure of the viewport. */
  private readonly meter = new ExposureMeter();
  /** E5b-1, U11: the guide passes of the viewport's image (at full resolution). */
  private accGuides: PassAccumulator | null = null;
  /** U11: the live denoise switch, as the project says (the Viewport part of Advanced ▸ Denoise). */
  private liveOn = false;
  /** U11b: the strength of the view's denoise (Advanced ▸ Denoise ▸ Strength, 0..1); at 0 nothing is denoised. */
  private liveStrength = 1;
  /** E11: the pixel filter and edge samples asked of views and Renders, and those of the view on screen. */
  private filter: PixelFilterFields = pixelFilterFields(DEFAULT_PIXEL_FILTER);
  private accFilter: PixelFilterFields | null = null;
  /** U11: the viewport's last pass, as the lane denoises it: its samples, sums and squared luminance (E10: rescaled to its samples, with each pixel's count). */
  private lastPass: { acc: Accumulator; samples: number; sum: Float32Array; lum2: Float32Array; counts?: Float32Array } | null = null;
  /** E10: the adaptive sampling of the view on screen (null: every pixel alike), and its time estimate. */
  private accAdaptive: AdaptiveState | null = null;
  private adaptiveEta = -1;
  /** U11: the last pass denoised (its samples) and the denoised sums. */
  private clean: { acc: Accumulator; samples: number; sums: Float32Array } | null = null;
  /** U11: the denoise in flight on the view's workers (its number; 0: none). */
  private denoising = 0;
  private denoiseSeq = 0;
  /** U11: the last denoise's cost and the denoised images shown for this view. */
  private denoiseMs = 0;
  private cleanImages = 0;
  private cleanAt = 0;
  private accGen = 0;
  private accScale = 1;
  /** The workers the viewport's generation renders on, and the scene key of its image. */
  private accLane: readonly number[] = [];
  private accKey = '';
  private firstPassDone = false;
  private curve: DisplayCurve | null = null;
  private readonly dirty = new Set<number>();
  private presentAll = false;
  private restartWanted = true;
  private lastUpdate: Uint8Array | null = null;
  private gesture: { patch: Partial<Omit<CameraState, 'id'>> | null } | null = null;
  /** A reduced-resolution frame is being rendered: the next one waits for it. */
  private frameInFlight = false;
  /** When the image last had to start over, and whether that was at reduced resolution. */
  private lastChangeAt = -Infinity;
  private previousChangeAt = -Infinity;
  private lastFrameMs: number | null = null;
  private lastScale = 4;
  private frames = 0;
  private passes = 0;
  private genStart = 0;
  private stoppedAt = 0;
  private rendering = 0;
  /** The workers a Render's pass is using right now (the viewport keeps off them). */
  private finalPass: readonly number[] | null = null;
  private failure: string | null = null;
  private readonly frameListeners = new Set<() => void>();
  private tileImage: ImageData | null = null;
  /** Settings ▸ Preferences: ½ or ¼ during gestures, or chosen from the last frame's time. */
  private gestureScale: 'AUTO' | 'HALF' | 'QUARTER' = 'AUTO';
  /** Settings ▸ Render engine: when Full mode stops in the viewport. */
  private limit: ViewportLimit = { by: 'OUTPUT', samples: 1024, seconds: 120 };
  /** Settings ▸ Render engine ▸ While a render runs: the viewport keeps a quarter of the workers, or waits. */
  private whileRender: 'SHARE' | 'PAUSE' = 'SHARE';
  /** The viewport stopped because of its time limit. */
  private timedOut = false;
  private readonly watchdog = new Watchdog('pool');
  /** The watchdog's clocks: the viewport generation's last tile (or its start), the last frame(), undrawn work. */
  private tileAt = 0;
  private startAt = 0;
  private lastFrameCall = 0;
  private pendingSince = 0;
  private shownKey: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private want: { state: ProjectState; w: number; h: number; dpr: number; limit: ViewportLimit; key: string } | null = null;
  /** Look through (L4): the camera the viewport renders from, for a state; null: the active one. */
  private viewCamera: ((state: ProjectState) => CameraState | null) | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly source: SceneSource,
    readonly simd: boolean,
  ) {}

  get workers(): number {
    return this.pool.size;
  }

  /** D1: the engine can denoise (its rt.wasm exports the denoiser). */
  get canDenoise(): boolean {
    return this.pool.hasDenoiser;
  }

  /** The engine's version, "major.minor.patch". */
  get version(): string {
    const v = this.pool.version;
    return `${v >> 16}.${(v >> 8) & 255}.${v & 255}`;
  }

  /** Times the watchdog started the view again. */
  get watchdogFires(): number {
    return this.watchdog.fires;
  }

  setGestureResolution(mode: 'AUTO' | 'HALF' | 'QUARTER'): void {
    this.gestureScale = mode;
  }

  /** Full mode's limit in the viewport; a change starts the image over at the new budget. */
  setViewportLimit(limit: ViewportLimit): void {
    const same = limit.by === this.limit.by && limit.samples === this.limit.samples && limit.seconds === this.limit.seconds;
    this.limit = { ...limit };
    if (!same) {
      // Start over even when the scene is the same (an image stopped by time continues under a new limit).
      this.lastUpdate = null;
      this.restartWanted = true;
    }
  }

  /** While a render runs: SHARE keeps the viewport live on a quarter of the workers, PAUSE stops it until the render ends. */
  setWhileRender(mode: 'SHARE' | 'PAUSE'): void {
    if (mode === this.whileRender) return;
    this.whileRender = mode;
    this.restartWanted = true;
  }

  /**
   * E11, Settings ▸ Render engine ▸ Edge smoothing ▸ Full mode and render: the pixel filter and the edge samples of the
   * view and of every Render from now on. The view starts over (its scene changes).
   */
  setPixelFilter(setting: PixelFilterSetting): void {
    const f = pixelFilterFields(setting);
    if (f.pixelFilter === this.filter.pixelFilter && f.edgeSupersample === this.filter.edgeSupersample) return;
    this.filter = f;
    this.restartWanted = true;
  }

  /** The workers the viewport renders on: all of them, or its share while a Render runs (none when it waits). */
  private viewLane(): number[] {
    const n = this.pool.size;
    if (this.rendering === 0) return this.pool.all();
    const k = this.whileRender === 'SHARE' ? viewportWorkers(n) : 0;
    return workerRange(n - k, n);
  }

  /** The workers a Render's next pass uses: all but the viewport's share while Full mode shares them. */
  private finalLane(): number[] {
    const n = this.pool.size;
    const k = this.active && this.whileRender === 'SHARE' ? viewportWorkers(n) : 0;
    return workerRange(0, n - k);
  }

  /** Samples the viewport converges to: the output's, or the limit's. */
  private viewportSamples(state: ProjectState): number {
    const output = Math.max(1, state.render.maxSamples);
    return this.limit.by === 'SAMPLES' ? Math.max(1, this.limit.samples) : output;
  }

  private chooseGestureScale(): 2 | 4 {
    if (this.gestureScale === 'HALF') return 2;
    if (this.gestureScale === 'QUARTER') return 4;
    return chooseScale(this.lastFrameMs, this.lastScale);
  }

  /** The 2D canvas the image is painted into (under the preview's canvas). */
  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.low = document.createElement('canvas');
  }

  /** Full mode on or off. Off, nothing renders and the pool is free. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      // Whatever an earlier session left on the canvas is not this scene.
      if (this.canvas && this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.restartWanted = true;
      this.shownKey = null;
      this.pendingSince = 0;
      const now = performance.now();
      this.tileAt = this.startAt = this.lastFrameCall = now;
      if (!this.timer && typeof setInterval === 'function') this.timer = setInterval(() => this.checkFrames(), 1000);
      return;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // A Render in progress keeps its workers: only the viewport's own frames stop. A frame that was
    // in flight is dropped with them, so it no longer holds the next restart back.
    this.stopView();
    this.acc = null;
    // U11: nothing of the view is kept for its live denoise (a denoise on its way is dropped when it comes back).
    this.lastPass = null;
    this.clean = null;
    this.denoising = 0;
    this.pendingSince = 0;
  }

  /** The viewport's generation stops (its late tiles are dropped). */
  private stopView(): void {
    if (this.viewGen) this.pool.cancel(this.viewGen);
    this.viewGen = 0;
    this.frameInFlight = false;
  }

  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  /** Something the scene depends on outside the project changed (S4a: the engine's particle cap): build it again. */
  sceneChanged(): void {
    this.want = null;
    this.changed();
  }

  sync(state: ProjectState, prev: ProjectState | null): void {
    this.state = state;
    if (!prev || touchesImage(state, prev)) this.changed();
    this.setLiveStrength(denoiseFraction(state.render.advanced.denoiseStrength));
    this.setLiveDenoise(denoiseIn(state.render.advanced.denoise, 'VIEWPORT'));
  }

  /**
   * U11b: the strength of the live denoise. (It is in the view's scene too, so a change usually starts the image
   * over; if not, the denoised image of another strength is dropped and the last pass denoised again, and at 0 % the
   * accumulated sums are on screen.)
   */
  private setLiveStrength(strength: number): void {
    if (strength === this.liveStrength) return;
    this.liveStrength = strength;
    this.clean = null;
    const acc = this.acc;
    if (strength <= 0 && acc && acc.shownSamples > 0) {
      acc.show(null);
      this.redrawAll();
    }
    this.pumpDenoise();
  }

  /**
   * U11: the live denoise switch. On, the last pass is denoised at once (its denoised image is shown at once if it
   * was already); off, the accumulated sums are on screen at the next frame. The image does not start over.
   */
  private setLiveDenoise(on: boolean): void {
    if (on === this.liveOn) return;
    this.liveOn = on;
    const acc = this.acc;
    if (!acc || this.accScale !== 1) return;
    if (!on) {
      if (acc.shownSamples > 0) {
        acc.show(null);
        this.redrawAll();
      }
      return;
    }
    const clean = this.clean;
    if (clean && clean.acc === acc && this.lastPass?.acc === acc && clean.samples === this.lastPass.samples) {
      acc.show(clean.sums, clean.samples);
      this.cleanImages++;
      this.cleanAt = performance.now();
      this.redrawAll();
      return;
    }
    this.pumpDenoise();
  }

  /** Every tile of the view is drawn again at the next frame. */
  private redrawAll(): void {
    const acc = this.acc;
    if (!acc) return;
    for (const t of acc.tiles) this.dirty.add(t.index);
    if (!this.pendingSince) this.pendingSince = performance.now();
  }

  private changed(): void {
    this.restartWanted = true;
    this.previousChangeAt = this.lastChangeAt;
    this.lastChangeAt = performance.now();
  }

  /** A gesture is on, or changes keep coming: frames at reduced resolution. */
  private interactive(now: number): boolean {
    return this.gesture !== null || now - this.previousChangeAt < QUIET_MS;
  }

  resize(width: number, height: number, dpr: number): void {
    if (width <= 0 || height <= 0) return;
    this.viewW = width;
    this.viewH = height;
    this.dpr = dpr;
    const px = this.pixelSize();
    if (this.canvas && (this.canvas.width !== px.width || this.canvas.height !== px.height)) {
      this.canvas.width = px.width;
      this.canvas.height = px.height;
    }
    this.restartWanted = true;
  }

  /** Image pixels of the viewport: CSS pixels, at most one per device pixel. */
  private pixelSize(): { width: number; height: number } {
    const k = Math.min(1, this.dpr || 1);
    return { width: Math.max(1, Math.round(this.viewW * k)), height: Math.max(1, Math.round(this.viewH * k)) };
  }

  // ------------------------------------------------------------------ gestures

  /**
   * Look through (L4): the viewport renders from a light's or a saved camera's view instead of the active camera's,
   * worked out from each state (it moves with the light); null renders the active camera again.
   */
  setViewCamera(fn: ((state: ProjectState) => CameraState | null) | null): void {
    if (fn === this.viewCamera) return;
    this.viewCamera = fn;
    this.want = null;
    this.restartWanted = true;
  }

  /** The camera of a gesture in progress, over the camera looked through (if any). */
  private cameraPatch(state: ProjectState, patch: Partial<Omit<CameraState, 'id'>> | null): Partial<Omit<CameraState, 'id'>> | null {
    const through = this.viewCamera?.(state) ?? null;
    if (!through) return patch;
    const { id: _id, ...rest } = through;
    return patch ? { ...rest, ...patch } : rest;
  }

  /** A gesture started (the camera, or a gizmo drag): frames at reduced resolution until `endGesture`. */
  beginGesture(): void {
    this.gesture = { patch: null };
  }

  /** The camera as the gesture has it now (the store hears of it only when the gesture ends). */
  gestureView(patch: Partial<Omit<CameraState, 'id'>>): void {
    if (!this.gesture) this.gesture = { patch };
    else this.gesture.patch = patch;
    this.changed();
  }

  /** The gesture is over: full resolution at once (its last change came just before this). */
  endGesture(): void {
    this.gesture = null;
    this.previousChangeAt = -Infinity;
    this.restartWanted = true;
  }

  // ------------------------------------------------------------------ frames

  /** The viewport may start a generation now: no Render, or its share of workers is free of the Render's pass. */
  private viewCanRun(): boolean {
    if (this.rendering === 0) return true;
    const lane = this.viewLane();
    const busy = this.finalPass;
    return lane.length > 0 && !(busy && lane.some((i) => busy.includes(i)));
  }

  frame(): void {
    if (!this.active || !this.canvas || !this.state) return;
    const now = performance.now();
    // The animation loop did not run for a while (the window was hidden or frozen): the clocks start again.
    if (now - this.lastFrameCall > WATCHDOG.frameMs) this.tileAt = this.startAt = this.pendingSince = now;
    this.lastFrameCall = now;
    // Quiet again after a run of changes: back to full resolution.
    if (!this.restartWanted && this.acc && this.accScale > 1 && !this.interactive(now) && now - this.lastChangeAt >= QUIET_MS) this.restartWanted = true;
    this.check(now);
    // A reduced-resolution frame in flight finishes first (otherwise a continuous drag would never show one).
    if (this.restartWanted && !this.frameInFlight && this.viewCanRun()) {
      this.restartWanted = false;
      void this.restart();
    }
    this.present();
    for (const fn of this.frameListeners) fn();
  }

  /** The view at a resolution divisor (and the camera of a gesture in progress). */
  private viewOf(state: ProjectState, scale: number, patch: Partial<Omit<CameraState, 'id'>> | null): TracerView {
    const px = this.pixelSize();
    const size = scaledSize(px.width, px.height, scale);
    return {
      width: size.width,
      height: size.height,
      maxSamples: this.viewportSamples(state),
      maxSeconds: 0,
      viewport: { viewW: this.viewW, viewH: this.viewH },
      ...(this.cameraPatch(state, patch) ? { cameraPatch: this.cameraPatch(state, patch)! } : {}),
      // Caustics; the denoise is the live switch (U11), so the scene is the same either way: a full-resolution view
      // can always be denoised (a gesture's frames are gone before a denoise would finish).
      ...engineFieldsOf(state.render.advanced, 'VIEWPORT'),
      denoise: scale > 1 ? 0 : DENOISE_IMAGE,
      // E11: a gesture's frames keep the filter but not the edge samples (they are gone before they would tell).
      pixelFilter: this.filter.pixelFilter,
      edgeSupersample: scale > 1 ? 1 : this.filter.edgeSupersample,
      // E10: a view that follows the output's samples samples adaptively when the output finishes by noise.
      ...(scale === 1 ? viewAdaptive(state, this.limit) : {}),
      // M2b: the textures, when this engine reads them; M3b: the material programs, when it runs them.
      ...(readsTextures(this.pool.features) ? { textures: true } : {}),
      ...(readsPrograms(this.pool.features) ? { programs: true } : {}),
      // L5: the IES lights, when this engine renders them.
      ...(readsIes(this.pool.features) ? { ies: true } : {}),
      // K3: the interior cameras, when this engine reads them.
      ...(readsCameras(this.pool.features) ? { cameras: true } : {}),
    };
  }

  /**
   * Loads the scene on the workers of `lane` that do not hold it: the whole scene where a worker has other meshes
   * (or nothing), an update where it has the same ones (an update a worker refuses: the whole scene).
   */
  private async ensureScene(lane: readonly number[], built: BuiltScene, update: Uint8Array): Promise<void> {
    const tag: SceneTag = { meshKey: built.meshKey, update };
    const whole: number[] = [];
    const partial: number[] = [];
    for (const i of lane) {
      const t = this.pool.tagOf(i);
      if (t && t.meshKey === tag.meshKey && sameBytes(t.update, update)) continue;
      (t && t.meshKey === tag.meshKey ? partial : whole).push(i);
    }
    const waits: Promise<void>[] = [];
    if (whole.length > 0) waits.push(this.pool.scene(built.bytes(true), true, whole, tag));
    if (partial.length > 0) waits.push(this.pool.scene(update, false, partial, tag).catch(() => this.pool.scene(built.bytes(true), true, partial, tag)));
    await Promise.all(waits);
  }

  private async restart(): Promise<void> {
    const state = this.state;
    if (!state || this.viewW <= 0) return;
    const lane = this.viewLane();
    if (lane.length === 0) return;
    const t0 = performance.now();
    const gesture = this.gesture;
    const scale = this.interactive(t0) ? this.chooseGestureScale() : 1;
    const view = this.viewOf(state, scale, gesture?.patch ?? null);
    const built = this.source.build(state, view);
    const update = built.bytes(false);
    const acc0 = this.acc;
    // Nothing that reaches the image changed (a rename, a hidden-then-shown light, the denoise switch): keep going.
    if (acc0 && this.viewGen !== 0 && this.accGen === this.viewGen && this.accScale === scale && sameLane(this.accLane, lane) && acc0.width === view.width && acc0.height === view.height && sameBytes(this.lastUpdate, update)) return;

    const gen = this.gens.next();
    if (this.viewGen) this.pool.cancel(this.viewGen);
    this.viewGen = gen;
    this.viewDone = false;
    this.frameInFlight = scale > 1;
    this.tileAt = this.startAt = t0;
    try {
      await this.ensureScene(lane, built, update);
    } catch (err) {
      if (gen === this.viewGen) {
        this.failure = err instanceof Error ? err.message : String(err);
        this.frameInFlight = false;
      }
      return;
    }
    if (gen !== this.viewGen) return;
    this.failure = null;
    this.lastUpdate = update;
    // E5b-1, U11: a full-resolution view renders the guide passes and sums the squared luminance too, so its live
    // denoise can be turned on at any time.
    const denoise = ((view.denoise ?? 0) & DENOISE_IMAGE) !== 0;
    const mask = denoise ? DENOISE_GUIDE_MASK : 0;
    // E10: adaptive sampling (a view that follows an output finishing by noise): rounds decided by the image.
    const adaptive = view.adaptive ? new AdaptiveState(view.width, view.height, { ev: this.source.tone(state).exposureEv, target: view.adaptive.noiseThreshold, cap: view.maxSamples }) : null;
    const acc = new Accumulator(view.width, view.height, undefined, { lum2: denoise, blocks: adaptive !== null });
    this.accGuides = denoise ? new PassAccumulator(view.width, view.height, mask, acc.tiles, { gaps: true }) : null;
    this.lastPass = null;
    this.clean = null;
    // A denoise of the view before may still come back: it is not this view's.
    this.denoising = 0;
    this.cleanImages = 0;
    this.cleanAt = 0;
    this.acc = acc;
    this.accState = state;
    this.accAdaptive = adaptive;
    this.adaptiveEta = -1;
    this.accFilter = { pixelFilter: view.pixelFilter ?? 0, edgeSupersample: view.edgeSupersample ?? 1 };
    this.accGen = gen;
    this.accScale = scale;
    this.accLane = lane;
    this.accKey = bytesKey(update);
    this.firstPassDone = false;
    this.dirty.clear();
    this.pendingSince = 0;
    this.tileAt = performance.now();
    if (scale === 1) {
      this.genStart = performance.now();
      this.stoppedAt = 0;
      this.timedOut = false;
    }
    const max = view.maxSamples;
    let done = 0;
    let pass = 0;
    let msPerSample = 0;
    // E10: milliseconds per pixel-sample of the last pass, and what the last decision says is left to the target.
    let msPerUnit = 0;
    let left: { work: number; since: number } | null = null;
    for (;;) {
      // E10: the round is over: the image decides the next one.
      if (adaptive && adaptive.left === 0) {
        const d = adaptive.decide(acc.sum, 4, acc.lum2);
        left = d.remaining > 0 ? { work: d.remaining, since: 0 } : null;
        if (adaptive.converged) {
          this.adaptiveEta = 0;
          break;
        }
      }
      let next: { first: number; count: number } | null;
      if (adaptive) next = { first: adaptive.iteration, count: Math.min(pass <= 0 ? 1 : adaptive.warmingUp ? Math.min(pass * 2, MAX_PASS_SAMPLES) : MAX_PASS_SAMPLES, adaptive.left) };
      else next = nextPass(done, pass, max);
      if (!next) break;
      // U11: with the live denoise on, a pass about as long as a denoise, so the denoised image follows.
      const p = denoise && this.liveOn && msPerSample > 0 ? { first: next.first, count: Math.min(next.count, livePassCap(msPerSample, this.denoiseMs)) } : next;
      // The guides' albedo while the switch is on, and for the first samples while it is off.
      const passMask = denoise && !this.liveOn && p.first >= LIVE_ALBEDO_SAMPLES ? mask & ~ALBEDO_BIT : mask;
      const started = performance.now();
      const cost = adaptive ? adaptive.passCost(p.count) : 0;
      // E10: after the first round, only the round's blocks.
      const ok = adaptive && !adaptive.warmingUp
        ? await this.pool.runBlocks(gen, adaptive.work(p.count), adaptive.iteration, (r) => this.onTile(gen, r), lane)
        : await this.pool.run(gen, acc.tiles, p.first, p.count, (r) => this.onTile(gen, r), lane, passMask);
      if (gen !== this.viewGen) return;
      if (!ok) {
        this.frameInFlight = false;
        return;
      }
      msPerSample = (performance.now() - started) / p.count;
      if (adaptive) {
        adaptive.advance(p.count);
        if (cost > 0) msPerUnit = (performance.now() - started) / cost;
        if (left) left.since += cost;
        this.adaptiveEta = left && msPerUnit > 0 && Number.isFinite(left.work) ? (Math.max(0, left.work - left.since) * msPerUnit) / 1000 : -1;
      }
      // U11: the lane's newest pass (not an image a change is about to replace: the next view starts over). E10: an
      // adaptive image goes as sums rescaled to its most samples, with every pixel's own count.
      if (denoise && !this.restartWanted) {
        if (adaptive) {
          const s = adaptive.minMax().max;
          this.lastPass = { acc, samples: s, sum: rescaledSums(acc.sum, acc.width, acc.height, acc.blockSamples, s), lum2: rescaledPlane(acc.lum2, acc.width, acc.height, acc.blockSamples, s), counts: adaptive.pixelCounts() };
        } else this.lastPass = { acc, samples: done + p.count, sum: acc.sum.slice(), lum2: acc.lum2.slice() };
        this.pumpDenoise();
      }
      this.passes++;
      this.watchdog.progressed();
      if (!this.firstPassDone) {
        this.firstPassDone = true;
        if (scale > 1) {
          this.lastFrameMs = performance.now() - t0;
          this.lastScale = scale;
          this.frames++;
          this.frameInFlight = false;
        }
      }
      if (scale > 1) {
        this.presentAll = true;
        if (!this.pendingSince) this.pendingSince = performance.now();
      }
      done = adaptive ? adaptive.minMax().max : done + p.count;
      pass = p.count;
      // The next view of a gesture, or the next step of a drag: this frame is shown, start over.
      if (this.restartWanted) return;
      // "After N seconds": stop between passes, so every pixel has the same samples.
      if (scale === 1 && this.limit.by === 'TIME' && performance.now() - this.genStart >= this.limit.seconds * 1000) {
        this.timedOut = true;
        break;
      }
    }
    if (scale === 1) this.stoppedAt = performance.now();
    // Converged (or stopped by time): nothing more comes, and the watchdog has nothing to wait for.
    if (gen === this.viewGen) this.viewDone = true;
  }

  private onTile(gen: number, r: TileResult): void {
    const acc = this.acc;
    if (!acc || gen !== this.accGen || gen !== this.viewGen) return;
    this.tileAt = performance.now();
    const guides = this.accGuides;
    if (guides && r.albedo) guides.addAlbedo(r.index, r.first, r.count, r.albedo);
    if (guides && r.exact) guides.setExact(r.index, r.exact);
    // Once the denoised image is on screen, the samples coming in are shown with the next one. E10: a block of an
    // adaptive round redraws its tile.
    const b = r.block;
    const added = b ? acc.addBlock(r.index, b.x, b.y, b.w, b.h, r.first, r.count, r.data) : acc.add(r.index, r.first, r.count, r.data);
    if (added && this.accScale === 1 && acc.shownSamples === 0) {
      this.dirty.add(b ? Math.floor(b.y / TILE) * Math.ceil(acc.width / TILE) + Math.floor(b.x / TILE) : r.index);
      if (!this.pendingSince) this.pendingSince = this.tileAt;
    }
  }

  /**
   * U11: the live denoise's lane. While the switch is on and the last pass is not denoised, it denoises that pass on
   * the view's workers by bands (they take them in between their tiles, so the passes go on) with the viewport's
   * preset; the image is shown the moment it is back, and the next denoise starts then, on the newest pass. One at a
   * time.
   */
  private pumpDenoise(): void {
    const acc = this.acc;
    const guides = this.accGuides;
    const last = this.lastPass;
    if (!this.liveOn || this.liveStrength <= 0 || this.denoising || !acc || !guides || !last || last.acc !== acc || this.accScale !== 1) return;
    if (this.clean?.acc === acc && this.clean.samples >= last.samples) return;
    const gen = this.accGen;
    const t0 = performance.now();
    const id = ++this.denoiseSeq;
    const strength = this.liveStrength;
    this.denoising = id;
    this.pool
      .denoise(acc.width, acc.height, last.samples, last.sum, last.lum2, guides.resolve(), this.accLane, 'VIEWPORT', strength, last.counts)
      .then((sums) => {
        // (Of another strength than the one asked for now: dropped, and the pass denoised again.)
        if (!sums || gen !== this.accGen || this.acc !== acc || strength !== this.liveStrength) return;
        this.clean = { acc, samples: last.samples, sums };
        if (!this.liveOn) return;
        acc.show(sums, last.samples);
        this.cleanImages++;
        this.cleanAt = performance.now();
        this.redrawAll();
      })
      .catch((err) => console.warn(`[viewport] denoise: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        if (this.denoising !== id) return;
        this.denoising = 0;
        this.denoiseMs = performance.now() - t0;
        this.pumpDenoise();
      });
  }

  /** The watchdog: the viewport's generation must keep getting tiles and have them drawn; if not, it starts again. */
  private check(now: number): void {
    if (this.viewGen === 0 || this.viewDone || this.failure !== null || this.viewW <= 0) return;
    const wd = this.watchdog;
    // The scene is still loading, or a pass is out: tiles must come.
    if (now - this.tileAt > wd.limit(this.acc && this.accGen === this.viewGen ? WATCHDOG.tileMs : WATCHDOG.startMs)) {
      this.fire(this.acc && this.accGen === this.viewGen ? `no tile for ${Math.round((now - this.tileAt) / 1000)} s` : `the workers did not take the new view in ${Math.round((now - this.startAt) / 1000)} s`, now);
    } else if (this.pendingSince && now - this.pendingSince > wd.limit(WATCHDOG.displayMs)) {
      this.fire(`tiles arrived ${Math.round((now - this.pendingSince) / 1000)} s ago and are not drawn`, now);
    }
  }

  /** Called by a timer: tiles that arrive must be drawn even if the page's animation loop stopped. */
  private checkFrames(): void {
    if (!this.active || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    const now = performance.now();
    if (now - this.lastFrameCall < WATCHDOG.frameMs) return;
    console.warn(`[viewport] watchdog (pool): no frame drawn for ${Math.round((now - this.lastFrameCall) / 1000)} s while the page is visible; drawing from a timer`);
    this.frame();
  }

  private fire(reason: string, now: number): void {
    this.watchdog.fire(reason, now);
    this.stopView();
    this.lastUpdate = null;
    this.restartWanted = true;
    this.tileAt = this.startAt = now;
    this.pendingSince = 0;
  }

  /**
   * K3: the automatic exposure of the view, metered from the accumulation on screen when it is complete and whenever
   * its samples have doubled (core/image-passes.ts `ExposureMeter`); the last reading while a new image fills in.
   */
  meteredExposure(): number | null {
    const acc = this.acc;
    if (acc && this.accScale === 1 && acc.complete) return this.meter.read(acc, acc.minSamples, () => meterExposure(acc));
    return this.meter.last;
  }

  private displayCurve(): DisplayCurve {
    const tone = this.source.tone(this.state!);
    const ev = tone.auto ? tone.exposureEv + (this.meteredExposure() ?? 0) : tone.exposureEv;
    if (!this.curve || this.curve.ev !== ev || this.curve.curve !== tone.tonemap) {
      this.curve = new DisplayCurve(ev, tone.tonemap);
      if (this.acc && this.accScale === 1) for (const t of this.acc.tiles) if (this.acc.samples[t.index] > 0) this.dirty.add(t.index);
      this.presentAll = true;
    }
    return this.curve;
  }

  private present(): void {
    const acc = this.acc;
    const ctx = this.ctx;
    if (!acc || !ctx || !this.canvas) return;
    const curve = this.displayCurve();
    if (this.accScale > 1) {
      if (!this.presentAll || !acc.complete) return;
      this.presentAll = false;
      const low = this.low!;
      if (low.width !== acc.width || low.height !== acc.height) {
        low.width = acc.width;
        low.height = acc.height;
      }
      const img = new ImageData(acc.imageBytes(curve) as Uint8ClampedArray<ArrayBuffer>, acc.width, acc.height);
      low.getContext('2d')!.putImageData(img, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'copy';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(low, 0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
      this.pendingSince = 0;
      this.shownKey = null;
      return;
    }
    this.presentAll = false;
    // An image of another size than the canvas cannot be drawn tile by tile: the watchdog notices.
    if (acc.width !== this.canvas.width || acc.height !== this.canvas.height) return;
    const t0 = performance.now();
    let drawn = 0;
    for (const i of this.dirty) {
      if (performance.now() - t0 > PRESENT_BUDGET_MS) break;
      this.dirty.delete(i);
      const t = acc.tiles[i];
      if (!this.tileImage || this.tileImage.width !== t.w || this.tileImage.height !== t.h) this.tileImage = new ImageData(t.w, t.h);
      acc.tileBytes(i, curve, this.tileImage.data);
      ctx.putImageData(this.tileImage, t.x, t.y);
      drawn++;
    }
    if (drawn > 0) {
      // The canvas now shows this view (the first pass covers every tile).
      if (acc.complete) this.shownKey = this.accKey;
      this.pendingSince = this.dirty.size > 0 ? t0 : 0;
    }
  }

  /** The scene of the project as the viewport would render it now (full resolution), cached per state. */
  private wantKey(): string | undefined {
    const state = this.state;
    if (!state || this.viewW <= 0) return undefined;
    const w = this.want;
    if (w && w.state === state && w.w === this.viewW && w.h === this.viewH && w.dpr === this.dpr && w.limit === this.limit) return w.key;
    const key = bytesKey(this.source.build(state, this.viewOf(state, 1, null)).bytes(false));
    this.want = { state, w: this.viewW, h: this.viewH, dpr: this.dpr, limit: this.limit, key };
    return key;
  }

  status(): EngineStatus {
    const acc = this.acc;
    const now = performance.now();
    const full = acc !== null && this.accScale === 1;
    // A denoised view shows the samples of its last denoised image (E5b-1).
    const denoised = full && acc.shownSamples > 0;
    // E10: an adaptive view's pixels have from `min` to `max` samples: the meter says both, the image counts its most.
    const range = full && acc.adaptive ? acc.sampleRange : null;
    const samples = full ? (denoised ? acc.shownSamples : range ? range.max : acc.minSamples) : 0;
    const caustics = this.accLane.length > 0 ? this.pool.causticsOf(this.accLane[0]) : 0;
    const max = this.state ? this.viewportSamples(this.state) : 1;
    const end = this.stoppedAt || performance.now();
    const k = this.whileRender === 'SHARE' ? viewportWorkers(this.pool.size) : 0;
    // While a Render runs: the viewport shares the pool, or waits (by choice, or in a pool of one); nothing to
    // say once it has converged.
    const converged = full && (samples >= max || this.timedOut || (range !== null && this.viewDone && this.accGen === this.viewGen));
    const renderShare = this.rendering > 0 && !converged ? (k > 0 ? 'SHARED' : 'PAUSED') : undefined;
    const restarted = this.watchdog.recent(now);
    const issue: ViewportIssue | undefined = this.failure !== null ? { kind: 'FAILED', detail: this.failure } : restarted ? { kind: 'RESTARTED', detail: restarted } : undefined;
    const wantKey = this.wantKey();
    // D1: what the Doctor reads of the accumulation (the raw sums: the denoised image is shown from other ones).
    const scan = full && acc.complete && this.accState ? this.scans.get(acc, acc.minSamples, () => scanFrame(acc, this.accState!)) : null;
    // K3: the automatic exposure's reading, for the meter.
    const metered = this.state && autoExposure(this.state.image) ? { meteredEv: this.meteredExposure() } : {};
    return {
      ...metered,
      samples,
      seconds: full && this.genStart ? (end - this.genStart) / 1000 : 0,
      converged,
      device: this.failure ? `error: ${this.failure}` : `${this.pool.size} workers${this.simd ? ' · SIMD' : ''}`,
      workers: this.pool.size,
      simd: this.simd,
      scale: acc ? this.accScale : 1,
      frames: this.frames,
      ...(this.lastFrameMs !== null ? { frameMs: this.lastFrameMs } : {}),
      rendering: this.rendering > 0,
      ...(renderShare ? { renderShare } : {}),
      ...(renderShare === 'SHARED' ? { share: { n: k, of: this.pool.size } } : {}),
      ...(full ? { pixels: acc.width * acc.height } : {}),
      ...(issue ? { issue } : {}),
      passes: this.passes,
      watchdog: this.watchdog.fires,
      ...(this.shownKey ? { shownKey: this.shownKey } : {}),
      ...(wantKey ? { wantKey } : {}),
      ...(denoised ? { denoised: true } : {}),
      ...(full && this.accGuides ? { liveDenoise: { ms: this.denoiseMs, images: this.cleanImages, accumulated: this.lastPass?.acc === acc ? this.lastPass.samples : 0, at: this.cleanAt } } : {}),
      ...(caustics > 0 && acc ? { caustics } : {}),
      ...(full && this.accFilter ? { pixelFilter: { ...this.accFilter } } : {}),
      ...(range ? { adaptive: { min: range.min, max: range.max, noise: this.accAdaptive?.last?.maxError ?? -1, eta: this.adaptiveEta } } : {}),
      ...(scan ? { scan } : {}),
    };
  }

  /** The viewport image as PNG (Full mode's Export viewport image). */
  capture(): Promise<Blob | null> {
    const c = this.canvas;
    return c ? new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png')) : Promise.resolve(null);
  }

  // ------------------------------------------------------------------ render

  /**
   * Renders the output image with the pool (all of it, or all but the viewport's share) and converts it
   * exactly. Renders run one after another (Render pressed while the queue runs waits for the job in progress).
   */
  renderPixels(opts: RenderOptions): Promise<RenderedPixels> {
    const run = this.renderChain.then(() => this.renderNow(opts));
    this.renderChain = run.catch(() => undefined);
    return run;
  }

  private renderChain: Promise<unknown> = Promise.resolve();

  private async renderNow(opts: RenderOptions): Promise<RenderedPixels> {
    const state = opts.state ?? this.state;
    if (!state) throw new Error('engine not ready');
    const signal = opts.signal;
    if (signal?.aborted) throw abortError();
    this.rendering++;
    const gen = this.gens.next();
    // The viewport leaves the Render's workers: it starts again on its share (or waits, by choice). A
    // converged image stays as it is.
    if (this.viewGen !== 0 && !this.viewDone) {
      const lane = this.finalLane();
      if (this.accLane.some((i) => lane.includes(i))) {
        this.stopView();
        this.restartWanted = true;
      }
    }
    const onAbort = () => this.pool.cancel(gen);
    signal?.addEventListener('abort', onAbort);
    const t0 = performance.now();
    try {
      const view: TracerView = {
        width: opts.width,
        height: opts.height,
        maxSamples: opts.maxSamples,
        maxSeconds: opts.maxSeconds,
        transparent: opts.transparent,
        ...(opts.camera ? { camera: opts.camera } : {}),
        ...(opts.time !== undefined ? { time: opts.time } : {}),
        ...(opts.advanced ? { advanced: opts.advanced, ...engineFieldsOf(opts.advanced, 'RENDER') } : {}),
        ...(opts.passes?.length ? { passes: opts.passes } : {}),
        ...this.filter,
        ...(opts.adaptive ? { adaptive: opts.adaptive } : {}),
        ...(readsTextures(this.pool.features) ? { textures: true } : {}),
        ...(readsPrograms(this.pool.features) ? { programs: true } : {}),
        // L5: the IES lights, when this engine renders them.
        ...(readsIes(this.pool.features) ? { ies: true } : {}),
        // K3: the interior cameras, when this engine reads them.
        ...(readsCameras(this.pool.features) ? { cameras: true } : {}),
      };
      // E5b-1: a denoised render also renders the guide passes and sums the squared luminance. U11b: at a strength
      // of 0 it is not denoised at all (the image is the noisy one).
      const strength = view.denoiseStrength ?? 1;
      const denoise = ((view.denoise ?? 0) & DENOISE_IMAGE) !== 0 && strength > 0;
      const keepNoisy = ((view.denoise ?? 0) & DENOISE_KEEP_NOISY) !== 0;
      const mask = passMask(opts.passes ?? []) | (denoise ? DENOISE_GUIDE_MASK : 0);
      const built = this.source.build(state, view);
      const update = built.bytes(false);
      opts.onProgress?.({ jobId: null, progress: 0, samples: 0, seconds: 0 });
      // E10: adaptive sampling (Finish by Noise): rounds decided by the image, at most its samples per pixel.
      const tone0 = this.source.tone(state);
      const adaptive = view.adaptive ? new AdaptiveState(opts.width, opts.height, { ev: tone0.exposureEv, target: view.adaptive.noiseThreshold, cap: budgetLimits(budgetOf(opts)).samples }) : null;
      let eta = -1;
      const acc = new Accumulator(opts.width, opts.height, undefined, { lum2: denoise, blocks: adaptive !== null });
      const passes = mask ? new PassAccumulator(opts.width, opts.height, mask, acc.tiles) : null;
      // Without a finish-by (older callers): the samples or the time, whichever first; 0 s is no limit.
      const budget: PassBudget = budgetOf(opts);
      let done = 0;
      let lastReport = 0;
      const report = () => {
        const elapsed = performance.now() - t0;
        const progress: RenderProgress = { jobId: null, progress: budgetProgress(budget, acc.totalSamples / Math.max(1, acc.tiles.length), elapsed), samples: done, seconds: elapsed / 1000 };
        if (adaptive) {
          const range = acc.sampleRange;
          const noise = adaptive.last?.maxError ?? -1;
          progress.samples = range.max;
          progress.adaptive = { min: range.min, max: range.max, noise, target: view.adaptive!.noiseThreshold, eta };
          progress.progress = adaptiveProgress(budget, range.max, elapsed, eta);
        }
        opts.onProgress?.(progress);
      };
      // U14: the queue's live view, when it wants a picture now: the accumulation as it is (each tile with its own
      // samples), scaled to its box, with the render's exposure and curve; the picture is kept, and only the boxes
      // over the tiles that came back since the last one are done again. Nothing is made while it wants none.
      let liveCurve: DisplayCurve | null = null;
      let livePic: LivePicture | null = null;
      const liveMeter = new ExposureMeter();
      const live = () => {
        const box = opts.frameBox?.();
        if (!box || !opts.onFrame) return;
        // K3: an automatic exposure is metered from the accumulation as it doubles its samples.
        const tone = this.source.tone(state);
        const ev = tone.auto ? tone.exposureEv + (acc.complete ? (liveMeter.read(acc, acc.minSamples, () => meterExposure(acc)) ?? 0) : 0) : tone.exposureEv;
        if (!liveCurve || liveCurve.ev !== ev) liveCurve = new DisplayCurve(ev, tone.tonemap);
        const k = fitFactor(acc.width, acc.height, box);
        // E10: an adaptive accumulation counts its samples per block.
        if (livePic?.k !== k) livePic = new LivePicture(acc.width, acc.height, k, acc.adaptive ? BLOCK : TILE);
        livePic.update(acc.sum, acc.adaptive ? acc.blockSamples : acc.samples, liveCurve);
        const seconds = (performance.now() - t0) / 1000;
        opts.onFrame({ width: livePic.width, height: livePic.height, rgba: livePic.rgba.slice(), renderWidth: opts.width, renderHeight: opts.height, samples: acc.adaptive ? acc.sampleRange.max : acc.minSamples, seconds, ...(acc.adaptive ? { minSamples: acc.sampleRange.min } : {}) });
      };
      const onTile = (r: TileResult) => {
        const b = r.block;
        if (b) acc.addBlock(r.index, b.x, b.y, b.w, b.h, r.first, r.count, r.data);
        else acc.add(r.index, r.first, r.count, r.data);
        if (passes && r.albedo) passes.addAlbedo(r.index, r.first, r.count, r.albedo);
        if (passes && r.exact) passes.setExact(r.index, r.exact);
        const now = performance.now();
        if (now - lastReport > 100) {
          lastReport = now;
          report();
        }
        if (opts.frameBox) live();
      };
      // Each pass on the workers the viewport leaves free now (all of them in Fast mode); the pool hands this job only
      // its own generation's tiles, and which worker renders a tile does not change a pixel, nor a pass. E10: after the
      // first round of an adaptive render, only the round's blocks.
      const pass = async (first: number, count: number): Promise<boolean> => {
        const lane = this.finalLane();
        this.finalPass = lane;
        try {
          await this.ensureScene(lane, built, update);
          if (signal?.aborted) return false;
          if (adaptive && !adaptive.warmingUp) return await this.pool.runBlocks(gen, adaptive.work(count), adaptive.iteration, onTile, lane);
          return await this.pool.run(gen, acc.tiles, first, count, onTile, lane, mask);
        } finally {
          this.finalPass = null;
        }
      };
      const result = adaptive
        ? await runAdaptive(budget, adaptive, {
            now: () => performance.now(),
            pass,
            decide: () => adaptive.decide(acc.sum, 4, acc.lum2),
            aborted: () => signal?.aborted === true,
            progress: (samples, _ms, left) => {
              done = samples;
              eta = left;
              report();
            },
          })
        : await runPasses(budget, {
            now: () => performance.now(),
            pass,
            aborted: () => signal?.aborted === true,
            progress: (samples) => {
              done = samples;
              report();
            },
          });
      done = result.samples;
      const tone0f = this.source.tone(state);
      // E10: an adaptive image goes on as sums rescaled to its most samples (what the files, the display and the denoiser
      // read as sums of `done` samples), every pixel's own count for the denoiser.
      const sums = adaptive ? rescaledSums(acc.sum, acc.width, acc.height, acc.blockSamples, done) : acc.sum;
      const lum2 = adaptive && denoise ? rescaledPlane(acc.lum2, acc.width, acc.height, acc.blockSamples, done) : acc.lum2;
      const counts = adaptive ? adaptive.pixelCounts() : undefined;
      // The engine's denoiser on the finished image (all the workers; the viewport may have its share back).
      let image = sums;
      let denoised = false;
      if (denoise && passes && done > 0 && !signal?.aborted) {
        const clean = await this.pool.denoise(opts.width, opts.height, done, sums, lum2, passes.resolve(), this.finalLane(), 'FULL', strength, counts).catch((err) => {
          console.warn(`render: denoise: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        });
        if (signal?.aborted) throw abortError();
        if (clean) {
          image = clean;
          denoised = true;
        }
      }
      // K3: an automatic exposure is metered from the finished sums before the denoise (the same for the denoised image
      // and the one without), so the same render gives the same exposure.
      const metered = tone0f.auto && done > 0 ? meterExposure({ width: opts.width, height: opts.height, sum: sums, samplesAt: () => done }) : null;
      const tone = { exposureEv: tone0f.exposureEv + (metered ?? 0), tonemap: tone0f.tonemap };
      // The workers convert slices of a copy; the sums stay here when they are wanted.
      const data = await this.pool.tonemap(image, opts.width, opts.height, done, tone.exposureEv, tone.tonemap);
      const noisy =
        denoised && keepNoisy
          ? { data: await this.pool.tonemap(sums, opts.width, opts.height, done, tone.exposureEv, tone.tonemap), ...(opts.keepLinear ? { sum: sums } : {}) }
          : undefined;
      const seconds = (performance.now() - t0) / 1000;
      opts.onProgress?.({ jobId: null, progress: 1, samples: done, seconds });
      return {
        width: opts.width,
        height: opts.height,
        data,
        samples: done,
        seconds,
        exposureEv: tone.exposureEv,
        tonemap: tone.tonemap,
        ...(opts.keepLinear ? { sum: image } : {}),
        ...(passes && opts.passes?.length ? { passes: passes.resolve() } : {}),
        ...(denoised ? { denoised: true } : {}),
        ...(noisy ? { noisy } : {}),
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.pool.cancel(gen);
      this.rendering--;
      // The Render is over (or stopped): the viewport takes every worker again, at once.
      this.restartWanted = true;
    }
  }

  async render(opts: RenderOptions): Promise<ImageBitmap> {
    const px = await this.renderPixels(opts);
    return createImageBitmap(new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.width, px.height), { premultiplyAlpha: 'none' });
  }

  /** Picking is the preview's (geometry, not shading). */
  pick(): PickHit | null {
    return null;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pool.dispose();
  }
}

/** E10: a full-resolution view samples adaptively when it follows the output's samples and the output finishes by noise. */
export function viewAdaptive(state: ProjectState, limit: Limit): { adaptive?: { noiseThreshold: number } } {
  return limit.by === 'OUTPUT' ? adaptiveOf(state.render) : {};
}

/** E10: the key of what adaptive sampling a view asks for (a change starts the image over). */
export function adaptiveKey(state: ProjectState): string {
  const a = adaptiveOf(state.render).adaptive;
  return a ? String(a.noiseThreshold) : '';
}

function sameLane(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

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

import type { CameraState } from '../core/camera';
import type { AdvancedSettings } from '../core/render';
import type { ProjectState } from '../core/store';
import type { EngineStatus, PickHit, RenderEngine, RenderOptions } from './engine';
import type { WorkerReply, WorkerRequest } from './pool-protocol';
import { abortError, budgetProgress, runPasses, type PassBudget } from './schedule';
import { Accumulator, assignTiles, chooseScale, Generations, nextPass, scaledSize, type Tile, type TileResult } from './tiles';
import type { ViewportLimit } from '../core/settings';
import { DisplayCurve } from './tonemap';

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
  /** Exposure and `RNDR.tonemap` the image is converted with. */
  tone(state: ProjectState): { exposureEv: number; tonemap: number };
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

/** The workers and their messages. */
export class Pool {
  readonly size: number;
  /** The engine's version as its workers report it (`rt_version`: major << 16 | minor << 8 | patch). */
  version = 0;
  private readonly workers: Worker[];
  private sceneSeq = 0;
  private readonly scenes = new Map<number, { left: number; error: string | null; done: (error: string | null) => void }>();
  private readonly jobs = new Map<number, JobState>();
  private tonemapSeq = 0;
  private readonly tonemaps = new Map<number, (bytes: Uint8ClampedArray) => void>();

  private constructor(workers: Worker[]) {
    this.workers = workers;
    this.size = workers.length;
    workers.forEach((w) => (w.onmessage = (e: MessageEvent<WorkerReply>) => this.receive(e.data)));
  }

  /** Starts `size` workers on a compiled engine; fails with the first worker's reason. */
  static async create(module: WebAssembly.Module, size: number, spawn: () => Worker): Promise<Pool> {
    const workers = Array.from({ length: size }, spawn);
    let version = 0;
    try {
      await Promise.all(
        workers.map(
          (w) =>
            new Promise<void>((resolve, reject) => {
              w.onmessage = (e: MessageEvent<WorkerReply>) => {
                if (e.data.type === 'ready') {
                  version = e.data.version;
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
    return pool;
  }

  private receive(msg: WorkerReply): void {
    switch (msg.type) {
      case 'scene': {
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
        const j = this.jobs.get(msg.generation);
        if (j && --j.left === 0) {
          this.jobs.delete(msg.generation);
          j.done(true);
        }
        return;
      }
      case 'error': {
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
    }
  }

  /** Loads (`full`) or updates the scene of every worker; rejects with the first error. */
  scene(bytes: Uint8Array, full: boolean): Promise<void> {
    const id = ++this.sceneSeq;
    return new Promise((resolve, reject) => {
      this.scenes.set(id, { left: this.size, error: null, done: (e) => (e ? reject(new Error(e)) : resolve()) });
      for (const w of this.workers) {
        // Every worker gets its own copy, transferred (no shared memory).
        const copy = bytes.slice().buffer;
        w.postMessage({ type: 'scene', id, bytes: copy, full } satisfies WorkerRequest, [copy]);
      }
    });
  }

  /**
   * Renders samples `first .. first + count - 1` of the tiles, tile i on worker i mod n. Resolves
   * true when every worker is done, false when the generation was cancelled.
   */
  run(generation: number, tiles: readonly Tile[], first: number, count: number, onTile: (r: TileResult) => void): Promise<boolean> {
    const parts = assignTiles(tiles, this.size);
    const busy = parts.filter((p) => p.length > 0).length;
    if (busy === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.jobs.set(generation, { left: busy, onTile, done: resolve });
      parts.forEach((list, i) => {
        if (list.length === 0) return;
        const packed = new Int32Array(list.length * 5);
        list.forEach((t, k) => packed.set([t.x, t.y, t.w, t.h, t.index], k * 5));
        this.workers[i].postMessage({ type: 'job', generation, tiles: packed, first, count } satisfies WorkerRequest, [packed.buffer]);
      });
    });
  }

  /** Stops every job up to `generation`; their `run` resolves false and their tiles are dropped. */
  cancel(generation: number): void {
    for (const [g, j] of [...this.jobs]) {
      if (g <= generation) {
        this.jobs.delete(g);
        j.done(false);
      }
    }
    for (const w of this.workers) w.postMessage({ type: 'cancel', generation } satisfies WorkerRequest);
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
}

/** What reaches the image, by reference: anything else (selection, names, the queue) does not restart it. */
function touchesImage(s: ProjectState, p: ProjectState): boolean {
  return (
    s.scene !== p.scene ||
    s.materials !== p.materials ||
    s.studio !== p.studio ||
    s.environment !== p.environment ||
    s.camera !== p.camera ||
    s.render.width !== p.render.width ||
    s.render.height !== p.render.height ||
    s.render.maxSamples !== p.render.maxSamples ||
    s.render.quality !== p.render.quality ||
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
  private readonly gens = new Generations();
  private acc: Accumulator | null = null;
  private accGen = 0;
  private accScale = 1;
  private firstPassDone = false;
  private curve: DisplayCurve | null = null;
  private readonly dirty = new Set<number>();
  private presentAll = false;
  private restartWanted = true;
  private loadedMeshKey: string | null = null;
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
  private genStart = 0;
  private stoppedAt = 0;
  private rendering = 0;
  private failure: string | null = null;
  private readonly frameListeners = new Set<() => void>();
  private tileImage: ImageData | null = null;
  /** Settings ▸ Preferences: ½ or ¼ during gestures, or chosen from the last frame's time. */
  private gestureScale: 'AUTO' | 'HALF' | 'QUARTER' = 'AUTO';
  /** Settings ▸ Render engine: when Full mode stops in the viewport. */
  private limit: ViewportLimit = { by: 'OUTPUT', samples: 1024, seconds: 120 };
  /** The viewport stopped because of its time limit. */
  private timedOut = false;

  constructor(
    private readonly pool: Pool,
    private readonly source: SceneSource,
    readonly simd: boolean,
  ) {}

  get workers(): number {
    return this.pool.size;
  }

  /** The engine's version, "major.minor.patch". */
  get version(): string {
    const v = this.pool.version;
    return `${v >> 16}.${(v >> 8) & 255}.${v & 255}`;
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
      return;
    }
    // A Render in progress keeps the pool: only the viewport's own frames stop.
    if (this.rendering === 0) this.pool.cancel(this.gens.next());
    this.acc = null;
  }

  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  sync(state: ProjectState, prev: ProjectState | null): void {
    this.state = state;
    if (!prev || touchesImage(state, prev)) this.changed();
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

  frame(): void {
    if (!this.active || !this.canvas || !this.state) return;
    const now = performance.now();
    // Quiet again after a run of changes: back to full resolution.
    if (!this.restartWanted && this.acc && this.accScale > 1 && !this.interactive(now) && now - this.lastChangeAt >= QUIET_MS) this.restartWanted = true;
    // A reduced-resolution frame in flight finishes first (otherwise a continuous drag would never show one).
    if (this.restartWanted && this.rendering === 0 && !this.frameInFlight) {
      this.restartWanted = false;
      void this.restart();
    }
    this.present();
    for (const fn of this.frameListeners) fn();
  }

  private async restart(): Promise<void> {
    const state = this.state;
    if (!state || this.viewW <= 0) return;
    const t0 = performance.now();
    const gesture = this.gesture;
    const scale = this.interactive(t0) ? this.chooseGestureScale() : 1;
    const px = this.pixelSize();
    const size = scaledSize(px.width, px.height, scale);
    const view: TracerView = {
      width: size.width,
      height: size.height,
      maxSamples: this.viewportSamples(state),
      maxSeconds: 0,
      viewport: { viewW: this.viewW, viewH: this.viewH },
      ...(gesture?.patch ? { cameraPatch: gesture.patch } : {}),
    };
    const built = this.source.build(state, view);
    const full = built.meshKey !== this.loadedMeshKey;
    const update = built.bytes(false);
    const acc0 = this.acc;
    // Nothing that reaches the image changed (a rename, a hidden-then-shown light): keep going.
    if (!full && acc0 && this.gens.accepts(this.accGen) && this.accScale === scale && acc0.width === size.width && acc0.height === size.height && sameBytes(this.lastUpdate, update)) return;

    const gen = this.gens.next();
    this.pool.cancel(gen - 1);
    this.frameInFlight = scale > 1;
    try {
      try {
        await this.pool.scene(full ? built.bytes(true) : update, full);
      } catch (err) {
        // An update the engine refuses: send everything instead.
        if (full || !this.gens.accepts(gen)) throw err;
        await this.pool.scene(built.bytes(true), true);
      }
    } catch (err) {
      if (this.gens.accepts(gen)) {
        this.failure = err instanceof Error ? err.message : String(err);
        this.frameInFlight = false;
      }
      return;
    }
    if (!this.gens.accepts(gen)) return;
    this.failure = null;
    this.loadedMeshKey = built.meshKey;
    this.lastUpdate = update;
    const acc = new Accumulator(size.width, size.height);
    this.acc = acc;
    this.accGen = gen;
    this.accScale = scale;
    this.firstPassDone = false;
    this.dirty.clear();
    if (scale === 1) {
      this.genStart = performance.now();
      this.stoppedAt = 0;
      this.timedOut = false;
    }
    const max = view.maxSamples;
    let done = 0;
    let pass = 0;
    for (;;) {
      const p = nextPass(done, pass, max);
      if (!p) break;
      const ok = await this.pool.run(gen, acc.tiles, p.first, p.count, (r) => this.onTile(gen, r));
      if (!this.gens.accepts(gen)) return;
      if (!ok) {
        this.frameInFlight = false;
        return;
      }
      if (!this.firstPassDone) {
        this.firstPassDone = true;
        if (scale > 1) {
          this.lastFrameMs = performance.now() - t0;
          this.lastScale = scale;
          this.frames++;
          this.frameInFlight = false;
        }
      }
      if (scale > 1) this.presentAll = true;
      done += p.count;
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
  }

  private onTile(gen: number, r: TileResult): void {
    const acc = this.acc;
    if (!acc || gen !== this.accGen || !this.gens.accepts(gen)) return;
    if (acc.add(r.index, r.first, r.count, r.data) && this.accScale === 1) this.dirty.add(r.index);
  }

  private displayCurve(): DisplayCurve {
    const tone = this.source.tone(this.state!);
    if (!this.curve || this.curve.ev !== tone.exposureEv || this.curve.curve !== tone.tonemap) {
      this.curve = new DisplayCurve(tone.exposureEv, tone.tonemap);
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
      return;
    }
    this.presentAll = false;
    if (acc.width !== this.canvas.width || acc.height !== this.canvas.height) return;
    const t0 = performance.now();
    for (const i of this.dirty) {
      if (performance.now() - t0 > PRESENT_BUDGET_MS) break;
      this.dirty.delete(i);
      const t = acc.tiles[i];
      if (!this.tileImage || this.tileImage.width !== t.w || this.tileImage.height !== t.h) this.tileImage = new ImageData(t.w, t.h);
      acc.tileBytes(i, curve, this.tileImage.data);
      ctx.putImageData(this.tileImage, t.x, t.y);
    }
  }

  status(): EngineStatus {
    const acc = this.acc;
    const full = acc !== null && this.accScale === 1;
    const samples = full ? acc.minSamples : 0;
    const max = this.state ? this.viewportSamples(this.state) : 1;
    const end = this.stoppedAt || performance.now();
    return {
      samples,
      seconds: full && this.genStart ? (end - this.genStart) / 1000 : 0,
      converged: full && (samples >= max || this.timedOut),
      device: this.failure ? `error: ${this.failure}` : `${this.pool.size} workers${this.simd ? ' · SIMD' : ''}`,
      workers: this.pool.size,
      simd: this.simd,
      scale: acc ? this.accScale : 1,
      frames: this.frames,
      ...(this.lastFrameMs !== null ? { frameMs: this.lastFrameMs } : {}),
      rendering: this.rendering > 0,
      ...(full ? { pixels: acc.width * acc.height } : {}),
    };
  }

  /** The viewport image as PNG (Full mode's Export viewport image). */
  capture(): Promise<Blob | null> {
    const c = this.canvas;
    return c ? new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png')) : Promise.resolve(null);
  }

  // ------------------------------------------------------------------ render

  /**
   * Renders the output image with the whole pool and converts it exactly. Renders run one after
   * another (Render pressed while the queue runs waits for the job in progress).
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
    this.pool.cancel(gen - 1);
    this.acc = null;
    this.frameInFlight = false;
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
        ...(opts.advanced ? { advanced: opts.advanced } : {}),
      };
      const built = this.source.build(state, view);
      const full = built.meshKey !== this.loadedMeshKey;
      opts.onProgress?.({ jobId: null, progress: 0, samples: 0, seconds: 0 });
      try {
        await this.pool.scene(built.bytes(full), full);
      } catch (err) {
        // An update the engine refuses: send everything instead.
        if (full) throw err;
        await this.pool.scene(built.bytes(true), true);
      }
      this.loadedMeshKey = built.meshKey;
      this.lastUpdate = null;
      if (signal?.aborted) throw abortError();
      const acc = new Accumulator(opts.width, opts.height);
      // Without a finish-by (older callers): the samples or the time, whichever first; 0 s is no limit.
      const budget: PassBudget = { finishBy: opts.finishBy ?? (opts.maxSeconds > 0 ? 'FIRST' : 'SAMPLES'), maxSamples: opts.maxSamples, maxSeconds: opts.maxSeconds };
      let done = 0;
      let lastReport = 0;
      const report = () => {
        const elapsed = performance.now() - t0;
        opts.onProgress?.({ jobId: null, progress: budgetProgress(budget, acc.totalSamples / Math.max(1, acc.tiles.length), elapsed), samples: done, seconds: elapsed / 1000 });
      };
      const result = await runPasses(budget, {
        now: () => performance.now(),
        // The pool hands this job only its own generation's tiles.
        pass: (first, count) =>
          this.pool.run(gen, acc.tiles, first, count, (r) => {
            acc.add(r.index, r.first, r.count, r.data);
            const now = performance.now();
            if (now - lastReport > 100) {
              lastReport = now;
              report();
            }
          }),
        aborted: () => signal?.aborted === true,
        progress: (samples) => {
          done = samples;
          report();
        },
      });
      done = result.samples;
      const tone = this.source.tone(state);
      // The workers convert slices of a copy; the sums stay here when they are wanted.
      const data = await this.pool.tonemap(acc.sum, opts.width, opts.height, done, tone.exposureEv, tone.tonemap);
      const seconds = (performance.now() - t0) / 1000;
      opts.onProgress?.({ jobId: null, progress: 1, samples: done, seconds });
      return { width: opts.width, height: opts.height, data, samples: done, seconds, exposureEv: tone.exposureEv, tonemap: tone.tonemap, ...(opts.keepLinear ? { sum: acc.sum } : {}) };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.rendering--;
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
    this.pool.dispose();
  }
}

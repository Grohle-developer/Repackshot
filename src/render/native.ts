// The path tracer of the desktop launcher (ARCHITECTURE §5.5): the same Rust
// engine as the worker pool, compiled natively and run by the launcher on
// every thread, behind the same interface as render/pathtracer.ts. main.ts
// picks it when the page runs in the launcher's window (io/native.ts); Full
// mode and Render then use it, and the wasm pool is not loaded.
//
// The launcher renders exactly as `rt` and the pool do (32-pixel tiles,
// samples in index order, f32 sums), so the image is the same bits; it sends
// back, after every pass, the RGBA sums of the whole image, which go into the
// same Accumulator the pool fills, and the display and 8-bit code of tiles.ts
// and tonemap.ts is reused unchanged.
//
// Viewport: every change posts a viewport job (an RSB without meshes when the
// geometry is the same: the launcher keeps it), which replaces the previous
// one, and long-polls its passes. Only one job is posted at a time, each with
// its number (`seq`, so one overtaken on the way cannot replace a newer one),
// and a job that is replaced has its poll aborted: a response is never left
// unread, because an unread one keeps one of the browser's six connections to
// the launcher, and with all six kept every request queues for ever (the
// viewport, Render and Pause all stop: phase P3a). During camera gestures it
// renders at ½ or ¼ of the viewport, as the pool does. While a Render runs the
// viewport keeps a quarter of the threads (`share`), or waits for it when the
// settings say so. A refused or lost view is posted again (1, 2, 4… s), with
// the reason on the meter, and a watchdog (render/watchdog.ts) starts the view
// again when it stops answering, stops getting passes or stops being drawn,
// writing what the launcher was doing to its log.
//
// Live denoise (U11): a full-resolution view is posted with `denoise=0|1`, its
// live switch (the Viewport part of Advanced ▸ Denoise), and its RSB always asks
// for denoise, so the launcher renders the guides and the switch never changes
// the scene; turning it posts `/api/render/<id>/denoise`, and the image does not
// start over. The long-poll carries the number of the image it has (`version`):
// the launcher answers with the sums only for a newer one, and with the switch
// turned on once the view is over, the poll waits for the denoised image.
//
// Render: a final job. It finishes by samples, by time or whichever comes
// first (`finish=`): the launcher stops between passes with the rule of
// schedule.ts `runPasses`, so the end lands as the pool's does. Progress comes
// from headers (schedule.ts `budgetProgress`), the sums once at the end; they
// are converted to 8 bits exactly in slices and, with `keepLinear`, handed
// back for 16-bit PNG and EXR. Every request carries the abort signal, so
// aborting (Pause, Stop) rejects at once and the job is cancelled.
//
// Passes (phase X2): a Render with `passes` asks the launcher for them
// (`passes=` and `RNDR.passes`); it keeps the image and the passes by the job's
// id for the AI (AI-POST.md §7.3, even after the page forgets the job), and the
// page reads them once, before it lets the job go (`GET /api/render/<id>/passes`,
// render/pass-planes.ts `parsePasses`), and hands them back with the render's id.
//
// Live view (U14): while the queue's live view wants a picture of the Render
// (`frameBox`, at its cadence), the page asks for the frame of the pass just
// published scaled down to the view's box (`GET /api/render/<id>?fit=WxH`:
// the launcher averages the sums by a whole factor) and converts it for
// display; while it wants none, only the headers travel, as before.

import type { CameraState } from '../core/camera';
import type { FrameBox } from '../core/live-frame';
import type { PassKey, RenderPasses } from '../core/passes';
import type { FinishBy, RenderProgress } from '../core/render';
import type { ProjectState } from '../core/store';
import type { ViewportLimit } from '../core/settings';
import { readsIes, readsPrograms, readsTextures, type EngineStatus, type PickHit, type RenderOptions } from './engine';
import { adaptiveKey, QUIET_MS, viewAdaptive, type RenderedPixels, type SceneSource, type TracerView } from './pathtracer';
import { CAUSTICS_PRESETS, DENOISE_IMAGE, denoiseIn } from '../core/caustics';
import { advancedTouchesView, engineFieldsOf } from '../core/render';
import { DEFAULT_PIXEL_FILTER, pixelFilterFields, type PixelFilterFields, type PixelFilterSetting } from '../core/antialias';
import { liveFrameOf } from './live-frame';
import { parsePasses } from './pass-planes';
import { abortError, adaptiveProgress, budgetProgress, type PassBudget } from './schedule';
import { Accumulator, chooseScale, exactBytes, scaledSize } from './tiles';
import { DisplayCurve } from './tonemap';
import { bytesKey, retryDelay, Watchdog, WATCHDOG, type ViewportIssue } from './watchdog';
import { ScanCache, scanFrame } from './frame-scan';

/** How the engine reaches the launcher (io/native.ts's NativeClient, handed in by main.ts). */
export interface NativeTransport {
  request(path: string, init?: RequestInit): Promise<Response>;
}

export const FRAME_MAGIC = 0x31585052; // "RPX1" little-endian
/** Bytes of the header the launcher writes (U11: 52, with the image's number; a reader takes the length from the header). */
export const FRAME_HEADER = 52;
export const FLAG_DONE = 1;
export const FLAG_CANCELLED = 2;
export const FLAG_FAILED = 4;
export const FLAG_PAUSED = 8;
export const FLAG_DATA = 16;
export const FLAG_SHARED = 32;
/** E5b-1: the sums are the engine's denoised image. */
export const FLAG_DENOISED = 64;
/** E5b-1: after the sums come the sums without denoise (a final's last frame, Also save without denoise). */
export const FLAG_NOISY = 128;
/** E5b-1: the image has caustics from the photon map. */
export const FLAG_CAUSTICS = 256;
/** U14: the sums are scaled down by a whole factor (`fit=`): the header's width and height are the picture's. */
export const FLAG_SCALED = 512;
/**
 * E10: the image is sampled adaptively: its pixels have from `adaptive.min` to `adaptive.max` samples, and the sums are
 * each pixel's rescaled to the header's samples (so they read as before).
 */
export const FLAG_ADAPTIVE = 1024;

/** Threads the viewport keeps while a Render runs: a quarter, at least one (render.rs `viewport_share`). */
export function viewportShare(threads: number): number {
  return Math.max(1, Math.floor(threads / 4));
}

export interface NativeFrame {
  pass: number;
  samples: number;
  width: number;
  height: number;
  seconds: number;
  flags: number;
  maxSamples: number;
  /** Threads rendering the job now (its share while it shares, 0 while it waits). */
  threads: number;
  rays: number;
  /** RGBA sums of `samples` samples per pixel (when the frame carries data); denoised with FLAG_DENOISED. */
  sums: Float32Array | null;
  /** E5b-1, with FLAG_NOISY: the sums without denoise. */
  noisy: Float32Array | null;
  /** U11: the number of the image (render.rs `Frame::version`; 0 in a header of before). */
  version: number;
  /**
   * E10, with FLAG_ADAPTIVE (render.rs `FrameAdaptive`, header bytes 52..68): the fewest and most samples of a pixel,
   * the relative error of the noisiest block at the last decision (-1 before it) and the seconds to the noise target
   * (-1: unknown). Null otherwise.
   */
  adaptive: { min: number; max: number; noise: number; eta: number } | null;
}

/** Reads a frame of `GET /api/render/<id>` (header, then little-endian f32 sums). */
export function parseFrame(buf: ArrayBuffer): NativeFrame {
  if (buf.byteLength < 48) throw new Error('short frame');
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== FRAME_MAGIC) throw new Error('not a frame');
  const header = v.getUint32(4, true);
  if (header < 48 || header % 4 !== 0 || header > buf.byteLength) throw new Error('bad frame header');
  const u = (i: number) => v.getUint32(i, true);
  const width = u(16);
  const height = u(20);
  const flags = u(28);
  let sums: Float32Array | null = null;
  let noisy: Float32Array | null = null;
  if (flags & FLAG_DATA) {
    const n = width * height * 4;
    const planes = flags & FLAG_NOISY ? 2 : 1;
    if (buf.byteLength - header < n * 4 * planes) throw new Error('short frame data');
    // The header is 48 bytes, so the floats are aligned; every browser is little-endian.
    sums = new Float32Array(buf, header, n);
    if (planes === 2) noisy = new Float32Array(buf, header + n * 4, n);
  }
  return {
    pass: u(8),
    samples: u(12),
    width,
    height,
    seconds: v.getFloat32(24, true),
    flags,
    maxSamples: u(32),
    threads: u(36),
    rays: Number(v.getBigUint64(40, true)),
    sums,
    noisy,
    version: header >= 52 ? u(48) : 0,
    adaptive: header >= 68 && flags & FLAG_ADAPTIVE ? { min: u(52), max: u(56), noise: v.getFloat32(60, true), eta: v.getFloat32(64, true) } : null,
  };
}

/** A short, stable name of a geometry key (two FNV-1a hashes). */
export function meshKeyHash(key: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c ^ (i & 0xff), 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0') + key.length.toString(16);
}

/** `exactBytes` over row slices, yielding between them so the page stays responsive. */
export async function exactBytesSliced(sum: Float32Array, width: number, height: number, samples: number, ev: number, tonemap: number, rowsPerSlice = 64): Promise<Uint8ClampedArray> {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += rowsPerSlice) {
    const a = y * width * 4;
    const b = Math.min(height, y + rowsPerSlice) * width * 4;
    exactBytes(sum.subarray(a, b), samples, ev, tonemap, out.subarray(a, b));
    if (b < out.length) await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** What reaches the image (as render/pathtracer.ts decides it). */
export function touchesImage(s: ProjectState, p: ProjectState): boolean {
  return (
    s.scene !== p.scene ||
    // Caustics and the other Advanced settings (E5b-1) reach the image; the denoise is the live switch (U11).
    advancedTouchesView(s.render.advanced, p.render.advanced) ||
    // E10: Finish by Noise samples the view adaptively, to its threshold.
    adaptiveKey(s) !== adaptiveKey(p) ||
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
    s.animation.clips !== p.animation.clips ||
    s.animation.shots !== p.animation.shots ||
    (s.animation.clips.length > 0 && (s.animation.playhead !== p.animation.playhead || s.animation.playing !== p.animation.playing))
  );
}

async function failureText(res: Response): Promise<string> {
  return (await failure(res)).message;
}

/** The launcher's error: its code and message (the body is read, so the connection is free again). */
async function failure(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return { code: body.error ?? `http-${res.status}`, message: body.message ?? body.error ?? `HTTP ${res.status}` };
  } catch {
    return { code: `http-${res.status}`, message: `HTTP ${res.status}` };
  }
}

/** A response whose body is not wanted: cancelled, so the browser can reuse its connection. */
function discard(res: Response): void {
  void res.body?.cancel().catch(() => undefined);
}

function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError';
}

const PRESENT_BUDGET_MS = 8;

interface ViewJob {
  id: number;
  gen: number;
  scale: number;
  acc: Accumulator;
  /** D1: the project the job was posted from (what the Doctor's scan of its sums is about). */
  state: ProjectState;
  /** The scene of the job (`bytesKey` of its update bytes). */
  key: string;
  share: number;
  pass: number;
  samples: number;
  seconds: number;
  done: boolean;
  paused: boolean;
  shared: boolean;
  /** Threads rendering it now (from the launcher). */
  threads: number;
  /** E5b-1: its last frame was denoised, and it renders caustics (the launcher's flags). */
  denoised: boolean;
  caustics: boolean;
  /** U11: the live denoise switch the launcher has for it (a full-resolution view), and the number of its image. */
  live: boolean;
  /** E11: the pixel filter and edge samples it was posted with. */
  filter: PixelFilterFields;
  version: number;
  /** U11: denoised images it has shown. */
  cleanImages: number;
  /** Milliseconds the next pass should take (from the last one), for the watchdog. */
  expectMs: number;
  /** Its long-poll is running (it ends when the job ends, is replaced, or fails). */
  alive: boolean;
  /** E10: what the launcher's last frame said of an adaptive image. */
  adaptive: NativeFrame['adaptive'];
  /** Aborts its long-poll. */
  abort: AbortController;
}

export class NativeEngine {
  readonly kind = 'pathtracer' as const;
  readonly native = true;
  /** Tells this window's viewport jobs apart from another window's. */
  private readonly client: string;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private low: HTMLCanvasElement | null = null;
  private state: ProjectState | null = null;
  private active = false;
  private viewW = 0;
  private viewH = 0;
  private dpr = 1;
  private gen = 0;
  private job: ViewJob | null = null;
  private curve: DisplayCurve | null = null;
  private readonly dirty = new Set<number>();
  private presentAll = false;
  private restartWanted = true;
  private loadedMeshKey: string | null = null;
  private lastUpdate: Uint8Array | null = null;
  private gesture: { patch: Partial<Omit<CameraState, 'id'>> | null } | null = null;
  private frameInFlight = false;
  /** The viewport job being posted (one at a time): its generation, since when, and its abort. */
  private posting: { gen: number; at: number; abort: AbortController } | null = null;
  private lastChangeAt = -Infinity;
  private previousChangeAt = -Infinity;
  private lastFrameMs: number | null = null;
  private lastScale = 4;
  private frames = 0;
  private passes = 0;
  private rendering = 0;
  private failure: string | null = null;
  /** When a refused or lost view is posted again (0: none pending), and how many tries so far. */
  private retryAt = 0;
  private retries = 0;
  private readonly watchdog = new Watchdog('native');
  /** The watchdog's clocks: the last answer of the job's long-poll, its last new pass, the last frame(). */
  private aliveAt = 0;
  private progressAt = 0;
  private lastFrameCall = 0;
  /** The pass of the job on the canvas (and the number of its image, U11), and since when a newer one waits to be drawn. */
  private shownPass = 0;
  private shownVersion = 0;
  /** U11: the live denoise switch, as the project says. */
  private liveOn = false;
  private shownKey: string | null = null;
  private pendingSince = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private want: { state: ProjectState; w: number; h: number; dpr: number; limit: ViewportLimit; key: string } | null = null;
  /** Look through (L4): the camera the viewport renders from, for a state; null: the active one. */
  private viewCamera: ((state: ProjectState) => CameraState | null) | null = null;
  private readonly frameListeners = new Set<() => void>();
  /** D1: what the Doctor reads of the view's sums, made again when the samples double. */
  private readonly scans = new ScanCache();
  private tileImage: ImageData | null = null;
  private renderChain: Promise<unknown> = Promise.resolve();
  /** Jobs of renders in progress (cancelled if the page goes away). */
  private readonly finals = new Set<number>();
  /** Settings ▸ Preferences: ½ or ¼ during gestures, or chosen from the last frame's time. */
  private gestureScale: 'AUTO' | 'HALF' | 'QUARTER' = 'AUTO';
  /** Settings ▸ Render engine: when Full mode stops in the viewport. */
  private limit: ViewportLimit = { by: 'OUTPUT', samples: 1024, seconds: 120 };
  /** Settings ▸ Render engine ▸ While a render runs: the viewport keeps a share of the threads, or waits. */
  private whileRender: 'SHARE' | 'PAUSE' = 'SHARE';
  /** E11: the pixel filter and edge samples asked of views and finals. */
  private filter: PixelFilterFields = pixelFilterFields(DEFAULT_PIXEL_FILTER);

  constructor(
    private readonly api: NativeTransport,
    private readonly source: SceneSource,
    readonly info: { threads: number; isa: string; engineVersion?: string; features?: number },
  ) {
    const bytes = new Uint8Array(8);
    globalThis.crypto?.getRandomValues?.(bytes);
    this.client = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') || String(Math.random()).slice(2);
  }

  get workers(): number {
    return this.info.threads;
  }

  get simd(): boolean {
    return this.info.isa !== 'scalar';
  }

  /** The native engine's version, as the launcher reports it. */
  get version(): string {
    return this.info.engineVersion ?? '';
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
      this.lastUpdate = null;
      this.restartWanted = true;
    }
  }

  /** While a render runs: SHARE keeps the viewport live on a quarter of the threads, PAUSE stops it until the render ends. */
  setWhileRender(mode: 'SHARE' | 'PAUSE'): void {
    if (mode === this.whileRender) return;
    this.whileRender = mode;
    this.lastUpdate = null;
    this.restartWanted = true;
  }

  /** E11: the pixel filter and the edge samples of the view and of every final from now on (the view starts over). */
  setPixelFilter(setting: PixelFilterSetting): void {
    const f = pixelFilterFields(setting);
    if (f.pixelFilter === this.filter.pixelFilter && f.edgeSupersample === this.filter.edgeSupersample) return;
    this.filter = f;
    this.restartWanted = true;
  }

  /** The threads the viewport asks to keep while a final runs. */
  private shareThreads(): number {
    return this.whileRender === 'SHARE' ? viewportShare(this.info.threads) : 0;
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

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.low = document.createElement('canvas');
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      if (this.canvas && this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.restartWanted = true;
      this.shownPass = 0;
      this.shownKey = null;
      this.pendingSince = 0;
      const now = performance.now();
      this.aliveAt = this.progressAt = this.lastFrameCall = now;
      // The page's own animation loop draws the frames; this timer only notices when it stopped.
      if (!this.timer && typeof setInterval === 'function') this.timer = setInterval(() => this.checkFrames(), 1000);
      return;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Off: the launcher stops the viewport's job (a Render keeps going).
    this.gen++;
    this.posting?.abort.abort();
    this.posting = null;
    const job = this.job;
    this.job = null;
    this.frameInFlight = false;
    this.retryAt = 0;
    this.pendingSince = 0;
    if (job) {
      job.abort.abort();
      if (!job.done) this.deleteJob(job.id);
    }
  }

  private deleteJob(id: number): void {
    void this.api
      .request(`/api/render/${id}`, { method: 'DELETE', keepalive: true })
      .then(discard)
      .catch(() => undefined);
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
    this.setLiveDenoise(denoiseIn(state.render.advanced.denoise, 'VIEWPORT'));
  }

  /**
   * U11: the live denoise switch. A full-resolution view of the launcher gets it at once (the image does not start
   * over): on, it denoises what has accumulated; off, the next frame is the noisy one. A view that is over is followed
   * again for that image.
   */
  private setLiveDenoise(on: boolean): void {
    if (on === this.liveOn) return;
    this.liveOn = on;
    const job = this.job;
    if (!job || job.scale !== 1 || job.gen !== this.gen || job.live === on) return;
    job.live = on;
    void this.api
      .request(`/api/render/${job.id}/denoise?on=${on ? 1 : 0}`, { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) {
          const why = await failure(res);
          // The launcher forgot the view: posted again (with the switch as it is now).
          if (job.gen === this.gen) this.lost(`the launcher no longer has the view (${why.code})`);
          return;
        }
        discard(res);
        // A view that is over is not followed any more: once more, for the image the switch asked for.
        if (job.gen === this.gen && !job.alive && job.done) void this.follow(job, performance.now());
      })
      .catch(() => {
        if (job.gen === this.gen) this.lost('the launcher did not hear the denoise switch');
      });
  }

  private changed(): void {
    this.restartWanted = true;
    this.previousChangeAt = this.lastChangeAt;
    this.lastChangeAt = performance.now();
  }

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

  private pixelSize(): { width: number; height: number } {
    const k = Math.min(1, this.dpr || 1);
    return { width: Math.max(1, Math.round(this.viewW * k)), height: Math.max(1, Math.round(this.viewH * k)) };
  }

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

  beginGesture(): void {
    this.gesture = { patch: null };
  }

  gestureView(patch: Partial<Omit<CameraState, 'id'>>): void {
    if (!this.gesture) this.gesture = { patch };
    else this.gesture.patch = patch;
    this.changed();
  }

  endGesture(): void {
    this.gesture = null;
    this.previousChangeAt = -Infinity;
    this.restartWanted = true;
  }

  frame(): void {
    if (!this.active || !this.canvas || !this.state) return;
    const now = performance.now();
    // The animation loop did not run for a while (the window was hidden or frozen): the clocks start again.
    if (now - this.lastFrameCall > WATCHDOG.frameMs) this.aliveAt = this.progressAt = this.pendingSince = now;
    this.lastFrameCall = now;
    if (!this.restartWanted && this.job && this.job.scale > 1 && !this.interactive(now) && now - this.lastChangeAt >= QUIET_MS) this.restartWanted = true;
    if (this.retryAt && now >= this.retryAt) {
      this.retryAt = 0;
      this.restartWanted = true;
    }
    this.check(now);
    // One viewport job is posted at a time: the newest view goes when the one in flight is answered.
    if (this.restartWanted && !this.frameInFlight && !this.posting) {
      this.restartWanted = false;
      void this.restart();
    }
    this.present();
    for (const fn of this.frameListeners) fn();
  }

  /** The view at a resolution divisor (and the camera of a gesture in progress). */
  private viewOf(state: ProjectState, scale: number, patch: Partial<Omit<CameraState, 'id'>> | null): { view: TracerView; timed: boolean } {
    const px = this.pixelSize();
    const size = scaledSize(px.width, px.height, scale);
    // "After N seconds": the launcher stops the job between passes at the limit (or at the output's samples).
    const timed = scale === 1 && this.limit.by === 'TIME';
    return {
      timed,
      view: {
        width: size.width,
        height: size.height,
        maxSamples: this.viewportSamples(state),
        maxSeconds: timed ? this.limit.seconds : 0,
        viewport: { viewW: this.viewW, viewH: this.viewH },
        ...(this.cameraPatch(state, patch) ? { cameraPatch: this.cameraPatch(state, patch)! } : {}),
        // E5b-1: the launcher renders its caustics; U11: a full-resolution view can always be denoised (its live
        // switch is a query of the job, so the scene is the same either way).
        ...engineFieldsOf(state.render.advanced, 'VIEWPORT'),
        denoise: scale > 1 ? 0 : DENOISE_IMAGE,
        // E11: a gesture's frames keep the filter but not the edge samples.
        pixelFilter: this.filter.pixelFilter,
        edgeSupersample: scale > 1 ? 1 : this.filter.edgeSupersample,
        // E10: a view that follows the output's samples samples adaptively when the output finishes by noise.
        ...(scale === 1 ? viewAdaptive(state, this.limit) : {}),
        // M2b: the textures, when the launcher's engine reads them; M3b: the material programs, when it runs them.
        ...(readsTextures(this.info.features) ? { textures: true } : {}),
        ...(readsPrograms(this.info.features) ? { programs: true } : {}),
        // L5: the IES lights, when this engine renders them.
        ...(readsIes(this.info.features) ? { ies: true } : {}),
      },
    };
  }

  /**
   * Posts a job. `whole` says the bytes are the complete scene (`full=1`): the launcher then reads
   * them as such even without a MESH section, which is what an empty project writes; otherwise a
   * viewport update the launcher cannot apply (409 need-meshes) is sent again whole.
   */
  private async post(kind: 'viewport' | 'final', bytes: Uint8Array, whole: boolean, meshKey: string, again: (() => Uint8Array) | undefined, opts: { finish?: FinishBy; seq?: number; share?: number; signal?: AbortSignal; passes?: readonly PassKey[]; live?: boolean }): Promise<number> {
    // E10: by noise is the launcher's by samples (its samples are the cap; the RSB's noise target ends it sooner).
    const finish = opts.finish ? `&finish=${(opts.finish === 'NOISE' ? 'SAMPLES' : opts.finish).toLowerCase()}` : '';
    const wanted = opts.passes?.length ? `&passes=${opts.passes.join(',')}` : '';
    const order = opts.seq !== undefined ? `&seq=${opts.seq}` : '';
    const share = opts.share ? `&share=${opts.share}` : '';
    const live = opts.live !== undefined ? `&denoise=${opts.live ? 1 : 0}` : '';
    const path = `/api/render?kind=${kind}${finish}${wanted}&mesh=${meshKeyHash(meshKey)}&client=${this.client}${order}${share}${live}`;
    const send = (body: Uint8Array, full: boolean) =>
      this.api.request(full ? `${path}&full=1` : path, { method: 'POST', body: body as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': 'application/octet-stream' }, ...(opts.signal ? { signal: opts.signal } : {}) });
    let res = await send(bytes, whole);
    if (res.status === 409 && again) {
      const why = await failure(res);
      if (why.code !== 'need-meshes') throw new Error(why.message);
      res = await send(again(), true);
    }
    if (!res.ok) throw new Error(await failureText(res));
    return ((await res.json()) as { id: number }).id;
  }

  private async restart(): Promise<void> {
    const state = this.state;
    if (!state || this.viewW <= 0) return;
    const t0 = performance.now();
    const gesture = this.gesture;
    const scale = this.interactive(t0) ? this.chooseGestureScale() : 1;
    const { view, timed } = this.viewOf(state, scale, gesture?.patch ?? null);
    const built = this.source.build(state, view);
    const meshes = built.meshKey !== this.loadedMeshKey;
    const update = built.bytes(false);
    const share = this.shareThreads();
    const cur = this.job;
    // The same view, still followed (or done): it goes on.
    if (!meshes && cur && (cur.alive || cur.done) && this.failure === null && cur.scale === scale && cur.share === share && cur.acc.width === view.width && cur.acc.height === view.height && sameBytes(this.lastUpdate, update)) return;
    const gen = ++this.gen;
    // The view on screen stays until the new one has a pass; its long-poll stops now.
    cur?.abort.abort();
    this.frameInFlight = scale > 1;
    const posting = { gen, at: t0, abort: new AbortController() };
    this.posting = posting;
    let id: number;
    const live = scale === 1 ? this.liveOn : false;
    try {
      id = await this.post('viewport', meshes ? built.bytes(true) : update, meshes, built.meshKey, () => built.bytes(true), {
        ...(timed ? { finish: 'FIRST' as const } : {}),
        seq: gen,
        share,
        signal: posting.abort.signal,
        ...(scale === 1 ? { live } : {}),
      });
    } catch (err) {
      if (gen === this.gen) this.fail(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      if (this.posting === posting) this.posting = null;
    }
    if (gen !== this.gen) {
      // Superseded while it was being posted (Fast mode, the watchdog): the launcher drops it.
      this.deleteJob(id);
      return;
    }
    this.failure = null;
    this.loadedMeshKey = built.meshKey;
    this.lastUpdate = update;
    const job: ViewJob = { id, gen, scale, acc: new Accumulator(view.width, view.height), state, key: bytesKey(update), share, pass: 0, samples: 0, seconds: 0, done: false, paused: false, shared: false, threads: this.info.threads, denoised: false, caustics: false, live, filter: { pixelFilter: view.pixelFilter ?? 0, edgeSupersample: view.edgeSupersample ?? 1 }, version: 0, cleanImages: 0, expectMs: 0, alive: true, abort: new AbortController(), adaptive: null };
    this.job = job;
    this.dirty.clear();
    this.shownPass = 0;
    this.shownVersion = 0;
    this.aliveAt = this.progressAt = performance.now();
    this.pendingSince = 0;
    // The switch was turned while the view was being posted.
    if (scale === 1 && this.liveOn !== live) {
      this.liveOn = live;
      this.setLiveDenoise(!live);
    }
    await this.follow(job, t0);
  }

  /** Long-polls the view job's frames until it ends, is replaced or fails; `t0`: when its view was asked for. */
  private async follow(job: ViewJob, t0: number): Promise<void> {
    const { id, gen, scale } = job;
    job.alive = true;
    try {
      for (;;) {
        const res = await this.api.request(`/api/render/${id}?after=${job.pass}&version=${job.version}`, { signal: job.abort.signal });
        if (gen !== this.gen) {
          discard(res);
          return;
        }
        if (res.status === 404) {
          // The launcher forgot it (replaced, cancelled, or it went unasked too long): post it again.
          discard(res);
          this.lost('the launcher no longer has the view');
          return;
        }
        if (!res.ok) throw new Error(await failureText(res));
        const frame = parseFrame(await res.arrayBuffer());
        if (gen !== this.gen) return;
        const now = performance.now();
        this.aliveAt = now;
        job.samples = frame.samples;
        job.seconds = frame.seconds;
        job.adaptive = frame.adaptive;
        job.paused = (frame.flags & FLAG_PAUSED) !== 0;
        job.shared = (frame.flags & FLAG_SHARED) !== 0;
        job.threads = frame.threads;
        // Waiting for a Render by choice is not a stall.
        if (job.paused) this.progressAt = now;
        // A new pass, with its image or not (U11: while a denoised image is on screen the launcher sends none).
        const first = job.pass === 0;
        if (frame.pass > job.pass) {
          this.passes += frame.pass - job.pass;
          job.pass = frame.pass;
          this.progressAt = now;
          this.retries = 0;
          this.watchdog.progressed();
          // The next pass doubles, up to 16 samples: about that much longer than this one took per sample.
          const per = frame.samples > 0 ? (frame.seconds * 1000) / frame.samples : 0;
          job.expectMs = per * Math.min(16, Math.max(1, frame.samples));
        }
        if (frame.sums) {
          job.denoised = (frame.flags & FLAG_DENOISED) !== 0;
          job.caustics = (frame.flags & FLAG_CAUSTICS) !== 0;
          if (job.denoised && frame.version !== job.version) job.cleanImages++;
          job.version = frame.version;
          job.acc.sum.set(frame.sums);
          job.acc.samples.fill(frame.samples);
          this.progressAt = now;
          if (this.pendingSince === 0) this.pendingSince = now;
          if (scale > 1) {
            this.presentAll = true;
            if (first) {
              this.lastFrameMs = performance.now() - t0;
              this.lastScale = scale;
              this.frames++;
              this.frameInFlight = false;
            }
          } else for (const t of job.acc.tiles) this.dirty.add(t.index);
        } else job.version = frame.version;
        if (frame.flags & (FLAG_DONE | FLAG_CANCELLED | FLAG_FAILED)) {
          if (frame.flags & FLAG_FAILED) this.fail('the render failed in the launcher');
          else if (frame.flags & FLAG_CANCELLED) this.lost('the launcher stopped the view');
          else job.done = true;
          return;
        }
      }
    } catch (err) {
      if (gen === this.gen && !isAbort(err)) this.fail(err instanceof Error ? err.message : String(err));
    } finally {
      job.alive = false;
      if (gen === this.gen) this.frameInFlight = false;
    }
  }

  /** The launcher refused or failed the view: the meter says why and it is posted again a little later. */
  private fail(reason: string): void {
    this.failure = reason;
    this.frameInFlight = false;
    const wait = retryDelay(Math.max(1, this.retries));
    this.retries++;
    this.retryAt = performance.now() + wait;
    this.lastUpdate = null;
    console.warn(`[viewport] native: ${reason}; trying again in ${Math.round(wait / 1000)} s`);
  }

  /** The launcher dropped the view: it is posted again (at once the first time). */
  private lost(reason: string): void {
    this.frameInFlight = false;
    const wait = retryDelay(this.retries);
    this.retries++;
    this.retryAt = performance.now() + Math.max(1, wait);
    this.lastUpdate = null;
    console.warn(`[viewport] native: ${reason}; posting it again`);
  }

  /** The watchdog: the view in flight must answer, get passes and be drawn; if not, it starts again. */
  private check(now: number): void {
    // A refused view is being retried (and the meter says so).
    if (this.retryAt || this.viewW <= 0) return;
    const wd = this.watchdog;
    const p = this.posting;
    if (p) {
      if (now - p.at > wd.limit(WATCHDOG.startMs)) this.fire(`the launcher did not take the new view in ${Math.round((now - p.at) / 1000)} s`, now);
      return;
    }
    const job = this.job;
    if (!job || job.done || job.gen !== this.gen) return;
    if (!job.alive) {
      if (!this.restartWanted) this.fire('the view stopped being followed', now);
      return;
    }
    const idleLimit = wd.limit(Math.max(WATCHDOG.idleMs, 4 * job.expectMs));
    if (now - this.aliveAt > wd.limit(WATCHDOG.silentMs)) this.fire(`the launcher has not answered for ${Math.round((now - this.aliveAt) / 1000)} s`, now);
    else if (now - this.progressAt > idleLimit) this.fire(`no new pass for ${Math.round((now - this.progressAt) / 1000)} s`, now);
    else if (this.pendingSince && now - this.pendingSince > wd.limit(WATCHDOG.displayMs)) this.fire(`pass ${job.pass} arrived ${Math.round((now - this.pendingSince) / 1000)} s ago and is not drawn`, now);
  }

  /** Called by a timer: frames that arrive must be drawn even if the page's animation loop stopped. */
  private checkFrames(): void {
    if (!this.active || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    const now = performance.now();
    if (now - this.lastFrameCall < WATCHDOG.frameMs) return;
    console.warn(`[viewport] watchdog (native): no frame drawn for ${Math.round((now - this.lastFrameCall) / 1000)} s while the page is visible; drawing from a timer`);
    this.frame();
  }

  private fire(reason: string, now: number): void {
    this.watchdog.fire(reason, now);
    // What the launcher was doing goes to its log (and to the console), for the report.
    const ask = new AbortController();
    const timeout = setTimeout(() => ask.abort(), 5000);
    void this.api
      .request(`/api/render/state?log=1&reason=${encodeURIComponent(`watchdog: ${reason}`.slice(0, 180))}`, { signal: ask.signal })
      .then((res) => res.text())
      .then((text) => console.warn(`[viewport] launcher state: ${text}`))
      .catch(() => console.warn('[viewport] the launcher did not answer for its state either'))
      .finally(() => clearTimeout(timeout));
    this.gen++;
    this.job?.abort.abort();
    this.posting?.abort.abort();
    this.posting = null;
    this.frameInFlight = false;
    this.lastUpdate = null;
    this.restartWanted = true;
    this.aliveAt = this.progressAt = now;
    this.pendingSince = 0;
  }

  private displayCurve(): DisplayCurve {
    const tone = this.source.tone(this.state!);
    if (!this.curve || this.curve.ev !== tone.exposureEv || this.curve.curve !== tone.tonemap) {
      this.curve = new DisplayCurve(tone.exposureEv, tone.tonemap);
      if (this.job && this.job.scale === 1 && this.job.pass > 0) for (const t of this.job.acc.tiles) this.dirty.add(t.index);
      this.presentAll = true;
    }
    return this.curve;
  }

  /** The job's pass (and its image, U11) is on the canvas. */
  private shown(job: ViewJob): void {
    this.shownPass = job.pass;
    this.shownVersion = job.version;
    this.shownKey = job.scale === 1 ? job.key : null;
    this.pendingSince = 0;
  }

  private present(): void {
    const job = this.job;
    const ctx = this.ctx;
    if (!job || !ctx || !this.canvas || job.pass === 0) return;
    const acc = job.acc;
    const curve = this.displayCurve();
    if (job.scale > 1) {
      if (!this.presentAll) {
        if (job.pass > this.shownPass || job.version !== this.shownVersion) this.shown(job);
        return;
      }
      this.presentAll = false;
      const low = this.low!;
      if (low.width !== acc.width || low.height !== acc.height) {
        low.width = acc.width;
        low.height = acc.height;
      }
      low.getContext('2d')!.putImageData(new ImageData(acc.imageBytes(curve) as Uint8ClampedArray<ArrayBuffer>, acc.width, acc.height), 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'copy';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(low, 0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
      this.shown(job);
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
    if (this.dirty.size === 0 && (job.pass > this.shownPass || job.version !== this.shownVersion)) this.shown(job);
    // Drawing goes on (a big image takes a few frames): not a stall.
    else if (drawn > 0 && this.pendingSince) this.pendingSince = t0;
  }

  /** The scene of the project as the viewport would render it now (full resolution), cached per state. */
  private wantKey(): string | undefined {
    const state = this.state;
    if (!state || this.viewW <= 0) return undefined;
    const w = this.want;
    if (w && w.state === state && w.w === this.viewW && w.h === this.viewH && w.dpr === this.dpr && w.limit === this.limit) return w.key;
    const key = bytesKey(this.source.build(state, this.viewOf(state, 1, null).view).bytes(false));
    this.want = { state, w: this.viewW, h: this.viewH, dpr: this.dpr, limit: this.limit, key };
    return key;
  }

  private issue(now: number): ViewportIssue | undefined {
    if (this.failure !== null) return { kind: 'FAILED', detail: this.failure, ...(this.retryAt ? { seconds: Math.max(0, Math.ceil((this.retryAt - now) / 1000)) } : {}) };
    const p = this.posting;
    if (p && now - p.at > 3000) return { kind: 'WAITING', detail: 'the launcher has not taken the view yet', seconds: Math.round((now - p.at) / 1000) };
    const job = this.job;
    if (job && job.alive && !job.done && now - this.aliveAt > 3000) return { kind: 'WAITING', detail: 'the launcher has not answered', seconds: Math.round((now - this.aliveAt) / 1000) };
    const restarted = this.watchdog.recent(now);
    if (restarted) return { kind: 'RESTARTED', detail: restarted };
    return undefined;
  }

  status(): EngineStatus & { native: true; threads: number; isa: string } {
    const job = this.job;
    const now = performance.now();
    const full = job !== null && job.scale === 1 && job.pass > 0;
    const samples = full ? job.samples : 0;
    const max = this.state ? this.viewportSamples(this.state) : 1;
    // While a Render runs: what the launcher says the job does, or what it was asked to do (nothing to say
    // once the view has converged: it does not render).
    const share = this.shareThreads();
    const live = job !== null && !job.done;
    const renderShare = job?.shared ? 'SHARED' : job?.paused ? 'PAUSED' : this.rendering > 0 && (live || !job) ? (share > 0 ? 'SHARED' : 'PAUSED') : undefined;
    const issue = this.issue(now);
    const wantKey = this.wantKey();
    // D1: what the Doctor reads of the sums the launcher handed out. While its live denoise is on those are the denoised
    // image, which holds no fireflies to count (the brightness by the stop it still says).
    const scan = full && job.pass > 0 ? this.scans.get(job.acc, job.samples, () => scanFrame(job.acc, job.state, { denoised: job.denoised }), job.denoised ? 'denoised' : '') : null;
    return {
      samples,
      seconds: full ? job.seconds : 0,
      // Done: at the samples, or stopped by the viewport's time limit.
      converged: full && (samples >= max || job.done),
      device: this.failure ? `error: ${this.failure}` : `native · ${this.info.threads} threads · ${this.info.isa}`,
      workers: this.info.threads,
      simd: this.simd,
      native: true,
      threads: this.info.threads,
      isa: this.info.isa,
      scale: job ? job.scale : 1,
      frames: this.frames,
      ...(this.lastFrameMs !== null ? { frameMs: this.lastFrameMs } : {}),
      rendering: this.rendering > 0 || (job?.paused ?? false) || (job?.shared ?? false),
      ...(renderShare ? { renderShare } : {}),
      ...(renderShare === 'SHARED' ? { share: { n: job?.shared && job.threads > 0 ? job.threads : share, of: this.info.threads } } : {}),
      ...(full ? { pixels: job.acc.width * job.acc.height } : {}),
      ...(issue ? { issue } : {}),
      passes: this.passes,
      watchdog: this.watchdog.fires,
      ...(this.shownKey ? { shownKey: this.shownKey } : {}),
      ...(wantKey ? { wantKey } : {}),
      ...(full && job.denoised ? { denoised: true } : {}),
      ...(full && job.live !== undefined ? { liveDenoise: { images: job.cleanImages } } : {}),
      ...(job?.caustics && this.state ? { caustics: CAUSTICS_PRESETS[this.state.render.advanced.causticsQuality].photons } : {}),
      ...(full && job.adaptive ? { adaptive: { ...job.adaptive } } : {}),
      ...(full ? { pixelFilter: { ...job.filter } } : {}),
      ...(scan ? { scan } : {}),
    };
  }

  capture(): Promise<Blob | null> {
    const c = this.canvas;
    return c ? new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png')) : Promise.resolve(null);
  }

  /** Renders the output image natively (one Render after another) and converts it exactly. */
  renderPixels(opts: RenderOptions): Promise<RenderedPixels> {
    const run = this.renderChain.then(() => this.renderNow(opts));
    this.renderChain = run.catch(() => undefined);
    return run;
  }

  private async renderNow(opts: RenderOptions): Promise<RenderedPixels> {
    const state = opts.state ?? this.state;
    if (!state) throw new Error('engine not ready');
    const signal = opts.signal;
    if (signal?.aborted) throw abortError();
    this.rendering++;
    let id: number | null = null;
    let cancelled = false;
    const cancel = () => {
      if (id === null || cancelled) return;
      cancelled = true;
      this.deleteJob(id);
    };
    signal?.addEventListener('abort', cancel);
    // Every request carries the signal: Pause or Stop rejects at once, whatever the launcher does.
    const init = signal ? { signal } : {};
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
        ...(readsTextures(this.info.features) ? { textures: true } : {}),
        ...(readsPrograms(this.info.features) ? { programs: true } : {}),
        // L5: the IES lights, when this engine renders them.
        ...(readsIes(this.info.features) ? { ies: true } : {}),
      };
      const built = this.source.build(state, view);
      // Without a finish-by (older callers): the samples or the time, whichever first; 0 s is no limit.
      const budget: PassBudget = { finishBy: opts.finishBy ?? (opts.maxSeconds > 0 ? 'FIRST' : 'SAMPLES'), maxSamples: opts.maxSamples, maxSeconds: opts.maxSeconds };
      opts.onProgress?.({ jobId: null, progress: 0, samples: 0, seconds: 0 });
      id = await this.post('final', built.bytes(true), true, built.meshKey, undefined, { finish: budget.finishBy, ...init, ...(opts.passes?.length ? { passes: opts.passes } : {}) });
      this.finals.add(id);
      if (signal?.aborted) {
        cancel();
        throw abortError();
      }
      let pass = 0;
      for (;;) {
        const res = await this.api.request(`/api/render/${id}?after=${pass}&data=0`, init);
        if (signal?.aborted) {
          discard(res);
          throw abortError();
        }
        if (!res.ok) {
          if (res.status === 404) discard(res);
          throw new Error(res.status === 404 ? 'the render was interrupted' : await failureText(res));
        }
        const f = parseFrame(await res.arrayBuffer());
        pass = f.pass;
        const progress: RenderProgress = { jobId: null, progress: budgetProgress(budget, f.samples, f.seconds * 1000), samples: f.samples, seconds: f.seconds };
        // E10: the launcher's numbers of an adaptive image, its progress by the time it expects to the target.
        if (f.adaptive && opts.adaptive) {
          progress.adaptive = { ...f.adaptive, target: opts.adaptive.noiseThreshold };
          progress.progress = adaptiveProgress(budget, f.samples, f.seconds * 1000, f.adaptive.eta);
        }
        opts.onProgress?.(progress);
        if (f.flags & FLAG_CANCELLED) throw signal?.aborted ? abortError() : new Error('the render was interrupted');
        if (f.flags & FLAG_FAILED) throw new Error('the render failed');
        if (f.flags & FLAG_DONE) break;
        // U14: the queue's live view wants a picture of this pass: the launcher scales the sums down to its box
        // (`fit=`), so only the picture's pixels travel. Asked for nothing, nothing is fetched.
        // A poll that comes back without a new pass (after a second) asks with the same image: no new picture of it.
        const box = f.samples > 0 && opts.onFrame ? opts.frameBox?.(f.pass) : null;
        if (box) await this.liveFrame(id, box, opts, state, init);
      }
      const res = await this.api.request(`/api/render/${id}`, init);
      if (!res.ok) throw new Error(await failureText(res));
      const f = parseFrame(await res.arrayBuffer());
      // The passes are read before the job is let go (the launcher keeps them for the AI all the same); for the
      // AI step of a Render they stay there (X3c: the pixels do not travel).
      const passes = opts.passes?.length && !opts.passesInLauncher ? await this.passesOf(id, f.width, f.height, init) : undefined;
      this.deleteJob(id);
      if (!f.sums) throw new Error('the render has no image');
      const tone = this.source.tone(state);
      const data = await exactBytesSliced(f.sums, f.width, f.height, f.samples, tone.exposureEv, tone.tonemap);
      // E5b-1: the launcher's last frame is the denoised image, with the one before denoise when asked.
      const denoised = (f.flags & FLAG_DENOISED) !== 0;
      const noisy = denoised && f.noisy ? { data: await exactBytesSliced(f.noisy, f.width, f.height, f.samples, tone.exposureEv, tone.tonemap), ...(opts.keepLinear ? { sum: f.noisy } : {}) } : undefined;
      opts.onProgress?.({ jobId: null, progress: 1, samples: f.samples, seconds: f.seconds });
      return {
        width: f.width,
        height: f.height,
        data,
        samples: f.samples,
        seconds: f.seconds,
        exposureEv: tone.exposureEv,
        tonemap: tone.tonemap,
        // The same f32 sums the pool keeps: 16-bit PNG and EXR are written from them.
        ...(opts.keepLinear ? { sum: f.sums } : {}),
        ...(passes ? { passes } : {}),
        renderId: id,
        ...(denoised ? { denoised: true } : {}),
        ...(noisy ? { noisy } : {}),
      };
    } catch (err) {
      // Aborted (Pause, Stop): the launcher stops the job, and the caller hears it as an abort.
      if (signal?.aborted || isAbort(err)) {
        cancel();
        throw abortError();
      }
      throw err;
    } finally {
      if (id !== null) this.finals.delete(id);
      signal?.removeEventListener('abort', cancel);
      this.rendering--;
    }
  }

  /**
   * U14: a picture of final render `id` as it is now for the queue's live view, the launcher's sums scaled to `box`
   * (`GET /api/render/<id>?fit=WxH`; a launcher without `fit=` sends them whole and they are scaled here). A picture
   * that cannot be had is skipped (the render goes on); an abort is the render's.
   */
  private async liveFrame(id: number, box: FrameBox, opts: RenderOptions, state: ProjectState, init: RequestInit): Promise<void> {
    try {
      const res = await this.api.request(`/api/render/${id}?fit=${Math.max(1, Math.floor(box.width))}x${Math.max(1, Math.floor(box.height))}`, init);
      // Every body is read (or its error text): an unread one would hold one of the six connections.
      if (!res.ok) throw new Error(await failureText(res));
      const f = parseFrame(await res.arrayBuffer());
      if (!f.sums || f.samples <= 0) return;
      if (!this.liveCurve || this.liveCurve.state !== state) {
        const tone = this.source.tone(state);
        this.liveCurve = { state, curve: new DisplayCurve(tone.exposureEv, tone.tonemap) };
      }
      opts.onFrame?.(liveFrameOf({ sum: f.sums, width: f.width, height: f.height, samples: f.samples }, box, this.liveCurve.curve, { renderWidth: opts.width, renderHeight: opts.height, samples: f.samples, seconds: f.seconds, ...(f.adaptive ? { minSamples: f.adaptive.min } : {}) }));
    } catch (err) {
      if (isAbort(err) || init.signal?.aborted) throw err;
      console.warn(`render ${id}: no live picture (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  /** U14: the display curve of the live view's pictures, for the project it was made from. */
  private liveCurve: { state: ProjectState; curve: DisplayCurve } | null = null;

  /**
   * The passes the launcher kept for final render `id`. A launcher that has none (one older than X2, or a
   * failure) leaves the render without them, and says so in the console: the image is still the render.
   */
  private async passesOf(id: number, width: number, height: number, init: RequestInit): Promise<RenderPasses | undefined> {
    try {
      const res = await this.api.request(`/api/render/${id}/passes`, init);
      // Every body is read (or its error text): an unread one would hold one of the six connections.
      if (!res.ok) throw new Error(await failureText(res));
      const p = parsePasses(await res.arrayBuffer());
      if (p.id !== id || p.passes.width !== width || p.passes.height !== height) throw new Error(`passes of render ${p.id}, ${p.passes.width} × ${p.passes.height}`);
      return p.passes;
    } catch (err) {
      // Pause or Stop while they come: an abort, like the rest of the render.
      if (isAbort(err) || init.signal?.aborted) throw err;
      console.warn(`render ${id}: no passes (${err instanceof Error ? err.message : String(err)})`);
      return undefined;
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

  /** The page goes away: the launcher stops this window's jobs at once (the requests outlive the page). */
  release(): void {
    for (const id of this.finals) this.deleteJob(id);
    if (this.job && !this.job.done) this.deleteJob(this.job.id);
  }

  dispose(): void {
    this.release();
    this.finals.clear();
    this.setActive(false);
  }
}

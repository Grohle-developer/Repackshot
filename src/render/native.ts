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
// one, and long-polls its passes. During camera gestures it renders at ½ or ¼
// of the viewport, as the pool does. Render: a final job, which pauses the
// viewport's while it runs. It finishes by samples, by time or whichever comes
// first (`finish=`): the launcher stops between passes with the rule of
// schedule.ts `runPasses`, so the end lands as the pool's does. Progress comes
// from headers (schedule.ts `budgetProgress`), the sums once at the end; they
// are converted to 8 bits exactly in slices and, with `keepLinear`, handed
// back for 16-bit PNG and EXR. Aborting the signal cancels the job.

import type { CameraState } from '../core/camera';
import type { FinishBy, RenderProgress } from '../core/render';
import type { ProjectState } from '../core/store';
import type { ViewportLimit } from '../core/settings';
import type { EngineStatus, PickHit, RenderOptions } from './engine';
import { QUIET_MS, type RenderedPixels, type SceneSource, type TracerView } from './pathtracer';
import { abortError, budgetProgress, type PassBudget } from './schedule';
import { Accumulator, chooseScale, exactBytes, scaledSize } from './tiles';
import { DisplayCurve } from './tonemap';

/** How the engine reaches the launcher (io/native.ts's NativeClient, handed in by main.ts). */
export interface NativeTransport {
  request(path: string, init?: RequestInit): Promise<Response>;
}

export const FRAME_MAGIC = 0x31585052; // "RPX1" little-endian
export const FRAME_HEADER = 48;
export const FLAG_DONE = 1;
export const FLAG_CANCELLED = 2;
export const FLAG_FAILED = 4;
export const FLAG_PAUSED = 8;
export const FLAG_DATA = 16;

export interface NativeFrame {
  pass: number;
  samples: number;
  width: number;
  height: number;
  seconds: number;
  flags: number;
  maxSamples: number;
  threads: number;
  rays: number;
  /** RGBA sums of `samples` samples per pixel (when the frame carries data). */
  sums: Float32Array | null;
}

/** Reads a frame of `GET /api/render/<id>` (header, then little-endian f32 sums). */
export function parseFrame(buf: ArrayBuffer): NativeFrame {
  if (buf.byteLength < FRAME_HEADER) throw new Error('short frame');
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== FRAME_MAGIC) throw new Error('not a frame');
  const header = v.getUint32(4, true);
  if (header < FRAME_HEADER || header > buf.byteLength) throw new Error('bad frame header');
  const u = (i: number) => v.getUint32(i, true);
  const width = u(16);
  const height = u(20);
  const flags = u(28);
  let sums: Float32Array | null = null;
  if (flags & FLAG_DATA) {
    const n = width * height * 4;
    if (buf.byteLength - header < n * 4) throw new Error('short frame data');
    // The header is 48 bytes, so the floats are aligned; every browser is little-endian.
    sums = new Float32Array(buf, header, n);
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

async function failureText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

const PRESENT_BUDGET_MS = 8;

interface ViewJob {
  id: number;
  gen: number;
  scale: number;
  acc: Accumulator;
  pass: number;
  samples: number;
  seconds: number;
  done: boolean;
  paused: boolean;
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
  private lastChangeAt = -Infinity;
  private previousChangeAt = -Infinity;
  private lastFrameMs: number | null = null;
  private lastScale = 4;
  private frames = 0;
  private rendering = 0;
  private failure: string | null = null;
  private readonly frameListeners = new Set<() => void>();
  private tileImage: ImageData | null = null;
  private renderChain: Promise<unknown> = Promise.resolve();
  /** Settings ▸ Preferences: ½ or ¼ during gestures, or chosen from the last frame's time. */
  private gestureScale: 'AUTO' | 'HALF' | 'QUARTER' = 'AUTO';
  /** Settings ▸ Render engine: when Full mode stops in the viewport. */
  private limit: ViewportLimit = { by: 'OUTPUT', samples: 1024, seconds: 120 };

  constructor(
    private readonly api: NativeTransport,
    private readonly source: SceneSource,
    readonly info: { threads: number; isa: string; engineVersion?: string },
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
      return;
    }
    // Off: the launcher stops the viewport's job (a Render keeps going).
    this.gen++;
    const job = this.job;
    this.job = null;
    this.frameInFlight = false;
    if (job && !job.done) void this.api.request(`/api/render/${job.id}`, { method: 'DELETE' }).catch(() => undefined);
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
    if (!this.restartWanted && this.job && this.job.scale > 1 && !this.interactive(now) && now - this.lastChangeAt >= QUIET_MS) this.restartWanted = true;
    if (this.restartWanted && !this.frameInFlight) {
      this.restartWanted = false;
      void this.restart();
    }
    this.present();
    for (const fn of this.frameListeners) fn();
  }

  /**
   * Posts a job. `whole` says the bytes are the complete scene (`full=1`): the launcher then reads
   * them as such even without a MESH section, which is what an empty project writes; otherwise a
   * viewport update the launcher cannot apply (409) is sent again whole.
   */
  private async post(kind: 'viewport' | 'final', bytes: Uint8Array, whole: boolean, meshKey: string, again?: () => Uint8Array, finishBy?: FinishBy): Promise<number> {
    const finish = finishBy ? `&finish=${finishBy.toLowerCase()}` : '';
    const path = `/api/render?kind=${kind}${finish}&mesh=${meshKeyHash(meshKey)}&client=${this.client}`;
    const send = (body: Uint8Array, full: boolean) => this.api.request(full ? `${path}&full=1` : path, { method: 'POST', body: body as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': 'application/octet-stream' } });
    let res = await send(bytes, whole);
    if (res.status === 409 && again) res = await send(again(), true);
    if (!res.ok) throw new Error(await failureText(res));
    return ((await res.json()) as { id: number }).id;
  }

  private async restart(): Promise<void> {
    const state = this.state;
    if (!state || this.viewW <= 0) return;
    const t0 = performance.now();
    const gesture = this.gesture;
    const scale = this.interactive(t0) ? this.chooseGestureScale() : 1;
    const px = this.pixelSize();
    const size = scaledSize(px.width, px.height, scale);
    // "After N seconds": the launcher stops the job between passes at the limit (or at the output's samples).
    const timed = scale === 1 && this.limit.by === 'TIME';
    const view: TracerView = {
      width: size.width,
      height: size.height,
      maxSamples: this.viewportSamples(state),
      maxSeconds: timed ? this.limit.seconds : 0,
      viewport: { viewW: this.viewW, viewH: this.viewH },
      ...(gesture?.patch ? { cameraPatch: gesture.patch } : {}),
    };
    const built = this.source.build(state, view);
    const meshes = built.meshKey !== this.loadedMeshKey;
    const update = built.bytes(false);
    const cur = this.job;
    if (!meshes && cur && this.failure === null && cur.scale === scale && cur.acc.width === size.width && cur.acc.height === size.height && sameBytes(this.lastUpdate, update)) return;
    const gen = ++this.gen;
    this.frameInFlight = scale > 1;
    let id: number;
    try {
      id = await this.post('viewport', meshes ? built.bytes(true) : update, meshes, built.meshKey, () => built.bytes(true), timed ? 'FIRST' : undefined);
    } catch (err) {
      if (gen === this.gen) {
        this.failure = err instanceof Error ? err.message : String(err);
        this.frameInFlight = false;
      }
      return;
    }
    if (gen !== this.gen) return;
    this.failure = null;
    this.loadedMeshKey = built.meshKey;
    this.lastUpdate = update;
    const job: ViewJob = { id, gen, scale, acc: new Accumulator(size.width, size.height), pass: 0, samples: 0, seconds: 0, done: false, paused: false };
    this.job = job;
    this.dirty.clear();
    for (;;) {
      let frame: NativeFrame;
      try {
        const res = await this.api.request(`/api/render/${id}?after=${job.pass}`);
        if (gen !== this.gen) return;
        if (res.status === 404) return; // replaced or cancelled
        if (!res.ok) throw new Error(await failureText(res));
        frame = parseFrame(await res.arrayBuffer());
      } catch (err) {
        if (gen === this.gen) {
          this.failure = err instanceof Error ? err.message : String(err);
          this.frameInFlight = false;
        }
        return;
      }
      if (gen !== this.gen) return;
      job.samples = frame.samples;
      job.seconds = frame.seconds;
      job.paused = (frame.flags & FLAG_PAUSED) !== 0;
      if (frame.sums) {
        job.acc.sum.set(frame.sums);
        job.acc.samples.fill(frame.samples);
        const first = job.pass === 0;
        job.pass = frame.pass;
        if (scale > 1) {
          this.presentAll = true;
          if (first) {
            this.lastFrameMs = performance.now() - t0;
            this.lastScale = scale;
            this.frames++;
            this.frameInFlight = false;
          }
        } else for (const t of job.acc.tiles) this.dirty.add(t.index);
      }
      if (frame.flags & (FLAG_DONE | FLAG_CANCELLED | FLAG_FAILED)) {
        job.done = true;
        if (frame.flags & FLAG_FAILED) this.failure = 'the render failed';
        this.frameInFlight = false;
        return;
      }
      // A newer view is waiting and this one is on screen: the next job replaces it.
      if (this.restartWanted && job.pass > 0) return;
    }
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

  private present(): void {
    const job = this.job;
    const ctx = this.ctx;
    if (!job || !ctx || !this.canvas || job.pass === 0) return;
    const acc = job.acc;
    const curve = this.displayCurve();
    if (job.scale > 1) {
      if (!this.presentAll) return;
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

  status(): EngineStatus & { native: true; threads: number; isa: string } {
    const job = this.job;
    const full = job !== null && job.scale === 1 && job.pass > 0;
    const samples = full ? job.samples : 0;
    const max = this.state ? this.viewportSamples(this.state) : 1;
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
      rendering: this.rendering > 0 || (job?.paused ?? false),
      ...(full ? { pixels: job.acc.width * job.acc.height } : {}),
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
    const cancel = () => {
      if (id !== null) void this.api.request(`/api/render/${id}`, { method: 'DELETE' }).catch(() => undefined);
    };
    signal?.addEventListener('abort', cancel);
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
      // Without a finish-by (older callers): the samples or the time, whichever first; 0 s is no limit.
      const budget: PassBudget = { finishBy: opts.finishBy ?? (opts.maxSeconds > 0 ? 'FIRST' : 'SAMPLES'), maxSamples: opts.maxSamples, maxSeconds: opts.maxSeconds };
      opts.onProgress?.({ jobId: null, progress: 0, samples: 0, seconds: 0 });
      id = await this.post('final', built.bytes(true), true, built.meshKey, undefined, budget.finishBy);
      if (signal?.aborted) {
        cancel();
        throw abortError();
      }
      let pass = 0;
      for (;;) {
        const res = await this.api.request(`/api/render/${id}?after=${pass}&data=0`);
        if (signal?.aborted) throw abortError();
        if (!res.ok) throw new Error(res.status === 404 ? 'the render was interrupted' : await failureText(res));
        const f = parseFrame(await res.arrayBuffer());
        pass = f.pass;
        const progress: RenderProgress = { jobId: null, progress: budgetProgress(budget, f.samples, f.seconds * 1000), samples: f.samples, seconds: f.seconds };
        opts.onProgress?.(progress);
        if (f.flags & FLAG_CANCELLED) throw signal?.aborted ? abortError() : new Error('the render was interrupted');
        if (f.flags & FLAG_FAILED) throw new Error('the render failed');
        if (f.flags & FLAG_DONE) break;
      }
      const res = await this.api.request(`/api/render/${id}`);
      if (!res.ok) throw new Error(await failureText(res));
      const f = parseFrame(await res.arrayBuffer());
      void this.api.request(`/api/render/${id}`, { method: 'DELETE' }).catch(() => undefined);
      if (!f.sums) throw new Error('the render has no image');
      const tone = this.source.tone(state);
      const data = await exactBytesSliced(f.sums, f.width, f.height, f.samples, tone.exposureEv, tone.tonemap);
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
      };
    } finally {
      signal?.removeEventListener('abort', cancel);
      this.rendering--;
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
    this.setActive(false);
  }
}

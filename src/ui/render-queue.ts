// The render queue at work (UI.md §2.5, §2.7, SPEC §3.8): jobs run one after
// another, always with the path tracer (`services.renderFrame`, never the
// preview), each image saved where its settings say and kept in the results
// history. *Render* runs only the jobs it just put first ("render just this
// one"); *Start queue* runs every waiting job in order; *Pause* stops now and
// the job in progress waits again (a render cannot resume halfway).
//
// Status and progress go through volatile store actions (`render/job`,
// `render/running`), throttled, so they never reach the undo history. If the
// running job leaves the queue (removed, or an undo took it away) its render
// is stopped.

import { totalDuration } from '../core/animation';
import { outputFileName, type NameValues } from '../core/name-template';
import { formatExtension, frameRange, frameTime, jobCamera, type JobRuntime, type JobStatus, type RenderJob, type RenderSettings } from '../core/render';
import type { ResultMeta } from '../core/results';
import type { ProjectState } from '../core/store';
import { cameraName, studioLabel } from './names';
import type { FrameRequest, FrameResult } from './ports';
import type { Ctx } from './reactive';
import { t, tIn } from './strings';

interface Runner {
  mode: 'IDLE' | 'ALL' | 'ONLY';
  /** Jobs Render asked for, in ONLY mode. */
  only: Set<string>;
  current: { id: string; abort: AbortController; why: 'PAUSE' | 'STOP' | 'GONE' | null } | null;
  loop: Promise<void> | null;
  unsubscribe: (() => void) | null;
}

const runners = new WeakMap<object, Runner>();

function runnerOf(ctx: Ctx): Runner {
  let r = runners.get(ctx.store);
  if (!r) {
    r = { mode: 'IDLE', only: new Set(), current: null, loop: null, unsubscribe: null };
    runners.set(ctx.store, r);
  }
  return r;
}

/** A job of the queue is being rendered. */
export function isRendering(ctx: Ctx): boolean {
  return runnerOf(ctx).current !== null;
}

export function queueMode(ctx: Ctx): Runner['mode'] {
  return runnerOf(ctx).mode;
}

/** Values of the name tokens for a job, now. */
export function nameValues(state: ProjectState, job: Pick<RenderJob, 'seq' | 'settings'>, cameraId: string | null, n = job.seq, date = new Date()): NameValues {
  const lang = state.meta.lang;
  const cam = cameraId ? state.camera.cameras[cameraId] : state.camera.cameras[state.camera.active];
  return {
    project: state.meta.name || tIn(lang, 'app.untitled'),
    camera: cameraName(state, cam, lang),
    studio: studioLabel(state.studio.preset, state.studio.customPreset)[lang],
    date,
    n,
  };
}

/** The frames a job writes: one image, or every frame of its range (1-based) with its instant. */
export function jobFrames(state: ProjectState, settings: RenderSettings): { n: number | null; time: number | undefined }[] {
  if (settings.mode !== 'ANIMATION') return [{ n: null, time: undefined }];
  const a = settings.animation;
  const range = frameRange(a, totalDuration(state));
  const out: { n: number | null; time: number | undefined }[] = [];
  for (let f = range.first; f <= range.last; f++) out.push({ n: f, time: frameTime(f, a.fps) });
  return out;
}

/** The file names a job writes, in order (images: one; animations: `…_0001.png` and on). */
export function jobFileNames(state: ProjectState, job: RenderJob, date = new Date()): string[] {
  const cam = jobCamera(job, state);
  const ext = formatExtension(job.settings.format);
  return jobFrames(state, job.settings).map((f) =>
    f.n === null ? outputFileName(job.settings.name, nameValues(state, job, cam, job.seq, date), ext) : outputFileName(job.settings.name, nameValues(state, job, cam, f.n, date), ext, true),
  );
}

/** A small JPEG of an image for the queue and the history ('' when the browser cannot decode it). */
async function thumbnailOf(blob: Blob): Promise<string> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return '';
    const bmp = await createImageBitmap(blob);
    const w = 192;
    const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    // Transparent images over the checker grey of the viewport, so they read in both themes.
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return c.toDataURL('image/jpeg', 0.8);
  } catch {
    return '';
  }
}

let resultSeq = 0;
function resultId(now: number): string {
  return `r${now.toString(36)}${(++resultSeq).toString(36)}`;
}

function patchJob(ctx: Ctx, id: string, patch: Partial<JobRuntime>): void {
  ctx.store.dispatch({ type: 'render/job', id, patch });
}

/** Stores a result in the history and in the interface's list (evicted ones leave both). */
export async function recordResult(ctx: Ctx, meta: ResultMeta, out: FrameResult): Promise<void> {
  let evicted: string[] = [];
  try {
    evicted = await ctx.services.results.add(meta, out.file, out.display);
  } catch (err) {
    console.warn(`results history: ${err instanceof Error ? err.message : String(err)}`);
  }
  const gone = new Set(evicted);
  ctx.ui.set({ results: [meta, ...ctx.ui.get().results.filter((r) => r.id !== meta.id && !gone.has(r.id))] });
}

/**
 * Renders one job: every frame with the path tracer, each saved under its name where the job
 * says, the first image kept in the history. Throws an AbortError when stopped.
 */
export async function runJob(ctx: Ctx, job: RenderJob, signal: AbortSignal, now: () => number = Date.now): Promise<{ resultIds: string[]; names: string[] }> {
  const state = ctx.store.get();
  const s = job.settings;
  const cam = jobCamera(job, state);
  const frames = jobFrames(state, s);
  const date = new Date(now());
  const names = jobFileNames(state, job, date);
  const total = frames.length;
  const anim = s.mode === 'ANIMATION';
  patchJob(ctx, job.id, { status: 'RUNNING', progress: 0, startedAt: now(), finishedAt: null, error: null, frame: 0, frames: anim ? total : 0 });
  const resultIds: string[] = [];
  const saved: string[] = [];
  let lastTick = 0;
  for (let k = 0; k < total; k++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const f = frames[k];
    const tick = (p: number, samples: number, seconds: number, force = false) => {
      const t = now();
      if (!force && t - lastTick < 200) return;
      lastTick = t;
      const progress = Math.min(1, (k + p) / total);
      ctx.store.dispatch({ type: 'render/running', running: { jobId: job.id, progress, samples, seconds, ...(anim ? { frame: k + 1, frames: total } : {}) } });
      patchJob(ctx, job.id, { progress, frame: anim ? k + 1 : 0 });
    };
    tick(0, 0, 0, true);
    const req: FrameRequest = {
      width: s.width,
      height: s.height,
      finishBy: s.finishBy,
      maxSamples: s.maxSamples,
      maxSeconds: s.maxSeconds,
      transparent: s.transparent,
      format: s.format,
      bitDepth: s.bitDepth,
      jpegQuality: s.jpegQuality,
      dpi: s.dpi,
      advanced: s.advanced,
      signal,
      onProgress: (p, samples, seconds) => tick(p, samples, seconds),
      ...(cam ? { camera: cam } : {}),
      ...(f.time !== undefined ? { time: f.time } : {}),
    };
    const out = await ctx.services.renderFrame(req);
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const where = await ctx.services.files.save(s.destination, names[k], out.file);
    saved.push(names[k]);
    // A measured throughput for the window's estimate (the whole render, upload and conversion included).
    if (out.seconds > 0 && out.samples > 0) ctx.ui.set({ throughput: (out.samples * out.width * out.height) / out.seconds });
    // The history keeps the image of a job (the first frame of an animation).
    if (k === 0) {
      const st = ctx.store.get();
      const camId = cam ?? st.camera.active;
      const meta: ResultMeta = {
        id: resultId(now()),
        jobId: job.id,
        name: names[k],
        createdAt: now(),
        width: out.width,
        height: out.height,
        dpi: s.dpi,
        samples: out.samples,
        seconds: out.seconds,
        cameraId: anim ? null : camId,
        camera: anim ? t('rw.cameraTrack') : cameraName(st, st.camera.cameras[camId]),
        format: s.format,
        bitDepth: s.bitDepth,
        savedTo: where === 'FOLDER' && s.destination.kind === 'FOLDER' ? s.destination : { kind: 'DOWNLOADS' },
        thumb: await thumbnailOf(out.display ?? out.file),
        bytes: out.file.size + (out.display?.size ?? 0),
        ...(anim ? { frame: frames[0].n ?? 1, frames: total } : {}),
      };
      await recordResult(ctx, meta, out);
      resultIds.push(meta.id);
      patchJob(ctx, job.id, { resultIds: [...resultIds] });
    }
    tick(1, out.samples, out.seconds, true);
  }
  return { resultIds, names: saved };
}

function nextJob(ctx: Ctx, r: Runner): RenderJob | undefined {
  const queue = ctx.store.get().render.queue;
  return queue.find((j) => j.status === 'QUEUED' && (r.mode === 'ALL' || r.only.has(j.id)));
}

function setMode(ctx: Ctx, r: Runner, mode: Runner['mode']): void {
  r.mode = mode;
  if (ctx.ui.get().queueRun !== mode) ctx.ui.set({ queueRun: mode });
}

/** Watches the queue while running: a job that leaves it (removed, or undone) stops rendering. */
function watchQueue(ctx: Ctx, r: Runner): void {
  if (r.unsubscribe) return;
  r.unsubscribe = ctx.store.subscribe((s) => {
    const c = r.current;
    if (c && !c.abort.signal.aborted && !s.render.queue.some((j) => j.id === c.id)) {
      c.why = 'GONE';
      c.abort.abort();
    }
  });
}

async function loop(ctx: Ctx, r: Runner): Promise<void> {
  watchQueue(ctx, r);
  try {
    for (;;) {
      if (r.mode === 'IDLE') break;
      const job = nextJob(ctx, r);
      if (!job) break;
      const abort = new AbortController();
      r.current = { id: job.id, abort, why: null };
      let status: JobStatus = 'DONE';
      let error: string | null = null;
      try {
        const out = await runJob(ctx, job, abort.signal);
        const n = out.names.length;
        const dest = job.settings.destination;
        if (n > 1) ctx.ui.toast(t('render.doneFrames', { n }));
        else ctx.ui.toast(dest.kind === 'FOLDER' ? t('render.doneFolder', { name: out.names[0] ?? '', folder: dest.name }) : t('render.done', { name: out.names[0] ?? '' }));
        if (job.settings.showWhenDone && out.resultIds[0]) ctx.ui.set({ resultView: { id: out.resultIds[0], compare: null, split: 'SPLIT', position: 0.5 } });
      } catch (err) {
        const why = r.current?.why;
        if (abort.signal.aborted || (err instanceof Error && err.name === 'AbortError')) status = why === 'PAUSE' ? 'QUEUED' : 'CANCELLED';
        else {
          status = 'FAILED';
          error = err instanceof Error ? err.message : String(err);
          ctx.ui.toast(t('render.failed', { reason: error }));
        }
        if (why === 'STOP') ctx.ui.toast(t('render.cancelled'));
      } finally {
        r.only.delete(job.id);
        const why = r.current?.why;
        r.current = null;
        if (why !== 'GONE' && ctx.store.get().render.queue.some((j) => j.id === job.id)) {
          ctx.store.dispatch({
            type: 'render/job',
            id: job.id,
            patch:
              status === 'QUEUED'
                ? { status, progress: 0, startedAt: null, frame: 0 }
                : { status, progress: status === 'DONE' ? 1 : ctx.store.get().render.queue.find((j) => j.id === job.id)?.progress ?? 0, finishedAt: Date.now(), error },
          });
        }
        ctx.store.dispatch({ type: 'render/running', running: null });
      }
      if (status === 'QUEUED') break; // paused
    }
  } finally {
    r.loop = null;
    r.only.clear();
    setMode(ctx, r, 'IDLE');
    r.unsubscribe?.();
    r.unsubscribe = null;
  }
}

function ensureLoop(ctx: Ctx, r: Runner): void {
  if (!r.loop) r.loop = loop(ctx, r);
}

/** Start queue: every waiting job, in order. */
export function startQueue(ctx: Ctx): void {
  const r = runnerOf(ctx);
  setMode(ctx, r, 'ALL');
  ensureLoop(ctx, r);
}

/**
 * Render: these jobs (just put first) start now. With the queue already running they are next
 * (the job in progress is not thrown away); with only Render's jobs running, they join them.
 */
export function runOnly(ctx: Ctx, ids: readonly string[]): 'NOW' | 'NEXT' {
  const r = runnerOf(ctx);
  const busy = r.current !== null;
  if (r.mode !== 'ALL') {
    for (const id of ids) r.only.add(id);
    setMode(ctx, r, 'ONLY');
  }
  ensureLoop(ctx, r);
  return busy ? 'NEXT' : 'NOW';
}

/** Pause: stops now; the job in progress waits again and the queue stays where it is. */
export function pauseQueue(ctx: Ctx): void {
  const r = runnerOf(ctx);
  setMode(ctx, r, 'IDLE');
  if (r.current) {
    r.current.why = 'PAUSE';
    r.current.abort.abort();
  }
}

/** Stops one job (the one in progress: cancelled); the queue goes on with the next. */
export function stopJob(ctx: Ctx, id: string): void {
  const r = runnerOf(ctx);
  if (r.current?.id === id) {
    r.current.why = 'STOP';
    r.current.abort.abort();
  }
}

/** For tests: waits until the runner is idle. */
export async function queueSettled(ctx: Ctx): Promise<void> {
  const r = runnerOf(ctx);
  while (r.loop) await r.loop;
}

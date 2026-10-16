// The render queue at work (UI.md §2.5, §2.7, SPEC §3.8): jobs run one after
// another, always with the path tracer (`services.renderFrame`, never the
// preview), each image saved where its settings say and kept in the results
// history. *Render* runs only the jobs it just put first ("render just this
// one"); *Start queue* runs every waiting job in order; *Pause* stops now (the
// engine is free at once) and the job in progress waits again (a render cannot
// resume halfway); *Resume* goes on with what was paused. Pausing and resuming
// are taken at once, even while the stopped job is still winding down: a
// Resume pressed then is not lost, it carries on in the same loop.
//
// Status and progress go through volatile store actions (`render/job`,
// `render/running`), throttled, so they never reach the undo history. If the
// running job leaves the queue (removed, or an undo took it away) its render
// is stopped.
//
// AI post-processing (X3c): after the engine's image is saved, a job with the
// AI on posts it to the pipeline. On the desktop the source is the render the
// launcher kept with its linear image and passes (`RENDER`), and the AI's image
// comes back as the render's light and is written with the render's own
// exposure and curve, so a PNG of 16 bits or an EXR stays one; elsewhere the
// saved picture and three.js passes go along (`INLINE`). While it runs, the
// job's progress is the pipeline's, tile by tile. Stopping or pausing it then
// keeps the engine's image in the history: only the AI's is lost.
//
// Variants (X4b): a job with N variants is still one render; the AI step then
// posts it N times with consecutive seeds (seed, seed + 1…), the model kept
// loaded and the launcher's kept render reused, and saves each image under its
// own name (`_AI`, `_AI_2`…) with its own report. Stopping in the middle keeps
// the render and the variants already finished. The prompt is Settings' system
// prompt, the scene's and the job's own, fitted to the model (src/ai/prompt.ts).
//
// Plugins (P6 decision 9): a plugin switched on for render jobs (its `jobs` in
// the job's settings) takes every image the job renders, after the engine's is
// saved: a still with the seed set (seed0), and each frame of an animation with
// its own, seed0 + the frame's index in the animation (`frameControls`), so its
// grain is drawn again on every frame. Its image is saved next to the engine's
// (`<name>_<plugin>.png`); the first one is also kept in the history, with its
// provenance (seed0 and the rule). A plugin that is not installed, or fails,
// leaves the engine's images as they are and says so once.
//
// Live view (U14): a job that runs while the live view shows it (a click on
// its row: `ui.liveView`) gets pictures of its render as it accumulates
// (`liveTap`: at most every LIVE_FRAME_MS, only while the view shows it and
// the page is visible), kept in `ui.liveFrame`; when it ends with a result,
// the view becomes the results viewer of that result.

import { totalDuration } from '../core/animation';
import type { AiPostProgress, AiPostRequest } from '../core/ai';
import { aiFileName, pipelineOf, variantSettings } from '../core/ai-post';
import { FrameCadence, liveBox } from '../core/live-frame';
import { outputFileName, type NameValues } from '../core/name-template';
import { formatExtension, frameRange, frameTime, jobCamera, needsDisplayCopy, type JobRuntime, type JobStatus, type RenderJob, type RenderSettings } from '../core/render';
import { controlsFor, frameControls, seedProvenance, type PluginLabel, type PluginManifest, type PluginRenderSettings } from '../core/plugins';
import type { AiResultInfo, ResultMeta } from '../core/results';
import type { ProjectState } from '../core/store';
import { promptContext } from './ai-query';
import { cameraName, dyn, studioLabel } from './names';
import { pluginImageFile, recordPluginResult } from './plugin-results';
import type { FrameRequest, FrameResult } from './ports';
import type { Ctx } from './reactive';
import { lbl, t, tIn } from './strings';

interface Runner {
  /** IDLE: not started; ALL: every waiting job; ONLY: Render's jobs; PAUSED: stopped by Pause, waiting for Resume. */
  mode: 'IDLE' | 'ALL' | 'ONLY' | 'PAUSED';
  /** Jobs Render asked for, in ONLY mode. */
  only: Set<string>;
  /** What Resume goes on with after a Pause. */
  resume: { mode: 'ALL' | 'ONLY'; only: string[] } | null;
  current: { id: string; abort: AbortController; why: 'PAUSE' | 'STOP' | 'GONE' | null } | null;
  loop: Promise<void> | null;
  unsubscribe: (() => void) | null;
}

const runners = new WeakMap<object, Runner>();

function runnerOf(ctx: Ctx): Runner {
  let r = runners.get(ctx.store);
  if (!r) {
    r = { mode: 'IDLE', only: new Set(), resume: null, current: null, loop: null, unsubscribe: null };
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
/** A small JPEG (data URL) of an image file, for the queue and the history; '' where it cannot be drawn. */
export async function thumbnailOf(blob: Blob): Promise<string> {
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
/** A new result id. */
export function resultId(now: number): string {
  return `r${now.toString(36)}${(++resultSeq).toString(36)}`;
}

function patchJob(ctx: Ctx, id: string, patch: Partial<JobRuntime>): void {
  ctx.store.dispatch({ type: 'render/job', id, patch });
}

const abortError = (): DOMException => new DOMException('aborted', 'AbortError');

/** One variant the AI step made (X4b): its image (null when the guard rejected it: the engine's stays) and its record. */
export interface AiVariantDone {
  blob: Blob | null;
  info: AiResultInfo;
}

/** Where the AI step is: the pipeline's progress of the variant in flight, and which variant of how many (X4b). */
export type AiStepProgress = AiPostProgress & { variant: number; variants: number };

/**
 * The AI post-processing of a finished image (AI-POST.md §4, §7): the engine's image has been saved already and
 * stays the result's own; the service gets the render the launcher kept (`RENDER`, desktop) or a copy of the
 * picture with the passes of its camera (`INLINE`), and what it makes is saved next to it (`…_AI.png`) and kept in
 * the history with the guard's report. With N variants (X4b) the same source is posted N times with consecutive
 * seeds, each image saved under its own name (`…_AI_2.png`…) with its own report; `done` gets each variant as it
 * ends, so a caller stopped in the middle keeps the ones finished. Never throws but for an abort: when the AI cannot
 * run, or fails, the person is told and what was finished (maybe nothing) is all there is. A REJECTED report keeps
 * the report (the viewer words it) and no image of its own: the delivered image is the engine's, unchanged.
 * `measure` hears the seconds each finished request took, measured around it.
 */
export async function aiStep(
  ctx: Ctx,
  s: RenderSettings,
  out: FrameResult,
  cam: string | null,
  fileName: string,
  signal: AbortSignal,
  onProgress: (p: AiStepProgress) => void = () => undefined,
  done: AiVariantDone[] = [],
  measure: (seconds: number) => void = () => undefined,
): Promise<AiVariantDone[] | null> {
  const port = ctx.services.ai;
  if (!port) return null;
  const variants = Math.max(1, Math.round(s.ai.variants ?? 1));
  const skipped = (reason: string) => {
    ctx.ui.toast(done.length > 0 ? t('render.aiVariantFailed', { i: done.length + 1, n: variants, reason }) : t('render.aiSkipped', { reason }));
    return done.length > 0 ? done : null;
  };
  try {
    const status = await port.service.status();
    if (!status.available) return skipped(t(dyn(`rw.aiWhy.${status.reason ?? 'NOT_BUILT'}`)));
    const st = ctx.store.get();
    const pipeline = pipelineOf(s.ai);
    // Settings' system prompt, the scene's and the job's own (when the model takes one), fitted to the model.
    const pc = promptContext(ctx.ui.get(), status);
    const text = port.scenePrompt(st, pipeline, { system: pc.system, caps: pc.caps });
    const materials = port.materials(st, cam);
    const kept = out.renderId !== undefined && (await port.renderSource());
    let source: AiPostRequest['source'];
    if (kept) source = { kind: 'RENDER', renderId: out.renderId! };
    else {
      const [image, passes] = await Promise.all([port.decode(out.display ?? out.file), port.passes({ width: out.width, height: out.height, camera: cam })]);
      source = { kind: 'INLINE', image, passes };
    }
    const opts = { format: s.format, bitDepth: s.bitDepth, jpegQuality: s.jpegQuality, dpi: s.dpi, transparent: s.transparent, ...(kept && out.tone ? { tone: out.tone } : {}) };
    for (let v = done.length + 1; v <= variants; v++) {
      if (signal.aborted) throw abortError();
      // Each variant is one request with its own seed; the source (the kept render, or the decoded picture) is the same.
      const t0 = performance.now();
      const result = await port.service.post(
        { source, settings: variantSettings(pipeline, v), prompt: text.prompt, negative: text.negative, modelKey: status.activeModel ?? '', materials },
        (p) => onProgress({ ...p, fraction: (v - 1 + Math.max(0, Math.min(1, p.fraction))) / variants, variant: v, variants }),
        signal,
      );
      if (signal.aborted) throw abortError();
      measure(Math.max(0, (performance.now() - t0) / 1000));
      const name = aiFileName(fileName, v);
      if (result.report.verdict === 'REJECTED') {
        ctx.ui.toast(variants > 1 ? t('render.aiVariantRejected', { i: v, n: variants }) : t('render.aiRejected'));
        done.push({ blob: null, info: { name, thumb: '', bytes: 0, report: result.report } });
        continue;
      }
      const blob = await port.encode(result.image, opts);
      await ctx.services.files.save(s.destination, name, blob);
      // Browsers do not show EXR, TIFF or DNG: the thumbnail comes from an 8-bit picture of the same image (as the engine's does).
      const shown = needsDisplayCopy(s.format) ? await port.encode(result.image, { ...opts, format: 'PNG', bitDepth: 8 }) : blob;
      done.push({ blob, info: { name, thumb: await thumbnailOf(shown), bytes: blob.size, report: result.report } });
    }
    return done;
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) throw err;
    return skipped(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Stores a result in the history and in the interface's list (evicted ones leave both). `ai`: the image the AI
 * post-processing made (its first variant); `aiMore`: variants 2 and on (X4b), null for one the guard rejected.
 */
export async function recordResult(ctx: Ctx, meta: ResultMeta, out: FrameResult, ai: Blob | null = null, aiMore: readonly (Blob | null)[] = []): Promise<void> {
  let evicted: string[] = [];
  try {
    evicted = await (aiMore.length > 0 ? ctx.services.results.add(meta, out.file, out.display, ai, aiMore) : ctx.services.results.add(meta, out.file, out.display, ai));
  } catch (err) {
    console.warn(`results history: ${err instanceof Error ? err.message : String(err)}`);
  }
  const gone = new Set(evicted);
  ctx.ui.set({ results: [meta, ...ctx.ui.get().results.filter((r) => r.id !== meta.id && !gone.has(r.id))] });
}

/** The file name of a render's image before denoise (E5b-1): `-noisy` before the extension. */
export function noisyName(name: string): string {
  const dot = name.lastIndexOf('.');
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return dot > slash && dot > 0 ? `${name.slice(0, dot)}-noisy${name.slice(dot)}` : `${name}-noisy`;
}

/** A plugin a job goes through (decision 9): its kept settings, and its manifest when it is installed and opens. */
interface JobPlugin {
  id: string;
  entry: PluginRenderSettings;
  manifest: PluginManifest | null;
  recipeName: PluginLabel | null | undefined;
  failed: boolean;
}

/** The plugins switched on for render jobs in `s`, in the order the settings keep them. */
export function jobPlugins(ctx: Ctx, s: RenderSettings): JobPlugin[] {
  if (!ctx.services.plugins) return [];
  const installed = ctx.ui.get().plugins?.installed ?? [];
  return Object.entries(s.plugins ?? {})
    .filter(([, e]) => e.jobs === true)
    .map(([id, entry]) => {
      const m = installed.find((p) => p.id === id)?.manifest ?? null;
      return { id, entry, manifest: m && m.slots.includes('render.plugins') ? m : null, recipeName: undefined, failed: false };
    });
}

/**
 * One image of a job through the plugins switched on for jobs (decision 9): frame `frame` of the animation (0 for a
 * still) with its seed, saved next to the engine's; the job's first image (`first`, the result just kept) is also
 * kept in the history with its provenance. Returns the names it saved. A failure is said once per plugin and job.
 */
async function pluginsStep(ctx: Ctx, s: RenderSettings, plugins: JobPlugin[], out: FrameResult, name: string, frame: number, first: ResultMeta | null, signal: AbortSignal): Promise<string[]> {
  const port = ctx.services.plugins;
  const saved: string[] = [];
  if (!port) return saved;
  for (const p of plugins) {
    if (p.failed) continue;
    const label = p.manifest ? p.manifest.name : { en: p.id, es: p.id };
    const skip = (reason: string) => {
      p.failed = true;
      ctx.ui.toast(t('render.pluginSkipped', { plugin: lbl(label), name, reason }));
    };
    if (!p.manifest) {
      skip(t('render.pluginMissing'));
      continue;
    }
    try {
      const seed0 = controlsFor(p.manifest, p.entry.controls);
      const controls = frameControls(p.manifest, seed0, frame);
      const run = await port.runImage({ plugin: p.id, file: out.file, display: out.display, recipe: p.entry.recipe, controls }, signal);
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (first) {
        if (p.recipeName === undefined) p.recipeName = p.entry.recipe ? ((await port.presets(p.id).catch(() => null))?.presets.find((x) => x.id === p.entry.recipe)?.name ?? null) : null;
        const kept = await recordPluginResult(ctx, { source: first, run, manifest: p.manifest, recipe: p.entry.recipe, recipeName: p.recipeName, controls, seed: seedProvenance(p.manifest, seed0, frame) });
        saved.push(kept.name);
      } else {
        const file = await pluginImageFile(ctx, run, name, s.format, s.dpi, p.id);
        await ctx.services.files.save(s.destination, file.name, file.blob);
        saved.push(file.name);
      }
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) throw err;
      skip(err instanceof Error ? err.message : String(err));
    }
  }
  return saved;
}

/** The page is in a background tab (no live picture is wanted there). */
const pageHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * U14: what a job's frame requests ask the live view with (`FrameRequest.frameBox`, `onFrame`): a box while the live
 * view shows job `jobId` and a picture is due by the cadence, null otherwise; the pictures go to `ui.liveFrame`, unless
 * the view moved on while one was being made.
 */
export function liveTap(ctx: Ctx, jobId: string, now: () => number = Date.now): Required<Pick<FrameRequest, 'frameBox' | 'onFrame'>> {
  const cadence = new FrameCadence(now);
  let watched = false;
  return {
    frameBox: () => {
      const v = ctx.ui.get().liveView;
      const on = v !== null && v.jobId === jobId && !pageHidden();
      // Opened again (or on this job again): its picture at once.
      if (on && !watched) cadence.reset();
      watched = on;
      if (!on || !cadence.due()) return null;
      cadence.mark();
      return liveBox(v.box);
    },
    onFrame: (frame) => {
      if (ctx.ui.get().liveView?.jobId !== jobId) return;
      ctx.ui.set({ liveFrame: { jobId, frame } });
    },
  };
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
  // AI post-processing: single images only (animations arrive later), after the engine's image is safe.
  const withAi = s.ai.enabled && !anim && !!ctx.services.ai;
  // Plugins switched on for render jobs (decision 9): every image, a frame's seed its own.
  const plugins = jobPlugins(ctx, s);
  const renderSource = async () => {
    try {
      return (await ctx.services.ai?.renderSource()) ?? false;
    } catch {
      return false;
    }
  };
  // U14: the live view's pictures of this job (the results viewer in progress): only while it shows this job and
  // the page is visible, at most every LIVE_FRAME_MS (the first one at once, also when the view opens again). While
  // it asks for none the engine makes none (FrameRequest.frameBox).
  const live = liveTap(ctx, job.id, now);
  if (ctx.ui.get().liveFrame?.jobId === job.id) ctx.ui.set({ liveFrame: null });
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
      frameBox: live.frameBox,
      onFrame: live.onFrame,
      ...(cam ? { camera: cam } : {}),
      ...(f.time !== undefined ? { time: f.time } : {}),
      // The AI step works from the render the launcher keeps with its passes (desktop).
      ...(withAi && k === 0 && (await renderSource()) ? { aiPasses: true } : {}),
    };
    const out = await ctx.services.renderFrame(req);
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const where = await ctx.services.files.save(s.destination, names[k], out.file);
    saved.push(names[k]);
    // E5b-1: the image before denoise, next to it (`<name>-noisy`).
    if (out.noisyFile) {
      const noisy = noisyName(names[k]);
      await ctx.services.files.save(s.destination, noisy, out.noisyFile);
      saved.push(noisy);
    }
    // A measured throughput for the window's estimate (the whole render, upload and conversion included).
    if (out.seconds > 0 && out.samples > 0) ctx.ui.set({ throughput: (out.samples * out.width * out.height) / out.seconds });
    // The history keeps the image of a job (the first frame of an animation).
    let first: ResultMeta | null = null;
    if (k === 0) {
      // The pipeline's progress, tile by tile (and variant by variant, X4b), in place of the render's (the render is done).
      let lastAi = '';
      const aiTick = (p: AiStepProgress) => {
        const t = now();
        const key = `${p.variant}|${p.stage}|${p.tile}|${p.attempt}|${p.reason ?? ''}`;
        if (key === lastAi && t - lastTick < 200) return;
        lastAi = key;
        lastTick = t;
        const where = { stage: p.stage, tile: p.tile, tiles: p.tiles, attempt: p.attempt, ...(p.maxAttempts ? { maxAttempts: p.maxAttempts } : {}), ...(p.reason ? { reason: p.reason } : {}), ...(p.variants > 1 ? { variant: p.variant, variants: p.variants } : {}) };
        ctx.store.dispatch({ type: 'render/running', running: { jobId: job.id, progress: Math.min(1, p.fraction), samples: out.samples, seconds: out.seconds, ai: where } });
        patchJob(ctx, job.id, { progress: Math.min(1, p.fraction) });
      };
      // Stopped or paused during the AI step: the engine's image is kept in the history all the same, with the
      // variants already finished (X4b).
      let interrupted: unknown = null;
      const variants: AiVariantDone[] = [];
      // The AI's own throughput on this computer (pixels a second, measured around each request), for the window's estimate.
      const measure = (seconds: number) => seconds > 0 && ctx.ui.set({ aiThroughput: (out.width * out.height) / seconds });
      if (withAi) {
        try {
          await aiStep(ctx, s, out, cam, names[k], signal, aiTick, variants, measure);
        } catch (err) {
          interrupted = err;
        }
      }
      const [firstVariant, ...more] = variants;
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
        bytes: out.file.size + (out.display?.size ?? 0) + variants.reduce((n, v) => n + (v.blob?.size ?? 0), 0),
        ...(anim ? { frame: frames[0].n ?? 1, frames: total } : {}),
        ...(firstVariant ? { ai: firstVariant.info } : {}),
        ...(more.length > 0 ? { aiMore: more.map((v) => v.info) } : {}),
      };
      await recordResult(ctx, meta, out, firstVariant?.blob ?? null, more.map((v) => v.blob));
      first = meta;
      resultIds.push(meta.id);
      patchJob(ctx, job.id, { resultIds: [...resultIds] });
      if (interrupted) {
        const kept = variants.filter((v) => v.blob).length;
        ctx.ui.toast(kept > 0 ? t('render.aiStoppedVariants', { n: kept }) : t('render.aiStopped'));
        throw interrupted;
      }
    }
    // The frame's index in the animation (its number less one): a range rendered in parts draws the same grain.
    if (plugins.length > 0) saved.push(...(await pluginsStep(ctx, s, plugins, out, names[k], anim ? Math.max(0, (f.n ?? 1) - 1) : 0, first, signal)));
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

const running = (r: Runner) => r.mode === 'ALL' || r.mode === 'ONLY';

async function loop(ctx: Ctx, r: Runner): Promise<void> {
  watchQueue(ctx, r);
  try {
    for (;;) {
      // Paused (or never started): the loop ends here; resumed meanwhile, it goes on.
      if (!running(r)) break;
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
        // Its result opens in the viewer when the job says so, or when the live view was watching it (U14: the view
        // in progress becomes the result's).
        const watched = ctx.ui.get().liveView?.jobId === job.id;
        if ((job.settings.showWhenDone || watched) && out.resultIds[0]) ctx.ui.set({ resultView: { id: out.resultIds[0], compare: null, split: 'SPLIT', position: 0.5 }, liveView: null, liveFrame: null });
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
    }
  } finally {
    r.loop = null;
    r.unsubscribe?.();
    r.unsubscribe = null;
    // A Start or Resume that came while the loop was ending is not lost.
    if (running(r) && nextJob(ctx, r)) ensureLoop(ctx, r);
    else if (r.mode !== 'PAUSED') {
      r.only.clear();
      setMode(ctx, r, 'IDLE');
    }
  }
}

function ensureLoop(ctx: Ctx, r: Runner): void {
  if (!r.loop) r.loop = loop(ctx, r);
}

/** Start queue: every waiting job, in order. After a Pause (Resume): what was paused goes on. */
export function startQueue(ctx: Ctx): void {
  const r = runnerOf(ctx);
  const resume = r.mode === 'PAUSED' ? r.resume : null;
  r.resume = null;
  const queued = new Set(ctx.store.get().render.queue.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').map((j) => j.id));
  const only = resume?.mode === 'ONLY' ? resume.only.filter((id) => queued.has(id)) : [];
  if (only.length > 0) {
    r.only = new Set(only);
    setMode(ctx, r, 'ONLY');
  } else setMode(ctx, r, 'ALL');
  ensureLoop(ctx, r);
}

/**
 * Render: these jobs (just put first) start now. With the queue already running they are next
 * (the job in progress is not thrown away); with only Render's jobs running, they join them.
 */
export function runOnly(ctx: Ctx, ids: readonly string[]): 'NOW' | 'NEXT' {
  const r = runnerOf(ctx);
  // A job still winding down after a Pause does not count: Render starts now.
  const busy = r.current !== null && running(r);
  if (r.mode !== 'ALL') {
    // Render after a Pause renders just its job; what was paused stays waiting.
    if (r.mode !== 'ONLY') r.only.clear();
    r.resume = null;
    for (const id of ids) r.only.add(id);
    setMode(ctx, r, 'ONLY');
  }
  ensureLoop(ctx, r);
  return busy ? 'NEXT' : 'NOW';
}

/** Pause: stops now (the engine is free at once); the job in progress waits again and Resume goes on from there. */
export function pauseQueue(ctx: Ctx): void {
  const r = runnerOf(ctx);
  if (!running(r)) return;
  r.resume = { mode: r.mode === 'ONLY' ? 'ONLY' : 'ALL', only: [...r.only] };
  setMode(ctx, r, 'PAUSED');
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

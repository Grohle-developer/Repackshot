// Render settings, the render job and the queue (SPEC §3.8, UI.md §2.7).
//
// `state.render` holds the settings of the render window (they are the
// project's: undoable, saved, remembered) next to the queue. A job copies the
// settings it was made with; "All cameras" becomes one job per camera when it
// enters the queue. Queue edits (add, edit, duplicate, reorder, remove) are
// project state and undoable; what changes while a job runs (status,
// progress, timestamps, results) is not: those actions are volatile and an
// undo carries them over (`carryRuntime`), so progress never floods the
// history and undo never resurrects a stale "running" job.

import { QUALITY_PRESETS, RESOLUTION_PRESETS } from '../data/quality';
import type { QualityKey, ResolutionKey } from '../data/types';
import { AI_STYLES, DEFAULT_AI_PIPELINE, MAX_VARIANTS, type AiPipelineSettings, type AiPostStage, type AiStyle } from './ai';
import { normaliseUserPrompt } from './ai-prompt';
import type { ActionBase, ProjectState } from './store';
import { activeCamera, aspectRatio, type CameraId } from './camera';
import { customFromPixels, type CameraAspect } from './aspect';
import { ASPECT_PRESETS } from '../data/aspects';
import { CAUSTICS_MODES, CAUSTICS_QUALITIES, DENOISE_MODES, denoiseBits, type CausticsMode, type CausticsQuality, type DenoiseMode } from './caustics';
import { nextId } from './ids';
import { DEFAULT_NAME_TEMPLATE } from './name-template';
import { normalisePlugins, NO_PLUGINS, type PluginsSettings } from './plugins';
import { clampDpi, DEFAULT_DPI, lockedSide, PRINT_UNITS, type PrintUnit } from './print-size';

export type RenderQuality = QualityKey | 'CUSTOM';
export type RenderMode = 'IMAGE' | 'ANIMATION';
export type OutputFormat = 'PNG' | 'JPEG' | 'EXR' | 'TIFF' | 'DNG';
/** Bits per channel: 8 and 16 are sRGB (PNG, TIFF); 32 is the float TIFF in linear light. */
export type BitDepth = 8 | 16 | 32;
/** When a render ends: at a number of samples, at a time, or whichever comes first (Advanced). */
export type FinishBy = 'SAMPLES' | 'TIME' | 'FIRST';
/** Where an output goes: the browser's downloads, or a folder chosen with the File System Access API. */
export type Destination = { kind: 'DOWNLOADS' } | { kind: 'FOLDER'; id: string; name: string };
/** The camera of the render window: the active one, one by id, or every camera (one job each). */
export type CameraChoice = { kind: 'ACTIVE' } | { kind: 'ALL' } | { kind: 'ONE'; id: CameraId };
export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';

/** Engine settings under Advanced; they map to RNDR fields the engine reads (io/rsb.ts). */
export interface AdvancedSettings {
  /** Most surface interactions per path (`RNDR.max_depth`); null: the quality tier's, or the engine's 8. */
  maxBounces: number | null;
  /** Cap on every channel of indirect light (`RNDR.clamp_indirect`); 0 is off. */
  clampIndirect: number;
  /** `RNDR.seed`: another seed, another noise pattern. */
  seed: number;
  /** E5b-1, Advanced ▸ Denoise: where the engine's denoiser runs (`RNDR.denoise`; default both). */
  denoise: DenoiseMode;
  /**
   * U11b, Advanced ▸ Denoise ▸ Strength, 0–100 % (default 100): the image handed out is noisy × (1 − s) + denoised × s,
   * per channel in linear light, in the engine (`RNDR.denoise_strength`); for the render and the Full viewport alike.
   * 0 % runs no filter (the noisy image itself).
   */
  denoiseStrength: number;
  /** E5b-1, Advanced ▸ Also save without denoise: a render also writes the image before denoise (`<name>-noisy`). */
  saveNoisy: boolean;
  /** E5b-1, the render window's Caustics switch (Quality section): Automatic · On · Off. */
  caustics: CausticsMode;
  /** E5b-1, Advanced ▸ Caustic quality: photons per sample and first radius (core/caustics.ts). */
  causticsQuality: CausticsQuality;
}

/**
 * What the engine is told of the denoise and the caustics for a view (io/rsb.ts `SceneView.denoise` and
 * `.caustics`): the viewport (Full mode) or a Render. The viewport never keeps the noisy image.
 */
export function engineFieldsOf(a: AdvancedSettings, where: 'VIEWPORT' | 'RENDER'): { denoise: number; denoiseStrength: number; caustics: { mode: CausticsMode; quality: CausticsQuality } } {
  return { denoise: denoiseBits(a.denoise, where, a.saveNoisy), denoiseStrength: denoiseFraction(a.denoiseStrength), caustics: { mode: a.caustics, quality: a.causticsQuality } };
}

/** U11b: the strength of Advanced ▸ Denoise (percent) as the engine takes it, a fraction 0..1 (`RNDR.denoise_strength`). */
export function denoiseFraction(percent: number): number {
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) / 100 : 1;
}

/**
 * U11: whether two Advanced settings give the Full viewport another image. The denoise does not: the viewport's part
 * is its live switch (the engines turn it without starting the image over) and the rest is the Render's, as is
 * Also save without denoise.
 */
export function advancedTouchesView(a: AdvancedSettings, b: AdvancedSettings): boolean {
  if (a === b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof AdvancedSettings)[]);
  for (const k of keys) if (k !== 'denoise' && k !== 'saveNoisy' && a[k] !== b[k]) return true;
  return false;
}

/** The Advanced settings of a new project (and what an older project lacks). */
export const DEFAULT_ADVANCED: Readonly<AdvancedSettings> = Object.freeze({
  maxBounces: null,
  clampIndirect: 0,
  seed: 0,
  denoise: 'BOTH',
  denoiseStrength: 100,
  saveNoisy: false,
  caustics: 'AUTO',
  causticsQuality: 'MEDIUM',
});

export type VideoCodec = 'MP4' | 'WEBM';

/** Animation output (UI.md §2.7 "2 bis"): range, fps, video or frames. */
export interface AnimationOutput {
  range: 'ALL' | 'RANGE';
  /** How the range is shown and typed; it is always stored in frames. */
  rangeUnit: 'FRAMES' | 'SECONDS';
  /** First and last frame, 1-based and inclusive (frame 1 is t = 0). */
  from: number;
  to: number;
  fps: number;
  /** Video is written by N1; until then only frames. */
  output: 'VIDEO' | 'FRAMES';
  video: VideoCodec;
}

/**
 * AI post-processing (AI-POST.md §4, §7.5): the switch, whether the preview starts from the full engine
 * instead of Fast mode, and the pipeline's controls and seed (core/ai.ts), with the job's own prompt and its
 * number of variants (X4b: always present here). Each job copies it.
 */
export type AiSettings = { enabled: boolean; previewFullEngine: boolean } & Required<AiPipelineSettings>;

/** The AI settings of a new project: off, the preview from Fast mode, the configurator's defaults. */
export const DEFAULT_AI: Readonly<AiSettings> = Object.freeze({ enabled: false, previewFullEngine: false, ...DEFAULT_AI_PIPELINE });

/** The numeric controls of the configurator (0..100 each), in the order the window lists them. */
export const AI_PERCENT_KEYS = ['intervention', 'light', 'bounce', 'wear', 'styleStrength'] as const;
export type AiPercentKey = (typeof AI_PERCENT_KEYS)[number];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * AI settings from anything that looks like them: an old project's `{ enabled: false }` (the rest takes
 * `base`'s values), a hand-edited file. Controls become integers 0..100, an unknown style becomes
 * NATURAL, the seed an unsigned 32-bit integer, the job's own prompt a trimmed string of at most
 * MAX_USER_PROMPT characters and the variants an integer 1..MAX_VARIANTS (X4b; a project of before has
 * neither: no prompt, one variant). Pure, idempotent, and it returns `base` itself when nothing differs
 * (so watchers comparing by reference do not wake for an unrelated edit).
 */
export function normaliseAi(raw: unknown, base: AiSettings = DEFAULT_AI): AiSettings {
  if (!isRecord(raw)) return base;
  const pct = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fallback);
  const style: AiStyle = raw.style === undefined ? base.style : (AI_STYLES as readonly unknown[]).includes(raw.style) ? (raw.style as AiStyle) : 'NATURAL';
  const seed = typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? Math.max(0, Math.min(0xffffffff, Math.round(raw.seed))) : base.seed;
  const next: AiSettings = {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    previewFullEngine: typeof raw.previewFullEngine === 'boolean' ? raw.previewFullEngine : base.previewFullEngine,
    intervention: pct(raw.intervention, base.intervention),
    light: pct(raw.light, base.light),
    bounce: pct(raw.bounce, base.bounce),
    wear: pct(raw.wear, base.wear),
    style,
    styleStrength: pct(raw.styleStrength, base.styleStrength),
    seed,
    userPrompt: raw.userPrompt === undefined ? base.userPrompt : normaliseUserPrompt(raw.userPrompt),
    variants: typeof raw.variants === 'number' && Number.isFinite(raw.variants) ? Math.max(1, Math.min(MAX_VARIANTS, Math.round(raw.variants))) : base.variants,
  };
  return (Object.keys(next) as (keyof AiSettings)[]).every((k) => next[k] === base[k]) ? base : next;
}

/** Everything the render window sets (SPEC §3.8). */
export interface RenderSettings {
  mode: RenderMode;
  /** Name template with tokens (core/name-template.ts). */
  name: string;
  destination: Destination;
  /** Open the result in the results viewer when the job ends. */
  showWhenDone: boolean;
  format: OutputFormat;
  /** PNG: 8 or 16 bits per channel; TIFF: 8, 16 or 32 (float, linear). Any other format keeps 8 (EXR and DNG are 32-bit float always). */
  bitDepth: BitDepth;
  /** JPEG quality, 1..100. */
  jpegQuality: number;
  transparent: boolean;
  camera: CameraChoice;
  /**
   * The size in pixels. An image keeps the width and takes its height from the active camera's aspect ratio
   * (U13: `syncOutputSize`, and `reduceRender` for a size typed in the window); an animation has the size of its
   * own, as the window shows it.
   */
  width: number;
  height: number;
  /** With the lock, typing one side keeps the ratio (an image: the camera's); without it a typed size becomes the camera's ratio. */
  aspectLock: boolean;
  /**
   * width / height the size follows: an image's is always the active camera's ratio (`aspectRatio`); an
   * animation's is its own, the one its lock keeps. Jobs and the draft of an edited job keep their own.
   */
  aspect: number;
  /** Written into the file (PNG pHYs, JPEG JFIF). */
  dpi: number;
  printUnit: PrintUnit;
  finishBy: FinishBy;
  /** The tier the samples came from (Draft · Preview · Final), or CUSTOM; the tier also gives the bounces. */
  quality: RenderQuality;
  maxSamples: number;
  maxSeconds: number;
  advanced: AdvancedSettings;
  animation: AnimationOutput;
  ai: AiSettings;
  /**
   * P6, Render window ▸ Plugins: each plugin's recipe and controls, by plugin id (core/plugins.ts). Undoable and saved
   * with the project; a project of before has none (`{}`), and an entry of a plugin that is not installed is kept as
   * it is. The values are checked against the plugin's manifest where it runs (`controlsFor`).
   */
  plugins: PluginsSettings;
}

/** One job of the render queue: the settings it was made with, and how it is going. */
export interface RenderJob {
  id: string;
  /** Its render number (`{n}` in the name of an image). */
  seq: number;
  /** Camera: always ONE for an image job; for an animation the timeline's camera track decides. */
  settings: RenderSettings;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  /** Milliseconds since the epoch. */
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Results this job wrote to the history (the results store), oldest first. */
  resultIds: string[];
  error: string | null;
  /** Animation: frames written so far and in total. */
  frame: number;
  frames: number;
}

/** What changes while a job runs: volatile, never in the undo history. */
export type JobRuntime = Pick<RenderJob, 'status' | 'progress' | 'startedAt' | 'finishedAt' | 'resultIds' | 'error' | 'frame' | 'frames'>;
const RUNTIME_KEYS: readonly (keyof JobRuntime)[] = ['status', 'progress', 'startedAt', 'finishedAt', 'resultIds', 'error', 'frame', 'frames'];

/** Progress of the job in flight, as reported by the engine. */
export interface RenderProgress {
  /** Queue job being rendered. */
  jobId: string | null;
  /** 0..1 */
  progress: number;
  samples: number;
  seconds: number;
  /** Animation: the frame being rendered (1-based) and the frames in the job. */
  frame?: number;
  frames?: number;
  /**
   * The AI post-processing of the job's image is running (X3c): `progress` is then the pipeline's own, and this
   * says where it is (the tile and the attempt, 1-based; X4b: the variant, 1-based, of how many).
   */
  ai?: { stage: AiPostStage; tile: number; tiles: number; attempt: number; variant?: number; variants?: number };
}

/** `state.render`: the window's settings, the queue, the job in flight and the last render number. */
export interface RenderState extends RenderSettings {
  queue: RenderJob[];
  running: RenderProgress | null;
  /** The last render number given to a job. */
  seq: number;
}

/** Formats this version writes. */
export const WRITABLE_FORMATS: ReadonlySet<OutputFormat> = new Set<OutputFormat>(['PNG', 'JPEG', 'EXR', 'TIFF', 'DNG']);
/** Frame rates offered for animation output. */
export const FPS_CHOICES: readonly number[] = [24, 25, 30, 60];
/** Encoded video arrives with N1; until then the output is a frame sequence. */
export const VIDEO_AVAILABLE = false;
/** Formats that carry an alpha channel (a DNG is a raw: it has none). */
export function supportsAlpha(format: OutputFormat): boolean {
  return format === 'PNG' || format === 'EXR' || format === 'TIFF';
}

/** File extension of a format. */
export function formatExtension(format: OutputFormat): string {
  switch (format) {
    case 'JPEG':
      return 'jpg';
    case 'EXR':
      return 'exr';
    case 'TIFF':
      return 'tif';
    case 'DNG':
      return 'dng';
    default:
      return 'png';
  }
}

/** The bit depths a format offers: PNG 8 or 16, TIFF 8, 16 or 32 (float); the others have no choice. */
export function bitDepthsOf(format: OutputFormat): readonly BitDepth[] {
  return format === 'PNG' ? [8, 16] : format === 'TIFF' ? [8, 16, 32] : [8];
}

/** Whether the file is written from the engine's linear float sums (not from its 8-bit pixels): 16-bit PNG and TIFF, 32-bit TIFF, EXR and DNG. */
export function needsLinearSums(format: OutputFormat, bitDepth: BitDepth): boolean {
  return format === 'EXR' || format === 'DNG' || (format === 'PNG' && bitDepth === 16) || (format === 'TIFF' && bitDepth !== 8);
}

/**
 * Whether a browser cannot show the file (EXR, TIFF, DNG): the render keeps an 8-bit PNG of the same image
 * beside it for the results viewer and the thumbnails.
 */
export function needsDisplayCopy(format: OutputFormat): boolean {
  return format === 'EXR' || format === 'TIFF' || format === 'DNG';
}

/** The RESOLUTION_PRESETS key for a size, or 'CUSTOM'. */
export function matchResolution(width: number, height: number): ResolutionKey | 'CUSTOM' {
  return RESOLUTION_PRESETS.find((r) => r.width === width && r.height === height)?.key ?? 'CUSTOM';
}

/** Largest side the engine renders in one go. */
export const MAX_OUTPUT_SIDE = 8192;
export const MIN_OUTPUT_SIDE = 16;
export const MAX_BOUNCES = 64;
/** The engine's bounces when nothing sets them (`RNDR.max_depth` 0 means this; io/rsb.ts DEFAULT_MAX_DEPTH). */
export const ENGINE_DEFAULT_BOUNCES = 8;

/** The bounces a render of these settings uses: Advanced's, or the quality tier's, or the engine's. */
export function effectiveBounces(s: Pick<RenderSettings, 'advanced' | 'quality'>): number {
  if (s.advanced.maxBounces !== null) return s.advanced.maxBounces;
  return s.quality === 'CUSTOM' ? ENGINE_DEFAULT_BOUNCES : QUALITY_PRESETS[s.quality].bounces;
}
export const MAX_SAMPLES = 100000;
export const MAX_SECONDS = 7 * 24 * 3600;

export function defaultRenderSettings(): RenderSettings {
  return {
    mode: 'IMAGE',
    name: DEFAULT_NAME_TEMPLATE,
    destination: { kind: 'DOWNLOADS' },
    showWhenDone: true,
    format: 'PNG',
    bitDepth: 8,
    jpegQuality: 92,
    transparent: false,
    camera: { kind: 'ACTIVE' },
    width: 1920,
    height: 1080,
    aspectLock: true,
    aspect: 1920 / 1080,
    dpi: DEFAULT_DPI,
    printUnit: 'MM',
    finishBy: 'SAMPLES',
    quality: 'PREVIEW',
    maxSamples: QUALITY_PRESETS.PREVIEW.samples,
    maxSeconds: 120,
    advanced: { ...DEFAULT_ADVANCED },
    animation: { range: 'ALL', rangeUnit: 'FRAMES', from: 1, to: 1, fps: 24, output: 'FRAMES', video: 'MP4' },
    ai: DEFAULT_AI,
    plugins: NO_PLUGINS,
  };
}

export function defaultRenderState(): RenderState {
  return { ...defaultRenderSettings(), queue: [], running: null, seq: 0 };
}

/** Just the settings of a render state (or of anything that has them). */
export function settingsOf(r: RenderSettings): RenderSettings {
  return {
    mode: r.mode,
    name: r.name,
    destination: r.destination,
    showWhenDone: r.showWhenDone,
    format: r.format,
    bitDepth: r.bitDepth,
    jpegQuality: r.jpegQuality,
    transparent: r.transparent,
    camera: r.camera,
    width: r.width,
    height: r.height,
    aspectLock: r.aspectLock,
    aspect: r.aspect,
    dpi: r.dpi,
    printUnit: r.printUnit,
    finishBy: r.finishBy,
    quality: r.quality,
    maxSamples: r.maxSamples,
    maxSeconds: r.maxSeconds,
    advanced: r.advanced,
    animation: r.animation,
    ai: r.ai,
    plugins: r.plugins ?? NO_PLUGINS,
  };
}

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));
const clampSize = (v: number): number => clampInt(v, MIN_OUTPUT_SIDE, MAX_OUTPUT_SIDE);

/**
 * The size of an image of `ratio` (width / height) at this width: the width is kept (within the engine's limits)
 * and the height is `round(width / ratio)`, within the limits too. At the extremes (a 3:700 ratio at 1000 pixels
 * wide) the height stops at the limit and the pair no longer has the ratio, but the width is not lost: the ratio
 * that comes next gives the height back.
 */
export function sizeForWidth(width: number, ratio: number): { width: number; height: number } {
  const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 16 / 9;
  const w = clampSize(width);
  return { width: w, height: clampSize(w / r) };
}

/** The size of an image of `ratio` at this height (the lock closed with the height typed): see `sizeForWidth`. */
export function sizeForHeight(height: number, ratio: number): { width: number; height: number } {
  const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 16 / 9;
  const h = clampSize(height);
  return { width: clampSize(h * r), height: h };
}

/** Whether a size has this ratio to the pixel: the height is the one `sizeForWidth` gives, before the limits. */
function followsRatio(width: number, height: number, ratio: number): boolean {
  return Math.round(width / ratio) === height;
}

/**
 * The aspect ratio a size in pixels is, to the letter: the preset whose ratio gives exactly this height at this
 * width (so the size survives `syncOutputSize` as typed), else a custom ratio with the pixels as its terms.
 */
export function aspectForSize(width: number, height: number): CameraAspect {
  const w = clampSize(width);
  const h = clampSize(height);
  for (const p of ASPECT_PRESETS) if (followsRatio(w, h, p.w / p.h)) return { preset: p.key, w: p.w, h: p.h };
  return customFromPixels(w, h);
}

/**
 * Applies a patch of settings with every rule of the window: sizes clamped, the aspect lock (one
 * side typed: the other follows the locked ratio; both given, as a preset does: that becomes the
 * ratio), formats without alpha switch transparency off, 16 bits only in PNG, the samples away
 * from the tier make the quality custom, video stays off until it exists, the AI controls stay 0..100. Pure.
 */
export function patchSettings(s: RenderSettings, patch: Partial<RenderSettings>): RenderSettings {
  const p: Partial<RenderSettings> = { ...patch };
  const next: RenderSettings = { ...s, ...p };
  // Size and aspect.
  const hasW = p.width !== undefined;
  const hasH = p.height !== undefined;
  if (hasW) next.width = clampSize(p.width!);
  if (hasH) next.height = clampSize(p.height!);
  if (hasW && hasH) next.aspect = next.width / next.height;
  else if (hasW || hasH) {
    if (next.aspectLock) {
      if (hasW) next.height = clampSize(lockedSide('width', next.width, s.aspect));
      else next.width = clampSize(lockedSide('height', next.height, s.aspect));
    } else next.aspect = next.width / next.height;
  }
  if (p.aspectLock === true && !s.aspectLock) next.aspect = next.width / next.height;
  if (!(next.aspect > 0) || !Number.isFinite(next.aspect)) next.aspect = next.width / next.height;
  if (p.dpi !== undefined) next.dpi = clampDpi(p.dpi);
  if (p.printUnit !== undefined && !PRINT_UNITS.includes(p.printUnit)) next.printUnit = s.printUnit;
  // Budget.
  if (p.maxSamples !== undefined) {
    next.maxSamples = clampInt(p.maxSamples, 1, MAX_SAMPLES);
    // Touching the samples away from the tier makes the quality custom.
    if (p.quality === undefined && s.quality !== 'CUSTOM' && QUALITY_PRESETS[s.quality].samples !== next.maxSamples) next.quality = 'CUSTOM';
  }
  if (p.maxSeconds !== undefined) next.maxSeconds = clampInt(p.maxSeconds, 1, MAX_SECONDS);
  if (p.finishBy !== undefined && !['SAMPLES', 'TIME', 'FIRST'].includes(p.finishBy)) next.finishBy = s.finishBy;
  // Format.
  if (!WRITABLE_FORMATS.has(next.format)) next.format = 'PNG';
  if (!supportsAlpha(next.format)) next.transparent = false;
  if (!bitDepthsOf(next.format).includes(next.bitDepth)) next.bitDepth = 8;
  if (p.jpegQuality !== undefined) next.jpegQuality = clampInt(p.jpegQuality, 1, 100);
  // Engine.
  if (p.advanced !== undefined) {
    const a = { ...s.advanced, ...p.advanced };
    next.advanced = {
      maxBounces: a.maxBounces === null || a.maxBounces === undefined ? null : clampInt(a.maxBounces, 1, MAX_BOUNCES),
      clampIndirect: Math.max(0, Number.isFinite(a.clampIndirect) ? a.clampIndirect : 0),
      seed: clampInt(a.seed, 0, 0xffffffff),
      denoise: DENOISE_MODES.includes(a.denoise) ? a.denoise : DEFAULT_ADVANCED.denoise,
      denoiseStrength: typeof a.denoiseStrength === 'number' && Number.isFinite(a.denoiseStrength) ? clampInt(a.denoiseStrength, 0, 100) : DEFAULT_ADVANCED.denoiseStrength,
      saveNoisy: a.saveNoisy === true,
      caustics: CAUSTICS_MODES.includes(a.caustics) ? a.caustics : DEFAULT_ADVANCED.caustics,
      causticsQuality: CAUSTICS_QUALITIES.includes(a.causticsQuality) ? a.causticsQuality : DEFAULT_ADVANCED.causticsQuality,
    };
  }
  // Animation.
  if (p.animation !== undefined) {
    const a = { ...s.animation, ...p.animation };
    const fps = clampInt(a.fps, 1, 120);
    // A new frame rate keeps the range where it was in time.
    const keepsRange = (p.animation.from === undefined || p.animation.from === s.animation.from) && (p.animation.to === undefined || p.animation.to === s.animation.to);
    const k = fps !== s.animation.fps && keepsRange ? fps / s.animation.fps : 1;
    const from = clampInt(k === 1 ? a.from : (a.from - 1) * k + 1, 1, 1_000_000);
    const to = Math.max(from, clampInt(k === 1 ? a.to : (a.to - 1) * k + 1, 1, 1_000_000));
    next.animation = {
      range: a.range === 'RANGE' ? 'RANGE' : 'ALL',
      rangeUnit: a.rangeUnit === 'SECONDS' ? 'SECONDS' : 'FRAMES',
      from,
      to,
      fps,
      output: VIDEO_AVAILABLE && a.output === 'VIDEO' ? 'VIDEO' : 'FRAMES',
      video: a.video === 'WEBM' ? 'WEBM' : 'MP4',
    };
  }
  // AI post-processing: merged into the current settings, then every control clamped (a slider drag is many patches).
  next.ai = normaliseAi(p.ai !== undefined ? { ...s.ai, ...p.ai } : s.ai, s.ai);
  // Plugins: the shape checked, the entries that did not change kept as they were (watchers compare by reference).
  next.plugins = p.plugins !== undefined ? normalisePlugins(p.plugins, s.plugins ?? NO_PLUGINS) : (s.plugins ?? NO_PLUGINS);
  if (next.mode !== 'ANIMATION') next.mode = 'IMAGE';
  return next;
}

// ------------------------------------------------------------------ jobs

/** The settings a job keeps: the camera resolved (an animation follows the camera track). */
function jobSettings(s: RenderSettings, camera: CameraId | null): RenderSettings {
  return { ...s, camera: camera ? { kind: 'ONE', id: camera } : { kind: 'ACTIVE' } };
}

/** The camera a job renders through (null: the camera track of the timeline). */
export function jobCamera(job: RenderJob, state: ProjectState): CameraId | null {
  if (job.settings.mode === 'ANIMATION') return null;
  const c = job.settings.camera;
  if (c.kind === 'ONE' && state.camera.cameras[c.id]) return c.id;
  return state.camera.active;
}

/** The cameras a choice stands for, in the order of the project. */
export function camerasOf(state: ProjectState, choice: CameraChoice): CameraId[] {
  if (choice.kind === 'ALL') return Object.keys(state.camera.cameras);
  if (choice.kind === 'ONE' && state.camera.cameras[choice.id]) return [choice.id];
  return [state.camera.active];
}

function freshRuntime(): JobRuntime {
  return { status: 'QUEUED', progress: 0, startedAt: null, finishedAt: null, resultIds: [], error: null, frame: 0, frames: 0 };
}

/**
 * The settings of an image job for a camera (U13): the window's size is the active camera's, so a camera with
 * another aspect ratio (One camera, or each of All cameras) renders at the same width and its own height. A camera
 * with the window's ratio, an animation, or no camera: the settings as they are.
 */
function sizedFor(state: ProjectState, s: RenderSettings, camera: CameraId | null): RenderSettings {
  const cam = camera ? state.camera.cameras[camera] : undefined;
  const active = activeCamera(state);
  if (s.mode === 'ANIMATION' || !cam || !active) return s;
  const ratio = aspectRatio(cam);
  if (ratio === aspectRatio(active)) return s;
  return { ...s, ...sizeForWidth(s.width, ratio), aspect: ratio };
}

/**
 * The jobs a set of settings becomes: one per camera for "All cameras", one for an animation
 * (whatever the camera says: the camera track decides). Ids and render numbers continue the queue's.
 */
export function expandJobs(state: ProjectState, settings: RenderSettings, at: number): RenderJob[] {
  const r = state.render;
  const s = patchSettings(settings, {});
  const cams = s.mode === 'ANIMATION' ? [null] : camerasOf(state, s.camera);
  const taken = r.queue.map((j) => j.id);
  return cams.map((cam, k) => {
    const id = nextId('j', taken);
    taken.push(id);
    return { id, seq: r.seq + k + 1, settings: jobSettings(sizedFor(state, s, cam), cam), createdAt: at, ...freshRuntime() };
  });
}

export type RenderAction =
  | ({ type: 'render/quality'; quality: QualityKey } & ActionBase)
  | ({ type: 'render/set'; patch: Partial<RenderSettings> } & ActionBase)
  /** Adds the jobs of `settings` (default: the window's) first or last. `at`: now, in ms. */
  | ({ type: 'render/enqueue'; at: number; position: 'FIRST' | 'LAST'; settings?: RenderSettings } & ActionBase)
  /** Edit: new settings for a job that is not running; it waits in the queue again. */
  | ({ type: 'render/updateJob'; id: string; settings: RenderSettings } & ActionBase)
  | ({ type: 'render/duplicateJob'; id: string; at: number } & ActionBase)
  | ({ type: 'render/removeJob'; id: string } & ActionBase)
  /** Moves a job to an index of the queue (drag to reorder). */
  | ({ type: 'render/moveJob'; id: string; to: number } & ActionBase)
  | ({ type: 'render/clearFinished' } & ActionBase)
  | ({ type: 'render/clearQueue' } & ActionBase)
  /** Volatile: what a running job reports. */
  | ({ type: 'render/job'; id: string; patch: Partial<JobRuntime> } & ActionBase)
  /** Volatile: the job in flight. */
  | ({ type: 'render/running'; running: RenderProgress | null } & ActionBase);

const isFinished = (j: RenderJob) => j.status === 'DONE' || j.status === 'FAILED' || j.status === 'CANCELLED';

/**
 * `render/set`. An animation takes the patch as it is (its size is its own). An image takes the active camera's
 * aspect ratio as the rule of its size (U13): a width keeps and the height follows; with the lock closed the
 * other side of a typed one follows too; with it open, or when both sides come at once (a size preset), the
 * size is what was asked and the camera takes its ratio (a preset of the list when the size is exactly one,
 * else a custom one with the pixels). One action, so one undo entry restores both.
 */
function setSettings(state: ProjectState, patch: Partial<RenderSettings>): ProjectState {
  const r = state.render;
  const cam = activeCamera(state);
  if (!cam || (patch.mode ?? r.mode) === 'ANIMATION') return { ...state, render: { ...r, ...patchSettings(r, patch) } };
  const ratio = aspectRatio(cam);
  const { width, height, aspect: _aspect, ...rest } = patch;
  const next = patchSettings({ ...r, aspect: ratio }, rest);
  // The size the window has now, as the camera's ratio gives it (an animation's own size becomes an image's).
  const following = r.mode !== 'ANIMATION' && r.aspect === ratio;
  let size = following ? { width: r.width, height: r.height } : sizeForWidth(r.width, ratio);
  let aspect = cam.aspect;
  const asked = (w: number, h: number) => {
    size = { width: clampSize(w), height: clampSize(h) };
    if (!followsRatio(size.width, size.height, ratio)) aspect = aspectForSize(size.width, size.height);
  };
  if (width !== undefined && height !== undefined) asked(width, height);
  else if (width !== undefined || height !== undefined) {
    if (next.aspectLock) size = width !== undefined ? sizeForWidth(width, ratio) : sizeForHeight(height!, ratio);
    else asked(width ?? size.width, height ?? size.height);
  }
  const finalRatio = aspectRatio({ aspect });
  if (aspect !== cam.aspect) size = sizeForWidth(size.width, finalRatio);
  const camera = aspect === cam.aspect ? state.camera : { ...state.camera, cameras: { ...state.camera.cameras, [cam.id]: { ...cam, aspect } } };
  return { ...state, camera, render: { ...r, ...next, width: size.width, height: size.height, aspect: finalRatio } };
}

/**
 * An image's size follows the active camera's aspect ratio (U13): when the ratio the window's size follows is not
 * the camera's any more (another camera became active, its ratio changed, an undo, a project was opened, the
 * window came back from Animation) the width is kept and the height derived. An animation's size is its own. The
 * same state when it already follows (the check is one comparison, so it runs on every action).
 */
export function syncOutputSize(state: ProjectState): ProjectState {
  const r = state.render;
  if (r.mode === 'ANIMATION') return state;
  const cam = activeCamera(state);
  if (!cam) return state;
  const ratio = aspectRatio(cam);
  if (r.aspect === ratio) return state;
  const size = sizeForWidth(r.width, ratio);
  return { ...state, render: { ...r, width: size.width, height: size.height, aspect: ratio } };
}

export function reduceRender(state: ProjectState, action: RenderAction): ProjectState {
  const r = state.render;
  const withQueue = (queue: RenderJob[], extra: Partial<RenderState> = {}): ProjectState => ({ ...state, render: { ...r, ...extra, queue } });
  switch (action.type) {
    case 'render/quality': {
      const q = QUALITY_PRESETS[action.quality];
      if (!q) return state;
      return { ...state, render: { ...r, ...patchSettings(r, { quality: action.quality, maxSamples: q.samples }) } };
    }
    case 'render/set':
      return setSettings(state, action.patch);
    case 'render/enqueue': {
      const jobs = expandJobs(state, action.settings ?? settingsOf(r), action.at);
      if (jobs.length === 0) return state;
      const queue = action.position === 'FIRST' ? [...jobs, ...r.queue] : [...r.queue, ...jobs];
      return withQueue(queue, { seq: r.seq + jobs.length });
    }
    case 'render/updateJob': {
      const job = r.queue.find((j) => j.id === action.id);
      if (!job || job.status === 'RUNNING') return state;
      const s = patchSettings(action.settings, {});
      const cam = s.mode === 'ANIMATION' ? null : camerasOf(state, s.camera.kind === 'ALL' ? job.settings.camera : s.camera)[0];
      const settings = jobSettings(s, cam);
      return withQueue(r.queue.map((j) => (j.id === action.id ? { ...j, settings, status: 'QUEUED', progress: 0, error: null, startedAt: null, finishedAt: null, frame: 0, frames: 0 } : j)));
    }
    case 'render/duplicateJob': {
      const i = r.queue.findIndex((j) => j.id === action.id);
      if (i < 0) return state;
      const id = nextId('j', r.queue.map((j) => j.id));
      const copy: RenderJob = { ...r.queue[i], id, seq: r.seq + 1, createdAt: action.at, ...freshRuntime() };
      const queue = [...r.queue];
      queue.splice(i + 1, 0, copy);
      return withQueue(queue, { seq: r.seq + 1 });
    }
    case 'render/removeJob':
      return r.queue.some((j) => j.id === action.id) ? withQueue(r.queue.filter((j) => j.id !== action.id)) : state;
    case 'render/moveJob': {
      const i = r.queue.findIndex((j) => j.id === action.id);
      if (i < 0) return state;
      const to = Math.max(0, Math.min(r.queue.length - 1, Math.round(action.to)));
      if (to === i) return state;
      const queue = [...r.queue];
      const [job] = queue.splice(i, 1);
      queue.splice(to, 0, job);
      return withQueue(queue);
    }
    case 'render/clearFinished':
      return r.queue.some(isFinished) ? withQueue(r.queue.filter((j) => !isFinished(j))) : state;
    case 'render/clearQueue':
      return r.queue.some((j) => j.status !== 'RUNNING') ? withQueue(r.queue.filter((j) => j.status === 'RUNNING')) : state;
    case 'render/job': {
      let changed = false;
      const queue = r.queue.map((j) => {
        if (j.id !== action.id) return j;
        const next = { ...j, ...action.patch };
        changed = RUNTIME_KEYS.some((k) => next[k] !== j[k]);
        return changed ? next : j;
      });
      return changed ? withQueue(queue) : state;
    }
    case 'render/running':
      return { ...state, render: { ...r, running: action.running } };
    default:
      return state;
  }
}

/**
 * The render block of a history snapshot with the runtime of the present: jobs that still exist
 * keep their current status, progress and results; a job that comes back with the snapshot was
 * not running any more (it waits again); the job in flight stays what it is.
 */
export function carryRuntime(snapshot: RenderState, current: RenderState): RenderState {
  if (snapshot.queue === current.queue && snapshot.running === current.running) return snapshot;
  const now = new Map(current.queue.map((j) => [j.id, j]));
  let changed = snapshot.running !== current.running;
  const queue = snapshot.queue.map((j) => {
    const c = now.get(j.id);
    if (c) {
      if (RUNTIME_KEYS.every((k) => j[k] === c[k])) return j;
      changed = true;
      const rt: Partial<JobRuntime> = {};
      for (const k of RUNTIME_KEYS) (rt as Record<string, unknown>)[k] = c[k];
      return { ...j, ...rt };
    }
    if (j.status !== 'RUNNING') return j;
    changed = true;
    return { ...j, status: 'QUEUED' as const, progress: 0, startedAt: null, frame: 0 };
  });
  return changed ? { ...snapshot, queue, running: current.running } : snapshot;
}

// ------------------------------------------------------------------ animation output

/** Frames of a timeline of `seconds` at `fps` (at least one: a still timeline is one frame). */
export function timelineFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(Math.max(0, seconds) * Math.max(1, fps)));
}

/** First and last frame (1-based, inclusive) an animation output renders, for a timeline of `seconds`. */
export function frameRange(a: AnimationOutput, seconds: number): { first: number; last: number; count: number } {
  const total = timelineFrames(seconds, a.fps);
  const first = a.range === 'RANGE' ? Math.max(1, Math.round(a.from)) : 1;
  const last = a.range === 'RANGE' ? Math.max(first, Math.round(a.to)) : total;
  return { first, last, count: last - first + 1 };
}

/** The instant of a frame (frame 1 is t = 0). */
export function frameTime(frame: number, fps: number): number {
  return (frame - 1) / Math.max(1, fps);
}

// ------------------------------------------------------------------ estimate

/**
 * Seconds a job of these settings would take on this machine, from the measured throughput of the
 * engine (pixel-samples per second), for `frames` frames; null when nothing was measured and the
 * budget is in samples. A time budget is its own estimate. Never an invented number.
 */
export function estimateSeconds(s: RenderSettings, pixelSamplesPerSecond: number | null, frames = 1): number | null {
  const bySamples = pixelSamplesPerSecond && pixelSamplesPerSecond > 0 ? (s.maxSamples * s.width * s.height) / pixelSamplesPerSecond : null;
  let perFrame: number | null;
  if (s.finishBy === 'TIME') perFrame = s.maxSeconds;
  else if (s.finishBy === 'FIRST') perFrame = bySamples === null ? null : Math.min(bySamples, s.maxSeconds);
  else perFrame = bySamples;
  return perFrame === null ? null : perFrame * Math.max(1, frames);
}

/** Samples a time budget would reach on this machine, or null without a measurement. */
export function estimateSamples(s: RenderSettings, pixelSamplesPerSecond: number | null): number | null {
  if (!pixelSamplesPerSecond || pixelSamplesPerSecond <= 0) return null;
  return Math.max(1, Math.floor((pixelSamplesPerSecond * s.maxSeconds) / (s.width * s.height)));
}

// ------------------------------------------------------------------ migration

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined);
const QUALITIES: readonly RenderQuality[] = ['DRAFT', 'PREVIEW', 'FINAL', 'CUSTOM'];
const STATUSES: readonly JobStatus[] = ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'];

function defined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Settings from anything that looks like them (a U1 render block, a U5 one, a U5 job's settings). */
function migrateSettings(raw: Record<string, unknown>, base: RenderSettings): RenderSettings {
  const dest = isObj(raw.destination) && raw.destination.kind === 'FOLDER' && typeof raw.destination.id === 'string'
    ? { kind: 'FOLDER' as const, id: raw.destination.id, name: str(raw.destination.name) ?? '' }
    : isObj(raw.destination)
      ? { kind: 'DOWNLOADS' as const }
      : undefined;
  let camera: CameraChoice | undefined;
  if (isObj(raw.camera)) {
    if (raw.camera.kind === 'ALL') camera = { kind: 'ALL' };
    else if (raw.camera.kind === 'ONE' && typeof raw.camera.id === 'string') camera = { kind: 'ONE', id: raw.camera.id };
    else camera = { kind: 'ACTIVE' };
  } else if (typeof raw.camera === 'string') camera = { kind: 'ONE', id: raw.camera }; // U1 jobs: a camera id
  const adv = isObj(raw.advanced) ? raw.advanced : null;
  const anim = isObj(raw.animation) ? raw.animation : null;
  const width = num(raw.width);
  const height = num(raw.height);
  const maxSeconds = num(raw.maxSeconds);
  const patch: Partial<RenderSettings> = defined({
    mode: oneOf<RenderMode>(raw.mode, ['IMAGE', 'ANIMATION']),
    name: str(raw.name),
    destination: dest,
    showWhenDone: bool(raw.showWhenDone),
    format: oneOf<OutputFormat>(raw.format, ['PNG', 'JPEG', 'EXR', 'TIFF', 'DNG']),
    bitDepth: raw.bitDepth === 32 ? (32 as const) : raw.bitDepth === 16 ? (16 as const) : raw.bitDepth === 8 ? (8 as const) : undefined,
    jpegQuality: num(raw.jpegQuality),
    transparent: bool(raw.transparent),
    camera,
    aspectLock: bool(raw.aspectLock),
    dpi: num(raw.dpi),
    printUnit: oneOf<PrintUnit>(raw.printUnit, PRINT_UNITS),
    // Before X4 the block was `{ enabled }` only: the patch merges it into the defaults and clamps every control.
    ai: isObj(raw.ai) ? (raw.ai as unknown as AiSettings) : undefined,
    // Before P6 there were no plugins: the patch keeps `{}`.
    plugins: isObj(raw.plugins) ? (raw.plugins as unknown as PluginsSettings) : undefined,
    // U1 had no finishBy: its budget was the samples or the time, whichever came first (0 s: no time limit).
    finishBy: oneOf<FinishBy>(raw.finishBy, ['SAMPLES', 'TIME', 'FIRST']) ?? (raw.finishBy === undefined && maxSeconds !== undefined ? (maxSeconds > 0 ? 'FIRST' : 'SAMPLES') : undefined),
    quality: oneOf(raw.quality, QUALITIES),
    maxSamples: num(raw.maxSamples),
    maxSeconds: maxSeconds !== undefined && maxSeconds > 0 ? maxSeconds : undefined,
    // Before E5b-1 the block had no denoise or caustics: the defaults (denoise both ways, caustics automatic).
    advanced: adv
      ? {
          maxBounces: adv.maxBounces === null ? null : (num(adv.maxBounces) ?? null),
          clampIndirect: num(adv.clampIndirect) ?? 0,
          seed: num(adv.seed) ?? 0,
          denoise: oneOf<DenoiseMode>(adv.denoise, DENOISE_MODES) ?? DEFAULT_ADVANCED.denoise,
          // U11b: a project of before has no strength: all of the filter.
          denoiseStrength: num(adv.denoiseStrength) !== undefined ? clampInt(num(adv.denoiseStrength)!, 0, 100) : DEFAULT_ADVANCED.denoiseStrength,
          saveNoisy: bool(adv.saveNoisy) ?? false,
          caustics: oneOf<CausticsMode>(adv.caustics, CAUSTICS_MODES) ?? DEFAULT_ADVANCED.caustics,
          causticsQuality: oneOf<CausticsQuality>(adv.causticsQuality, CAUSTICS_QUALITIES) ?? DEFAULT_ADVANCED.causticsQuality,
        }
      : undefined,
    animation: anim
      ? {
          range: oneOf<'ALL' | 'RANGE'>(anim.range, ['ALL', 'RANGE']) ?? 'ALL',
          rangeUnit: oneOf<'FRAMES' | 'SECONDS'>(anim.rangeUnit, ['FRAMES', 'SECONDS']) ?? 'FRAMES',
          from: num(anim.from) ?? 1,
          to: num(anim.to) ?? 1,
          fps: num(anim.fps) ?? base.animation.fps,
          output: oneOf<'VIDEO' | 'FRAMES'>(anim.output, ['VIDEO', 'FRAMES']) ?? 'FRAMES',
          video: oneOf<VideoCodec>(anim.video, ['MP4', 'WEBM']) ?? 'MP4',
        }
      : undefined,
  });
  // The quality goes with its samples: set both together so the tier is not lost to "custom".
  const quality = patch.quality;
  delete patch.quality;
  let s = patchSettings({ ...base, ...(quality ? { quality } : {}) }, patch);
  // The size as it was (both sides at once: no aspect lock applies), with its own ratio.
  if (width !== undefined || height !== undefined) s = patchSettings(s, { width: width ?? s.width, height: height ?? s.height });
  if (num(raw.aspect) !== undefined && s.aspectLock) s = { ...s, aspect: num(raw.aspect)! };
  return s;
}

/** A job from a U1 job (flat fields) or a U5 one; null when it has no id. */
function migrateJob(raw: unknown, index: number): RenderJob | null {
  if (!isObj(raw) || typeof raw.id !== 'string') return null;
  const base = defaultRenderSettings();
  const settings = migrateSettings(isObj(raw.settings) ? raw.settings : raw, base);
  // Nothing runs after a load: a job that was running waits again.
  let status = oneOf(raw.status, STATUSES) ?? 'QUEUED';
  if (status === 'RUNNING') status = 'QUEUED';
  const resultIds = Array.isArray(raw.resultIds) ? raw.resultIds.filter((x): x is string => typeof x === 'string') : [];
  return {
    id: raw.id,
    seq: Math.max(1, Math.round(num(raw.seq) ?? index + 1)),
    settings: jobSettings(settings, settings.mode === 'ANIMATION' ? null : settings.camera.kind === 'ONE' ? settings.camera.id : null),
    status,
    progress: status === 'DONE' ? 1 : status === 'QUEUED' ? 0 : Math.max(0, Math.min(1, num(raw.progress) ?? 0)),
    createdAt: num(raw.createdAt) ?? 0,
    startedAt: status === 'QUEUED' ? null : (num(raw.startedAt) ?? null),
    finishedAt: num(raw.finishedAt) ?? null,
    resultIds,
    error: str(raw.error) ?? null,
    frame: status === 'QUEUED' ? 0 : Math.max(0, Math.round(num(raw.frame) ?? 0)),
    frames: Math.max(0, Math.round(num(raw.frames) ?? 0)),
  };
}

/**
 * Any persisted render block to the current shape: the U1 one (`quality`, `width`, `height`,
 * `maxSamples`, `maxSeconds`, `format`, `transparent`, a queue of flat jobs), a U5 one (unchanged
 * but for nothing running after a load), or garbage (the defaults). Pure and idempotent.
 */
export function migrateRender(raw: unknown): RenderState {
  const base = defaultRenderState();
  if (!isObj(raw)) return base;
  const settings = migrateSettings(raw, defaultRenderSettings());
  const seen = new Set<string>();
  const queue: RenderJob[] = [];
  if (Array.isArray(raw.queue)) {
    raw.queue.forEach((j, i) => {
      const job = migrateJob(j, i);
      if (job && !seen.has(job.id)) {
        seen.add(job.id);
        queue.push(job);
      }
    });
  }
  const seq = Math.max(Math.round(num(raw.seq) ?? 0), ...queue.map((j) => j.seq), 0);
  return { ...settings, queue, running: null, seq };
}

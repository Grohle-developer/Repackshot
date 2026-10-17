// AI post-processing: the contract between the phases that build it
// (AI-POST.md §7). Types, stable keys and the shared constants only; the
// logic lives in engine/crates/rt-post (the guard), rt-app (the desktop
// runner and pipeline), src/ai/ (the web driver and the prompt) and src/ui/
// (X4). Phases add to this file; they do not change what is here.

import type { RenderPasses } from './passes';

/** Styles of the configurator (AI-POST.md §4). Stable keys: add, never rename. */
export const AI_STYLES = ['NATURAL', 'CATALOGUE', 'EDITORIAL', 'WARM', 'COOL', 'CINEMATIC'] as const;
export type AiStyle = (typeof AI_STYLES)[number];

/**
 * What the pipeline takes from a job: the configurator's controls and the seed. Every control is
 * an integer 0..100, and at 0 its aspect of the image does not change (AI-POST.md §1.2, §4).
 */
export interface AiPipelineSettings {
  /** How much the model may change the image in total; scales every other control. */
  intervention: number;
  /** More natural light: penumbras, soft highlights, highlight roll-off. */
  light: number;
  /** Bounced light and ambient colour between surfaces. */
  bounce: number;
  /** Micro-variation and believable wear, only in materials that allow wear. */
  wear: number;
  style: AiStyle;
  /** How much the style applies (colour and light mood only). */
  styleStrength: number;
  /** "Another variation" changes it. */
  seed: number;
  /**
   * The job's own words for the model (X4b): at most MAX_USER_PROMPT characters, trimmed; appended after the scene's
   * prompt, never in its place, and only sent to a model that takes a text prompt (`textPrompt` in ai-models.json).
   * Absent: none.
   */
  userPrompt?: string;
  /**
   * How many AI images the job makes from its one render (X4b), 1..MAX_VARIANTS, with consecutive seeds (seed,
   * seed + 1…). Absent: 1. The pipeline itself makes one image per request: the queue sends one request a variant.
   */
  variants?: number;
}

/** The configurator's defaults (AI-POST.md §4). */
export const DEFAULT_AI_PIPELINE: Readonly<Required<AiPipelineSettings>> = {
  intervention: 50,
  light: 50,
  bounce: 40,
  wear: 20,
  style: 'NATURAL',
  styleStrength: 30,
  seed: 0,
  userPrompt: '',
  variants: 1,
};

/** Longest prompt of a job's own (X4b), in characters. */
export const MAX_USER_PROMPT = 400;
/** Most AI images a job makes from its render (X4b). */
export const MAX_VARIANTS = 8;

/** The img2img strength at Intervention 100 (AI-POST.md §3.2 step 3). */
export const MAX_STRENGTH = 0.4;
/** Attempts before the guard gives up and the engine image is delivered unchanged (§7.2). */
export const MAX_ATTEMPTS = 4;
/** Each retry multiplies the strength by this (§7.2). */
export const RETRY_FACTOR = 0.6;
/** Largest side of the Fast-mode preview the pipeline is sent inline (§4, §7.3). */
export const PREVIEW_MAX_SIDE = 512;

/**
 * One material region as the guard sees it (X3a): the passes' `materialId` (RSB material index + 1), its name for
 * the report, whether the model's mid band (wear, micro-detail) may enter it, and whether it is locked (nothing may
 * change there, like the background). Built from the store by `src/ai/prompt.ts` (`guardMaterials`).
 */
export interface AiGuardMaterial {
  materialId: number;
  name: string;
  allowsWear: boolean;
  locked: boolean;
}

/** Linear RGBA, 4 floats a pixel, row-major from the top-left: the render's average (sums / samples), straight alpha. */
export interface LinearImage {
  width: number;
  height: number;
  rgba: Float32Array;
}

/**
 * One measured check of the guard (AI-POST.md §3.2 step 5). `value` and `limit` are in the check's
 * own unit; `ok` is the verdict, so a reader never has to know whether the limit is a floor or a ceiling.
 */
export interface GuardCheck {
  ok: boolean;
  value: number;
  limit: number;
}

/** The colour check of one material region (ΔE₀₀ against the engine image). */
export interface GuardMaterialCheck {
  /** RSB material index + 1, as in RenderPasses.materialId. */
  materialId: number;
  /** The material's name when it was rendered, for the report. */
  name: string;
  deltaEMean: number;
  deltaEP95: number;
  /** Limit on the mean; the 95th percentile's limit is in the guard's tolerances. */
  limit: number;
  ok: boolean;
}

/**
 * ACCEPTED: passed at the asked strength. LIMITED: passed after the strength was lowered.
 * REJECTED: no attempt passed, and the delivered image is the engine's, unchanged.
 */
export type GuardVerdict = 'ACCEPTED' | 'LIMITED' | 'REJECTED';

/** What the guard reports with every AI image (AI-POST.md §3.2 step 5, §4 "Al terminar"). */
export interface GuardReport {
  verdict: GuardVerdict;
  /** Fraction of the asked strength that was used: 1 when accepted at once, 0 when rejected. */
  usedFraction: number;
  attempts: number;
  /** Output size equals the job's exactly (value 1 or 0, limit 1). */
  size: GuardCheck;
  /** Pixels changed outside the regions the controls allow (limit 0). */
  outside: GuardCheck;
  /** Worst edge displacement at id and normal discontinuities, in pixels. */
  edges: GuardCheck;
  /** SSIM of the high band against the engine image (a floor). */
  detail: GuardCheck;
  /** Worst per-tile sharpness deviation against the blur map (in focus stays sharp, out of focus stays soft). */
  focus: GuardCheck;
  materials: GuardMaterialCheck[];
  /** Why it was limited or rejected, in English, for the log; the interface words it from the checks. */
  reason?: string;
  /** ai-models.json key of the model that ran. */
  modelKey: string;
  /** What ran it: an ai-runtimes.json key (desktop), 'ort-web' or 'synthetic'. */
  runtime: string;
  seed: number;
  seconds: number;
}

/** What can run on this install, and why not when it cannot (AI-POST.md §1.5: the switch says the reason). */
export type AiUnavailableReason =
  | 'NO_RUNTIME' // desktop: no inference runtime installed yet
  | 'NO_MODEL' // no model downloaded
  | 'MODEL_UNSUPPORTED' // the active model is not one the installed runtime loads
  | 'NO_WEBGPU' // web: no WebGPU adapter
  | 'TOO_LITTLE_MEMORY' // the active model does not fit
  | 'NOT_BUILT'; // this build has no pipeline yet (the web before X3d)

export type AiBackend = 'VULKAN' | 'CPU' | 'WEBGPU' | 'SYNTHETIC';

export interface AiRuntimeStatus {
  available: boolean;
  reason?: AiUnavailableReason;
  backend: AiBackend | null;
  /** The device it runs on, as the system names it. */
  device: string | null;
  /** ai-models.json keys the installed runtime loads. */
  supports: string[];
  /** The active model's key, or null. */
  activeModel: string | null;
}

/** One post-processing request (AI-POST.md §7.3). */
export interface AiPostRequest {
  /**
   * RENDER: a final render the launcher keeps with its passes (desktop; the pixels never come back
   * to the page and go out again). INLINE: the image and passes sent along (the Fast-mode preview,
   * at most PREVIEW_MAX_SIDE a side, and the web).
   */
  source: { kind: 'RENDER'; renderId: string } | { kind: 'INLINE'; image: LinearImage; passes: RenderPasses };
  settings: AiPipelineSettings;
  /** Built from the scene's materials and lights (src/ai/prompt.ts). */
  prompt: string;
  negative: string;
  /** ai-models.json key. */
  modelKey: string;
  /**
   * The guard's material table (X3c): every RSB material by its `materialId`, with its name, whether wear may
   * enter it and whether it is locked (`guardMaterials` of src/ai/prompt.ts, over io/rsb.ts's material order).
   * Regions it does not name are guarded with defaults; the studio floor (FLOOR_ID) is named "Floor".
   */
  materials?: AiGuardMaterial[];
  /**
   * The person's guard tolerances (Settings ▸ AI post-processing ▸ Advanced, C1), by the keys rt-post names them
   * (`Tolerances::KEYS`). Absent: the guard's provisional defaults, which are the factory values of those settings.
   */
  tolerances?: AiGuardTolerances;
}

/** The guard's tolerances the person sets: mean and 95th percentile ΔE₀₀ per material, and the edge match in pixels. */
export interface AiGuardTolerances {
  deltaEMean: number;
  deltaEP95: number;
  edgesPx: number;
}

export type AiPostStage = 'LOADING' | 'CONDITIONING' | 'INFERENCE' | 'GUARD' | 'RETRY';

export interface AiPostProgress {
  stage: AiPostStage;
  /** 1-based tile being run, and how many. */
  tile: number;
  tiles: number;
  /** 1-based attempt in flight (the guard may send an attempt back: at most `maxAttempts`). */
  attempt: number;
  /** The most attempts there can be (`MAX_ATTEMPTS` when the service does not say). */
  maxAttempts?: number;
  /** Why the guard sent the attempt before this one back, in its words; absent on the first. */
  reason?: string;
  /**
   * 0..1 of the whole request, as far as it can be known. Split by attempts: each owns `1 / maxAttempts` of it, so the
   * bar reaches the end only when the work does (it used to creep towards the end at every retry).
   */
  fraction: number;
}

export interface AiPostResult {
  /** The image to keep (the engine's, unchanged, when the verdict is REJECTED), at the job's exact size. */
  image: LinearImage;
  report: GuardReport;
}

/** The pipeline as the interface sees it: desktop (launcher), web (worker) or synthetic (tests). */
export interface AiPostService {
  status(): Promise<AiRuntimeStatus>;
  post(request: AiPostRequest, onProgress: (p: AiPostProgress) => void, signal: AbortSignal): Promise<AiPostResult>;
}

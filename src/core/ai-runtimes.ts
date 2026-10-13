// The rule that chooses the inference runtime build (AI-POST.md §7.1), over
// the table of src/data/ai-runtimes.json. Pure. The desktop launcher evaluates
// the same table with the same rule in Rust (engine/crates/rt-app/src/ai/
// catalogue.rs); both are tested against tests/fixtures/ai-runtime-cases.json.
//
// Rule: the rows are tried top to bottom and the first that matches wins. A
// row matches when its `force` equals the forced backend (null matches nothing
// forced) and, if it has `gpu`, when that equals whether the hardware report
// has a GPU to use (a failed detection is no GPU: the CPU build runs
// everywhere). The row's backend and the system (os, arch) pick the build; a
// system without a pinned build gets the row and no key. An unknown forced
// backend is not a choice.

import { AI_RUNTIMES, type AiRuntimesCatalogue, type RuntimeBackend } from '../data/ai-runtimes';
import type { AiRuntimeStatus } from './ai';
import type { HardwareInfo } from './models';

export interface RuntimeChoiceInput {
  os: string;
  arch: string;
  /** The hardware report has a GPU to use; null when the detection failed. */
  gpu: boolean | null;
  /** The backend the person forced, or null (Automatic). */
  force: string | null;
}

export interface RuntimeChoice {
  rowId: string;
  backend: RuntimeBackend;
  /** The build for this system, or null when none is pinned. */
  key: string | null;
}

const BACKENDS: readonly string[] = ['VULKAN', 'CPU'];

export function chooseRuntime(input: RuntimeChoiceInput | null, catalogue: AiRuntimesCatalogue = AI_RUNTIMES): RuntimeChoice | null {
  if (!input || typeof input !== 'object') return null;
  const force = input.force ?? null;
  if (force !== null && !BACKENDS.includes(force)) return null;
  const gpu = input.gpu === true;
  const row = catalogue.choice.find((r) => r.force === force && (r.gpu === undefined || r.gpu === gpu));
  if (!row) return null;
  const build = catalogue.runtimes.find((r) => r.os === input.os && r.arch === input.arch && r.backend === row.backend);
  return { rowId: row.id, backend: row.backend, key: build?.key ?? null };
}

/** `ai.backend` of the settings. */
export type BackendSetting = 'AUTO' | 'VULKAN' | 'CPU';

/**
 * The rule's input on the desktop: the launcher's system, whether its hardware report has a GPU to use (a GPU with
 * at least 4 effective GiB: `device`), the person's device (`ai.device` CPU means no GPU) and the forced backend.
 * The launcher reads the same from its own report (`GET /api/ai/runtime?device=cpu&force=…`).
 */
export function runtimeInput(os: string, arch: string, hw: HardwareInfo | null, device: 'GPU' | 'CPU', backend: BackendSetting): RuntimeChoiceInput {
  const gpu = device === 'CPU' ? false : hw && hw.detected && hw.where === 'desktop' ? hw.device === 'gpu' : null;
  return { os, arch, gpu, force: backend === 'AUTO' ? null : backend };
}

// ------------------------------------------------------------------ what the launcher reports

/** One build as the launcher sees it (`GET /api/ai/runtimes/<key>`). */
export interface AiRuntimeEntryState {
  key: string;
  os: string;
  arch: string;
  backend: RuntimeBackend;
  /** A build for this computer's system. */
  here: boolean;
  name: string;
  url: string;
  sha256: string;
  bytes: number;
  state: 'missing' | 'paused' | 'downloading' | 'verifying' | 'installing' | 'installed';
  /** Bytes downloaded (verifying: hashed). */
  done: number;
  total: number;
  /** The last failure, until it is started again. */
  error: string | null;
  /** What `--version` said once installed. */
  version: string | null;
  /** What `--list-devices` said: ggml's name and the system's. */
  devices: { name: string; description: string }[];
  /** Why it does not start on this computer (a missing library or DLL). */
  probeError: string | null;
  supports: string[];
  verified: string[];
}

/** `GET /api/ai/runtime`: the contract's AiRuntimeStatus (src/core/ai.ts), and what the Settings row shows. */
export interface AiRuntimeReport extends AiRuntimeStatus {
  /** Why it is not available, in the launcher's English (the interface words it from `reason`). */
  detail: string | null;
  choice: RuntimeChoice | null;
  release: { tag: string; commit: string };
  platform: { os: string; arch: string };
  gpu: boolean;
  force: string | null;
  /** The chosen build. */
  runtime: AiRuntimeEntryState | null;
  runtimes: AiRuntimeEntryState[];
  sidecar: { state: 'stopped' | 'loading' | 'ready' | 'busy'; label: string | null; pid: number | null; idleSeconds: number };
  /** The launcher has `curl` to download with. */
  downloader: boolean;
}

/** What the status is asked for: the settings' forced backend, the person's device, the active model. */
export interface AiRuntimeQuery {
  force: RuntimeBackend | null;
  cpu: boolean;
  model: string | null;
}

/** The settings as the query. */
export function runtimeQuery(backend: BackendSetting, device: 'GPU' | 'CPU', model: string | null): AiRuntimeQuery {
  return { force: backend === 'AUTO' ? null : backend, cpu: device === 'CPU', model: model || null };
}

/** One raw img2img inference (`POST /api/ai/run`), no guard: the pipeline (X3c) adds that. */
export interface AiRunRequest {
  model: string;
  /** PNG, in base64 (sides 64..4096, multiples of 16). */
  image: string;
  control?: { kind: 'tile' | 'depth'; image: string };
  prompt: string;
  negative: string;
  /** More than 0, at most 1. */
  strength: number;
  seed: number;
  steps?: number;
  width?: number;
  height?: number;
  force?: RuntimeBackend | null;
  /** `cpu` when the person chose the CPU. */
  device?: 'cpu' | null;
}

export type AiRunPhase = 'QUEUED' | 'STARTING' | 'LOADING' | 'INFERENCE' | 'FINISHING' | 'DONE' | 'FAILED' | 'CANCELLED';

/** `GET /api/ai/run/<id>`. */
export interface AiRunState {
  id: number;
  state: AiRunPhase;
  step: number;
  steps: number;
  /** 0..1 of the whole run, as far as it can be known. */
  fraction: number;
  seconds: number;
  version: number;
  model: string;
  runtime: string;
  width: number;
  height: number;
  /** `crashed`, `hung`, `timeout`, `failed`, `wrong-size`, `bad-image`, `start`, `protocol`. */
  error: string | null;
  message: string | null;
}

/** The desktop runtime as the interface uses it (src/io/ai-runtime.ts). */
export interface AiRuntimePort {
  status(q: AiRuntimeQuery): Promise<AiRuntimeReport>;
  download(key: string): Promise<void>;
  pause(key: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** The system's open dialog, then the chosen archive is installed if its sha256 is the pinned one; false when cancelled. */
  installFromFile(key: string, dialog: { title: string; filterName: string }): Promise<boolean>;
  /** Stops the loaded model to give the memory back (closing the AI section). */
  release(): Promise<void>;
}

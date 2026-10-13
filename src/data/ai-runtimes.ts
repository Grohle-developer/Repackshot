// The inference runtimes of the desktop AI post-processing (AI-POST.md §7.1):
// the pinned official builds of stable-diffusion.cpp, the rule that chooses
// one, and how each model family is run. The data lives in ai-runtimes.json
// because two programs read it: this interface (the Settings row) and the
// desktop launcher (engine/crates/rt-app/src/ai/catalogue.rs, which embeds the
// same file at build time and runs the builds). Keys are stable: added, never
// renamed.

import raw from './ai-runtimes.json';
import type { Label } from './types';

export type RuntimeBackend = 'VULKAN' | 'CPU';

export interface AiRuntimeEntry {
  key: string;
  /** `std::env::consts::OS` of the launcher: `windows`, `linux`. */
  os: string;
  /** `std::env::consts::ARCH`: `x86_64`. */
  arch: string;
  backend: RuntimeBackend;
  label: Label;
  /** The archive's file name. */
  name: string;
  /** Pinned to the release tag. */
  url: string;
  bytes: number;
  sha256: string;
  archive: { format: 'zip'; server: string; cli: string };
  /** What the computer needs for it to start (shown before downloading). */
  requires: Label;
  /** ai-models.json keys it loads, per the release's documentation and our arguments. */
  supports: string[];
  /** Keys proven on a real computer (X1 part B); empty until then. */
  verified: string[];
}

/** One row of the choice rule: tried top to bottom, the first match wins. */
export interface AiRuntimeChoiceRow {
  id: string;
  /** The forced backend it answers; null: nothing forced. */
  force: RuntimeBackend | null;
  /** Whether a GPU must be (or must not be) there; absent: either. */
  gpu?: boolean;
  backend: RuntimeBackend;
}

export interface AiRuntimeProfile {
  /** Arguments that load the model; `@role` is a file of the model (`@controlnet~tile`: by name too). */
  load: string[];
  steps: number;
  cfgScale: number;
  sampler: string | null;
  flowShift: number | null;
  /** `init`: img2img; `init+ref`: also the reference image of the edit models. */
  image: 'init' | 'init+ref';
  controls: Record<string, { load: string[]; strength: number }>;
  source?: string;
}

export interface AiRuntimesCatalogue {
  schema: number;
  provisional?: boolean;
  researched?: string;
  release: {
    project: string;
    repository: string;
    tag: string;
    commit: string;
    published: string;
    ggmlCommit?: string;
    licences: { component: string; spdx: string; url: string; file: string }[];
  };
  runtimes: AiRuntimeEntry[];
  choice: AiRuntimeChoiceRow[];
  /** By model family (ai-models.json `family`). */
  profiles: Record<string, AiRuntimeProfile>;
}

export const AI_RUNTIMES: AiRuntimesCatalogue = raw as AiRuntimesCatalogue;

export function aiRuntime(key: string, catalogue: AiRuntimesCatalogue = AI_RUNTIMES): AiRuntimeEntry | undefined {
  return catalogue.runtimes.find((r) => r.key === key);
}

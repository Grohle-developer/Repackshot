// The layer under the pipeline's model call (phase X7, AI-POST.md §8.1): one interface for whatever runs the model on
// one tile of one attempt. The pipeline (the guard's step machine: plan → tiles → the model → accept → retries) does
// not know or care what is behind it; every result goes through the same guard with the same protections and report.
//
// Implementations: the launcher's local runtime (stable-diffusion.cpp, `LocalRuntime` in
// engine/crates/rt-app/src/ai/backend.rs), the launcher's remote API (`RemoteApi` in rt-app/src/ai/remote.rs, the
// system's `curl`), and on the page the remote API through `fetch` (io/ai-api.ts). The web's own local runtime (ONNX
// Runtime Web, phase X3d) is the next one. The Rust trait and this interface say the same thing.

/** One model pass: what the guard prepared for one tile (8-bit, padded), and what to ask. */
export interface AiModelPass {
  /** 1-based tile, of `tiles`. */
  tile: number;
  tiles: number;
  /** 0-based attempt of the guard (a retry asks again at a lower strength). */
  attempt: number;
  /** img2img strength of this attempt, 0..MAX_STRENGTH. */
  strength: number;
  seed: number;
  /** The tile's padded size. */
  width: number;
  height: number;
  /** The engine image as the person sees it, 8-bit sRGB RGB. */
  input: Uint8Array;
  /** Id and normal discontinuities (one byte a pixel). */
  edges: Uint8Array;
  /** Depth (one byte a pixel: near 255, far 16, background 0). */
  depth: Uint8Array;
  prompt: string;
  negative: string;
}

/** What a pass returns: 8-bit sRGB RGB. Another size than the tile's fails the guard's size check (it rejects). */
export interface AiTileImage {
  width: number;
  height: number;
  rgb: Uint8Array;
}

export interface AiModelBackend {
  /** LOCAL: a runtime on this computer; API: a remote service (the render leaves the computer). */
  readonly kind: 'LOCAL' | 'API';
  /** What ran it, as the guard's report says (`GuardReport.runtime`). */
  readonly runtime: string;
  /** Runs the model once. Throws on failure (an API call says why: `ApiCallError`), or an AbortError when stopped. */
  run(pass: AiModelPass, signal: AbortSignal): Promise<AiTileImage>;
}

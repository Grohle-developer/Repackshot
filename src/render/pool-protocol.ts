// Messages between the path tracer (main thread) and its workers.

export type WorkerRequest =
  /** Instantiate this compiled rt.wasm. */
  | { type: 'init'; module: WebAssembly.Module }
  /** Load an RSB (`full`) or update the loaded scene with one that has no meshes. */
  | { type: 'scene'; id: number; bytes: ArrayBuffer; full: boolean }
  /** Render samples first .. first + count - 1 of these tiles (x, y, w, h, index each). */
  | { type: 'job'; generation: number; tiles: Int32Array; first: number; count: number }
  /** Stop the job of this generation (or an older one). */
  | { type: 'cancel'; generation: number }
  /** Convert accumulated RGBA sums of `samples` samples to 8-bit pixels, exactly. */
  | { type: 'tonemap'; id: number; sum: ArrayBuffer; samples: number; ev: number; tonemap: number };

export type WorkerReply =
  | { type: 'ready'; version: number }
  | { type: 'failed'; reason: string }
  | { type: 'scene'; id: number; error: string | null }
  | { type: 'tile'; generation: number; index: number; first: number; count: number; data: Float32Array }
  | { type: 'done'; generation: number }
  | { type: 'error'; generation: number; reason: string }
  | { type: 'pixels'; id: number; bytes: Uint8ClampedArray };

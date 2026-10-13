// The web-side engine interface (ARCHITECTURE §5.0). Two implementations
// coexist: `preview` (three.js, render/preview.ts) and `pathtracer` (the Rust
// engine over a pool of wasm workers, render/pathtracer.ts). The user picks
// which one the viewport shows (Fast / Full); Render always uses the path
// tracer. main.ts wires both.

import type { CameraId } from '../core/camera';
import type { RenderProgress } from '../core/render';
import type { NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';

export interface EngineStatus {
  samples: number;
  seconds: number;
  converged: boolean;
  device: string;
  /** Path tracer: workers in the pool. */
  workers?: number;
  /** Path tracer: the simd128 build of the engine is running. */
  simd?: boolean;
  /** Path tracer: resolution divisor of what is on screen (1, or 2 and 4 during a camera gesture). */
  scale?: number;
  /** Path tracer: frames presented during camera gestures since it started (for measuring). */
  frames?: number;
  /** Path tracer: milliseconds the last reduced-resolution frame took, from the change to the image. */
  frameMs?: number;
  /** Path tracer: a Render is using the pool, the viewport waits. */
  rendering?: boolean;
}

export interface RenderOptions {
  width: number;
  height: number;
  maxSamples: number;
  maxSeconds: number;
  transparent: boolean;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
  /** Camera to render through (default: the active one). Extension used by the queue. */
  camera?: CameraId;
}

export interface PickHit {
  node: NodeId;
  face: number;
  point: [number, number, number];
  normal: [number, number, number];
}

export interface RenderEngine {
  readonly kind: 'preview' | 'pathtracer';
  mount(canvas: HTMLCanvasElement): void;
  /** Applies only what changed between `prev` and `state`. */
  sync(state: ProjectState, prev: ProjectState | null): void;
  resize(width: number, height: number, dpr: number): void;
  /** One step: a frame (preview) or one more sample (path tracer). */
  frame(): void;
  /** The truth about what is on screen; the meter prints exactly this. */
  status(): EngineStatus;
  render(opts: RenderOptions): Promise<ImageBitmap>;
  /** CSS pixels relative to the canvas. */
  pick(x: number, y: number): PickHit | null;
  dispose(): void;
}

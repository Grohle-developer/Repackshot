// The web-side engine interface (ARCHITECTURE §5.0). Two implementations
// coexist: `preview` (three.js, render/preview.ts) and `pathtracer` (the Rust
// engine over a pool of wasm workers, render/pathtracer.ts). The user picks
// which one the viewport shows (Fast / Full); Render always uses the path
// tracer. main.ts wires both.

import type { CameraId } from '../core/camera';
import type { PassKey } from '../core/passes';
import type { AdvancedSettings, FinishBy, RenderProgress } from '../core/render';
import type { NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';

export type { DisplayPrefs, NavigationPrefs } from '../core/settings';

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
  /** Path tracer: a Render is running (the viewport shares the engine with it, or waits). */
  rendering?: boolean;
  /**
   * Path tracer, while a Render runs: SHARED, the viewport goes on with `share` of the threads or workers;
   * PAUSED, it waits until the Render is over (Settings ▸ Render engine ▸ While a render runs, or a pool of one).
   */
  renderShare?: 'SHARED' | 'PAUSED';
  /** Threads (native) or workers (pool) the viewport renders on while it shares, and how many there are. */
  share?: { n: number; of: number };
  /** Path tracer: why the view is not simply converging (the engine does not answer, refused it, or was restarted). */
  issue?: import('./watchdog').ViewportIssue;
  /** Path tracer: passes received since the engine started (for checks: it only grows). */
  passes?: number;
  /** Path tracer: times the watchdog started the view again. */
  watchdog?: number;
  /** Path tracer: the scene of the image on the canvas (full resolution), and the scene of the project now. */
  shownKey?: string;
  wantKey?: string;
  /** Path tracer: pixels of the image the samples above are counted on (for estimates). */
  pixels?: number;
  /** The native engine of the desktop launcher (render/native.ts) is rendering. */
  native?: boolean;
  /** Native engine: its render threads. */
  threads?: number;
  /** Native engine: its SIMD path (`avx2`, `sse2`, `neon`, `scalar`). */
  isa?: string;
}

export interface RenderOptions {
  width: number;
  height: number;
  maxSamples: number;
  maxSeconds: number;
  /**
   * When to stop (render/schedule.ts). Absent: the samples or the time, whichever comes first,
   * with `maxSeconds` 0 meaning no time limit.
   */
  finishBy?: FinishBy;
  transparent: boolean;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
  /** Camera to render through (default: the active one, or the camera track at `time`). */
  camera?: CameraId;
  /** Animation: the instant whose pose is rendered, seconds. */
  time?: number;
  /** Engine settings of the window's Advanced section. */
  advanced?: AdvancedSettings;
  /** Path tracer: also hand back the accumulated linear sums (16-bit PNG, EXR). */
  keepLinear?: boolean;
  /**
   * Path tracer: also render these exact passes next to the image and hand them back (AI-POST.md §7.4,
   * phase X2); the image does not change. The launcher keeps them by the render's id for the AI.
   */
  passes?: readonly PassKey[];
  /**
   * With `passes`, the native engine: leave them in the launcher (it keeps them with the linear image by the
   * render's id for the AI post-processing, X3c) instead of reading them back; `renderId` says which.
   */
  passesInLauncher?: boolean;
  /** Render this project instead of the one on screen (Settings ▸ Measure performance renders the example). */
  state?: ProjectState;
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

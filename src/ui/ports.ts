// What the interface needs from the rest of the application. `ui` never
// imports from `render` or `io` (ARCHITECTURE §2): main.ts builds these
// services from the engine and the importers and hands them in.

import type { CameraId } from '../core/camera';
import type { ImportMessage, ImportPayload, ImportReadOptions } from '../core/import-options';
import type { ImportResult, Library } from '../core/library';
import type { MaterialInstance } from '../core/materials';
import type { NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';
import type { GizmoDelta, GizmoHandle, Space } from '../core/transform';
import type { Tool } from './ui-state';

export interface PickResult {
  node: NodeId;
  face: number;
  point: [number, number, number];
  normal: [number, number, number];
}

/** What the engine on screen reports; the meter prints exactly this. */
export interface EngineStatus {
  samples: number;
  seconds: number;
  converged: boolean;
  device: string;
  /** Path tracer: workers in the pool. */
  workers?: number;
  /** Path tracer: the simd128 build of the engine. */
  simd?: boolean;
  /** Path tracer: resolution divisor on screen (2 or 4 during a camera gesture). */
  scale?: number;
  /** Path tracer: frames presented during camera gestures so far. */
  frames?: number;
  /** Path tracer: milliseconds the last reduced-resolution frame took. */
  frameMs?: number;
  /** Path tracer: a Render has the pool, the viewport waits. */
  rendering?: boolean;
}

/** The viewport as the interface sees it. */
export interface ViewportPort {
  /** The engine on screen now: the preview in Fast mode, the path tracer in Full. */
  readonly kind: 'preview' | 'pathtracer';
  readonly canvas: HTMLCanvasElement;
  /** Full mode's image, placed under `canvas` (which then draws only the overlays); null without a path tracer. */
  readonly backdrop: HTMLCanvasElement | null;
  resize(width: number, height: number, dpr: number): void;
  /** Coordinates in CSS pixels relative to the canvas. */
  pick(x: number, y: number): PickResult | null;
  /** Parts to outline as hovered (the ones under the cursor, or under a dragged material). */
  setHover(ids: readonly NodeId[]): void;
  setTool(tool: Tool): void;
  /** The gizmo of the move tool for these nodes in these axes (UI.md §2.3); null hides it. */
  setGizmo(spec: { ids: readonly NodeId[]; space: Space } | null): void;
  /** The gizmo handle under a point (and highlights it), or null. */
  gizmoHover(x: number, y: number): GizmoHandle | null;
  /** Starts dragging the handle under a point; null when there is none. */
  gizmoBegin(x: number, y: number): GizmoHandle | null;
  /** What the drag did so far, measured from where it began, not snapped. */
  gizmoDrag(x: number, y: number): GizmoDelta | null;
  gizmoEnd(): void;
  status(): EngineStatus;
  /** Called after every drawn frame. */
  onFrame(fn: () => void): () => void;
  /** A sphere with the material, 96 x 96, as a data URL (cached by key). */
  materialThumbnail(mat: MaterialInstance, key: string): Promise<string | null>;
  /** Number of thumbnails waiting to be rendered. */
  thumbnailsPending(): number;
}

export interface RenderRequest {
  width: number;
  height: number;
  maxSamples: number;
  maxSeconds: number;
  transparent: boolean;
  format: 'PNG' | 'JPEG';
  camera?: CameraId;
  signal?: AbortSignal;
  /** 0..1, with the samples every pixel has so far when the engine says. */
  onProgress?: (progress: number, samples?: number) => void;
  /** A quick rasterised picture from the preview instead of the path tracer (the library's thumbnails). */
  quick?: boolean;
}

export type { ImportMessage };

/**
 * A model as the file has it (the units and axes of the file) plus what the reader said and detected. The
 * import sheet chooses the options and `applyImportOptions` (core) turns it into what the store adds.
 */
export interface ImportRead extends ImportPayload {
  format: string;
  /** Data that was repaired or dropped while reading. */
  warnings: ImportMessage[];
  /** Informational: B-reps without a mesh, textures kept, units the sheet does not offer... */
  notes: ImportMessage[];
}

/** The library as a file (src/io/library.ts, which the interface cannot import). */
export interface LibraryServices {
  /** The export file: `{ format, schema, items }` as JSON. */
  export(lib: Library): Blob;
  /** Merges the text of a library file into `lib`; what could not be read is reported, never thrown. */
  import(text: string, lib: Library): ImportResult;
}

export interface AppServices {
  /** Null when WebGL is not available. */
  viewport: ViewportPort | null;
  /** Renders at output size and encodes the image. */
  renderImage(req: RenderRequest): Promise<Blob>;
  /** The viewport as it is now, PNG. */
  captureViewport(): Promise<Blob | null>;
  /** The engine's scene file (RSB, what `rt` renders on the command line) for the output image. */
  exportScene(state: ProjectState): Blob;
  /**
   * Reads a model file; throws with a readable reason (an ImportError with a code for the CAD formats). Names
   * come from the file. STEP and IGES take the tessellation, can be cancelled and report their progress.
   */
  importFile(file: File, options?: ImportReadOptions): Promise<ImportRead>;
  /** The project as a .repack.json blob. */
  serializeProject(state: ProjectState): Blob;
  /** The user's library as a file (Export library / Import library). */
  library: LibraryServices;
}

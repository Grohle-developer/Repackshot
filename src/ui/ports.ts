// What the interface needs from the rest of the application. `ui` never
// imports from `render` or `io` (ARCHITECTURE §2): main.ts builds these
// services from the engine and the importers and hands them in.

import type { CameraId } from '../core/camera';
import type { ImportMessage, ImportPayload, ImportReadOptions } from '../core/import-options';
import type { ImportResult, Library } from '../core/library';
import type { MaterialInstance } from '../core/materials';
import type { AdvancedSettings, BitDepth, Destination, FinishBy, OutputFormat } from '../core/render';
import type { ResultMeta } from '../core/results';
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
  /** Path tracer: pixels the samples above are counted on (the render window's estimate). */
  pixels?: number;
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

/** One image of a render job (an image, or a frame of an animation): always the path tracer. */
export interface FrameRequest {
  width: number;
  height: number;
  finishBy: FinishBy;
  maxSamples: number;
  maxSeconds: number;
  transparent: boolean;
  format: OutputFormat;
  bitDepth: BitDepth;
  /** 1..100 */
  jpegQuality: number;
  /** Written into the file (PNG pHYs, JPEG JFIF). */
  dpi: number;
  /** An image job's camera. */
  camera?: CameraId;
  /** A frame of an animation: the instant rendered (the camera track's camera). */
  time?: number;
  advanced?: AdvancedSettings;
  signal?: AbortSignal;
  /** 0..1, the samples every pixel has so far, and seconds. */
  onProgress?: (progress: number, samples: number, seconds: number) => void;
}

/** What a frame request gives back. */
export interface FrameResult {
  /** The file as it is saved. */
  file: Blob;
  /** An 8-bit picture of it when the browser cannot show the file (EXR); null otherwise. */
  display: Blob | null;
  width: number;
  height: number;
  samples: number;
  seconds: number;
}

/** The results history in the browser (src/io/results.ts). */
export interface ResultsPort {
  /** Kept between sessions (IndexedDB), or only in memory (storage unavailable, e.g. a private window). */
  persistent(): Promise<boolean>;
  /** Newest first. */
  list(): Promise<ResultMeta[]>;
  /** Stores a result; returns the ids evicted to stay within the limits (oldest first). */
  add(meta: ResultMeta, file: Blob, display: Blob | null): Promise<string[]>;
  get(id: string): Promise<{ file: Blob; display: Blob | null } | null>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Where outputs go (src/io/files.ts): the downloads, or a folder of the File System Access API. */
export interface FilesPort {
  /** The browser can give write access to a folder (`showDirectoryPicker`). */
  readonly canChooseFolder: boolean;
  /** The folder can be shown in the system's file manager (the desktop build); never in a browser. */
  readonly canOpenFolder: boolean;
  /** Asks for a folder (a user gesture); null when the person cancels. */
  chooseFolder(): Promise<{ id: string; name: string } | null>;
  /** Write permission for a remembered folder, asked again when needed (call it from a user gesture). */
  ensureAccess(id: string): Promise<boolean>;
  /** Saves under the destination; a download when the folder is gone or not writable. */
  save(dest: Destination, name: string, blob: Blob): Promise<'FOLDER' | 'DOWNLOAD'>;
  openFolder(id: string): Promise<void>;
}

export type { ImportMessage };

// --- Project files (src/io/project.ts, src/io/project-file.ts) ---------------------------------------------

/** Why a file did not open (the same codes as io/project.ts `ProjectErrorCode`; the interface words them). */
export type ProjectFaultCode = 'NOT_A_PROJECT' | 'NEWER_VERSION' | 'DAMAGED' | 'TOO_LARGE';

export interface ProjectFault {
  code: ProjectFaultCode;
  /** The reason in the program's own English: for the console and the tooltip, not for the sentence. */
  detail: string;
  /** NEWER_VERSION: the schema the file has. */
  schema?: number;
}

/** Something a load noticed that the person should hear about. */
export interface ProjectWarning {
  /** This many parts have no geometry in the file (a project from before meshes were embedded). */
  code: 'MISSING_MESHES';
  count: number;
}

export type OpenOutcome = { ok: true; state: ProjectState; warnings: ProjectWarning[] } | { ok: false; fault: ProjectFault };

/** The project as a file: its content (never throws for a bad file; `open` says why instead). */
export interface ProjectPort {
  /** The `.repack.json` blob: the state and the meshes its parts use. Throws only when a mesh is too big to embed. */
  serialize(state: ProjectState): Blob;
  /**
   * Reads a project file. On success its meshes are registered and `state` is ready for `store.reset`; on
   * failure nothing changed.
   */
  open(file: File): Promise<OpenOutcome>;
}

export type SaveResult = { kind: 'SAVED'; name: string; inPlace: boolean } | { kind: 'CANCELLED' } | { kind: 'FAILED'; reason: string };

/** Where project files are written and read: the file system with a remembered file, or downloads and an input. */
export interface ProjectFilesPort {
  /** The browser writes back to the file it opened or saved (File System Access API); otherwise it downloads. */
  readonly canSaveInPlace: boolean;
  /**
   * Writes the project. Without `saveAs`, to the remembered file when there is one (no dialog); otherwise it asks
   * where (or downloads `suggestedName`). `make` is called when the destination is known, so a slow dialog does
   * not lose the user gesture and the file holds the project as of that moment.
   */
  save(make: () => Blob, suggestedName: string, opts: { saveAs: boolean }): Promise<SaveResult>;
  /** The Open dialog; null when the person cancels. `handle` goes to `adopt` once the project is open. */
  pick(): Promise<{ file: File; handle: unknown } | null>;
  /** The file the open project lives in (a handle from `pick` or a dropped file), or null for none. */
  adopt(handle: unknown): void;
}

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
  /** A quick picture (`quick`: the preview) or a render at output size, encoded (the library's thumbnails). */
  renderImage(req: RenderRequest): Promise<Blob>;
  /** One image of a render job with the path tracer (never the preview), encoded as the job asks. */
  renderFrame(req: FrameRequest): Promise<FrameResult>;
  /** The results history. */
  results: ResultsPort;
  /** Saving outputs. */
  files: FilesPort;
  /** The viewport as it is now, PNG. */
  captureViewport(): Promise<Blob | null>;
  /** The engine's scene file (RSB, what `rt` renders on the command line) for the output image. */
  exportScene(state: ProjectState): Blob;
  /**
   * Reads a model file; throws with a readable reason (an ImportError with a code for the CAD formats). Names
   * come from the file. STEP and IGES take the tessellation, can be cancelled and report their progress.
   */
  importFile(file: File, options?: ImportReadOptions): Promise<ImportRead>;
  /** The project file's content, and reading one. */
  project: ProjectPort;
  /** Where project files go. */
  projectFiles: ProjectFilesPort;
  /** The user's library as a file (Export library / Import library). */
  library: LibraryServices;
}

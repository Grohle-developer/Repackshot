// What the interface needs from the rest of the application. `ui` never
// imports from `render` or `io` (ARCHITECTURE §2): main.ts builds these
// services from the engine and the importers and hands them in.

import type { AiPostService, LinearImage } from '../core/ai';
import type { Projection, Rect } from '../core/box-select';
import type { CameraId } from '../core/camera';
import type { ImportMessage, ImportPayload, ImportReadOptions } from '../core/import-options';
import type { ImportResult, Library } from '../core/library';
import type { MaterialInstance } from '../core/materials';
import type { RenderPasses } from '../core/passes';
import type { AdvancedSettings, BitDepth, Destination, FinishBy, OutputFormat } from '../core/render';
import type { ResultMeta } from '../core/results';
import type { NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';
import type { GizmoDelta, GizmoHandle, Space } from '../core/transform';
import type { HardwareInfo, ModelsService } from '../core/models';
import type { ImageRef } from '../core/images';
import type { AiRuntimePort } from '../core/ai-runtimes';
import type { HostEvent, HostInfo } from '../core/host-protocol';
import type { HistoryLimits } from '../core/results';
import type { DisplayPrefs, NavigationPrefs, ViewportLimit } from '../core/settings';
import type { UpdateOutcome } from '../core/updates';
import type { PerfResult, Tool } from './ui-state';

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
  /** The desktop launcher's native engine renders (threads and SIMD path below). */
  native?: boolean;
  threads?: number;
  isa?: string;
}

export type { DisplayPrefs, NavigationPrefs } from '../core/settings';

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
  /** How the parts are projected as they are drawn now: selection by box tests them on the screen (core/box-select.ts). */
  projection(): Projection | null;
  /**
   * The triangles of a part that show in a rectangle (CSS pixels of the canvas), found by drawing them with an id
   * each: what other parts and the part itself hide does not count. Null when the viewport cannot tell.
   */
  visibleTriangles(part: NodeId, rect: Rect): Set<number> | null;
  /** The faces of a part a dragged material would reach, tinted (null clears them). */
  setHoverFaces(spec: { part: NodeId; indices: readonly number[] } | null): void;
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
  setNavigation(nav: NavigationPrefs): void;
  setDisplay(display: DisplayPrefs): void;
}

/** The engine settings of Settings ▸ Render engine, as main.ts applies them. */
export interface EngineConfig {
  backend: 'AUTO' | 'NATIVE' | 'WASM';
  /** 0: automatic. */
  threads: number;
  simd: 'AUTO' | 'OFF';
  gestureResolution: 'AUTO' | 'HALF' | 'QUARTER';
  viewportLimit: ViewportLimit;
}

export interface EnginePort {
  /** Applies the settings: the pool restarts when its size, its SIMD build or the backend changes. */
  configure(cfg: EngineConfig): void;
  /** Renders the example scene for `seconds` with the engine in use and reports what it measured. */
  measure(opts: { seconds: number; signal: AbortSignal; onProgress?: (elapsed: number) => void }): Promise<PerfResult>;
}

/** One part of the desktop's data folder, measured by the launcher (`models`, `results`, `library`, `thumbs`, `logs`, `window`, `other`). */
export interface FolderPart {
  id: string;
  path: string | null;
  bytes: number;
  files: number;
}

/**
 * Where the application's data is, as Settings ▸ Storage shows it (io/platform.ts): the browser's site storage in
 * the web version, the data folder of the desktop application.
 */
export interface StoragePort {
  /** `browser`: the site's storage, which the browser may evict; `folder`: the desktop's data folder. Absent: `browser`. */
  readonly kind?: 'browser' | 'folder';
  /** What the browser reports (navigator.storage.estimate), or null when it does not (and on the desktop). */
  estimate(): Promise<{ usage: number; quota: number } | null>;
  /** Whether the browser keeps the data (navigator.storage.persisted), null when it cannot say (and on the desktop). */
  persisted(): Promise<boolean | null>;
  /** Asks the browser to keep the data; null when it cannot be asked. */
  persist(): Promise<boolean | null>;
  /** Bytes of the library. */
  libraryBytes(): number | Promise<number>;
  /** Bytes of the thumbnail cache. */
  cacheBytes(): number | Promise<number>;
  /** Deletes the thumbnail cache; the bytes freed. */
  clearCache(): number | Promise<number>;
  /** The desktop's data folder by part, as the launcher measured it; null (or absent) in the web version. */
  usage?(): Promise<{ dataDir: string; total: number; folders: FolderPart[] } | null>;
}

/**
 * Repackshot's own window on the desktop (P3c, WebView2 on Windows, with the system's title bar): the page
 * names its title, gives its colours and answers its close with our own question. Null in a browser and in
 * the browser's app window.
 */
export interface WindowHostPort {
  readonly kind: 'webview2';
  /** The window's answer to `ready` (its WebView2 version), or null before it. */
  info(): HostInfo | null;
  /** Listens to the window's events; returns the function that stops. */
  on(listener: (event: HostEvent) => void): () => void;
  /** The page listens. */
  ready(): void;
  /** The project's name: the title becomes `Repackshot — <project>`. */
  setTitle(project: string): void;
  setTheme(dark: boolean, background: string): void;
  /** Close as the system would: the window asks back (`close-requested`). */
  close(): void;
  /** The page agreed to close. */
  closeOk(): void;
}

/** The desktop launcher's folders (P2), when the page runs in its window. */
export interface DesktopPort {
  openFolder(target: 'data' | 'models' | 'logs' | 'results'): Promise<void>;
  /** Closes the app window (Ctrl/⌘ W and Ctrl Q after the unsaved-changes question). */
  closeWindow?(): void;
}

/** The release feed (src/io/updates.ts): the latest published release, or why it could not be had. Never throws. */
export interface UpdatesPort {
  latest(): Promise<UpdateOutcome>;
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

// --- AI post-processing (phase X4, AI-POST.md §4, §7.3) ---------------------------------------------------------

/** The inputs of an AI request for a camera: a picture and the passes of §7.4 drawn at the same size. */
export interface AiFrameRequest {
  width: number;
  height: number;
  /** The job's camera; null: the active one. */
  camera: CameraId | null;
  /** Start from the path tracer instead of Fast mode (the preview's "full engine" option), with the job's budget. */
  fullEngine: { finishBy: FinishBy; maxSamples: number; maxSeconds: number } | null;
  signal?: AbortSignal;
}

export interface AiFrame {
  image: LinearImage;
  passes: RenderPasses;
}

/** How a finished AI image is written (the job's format). */
export interface AiEncodeOptions {
  format: OutputFormat;
  bitDepth: BitDepth;
  /** 1..100 */
  jpegQuality: number;
  dpi: number;
  transparent: boolean;
}

/**
 * Everything the interface needs for the AI post-processing step. `service` is the pipeline (the desktop
 * launcher's, the web's, or the synthetic one of tests and screenshots); the rest builds its inputs from the
 * engine on screen and turns its output into files. `ui` never imports from `ai`, `render` or `io`.
 */
export interface AiPort {
  readonly service: AiPostService;
  /** The preview's inputs: the picture of a camera at a size (Fast mode, or the full engine) and its passes. */
  frame(req: AiFrameRequest): Promise<AiFrame>;
  /** The passes of §7.4 for a camera at a size, to go with a render that was already made. */
  passes(req: { width: number; height: number; camera: CameraId | null }): Promise<RenderPasses>;
  /** A finished render's picture as a linear image. */
  decode(image: Blob): Promise<LinearImage>;
  /** An image from the service as a file, in the job's format. */
  encode(image: LinearImage, opts: AiEncodeOptions): Promise<Blob>;
  /** The prompt and the negative for a scene (src/ai/prompt.ts arrives with X3a). */
  scenePrompt(state: ProjectState): { prompt: string; negative: string };
}

/** The results history in the browser (src/io/results.ts). */
export interface ResultsPort {
  /** Kept between sessions (IndexedDB), or only in memory (storage unavailable, e.g. a private window). */
  persistent(): Promise<boolean>;
  /** Newest first. */
  list(): Promise<ResultMeta[]>;
  /** Stores a result (`ai`: the image the AI post-processing made, when there is one); returns the ids evicted to stay within the limits (oldest first). */
  add(meta: ResultMeta, file: Blob, display: Blob | null, ai?: Blob | null): Promise<string[]>;
  get(id: string): Promise<{ file: Blob; display: Blob | null; ai?: Blob | null } | null>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /** New limits (Settings ▸ Storage); the ids evicted at once to fit them, oldest first. */
  setLimits?(limits: HistoryLimits): Promise<string[]>;
}

/** Where outputs go (src/io/files.ts): the downloads, or a folder of the File System Access API. */
export interface FilesPort {
  /** The browser can give write access to a folder (`showDirectoryPicker`). */
  readonly canChooseFolder: boolean;
  /** The folder can be shown in the system's file manager (the desktop build); never in a browser. */
  readonly canOpenFolder: boolean;
  /** The desktop launcher writes the files: a folder is a path, Downloads the system's folder. */
  readonly desktop?: boolean;
  /** Results saved to Downloads can be shown in the file manager too (the desktop). */
  readonly canOpenDownloads?: boolean;
  /** Asks for a folder (a user gesture); null when the person cancels. */
  chooseFolder(): Promise<{ id: string; name: string } | null>;
  /** Write permission for a remembered folder, asked again when needed (call it from a user gesture). */
  ensureAccess(id: string): Promise<boolean>;
  /** Saves under the destination; a download when the folder is gone or not writable. */
  save(dest: Destination, name: string, blob: Blob): Promise<'FOLDER' | 'DOWNLOAD'>;
  /** Shows the folder (`downloads`: the Downloads folder) in the file manager, with the file `name` saved there selected when known. */
  openFolder(id: string, name?: string): Promise<void>;
}

/** A file type of the system's dialogs: `extensions` without the dot; `*` is every file. */
export interface DialogFilter {
  name: string;
  extensions: string[];
}

/**
 * The system's own dialogs for imports and exports (the desktop launcher, io/desktop-files.ts); null in the browser,
 * which uses `<input type="file">` and downloads.
 */
export interface DialogsPort {
  /** Files to read; null when cancelled. `lazy`: read in ranges through the launcher (AI model files of many GB). */
  openFiles(req: { title: string; filters: DialogFilter[]; multiple?: boolean; lazy?: boolean }): Promise<File[] | null>;
  /** Every file under a folder (an AI model's folder), each with its `webkitRelativePath`; null when cancelled. */
  openFolderFiles(req: { title: string; folderItem: string }): Promise<File[] | null>;
  /** Writes `blob` where the person says in the save dialog. */
  saveFile(blob: Blob, suggestedName: string, req: { title: string; filters: DialogFilter[] }): Promise<{ kind: 'SAVED'; name: string; path: string } | { kind: 'CANCELLED' } | { kind: 'FAILED'; reason: string }>;
  /** Opens an https:// address in the system's browser, not in the app window. */
  openExternal(url: string): Promise<void>;
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
  code: 'MISSING_MESHES' | 'MISSING_IMAGES';
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
  /** The project file opened or saved last, when the browser keeps file handles (General ▸ On start ▸ Last project). */
  last?(): Promise<{ name: string; handle: unknown } | null>;
  /** Reads that file again, asking for permission (call it from a click); null when it cannot be read. */
  reopen?(handle: unknown): Promise<File | null>;
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

/** The environment's image files (src/io/hdri.ts, which the interface cannot import). */
export interface ImagesPort {
  /**
   * Reads an HDRI (.hdr or .exr) into the image registry; rejects with an error whose `code` is FORMAT,
   * DAMAGED, UNSUPPORTED or TOO_LARGE (and a message naming what is not supported).
   */
  loadHdri(file: File): Promise<ImageRef>;
  /** Reads a background image (.png, .jpg, .webp) into the image registry; rejects like `loadHdri`. */
  loadBackplate(file: File): Promise<ImageRef>;
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
  /** The render engine's settings and Measure performance. */
  engine: EnginePort;
  /** AI post-processing (phase X4); null or absent when this build has no way to draw its inputs. */
  ai?: AiPort | null;
  /** The AI model manager; null when this build has none. */
  models: ModelsService | null;
  /** The desktop launcher's inference runtime (X3b, src/io/ai-runtime.ts); absent or null elsewhere. */
  aiRuntime?: AiRuntimePort | null;
  /** What this computer has, for the AI models (WebGPU limits in the browser, the launcher's detection on the desktop). */
  hardware(again?: boolean): Promise<HardwareInfo>;
  storage: StoragePort;
  /** Null outside the desktop application. */
  desktop: DesktopPort | null;
  /** Where new versions are published (Settings ▸ Updates). */
  updates: UpdatesPort;
  /**
   * Opens an https:// address outside the application, never in its window: the system's browser on the desktop (the
   * launcher's /api/open-url), a new tab in the browser version. Anything else than https:// is ignored.
   */
  openExternal(url: string): Promise<void>;
  /** The system's dialogs for imports and exports; absent or null in the browser. */
  dialogs?: DialogsPort | null;
  /** Repackshot's own window (P3c); null or absent in a browser and in the browser's app window. */
  windowHost?: WindowHostPort | null;
  /** A licence text shipped with the build (`licences/<file>`, copied by tools/licences.mjs); null when missing. */
  licenceText(file: string): Promise<string | null>;
  /** The environment's HDRI and background image files. */
  images: ImagesPort;
}

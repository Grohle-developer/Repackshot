// What the interface needs from the rest of the application. `ui` never
// imports from `render` or `io` (ARCHITECTURE §2): main.ts builds these
// services from the engine and the importers and hands them in.

import type { FadeToColor } from '../core/animation';
import type { FastAa, PixelFilterFields, PixelFilterSetting } from '../core/antialias';
import type { AiGuardMaterial, AiPipelineSettings, AiPostService, LinearImage } from '../core/ai';
import type { ComposedPrompt, PromptCaps } from '../core/ai-prompt';
import type { Projection, Rect } from '../core/box-select';
import type { FrameScan } from '../core/doctor-engine';
import type { CameraId, CameraState } from '../core/camera';
import type { EngineLensInfo } from '../core/traced-lens';
import type { ImportMessage, ImportPayload, ImportReadOptions } from '../core/import-options';
import type { ImportResult, Library } from '../core/library';
import type { MaterialInstance } from '../core/materials';
import type { Program } from '../core/material-program';
import type { FrameBox, LiveFrame } from '../core/live-frame';
import type { PassesOutput } from '../core/pass-files';
import type { RenderPasses } from '../core/passes';
import type { AdvancedSettings, BitDepth, Destination, FinishBy, OutputFormat, RenderProgress, VideoCodec } from '../core/render';
import type { ResultMeta } from '../core/results';
import type { NodeId } from '../core/scene';
import type { MotionHint } from '../core/motion-hint';
import type { ViewObject } from '../core/view-objects';
import type { ProjectState } from '../core/store';
import type { GizmoDelta, GizmoHandle, Space } from '../core/transform';
import type { HardwareInfo, ModelsService } from '../core/models';
import type { ImageRef } from '../core/images';
import type { AiRuntimePort } from '../core/ai-runtimes';
import type { HostEvent, HostInfo } from '../core/host-protocol';
import type { HistoryLimits } from '../core/results';
import type { DisplayPrefs, NavigationPrefs, ViewportLimit } from '../core/settings';
import type { InstallerPort, UpdateOutcome } from '../core/updates';
import type { InstallOutcome, PluginImageRequest, PluginPresets, PluginRunRequest, PluginRunResult, PluginsSnapshot, ThumbsOutcome } from '../core/plugins';
import type { PluginRegistryEntry } from '../data/plugins';
import type { PerfResult, Tool, VideoSupportUi } from './ui-state';
import type { PhysicsRunHandle, PhysicsRunOptions, PhysicsSpec, PhysicsUpdate } from '../core/physics';

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
  /** Path tracer: a Render is running (the viewport shares the engine with it, or waits). */
  rendering?: boolean;
  /** Path tracer, while a Render runs: the viewport goes on with `share` of the engine, or waits for it. */
  renderShare?: 'SHARED' | 'PAUSED';
  /** Threads (native) or workers (pool) the viewport renders on while it shares, of how many. */
  share?: { n: number; of: number };
  /** Path tracer: why the view is not simply converging (render/watchdog.ts `ViewportIssue`). */
  issue?: { kind: 'WAITING' | 'FAILED' | 'RESTARTED'; detail: string; seconds?: number };
  /** Path tracer: passes received since it started, and times its watchdog restarted the view (for checks). */
  passes?: number;
  /**
   * Preview (S4a): the particles of the ambient effects it draws (evaluated by rt.wasm's own simulator), of how many
   * the engine renders; `boxesOnly` when there is no rt.wasm and only the region boxes are drawn. Absent: no effect.
   */
  particles?: { shown: number; total: number; boxesOnly: boolean };
  watchdog?: number;
  /** Path tracer: the scene of the image on the canvas and the scene of the project now (equal: up to date). */
  shownKey?: string;
  wantKey?: string;
  /** Path tracer: pixels the samples above are counted on (the render window's estimate). */
  pixels?: number;
  /** The desktop launcher's native engine renders (threads and SIMD path below). */
  native?: boolean;
  threads?: number;
  isa?: string;
  /** Path tracer (E5b-1): the image on screen is the engine's denoised one. */
  denoised?: boolean;
  /** Path tracer (U11): the live denoise's measures, the last denoise's cost (the pool) and the denoised images shown. */
  liveDenoise?: { ms?: number; images: number; accumulated?: number; at?: number };
  /** Path tracer (E5b-1): the view renders caustics with this many photons per sample. */
  caustics?: number;
  /** Path tracer (E11): the pixel filter and edge samples the image on screen was asked to render with, at full resolution. */
  pixelFilter?: PixelFilterFields;
  /** Path tracer (D1): what the Doctor reads of the view's accumulation (fireflies, brightness by the stop); absent while there is none. */
  scan?: FrameScan;
  /** Preview (E11): the multisampling it draws with now, and the most the device can do. */
  msaa?: { samples: number; max: number };
  /**
   * Path tracer (E10): the view samples adaptively: its pixels' fewest and most samples, the noise of its noisiest block
   * at the last decision (-1 before it) and the seconds to the target from its last pass (-1: unknown).
   */
  adaptive?: { min: number; max: number; noise: number; eta: number };
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
  /** S4a: the ambient effect whose region box the viewport draws (the one being edited), or null. */
  setSelectedEffect?(id: string | null): void;
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
  /**
   * The gizmo of the move tool for these nodes in these axes (UI.md §2.3); null hides it. `handles` SCALE: only the
   * scale handles (the scale tool, phase U9).
   */
  setGizmo(spec: { ids: readonly NodeId[]; space: Space; handles?: 'ALL' | 'SCALE' | 'MOVE'; object?: ViewObject | null } | null): void;
  /**
   * L4: the glyphs of lights and saved cameras the viewport draws (all, or only the selected object's) and the light or
   * camera it looks through (null: the active camera).
   */
  setGlyphs(spec: { all: boolean; selected: ViewObject | null; lookThrough: ViewObject | null }): void;
  /** L4: the light or camera whose glyph is under a point (CSS pixels of the canvas), or null. */
  glyphAt(x: number, y: number): ViewObject | null;
  /**
   * N6: what the viewport draws for the animation selected in the timeline: its target outlined, its track (an orbit's
   * arc, a move's arrow, an explode's vectors, a spin's axis) as lines in model space; null clears it.
   */
  setMotionHint?(hint: MotionHint | null): void;
  /** L4: where a light or a camera is on the canvas now (CSS pixels), or null; the viewport writes it for checks. */
  objectAt?(obj: ViewObject): { x: number; y: number } | null;
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
  /** While a render runs: the viewport keeps a quarter of the engine, or waits. */
  whileRender: 'SHARE' | 'PAUSE';
  /** E11, Edge smoothing: Fast mode's multisampling, and Full mode's and the render's pixel filter. */
  fastAa: FastAa;
  pixelFilter: PixelFilterSetting;
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
  /** Installing it from inside the application: the desktop launcher's; null or absent in the web version. */
  installer?: InstallerPort | null;
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
  /** Written into the file (PNG pHYs, JPEG JFIF, TIFF XResolution and YResolution). */
  dpi: number;
  /** An image job's camera. */
  camera?: CameraId;
  /**
   * N2: the project to render instead of the open one (the job's studio put on it, core/lighting.ts `restoreStudio`); the
   * camera and the instant apply to it as to the open one. Absent: the open project.
   */
  state?: ProjectState;
  /**
   * N2: the passes to write next to the image (an image only), as 16-bit PNG or EXR; the files come back in `extras`,
   * named from `imageName`.
   */
  passes?: PassesOutput;
  /** N2: the name of the image this request writes: its companions (the pass files) are named from it. */
  imageName?: string;
  /** A frame of an animation: the instant rendered (the camera track's camera). */
  time?: number;
  /** N1: the camera track's fade to a colour at that instant (core/animation.ts `shotFadeAt`): mixed into the file. */
  fade?: FadeToColor | null;
  advanced?: AdvancedSettings;
  /** E10, Finish by Noise: its threshold, percent (core/render.ts `adaptiveOf` makes it the engine's). */
  noiseThreshold?: number;
  signal?: AbortSignal;
  /** 0..1, the samples every pixel has so far, and seconds; E10, an adaptive render: the engine's numbers of it. */
  onProgress?: (progress: number, samples: number, seconds: number, adaptive?: RenderProgress['adaptive']) => void;
  /**
   * The AI step follows (X3c): render the guard's passes too and let the desktop launcher keep them with the linear
   * image by the render's id (AI-POST.md §7.3), for the `RENDER` source. Ignored where there is no launcher.
   */
  aiPasses?: boolean;
  /**
   * U14, the queue's live view of this job: asked as the image accumulates (the web's pool: as its tiles come back;
   * the desktop launcher: after every pass), the box (device pixels) to fit a picture in when one is wanted now, else
   * null. The queue's cadence is inside it (core/live-frame.ts): it says yes at most every LIVE_FRAME_MS, and only
   * while the live view shows this job; while it says no, no picture is made and no sums are copied for one. `image`:
   * the number of the image the engine has now (the desktop: its pass), so the same image is not asked for twice
   * while the view stays open.
   */
  frameBox?: (image?: number) => FrameBox | null;
  /** U14: the picture `frameBox` asked for, scaled to its box, with the engine's samples and seconds. */
  onFrame?: (frame: LiveFrame) => void;
}

/** The exposure and tone curve a render's file was written with (RSB codes): the AI image is written the same way. */
export interface FrameTone {
  exposureEv: number;
  tonemap: number;
}

/** What a frame request gives back. */
/**
 * N1: encoded video (src/io/video.ts, WebCodecs and our own muxers): what this system encodes, and a writer for one
 * video, frame by frame. Absent where the page has no such service (a test without it): video is not offered.
 */
export interface VideoPort {
  /** The track codec each container is encoded with here (null: it cannot be), asked of the browser once. */
  support(): Promise<VideoSupportUi>;
  /** A writer for one video of this size and rate in this container; rejects when the system cannot encode it. */
  open(opts: { container: VideoCodec; width: number; height: number; fps: number }): Promise<VideoWriterPort>;
}

export interface VideoWriterPort {
  /** The codec the frames are encoded with (`VP9`, `VP8`, `H264`). */
  readonly track: string;
  /** Frame `index` of the video (0 for the first), a picture the browser decodes; resolves once it is taken. */
  add(picture: Blob, index: number): Promise<void>;
  /** The file, once every frame is encoded and muxed. */
  finish(): Promise<Blob>;
  /** Stops and lets the encoder go. */
  close(): void;
}

export interface FrameResult {
  /** The file as it is saved. */
  file: Blob;
  /** An 8-bit picture of it when the browser cannot show the file (EXR, TIFF, DNG; `needsDisplayCopy`); null otherwise. */
  display: Blob | null;
  width: number;
  height: number;
  samples: number;
  seconds: number;
  /** The desktop launcher's id of the render, by which it keeps the linear image and the passes (`aiPasses`). */
  renderId?: string;
  /** E5b-1: the file is the engine's denoised image. */
  denoised?: boolean;
  /** E5b-1, Advanced ▸ Also save without denoise: the same render before denoise, in the same format. */
  noisyFile?: Blob;
  /** How its file was converted from the render's light. */
  tone?: FrameTone;
  /** N2: the files beside the image: the pass files and the part-id legend, each with its whole name. */
  extras?: { name: string; blob: Blob }[];
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
  /**
   * The image is the render's own scene light (the `RENDER` source, X3c): written with this exposure and curve,
   * exactly as the engine's file was. Absent: the image is display light (an `INLINE` source decoded from 8 bits).
   */
  tone?: FrameTone;
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
  /**
   * The prompt and the negative for a scene and a job's settings (src/ai/prompt.ts; default: the window's). With a
   * `context` (X4b): Settings' system prompt, the scene's and the job's own, in that order, fitted to the model whose
   * capabilities it gives, and how that went (`composed`).
   */
  scenePrompt(state: ProjectState, settings?: AiPipelineSettings, context?: { system: string; caps: PromptCaps }): { prompt: string; negative: string; composed?: ComposedPrompt };
  /** The guard's material table for a job's camera: the engine scene's material order (io/rsb.ts), named (src/ai/prompt.ts). */
  materials(state: ProjectState, camera: CameraId | null): AiGuardMaterial[];
  /** The service takes the `RENDER` source: the desktop launcher kept the final render with its passes (X3c). */
  renderSource(): Promise<boolean>;
}

/** N2: our own ZIP (src/io/zip.ts), for the files of a batch; `ui` does not import `io`. */
export interface ArchivePort {
  /** A ZIP of the files, stored (not compressed), in the order given; repeated names are told apart. */
  zip(entries: readonly { name: string; data: Blob }[]): Promise<Blob>;
}

/** The results history in the browser (src/io/results.ts). */
export interface ResultsPort {
  /** Kept between sessions (IndexedDB), or only in memory (storage unavailable, e.g. a private window). */
  persistent(): Promise<boolean>;
  /** Newest first. */
  list(): Promise<ResultMeta[]>;
  /**
   * Stores a result (`ai`: the image the AI post-processing made, when there is one; `aiMore`: variants 2 and on, in
   * order, null for one the guard rejected, X4b); returns the ids evicted to stay within the limits (oldest first).
   */
  add(meta: ResultMeta, file: Blob, display: Blob | null, ai?: Blob | null, aiMore?: readonly (Blob | null)[]): Promise<string[]>;
  get(id: string): Promise<{ file: Blob; display: Blob | null; ai?: Blob | null; aiMore?: (Blob | null)[] } | null>;
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
  /** The `.repack` blob: the state and the meshes its parts use. Throws only when a mesh is too big to embed. */
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

/**
 * The rigid body simulator (phase S2): rt-phys in a worker of its own (render/physics.ts), fed the PHY1 scene of a
 * spec (io/phys.ts). The interface never sees the engine: only the spec, the frames and what the simulator measured.
 */
export interface PhysicsPort {
  /**
   * Starts a simulation (a new one replaces the one in progress). `started` rejects with `NO_ENGINE` when rt.wasm
   * is not there (npm run engine:build), or with the engine's message when the scene does not load.
   */
  run(spec: PhysicsSpec, options: PhysicsRunOptions, onUpdate: (u: PhysicsUpdate) => void): PhysicsRunHandle;
}

/**
 * Plugins (phase P6, src/plugins/): the registry, what is installed and its installs, and runs over a finished result.
 * The interface never sees a plugin's code or its key: it asks, and draws what comes back.
 */
export interface PluginsPort {
  readonly registry: readonly PluginRegistryEntry[];
  snapshot(): PluginsSnapshot;
  subscribe(fn: (s: PluginsSnapshot) => void): () => void;
  /** Install or update a plugin of the registry; NEEDS_KEY: `provideKey` goes on. */
  install(id: string): Promise<InstallOutcome>;
  provideKey(id: string, key: string): Promise<InstallOutcome>;
  cancelInstall(id: string): void;
  /** Install from a `.rpk` the person chose, with the key they typed. */
  installFile(file: Blob, key: string): Promise<InstallOutcome>;
  remove(id: string): Promise<void>;
  /** A text file of an installed plugin (its licence, its notices), or null. */
  text(id: string, file: string): Promise<string | null>;
  /** The plugin's recipes by category (it is started on first use). */
  presets(id: string): Promise<PluginPresets>;
  /** Stops a running plugin's worker (a cancelled Apply); the next use starts it again. */
  stop(id: string): Promise<void>;
  /** A result through a plugin (its base picture when `result` is null); rejects with an AbortError when `signal` aborts. */
  run(req: PluginRunRequest, signal?: AbortSignal): Promise<PluginRunResult>;
  /** Whether a plugin has a base picture (decision 8: the preview before there is a result, the recipe cards). */
  hasBase(id: string): boolean;
  /** An image a render job made, through a plugin at its own size (decision 9). */
  runImage(req: PluginImageRequest, signal?: AbortSignal): Promise<PluginRunResult>;
  /** The recipe cards' pictures (PNG), each as it is ready: kept ones at once, missing ones made one at a time. */
  thumbnails(id: string, onThumb: (recipe: string | null, png: Blob) => void, signal?: AbortSignal): Promise<ThumbsOutcome>;
  /** A plugin's image as a file: PNG, or JPEG for a JPEG result, with the result's DPI. */
  encode(img: { width: number; height: number; rgba: Uint8ClampedArray }, format: 'PNG' | 'JPEG', dpi: number): Promise<Blob>;
}

/** The material editor's previews (M3a): a program on the preview sphere, run in a worker (render/graph-client.ts). */
export interface GraphPreviewPort {
  /**
   * The spheres of a program compiled with probes: one per probe and the material's own. A newer request on the same
   * `channel` supersedes an older one, which resolves to null.
   */
  previews(program: Program, channel: string): Promise<GraphPreviews | null>;
}

export interface GraphPreviews {
  /** Side of the probes' spheres, pixels. */
  size: number;
  /** RGBA, one per probe of the program, in order. */
  probes: Uint8ClampedArray[];
  /** The material's sphere, RGBA, `materialSize` square. */
  material: Uint8ClampedArray;
  materialSize: number;
}

/** O2: what the engine makes of a camera's traced lens (rt.wasm on the page, or the launcher's /api/lens/info). */
export interface LensPort {
  /**
   * The engine's numbers of `cam`'s traced lens for its output frame: null for the thin lens or when there is no
   * engine to ask, undefined when the engine refuses the lens (it forms no image).
   */
  info(cam: CameraState): Promise<EngineLensInfo | null | undefined>;
}

export interface AppServices {
  /** Null when WebGL is not available. */
  viewport: ViewportPort | null;
  /** A quick picture (`quick`: the preview) or a render at output size, encoded (the library's thumbnails). */
  renderImage(req: RenderRequest): Promise<Blob>;
  /** One image of a render job with the path tracer (never the preview), encoded as the job asks. */
  renderFrame(req: FrameRequest): Promise<FrameResult>;
  /** N1: encoded video (WebCodecs); absent, a video job cannot run and the window offers frames. */
  video?: VideoPort;
  /** The results history. */
  results: ResultsPort;
  /** Saving outputs. */
  files: FilesPort;
  /** N2: packs the files of a batch into a ZIP (the render window's ZIP switch); absent, the switch is not offered. */
  archive?: ArchivePort;
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
  /** Plugins (P6); absent or null in a build without them (tests). */
  plugins?: PluginsPort | null;
  /** The rigid body simulator (S2); null or absent where it cannot run (no Web Workers). */
  physics?: PhysicsPort | null;
  /** The material editor's node previews (M3a); absent or null where no worker runs them (the editor draws no spheres). */
  graphPreview?: GraphPreviewPort | null;
  /** The engine's numbers of a traced lens (O2); absent or null where no engine is at hand. */
  lens?: LensPort | null;
}

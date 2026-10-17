// Interface-only state: tabs, tools, drawers, panel widths, open menus...
// It is not part of the project (no undo, not saved in .repack); the
// parts worth remembering between sessions go to localStorage.

import type { LightStyle, MaterialCategory } from '../data/types';
import type { ImportMessage, ImportOptions, ImportPayload, ImportProgress } from '../core/import-options';
import { emptyLibrary, type Library } from '../core/library';
import type { MaterialId, MaterialInstance } from '../core/materials';
import type { FrameBox, LiveFrame } from '../core/live-frame';
import type { RenderSettings } from '../core/render';
import type { ResultMeta } from '../core/results';
import type { NodeId } from '../core/scene';
import type { ImageRef } from '../core/images';
import type { Space } from '../core/transform';
import type { ClipTarget } from '../core/animation';
import type { ViewObject } from '../core/view-objects';
import type { SectionAxis, SectionPick } from '../core/section';
import type { ConfirmSpec } from './components/widgets';
import type { MoveKind, EasingKind } from '../data/types';
import type { HardwareInfo, ModelsSnapshot } from '../core/models';
import type { PluginsSnapshot } from '../core/plugins';
import type { RuntimeWarning } from '../core/ai-runtimes';
import { defaultLayout, defaultSettings, type EditorRect, type Layout, type SectionId, type Settings, type ThumbSize } from '../core/settings';
import type { SetupGroup } from '../core/setup-groups';
import { NO_INSTALL, type InstallRequest, type InstallStatus, type ReleaseInfo, type UpdateFault } from '../core/updates';

export type SceneTab = 'parts' | 'cameras' | 'lights' | 'studios';
/** What the viewport shows (UI.md §2.1): the rasterised preview or the path tracer. */
export type ViewportMode = 'FAST' | 'FULL';
/** Whether the path tracer can run, and why not (main.ts finds out). */
export type EngineState = 'LOADING' | 'READY' | 'NO_WASM' | 'NO_WORKERS' | 'OUTDATED' | 'FAILED';
export type Tool = 'select' | 'orbit' | 'pan' | 'zoom' | 'move' | 'scale';
export const TOOLS: readonly Tool[] = ['select', 'orbit', 'pan', 'zoom', 'move', 'scale'];
export type Drawer = 'animation' | 'physics' | 'queue' | null;

/**
 * The physics bar (phase S2): what the simulation is doing, only as the simulator reports it (rule 10). STOPPED is
 * the default: nothing runs until the person starts it or drops something.
 */
export interface PhysicsUi {
  state: 'STOPPED' | 'STARTING' | 'RUNNING' | 'PAUSED';
  /** Simulated seconds of the run in progress, or of the last one. */
  time: number;
  awake: number;
  bodies: number;
  /** How the last run ended (null: none yet), or why it could not start. */
  ended: 'SETTLED' | 'STOPPED' | 'TIME' | 'NO_ENGINE' | 'FAILED' | 'NOTHING' | null;
  /** Reset has something to undo: a run in progress, or the last one's clips and poses. */
  canReset: boolean;
}
/**
 * The next click on the viewport picks something: the focus distance, where a light reflects, the pivot of
 * some nodes (phase U3), or the part whose material some parts link to.
 */
export type PickMode =
  /**
   * F1: focus on a point (the camera's Focus, Point), for `camera` (a camera's own inspector) or, without it, the camera
   * that is seen.
   */
  | { kind: 'focus'; camera?: string }
  /** F1: focus on an object, a part, group or model at the selection level (the camera's Focus, Object). */
  | { kind: 'focusObject'; camera?: string }
  | { kind: 'reflect'; light: string }
  /** L4: Place on surface (the light stands over the point along its normal) and Aim at… a point or a part. */
  | { kind: 'surface'; light: string }
  | { kind: 'aim'; light: string; part: boolean }
  | { kind: 'pivot'; ids: NodeId[] }
  | { kind: 'link'; parts: NodeId[] }
  /** Q1: the section plane, by a click and an axis, or by the two points of a line (the first, once clicked). */
  | { kind: 'section'; pick: SectionPick }
  | null;

/**
 * The label tool (M2a): `place` lays a new label of `image` on a part that carries `material` with a press (its
 * centre) and a drag (its width); `move` slides label `label` over the surface under the pointer. Esc leaves it.
 */
export type LabelTool =
  | { kind: 'place'; material: string; image: ImageRef }
  | { kind: 'move'; material: string; label: string }
  | null;

export interface Toast {
  id: number;
  text: string;
}

/** The "Add move" wizard (three questions, inline). */
export interface WizardState {
  target: ClipTarget | null;
  move: MoveKind | null;
  amount: number;
  start: number;
  duration: number;
  easing: EasingKind;
  shot: number | null;
  /** N1: the step on screen: 1 what moves, 2 how (the grid of kinds), 3 how much and for how long. Absent: 1. */
  step?: 1 | 2 | 3;
  /** N1: MATERIAL_COLOR and TINT: the colour it goes to, linear RGB. */
  color?: [number, number, number];
}

/** N1: the track codec of each container on this system (null: it cannot be encoded here). */
export type VideoSupportUi = { MP4: 'H264' | null; WEBM: 'VP9' | 'VP8' | null };

/**
 * Where the read of a CAD file (STEP, IGES) is. The sheet opens at once for them and says it: the reader
 * downloading (`loaded` of `total` bytes), starting, reading and tessellating, building parts, done (`ready`),
 * or `error` with the reason. `confirm` remembers an Import pressed before the file was read.
 */
export interface CadReadState {
  stage: ImportProgress['stage'] | 'ready' | 'error';
  loaded?: number;
  total?: number;
  /** The reason, in the interface language, when `stage` is `error`. */
  error?: string;
  confirm?: boolean;
}

/** A file that was read and waits for the import sheet (UI.md §2.3). The options are the sheet's current values. */
export interface PendingImport {
  /** Changes with every file, so the sheet is rebuilt for the next one and only then. */
  id: number;
  /** Changes when the payload is replaced (a CAD file read again at another quality), so the sheet is rebuilt. */
  rev?: number;
  name: string;
  format: string;
  /** The model as read; empty while a CAD file is still being read. */
  payload: ImportPayload;
  /** CAD files only: the read in progress. */
  cad?: CadReadState;
  warnings: ImportMessage[];
  notes: ImportMessage[];
  options: ImportOptions;
  /** Files dropped together with this one that are waiting for their turn. */
  queued: number;
}

/** The render window (UI.md §2.7): the project's settings, or a draft of one queued job's ("Edit"). */
export type RenderWindowState = { kind: 'NEW' } | { kind: 'EDIT'; jobId: string; draft: RenderSettings };

/** How the split-compare component shows its two images. */
export type SplitMode = 'A' | 'B' | 'SPLIT';

/** The results viewer over the viewport (UI.md §2.8). */
export interface ResultViewState {
  id: string;
  /** A second result shown with the split divider, or null. */
  compare: string | null;
  /** The AI variant compared with the render (X4b), 1-based; absent: the first with an image. */
  variant?: number;
  split: SplitMode;
  /** Divider position, 0..1 of the width. */
  position: number;
}

/**
 * U14: the results viewer's "in progress" mode over the viewport (UI.md §2.5, §2.8): the live view of a queue job that
 * renders or waits. `box`: the device pixels its picture is fitted in, as the viewer measured them (null before).
 */
export interface LiveViewState {
  jobId: string;
  box: FrameBox | null;
  /** A new number for each opening (`watchJob`): the first picture of an opening comes at once. */
  opened: number;
}

/** The Settings window (UI.md §2.9): the section shown, a row to bring into view, the first-run chooser. */
export interface SettingsWindowState {
  section: SectionId;
  /** A row id (`engine.threads`) or a part of a section (`ai.models`) to scroll to and highlight. */
  focus: string | null;
  /** Changes with every opening, so a deep link to the same row scrolls again. */
  nonce: number;
  /** The desktop portable's first start: the Models part as a chooser (one, several or none). */
  chooser?: boolean;
  /** The chooser's box for the inference runtime (phase U10): ticked unless the person unticked it. */
  chooserRuntime?: boolean;
}

/** The guided tour (phase U10): the step shown (an index into the steps this computer has), and how it started. */
export interface TourState {
  step: number;
  /** `first`: by itself at the first start; `menu`: Help ▸ Guided tour (or the palette, or `?tour=1`). */
  how: 'first' | 'menu';
}

/**
 * The note in the status bar about the inference runtime (phase U10): the application checks once at start whether
 * a model is installed and the runtime is not (or does not start), and says so quietly; *Later* dismisses it.
 */
export interface RuntimeNote {
  /** The check had its turn this session (it runs once). */
  checked: boolean;
  /** What to say; null: nothing (no problem, or dismissed). */
  warning: RuntimeWarning | null;
}

/** What Measure performance measured (Settings ▸ Render engine): real numbers of a real run. */
export interface PerfResult {
  width: number;
  height: number;
  /** Samples every pixel got. */
  samples: number;
  seconds: number;
  /** samples × pixels / seconds. */
  pixelSamplesPerSecond: number;
  /** How the engine ran: "3 workers · SIMD", "16 threads · avx2". */
  engine: string;
}

export type PerfState = { state: 'IDLE' } | { state: 'RUNNING'; startedAt: number; elapsed: number } | { state: 'DONE'; result: PerfResult } | { state: 'FAILED'; reason: string } | { state: 'STOPPED' };

/** The engine as Settings ▸ Render engine describes it (from the engine itself, never assumed). */
export interface EngineInfo {
  backend: 'wasm' | 'native';
  /** The engine's own version (rt_version, or the launcher's). */
  version: string | null;
  /** The build that runs: rt-simd.wasm or rt.wasm; the native SIMD path. */
  build: string;
  workers: number;
  /** What "Automatic" threads is here: one worker per logical core but one in the browser, every thread natively. */
  autoThreads: number;
  simd: boolean;
  /** What the browser supports, whatever runs. */
  simdSupported: boolean;
  /** Logical cores the system reports. */
  cores: number | null;
  /** D1: the engine can denoise (rt.wasm exports the denoiser; the native engine always can). Absent: not known. */
  denoise?: boolean;
  /** Desktop: the launcher's /api/info. */
  native?: { threads: number; isa: string; simd: string[]; os: string; arch: string; engineVersion: string };
}

/**
 * What draws the desktop window (the launcher's `/api/info` `window`, P3c): Repackshot's own window
 * (`webview2`, detail = its version), a browser's app window (`browser`, detail = the browser), the default
 * browser, or nothing; and why it is not our own window when it is not.
 */
export interface DesktopWindow {
  kind: 'webview2' | 'browser' | 'default' | 'none' | string;
  detail: string | null;
  reason: 'forced' | 'not-windows' | 'loader-missing' | 'runtime-missing' | 'failed' | string | null;
}

/** The desktop launcher, when the page runs in its window (Settings ▸ Desktop, Storage). */
export interface DesktopInfo {
  portable: boolean;
  dataDir: string;
  modelsDir: string;
  logsDir: string;
  browser: string | null;
  version: string;
  /** The launcher's `os` (`windows`, `linux`, `macos`) and `arch` (`x86_64`): which package updates this one. */
  os?: string;
  arch?: string;
  /**
   * What draws the window (`/api/info` `window`, phase P3c): `webview2` (its own window, `detail` the runtime's
   * version), `browser` (an app window, `detail` the browser), `default` or `none`. Null from a launcher before P3c
   * or with --serve-only.
   */
  window?: DesktopWindow | null;
  /** The launcher was started by an update (`--after-update`): the interface says so once (P5). */
  afterUpdate?: boolean;
}

/** An update being installed from inside the application (P5), as the launcher reports it. */
export interface InstallUi {
  status: InstallStatus;
  /** What was asked of the launcher: Try again sends it again. */
  request: InstallRequest | null;
  /** The new version is in place and the window did not close for it (the person said Cancel): Restart now offers it again. */
  deferred: boolean;
  /**
   * The project’s revision when the person answered the question about unsaved changes: the window closes without
   * asking again as long as the project is still as it was then, and asks when it is not. Null: never answered (a
   * page that was reloaded in the middle of an update).
   */
  answeredAt: number | null;
}

/** The update check in this session (Settings ▸ Updates, the notice in the status bar); not remembered. */
export interface UpdatesUi {
  /** A check is running. */
  checking: boolean;
  /** Why the last check of this session failed; null when it worked or none has run. */
  fault: UpdateFault | null;
  /** The check at startup has had its turn (it runs once, whatever the setting said). */
  startupDone: boolean;
  /** The release the status bar announces; null: no notice (none found, or dismissed with Later). */
  notice: ReleaseInfo | null;
  /** Versions announced in this session, dismissed or not: a version is announced once. */
  announced: string[];
  /** Installing a new version from inside the application (desktop only). */
  install: InstallUi;
}

/** What the queue runner is doing: nothing, the whole queue, or only the jobs Render started. */
/** The queue: not started, running every job, running Render's jobs, or paused (Resume goes on). */
export type QueueRun = 'IDLE' | 'ALL' | 'ONLY' | 'PAUSED';

export interface UiState {
  sceneTab: SceneTab;
  tool: Tool;
  drawer: Drawer;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftWidth: number;
  rightWidth: number;
  paletteOpen: boolean;
  /** Current guide step (0..5) or null when the guide is closed. */
  guideStep: number | null;
  catalogOpen: boolean;
  /** A category of the catalogue, or 'MINE': the user's own materials. */
  materialCategory: MaterialCategory | 'MINE';
  materialFilter: string;
  /**
   * The style filter of the Lights group of the light catalogue (L7): a style, 'ALL', or 'MINE' (the user's own
   * setups). 'SETS' is not a style of the Lights: setting it shows the Sets group (`lightGroup`).
   */
  lightStyle: LightStyle | 'ALL' | 'MINE';
  /** L7: the group of the light catalogue on show. */
  lightGroup: SetupGroup;
  /** L7: the filters of the Sets group chosen (`type`, `hero`; core/setup-groups.ts). */
  lightFilters: Record<string, string>;
  /** L7: the size of the light catalogue's thumbnails. */
  thumbSize: ThumbSize;
  treeFilter: string;
  /** Tree rows folded by the user (rows are unfolded by default). */
  folded: Record<NodeId, true>;
  hover: NodeId | null;
  pickMode: PickMode;
  /** M2a: placing or moving a label in the viewport. */
  labelTool: LabelTool;
  doctorOpen: boolean;
  menuOpen: boolean;
  /** Collapsed inspector sections, by id. */
  sections: Record<string, boolean>;
  tuneOpen: boolean;
  toasts: Toast[];
  /** Window narrower than 1100 px: side panels become drawers. */
  narrow: boolean;
  wizard: WizardState | null;
  /** Clip selected in the animation drawer: the one the properties edit (the last one picked). */
  selectedClip: string | null;
  /** N1: the shot of the camera track whose properties the drawer shows (a segment clicked), or null. */
  selectedShot: string | null;
  /** S4a: the ambient effect being edited in the scene's Ambient section (its region is drawn), or null. */
  effectSelected: string | null;
  /** S4a: the gallery of effect presets is open (Ambient ▸ Add). */
  effectGallery: boolean;
  /** Q1: the axis a click on the model cuts across (Section ▸ Cut across). */
  sectionAxis: SectionAxis;
  /**
   * N6: every clip selected in the timeline (the multiple selection, `selectedClip` among them). Code that only knows
   * `selectedClip` keeps working: the commands of ui/anim-commands.ts keep the two in step.
   */
  selectedClips: string[];
  /** N6: targets of the timeline folded by the user (their clips hidden; the row shows their bars). */
  animFolded: Record<string, true>;
  /** N6: the timeline's zoom, 1 = the whole animation fits. */
  animZoom: number;
  /** N6: playing goes back to the start at the end (on), or stops there. */
  animLoop: boolean;
  customResolution: boolean;
  /** A file is being dragged over the viewport. */
  fileDrag: boolean;
  /** Shortcut sheet open. */
  shortcutsOpen: boolean;
  /** Message line of the empty state (import progress or error). */
  importMessage: string | null;
  /** The import sheet, in the inspector, while a file waits for its options. */
  importSheet: PendingImport | null;
  /** Axes of the move tool. */
  space: Space;
  /** Scale fields keep their proportions. */
  scaleLock: boolean;
  /** Selection by box at the Faces level also takes the faces hidden behind others (X-ray). */
  boxXray: boolean;
  /** L4: the viewport draws every light's and saved camera's glyph (Lights and cameras in the view bar; remembered). */
  showGlyphs: boolean;
  /** L4: the light or saved camera the viewport looks through (Look through), or null: the active camera. */
  lookThrough: ViewObject | null;
  /** Copy material / Paste material: a snapshot of the copied instance. */
  materialClipboard: MaterialInstance | null;
  /**
   * The user's library (U4): user state like the theme, not part of the project and not undone. It lives here so
   * the catalogues, the palette and the commands read it like any other interface state; main.ts keeps it in
   * `localStorage` (io/library.ts) and the commands change it with the pure functions of core/library.ts.
   */
  library: Library;
  /** The mode the user chose (remembered); the viewport is in it when the engine allows. */
  viewportMode: ViewportMode;
  /** Whether Full can run. */
  engine: EngineState;
  renderWindow: RenderWindowState | null;
  /** Where the render window was dragged to (top left, CSS pixels); null: centred. */
  renderWindowPos: { x: number; y: number } | null;
  /** The material editor (M3a), open on one material; null: closed. */
  materialEditor: { material: MaterialId } | null;
  /** Where it was moved to and its size (remembered); null: centred at its own size. */
  materialEditorRect: EditorRect | null;
  resultView: ResultViewState | null;
  /** U14: the live view of a queue job (the results viewer in progress); null: closed. Never open with `resultView`. */
  liveView: LiveViewState | null;
  /** U14: the newest picture of the job in the live view, as the engine made it at the queue's cadence; null: none yet. */
  liveFrame: { jobId: string; frame: LiveFrame } | null;
  /** The results history, newest first (main.ts loads it from the browser's storage). */
  results: ResultMeta[];
  /** Whether the history survives the session. */
  resultsStorage: 'LOADING' | 'PERSISTENT' | 'MEMORY';
  /** Pixel-samples per second the engine reached on this machine (measured, never assumed); null until measured. */
  throughput: number | null;
  /**
   * N1: the codec each video container is encoded with on this system (WebCodecs, asked once at start: `VP9`, `VP8`,
   * `H264`), null for one it cannot encode; the whole field null until the browser has answered.
   */
  video: VideoSupportUi | null;
  /**
   * E10: what the Full view sampling adaptively to a noise target (a fraction) said: the seconds it takes to reach it
   * (those rendered and those it expects from its last pass) on `pixels` pixels; null until it said so.
   */
  noiseEstimate: { seconds: number; pixels: number; target: number } | null;
  /**
   * Pixels a second the AI post-processing of a final render took on this machine (X4b: measured around the last
   * request of a job, never assumed; the model's loading included when it loaded then); null until measured.
   */
  aiThroughput: number | null;
  queueRun: QueueRun;
  /** The application settings (core/settings.ts): not the project's, not undone. */
  settings: Settings;
  settingsWindow: SettingsWindowState | null;
  /** Where the Settings window was dragged to; null: centred. */
  settingsPos: { x: number; y: number } | null;
  /** The section of the Settings window opened last (remembered). */
  settingsSection: SectionId;
  /** The desktop portable's model chooser was shown (once). */
  chooserShown: boolean;
  /** The guided tour was finished or skipped (remembered): it starts by itself only until then. */
  tourSeen: boolean;
  /** The guided tour on screen, or null (not remembered). */
  tour: TourState | null;
  runtimeNote: RuntimeNote;
  /** When the update feed last answered (remembered), and the latest release it named. */
  updateCheckedAt: number | null;
  updateLatest: ReleaseInfo | null;
  updates: UpdatesUi;
  /** The model manager's view (null: no manager in this build or not started). */
  models: ModelsSnapshot | null;
  /** The plugin host's view (P6; null: no host in this build). */
  plugins: PluginsSnapshot | null;
  /** What was detected of this computer for the AI models. */
  hardware: { state: 'IDLE' | 'DETECTING' | 'DONE'; info: HardwareInfo | null };
  perf: PerfState;
  engineInfo: EngineInfo | null;
  /** E11: the preview's multisampling now and the most the device can do (Settings ▸ Edge smoothing says it); null before it starts. */
  fastAa: { samples: number; max: number } | null;
  desktop: DesktopInfo | null;
  /**
   * An inline confirmation the header shows under the project name (New and Open ask before they discard unsaved
   * changes, whichever way they were asked for: menu, shortcut or a dropped file). Esc cancels.
   */
  prompt: ConfirmSpec | null;
  /** The physics bar (phase S2). */
  physics: PhysicsUi;
}

/**
 * Whether the viewport draws every light's and saved camera's glyph (L4), or only the selected one's: Lights and
 * cameras is on, and the person is working with them (the Lights or the Cameras tab is open, a light or a camera
 * is selected, or the view is through one). Otherwise the glyphs stay out of the picture: a setup panel's outline
 * crossing the product (the key light is often between the camera and the part) must not read as part of it.
 */
export function drawAllGlyphs(u: Pick<UiState, 'showGlyphs' | 'sceneTab' | 'lookThrough'>, selected: unknown): boolean {
  return u.showGlyphs && (u.sceneTab === 'lights' || u.sceneTab === 'cameras' || selected !== null || u.lookThrough !== null);
}

/** The mode the viewport is in: Full only when chosen and the engine is ready. */
export function effectiveMode(u: Pick<UiState, 'viewportMode' | 'engine'>): ViewportMode {
  return u.viewportMode === 'FULL' && u.engine === 'READY' ? 'FULL' : 'FAST';
}

export type UiListener = (ui: UiState, prev: UiState) => void;

export interface UiStore {
  get(): UiState;
  set(patch: Partial<UiState>): void;
  subscribe(fn: UiListener): () => void;
  toast(text: string): void;
}

/** Interface state remembered between sessions, in the settings document's `layout` (core/settings.ts). */
const PERSISTED: readonly (keyof UiState & keyof Layout)[] = [
  'sceneTab',
  'leftWidth',
  'rightWidth',
  'leftCollapsed',
  'rightCollapsed',
  'sections',
  'lightStyle',
  'lightGroup',
  'lightFilters',
  'thumbSize',
  'materialCategory',
  'tuneOpen',
  'space',
  'scaleLock',
  'showGlyphs',
  'viewportMode',
  'settingsSection',
  'chooserShown',
  'tourSeen',
  'updateCheckedAt',
  'updateLatest',
  'materialEditorRect',
];

/** 'SETS' asked as a style (a URL, a document of before L7) is the Sets group, its Lights style at All. */
function withLightGroup(state: UiState): UiState {
  return (state.lightStyle as string) === 'SETS' ? { ...state, lightGroup: 'SETS', lightStyle: 'ALL' } : state;
}

export const PANEL_MIN = 220;
export const PANEL_MAX = 480;

export function defaultUiState(): UiState {
  return {
    sceneTab: 'parts',
    tool: 'select',
    drawer: null,
    leftCollapsed: false,
    rightCollapsed: false,
    leftWidth: 260,
    rightWidth: 340,
    paletteOpen: false,
    guideStep: null,
    catalogOpen: false,
    materialCategory: 'METAL',
    materialFilter: '',
    lightStyle: 'ALL',
    lightGroup: 'SETS',
    lightFilters: {},
    thumbSize: 'M',
    treeFilter: '',
    folded: {},
    hover: null,
    pickMode: null,
    labelTool: null,
    doctorOpen: false,
    menuOpen: false,
    sections: {},
    tuneOpen: false,
    toasts: [],
    narrow: false,
    wizard: null,
    selectedClip: null,
    selectedShot: null,
    effectSelected: null,
    effectGallery: false,
    sectionAxis: 'Z',
    selectedClips: [],
    animFolded: {},
    animZoom: 1,
    animLoop: true,
    customResolution: false,
    fileDrag: false,
    shortcutsOpen: false,
    importMessage: null,
    importSheet: null,
    space: 'GLOBAL',
    scaleLock: true,
    boxXray: false,
    showGlyphs: true,
    lookThrough: null,
    materialClipboard: null,
    library: emptyLibrary(),
    viewportMode: 'FULL',
    engine: 'LOADING',
    renderWindow: null,
    renderWindowPos: null,
    materialEditor: null,
    materialEditorRect: null,
    resultView: null,
    liveView: null,
    liveFrame: null,
    results: [],
    resultsStorage: 'LOADING',
    throughput: null,
    video: null,
    noiseEstimate: null,
    aiThroughput: null,
    queueRun: 'IDLE',
    settings: defaultSettings(),
    settingsWindow: null,
    settingsPos: null,
    settingsSection: 'general',
    chooserShown: false,
    tourSeen: false,
    tour: null,
    runtimeNote: { checked: false, warning: null },
    updateCheckedAt: null,
    updateLatest: null,
    updates: { checking: false, fault: null, startupDone: false, notice: null, announced: [], install: { status: NO_INSTALL, request: null, deferred: false, answeredAt: null } },
    models: null,
    plugins: null,
    hardware: { state: 'IDLE', info: null },
    perf: { state: 'IDLE' },
    engineInfo: null,
    fastAa: null,
    desktop: null,
    prompt: null,
    physics: { state: 'STOPPED', time: 0, awake: 0, bodies: 0, ended: null, canReset: false },
  };
}

export interface UiStoreOptions {
  /** The remembered interface state (the settings document's layout); factory values without one. */
  layout?: Layout;
  /** Called with what changed of the remembered state, to save it. */
  onLayout?: (patch: Partial<Layout>) => void;
}

export function createUiStore(initial: Partial<UiState> = {}, opts: UiStoreOptions = {}): UiStore {
  const base = defaultUiState();
  const layout = opts.layout ?? defaultLayout();
  const restored: Partial<UiState> = {};
  for (const k of PERSISTED) (restored as Record<string, unknown>)[k] = layout[k];
  let state: UiState = { ...base, ...restored, ...initial };
  state.leftWidth = Math.min(PANEL_MAX, Math.max(PANEL_MIN, state.leftWidth));
  state.rightWidth = Math.min(PANEL_MAX, Math.max(PANEL_MIN, state.rightWidth));
  if (state.viewportMode !== 'FAST' && state.viewportMode !== 'FULL') state.viewportMode = 'FULL';
  state = withLightGroup(state);
  const listeners = new Set<UiListener>();
  let toastId = 0;
  const store: UiStore = {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const k of Object.keys(patch) as (keyof UiState)[]) if (state[k] !== patch[k]) changed = true;
      if (!changed) return;
      const prev = state;
      state = withLightGroup({ ...state, ...patch });
      if (opts.onLayout) {
        const saved: Partial<Layout> = {};
        let any = false;
        for (const k of PERSISTED)
          if (state[k] !== prev[k]) {
            (saved as Record<string, unknown>)[k] = state[k];
            any = true;
          }
        if (any) opts.onLayout(saved);
      }
      for (const fn of [...listeners]) fn(state, prev);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    toast(text) {
      const id = ++toastId;
      store.set({ toasts: [...state.toasts.slice(-2), { id, text }] });
      setTimeout(() => store.set({ toasts: state.toasts.filter((x) => x.id !== id) }), 4200);
    },
  };
  return store;
}

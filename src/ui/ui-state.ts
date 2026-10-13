// Interface-only state: tabs, tools, drawers, panel widths, open menus...
// It is not part of the project (no undo, not saved in .repack.json); the
// parts worth remembering between sessions go to localStorage.

import type { LightStyle, MaterialCategory } from '../data/types';
import type { ImportMessage, ImportOptions, ImportPayload, ImportProgress } from '../core/import-options';
import { emptyLibrary, type Library } from '../core/library';
import type { MaterialInstance } from '../core/materials';
import type { RenderSettings } from '../core/render';
import type { ResultMeta } from '../core/results';
import type { NodeId } from '../core/scene';
import type { Space } from '../core/transform';
import type { ClipTarget } from '../core/animation';
import type { ViewObject } from '../core/view-objects';
import type { ConfirmSpec } from './components/widgets';
import type { MoveKind, EasingKind } from '../data/types';
import type { HardwareInfo, ModelsSnapshot } from '../core/models';
import { defaultLayout, defaultSettings, type Layout, type SectionId, type Settings } from '../core/settings';
import type { ReleaseInfo, UpdateFault } from '../core/updates';

export type SceneTab = 'parts' | 'cameras' | 'lights' | 'studios';
/** What the viewport shows (UI.md §2.1): the rasterised preview or the path tracer. */
export type ViewportMode = 'FAST' | 'FULL';
/** Whether the path tracer can run, and why not (main.ts finds out). */
export type EngineState = 'LOADING' | 'READY' | 'NO_WASM' | 'NO_WORKERS' | 'OUTDATED' | 'FAILED';
export type Tool = 'select' | 'orbit' | 'pan' | 'zoom' | 'move' | 'scale';
export const TOOLS: readonly Tool[] = ['select', 'orbit', 'pan', 'zoom', 'move', 'scale'];
export type Drawer = 'animation' | 'queue' | null;
/**
 * The next click on the viewport picks something: the focus distance, where a light reflects, the pivot of
 * some nodes (phase U3), or the part whose material some parts link to.
 */
export type PickMode =
  | { kind: 'focus' }
  | { kind: 'reflect'; light: string }
  /** L4: Place on surface (the light stands over the point along its normal) and Aim at… a point or a part. */
  | { kind: 'surface'; light: string }
  | { kind: 'aim'; light: string; part: boolean }
  | { kind: 'pivot'; ids: NodeId[] }
  | { kind: 'link'; parts: NodeId[] }
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
}

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
  split: SplitMode;
  /** Divider position, 0..1 of the width. */
  position: number;
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
  /** A style of the catalogue, 'ALL', or 'MINE': the user's own setups. */
  lightStyle: LightStyle | 'ALL' | 'MINE';
  treeFilter: string;
  /** Tree rows folded by the user (rows are unfolded by default). */
  folded: Record<NodeId, true>;
  hover: NodeId | null;
  pickMode: PickMode;
  doctorOpen: boolean;
  menuOpen: boolean;
  /** Collapsed inspector sections, by id. */
  sections: Record<string, boolean>;
  tuneOpen: boolean;
  toasts: Toast[];
  /** Window narrower than 1100 px: side panels become drawers. */
  narrow: boolean;
  wizard: WizardState | null;
  /** Clip selected in the animation drawer. */
  selectedClip: string | null;
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
  resultView: ResultViewState | null;
  /** The results history, newest first (main.ts loads it from the browser's storage). */
  results: ResultMeta[];
  /** Whether the history survives the session. */
  resultsStorage: 'LOADING' | 'PERSISTENT' | 'MEMORY';
  /** Pixel-samples per second the engine reached on this machine (measured, never assumed); null until measured. */
  throughput: number | null;
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
  /** When the update feed last answered (remembered), and the latest release it named. */
  updateCheckedAt: number | null;
  updateLatest: ReleaseInfo | null;
  updates: UpdatesUi;
  /** The model manager's view (null: no manager in this build or not started). */
  models: ModelsSnapshot | null;
  /** What was detected of this computer for the AI models. */
  hardware: { state: 'IDLE' | 'DETECTING' | 'DONE'; info: HardwareInfo | null };
  perf: PerfState;
  engineInfo: EngineInfo | null;
  desktop: DesktopInfo | null;
  /**
   * An inline confirmation the header shows under the project name (New and Open ask before they discard unsaved
   * changes, whichever way they were asked for: menu, shortcut or a dropped file). Esc cancels.
   */
  prompt: ConfirmSpec | null;
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
  'materialCategory',
  'tuneOpen',
  'space',
  'scaleLock',
  'showGlyphs',
  'viewportMode',
  'settingsSection',
  'chooserShown',
  'updateCheckedAt',
  'updateLatest',
];

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
    treeFilter: '',
    folded: {},
    hover: null,
    pickMode: null,
    doctorOpen: false,
    menuOpen: false,
    sections: {},
    tuneOpen: false,
    toasts: [],
    narrow: false,
    wizard: null,
    selectedClip: null,
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
    resultView: null,
    results: [],
    resultsStorage: 'LOADING',
    throughput: null,
    queueRun: 'IDLE',
    settings: defaultSettings(),
    settingsWindow: null,
    settingsPos: null,
    settingsSection: 'general',
    chooserShown: false,
    updateCheckedAt: null,
    updateLatest: null,
    updates: { checking: false, fault: null, startupDone: false, notice: null, announced: [] },
    models: null,
    hardware: { state: 'IDLE', info: null },
    perf: { state: 'IDLE' },
    engineInfo: null,
    desktop: null,
    prompt: null,
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
  const listeners = new Set<UiListener>();
  let toastId = 0;
  const store: UiStore = {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const k of Object.keys(patch) as (keyof UiState)[]) if (state[k] !== patch[k]) changed = true;
      if (!changed) return;
      const prev = state;
      state = { ...state, ...patch };
      if (opts.onLayout) {
        const saved: Partial<Layout> = {};
        let any = false;
        for (const k of PERSISTED)
          if (k in patch && state[k] !== prev[k]) {
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

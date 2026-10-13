// Interface-only state: tabs, tools, drawers, panel widths, open menus...
// It is not part of the project (no undo, not saved in .repack.json); the
// parts worth remembering between sessions go to localStorage.

import type { LightStyle, MaterialCategory } from '../data/types';
import type { ImportMessage, ImportOptions, ImportPayload } from '../core/import-options';
import { emptyLibrary, type Library } from '../core/library';
import type { MaterialInstance } from '../core/materials';
import type { NodeId } from '../core/scene';
import type { Space } from '../core/transform';
import type { ClipTarget } from '../core/animation';
import type { MoveKind, EasingKind } from '../data/types';
import { readPref, writePref } from './prefs';

export type SceneTab = 'parts' | 'cameras' | 'lights' | 'studios';
export type Tool = 'select' | 'orbit' | 'pan' | 'zoom' | 'move';
export const TOOLS: readonly Tool[] = ['select', 'orbit', 'pan', 'zoom', 'move'];
export type Drawer = 'animation' | 'queue' | null;
/**
 * The next click on the viewport picks something: the focus distance, where a light reflects, the pivot of
 * some nodes (phase U3), or the part whose material some parts link to.
 */
export type PickMode =
  | { kind: 'focus' }
  | { kind: 'reflect'; light: string }
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

/** A file that was read and waits for the import sheet (UI.md §2.3). The options are the sheet's current values. */
export interface PendingImport {
  /** Changes with every file, so the sheet is rebuilt for the next one and only then. */
  id: number;
  name: string;
  format: string;
  payload: ImportPayload;
  warnings: ImportMessage[];
  notes: ImportMessage[];
  options: ImportOptions;
  /** Files dropped together with this one that are waiting for their turn. */
  queued: number;
}

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
  /** Copy material / Paste material: a snapshot of the copied instance. */
  materialClipboard: MaterialInstance | null;
  /**
   * The user's library (U4): user state like the theme, not part of the project and not undone. It lives here so
   * the catalogues, the palette and the commands read it like any other interface state; main.ts keeps it in
   * `localStorage` (io/library.ts) and the commands change it with the pure functions of core/library.ts.
   */
  library: Library;
}

export type UiListener = (ui: UiState, prev: UiState) => void;

export interface UiStore {
  get(): UiState;
  set(patch: Partial<UiState>): void;
  subscribe(fn: UiListener): () => void;
  toast(text: string): void;
}

const PERSISTED: readonly (keyof UiState)[] = [
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
    materialClipboard: null,
    library: emptyLibrary(),
  };
}

export function createUiStore(initial: Partial<UiState> = {}): UiStore {
  const base = defaultUiState();
  const restored: Partial<UiState> = {};
  for (const k of PERSISTED) (restored as Record<string, unknown>)[k] = readPref(`ui.${k}`, base[k]);
  let state: UiState = { ...base, ...restored, ...initial };
  state.leftWidth = Math.min(PANEL_MAX, Math.max(PANEL_MIN, state.leftWidth));
  state.rightWidth = Math.min(PANEL_MAX, Math.max(PANEL_MIN, state.rightWidth));
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
      for (const k of PERSISTED) if (k in patch) writePref(`ui.${k}`, state[k]);
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

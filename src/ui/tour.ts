// The guided tour (phase U10, UI.md §4.7): our own overlay that walks the person through the screen, area by area, in
// the order of the roadmap: the app menu, the tree and the selection levels, the view tools, Fast and Full, the
// inspector (product, light and setups, environment and sky, camera and focus, materials), the Lights, Cameras and
// Studios tabs, Add ▸ Primitive, the render window (queue, AI), the results, and Settings by section.
//
// This file is the tour without the pictures: the steps as data, what each one needs on screen (`TourStage`), the
// rules for starting, and the commands that run it (start, next, back, end). The overlay that draws it is
// panels/tour.ts. A step highlights the first of its `targets` ([data-guide] anchors) that is shown; a step whose
// area is not on screen first puts it there (a tab, a side panel, the render window, Settings, the queue drawer, a
// selection) and the tour puts everything back when it ends. Skipping, finishing and Escape all count as seen: the
// tour starts by itself only until then (it is remembered with the interface's other state, `tourSeen`), and
// Help ▸ Guided tour brings it back.

import { allParts, type NodeId, type SelectionLevel } from '../core/scene';
import type { SectionId } from '../core/settings';
import * as cmd from './commands';
import { dyn } from './names';
import type { Ctx } from './reactive';
import { kbdFor } from './shortcuts';
import { t, type StringKey } from './strings';
import type { Drawer, SceneTab, UiState, UiStore } from './ui-state';

export type TourChapter = 'welcome' | 'app' | 'scene' | 'view' | 'inspector' | 'render' | 'settings' | 'done';

/** What a step needs on screen before its area can be shown. What a stage does not name is as the person left it. */
export interface TourStage {
  /** The Scene panel's tab. */
  sceneTab?: SceneTab;
  /** A side panel that must be open (in a narrow window it floats over the viewport, and the other one is closed). */
  panel?: 'left' | 'right';
  /** The inspector's content: the scene (nothing selected) or the first part (its materials). */
  inspector?: 'scene' | 'part';
  /** The render window, open. */
  renderWindow?: true;
  /** The Settings window, open at a section. */
  settings?: SectionId;
  /** A drawer of the bottom bar, open. */
  drawer?: Exclude<Drawer, null>;
  /** The material catalogue of the inspector, open (it is folded until *Change* is pressed). */
  catalog?: true;
}

export interface TourStep {
  /** Stable. */
  id: string;
  chapter: TourChapter;
  /** `data-guide` anchors: the first one that is on screen is highlighted. None: a card in the middle of the screen. */
  targets: readonly string[];
  stage?: TourStage;
  /** The step exists only where this holds: a viewport to talk about, or the desktop application. */
  when?: 'viewport' | 'desktop';
  title: StringKey;
  text: StringKey;
  /** `{name}` placeholders of the title and the text, worded when the step is shown. */
  params?: Record<string, () => string>;
}

const SETTINGS_SECTIONS: readonly SectionId[] = ['general', 'preferences', 'accessibility', 'shortcuts', 'engine', 'ai', 'storage', 'desktop', 'updates', 'about'];

/** The steps, in order. Adding one is adding a row here and its two strings. */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome', chapter: 'welcome', targets: [], title: 'tour.welcome.title', text: 'tour.welcome.text' },
  { id: 'menu', chapter: 'app', targets: ['app-menu'], title: 'tour.menu.title', text: 'tour.menu.text', params: { kbd: () => kbdFor('palette') } },
  { id: 'parts', chapter: 'scene', targets: ['parts-tab'], stage: { sceneTab: 'parts', panel: 'left' }, title: 'tour.parts.title', text: 'tour.parts.text' },
  { id: 'levels', chapter: 'scene', targets: ['levels'], stage: { sceneTab: 'parts', panel: 'left' }, title: 'tour.levels.title', text: 'tour.levels.text' },
  { id: 'tools', chapter: 'view', targets: ['tools'], when: 'viewport', title: 'tour.tools.title', text: 'tour.tools.text', params: { frame: () => kbdFor('frame') } },
  // Fast · Full and, next to it, the live denoise of Full (U11): one area of the top bar.
  { id: 'mode', chapter: 'view', targets: ['viewport-mode'], title: 'tour.mode.title', text: 'tour.mode.text', params: { denoise: () => kbdFor('viewportDenoise') } },
  { id: 'product', chapter: 'inspector', targets: ['section-product'], stage: { panel: 'right', inspector: 'scene' }, title: 'tour.product.title', text: 'tour.product.text' },
  { id: 'light', chapter: 'inspector', targets: ['section-light'], stage: { panel: 'right', inspector: 'scene' }, title: 'tour.light.title', text: 'tour.light.text' },
  { id: 'environment', chapter: 'inspector', targets: ['section-environment'], stage: { panel: 'right', inspector: 'scene' }, title: 'tour.environment.title', text: 'tour.environment.text' },
  { id: 'camera', chapter: 'inspector', targets: ['section-camera'], stage: { panel: 'right', inspector: 'scene' }, title: 'tour.camera.title', text: 'tour.camera.text' },
  // With no part to select (an empty project) the catalogue is not there: the inspector itself is shown, and says so.
  { id: 'material', chapter: 'inspector', targets: ['material', 'inspector'], stage: { panel: 'right', inspector: 'part', catalog: true }, title: 'tour.material.title', text: 'tour.material.text' },
  { id: 'lights', chapter: 'scene', targets: ['scene-panel'], stage: { sceneTab: 'lights', panel: 'left' }, title: 'tour.lights.title', text: 'tour.lights.text' },
  { id: 'cameras', chapter: 'scene', targets: ['scene-panel'], stage: { sceneTab: 'cameras', panel: 'left' }, title: 'tour.cameras.title', text: 'tour.cameras.text' },
  { id: 'studios', chapter: 'scene', targets: ['scene-panel'], stage: { sceneTab: 'studios', panel: 'left' }, title: 'tour.studios.title', text: 'tour.studios.text' },
  { id: 'add', chapter: 'scene', targets: ['add-primitive'], stage: { sceneTab: 'parts', panel: 'left' }, title: 'tour.add.title', text: 'tour.add.text' },
  { id: 'render', chapter: 'render', targets: ['render'], title: 'tour.render.title', text: 'tour.render.text', params: { kbd: () => kbdFor('render') } },
  { id: 'render-window', chapter: 'render', targets: ['render-window'], stage: { renderWindow: true }, title: 'tour.renderWindow.title', text: 'tour.renderWindow.text' },
  { id: 'render-queue', chapter: 'render', targets: ['rw-actions'], stage: { renderWindow: true }, title: 'tour.renderQueue.title', text: 'tour.renderQueue.text' },
  { id: 'render-ai', chapter: 'render', targets: ['section-rw.ai'], stage: { renderWindow: true }, title: 'tour.renderAi.title', text: 'tour.renderAi.text' },
  { id: 'results', chapter: 'render', targets: ['history'], stage: { drawer: 'queue' }, title: 'tour.results.title', text: 'tour.results.text' },
  ...SETTINGS_SECTIONS.map(
    (id): TourStep => ({
      id: `settings-${id}`,
      chapter: 'settings',
      targets: ['settings-content'],
      stage: { settings: id },
      when: id === 'desktop' ? 'desktop' : undefined,
      title: 'tour.settings.title',
      text: dyn(`set.sec.${id}.desc`),
      params: { section: () => t(dyn(`set.sec.${id}`)) },
    }),
  ),
  { id: 'done', chapter: 'done', targets: [], title: 'tour.done.title', text: 'tour.done.text' },
];

/** The steps this computer has: the desktop's section only in the desktop application, the viewport's only with a viewport. */
export function tourSteps(ctx: Pick<Ctx, 'ui' | 'services'>): TourStep[] {
  const desktop = ctx.ui.get().desktop !== null;
  const viewport = ctx.services.viewport !== null && ctx.services.viewport !== undefined;
  return TOUR_STEPS.filter((s) => (s.when === 'desktop' ? desktop : s.when === 'viewport' ? viewport : true));
}

/** The words of a step in the interface language. */
export function stepWords(step: TourStep): { title: string; text: string } {
  const params: Record<string, string> = {};
  for (const [k, fn] of Object.entries(step.params ?? {})) params[k] = fn();
  return { title: t(step.title, params), text: t(step.text, params) };
}

// ------------------------------------------------------------------ what is on screen

/** An element that can be seen: it has a box, and it and its ancestors are not hidden or collapsed. */
export function isShown(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.getClientRects().length === 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

/** The first anchor of the step that is on screen, the first of the document order when several carry it. */
export function findTarget(step: Pick<TourStep, 'targets'>, root: ParentNode = document): HTMLElement | null {
  for (const name of step.targets) {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-guide="${name}"]`)) if (isShown(el)) return el;
  }
  return null;
}

// ------------------------------------------------------------------ starting

/**
 * Whether the tour starts by itself at the start: the person has not seen it, and nobody is driving the page (a test
 * or a screenshot: `navigator.webdriver`), unless the address says otherwise: `?tour=0` never, `?tour=auto` as a first
 * start would (automation included), `?tour=1` (handled by `maybeStartTour`) at once.
 */
export function startsByItself(o: { seen: boolean; automated: boolean; param?: 'auto' | '0' | '1' | null }): boolean {
  if (o.param === '0') return false;
  if (o.param === 'auto') return !o.seen;
  return !o.seen && !o.automated;
}

/** What the baseline of a tour is: the interface as the person left it, to put back. */
interface Baseline {
  sceneTab: SceneTab;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  drawer: Drawer;
  catalogOpen: boolean;
  settingsSection: SectionId;
  selection: { level: SelectionLevel; ids: NodeId[]; faces?: { part: NodeId; indices: number[] } };
}

const baselines = new WeakMap<UiStore, Baseline>();

function snapshot(ctx: Ctx): Baseline {
  const u = ctx.ui.get();
  const sel = ctx.store.get().selection;
  return {
    sceneTab: u.sceneTab,
    leftCollapsed: u.leftCollapsed,
    rightCollapsed: u.rightCollapsed,
    drawer: u.drawer,
    catalogOpen: u.catalogOpen,
    settingsSection: u.settingsSection,
    selection: { level: sel.level, ids: [...sel.ids], ...(sel.faces ? { faces: { part: sel.faces.part, indices: [...sel.faces.indices] } } : {}) },
  };
}

/** Starts the tour at its first step; false when one is already running. The windows that would sit on it close. */
export function startTour(ctx: Ctx, how: 'first' | 'menu'): boolean {
  if (ctx.ui.get().tour) return false;
  baselines.set(ctx.ui, snapshot(ctx));
  ctx.ui.set({ tour: { step: 0, how }, paletteOpen: false, guideStep: null, pickMode: null, renderWindow: null, settingsWindow: null, resultView: null });
  applyStage(ctx, tourSteps(ctx)[0]?.stage);
  return true;
}

/** Starts the tour by itself when `startsByItself` says so; with a window open (the portable's chooser) it waits for it to close. */
export function maybeStartTour(ctx: Ctx, o: { automated: boolean; param?: 'auto' | '0' | '1' | null }): void {
  if (o.param === '1') {
    startTour(ctx, 'menu');
    return;
  }
  if (!startsByItself({ seen: ctx.ui.get().tourSeen, automated: o.automated, param: o.param })) return;
  const busy = (u: UiState) => u.settingsWindow !== null || u.renderWindow !== null || u.tour !== null;
  if (!busy(ctx.ui.get())) {
    startTour(ctx, 'first');
    return;
  }
  // The first start of a portable opens the model chooser: the tour comes when it is closed.
  const off = ctx.ui.subscribe((u) => {
    if (u.tourSeen || u.tour) return off();
    if (!busy(u)) {
      off();
      startTour(ctx, 'first');
    }
  });
}

// ------------------------------------------------------------------ moving

/** Shows step `index` (clamped), putting on screen what it needs. */
export function goToStep(ctx: Ctx, index: number): void {
  const steps = tourSteps(ctx);
  const tour = ctx.ui.get().tour;
  if (!tour) return;
  const step = Math.max(0, Math.min(steps.length - 1, index));
  // What the step needs first, then the step: the overlay measures the area only when it is there.
  applyStage(ctx, steps[step]?.stage);
  ctx.ui.set({ tour: { ...tour, step } });
}

/** Next; after the last step the tour ends. */
export function tourNext(ctx: Ctx): void {
  const tour = ctx.ui.get().tour;
  if (!tour) return;
  if (tour.step >= tourSteps(ctx).length - 1) endTour(ctx);
  else goToStep(ctx, tour.step + 1);
}

export function tourBack(ctx: Ctx): void {
  const tour = ctx.ui.get().tour;
  if (tour && tour.step > 0) goToStep(ctx, tour.step - 1);
}

/** Skip, Done and Escape: everything goes back as the person left it, and the tour counts as seen. */
export function endTour(ctx: Ctx): void {
  if (!ctx.ui.get().tour) return;
  const base = baselines.get(ctx.ui);
  baselines.delete(ctx.ui);
  ctx.ui.set({ tour: null, tourSeen: true, renderWindow: null, settingsWindow: null });
  if (!base) return;
  ctx.ui.set({ sceneTab: base.sceneTab, leftCollapsed: base.leftCollapsed, rightCollapsed: base.rightCollapsed, drawer: base.drawer, catalogOpen: base.catalogOpen, settingsSection: base.settingsSection });
  restoreSelection(ctx, base.selection);
}

// ------------------------------------------------------------------ the stage

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function restoreSelection(ctx: Ctx, want: Baseline['selection']): void {
  const now = ctx.store.get().selection;
  if (now.level === want.level && sameIds(now.ids, want.ids) && !now.faces === !want.faces) return;
  ctx.store.dispatch({ type: 'scene/select', ids: want.ids, mode: 'set', level: want.level });
  if (want.faces) ctx.store.dispatch({ type: 'scene/selectFaces', part: want.faces.part, indices: want.faces.indices, mode: 'set' });
}

/**
 * Puts on screen what a step needs, from the interface as it was when the tour began: the tab, the panel, the render
 * window or Settings, the drawer, the selection. What the stage does not ask for goes back to the baseline, so moving
 * between steps never leaves a window open behind. Selection changes are not undoable and do not touch the project.
 */
export function applyStage(ctx: Ctx, stage: TourStage | undefined): void {
  const base = baselines.get(ctx.ui);
  if (!base || !ctx.ui.get().tour) return;
  const st = stage ?? {};
  const u = ctx.ui.get();
  const narrow = u.narrow;
  // The Settings window is its own call (it remembers the section; the tour puts that back at the end).
  if (st.settings) {
    if (u.settingsWindow?.section !== st.settings) cmd.openSettings(ctx, st.settings);
  }
  ctx.ui.set({
    sceneTab: st.sceneTab ?? base.sceneTab,
    leftCollapsed: st.panel === 'left' ? false : narrow ? true : base.leftCollapsed,
    rightCollapsed: st.panel === 'right' ? false : narrow ? true : base.rightCollapsed,
    drawer: st.drawer ?? base.drawer,
    catalogOpen: st.catalog ? true : base.catalogOpen,
    renderWindow: st.renderWindow ? (ctx.ui.get().renderWindow ?? { kind: 'NEW' }) : null,
    ...(st.settings ? {} : { settingsWindow: null }),
  });
  if (st.inspector === 'scene') restoreSelection(ctx, { level: base.selection.level, ids: [] });
  else if (st.inspector === 'part') {
    const first = allParts(ctx.store.get())[0];
    if (first) {
      const now = ctx.store.get().selection;
      if (!(now.ids.length === 1 && now.ids[0] === first)) ctx.store.dispatch({ type: 'scene/select', ids: [first], mode: 'set', level: 'PART' });
    } else restoreSelection(ctx, { level: base.selection.level, ids: [] });
  } else restoreSelection(ctx, base.selection);
}

// ------------------------------------------------------------------ keys

/** What a key does in the tour: the arrows move, Escape ends it; any other key does nothing (the tour is modal). */
export function tourKeyAction(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): 'next' | 'back' | 'end' | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') return 'next';
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') return 'back';
  if (e.key === 'Escape') return 'end';
  return null;
}

// ------------------------------------------------------------------ where the card goes

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CardPlace = 'center' | 'right' | 'left' | 'below' | 'above' | 'inside';

/**
 * Where the step's card goes (screen pixels): beside the area it talks about without covering it, on the side that has
 * room (to the right of an area on the left half of the screen, to its left on the right half, below or above a wide
 * one; a block in a side column prefers its sides, a button in a bar prefers below or above), or in the middle of the
 * screen when there is no area. `avoid` is the window the area is in (the render window, Settings): the card stays
 * outside it when it can. An area too large to leave room gets the card inside it: where it covers no control, if
 * `controls` (the boxes of the buttons, fields and switches of the window, asked for only then) leaves such a spot
 * (the nearest one to the area's bottom right), else at the area's bottom right, where it hides the least. Always
 * inside the screen.
 */
export function placeCard(
  target: Box | null,
  card: { w: number; h: number },
  view: { w: number; h: number },
  avoid: Box | null = null,
  gap = 14,
  margin = 10,
  controls?: () => Box[],
): { x: number; y: number; where: CardPlace } {
  const clampX = (x: number) => Math.max(margin, Math.min(view.w - card.w - margin, x));
  const clampY = (y: number) => Math.max(margin, Math.min(view.h - card.h - margin, y));
  if (!target) return { x: clampX((view.w - card.w) / 2), y: clampY((view.h - card.h) / 2), where: 'center' };
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const at: Record<'right' | 'left' | 'below' | 'above', { x: number; y: number }> = {
    right: { x: target.x + target.w + gap, y: clampY(cy - card.h / 2) },
    left: { x: target.x - gap - card.w, y: clampY(cy - card.h / 2) },
    below: { x: clampX(cx - card.w / 2), y: target.y + target.h + gap },
    above: { x: clampX(cx - card.w / 2), y: target.y - gap - card.h },
  };
  // Beside a window, not over it: the same sides, measured from the window.
  if (avoid) {
    at.right.x = Math.max(at.right.x, avoid.x + avoid.w + gap);
    at.left.x = Math.min(at.left.x, avoid.x - gap - card.w);
    at.below.y = Math.max(at.below.y, avoid.y + avoid.h + gap);
    at.above.y = Math.min(at.above.y, avoid.y - gap - card.h);
  }
  const fits = (w: 'right' | 'left' | 'below' | 'above') => {
    const p = at[w];
    return p.x >= margin && p.y >= margin && p.x + card.w <= view.w - margin && p.y + card.h <= view.h - margin;
  };
  const sides: ('right' | 'left')[] = cx < view.w / 2 ? ['right', 'left'] : ['left', 'right'];
  const verticals: ('below' | 'above')[] = cy < view.h / 2 ? ['below', 'above'] : ['above', 'below'];
  // A tall area, or a block in a side column, has its sides free; a bar or a button, its top and bottom.
  const sideFirst = target.h > target.w * 1.2 || (target.h > 120 && target.w < view.w * 0.45);
  const where = (sideFirst ? [...sides, ...verticals] : [...verticals, ...sides]).find(fits);
  if (where) return { ...at[where], where };
  const corner = { x: clampX(target.x + target.w - card.w - gap), y: clampY(target.y + target.h - card.h - gap) };
  const free = controls ? clearSpot(avoid ?? target, card, corner, controls(), clampX, clampY) : null;
  return { ...(free ?? corner), where: 'inside' };
}

/** How far apart the candidate positions are tried. */
const SCAN_STEP = 16;

/**
 * Inside `region`, a place for the card that covers none of the `boxes`, the nearest to `corner`; null when every place
 * covers one (a section full of controls).
 */
function clearSpot(region: Box, card: { w: number; h: number }, corner: { x: number; y: number }, boxes: readonly Box[], clampX: (x: number) => number, clampY: (y: number) => number): { x: number; y: number } | null {
  const covers = (x: number, y: number) => boxes.some((b) => x < b.x + b.w && b.x < x + card.w && y < b.y + b.h && b.y < y + card.h);
  const x0 = clampX(region.x);
  const y0 = clampY(region.y);
  // From the corner towards the top left (the corner itself first); the nearest place that covers no box wins.
  let best: { x: number; y: number } | null = null;
  let nearest = Infinity;
  for (let dy = 0; corner.y - dy >= y0 - SCAN_STEP + 1; dy += SCAN_STEP) {
    const y = Math.max(y0, corner.y - dy);
    for (let dx = 0; corner.x - dx >= x0 - SCAN_STEP + 1; dx += SCAN_STEP) {
      const x = Math.max(x0, corner.x - dx);
      const d = corner.x - x + (corner.y - y);
      if (d < nearest && !covers(x, y)) {
        nearest = d;
        best = { x, y };
      }
    }
  }
  return best;
}

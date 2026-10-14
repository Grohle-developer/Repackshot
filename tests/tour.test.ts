// The guided tour of phase U10 without a DOM (the browser walk of the whole tour is tools/tour-check.mjs): its order,
// that every step points at something that exists in the interface's source and opens what it needs, Skip and the
// remembered state, when it starts by itself, the keys, where the card goes, and the words in both languages.

import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildExample } from '../src/core/example';
import { allParts } from '../src/core/scene';
import { defaultLayout, validateLayout, type Layout } from '../src/core/settings';
import { createInitialState, createStore } from '../src/core/store';
import { exampleNames } from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang, STRINGS, t, type StringKey } from '../src/ui/strings';
import {
  applyStage,
  endTour,
  goToStep,
  maybeStartTour,
  placeCard,
  startsByItself,
  startTour,
  stepWords,
  TOUR_STEPS,
  tourBack,
  tourKeyAction,
  tourNext,
  tourSteps,
} from '../src/ui/tour';
import { createUiStore, type UiState } from '../src/ui/ui-state';

// ------------------------------------------------------------------ a ctx

interface Made {
  ctx: Ctx;
  saved: Partial<Layout>[];
}

/** A store and an interface state with the services the tour reads; `example` loads the example bottle. */
function make(opts: { example?: boolean; desktop?: boolean; viewport?: boolean; ui?: Partial<UiState>; layout?: Layout } = {}): Made {
  const store = createStore(createInitialState());
  if (opts.example) store.dispatch({ type: 'scene/addModel', payload: buildExample(exampleNames()), replace: true });
  const saved: Partial<Layout>[] = [];
  const desktop = opts.desktop ? ({ portable: false, dataDir: '/d', modelsDir: '/m', logsDir: '/l', browser: null, version: '0', window: null } as UiState['desktop']) : null;
  const ui = createUiStore({ desktop, ...opts.ui }, { layout: opts.layout ?? defaultLayout(), onLayout: (p) => saved.push(p) });
  const services = { viewport: opts.viewport === false ? null : ({} as never) } as unknown as AppServices;
  return { ctx: { store, ui, services }, saved };
}

afterEach(() => setLang('en'));

// ------------------------------------------------------------------ the steps

const ORDER = [
  'welcome',
  'menu',
  'parts',
  'levels',
  'tools',
  'mode',
  'product',
  'light',
  'environment',
  'camera',
  'material',
  'nodes',
  'lights',
  'cameras',
  'studios',
  'add',
  'render',
  'render-window',
  'render-queue',
  'render-ai',
  'results',
  'settings-general',
  'settings-preferences',
  'settings-accessibility',
  'settings-shortcuts',
  'settings-engine',
  'settings-ai',
  'settings-storage',
  'settings-desktop',
  'settings-updates',
  'settings-about',
  'done',
];

describe('the steps and their order', () => {
  it('follow the roadmap: menu, tree and levels, tools, Fast/Full, inspector, tabs, Add, render window, results, Settings', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(ORDER);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    // The chapters only ever move forward.
    const chapters = ['welcome', 'app', 'scene', 'view', 'inspector', 'scene', 'render', 'settings', 'done'] as const;
    let at = 0;
    for (const s of TOUR_STEPS) {
      while (at < chapters.length && chapters[at] !== s.chapter) at++;
      expect(at, `${s.id} (${s.chapter}) is out of order`).toBeLessThan(chapters.length);
    }
  });

  it('this computer has the steps that exist for it: the desktop section only on the desktop, the tools only with a viewport', () => {
    const web = tourSteps(make().ctx).map((s) => s.id);
    expect(web).not.toContain('settings-desktop');
    expect(web).toContain('tools');
    expect(tourSteps(make({ desktop: true }).ctx).map((s) => s.id)).toEqual(ORDER);
    expect(tourSteps(make({ viewport: false }).ctx).map((s) => s.id)).not.toContain('tools');
    // The other steps are the same everywhere.
    expect(web.filter((id) => id !== 'settings-desktop')).toEqual(ORDER.filter((id) => id !== 'settings-desktop'));
  });

  it('only the first and the last step have no area; every other one names the anchors it rings', () => {
    for (const s of TOUR_STEPS) {
      if (s.id === 'welcome' || s.id === 'done') expect(s.targets, s.id).toEqual([]);
      else expect(s.targets.length, s.id).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------------------------------ every step points at something that exists

/** The paths of every TypeScript file under a folder (a folder has no extension and lists; a file throws). */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    try {
      return walk(path);
    } catch {
      return path.endsWith('.ts') ? [path] : [];
    }
  });

/** The text of every source file of the interface but the tour's own (which names the anchors, not creates them). */
function sources(): string {
  return walk('src/ui')
    .filter((p) => !p.endsWith('panels/tour.ts') && !p.endsWith('ui/tour.ts'))
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
}

describe('every step points at something that exists', () => {
  const code = sources();
  /** An anchor is written as a `data-guide` attribute, or comes from a section of the inspector or of a window (`section-<id>`). */
  const exists = (name: string): boolean => {
    if (name.startsWith('section-')) return new RegExp(`section\\(ctx, '${name.slice('section-'.length).replace('.', '\\.')}'`).test(code);
    return new RegExp(`'data-guide'[:,] '${name}'|setAttribute\\('data-guide', '${name}'\\)`).test(code);
  };

  it('each anchor of each step is in the interface', () => {
    const missing: string[] = [];
    for (const s of TOUR_STEPS) for (const name of s.targets) if (!exists(name)) missing.push(`${s.id}: ${name}`);
    expect(missing).toEqual([]);
  });

  it('the finder is not fooled: an anchor nobody wrote is not found', () => {
    expect(exists('no-such-area')).toBe(false);
    expect(exists('section-nothing')).toBe(false);
    expect(exists('app-menu')).toBe(true);
    expect(exists('section-rw.ai')).toBe(true);
  });

  it('the anchors the first step of a kind needs are the ones the stage can show', () => {
    // An area behind a tab, a panel, a window, a drawer or a selection says what it needs (so it is never hidden).
    const need = (id: string) => TOUR_STEPS.find((s) => s.id === id)!.stage ?? {};
    expect(need('lights').sceneTab).toBe('lights');
    expect(need('cameras').sceneTab).toBe('cameras');
    expect(need('studios').sceneTab).toBe('studios');
    for (const id of ['parts', 'levels', 'add']) expect(need(id)).toMatchObject({ sceneTab: 'parts', panel: 'left' });
    for (const id of ['product', 'light', 'environment', 'camera']) expect(need(id)).toMatchObject({ panel: 'right', inspector: 'scene' });
    expect(need('material')).toMatchObject({ panel: 'right', inspector: 'part', catalog: true });
    for (const id of ['render-window', 'render-queue', 'render-ai']) expect(need(id).renderWindow).toBe(true);
    expect(need('results').drawer).toBe('queue');
    for (const s of TOUR_STEPS.filter((x) => x.chapter === 'settings')) expect(need(s.id).settings, s.id).toBe(s.id.replace('settings-', ''));
    // The areas that are always on screen need nothing.
    for (const id of ['menu', 'tools', 'mode', 'render']) expect(need(id), id).toEqual({});
  });
});

// ------------------------------------------------------------------ what each step puts on screen, and puts back

describe('a step opens what it needs, and the tour puts everything back', () => {
  it('the render window opens for its steps and closes for the next', () => {
    const { ctx } = make({ example: true });
    startTour(ctx, 'menu');
    const steps = tourSteps(ctx);
    const at = (id: string) => steps.findIndex((s) => s.id === id);
    goToStep(ctx, at('render'));
    expect(ctx.ui.get().renderWindow).toBeNull();
    goToStep(ctx, at('render-window'));
    expect(ctx.ui.get().renderWindow).toEqual({ kind: 'NEW' });
    const open = ctx.ui.get().renderWindow;
    goToStep(ctx, at('render-queue'));
    expect(ctx.ui.get().renderWindow).toBe(open);
    goToStep(ctx, at('render-ai'));
    expect(ctx.ui.get().renderWindow).not.toBeNull();
    goToStep(ctx, at('results'));
    expect(ctx.ui.get().renderWindow).toBeNull();
    expect(ctx.ui.get().drawer).toBe('queue');
    goToStep(ctx, at('settings-engine'));
    expect(ctx.ui.get().drawer).toBeNull();
    expect(ctx.ui.get().settingsWindow?.section).toBe('engine');
    goToStep(ctx, at('settings-ai'));
    expect(ctx.ui.get().settingsWindow?.section).toBe('ai');
    goToStep(ctx, at('done'));
    expect(ctx.ui.get().settingsWindow).toBeNull();
    expect(ctx.ui.get().renderWindow).toBeNull();
  });

  it('Settings and the render window are never open together', () => {
    const { ctx } = make({ example: true });
    startTour(ctx, 'menu');
    for (let i = 0; i < tourSteps(ctx).length; i++) {
      goToStep(ctx, i);
      const u = ctx.ui.get();
      expect(u.renderWindow !== null && u.settingsWindow !== null, `step ${i}`).toBe(false);
    }
  });

  it('the Scene tab follows the step and is back where it was at the end', () => {
    const { ctx } = make({ example: true, ui: { sceneTab: 'cameras' } });
    startTour(ctx, 'menu');
    const steps = tourSteps(ctx);
    const tab = (id: string) => {
      goToStep(ctx, steps.findIndex((s) => s.id === id));
      return ctx.ui.get().sceneTab;
    };
    expect(tab('menu')).toBe('cameras');
    expect(tab('parts')).toBe('parts');
    expect(tab('lights')).toBe('lights');
    expect(tab('cameras')).toBe('cameras');
    expect(tab('studios')).toBe('studios');
    expect(tab('add')).toBe('parts');
    expect(tab('render')).toBe('cameras');
    ctx.ui.set({ sceneTab: 'studios' });
    endTour(ctx);
    expect(ctx.ui.get().sceneTab).toBe('cameras');
  });

  it('a folded side panel opens for the step that needs it, and in a narrow window only the one it needs', () => {
    const { ctx } = make({ example: true, ui: { leftCollapsed: true, rightCollapsed: true } });
    startTour(ctx, 'menu');
    const steps = tourSteps(ctx);
    const at = (id: string) => steps.findIndex((s) => s.id === id);
    goToStep(ctx, at('parts'));
    expect([ctx.ui.get().leftCollapsed, ctx.ui.get().rightCollapsed]).toEqual([false, true]);
    goToStep(ctx, at('camera'));
    expect([ctx.ui.get().leftCollapsed, ctx.ui.get().rightCollapsed]).toEqual([true, false]);
    goToStep(ctx, at('render'));
    expect([ctx.ui.get().leftCollapsed, ctx.ui.get().rightCollapsed]).toEqual([true, true]);
    endTour(ctx);
    expect([ctx.ui.get().leftCollapsed, ctx.ui.get().rightCollapsed]).toEqual([true, true]);
    // Wide, with the left panel open and the right one folded by the person: each step leaves what it does not name as it was.
    const wide = make({ example: true, ui: { leftCollapsed: false, rightCollapsed: true, narrow: false } });
    startTour(wide.ctx, 'menu');
    goToStep(wide.ctx, at('mode'));
    expect([wide.ctx.ui.get().leftCollapsed, wide.ctx.ui.get().rightCollapsed]).toEqual([false, true]);
    // A window that became narrow while a step was up: the stage again puts the panel it needs on screen.
    wide.ctx.ui.set({ narrow: true, leftCollapsed: true, rightCollapsed: true });
    goToStep(wide.ctx, at('camera'));
    applyStage(wide.ctx, TOUR_STEPS.find((s) => s.id === 'camera')!.stage);
    expect([wide.ctx.ui.get().leftCollapsed, wide.ctx.ui.get().rightCollapsed]).toEqual([true, false]);
  });

  it('the inspector shows the scene for its steps and the first part for the materials, and the selection comes back', () => {
    const { ctx } = make({ example: true });
    const body = Object.values(ctx.store.get().scene.nodes).find((n) => n.name === 'Body')!;
    ctx.store.dispatch({ type: 'scene/select', ids: [body.id], mode: 'set', level: 'PART' });
    const before = ctx.store.get().selection;
    startTour(ctx, 'menu');
    const steps = tourSteps(ctx);
    const at = (id: string) => steps.findIndex((s) => s.id === id);
    goToStep(ctx, at('levels'));
    expect(ctx.store.get().selection.ids).toEqual([body.id]);
    goToStep(ctx, at('product'));
    expect(ctx.store.get().selection.ids).toEqual([]);
    goToStep(ctx, at('camera'));
    expect(ctx.store.get().selection.ids).toEqual([]);
    goToStep(ctx, at('material'));
    expect(ctx.store.get().selection.ids).toEqual([allParts(ctx.store.get())[0]]);
    expect(ctx.ui.get().catalogOpen).toBe(true);
    goToStep(ctx, at('lights'));
    expect(ctx.store.get().selection.ids).toEqual([body.id]);
    expect(ctx.ui.get().catalogOpen).toBe(false);
    goToStep(ctx, at('material'));
    endTour(ctx);
    expect(ctx.store.get().selection).toEqual(before);
    expect(ctx.ui.get().catalogOpen).toBe(false);
  });

  it('selecting for a step never touches the project: no undo entry, not dirty', () => {
    const { ctx } = make({ example: true });
    const history = ctx.store.history().undo.length;
    const dirty = ctx.store.get().meta.dirty;
    startTour(ctx, 'menu');
    for (let i = 0; i < tourSteps(ctx).length; i++) goToStep(ctx, i);
    endTour(ctx);
    expect(ctx.store.history().undo.length).toBe(history);
    expect(ctx.store.get().meta.dirty).toBe(dirty);
  });

  it('an empty project has no part to select: the materials step leaves the inspector as the scene (the page rings the inspector)', () => {
    const { ctx } = make();
    startTour(ctx, 'menu');
    goToStep(ctx, tourSteps(ctx).findIndex((s) => s.id === 'material'));
    expect(ctx.store.get().selection.ids).toEqual([]);
    expect(ctx.ui.get().catalogOpen).toBe(true);
    endTour(ctx);
    expect(ctx.ui.get().catalogOpen).toBe(false);
  });

  it('Settings remembers its section for the person; the tour does not change it', () => {
    const { ctx } = make({ example: true, ui: { settingsSection: 'storage' } });
    startTour(ctx, 'menu');
    goToStep(ctx, tourSteps(ctx).findIndex((s) => s.id === 'settings-ai'));
    expect(ctx.ui.get().settingsSection).toBe('ai');
    endTour(ctx);
    expect(ctx.ui.get().settingsSection).toBe('storage');
    expect(ctx.ui.get().settingsWindow).toBeNull();
  });

  it('the windows that would sit on the tour are closed when it starts, and the palette and the guide with them', () => {
    const { ctx } = make({ example: true, ui: { renderWindow: { kind: 'NEW' }, settingsWindow: { section: 'general', focus: null, nonce: 1 }, paletteOpen: true, guideStep: 2, pickMode: { kind: 'focus' } } });
    expect(startTour(ctx, 'menu')).toBe(true);
    const u = ctx.ui.get();
    expect([u.renderWindow, u.settingsWindow, u.paletteOpen, u.guideStep, u.pickMode]).toEqual([null, null, false, null, null]);
    // Started once: a second start while it is up does nothing.
    expect(startTour(ctx, 'menu')).toBe(false);
  });

  it('next and back move one step, back stops at the first, and next after the last ends it', () => {
    const { ctx } = make({ example: true });
    startTour(ctx, 'menu');
    const total = tourSteps(ctx).length;
    tourBack(ctx);
    expect(ctx.ui.get().tour?.step).toBe(0);
    tourNext(ctx);
    tourNext(ctx);
    expect(ctx.ui.get().tour?.step).toBe(2);
    tourBack(ctx);
    expect(ctx.ui.get().tour?.step).toBe(1);
    goToStep(ctx, total - 1);
    expect(ctx.ui.get().tour?.step).toBe(total - 1);
    tourNext(ctx);
    expect(ctx.ui.get().tour).toBeNull();
    goToStep(ctx, 99);
    expect(ctx.ui.get().tour).toBeNull();
  });
});

// ------------------------------------------------------------------ Skip, and what is remembered

describe('Skip, Done and Escape count as seen, and the flag is remembered with the interface state', () => {
  it('ending the tour sets tourSeen and saves it in the layout of the settings document', () => {
    const { ctx, saved } = make({ example: true });
    expect(ctx.ui.get().tourSeen).toBe(false);
    startTour(ctx, 'first');
    expect(saved).toEqual([]);
    endTour(ctx);
    expect(ctx.ui.get().tourSeen).toBe(true);
    expect(ctx.ui.get().tour).toBeNull();
    expect(saved.some((p) => p.tourSeen === true)).toBe(true);
    // Through the document: what a next start reads.
    const doc = JSON.parse(JSON.stringify({ ...defaultLayout(), ...Object.assign({}, ...saved) }));
    expect(validateLayout(doc).tourSeen).toBe(true);
    expect(createUiStore({}, { layout: validateLayout(doc) }).get().tourSeen).toBe(true);
  });

  it('skipping in the middle counts as seen too, and ending twice does nothing', () => {
    const { ctx, saved } = make({ example: true });
    startTour(ctx, 'first');
    goToStep(ctx, 5);
    endTour(ctx);
    expect(ctx.ui.get().tourSeen).toBe(true);
    const n = saved.length;
    endTour(ctx);
    expect(saved.length).toBe(n);
  });

  it('is not remembered by anything but the layout: a damaged value reads as not seen', () => {
    expect(validateLayout({ tourSeen: 'yes' }).tourSeen).toBe(false);
    expect(validateLayout({ tourSeen: true }).tourSeen).toBe(true);
    expect(validateLayout(null).tourSeen).toBe(false);
    expect(defaultLayout().tourSeen).toBe(false);
  });

  it('Help ▸ Guided tour starts it again after it was seen', () => {
    const { ctx } = make({ example: true, ui: { tourSeen: true } });
    expect(startTour(ctx, 'menu')).toBe(true);
    expect(ctx.ui.get().tour).toEqual({ step: 0, how: 'menu' });
    endTour(ctx);
    expect(ctx.ui.get().tourSeen).toBe(true);
  });
});

describe('when it starts by itself', () => {
  it('at the first start, not under automation, never once seen', () => {
    expect(startsByItself({ seen: false, automated: false })).toBe(true);
    expect(startsByItself({ seen: true, automated: false })).toBe(false);
    expect(startsByItself({ seen: false, automated: true })).toBe(false);
    // ?tour=0 never, ?tour=auto as a first start would (automation included).
    expect(startsByItself({ seen: false, automated: false, param: '0' })).toBe(false);
    expect(startsByItself({ seen: false, automated: true, param: 'auto' })).toBe(true);
    expect(startsByItself({ seen: true, automated: true, param: 'auto' })).toBe(false);
  });

  it('maybeStartTour: starts when it should, not when seen, driven, or told not to; ?tour=1 always', () => {
    const run = (o: Parameters<typeof maybeStartTour>[1], ui: Partial<UiState> = {}) => {
      const { ctx } = make({ example: true, ui });
      maybeStartTour(ctx, o);
      return ctx.ui.get().tour;
    };
    expect(run({ automated: false })?.how).toBe('first');
    expect(run({ automated: false }, { tourSeen: true })).toBeNull();
    expect(run({ automated: true })).toBeNull();
    expect(run({ automated: false, param: '0' })).toBeNull();
    expect(run({ automated: true, param: 'auto' })?.how).toBe('first');
    expect(run({ automated: true, param: '1' }, { tourSeen: true })?.how).toBe('menu');
  });

  it('waits for the first start of a portable to close its chooser, then starts', () => {
    const { ctx } = make({ example: true, ui: { settingsWindow: { section: 'ai', focus: 'ai.models', nonce: 1, chooser: true } } });
    maybeStartTour(ctx, { automated: false });
    expect(ctx.ui.get().tour).toBeNull();
    ctx.ui.set({ settingsWindow: null });
    expect(ctx.ui.get().tour?.how).toBe('first');
    // Seen in the meantime (another start of the tour): it does not come a second time.
    const second = make({ example: true, ui: { renderWindow: { kind: 'NEW' } } });
    maybeStartTour(second.ctx, { automated: false });
    second.ctx.ui.set({ tourSeen: true });
    second.ctx.ui.set({ renderWindow: null });
    expect(second.ctx.ui.get().tour).toBeNull();
  });
});

// ------------------------------------------------------------------ keys

describe('the keys', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => tourKeyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  it('→ goes on, ← goes back, Esc ends it; Ctrl, ⌘ and Alt combinations and every other key do nothing', () => {
    expect(key('ArrowRight')).toBe('next');
    expect(key('ArrowLeft')).toBe('back');
    expect(key('Escape')).toBe('end');
    expect(key('PageDown')).toBe('next');
    expect(key('PageUp')).toBe('back');
    expect(key('ArrowRight', { ctrlKey: true })).toBeNull();
    expect(key('ArrowLeft', { metaKey: true })).toBeNull();
    expect(key('Escape', { altKey: true })).toBeNull();
    for (const other of ['Delete', 'f', 'z', 'Backspace', 'Tab', 'Enter', ' ', 'ArrowUp']) expect(key(other), other).toBeNull();
  });
});

// ------------------------------------------------------------------ where the card goes

describe('where the card goes', () => {
  const view = { w: 1600, h: 1000 };
  const card = { w: 360, h: 210 };
  const inside = (p: { x: number; y: number }) => p.x >= 10 && p.y >= 10 && p.x + card.w <= view.w - 10 && p.y + card.h <= view.h - 10;
  const clear = (p: { x: number; y: number }, t: { x: number; y: number; w: number; h: number }) => p.x + card.w <= t.x || t.x + t.w <= p.x || p.y + card.h <= t.y || t.y + t.h <= p.y;

  it('is in the middle of the screen when there is no area', () => {
    const p = placeCard(null, card, view);
    expect(p).toEqual({ x: 620, y: 395, where: 'center' });
  });

  it('is beside the area, on the side that has room, and never covers it', () => {
    const cases: [string, { x: number; y: number; w: number; h: number }, string][] = [
      ['the tree, on the left', { x: 0, y: 44, w: 260, h: 876 }, 'right'],
      ['the inspector, on the right', { x: 1260, y: 44, w: 340, h: 876 }, 'left'],
      ['the app menu, in the header', { x: 8, y: 6, w: 52, h: 32 }, 'below'],
      ['the Render button, in the bar', { x: 1456, y: 928, w: 132, h: 40 }, 'above'],
      ['the Fast/Full switch', { x: 620, y: 8, w: 94, h: 28 }, 'below'],
      ['the view tools', { x: 270, y: 54, w: 344, h: 38 }, 'below'],
      ['a section of the inspector', { x: 1262, y: 620, w: 338, h: 300 }, 'left'],
    ];
    for (const [name, target, where] of cases) {
      const p = placeCard(target, card, view);
      expect(p.where, name).toBe(where);
      expect(inside(p), name).toBe(true);
      expect(clear(p, target), name).toBe(true);
    }
  });

  it('stays outside the window the area is in, when there is room beside it', () => {
    // The render window is 760 wide in the middle of 1600: its AI section is talked about from beside the window.
    const win = { x: 420, y: 180, w: 760, h: 640 };
    const ai = { x: 420, y: 720, w: 760, h: 44 };
    const p = placeCard(ai, card, view, win);
    expect(['left', 'right']).toContain(p.where);
    expect(clear(p, win)).toBe(true);
    expect(inside(p)).toBe(true);
    // Settings is too wide for that: the card goes inside the area, at its bottom right.
    const sw = { x: 320, y: 160, w: 960, h: 660 };
    const content = { x: 548, y: 202, w: 736, h: 608 };
    const q = placeCard(content, card, view, sw);
    expect(q.where).toBe('inside');
    expect(q.x + card.w).toBeLessThanOrEqual(content.x + content.w);
    expect(q.y + card.h).toBeLessThanOrEqual(content.y + content.h);
    expect(inside(q)).toBe(true);
  });

  it('over a large area the card goes where it covers no control, when there is such a place (the nearest to the bottom right)', () => {
    const sw = { x: 320, y: 160, w: 960, h: 660 };
    const content = { x: 548, y: 202, w: 736, h: 608 };
    const none = placeCard(content, card, view, sw);
    const overlap = (p: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }) => p.x < b.x + b.w && b.x < p.x + card.w && p.y < b.y + b.h && b.y < p.y + card.h;
    // Controls down the right side of the section: the left part is free, and that is where the card goes.
    const right = [{ x: 960, y: 202, w: 300, h: 608 }];
    const a = placeCard(content, card, view, sw, 14, 10, () => right);
    expect(a.where).toBe('inside');
    expect(right.some((b) => overlap(a, b))).toBe(false);
    expect(inside(a)).toBe(true);
    expect(a.x + card.w).toBeLessThanOrEqual(960);
    // Controls only in the top half: the bottom right, where it would be anyway, is free.
    const top = [{ x: 548, y: 202, w: 736, h: 250 }];
    expect(placeCard(content, card, view, sw, 14, 10, () => top)).toEqual(none);
    // A section full of controls: no such place, so the bottom right, as before.
    const full = [{ x: 548, y: 202, w: 736, h: 608 }];
    expect(placeCard(content, card, view, sw, 14, 10, () => full)).toEqual(none);
    expect(placeCard(content, card, view, sw, 14, 10, () => [])).toEqual(none);
    // The controls are asked for only when the card has to go inside an area.
    let asked = 0;
    placeCard({ x: 0, y: 44, w: 260, h: 876 }, card, view, null, 14, 10, () => (asked++, []));
    expect(asked).toBe(0);
    placeCard(content, card, view, sw, 14, 10, () => (asked++, []));
    expect(asked).toBe(1);
  });

  it('an area that fills the screen gets the card inside, still on screen', () => {
    const p = placeCard({ x: 0, y: 0, w: 1600, h: 1000 }, card, view);
    expect(p.where).toBe('inside');
    expect(inside(p)).toBe(true);
    // A tiny window: the card is pushed inside the screen.
    const small = placeCard({ x: 300, y: 300, w: 100, h: 100 }, card, { w: 400, h: 400 });
    expect(small.x).toBeGreaterThanOrEqual(10);
    expect(small.y).toBeGreaterThanOrEqual(10);
  });
});

// ------------------------------------------------------------------ words

describe('the words of the tour exist in both languages and speak of nothing a desktop does not have', () => {
  it('every step has a title and a text in English and in Spanish, with no placeholder left over', () => {
    for (const lang of ['en', 'es'] as const) {
      setLang(lang);
      for (const s of TOUR_STEPS) {
        const w = stepWords(s);
        expect(w.title.trim(), `${lang} ${s.id} title`).not.toBe('');
        expect(w.text.trim(), `${lang} ${s.id} text`).not.toBe('');
        expect(`${w.title} ${w.text}`, `${lang} ${s.id}`).not.toMatch(/\{\w+\}/);
        expect(STRINGS[lang][s.title], `${lang} ${s.id}`).toBeTruthy();
        expect(STRINGS[lang][s.text], `${lang} ${s.id}`).toBeTruthy();
      }
    }
  });

  it('the two languages differ, step by step (a string left in English is caught)', () => {
    const same: string[] = [];
    for (const s of TOUR_STEPS) {
      setLang('en');
      const en = stepWords(s);
      setLang('es');
      const es = stepWords(s);
      // Single words that are the same in both languages are not translations missing ("Render", "Zoom").
      if (en.text === es.text || (en.title === es.title && en.title.split(' ').length > 2)) same.push(s.id);
    }
    expect(same).toEqual([]);
  });

  it('the Settings steps use the sections’ own names and descriptions', () => {
    setLang('en');
    const ai = stepWords(TOUR_STEPS.find((s) => s.id === 'settings-ai')!);
    expect(ai.title).toBe(`Settings · ${t('set.sec.ai')}`);
    expect(ai.text).toBe(t('set.sec.ai.desc'));
    setLang('es');
    expect(stepWords(TOUR_STEPS.find((s) => s.id === 'settings-engine')!).title).toBe('Ajustes · Motor de renderizado');
  });

  it('never name the browser, so the desktop wording test of P3e has nothing to ask of them', () => {
    const keys = (Object.keys(STRINGS.en) as StringKey[]).filter((k) => k.startsWith('tour.') || k.startsWith('rt.') || k === 'set.ai.chooserRuntime' || k === 'menu.help' || k === 'menu.tour' || k === 'action.tour');
    expect(keys.length).toBeGreaterThan(60);
    for (const k of keys) {
      expect(STRINGS.en[k], k).not.toMatch(/browser|navegador/i);
      expect(STRINGS.es[k], k).not.toMatch(/browser|navegador/i);
    }
  });

  it('have the same placeholders in both languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(STRINGS.en) as StringKey[]) if (k.startsWith('tour.') || k.startsWith('rt.')) expect(ph(STRINGS.es[k]), k).toEqual(ph(STRINGS.en[k]));
  });
});

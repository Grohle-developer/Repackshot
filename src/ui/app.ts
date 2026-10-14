// Mounts the interface: the five regions, theme, language, keyboard,
// panel folding and resizing, toasts and tooltips. A language switch
// rebuilds the interface in place (the viewport canvas is kept).

import type { Store } from '../core/store';
import * as cmd from './commands';
import { closePalette, openPalette } from './components/palette';
import { installTooltips, closeFloating } from './components/widgets';
import { h, isTyping } from './dom';
import { header } from './panels/header';
import { inspectorPanel } from './panels/inspector';
import { renderWindow } from './panels/render-window';
import { settingsWindow } from './panels/settings-window';
import { materialEditor } from './panels/material-editor';
import { renderBar } from './panels/renderbar';
import { scenePanel } from './panels/scene';
import { statusBar } from './panels/status';
import { tourOverlay } from './panels/tour';
import { viewportPanel } from './panels/viewport';
import type { AppServices } from './ports';
import { dynamic, Root, Scope, type Ctx } from './reactive';
import { preventedByGuard } from './guards';
import { ACTIONS, matches } from './shortcuts';
import { setLengthUnit } from './components/controls';
import { cssZoom } from './dom';
import { installSettingsEffects } from './settings-effects';
import { setLang } from './strings';
import { PANEL_MAX, PANEL_MIN, type UiStore } from './ui-state';
import { installCloseGuard, installWindowHost } from './window-host';

export interface App {
  ctx: Ctx;
  /** Resolves once the interface has painted. */
  painted: Promise<void>;
}

function resizer(ctx: Ctx, side: 'left' | 'right'): HTMLElement {
  const el = h('div', { class: 'resizer', role: 'separator', 'aria-orientation': 'vertical' });
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    const startX = e.clientX;
    const start = side === 'left' ? ctx.ui.get().leftWidth : ctx.ui.get().rightWidth;
    // The widths are in the panels' own pixels; the pointer moves in screen pixels (Interface size zooms them).
    const zoom = cssZoom(el);
    const move = (ev: PointerEvent) => {
      const d = (side === 'left' ? ev.clientX - startX : startX - ev.clientX) / zoom;
      const w = Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, start + d)));
      ctx.ui.set(side === 'left' ? { leftWidth: w } : { rightWidth: w });
    };
    const up = () => {
      el.classList.remove('is-dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  return el;
}

function toasts(scope: Scope): HTMLElement {
  const el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  scope.watch(
    (_s, u) => u.toasts,
    (list) => el.replaceChildren(...list.map((x) => h('div', { class: 'toast' }, x.text))),
  );
  return el;
}

function applyTheme(setting: 'dark' | 'light' | 'system'): void {
  document.documentElement.dataset.theme = cmd.resolveTheme(setting);
}

/** Handles global shortcuts. Returns true when the event was used. */
function onKey(ctx: Ctx, e: KeyboardEvent): boolean {
  // A focused number field swallows plain keys (digits, letters) but not Ctrl/⌘ combinations.
  const spin = (e.target as HTMLElement | null)?.getAttribute?.('role') === 'spinbutton';
  const typing = isTyping(e) && !(spin && (e.ctrlKey || e.metaKey));
  const u = ctx.ui.get();
  // The guided tour is modal: its own listener (panels/tour.ts) took the keys it uses; the rest do nothing under it.
  if (u.tour) return true;
  if (e.key === 'Escape' && !typing) {
    if (u.pickMode) {
      ctx.ui.set({ pickMode: null });
      return true;
    }
    if (u.wizard) {
      ctx.ui.set({ wizard: null });
      return true;
    }
    if (u.doctorOpen) {
      ctx.ui.set({ doctorOpen: false });
      return true;
    }
  }
  // The Settings window is modal: only its own shortcut (Ctrl/⌘ , closes it) reaches the application.
  if (u.settingsWindow) {
    const own = ACTIONS.find((a) => a.id === 'settings');
    if (own?.keys && matches(e, own.keys)) {
      e.preventDefault();
      void own.run(ctx);
      return true;
    }
    return false;
  }
  // The render window and the results viewer own the plain keys while they are open (their own
  // listeners handle ⏎, Esc, + - 0 1); shortcuts with Ctrl/⌘ still work.
  const overlay = u.renderWindow !== null || u.resultView !== null;
  for (const a of ACTIONS) {
    if (!a.keys) continue;
    const specs = [a.keys, ...(a.altKeys ?? [])];
    if (!specs.some((k) => matches(e, k))) continue;
    if (typing && !a.global) return false;
    if (overlay && !a.global && !a.keys.startsWith('mod+')) return false;
    // Tab folds the panels only when focus is not on a control (keyboard navigation keeps working).
    if (a.id === 'panels') {
      const f = document.activeElement;
      if (f && f !== document.body && !(f instanceof HTMLCanvasElement) && !f.classList.contains('vp')) return false;
    }
    e.preventDefault();
    void a.run(ctx);
    return true;
  }
  return false;
}

export function mountApp(root: HTMLElement, store: Store, ui: UiStore, services: AppServices): App {
  const ctx: Ctx = { store, ui, services };
  const reactive = new Root(ctx);
  let scope: Scope | null = null;
  let shell: HTMLElement | null = null;

  const build = () => {
    scope?.dispose();
    scope = new Scope(reactive);
    const sc = scope;
    setLang(store.get().meta.lang);
    setLengthUnit(ui.get().settings['general.units']);
    document.documentElement.lang = store.get().meta.lang;
    const left = scenePanel(ctx, sc);
    left.appendChild(resizer(ctx, 'left'));
    const right = inspectorPanel(ctx, sc);
    right.appendChild(resizer(ctx, 'right'));
    // The render window floats over everything but menus and toasts; it is DOM, never part of a canvas.
    const windowHost = dynamic(
      sc,
      (_s, u) => (u.renderWindow ? (u.renderWindow.kind === 'EDIT' ? `edit:${u.renderWindow.jobId}` : 'new') : null),
      (wsc, key) => (key ? renderWindow(ctx, wsc) : null),
      undefined,
      'div',
      'rw-mount',
    );
    // The Settings window (UI.md §2.9).
    const settingsHost = dynamic(sc, (_s, u) => (u.settingsWindow ? 'open' : null), (wsc, key) => (key ? settingsWindow(ctx, wsc) : null), undefined, 'div', 'sw-mount');
    // The material editor (UI.md §2.11, M3a): over the application without dimming it, one material at a time.
    const editorHost = dynamic(sc, (_s, u) => u.materialEditor?.material ?? null, (esc, key) => (key ? materialEditor(ctx, esc) : null), undefined, 'div', 'me-mount');
    // The guided tour (phase U10) is over everything, windows included, and owns the keys and the pointer while it is up.
    const tourHost = dynamic(sc, (_s, u) => (u.tour ? 'on' : null), (tsc, key) => (key ? tourOverlay(ctx, tsc) : null), undefined, 'div', 'tour-mount');
    const next = h('div', { class: 'app' }, header(ctx, sc), left, viewportPanel(ctx, sc), right, renderBar(ctx, sc), statusBar(ctx, sc), toasts(sc), editorHost, windowHost, settingsHost, tourHost);
    sc.watch(
      (_s, u) => [u.leftCollapsed, u.rightCollapsed, u.leftWidth, u.rightWidth, u.narrow, u.drawer] as const,
      ([lc, rc, lw, rw, narrow, drawer]) => {
        next.dataset.left = lc ? 'collapsed' : 'open';
        next.dataset.right = rc ? 'collapsed' : 'open';
        next.dataset.drawer = drawer ?? 'none';
        next.toggleAttribute('data-narrow', narrow);
        next.style.setProperty('--left-w', narrow || lc ? 'var(--rail)' : `${lw}px`);
        next.style.setProperty('--right-w', narrow || rc ? 'var(--rail)' : `${rw}px`);
      },
      (a, b) => a.every((x, i) => x === b[i]),
    );
    if (shell) shell.replaceWith(next);
    else root.appendChild(next);
    shell = next;
  };

  build();
  let lang = store.get().meta.lang;
  store.subscribe((s) => {
    if (s.meta.lang !== lang) {
      lang = s.meta.lang;
      closeFloating();
      closePalette();
      build();
    }
  });
  // The interface units change every length field: the interface is rebuilt, like for a language.
  let units = ui.get().settings['general.units'];
  ui.subscribe((u) => {
    if (u.settings['general.units'] !== units) {
      units = u.settings['general.units'];
      closeFloating();
      build();
    }
  });
  installSettingsEffects(ctx);

  // Theme, live.
  let theme = store.get().meta.theme;
  applyTheme(theme);
  store.subscribe((s) => {
    if (s.meta.theme !== theme) {
      theme = s.meta.theme;
      applyTheme(theme);
    }
  });
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(store.get().meta.theme));
  } catch {
    // Old browsers: the theme just does not follow live changes of the OS.
  }

  // Palette.
  ui.subscribe((u, prev) => {
    if (u.paletteOpen && !prev.paletteOpen) openPalette(ctx);
    if (!u.paletteOpen && prev.paletteOpen) closePalette();
  });

  // Narrow windows: side panels become drawers over the viewport.
  const checkNarrow = () => {
    const narrow = window.innerWidth < 1100;
    if (narrow !== ui.get().narrow) ui.set(narrow ? { narrow, leftCollapsed: true, rightCollapsed: true } : { narrow });
  };
  checkNarrow();
  window.addEventListener('resize', checkNarrow);

  document.addEventListener('keydown', (e) => {
    // The guards (guards.ts) prevent the browser's own action of keys such as Ctrl/⌘ S or D; the application's
    // shortcut for the key still runs.
    if (e.defaultPrevented && !preventedByGuard(e)) return;
    onKey(ctx, e);
  });

  // Files dropped anywhere in the window that the viewport did not take: a browser would navigate to them (and
  // leave the project behind); a project opens and models go to the import sheet.
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
  document.addEventListener('dragover', (e) => {
    if (!e.defaultPrevented && hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (e.defaultPrevented || !hasFiles(e)) return;
    e.preventDefault();
    const { files, handles } = cmd.readDrop(e.dataTransfer);
    cmd.dropFiles(ctx, files, handles);
  });

  // Closing with unsaved changes: in a browser the browser asks (its own words), unless General ▸ Confirm before
  // closing is off; in Repackshot's own desktop window the window asks the page and we ask in our interface.
  installCloseGuard(ctx, window, services.windowHost);
  installWindowHost(ctx);
  installTooltips();

  const painted = new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return { ctx, painted };
}

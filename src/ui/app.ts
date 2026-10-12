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
import { renderBar } from './panels/renderbar';
import { scenePanel } from './panels/scene';
import { statusBar } from './panels/status';
import { viewportPanel } from './panels/viewport';
import type { AppServices } from './ports';
import { Root, Scope, type Ctx } from './reactive';
import { ACTIONS, matches } from './shortcuts';
import { setLang } from './strings';
import { PANEL_MAX, PANEL_MIN, type UiStore } from './ui-state';

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
    const move = (ev: PointerEvent) => {
      const d = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
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
  const typing = isTyping(e);
  const u = ctx.ui.get();
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
  for (const a of ACTIONS) {
    if (!a.keys) continue;
    const specs = [a.keys, ...(a.altKeys ?? [])];
    if (!specs.some((k) => matches(e, k))) continue;
    if (typing && !a.global) return false;
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
    document.documentElement.lang = store.get().meta.lang;
    const left = scenePanel(ctx, sc);
    left.appendChild(resizer(ctx, 'left'));
    const right = inspectorPanel(ctx, sc);
    right.appendChild(resizer(ctx, 'right'));
    const next = h('div', { class: 'app' }, header(ctx, sc), left, viewportPanel(ctx, sc), right, renderBar(ctx, sc), statusBar(ctx, sc), toasts(sc));
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
    if (e.defaultPrevented) return;
    onKey(ctx, e);
  });
  installTooltips();

  const painted = new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return { ctx, painted };
}

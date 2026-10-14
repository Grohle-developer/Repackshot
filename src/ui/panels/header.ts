// Header (UI.md §2.1): app menu, project name, undo / redo, the viewport
// mode (Fast · Full) and the live denoise of Full (U11), search, guide, theme.

import * as cmd from '../commands';
import { segmented } from '../components/controls';
import { confirmBox, openFloating, openMenu, type ConfirmSpec, type MenuEntry } from '../components/widgets';
import { h, icon } from '../dom';
import { LOGO_MARK } from '../icons';
import type { Ctx, Scope } from '../reactive';
import { kbdFor } from '../shortcuts';
import { t } from '../strings';
import { startTour } from '../tour';
import { effectiveMode, type ViewportMode } from '../ui-state';
import { lightMenuItems, primitiveMenuItems } from './add-menu';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The app's mark (icons.ts LOGO_MARK, docs/media/logo.svg) at `size` pixels. */
function logoMark(size: number): SVGSVGElement {
  const m = LOGO_MARK;
  const el = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const svg = el('svg', { viewBox: m.viewBox, width: size, height: size, class: 'brand-mark', 'aria-hidden': 'true' }) as SVGSVGElement;
  svg.append(
    el('rect', { width: 256, height: 256, rx: m.tile.rx, fill: m.tile.fill }),
    ...m.strokes.map((d) => el('path', { d, fill: 'none', stroke: m.stroke, 'stroke-width': m.strokeWidth, 'stroke-linecap': 'round' })),
    el('ellipse', { cx: m.shadow.cx, cy: m.shadow.cy, rx: m.shadow.rx, ry: m.shadow.ry, fill: m.shadow.fill, opacity: m.shadow.opacity }),
  );
  return svg;
}

export function header(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  // The application menu behind the app's mark, with a caret (the desktop window's title bar names the app).
  const menuBtn = h('button', { type: 'button', class: 'brand-btn', 'aria-label': t('menu.main'), 'data-tip': t('menu.main'), 'aria-haspopup': 'menu', 'data-guide': 'app-menu' }, logoMark(22), icon('chevronDown', 12));

  const openAppMenu = () => {
    const s = store.get();
    const entries: (MenuEntry | null | { heading: string })[] = [
      { label: t('menu.new'), icon: 'file', run: () => cmd.requestNewProject(ctx) },
      { label: t('menu.openProject'), icon: 'folder', kbd: kbdFor('open'), run: () => void cmd.openProject(ctx) },
      { label: t('menu.save'), icon: 'save', kbd: kbdFor('save'), run: () => void cmd.saveProject(ctx) },
      { label: t('menu.saveAs'), icon: 'save', kbd: kbdFor('saveAs'), run: () => void cmd.saveProject(ctx, { saveAs: true }) },
      { label: t('menu.import'), icon: 'upload', kbd: kbdFor('import'), run: () => void cmd.importDialog(ctx) },
      // Add ▸ Primitive (phase U9).
      { label: t('menu.add'), icon: 'plus', submenu: [...primitiveMenuItems(ctx), null, ...lightMenuItems(ctx)] },
      { label: t('menu.exportImage'), icon: 'download', run: () => void cmd.exportViewport(ctx) },
      { label: t('menu.exportLibrary'), icon: 'download', run: () => cmd.exportLibraryFile(ctx) },
      { label: t('menu.importLibrary'), icon: 'upload', run: () => void cmd.importLibraryDialog(ctx) },
      null,
      { heading: t('menu.language') },
      { label: t('lang.en'), checked: s.meta.lang === 'en', run: () => cmd.setLanguage(ctx, 'en') },
      { label: t('lang.es'), checked: s.meta.lang === 'es', run: () => cmd.setLanguage(ctx, 'es') },
      { heading: t('menu.theme') },
      { label: t('theme.dark'), checked: s.meta.theme === 'dark', run: () => cmd.setTheme(ctx, 'dark') },
      { label: t('theme.light'), checked: s.meta.theme === 'light', run: () => cmd.setTheme(ctx, 'light') },
      { label: t('theme.system'), checked: s.meta.theme === 'system', run: () => cmd.setTheme(ctx, 'system') },
      { label: t('menu.settings'), icon: 'settings', kbd: kbdFor('settings'), run: () => cmd.openSettings(ctx) },
      null,
      // Help ▸ Guided tour (phase U10), the six-step Guide, the shortcuts and About.
      {
        label: t('menu.help'),
        icon: 'guide',
        submenu: [
          { label: t('menu.tour'), icon: 'guide', run: () => void startTour(ctx, 'menu') },
          { label: t('menu.guide'), icon: 'guide', run: () => cmd.openGuide(ctx) },
          { label: t('menu.shortcuts'), icon: 'keyboard', run: () => cmd.openSettings(ctx, 'shortcuts') },
          { label: t('menu.about'), icon: 'info', run: () => cmd.openSettings(ctx, 'about') },
        ],
      },
    ];
    openMenu(menuBtn, entries);
  };
  menuBtn.addEventListener('click', openAppMenu);

  // Project name, editable in place.
  const dirtyDot = h('span', { class: 'dirty', 'aria-label': t('app.unsaved'), 'data-tip': t('app.unsaved') });
  const nameText = h('span', { style: 'overflow:hidden;text-overflow:ellipsis' });
  const nameEl = h('div', { class: 'project-name', tabindex: 0, role: 'button', 'data-tip': t('app.renameProject') }, dirtyDot, nameText);
  const startRename = () => {
    if (nameEl.querySelector('input')) return;
    const input = h('input', { type: 'text', value: store.get().meta.name, placeholder: t('app.untitled'), 'aria-label': t('app.renameProject') }) as HTMLInputElement;
    nameEl.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (ok && input.value.trim() !== store.get().meta.name) cmd.renameProject(ctx, input.value);
      nameEl.replaceChildren(dirtyDot, nameText);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  };
  nameEl.addEventListener('click', startRename);
  nameEl.addEventListener('keydown', (e) => e.key === 'Enter' && startRename());
  scope.watch(
    (s) => s.meta,
    (m) => {
      nameText.textContent = m.name || t('app.untitled');
      dirtyDot.style.display = m.dirty ? '' : 'none';
    },
  );

  // The inline question of New and Open when there are unsaved changes: under the project name, Esc cancels.
  let closePrompt: (() => void) | null = null;
  scope.watch(
    (_s, u) => u.prompt,
    (spec: ConfirmSpec | null) => {
      closePrompt?.();
      closePrompt = null;
      if (!spec) return;
      const done = () => {
        if (ui.get().prompt === spec) ui.set({ prompt: null });
        closePrompt?.();
      };
      closePrompt = openFloating(nameEl, confirmBox(spec, done), { onClose: () => ui.get().prompt === spec && ui.set({ prompt: null }) });
    },
  );
  scope.onDispose(() => closePrompt?.());

  // Undo / redo with the label in the tooltip.
  const undoBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('header.undo'), 'data-kbd': kbdFor('undo'), onclick: () => store.undo() }, icon('undo'));
  const redoBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('header.redo'), 'data-kbd': kbdFor('redo'), onclick: () => store.redo() }, icon('redo'));
  const refresh = () => {
      const hist = store.history();
      undoBtn.disabled = hist.undo.length === 0;
      redoBtn.disabled = hist.redo.length === 0;
      undoBtn.setAttribute('data-tip', hist.undo.length ? t('header.undoWhat', { label: hist.undo[0] }) : t('header.nothingUndo'));
      redoBtn.setAttribute('data-tip', hist.redo.length ? t('header.redoWhat', { label: hist.redo[0] }) : t('header.nothingRedo'));
  };
  // Every notification, including the commit of a transaction (which does not change the state).
  refresh();
  scope.onDispose(store.subscribe(refresh));

  // The viewport mode: what the viewport shows while working. Render always uses the path tracer.
  const mode = segmented<ViewportMode>(
    [
      { value: 'FAST', label: t('header.modeFast') },
      { value: 'FULL', label: t('header.modeFull') },
    ],
    effectiveMode(ui.get()),
    (v) => cmd.setViewportMode(ctx, v),
    { ariaLabel: t('header.mode') },
  );
  mode.el.setAttribute('data-tip', t('header.modeTip'));
  mode.el.setAttribute('data-kbd', kbdFor('viewportMode'));
  const fullBtn = mode.el.querySelectorAll('button')[1] as HTMLButtonElement;
  const reason = h('span', { class: 'aux mode-reason' });
  scope.watch(
    (_s, u) => [u.viewportMode, u.engine] as const,
    () => {
      const u = ui.get();
      mode.set(effectiveMode(u));
      const why = cmd.fullModeReason(ctx);
      fullBtn.disabled = why !== null;
      fullBtn.setAttribute('data-tip', why ? t(why) : t('header.modeTip'));
      reason.textContent = why ? t(why) : '';
      reason.style.display = why ? '' : 'none';
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );

  // U11: Denoise, to the right of Fast · Full: the live denoise of the Full viewport. The same switch as the meter's
  // and as the Viewport part of Render settings ▸ Advanced ▸ Denoise (the project's, undoable); in Fast it is off
  // to the hand, with the reason in its tooltip.
  const denoiseBtn = h(
    'button',
    { type: 'button', 'aria-pressed': 'false', 'aria-label': t('header.denoise'), 'data-denoise-toggle': '', onclick: () => cmd.toggleViewportDenoise(ctx) },
    t('header.denoise'),
  ) as HTMLButtonElement;
  const denoise = h('div', { class: 'seg hdr-denoise', role: 'group', 'aria-label': t('header.denoise'), 'data-kbd': kbdFor('viewportDenoise') }, denoiseBtn);
  scope.watch(
    (s, u) => [cmd.viewportDenoiseOn(s), effectiveMode(u)] as const,
    ([on]) => {
      const why = cmd.viewportDenoiseReason(ctx);
      denoiseBtn.setAttribute('aria-pressed', String(on));
      denoiseBtn.disabled = why !== null;
      denoise.setAttribute('data-tip', why ? t(why) : t('header.denoiseTip'));
      denoise.dataset.on = on ? '1' : '0';
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  // Fast · Full and Denoise are one area of the top bar (the guided tour's step rings both).
  const modeArea = h('div', { class: 'hdr-mode', 'data-guide': 'viewport-mode' }, mode.el, denoise);

  const search = h(
    'button',
    { type: 'button', class: 'search-trigger', 'aria-label': t('header.search'), 'data-kbd': kbdFor('palette'), onclick: () => ui.set({ paletteOpen: true }) },
    icon('search', 14),
    h('span', null, t('header.search')),
    h('kbd', null, kbdFor('palette')),
  );
  const guideBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('header.guide'), 'data-tip': t('header.guide'), 'data-guide': 'guide', onclick: () => cmd.openGuide(ctx) }, icon('guide'));
  const themeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('theme.toggle'), 'data-tip': t('theme.toggle'), onclick: () => cmd.toggleTheme(ctx) }, icon('theme'));

  return h(
    'header',
    { class: 'hdr' },
    h('div', { class: 'hdr-left' }, menuBtn, nameEl),
    h('div', { class: 'hdr-center' }, undoBtn, redoBtn, h('span', { class: 'hdr-sep' }), modeArea, reason),
    h('div', { class: 'hdr-right' }, search, guideBtn, themeBtn),
  );
}

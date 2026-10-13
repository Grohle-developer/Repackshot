// Header (UI.md §2.1): app menu, project name, undo / redo, search, guide, theme.

import { VERSION } from '../../core/version';
import * as cmd from '../commands';
import { confirmBox, openFloating, openMenu, type MenuEntry } from '../components/widgets';
import { h, icon } from '../dom';
import type { Ctx, Scope } from '../reactive';
import { ACTIONS, kbdFor, kbdText } from '../shortcuts';
import { t } from '../strings';

function shortcutSheet(): HTMLElement {
  const rows = ACTIONS.filter((a) => a.keys && !a.id.startsWith('tool.')).map((a) =>
    h('div', { class: 'menu-item', style: 'cursor:default' }, h('span', null, t(a.label)), h('span', { class: 'menu-right' }, h('kbd', null, kbdText(a.keys)), ...(a.altKeys ?? []).map((k) => h('kbd', null, kbdText(k))))),
  );
  return h(
    'div',
    { class: 'menu', style: 'max-height:70vh;overflow:auto;min-width:340px' },
    h('div', { class: 'menu-label aux' }, t('shortcuts.title')),
    ...rows,
    h('div', { class: 'menu-item', style: 'cursor:default' }, h('span', null, t('shortcuts.tools')), h('span', { class: 'menu-right' }, ...['v', 'o', 'p', 'z', 'm'].map((k) => h('kbd', null, k.toUpperCase())))),
  );
}

export function header(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const menuBtn = h('button', { type: 'button', class: 'btn', style: 'border-color:transparent;background:transparent', 'aria-label': t('menu.open'), 'aria-haspopup': 'menu' }, icon('menu'), h('span', { class: 'brand' }, t('app.name')));

  const openAppMenu = () => {
    const s = store.get();
    const entries: (MenuEntry | null | { heading: string })[] = [
      {
        label: t('menu.new'),
        icon: 'file',
        run: () => {
          if (!store.get().meta.dirty) return cmd.newProject(ctx);
          let close = () => {};
          close = openFloating(menuBtn, confirmBox({ message: t('menu.newConfirm'), options: [{ label: t('common.yes'), primary: true, run: () => cmd.newProject(ctx) }], cancelLabel: t('common.no') }, () => close()));
        },
      },
      { label: t('menu.openProject'), icon: 'folder', disabled: true, note: t('menu.openSoon') },
      { label: t('menu.save'), icon: 'save', kbd: kbdFor('save'), run: () => cmd.saveProject(ctx) },
      { label: t('menu.import'), icon: 'upload', kbd: kbdFor('import'), run: () => void cmd.importDialog(ctx) },
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
      null,
      { label: t('menu.guide'), icon: 'guide', run: () => cmd.openGuide(ctx) },
      { label: t('menu.shortcuts'), icon: 'keyboard', run: () => openFloating(menuBtn, shortcutSheet()) },
      {
        label: t('menu.about'),
        icon: 'info',
        run: () => openFloating(menuBtn, h('div', { class: 'menu' }, h('div', { class: 'menu-note note', style: 'padding:10px 12px' }, t('menu.aboutText', { version: VERSION })))),
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
    h('div', { class: 'hdr-center' }, undoBtn, redoBtn),
    h('div', { class: 'hdr-right' }, search, guideBtn, themeBtn),
  );
}

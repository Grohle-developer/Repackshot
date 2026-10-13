// The Settings window (UI.md §2.9): the second and last window of the
// application (§4.3). About 960 × 680, centred over the dimmed application,
// moved by its title bar, closed with Esc or ×, the last section remembered.
// Left column (232 px): a search field (Ctrl/⌘ F) over the sections, grouped
// Application · Render · System, as a listbox moved with the arrows. Right:
// the section's title, a one-line description and its rows in titled blocks,
// generated from the metadata of core/settings.ts (sections with their own
// content add renderers through settings-sections.ts and settings-ai.ts).
// Changes are saved at once: there is no OK or Cancel.

import { rowsOf, searchSettings, SECTION_GROUPS, SECTIONS, type RowMeta, type SectionId } from '../../core/settings';
import type { Lang } from '../../data/types';
import * as cmd from '../commands';
import { h, icon, isTyping, placeAt } from '../dom';
import { dyn } from '../names';
import { dynamic, type Ctx, type Scope } from '../reactive';
import { kbdText } from '../shortcuts';
import { getLang, STRINGS, t, type StringKey } from '../strings';
import { AI_HOOKS } from './settings-ai';
import { blockEl, rowLabel, settingRow } from './settings-rows';
import { SECTION_HOOKS, type SettingsHooks } from './settings-sections';
import { UPDATES_HOOKS } from './settings-updates';

const HOOKS: SettingsHooks = {
  rows: { ...SECTION_HOOKS.rows, ...AI_HOOKS.rows, ...UPDATES_HOOKS.rows },
  blocks: { ...SECTION_HOOKS.blocks, ...AI_HOOKS.blocks, ...UPDATES_HOOKS.blocks },
  rowOptions: { ...SECTION_HOOKS.rowOptions, ...AI_HOOKS.rowOptions, ...UPDATES_HOOKS.rowOptions },
  top: { ...SECTION_HOOKS.top, ...AI_HOOKS.top, ...UPDATES_HOOKS.top },
};

/** Ids of rows drawn by their own code (tests check every such row has a renderer). */
export const CUSTOM_ROW_IDS: readonly string[] = Object.keys(HOOKS.rows ?? {});
export const CUSTOM_BLOCK_IDS: readonly string[] = Object.keys(HOOKS.blocks ?? {});

const sectionTitle = (id: SectionId) => t(dyn(`set.sec.${id}`));
const searchLabel = (row: RowMeta, lang: Lang) => STRINGS[lang][`set.${row.id}` as StringKey] ?? '';

function visibleSections(ctx: Ctx): SectionId[] {
  const desktop = ctx.ui.get().desktop !== null;
  return SECTIONS.filter((s) => !s.desktopOnly || desktop).map((s) => s.id);
}

/** The right column for one section. */
function sectionContent(ctx: Ctx, scope: Scope, id: SectionId): HTMLElement {
  const desktop = ctx.ui.get().desktop !== null;
  const titleId = `sw-sec-${id}`;
  const blocks: HTMLElement[] = [];
  const rows = rowsOf(id).filter((r) => !r.desktopOnly || desktop);
  const byBlock = new Map<string, RowMeta[]>();
  for (const r of rows) byBlock.set(r.block, [...(byBlock.get(r.block) ?? []), r]);
  for (const [block, list] of byBlock) {
    const custom = HOOKS.blocks?.[block];
    if (custom) {
      const el = custom(ctx, scope, list);
      if (el) blocks.push(el);
      continue;
    }
    const els = list.map((r) => {
      const own = HOOKS.rows?.[r.id];
      if (own) return own(ctx, scope, r);
      if (r.kind === 'setting' && r.control.kind !== 'custom') return settingRow(ctx, scope, r, HOOKS.rowOptions?.[r.id]?.(ctx) ?? {});
      return null;
    });
    blocks.push(blockEl(block, t(dyn(`set.block.${block}`)), ...els));
  }
  const hasSettings = rows.some((r) => r.kind === 'setting' && !r.comingSoon);
  const status = h('span', { class: 'note', role: 'status', 'aria-live': 'polite' });
  const resetAll = h(
    'button',
    {
      type: 'button',
      class: 'btn sw-reset-section',
      onclick: () => {
        const n = cmd.resetSettingsSection(ctx, id);
        status.textContent = n === 1 ? t('set.resetSectionDone1') : n > 0 ? t('set.resetSectionDone', { n }) : t('set.resetSectionNone');
      },
    },
    t('set.resetSection'),
  );
  const top = HOOKS.top?.[id]?.(ctx, scope) ?? null;
  return h(
    'div',
    { class: 'sw-section', 'data-section': id, role: 'region', 'aria-labelledby': titleId },
    h('header', { class: 'sw-head' }, h('h3', { class: 'sw-title', id: titleId }, sectionTitle(id)), h('p', { class: 'note sw-desc' }, t(dyn(`set.sec.${id}.desc`)))),
    top,
    ...blocks,
    hasSettings ? h('div', { class: 'sw-section-foot' }, resetAll, status) : null,
  );
}

export function settingsWindow(ctx: Ctx, scope: Scope): HTMLElement {
  const { ui } = ctx;
  let query = '';

  // ------------------------------------------------------------------ left column
  const search = h('input', {
    type: 'search',
    class: 'text-input sw-search',
    placeholder: t('set.search'),
    'aria-label': t('set.search'),
    'aria-controls': 'sw-list',
    'data-tip': t('set.search'),
    'data-kbd': kbdText('mod+f'),
    spellcheck: 'false',
    autocomplete: 'off',
  }) as HTMLInputElement;
  const count = h('div', { class: 'sw-count aux', role: 'status', 'aria-live': 'polite' });
  const list = h('div', { class: 'sw-list', id: 'sw-list', role: 'listbox', 'aria-label': t('set.sections') });

  const options = () => [...list.querySelectorAll<HTMLElement>('[role="option"]')];
  const focusOption = (el: HTMLElement | undefined) => {
    if (!el) return;
    for (const o of options()) o.tabIndex = o === el ? 0 : -1;
    el.focus();
  };

  const renderNav = () => {
    // A rebuilt list keeps the keyboard focus on the same option.
    const had = list.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const key = had ? (had.dataset.section ?? had.dataset.target ?? null) : null;
    build();
    if (key) {
      const again = options().find((o) => (o.dataset.section ?? o.dataset.target) === key) ?? options().find((o) => o.getAttribute('aria-selected') === 'true');
      focusOption(again);
    }
  };
  const build = () => {
    const current = ui.get().settingsWindow?.section;
    if (query.trim()) {
      const hits = searchSettings(query, { lang: getLang(), label: searchLabel, desktop: ui.get().desktop !== null });
      count.textContent = hits.length === 1 ? t('set.searchCount1') : hits.length ? t('set.searchCount', { n: hits.length }) : t('set.searchNone', { q: query.trim() });
      list.setAttribute('aria-label', t('set.search'));
      list.replaceChildren(
        ...hits.slice(0, 40).map((hit, i) =>
          h(
            'div',
            { class: 'sw-option sw-hit', role: 'option', id: `sw-hit-${i}`, tabindex: i === 0 ? 0 : -1, 'aria-selected': 'false', 'data-target': hit.row.id, onclick: () => cmd.openSettings(ctx, hit.row.id) },
            h('span', { class: 'sw-hit-label' }, rowLabel(hit.row.id)),
            h('span', { class: 'sw-hit-path note' }, `${sectionTitle(hit.row.section)} ▸ ${rowLabel(hit.row.id)}`),
          ),
        ),
      );
      return;
    }
    count.textContent = '';
    list.setAttribute('aria-label', t('set.sections'));
    const visible = visibleSections(ctx);
    list.replaceChildren(
      ...SECTION_GROUPS.map((g) => {
        const gid = `sw-g-${g}`;
        const items = SECTIONS.filter((s) => s.group === g && visible.includes(s.id));
        return h(
          'div',
          { class: 'sw-group', role: 'group', 'aria-labelledby': gid },
          h('div', { class: 'sw-group-title', id: gid, role: 'presentation' }, t(dyn(`set.group.${g}`))),
          ...items.map((s) =>
            h(
              'div',
              { class: 'sw-option', role: 'option', id: `sw-opt-${s.id}`, 'data-section': s.id, tabindex: s.id === current ? 0 : -1, 'aria-selected': String(s.id === current), onclick: () => cmd.openSettings(ctx, s.id) },
              sectionTitle(s.id),
            ),
          ),
        );
      }),
    );
  };
  search.addEventListener('input', () => {
    query = search.value;
    renderNav();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusOption(options()[0]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      options()[0]?.click();
    }
  });
  list.addEventListener('keydown', (e) => {
    const all = options();
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowDown') next = all[Math.min(all.length - 1, i + 1)];
    else if (e.key === 'ArrowUp') {
      if (i === 0 && query) {
        e.preventDefault();
        search.focus();
        return;
      }
      next = all[Math.max(0, i - 1)];
    } else if (e.key === 'Home') next = all[0];
    else if (e.key === 'End') next = all[all.length - 1];
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      all[i].click();
      return;
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      (content.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), [role="spinbutton"]:not(.is-disabled), a[href], summary') as HTMLElement | null)?.focus();
      return;
    } else return;
    e.preventDefault();
    focusOption(next);
    // In the list of sections the selection follows the focus.
    if (!query && next?.dataset.section) cmd.openSettings(ctx, next.dataset.section);
  });

  scope.watch((_s, u) => u.desktop !== null, () => renderNav());

  // ------------------------------------------------------------------ right column
  const content = h('div', { class: 'sw-content' });
  const sectionHost = dynamic(
    scope,
    (_s, u) => `${u.settingsWindow?.section ?? ''}|${u.desktop ? 'd' : 'w'}`,
    (sc, key) => {
      const id = key.split('|')[0] as SectionId;
      return id ? sectionContent(ctx, sc, id) : null;
    },
    undefined,
    'div',
    'sw-section-host',
  );
  content.appendChild(sectionHost);

  // Deep links: bring the row (or part) into view and highlight it.
  scope.watch(
    (_s, u) => [u.settingsWindow?.section, u.settingsWindow?.focus, u.settingsWindow?.nonce] as const,
    ([section, focus]) => {
      renderNav();
      if (!section) return;
      requestAnimationFrame(() => {
        if (!focus) {
          content.scrollTop = 0;
          return;
        }
        const el = content.querySelector<HTMLElement>(`[data-row="${CSS.escape(focus)}"], [data-part="${CSS.escape(focus)}"]`);
        if (!el) return;
        // A row is centred; a part taller than the window (the model list) starts at the top.
        el.scrollIntoView({ block: el.offsetHeight > content.clientHeight * 0.8 ? 'start' : 'center' });
        el.classList.remove('is-flash');
        void el.offsetWidth;
        el.classList.add('is-flash');
        (el.querySelector('button:not(:disabled):not(.sw-reset), input:not(:disabled), select:not(:disabled), [role="spinbutton"]') as HTMLElement | null)?.focus({ preventScroll: true });
      });
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  );

  // ------------------------------------------------------------------ the window
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('set.close'), 'data-tip': t('set.close'), 'data-kbd': t('key.escape'), onclick: () => cmd.closeSettings(ctx) }, icon('close'));
  const titleBar = h('div', { class: 'sw-titlebar' }, h('h2', { class: 'sw-window-title', id: 'sw-window-title' }, t('set.title')), h('span', { style: 'flex:1' }), closeBtn);
  const nav = h('nav', { class: 'sw-nav', 'aria-label': t('set.sections') }, search, count, list);
  const foot = h('div', { class: 'sw-foot note' }, t('set.footer'));
  const win = h('div', { class: 'sw', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sw-window-title', tabindex: -1, 'data-settings-window': '' }, titleBar, h('div', { class: 'sw-main' }, nav, content), foot);
  const backdrop = h('div', { class: 'sw-backdrop', 'aria-hidden': 'true', onpointerdown: () => cmd.closeSettings(ctx) });
  const host = h('div', { class: 'sw-host' }, backdrop, win);

  // Moved by the title bar (screen pixels; the window may be zoomed by the interface size).
  const place = (x: number, y: number) => {
    const r = win.getBoundingClientRect();
    const nx = Math.max(120 - r.width, Math.min(window.innerWidth - 120, x));
    const ny = Math.max(8, Math.min(window.innerHeight - 48, y));
    win.style.transform = 'none';
    placeAt(win, nx, ny);
    return { x: nx, y: ny };
  };
  const pos0 = ui.get().settingsPos;
  if (pos0) requestAnimationFrame(() => place(pos0.x, pos0.y));
  titleBar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select')) return;
    e.preventDefault();
    const r = win.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    let last = { x: r.left, y: r.top };
    try {
      titleBar.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events.
    }
    win.classList.add('is-moving');
    const move = (ev: PointerEvent) => (last = place(ev.clientX - dx, ev.clientY - dy));
    const up = () => {
      win.classList.remove('is-moving');
      titleBar.removeEventListener('pointermove', move);
      titleBar.removeEventListener('pointerup', up);
      titleBar.removeEventListener('pointercancel', up);
      ui.set({ settingsPos: last });
    };
    titleBar.addEventListener('pointermove', move);
    titleBar.addEventListener('pointerup', up);
    titleBar.addEventListener('pointercancel', up);
  });
  titleBar.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    win.style.left = '';
    win.style.top = '';
    win.style.transform = '';
    ui.set({ settingsPos: null });
  });

  // ------------------------------------------------------------------ keys
  const focusables = () => [...win.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, a[href], summary, [tabindex="0"]')].filter((el) => el.offsetParent !== null || el === document.activeElement);
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing) return;
    if (ui.get().paletteOpen || document.querySelector('.floating')) return;
    const target = e.target as HTMLElement | null;
    const inside = target ? win.contains(target) || target === document.body : true;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F' || e.code === 'KeyF')) {
      e.preventDefault();
      e.stopPropagation();
      search.focus();
      search.select();
      return;
    }
    if (e.key === 'Escape') {
      if (target === search && search.value) {
        e.preventDefault();
        e.stopPropagation();
        search.value = '';
        query = '';
        renderNav();
        return;
      }
      // A field being typed in keeps its own Esc (it restores its value).
      if (isTyping(e) && target?.getAttribute?.('role') !== 'spinbutton' && target !== search) return;
      e.preventDefault();
      e.stopPropagation();
      cmd.closeSettings(ctx);
      return;
    }
    if (e.key === 'Tab' && inside) {
      // Focus stays in the window while it is open.
      const all = focusables();
      if (all.length === 0) return;
      const first = all[0];
      const last = all[all.length - 1];
      if (e.shiftKey && (document.activeElement === first || !win.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !win.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  scope.onDispose(() => document.removeEventListener('keydown', onKey, true));

  // The focus goes to the current section in the list, so the arrows work at once; it comes back on close.
  const opener = document.activeElement as HTMLElement | null;
  scope.onDispose(() => {
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  });
  requestAnimationFrame(() => {
    if (ui.get().settingsWindow?.focus) return;
    const sel = list.querySelector<HTMLElement>('[aria-selected="true"]');
    (sel ?? win).focus({ preventScroll: true });
  });
  return host;
}

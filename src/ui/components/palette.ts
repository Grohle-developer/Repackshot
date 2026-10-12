// Command palette (Ctrl/⌘ K, UI.md §3): one field that searches actions,
// materials, light setups, product types, cameras, studios and animation
// presets at once, in both languages, accents ignored. Confirmations that a
// command needs are shown inside the palette and answered with the keyboard.

import { SEQUENCE_PRESETS } from '../../data/animation';
import { LIGHT_SETUPS } from '../../data/light-setups';
import { MATERIAL_PRESETS } from '../../data/materials';
import { STUDIO_PRESETS } from '../../data/studios';
import type { Label } from '../../data/types';
import * as cmd from '../commands';
import { h } from '../dom';
import { cameraLabel, studioLabel } from '../names';
import type { Ctx } from '../reactive';
import { ACTIONS, kbdText } from '../shortcuts';
import { L, getLang, t, type StringKey } from '../strings';
import type { ConfirmSpec } from './widgets';

interface Item {
  id: string;
  category: StringKey;
  label: Label;
  kbd?: string;
  run(): void | ConfirmSpec | null | Promise<void>;
}

/** Lowercase, accents removed: "Joyería" and "joyeria" match. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function items(ctx: Ctx): Item[] {
  const s = ctx.store.get();
  const out: Item[] = [];
  for (const a of ACTIONS) {
    if (a.palette === false) continue;
    out.push({ id: `action:${a.id}`, category: 'palette.cat.action', label: L(a.label), kbd: kbdText(a.keys), run: () => a.run(ctx) });
  }
  for (const p of STUDIO_PRESETS) out.push({ id: `product:${p.key}`, category: 'palette.cat.product', label: studioLabel(p.key), run: () => cmd.setProductType(ctx, p.key) });
  for (const m of MATERIAL_PRESETS) out.push({ id: `material:${m.key}`, category: 'palette.cat.material', label: m.label, run: () => cmd.requestAssign(ctx, { preset: m.key }) });
  for (const st of LIGHT_SETUPS) out.push({ id: `setup:${st.key}`, category: 'palette.cat.setup', label: st.label, run: () => cmd.requestSetup(ctx, st.key) });
  for (const cam of Object.values(s.camera.cameras)) out.push({ id: `camera:${cam.id}`, category: 'palette.cat.camera', label: cameraLabel(s, cam), run: () => cmd.activateCamera(ctx, cam.id) });
  for (const st of s.studio.saved) out.push({ id: `studio:${st.id}`, category: 'palette.cat.studio', label: { en: st.name, es: st.name }, run: () => cmd.restoreStudio(ctx, st.id) });
  for (const q of SEQUENCE_PRESETS)
    out.push({
      id: `sequence:${q.key}`,
      category: 'palette.cat.sequence',
      label: q.label,
      run: () => {
        ctx.store.dispatch({ type: 'anim/preset', key: q.key, label: L('undo.sequence', { name: q.label }) });
        ctx.ui.set({ drawer: 'animation' });
      },
    });
  return out;
}

/** Ranks items for a query; exported for tests of the search. */
export function rank<T extends { label: Label; category: StringKey }>(list: readonly T[], query: string): T[] {
  const q = normalize(query);
  if (!q) return list.slice(0, 60) as T[];
  const tokens = q.split(/\s+/).filter(Boolean);
  const lang = getLang();
  const scored: { item: T; score: number; i: number }[] = [];
  list.forEach((item, i) => {
    const mine = normalize(item.label[lang]);
    const other = normalize(item.label[lang === 'en' ? 'es' : 'en']);
    const cat = normalize(`${t(item.category)}`);
    const hay = `${mine} ${other} ${cat}`;
    if (!tokens.every((tok) => hay.includes(tok))) return;
    let score = 0;
    for (const label of [mine, other]) {
      if (label === q) score = Math.max(score, 1000);
      else if (label.startsWith(q)) score = Math.max(score, 600);
      else if (label.split(/[\s:(),·-]+/).some((w) => w.startsWith(tokens[0]))) score = Math.max(score, 300);
      else if (label.includes(q)) score = Math.max(score, 200);
    }
    if (score === 0) score = 50;
    if (item.category === 'palette.cat.action') score += 5;
    scored.push({ item, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, 60).map((x) => x.item);
}

let open: (() => void) | null = null;

export function closePalette(): void {
  open?.();
}

/** Opens the palette; closing sets `paletteOpen` back to false. */
export function openPalette(ctx: Ctx): void {
  if (open) return;
  const all = items(ctx);
  const backdrop = h('div', { class: 'palette-backdrop' });
  const input = h('input', { class: 'palette-input', type: 'text', placeholder: t('palette.placeholder'), 'aria-label': t('palette.placeholder'), autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const list = h('div', { class: 'palette-list', role: 'listbox' });
  const foot = h('div', { class: 'palette-foot aux' }, t('palette.hint'));
  const box = h('div', { class: 'palette floating', role: 'dialog', 'aria-label': t('action.palette') }, input, list, foot);
  let active = 0;
  let shown: { label: string; aux?: string; kbd?: string; run(): void }[] = [];
  let confirm: ConfirmSpec | null = null;

  const close = () => {
    backdrop.remove();
    box.remove();
    open = null;
    ctx.ui.set({ paletteOpen: false });
  };
  open = close;

  const execute = (fn: () => void | ConfirmSpec | null | Promise<void>) => {
    const r = fn();
    if (r && typeof r === 'object' && 'options' in r) {
      confirm = r;
      input.value = '';
      input.readOnly = true;
      render();
      return;
    }
    close();
  };

  const render = () => {
    list.replaceChildren();
    if (confirm) {
      const c = confirm;
      list.appendChild(h('div', { class: 'palette-msg' }, c.message));
      shown = [
        ...c.options.map((o) => ({ label: o.label, run: () => (close(), o.run()) })),
        { label: c.cancelLabel ?? t('common.cancel'), run: () => close() },
      ];
    } else {
      const lang = getLang();
      shown = rank(all, input.value).map((it) => ({ label: it.label[lang], aux: t(it.category), kbd: it.kbd, run: () => execute(it.run) }));
      if (shown.length === 0) list.appendChild(h('div', { class: 'palette-msg aux' }, t('palette.noResults')));
    }
    active = Math.min(active, Math.max(0, shown.length - 1));
    shown.forEach((it, i) => {
      const row = h(
        'div',
        {
          class: `palette-item${i === active ? ' is-active' : ''}`,
          role: 'option',
          'aria-selected': String(i === active),
          onmousemove: () => {
            if (active !== i) {
              active = i;
              highlight();
            }
          },
          onclick: () => it.run(),
        },
        h('span', { class: 'palette-label' }, it.label),
        it.aux ? h('span', { class: 'aux' }, it.aux) : null,
        it.kbd ? h('kbd', null, it.kbd) : null,
      );
      list.appendChild(row);
    });
  };
  const highlight = () => {
    const rows = list.querySelectorAll('.palette-item');
    rows.forEach((r, i) => {
      r.classList.toggle('is-active', i === active);
      r.setAttribute('aria-selected', String(i === active));
    });
    (rows[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(shown.length - 1, active + 1);
      highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, active - 1);
      highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      shown[active]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      close();
    }
  });
  backdrop.addEventListener('pointerdown', close);
  document.body.append(backdrop, box);
  render();
  input.focus();
}

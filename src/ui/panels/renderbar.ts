// Render bar (UI.md §2.5): drawer tabs, quality, resolution, budget, format,
// Render and Add to queue. The drawer (Animation or Queue) opens above it.

import { QUALITY_KEYS, QUALITY_PRESETS, RESOLUTION_PRESETS } from '../../data/quality';
import { matchResolution, supportsAlpha, type OutputFormat } from '../../core/render';
import * as cmd from '../commands';
import { numberField, segmented, select, toggle } from '../components/controls';
import { h, icon } from '../dom';
import { dynamic, shallowEq, type Ctx, type Scope } from '../reactive';
import { kbdFor } from '../shortcuts';
import { L, formatClock, lbl, t } from '../strings';
import { animationDrawer } from './animation';
import { queueDrawer } from './queue';

export function renderBar(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const r0 = store.get().render;

  const drawerTabs = segmented(
    [
      { value: 'animation' as const, label: h('span', { style: 'display:inline-flex;gap:5px;align-items:center' }, icon('film', 14), t('render.animation')) },
      { value: 'queue' as const, label: h('span', { style: 'display:inline-flex;gap:5px;align-items:center' }, icon('queue', 14), t('render.queue')) },
    ],
    ui.get().drawer,
    (v) => ui.set({ drawer: ui.get().drawer === v ? null : v }),
    { ariaLabel: t('render.animation') },
  );
  scope.watch((_s, u) => u.drawer, (d) => drawerTabs.set(d));

  const quality = segmented(
    QUALITY_KEYS.map((k) => ({ value: k, label: lbl(QUALITY_PRESETS[k].label) })),
    r0.quality === 'CUSTOM' ? null : r0.quality,
    (q) => store.dispatch({ type: 'render/quality', quality: q, label: L('undo.quality', { name: QUALITY_PRESETS[q].label }) }),
    { ariaLabel: t('render.quality') },
  );
  const custom = h('span', { class: 'aux' }, t('render.custom'));

  const resOptions = [...RESOLUTION_PRESETS.map((r) => ({ value: r.key, label: lbl(r.label) })), { value: 'CUSTOM', label: t('render.customSize') }];
  const resSel = select(
    resOptions,
    matchResolution(r0.width, r0.height),
    (v) => {
      if (v === 'CUSTOM') {
        ui.set({ customResolution: true });
        return;
      }
      ui.set({ customResolution: false });
      const p = RESOLUTION_PRESETS.find((x) => x.key === v)!;
      store.dispatch({ type: 'render/set', patch: { width: p.width, height: p.height }, label: L('undo.resolution', { w: p.width, h: p.height }) });
    },
    t('render.resolution'),
  );
  resSel.el.setAttribute('data-guide', 'resolution');
  scope.watch((s) => `${s.render.width} × ${s.render.height}`, (v) => resSel.el.setAttribute('data-tip', v));
  const width = numberField({ value: r0.width, min: 16, max: 8192, step: 1, unit: 'px', ariaLabel: t('render.width'), onChange: (v, g) => store.dispatch({ type: 'render/set', patch: { width: v }, gesture: g, label: L('undo.render') }) });
  const height = numberField({ value: r0.height, min: 16, max: 8192, step: 1, unit: 'px', ariaLabel: t('render.height'), onChange: (v, g) => store.dispatch({ type: 'render/set', patch: { height: v }, gesture: g, label: L('undo.render') }) });
  const customBox = h('span', { class: 'bar-group' }, width.el, h('span', { class: 'aux' }, '×'), height.el);

  const samples = numberField({ value: r0.maxSamples, min: 1, max: 100000, step: 16, ariaLabel: t('render.samples'), onChange: (v, g) => store.dispatch({ type: 'render/set', patch: { maxSamples: v }, gesture: g, label: L('undo.render') }) });
  const seconds = numberField({ value: r0.maxSeconds, min: 0, max: 86400, step: 10, format: formatClock, ariaLabel: t('render.budget'), onChange: (v, g) => store.dispatch({ type: 'render/set', patch: { maxSeconds: v }, gesture: g, label: L('undo.render') }) });

  const format = segmented<OutputFormat>(
    [
      { value: 'PNG', label: 'PNG' },
      { value: 'JPEG', label: 'JPEG' },
      { value: 'EXR', label: 'EXR', disabled: true, title: t('render.exrSoon') },
    ],
    r0.format,
    (v) => store.dispatch({ type: 'render/set', patch: { format: v }, label: L('undo.render') }),
    { ariaLabel: t('render.format') },
  );
  const transparent = toggle(r0.transparent, (v) => store.dispatch({ type: 'render/set', patch: { transparent: v }, label: L('undo.render') }), t('render.transparent'));
  transparent.el.setAttribute('data-tip', t('render.transparent'));

  const edge = h('span', { class: 'progress-edge', style: 'width:0' });
  const renderLabel = h('span', null, t('render.render'));
  const renderBtn = h('button', { type: 'button', class: 'btn btn-primary btn-big', 'data-kbd': kbdFor('render'), 'data-tip': t('action.render'), 'data-guide': 'render', onclick: () => void cmd.render(ctx) }, renderLabel, edge);
  const queueBtn = h('button', { type: 'button', class: 'btn', onclick: () => cmd.enqueue(ctx) }, icon('plus', 14), t('render.addQueue'));

  scope.watch(
    (s, u) => [s.render, u.customResolution],
    () => {
      const r = store.get().render;
      quality.set(r.quality === 'CUSTOM' ? null : r.quality);
      custom.style.display = r.quality === 'CUSTOM' ? '' : 'none';
      const match = matchResolution(r.width, r.height);
      const isCustom = ui.get().customResolution || match === 'CUSTOM';
      resSel.set(isCustom ? 'CUSTOM' : match);
      customBox.style.display = isCustom ? '' : 'none';
      width.set(r.width);
      height.set(r.height);
      samples.set(r.maxSamples);
      seconds.set(r.maxSeconds);
      format.set(r.format);
      transparent.set(r.transparent);
      (transparent.el as HTMLButtonElement).disabled = !supportsAlpha(r.format);
      const running = r.running && r.running.jobId === null ? r.running : null;
      renderLabel.textContent = running ? t('render.stop') : t('render.render');
      edge.style.width = running ? `${Math.round(running.progress * 100)}%` : '0';
    },
    shallowEq,
  );

  const drawer = dynamic(
    scope,
    (_s, u) => u.drawer,
    (sc, d) => (d === 'animation' ? animationDrawer(ctx, sc) : d === 'queue' ? queueDrawer(ctx, sc) : null),
    undefined,
    'div',
    'drawer-host',
  );
  scope.watch((_s, u) => u.drawer, (d) => drawer.classList.toggle('drawer', d !== null));

  const bar = h(
    'div',
    { class: 'bar', role: 'toolbar', 'aria-label': t('render.render') },
    h('div', { class: 'bar-group' }, drawerTabs.el),
    h(
      'div',
      { class: 'bar-mid' },
    h('div', { class: 'bar-group', 'data-tip': t('render.quality') }, h('span', { class: 'field-label' }, t('render.quality')), quality.el, custom),
    h('div', { class: 'bar-group' }, h('span', { class: 'field-label' }, t('render.resolution')), resSel.el, customBox),
    h(
      'div',
      { class: 'bar-group', 'data-tip': t('render.previewNote') },
      h('span', { class: 'field-label' }, t('render.budget')),
      h('span', { class: 'aux' }, t('render.upTo')),
      samples.el,
      h('span', { class: 'aux' }, t('render.samples')),
      h('span', { class: 'aux' }, t('render.or')),
      seconds.el,
    ),
    h('div', { class: 'bar-group' }, h('span', { class: 'field-label' }, t('render.format')), format.el, transparent.el),
    ),
    h('div', { class: 'render-btn-wrap' }, queueBtn, renderBtn),
  );
  return h('section', { class: 'bar-wrap' }, drawer, bar);
}

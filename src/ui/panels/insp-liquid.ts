// Inspector ▸ Liquid (UI.md §2.4, phase S7): for a part Convert to liquid made, its preset (how it moves, and its look
// on its own material), its particle size (automatic from its volume, or its own), what the volume gives (an estimate,
// said as one) or what a run recorded (the engine's count), the part it came from, and the engine's word when the render
// engine in use cannot draw it inside its glass (bit 14, nested dielectrics). Every change is an action of the store.

import { autoSpacing, hasLiquidSurfacer, liquidSpacing, liquidVolume, presetOf } from '../../core/liquid';
import type { NodeId } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import { LIQUID_PRESETS, LIQUID_SPACING_LIMITS, LIQUID_TARGET_PARTICLES } from '../../data/liquids';
import { field, numberField, select, toggle } from '../components/controls';
import { section } from '../components/section';
import { h } from '../dom';
import * as liquid from '../liquid';
import type { Ctx, Scope } from '../reactive';
import { formatNumber, getLang, lbl, t } from '../strings';

/** The recorded run of a liquid part (its last PHYSICS clip with a liquid track), if any. */
function recorded(s: ProjectState, id: NodeId) {
  const clips = s.animation.clips.filter((c) => c.move === 'PHYSICS' && c.liquid && c.liquid.node === id);
  return clips.length > 0 ? clips[clips.length - 1].liquid! : null;
}

export function liquidSection(ctx: Ctx, scope: Scope, ids: NodeId[]): HTMLElement {
  const { store } = ctx;
  const first = ids[0];
  const preset = select(
    LIQUID_PRESETS.map((p) => ({ value: p.key, label: lbl(p.label) })),
    presetOf(store.get().scene.nodes[first]).key,
    (v) => liquid.setLiquidPreset(ctx, ids, v),
    t('liquid.preset'),
  );
  preset.el.setAttribute('data-field', 'liquid.preset');
  const spacing = numberField({
    value: liquidSpacing(store.get(), first),
    min: LIQUID_SPACING_LIMITS.min,
    max: LIQUID_SPACING_LIMITS.max,
    step: 0.1,
    digits: 2,
    unit: 'mm',
    ariaLabel: t('liquid.spacing'),
    onChange: (v, g) => liquid.setLiquidSpacing(ctx, ids, v, g),
  });
  spacing.el.setAttribute('data-field', 'liquid.spacing');
  const auto = toggle(true, (on) => liquid.setLiquidSpacing(ctx, ids, on ? null : liquidSpacing(store.get(), first)), t('liquid.spacingAuto'));
  auto.el.setAttribute('data-field', 'liquid.spacingAuto');
  const motion = h('p', { class: 'note', style: 'margin:0', 'data-field': 'liquid.motion' });
  const count = h('p', { class: 'note', style: 'margin:0', 'data-field': 'liquid.count' });
  const from = h('p', { class: 'note', style: 'margin:0', 'data-field': 'liquid.from' });
  // The render engine's word: without bit 14 the liquid meets its glass as against air.
  const oldEngine = h('div', { class: 'note', 'data-liquid': 'old-engine' }, t('liquid.oldEngine'));
  const noSurface = h('div', { class: 'note', 'data-liquid': 'no-surface' }, t('liquid.noSurface'));

  scope.watch(
    (s, u) => [s.scene.nodes, s.animation.clips, u.engineInfo?.nested] as const,
    () => {
      const s = store.get();
      const node = s.scene.nodes[first];
      if (!node?.liquid) return;
      const p = presetOf(node);
      preset.set(p.key);
      const own = typeof node.liquid.spacingMm === 'number';
      const mm = liquidSpacing(s, first);
      spacing.set(mm);
      spacing.el.classList.toggle('is-disabled', !own);
      auto.set(!own);
      const volume = liquidVolume(s, first);
      auto.el.setAttribute('data-tip', t('liquid.spacingAutoTip', { n: formatNumber(LIQUID_TARGET_PARTICLES, getLang(), 0), mm: formatNumber(autoSpacing(volume), getLang(), 2) }));
      motion.textContent = t('liquid.viscosity', { v: formatNumber(p.viscosity, getLang(), 1), d: formatNumber(p.density, getLang(), 0) });
      const track = recorded(s, first);
      count.textContent = track
        ? t('liquid.recorded', { frames: formatNumber(track.frames, getLang(), 0), n: formatNumber(track.particles, getLang(), 0) })
        : t('liquid.estimate', { n: formatNumber(Math.round(volume / (mm * mm * mm)), getLang(), 0), mm: formatNumber(mm, getLang(), 2), ml: formatNumber(volume / 1000, getLang(), 1) });
      const source = node.liquid.source ? s.scene.nodes[node.liquid.source] : undefined;
      from.textContent = source ? t('liquid.from', { name: source.name }) : '';
      from.style.display = source ? '' : 'none';
      oldEngine.style.display = ctx.ui.get().engineInfo?.nested === false ? '' : 'none';
      noSurface.style.display = track && !hasLiquidSurfacer() ? '' : 'none';
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  );

  const body = h(
    'div',
    { class: 'stack', 'data-field': 'liquid' },
    field(t('liquid.preset'), preset.el),
    motion,
    field(t('liquid.spacing'), spacing.el),
    field(t('liquid.spacingAuto'), auto.el),
    count,
    from,
    h('p', { class: 'note', style: 'margin:0' }, t('liquid.note')),
    oldEngine,
    noSurface,
  );
  return section(ctx, 'liquid', t('section.liquid'), body);
}

// The scene's Ambient section (phase S4a, UI.md §2.4): the ambient effects of the project (dust motes, pollen, rain,
// snow, a dust cloud, ash, rising bubbles, falling confetti), a gallery of cards to add one (the S5 volumes listed,
// greyed, coming soon), and the effect being edited: its preset, the eight photographer's knobs and its shape (S3b: out
// of Advanced, decision S3 ◆5) and, folded, Advanced with every other parameter. Every change is an action of the store, one undo entry per drag.

import { DEFAULT_MIX, EFFECT_PRESETS, EFFECT_SHAPES, effectPreset, type EffectKind, type EffectShape } from '../../data/effects';
import { MATERIAL_PRESETS } from '../../data/materials';
import { PARTS_FEED } from '../../data/wet-parts';
import { partsRenderDry, partsRenderNoFlight } from '../../core/wet-parts';
import { effectCap, effectHasShape, engineParticleCap, MAX_PALETTE, mixWeights, requestedParticles, windPolar, windVector, type AmbientEffect, type EffectPatch } from '../../core/effects';
import type { Vec3 } from '../../core/math';
import type { ProjectState } from '../../core/store';
import { colorField, field, numberField, segmented, select, slider, textField, toggle, type Control } from '../components/controls';
import { section } from '../components/section';
import { h, icon } from '../dom';
import { dynamic, type Ctx, type Scope } from '../reactive';
import { L, formatNumber, getLang, lbl, t, type StringKey } from '../strings';

/** The name an effect shows: its own, or its preset's. */
export function effectName(e: AmbientEffect): string {
  return e.name || lbl(effectPreset(e.preset)?.label ?? { en: e.preset, es: e.preset });
}

/** The effect being edited: the one chosen, or the first. */
function editedId(s: ProjectState, chosen: string | null): string | null {
  if (chosen && s.effects.some((e) => e.id === chosen)) return chosen;
  return s.effects[0]?.id ?? null;
}

const count = (n: number) => formatNumber(n, getLang(), 0);

function particlesLine(s: ProjectState, e: AmbientEffect): string {
  const asked = requestedParticles(s, e);
  const cap = effectCap(e, engineParticleCap());
  return asked > cap ? t('ambient.overCap', { n: count(asked), cap: count(cap) }) : t('ambient.particles', { n: count(asked) });
}

/** The list of effects: name, preset and particles, on/off and remove; a click edits it. */
function effectList(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  return dynamic(
    scope,
    (s, u) => JSON.stringify([s.effects.map((e) => [e.id, effectName(e), e.preset, e.enabled, particlesLine(s, e)]), editedId(s, u.effectSelected)]),
    () => {
      const s = store.get();
      if (s.effects.length === 0) return h('div', { class: 'note', 'data-ambient': 'empty' }, t('ambient.empty'));
      const current = editedId(s, ui.get().effectSelected);
      const rows = s.effects.map((e) => {
        const name = effectName(e);
        const eye = h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': e.enabled ? t('ambient.hide', { name }) : t('ambient.show', { name }),
            'data-tip': e.enabled ? t('ambient.hide', { name }) : t('ambient.show', { name }),
            onclick: (ev: Event) => {
              ev.stopPropagation();
              store.dispatch({ type: 'effect/set', id: e.id, patch: { enabled: !e.enabled }, label: L(e.enabled ? 'undo.effectHide' : 'undo.effectShow', { name }) });
            },
          },
          icon(e.enabled ? 'eye' : 'eyeOff', 14),
        );
        const trash = h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': t('ambient.remove', { name }),
            'data-tip': t('ambient.remove', { name }),
            onclick: (ev: Event) => {
              ev.stopPropagation();
              store.dispatch({ type: 'effect/remove', id: e.id, label: L('undo.effectRemove', { name }) });
            },
          },
          icon('trash', 14),
        );
        return h(
          'div',
          {
            class: `list-row${e.id === current ? ' is-selected' : ''}${e.enabled ? '' : ' is-off'}`,
            role: 'button',
            tabindex: 0,
            'data-effect': e.id,
            onclick: () => ui.set({ effectSelected: e.id }),
            onkeydown: (ev: KeyboardEvent) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                ui.set({ effectSelected: e.id });
              }
            },
          },
          h('span', { class: 'grow', style: 'min-width:0' }, h('div', { class: 'ellipsis' }, name), h('div', { class: 'aux ellipsis' }, particlesLine(s, e))),
          eye,
          trash,
        );
      });
      return h('div', { class: 'list', style: 'padding:0', 'data-ambient': 'list' }, ...rows);
    },
  );
}

/** The cards to add an effect: the eight presets, and the three volumes of S5 greyed as coming soon. */
function gallery(ctx: Ctx): HTMLElement {
  const { store, ui } = ctx;
  const cards = EFFECT_PRESETS.map((p) =>
    h(
      'button',
      {
        type: 'button',
        class: `fx-card${p.soon ? ' is-soon' : ''}`,
        disabled: p.soon,
        'data-preset': p.key,
        'aria-label': p.soon ? `${lbl(p.label)} · ${t('common.comingSoon')}` : t('ambient.addOne', { name: lbl(p.label) }),
        onclick: () => {
          if (p.soon) return;
          store.dispatch({ type: 'effect/add', preset: p.key, label: L('undo.effectAdd', { name: p.label }) });
          const added = store.get().effects.at(-1);
          ui.set({ effectGallery: false, effectSelected: added?.id ?? null });
        },
      },
      h('span', { class: 'fx-card-name' }, lbl(p.label)),
      h('span', { class: 'fx-card-intent' }, lbl(p.intent)),
      p.soon ? h('span', { class: 'fx-card-soon' }, t('common.comingSoon')) : null,
    ),
  );
  return h(
    'div',
    { class: 'fx-gallery', 'data-ambient': 'gallery' },
    h('div', { class: 'subhead' }, t('ambient.gallery')),
    h('div', { class: 'fx-cards' }, ...cards),
    h('button', { type: 'button', class: 'btn', onclick: () => ui.set({ effectGallery: false }) }, t('common.cancel')),
  );
}

function editor(ctx: Ctx, scope: Scope, id: string): HTMLElement {
  const { store } = ctx;
  const get = (): AmbientEffect | undefined => store.get().effects.find((e) => e.id === id);
  const e0 = get()!;
  const set = (patch: EffectPatch, what: StringKey, gesture?: string) => {
    const e = get();
    if (!e) return;
    store.dispatch({ type: 'effect/set', id, patch, gesture, label: L('undo.effectSet', { name: effectName(e), what: L(what) }) });
  };
  const watch = <T>(control: Control<T>, read: (e: AmbientEffect) => T): HTMLElement => {
    scope.watch(
      (s) => s.effects.find((e) => e.id === id),
      (e) => {
        if (e) control.set(read(e));
      },
    );
    return control.el;
  };
  const num = (what: StringKey, read: (e: AmbientEffect) => number, write: (v: number) => EffectPatch, opts: { min?: number; max?: number; step?: number; unit?: string; digits?: number; tip?: StringKey; format?: (v: number) => string; slider?: boolean } = {}): HTMLElement => {
    const props = {
      value: read(e0),
      min: opts.min,
      max: opts.max,
      step: opts.step ?? 0.01,
      unit: opts.unit,
      digits: opts.digits,
      ariaLabel: t(what),
      format: opts.format,
      onChange: (v: number, g: string) => set(write(v), what, g),
    };
    const control = opts.slider && opts.min !== undefined && opts.max !== undefined ? slider({ ...props, min: opts.min, max: opts.max }) : numberField(props);
    const row = field(t(what), watch(control, read));
    if (opts.tip) row.setAttribute('data-tip', t(opts.tip));
    row.setAttribute('data-knob', what);
    return row;
  };
  const vec = (what: StringKey, read: (e: AmbientEffect) => Vec3, write: (v: Vec3) => EffectPatch, unit = 'mm'): HTMLElement => {
    const axes = (['X', 'Y', 'Z'] as const).map((label, k) =>
      watch(
        numberField({
          value: read(e0)[k],
          step: 1,
          unit,
          label,
          ariaLabel: `${t(what)} ${label}`,
          onChange: (v, g) => {
            const e = get();
            if (!e) return;
            const next: Vec3 = [...read(e)] as Vec3;
            next[k] = v;
            set(write(next), what, g);
          },
        }),
        (e) => read(e)[k],
      ),
    );
    return field(t(what), h('div', { class: 'row', style: 'gap:4px' }, ...axes));
  };
  const flag = (what: StringKey, read: (e: AmbientEffect) => boolean, write: (v: boolean) => EffectPatch): HTMLElement =>
    field(t(what), watch(toggle(read(e0), (v) => set(write(v), what), t(what)), read));

  // --- The preset and the name.
  const presetSel = select(
    EFFECT_PRESETS.map((p) => ({ value: p.key, label: p.soon ? `${lbl(p.label)} · ${t('common.comingSoon')}` : lbl(p.label), disabled: p.soon })),
    e0.preset,
    (v) => {
      const e = get();
      if (!e || v === e.preset) return;
      store.dispatch({ type: 'effect/preset', id, preset: v as EffectKind, label: L('undo.effectPreset', { name: effectName(e), preset: effectPreset(v)!.label }) });
    },
    t('ambient.preset'),
  );
  const nameField = textField(e0.name, (v) => set({ name: v.trim() }, 'ambient.name'), t('ambient.name'), lbl(effectPreset(e0.preset)!.label));
  const line = h('div', { class: 'note', 'data-ambient': 'count' });
  scope.watch(
    (s) => s.effects.find((e) => e.id === id),
    (e) => {
      if (e) line.textContent = particlesLine(store.get(), e);
    },
  );

  // --- The eight photographer's knobs.
  const density = e0.amountMode === 'DENSITY';
  const knobs = [
    num('ambient.amount', (e) => (e.amountMode === 'DENSITY' ? e.density : e.count), (v) => (get()?.amountMode === 'COUNT' ? { count: Math.round(v) } : { density: v }), {
      min: 0,
      step: density ? 100 : 10,
      digits: 0,
      unit: density ? t('ambient.perM3') : undefined,
      tip: 'ambient.amountTip',
      format: (v) => count(v),
    }),
    num('ambient.size', (e) => e.sizeMm, (v) => ({ sizeMm: v }), { min: 0, step: 0.01, unit: 'mm', digits: 2, tip: 'ambient.sizeTip' }),
    num('ambient.energy', (e) => e.energy, (v) => ({ energy: v }), { min: 0, max: 2, step: 0.01, unit: 'm/s', slider: true, tip: 'ambient.energyTip' }),
    num('ambient.chaos', (e) => e.chaos, (v) => ({ chaos: v }), { min: 0, max: 2, step: 0.01, slider: true, tip: 'ambient.chaosTip', format: (v) => `${formatNumber(v * 100, getLang(), 0)} %` }),
    num('ambient.wind', (e) => windPolar(e.wind).speed, (v) => {
      const e = get()!;
      return { wind: windVector(v, windPolar(e.wind).dirDeg, e.wind[2]) };
    }, { min: 0, max: 10, step: 0.05, unit: 'm/s', slider: true, tip: 'ambient.windTip' }),
    num('ambient.windDir', (e) => windPolar(e.wind).dirDeg, (v) => {
      const e = get()!;
      const speed = windPolar(e.wind).speed;
      return { wind: windVector(speed, ((v % 360) + 360) % 360, e.wind[2]) };
    }, { step: 5, unit: '°', digits: 0, tip: 'ambient.windDirTip' }),
    num('ambient.gravity', (e) => e.gravity, (v) => ({ gravity: v }), { min: -2, max: 2, step: 0.01, unit: '× g', slider: true, tip: 'ambient.gravityTip' }),
    num('ambient.variation', (e) => e.sizeVar, (v) => ({ sizeVar: v, fallVar: v }), { min: 0, max: 1, step: 0.01, slider: true, tip: 'ambient.variationTip', format: (v) => `${formatNumber(v * 100, getLang(), 0)} %` }),
  ];
  const seedField = numberField({ value: e0.seed, min: 0, max: 0xffffffff, step: 1, digits: 0, ariaLabel: t('ambient.seed'), onChange: (v, g) => set({ seed: Math.round(v) }, 'ambient.seed', g) });
  const shuffle = h(
    'button',
    {
      type: 'button',
      class: 'icon-btn',
      'aria-label': t('ambient.shuffle'),
      'data-tip': t('ambient.shuffle'),
      onclick: () => set({ seed: Math.floor(Math.random() * 1_000_000) }, 'ambient.seed'),
    },
    icon('refresh', 14),
  );
  const seedRow = field(t('ambient.seed'), watch(seedField, (e) => e.seed), shuffle);
  seedRow.setAttribute('data-knob', 'ambient.seed');
  seedRow.setAttribute('data-tip', t('ambient.seedTip'));
  // S3c: the effect falls on the parts when the physics bar runs (rain wets them, dust and snow pile on them).
  const feeds = PARTS_FEED[e0.preset];
  const partsRow = feeds ? flag('ambient.wetParts', (e) => e.wetParts === true, (v) => ({ wetParts: v })) : null;
  // S3c: the engine of the render does not draw the weather of the parts (bit 8): it would show them dry.
  const partsDry = feeds ? h('div', { class: 'note', 'data-ambient': 'wet-parts-old-engine' }, t('ambient.wetPartsOldEngine')) : null;
  if (partsDry) {
    scope.watch(
      (s, u) => [s.effects, u.engineInfo?.wetParts] as const,
      () => {
        const e = get();
        partsDry.style.display = e?.wetParts === true && partsRenderDry(store.get(), ctx.ui.get().engineInfo?.wetParts) ? '' : 'none';
      },
    );
  }
  // S3d: it draws them, but not the drops in the air (bit 9): the drips and splashes would show only once they land.
  const partsNoFlight = feeds === 'DROPS' ? h('div', { class: 'note', 'data-ambient': 'wet-flight-old-engine' }, t('ambient.wetFlightOldEngine')) : null;
  if (partsNoFlight) {
    scope.watch(
      (s, u) => [s.effects, u.engineInfo?.wetParts, u.engineInfo?.wetFlight] as const,
      () => {
        const e = get();
        const info = ctx.ui.get().engineInfo;
        partsNoFlight.style.display = e?.wetParts === true && partsRenderNoFlight(store.get(), info?.wetParts, info?.wetFlight) ? '' : 'none';
      },
    );
  }
  if (partsRow) {
    partsRow.setAttribute('data-knob', 'ambient.wetParts');
    partsRow.setAttribute('data-tip', t(feeds === 'DROPS' ? 'ambient.wetPartsTip.DROPS' : feeds === 'DUST' ? 'ambient.wetPartsTip.DUST' : 'ambient.wetPartsTip.SNOW'));
  }

  // --- The shape (S3: a drop among them, or a mix of the four, each particle picking one by the weights). S3b: a knob
  // of its own, out of Advanced (decision S3 ◆5).
  type ShapeChoice = EffectShape | 'MIX';
  const shapeOf = (e: AmbientEffect): ShapeChoice => (e.shapeMix?.on ? 'MIX' : e.shape);
  // Five choices: a list, which fits the inspector's width in both languages (S4a's three were buttons).
  const shapeSeg = select(
    ([...EFFECT_SHAPES, 'MIX'] as const).map((v) => ({ value: v, label: t(`ambient.shape.${v}` as StringKey) })),
    shapeOf(e0),
    (choice) => {
      const v = choice as ShapeChoice;
      const e = get();
      if (!e) return;
      if (v === 'MIX') {
        // The weights it had, or every shape alike with drops twice (a proposal, rule 11).
        const had = e.shapeMix && EFFECT_SHAPES.some((k) => e.shapeMix[k] > 0) ? e.shapeMix : DEFAULT_MIX;
        set({ shapeMix: { ...had, on: true } }, 'ambient.shape');
      } else {
        set({ shape: v, shapeMix: { ...(e.shapeMix ?? DEFAULT_MIX), on: false } }, 'ambient.shape');
      }
    },
    t('ambient.shape'),
  );
  const shapeRow = field(t('ambient.shape'), watch(shapeSeg, shapeOf));
  shapeRow.setAttribute('data-knob', 'ambient.shape');
  const mixRows = mixWeights(e0) || e0.shapeMix?.on
    ? h(
        'div',
        { class: 'stack', 'data-ambient': 'mix' },
        ...EFFECT_SHAPES.map((k) =>
          num(`ambient.mix.${k}` as StringKey, (e) => e.shapeMix?.[k] ?? 0, (v) => ({ shapeMix: { ...get()!.shapeMix, [k]: Math.max(0, v) } }), {
            min: 0,
            max: 4,
            step: 0.05,
            slider: true,
            tip: 'ambient.mixTip',
          }),
        ),
        (() => {
          const share = h('div', { class: 'aux', 'data-ambient': 'mix-shares' });
          const show = (e: AmbientEffect) => {
            const w = mixWeights(e);
            const total = w ? w.reduce((a, b) => a + b, 0) : 0;
            share.textContent = w && total > 0
              ? EFFECT_SHAPES.map((k, i) => `${t(`ambient.shape.${k}` as StringKey)} ${formatNumber((100 * w[i]) / total, getLang(), 0)} %`).join(' · ')
              : t('ambient.mixEmpty');
          };
          show(e0);
          scope.watch((st) => st.effects.find((x) => x.id === id), (e) => e && show(e));
          return share;
        })(),
      )
    : null;
  const dropRows = effectHasShape(e0, 'DROP')
    ? h(
        'div',
        { class: 'stack', 'data-ambient': 'drop' },
        num('ambient.dropTail', (e) => e.dropTail, (v) => ({ dropTail: v }), { min: 0.5, max: 4, step: 0.05, unit: '×', slider: true, tip: 'ambient.dropTailTip' }),
        num('ambient.dropTip', (e) => e.dropTip, (v) => ({ dropTip: v }), { min: 0, max: 0.8, step: 0.01, slider: true, tip: 'ambient.dropTipTip', format: (v) => `${formatNumber(v * 100, getLang(), 0)} %` }),
      )
    : null;
  const shapeVarRow =
    effectHasShape(e0, 'DROP') || effectHasShape(e0, 'CAPSULE')
      ? num('ambient.shapeVar', (e) => e.shapeVar, (v) => ({ shapeVar: v }), { min: 0, max: 1, step: 0.01, slider: true, tip: 'ambient.shapeVarTip', format: (v) => `${formatNumber(v * 100, getLang(), 0)} %` })
      : null;
  // --- Advanced.
  const regionSeg = segmented<'SCENE' | 'BOX'>(
    (['SCENE', 'BOX'] as const).map((v) => ({ value: v, label: t(`ambient.region.${v}` as StringKey) })),
    e0.region.mode,
    (v) => set({ region: { ...get()!.region, mode: v } }, 'ambient.region'),
    { full: true, ariaLabel: t('ambient.region') },
  );
  const modeSeg = segmented<'DENSITY' | 'COUNT'>(
    (['DENSITY', 'COUNT'] as const).map((v) => ({ value: v, label: t(`ambient.amountMode.${v}` as StringKey) })),
    e0.amountMode,
    (v) => set({ amountMode: v }, 'ambient.amountMode'),
    { full: true, ariaLabel: t('ambient.amountMode') },
  );
  const materialSel = select(
    [{ value: '', label: t('ambient.ownMaterial') }, ...MATERIAL_PRESETS.map((m) => ({ value: m.key, label: lbl(m.label) }))],
    e0.material,
    (v) => set({ material: v }, 'ambient.material'),
    t('ambient.material'),
  );
  const palette = h(
    'div',
    { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
    ...e0.palette.map((c, i) => {
      const swatch = colorField(c, (rgb, g) => {
        const e = get();
        if (!e) return;
        const next = e.palette.slice();
        next[i] = rgb;
        set({ palette: next }, 'ambient.palette', g);
      }, `${t('ambient.palette')} ${i + 1}`);
      const remove = h(
        'button',
        { type: 'button', class: 'icon-btn', 'aria-label': t('ambient.removeTint'), 'data-tip': t('ambient.removeTint'), onclick: () => set({ palette: get()!.palette.filter((_, k) => k !== i) }, 'ambient.palette') },
        icon('close', 12),
      );
      return h('span', { class: 'row', style: 'gap:2px' }, watch(swatch, (e) => e.palette[i] ?? c), remove);
    }),
    e0.palette.length < MAX_PALETTE
      ? h('button', { type: 'button', class: 'btn', onclick: () => set({ palette: [...get()!.palette, [1, 1, 1]] }, 'ambient.palette') }, icon('plus', 12), t('ambient.addTint'))
      : null,
  );
  const capRow = num('ambient.cap', (e) => e.cap, (v) => ({ cap: Math.round(v) }), {
    min: 0,
    step: 1000,
    digits: 0,
    format: (v) => (v <= 0 ? t('ambient.capAuto', { n: count(engineParticleCap()) }) : count(v)),
  });
  const advanced = h(
    'div',
    { class: 'stack' },
    field(t('ambient.region'), watch(regionSeg, (e) => e.region.mode)),
    e0.region.mode === 'SCENE'
      ? num('ambient.margin', (e) => e.region.marginMm, (v) => ({ region: { ...get()!.region, marginMm: Math.max(0, v) } }), { min: 0, step: 1, unit: 'mm', digits: 0 })
      : h(
          'div',
          { class: 'stack' },
          vec('ambient.center', (e) => e.region.center, (v) => ({ region: { ...get()!.region, center: v } })),
          vec('ambient.boxSize', (e) => e.region.size, (v) => ({ region: { ...get()!.region, size: v.map((x) => Math.max(0, x)) as Vec3 } })),
        ),
    flag('ambient.band', (e) => e.band.on, (v) => ({ band: { ...get()!.band, on: v } })),
    e0.band.on
      ? h(
          'div',
          { class: 'stack' },
          num('ambient.bandMin', (e) => e.band.min, (v) => ({ band: { ...get()!.band, min: v } }), { step: 1, unit: 'mm', digits: 0 }),
          num('ambient.bandMax', (e) => e.band.max, (v) => ({ band: { ...get()!.band, max: v } }), { step: 1, unit: 'mm', digits: 0 }),
        )
      : null,
    field(t('ambient.amountMode'), watch(modeSeg, (e) => e.amountMode)),
    dropRows,
    shapeVarRow,
    num('ambient.sizeVar', (e) => e.sizeVar, (v) => ({ sizeVar: v }), { min: 0, max: 1, step: 0.01, slider: true }),
    num('ambient.fallSpeed', (e) => e.fallSpeed, (v) => ({ fallSpeed: v }), { min: 0, step: 0.01, unit: 'm/s', digits: 2 }),
    num('ambient.fallVar', (e) => e.fallVar, (v) => ({ fallVar: v }), { min: 0, max: 1, step: 0.01, slider: true }),
    effectHasShape(e0, 'DISC') ? num('ambient.spin', (e) => e.spin, (v) => ({ spin: v }), { step: 0.05, unit: t('ambient.turnsPerSecond'), digits: 2 }) : null,
    effectHasShape(e0, 'CAPSULE') ? num('ambient.streak', (e) => e.streak, (v) => ({ streak: v }), { min: 0, step: 0.001, unit: 's', digits: 3, tip: 'ambient.streakTip' }) : null,
    num('ambient.windZ', (e) => e.wind[2], (v) => ({ wind: [get()!.wind[0], get()!.wind[1], v] }), { step: 0.01, unit: 'm/s', digits: 2 }),
    num('ambient.turbScale', (e) => e.turbulenceScaleMm, (v) => ({ turbulenceScaleMm: v }), { min: 0, step: 1, unit: 'mm', digits: 0 }),
    num('ambient.turbSpeed', (e) => e.turbulenceSpeed, (v) => ({ turbulenceSpeed: v }), { min: 0, step: 0.01, unit: 'm/s', digits: 2 }),
    flag('ambient.cloud', (e) => e.cloud.on, (v) => ({ cloud: { ...get()!.cloud, on: v } })),
    e0.cloud.on
      ? h(
          'div',
          { class: 'stack' },
          vec('ambient.cloudCenter', (e) => e.cloud.center, (v) => ({ cloud: { ...get()!.cloud, center: v } })),
          num('ambient.cloudRadius', (e) => e.cloud.radiusMm, (v) => ({ cloud: { ...get()!.cloud, radiusMm: Math.max(0, v) } }), { min: 0, step: 1, unit: 'mm', digits: 0 }),
          num('ambient.cloudSoftness', (e) => e.cloud.softness, (v) => ({ cloud: { ...get()!.cloud, softness: Math.min(1, Math.max(0, v)) } }), { min: 0, max: 1, step: 0.01, slider: true }),
        )
      : null,
    field(t('ambient.material'), watch(materialSel, (e) => e.material)),
    num('ambient.tintVar', (e) => e.tintVar, (v) => ({ tintVar: v }), { min: 0, max: 1, step: 0.01, slider: true }),
    field(t('ambient.palette'), palette),
    num('ambient.time', (e) => e.time, (v) => ({ time: v }), { min: 0, step: 0.05, unit: 's', digits: 2, tip: 'ambient.timeTip' }),
    flag('ambient.camera', (e) => e.camera, (v) => ({ camera: v })),
    flag('ambient.reflections', (e) => e.reflections, (v) => ({ reflections: v })),
    flag('ambient.shadows', (e) => e.shadows, (v) => ({ shadows: v })),
    capRow,
  );

  return h(
    'div',
    { class: 'stack', 'data-ambient': 'editor', 'data-effect': id },
    field(t('ambient.preset'), watch(presetSel, (e) => e.preset)),
    field(t('ambient.name'), nameField.el),
    line,
    // S3b (decision S3 ◆5): the Shape is one of the visible knobs, after the size, with the weights of a mix under it.
    h('div', { class: 'stack', 'data-ambient': 'knobs' }, knobs[0], knobs[1], shapeRow, mixRows, ...knobs.slice(2), seedRow, partsRow, partsDry, partsNoFlight),
    section(ctx, 'ambient-advanced', t('ambient.advanced'), advanced, null, true),
    h('div', { class: 'note' }, t('ambient.previewNote')),
  );
}

export function ambientSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { ui } = ctx;
  const add = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      'data-ambient': 'add',
      'aria-expanded': 'false',
      'data-tip': t('ambient.addTip'),
      onclick: () => ui.set({ effectGallery: !ui.get().effectGallery }),
    },
    icon('plus', 12),
    t('ambient.add'),
  );
  scope.watch((_s, u) => u.effectGallery, (open) => add.setAttribute('aria-expanded', String(open)));
  // The viewport draws the region of the effect being edited.
  scope.watch(
    (s, u) => editedId(s, u.effectSelected),
    (id) => ctx.services.viewport?.setSelectedEffect?.(id),
  );
  const galleryHost = dynamic(scope, (_s, u) => u.effectGallery, (_sc, open) => (open ? gallery(ctx) : null));
  // The editor is built again when what it shows changes shape (another effect, another shape, a section folded open).
  const editorHost = dynamic(
    scope,
    (s, u) => {
      const id = editedId(s, u.effectSelected);
      const e = s.effects.find((x) => x.id === id);
      // S3: the mix and which of its shapes have a weight (the rows of the drop, the streak and the spin follow them).
      const mix = e?.shapeMix?.on ? EFFECT_SHAPES.map((k) => (e.shapeMix[k] > 0 ? 1 : 0)).join('') : '-';
      return e ? `${e.id}|${e.preset}|${e.shape}|${mix}|${e.amountMode}|${e.region.mode}|${e.band.on}|${e.cloud.on}|${e.palette.length}` : '';
    },
    (sc, key) => (key ? editor(ctx, sc, key.split('|')[0]) : null),
  );
  const body = h('div', { class: 'stack', 'data-ambient': 'section' }, effectList(ctx, scope), galleryHost, editorHost);
  return section(ctx, 'ambient', t('section.ambient'), body, add);
}

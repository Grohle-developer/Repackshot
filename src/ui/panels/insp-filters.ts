// The effect filters of a camera in the inspector (phase O3a, UI.md §2.4 Camera ▸ Lens ▸ Filters): the stack of up
// to three filters in front of the lens (src/data/lens-filters.ts), each with its type (and a sentence of what it
// does photographically), its grade and the knobs of its type (tint, points, angle). Everything goes through the
// store (camera/set with the camera's `optics`), one undo entry per change or drag. The engine scatters the camera
// rays; the Fast viewport draws an approximation and says so.
//
// S3: below the stack, the front glass (UI.md §2.4 Camera ▸ Lens ▸ Filters ▸ Front glass): a pane in front of the lens
// with drops and dust on it, its knobs (drops, their size, dust, the seed, the distance) through the same `camera/set`.

import { isPanoramic, type CameraId, type CameraState } from '../../core/camera';
import { filtersOf, newFrontGlass, newLensFilter, OPTICS_NEUTRAL, opticsOf, type CameraOptics, type FrontGlass, type LensFilter } from '../../core/optics';
import { FRONT_GLASS_LIMITS } from '../../data/front-glass';
import { GRADE_LABELS, LENS_FILTER_GRADES, LENS_FILTERS, lensFilterType, MAX_LENS_FILTERS, STAR_POINTS, type LensFilterKey } from '../../data/lens-filters';
import * as cmd from '../commands';
import { colorField, field, numberField, segmented, select, slider, toggle } from '../components/controls';
import { h, icon } from '../dom';
import { type Ctx, type Scope } from '../reactive';
import { formatNumber, getLang, lbl, t, type StringKey } from '../strings';

/** The swatch of a tint: brought to a peak of 1 (the engine keeps only its colour, at luminance 1). */
function swatchOf(tint: readonly number[]): [number, number, number] {
  const m = Math.max(tint[0], tint[1], tint[2], 1e-6);
  return [tint[0] / m, tint[1] / m, tint[2] / m];
}

/** The nearest grade offered to `g`. */
function nearestGrade(g: number): number {
  let best = LENS_FILTER_GRADES[0];
  for (const v of LENS_FILTER_GRADES) if (Math.abs(v - g) < Math.abs(best - g)) best = v;
  return best;
}

/** The Filters subsection of camera `camId()`. */
export function filterFields(ctx: Ctx, scope: Scope, camId: () => CameraId): HTMLElement {
  const { store } = ctx;
  const cam = (): CameraState | undefined => store.get().camera.cameras[camId()];
  const optics = (): CameraOptics => {
    const c = cam();
    return c ? opticsOf(c) : OPTICS_NEUTRAL;
  };
  const filters = (): LensFilter[] => filtersOf(optics());
  const commit = (next: LensFilter[], what: StringKey, gesture?: string) => {
    const cur = optics();
    store.dispatch({ type: 'camera/set', id: camId(), patch: { optics: { ...cur, filters: next } }, gesture, label: cmd.editLabel('camera', what) });
  };
  const edit = (i: number, patch: Partial<LensFilter>, what: StringKey, gesture?: string) => {
    const list = filters().slice();
    if (!list[i]) return;
    list[i] = { ...list[i], ...patch };
    commit(list, what, gesture);
  };

  const list = h('div', { class: 'stack', 'data-filter-list': '' });
  const add = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      'data-action': 'filters.add',
      onclick: () => {
        const cur = filters();
        if (cur.length >= MAX_LENS_FILTERS) return;
        commit([...cur, newLensFilter(cur.some((f) => f.type === 'DIFFUSION_BLACK') ? 'STAR' : 'DIFFUSION_BLACK')], 'camera.filterAdd');
      },
    },
    icon('plus', 14),
    h('span', null, t('camera.filterAdd')),
  ) as HTMLButtonElement;
  const full = h('div', { class: 'aux' });

  /** One filter's rows, and how to show new values without rebuilding them (a drag keeps its field). */
  const row = (f: LensFilter, i: number): { el: HTMLElement; update(f: LensFilter): void } => {
    const type = lensFilterType(f.type)!;
    const kind = select(
      LENS_FILTERS.map((x) => ({ value: x.key, label: lbl(x.name) })),
      f.type,
      // A new type keeps the grade and the angle; its tint is its own.
      (v) => edit(i, { type: v as LensFilterKey, tint: null }, 'camera.filterType'),
      t('camera.filterType'),
    );
    const remove = h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'aria-label': t('camera.filterRemove'),
        'data-tip': t('camera.filterRemove'),
        'data-action': 'filters.remove',
        onclick: () => commit(filters().filter((_, k) => k !== i), 'camera.filterRemove'),
      },
      icon('close', 14),
    );
    const grade = segmented(
      LENS_FILTER_GRADES.map((g, k) => ({ value: String(g), label: GRADE_LABELS[k] })),
      String(nearestGrade(f.grade)),
      (v) => edit(i, { grade: Number(v) }, 'camera.filterGrade'),
      { full: true, ariaLabel: t('camera.filterGrade') },
    );
    const rows: HTMLElement[] = [
      h('div', { class: 'row', style: 'gap:4px' }, h('div', { style: 'flex:1;min-width:0' }, field(t('camera.filterType'), kind.el)), remove),
      h('div', { class: 'note', 'data-filter-help': '' }, lbl(type.help)),
      field(t('camera.filterGrade'), grade.el),
    ];
    const updates: ((f: LensFilter) => void)[] = [(x) => grade.set(String(nearestGrade(x.grade)))];
    if (type.tint) {
      const own = type.tint;
      const tint = colorField(swatchOf(f.tint ?? own), (rgb, g) => edit(i, { tint: rgb }, 'camera.filterTint', g), t('camera.filterTint'));
      const back = h(
        'button',
        { type: 'button', class: 'btn', 'data-tip': t('camera.filterTintOwnAux'), onclick: () => edit(i, { tint: null }, 'camera.filterTint') },
        t('camera.filterTintOwn'),
      ) as HTMLButtonElement;
      back.disabled = f.tint === null;
      rows.push(field(t('camera.filterTint'), tint.el, back));
      updates.push((x) => {
        tint.set(swatchOf(x.tint ?? own));
        back.disabled = x.tint === null;
      });
    }
    if (type.points) {
      const points = segmented(
        STAR_POINTS.map((p) => ({ value: String(p), label: String(p) })),
        String(f.points),
        (v) => edit(i, { points: Number(v) }, 'camera.filterPoints'),
        { full: true, ariaLabel: t('camera.filterPoints') },
      );
      rows.push(field(t('camera.filterPoints'), points.el));
      updates.push((x) => points.set(String(x.points)));
    }
    if (type.angle) {
      const angle = slider({ value: f.angleDeg, min: -180, max: 180, step: 1, unit: '°', ariaLabel: t('camera.filterAngle'), onChange: (v, g) => edit(i, { angleDeg: v }, 'camera.filterAngle', g) });
      rows.push(field(t('camera.filterAngle'), angle.el));
      updates.push((x) => angle.set(x.angleDeg));
    }
    const el = h('div', { class: 'stack', 'data-filter': f.type, style: i > 0 ? 'border-top:1px solid var(--line);padding-top:8px' : '' }, ...rows);
    return { el, update: (x) => updates.forEach((u) => u(x)) };
  };

  // The rows are rebuilt when the stack changes (a filter added, removed or of another type); otherwise they show
  // the new values in place, so a drag keeps its field.
  let shape: string | null = null;
  let rows: { el: HTMLElement; update(f: LensFilter): void }[] = [];
  scope.watch(
    (s) => s.camera.cameras[camId()]?.optics?.filters,
    () => {
      const cur = filters();
      const next = cur.map((f) => f.type).join(',');
      if (next !== shape || rows.length !== cur.length) {
        shape = next;
        rows = cur.map(row);
        list.replaceChildren(...(cur.length === 0 ? [h('div', { class: 'aux' }, t('camera.filtersNone'))] : rows.map((r) => r.el)));
      } else {
        cur.forEach((f, i) => rows[i].update(f));
      }
      add.disabled = cur.length >= MAX_LENS_FILTERS;
      full.textContent = cur.length >= MAX_LENS_FILTERS ? t('camera.filtersFull') : '';
    },
  );

  return h(
    'div',
    { class: 'stack', 'data-guide': 'camera-filters' },
    list,
    h('div', { class: 'row' }, add),
    full,
    h('div', { class: 'note' }, t('camera.filtersNote')),
    frontGlassFields(ctx, scope, camId),
  );
}

/** S3: the front glass of camera `camId()`: on or off, and its knobs while it is on. */
function frontGlassFields(ctx: Ctx, scope: Scope, camId: () => CameraId): HTMLElement {
  const { store } = ctx;
  const cam = (): CameraState | undefined => store.get().camera.cameras[camId()];
  const optics = (): CameraOptics => {
    const c = cam();
    return c ? opticsOf(c) : OPTICS_NEUTRAL;
  };
  const glass = (): FrontGlass => optics().frontGlass ?? { ...newFrontGlass(), on: false };
  const set = (patch: Partial<FrontGlass>, what: StringKey, gesture?: string) => {
    const cur = optics();
    store.dispatch({ type: 'camera/set', id: camId(), patch: { optics: { ...cur, frontGlass: { ...glass(), ...patch } } }, gesture, label: cmd.editLabel('camera', what) });
  };
  const pct = (v: number) => `${formatNumber(v * 100, getLang(), 0)} %`;
  const L = FRONT_GLASS_LIMITS;
  const on = toggle(glass().on, (v) => set({ on: v }, 'camera.glassOn'), t('camera.glassOn'));
  const drops = slider({ value: glass().drops, min: L.drops.min, max: L.drops.max, step: 0.01, format: pct, ariaLabel: t('camera.glassDrops'), onChange: (v, g) => set({ drops: v }, 'camera.glassDrops', g) });
  const size = slider({ value: glass().dropSizeMm, min: L.dropSizeMm.min, max: L.dropSizeMm.max, step: 0.1, unit: 'mm', ariaLabel: t('camera.glassDropSize'), onChange: (v, g) => set({ dropSizeMm: v }, 'camera.glassDropSize', g) });
  const dust = slider({ value: glass().dust, min: L.dust.min, max: L.dust.max, step: 0.005, format: pct, ariaLabel: t('camera.glassDust'), onChange: (v, g) => set({ dust: v }, 'camera.glassDust', g) });
  const seed = numberField({ value: glass().seed, min: 0, max: 0xffffffff, step: 1, digits: 0, ariaLabel: t('camera.glassSeed'), onChange: (v, g) => set({ seed: Math.round(v) }, 'camera.glassSeed', g) });
  const shuffle = h(
    'button',
    { type: 'button', class: 'icon-btn', 'aria-label': t('camera.glassShuffle'), 'data-tip': t('camera.glassShuffle'), onclick: () => set({ seed: Math.floor(Math.random() * 1_000_000) }, 'camera.glassSeed') },
    icon('refresh', 14),
  );
  const distance = numberField({
    value: glass().distanceMm,
    min: L.distanceMm.min,
    max: L.distanceMm.max,
    step: 1,
    unit: 'mm',
    digits: 0,
    ariaLabel: t('camera.glassDistance'),
    format: (v) => (v <= 0 ? t('camera.glassAuto') : `${formatNumber(v, getLang(), 0)}`),
    onChange: (v, g) => set({ distanceMm: Math.max(0, v) }, 'camera.glassDistance', g),
  });
  const row = (label: StringKey, tip: StringKey | null, ...controls: (Node | null)[]) => {
    const r = field(t(label), ...controls);
    if (tip) r.setAttribute('data-tip', t(tip));
    return r;
  };
  const knobs = h(
    'div',
    { class: 'stack', 'data-glass': 'knobs' },
    row('camera.glassDrops', 'camera.glassDropsTip', drops.el),
    row('camera.glassDropSize', null, size.el),
    row('camera.glassDust', 'camera.glassDustTip', dust.el),
    row('camera.glassSeed', null, seed.el, shuffle),
    row('camera.glassDistance', 'camera.glassDistanceTip', distance.el),
  );
  const panoramic = h('div', { class: 'note', 'data-glass': 'panoramic' }, t('camera.glassPanoramic'));
  scope.watch(
    (s) => [s.camera.cameras[camId()]?.optics?.frontGlass, s.camera.cameras[camId()]?.projection] as const,
    () => {
      const g = glass();
      on.set(g.on);
      drops.set(g.drops);
      size.set(g.dropSizeMm);
      dust.set(g.dust);
      seed.set(g.seed);
      distance.set(g.distanceMm);
      knobs.style.display = g.on ? '' : 'none';
      const c = cam();
      panoramic.style.display = g.on && c && isPanoramic(c.projection) ? '' : 'none';
    },
  );
  return h(
    'div',
    { class: 'stack', 'data-guide': 'camera-glass', style: 'border-top:1px solid var(--line);padding-top:8px' },
    h('div', { class: 'subhead' }, t('camera.glass')),
    field(t('camera.glassOn'), on.el),
    knobs,
    panoramic,
    h('div', { class: 'note' }, t('camera.glassAux')),
  );
}

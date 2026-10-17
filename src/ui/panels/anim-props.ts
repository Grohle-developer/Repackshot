// The right zone of the animation timeline (phase N6, UI.md §2.5): the properties of the selected clip (how it moves),
// under a header that says it in one line ("Cap · Spherical exploded view · 1.5 × size · 0–3 s"); the "+ Animate…"
// wizard; and, with nothing selected, the presets. The knobs of an explode are the parameters of core/explode.ts.
// Every edit is an action of the store (one undo entry per drag of a field).

import { EASING_KINDS, MOVE_GROUPS, SEQUENCE_PRESETS, moveKind } from '../../data/animation';
import type { EasingKind, MoveKind } from '../../data/types';
import {
  DEFAULT_FADE,
  MAX_FADE,
  MIN_FADE,
  amountUnit,
  clipCurve,
  clipEnd,
  clipRepeat,
  easingForSmoothness,
  shotStarts,
  shotTransition,
  type ClipPivot,
  type ClipTarget,
  type Shot,
  type ClipTargetKind,
  type MotionClip,
} from '../../core/animation';
import { DEFAULT_CURVE } from '../../core/curve';
import { curveEditor } from '../components/curve-editor';
import {
  EXPLODE_AXES,
  EXPLODE_GEOMETRIES,
  EXPLODE_LEVELS,
  EXPLODE_ORDERS,
  explodeParts,
  resolveExplode,
  type ExplodeCentre,
  type ExplodeParams,
} from '../../core/explode';
import { allParts, partsUnder } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import { targetKey } from '../../core/timeline';
import * as anim from '../anim-commands';
import { colorField, field, lengthField, numberField, segmented, select, slider, toggle } from '../components/controls';
import { section } from '../components/section';
import { h, icon } from '../dom';
import { cameraName, dyn, lightName, materialName } from '../names';
import { dynamic, shallowEq, type Ctx, type Scope } from '../reactive';
import { clipHeader, clipSentence, clipTargetName } from '../sentence';
import { L, formatNumber, getLang, lbl, t } from '../strings';
import { clipIcon } from './anim-tree';
import type { WizardState } from '../ui-state';

const UNIT_TEXT: Record<ReturnType<typeof amountUnit>, string> = { deg: '°', pct: '%', factor: '×', mm: 'mm', m: 'm', W: 'W', parts: '', none: '' };
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The clip's curve drawn small: how it speeds up and slows down, over its phase. */
export function curvePreview(clip: Pick<MotionClip, 'easing' | 'smoothness' | 'reverse' | 'curve'>): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 60');
  svg.setAttribute('class', 'anim-curve');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('anim.curve'));
  const frame = document.createElementNS(SVG_NS, 'path');
  frame.setAttribute('d', 'M4 4V56H96');
  frame.setAttribute('class', 'anim-curve-axes');
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = i / 40;
    const y = clipCurve(clip, clip.reverse ? 1 - x : x);
    pts.push(`${(4 + x * 92).toFixed(2)},${(56 - y * 52).toFixed(2)}`);
  }
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('class', 'anim-curve-line');
  svg.append(frame, line);
  return svg;
}

function amountField(clip: MotionClip, onChange: (v: number, g: string) => void) {
  const unit = amountUnit(clip.move);
  const make = unit === 'mm' ? lengthField : numberField;
  // N1: a fade's amount is the opacity it ends at, 0..100 %.
  const range = clip.move === 'FADE' ? { min: 0, max: 100 } : {};
  return make({ value: clip.amount, step: clip.move === 'SCALE' || clip.move === 'FOCUS' || unit === 'parts' ? 0.05 : 1, digits: 2, unit: unit === 'mm' ? undefined : UNIT_TEXT[unit], ariaLabel: t('anim.amount'), onChange, ...range });
}

/** N1: the colour a TINT or a MATERIAL_COLOR goes to, when the clip has none yet. */
function defaultColor(s: ProjectState, clip: Pick<MotionClip, 'target'>): [number, number, number] {
  return anim.wizardColor(s, clip.target);
}

/** N1: what a rotation of a part or a group turns about: its origin, another part's centre, a point. */
function pivotKnobs(ctx: Ctx, scope: Scope, id: string): HTMLElement[] {
  const { store } = ctx;
  const get = () => store.get().animation.clips.find((c) => c.id === id)!;
  const patch = (pivot: ClipPivot | undefined, g?: string) => store.dispatch({ type: 'anim/setClip', id, patch: { pivot }, gesture: g, label: L('undo.editClip') });
  const s0 = store.get();
  const c0 = get();
  const self = c0.target.kind === 'NODE' ? c0.target.id : '';
  const kind = c0.pivot?.kind ?? 'OWN';
  const rows: HTMLElement[] = [];
  const kinds = select(
    (['OWN', 'NODE', 'POINT'] as const).map((k) => ({ value: k, label: t(dyn(`anim.pivot.${k}`)) })),
    kind,
    (k) => {
      const other = Object.values(store.get().scene.nodes).find((n) => n.id !== self && n.kind === 'PART');
      patch(k === 'NODE' ? { kind: 'NODE', id: other?.id ?? self } : k === 'POINT' ? { kind: 'POINT', point: [0, 0, 0] } : undefined);
    },
    t('anim.pivot'),
  );
  kinds.el.setAttribute('data-tip', t('anim.pivotTip'));
  rows.push(field(t('anim.pivot'), kinds.el));
  const pv = c0.pivot;
  if (pv?.kind === 'NODE') {
    const opts = Object.values(s0.scene.nodes).filter((n) => n.id !== self).map((n) => ({ value: n.id, label: n.name }));
    rows.push(field(t('anim.pivotPart'), select(opts, pv.id, (v) => patch({ kind: 'NODE', id: v }), t('anim.pivotPart')).el));
  } else if (pv?.kind === 'POINT') {
    const pt = (k: 0 | 1 | 2) =>
      lengthField({ value: pv.point[k], step: 1, label: 'XYZ'[k], ariaLabel: `${t('anim.pivotPoint')} ${'XYZ'[k]}`, onChange: (v, g) => {
        const cur = get().pivot;
        const p = cur?.kind === 'POINT' ? ([...cur.point] as [number, number, number]) : ([0, 0, 0] as [number, number, number]);
        p[k] = v;
        patch({ kind: 'POINT', point: p }, g);
      } });
    const fields = [pt(0), pt(1), pt(2)];
    scope.watch((s) => s.animation.clips.find((c) => c.id === id)?.pivot, (p) => p?.kind === 'POINT' && fields.forEach((f, k) => f.set(p.point[k])));
    rows.push(field(t('anim.pivotPoint'), h('div', { class: 'field-row3' }, ...fields.map((f) => f.el))));
  }
  return rows;
}

/** The targets an explode can take: the whole model, every model and group with two parts or more. */
function explodeTargets(s: ProjectState): { value: string; label: string; target: ClipTarget }[] {
  const out: { value: string; label: string; target: ClipTarget }[] = [{ value: 'SUBJECT', label: clipTargetName(s, { kind: 'SUBJECT' }, getLang()), target: { kind: 'SUBJECT' } }];
  for (const n of Object.values(s.scene.nodes)) {
    if ((n.kind === 'GROUP' || (n.kind === 'MODEL' && s.scene.roots.length > 1)) && explodeParts(s, n.id).length > 1) out.push({ value: `NODE:${n.id}`, label: n.name, target: { kind: 'NODE', id: n.id } });
  }
  return out;
}

/** The knobs of an explode: what, how, from where, how far, in which order. */
function explodeKnobs(ctx: Ctx, scope: Scope, id: string): HTMLElement[] {
  const { store } = ctx;
  const get = () => store.get().animation.clips.find((c) => c.id === id)!;
  const r0 = resolveExplode(get().explode);
  const setX = (patch: Partial<ExplodeParams>, g?: string) => store.dispatch({ type: 'anim/setExplode', id, patch, gesture: g, label: L('undo.explode') });
  const s0 = store.get();
  const rows: HTMLElement[] = [];

  const targets = explodeTargets(s0);
  // A target the list does not offer (a model picked in the wizard) still shows as itself.
  const cur = get().target;
  if (!targets.some((x) => x.value === targetKey(cur))) targets.push({ value: targetKey(cur), label: clipTargetName(s0, cur, getLang()), target: cur });
  const tgSel = select(targets.map((x) => ({ value: x.value, label: x.label })), targetKey(get().target), (v) => {
    const tg = targets.find((x) => x.value === v)?.target;
    if (tg) store.dispatch({ type: 'anim/setClip', id, patch: { target: tg }, label: L('undo.editClip') });
  }, t('ex.target'));
  rows.push(field(t('ex.target'), tgSel.el));

  const geo = segmented(EXPLODE_GEOMETRIES.map((g) => ({ value: g, label: t(dyn(`ex.geo.${g}`)), title: t(dyn(`ex.geoTip.${g}`)) })), r0.geometry, (g) => setX({ mode: g, ...(get().explode?.mode?.startsWith('AXIS_') ? { axis: r0.axis, linear: r0.linear } : {}) }), { full: true, ariaLabel: t('ex.geometry') });
  rows.push(field(t('ex.geometry'), geo.el));
  if (r0.geometry === 'LINEAR') {
    const lin = segmented((['SEPARATE', 'STACK'] as const).map((k) => ({ value: k, label: t(dyn(`ex.linear.${k}`)), title: t(dyn(`ex.linearTip.${k}`)) })), r0.linear, (k) => setX({ linear: k, ...(get().explode?.mode?.startsWith('AXIS_') ? { mode: 'LINEAR', axis: r0.axis } : {}) }), { full: true, ariaLabel: t('ex.linear') });
    rows.push(field(t('ex.linear'), lin.el));
  }
  if (r0.geometry !== 'SPHERICAL') {
    const ax = segmented(EXPLODE_AXES.map((a) => ({ value: a, label: a === 'CUSTOM' ? t('ex.axis.CUSTOM') : a })), r0.axis, (a) => setX({ axis: a, ...(get().explode?.mode?.startsWith('AXIS_') ? { mode: 'LINEAR' } : {}), ...(a === 'CUSTOM' && !get().explode?.direction ? { direction: [...r0.direction] } : {}) }), { full: true, ariaLabel: t(r0.geometry === 'LINEAR' ? 'ex.direction' : 'ex.axis') });
    rows.push(field(t(r0.geometry === 'LINEAR' ? 'ex.direction' : 'ex.axis'), ax.el));
    if (r0.axis === 'CUSTOM') {
      const dir = (k: 0 | 1 | 2) =>
        numberField({ value: (get().explode?.direction ?? r0.direction)[k], step: 0.1, digits: 2, label: 'XYZ'[k], ariaLabel: `${t('ex.direction')} ${'XYZ'[k]}`, onChange: (v, g) => {
          const d = [...(get().explode?.direction ?? r0.direction)] as [number, number, number];
          d[k] = v;
          setX({ direction: d }, g);
        } });
      const fields = [dir(0), dir(1), dir(2)];
      scope.watch((s) => s.animation.clips.find((c) => c.id === id)?.explode?.direction, (d) => d && fields.forEach((f, k) => f.set(d[k])));
      rows.push(field('', h('div', { class: 'field-row3' }, ...fields.map((f) => f.el))));
    }
  }
  const lv = segmented(EXPLODE_LEVELS.map((l) => ({ value: l, label: t(dyn(`ex.levels.${l}`)), title: t(dyn(`ex.levelsTip.${l}`)) })), r0.levels, (l) => setX({ levels: l }), { full: true, ariaLabel: t('ex.levels') });
  rows.push(field(t('ex.levels'), lv.el));

  const dist = numberField({ value: get().amount, step: r0.unit === 'MM' ? 1 : 0.05, digits: 2, ariaLabel: t('ex.distance'), onChange: (v, g) => store.dispatch({ type: 'anim/setClip', id, patch: { amount: v }, gesture: g, label: L('undo.editClip') }) });
  const unit = segmented((['SIZE', 'MM'] as const).map((u) => ({ value: u, label: t(dyn(`ex.unit.${u}`)), title: t('ex.unitTip') })), r0.unit, (u) => {
    if (u === resolveExplode(get().explode).unit) return;
    // The distance keeps its length when its unit changes.
    const size = store.get().scene.partSizeMm || 1;
    const amount = u === 'MM' ? Math.round(get().amount * size) : Math.round((get().amount / size) * 100) / 100;
    store.transaction(L('undo.explode'), () => {
      setX({ unit: u });
      store.dispatch({ type: 'anim/setClip', id, patch: { amount }, label: L('undo.explode') });
    });
  }, { ariaLabel: t('ex.unitTip') });
  scope.watch((s) => s.animation.clips.find((c) => c.id === id)?.amount, (v) => v !== undefined && dist.set(v));
  rows.push(field(t('ex.distance'), h('div', { class: 'row', style: 'flex-wrap:nowrap;gap:6px' }, dist.el, unit.el)));

  if (!(r0.geometry === 'LINEAR' && r0.linear === 'STACK')) {
    const sp = segmented((['EVEN', 'SPREAD'] as const).map((k) => ({ value: k, label: t(dyn(`ex.spacing.${k}`)), title: t(dyn(`ex.spacingTip.${k}`)) })), r0.spacing, (k) => setX({ spacing: k }), { full: true, ariaLabel: t('ex.spacing') });
    scope.watch((s) => resolveExplode(s.animation.clips.find((c) => c.id === id)?.explode).spacing, (v) => sp.set(v));
    rows.push(field(t('ex.spacing'), sp.el));
  }
  const prop = toggle(r0.proportional, (v) => setX({ proportional: v }), t('ex.proportional'));
  scope.watch((s) => resolveExplode(s.animation.clips.find((c) => c.id === id)?.explode).proportional, (v) => prop.set(v));
  rows.push(field(t('ex.proportional'), prop.el));

  const centreKinds: ExplodeCentre['kind'][] = ['MODEL', 'PART', 'PIVOT', 'POINT'];
  const centre = select(centreKinds.map((k) => ({ value: k, label: t(dyn(`ex.centre.${k}`)) })), r0.centre.kind, (k) => {
    const c = get();
    const parts = explodeParts(store.get(), c.target.kind === 'NODE' ? c.target.id : null);
    const sel = store.get().selection.ids.find((x) => parts.includes(x));
    const next: ExplodeCentre = k === 'PART' ? { kind: 'PART', id: sel ?? parts[0] ?? '' } : k === 'POINT' ? { kind: 'POINT', point: [0, 0, 0] } : { kind: k as 'MODEL' | 'PIVOT' };
    setX({ centre: next });
  }, t('ex.centre'));
  rows.push(field(t('ex.centre'), centre.el));
  if (r0.centre.kind === 'PART') {
    const c = get();
    const parts = explodeParts(s0, c.target.kind === 'NODE' ? c.target.id : null);
    const pc = r0.centre;
    const ps = select(parts.map((p) => ({ value: p, label: s0.scene.nodes[p]?.name ?? p })), pc.id, (v) => setX({ centre: { kind: 'PART', id: v } }), t('ex.centrePart'));
    rows.push(field(t('ex.centrePart'), ps.el));
  } else if (r0.centre.kind === 'POINT') {
    const pc = r0.centre;
    const pt = (k: 0 | 1 | 2) =>
      lengthField({ value: pc.point[k], step: 1, label: 'XYZ'[k], ariaLabel: `${t('ex.point')} ${'XYZ'[k]}`, onChange: (v, g) => {
        const cur = resolveExplode(get().explode).centre;
        const p = cur.kind === 'POINT' ? ([...cur.point] as [number, number, number]) : ([0, 0, 0] as [number, number, number]);
        p[k] = v;
        setX({ centre: { kind: 'POINT', point: p } }, g);
      } });
    rows.push(field(t('ex.point'), h('div', { class: 'field-row3' }, pt(0).el, pt(1).el, pt(2).el)));
  }

  const order = select(EXPLODE_ORDERS.map((o) => ({ value: o, label: t(dyn(`ex.order.${o}`)) })), r0.order, (o) => setX({ order: o as ExplodeParams['order'] }), t('ex.order'));
  order.el.setAttribute('data-tip', t(dyn(`ex.orderTip.${r0.order}`)));
  rows.push(field(t('ex.order'), order.el));
  if (r0.order !== 'AT_ONCE' || r0.levels === 'ALL') {
    const ov = slider({ value: Math.round(r0.overlap * 100), min: 0, max: 100, step: 5, unit: '%', ariaLabel: t('ex.overlap'), onChange: (v, g) => setX({ overlap: v / 100 }, g) });
    ov.el.setAttribute('data-tip', t('ex.overlapTip'));
    scope.watch((s) => resolveExplode(s.animation.clips.find((c) => c.id === id)?.explode).overlap, (v) => ov.set(Math.round(v * 100)));
    rows.push(field(t('ex.overlap'), ov.el));
  }
  const keep = toggle(r0.keepOrientation, (v) => setX({ keepOrientation: v }), t('ex.keepOrientation'));
  keep.el.setAttribute('data-tip', t('ex.keepTip'));
  scope.watch((s) => resolveExplode(s.animation.clips.find((c) => c.id === id)?.explode).keepOrientation, (v) => keep.set(v));
  rows.push(field(t('ex.keepOrientation'), keep.el));
  return rows;
}

/** The exceptions of an explode: the pinned parts, each freed with its ×, and the scene's selection pinned with a button. */
function exceptions(ctx: Ctx, scope: Scope, id: string): HTMLElement {
  const { store } = ctx;
  const host = h('div', { class: 'stack', style: 'gap:6px' });
  scope.watch(
    (s) => [s.animation.clips.find((c) => c.id === id)?.explode?.pinned, s.selection.ids, s.scene.nodes],
    () => {
      const s = store.get();
      const c = s.animation.clips.find((x) => x.id === id);
      if (!c) return;
      const pinned = partsUnder(s, resolveExplode(c.explode).pinned);
      const chips = pinned.map((p) =>
        h(
          'span',
          { class: 'chip anim-pin' },
          h('span', null, s.scene.nodes[p]?.name ?? p),
          h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('ex.unpin', { name: s.scene.nodes[p]?.name ?? p }), 'data-tip': t('ex.unpin', { name: s.scene.nodes[p]?.name ?? p }), onclick: () => store.dispatch({ type: 'anim/pinExplode', parts: [p], pinned: false, clips: [id], label: L('undo.unpinExplode') }) }, icon('close', 10)),
        ),
      );
      const parts = explodeParts(s, c.target.kind === 'NODE' ? c.target.id : null);
      const sel = partsUnder(s, s.selection.ids.filter((x) => s.scene.nodes[x])).filter((p) => parts.includes(p) && !pinned.includes(p));
      host.replaceChildren(
        pinned.length ? h('div', { class: 'chips' }, ...chips) : h('div', { class: 'note' }, t('ex.pinnedNone')),
        h('button', { type: 'button', class: 'btn', disabled: sel.length === 0, 'data-tip': t('ex.pinTip'), onclick: () => store.dispatch({ type: 'anim/pinExplode', parts: sel, pinned: true, clips: [id], label: L('undo.pinExplode') }) }, icon('lock', 14), t('ex.pinSelection')),
      );
    },
    shallowEq,
  );
  return host;
}

function clipView(ctx: Ctx, scope: Scope, id: string): HTMLElement {
  const { store } = ctx;
  const c0 = store.get().animation.clips.find((x) => x.id === id);
  if (!c0) return h('div');
  const label = L('undo.editClip');
  const patch = (p: Partial<MotionClip>, g?: string) => store.dispatch({ type: 'anim/setClip', id, patch: p, gesture: g, label });
  const header = h('div', { class: 'anim-props-head', 'data-clip-header': id });
  const sentence = h('div', { class: 'note anim-props-sentence' });

  const move: HTMLElement[] = [];
  const physics = c0.move === 'PHYSICS';
  if (c0.move === 'EXPLODE') move.push(...explodeKnobs(ctx, scope, id));
  // A recorded simulation (S2): no amount and no curve, what was simulated; its time like any other clip's.
  else if (physics) move.push(h('p', { class: 'note', style: 'margin:0', 'data-field': 'anim.physicsNote' }, t('anim.physicsNote')));
  else if (c0.move !== 'TINT' && c0.move !== 'MATERIAL_COLOR') {
    const amount = amountField(c0, (v, g) => patch({ amount: v }, g));
    scope.watch((s) => s.animation.clips.find((c) => c.id === id)?.amount, (v) => v !== undefined && amount.set(v));
    move.push(field(lbl(moveKind(c0.move)?.amountLabel ?? { en: t('anim.amount'), es: t('anim.amount') }), amount.el));
  }
  // N1: the colour a light's tint or a material's colour goes to.
  if (c0.move === 'TINT' || c0.move === 'MATERIAL_COLOR') {
    const color = colorField(c0.color ?? defaultColor(store.get(), c0), (rgb, g) => patch({ color: rgb }, g), t('anim.color'));
    scope.watch((s) => s.animation.clips.find((c) => c.id === id)?.color, (v) => v && color.set(v));
    move.push(field(t('anim.color'), color.el));
  }
  // N1: a rotation of a part or a group about a pivot (another part, a point).
  if ((c0.move === 'SPIN' || c0.move === 'TUMBLE') && c0.target.kind === 'NODE') move.push(...pivotKnobs(ctx, scope, id));
  if (c0.move === 'FADE') move.push(h('p', { class: 'note', style: 'margin:0' }, t('anim.fadeNote')));
  if (c0.target.kind === 'CAMERA' && store.get().animation.shots.length > 0) {
    const shots = store.get().animation.shots;
    move.push(field(t('anim.inShot'), select([{ value: '', label: t('anim.allShots') }, ...shots.map((_, i) => ({ value: String(i), label: t('anim.shot', { n: i + 1 }) }))], c0.shot === null ? '' : String(c0.shot), (v) => patch({ shot: v === '' ? null : Number(v) }), t('anim.inShot')).el));
  }

  const start = numberField({ value: c0.start, min: 0, step: 0.1, digits: 2, unit: 's', ariaLabel: t('anim.start'), onChange: (v, g) => patch({ start: v }, g) });
  const dur = numberField({ value: c0.duration, min: 0.05, step: 0.1, digits: 2, unit: 's', ariaLabel: t('anim.duration'), onChange: (v, g) => patch({ duration: v }, g) });
  const end = numberField({ value: clipEnd(c0), min: 0.05, step: 0.1, digits: 2, unit: 's', ariaLabel: t('anim.end'), onChange: (v, g) => {
    const c = store.get().animation.clips.find((x) => x.id === id)!;
    patch({ duration: Math.max(0.05, (v - c.start) / clipRepeat(c)) }, g);
  } });
  const repeat = numberField({ value: clipRepeat(c0), min: 1, max: 100, step: 1, digits: 0, unit: '×', ariaLabel: t('anim.repeat'), onChange: (v, g) => patch({ repeat: Math.max(1, Math.round(v)) }, g) });
  const reverse = toggle(c0.reverse === true, (v) => patch({ reverse: v }), t(c0.move === 'EXPLODE' ? 'anim.reverseExplode' : 'anim.reverse'));
  reverse.el.setAttribute('data-tip', t('anim.reverseTip'));

  const curveHost = h('div', { class: 'anim-curve-host' });
  const curve: HTMLElement[] = [];
  let easing: ReturnType<typeof select> | null = null;
  let smooth: ReturnType<typeof slider> | null = null;
  if (c0.move === 'EXPLODE') {
    smooth = slider({ value: Math.round((c0.smoothness ?? smoothnessOf(c0.easing)) * 100), min: 0, max: 100, step: 5, unit: '%', ariaLabel: t('anim.smoothness'), onChange: (v, g) => patch({ smoothness: v / 100, easing: easingForSmoothness(v / 100) }, g) });
    smooth.el.setAttribute('data-tip', t('anim.smoothnessTip'));
    curve.push(field(t('anim.smoothness'), smooth.el));
  } else {
    easing = select(
      EASING_KINDS.map((e) => ({ value: e.key, label: lbl(e.label) })),
      c0.easing,
      // N1: a custom curve starts from the classic smooth one, or the handles it had.
      (v) => patch({ easing: v as EasingKind, smoothness: undefined, ...(v === 'CUSTOM' ? { curve: [...(store.get().animation.clips.find((c) => c.id === id)?.curve ?? DEFAULT_CURVE)] as [number, number, number, number] } : {}) }),
      t('anim.easing'),
    );
    curve.push(field(t('anim.easing'), easing.el));
  }
  // N1: the custom curve, with its two handles to drag and their numbers to type.
  let editor: ReturnType<typeof curveEditor> | null = null;
  let handleFields: ReturnType<typeof numberField>[] = [];
  if (c0.move !== 'EXPLODE' && c0.easing === 'CUSTOM' && c0.smoothness === undefined) {
    const handlesOf = () => [...(store.get().animation.clips.find((c) => c.id === id)?.curve ?? DEFAULT_CURVE)] as [number, number, number, number];
    editor = curveEditor(handlesOf(), (hs, g) => patch({ curve: hs }, g));
    const names = ['x1', 'y1', 'x2', 'y2'];
    handleFields = names.map((n, k) =>
      numberField({ value: handlesOf()[k], step: 0.01, digits: 2, label: n, ariaLabel: `${t(k < 2 ? 'anim.handle1' : 'anim.handle2')} ${n}`, onChange: (v, g) => {
        const hs = handlesOf();
        hs[k] = v;
        patch({ curve: hs }, g);
      } }),
    );
    curve.push(h('div', { class: 'anim-curve-host', 'data-curve-editor': '' }, editor.el));
    curve.push(field(t('anim.handle1'), h('div', { class: 'field-row2', 'data-curve-handle': '1' }, handleFields[0].el, handleFields[1].el)));
    curve.push(field(t('anim.handle2'), h('div', { class: 'field-row2', 'data-curve-handle': '2' }, handleFields[2].el, handleFields[3].el)));
  } else curve.push(curveHost);

  scope.watch(
    (s) => [s.animation.clips.find((x) => x.id === id), s.scene.nodes, s.studio.lights],
    () => {
      const s = store.get();
      const c = s.animation.clips.find((x) => x.id === id);
      if (!c) return;
      header.textContent = clipHeader(s, c, getLang());
      sentence.textContent = clipSentence(s, c, getLang());
      start.set(c.start);
      dur.set(c.duration);
      end.set(clipEnd(c));
      repeat.set(clipRepeat(c));
      reverse.set(c.reverse === true);
      easing?.set(c.easing);
      smooth?.set(Math.round((c.smoothness ?? smoothnessOf(c.easing)) * 100));
      curveHost.replaceChildren(curvePreview(c));
      const hs = c.curve ?? DEFAULT_CURVE;
      editor?.set(hs);
      handleFields.forEach((f, k) => f.set(hs[k]));
    },
    shallowEq,
  );

  const body: HTMLElement[] = [header, sentence];
  if (move.length) body.push(section(ctx, 'anim-move', t('anim.secMove'), h('div', { class: 'stack' }, ...move)));
  if (c0.move === 'EXPLODE') body.push(section(ctx, 'anim-parts', t('ex.pinned'), exceptions(ctx, scope, id)));
  body.push(section(ctx, 'anim-time', t('anim.secTime'), h('div', { class: 'stack' }, field(t('anim.start'), start.el), field(t('anim.duration'), dur.el), field(t('anim.end'), end.el), field(t('anim.repeat'), repeat.el), field(t(c0.move === 'EXPLODE' ? 'anim.reverseExplode' : 'anim.reverse'), reverse.el))));
  if (!physics) body.push(section(ctx, 'anim-curve', t('anim.secCurve'), h('div', { class: 'stack' }, ...curve)));
  body.push(
    h(
      'div',
      { class: 'row anim-props-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => anim.duplicateClips(ctx, [id]) }, icon('duplicate', 14), t('common.duplicate')),
      h('button', { type: 'button', class: 'btn', onclick: () => anim.deleteClips(ctx, [id]) }, icon('trash', 14), t('common.delete')),
    ),
  );
  return h('div', { class: 'anim-props-body' }, ...body);
}

/** Where the smoothness knob sits for a clip that has only an easing kind. */
function smoothnessOf(e: EasingKind): number {
  return e === 'LINEAR' ? 0 : e === 'EASE_STRONG' ? 1 : 0.5;
}

function manyView(ctx: Ctx, ids: string[]): HTMLElement {
  return h(
    'div',
    { class: 'anim-props-body' },
    h('div', { class: 'anim-props-head' }, t('anim.propsMany', { n: ids.length })),
    h(
      'div',
      { class: 'row anim-props-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => anim.duplicateClips(ctx, ids) }, icon('duplicate', 14), t('common.duplicate')),
      h('button', { type: 'button', class: 'btn', onclick: () => anim.reverseClips(ctx, ids) }, t('anim.reverse')),
      h('button', { type: 'button', class: 'btn', onclick: () => anim.deleteClips(ctx, ids) }, icon('trash', 14), t('common.delete')),
    ),
  );
}

/** Nothing selected: what to do, and the presets in their list. */
function noneView(ctx: Ctx): HTMLElement {
  return h(
    'div',
    { class: 'anim-props-body' },
    h('p', { class: 'note', style: 'margin:0' }, t('anim.propsNone')),
    h('div', { class: 'field-label', style: 'font-weight:600;margin-top:4px' }, t('anim.presets')),
    h(
      'div',
      { class: 'anim-presets', role: 'list', 'aria-label': t('anim.presets'), 'data-tip': t('anim.presetsTip') },
      // Each preset is a button (announced as one) inside an item of the list.
      ...SEQUENCE_PRESETS.map((p) => h('div', { role: 'listitem', class: 'anim-preset-item' }, h('button', { type: 'button', class: 'list-row anim-preset', 'data-preset': p.key, onclick: () => anim.applyPreset(ctx, p.key) }, lbl(p.label)))),
    ),
  );
}


/**
 * "+ Animate…" in three steps (N1, UI.md §2.5), in line in the properties: 1 what moves (the target, the scene's
 * selection already in it), 2 how (a grid of cards, grouped as SPEC §3.7 groups the kinds: parts, camera, light and
 * environment, materials; only the target's), 3 how much and for how long. Back and Next between them, Add at the end.
 */
function wizardView(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const w = ui.get().wizard!;
  const s = store.get();
  const step = w.step ?? 1;
  const set = (patch: Partial<WizardState>) => ui.set({ wizard: { ...ui.get().wizard!, ...patch } });
  const kinds: ClipTargetKind[] = ['CAMERA', 'SUBJECT', 'NODE', 'LIGHT', 'SCENE', 'MATERIAL'];
  const kind = w.target?.kind ?? null;
  const pick = (target: ClipTarget) => {
    const moves = anim.wizardMoves(s, target);
    const move = moves.includes(w.move as MoveKind) ? (w.move as MoveKind) : (moves[0] ?? null);
    set({ target, move, amount: move ? anim.wizardAmount(s, target, move) : 0 });
  };
  const head = h(
    'div',
    { class: 'wizard-head' },
    h('span', { class: 'field-label', style: 'font-weight:600' }, t('anim.animate')),
    h('span', { class: 'aux tabular', 'data-wizard-step': String(step) }, t('anim.wizardStep', { n: step })),
    h('span', { class: 'wizard-dots', 'aria-hidden': 'true' }, ...[1, 2, 3].map((n) => h('span', { class: `wizard-dot${n === step ? ' is-on' : n < step ? ' is-done' : ''}` }))),
  );
  const parts: HTMLElement[] = [head];
  const title = (n: number, key: Parameters<typeof t>[0]) => h('div', { class: 'field-label', style: 'font-weight:600' }, `${n} · ${t(key)}`);

  if (step === 1) {
    parts.push(title(1, 'anim.wizardWhat'));
    const firstMaterial = Object.keys(s.materials)[0] ?? '';
    const targetSeg = segmented(
      kinds.map((k) => ({ value: k, label: t(dyn(`anim.target.${k}`)), disabled: k === 'MATERIAL' && !firstMaterial })),
      kind,
      (k) => pick(k === 'NODE' ? { kind: 'NODE', id: allParts(s)[0] ?? '' } : k === 'LIGHT' ? { kind: 'LIGHT', id: s.studio.lights[0]?.id ?? '' } : k === 'MATERIAL' ? { kind: 'MATERIAL', id: firstMaterial } : ({ kind: k } as ClipTarget)),
      { ariaLabel: t('anim.wizardWhat') },
    );
    targetSeg.el.style.flexWrap = 'wrap';
    parts.push(targetSeg.el);
    if (w.target?.kind === 'NODE') {
      const opts = Object.values(s.scene.nodes).map((n) => ({ value: n.id, label: n.name }));
      parts.push(select(opts, w.target.id, (v) => pick({ kind: 'NODE', id: v }), t('anim.target')).el);
    }
    if (w.target?.kind === 'LIGHT') {
      const opts = s.studio.lights.map((l) => ({ value: l.id, label: lightName(s, l.id, getLang()) }));
      parts.push(select(opts, w.target.id, (v) => pick({ kind: 'LIGHT', id: v }), t('anim.target')).el);
    }
    if (w.target?.kind === 'MATERIAL') {
      const opts = Object.values(s.materials).map((m) => ({ value: m.id, label: materialName(m) }));
      parts.push(select(opts, w.target.id, (v) => pick({ kind: 'MATERIAL', id: v }), t('anim.target')).el);
    }
  } else if (step === 2 && w.target) {
    parts.push(title(2, 'anim.wizardHow'));
    const offered = new Set(anim.wizardMoves(s, w.target));
    // The groups of SPEC §3.7, each with the target's kinds in it, the target's own group first (a kind in two
    // groups, a fade, shows in the first of them: a material's fade among the materials).
    const home = HOME_GROUP[w.target.kind];
    const groups = [...MOVE_GROUPS.filter((g) => g.key === home), ...MOVE_GROUPS.filter((g) => g.key !== home)];
    const shown = new Set<MoveKind>();
    for (const g of groups) {
      const moves = g.moves.filter((m) => offered.has(m) && !shown.has(m));
      if (moves.length === 0) continue;
      moves.forEach((m) => shown.add(m));
      parts.push(h('div', { class: 'aux wizard-group' }, lbl(g.label)));
      parts.push(
        h(
          'div',
          { class: 'anim-cards', role: 'radiogroup', 'aria-label': lbl(g.label) },
          ...moves.map((m) => {
            const item = moveKind(m)!;
            const card = h(
              'button',
              {
                type: 'button',
                class: `anim-card${w.move === m ? ' is-on' : ''}`,
                role: 'radio',
                'aria-checked': String(w.move === m),
                'data-move': m,
                'data-tip': lbl(item.description),
                onclick: () => set({ move: m, amount: anim.wizardAmount(s, w.target, m) }),
                ondblclick: () => set({ move: m, amount: anim.wizardAmount(s, w.target, m), step: 3 }),
              },
              h('span', { class: 'anim-card-icon' }, icon(clipIcon(m), 16)),
              h('span', { class: 'anim-card-name' }, lbl(item.label)),
              h('span', { class: 'anim-card-desc' }, lbl(item.description)),
            );
            return card;
          }),
        ),
      );
    }
  } else if (step === 3 && w.move && w.target) {
    const unit = amountUnit(w.move);
    parts.push(title(3, 'anim.wizardHowMuch'));
    parts.push(h('div', { class: 'note' }, `${clipTargetNameOf(s, w.target)} · ${lbl(moveKind(w.move)!.label)}`));
    const af = unit === 'mm' ? lengthField : numberField;
    if (w.move === 'TINT' || w.move === 'MATERIAL_COLOR') {
      parts.push(field(t('anim.color'), colorField(w.color ?? defaultColor(s, { target: w.target }), (rgb) => set({ color: rgb }), t('anim.color')).el));
    } else {
      const range = w.move === 'FADE' ? { min: 0, max: 100 } : {};
      parts.push(field(w.move === 'EXPLODE' ? `${t('ex.distance')} (${t('ex.unit.SIZE')})` : lbl(moveKind(w.move)?.amountLabel ?? { en: t('anim.amount'), es: t('anim.amount') }), af({ value: w.amount, step: w.move === 'SCALE' || w.move === 'FOCUS' || unit === 'parts' ? 0.05 : 1, digits: 2, unit: unit === 'mm' || unit === 'parts' ? undefined : UNIT_TEXT[unit], onChange: (v) => set({ amount: v }), ...range }).el));
    }
    parts.push(field(t('anim.start'), numberField({ value: w.start, min: 0, step: 0.1, digits: 1, unit: 's', onChange: (v) => set({ start: v }) }).el));
    parts.push(field(t('anim.duration'), numberField({ value: w.duration, min: 0.1, step: 0.1, digits: 1, unit: 's', onChange: (v) => set({ duration: v }) }).el));
    parts.push(field(t('anim.easing'), select(EASING_KINDS.map((e) => ({ value: e.key, label: lbl(e.label) })), w.easing, (v) => set({ easing: v as EasingKind }), t('anim.easing')).el));
    if (kind === 'CAMERA' && s.animation.shots.length > 0) {
      parts.push(field(t('anim.inShot'), select([{ value: '', label: t('anim.allShots') }, ...s.animation.shots.map((_, i) => ({ value: String(i), label: t('anim.shot', { n: i + 1 }) }))], w.shot === null ? '' : String(w.shot), (v) => set({ shot: v === '' ? null : Number(v) }), t('anim.inShot')).el));
    }
  }
  const back = step > 1 ? h('button', { type: 'button', class: 'btn', 'data-wizard-back': '', onclick: () => set({ step: (step - 1) as 1 | 2 }) }, t('anim.back')) : null;
  const next =
    step < 3
      ? h('button', { type: 'button', class: 'btn btn-primary', 'data-wizard-next': '', disabled: step === 1 ? !w.target : !w.move, onclick: () => set({ step: (step + 1) as 2 | 3 }) }, t('anim.next'))
      : h('button', { type: 'button', class: 'btn btn-primary', 'data-wizard-add': '', disabled: !w.move || !w.target, onclick: () => anim.finishWizard(ctx) }, t('common.add'));
  parts.push(h('div', { class: 'row' }, back, next, h('button', { type: 'button', class: 'btn', onclick: () => ui.set({ wizard: null }) }, t('common.cancel'))));
  void scope;
  return h('div', { class: 'wizard', 'data-wizard': String(step) }, ...parts);
}

/** N1: the group of the wizard's grid a kind of target belongs to (its kinds are listed first). */
const HOME_GROUP: Readonly<Record<ClipTargetKind, (typeof MOVE_GROUPS)[number]['key']>> = { CAMERA: 'CAMERA', SUBJECT: 'PARTS', NODE: 'PARTS', LIGHT: 'LIGHT', SCENE: 'LIGHT', MATERIAL: 'MATERIAL' };

/** A target's name for the wizard's summary line. */
function clipTargetNameOf(s: ProjectState, target: ClipTarget): string {
  return clipTargetName(s, target, getLang());
}

/**
 * N1: the properties of a shot of the camera track (a segment clicked in the timeline): its camera, its length and how
 * the track changes into it: a cut, or a fade to black or to white of a length (a cross-fade is a later phase).
 */
function shotView(ctx: Ctx, scope: Scope, shotId: string): HTMLElement {
  const { store } = ctx;
  const s0 = store.get();
  const i0 = s0.animation.shots.findIndex((x) => x.id === shotId);
  if (i0 < 0) return h('div');
  const label = L('undo.shotChange');
  const setShot = (patch: Partial<Omit<Shot, 'id'>>, g?: string) => store.dispatch({ type: 'anim/setShot', id: shotId, patch, gesture: g, label });
  const header = h('div', { class: 'anim-props-head', 'data-shot-header': shotId });
  const cams = Object.values(s0.camera.cameras);
  const camSel = select([{ value: '', label: t('anim.activeCamera') }, ...cams.map((c) => ({ value: c.id, label: cameraName(s0, c) }))], s0.animation.shots[i0].camera ?? '', (v) => setShot({ camera: v === '' ? null : v }), t('anim.shotCamera'));
  const len = numberField({ value: s0.animation.shots[i0].duration, min: 0.1, step: 0.1, digits: 2, unit: 's', ariaLabel: t('anim.duration'), onChange: (v, g) => setShot({ duration: v }, g) });
  type Change = 'CUT' | 'BLACK' | 'WHITE' | 'CROSS';
  const changeOf = (): Change => {
    const tr = shotTransition(store.get().animation.shots.find((x) => x.id === shotId) ?? {});
    return tr.kind === 'CUT' ? 'CUT' : tr.color === 'WHITE' ? 'WHITE' : 'BLACK';
  };
  const change = segmented<Change>(
    [
      { value: 'CUT', label: t('anim.change.CUT') },
      { value: 'BLACK', label: t('anim.change.BLACK') },
      { value: 'WHITE', label: t('anim.change.WHITE') },
      // A cross-fade shows two cameras at once: a later phase.
      { value: 'CROSS', label: t('anim.change.CROSS'), disabled: true, title: t('anim.crossSoon') },
    ],
    changeOf(),
    (v) => {
      if (v === 'CROSS') return;
      const cur = shotTransition(store.get().animation.shots.find((x) => x.id === shotId) ?? {});
      setShot({ transition: v === 'CUT' ? undefined : { kind: 'FADE', color: v, duration: cur.kind === 'FADE' ? cur.duration : DEFAULT_FADE.duration } });
    },
    { full: true, ariaLabel: t('anim.change') },
  );
  const fadeLen = numberField({ value: DEFAULT_FADE.duration, min: MIN_FADE, max: MAX_FADE, step: 0.05, digits: 2, unit: 's', ariaLabel: t('anim.fadeLength'), onChange: (v, g) => {
    const cur = shotTransition(store.get().animation.shots.find((x) => x.id === shotId) ?? {});
    if (cur.kind === 'FADE') setShot({ transition: { ...cur, duration: v } }, g);
  } });
  const fadeRow = field(t('anim.fadeLength'), fadeLen.el);
  const note = h('p', { class: 'note', style: 'margin:0' });
  scope.watch(
    (s) => [s.animation.shots, s.camera.cameras],
    () => {
      const s = store.get();
      const i = s.animation.shots.findIndex((x) => x.id === shotId);
      if (i < 0) return;
      const sh = s.animation.shots[i];
      const start = shotStarts(s)[i];
      const cam = sh.camera ? s.camera.cameras[sh.camera] : undefined;
      header.textContent = `${t('anim.shot', { n: i + 1 })} · ${cam ? cameraName(s, cam) : t('anim.activeCamera')} · ${formatNumber(start, getLang())}–${formatNumber(start + sh.duration, getLang())} s`;
      camSel.set(sh.camera ?? '');
      len.set(sh.duration);
      const tr = shotTransition(sh);
      change.set(changeOf());
      fadeRow.style.display = tr.kind === 'FADE' ? '' : 'none';
      if (tr.kind === 'FADE') fadeLen.set(tr.duration);
      note.textContent = tr.kind === 'FADE' ? t(i === 0 ? 'anim.fadeFirst' : 'anim.fadeNote2') : t(i === 0 ? 'anim.cutFirst' : 'anim.cutNote');
    },
    shallowEq,
  );
  return h(
    'div',
    { class: 'anim-props-body', 'data-shot-props': shotId },
    header,
    section(ctx, 'anim-shot', t('anim.secShot'), h('div', { class: 'stack' }, field(t('anim.shotCamera'), camSel.el), field(t('anim.duration'), len.el), field(t('anim.change'), change.el), fadeRow, note)),
    h(
      'div',
      { class: 'row anim-props-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => { store.dispatch({ type: 'anim/removeShot', id: shotId, label: L('undo.removeShot') }); ctx.ui.set({ selectedShot: null }); } }, icon('trash', 14), t('anim.removeShot')),
    ),
  );
}

/** The structure of a clip's panel: what is shown (fields come and go with these), not the values. */
function structureKey(c: MotionClip): string {
  // N1: a custom curve shows its editor; a pivot its part or its point.
  if (c.move !== 'EXPLODE') return `${c.move}:${c.target.kind}:${c.easing === 'CUSTOM' && c.smoothness === undefined ? 'C' : ''}:${c.pivot?.kind ?? ''}`;
  const r = resolveExplode(c.explode);
  return `EXPLODE:${targetKey(c.target)}:${r.geometry}:${r.linear}:${r.axis}:${r.levels}:${r.unit}:${r.centre.kind}:${r.order}`;
}

export function propsColumn(ctx: Ctx, scope: Scope): HTMLElement {
  return dynamic(
    scope,
    (s, u) => {
      const w = u.wizard;
      if (w) return `w:${w.step ?? 1}:${w.target ? targetKey(w.target) : ''}:${w.move ?? ''}:${s.animation.shots.length}:${Object.keys(s.scene.nodes).length}`;
      // N1: a shot of the camera track, selected in its lane.
      if (u.selectedShot && s.animation.shots.some((x) => x.id === u.selectedShot)) return `s:${u.selectedShot}`;
      const have = new Set(s.animation.clips.map((c) => c.id));
      const ids = [...u.selectedClips.filter((id) => have.has(id)), ...(u.selectedClip && have.has(u.selectedClip) && !u.selectedClips.includes(u.selectedClip) ? [u.selectedClip] : [])];
      if (ids.length > 1) return `m:${ids.join(',')}`;
      const c = ids.length === 1 ? s.animation.clips.find((x) => x.id === ids[0]) : undefined;
      return c ? `c:${c.id}:${structureKey(c)}:${s.scene.roots.length}` : 'none';
    },
    (sc, key) => {
      let inner: HTMLElement;
      if (key.startsWith('w:')) inner = wizardView(ctx, sc);
      else if (key.startsWith('m:')) inner = manyView(ctx, key.slice(2).split(','));
      else if (key.startsWith('c:')) inner = clipView(ctx, sc, key.split(':')[1]);
      else if (key.startsWith('s:')) inner = shotView(ctx, sc, key.slice(2));
      else inner = noneView(ctx);
      // A new panel starts at its top (the header says what it edits).
      requestAnimationFrame(() => inner.parentElement && (inner.parentElement.scrollTop = 0));
      return inner;
    },
    undefined,
    'div',
    'anim-props',
  );
}

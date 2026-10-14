// The right zone of the animation timeline (phase N6, UI.md §2.5): the properties of the selected clip (how it moves),
// under a header that says it in one line ("Cap · Spherical exploded view · 1.5 × size · 0–3 s"); the "+ Animate…"
// wizard; and, with nothing selected, the presets. The knobs of an explode are the parameters of core/explode.ts.
// Every edit is an action of the store (one undo entry per drag of a field).

import { EASING_KINDS, MOVE_KINDS, SEQUENCE_PRESETS, moveKind } from '../../data/animation';
import type { EasingKind, MoveKind } from '../../data/types';
import { TARGET_MOVES, amountUnit, clipCurve, clipEnd, clipRepeat, easingForSmoothness, type ClipTarget, type ClipTargetKind, type MotionClip } from '../../core/animation';
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
import { field, lengthField, numberField, segmented, select, slider, toggle } from '../components/controls';
import { section } from '../components/section';
import { h, icon } from '../dom';
import { dyn, lightName } from '../names';
import { dynamic, shallowEq, type Ctx, type Scope } from '../reactive';
import { clipHeader, clipSentence, clipTargetName } from '../sentence';
import { L, getLang, lbl, t } from '../strings';
import type { WizardState } from '../ui-state';

const UNIT_TEXT: Record<ReturnType<typeof amountUnit>, string> = { deg: '°', pct: '%', factor: '×', mm: 'mm', m: 'm', W: 'W', parts: '', none: '' };
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The clip's curve drawn small: how it speeds up and slows down, over its phase. */
export function curvePreview(clip: Pick<MotionClip, 'easing' | 'smoothness' | 'reverse'>): SVGSVGElement {
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
  return make({ value: clip.amount, step: clip.move === 'SCALE' || clip.move === 'FOCUS' || unit === 'parts' ? 0.05 : 1, digits: 2, unit: unit === 'mm' ? undefined : UNIT_TEXT[unit], ariaLabel: t('anim.amount'), onChange });
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
  if (c0.move === 'EXPLODE') move.push(...explodeKnobs(ctx, scope, id));
  else if (c0.move !== 'TINT') {
    const amount = amountField(c0, (v, g) => patch({ amount: v }, g));
    scope.watch((s) => s.animation.clips.find((c) => c.id === id)?.amount, (v) => v !== undefined && amount.set(v));
    move.push(field(lbl(moveKind(c0.move)?.amountLabel ?? { en: t('anim.amount'), es: t('anim.amount') }), amount.el));
  }
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
    easing = select(EASING_KINDS.map((e) => ({ value: e.key, label: lbl(e.label) })), c0.easing, (v) => patch({ easing: v as EasingKind, smoothness: undefined }), t('anim.easing'));
    curve.push(field(t('anim.easing'), easing.el));
  }
  curve.push(curveHost);

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
    },
    shallowEq,
  );

  const body: HTMLElement[] = [header, sentence];
  if (move.length) body.push(section(ctx, 'anim-move', t('anim.secMove'), h('div', { class: 'stack' }, ...move)));
  if (c0.move === 'EXPLODE') body.push(section(ctx, 'anim-parts', t('ex.pinned'), exceptions(ctx, scope, id)));
  body.push(section(ctx, 'anim-time', t('anim.secTime'), h('div', { class: 'stack' }, field(t('anim.start'), start.el), field(t('anim.duration'), dur.el), field(t('anim.end'), end.el), field(t('anim.repeat'), repeat.el), field(t(c0.move === 'EXPLODE' ? 'anim.reverseExplode' : 'anim.reverse'), reverse.el))));
  body.push(section(ctx, 'anim-curve', t('anim.secCurve'), h('div', { class: 'stack' }, ...curve)));
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
      { class: 'anim-presets', role: 'list', 'data-tip': t('anim.presetsTip') },
      ...SEQUENCE_PRESETS.map((p) => h('button', { type: 'button', class: 'list-row anim-preset', role: 'listitem', 'data-preset': p.key, onclick: () => anim.applyPreset(ctx, p.key) }, lbl(p.label))),
    ),
  );
}

function wizardView(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const w = ui.get().wizard!;
  const s = store.get();
  const set = (patch: Partial<WizardState>) => ui.set({ wizard: { ...ui.get().wizard!, ...patch } });
  const kinds: ClipTargetKind[] = ['CAMERA', 'SUBJECT', 'NODE', 'LIGHT', 'SCENE'];
  const kind = w.target?.kind ?? null;
  const allowed = (m: MoveKind) => m !== 'EXPLODE' || (w.target !== null && anim.canExplode(s, w.target));
  const pick = (target: ClipTarget) => {
    const moves = TARGET_MOVES[target.kind].filter((m) => m !== 'EXPLODE' || anim.canExplode(s, target));
    const move = moves.includes(w.move as MoveKind) ? (w.move as MoveKind) : moves[0];
    set({ target, move, amount: anim.wizardAmount(s, target, move) });
  };
  const targetSeg = segmented(
    kinds.map((k) => ({ value: k, label: t(dyn(`anim.target.${k}`)) })),
    kind,
    (k) => pick(k === 'NODE' ? { kind: 'NODE', id: allParts(s)[0] ?? '' } : k === 'LIGHT' ? { kind: 'LIGHT', id: s.studio.lights[0]?.id ?? '' } : ({ kind: k } as ClipTarget)),
    { ariaLabel: t('anim.wizardWhat') },
  );
  targetSeg.el.style.flexWrap = 'wrap';
  const parts: HTMLElement[] = [h('div', { class: 'field-label', style: 'font-weight:600' }, `1 · ${t('anim.wizardWhat')}`), targetSeg.el];
  if (w.target?.kind === 'NODE') {
    const opts = Object.values(s.scene.nodes).map((n) => ({ value: n.id, label: n.name }));
    parts.push(select(opts, w.target.id, (v) => pick({ kind: 'NODE', id: v }), t('anim.target')).el);
  }
  if (w.target?.kind === 'LIGHT') {
    const opts = s.studio.lights.map((l) => ({ value: l.id, label: lightName(s, l.id, getLang()) }));
    parts.push(select(opts, w.target.id, (v) => pick({ kind: 'LIGHT', id: v }), t('anim.target')).el);
  }
  if (kind) {
    const moves = TARGET_MOVES[kind].filter(allowed);
    parts.push(h('div', { class: 'field-label', style: 'font-weight:600' }, `2 · ${t('anim.wizardHow')}`));
    parts.push(select(moves.map((m) => ({ value: m, label: lbl(moveKind(m)!.label) })), w.move ?? moves[0], (v) => set({ move: v as MoveKind, amount: anim.wizardAmount(s, w.target, v as MoveKind) }), t('anim.wizardHow')).el);
    const desc = w.move ? MOVE_KINDS.find((m) => m.key === w.move)?.description : undefined;
    if (desc) parts.push(h('div', { class: 'note' }, lbl(desc)));
  }
  if (w.move) {
    const unit = amountUnit(w.move);
    parts.push(h('div', { class: 'field-label', style: 'font-weight:600' }, `3 · ${t('anim.wizardHowMuch')}`));
    const af = unit === 'mm' ? lengthField : numberField;
    if (w.move !== 'TINT') parts.push(field(w.move === 'EXPLODE' ? `${t('ex.distance')} (${t('ex.unit.SIZE')})` : lbl(moveKind(w.move)?.amountLabel ?? { en: t('anim.amount'), es: t('anim.amount') }), af({ value: w.amount, step: w.move === 'SCALE' || w.move === 'FOCUS' || unit === 'parts' ? 0.05 : 1, digits: 2, unit: unit === 'mm' || unit === 'parts' ? undefined : UNIT_TEXT[unit], onChange: (v) => set({ amount: v }) }).el));
    parts.push(field(t('anim.start'), numberField({ value: w.start, min: 0, step: 0.1, digits: 1, unit: 's', onChange: (v) => set({ start: v }) }).el));
    parts.push(field(t('anim.duration'), numberField({ value: w.duration, min: 0.1, step: 0.1, digits: 1, unit: 's', onChange: (v) => set({ duration: v }) }).el));
    parts.push(field(t('anim.easing'), select(EASING_KINDS.map((e) => ({ value: e.key, label: lbl(e.label) })), w.easing, (v) => set({ easing: v as EasingKind }), t('anim.easing')).el));
    if (kind === 'CAMERA' && s.animation.shots.length > 0) {
      parts.push(field(t('anim.inShot'), select([{ value: '', label: t('anim.allShots') }, ...s.animation.shots.map((_, i) => ({ value: String(i), label: t('anim.shot', { n: i + 1 }) }))], w.shot === null ? '' : String(w.shot), (v) => set({ shot: v === '' ? null : Number(v) }), t('anim.inShot')).el));
    }
  }
  const add = h('button', { type: 'button', class: 'btn btn-primary', 'data-wizard-add': '', disabled: !w.move || !w.target, onclick: () => anim.finishWizard(ctx) }, t('common.add'));
  parts.push(h('div', { class: 'row' }, add, h('button', { type: 'button', class: 'btn', onclick: () => ui.set({ wizard: null }) }, t('common.cancel'))));
  void scope;
  return h('div', { class: 'wizard' }, ...parts);
}

/** The structure of a clip's panel: what is shown (fields come and go with these), not the values. */
function structureKey(c: MotionClip): string {
  if (c.move !== 'EXPLODE') return `${c.move}:${c.target.kind}`;
  const r = resolveExplode(c.explode);
  return `EXPLODE:${targetKey(c.target)}:${r.geometry}:${r.linear}:${r.axis}:${r.levels}:${r.unit}:${r.centre.kind}:${r.order}`;
}

export function propsColumn(ctx: Ctx, scope: Scope): HTMLElement {
  return dynamic(
    scope,
    (s, u) => {
      const w = u.wizard;
      if (w) return `w:${w.target ? targetKey(w.target) : ''}:${w.move ?? ''}:${s.animation.shots.length}:${Object.keys(s.scene.nodes).length}`;
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

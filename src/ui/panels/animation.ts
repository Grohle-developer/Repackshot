// Animation drawer (UI.md §2.5): shots on the left, moves as plain-language
// cards and a block timeline in the centre, presets and the three-question
// "Add move" wizard on the right. Playing moves the camera and the parts in
// the viewport with the analytic easing; video export is a later phase.

import { EASING_KINDS, MOVE_KINDS, SEQUENCE_PRESETS, moveKind } from '../../data/animation';
import type { EasingKind, MoveKind } from '../../data/types';
import {
  TARGET_MOVES,
  amountUnit,
  clipConflicts,
  defaultAmount,
  shotStarts,
  totalDuration,
  type ClipTarget,
  type ClipTargetKind,
  type MotionClip,
} from '../../core/animation';
import { activeCamera } from '../../core/camera';
import { allParts } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import * as cmd from '../commands';
import { field, numberField, segmented, select } from '../components/controls';
import { h, icon } from '../dom';
import { dyn, lightName } from '../names';
import { dynamic, shallowEq, type Ctx, type Scope } from '../reactive';
import { clipSentence } from '../sentence';
import { L, formatNumber, getLang, lbl, t } from '../strings';
import type { WizardState } from '../ui-state';

const UNIT_TEXT: Record<ReturnType<typeof amountUnit>, string> = { deg: '°', pct: '%', factor: '×', mm: 'mm', m: 'm', W: 'W', parts: '', none: '' };

function targetKey(tg: ClipTarget): string {
  return tg.kind === 'NODE' || tg.kind === 'LIGHT' ? `${tg.kind}:${tg.id}` : tg.kind;
}

function laneLabel(s: ProjectState, tg: ClipTarget): string {
  switch (tg.kind) {
    case 'CAMERA':
      return t('anim.target.CAMERA');
    case 'SUBJECT':
      return t('anim.target.SUBJECT');
    case 'SCENE':
      return t('anim.target.SCENE');
    case 'NODE':
      return s.scene.nodes[tg.id]?.name ?? '?';
    case 'LIGHT':
      return lightName(s, tg.id, getLang());
  }
}

function secs(v: number): string {
  return `${formatNumber(v, getLang(), 2)} s`;
}

function head(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const play = h('button', { type: 'button', class: 'icon-btn' });
  play.addEventListener('click', () => {
    const s = store.get();
    if (!s.animation.playing && s.animation.playhead >= totalDuration(s)) store.dispatch({ type: 'anim/playhead', t: 0 });
    store.dispatch({ type: 'anim/play', playing: !s.animation.playing });
  });
  const rewind = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('anim.stop'), 'data-tip': t('anim.stop'), onclick: () => {
    store.dispatch({ type: 'anim/play', playing: false });
    store.dispatch({ type: 'anim/playhead', t: 0 });
  } }, icon('rewind'));
  const time = h('span', { class: 'tabular' });
  const frame = h('span', { class: 'aux tabular' });
  const fps = numberField({ value: store.get().animation.fps, min: 1, max: 120, step: 1, unit: t('anim.fps'), ariaLabel: t('anim.fps'), onChange: (v, g) => store.dispatch({ type: 'anim/setFps', fps: v, gesture: g, label: L('undo.fps') }) });
  fps.el.style.width = '84px';
  scope.watch(
    (s) => [s.animation.playing, s.animation.playhead, s.animation.fps, s.animation.shots, s.animation.clips],
    () => {
      const s = store.get();
      const a = s.animation;
      play.replaceChildren(icon(a.playing ? 'pause' : 'play'));
      play.setAttribute('aria-label', a.playing ? t('anim.pause') : t('anim.play'));
      play.setAttribute('data-tip', a.playing ? t('anim.pause') : t('anim.play'));
      const total = totalDuration(s);
      time.textContent = `${secs(a.playhead)} / ${secs(total)}`;
      frame.textContent = t('anim.frame', { n: Math.floor(a.playhead * a.fps) });
      fps.set(a.fps);
      play.toggleAttribute('disabled', total <= 0);
    },
    shallowEq,
  );
  // Animations render from the render window in Animation mode (UI.md §2.5).
  const video = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      'data-tip': t('anim.renderTip'),
      onclick: () => {
        if (store.get().render.mode !== 'ANIMATION') store.dispatch({ type: 'render/set', patch: { mode: 'ANIMATION' }, label: L('undo.render') });
        cmd.openRenderWindow(ctx);
      },
    },
    icon('film', 14),
    t('anim.renderAnimation'),
  );
  return h('div', { class: 'anim-head' }, play, rewind, time, frame, fps.el, h('span', { style: 'flex:1' }), video, h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('render.drawerClose'), 'data-tip': t('render.drawerClose'), onclick: () => ctx.ui.set({ drawer: null }) }, icon('close')));
}

function shotsColumn(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const col = h('div', { class: 'anim-col' });
  return dynamic(
    scope,
    (s) => s.animation.shots.map((x) => x.id).join(','),
    (sc) => {
      const s = store.get();
      const rows = s.animation.shots.map((shot, i) => {
        const dur = numberField({ value: shot.duration, min: 0.1, max: 600, step: 0.1, digits: 1, unit: 's', ariaLabel: t('anim.duration'), onChange: (v, g) => store.dispatch({ type: 'anim/setShot', id: shot.id, patch: { duration: v }, gesture: g, label: L('undo.shotLength') }) });
        sc.watch((st) => st.animation.shots.find((x) => x.id === shot.id)?.duration ?? shot.duration, (v) => dur.set(v));
        return h(
          'div',
          { class: 'shot-row' },
          h('span', null, t('anim.shot', { n: i + 1 })),
          dur.el,
          h(
            'span',
            { class: 'row', style: 'gap:0;flex-wrap:nowrap' },
            h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('common.moveUp'), disabled: i === 0, onclick: () => store.dispatch({ type: 'anim/moveShot', id: shot.id, delta: -1, label: L('undo.moveShot') }) }, icon('arrowUp', 12)),
            h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('common.moveDown'), disabled: i === s.animation.shots.length - 1, onclick: () => store.dispatch({ type: 'anim/moveShot', id: shot.id, delta: 1, label: L('undo.moveShot') }) }, icon('arrowDown', 12)),
            h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('common.remove'), onclick: () => store.dispatch({ type: 'anim/removeShot', id: shot.id, label: L('undo.removeShot') }) }, icon('close', 12)),
          ),
        );
      });
      col.replaceChildren(
        h('div', { class: 'field-label', style: 'font-weight:600' }, t('anim.shots')),
        ...rows,
        h('button', { type: 'button', class: 'btn', onclick: () => store.dispatch({ type: 'anim/addShot', duration: 3, label: L('undo.addShot') }) }, icon('plus', 14), t('anim.addShot')),
      );
      return col;
    },
    undefined,
    'div',
    'anim-col-host',
  );
}

/** Width of the lane-label gutter of the timeline, px. */
const GUTTER = 84;
const ROW_H = 20;

function timeline(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const el = h('div', { class: 'timeline', 'aria-label': t('anim.timeline') });
  const draw = () => {
    const s = store.get();
    const a = s.animation;
    const total = Math.max(totalDuration(s), 1);
    const w = Math.max(100, (el.clientWidth || 600) - GUTTER - 8);
    const px = w / total;
    const conflicts = clipConflicts(s);
    const starts = shotStarts(s);
    const ruler = h(
      'div',
      { class: 'tl-shots', style: `margin-left:${GUTTER}px` },
      ...a.shots.map((shot, i) => h('div', { class: 'tl-shot', style: `left:${starts[i] * px}px;width:${shot.duration * px}px` }, t('anim.shot', { n: i + 1 }))),
    );
    ruler.addEventListener('pointerdown', (e) => {
      const r = ruler.getBoundingClientRect();
      store.dispatch({ type: 'anim/playhead', t: Math.max(0, (e.clientX - r.left) / px) });
    });
    // One lane per target; overlapping moves of a lane stack in rows.
    const lanes = new Map<string, { target: ClipTarget; rows: MotionClip[][] }>();
    for (const c of a.clips) {
      const k = targetKey(c.target);
      if (!lanes.has(k)) lanes.set(k, { target: c.target, rows: [] });
      const lane = lanes.get(k)!;
      const row = lane.rows.find((r) => r.every((o) => c.start >= o.start + o.duration || o.start >= c.start + c.duration));
      if (row) row.push(c);
      else lane.rows.push([c]);
    }
    const laneEls = [...lanes.values()].map((lane) =>
      h(
        'div',
        { class: 'tl-lane', style: `height:${lane.rows.length * ROW_H + 4}px` },
        h('span', { class: 'tl-lane-label', style: `width:${GUTTER - 8}px` }, laneLabel(s, lane.target)),
        ...lane.rows.flatMap((row, ri) =>
          row.map((c) => {
            const label = lbl(moveKind(c.move)?.label ?? { en: c.move, es: c.move });
            const block = h(
              'div',
              {
                class: `tl-block${ui.get().selectedClip === c.id ? ' is-selected' : ''}${conflicts.has(c.id) ? ' is-conflict' : ''}`,
                style: `left:${GUTTER + c.start * px}px;top:${3 + ri * ROW_H}px;width:${Math.max(6, c.duration * px)}px`,
                'data-tip': clipSentence(s, c, getLang()) + (conflicts.has(c.id) ? ` · ${t('anim.conflict')}` : ''),
              },
              label,
              h('span', { class: 'tl-handle' }),
            );
            block.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              ui.set({ selectedClip: c.id, wizard: null });
              const stretch = (e.target as HTMLElement).classList.contains('tl-handle');
              const x0 = e.clientX;
              const start0 = c.start;
              const dur0 = c.duration;
              const gesture = `clip${c.id}${Date.now()}`;
              block.setPointerCapture(e.pointerId);
              const move = (ev: PointerEvent) => {
                const d = Math.round(((ev.clientX - x0) / px) * 20) / 20;
                const patch = stretch ? { duration: Math.max(0.05, dur0 + d) } : { start: Math.max(0, start0 + d) };
                store.dispatch({ type: 'anim/setClip', id: c.id, patch, gesture, label: L('undo.editClip') });
              };
              const up = () => {
                block.removeEventListener('pointermove', move);
                block.removeEventListener('pointerup', up);
              };
              block.addEventListener('pointermove', move);
              block.addEventListener('pointerup', up);
            });
            return block;
          }),
        ),
      ),
    );
    const head = h('div', { class: 'tl-playhead', style: `left:${GUTTER + a.playhead * px}px` });
    el.replaceChildren(ruler, ...laneEls, head);
  };
  scope.watch((s, u) => [s.animation.shots, s.animation.clips, s.scene.nodes, u.selectedClip], draw, shallowEq);
  scope.watch(
    (s) => s.animation.playhead,
    (p) => {
      const s = store.get();
      const head = el.querySelector('.tl-playhead') as HTMLElement | null;
      const w = Math.max(100, (el.clientWidth || 600) - GUTTER - 8);
      if (head) head.style.left = `${GUTTER + p * (w / Math.max(totalDuration(s), 1))}px`;
    },
  );
  const ro = new ResizeObserver(draw);
  ro.observe(el);
  scope.onDispose(() => ro.disconnect());
  return el;
}

function centerColumn(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const cards = h('div', { class: 'clip-cards' });
  scope.watch(
    (s, u) => [s.animation.clips, s.scene.nodes, s.studio.lights, u.selectedClip],
    () => {
      const s = store.get();
      const conflicts = clipConflicts(s);
      if (s.animation.clips.length === 0) {
        cards.replaceChildren(h('p', { class: 'note', style: 'margin:0' }, t('anim.noMoves')));
        return;
      }
      cards.replaceChildren(
        ...s.animation.clips.map((c) =>
          h(
            'div',
            { class: `clip-card${ui.get().selectedClip === c.id ? ' is-selected' : ''}`, role: 'button', tabindex: 0, onclick: () => ui.set({ selectedClip: c.id, wizard: null }) },
            conflicts.has(c.id) ? h('span', { 'data-tip': t('anim.conflict'), 'aria-label': t('anim.conflict') }, icon('dot', 12)) : null,
            h('span', { class: 'clip-text' }, clipSentence(s, c, getLang())),
          ),
        ),
      );
    },
    shallowEq,
  );
  return h('div', { class: 'anim-col', style: 'gap:6px' }, h('div', { class: 'field-label', style: 'font-weight:600' }, t('anim.moves')), cards, timeline(ctx, scope));
}

function newWizard(s: ProjectState): WizardState {
  return { target: null, move: null, amount: 0, start: Math.round(s.animation.playhead * 10) / 10, duration: 3, easing: 'EASE', shot: null };
}

function wizard(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const w = ui.get().wizard!;
  const s = store.get();
  const set = (patch: Partial<WizardState>) => ui.set({ wizard: { ...ui.get().wizard!, ...patch } });
  const kinds: ClipTargetKind[] = ['CAMERA', 'SUBJECT', 'NODE', 'LIGHT', 'SCENE'];
  const kind = w.target?.kind ?? null;
  const targetSeg = segmented(
    kinds.map((k) => ({ value: k, label: t(dyn(`anim.target.${k}`)) })),
    kind,
    (k) => {
      const target: ClipTarget =
        k === 'NODE' ? { kind: 'NODE', id: allParts(s)[0] ?? '' } : k === 'LIGHT' ? { kind: 'LIGHT', id: s.studio.lights[0]?.id ?? '' } : ({ kind: k } as ClipTarget);
      const move = TARGET_MOVES[k][0];
      set({ target, move, amount: amountFor(move) });
    },
    { ariaLabel: t('anim.wizardWhat') },
  );
  targetSeg.el.style.flexWrap = 'wrap';
  const amountFor = (m: MoveKind) => (m === 'INTENSITY' ? Math.round((s.studio.lights.find((l) => w.target?.kind === 'LIGHT' && l.id === w.target.id)?.power ?? 50) * 2) : m === 'ZOOM' ? Math.round(activeCamera(s).focalMm * 1.5) : defaultAmount(m));
  const parts: HTMLElement[] = [h('div', { class: 'field-label', style: 'font-weight:600' }, `1 · ${t('anim.wizardWhat')}`), targetSeg.el];
  if (w.target?.kind === 'NODE') {
    const opts = Object.values(s.scene.nodes).filter((n) => n.kind !== 'MODEL').map((n) => ({ value: n.id, label: n.name }));
    parts.push(select(opts, w.target.id, (v) => set({ target: { kind: 'NODE', id: v } }), t('anim.target')).el);
  }
  if (w.target?.kind === 'LIGHT') {
    const opts = s.studio.lights.map((l) => ({ value: l.id, label: lightName(s, l.id, getLang()) }));
    parts.push(select(opts, w.target.id, (v) => set({ target: { kind: 'LIGHT', id: v } }), t('anim.target')).el);
  }
  if (kind) {
    const moves = TARGET_MOVES[kind];
    parts.push(h('div', { class: 'field-label', style: 'font-weight:600' }, `2 · ${t('anim.wizardHow')}`));
    parts.push(select(moves.map((m) => ({ value: m, label: lbl(moveKind(m)!.label) })), w.move ?? moves[0], (v) => set({ move: v as MoveKind, amount: amountFor(v as MoveKind) }), t('anim.wizardHow')).el);
    const desc = w.move ? MOVE_KINDS.find((m) => m.key === w.move)?.description : undefined;
    if (desc) parts.push(h('div', { class: 'note' }, lbl(desc)));
  }
  if (w.move) {
    const unit = UNIT_TEXT[amountUnit(w.move)];
    parts.push(h('div', { class: 'field-label', style: 'font-weight:600' }, `3 · ${t('anim.wizardHowMuch')}`));
    if (w.move !== 'TINT') parts.push(field(lbl(moveKind(w.move)?.amountLabel ?? { en: t('anim.amount'), es: t('anim.amount') }), numberField({ value: w.amount, step: w.move === 'SCALE' || w.move === 'FOCUS' || w.move === 'EXPLODE' || amountUnit(w.move) === 'parts' ? 0.05 : 1, digits: 2, unit, onChange: (v) => set({ amount: v }) }).el));
    parts.push(field(t('anim.start'), numberField({ value: w.start, min: 0, step: 0.1, digits: 1, unit: 's', onChange: (v) => set({ start: v }) }).el));
    parts.push(field(t('anim.duration'), numberField({ value: w.duration, min: 0.1, step: 0.1, digits: 1, unit: 's', onChange: (v) => set({ duration: v }) }).el));
    parts.push(field(t('anim.easing'), select(EASING_KINDS.map((e) => ({ value: e.key, label: lbl(e.label) })), w.easing, (v) => set({ easing: v as EasingKind }), t('anim.easing')).el));
    if (kind === 'CAMERA' && s.animation.shots.length > 0) {
      parts.push(field(t('anim.inShot'), select([{ value: '', label: t('anim.allShots') }, ...s.animation.shots.map((_, i) => ({ value: String(i), label: t('anim.shot', { n: i + 1 }) }))], w.shot === null ? '' : String(w.shot), (v) => set({ shot: v === '' ? null : Number(v) }), t('anim.inShot')).el));
    }
  }
  const add = h('button', { type: 'button', class: 'btn btn-primary', disabled: !w.move || !w.target, onclick: () => {
    const cur = ui.get().wizard!;
    if (!cur.move || !cur.target) return;
    const clip: Omit<MotionClip, 'id'> = { target: cur.target, move: cur.move, shot: cur.target.kind === 'CAMERA' ? cur.shot : null, start: cur.start, duration: cur.duration, amount: cur.amount, easing: cur.easing };
    if (cur.move === 'TINT') clip.color = [1, 0.62, 0.35];
    store.dispatch({ type: 'anim/addClip', clip, label: L('undo.addClip') });
    const clips = store.get().animation.clips;
    ui.set({ wizard: null, selectedClip: clips[clips.length - 1]?.id ?? null });
  } }, t('common.add'));
  parts.push(h('div', { class: 'row' }, add, h('button', { type: 'button', class: 'btn', onclick: () => ui.set({ wizard: null }) }, t('common.cancel'))));
  void scope;
  return h('div', { class: 'wizard' }, ...parts);
}

function clipEditor(ctx: Ctx, scope: Scope, id: string): HTMLElement {
  const { store, ui } = ctx;
  const c = store.get().animation.clips.find((x) => x.id === id);
  if (!c) return h('div');
  const label = L('undo.editClip');
  const patch = (p: Partial<MotionClip>, g?: string) => store.dispatch({ type: 'anim/setClip', id, patch: p, gesture: g, label });
  const sentence = h('div', { style: 'font-weight:600;line-height:1.35' });
  const unit = UNIT_TEXT[amountUnit(c.move)];
  const amount = numberField({ value: c.amount, step: c.move === 'SCALE' || c.move === 'FOCUS' || amountUnit(c.move) === 'parts' ? 0.05 : 1, digits: 2, unit, onChange: (v, g) => patch({ amount: v }, g) });
  const start = numberField({ value: c.start, min: 0, step: 0.1, digits: 2, unit: 's', onChange: (v, g) => patch({ start: v }, g) });
  const dur = numberField({ value: c.duration, min: 0.05, step: 0.1, digits: 2, unit: 's', onChange: (v, g) => patch({ duration: v }, g) });
  const easing = select(EASING_KINDS.map((e) => ({ value: e.key, label: lbl(e.label) })), c.easing, (v) => patch({ easing: v as EasingKind }), t('anim.easing'));
  scope.watch(
    (s) => [s.animation.clips.find((x) => x.id === id), s.scene.nodes],
    () => {
      const s = store.get();
      const cur = s.animation.clips.find((x) => x.id === id);
      if (!cur) return;
      sentence.textContent = clipSentence(s, cur, getLang());
      amount.set(cur.amount);
      start.set(cur.start);
      dur.set(cur.duration);
      easing.set(cur.easing);
    },
    shallowEq,
  );
  return h(
    'div',
    { class: 'stack' },
    sentence,
    c.move !== 'TINT' ? field(t('anim.amount'), amount.el) : null,
    field(t('anim.start'), start.el),
    field(t('anim.duration'), dur.el),
    field(t('anim.easing'), easing.el),
    h(
      'div',
      { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: () => {
        store.dispatch({ type: 'anim/removeClip', id, label: L('undo.removeClip') });
        ui.set({ selectedClip: null });
      } }, icon('trash', 14), t('anim.clipDelete')),
      h('button', { type: 'button', class: 'btn', onclick: () => ui.set({ selectedClip: null }) }, t('common.close')),
    ),
  );
}

function rightColumn(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  return dynamic(
    scope,
    // The wizard rebuilds when its structure changes (target, move), not when a value is dragged.
    (s, u) => {
      const w = u.wizard;
      if (w) return `w:${w.target ? targetKey(w.target) : ''}:${w.move ?? ''}:${s.animation.shots.length}:${Object.keys(s.scene.nodes).length}`;
      return u.selectedClip && s.animation.clips.some((c) => c.id === u.selectedClip) ? `c:${u.selectedClip}` : 'p';
    },
    (sc, key) => {
      if (key.startsWith('w:')) return h('div', { class: 'anim-col' }, wizard(ctx, sc));
      if (key.startsWith('c:')) return h('div', { class: 'anim-col' }, clipEditor(ctx, sc, key.slice(2)));
      const presets = select(
        [{ value: '', label: '—' }, ...SEQUENCE_PRESETS.map((p) => ({ value: p.key, label: lbl(p.label) }))],
        '',
        (v) => {
          const p = SEQUENCE_PRESETS.find((x) => x.key === v);
          if (p) store.dispatch({ type: 'anim/preset', key: p.key, label: L('undo.sequence', { name: p.label }) });
        },
        t('anim.presets'),
      );
      return h(
        'div',
        { class: 'anim-col' },
        h('div', { class: 'field-label', style: 'font-weight:600' }, t('anim.presets')),
        presets.el,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => ui.set({ wizard: newWizard(store.get()), selectedClip: null }) }, icon('plus', 14), t('anim.addMove')),
      );
    },
    undefined,
    'div',
    'anim-col-host',
  );
}

export function animationDrawer(ctx: Ctx, scope: Scope): HTMLElement {
  return h('div', { class: 'anim' }, head(ctx, scope), shotsColumn(ctx, scope), centerColumn(ctx, scope), rightColumn(ctx, scope));
}

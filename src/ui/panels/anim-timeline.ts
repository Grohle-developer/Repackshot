// The centre zone of the animation timeline (phase N6, UI.md §2.5): the ruler in seconds and frames with the
// playhead, and one lane per row of the tree: the camera track with its segments, a target's summary, a clip's bar.
// Bars move by dragging and stretch by their ends, drawn by the magnet of core/timeline.ts to the edges of the other
// bars, the playhead and the whole seconds (Shift: free, on frames). Generic over clip kinds: a bar is its times, its
// target and its sentence.

import { clipEnd, clipRepeat, shotTransition, type MotionClip } from '../../core/animation';
import { cameraSegments, dragBars, resizeBar, rulerTicks, snapTargets, snapTime, toFrame, type SnapOptions, type TimelineRow } from '../../core/timeline';
import * as anim from '../anim-commands';
import { newGesture } from '../components/controls';
import { openMenu, type MenuItems } from '../components/widgets';
import { cssZoom, h, icon } from '../dom';
import { cameraName } from '../names';
import type { Ctx } from '../reactive';
import { clipSentence, clipShort } from '../sentence';
import { L, formatNumber, getLang, t } from '../strings';
import { clickClip, clipMenu, type RowInfo } from './anim-tree';

/** How the lanes map time to pixels now. */
export interface Geometry {
  /** Pixels per second of the lanes (CSS pixels of the drawer). */
  pxPerS: number;
  /** Seconds the lanes show. */
  span: number;
  /** Width of the lanes, px. */
  width: number;
}

/** Pixels within which the magnet takes an edge. */
export const SNAP_PX = 6;

/** A drag in progress (bars, a shot's edge, the playhead). */
interface DragState {
  kind: 'move' | 'start' | 'end' | 'shot' | 'playhead';
  ids: string[];
  base: Record<string, Pick<MotionClip, 'id' | 'start' | 'duration' | 'repeat'>>;
  shot?: { id: string; start: number; duration: number };
  x0: number;
  t0: number;
  pxPerS: number;
  zoom: number;
  gesture: string;
  moved: boolean;
}

/**
 * The drags of the timeline. While one runs the lanes keep their scale (`frozen`), so a bar dragged past the end
 * does not slide away from the pointer; `onSnap` shows where the magnet took it.
 */
export class TimelineDrags {
  private drag: DragState | null = null;
  private frozenSpan: number | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly geometry: () => Geometry,
    private readonly onSnap: (t: number | null) => void,
    private readonly onEnd: () => void,
  ) {}

  get frozen(): number | null {
    return this.frozenSpan;
  }

  get active(): boolean {
    return this.drag !== null;
  }

  /** Ids of the bars being dragged (they keep their look across a rebuild). */
  dragging(): ReadonlySet<string> {
    return new Set(this.drag?.moved ? this.drag.ids : []);
  }

  private options(e: PointerEvent, moving: ReadonlySet<string>): SnapOptions {
    const s = this.ctx.store.get();
    return { targets: snapTargets(s, moving, s.animation.playhead), threshold: SNAP_PX / (this.drag?.pxPerS ?? 1), fps: s.animation.fps || 24, free: e.shiftKey };
  }

  begin(e: PointerEvent, kind: DragState['kind'], ids: string[], el: Element, shot?: DragState['shot']): void {
    if (e.button !== 0) return;
    const s = this.ctx.store.get();
    const g = this.geometry();
    const base: DragState['base'] = {};
    for (const c of s.animation.clips) if (ids.includes(c.id)) base[c.id] = { id: c.id, start: c.start, duration: c.duration, repeat: c.repeat };
    const lanes = el.closest('.anim-grid')?.querySelector('.tl-ruler') as HTMLElement | null;
    const zoom = cssZoom(el);
    const left = lanes ? lanes.getBoundingClientRect().left / zoom : 0;
    this.drag = { kind, ids, base, shot, x0: e.clientX / zoom, t0: kind === 'playhead' ? (e.clientX / zoom - left) / g.pxPerS : 0, pxPerS: g.pxPerS, zoom, gesture: newGesture('tl'), moved: kind === 'playhead' };
    this.frozenSpan = g.span;
    if (kind === 'playhead') anim.seek(this.ctx, toFrame(Math.max(0, this.drag.t0), s.animation.fps || 24));
    const move = (ev: PointerEvent) => this.move(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.drag = null;
      this.frozenSpan = null;
      this.onSnap(null);
      // The lanes may grow now that the drag is over.
      this.onEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX / d.zoom - d.x0;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    const dt = dx / d.pxPerS;
    const store = this.ctx.store;
    const fps = store.get().animation.fps || 24;
    if (d.kind === 'playhead') {
      anim.seek(this.ctx, toFrame(Math.max(0, d.t0 + dt), fps));
      return;
    }
    if (d.kind === 'shot' && d.shot) {
      const o = this.options(e, new Set());
      const end = snapTime(d.shot.start + d.shot.duration + dt, o);
      this.onSnap(end.hit);
      store.dispatch({ type: 'anim/setShot', id: d.shot.id, patch: { duration: Math.max(0.1, end.t - d.shot.start) }, gesture: d.gesture, label: L('undo.shotLength') });
      return;
    }
    const moving = new Set(d.ids);
    const o = this.options(e, moving);
    const bars = d.ids.map((id) => d.base[id]).filter(Boolean);
    if (d.kind === 'move') {
      const r = dragBars(bars, dt, o);
      this.onSnap(r.hit);
      const times: Record<string, { start: number }> = {};
      for (const [id, start] of Object.entries(r.starts)) times[id] = { start };
      store.dispatch({ type: 'anim/setClipTimes', times, gesture: d.gesture, label: L('undo.moveClips') });
      return;
    }
    const bar = bars[0];
    if (!bar || (d.kind !== 'start' && d.kind !== 'end')) return;
    const edge = d.kind === 'start' ? bar.start : clipEnd(bar);
    const r = resizeBar(bar, d.kind, edge + dt, o);
    this.onSnap(r.hit);
    store.dispatch({ type: 'anim/setClipTimes', times: { [bar.id]: { start: r.start, duration: r.duration } }, gesture: d.gesture, label: L('undo.resizeClip') });
  }
}

/** The ruler: seconds labelled, frames under them, ticks between; a press or a drag moves the playhead. */
export function rulerCell(ctx: Ctx, g: Geometry, drags: TimelineDrags): HTMLElement {
  const fps = ctx.store.get().animation.fps || 24;
  const { major, minor } = rulerTicks(g.span, g.pxPerS);
  const lang = getLang();
  const el = h(
    'div',
    // For the pointer only (its tip says how): the keyboard moves the playhead from the tree (Home, End, ← →), and the
    // transport says where it is. It sits inside the tree, which owns only its rows, so it is hidden from assistive
    // technology rather than a second control (H1, N1).
    { class: 'tl-ruler', 'aria-hidden': 'true', 'data-tip': t('anim.ruler'), 'data-px-per-s': String(g.pxPerS) },
    ...minor.map((s) => h('span', { class: 'tl-tick', style: `left:${s * g.pxPerS}px` })),
    ...major.map((s) =>
      h(
        'span',
        { class: 'tl-tick is-major', style: `left:${s * g.pxPerS}px` },
        h('span', { class: 'tl-tick-label' }, t('anim.seconds', { n: formatNumber(s, lang) })),
        h('span', { class: 'tl-tick-frame aux' }, String(Math.round(s * fps))),
      ),
    ),
  );
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drags.begin(e, 'playhead', [], el);
  });
  return el;
}

function barEl(ctx: Ctx, clip: MotionClip, g: Geometry, info: RowInfo, drags: TimelineDrags, compact = false): HTMLElement {
  const s = ctx.store.get();
  const lang = getLang();
  const n = clipRepeat(clip);
  const left = clip.start * g.pxPerS;
  const width = Math.max(6, clip.duration * n * g.pxPerS);
  const dragging = drags.dragging().has(clip.id);
  const bar = h(
    'div',
    {
      class: `tl-bar${compact ? ' is-compact' : ''}${info.selected.has(clip.id) ? ' is-selected' : ''}${info.related.has(clip.id) ? ' is-related' : ''}${info.conflicts.has(clip.id) ? ' is-conflict' : ''}${dragging ? ' is-dragging' : ''}${clip.reverse ? ' is-reversed' : ''}`,
      style: `left:${left}px;width:${width}px`,
      'data-clip': clip.id,
      'data-start': String(clip.start),
      'data-end': String(clipEnd(clip)),
      'data-tip': t('anim.barTip', { sentence: clipSentence(s, clip, lang) }) + (info.conflicts.has(clip.id) ? ` · ${t('anim.conflict')}` : ''),
    },
    h('span', { class: 'tl-grip is-start' }),
    compact ? null : h('span', { class: 'tl-bar-text' }, clipShort(clip, lang)),
    ...Array.from({ length: n - 1 }, (_, i) => h('span', { class: 'tl-rep', style: `left:${(i + 1) * clip.duration * g.pxPerS}px` })),
    h('span', { class: 'tl-grip is-end' }),
  );
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const sel = anim.selectedClipIds(ctx);
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || !sel.includes(clip.id)) clickClip(ctx, clip.id, e);
    else ctx.ui.set({ selectedClip: clip.id });
    // A Ctrl click that took the bar out of the selection does not drag the others.
    const now = anim.selectedClipIds(ctx);
    if (!now.includes(clip.id)) return;
    const kind = target.classList.contains('is-start') ? 'start' : target.classList.contains('is-end') ? 'end' : 'move';
    drags.begin(e, kind, kind === 'move' ? now : [clip.id], bar);
  });
  bar.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!anim.selectedClipIds(ctx).includes(clip.id)) anim.selectClips(ctx, [clip.id]);
    openMenu(bar, clipMenu(ctx, clip));
  });
  return bar;
}

function shotMenu(ctx: Ctx, shot: number): MenuItems {
  const s = ctx.store.get();
  const sh = s.animation.shots[shot];
  if (!sh) return [];
  return [
    { heading: t('anim.shotCamera') },
    { label: t('anim.activeCamera'), checked: sh.camera === null, run: () => ctx.store.dispatch({ type: 'anim/setShot', id: sh.id, patch: { camera: null }, label: L('undo.shotCamera') }) },
    ...Object.values(s.camera.cameras).map((c) => ({ label: cameraName(s, c), checked: sh.camera === c.id, run: () => ctx.store.dispatch({ type: 'anim/setShot', id: sh.id, patch: { camera: c.id }, label: L('undo.shotCamera') }) })),
    null,
    { label: t('anim.removeShot'), icon: 'trash' as const, run: () => ctx.store.dispatch({ type: 'anim/removeShot', id: sh.id, label: L('undo.removeShot') }) },
  ];
}

/** The camera track: one segment per shot (or the active camera all along), its right edge stretches it. */
function cameraLane(ctx: Ctx, g: Geometry, drags: TimelineDrags): HTMLElement[] {
  const s = ctx.store.get();
  const segs = cameraSegments(s);
  const selected = ctx.ui.get().selectedShot;
  const fades: HTMLElement[] = [];
  const out: HTMLElement[] = segs.map((seg) => {
    const cam = seg.camera ? s.camera.cameras[seg.camera] : undefined;
    const label = seg.shot === null ? t('anim.activeCamera') : t('anim.segment', { n: seg.shot + 1, camera: cam ? cameraName(s, cam) : t('anim.activeCamera') });
    const shotId = seg.shot === null ? null : s.animation.shots[seg.shot].id;
    // N1: how the track changes into this shot: a fade straddles the cut (into the first shot, it starts at 0).
    const tr = seg.shot === null ? null : shotTransition(s.animation.shots[seg.shot]);
    const fade = tr && tr.kind === 'FADE' ? tr : null;
    const fadeTip = fade ? `${t(fade.color === 'WHITE' ? 'anim.change.WHITE' : 'anim.change.BLACK')} · ${formatNumber(fade.duration, getLang())} s` : '';
    const el = h(
      'div',
      { class: `tl-seg${seg.shot === null ? ' is-whole' : ''}${shotId && shotId === selected ? ' is-selected' : ''}`, style: `left:${seg.start * g.pxPerS}px;width:${Math.max(4, (seg.shot === null ? g.span : seg.end - seg.start) * g.pxPerS)}px`, 'data-shot': seg.shot === null ? '' : String(seg.shot), 'data-tip': seg.shot === null ? label : `${label}${fade ? ` · ${fadeTip}` : ''} · ${t('anim.segmentTip')}` },
      h('span', { class: 'tl-seg-text' }, label),
      seg.shot === null ? null : h('span', { class: 'tl-grip is-end' }),
    );
    if (fade) {
      // Drawn over the cut in the lane (half on each shot), not inside the segment, which clips.
      const start = seg.shot === 0 ? 0 : seg.start - fade.duration / 2;
      fades.push(h('span', { class: `tl-fade is-${fade.color === 'WHITE' ? 'white' : 'black'}${seg.shot === 0 ? ' is-in' : ''}`, 'data-fade': fade.color, 'aria-hidden': 'true', style: `left:${start * g.pxPerS}px;width:${Math.max(4, fade.duration * g.pxPerS)}px` }));
    }
    if (seg.shot !== null) {
      const shot = s.animation.shots[seg.shot];
      // N1: a click shows the shot's properties (its camera, length and change of camera).
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('tl-grip')) return;
        anim.selectShot(ctx, shot.id);
      });
      el.querySelector('.tl-grip')!.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        drags.begin(e as PointerEvent, 'shot', [], el, { id: shot.id, start: seg.start, duration: shot.duration });
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openMenu(el, shotMenu(ctx, seg.shot!));
      });
    }
    return el;
  });
  const end = segs[segs.length - 1];
  const add = h(
    'button',
    {
      type: 'button',
      class: 'icon-btn sm tl-seg-add',
      style: `left:${(end.shot === null ? 0 : end.end) * g.pxPerS + 4}px`,
      'aria-label': t('anim.addShot'),
      'data-tip': t('anim.addShot'),
      onclick: () => ctx.store.dispatch({ type: 'anim/addShot', duration: 3, label: L('undo.addShot') }),
    },
    icon('plus', 12),
  );
  if (end.shot === null) add.style.left = `${Math.max(4, g.width - 26)}px`;
  out.push(...fades, add);
  return out;
}

/** The lane of a row: the camera track, a target's bars (folded) or span, a clip's bar. */
export function laneCell(ctx: Ctx, row: TimelineRow, g: Geometry, info: RowInfo, drags: TimelineDrags): HTMLElement {
  const s = ctx.store.get();
  if (row.kind === 'CLIP') {
    const clip = s.animation.clips.find((c) => c.id === row.clip);
    return h('div', { class: 'tl-lane is-clip', 'data-clip-lane': row.clip }, clip ? barEl(ctx, clip, g, info, drags) : null);
  }
  const el = h('div', { class: 'tl-lane is-target', 'data-target-lane': row.key });
  if (row.target.kind === 'CAMERA') {
    el.classList.add('is-camera');
    el.append(...cameraLane(ctx, g, drags));
    return el;
  }
  const clips = s.animation.clips.filter((c) => row.clips.includes(c.id));
  if (clips.length === 0) return el;
  if (row.folded) {
    el.append(...clips.map((c) => barEl(ctx, c, g, info, drags, true)));
  } else {
    const a = Math.min(...clips.map((c) => c.start));
    const b = Math.max(...clips.map((c) => clipEnd(c)));
    el.append(h('div', { class: 'tl-span', style: `left:${a * g.pxPerS}px;width:${Math.max(2, (b - a) * g.pxPerS)}px` }));
  }
  return el;
}

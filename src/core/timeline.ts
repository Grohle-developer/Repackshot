// The arithmetic of the animation timeline (phase N6, UI.md §2.5): its rows (one per animated target, its clips
// nested), the ruler's ticks, the camera track's segments and the magnet that draws a dragged bar to the edges of the
// others, the playhead and the whole seconds. Pure: the interface draws what this says, the tests check the numbers.
// Generic over clip kinds: rows and bars read the target and the times of a clip, never its kind.

import { clipEnd, shotStarts, totalDuration, type ClipTarget, type MotionClip } from './animation';
import { treeOrder } from './scene';
import type { ProjectState } from './store';

/** The key of a target: one row of the tree per key. */
export function targetKey(t: ClipTarget): string {
  return t.kind === 'NODE' || t.kind === 'LIGHT' ? `${t.kind}:${t.id}` : t.kind;
}

/** One row of the timeline: a target (the camera track among them) or one of its clips. */
export type TimelineRow =
  | { kind: 'TARGET'; key: string; target: ClipTarget; clips: string[]; folded: boolean }
  | { kind: 'CLIP'; key: string; clip: string; parent: string };

/**
 * The rows, in a fixed order: the camera track first (always: its segments say which camera is seen), then the model,
 * its groups and parts in tree order, the lights in the rig's order, the environment, and any other target last.
 * A folded target hides its clips (its row shows their bars).
 */
export function timelineRows(state: ProjectState, folded: Readonly<Record<string, true>> = {}): TimelineRow[] {
  const groups = new Map<string, { target: ClipTarget; clips: string[] }>();
  groups.set('CAMERA', { target: { kind: 'CAMERA' }, clips: [] });
  for (const c of state.animation.clips) {
    const k = targetKey(c.target);
    if (!groups.has(k)) groups.set(k, { target: c.target, clips: [] });
    groups.get(k)!.clips.push(c.id);
  }
  const tree = treeOrder(state);
  const lights = state.studio.lights.map((l) => l.id);
  const rank = (t: ClipTarget): [number, number] => {
    switch (t.kind) {
      case 'CAMERA':
        return [0, 0];
      case 'SUBJECT':
        return [1, 0];
      case 'NODE': {
        const i = tree.indexOf(t.id);
        return [2, i < 0 ? tree.length : i];
      }
      case 'LIGHT': {
        const i = lights.indexOf(t.id);
        return [3, i < 0 ? lights.length : i];
      }
      case 'SCENE':
        return [4, 0];
      default:
        return [5, 0];
    }
  };
  const entries = [...groups.entries()].map(([key, g], i) => ({ key, g, r: rank(g.target), i }));
  entries.sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i);
  const rows: TimelineRow[] = [];
  for (const { key, g } of entries) {
    const isFolded = folded[key] === true;
    rows.push({ kind: 'TARGET', key, target: g.target, clips: g.clips, folded: isFolded });
    if (!isFolded) for (const id of g.clips) rows.push({ kind: 'CLIP', key: `clip:${id}`, clip: id, parent: key });
  }
  return rows;
}

/** One segment of the camera track: a shot (index into `animation.shots`), or the whole timeline without shots. */
export interface CameraSegment {
  shot: number | null;
  start: number;
  end: number;
  /** The camera seen (null: the active one). */
  camera: string | null;
}

export function cameraSegments(state: ProjectState): CameraSegment[] {
  const shots = state.animation.shots;
  if (shots.length === 0) return [{ shot: null, start: 0, end: Math.max(totalDuration(state), 0), camera: null }];
  const starts = shotStarts(state);
  return shots.map((s, i) => ({ shot: i, start: starts[i], end: starts[i] + s.duration, camera: s.camera }));
}

/** How long the timeline shows: the sequence and a little room after it (never less than 4 s). */
export function timelineSpan(state: ProjectState): number {
  const total = totalDuration(state);
  return Math.max(4, Math.ceil((total + Math.max(1, total * 0.15)) * 2) / 2);
}

/** The ruler's ticks: labelled ones at least `minLabelPx` apart, in whole steps of a round number of seconds. */
export function rulerTicks(span: number, pxPerS: number, minLabelPx = 56): { major: number[]; minor: number[]; step: number } {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((s) => s * pxPerS >= minLabelPx) ?? steps[steps.length - 1];
  const sub = step >= 1 ? (step % 5 === 0 ? step / 5 : step / 2) : step / 2;
  const major: number[] = [];
  const minor: number[] = [];
  const n = Math.floor(span / step + 1e-9);
  for (let i = 0; i <= n; i++) major.push(Math.round(i * step * 1000) / 1000);
  const m = Math.floor(span / sub + 1e-9);
  for (let i = 0; i <= m; i++) {
    const v = Math.round(i * sub * 1000) / 1000;
    if (!major.some((x) => Math.abs(x - v) < 1e-9)) minor.push(v);
  }
  return { major, minor, step };
}

// --- The magnet -------------------------------------------------------------------------------

export interface SnapOptions {
  /** Times the edges are drawn to (see `snapTargets`). */
  targets: readonly number[];
  /** How near counts, seconds (the interface turns its pixels into seconds). */
  threshold: number;
  /** Without a magnet hit, times land on whole frames. */
  fps: number;
  /** Shift held: no magnet, only frames. */
  free?: boolean;
}

/** A time on the nearest whole frame. */
export function toFrame(t: number, fps: number): number {
  return fps > 0 ? Math.round(t * fps) / fps : t;
}

/** A time drawn to the nearest target within the threshold; otherwise on its frame. `hit` is the target it took. */
export function snapTime(t: number, o: SnapOptions): { t: number; hit: number | null } {
  if (!o.free) {
    let best: number | null = null;
    for (const x of o.targets) if (Math.abs(x - t) <= o.threshold && (best === null || Math.abs(x - t) < Math.abs(best - t))) best = x;
    if (best !== null) return { t: best, hit: best };
  }
  return { t: toFrame(t, o.fps), hit: null };
}

/** What a dragged bar is drawn to: the edges of the bars that are not moving, the playhead and every whole second. */
export function snapTargets(state: ProjectState, moving: ReadonlySet<string>, playhead: number): number[] {
  const out = new Set<number>([0, playhead]);
  for (const c of state.animation.clips) {
    if (moving.has(c.id)) continue;
    out.add(c.start);
    out.add(clipEnd(c));
  }
  for (const s of shotStarts(state)) out.add(s);
  const span = timelineSpan(state);
  for (let s = 0; s <= span; s++) out.add(s);
  return [...out].sort((a, b) => a - b);
}

type Timed = Pick<MotionClip, 'id' | 'start' | 'duration' | 'repeat'>;

/**
 * New starts of bars dragged together by `dt` seconds: the edge of any of them (start or end) nearest to a target
 * within the threshold takes the group there; otherwise the first bar's start lands on a frame. None goes before 0.
 */
export function dragBars(bars: readonly Timed[], dt: number, o: SnapOptions): { starts: Record<string, number>; hit: number | null } {
  if (bars.length === 0) return { starts: {}, hit: null };
  const first = Math.min(...bars.map((b) => b.start));
  let shift = Math.max(-first, dt);
  let hit: number | null = null;
  if (!o.free) {
    let best: { d: number; to: number; shift: number } | null = null;
    for (const b of bars) {
      for (const edge of [b.start, clipEnd(b)]) {
        const at = edge + shift;
        for (const x of o.targets) {
          const d = x - at;
          // The shift that puts this edge exactly on the target (not shift + d: no rounding on the way).
          if (Math.abs(d) <= o.threshold && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, to: x, shift: x - edge };
        }
      }
    }
    if (best && first + best.shift >= -1e-9) {
      shift = best.shift;
      hit = best.to;
    }
  }
  if (hit === null) shift = toFrame(first + shift, o.fps) - first;
  shift = Math.max(-first, shift);
  const starts: Record<string, number> = {};
  for (const b of bars) starts[b.id] = Math.max(0, b.start + shift);
  return { starts, hit };
}

/** Shortest a bar can be stretched to, seconds (one repeat). */
export const MIN_BAR = 0.05;

/**
 * A bar stretched by one end to time t: the other end stays, the dragged one is drawn to the targets (or a frame).
 * With repeats the duration is one repeat: the bar's length divided by them.
 */
export function resizeBar(bar: Timed, edge: 'start' | 'end', t: number, o: SnapOptions): { start: number; duration: number; hit: number | null } {
  const n = Math.max(1, Math.floor(bar.repeat ?? 1));
  const end = clipEnd(bar);
  const s = snapTime(t, o);
  if (edge === 'end') {
    const e = Math.max(bar.start + MIN_BAR * n, s.t);
    return { start: bar.start, duration: (e - bar.start) / n, hit: e === s.t ? s.hit : null };
  }
  const st = Math.max(0, Math.min(end - MIN_BAR * n, s.t));
  return { start: st, duration: (end - st) / n, hit: st === s.t ? s.hit : null };
}

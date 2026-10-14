// What the viewport draws for the selected animation (phase N6, UI.md §2.5): its target outlined and its track as
// lines in model space (Z up), the way a storyboard sketches a move: the arc of an orbit, the arrow of a move, a vector
// per part of an explode, the axis and the turn of a spin. Pure; the preview turns it into lines (render/preview.ts).
// A kind it does not know (a physics clip) gets its target outlined and no track.

import { activeCamera } from './camera';
import { clipCurve, clipPhase, clipProgress, clipTargetParts, type MotionClip } from './animation';
import { explodeMovers, moverPhase } from './explode';
import { add, boxCenter, boxMaxDim, cross, isEmptyBox, length, normalize, scale, sub, transformDirection, type Vec3 } from './math';
import { boundsOf, worldMatrix, type NodeId } from './scene';
import type { ProjectState } from './store';

export interface MotionHint {
  /** Parts outlined: the targets of the selected clips. */
  highlight: NodeId[];
  /** Line segments of the primary clip's track, model space, two points each. */
  lines: Vec3[];
  /** Where what the clip moves is at the playhead. */
  dots: Vec3[];
}

/** An arrowhead at `to` for a line coming from `from`: two short strokes. */
function arrowhead(from: Vec3, to: Vec3, size: number, out: Vec3[]): void {
  const d = sub(to, from);
  const len = length(d);
  if (len < 1e-9) return;
  const u = scale(d, 1 / len);
  const side = normalize(cross(u, Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const back = sub(to, scale(u, Math.min(size, len * 0.4)));
  const w = Math.min(size, len * 0.4) * 0.5;
  out.push(to, add(back, scale(side, w)), to, sub(back, scale(side, w)));
}

/** An arc about `axis` through `centre`, from the vector `start` (relative to the centre), turning `deg` degrees. */
function arc(centre: Vec3, axis: Vec3, start: Vec3, deg: number, out: Vec3[]): Vec3 {
  const steps = Math.max(8, Math.min(96, Math.ceil(Math.abs(deg) / 5)));
  const a = normalize(axis);
  const rot = (v: Vec3, rad: number): Vec3 => {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const k = cross(a, v);
    const d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
    return [v[0] * c + k[0] * s + a[0] * d * (1 - c), v[1] * c + k[1] * s + a[1] * d * (1 - c), v[2] * c + k[2] * s + a[2] * d * (1 - c)];
  };
  let prev = add(centre, start);
  for (let i = 1; i <= steps; i++) {
    const p = add(centre, rot(start, ((deg * i) / steps) * (Math.PI / 180)));
    out.push(prev, p);
    prev = p;
  }
  return prev;
}

function trackOf(state: ProjectState, clip: MotionClip, t: number, lines: Vec3[], dots: Vec3[]): void {
  const size = state.scene.partSizeMm || 200;
  const head = size * 0.06;
  const tg = clip.target;
  if (clip.move === 'EXPLODE' && (tg.kind === 'SUBJECT' || tg.kind === 'NODE')) {
    const x = clipPhase(clip, t);
    for (const m of explodeMovers(state, { node: tg.kind === 'NODE' ? tg.id : null, amount: clip.amount, explode: clip.explode })) {
      if (length(m.delta) < 1e-6) continue;
      const from = m.ref;
      const to = add(m.ref, clip.reverse ? [0, 0, 0] : m.delta);
      const start = clip.reverse ? add(m.ref, m.delta) : from;
      lines.push(start, to);
      arrowhead(start, to, head, lines);
      dots.push(add(m.ref, scale(m.delta, clipCurve(clip, moverPhase(m, x)))));
    }
    return;
  }
  if (tg.kind === 'CAMERA') {
    const cam = activeCamera(state);
    const e = clipProgress(clip, t);
    if (clip.move === 'ORBIT') {
      // A ring on the target's level, the angle the camera sweeps: a compass around the product.
      const r = size * 0.75;
      const rad = (cam.azimuth * Math.PI) / 180;
      const start: Vec3 = [Math.cos(rad) * r, Math.sin(rad) * r, 0];
      const end = arc(cam.target, [0, 0, 1], start, clip.amount, lines);
      arrowhead(lines[lines.length - 2] ?? end, end, head, lines);
      const now = ((cam.azimuth + clip.amount * e) * Math.PI) / 180;
      dots.push(add(cam.target, [Math.cos(now) * r, Math.sin(now) * r, 0]));
    } else if (clip.move === 'RISE') {
      const r = size * 0.75;
      const az = (cam.azimuth * Math.PI) / 180;
      const el = (cam.elevation * Math.PI) / 180;
      const dir: Vec3 = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
      const axis = normalize(cross(dir, [0, 0, 1]));
      const end = arc(cam.target, axis, scale(dir, r), -clip.amount, lines);
      arrowhead(lines[lines.length - 2] ?? end, end, head, lines);
    }
    return;
  }
  if (tg.kind !== 'SUBJECT' && tg.kind !== 'NODE') return;
  const ids = tg.kind === 'NODE' ? [tg.id] : state.scene.roots;
  const b = boundsOf(state, ids);
  if (isEmptyBox(b)) return;
  const c = boxCenter(b);
  const e = clipProgress(clip, t);
  if (clip.move === 'MOVE') {
    const v = clip.vector ?? [0, 0, clip.amount];
    const to = add(c, scale(v, size));
    lines.push(c, to);
    arrowhead(c, to, head, lines);
    dots.push(add(c, scale(v, size * e)));
  } else if (clip.move === 'SPIN' || clip.move === 'TUMBLE') {
    // The node's own axis (Z for a spin, X for a tumble) through its centre, and the turn around it.
    const node = tg.kind === 'NODE' ? tg.id : state.scene.roots[0];
    const w = node ? worldMatrix(state, node) : null;
    const axis = normalize(w ? transformDirection(w, clip.move === 'SPIN' ? [0, 0, 1] : [1, 0, 0]) : [0, 0, 1]);
    const half = boxMaxDim(b) * 0.65;
    lines.push(sub(c, scale(axis, half)), add(c, scale(axis, half)));
    const ref = normalize(cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const r = boxMaxDim(b) * 0.55;
    const deg = Math.max(-359, Math.min(359, clip.amount));
    const end = arc(c, axis, scale(ref, r), deg, lines);
    arrowhead(lines[lines.length - 2] ?? end, end, head, lines);
  }
}

/**
 * The hint for the selected clips: every one's target outlined, the primary's track drawn; null when nothing is
 * selected (or what is selected is gone).
 */
export function motionHint(state: ProjectState, clipIds: readonly string[], primary: string | null, t: number): MotionHint | null {
  const clips = state.animation.clips.filter((c) => clipIds.includes(c.id) || c.id === primary);
  if (clips.length === 0) return null;
  const highlight = new Set<NodeId>();
  for (const c of clips) for (const p of clipTargetParts(state, c)) highlight.add(p);
  const lines: Vec3[] = [];
  const dots: Vec3[] = [];
  const main = clips.find((c) => c.id === primary) ?? clips[clips.length - 1];
  trackOf(state, main, t, lines, dots);
  return { highlight: [...highlight], lines, dots };
}

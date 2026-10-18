// Animation: shots (the cuts), motion clips (what moves, when and how much)
// and their evaluation in time with the analytic easing curves (SPEC §3.7).

import { sequencePreset } from '../data/animation';
import type { EasingKind, MoveKind, RGB } from '../data/types';
import { ease, polar } from './light-math';
import type { ActionBase, ProjectState } from './store';
import { activeCamera, cameraBasis, type CameraId } from './camera';
import { bezierEase, DEFAULT_CURVE, normaliseCurve } from './curve';
import { explodeMovers, explodeParts, moverPhase, resolveExplode, tiltAxis, EXPLODE_TILT_DEG, type ExplodeParams } from './explode';
import { nextId, nextIds } from './ids';
import type { MaterialId, MaterialInstance } from './materials';
import { add, boxCenter, clamp, cross, dot, isEmptyBox, lerp, mat4Compose, mat4Identity, mat4Invert, mat4Multiply, normalize, scale, sub, type Mat4, type Vec3 } from './math';
import { allParts, boundsOf, partsUnder, worldMatrix, worldToLocalDelta, type NodeId } from './scene';
import { decomposeMatrix } from './transform';
import { trackPose, type PhysicsTrack } from './physics';
import { glassFrameIndex, type GlassTrack } from './wet';
import { partsFrameIndex, type PartsTrack } from './wet-parts';

/**
 * How the camera track changes into a shot (N1, SPEC §3.7 "Fades"): a cut, or a fade to a colour (black or white)
 * of `duration` seconds centred on the cut: the image goes to the colour over the first half, the camera changes under
 * it, and the image comes back over the second half. Into the first shot, a fade from the colour at the start. A
 * cross-fade (two cameras at once) is a later phase.
 */
export interface ShotTransition {
  kind: 'CUT' | 'FADE';
  color: 'BLACK' | 'WHITE';
  /** Seconds, the whole fade (down and up). */
  duration: number;
}

/** The fade a new FADE change has: half a second to black. */
export const DEFAULT_FADE: Readonly<ShotTransition> = Object.freeze({ kind: 'FADE', color: 'BLACK', duration: 0.5 });
/** The shortest and the longest fade of a change of camera, seconds. */
export const MIN_FADE = 0.04;
export const MAX_FADE = 10;

/** One shot: how long it lasts and which camera is seen (null = the active camera). */
export interface Shot {
  id: string;
  duration: number;
  camera: CameraId | null;
  /** N1: how the camera track changes into this shot; absent, a cut (as every shot before N1). */
  transition?: ShotTransition;
}

/** What a clip moves. */
export type ClipTarget =
  | { kind: 'CAMERA' }
  | { kind: 'SUBJECT' }
  | { kind: 'NODE'; id: NodeId }
  | { kind: 'LIGHT'; id: string }
  | { kind: 'SCENE' }
  /** N1: a material, and with it every part that wears it (its colour, its opacity). */
  | { kind: 'MATERIAL'; id: MaterialId };

/**
 * N1: what a rotation (SPIN, TUMBLE) of a part or a group turns about: the centre of another part or group (a lid
 * about its hinge part), or a point of the world, in mm. Absent: the node's own origin, as before N1.
 */
export type ClipPivot = { kind: 'NODE'; id: NodeId } | { kind: 'POINT'; point: Vec3 };

export type ClipTargetKind = ClipTarget['kind'];

/** One movement (SPEC §3.7): target, kind, timing, amount and easing. */
export interface MotionClip {
  id: string;
  target: ClipTarget;
  move: MoveKind;
  /** For camera clips: the shot whose camera it moves (null = every shot). */
  shot: number | null;
  /** Seconds from the start of the sequence. */
  start: number;
  /** Seconds. */
  duration: number;
  /** Degrees, percent, factor, mm, W... see MoveItem.amountLabel and `amountUnit`. */
  amount: number;
  easing: EasingKind;
  /** TRACK / MOVE: displacement in part sizes (x right, y depth, z up). */
  vector?: Vec3;
  /** TINT: target colour, linear RGB. */
  color?: RGB;
  /** Plays backwards (SPEC §3.7): it holds its end state before it starts; an explode reversed assembles. */
  reverse?: boolean;
  /** Plays this many times in a row (a whole number, 1 when absent): the bar lasts `duration` × `repeat`. */
  repeat?: number;
  /**
   * One knob over the symmetric curves of EASING_KINDS, 0..1: 0 linear, 0.5 smooth (EASE), 1 very smooth (EASE_STRONG),
   * blended in between. Absent: `easing` alone (the knob writes the nearest kind there too).
   */
  smoothness?: number;
  /** EXPLODE: how the parts come apart (core/explode.ts). Absent: the explode of before N6. */
  explode?: ExplodeParams;
  /** N1, easing CUSTOM: the two handles of the curve, x1, y1, x2, y2 (core/curve.ts); absent, DEFAULT_CURVE. */
  curve?: [number, number, number, number];
  /** N1, SPIN and TUMBLE of a part or a group: what it turns about (absent: its own origin). */
  pivot?: ClipPivot;
  /**
   * PHYSICS (phase S2): the recorded simulation, the node's local position and rotation per frame (core/physics.ts).
   * The clip plays it over its duration (stretching it slows it down); before its start and after its end the node
   * holds the first and the last frame.
   */
  track?: PhysicsTrack;
  /**
   * PHYSICS: the node's position and rotation the recording is relative to (the node's own when the run began, then
   * where the run left it). The clip plays the recorded frames carried by however the node has been moved since, so
   * a part moved after a Drop takes its whole fall with it. Without it, the frames as they are.
   */
  anchor?: ClipAnchor;
  /**
   * PHYSICS of the camera (S3b): the recorded front glass of a run fed by the scene's rain and dust (core/wet.ts), its
   * drops and motes per frame. The clip moves nothing; it says which frame of the glass the camera shows.
   */
  glass?: GlassTrack;
  /**
   * PHYSICS of the scene (S3c): the recorded rain, dust and snow on the parts of a run (core/wet-parts.ts): the drops
   * and the samples of every frame. The clip moves nothing; it says which frame the parts show.
   */
  parts?: PartsTrack;
}

/** A node's position (mm) and rotation (degrees, XYZ) without its scale. */
export interface ClipAnchor {
  position: Vec3;
  rotation: Vec3;
}

/** Moves offered for each kind of target, in wizard order (N1 appended PAN, FADE, SUN_ARC and the materials). */
export const TARGET_MOVES: Readonly<Record<ClipTargetKind, readonly MoveKind[]>> = {
  CAMERA: ['ORBIT', 'RISE', 'DOLLY', 'TRACK', 'ZOOM', 'FOCUS', 'PAN'],
  SUBJECT: ['SPIN', 'TUMBLE', 'MOVE', 'SCALE', 'EXPLODE', 'VISIBILITY', 'FADE'],
  // EXPLODE on a node: a model or a group (the interface offers it only for those).
  NODE: ['SPIN', 'TUMBLE', 'MOVE', 'SCALE', 'EXPLODE', 'VISIBILITY', 'FADE'],
  LIGHT: ['INTENSITY', 'TINT', 'ORBIT', 'RISE', 'VISIBILITY'],
  SCENE: ['HDRI', 'SECTION', 'SUN_ARC'],
  MATERIAL: ['MATERIAL_COLOR', 'FADE'],
};

/** What a clip's amount is measured in, for the sentence and the field unit. */
export function amountUnit(move: MoveKind): 'deg' | 'pct' | 'factor' | 'mm' | 'm' | 'W' | 'parts' | 'none' {
  switch (move) {
    case 'ORBIT':
    case 'RISE':
    case 'SPIN':
    case 'TUMBLE':
    case 'HDRI':
    case 'PAN':
    case 'SUN_ARC':
      return 'deg';
    case 'DOLLY':
    case 'FADE':
      return 'pct';
    case 'SCALE':
      return 'factor';
    case 'ZOOM':
      return 'mm';
    case 'FOCUS':
      return 'm';
    case 'INTENSITY':
      return 'W';
    case 'EXPLODE':
    case 'TRACK':
    case 'MOVE':
    case 'SECTION':
      return 'parts';
    default:
      return 'none';
  }
}

/** Amount a new clip starts with. */
export function defaultAmount(move: MoveKind): number {
  const table: Partial<Record<MoveKind, number>> = {
    ORBIT: 90,
    RISE: 15,
    DOLLY: 30,
    TRACK: 0.5,
    MOVE: 0.5,
    SPIN: 360,
    TUMBLE: 90,
    SCALE: 1.25,
    ZOOM: 135,
    FOCUS: 0.3,
    INTENSITY: 120,
    HDRI: 90,
    EXPLODE: 1.5,
    VISIBILITY: 0,
    // Q1: along the normal, towards the removed side: negative moves the plane into what is kept (cuts more).
    SECTION: -0.5,
    // N1: a fade ends invisible (reversed, it fades in); a pan turns a little; the sun goes six hours of its arc.
    FADE: 0,
    PAN: 30,
    SUN_ARC: 90,
    PATH: 0,
  };
  return table[move] ?? 1;
}

/** How many times a clip plays (a whole number, at least 1). */
export function clipRepeat(clip: Pick<MotionClip, 'repeat'>): number {
  const n = clip.repeat;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.min(100, Math.floor(n)) : 1;
}

/** When a clip ends, seconds: its start plus its duration times its repeats. */
export function clipEnd(clip: Pick<MotionClip, 'start' | 'duration' | 'repeat'>): number {
  return clip.start + clip.duration * clipRepeat(clip);
}

/** Total length of the sequence: the shots, or the last clip if it runs longer. */
export function totalDuration(state: ProjectState): number {
  const shots = state.animation.shots.reduce((a, s) => a + Math.max(0, s.duration), 0);
  const clips = state.animation.clips.reduce((a, c) => Math.max(a, clipEnd(c)), 0);
  return Math.max(shots, clips);
}

/** Index of the shot playing at `t` (the last one after the end, -1 without shots). */
export function shotIndexAt(state: ProjectState, t: number): number {
  const shots = state.animation.shots;
  if (shots.length === 0) return -1;
  let acc = 0;
  for (let i = 0; i < shots.length; i++) {
    acc += shots[i].duration;
    if (t < acc) return i;
  }
  return shots.length - 1;
}

/** Start time of each shot, seconds. */
export function shotStarts(state: ProjectState): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of state.animation.shots) {
    out.push(acc);
    acc += s.duration;
  }
  return out;
}

/**
 * The linear phase of a clip at time t, 0..1, before its curve: 0 before it starts, 1 after it ends, the repeats
 * one after another, mirrored when the clip is reversed.
 */
export function clipPhase(clip: Pick<MotionClip, 'start' | 'duration' | 'repeat' | 'reverse'>, t: number): number {
  let x: number;
  if (clip.duration <= 0) x = t >= clip.start ? 1 : 0;
  else {
    const u = (t - clip.start) / clip.duration;
    const n = clipRepeat(clip);
    x = u <= 0 ? 0 : u >= n ? 1 : u - Math.floor(u);
  }
  return clip.reverse ? 1 - x : x;
}

/** The symmetric curves the smoothness knob moves between: linear, smooth, very smooth. */
export function smoothEase(x: number, smoothness: number): number {
  const k = Number.isFinite(smoothness) ? clamp(smoothness, 0, 1) : 0;
  const lin = ease(x, 'LINEAR');
  const mid = ease(x, 'EASE');
  if (k <= 0.5) return lin + (mid - lin) * (k / 0.5);
  return mid + (ease(x, 'EASE_STRONG') - mid) * ((k - 0.5) / 0.5);
}

/** The easing kind nearest to a smoothness (what the knob writes in `easing`). */
export function easingForSmoothness(smoothness: number): EasingKind {
  return smoothness < 0.25 ? 'LINEAR' : smoothness < 0.75 ? 'EASE' : 'EASE_STRONG';
}

/** A clip's curve at phase x: its smoothness when it has one, otherwise its easing (CUSTOM: its two handles, N1). */
export function clipCurve(clip: Pick<MotionClip, 'easing' | 'smoothness' | 'curve'>, x: number): number {
  if (clip.smoothness !== undefined) return smoothEase(x, clip.smoothness);
  if (clip.easing === 'CUSTOM') return bezierEase(x, clip.curve ?? DEFAULT_CURVE);
  return ease(x, clip.easing);
}

/** Eased progress of a clip at time t, 0..1. */
export function clipProgress(clip: MotionClip, t: number): number {
  return clipCurve(clip, clipPhase(clip, t));
}

/**
 * Whether the scene shows the pose of the playhead rather than the scene at rest: clips play, the playhead moved, or
 * a reversed clip holds its end state from the start.
 */
export function poseActive(state: ProjectState): boolean {
  const a = state.animation;
  return a.clips.length > 0 && (a.playing || a.playhead > 0 || a.clips.some((c) => c.reverse === true));
}

/** The animated camera at an instant. */
export interface CameraPose {
  camera: CameraId;
  azimuth: number;
  elevation: number;
  distance: number;
  target: Vec3;
  focalMm: number;
  focusDistance: number;
}

/** The animated local transform of a node. */
export interface NodePose {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  /** N1: what the FADE clips on this node leave of its opacity, 0..1 (absent: 1). Its parts multiply their ancestors'. */
  opacity?: number;
}

/** N1: a material as the animation leaves it: its colour (MATERIAL_COLOR; absent, its own) and opacity (FADE), 0..1. */
export interface MaterialPose {
  color?: RGB;
  opacity: number;
}

/** N1: the camera track's fade to a colour at an instant: how much of the image is the colour, 0..1. */
export interface FadeToColor {
  color: RGB;
  amount: number;
}

export interface LightPose {
  power: number;
  color: RGB;
  az: number;
  el: number;
  enabled: boolean;
}

/** Everything the animation changes at an instant, on top of the state. */
export interface Pose {
  t: number;
  shot: number;
  camera: CameraPose | null;
  nodes: Record<NodeId, NodePose>;
  lights: Record<string, LightPose>;
  envRotationDeg: number;
  /** Q1: how far the SECTION clips have moved the cutting plane along its normal, mm (0 without clips). */
  sectionOffsetMm: number;
  /** N1: the materials the clips change (MATERIAL_COLOR, FADE on a material), by id. */
  materials: Record<MaterialId, MaterialPose>;
  /** N1: the camera track's fade to a colour at this instant (a change of shot with a fade), or null. */
  fade: FadeToColor | null;
  /** N1: where SUN_ARC has put the sky's own sun (when the rig has no sun light), or null: where the environment says. */
  skySun: { az: number; el: number } | null;
  /**
   * S3b: the frame of each camera's recorded front glass at this instant (the PHYSICS clips of the cameras, by camera:
   * the clip and the frame), absent without one. The last clip of a camera wins.
   */
  glass?: Record<CameraId, GlassPose>;
  /** S3c: the frame of the recorded rain, dust and snow on the parts at this instant (the last such clip wins). */
  parts?: GlassPose;
}

/** S3b: which frame of which recorded glass a camera shows. */
export interface GlassPose {
  clip: string;
  frame: number;
}

function targetKey(t: ClipTarget): string {
  return t.kind === 'NODE' || t.kind === 'LIGHT' || t.kind === 'MATERIAL' ? `${t.kind}:${t.id}` : t.kind;
}

/**
 * The pose the viewport and a still render show: the playhead's whenever `poseActive` says so; otherwise (at 0, not
 * playing, nothing reversed) the scene as edited, except the nodes a recorded simulation (a PHYSICS clip) holds,
 * which show its frame there too (a Drop at 0 starts its clip at 0, so the scene as edited is already where the run
 * ended). Null when nothing is posed.
 */
export function playheadPose(state: ProjectState): Pose | null {
  const anim = state.animation;
  if (anim.clips.length === 0) return null;
  if (poseActive(state)) return evaluate(state, anim.playhead);
  const held = new Set(anim.clips.filter((c) => c.move === 'PHYSICS' && c.target.kind === 'NODE').map((c) => (c.target.kind === 'NODE' ? c.target.id : '')));
  // S3b: a recorded front glass shows its frame at 0 too, like the nodes a recorded simulation holds. S3c: and the
  // recorded rain, dust and snow on the parts.
  const glass = anim.clips.some((c) => c.move === 'PHYSICS' && c.glass);
  const parts = anim.clips.some((c) => c.move === 'PHYSICS' && c.parts);
  if (held.size === 0 && !glass && !parts) return null;
  const pose = evaluate(state, anim.playhead);
  const out: Pose = { ...pose, camera: null, lights: {}, envRotationDeg: state.environment.rotationDeg, sectionOffsetMm: 0, materials: {}, fade: null, skySun: null, nodes: Object.fromEntries(Object.entries(pose.nodes).filter(([id]) => held.has(id))) };
  if (!glass) delete out.glass;
  if (!parts) delete out.parts;
  return out;
}

/** N1: the colour of a fade of the camera track, linear RGB. */
export function fadeColor(color: ShotTransition['color']): RGB {
  return color === 'WHITE' ? [1, 1, 1] : [0, 0, 0];
}

/** N1: a shot's change as this version reads it (a damaged or absent one is a cut). */
export function shotTransition(shot: Pick<Shot, 'transition'>): ShotTransition {
  const tr = shot.transition;
  if (!tr || tr.kind !== 'FADE') return { kind: 'CUT', color: 'BLACK', duration: 0 };
  const d = typeof tr.duration === 'number' && Number.isFinite(tr.duration) ? clamp(tr.duration, MIN_FADE, MAX_FADE) : DEFAULT_FADE.duration;
  return { kind: 'FADE', color: tr.color === 'WHITE' ? 'WHITE' : 'BLACK', duration: d };
}

/**
 * N1: the stretch of time the change into shot i covers, seconds (SPEC §3.7 "Fades"), or null for a cut. A FADE into
 * shot i (i ≥ 1) straddles the cut: half of its length before and half after, never longer than half of either shot;
 * one into the first shot runs from 0 over its length (no longer than the shot). The timeline draws this very span.
 */
export function shotFadeSpan(shots: readonly Pick<Shot, 'duration' | 'transition'>[], i: number): { start: number; cut: number; end: number } | null {
  const shot = shots[i];
  if (!shot) return null;
  const tr = shotTransition(shot);
  if (tr.kind !== 'FADE') return null;
  if (i === 0) {
    const d = Math.min(tr.duration, Math.max(0, shot.duration));
    return d > 0 ? { start: 0, cut: 0, end: d } : null;
  }
  let cut = 0;
  for (let k = 0; k < i; k++) cut += Math.max(0, shots[k].duration);
  const half = Math.min(tr.duration / 2, Math.max(0, shots[i - 1].duration) / 2, Math.max(0, shot.duration) / 2);
  return half > 0 ? { start: cut - half, cut, end: cut + half } : null;
}

/**
 * N1: the camera track's fade to a colour at time t (SPEC §3.7 "Fades"). A FADE change into shot i (i ≥ 1) takes the
 * image to its colour over the half of its span before the cut and back over the half after, with the smooth curve;
 * one into the first shot is a fade from the colour over its span from 0 (`shotFadeSpan`). Where two overlap the
 * stronger one is seen. Null when no fade is under way.
 */
export function shotFadeAt(state: Pick<ProjectState, 'animation'>, t: number): FadeToColor | null {
  const shots = state.animation.shots;
  let best: FadeToColor | null = null;
  for (let i = 0; i < shots.length; i++) {
    const span = shotFadeSpan(shots, i);
    if (!span) continue;
    let amount = 0;
    if (i === 0) amount = t < span.end ? ease(1 - Math.max(0, t) / span.end, 'EASE') : 0;
    else {
      const half = span.end - span.cut;
      const off = Math.abs(t - span.cut);
      amount = off < half ? ease(1 - off / half, 'EASE') : 0;
    }
    if (amount > 0 && (!best || amount > best.amount)) best = { color: fadeColor(shotTransition(shots[i]).color), amount };
  }
  return best;
}

/**
 * N1, SUN_ARC: where the celestial pole is in the frame lights are placed in (azimuth and elevation relative to the
 * camera, like a light's): behind the product, 45° up. ◆ A photographic choice (which latitude, where north is) that
 * is not this phase's to make: one constant each.
 */
export const SUN_POLE_AZ = 180;
export const SUN_LATITUDE = 45;

/** A unit vector turned by `deg` degrees about a unit axis (Rodrigues). */
function turn(v: Vec3, axis: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d];
}

/**
 * N1: the sun (azimuth and elevation, degrees, in a light's frame) after `deg` degrees of its daily arc: it turns about
 * the celestial pole the way the sky does (westwards: clockwise seen from the pole), 15° an hour. Its angle to the pole
 * stays (its declination); 360° is a whole day.
 */
export function sunArc(az: number, el: number, deg: number): { az: number; el: number } {
  if (deg === 0) return { az, el };
  const d = turn(polar(az, el, 1), normalize(polar(SUN_POLE_AZ, SUN_LATITUDE, 1)), -deg);
  const z = clamp(d[2], -1, 1);
  return { az: (Math.atan2(d[0], -d[1]) * 180) / Math.PI, el: (Math.asin(z) * 180) / Math.PI };
}

/** N1: a material's own colour (the base colour of its Simple parameters), or null when it has none to change. */
export function materialBaseColor(inst: Pick<MaterialInstance, 'params'> | undefined): RGB | null {
  const c = inst?.params.baseColor;
  return Array.isArray(c) && c.length >= 3 && c.slice(0, 3).every((v) => typeof v === 'number' && Number.isFinite(v)) ? [c[0], c[1], c[2]] : null;
}

/**
 * N1: a material as the animation leaves it: its base colour where a MATERIAL_COLOR clip has put it (a copy; the same
 * instance without one). Its opacity is the engine's and the preview's to apply (a cut-out, a transparency).
 */
export function posedMaterial(inst: MaterialInstance, mp: MaterialPose | undefined): MaterialInstance {
  if (!mp?.color) return inst;
  const a = inst.params.baseColor?.[3] ?? 1;
  return { ...inst, params: { ...inst.params, baseColor: [mp.color[0], mp.color[1], mp.color[2], a] } };
}

/** N1: the world point a rotation turns about, or null for the node's own origin (no pivot, or one that is gone). */
export function pivotPoint(state: ProjectState, pivot: ClipPivot | undefined): Vec3 | null {
  if (!pivot) return null;
  if (pivot.kind === 'POINT') return Array.isArray(pivot.point) && pivot.point.length === 3 && pivot.point.every(Number.isFinite) ? [pivot.point[0], pivot.point[1], pivot.point[2]] : null;
  if (pivot.kind !== 'NODE' || !state.scene.nodes[pivot.id]) return null;
  const b = boundsOf(state, [pivot.id]);
  return isEmptyBox(b) ? null : boxCenter(b);
}

/**
 * Pose at time `t` (SPEC §3.7): every clip contributes its eased amount;
 * contributions on the same target add up. Pure: the preview uses it to
 * play, the engines to render frame by frame.
 */
export function evaluate(state: ProjectState, t: number): Pose {
  const anim = state.animation;
  const size = state.scene.partSizeMm || 1;
  const shot = shotIndexAt(state, t);
  const pose: Pose = { t, shot, camera: null, nodes: {}, lights: {}, envRotationDeg: state.environment.rotationDeg, sectionOffsetMm: 0, materials: {}, fade: shotFadeAt(state, t), skySun: null };

  // Camera: the camera of the current shot, moved by the clips of that shot.
  const shotCamId = shot >= 0 ? anim.shots[shot]?.camera : null;
  const base = (shotCamId && state.camera.cameras[shotCamId]) || activeCamera(state);
  // S3b: a PHYSICS clip of the camera records its front glass and moves nothing (below).
  const camClips = anim.clips.filter((c) => c.target.kind === 'CAMERA' && c.move !== 'PHYSICS' && (c.shot === null || c.shot === shot));
  if (base && (camClips.length > 0 || shotCamId)) {
    const cp: CameraPose = {
      camera: base.id,
      azimuth: base.azimuth,
      elevation: base.elevation,
      distance: base.distance,
      target: [...base.target],
      focalMm: base.focalMm,
      focusDistance: base.focusDistance,
    };
    let dolly = 1;
    for (const c of camClips) {
      const e = clipProgress(c, t);
      switch (c.move) {
        case 'ORBIT':
          cp.azimuth += c.amount * e;
          break;
        case 'RISE':
          cp.elevation = clamp(cp.elevation + c.amount * e, -89, 89);
          break;
        case 'DOLLY':
          dolly *= 1 - (c.amount / 100) * e;
          break;
        case 'TRACK': {
          const v = c.vector ?? [c.amount, 0, 0];
          const { right, up, forward } = cameraBasis(cp.azimuth, cp.elevation);
          const off = add(add(scale(right, v[0]), scale(forward, v[1])), scale(up, v[2]));
          cp.target = add(cp.target, scale(off, size * e));
          break;
        }
        case 'ZOOM':
          cp.focalMm = lerp(base.focalMm, c.amount, e);
          break;
        case 'FOCUS':
          cp.focusDistance = lerp(base.focusDistance, c.amount * 1000, e);
          break;
        case 'PAN': {
          // N1: the camera turns where it stands (positive: to its right): its target goes round its position.
          const at = add(cp.target, polar(cp.azimuth, cp.elevation, cp.distance));
          cp.azimuth -= c.amount * e;
          cp.target = sub(at, polar(cp.azimuth, cp.elevation, cp.distance));
          break;
        }
        default:
          break;
      }
    }
    cp.distance = base.distance * Math.max(0.05, dolly);
    pose.camera = cp;
  }

  // S3b: the recorded front glass of each camera, the frame at this instant (through the clip's time: repeats, reversed).
  for (const c of anim.clips) {
    if (c.move !== 'PHYSICS' || c.target.kind !== 'CAMERA' || !c.glass) continue;
    (pose.glass ??= {})[c.glass.camera] = { clip: c.id, frame: glassFrameIndex(c.glass, clipPhase(c, t)) };
  }
  // S3c: the recorded rain, dust and snow on the parts, the frame at this instant.
  for (const c of anim.clips) {
    if (c.move !== 'PHYSICS' || c.target.kind !== 'SCENE' || !c.parts) continue;
    pose.parts = { clip: c.id, frame: partsFrameIndex(c.parts, clipPhase(c, t)) };
  }

  // Nodes: the subject (every model root) or one node.
  const nodeClips = anim.clips.filter((c) => c.target.kind === 'SUBJECT' || c.target.kind === 'NODE');
  const cache = new Map<NodeId, Mat4>();
  const ensure = (id: NodeId): NodePose | null => {
    const node = state.scene.nodes[id];
    if (!node) return null;
    return (pose.nodes[id] ??= {
      position: [...node.transform.position],
      rotation: [...node.transform.rotation],
      scale: [...node.transform.scale],
      visible: node.visible,
    });
  };
  // A PHYSICS clip says where its node is; the other moves add to that, so it goes first.
  const ordered = [...nodeClips.filter((c) => c.move === 'PHYSICS'), ...nodeClips.filter((c) => c.move !== 'PHYSICS')];
  for (const c of ordered) {
    if (c.move === 'PHYSICS') {
      if (c.target.kind !== 'NODE' || !c.track) continue;
      const np = ensure(c.target.id);
      if (!np) continue;
      // The recording follows the clip's time like any other clip (repeats, reversed), without a curve.
      const p = trackPose(c.track, clipPhase(c, t), state.scene.nodes[c.target.id].transform, c.anchor);
      if (p) {
        np.position = p.position;
        np.rotation = p.rotation;
      }
      continue;
    }
    const e = clipProgress(c, t);
    const ids = c.target.kind === 'NODE' ? [c.target.id] : state.scene.roots;
    if (c.move === 'EXPLODE') {
      applyExplode(state, c, t, ensure, cache);
      continue;
    }
    // N1: a rotation about a pivot (another part's centre, a point) turns the node about it, along its own axis.
    const pivot = (c.move === 'SPIN' || c.move === 'TUMBLE') && c.target.kind === 'NODE' ? pivotPoint(state, c.pivot) : null;
    for (const id of ids) {
      const np = ensure(id);
      if (!np) continue;
      if (pivot) {
        turnAbout(state, id, np, pivot, c.move === 'SPIN' ? 2 : 0, c.amount * e, cache);
        continue;
      }
      switch (c.move) {
        case 'SPIN':
          np.rotation = [np.rotation[0], np.rotation[1], np.rotation[2] + c.amount * e];
          break;
        case 'TUMBLE':
          np.rotation = [np.rotation[0] + c.amount * e, np.rotation[1], np.rotation[2]];
          break;
        case 'FADE':
          // N1: the opacity goes from what it was towards `amount` percent; fades on the same node multiply.
          np.opacity = (np.opacity ?? 1) * lerp(1, clamp(c.amount / 100, 0, 1), e);
          break;
        case 'MOVE': {
          const v = c.vector ?? [0, 0, c.amount];
          np.position = add(np.position, worldToLocalDelta(state, id, scale(v, size * e), cache));
          break;
        }
        case 'SCALE': {
          const k = lerp(1, c.amount, e);
          np.scale = [np.scale[0] * k, np.scale[1] * k, np.scale[2] * k];
          break;
        }
        case 'VISIBILITY': {
          const appear = c.amount >= 0.5;
          np.visible = clipPhase(c, t) >= 0.5 ? appear : !appear;
          break;
        }
        default:
          break;
      }
    }
  }

  // Lights.
  for (const c of anim.clips) {
    if (c.target.kind !== 'LIGHT') continue;
    const id = c.target.id;
    const light = state.studio.lights.find((l) => l.id === id);
    if (!light) continue;
    const lp = (pose.lights[id] ??= { power: light.power, color: [...light.color], az: light.az, el: light.el, enabled: light.enabled });
    const e = clipProgress(c, t);
    switch (c.move) {
      case 'INTENSITY':
        lp.power = lerp(light.power, c.amount, e);
        break;
      case 'TINT': {
        const to = c.color ?? [1, 1, 1];
        lp.color = [lerp(light.color[0], to[0], e), lerp(light.color[1], to[1], e), lerp(light.color[2], to[2], e)];
        break;
      }
      case 'ORBIT':
        lp.az += c.amount * e;
        break;
      case 'RISE':
        lp.el = clamp(lp.el + c.amount * e, -89, 89);
        break;
      case 'VISIBILITY':
        lp.enabled = clipPhase(c, t) >= 0.5 ? c.amount >= 0.5 : c.amount < 0.5;
        break;
      default:
        break;
    }
  }

  // N1: materials: their colour goes to the clip's (from what the clips before left), their opacity multiplies.
  for (const c of anim.clips) {
    if (c.target.kind !== 'MATERIAL') continue;
    const inst = state.materials[c.target.id];
    if (!inst) continue;
    const mp = (pose.materials[c.target.id] ??= { opacity: 1 });
    const e = clipProgress(c, t);
    if (c.move === 'FADE') mp.opacity *= lerp(1, clamp(c.amount / 100, 0, 1), e);
    else if (c.move === 'MATERIAL_COLOR') {
      const from = mp.color ?? materialBaseColor(inst);
      if (!from) continue;
      const to = c.color ?? from;
      mp.color = [lerp(from[0], to[0], e), lerp(from[1], to[1], e), lerp(from[2], to[2], e)];
    }
  }

  // Environment, and the scene as a whole: the light sweep, and the section plane (Q1: its offset along its normal,
  // in part sizes like a MOVE, added up with the curve of each clip).
  let arc = 0;
  for (const c of anim.clips) {
    if (c.target.kind !== 'SCENE') continue;
    if (c.move === 'HDRI') pose.envRotationDeg += c.amount * clipProgress(c, t);
    else if (c.move === 'SECTION') pose.sectionOffsetMm += c.amount * size * clipProgress(c, t);
    // N1: turns about the same axis add up, so the arcs of every clip are one turn.
    else if (c.move === 'SUN_ARC') arc += c.amount * clipProgress(c, t);
  }
  if (arc !== 0) {
    // The sun of the sky is the rig's first sun light that shines (SPEC §3.4, core/lighting.ts skySunDirection);
    // without one, the environment's own.
    const sun = state.studio.lights.find((l) => l.type === 'SUN' && l.enabled && l.power > 0);
    if (sun) {
      const lp = (pose.lights[sun.id] ??= { power: sun.power, color: [...sun.color], az: sun.az, el: sun.el, enabled: sun.enabled });
      const next = sunArc(lp.az, lp.el, arc);
      lp.az = next.az;
      lp.el = next.el;
    } else pose.skySun = sunArc(state.environment.skySun.az, state.environment.skySun.el, arc);
  }
  return pose;
}

/**
 * N1: node `id`, posed as `np`, turned by `deg` degrees about `pivot` (world, mm) along its own axis `axis` (0 X, 2 Z) as
 * it stands before the clip: the turn is made in the world and brought back to the node's parent.
 */
function turnAbout(state: ProjectState, id: NodeId, np: NodePose, pivot: Vec3, axis: 0 | 2, deg: number, cache: Map<NodeId, Mat4>): void {
  const node = state.scene.nodes[id];
  if (!node || deg === 0) return;
  const pw = node.parent ? worldMatrix(state, node.parent, cache) : mat4Identity();
  const local = mat4Compose(np.position, np.rotation, np.scale);
  const world = mat4Multiply(pw, local);
  const dir = normalize([world[axis * 4], world[axis * 4 + 1], world[axis * 4 + 2]]);
  if (!(Math.hypot(dir[0], dir[1], dir[2]) > 0)) return;
  const r = rotationAbout(pivot, dir, deg);
  const next = decomposeMatrix(mat4Multiply(mat4Invert(pw), mat4Multiply(r, world)), { position: np.position, rotation: np.rotation, scale: np.scale });
  np.position = next.position;
  np.rotation = next.rotation;
  np.scale = next.scale;
}

/** A rotation of `deg` degrees about a unit axis through `c`, world space. */
function rotationAbout(c: Vec3, axis: Vec3, deg: number): Mat4 {
  const a = (deg * Math.PI) / 180;
  const co = Math.cos(a);
  const si = Math.sin(a);
  const [x, y, z] = axis;
  const t = 1 - co;
  const r = mat4Identity();
  r[0] = co + x * x * t;
  r[1] = y * x * t + z * si;
  r[2] = z * x * t - y * si;
  r[4] = x * y * t - z * si;
  r[5] = co + y * y * t;
  r[6] = z * y * t + x * si;
  r[8] = x * z * t + y * si;
  r[9] = y * z * t - x * si;
  r[10] = co + z * z * t;
  const to = mat4Compose(c, [0, 0, 0], [1, 1, 1]);
  const back = mat4Compose(scale(c, -1), [0, 0, 0], [1, 1, 1]);
  return mat4Multiply(to, mat4Multiply(r, back));
}

/**
 * An EXPLODE clip on the pose (core/explode.ts): each mover travels its displacement inside its window of the clip,
 * with the clip's curve; the displacement is world space, added to each part's position in its parent's space.
 */
function applyExplode(state: ProjectState, c: MotionClip, t: number, ensure: (id: NodeId) => NodePose | null, cache: Map<NodeId, Mat4>): void {
  const node = c.target.kind === 'NODE' ? c.target.id : null;
  // Every part of the target has a pose, moving or not (as before N6).
  for (const p of explodeParts(state, node)) ensure(p);
  const movers = explodeMovers(state, { node, amount: c.amount, explode: c.explode }, cache);
  if (movers.length === 0) return;
  const x = clipPhase(c, t);
  const keep = resolveExplode(c.explode).keepOrientation;
  for (const m of movers) {
    const e = clipCurve(c, moverPhase(m, x));
    const d = scale(m.delta, e);
    for (const p of m.parts) {
      const np = ensure(p);
      if (np) np.position = add(np.position, worldToLocalDelta(state, p, d, cache));
    }
    const axis = keep || e === 0 ? null : tiltAxis(m.delta);
    if (!axis) continue;
    // Not keeping the orientation: the mover tilts away as it travels, about its own (moved) centre.
    const turn = rotationAbout(add(m.ref, d), axis, EXPLODE_TILT_DEG * e);
    for (const p of m.parts) {
      const np = ensure(p);
      const parent = state.scene.nodes[p]?.parent;
      if (!np) continue;
      const pw = parent ? worldMatrix(state, parent, cache) : mat4Identity();
      const local = mat4Compose(np.position, np.rotation, np.scale);
      const next = decomposeMatrix(mat4Multiply(mat4Invert(pw), mat4Multiply(turn, mat4Multiply(pw, local))), { position: np.position, rotation: np.rotation, scale: np.scale });
      np.position = next.position;
      np.rotation = next.rotation;
      np.scale = next.scale;
    }
  }
}

/**
 * Clips that collide: same target, same move, overlapping in time (SPEC §3.7:
 * marked in the interface, never silenced). Camera clips only collide within
 * the same shot.
 */
export function clipConflicts(state: ProjectState): Set<string> {
  const out = new Set<string>();
  const clips = state.animation.clips;
  for (let i = 0; i < clips.length; i++) {
    for (let j = i + 1; j < clips.length; j++) {
      const a = clips[i];
      const b = clips[j];
      if (a.move !== b.move || targetKey(a.target) !== targetKey(b.target)) continue;
      if (a.target.kind === 'CAMERA' && a.shot !== null && b.shot !== null && a.shot !== b.shot) continue;
      const overlap = a.start < clipEnd(b) && b.start < clipEnd(a);
      if (overlap) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  }
  return out;
}

/** N1: the parts that wear a material (as their own or on some of their faces). */
export function partsWearing(state: ProjectState, material: MaterialId): NodeId[] {
  return allParts(state).filter((p) => {
    const n = state.scene.nodes[p];
    return n.material === material || (n.faceMaterials ?? []).some((f) => f.material === material);
  });
}

/**
 * The parts a clip moves (what the viewport highlights): the model's, a node's, a material's wearers (N1); none for
 * cameras, lights, the environment.
 */
export function clipTargetParts(state: ProjectState, clip: Pick<MotionClip, 'target' | 'move' | 'explode'>): NodeId[] {
  const tg = clip.target;
  if (tg.kind === 'MATERIAL') return partsWearing(state, tg.id);
  if (tg.kind !== 'SUBJECT' && tg.kind !== 'NODE') return [];
  const parts = explodeParts(state, tg.kind === 'NODE' ? tg.id : null);
  if (clip.move !== 'EXPLODE') return parts;
  // An explode does not move its exceptions.
  const pinned = new Set(partsUnder(state, resolveExplode(clip.explode).pinned));
  return parts.filter((p) => !pinned.has(p));
}

/**
 * The clips that act on some of the selected things (scene nodes, or lights by id): what the timeline's tree marks
 * when they are selected in the scene. A clip on a group or on the model acts on every part under it.
 */
export function clipsActingOn(state: ProjectState, ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const parts = new Set(partsUnder(state, ids.filter((id) => state.scene.nodes[id])));
  const lights = new Set(ids.filter((id) => state.studio.lights.some((l) => l.id === id)));
  return state.animation.clips
    .filter((c) => {
      if (c.target.kind === 'LIGHT') return lights.has(c.target.id);
      if (c.target.kind === 'NODE' && ids.includes(c.target.id)) return true;
      return clipTargetParts(state, c).some((p) => parts.has(p));
    })
    .map((c) => c.id);
}

/** The EXPLODE clips whose target holds some of these parts (where "Pin in exploded view" pins them). */
export function explodeClipsFor(state: ProjectState, parts: readonly NodeId[]): MotionClip[] {
  const want = new Set(partsUnder(state, parts));
  return state.animation.clips.filter((c) => c.move === 'EXPLODE' && explodeParts(state, c.target.kind === 'NODE' ? c.target.id : null).some((p) => want.has(p)));
}

/** Whether these parts are all exceptions of an explode clip. */
export function isPinned(state: ProjectState, clip: MotionClip, parts: readonly NodeId[]): boolean {
  const pinned = new Set(partsUnder(state, resolveExplode(clip.explode).pinned));
  const ps = partsUnder(state, parts);
  return ps.length > 0 && ps.every((p) => pinned.has(p));
}

/** Kinds whose amount adds up over time (a turn, a distance): a split gives each half its share. */
const ADDITIVE: ReadonlySet<MoveKind> = new Set<MoveKind>(['ORBIT', 'RISE', 'SPIN', 'TUMBLE', 'HDRI', 'TRACK', 'MOVE', 'EXPLODE', 'SECTION', 'PAN', 'SUN_ARC']);

/**
 * Whether a clip can be cut in two at time t: strictly inside it, played once and forwards, of a kind whose amount
 * accumulates (or multiplies: scale, dolly), and for an explode only when every part moves at once.
 */
export function canSplit(clip: MotionClip, t: number): boolean {
  if (!(t > clip.start + 1e-6 && t < clipEnd(clip) - 1e-6) || clip.reverse || clipRepeat(clip) > 1) return false;
  if (clip.move === 'EXPLODE') {
    const e = resolveExplode(clip.explode);
    return e.order === 'AT_ONCE' && e.levels !== 'ALL';
  }
  return ADDITIVE.has(clip.move) || clip.move === 'SCALE' || clip.move === 'DOLLY' || clip.move === 'FADE';
}

/**
 * The two halves of a clip cut at time t (null when it cannot be cut): the first ends where the clip was at t, the
 * second goes on from there to where the clip ended. The motion is continuous; each half keeps the curve.
 */
export function splitClip(clip: MotionClip, t: number): [Omit<MotionClip, 'id'>, Omit<MotionClip, 'id'>] | null {
  if (!canSplit(clip, t)) return null;
  const { id: _id, ...rest } = clip;
  void _id;
  const p = clipProgress(clip, t);
  const first: Omit<MotionClip, 'id'> = { ...structuredClone(rest), duration: t - clip.start };
  const second: Omit<MotionClip, 'id'> = { ...structuredClone(rest), start: t, duration: clipEnd(clip) - t };
  if (ADDITIVE.has(clip.move)) {
    first.amount = clip.amount * p;
    second.amount = clip.amount * (1 - p);
    if (clip.vector) {
      first.vector = scale(clip.vector, p);
      second.vector = scale(clip.vector, 1 - p);
    }
  } else if (clip.move === 'SCALE') {
    const k = lerp(1, clip.amount, p);
    if (Math.abs(k) < 1e-9) return null;
    first.amount = k;
    second.amount = clip.amount / k;
  } else if (clip.move === 'FADE') {
    // N1: the opacity multiplies by lerp(1, amount / 100, e): the first half ends at k, the second goes from there.
    const end = clamp(clip.amount / 100, 0, 1);
    const k = lerp(1, end, p);
    if (k < 1e-9) return null;
    first.amount = 100 * k;
    second.amount = (100 * end) / k;
  } else {
    // DOLLY multiplies the distance by 1 - amount / 100.
    const d = 1 - (clip.amount / 100) * p;
    if (Math.abs(d) < 1e-9) return null;
    first.amount = clip.amount * p;
    second.amount = 100 * (1 - (1 - clip.amount / 100) / d);
  }
  return [first, second];
}

/** Shots and clips of a SEQUENCE_PRESETS entry. Unknown key gives null. */
export function animationFromPreset(key: string): { shots: Shot[]; clips: MotionClip[] } | null {
  const p = sequencePreset(key);
  if (!p) return null;
  const shotIds = nextIds('s', [], p.shots.length);
  const clipIds = nextIds('c', [], p.clips.length);
  const shots: Shot[] = p.shots.map((d, i) => ({ id: shotIds[i], duration: d, camera: null }));
  const clips: MotionClip[] = p.clips.map((c, i) => ({
    id: clipIds[i],
    target: c.target === 'CAM' ? { kind: 'CAMERA' } : c.target === 'SUBJECT' ? { kind: 'SUBJECT' } : { kind: 'SCENE' },
    move: c.move,
    shot: c.target === 'CAM' ? c.shot : null,
    start: c.start,
    duration: c.duration,
    amount: c.amount,
    easing: c.easing,
  }));
  return { shots, clips };
}

export type AnimationAction =
  | ({ type: 'anim/preset'; key: string } & ActionBase)
  | ({ type: 'anim/addShot'; duration: number } & ActionBase)
  | ({ type: 'anim/setShot'; id: string; patch: Partial<Omit<Shot, 'id'>> } & ActionBase)
  | ({ type: 'anim/removeShot'; id: string } & ActionBase)
  | ({ type: 'anim/moveShot'; id: string; delta: number } & ActionBase)
  | ({ type: 'anim/addClip'; clip: Omit<MotionClip, 'id'> } & ActionBase)
  | ({ type: 'anim/setClip'; id: string; patch: Partial<Omit<MotionClip, 'id'>> } & ActionBase)
  | ({ type: 'anim/removeClip'; id: string } & ActionBase)
  /** N6: several clips at once (the timeline's multiple selection). */
  | ({ type: 'anim/removeClips'; ids: string[] } & ActionBase)
  /** N6: copies of clips, each placed right after its original. */
  | ({ type: 'anim/duplicateClips'; ids: string[] } & ActionBase)
  /** N6: new start and duration of some clips (a drag of bars: absolute values, so a gesture repeats it safely). */
  | ({ type: 'anim/setClipTimes'; times: Record<string, { start?: number; duration?: number }> } & ActionBase)
  /** N6: cut a clip in two at time t (see `splitClip`). */
  | ({ type: 'anim/splitClip'; id: string; t: number } & ActionBase)
  /** N6: turn the direction of some clips round (an explode reversed assembles). */
  | ({ type: 'anim/reverseClips'; ids: string[] } & ActionBase)
  /** N6: change some parameters of an explode. */
  | ({ type: 'anim/setExplode'; id: string; patch: Partial<ExplodeParams> } & ActionBase)
  /** N6: pin parts in (or free them from) the explodes that hold them, or only in `clips`. */
  | ({ type: 'anim/pinExplode'; parts: NodeId[]; pinned: boolean; clips?: string[] } & ActionBase)
  | ({ type: 'anim/setFps'; fps: number } & ActionBase)
  | ({ type: 'anim/clear' } & ActionBase)
  | ({ type: 'anim/playhead'; t: number } & ActionBase)
  | ({ type: 'anim/play'; playing: boolean } & ActionBase);

export function reduceAnimation(state: ProjectState, action: AnimationAction): ProjectState {
  const anim = state.animation;
  const set = (patch: Partial<ProjectState['animation']>): ProjectState => ({ ...state, animation: { ...anim, ...patch } });
  switch (action.type) {
    case 'anim/preset': {
      const r = animationFromPreset(action.key);
      return r ? set({ shots: r.shots, clips: r.clips, playhead: 0, playing: false }) : state;
    }
    case 'anim/addShot':
      return set({ shots: [...anim.shots, { id: nextId('s', anim.shots.map((s) => s.id)), duration: Math.max(0.1, action.duration), camera: null }] });
    case 'anim/setShot':
      return set({
        shots: anim.shots.map((s) => {
          if (s.id !== action.id) return s;
          const next: Shot = { ...s, ...action.patch, duration: Math.max(0.1, action.patch.duration ?? s.duration) };
          // N1: a change of camera is a cut (no field) or a fade within its limits.
          if ('transition' in action.patch) {
            const tr = action.patch.transition ? shotTransition(action.patch) : null;
            if (tr && tr.kind === 'FADE') next.transition = tr;
            else delete next.transition;
          }
          return next;
        }),
      });
    case 'anim/removeShot': {
      const i = anim.shots.findIndex((s) => s.id === action.id);
      if (i < 0) return state;
      const clips = anim.clips.map((c) =>
        c.shot === null ? c : c.shot === i ? { ...c, shot: null } : c.shot > i ? { ...c, shot: c.shot - 1 } : c,
      );
      return set({ shots: anim.shots.filter((s) => s.id !== action.id), clips });
    }
    case 'anim/moveShot': {
      const i = anim.shots.findIndex((s) => s.id === action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= anim.shots.length) return state;
      const shots = [...anim.shots];
      [shots[i], shots[j]] = [shots[j], shots[i]];
      const clips = anim.clips.map((c) => (c.shot === i ? { ...c, shot: j } : c.shot === j ? { ...c, shot: i } : c));
      return set({ shots, clips });
    }
    case 'anim/addClip':
      return set({ clips: [...anim.clips, { ...action.clip, id: nextId('c', anim.clips.map((c) => c.id)) }] });
    case 'anim/setClip':
      return set({
        clips: anim.clips.map((c) =>
          c.id === action.id
            ? {
                ...c,
                ...action.patch,
                start: Math.max(0, action.patch.start ?? c.start),
                duration: Math.max(0.05, action.patch.duration ?? c.duration),
                ...('repeat' in action.patch && action.patch.repeat !== undefined ? { repeat: clipRepeat(action.patch) } : {}),
                ...('smoothness' in action.patch && action.patch.smoothness !== undefined ? { smoothness: clamp(action.patch.smoothness, 0, 1) } : {}),
                // N1: the handles of a custom curve stay where they can be (x within 0..1).
                ...('curve' in action.patch && action.patch.curve !== undefined ? { curve: [...normaliseCurve(action.patch.curve)] as [number, number, number, number] } : {}),
              }
            : c,
        ),
      });
    case 'anim/removeClip':
      return set({ clips: anim.clips.filter((c) => c.id !== action.id) });
    case 'anim/removeClips': {
      const gone = new Set(action.ids);
      const clips = anim.clips.filter((c) => !gone.has(c.id));
      return clips.length === anim.clips.length ? state : set({ clips });
    }
    case 'anim/duplicateClips': {
      const ids = anim.clips.map((c) => c.id);
      const clips = [...anim.clips];
      for (const c of anim.clips) {
        if (!action.ids.includes(c.id)) continue;
        const id = nextId('c', ids);
        ids.push(id);
        clips.push({ ...structuredClone(c), id, start: clipEnd(c) });
      }
      return clips.length === anim.clips.length ? state : set({ clips });
    }
    case 'anim/setClipTimes': {
      let changed = false;
      const clips = anim.clips.map((c) => {
        const tm = action.times[c.id];
        if (!tm) return c;
        const start = Math.max(0, tm.start ?? c.start);
        const duration = Math.max(0.05, tm.duration ?? c.duration);
        if (start === c.start && duration === c.duration) return c;
        changed = true;
        return { ...c, start, duration };
      });
      return changed ? set({ clips }) : state;
    }
    case 'anim/splitClip': {
      const i = anim.clips.findIndex((c) => c.id === action.id);
      const halves = i >= 0 ? splitClip(anim.clips[i], action.t) : null;
      if (!halves) return state;
      const id = nextId('c', anim.clips.map((c) => c.id));
      const clips = [...anim.clips];
      clips.splice(i, 1, { ...halves[0], id: anim.clips[i].id }, { ...halves[1], id });
      return set({ clips });
    }
    case 'anim/reverseClips': {
      const flip = new Set(action.ids);
      if (!anim.clips.some((c) => flip.has(c.id))) return state;
      return set({ clips: anim.clips.map((c) => (flip.has(c.id) ? { ...c, reverse: !c.reverse } : c)) });
    }
    case 'anim/setExplode': {
      const c = anim.clips.find((x) => x.id === action.id);
      if (!c || c.move !== 'EXPLODE') return state;
      // A clip saved before N6 has no parameters: its own are the legacy ones, under the legacy key.
      const explode: ExplodeParams = { ...(c.explode ?? { mode: 'RADIAL' }), ...action.patch };
      if (explode.overlap !== undefined) explode.overlap = clamp(explode.overlap, 0, 1);
      return set({ clips: anim.clips.map((x) => (x.id === action.id ? { ...x, explode } : x)) });
    }
    case 'anim/pinExplode': {
      const parts = partsUnder(state, action.parts);
      if (parts.length === 0) return state;
      const which = new Set((action.clips ? anim.clips.filter((c) => action.clips!.includes(c.id) && c.move === 'EXPLODE') : explodeClipsFor(state, parts)).map((c) => c.id));
      if (which.size === 0) return state;
      let changed = false;
      const clips = anim.clips.map((c) => {
        if (!which.has(c.id)) return c;
        const prev = c.explode?.pinned ?? [];
        // Pins are kept as parts: pinning a group pins what is under it, freeing a part frees it from a pinned group.
        const had = new Set(partsUnder(state, prev));
        const next = action.pinned ? [...had, ...parts.filter((p) => !had.has(p))] : [...had].filter((p) => !parts.includes(p));
        if (next.length === had.size && next.every((p) => had.has(p)) && prev.every((p) => state.scene.nodes[p]?.kind === 'PART')) return c;
        changed = true;
        return { ...c, explode: { ...(c.explode ?? { mode: 'RADIAL' }), pinned: next } };
      });
      return changed ? set({ clips }) : state;
    }
    case 'anim/setFps':
      return action.fps > 0 ? set({ fps: Math.round(action.fps) }) : state;
    case 'anim/clear':
      return set({ shots: [], clips: [], playhead: 0, playing: false });
    case 'anim/playhead': {
      const t = Math.max(0, action.t);
      return t === anim.playhead ? state : set({ playhead: t });
    }
    case 'anim/play':
      return anim.playing === action.playing ? state : set({ playing: action.playing });
    default:
      return state;
  }
}

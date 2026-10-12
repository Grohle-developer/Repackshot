// Animation: shots (the cuts), motion clips (what moves, when and how much)
// and their evaluation in time with the analytic easing curves (SPEC §3.7).

import { sequencePreset } from '../data/animation';
import type { EasingKind, MoveKind, RGB } from '../data/types';
import { ease } from './light-math';
import type { ActionBase, ProjectState } from './store';
import { activeCamera, cameraBasis, type CameraId } from './camera';
import { nextId, nextIds } from './ids';
import { add, boxCenter, clamp, isEmptyBox, lerp, normalize, scale, sub, type Mat4, type Vec3 } from './math';
import { allParts, partWorldBounds, sceneBounds, worldToLocalDelta, type NodeId } from './scene';

/** One shot: how long it lasts and which camera is seen (null = the active camera). */
export interface Shot {
  id: string;
  duration: number;
  camera: CameraId | null;
}

/** What a clip moves. */
export type ClipTarget =
  | { kind: 'CAMERA' }
  | { kind: 'SUBJECT' }
  | { kind: 'NODE'; id: NodeId }
  | { kind: 'LIGHT'; id: string }
  | { kind: 'SCENE' };

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
}

/** Moves offered for each kind of target, in wizard order. */
export const TARGET_MOVES: Readonly<Record<ClipTargetKind, readonly MoveKind[]>> = {
  CAMERA: ['ORBIT', 'RISE', 'DOLLY', 'TRACK', 'ZOOM', 'FOCUS'],
  SUBJECT: ['SPIN', 'TUMBLE', 'MOVE', 'SCALE', 'EXPLODE', 'VISIBILITY'],
  NODE: ['SPIN', 'TUMBLE', 'MOVE', 'SCALE', 'VISIBILITY'],
  LIGHT: ['INTENSITY', 'TINT', 'ORBIT', 'RISE', 'VISIBILITY'],
  SCENE: ['HDRI'],
};

/** What a clip's amount is measured in, for the sentence and the field unit. */
export function amountUnit(move: MoveKind): 'deg' | 'pct' | 'factor' | 'mm' | 'm' | 'W' | 'parts' | 'none' {
  switch (move) {
    case 'ORBIT':
    case 'RISE':
    case 'SPIN':
    case 'TUMBLE':
    case 'HDRI':
      return 'deg';
    case 'DOLLY':
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
  };
  return table[move] ?? 1;
}

/** Total length of the sequence: the shots, or the last clip if it runs longer. */
export function totalDuration(state: ProjectState): number {
  const shots = state.animation.shots.reduce((a, s) => a + Math.max(0, s.duration), 0);
  const clips = state.animation.clips.reduce((a, c) => Math.max(a, c.start + c.duration), 0);
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

/** Eased progress of a clip at time t, 0..1. */
export function clipProgress(clip: MotionClip, t: number): number {
  if (clip.duration <= 0) return t >= clip.start ? 1 : 0;
  return ease((t - clip.start) / clip.duration, clip.easing);
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
}

function targetKey(t: ClipTarget): string {
  return t.kind === 'NODE' || t.kind === 'LIGHT' ? `${t.kind}:${t.id}` : t.kind;
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
  const pose: Pose = { t, shot, camera: null, nodes: {}, lights: {}, envRotationDeg: state.environment.rotationDeg };

  // Camera: the camera of the current shot, moved by the clips of that shot.
  const shotCamId = shot >= 0 ? anim.shots[shot]?.camera : null;
  const base = (shotCamId && state.camera.cameras[shotCamId]) || activeCamera(state);
  const camClips = anim.clips.filter((c) => c.target.kind === 'CAMERA' && (c.shot === null || c.shot === shot));
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
        default:
          break;
      }
    }
    cp.distance = base.distance * Math.max(0.05, dolly);
    pose.camera = cp;
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
  for (const c of nodeClips) {
    const e = clipProgress(c, t);
    const ids = c.target.kind === 'NODE' ? [c.target.id] : state.scene.roots;
    if (c.move === 'EXPLODE') {
      const box = sceneBounds(state);
      if (isEmptyBox(box)) continue;
      const center = boxCenter(box);
      for (const p of allParts(state)) {
        const pb = partWorldBounds(state, p, cache);
        const dir = normalize(sub(boxCenter(pb), center));
        const local = worldToLocalDelta(state, p, scale(dir, c.amount * size * e), cache);
        const np = ensure(p);
        if (np) np.position = add(np.position, local);
      }
      continue;
    }
    for (const id of ids) {
      const np = ensure(id);
      if (!np) continue;
      switch (c.move) {
        case 'SPIN':
          np.rotation = [np.rotation[0], np.rotation[1], np.rotation[2] + c.amount * e];
          break;
        case 'TUMBLE':
          np.rotation = [np.rotation[0] + c.amount * e, np.rotation[1], np.rotation[2]];
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
          const raw = c.duration > 0 ? (t - c.start) / c.duration : t >= c.start ? 1 : 0;
          np.visible = raw >= 0.5 ? appear : !appear;
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
      case 'VISIBILITY': {
        const raw = c.duration > 0 ? (t - c.start) / c.duration : 1;
        lp.enabled = raw >= 0.5 ? c.amount >= 0.5 : c.amount < 0.5;
        break;
      }
      default:
        break;
    }
  }

  // Environment.
  for (const c of anim.clips) {
    if (c.target.kind === 'SCENE' && c.move === 'HDRI') pose.envRotationDeg += c.amount * clipProgress(c, t);
  }
  return pose;
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
      const overlap = a.start < b.start + b.duration && b.start < a.start + a.duration;
      if (overlap) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  }
  return out;
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
      return set({ shots: anim.shots.map((s) => (s.id === action.id ? { ...s, ...action.patch, duration: Math.max(0.1, action.patch.duration ?? s.duration) } : s)) });
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
            ? { ...c, ...action.patch, start: Math.max(0, action.patch.start ?? c.start), duration: Math.max(0.05, action.patch.duration ?? c.duration) }
            : c,
        ),
      });
    case 'anim/removeClip':
      return set({ clips: anim.clips.filter((c) => c.id !== action.id) });
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

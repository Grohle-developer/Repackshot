// Product-relative camera moves and handheld presets (STUDIO-TOOLS §4 and §6, docs/SPEC.md §3.7).
//
// A move is a short list of the existing animation kinds (ORBIT, RISE, DOLLY, TRACK, ZOOM, FOCUS for the camera,
// SPIN and EXPLODE for the model) in units that do not depend on the project: degrees, a percentage of the framing
// distance, part sizes (the model's size, as TRACK and EXPLODE already measure), a factor of the current focal
// length or focus distance. Times are fractions of the move's duration, so that one move fits any length. Every
// move starts from the camera as it is (a push-in pushes in from the current framing); src/core/camera-moves.ts
// turns a move into the clips of the timeline for a given camera. Keys are stable: they are added, never renamed.
//
// Data lives in camera-moves.json. There is no PAN kind in the animation yet (SPEC §3.7 lists it as new), so the
// whip pan is a fast, strongly eased orbit around the product; a pan variant can be added next to it later.

import raw from './camera-moves.json';
import type { EasingKind, Label } from './types';

export type MoveClipTarget = 'CAMERA' | 'SUBJECT';
/** The animation kinds a move may use. */
export type MoveClipKind = 'ORBIT' | 'RISE' | 'DOLLY' | 'TRACK' | 'ZOOM' | 'FOCUS' | 'SPIN' | 'EXPLODE';

/** One bar of a move. Exactly one of the amount fields is set, the one its kind needs. */
export interface MoveClipSpec {
  target: MoveClipTarget;
  move: MoveClipKind;
  /** Start and length as fractions of the move's duration, 0..1. */
  start: number;
  length: number;
  /** Overrides the move's easing. */
  easing?: EasingKind;
  /** ORBIT, RISE, SPIN: degrees. */
  degrees?: number;
  /** DOLLY: percent of the framing distance, positive toward the product. */
  percent?: number;
  /** TRACK: right, forward, up, in part sizes, along the camera's own axes. */
  vector?: [number, number, number];
  /** ZOOM: the final focal length as a factor of the current one. */
  focalFactor?: number;
  /** FOCUS: the focus distance at the start and at the end, as factors of the current focus distance. */
  focus?: { from: number; to: number };
  /** EXPLODE: the distance the parts move apart, in part sizes. */
  parts?: number;
}

export interface CameraMove {
  key: string;
  name: Label;
  description: Label;
  /** Default length in seconds. */
  durationS: number;
  /** The default easing of the move's bars. */
  easing: EasingKind;
  /** True when the end pose repeats the start, so the move can loop (a full turn). */
  loop: boolean;
  /** Set when the move works between parts the user picks (rack focus: 2). It runs without them, between near and far. */
  needsParts?: number;
  clips: MoveClipSpec[];
}

/** Shake parameters of a handheld camera; the noise itself is band-limited and seeded (STUDIO-TOOLS §4). */
export interface HandheldPreset {
  key: string;
  name: Label;
  description: Label;
  seed: number;
  /** Band of the noise, hertz: low and high. */
  bandHz: [number, number];
  octaves: number;
  /** Peak rotation of the camera at the reference focal length, degrees. */
  rotationDeg: { pitch: number; yaw: number; roll: number };
  /** Peak translation, in part sizes. */
  positionPartSizes: number;
  referenceFocalMm: number;
  /** Whether the engine scales the amplitudes with the focal length and the distance to the product. */
  scaleWithFocal: boolean;
  scaleWithDistance: boolean;
}

const loadMoves = (): CameraMove[] => raw.moves as unknown as CameraMove[];
const loadHandheld = (): HandheldPreset[] => raw.handheld as unknown as HandheldPreset[];

/** The 14 moves, in the order of the plan. (`CAMERA_MOVES`, in animation.ts, is the set of kinds only a camera has.) */
export const CAMERA_MOVE_LIBRARY: readonly CameraMove[] = /* @__PURE__ */ loadMoves();

/** Subtle, medium and strong. */
export const HANDHELD_PRESETS: readonly HandheldPreset[] = /* @__PURE__ */ loadHandheld();

export function cameraMove(key: string): CameraMove | undefined {
  return CAMERA_MOVE_LIBRARY.find((m) => m.key === key);
}

export function handheldPreset(key: string): HandheldPreset | undefined {
  return HANDHELD_PRESETS.find((p) => p.key === key);
}

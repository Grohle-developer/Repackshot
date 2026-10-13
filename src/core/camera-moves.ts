// Turns a product-relative camera move (data/camera-moves.json) into the clips of the timeline for a given camera.
// Pure: the same move and the same camera give the same clips, and the clips are evaluated by `evaluate` in
// animation.ts like any other. The library's own window (phase N4) adds them with `anim/addClip`.

import type { CameraMove, MoveClipSpec } from '../data/camera-moves';
import type { MotionClip } from './animation';

/** What the move needs to know about the camera it is applied to. */
export interface MoveContext {
  /** The camera's focal length, mm: a ZOOM clip stores the final focal length. */
  focalMm: number;
  /** The camera's focus distance, mm: a FOCUS clip stores the final distance. */
  focusDistanceMm: number;
  /** Rack focus between two parts the user picked: distances from the camera to each, mm. */
  partDistancesMm?: readonly [number, number];
}

export interface MoveOptions {
  /** Seconds from the start of the sequence at which the move begins. Default 0. */
  start?: number;
  /** Length of the move in seconds. Default the move's own. */
  durationS?: number;
  /** The shot whose camera is moved (null: every shot). Default null. */
  shot?: number | null;
}

export interface ExpandedMove {
  clips: Omit<MotionClip, 'id'>[];
  /** What the camera must have before the clips play (a FOCUS bar starts from the camera's own focus distance). */
  setup: { focusDistanceMm?: number };
  /** Seconds the move lasts. */
  durationS: number;
}

/** The amount of a clip, in the unit the animation kind uses. */
function amountOf(spec: MoveClipSpec, ctx: MoveContext, endFocusMm: number): number {
  switch (spec.move) {
    case 'ORBIT':
    case 'RISE':
    case 'SPIN':
      return spec.degrees ?? 0;
    case 'DOLLY':
      return spec.percent ?? 0;
    case 'TRACK': {
      const v = spec.vector ?? [0, 0, 0];
      return Math.hypot(v[0], v[1], v[2]);
    }
    case 'ZOOM':
      return ctx.focalMm * (spec.focalFactor ?? 1);
    case 'FOCUS':
      // The animation measures focus in metres.
      return endFocusMm / 1000;
    case 'EXPLODE':
      return spec.parts ?? 0;
    default:
      return 0;
  }
}

/**
 * The clips of a move for a camera. A FOCUS bar runs from the camera's focus distance to the end distance; when the
 * move starts from another distance than the camera's (the near part of a rack focus) `setup.focusDistanceMm` says so.
 */
export function expandCameraMove(move: CameraMove, ctx: MoveContext, opts: MoveOptions = {}): ExpandedMove {
  const durationS = opts.durationS ?? move.durationS;
  const t0 = opts.start ?? 0;
  const setup: ExpandedMove['setup'] = {};
  const clips: Omit<MotionClip, 'id'>[] = move.clips.map((spec) => {
    let endFocusMm = 0;
    if (spec.move === 'FOCUS') {
      const f = spec.focus ?? { from: 1, to: 1 };
      const parts = ctx.partDistancesMm;
      const startMm = move.needsParts && parts ? parts[0] : ctx.focusDistanceMm * f.from;
      endFocusMm = move.needsParts && parts ? parts[1] : ctx.focusDistanceMm * f.to;
      if (startMm !== ctx.focusDistanceMm) setup.focusDistanceMm = startMm;
    }
    const clip: Omit<MotionClip, 'id'> = {
      target: { kind: spec.target },
      move: spec.move,
      shot: spec.target === 'CAMERA' ? (opts.shot ?? null) : null,
      start: t0 + spec.start * durationS,
      duration: spec.length * durationS,
      amount: amountOf(spec, ctx, endFocusMm),
      easing: spec.easing ?? move.easing,
    };
    if (spec.move === 'TRACK' && spec.vector) clip.vector = [...spec.vector];
    return clip;
  });
  return { clips, setup, durationS };
}

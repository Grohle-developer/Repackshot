// A scene for measuring focus with a click (phase F1): a fine black and white checker board slanted 45° in depth across
// the whole frame (its depth changes along the frame's diagonal), lit by a flat white environment, without a floor or
// lights, seen through a long lens wide open (135 mm at f/1.4, 600 mm away): the depth of field is a couple of
// millimetres, so a focus a millimetre off moves the sharp band by pixels. The board is two parts (the white tiles and
// the black ones) under one group, so that a focus anchored to a part can be moved with it.
//
// The browser page (tests/browser/focus-page.ts) builds the same state as Node does (tests/focus-measure.ts): the same
// cases give the same scene in both.

import type { CameraAspect } from '../../src/core/aspect';
import { normaliseAspect } from '../../src/core/aspect';
import type { CameraState } from '../../src/core/camera';
import type { MotionClip } from '../../src/core/animation';
import { instanceFromPreset } from '../../src/core/materials';
import { add, normalize, rotateAbout, scale, type Vec3 } from '../../src/core/math';
import { registerMesh, type MeshData } from '../../src/core/meshes';
import { OPTICS_NEUTRAL, type CameraOptics } from '../../src/core/optics';
import type { NodeId, SceneNode } from '../../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../../src/core/store';
import { newTracedLens } from '../../src/core/traced-lens';

/** The board: its side and its tiles, millimetres. */
export const BOARD = { side: 260, tile: 1.3 } as const;
/** The camera: 135 mm at f/1.4, 600 mm from the board's centre, looking along +Y. */
export const FOCUS_CAMERA = { focalMm: 135, fstop: 1.4, distance: 600 } as const;

/** One case of the measurement: the scene's camera and view, as plain data (the page gets it as JSON). */
export interface FocusCase {
  name: string;
  /** The viewport, CSS pixels. */
  view: { w: number; h: number };
  /** The image of the final render (and of the Full view's pixels per CSS pixel: 1). */
  render?: { w: number; h: number };
  /** The active camera's ratio (U13), a preset key; default 16:9. */
  aspect?: string;
  /** O1 optics over the neutral ones. */
  optics?: Partial<CameraOptics>;
  /** O2: a lens of the catalogue, with its artistic overrides. */
  traced?: { key: string; distortion?: number; breathing?: number } | null;
  /** The camera's azimuth (default 0: in front of the board; 180 sees the backs of its tiles). */
  azimuth?: number;
  /** Focal length and f-number over FOCUS_CAMERA's. */
  focalMm?: number;
  fstop?: number;
  /** L4: look through a second, saved camera (its fields over the active camera's), made active = false. */
  lookThrough?: Partial<Omit<CameraState, 'id'>> & { aspectKey?: string };
  /** N1: camera clips and the playhead. */
  clips?: Omit<MotionClip, 'id'>[];
  playhead?: number;
}

/** The two meshes of the board: the tiles of each colour, slanted and placed in world space (the parts sit at the origin). */
function boardMeshes(): { white: MeshData; black: MeshData } {
  const n = Math.round(BOARD.side / BOARD.tile);
  const half = (n * BOARD.tile) / 2;
  // The board faces the camera (normal −Y) and is turned 45° about the frame's diagonal (right + up): its depth grows
  // from the top left of the frame to its bottom right.
  const axis = normalize([1, 0, 1]);
  const turn = (p: Vec3): Vec3 => rotateAbout(p, axis, 45);
  const normal = turn([0, -1, 0]);
  const build = (parity: number): MeshData => {
    const count = Math.ceil((n * n) / 2);
    const positions = new Float32Array(count * 4 * 3);
    const normals = new Float32Array(count * 4 * 3);
    const indices = new Uint32Array(count * 6);
    let q = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if ((i + j) % 2 !== parity) continue;
        const x0 = -half + i * BOARD.tile;
        const z0 = -half + j * BOARD.tile;
        // Counter-clockwise seen from the camera (−Y): x right, z up.
        const corners: Vec3[] = [
          [x0, 0, z0],
          [x0 + BOARD.tile, 0, z0],
          [x0 + BOARD.tile, 0, z0 + BOARD.tile],
          [x0, 0, z0 + BOARD.tile],
        ].map((c) => turn(c as Vec3));
        corners.forEach((c, k) => {
          positions.set(c, (q * 4 + k) * 3);
          normals.set(normal, (q * 4 + k) * 3);
        });
        indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
        q++;
      }
    }
    return { positions: positions.subarray(0, q * 12), normals: normals.subarray(0, q * 12), indices: indices.subarray(0, q * 6) };
  };
  return { white: build(0), black: build(1) };
}

let meshes: { white: ReturnType<typeof registerMesh>; black: ReturnType<typeof registerMesh> } | null = null;
function boardRefs() {
  if (!meshes) {
    const m = boardMeshes();
    meshes = { white: registerMesh('f1:white', m.white), black: registerMesh('f1:black', m.black) };
  }
  return meshes;
}

const node = (id: string, kind: SceneNode['kind'], parent: string | null, children: string[]): SceneNode => ({
  id,
  name: id,
  kind,
  parent,
  children,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  visible: true,
  locked: false,
});

/** The ids of the board's nodes. */
export const FOCUS_PARTS = { board: 'board', white: 'white', black: 'black' } as const;

/** The scene of a case: the board, the flat white environment, the camera, the second camera and the clips. */
export function focusScene(c: FocusCase): ProjectState {
  const refs = boardRefs();
  const materials: ProjectState['materials'] = {};
  const colour = (id: string, rgb: [number, number, number]) => {
    const inst = instanceFromPreset(id, 'ABS_MATTE', 100)!;
    inst.params = { ...inst.params, baseColor: [...rgb, 1], roughness: 1 };
    materials[id] = inst;
  };
  colour('mWhite', [0.8, 0.8, 0.8]);
  colour('mBlack', [0.03, 0.03, 0.03]);
  const nodes: Record<NodeId, SceneNode> = {
    board: node('board', 'MODEL', null, ['white', 'black']),
    white: { ...node('white', 'PART', 'board', []), mesh: refs.white, material: 'mWhite', smooth: false },
    black: { ...node('black', 'PART', 'board', []), mesh: refs.black, material: 'mBlack', smooth: false },
  };
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['board'], materials }, replace: true });
  const render = c.render ?? { w: 480, h: 270 };
  s = reduce(s, { type: 'render/set', patch: { width: render.w, height: render.h } });
  s = reduce(s, { type: 'env/set', patch: { kind: 'FLAT', color: [1, 1, 1, 1], strength: 1, background: 'COLOR', groundShadow: 0, groundReflection: 0 } });
  s = { ...s, studio: { ...s.studio, floor: false, shadow: false, lights: [] } };
  const id = s.camera.active;
  const optics: CameraOptics | undefined =
    c.optics || c.traced ? { ...OPTICS_NEUTRAL, ...(c.optics ?? {}), ...(c.traced ? { traced: { ...newTracedLens(c.traced.key), ...(c.traced.distortion !== undefined ? { distortion: c.traced.distortion } : {}), ...(c.traced.breathing !== undefined ? { breathing: c.traced.breathing } : {}) } } : {}) } : undefined;
  const aspect: CameraAspect = normaliseAspect({ preset: c.aspect ?? '16:9' });
  s = reduce(s, {
    type: 'camera/set',
    id,
    patch: {
      azimuth: c.azimuth ?? 0,
      elevation: 0,
      distance: FOCUS_CAMERA.distance,
      target: [0, 0, 0],
      focalMm: c.focalMm ?? FOCUS_CAMERA.focalMm,
      fstop: c.fstop ?? FOCUS_CAMERA.fstop,
      focusDistance: FOCUS_CAMERA.distance,
      clipStart: 1,
      clipEnd: 100000,
      aspect,
      ...(optics ? { optics } : {}),
    },
  });
  if (c.lookThrough) {
    const { aspectKey, ...rest } = c.lookThrough;
    s = reduce(s, { type: 'camera/add', name: 'Second', from: id });
    const second = s.camera.active;
    s = reduce(s, { type: 'camera/set', id: second, patch: { ...rest, ...(aspectKey ? { aspect: normaliseAspect({ preset: aspectKey }) } : {}) } });
    s = reduce(s, { type: 'camera/activate', id });
  }
  if (c.clips && c.clips.length > 0) {
    s = { ...s, animation: { ...s.animation, shots: [{ id: 's1', duration: 4, camera: null }], clips: c.clips.map((clip, i) => ({ ...clip, id: `c${i + 1}` }) as MotionClip) } };
    s = reduce(s, { type: 'anim/playhead', t: c.playhead ?? 0 });
  }
  return s;
}

/** The saved camera a case looks through (the one that is not active), or null. */
export function lookCameraId(s: ProjectState): string | null {
  return Object.keys(s.camera.cameras).find((k) => k !== s.camera.active) ?? null;
}

/** A point of the board in world space at board coordinates (u, v) in −1..1 (for tests that need one off the axis). */
export function boardPoint(u: number, v: number): Vec3 {
  const half = BOARD.side / 2;
  const axis = normalize([1, 0, 1]);
  return rotateAbout(add(scale([1, 0, 0], u * half), scale([0, 0, 1], v * half)), axis, 45);
}

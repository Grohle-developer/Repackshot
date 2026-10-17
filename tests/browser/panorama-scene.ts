// A scene for the panoramas of K3 (tests/interior-camera.test.ts with the real rt.wasm, tests/panorama-browser.test.ts
// in Chromium): the camera in the middle of a closed cube room whose six walls glow in six colours (+X red, −X cyan,
// +Y green, −Y magenta, +Z blue, −Z yellow), nothing else lit, on black. Where a direction falls on the image (the
// projection's own map, core/panorama.ts `panoramaPoint`) the image must show the colour of the wall that direction
// meets, in the engine's image and in the preview's alike.

import { cameraBasis, type CameraState } from '../../src/core/camera';
import { instanceFromPreset } from '../../src/core/materials';
import { registerMesh } from '../../src/core/meshes';
import type { NodeId, SceneNode } from '../../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../../src/core/store';
import { boxMesh } from './pass-scene';

/** The six test directions (world, Z up), the wall each meets and that wall's colour class (its lit channels). */
export const ROOM_WALLS = [
  { key: '+X', dir: [1, 0, 0], cls: 'R', rgb: [1, 0, 0] },
  { key: '-X', dir: [-1, 0, 0], cls: 'GB', rgb: [0, 1, 1] },
  { key: '+Y', dir: [0, 1, 0], cls: 'G', rgb: [0, 1, 0] },
  { key: '-Y', dir: [0, -1, 0], cls: 'RB', rgb: [1, 0, 1] },
  { key: '+Z', dir: [0, 0, 1], cls: 'B', rgb: [0, 0, 1] },
  { key: '-Z', dir: [0, 0, -1], cls: 'RG', rgb: [1, 1, 0] },
] as const;

/** Half the inside of the room, mm. */
const HALF = 1000;

/** The channels of a colour that are lit: those above half the brightest ('' for black, '?' when one is in between). */
export function colourClass(r: number, g: number, b: number): string {
  const m = Math.max(r, g, b);
  if (!(m > 0)) return '';
  let out = '';
  for (const [name, v] of [['R', r], ['G', g], ['B', b]] as const) {
    if (v > 0.6 * m) out += name;
    else if (v > 0.3 * m) return '?';
  }
  return out;
}

/** The room with its camera at the centre: `patch` sets the projection, the azimuth, the field, the frame. */
export function panoramaRoom(patch: Partial<CameraState>): ProjectState {
  const materials: ProjectState['materials'] = {};
  const nodes: Record<NodeId, SceneNode> = {};
  nodes.room = { id: 'room', name: 'room', kind: 'MODEL', parent: null, children: ROOM_WALLS.map((w) => `w${w.key}`), transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false };
  for (const w of ROOM_WALLS) {
    const id = `w${w.key}`;
    const inst = instanceFromPreset(`m${w.key}`, 'NEON_RED', 100)!;
    inst.params = { ...inst.params, emitColor: [w.rgb[0], w.rgb[1], w.rgb[2], 1], emitPower: 2 };
    materials[`m${w.key}`] = inst;
    // A slab 20 mm thick just outside the room's inside, wide enough to close the corners.
    const size = w.dir.map((d) => (d !== 0 ? 20 : 2 * HALF + 40)) as [number, number, number];
    const position = w.dir.map((d) => d * (HALF + 10)) as [number, number, number];
    nodes[id] = {
      id,
      name: id,
      kind: 'PART',
      parent: 'room',
      children: [],
      transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      mesh: registerMesh(`k3room:${w.key}`, boxMesh(size[0], size[1], size[2])),
      material: `m${w.key}`,
      smooth: false,
    };
  }
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['room'], materials }, replace: true });
  // The camera at the centre: its target 1 m in front of it (the azimuth turns it about Z).
  const azimuth = patch.azimuth ?? 0;
  const elevation = patch.elevation ?? 0;
  const { forward } = cameraBasis(azimuth, elevation);
  const target: [number, number, number] = [forward[0] * 1000, forward[1] * 1000, forward[2] * 1000];
  s = reduce(s, { type: 'camera/set', id: s.camera.active, patch: { azimuth, elevation, distance: 1000, target, focusDistance: 1000, fstop: 0, clipStart: 1, clipEnd: 100000, ...patch } });
  return { ...s, studio: { ...s.studio, floor: false, lights: [] }, environment: { ...s.environment, background: 'COLOR', color: [0, 0, 0, 1], strength: 0 } };
}

/** A world direction in the camera's frame `[forward, right, up]` (the frame the panoramas are mapped in). */
export function cameraFrame(cam: Pick<CameraState, 'azimuth' | 'elevation'>, dir: readonly number[]): [number, number, number] {
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const dot = (a: readonly number[]) => a[0] * dir[0] + a[1] * dir[1] + a[2] * dir[2];
  return [dot(forward), dot(right), dot(up)];
}

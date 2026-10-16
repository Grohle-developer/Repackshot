// The scenes of the M2b region comparison (tests/textures-full-browser.test.ts): the Fast preview draws them in
// Chromium and the engine renders the same states, and the test compares where the texture's cells (or the label)
// fall in the two pictures. Built the same way in the page and in Node.
//
//   checker   a sphere primitive with a red and blue checker in Colour by its UVs, and a box primitive turned 30°
//             about Z with the same checker by a box projection (80 mm repeats, 10 mm cells), on matte white.
//   label     the example bottle with a green label on the front of its body (M2a's label criterion).

import { buildExample } from '../../src/core/example';
import { defaultParams, generatePrimitive } from '../../src/core/primitives';
import { instanceFromPreset } from '../../src/core/materials';
import { getMesh, registerMesh } from '../../src/core/meshes';
import { worldMatrix, type NodeId, type SceneNode } from '../../src/core/scene';
import { transformPoint } from '../../src/core/math';
import { createInitialState, reduce, type ProjectState } from '../../src/core/store';
import { newLabel, newSlot, tangentOf } from '../../src/core/textures';
import type { ImageRef } from '../../src/core/images';
import type { Vec3 } from '../../src/core/math';

const node = (id: string, parent: string | null, children: string[], position: Vec3, rotation: Vec3 = [0, 0, 0]): SceneNode => ({
  id,
  name: id,
  kind: parent ? 'PART' : 'MODEL',
  parent,
  children,
  transform: { position, rotation, scale: [1, 1, 1] },
  visible: true,
  locked: false,
});

/** The checker scene with `image` (the checker's ref, already in the registry); `offset` moves the box's image. */
export function checkerScene(image: ImageRef, width: number, height: number, offset: [number, number] = [0, 0]): ProjectState {
  const sphere = generatePrimitive({ kind: 'SPHERE', params: defaultParams('SPHERE', 120) });
  const box = generatePrimitive({ kind: 'BOX', params: defaultParams('BOX', 120) });
  const matte = (id: string) => {
    const m = instanceFromPreset(id, 'WHITE_STUDIO', 120)!;
    m.params = { ...m.params, baseColor: [1, 1, 1, 1], roughness: 1, coat: 0 };
    return m;
  };
  const ball = matte('mBall');
  ball.textures = { ...ball.textures, color: newSlot('color', image), mapping: { ...ball.textures.mapping, projection: 'UV', repeat: [2, 1], offset } };
  const cube = matte('mBox');
  cube.textures = { ...cube.textures, color: newSlot('color', image), mapping: { ...cube.textures.mapping, projection: 'BOX', sizeMm: 80, offset } };
  const nodes: Record<NodeId, SceneNode> = {
    model: node('model', null, ['ball', 'cube'], [0, 0, 0]),
    ball: { ...node('ball', 'model', [], [-45, 0, 30]), mesh: registerMesh('m2b:ball', sphere.data), material: 'mBall', smooth: true },
    cube: { ...node('cube', 'model', [], [45, 0, 30], [0, 0, 30]), mesh: registerMesh('m2b:cube', box.data), material: 'mBox', smooth: true },
  };
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['model'], materials: { mBall: ball, mBox: cube } }, replace: true });
  s = reduce(s, { type: 'render/set', patch: { width, height } });
  s = reduce(s, { type: 'camera/set', id: s.camera.active, patch: { azimuth: -15, elevation: 18, distance: 420, target: [0, 0, 30], focalMm: 50, fstop: 0 } });
  return s;
}

/** The example bottle with a label of `image` on the front of its body. */
export function labelScene(image: ImageRef, width: number, height: number): ProjectState {
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: buildExample(), replace: true });
  const body = Object.values(s.scene.nodes).find((n) => n.key === 'body')!;
  const mesh = getMesh(body.mesh!.id)!;
  // The body's height, in its own space.
  const n = mesh.positions.length / 3;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < n; i++) {
    zMin = Math.min(zMin, mesh.positions[3 * i + 2]);
    zMax = Math.max(zMax, mesh.positions[3 * i + 2]);
  }
  // Low on the body, under the example's own paper label: where a ray along +Y at that height meets the body's
  // front (part space), as a click there would find it.
  const z = zMin + 0.2 * (zMax - zMin);
  let front = Infinity;
  const p = (i: number): Vec3 => [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [p(mesh.indices[t]), p(mesh.indices[t + 1]), p(mesh.indices[t + 2])];
    // The ray from (0, −10⁴, z) along +Y against the triangle (Möller–Trumbore).
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const d = [0, 1, 0];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-12) continue;
    const o = [0, -1e4, z];
    const sv = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
    const u = (sv[0] * h[0] + sv[1] * h[1] + sv[2] * h[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const hit = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (hit > 0) front = Math.min(front, -1e4 + hit);
  }
  const origin: Vec3 = [0, front, z];
  const normal: Vec3 = [0, -1, 0];
  const material = body.material!;
  s = reduce(s, { type: 'texture/addLabel', material, value: newLabel('lb1', image, { origin, normal, uAxis: tangentOf(normal) }, 0.45 * (zMax - zMin)), label: 'label' });
  s = reduce(s, { type: 'render/set', patch: { width, height } });
  // From the front, close, aimed at the label (its world point): it fills a good part of the frame.
  const world = worldMatrix(s, body.id);
  const target = transformPoint(world, origin) as Vec3;
  const tall = transformPoint(world, [0, 0, zMax])[2] - transformPoint(world, [0, 0, zMin])[2];
  s = reduce(s, { type: 'camera/set', id: s.camera.active, patch: { azimuth: 0, elevation: 4, distance: 3 * tall, target, focalMm: 50, fstop: 0 } });
  return s;
}

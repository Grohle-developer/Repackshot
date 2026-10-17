// The scenes of the M3b region comparison (tests/programs-full-browser.test.ts): each of the ten example graphs of
// M3a on a part where the Fast preview's maps are exactly the graph (not an approximation of it), seen from the
// front, so that what Fast draws and what the engine renders can be compared point by point. Built the same way in
// the page and in Node.
//
//   plate     a plate whose front face is the part's plane y = 0 (x −60..60, z 0..90 mm, 8 mm thick), with UVs on
//             that face: the slice through the part's front that Fast draws for a graph of 3D coordinates is the face
//             itself, a box projection's front face is the face, the UVs are the face's. The metallic paint's plate
//             is a twentieth of that (6 × 4.5 mm), so that Fast's 512² maps and the picture's pixels both hold its
//             flakes of a tenth of a millimetre.
//   cylinder  a cylinder about the part's Z axis (radius 30, 80 mm tall), for the cylindrical label: Fast's maps of
//             a cylindrical projection are the graph whatever the radius.
//
// The light: a flat white world and nothing else (the colour of a surface is its albedo, plus the reflection of the
// same white), except for the brushed metal, whose pattern is in its roughness and its bump: the default studio, its
// lights and dome, where a highlight shows them. The glass has a black wall behind it, so its dust shows against
// what it lets through.
//
// `control` builds the engine's control: the same picture with the pattern moved (the part's own coordinates shifted
// along x, a cell for the checks; the UVs by half a band for the stripes; the cylinder turned half a turn about its
// axis for the label, which then faces away; the plate turned upside down about the camera's line for the glaze,
// whose pattern is a gradient up the part), so that the agreement of the comparison must collapse. Every control
// moves the part's node, not its mesh: the plate and the cylinder are symmetric, and a mesh turned or mirrored in
// its own coordinates is the same surface at the same part coordinates.

import { MATERIAL_GRAPHS } from '../../src/data/material-graphs';
import { instanceFromPreset } from '../../src/core/materials';
import { exampleGraph, registerLabelImage } from '../../src/core/material-examples';
import { registerMesh, type MeshData } from '../../src/core/meshes';
import type { NodeId, SceneNode } from '../../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../../src/core/store';
import type { Vec3 } from '../../src/core/math';

/** The graphs compared, in the order of the examples. */
export const GRAPH_KEYS: readonly string[] = MATERIAL_GRAPHS.map((g) => g.key);

/** The graphs lit by the default studio (their pattern is not in their base colour). */
export const LIT: readonly string[] = ['BRUSHED_SCRATCHED'];

/** The baseline: the plate in the white preset's own material, no graph (the two renderers' own difference of tone). */
export const PLAIN = 'PLAIN';

/** How the control moves the pattern of graph `key`. */
type Control = { kind: 'shift'; mm: number } | { kind: 'uv'; dv: number } | { kind: 'turn'; deg: number } | { kind: 'flip' };
function controlOf(key: string): Control {
  if (key === 'CHECKS') return { kind: 'shift', mm: 12.5 };
  if (key === 'STRIPES') return { kind: 'uv', dv: 0.05 };
  if (key === 'PLASTIC_LABEL') return { kind: 'turn', deg: 180 };
  if (key === 'GLAZED_CERAMIC') return { kind: 'flip' };
  return { kind: 'shift', mm: 23 };
}

export interface Built {
  p: number[];
  n: number[];
  uv: number[];
  i: number[];
}

/** A box face: four corners counter-clockwise seen from outside, its normal, and the UVs of its corners. */
function face(out: Built, corners: Vec3[], normal: Vec3, uv: [number, number][]): void {
  const base = out.p.length / 3;
  for (let k = 0; k < 4; k++) {
    out.p.push(...corners[k]);
    out.n.push(...normal);
    out.uv.push(...uv[k]);
  }
  out.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A box from `lo` to `hi` with UVs over each face (the front, y = lo.y, u along +x and v up), its UVs moved by `dv`. */
export function box(lo: Vec3, hi: Vec3, dv = 0): Built {
  const m: Built = { p: [], n: [], uv: [], i: [] };
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const c = (x: number, y: number, z: number): Vec3 => [x, y, z];
  const uv = (u0: number, u1: number, v0: number, v1: number): [number, number][] => [
    [u0, v0 + dv],
    [u1, v0 + dv],
    [u1, v1 + dv],
    [u0, v1 + dv],
  ];
  face(m, [c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, z1), c(x0, y0, z1)], [0, -1, 0], uv(0, 1, 0, 1));
  face(m, [c(x1, y1, z0), c(x0, y1, z0), c(x0, y1, z1), c(x1, y1, z1)], [0, 1, 0], uv(0, 1, 0, 1));
  face(m, [c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)], [0, 0, 1], uv(0, 1, 0, 0.1));
  face(m, [c(x0, y1, z0), c(x1, y1, z0), c(x1, y0, z0), c(x0, y0, z0)], [0, 0, -1], uv(0, 1, 0, 0.1));
  face(m, [c(x0, y1, z0), c(x0, y0, z0), c(x0, y0, z1), c(x0, y1, z1)], [-1, 0, 0], uv(0, 0.1, 0, 1));
  face(m, [c(x1, y0, z0), c(x1, y1, z0), c(x1, y1, z1), c(x1, y0, z1)], [1, 0, 0], uv(0, 0.1, 0, 1));
  return m;
}

/** The mesh of `m` with its coordinates moved by `d`. */
export function moved(m: Built, d: Vec3 = [0, 0, 0]): MeshData {
  const p = m.p.map((x, k) => x + d[k % 3]);
  return { positions: Float32Array.from(p), normals: Float32Array.from(m.n), indices: Uint32Array.from(m.i), uvs: Float32Array.from(m.uv) };
}

/** The cylinder about Z (radius 30, 80 tall): smooth sides of 96 segments, flat caps. */
export function cylinder(): MeshData {
  const seg = 96;
  const r = 30;
  const h = 80;
  const p: number[] = [];
  const n: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * 2 * Math.PI;
    const [cx, cy] = [Math.cos(a), Math.sin(a)];
    for (const z of [0, h]) {
      p.push(r * cx, r * cy, z);
      n.push(cx, cy, 0);
      uv.push(k / seg, z / h);
    }
  }
  for (let k = 0; k < seg; k++) {
    const a = 2 * k;
    idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
  }
  for (const [z, nz] of [
    [0, -1],
    [h, 1],
  ] as const) {
    const centre = p.length / 3;
    p.push(0, 0, z);
    n.push(0, 0, nz);
    uv.push(0.5, 0.5);
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * 2 * Math.PI;
      p.push(r * Math.cos(a), r * Math.sin(a), z);
      n.push(0, 0, nz);
      uv.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
    }
    for (let k = 0; k < seg; k++) {
      const [a, b] = [centre + 1 + k, centre + 1 + ((k + 1) % seg)];
      if (nz > 0) idx.push(centre, a, b);
      else idx.push(centre, b, a);
    }
  }
  return { positions: Float32Array.from(p), normals: Float32Array.from(n), indices: Uint32Array.from(idx), uvs: Float32Array.from(uv) };
}

const node = (id: string, parent: string | null, children: string[], position: Vec3, extra: Partial<SceneNode> = {}): SceneNode => ({
  id,
  name: id,
  kind: parent ? 'PART' : 'MODEL',
  parent,
  children,
  transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
  visible: true,
  locked: false,
  ...extra,
});

/** The scene of graph `key` (or of the baseline, `PLAIN`) at `width × height`; `control`: the engine's control (the pattern moved). */
export function graphScene(key: string, width: number, height: number, control = false): ProjectState {
  const def = MATERIAL_GRAPHS.find((g) => g.key === key);
  const round = key === 'PLASTIC_LABEL';
  const s0 = key === 'METALLIC_FLAKES' ? 0.05 : 1;
  const c = control ? controlOf(key) : null;
  const dx = c?.kind === 'shift' ? c.mm : 0;
  let data: MeshData;
  if (round) data = cylinder();
  else {
    const plate = box([-60 * s0, 0, 0], [60 * s0, 8 * s0, 90 * s0], c?.kind === 'uv' ? c.dv : 0);
    data = moved(plate, [dx, 0, 0]);
  }
  const mat = instanceFromPreset('mPart', 'WHITE_STUDIO', 120)!;
  const wall = instanceFromPreset('mWall', 'WHITE_STUDIO', 120)!;
  wall.params = { ...wall.params, baseColor: [0, 0, 0, 1], roughness: 1, coat: 0 };
  const glass = key === 'GLASS_DIRT';
  const nodes: Record<NodeId, SceneNode> = {
    model: node('model', null, glass ? ['part', 'wall'] : ['part'], [0, 0, 0]),
    part: node('part', 'model', [], [-dx, 0, 0], { mesh: registerMesh(`m3b:${key}:${control}`, data), material: 'mPart', smooth: true }),
  };
  // The label's control turns the cylinder about its axis; the glaze's turns the plate half a turn about Y and lifts it
  // back into place (part z = 90 − world z): the same surface in the world, the part's coordinates moved under it.
  if (c?.kind === 'turn') nodes.part = { ...nodes.part, transform: { ...nodes.part.transform, rotation: [0, 0, c.deg] } };
  if (c?.kind === 'flip') nodes.part = { ...nodes.part, transform: { ...nodes.part.transform, position: [0, 0, 90], rotation: [0, 180, 0] } };
  if (glass) nodes.wall = node('wall', 'model', [], [0, 0, 0], { mesh: registerMesh('m3b:wall', moved(box([-400, 150, -300], [400, 170, 400]))), material: 'mWall', smooth: true });
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['model'], materials: { mPart: mat, mWall: wall } }, replace: true });
  // The model's ids are the store's own once it is added: the part is the one with the white preset's graph.
  const part = Object.values(s.scene.nodes).find((n) => n.kind === 'PART' && n.name === 'part')!;
  const material = part.material!;
  if (def) {
    s = reduce(s, { type: 'graph/enable', material });
    s = reduce(s, { type: 'graph/set', material, graph: exampleGraph(key, def.labelImage ? registerLabelImage() : null)! });
  }
  s = reduce(s, { type: 'render/set', patch: { width, height } });
  // From the front (the glass at 60°, where Fast takes its Fresnel), the part filling most of the frame.
  const azimuth = glass ? 60 : 0;
  s = reduce(s, { type: 'camera/set', id: s.camera.active, patch: { azimuth, elevation: 0, distance: round ? 240 : 280 * s0, target: [0, 0, round ? 42 : 45 * s0], focalMm: 50, fstop: 0 } });
  if (LIT.includes(key)) return { ...s, studio: { ...s.studio, floor: false, shadow: false } };
  return {
    ...s,
    studio: { ...s.studio, lights: [], floor: false, shadow: false },
    environment: { ...s.environment, kind: 'FLAT', color: [1, 1, 1, 1], strength: 1, background: 'ENVIRONMENT' },
  };
}

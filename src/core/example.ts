// The procedural example part: an original fragrance-style bottle in five
// parts, two of them grouped (the closure), so that every selection level
// has something to select. Plain typed arrays, no three.js: the tests count
// triangles and measure bounds without a GPU.

import type { MaterialId, MaterialInstance } from './materials';
import { instanceFromPreset } from './materials';
import { registerMesh, type MeshData } from './meshes';
import type { ModelPayload, NodeId, SceneNode } from './scene';

/** Roles of the example nodes; the interface supplies their names. */
export type ExampleKey = 'model' | 'closure' | 'base' | 'body' | 'label' | 'collar' | 'cap';

export const EXAMPLE_KEYS: readonly ExampleKey[] = ['model', 'closure', 'base', 'body', 'label', 'collar', 'cap'];

/** Material preset of each example part. */
export const EXAMPLE_MATERIALS: Readonly<Record<'base' | 'body' | 'label' | 'collar' | 'cap', string>> = {
  base: 'ABS_GLOSS',
  body: 'PAINT_MET',
  label: 'PAPER',
  collar: 'CHROME',
  cap: 'GOLD',
};

/** A point of a revolution profile: radius and height in mm. `sharp` splits the normal. */
export interface ProfilePoint {
  r: number;
  z: number;
  sharp?: boolean;
}

/** Arc of a profile, from angle a0 to a1 (degrees) around (cr, cz). */
export function arc(cr: number, cz: number, radius: number, a0: number, a1: number, steps: number): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    out.push({ r: cr + radius * Math.cos(a), z: cz + radius * Math.sin(a) });
  }
  return out;
}

/**
 * Surface of revolution about Z. The profile runs so that its outside is on
 * the right-hand side of the direction of travel (bottom to top for an outer
 * wall), which gives outward normals and counter-clockwise front faces.
 */
export function lathe(profile: readonly ProfilePoint[], segments: number, thetaStartDeg = 0, thetaLengthDeg = 360): MeshData {
  // Expand sharp points into two vertices with the normals of each side.
  type V = { r: number; z: number; nr: number; nz: number; v: number };
  const segNormal = (a: ProfilePoint, b: ProfilePoint): [number, number] => {
    const dr = b.r - a.r;
    const dz = b.z - a.z;
    const l = Math.hypot(dr, dz) || 1;
    return [dz / l, -dr / l];
  };
  const verts: V[] = [];
  let acc = 0;
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i];
    if (i > 0) acc += Math.hypot(p.r - profile[i - 1].r, p.z - profile[i - 1].z);
    const prev = i > 0 ? segNormal(profile[i - 1], p) : null;
    const next = i < profile.length - 1 ? segNormal(p, profile[i + 1]) : null;
    if (p.sharp && prev && next) {
      verts.push({ r: p.r, z: p.z, nr: prev[0], nz: prev[1], v: acc });
      verts.push({ r: p.r, z: p.z, nr: next[0], nz: next[1], v: acc });
    } else {
      const a = prev ?? next!;
      const b = next ?? prev!;
      const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
      verts.push({ r: p.r, z: p.z, nr: (a[0] + b[0]) / l, nz: (a[1] + b[1]) / l, v: acc });
    }
  }
  const total = acc || 1;
  const rings = segments + 1;
  const n = verts.length;
  const positions = new Float32Array(rings * n * 3);
  const normals = new Float32Array(rings * n * 3);
  const uvs = new Float32Array(rings * n * 2);
  for (let j = 0; j < rings; j++) {
    const theta = ((thetaStartDeg + (thetaLengthDeg * j) / segments) * Math.PI) / 180;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    for (let i = 0; i < n; i++) {
      const v = verts[i];
      const k = j * n + i;
      positions[k * 3] = v.r * c;
      positions[k * 3 + 1] = v.r * s;
      positions[k * 3 + 2] = v.z;
      normals[k * 3] = v.nr * c;
      normals[k * 3 + 1] = v.nr * s;
      normals[k * 3 + 2] = v.nz;
      uvs[k * 2] = j / segments;
      uvs[k * 2 + 1] = v.v / total;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < n - 1; i++) {
      const p0 = verts[i];
      const p1 = verts[i + 1];
      if (p0.r === p1.r && p0.z === p1.z) continue; // the two halves of a sharp point
      const a = j * n + i;
      const b = (j + 1) * n + i;
      const c = (j + 1) * n + i + 1;
      const d = j * n + i + 1;
      if (p0.r > 1e-9) idx.push(a, b, c);
      if (p1.r > 1e-9) idx.push(a, c, d);
    }
  }
  return { positions, normals, uvs, indices: new Uint32Array(idx) };
}

/** Radius of the bottle wall, mm. */
const R = 31;
/** Height of the top of the cap, mm. */
export const EXAMPLE_HEIGHT_MM = 121;

/** Elliptic shoulder from the wall (R, 74) to the neck (11, 90). */
function shoulder(): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = ((i / steps) * Math.PI) / 2;
    out.push({ r: 11 + (R - 11) * Math.cos(t), z: 74 + 16 * Math.sin(t), sharp: i === steps });
  }
  return out;
}

function bodyProfile(): ProfilePoint[] {
  return [
    { r: 0, z: 5 },
    { r: R - 4, z: 5 },
    ...arc(R - 4, 9, 4, -90, 0, 6).slice(1),
    ...shoulder(),
    { r: 11, z: 98, sharp: true },
    { r: 0, z: 98 },
  ];
}

function baseProfile(): ProfilePoint[] {
  return [
    { r: 0, z: 0 },
    { r: R - 2.4, z: 0 },
    ...arc(R - 2.4, 3, 3, -90, 0, 6).slice(1),
    { r: R + 0.6, z: 9, sharp: true },
    { r: R - 0.2, z: 9 },
  ];
}

function collarProfile(): ProfilePoint[] {
  return [
    { r: 11.2, z: 90.5 },
    { r: 15.2, z: 90.5, sharp: true },
    { r: 15.2, z: 97, sharp: true },
    { r: 11.2, z: 97, sharp: true },
    { r: 11.2, z: 90.5 },
  ];
}

function capProfile(): ProfilePoint[] {
  return [
    { r: 0, z: 97 },
    { r: 14, z: 97, sharp: true },
    { r: 14, z: 117 },
    ...arc(10, 117, 4, 0, 90, 8).slice(1),
    { r: 0, z: EXAMPLE_HEIGHT_MM },
  ];
}

function labelProfile(): ProfilePoint[] {
  return [
    { r: R + 0.35, z: 22 },
    { r: R + 0.35, z: 60 },
  ];
}

/** Segments around the axis. */
const SEGMENTS = 96;

/**
 * Builds the example model and registers its meshes. Names come from the
 * caller (the interface translates them); missing names fall back to the key.
 * The model origin sits at the centre of its bounds, resting on the floor.
 */
export function buildExample(names: Partial<Record<ExampleKey, string>> = {}): ModelPayload {
  const name = (k: ExampleKey): string => names[k] ?? k;
  const meshes: Record<'base' | 'body' | 'label' | 'collar' | 'cap', MeshData> = {
    base: lathe(baseProfile(), SEGMENTS),
    body: lathe(bodyProfile(), SEGMENTS),
    // Centred on the reference camera (world azimuth -35 is angle -125 from +X).
    label: lathe(labelProfile(), 64, -125 - 70, 140),
    collar: lathe(collarProfile(), SEGMENTS),
    cap: lathe(capProfile(), SEGMENTS),
  };
  const half = EXAMPLE_HEIGHT_MM / 2;
  const nodes: Record<NodeId, SceneNode> = {};
  const materials: Record<MaterialId, MaterialInstance> = {};
  const node = (id: string, kind: SceneNode['kind'], key: ExampleKey, parent: string | null, children: string[], z: number): SceneNode => ({
    id,
    name: name(key),
    kind,
    key,
    parent,
    children,
    transform: { position: [0, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
  });
  nodes.model = { ...node('model', 'MODEL', 'model', null, ['base', 'body', 'label', 'closure'], half), source: { kind: 'EXAMPLE', name: 'bottle' } };
  nodes.closure = node('closure', 'GROUP', 'closure', 'model', ['collar', 'cap'], -half);
  for (const key of ['base', 'body', 'label', 'collar', 'cap'] as const) {
    const parent = key === 'collar' || key === 'cap' ? 'closure' : 'model';
    const ref = registerMesh(`example:${key}`, meshes[key]);
    const matId = `m_${key}`;
    const inst = instanceFromPreset(matId, EXAMPLE_MATERIALS[key], EXAMPLE_HEIGHT_MM);
    if (inst) materials[matId] = inst;
    nodes[key] = {
      ...node(key, 'PART', key, parent, [], parent === 'model' ? -half : 0),
      mesh: ref,
      material: inst ? matId : null,
      smooth: true,
    };
  }
  return { nodes, roots: ['model'], materials };
}


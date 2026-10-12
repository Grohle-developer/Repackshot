// Helpers for the importer tests: read the parts of an ImportResult back as data.

import { applyImportOptions, defaultImportOptions, type AppliedImport, type ImportOptions, type ImportPayload } from '../src/core/import-options';
import { defaultInstance, plainInstance, type MaterialInstance } from '../src/core/materials';
import { getMesh, registerMesh, type MeshData } from '../src/core/meshes';
import type { SceneNode } from '../src/core/scene';
import { importFile, type ImportResult, type ImportSource } from '../src/io/import';

export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** What the tests look at after an import: the payload the store would add, plus what the reader said. */
export type ReadBack = AppliedImport & Pick<ImportResult, 'format' | 'warnings' | 'detected'> & { raw: ImportResult; options: ImportOptions };

/**
 * A file read and the import options applied with the values the sheet starts with (the detected units and
 * up axis), as the interface does when Enter is pressed. `overrides` change single options.
 */
export async function readWithDefaults(file: ImportSource, overrides: Partial<ImportOptions> = {}): Promise<ReadBack> {
  const raw = await importFile(file);
  const options = { ...defaultImportOptions(raw.detected, false), ...overrides };
  const applied = applyImportOptions(raw, options);
  return { ...applied, notes: [...raw.notes, ...applied.notes], format: raw.format, warnings: raw.warnings, detected: raw.detected, raw, options };
}

/** The PART nodes of the single model of a result, in file order. */
export function partsOf(result: Pick<AppliedImport, 'nodes' | 'roots'>): SceneNode[] {
  const model = result.nodes[result.roots[0]];
  return model.children.map((id) => result.nodes[id]);
}

export function meshOf(node: SceneNode): MeshData {
  return getMesh(node.mesh!.id)!;
}

/** Number of different positions in a mesh (to a thousandth of a unit). */
export function distinctPositions(mesh: MeshData): number {
  const seen = new Set<string>();
  for (let i = 0; i < mesh.positions.length; i += 3) seen.add(`${mesh.positions[i].toFixed(3)},${mesh.positions[i + 1].toFixed(3)},${mesh.positions[i + 2].toFixed(3)}`);
  return seen.size;
}

/** Largest deviation from 1 of the length of any normal. */
export function normalLengthError(mesh: MeshData): number {
  let worst = 0;
  for (let i = 0; i < mesh.normals.length; i += 3) worst = Math.max(worst, Math.abs(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]) - 1));
  return worst;
}

/** The sharp edges as [ax, ay, az, bx, by, bz] position pairs, so they can be compared by geometry. */
export function sharpEdgeSegments(mesh: MeshData): number[][] {
  const out: number[][] = [];
  const e = mesh.sharpEdges!;
  const p = mesh.positions;
  for (let i = 0; i < e.length; i += 2) out.push([...p.subarray(3 * e[i], 3 * e[i] + 3), ...p.subarray(3 * e[i + 1], 3 * e[i + 1] + 3)]);
  return out;
}

/** A binary STL from triangles given as 9 numbers each (the facet normal is computed). */
export function binaryStl(triangles: number[][], header = 'binary stl written by the tests'): Uint8Array {
  const out = new Uint8Array(84 + 50 * triangles.length);
  out.set(encode(header).subarray(0, 80), 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => {
    const o = 84 + 50 * i;
    const u = [t[3] - t[0], t[4] - t[1], t[5] - t[2]];
    const v = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n.forEach((x, k) => dv.setFloat32(o + 4 * k, x / l, true));
    t.forEach((x, k) => dv.setFloat32(o + 12 + 4 * k, x, true));
  });
  return out;
}

/** Two rectangular panels meeting along a ridge, `foldDeg` apart in normal direction. Z-up STL axes. */
export function roof(foldDeg: number): number[][] {
  const slope = (foldDeg / 2) * (Math.PI / 180);
  const dx = 10 * Math.cos(slope);
  const dz = -10 * Math.sin(slope);
  // Ridge along x at y = 0; the panels fall away to -y and +y.
  const r1 = [0, 0, 0];
  const r2 = [10, 0, 0];
  const a1 = [0, -dx, dz];
  const a2 = [10, -dx, dz];
  const b1 = [0, dx, dz];
  const b2 = [10, dx, dz];
  return [
    [...r1, ...a1, ...a2],
    [...r1, ...a2, ...r2],
    [...r1, ...r2, ...b2],
    [...r1, ...b2, ...b1],
  ];
}

// --- Payloads built by hand, for the options pipeline ---------------------------------------------

/** A box of w x d x h centred on its own origin: 24 vertices (flat faces), 12 triangles, normals along the axes. */
export function boxData(w: number, d: number, h: number): MeshData {
  const faces: { n: [number, number, number]; c: [number, number, number][] }[] = [
    { n: [1, 0, 0], c: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
    { n: [-1, 0, 0], c: [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]] },
    { n: [0, 1, 0], c: [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]] },
    { n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
    { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], c: [[-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, -1]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  faces.forEach((f, i) => {
    for (const c of f.c) {
      positions.push((c[0] * w) / 2, (c[1] * d) / 2, (c[2] * h) / 2);
      normals.push(...f.n);
    }
    const o = 4 * i;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) };
}

export interface PartSpec {
  name: string;
  size: [number, number, number];
  /** Pivot position (where the node sits). */
  at?: [number, number, number];
  /** Material name (one instance per name; omit for the neutral Default). */
  material?: string;
  /** Triangle runs of another material: [start, count, material name]. */
  ranges?: [number, number, string][];
  visible?: boolean;
  layer?: string;
  /** Name of the group the part sits in (created once per name). */
  group?: string;
}

let payloadCounter = 0;

/** A payload like a reader returns it: one MODEL, optional groups, parts with registered boxes, materials by name. */
export function makePayload(parts: PartSpec[], detected: Partial<ImportPayload['detected']> = {}): ImportPayload {
  const run = ++payloadCounter;
  const nodes: Record<string, SceneNode> = {};
  const materials: Record<string, MaterialInstance> = {};
  const layers: Record<string, string> = {};
  const base = (id: string, name: string, kind: SceneNode['kind'], parent: string | null): SceneNode => ({
    id,
    name,
    kind,
    parent,
    children: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
  });
  nodes.m = { ...base('m', 'model', 'MODEL', null), source: { kind: 'FILE', name: 'model.test', format: 'TEST' } };
  const byName = new Map<string, string>();
  // Like the readers: one SIMPLE instance per name, and the neutral Default for a part without a material.
  const matId = (name?: string): string => {
    if (name === undefined) {
      materials.tm_default ??= defaultInstance('tm_default', 100);
      return 'tm_default';
    }
    let id = byName.get(name);
    if (!id) {
      id = `tm${byName.size + 1}`;
      byName.set(name, id);
      materials[id] = plainInstance(id, name, { baseColor: [0.5, 0.5, 0.5, 1], metallic: 0, roughness: 0.5 });
    }
    return id;
  };
  const groupIds = new Map<string, string>();
  parts.forEach((p, i) => {
    const id = `p${i + 1}`;
    let parent = 'm';
    if (p.group) {
      let g = groupIds.get(p.group);
      if (!g) {
        g = `g${groupIds.size + 1}`;
        groupIds.set(p.group, g);
        nodes[g] = base(g, p.group, 'GROUP', 'm');
        nodes.m.children.push(g);
      }
      parent = g;
    }
    const data = boxData(...p.size);
    const node: SceneNode = { ...base(id, p.name, 'PART', parent), mesh: registerMesh(`test:${run}:${id}`, data), smooth: true, visible: p.visible !== false };
    node.material = matId(p.material);
    if (p.ranges) node.faceMaterials = p.ranges.map(([start, count, m]) => ({ start, count, material: matId(m) }));
    node.transform.position = p.at ?? [0, 0, 0];
    nodes[id] = node;
    nodes[parent].children.push(id);
    if (p.layer) layers[id] = p.layer;
  });
  return {
    nodes,
    roots: ['m'],
    materials,
    layers,
    detected: { units: null, upAxis: 'Z', upAxisDeclared: false, size: 0, hasLayers: Object.keys(layers).length > 0, hiddenParts: parts.filter((p) => p.visible === false).length, ...detected },
  };
}

/** The sheet's defaults for Z up, millimetres, with `overrides`. */
export function optionsFor(overrides: Partial<ImportOptions> = {}): ImportOptions {
  return { ...defaultImportOptions({ units: 'mm', upAxis: 'Z', upAxisDeclared: true, size: 100, hasLayers: false, hiddenParts: 0 }, false), ...overrides };
}

/** The base colour of a material as a plain array. */
export const colorOf = (m: MaterialInstance): number[] => [...(m.params.baseColor ?? [])];

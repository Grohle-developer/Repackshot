// Import options (SPEC §5, UI §2.3): what the import sheet chooses and how a
// model that a reader returned in the file's own units and axes becomes the
// nodes the store adds. Pure: no DOM, no three, no fetch. The only side effect
// is the geometry registry (`core/meshes`): the meshes of the result are
// registered under fresh ids; the ones of the input are left alone (call
// `releaseImport` when the input is no longer needed).
//
// Every reader hands over its model "as the file has it": numbers in the
// units of the file, axes of the file, one MODEL with GROUP and PART nodes,
// the file's materials as SIMPLE instances. The sheet's values are applied
// here, once, the same way for every format:
//
//   1. hidden parts are dropped unless `importHidden`;
//   2. "separate by material" splits a part with face materials into parts;
//   3. the geometry is turned into the model's axes (Y up -> Z up: +Y goes to
//      +Z, the old +Z to -Y, a rotation, so winding is kept) and scaled to
//      millimetres; "flip normals" negates the normals and reverses the winding;
//   4. "group by" rebuilds the hierarchy under the MODEL;
//   5. the material policy keeps the file's materials or applies the Default.
//
// Centre, rest on floor, frame camera and add/replace are store actions the
// interface dispatches after the model is added (src/ui/commands.ts).

import { defaultInstance, triangleMaterials, type MaterialId, type MaterialInstance } from './materials';
import { getMesh, meshRef, positionsBounds, registerMesh, unregisterMesh, type MeshData } from './meshes';
import type { ModelPayload, NodeId, SceneNode } from './scene';

// --- Vocabulary -------------------------------------------------------------------------

/** Units the sheet offers. */
export type ImportUnit = 'mm' | 'cm' | 'm' | 'in';
export const IMPORT_UNITS: readonly ImportUnit[] = ['mm', 'cm', 'm', 'in'];
/** Millimetres in one unit of the file. */
export const UNIT_TO_MM: Readonly<Record<ImportUnit, number>> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

export type UpAxis = 'Y' | 'Z';
export type GroupBy = 'object' | 'material' | 'layer';
/** `face` (by CAD face) needs STEP/IGES topology (phase I2); until then it changes nothing. */
export type SeparateBy = 'none' | 'material' | 'face';
export type MaterialPolicy = 'keep' | 'default';
export type ImportMode = 'add' | 'replace';
/** Reserved for STEP/IGES (phase I2); mesh formats ignore it. */
export type Tessellation = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ImportOptions {
  units: ImportUnit;
  upAxis: UpAxis;
  center: boolean;
  restOnFloor: boolean;
  frameCamera: boolean;
  mode: ImportMode;
  groupBy: GroupBy;
  materials: MaterialPolicy;
  separate: SeparateBy;
  tessellation: Tessellation;
  importHidden: boolean;
  flipNormals: boolean;
}

/** Largest dimension (mm) under which a file without declared units is probably in metres. */
export const SMALL_MODEL_MM = 1;
/** Largest dimension (mm) above which a file is probably in micrometres, or wrong. */
export const LARGE_MODEL_MM = 10_000;

/** What a reader found out about the file; the sheet preselects from it. */
export interface ImportDetected {
  /** Units the file declares, or null when the format does not say (or says one the sheet does not offer). */
  units: ImportUnit | null;
  /** The unit the file declares when it is not one of the four (for the message), e.g. 'feet'. */
  unsupportedUnit?: string;
  /** Up axis of the file: declared (`upAxisDeclared`) or the convention of its format. */
  upAxis: UpAxis;
  upAxisDeclared: boolean;
  /** Largest dimension of the model as read, in file units (0 when empty). */
  size: number;
  /** Parts carry a layer (3DM): "group by layer" means something. */
  hasLayers: boolean;
  /** Parts that are hidden in the file (themselves or through a parent or layer). */
  hiddenParts: number;
}

/** A texture image found in the file, kept for the materials phase (M2); not applied yet. */
export interface ImportTexture {
  name: string;
  /** Which map of the material it fed. */
  slot: 'color' | 'roughness' | 'metal' | 'normal' | 'alpha' | 'other';
  material: MaterialId;
  mime: string;
  blob: Blob;
}

/** Something to tell the person after an import. `code` selects the string `import.msg.<code>`. */
export type ImportMessageCode =
  | 'degenerate'
  | 'badFace'
  | 'partialNormals'
  | 'scaleSmall'
  | 'scaleLarge'
  | 'mtlIgnored'
  | 'brepNoMesh'
  | 'unitsUnsupported'
  | 'axisUnsupported'
  | 'vertexColors'
  | 'usdUnsupported'
  | 'texturesKept';
export interface ImportMessage {
  code: ImportMessageCode;
  params: Record<string, string | number>;
}

/** What a reader returns: a model in the file's units and axes, plus what the sheet needs. */
export interface ImportPayload extends ModelPayload {
  detected: ImportDetected;
  /** Layer of each part (3DM), for "group by layer". */
  layers?: Record<NodeId, string>;
  textures?: ImportTexture[];
}

/** What `applyImportOptions` returns: a payload the store can add, plus the size notes. */
export interface AppliedImport extends ModelPayload {
  textures: ImportTexture[];
  notes: ImportMessage[];
}

// --- Defaults -----------------------------------------------------------------------------

/**
 * The values the sheet starts with: units and up axis from the file; a file that declares no
 * units whose size is under a millimetre is taken as metres (the I1 hint); everything else on.
 */
export function defaultImportOptions(detected: ImportDetected, sceneHasParts: boolean): ImportOptions {
  const guess: ImportUnit = detected.size > 0 && detected.size < SMALL_MODEL_MM ? 'm' : 'mm';
  return {
    units: detected.units ?? guess,
    upAxis: detected.upAxis,
    center: true,
    restOnFloor: true,
    frameCamera: true,
    mode: sceneHasParts ? 'add' : 'replace',
    groupBy: 'object',
    materials: 'keep',
    separate: 'none',
    tessellation: 'MEDIUM',
    importHidden: false,
    flipNormals: false,
  };
}

/** The unit a declared scale to millimetres stands for, or null when the sheet does not offer it. */
export function unitFromMillimetres(mm: number): ImportUnit | null {
  for (const u of IMPORT_UNITS) if (Math.abs(mm - UNIT_TO_MM[u]) <= 1e-6 * UNIT_TO_MM[u]) return u;
  return null;
}

/** Y up to the model's Z up: +Y goes to +Z, +Z to -Y. A rotation, so winding is preserved. */
export function yUpToZUp(x: number, y: number, z: number): [number, number, number] {
  return [x, -z, y];
}

// --- Reading a payload ------------------------------------------------------------------------

function partIdsOf(nodes: Record<NodeId, SceneNode>, roots: readonly NodeId[]): NodeId[] {
  const out: NodeId[] = [];
  const walk = (id: NodeId): void => {
    const n = nodes[id];
    if (!n) return;
    if (n.kind === 'PART') out.push(id);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

/** Counts of a payload: what the sheet shows and the tests pin. */
export function describePayload(p: ModelPayload): { parts: number; groups: number; triangles: number; materials: number } {
  let groups = 0;
  let triangles = 0;
  const parts = partIdsOf(p.nodes, p.roots);
  for (const n of Object.values(p.nodes)) if (n.kind === 'GROUP') groups++;
  for (const id of parts) triangles += p.nodes[id].mesh?.triangles ?? 0;
  return { parts: parts.length, groups, triangles, materials: Object.keys(p.materials).length };
}

/** Largest dimension of the parts of a payload, in the payload's own units (0 when empty). */
export function payloadSize(p: ModelPayload): number {
  return sizeOf(p.nodes, p.roots);
}

function sizeOf(nodes: Record<NodeId, SceneNode>, roots: readonly NodeId[]): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const walk = (id: NodeId, off: readonly number[]): void => {
    const n = nodes[id];
    if (!n) return;
    const here = [off[0] + n.transform.position[0], off[1] + n.transform.position[1], off[2] + n.transform.position[2]];
    if (n.kind === 'PART' && n.mesh) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], here[k] + n.mesh.bounds.min[k]);
        max[k] = Math.max(max[k], here[k] + n.mesh.bounds.max[k]);
      }
    }
    for (const c of n.children) walk(c, here);
  };
  for (const r of roots) walk(r, [0, 0, 0]);
  if (!Number.isFinite(min[0])) return 0;
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

// --- Meshes -----------------------------------------------------------------------------------

let meshCounter = 0;
const freshMeshId = (node: NodeId): string => `import:${++meshCounter}:${node}`;

/** Rotates (Y up to Z up), scales and optionally flips a mesh into a new one. Shares what it does not change. */
function transformMesh(src: MeshData, k: number, swap: boolean, flip: boolean): MeshData {
  const p = new Float32Array(src.positions.length);
  const n = new Float32Array(src.normals.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = src.positions[i];
    const y = src.positions[i + 1];
    const z = src.positions[i + 2];
    if (swap) {
      p[i] = x * k;
      p[i + 1] = -z * k;
      p[i + 2] = y * k;
    } else {
      p[i] = x * k;
      p[i + 1] = y * k;
      p[i + 2] = z * k;
    }
  }
  const s = flip ? -1 : 1;
  for (let i = 0; i < n.length; i += 3) {
    const x = src.normals[i];
    const y = src.normals[i + 1];
    const z = src.normals[i + 2];
    if (swap) {
      n[i] = s * x;
      n[i + 1] = s * -z;
      n[i + 2] = s * y;
    } else {
      n[i] = s * x;
      n[i + 1] = s * y;
      n[i + 2] = s * z;
    }
  }
  let indices = src.indices;
  if (flip) {
    indices = new Uint32Array(src.indices);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
  return { positions: p, normals: n, indices, uvs: src.uvs, sharpEdges: src.sharpEdges };
}

/**
 * The triangles `tris` of a mesh as a mesh of their own, re-centred on its bounds. Vertices are renumbered in
 * order of first use; a hard edge is kept when a kept triangle has both of its vertices.
 */
function sliceMesh(src: MeshData, tris: readonly number[]): { mesh: MeshData; centre: [number, number, number] } {
  const remap = new Map<number, number>();
  const order: number[] = [];
  const indices = new Uint32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t++) {
    for (let j = 0; j < 3; j++) {
      const v = src.indices[3 * tris[t] + j];
      let r = remap.get(v);
      if (r === undefined) {
        r = order.length;
        remap.set(v, r);
        order.push(v);
      }
      indices[3 * t + j] = r;
    }
  }
  const positions = new Float32Array(order.length * 3);
  const normals = new Float32Array(order.length * 3);
  const uvs = src.uvs ? new Float32Array(order.length * 2) : undefined;
  order.forEach((v, r) => {
    positions.set(src.positions.subarray(3 * v, 3 * v + 3), 3 * r);
    normals.set(src.normals.subarray(3 * v, 3 * v + 3), 3 * r);
    if (uvs && src.uvs) uvs.set(src.uvs.subarray(2 * v, 2 * v + 2), 2 * r);
  });
  const b = positionsBounds(positions);
  const centre: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= centre[0];
    positions[i + 1] -= centre[1];
    positions[i + 2] -= centre[2];
  }
  let sharp: Uint32Array | undefined;
  if (src.sharpEdges && src.sharpEdges.length > 0) {
    const edges = new Set<number>();
    const key = (a: number, c: number) => (a < c ? a * order.length + c : c * order.length + a);
    for (let t = 0; t < tris.length; t++) {
      for (let j = 0; j < 3; j++) edges.add(key(indices[3 * t + j], indices[3 * t + ((j + 1) % 3)]));
    }
    const keep: number[] = [];
    for (let e = 0; e < src.sharpEdges.length; e += 2) {
      const a = remap.get(src.sharpEdges[e]);
      const c = remap.get(src.sharpEdges[e + 1]);
      if (a !== undefined && c !== undefined && edges.has(key(a, c))) keep.push(Math.min(a, c), Math.max(a, c));
    }
    sharp = Uint32Array.from(keep);
  }
  return { mesh: { positions, normals, indices, uvs, sharpEdges: sharp }, centre };
}

// --- The pipeline -------------------------------------------------------------------------------

function cloneNode(n: SceneNode): SceneNode {
  return {
    ...n,
    children: [...n.children],
    transform: { position: [...n.transform.position], rotation: [...n.transform.rotation], scale: [...n.transform.scale] },
    ...(n.faceMaterials ? { faceMaterials: n.faceMaterials.map((f) => ({ ...f })) } : {}),
    ...(n.source ? { source: { ...n.source } } : {}),
  };
}

function round3(x: number): number {
  return Number(x.toPrecision(3));
}

function materialLabel(m: MaterialInstance | undefined): string {
  if (!m) return 'Default';
  return m.name ?? (m.role === 'DEFAULT' ? 'Default' : 'Material');
}

/**
 * Turns a model as a reader returned it into the payload the store adds, applying the sheet's options.
 * Does not touch `input`; registers the new meshes it makes (those that need no change are shared).
 */
export function applyImportOptions(input: ImportPayload, options: ImportOptions): AppliedImport {
  const nodes: Record<NodeId, SceneNode> = {};
  for (const [id, n] of Object.entries(input.nodes)) nodes[id] = cloneNode(n);
  const roots = [...input.roots];
  const layers: Record<NodeId, string> = { ...(input.layers ?? {}) };
  let materials: Record<MaterialId, MaterialInstance> = { ...input.materials };

  // 1. Hidden parts.
  if (!options.importHidden) {
    const dropped = (id: NodeId, hidden: boolean): boolean => {
      const n = nodes[id];
      if (!n) return true;
      const h = hidden || n.visible === false;
      if (n.kind === 'PART') return h;
      n.children = n.children.filter((c) => !dropped(c, h));
      return n.kind !== 'MODEL' && n.children.length === 0;
    };
    for (let i = roots.length - 1; i >= 0; i--) {
      const root = nodes[roots[i]];
      if (dropped(roots[i], false) || (root && root.children.length === 0)) roots.splice(i, 1);
    }
    // Forget what is no longer reachable.
    const reach = new Set<NodeId>();
    const mark = (id: NodeId): void => {
      reach.add(id);
      for (const c of nodes[id]?.children ?? []) mark(c);
    };
    roots.forEach(mark);
    for (const id of Object.keys(nodes)) if (!reach.has(id)) delete nodes[id];
  }

  // 2 + 3. Separate by material, then the geometry into the model's axes and millimetres.
  const k = UNIT_TO_MM[options.units];
  const swap = options.upAxis === 'Y';
  const move = (p: readonly number[]): [number, number, number] => (swap ? [p[0] * k, -p[2] * k, p[1] * k] : [p[0] * k, p[1] * k, p[2] * k]);
  const convert = k !== 1 || swap || options.flipNormals;
  /** Moves a node into the model's axes and units; `fresh` meshes (slices) are registered even when unchanged. */
  const place = (id: NodeId, node: SceneNode, data: MeshData | undefined, fresh: boolean): void => {
    node.transform.position = move(node.transform.position);
    if (!node.mesh || !data || (!convert && !fresh)) return;
    node.mesh = registerMesh(freshMeshId(id), convert ? transformMesh(data, k, swap, options.flipNormals) : data);
  };
  for (const id of partIdsOf(nodes, roots)) {
    const node = nodes[id];
    const data = node.mesh ? getMesh(node.mesh.id) : undefined;
    const per = options.separate === 'material' && data && node.mesh ? triangleMaterials(node) : null;
    const groups = new Map<MaterialId | '', number[]>();
    if (per) per.forEach((m, t) => (groups.get(m ?? '') ?? groups.set(m ?? '', []).get(m ?? '')!).push(t));
    if (!per || !data || groups.size < 2) {
      place(id, node, data, false);
      continue;
    }
    // Replace the part by one part per material, in order of first appearance.
    const parent = nodes[node.parent ?? ''];
    const created: NodeId[] = [];
    let i = 0;
    for (const [mat, tris] of groups) {
      const slice = sliceMesh(data, tris);
      const sid = `${id}.${++i}`;
      const sub = cloneNode(node);
      sub.id = sid;
      sub.name = mat === '' ? node.name : `${node.name} (${materialLabel(materials[mat])})`;
      sub.material = mat === '' ? null : mat;
      delete sub.faceMaterials;
      sub.transform.position = [node.transform.position[0] + slice.centre[0], node.transform.position[1] + slice.centre[1], node.transform.position[2] + slice.centre[2]];
      sub.mesh = meshRef(sid, slice.mesh);
      nodes[sid] = sub;
      if (layers[id] !== undefined) layers[sid] = layers[id];
      place(sid, sub, slice.mesh, true);
      created.push(sid);
    }
    if (parent) parent.children = parent.children.flatMap((c) => (c === id ? created : [c]));
    delete nodes[id];
    delete layers[id];
  }
  // Models and groups carry no geometry; their offsets (identity from the readers) follow the same rule.
  for (const n of Object.values(nodes)) if (n.kind !== 'PART') n.transform.position = move(n.transform.position);

  // 4. Group by.
  if (options.groupBy === 'material' || (options.groupBy === 'layer' && input.detected.hasLayers)) {
    for (const rootId of roots) regroup(nodes, rootId, options.groupBy, materials, layers);
  }

  // 5. Materials.
  let policyDefault: MaterialInstance | null = null;
  if (options.materials === 'default') {
    policyDefault = defaultInstance('tm_default', 100);
    for (const id of partIdsOf(nodes, roots)) {
      nodes[id].material = 'tm_default';
      delete nodes[id].faceMaterials;
    }
    materials = {};
  } else {
    const used = new Set<MaterialId>();
    for (const id of partIdsOf(nodes, roots)) {
      const n = nodes[id];
      if (n.material) used.add(n.material);
      for (const f of n.faceMaterials ?? []) used.add(f.material);
    }
    materials = Object.fromEntries(Object.entries(materials).filter(([m]) => used.has(m)));
  }
  if (policyDefault) materials = { tm_default: policyDefault };

  // 6. Size notes and the Doctor's hint, on the final size.
  const sizeMm = sizeOf(nodes, roots);
  const notes: ImportMessage[] = [];
  let hint: 1000 | 0.001 | null = null;
  if (sizeMm > 0 && sizeMm < SMALL_MODEL_MM) {
    notes.push({ code: 'scaleSmall', params: { size: round3(sizeMm), factor: 1000 } });
    hint = 1000;
  } else if (sizeMm > LARGE_MODEL_MM) {
    notes.push({ code: 'scaleLarge', params: { size: round3(sizeMm), factor: 0.001 } });
    hint = 0.001;
  }
  for (const r of roots) {
    const model = nodes[r];
    if (!model?.source) continue;
    delete model.source.unitHint;
    if (hint) model.source.unitHint = hint;
  }
  const used = new Set(Object.keys(materials));
  const textures = options.materials === 'default' ? [] : (input.textures ?? []).filter((t) => used.has(t.material));
  return { nodes, roots, materials, textures, notes };
}

/** Rebuilds the hierarchy under a MODEL as one group per material or per layer, in order of first appearance. */
function regroup(nodes: Record<NodeId, SceneNode>, rootId: NodeId, by: 'material' | 'layer', materials: Record<MaterialId, MaterialInstance>, layers: Record<NodeId, string>): void {
  const root = nodes[rootId];
  if (!root) return;
  const parts = partIdsOf(nodes, [rootId]);
  const keyOf = (id: NodeId): string | null => {
    if (by === 'layer') return layers[id] ?? null;
    const n = nodes[id];
    return n.material ?? n.faceMaterials?.[0]?.material ?? null;
  };
  const labelOf = (key: string): string => (by === 'layer' ? key : materialLabel(materials[key]));
  // Old groups go; parts without a key stay directly under the model.
  for (const [id, n] of Object.entries(nodes)) if (n.kind === 'GROUP' && partsBelong(nodes, id, rootId)) delete nodes[id];
  const groupOf = new Map<string, NodeId>();
  const children: NodeId[] = [];
  for (const id of parts) {
    const key = keyOf(id);
    if (key === null) {
      nodes[id].parent = rootId;
      children.push(id);
      continue;
    }
    let g = groupOf.get(key);
    if (!g) {
      g = `grp:${by}:${groupOf.size + 1}`;
      groupOf.set(key, g);
      nodes[g] = {
        id: g,
        name: labelOf(key),
        kind: 'GROUP',
        parent: rootId,
        children: [],
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        locked: false,
      };
      children.push(g);
    }
    nodes[g].children.push(id);
    nodes[id].parent = g;
  }
  root.children = children;
}

/** Whether `id` is below `rootId` (by walking up). */
function partsBelong(nodes: Record<NodeId, SceneNode>, id: NodeId, rootId: NodeId): boolean {
  let cur: NodeId | null = id;
  while (cur) {
    if (cur === rootId) return true;
    cur = nodes[cur]?.parent ?? null;
  }
  return false;
}

/** Forgets the registered meshes of a payload that was not (or no longer is) used; `keep` lists the ones to spare. */
export function releaseImport(raw: ModelPayload, keep?: ModelPayload): void {
  const spare = new Set<string>();
  for (const n of Object.values(keep?.nodes ?? {})) if (n.mesh) spare.add(n.mesh.id);
  for (const n of Object.values(raw.nodes)) if (n.mesh && !spare.has(n.mesh.id)) unregisterMesh(n.mesh.id);
}

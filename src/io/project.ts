// The .repack.json project file (ARCHITECTURE §8): the state, and next to it the geometry the state refers to.
//
//   {
//    "format": "repackshot-project",
//    "schema": 2,
//    "state": { ...ProjectState, as the store has it },
//    "meshes": [ { "id": "stl:1:n3", "glb": "<base64>", "sharpEdges": "<base64>", "triangleSource": "<base64>" }, ... ]
//   }
//
// The state keeps only a `MeshRef` per part (id, counts, bounds: core/meshes.ts), so each mesh that a part uses
// is written once, whoever shares it, as a GLB in base64 (io/glb.ts: positions, normals, UVs and indices, bit
// for bit). What glTF has no place for travels beside the GLB: `sharpEdges` (the hard edges, little-endian
// uint32 pairs, base64; an empty string is "has the field, no edges") and `triangleSource` (the triangle map of
// a mesh made by re-smoothing, which keeps face materials right afterwards). Fields a later version adds to an
// entry are ignored by this reader.
//
// `schema` versions the state. The meshes block is an addition of the envelope that older files (schema 1, and
// the schema-2 files written before this block) do not have: they load without geometry (the example's is
// regenerated, anything else is reported as missing) so they keep opening in every version.
//
// Schema history (each step a pure function over the state, applied in order on load):
//   1 (U1) — the state as it was.
//   2 (U5) — `render` is the render window's settings and a queue of full `RenderJob`s (core/render.ts
//            `migrateRender`).
//
// Opening is all or nothing: the text is read and checked (envelope, schema, state, meshes) before the registry
// or the store are touched, so a damaged file leaves the open project as it was.

import { runDoctor } from '../core/doctor';
import { buildExample } from '../core/example';
import {
  getMesh,
  registerMesh,
  setTriangleSource,
  triangleSource,
  unregisterMesh,
  type MeshData,
  type MeshId,
} from '../core/meshes';
import { migrateRender } from '../core/render';
import { cleanSelection, meshIdsInUse, type SceneNode } from '../core/scene';
import { emptyBox } from '../core/math';
import { createInitialState, type ProjectState } from '../core/store';
import { baseMeshId } from '../core/transform';
import { base64ToBytes, bytesToBase64 } from './base64';
import { glbToMesh, meshToGlb, packUint32, unpackUint32 } from './glb';

export const PROJECT_FORMAT = 'repackshot-project';
export const PROJECT_SCHEMA = 2;

/** Why a file did not open. The interface turns the code into a sentence in the language of the person. */
export type ProjectErrorCode = 'NOT_A_PROJECT' | 'NEWER_VERSION' | 'DAMAGED' | 'TOO_LARGE';

export class ProjectError extends Error {
  constructor(
    readonly code: ProjectErrorCode,
    message: string,
    /** NEWER_VERSION: the schema the file has. */
    readonly schema?: number,
  ) {
    super(message);
    this.name = 'ProjectError';
  }
}

const damaged = (detail: string): ProjectError => new ProjectError('DAMAGED', detail);

// --- Writing -----------------------------------------------------------------------------------------------

/** What stands in for a negative zero while the state is turned into text. */
const NEGATIVE_ZERO = '__repackshot_negative_zero__';

/**
 * The state as indented JSON. `JSON.stringify` writes -0 as 0, and the importers do produce negative zeros
 * (`-z` of a model's axis swap): they are written as the literal `-0`, which JSON allows and `JSON.parse`
 * reads back, so the state that comes out of a file is the one that went in.
 */
function stateJson(state: ProjectState): string {
  return JSON.stringify(state, (_key, v: unknown) => (v === 0 && 1 / v < 0 ? NEGATIVE_ZERO : v), 1).replaceAll(`"${NEGATIVE_ZERO}"`, '-0');
}

/** One entry of the `meshes` block, as a line of JSON. */
function meshEntry(id: MeshId, data: MeshData): string {
  const entry: Record<string, string> = { id, glb: bytesToBase64(meshToGlb(id, data)) };
  if (data.sharpEdges) entry.sharpEdges = bytesToBase64(packUint32(data.sharpEdges));
  const source = triangleSource(id);
  if (source) entry.triangleSource = bytesToBase64(packUint32(source));
  return JSON.stringify(entry);
}

/**
 * The project as a file: the state and every mesh its parts use. The file is built from pieces (one per mesh),
 * never one big string, so a model of millions of triangles costs time and memory linear in its size. A part
 * whose geometry is not in the registry (a project opened without it) is written without it.
 */
export function serializeProject(state: ProjectState): Blob {
  // A file on disk is by definition the saved state: the flag is written clean.
  const clean: ProjectState = state.meta.dirty ? { ...state, meta: { ...state.meta, dirty: false } } : state;
  const parts: string[] = [
    `{\n "format": ${JSON.stringify(PROJECT_FORMAT)},\n "schema": ${PROJECT_SCHEMA},\n "state": `,
    stateJson(clean).replace(/\n/g, '\n '),
    ',\n "meshes": [',
  ];
  let first = true;
  for (const id of meshIdsInUse(state)) {
    const data = getMesh(id);
    if (!data) continue;
    try {
      parts.push(`${first ? '' : ','}\n  ${meshEntry(id, data)}`);
    } catch (err) {
      // A string longer than the engine allows (about half a gigabyte): one mesh that big cannot be embedded.
      if (err instanceof RangeError) throw new ProjectError('TOO_LARGE', `mesh ${id} is too large to save in a project file`);
      throw err;
    }
    first = false;
  }
  parts.push(first ? ']\n}\n' : '\n ]\n}\n');
  return new Blob(parts, { type: 'application/json' });
}

// --- Migration and checks ----------------------------------------------------------------------------------

type RawState = Record<string, unknown>;

/** One step per schema: the state of schema `n` to schema `n + 1`. */
export const STEPS: Record<number, (state: RawState) => RawState> = {
  // U1 → U5: the render block (settings, full jobs; nothing runs after a load).
  1: (state) => ({ ...state, render: migrateRender(state.render) }),
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isVec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The kind of a JSON value, for comparing a block of a file with the block of a new project. */
const kindOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * Looks at the blocks of a state the way the interface will: the right kinds of value, a consistent scene tree,
 * and every reference (material, camera, mesh) pointing at something. It is a structural check of what could
 * crash the interface, not a schema validator: numbers inside a material are the material's business.
 * Blocks and fields a file lacks (a project from before they existed) are filled with the defaults of a new
 * project; a field of the wrong kind is damage.
 */
function checkState(raw: RawState): ProjectState {
  const fresh = createInitialState() as unknown as RawState;
  const state: RawState = { ...raw };
  for (const key of Object.keys(fresh)) {
    const want = fresh[key];
    const have = state[key];
    if (have === undefined) {
      state[key] = want;
      continue;
    }
    if (key === 'render') continue; // normalised by migrateRender
    if (kindOf(have) !== kindOf(want)) throw damaged(`${key} has the wrong kind of value (expected ${kindOf(want)})`);
    if (isObject(want) && isObject(have)) {
      const block: RawState = { ...have };
      for (const k of Object.keys(want)) {
        if (block[k] === undefined) block[k] = want[k];
        else if (want[k] !== null && kindOf(block[k]) !== kindOf(want[k])) throw damaged(`${key}.${k} has the wrong kind of value (expected ${kindOf(want[k])})`);
      }
      state[key] = block;
    }
  }
  const s = state as unknown as ProjectState;

  // The scene tree.
  const nodes = s.scene.nodes;
  if (!isObject(nodes)) throw damaged('scene.nodes is not a list of nodes');
  if (!isIdList(s.scene.roots)) throw damaged('scene.roots is not a list of ids');
  const KINDS = new Set(['MODEL', 'GROUP', 'PART', 'CAMERA', 'LIGHT', 'FLOOR']);
  const emptied: Record<string, SceneNode> = {};
  for (const [id, n] of Object.entries(nodes) as [string, SceneNode][]) {
    const at = `scene.nodes.${id}`;
    if (!isObject(n) || n.id !== id) throw damaged(`${at} is not a node`);
    if (typeof n.name !== 'string' || !KINDS.has(n.kind) || typeof n.visible !== 'boolean') throw damaged(`${at} lacks its name, kind or visibility`);
    if (!isIdList(n.children)) throw damaged(`${at}.children is not a list of ids`);
    if (!isObject(n.transform) || !isVec3(n.transform.position) || !isVec3(n.transform.rotation) || !isVec3(n.transform.scale)) throw damaged(`${at}.transform is damaged`);
    if (n.parent !== null && (typeof n.parent !== 'string' || !nodes[n.parent])) throw damaged(`${at} has a parent that does not exist`);
    for (const c of n.children) {
      if (!nodes[c]) throw damaged(`${at} lists a child that does not exist`);
      if (nodes[c].parent !== id) throw damaged(`${at} and its child ${c} disagree on who the parent is`);
    }
    if (n.parent !== null && !nodes[n.parent].children.includes(id)) throw damaged(`${at} is not a child of its parent`);
    if (n.mesh !== undefined) {
      const m = n.mesh;
      const b = isObject(m) ? m.bounds : undefined;
      // The bounds of a mesh with no vertices are infinite, which JSON writes as null: they come back as that.
      const corner = (v: unknown): v is (number | null)[] => Array.isArray(v) && v.length === 3 && v.every((x) => x === null || (typeof x === 'number' && Number.isFinite(x)));
      if (!isObject(m) || typeof m.id !== 'string' || !Number.isInteger(m.vertices) || !Number.isInteger(m.triangles) || !isObject(b) || !corner(b.min) || !corner(b.max)) throw damaged(`${at}.mesh is damaged`);
      if ((b.min as unknown[]).includes(null) || (b.max as unknown[]).includes(null)) emptied[id] = { ...n, mesh: { ...m, bounds: emptyBox() } };
    }
    if (n.material !== undefined && n.material !== null && !isObject(s.materials[n.material])) throw damaged(`${at} uses a material that does not exist`);
    if (n.faceMaterials !== undefined) {
      if (!Array.isArray(n.faceMaterials)) throw damaged(`${at}.faceMaterials is not a list`);
      for (const f of n.faceMaterials) if (!isObject(f) || !Number.isInteger(f.start) || !Number.isInteger(f.count) || !isObject(s.materials[f.material])) throw damaged(`${at}.faceMaterials is damaged`);
    }
  }
  for (const r of s.scene.roots) if (!nodes[r] || nodes[r].parent !== null) throw damaged(`scene.roots names ${r}, which is not a top-level node`);
  // No cycles: walking up from any node ends at a root within as many steps as there are nodes.
  const count = Object.keys(nodes).length;
  for (const id of Object.keys(nodes)) {
    let at: string | null = id;
    for (let steps = 0; at !== null; steps++) {
      if (steps > count) throw damaged(`the scene tree loops at ${id}`);
      at = nodes[at].parent;
    }
  }
  if (Object.keys(emptied).length > 0) s.scene = { ...s.scene, nodes: { ...nodes, ...emptied } };
  if (!isObject(s.materials)) throw damaged('materials is not a list of materials');
  for (const [id, m] of Object.entries(s.materials)) if (!isObject(m) || m.id !== id) throw damaged(`materials.${id} is not a material`);
  if (!isObject(s.camera.cameras) || !isObject(s.camera.cameras[s.camera.active])) throw damaged('camera.active is not a camera');
  for (const [id, c] of Object.entries(s.camera.cameras)) if (!isObject(c) || c.id !== id) throw damaged(`camera.cameras.${id} is not a camera`);
  if (!Array.isArray(s.studio.lights) || s.studio.lights.some((l) => !isObject(l) || typeof l.id !== 'string')) throw damaged('studio.lights is damaged');
  if (!Array.isArray(s.selection.ids)) throw damaged('selection.ids is not a list');
  return s;
}

/** The envelope of a parsed file and the state it holds, migrated to the current schema and checked. */
function readEnvelope(body: unknown): { state: ProjectState; meshes: unknown } {
  if (!isObject(body) || body.format !== PROJECT_FORMAT) throw new ProjectError('NOT_A_PROJECT', 'not a Repackshot project');
  // A file without `schema` is a hand-made one; the first schema is the oldest there is.
  const schema = body.schema === undefined ? 1 : body.schema;
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) throw damaged('the project has no valid schema number');
  if (schema > PROJECT_SCHEMA) throw new ProjectError('NEWER_VERSION', `the project was saved by a newer version (schema ${schema})`, schema);
  if (!isObject(body.state)) throw damaged('the project has no state');
  let state: RawState = body.state;
  for (let n = schema; n < PROJECT_SCHEMA; n++) state = STEPS[n](state);
  const checked = checkState({ ...state, render: migrateRender(state.render) });
  // A file is the saved state, and nothing plays or renders after a load.
  const loaded: ProjectState = {
    ...checked,
    meta: { ...checked.meta, dirty: false },
    animation: { ...checked.animation, playing: false },
  };
  return { state: loaded, meshes: body.meshes };
}

/**
 * A parsed project file to the state it holds (no geometry: see `loadProject`): checks the envelope, runs the
 * migration steps from its schema up and checks the result. Throws a `ProjectError` when the file is not a
 * project, comes from a newer version or is damaged.
 */
export function migrateProject(body: unknown): ProjectState {
  return cleanSelection(readEnvelope(body).state);
}

function parseText(text: string): unknown {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    // A project that was cut short still starts like one; a text file of anything else does not.
    if (text.slice(0, 2000).includes(`"${PROJECT_FORMAT}"`)) throw damaged('the file is cut short or its JSON is damaged');
    throw new ProjectError('NOT_A_PROJECT', 'not a Repackshot project');
  }
}

/** The text of a .repack.json file to its state, without geometry (see `migrateProject`). */
export function parseProject(text: string): ProjectState {
  return migrateProject(parseText(text));
}

// --- Meshes ------------------------------------------------------------------------------------------------

interface DecodedMesh {
  data: MeshData;
  source: Uint32Array | null;
}

function decodeMesh(entry: unknown, index: number): { id: MeshId; mesh: DecodedMesh } {
  if (!isObject(entry) || typeof entry.id !== 'string' || entry.id === '' || typeof entry.glb !== 'string') throw damaged(`meshes[${index}] is not a mesh`);
  const id = entry.id;
  const fail = (why: string): ProjectError => damaged(`mesh ${id}: ${why}`);
  let glb;
  try {
    glb = glbToMesh(base64ToBytes(entry.glb));
  } catch (err) {
    throw fail(err instanceof Error ? err.message : String(err));
  }
  const { positions, normals, indices, uvs } = glb.mesh;
  const vertices = positions.length / 3;
  if (!Number.isInteger(vertices) || normals.length !== positions.length || indices.length % 3 !== 0 || (uvs && uvs.length !== 2 * vertices)) throw fail('the arrays do not fit together');
  for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i]) || !Number.isFinite(normals[i])) throw fail('a position or normal is not a number');
  for (let i = 0; i < indices.length; i++) if (indices[i] >= vertices) throw fail('a triangle uses a vertex that does not exist');
  const optional = (field: 'sharpEdges' | 'triangleSource'): Uint32Array | undefined => {
    const text = entry[field];
    if (text === undefined) return undefined;
    try {
      if (typeof text !== 'string') throw new Error('not text');
      return unpackUint32(base64ToBytes(text));
    } catch {
      throw fail(`${field} is damaged`);
    }
  };
  const sharpEdges = optional('sharpEdges');
  if (sharpEdges && (sharpEdges.length % 2 !== 0 || sharpEdges.some((v) => v >= vertices))) throw fail('sharpEdges does not fit the mesh');
  const source = optional('triangleSource') ?? null;
  if (source && source.length !== indices.length / 3) throw fail('triangleSource does not fit the mesh');
  return { id, mesh: { data: { positions, normals, indices, ...(uvs ? { uvs } : {}), ...(sharpEdges ? { sharpEdges } : {}) }, source } };
}

function decodeMeshes(block: unknown): Map<MeshId, DecodedMesh> {
  const out = new Map<MeshId, DecodedMesh>();
  if (block === undefined) return out;
  if (!Array.isArray(block)) throw damaged('meshes is not a list');
  block.forEach((entry, i) => {
    const { id, mesh } = decodeMesh(entry, i);
    if (out.has(id)) throw damaged(`mesh ${id} is in the file twice`);
    out.set(id, mesh);
  });
  return out;
}

const sameBytes = (a: ArrayBufferView | undefined, b: ArrayBufferView | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b;
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

/** The same geometry, bit for bit. */
export function sameMesh(a: MeshData, b: MeshData): boolean {
  return sameBytes(a.positions, b.positions) && sameBytes(a.normals, b.normals) && sameBytes(a.indices, b.indices) && sameBytes(a.uvs, b.uvs) && sameBytes(a.sharpEdges, b.sharpEdges);
}

/** Loads of this session: the prefix of the ids a file's meshes get when their own are taken. */
let loads = 0;

/**
 * Registers the meshes of a loaded project under ids that name them alone. A mesh id is a promise that the id
 * means one geometry for as long as it is registered (the preview and the workers cache by it), and a file's ids
 * are only unique inside the file: the importers number from 1 in every session. So a mesh keeps its id only
 * when the registry already holds exactly that geometry under it (opening the file just saved, the example);
 * otherwise the whole family of ids that share a base (`stl:1:n3`, `stl:1:n3~flip`) moves to a fresh `prjN:`
 * prefix, which no importer makes. Returns the state with its mesh refs updated; `registered` collects the ids it
 * registered, so the caller can take them back if the load fails after this.
 */
function placeMeshes(state: ProjectState, decoded: Map<MeshId, DecodedMesh>, registered: MeshId[]): { state: ProjectState; missing: number } {
  const wanted = meshIdsInUse(state);
  // Files from before the meshes block: the example's geometry is code, the rest is gone.
  let regenerated = false;
  for (const id of wanted) {
    if (decoded.has(id) || getMesh(id) || !id.startsWith('example:') || regenerated) continue;
    buildExample();
    regenerated = true;
  }
  // The counts in the state must be the counts of the geometry in the file.
  for (const n of Object.values(state.scene.nodes)) {
    const d = n.mesh ? decoded.get(n.mesh.id) : undefined;
    if (n.mesh && d && (d.data.positions.length / 3 !== n.mesh.vertices || d.data.indices.length / 3 !== n.mesh.triangles)) {
      throw damaged(`mesh ${n.mesh.id} does not have the vertices and triangles that ${n.name} says`);
    }
  }

  const families = new Map<string, MeshId[]>();
  for (const id of decoded.keys()) {
    if (!wanted.has(id)) continue; // not used by any part: not worth keeping
    const base = baseMeshId(id);
    families.set(base, [...(families.get(base) ?? []), id]);
  }
  const rename = new Map<MeshId, MeshId>();
  for (const [base, ids] of families) {
    const kept = ids.every((id) => {
      const have = getMesh(id);
      return have !== undefined && sameMesh(have, decoded.get(id)!.data);
    });
    if (kept) continue;
    const stem = base.replace(/^prj\d+:/, '');
    let next = '';
    do {
      next = `prj${++loads}:${stem}`;
    } while (ids.some((id) => getMesh(next + id.slice(base.length))));
    for (const id of ids) rename.set(id, next + id.slice(base.length));
  }
  for (const id of wanted) {
    const d = decoded.get(id);
    const target = rename.get(id);
    if (!d || target === undefined) continue; // no geometry in the file, or its own id is free and identical
    registerMesh(target, d.data);
    setTriangleSource(target, d.source);
    registered.push(target);
  }
  // The refs keep what the file says (counts and bounds were checked / are the geometry's); only the id moves.
  const nodes: Record<string, SceneNode> = { ...state.scene.nodes };
  let missing = 0;
  for (const [key, n] of Object.entries(state.scene.nodes)) {
    if (!n.mesh) continue;
    const target = rename.get(n.mesh.id);
    if (target !== undefined) nodes[key] = { ...n, mesh: { ...n.mesh, id: target } };
    // A part whose geometry no file or code can give stays in the scene without it (the preview skips it).
    if (!getMesh(target ?? n.mesh.id)) missing++;
  }
  return { state: { ...state, scene: { ...state.scene, nodes } }, missing };
}

/** What a load noticed and the person should hear about. */
export interface ProjectWarning {
  /** Parts whose geometry is not in the file (a project from before the meshes block, other than the example). */
  code: 'MISSING_MESHES';
  count: number;
}

export interface LoadedProject {
  state: ProjectState;
  warnings: ProjectWarning[];
}

/**
 * The text of a .repack.json file to a project ready for `store.reset`: the state, migrated and checked, with its
 * meshes registered. Throws a `ProjectError` and leaves the registry as it was when the file cannot be loaded.
 */
export function loadProject(text: string): LoadedProject {
  const registered: MeshId[] = [];
  try {
    const { state, meshes } = readEnvelope(parseText(text));
    const placed = placeMeshes(state, decodeMeshes(meshes), registered);
    const checked = cleanSelection(placed.state);
    // The Doctor's findings follow the model and the catalogue of this version, not the file's.
    const withDoctor: ProjectState = { ...checked, doctor: { results: runDoctor(checked), stamp: checked.doctor.stamp } };
    return { state: withDoctor, warnings: placed.missing > 0 ? [{ code: 'MISSING_MESHES', count: placed.missing }] : [] };
  } catch (err) {
    for (const id of registered) unregisterMesh(id);
    if (err instanceof ProjectError) throw err;
    // The memory or the stack gave out: a file too big for this browser.
    if (err instanceof RangeError) throw new ProjectError('TOO_LARGE', err.message);
    // The file passed the checks but something in it still did not fit what the program expects.
    throw damaged(`the project could not be evaluated (${err instanceof Error ? err.message : String(err)})`);
  }
}

/** What `readProjectFile` gives back: the project, or why the file is not one (never an exception). */
export type ProjectOpenResult =
  | { ok: true; state: ProjectState; warnings: ProjectWarning[] }
  | { ok: false; fault: { code: ProjectErrorCode; detail: string; schema?: number } };

/** Reads a project file (see `loadProject`); on failure the registry and everything else are as they were. */
export async function readProjectFile(file: Blob): Promise<ProjectOpenResult> {
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    // A string cannot be longer than about half a gigabyte; anything else is the file not being readable.
    if (err instanceof RangeError) return { ok: false, fault: { code: 'TOO_LARGE', detail: err.message } };
    return { ok: false, fault: { code: 'DAMAGED', detail: `the file could not be read (${err instanceof Error ? err.message : String(err)})` } };
  }
  try {
    const { state, warnings } = loadProject(text);
    return { ok: true, state, warnings };
  } catch (err) {
    if (err instanceof ProjectError) return { ok: false, fault: { code: err.code, detail: err.message, ...(err.schema !== undefined ? { schema: err.schema } : {}) } };
    return { ok: false, fault: { code: 'DAMAGED', detail: err instanceof Error ? err.message : String(err) } };
  }
}

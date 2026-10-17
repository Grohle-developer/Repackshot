// The .repack project file (once .repack.json; both open, ARCHITECTURE §8): the state, and next to it the geometry the state refers to.
//
//   {
//    "format": "repackshot-project",
//    "schema": 2,
//    "state": { ...ProjectState, as the store has it },
//    "meshes": [ { "id": "stl:1:n3", "glb": "<base64>", "sharpEdges": "<base64>", "triangleSource": "<base64>" }, ... ],
//    "images": [ { "id": "hdri:1", "name": "studio.hdr", "file": "<base64>" }, ... ]
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
// `images` (E5) holds the environment's HDRI and background image as the files they were read from (the state
// keeps an `ImageRef`: core/images.ts). It is written only when the environment has one. Its images are decoded
// again on open; one that is missing or does not decode is dropped from the environment (the studio dome lights,
// the colour shows) and reported, never a reason not to open the project.
//
// Texture images (M2a) travel in the same block, after the environment's: every PNG or JPEG a material's slots
// or labels name, once, as its file's bytes (base64), under its content id (`tex:…`, core/texture-images.ts), so
// a project saved and opened again gives back the same bytes under the same ids. On open they go back to the
// registry without decoding; a slot or a label whose image is missing or is not a PNG or JPEG is dropped from its
// material and counted with the missing images. The materials' `textures` are read through
// `normalizeTextures` (core/textures.ts), which also takes the flat shape of files written before M2a.
//
// Material graphs (M3a) travel inside their material (`materials.<id>.graph`, with its own `version`, core/
// material-graph.ts); a file from before M3a has none and its materials open as Simple ones. The images of a graph's
// image nodes travel in `images` with the texture images, and a missing one leaves its node without an image. The
// schema stays at 2.
//
// Schema history (each step a pure function over the state, applied in order on load):
//   1 (U1) — the state as it was.
//   2 (U5) — `render` is the render window's settings and a queue of full `RenderJob`s (core/render.ts
//            `migrateRender`).
//
// Cameras (U13): each carries the aspect ratio of its image (`aspect: { preset, w, h }`). A file from before it has
// none: its cameras take the ratio of the saved render size (a preset within 0.5 %, else a custom ratio with those
// pixels; `withCameraAspects`), and the saved size stays. The schema stays at 2.
//
// Ambient effects (S4a): `effects`, a list of parameters (core/effects.ts); a file from before S4a has none and
// opens with an empty list, an entry of a newer version keeps what this version knows of it. The schema stays at 2.
//
// Section view (Q1): `section`, the cutting plane (`{ enabled, point, normal, cap }`, core/section.ts) or null; a file
// from before Q1 has none and opens without one, a plane with no usable normal is left out. The schema stays at 2.
//
// Primitives (U9): a part made by Add ▸ Primitive keeps its shape and measures in an optional field of its node
// (`primitive`: `{ kind, params }`, core/primitives.ts), and its mesh is not written: on open it is made again from
// the measures, under the id it had (the id names the content), so a project with primitives saves, opens and
// saves again to the same bytes. A file from before U9 has no such field and opens as it always did; a shape this
// version does not know (a newer file) leaves its part without geometry, reported like any missing mesh. The
// schema stays at 2.
//
// Physics (S2): a node may carry its Physics section (`physics`: role, density, friction, bounciness, as parts) and the
// animation may hold PHYSICS clips with a recorded track (`track`: fps, frames and the local poses as base64 f32,
// core/physics.ts) and the node's position and rotation it is relative to (`anchor`), all plain JSON in the state. A
// file from before S2 has neither and opens as it always did; on open the section keeps only what this version
// knows, a clip whose track does not decode is left out and so is a damaged anchor. The schema stays at 2.
//
// IES lights (L5): an own light of type IES keeps its photometric profile in `studio.lights[].ies` (`{ name, text, base }`: the
// file's text, one character per byte, and the power the light came in with), so the project opens elsewhere without the
// file; it is plain JSON in the state, a file from before L5 has none and opens as it always did, and on open a profile
// that does not read (a file edited by hand) is taken away and its light is a point. The schema stays at 2.
//
// Scene type (K1): `scene.type` (`PRODUCT`, `INTERIOR` or `CATALOGUE`, core/scene-type.ts) and, while it is not Product,
// `scene.typeBase`: what the type replaced, per setting, so that switching back leaves the project as it was. A file
// from before K1 has neither and opens as Product; a type this version does not know is Product too, and a setting
// of the memory it does not know is dropped. The schema stays at 2.
//
// Opening is all or nothing: the text is read and checked (envelope, schema, state, meshes) before the registry
// or the store are touched, so a damaged file leaves the open project as it was.

import { runDoctor } from '../core/doctor';
import { parseIes } from '../core/ies';
import type { LightInstance } from '../core/lighting';
import { normalizeEffects } from '../core/effects';
import { normalizeSection } from '../core/section';
import { normalizeSceneType, normalizeTypeBase } from '../core/scene-type';
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
import { normalizeOptics } from '../core/optics';
import { getImage, nextImageId, type ImageData, type ImageId, type ImageRef } from '../core/images';
import { checkTextureFile, registerTextureImage, textureImageId } from '../core/texture-images';
import { normalizeTextures, TEXTURE_SLOTS, textureImages, type MaterialTextures } from '../core/textures';
import { mapGraphImages, normalizeGraph } from '../core/material-graph';
import type { MaterialInstance } from '../core/materials';
import { withCameraAspects } from '../core/camera';
import { migrateRender, syncOutputSize } from '../core/render';
import { isAnchor, isTrack, type PhysicsProps } from '../core/physics';
import { ensurePrimitiveMeshAt, normalizeParams, primitiveMeshId, primitiveOwner } from '../core/primitives';
import { isPrimitiveKind } from '../data/primitives';
import { cleanSelection, meshIdsInUse, type SceneNode } from '../core/scene';
import { emptyBox } from '../core/math';
import { createInitialState, type ProjectState } from '../core/store';
import { baseMeshId } from '../core/transform';
import { base64ToBytes, bytesToBase64 } from './base64';
import { glbToMesh, meshToGlb, packUint32, unpackUint32 } from './glb';
import type { PixelDecoder } from './hdri';

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

/** The environment's image slots that hold an image. */
function environmentImages(state: ProjectState): ['hdri' | 'backplate', ImageRef][] {
  const env = state.environment;
  const out: ['hdri' | 'backplate', ImageRef][] = [];
  if (env.hdri) out.push(['hdri', env.hdri]);
  if (env.backplate) out.push(['backplate', env.backplate]);
  return out;
}

/** One entry of the `images` block, as a line of JSON. */
function imageEntry(ref: ImageRef, data: ImageData): string {
  return JSON.stringify({ id: ref.id, name: ref.name, file: bytesToBase64(data.bytes) });
}

/**
 * The project as a file: the state and every mesh its parts use. The file is built from pieces (one per mesh),
 * never one big string, so a model of millions of triangles costs time and memory linear in its size. A part
 * whose geometry is not in the registry (a project opened without it) is written without it.
 */
export function serializeProject(state: ProjectState): Blob {
  // A file on disk is by definition the saved state: the flag is written clean.
  const clean: ProjectState = state.meta.dirty ? { ...state, meta: { ...state.meta, dirty: false } } : state;
  const made = madeFromMeasures(state);
  const parts: string[] = [
    `{\n "format": ${JSON.stringify(PROJECT_FORMAT)},\n "schema": ${PROJECT_SCHEMA},\n "state": `,
    stateJson(clean).replace(/\n/g, '\n '),
    ',\n "meshes": [',
  ];
  let first = true;
  for (const id of meshIdsInUse(state)) {
    // A primitive's mesh is its measures: it is made again on open (U9).
    if (made.has(id)) continue;
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
  parts.push(first ? ']' : '\n ]');
  // The environment's images and the texture images (M2a), as their files.
  const images: ImageRef[] = environmentImages(state).filter(([, ref]) => getImage(ref.id)).map(([, ref]) => ref);
  for (const ref of textureImages(state).values()) if (getImage(ref.id) && !images.some((r) => r.id === ref.id)) images.push(ref);
  if (images.length > 0) {
    parts.push(',\n "images": [');
    images.forEach((ref, i) => {
      try {
        parts.push(`${i === 0 ? '' : ','}\n  ${imageEntry(ref, getImage(ref.id)!)}`);
      } catch (err) {
        if (err instanceof RangeError) throw new ProjectError('TOO_LARGE', `image ${ref.name} is too large to save in a project file`);
        throw err;
      }
    });
    parts.push('\n ]');
  }
  parts.push('\n}\n');
  return new Blob(parts, { type: 'application/json' });
}

/** Meshes every part of which is a primitive: the file keeps their measures, not the mesh. */
function madeFromMeasures(state: Pick<ProjectState, 'scene'>): Set<MeshId> {
  const out = new Set<MeshId>();
  const other = new Set<MeshId>();
  for (const n of Object.values(state.scene.nodes)) {
    if (!n.mesh) continue;
    if (n.primitive) out.add(n.mesh.id);
    else other.add(n.mesh.id);
  }
  for (const id of other) out.delete(id);
  return out;
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
    if (key === 'section') continue; // null or a plane: normalised by normalizeSection (Q1)
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
    if (n.faceRanges !== undefined) {
      // The CAD faces of a STEP or IGES part (core/scene.ts): runs of triangles.
      if (!Array.isArray(n.faceRanges)) throw damaged(`${at}.faceRanges is not a list`);
      for (const f of n.faceRanges) if (!isObject(f) || !Number.isInteger(f.start) || !Number.isInteger(f.count) || f.start < 0 || f.count < 1) throw damaged(`${at}.faceRanges is damaged`);
    }
    if (n.faceMaterials !== undefined) {
      if (!Array.isArray(n.faceMaterials)) throw damaged(`${at}.faceMaterials is not a list`);
      for (const f of n.faceMaterials) if (!isObject(f) || !Number.isInteger(f.start) || !Number.isInteger(f.count) || !isObject(s.materials[f.material])) throw damaged(`${at}.faceMaterials is damaged`);
    }
    if (n.physics !== undefined) {
      // The Physics section (S2): what this version knows of it, the rest dropped (a role of a later version, a
      // value out of range), never a reason not to open the file.
      const ph = n.physics as unknown;
      if (!isObject(ph)) throw damaged(`${at}.physics is damaged`);
      const fixed: SceneNode = { ...(emptied[id] ?? n) };
      const props: PhysicsProps = {};
      if (ph.role === 'STATIC' || ph.role === 'DYNAMIC') props.role = ph.role;
      if (typeof ph.density === 'number' && Number.isFinite(ph.density) && ph.density > 0) props.density = ph.density;
      if (typeof ph.friction === 'number' && Number.isFinite(ph.friction) && ph.friction >= 0) props.friction = ph.friction;
      if (typeof ph.bounciness === 'number' && Number.isFinite(ph.bounciness) && ph.bounciness >= 0 && ph.bounciness <= 1) props.bounciness = ph.bounciness;
      if (typeof ph.asParts === 'boolean') props.asParts = ph.asParts;
      if (Object.keys(props).length > 0) fixed.physics = props;
      else delete fixed.physics;
      emptied[id] = fixed;
    }
    if (n.primitive !== undefined) {
      // A primitive (U9): its shape and measures. A shape this version does not know is dropped (the part has no
      // geometry then, reported as missing); the measures are normalised like the inspector's.
      const prim = n.primitive as unknown;
      if (!isObject(prim) || !isObject(prim.params) || typeof prim.kind !== 'string') throw damaged(`${at}.primitive is damaged`);
      const fixed: SceneNode = { ...(emptied[id] ?? n) };
      if (n.kind !== 'PART' || !isPrimitiveKind(prim.kind)) delete fixed.primitive;
      else fixed.primitive = { kind: prim.kind, params: normalizeParams(prim.kind, prim.params) };
      emptied[id] = fixed;
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
  // M2a: the image maps and labels, read whatever shape they were written in (core/textures.ts). M3a: a material's
  // graph, checked node by node and link by link (core/material-graph.ts); one this version cannot read (a newer
  // schema) is dropped and the material opens as Simple, with its parameters.
  const materials: Record<string, MaterialInstance> = {};
  for (const [id, m] of Object.entries(s.materials)) {
    const next: MaterialInstance = { ...m, textures: normalizeTextures(m.textures) };
    const graph = (m as { graph?: unknown }).graph;
    if (graph !== undefined) {
      const g = normalizeGraph(graph);
      if (g) next.graph = g;
      else delete next.graph;
    }
    materials[id] = next;
  }
  s.materials = materials;
  if (!isObject(s.camera.cameras) || !isObject(s.camera.cameras[s.camera.active])) throw damaged('camera.active is not a camera');
  for (const [id, c] of Object.entries(s.camera.cameras)) if (!isObject(c) || c.id !== id) throw damaged(`camera.cameras.${id} is not a camera`);
  // O1: a camera's optics (absent on cameras saved before O1, which keep the plain thin lens) within the engine's limits.
  if (Object.values(s.camera.cameras).some((c) => (c as { optics?: unknown }).optics !== undefined)) {
    const cameras = { ...s.camera.cameras };
    for (const [id, c] of Object.entries(cameras)) {
      const raw = (c as { optics?: unknown }).optics;
      if (raw === undefined) continue;
      const { optics: _drop, ...rest } = c;
      cameras[id] = raw === null ? rest : { ...rest, optics: normalizeOptics(raw) };
    }
    s.camera = { ...s.camera, cameras };
  }
  if (!Array.isArray(s.studio.lights) || s.studio.lights.some((l) => !isObject(l) || typeof l.id !== 'string')) throw damaged('studio.lights is damaged');
  // L5: an IES light whose profile is damaged, or is not a file the engine reads, opens as the point light it stands on.
  s.studio = { ...s.studio, lights: s.studio.lights.map(withReadableProfile) };
  if (!Array.isArray(s.selection.ids)) throw damaged('selection.ids is not a list');
  const env = s.environment;
  for (const slot of ['hdri', 'backplate'] as const) {
    const r = env[slot] as unknown;
    if (r !== null && !(isObject(r) && typeof r.id === 'string' && typeof r.name === 'string' && Number.isInteger(r.width) && Number.isInteger(r.height))) throw damaged(`environment.${slot} is damaged`);
  }
  if (!isObject(env.skySun) || !Number.isFinite(env.skySun.az) || !Number.isFinite(env.skySun.el)) throw damaged('environment.skySun is damaged');
  // E5c: a project saved before the physical sky has no skyModel and opens with the default (filled in above).
  if (env.skyModel !== 'PHYSICAL' && env.skyModel !== 'CLASSIC') throw damaged('environment.skyModel is damaged');
  // S2: a recorded simulation (a PHYSICS clip) whose track does not decode is left out, not the project.
  if (Array.isArray(s.animation.clips) && s.animation.clips.some((c) => isObject(c) && c.move === 'PHYSICS' && !isTrack(c.track))) {
    s.animation = { ...s.animation, clips: s.animation.clips.filter((c) => !(isObject(c) && c.move === 'PHYSICS' && !isTrack(c.track))) };
  }
  // A damaged anchor is left out: the clip then plays its frames as they are.
  if (Array.isArray(s.animation.clips) && s.animation.clips.some((c) => isObject(c) && 'anchor' in c && !isAnchor(c.anchor))) {
    s.animation = { ...s.animation, clips: s.animation.clips.map((c) => (isObject(c) && 'anchor' in c && !isAnchor(c.anchor) ? (({ anchor: _a, ...rest }) => rest)(c) : c)) as typeof s.animation.clips };
  }
  // S4a: the ambient effects (a project saved before them has none; filled in above), each checked and completed.
  s.effects = normalizeEffects(s.effects, s);
  // Q1: the section view's plane (a project saved before it has none; a plane that cannot be one is none).
  s.section = normalizeSection(s.section);
  // K1: the scene type (a project saved before it has none and opens as Product; a name this version does not know is
  // Product too) and what it replaced, the writes of the slots this version knows (core/scene-type.ts).
  const sceneType = normalizeSceneType((raw.scene as { type?: unknown } | undefined)?.type);
  const typeBase = normalizeTypeBase((raw.scene as { typeBase?: unknown } | undefined)?.typeBase, s);
  const { typeBase: _drop, ...sceneRest } = s.scene;
  s.scene = { ...sceneRest, type: sceneType, ...(typeBase && sceneType !== 'PRODUCT' ? { typeBase } : {}) };
  return s;
}

/**
 * A light of a project as this version reads its IES profile (L5): a profile that is not `{ name, text, base }` or whose
 * text the reader refuses is taken away, and an IES light without one is the point light it stands on. Everything else of
 * the light stays, so a project edited by hand, or written by a version whose reader accepted more, still opens.
 */
function withReadableProfile(l: LightInstance): LightInstance {
  const raw = (l as { ies?: unknown }).ies;
  const valid = isObject(raw) && typeof raw.name === 'string' && typeof raw.text === 'string' && typeof raw.base === 'number' && Number.isFinite(raw.base) && parseIes(raw.text).ok;
  if (valid || (raw === undefined && l.type !== 'IES')) return l;
  const { ies: _dropped, ...rest } = l;
  return l.type === 'IES' ? { ...rest, type: 'POINT' } : rest;
}

/** The envelope of a parsed file and the state it holds, migrated to the current schema and checked. */
function readEnvelope(body: unknown): { state: ProjectState; meshes: unknown; images: unknown } {
  if (!isObject(body) || body.format !== PROJECT_FORMAT) throw new ProjectError('NOT_A_PROJECT', 'not a Repackshot project');
  // A file without `schema` is a hand-made one; the first schema is the oldest there is.
  const schema = body.schema === undefined ? 1 : body.schema;
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) throw damaged('the project has no valid schema number');
  if (schema > PROJECT_SCHEMA) throw new ProjectError('NEWER_VERSION', `the project was saved by a newer version (schema ${schema})`, schema);
  if (!isObject(body.state)) throw damaged('the project has no state');
  let state: RawState = body.state;
  for (let n = schema; n < PROJECT_SCHEMA; n++) state = STEPS[n](state);
  // U13: a camera of a project saved before it takes the ratio of the saved size; an image follows its camera.
  const checked = syncOutputSize(withCameraAspects(checkState({ ...state, render: migrateRender(state.render) })));
  // A file is the saved state, and nothing plays or renders after a load.
  const loaded: ProjectState = {
    ...checked,
    meta: { ...checked.meta, dirty: false },
    animation: { ...checked.animation, playing: false },
  };
  return { state: loaded, meshes: body.meshes, images: body.images };
}

/**
 * A parsed project file to the state it holds (no geometry: see `loadProject`): checks the envelope, runs the
 * migration steps from its schema up and checks the result. Throws a `ProjectError` when the file is not a
 * project, comes from a newer version or is damaged.
 */
export function migrateProject(body: unknown): ProjectState {
  const state = cleanSelection(readEnvelope(body).state);
  // The Doctor's findings follow the model and the catalogue of this version, not the file's (as `loadProject` does).
  return { ...state, doctor: { results: runDoctor(state), stamp: state.doctor.stamp } };
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

/** The text of a .repack file to its state, without geometry (see `migrateProject`). */
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
  const { positions, normals, indices, uvs, uvs2 } = glb.mesh;
  const vertices = positions.length / 3;
  if (!Number.isInteger(vertices) || normals.length !== positions.length || indices.length % 3 !== 0 || (uvs && uvs.length !== 2 * vertices) || (uvs2 && uvs2.length !== 2 * vertices)) throw fail('the arrays do not fit together');
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
  return { id, mesh: { data: { positions, normals, indices, ...(uvs ? { uvs } : {}), ...(uvs2 ? { uvs2 } : {}), ...(sharpEdges ? { sharpEdges } : {}) }, source } };
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
  return sameBytes(a.positions, b.positions) && sameBytes(a.normals, b.normals) && sameBytes(a.indices, b.indices) && sameBytes(a.uvs, b.uvs) && sameBytes(a.uvs2, b.uvs2) && sameBytes(a.sharpEdges, b.sharpEdges);
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
function placeMeshes(loaded: ProjectState, decoded: Map<MeshId, DecodedMesh>, registered: MeshId[]): { state: ProjectState; missing: number } {
  // Primitives first: their meshes are made from their measures under the id they had (it names the content and its
  // owner), whatever the file holds.
  const made = new Set<MeshId>();
  const withPrimitives: Record<string, SceneNode> = { ...loaded.scene.nodes };
  for (const [key, n] of Object.entries(loaded.scene.nodes)) {
    if (!n.primitive) continue;
    const id = primitiveMeshId((n.mesh && primitiveOwner(n.mesh.id)) ?? n.id, n.primitive);
    const had = getMesh(id) !== undefined;
    const m = ensurePrimitiveMeshAt(id, n.primitive);
    if (!had) registered.push(id);
    made.add(id);
    withPrimitives[key] = { ...n, mesh: m.ref, faceRanges: m.faceRanges };
  }
  const state: ProjectState = made.size > 0 ? { ...loaded, scene: { ...loaded.scene, nodes: withPrimitives } } : loaded;
  const wanted = meshIdsInUse(state);
  for (const id of made) wanted.delete(id);
  // Files from before the meshes block: the example's geometry is code, the rest is gone.
  let regenerated = false;
  for (const id of wanted) {
    if (decoded.has(id) || getMesh(id) || !id.startsWith('example:') || regenerated) continue;
    buildExample();
    regenerated = true;
  }
  // The counts in the state must be the counts of the geometry in the file.
  for (const n of Object.values(state.scene.nodes)) {
    const d = n.mesh && !made.has(n.mesh.id) ? decoded.get(n.mesh.id) : undefined;
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
    if (!n.mesh || made.has(n.mesh.id)) continue;
    const target = rename.get(n.mesh.id);
    if (target !== undefined) nodes[key] = { ...n, mesh: { ...n.mesh, id: target } };
    // A part whose geometry no file or code can give stays in the scene without it (the preview skips it).
    if (!getMesh(target ?? n.mesh.id)) missing++;
  }
  return { state: { ...state, scene: { ...state.scene, nodes } }, missing };
}

/** What a load noticed and the person should hear about. */
export interface ProjectWarning {
  /**
   * MISSING_MESHES: parts whose geometry is not in the file (a project from before the meshes block, other than
   * the example). MISSING_IMAGES: environment images that are not in the file or do not decode (dropped), and
   * texture images that are not in the file (their slots and labels dropped, M2a).
   */
  code: 'MISSING_MESHES' | 'MISSING_IMAGES';
  count: number;
}

/** An image of the file's `images` block, still to be decoded. */
export interface SavedImage {
  id: ImageId;
  name: string;
  bytes: Uint8Array;
}

export interface LoadedProject {
  state: ProjectState;
  warnings: ProjectWarning[];
  /** The `images` block (entries that are not images are left out): `placeImages` decodes them. */
  images: SavedImage[];
}

/** The well-formed entries of an `images` block. */
function savedImages(block: unknown): SavedImage[] {
  if (!Array.isArray(block)) return [];
  const out: SavedImage[] = [];
  for (const e of block) {
    if (!isObject(e) || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.file !== 'string') continue;
    try {
      out.push({ id: e.id, name: e.name, bytes: base64ToBytes(e.file) });
    } catch {
      // Not base64: as if it were not there.
    }
  }
  return out;
}

/**
 * Decodes the environment's images of a loaded project into the registry. An image keeps its id unless the id
 * names another image in this session (ids are numbered per session, like the meshes'); one that is missing or
 * does not decode is dropped from the environment. Returns the state with its refs updated and how many were
 * dropped.
 */
export async function placeImages(state: ProjectState, saved: readonly SavedImage[], decode?: PixelDecoder): Promise<{ state: ProjectState; missing: number }> {
  const textured = placeTextureImages(state, saved);
  state = textured.state;
  const env = { ...state.environment };
  if (!env.hdri && !env.backplate) return { state, missing: textured.missing };
  // The readers load with the first project that has images (they stay out of the main chunk).
  const { restoreImage } = await import('./hdri');
  let missing = 0;
  for (const slot of ['hdri', 'backplate'] as const) {
    const ref = env[slot];
    if (!ref) continue;
    const entry = saved.find((e) => e.id === ref.id);
    const have = getImage(ref.id);
    let placed: ImageRef | null = null;
    if (entry) {
      const id = have && !sameBytes(have.bytes, entry.bytes) ? nextImageId(slot === 'hdri' ? 'hdri' : 'plate') : ref.id;
      try {
        await restoreImage({ ...ref, id }, entry.bytes, decode);
        const data = getImage(id)!;
        placed = { id, name: ref.name, width: data.width, height: data.height };
      } catch {
        placed = null;
      }
    }
    if (!placed) missing++;
    env[slot] = placed;
  }
  return { state: missing > 0 || env.hdri !== state.environment.hdri || env.backplate !== state.environment.backplate ? { ...state, environment: env } : state, missing: missing + textured.missing };
}

/**
 * The texture images of a loaded project into the registry (M2a), under the ids that name their content: one
 * whose file is in `saved` is registered (an id the registry already holds is that content); one whose file is
 * missing, or is not a PNG or JPEG, leaves its slots and labels, counted in `missing` once per image.
 */
export function placeTextureImages(state: ProjectState, saved: readonly SavedImage[]): { state: ProjectState; missing: number } {
  const wanted = textureImages(state);
  if (wanted.size === 0) return { state, missing: 0 };
  const rename = new Map<string, ImageRef | null>();
  for (const [id, ref] of wanted) {
    if (getImage(id)) continue;
    const entry = saved.find((e) => e.id === id);
    if (!entry || 'reason' in checkTextureFile(entry.bytes)) {
      rename.set(id, null);
      continue;
    }
    // A file edited by hand may hold other bytes than its id names: the id follows the bytes.
    const own = textureImageId(entry.bytes);
    const placed = registerTextureImage(ref.name, entry.bytes, own);
    if (own !== id) rename.set(id, placed);
  }
  if (rename.size === 0) return { state, missing: 0 };
  const fix = (r: ImageRef): ImageRef | null => (rename.has(r.id) ? rename.get(r.id)! : r);
  const materials: Record<string, MaterialInstance> = {};
  for (const [id, m] of Object.entries(state.materials)) {
    const t: MaterialTextures = { ...m.textures, labels: [] };
    let changed = false;
    for (const k of TEXTURE_SLOTS) {
      const slot = m.textures[k];
      if (!slot || !rename.has(slot.image.id)) continue;
      const image = fix(slot.image);
      t[k] = image ? { ...slot, image } : null;
      changed = true;
    }
    for (const l of m.textures.labels) {
      const image = fix(l.image);
      if (image) t.labels.push(image === l.image ? l : { ...l, image });
      if (image !== l.image) changed = true;
    }
    // M3a: the image nodes of its graph (a missing image leaves the node without one).
    const graph = m.graph ? mapGraphImages(m.graph, fix) : undefined;
    const next = changed ? { ...m, textures: t } : m;
    materials[id] = graph && graph !== m.graph ? { ...next, graph } : next;
  }
  const missing = [...rename.values()].filter((r) => r === null).length;
  return { state: { ...state, materials }, missing };
}

/**
 * The text of a .repack file to a project ready for `store.reset`: the state, migrated and checked, with its
 * meshes registered. Throws a `ProjectError` and leaves the registry as it was when the file cannot be loaded.
 */
export function loadProject(text: string): LoadedProject {
  const registered: MeshId[] = [];
  try {
    const { state, meshes, images } = readEnvelope(parseText(text));
    const placed = placeMeshes(state, decodeMeshes(meshes), registered);
    const checked = cleanSelection(placed.state);
    // The Doctor's findings follow the model and the catalogue of this version, not the file's.
    const withDoctor: ProjectState = { ...checked, doctor: { results: runDoctor(checked), stamp: checked.doctor.stamp } };
    return { state: withDoctor, warnings: placed.missing > 0 ? [{ code: 'MISSING_MESHES', count: placed.missing }] : [], images: savedImages(images) };
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

/**
 * Reads a project file (see `loadProject`) and decodes its environment images (`placeImages`, with `decode` for
 * background images: the browser's by default); on failure the registry and everything else are as they were.
 */
export async function readProjectFile(file: Blob, decode?: PixelDecoder): Promise<ProjectOpenResult> {
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    // A string cannot be longer than about half a gigabyte; anything else is the file not being readable.
    if (err instanceof RangeError) return { ok: false, fault: { code: 'TOO_LARGE', detail: err.message } };
    return { ok: false, fault: { code: 'DAMAGED', detail: `the file could not be read (${err instanceof Error ? err.message : String(err)})` } };
  }
  try {
    const loaded = loadProject(text);
    const { state, missing } = await placeImages(loaded.state, loaded.images, decode);
    const warnings: ProjectWarning[] = missing > 0 ? [...loaded.warnings, { code: 'MISSING_IMAGES', count: missing }] : loaded.warnings;
    return { ok: true, state, warnings };
  } catch (err) {
    if (err instanceof ProjectError) return { ok: false, fault: { code: err.code, detail: err.message, ...(err.schema !== undefined ? { schema: err.schema } : {}) } };
    return { ok: false, fault: { code: 'DAMAGED', detail: err instanceof Error ? err.message : String(err) } };
  }
}

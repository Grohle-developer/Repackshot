// What the readers that go through a three.js loader (glTF, FBX, 3DM, 3MF,
// PLY, DAE, USD) share: turning the Object3D tree the loader built into the
// nodes of a payload, the same way for every format.
//
//   - A mesh becomes a PART; an object with children becomes a GROUP (a mesh
//     with children becomes a GROUP holding the part and the children); the
//     root itself is the MODEL named after the file. Lights, cameras, lines and
//     points are skipped.
//   - The world transform of every mesh is baked into its vertices (a mirrored
//     one reverses the winding), and the part is re-centred on its own bounds:
//     the node position carries the offset, as in the OBJ and STL readers.
//   - Vertices are welded and hard edges found by `buildMesh`, like OBJ and STL;
//     the loader's normals are kept when it has them.
//   - Materials become SIMPLE instances: colour, roughness and metal read from
//     the three material (Phong shininess is mapped to roughness). Texture
//     images are collected as blobs for the materials phase (M2), not applied.
//
// Nothing here scales or turns the axes: the geometry stays in the units and
// axes of the file and the import options (core/import-options.ts) do the rest.

import * as THREE from 'three';
import type { ImportDetected, ImportMessage, ImportPayload, ImportTexture } from '../core/import-options';
import { payloadSize } from '../core/import-options';
import { defaultInstance, plainInstance, type MaterialId, type MaterialInstance } from '../core/materials';
import { registerMesh, type MeshData } from '../core/meshes';
import type { FaceRange, NodeId, SceneNode } from '../core/scene';
import type { MaterialParams } from '../data/types';
import { buildMesh, type RawMesh } from './mesh-common';

export interface ConvertOptions {
  fileName: string;
  /** Format name for the MODEL's source, and for the mesh ids. */
  format: string;
  /** True for the material a loader gives to meshes that had none: the part takes the neutral Default. */
  isFallbackMaterial?(m: THREE.Material): boolean;
  /** Layer of a mesh (3DM), for "group by layer". */
  layerOf?(o: THREE.Object3D): string | undefined;
  /** A group with a single part and nothing else is just that part (3MF build items). */
  collapseSingleParts?: boolean;
  /** The loader's colours are sRGB values it did not convert (3DM): convert them to linear. */
  srgbColors?: boolean;
  /** Roughness for a material the loader left at three's default of 1 (the file has no roughness: 3MF, 3DM). */
  roughnessWhenDefault?: number;
  /** Ignore the loader's normals: it computed smooth ones for a file that has none (USD without `normals`). */
  ignoreNormals?: boolean;
}

export interface ConvertedScene {
  nodes: Record<NodeId, SceneNode>;
  roots: NodeId[];
  materials: Record<MaterialId, MaterialInstance>;
  layers: Record<NodeId, string>;
  /** Parts hidden in the file (themselves or through a parent). */
  hiddenParts: number;
  warnings: ImportMessage[];
  /** The three material behind each instance, to collect its textures. */
  sources: Map<MaterialId, THREE.Material>;
}

let importCounter = 0;

// --- Materials -----------------------------------------------------------------------------

/** Roughness for a Blinn-Phong material: the GGX alpha that has the same lobe, as `r = alpha^(1/2)`. */
export function roughnessFromShininess(shininess: number, specularLuma: number): number {
  if (specularLuma < 0.02) return 1;
  return Math.min(1, Math.max(0.05, (2 / (Math.max(shininess, 0) + 2)) ** 0.25));
}

/** Colour, roughness, metal and the few extras of a three material, as the model's SIMPLE parameters. */
export function surfaceParams(m: THREE.Material): MaterialParams {
  const any = m as THREE.Material & {
    color?: THREE.Color;
    metalness?: number;
    roughness?: number;
    shininess?: number;
    specular?: THREE.Color;
    transmission?: number;
    clearcoat?: number;
    isMeshStandardMaterial?: boolean;
    isMeshPhongMaterial?: boolean;
  };
  const c = any.color ?? new THREE.Color(0.8, 0.8, 0.8);
  let roughness = 0.5;
  let metallic = 0;
  if (any.isMeshStandardMaterial) {
    metallic = typeof any.metalness === 'number' ? any.metalness : 0;
    roughness = typeof any.roughness === 'number' ? any.roughness : 0.5;
  } else if (any.isMeshPhongMaterial) {
    const s = any.specular ?? new THREE.Color(0, 0, 0);
    roughness = roughnessFromShininess(any.shininess ?? 30, (s.r + s.g + s.b) / 3);
  }
  const params: MaterialParams = { baseColor: [c.r, c.g, c.b, 1], metallic, roughness };
  if (any.opacity !== undefined && any.opacity < 1) params.opacity = any.opacity;
  if (typeof any.transmission === 'number' && any.transmission > 0) params.transmission = any.transmission;
  if (typeof any.clearcoat === 'number' && any.clearcoat > 0) params.coat = any.clearcoat;
  return params;
}

// --- Geometry ------------------------------------------------------------------------------

interface PartGeometry {
  mesh: MeshData;
  /** For each triangle of `mesh`, the index into the material list of the three mesh. */
  materialOf: Uint16Array;
  dropped: number;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();

/** The world-space triangle soup of a mesh, welded into a MeshData; null when no triangle survives. */
function readGeometry(mesh: THREE.Mesh, ignoreNormals: boolean): PartGeometry | null {
  const g = mesh.geometry as THREE.BufferGeometry;
  const pos = g.getAttribute('position');
  if (!pos || pos.count === 0) return null;
  const nor = ignoreNormals ? undefined : g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const index = g.index;
  const triangles = Math.floor((index ? index.count : pos.count) / 3);
  if (triangles === 0) return null;
  const mirrored = mesh.matrixWorld.determinant() < 0;
  _normalMatrix.getNormalMatrix(mesh.matrixWorld);

  // Material slot of every input triangle.
  const slot = new Uint16Array(triangles);
  if (Array.isArray(mesh.material)) {
    for (const grp of g.groups) {
      const from = Math.floor(grp.start / 3);
      const to = Math.min(triangles, Math.floor((grp.start + grp.count) / 3));
      for (let t = from; t < to; t++) slot[t] = grp.materialIndex ?? 0;
    }
  }

  const positions = new Float32Array(triangles * 9);
  const normals = nor ? new Float32Array(triangles * 9) : null;
  const uvs = uv ? new Float32Array(triangles * 6) : null;
  for (let t = 0; t < triangles; t++) {
    for (let j = 0; j < 3; j++) {
      // A mirrored mesh swaps the second and third corner to keep the fronts outward.
      const corner = mirrored && j > 0 ? 3 - j : j;
      const vi = index ? index.getX(3 * t + corner) : 3 * t + corner;
      _v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(mesh.matrixWorld);
      positions[9 * t + 3 * j] = _v.x;
      positions[9 * t + 3 * j + 1] = _v.y;
      positions[9 * t + 3 * j + 2] = _v.z;
      if (normals && nor) {
        _n.set(nor.getX(vi), nor.getY(vi), nor.getZ(vi)).applyMatrix3(_normalMatrix);
        normals[9 * t + 3 * j] = _n.x;
        normals[9 * t + 3 * j + 1] = _n.y;
        normals[9 * t + 3 * j + 2] = _n.z;
      }
      if (uvs && uv) {
        uvs[6 * t + 2 * j] = uv.getX(vi);
        uvs[6 * t + 2 * j + 1] = uv.getY(vi);
      }
    }
  }
  const raw: RawMesh = { positions, normals, uvs };
  const built = buildMesh(raw);
  if (!built) return null;
  const materialOf = new Uint16Array(built.source.length);
  for (let k = 0; k < materialOf.length; k++) materialOf[k] = slot[built.source[k]];
  return { mesh: built.data, materialOf, dropped: built.dropped };
}

// --- The tree ----------------------------------------------------------------------------------

/** Reads the Object3D tree under `root` (the root itself is the MODEL and is not a node of its own). */
export function convertScene(source: THREE.Object3D, o: ConvertOptions): ConvertedScene {
  // A file that is a bare mesh (PLY) gets a group to stand for the root.
  const root = (source as THREE.Mesh).isMesh ? new THREE.Group().add(source) : source;
  root.updateMatrixWorld(true);
  const run = ++importCounter;
  const nodes: Record<NodeId, SceneNode> = {};
  const materials: Record<MaterialId, MaterialInstance> = {};
  const layers: Record<NodeId, string> = {};
  const sources = new Map<MaterialId, THREE.Material>();
  const warnings: ImportMessage[] = [];
  const byUuid = new Map<string, MaterialId>();
  const autoNamed = new Set<NodeId>();
  let n = 0;
  const newId = (): NodeId => `t${++n}`;
  const base = (id: NodeId, name: string, kind: SceneNode['kind']): SceneNode => ({
    id,
    name,
    kind,
    parent: null,
    children: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
  });

  const byKey = new Map<string, MaterialId>();
  const textureKey = (m: THREE.Material): string =>
    TEXTURE_SLOTS.map(([slot]) => (m as unknown as Record<string, THREE.Texture | null | undefined>)[slot]?.uuid ?? '').join(',');
  const materialFor = (m: THREE.Material): MaterialId => {
    const hit = byUuid.get(m.uuid);
    if (hit) return hit;
    let id: MaterialId;
    if (o.isFallbackMaterial?.(m)) {
      id = 'tm_default';
      if (!materials[id]) materials[id] = defaultInstance(id, 100);
    } else {
      const params = surfaceParams(m);
      if (o.srgbColors && params.baseColor) {
        const c = new THREE.Color(params.baseColor[0], params.baseColor[1], params.baseColor[2]).convertSRGBToLinear();
        params.baseColor = [c.r, c.g, c.b, 1];
      }
      if (o.roughnessWhenDefault !== undefined && params.roughness === 1 && params.metallic === 0) params.roughness = o.roughnessWhenDefault;
      // Loaders often make one material per mesh: equal ones (same name, parameters and textures) are one instance.
      const key = `${m.name}|${JSON.stringify(params)}|${textureKey(m)}`;
      const same = byKey.get(key);
      if (same) {
        byUuid.set(m.uuid, same);
        return same;
      }
      id = `tm${Object.keys(materials).filter((k) => k !== 'tm_default').length + 1}`;
      materials[id] = plainInstance(id, m.name || 'Material', params);
      sources.set(id, m);
      byKey.set(key, id);
    }
    byUuid.set(m.uuid, id);
    return id;
  };

  const link = (parent: SceneNode, kids: readonly NodeId[]): void => {
    for (const k of kids) {
      nodes[k].parent = parent.id;
      parent.children.push(k);
    }
  };

  const makePart = (mesh: THREE.Mesh): NodeId | null => {
    const geometry = readGeometry(mesh, o.ignoreNormals === true);
    const label = mesh.name || `Part ${n + 1}`;
    if (!geometry) {
      warnings.push({ code: 'degenerate', params: { part: label, count: ((mesh.geometry as THREE.BufferGeometry).index?.count ?? (mesh.geometry as THREE.BufferGeometry).getAttribute('position')?.count ?? 0) / 3 } });
      return null;
    }
    if (geometry.dropped > 0) warnings.push({ code: 'degenerate', params: { part: label, count: geometry.dropped } });
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const idOf = (slotIndex: number): MaterialId => materialFor(list[slotIndex] ?? list[0] ?? new THREE.MeshStandardMaterial());
    const mats = Array.from(geometry.materialOf, idOf);
    const initial = mats[0];
    const ranges: FaceRange[] = [];
    for (let i = 0; i < mats.length; i++) {
      if (mats[i] === initial) continue;
      const last = ranges[ranges.length - 1];
      if (last && last.material === mats[i] && last.start + last.count === i) last.count++;
      else ranges.push({ start: i, count: 1, material: mats[i] });
    }
    // Re-centre the part on its bounds: the node position carries the offset.
    const p = geometry.mesh.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < lo[k]) lo[k] = p[i + k];
        if (p[i + k] > hi[k]) hi[k] = p[i + k];
      }
    }
    const c: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    for (let i = 0; i < p.length; i += 3) {
      p[i] -= c[0];
      p[i + 1] -= c[1];
      p[i + 2] -= c[2];
    }
    const id = newId();
    const node: SceneNode = { ...base(id, label, 'PART'), mesh: registerMesh(`${o.format.toLowerCase()}:${run}:${id}`, geometry.mesh), material: initial, smooth: true };
    if (ranges.length > 0) node.faceMaterials = ranges;
    node.transform.position = c;
    nodes[id] = node;
    if (!mesh.name) autoNamed.add(id);
    const layer = o.layerOf?.(mesh);
    if (layer !== undefined) layers[id] = layer;
    return id;
  };

  const convert = (obj: THREE.Object3D): NodeId[] => {
    const kids = obj.children.flatMap(convert);
    if ((obj as THREE.Mesh).isMesh) {
      const part = makePart(obj as THREE.Mesh);
      if (part === null) return kids;
      if (kids.length === 0) return [part];
      const gid = newId();
      nodes[gid] = { ...base(gid, obj.name || `Group ${n}`, 'GROUP'), visible: obj.visible };
      link(nodes[gid], [part, ...kids]);
      return [gid];
    }
    if (kids.length === 0 || obj === root) return kids;
    if (o.collapseSingleParts && kids.length === 1 && nodes[kids[0]].kind === 'PART') {
      // The build item is the part: it takes the item's name when it has none of its own.
      if (autoNamed.has(kids[0]) && obj.name) nodes[kids[0]].name = obj.name;
      return kids;
    }
    const gid = newId();
    nodes[gid] = { ...base(gid, obj.name || `Group ${n}`, 'GROUP'), visible: obj.visible };
    link(nodes[gid], kids);
    return [gid];
  };

  const rootKids = convert(root);
  if (rootKids.length === 0) throw new Error('no meshes');
  const modelId = newId();
  nodes[modelId] = {
    ...base(modelId, o.fileName.replace(/\.[^.]+$/, '') || o.fileName, 'MODEL'),
    visible: root.visible,
    source: { kind: 'FILE', name: o.fileName, format: o.format },
  };
  link(nodes[modelId], rootKids);

  // Parts that are hidden themselves or through a parent.
  let hiddenParts = 0;
  const count = (id: NodeId, hidden: boolean): void => {
    const node = nodes[id];
    const h = hidden || !node.visible;
    if (node.kind === 'PART' && h) hiddenParts++;
    for (const c of node.children) count(c, h);
  };
  count(modelId, false);
  return { nodes, roots: [modelId], materials, layers, hiddenParts, warnings, sources };
}

/** The payload of a converted scene, with what the reader detected. */
export function toPayload(c: ConvertedScene, detected: Pick<ImportDetected, 'units' | 'upAxis' | 'upAxisDeclared'> & Partial<ImportDetected>, textures: ImportTexture[] = []): ImportPayload {
  const payload: ImportPayload = {
    nodes: c.nodes,
    roots: c.roots,
    materials: c.materials,
    detected: { size: 0, hasLayers: false, hiddenParts: c.hiddenParts, ...detected },
  };
  payload.detected.size = payloadSize(payload);
  if (Object.keys(c.layers).length > 0) {
    payload.layers = c.layers;
    payload.detected.hasLayers = true;
  }
  if (textures.length > 0) payload.textures = textures;
  return payload;
}

// --- Textures ----------------------------------------------------------------------------------

const TEXTURE_SLOTS: readonly [keyof THREE.MeshStandardMaterial | 'specularMap', ImportTexture['slot']][] = [
  ['map', 'color'],
  ['roughnessMap', 'roughness'],
  ['metalnessMap', 'metal'],
  ['normalMap', 'normal'],
  ['alphaMap', 'alpha'],
  ['bumpMap', 'other'],
  ['aoMap', 'other'],
  ['emissiveMap', 'other'],
  ['specularMap', 'other'],
];

/** Waits (up to `ms`) for a texture whose image is still loading. */
async function imageOf(tex: THREE.Texture, ms = 4000): Promise<unknown> {
  const started = Date.now();
  while (!tex.image && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 20));
  return tex.image;
}

/** The bytes of a texture image: the original when it came from a blob or data URL, else a PNG drawn from it. */
async function textureBlob(tex: THREE.Texture): Promise<Blob | null> {
  const img = await imageOf(tex);
  if (!img || typeof document === 'undefined') return null;
  try {
    if (img instanceof HTMLImageElement) {
      await img.decode();
      if (/^(?:blob|data):/.test(img.src)) return await (await fetch(img.src)).blob();
    }
    const source = img as CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
    const w = source.naturalWidth || source.width || 0;
    const h = source.naturalHeight || source.height || 0;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(source, 0, 0);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  }
}

/** The texture images the materials of a scene use, as blobs (browser only; empty elsewhere). */
export async function collectTextures(sources: ReadonlyMap<MaterialId, THREE.Material>): Promise<ImportTexture[]> {
  const out: ImportTexture[] = [];
  for (const [id, m] of sources) {
    const seen = new Set<string>();
    for (const [key, slot] of TEXTURE_SLOTS) {
      const tex = (m as unknown as Record<string, THREE.Texture | null | undefined>)[key];
      if (!tex || !(tex as THREE.Texture).isTexture || seen.has(tex.uuid)) continue;
      seen.add(tex.uuid);
      const blob = await textureBlob(tex);
      if (blob) out.push({ name: tex.name || `${m.name || 'material'}-${key}`, slot, material: id, mime: blob.type || 'image/png', blob });
    }
  }
  return out;
}

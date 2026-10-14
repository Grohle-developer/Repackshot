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
//     the three material (Phong shininess is mapped to roughness). Its maps
//     (M2a) become the slots of the instance (`collectTextures`): colour,
//     roughness, metal, normal (or a bump map as a height map), alpha and
//     emission, with the texture's transform as the mapping, and the images as
//     PNG or JPEG files (the original bytes where the loader kept them, a PNG
//     drawn from the decoded image otherwise; in a browser only).
//   - UVs (and a second set, `uv1`) are kept per corner; glTF's v runs down and
//     is turned over (`flipV`) to the model's convention (core/textures.ts).
//
// Nothing here scales or turns the axes: the geometry stays in the units and
// axes of the file and the import options (core/import-options.ts) do the rest.

import * as THREE from 'three';
import type { ImportDetected, ImportMessage, ImportPayload, ImportTexture } from '../core/import-options';
import { checkTextureFile, textureImageId } from '../core/texture-images';
import { defaultMapping, newSlot, sharedMapping, type TextureMapping, type TextureSlot, type TextureSlotKey, type TextureWrap } from '../core/textures';
import { payloadSize } from '../core/import-options';
import { defaultInstance, plainInstance, type MaterialId, type MaterialInstance } from '../core/materials';
import { registerMesh, type MeshData } from '../core/meshes';
import type { FaceRange, NodeId, SceneNode } from '../core/scene';
import type { MaterialParams } from '../data/types';
import { buildMesh, findCompanion, companionKey, roughnessFromShininess, type Companions, type RawMesh } from './mesh-common';

export { companionKey, findCompanion, roughnessFromShininess, type Companions } from './mesh-common';
export { textureNotes } from './texture-notes';

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
  /** The file's v runs down (glTF): turn it over to the model's v up. */
  flipV?: boolean;
  /** More of what makes two materials the same (glTF: the file's definition, whose maps the loader may not have loaded). */
  materialKey?(m: THREE.Material): string;
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
function readGeometry(mesh: THREE.Mesh, ignoreNormals: boolean, flipV: boolean): PartGeometry | null {
  const g = mesh.geometry as THREE.BufferGeometry;
  const pos = g.getAttribute('position');
  if (!pos || pos.count === 0) return null;
  const nor = ignoreNormals ? undefined : g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const uv1 = uv ? g.getAttribute('uv1') : undefined;
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
  const uvs2 = uv1 ? new Float32Array(triangles * 6) : null;
  const vOf = (y: number): number => (flipV ? 1 - y : y);
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
        uvs[6 * t + 2 * j + 1] = vOf(uv.getY(vi));
      }
      if (uvs2 && uv1) {
        uvs2[6 * t + 2 * j] = uv1.getX(vi);
        uvs2[6 * t + 2 * j + 1] = vOf(uv1.getY(vi));
      }
    }
  }
  const raw: RawMesh = { positions, normals, uvs, uvs2 };
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
    MAP_KEYS.map((slot) => (m as unknown as Record<string, THREE.Texture | null | undefined>)[slot]?.uuid ?? '').join(',') + (o.materialKey ? `|${o.materialKey(m)}` : '');
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
    const geometry = readGeometry(mesh, o.ignoreNormals === true, o.flipV === true);
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
      if (kids.length === 0) {
        nodes[part].visible = obj.visible;
        return [part];
      }
      // A mesh with children: the group carries the visibility of the object (and so hides the children), the part is shown by it.
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

/** Every map of a three material, for telling materials apart. */
const MAP_KEYS = ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'alphaMap', 'bumpMap', 'aoMap', 'emissiveMap', 'specularMap', 'lightMap'] as const;

/** Waits (up to `ms`) for a texture whose image is still loading. */
async function imageOf(tex: THREE.Texture, ms = 4000): Promise<unknown> {
  const started = Date.now();
  while (!tex.image && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 20));
  return tex.image;
}

/** A canvas with the pixels of a decoded image, an ImageBitmap or a DataTexture's RGBA / RGB bytes. */
function canvasOf(img: unknown): HTMLCanvasElement | null {
  const source = img as CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; data?: ArrayLike<number> };
  const w = source.naturalWidth || source.width || 0;
  const h = source.naturalHeight || source.height || 0;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (source.data && !(img instanceof HTMLImageElement) && !(img instanceof HTMLCanvasElement)) {
    // A DataTexture (TGA in FBX): straight bytes, RGBA or RGB, rows from the top as three keeps them for flipY.
    const data = source.data;
    const per = data.length >= w * h * 4 ? 4 : 3;
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      out.data[4 * i] = data[per * i];
      out.data[4 * i + 1] = data[per * i + 1];
      out.data[4 * i + 2] = data[per * i + 2];
      out.data[4 * i + 3] = per === 4 ? data[per * i + 3] : 255;
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  }
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** The bytes of a texture image: the original when it came from a blob or data URL and is a PNG or JPEG, else a PNG drawn from it. */
async function textureBytes(tex: THREE.Texture): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null;
  const img = await imageOf(tex);
  if (!img) return null;
  try {
    if (img instanceof HTMLImageElement) {
      await img.decode();
      if (/^(?:blob|data):/.test(img.src)) {
        // The file itself when it is one we keep (a PNG or JPEG, even one too large: the check says so later).
        const original = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
        const checked = checkTextureFile(original);
        if (!('reason' in checked) || checked.reason !== 'format') return original;
      }
    }
    const canvas = canvasOf(img);
    if (!canvas) return null;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const WRAPS: Record<number, TextureWrap> = { [THREE.RepeatWrapping]: 'REPEAT', [THREE.ClampToEdgeWrapping]: 'CLAMP', [THREE.MirroredRepeatWrapping]: 'MIRROR' };

/**
 * A three texture's transform as a mapping (UV): three applies `T(offset) R(-rotation) S(repeat)` about `center`
 * in the same v-up space as ours for the loaders that flip their images (every one but glTF's), so the turn
 * changes sign and the centre goes into the offset. (Three scales after turning, we turn after scaling: the same
 * when the repeat is uniform or there is no turn, the common case.)
 */
export function mappingOfTexture(tex: THREE.Texture): TextureMapping {
  const m = defaultMapping();
  const sx = tex.repeat.x;
  const sy = tex.repeat.y;
  const r = tex.rotation;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  const cx = tex.center.x;
  const cy = tex.center.y;
  m.repeat = [sx, sy];
  m.rotationDeg = (-r * 180) / Math.PI;
  m.offset = [-sx * (c * cx + sn * cy) + cx + tex.offset.x, -sy * (-sn * cx + c * cy) + cy + tex.offset.y];
  m.uvSet = tex.channel === 1 ? 1 : 0;
  m.wrap = WRAPS[tex.wrapS] ?? 'REPEAT';
  return m;
}

/** What a three map becomes in our model. */
const MAP_SLOTS: readonly { key: string; slot: TextureSlotKey | null; unused?: string }[] = [
  { key: 'map', slot: 'color' },
  { key: 'roughnessMap', slot: 'roughness' },
  { key: 'metalnessMap', slot: 'metal' },
  { key: 'normalMap', slot: 'normal' },
  { key: 'bumpMap', slot: 'normal' },
  { key: 'alphaMap', slot: 'alpha' },
  { key: 'emissiveMap', slot: 'emission' },
  { key: 'aoMap', slot: null, unused: 'occlusion' },
  { key: 'specularMap', slot: null, unused: 'specular' },
  { key: 'lightMap', slot: null, unused: 'light' },
];

/**
 * The maps of the scene's three materials as slots of their instances (in place: `c.materials` gets its
 * textures) and the images they use as files (browser only; in Node there is nothing to decode them with and
 * nothing is collected). A map whose image cannot be had is reported as dropped; one we have no slot for, as
 * unused.
 */
export async function collectTextures(c: Pick<ConvertedScene, 'materials' | 'sources'>): Promise<ImportTexture[]> {
  if (typeof document === 'undefined') return [];
  const out: ImportTexture[] = [];
  const byTexture = new Map<string, ImportTexture>();
  for (const [id, m] of c.sources) {
    const inst = c.materials[id];
    if (!inst) continue;
    const any = m as unknown as Record<string, unknown> & { normalScale?: THREE.Vector2; bumpScale?: number; emissive?: THREE.Color; emissiveIntensity?: number; alphaTest?: number; transparent?: boolean };
    const textures = { ...inst.textures };
    // The mapping most maps share is the material's.
    const shared = sharedMapping(MAP_SLOTS.flatMap((spec) => {
      const tex = any[spec.key] as THREE.Texture | null | undefined;
      return spec.slot && tex?.isTexture ? [mappingOfTexture(tex)] : [];
    }));
    for (const spec of MAP_SLOTS) {
      const tex = any[spec.key] as THREE.Texture | null | undefined;
      if (!tex || !tex.isTexture) continue;
      if (spec.key === 'bumpMap' && textures.normal) continue; // a normal map wins over a bump map
      let entry = byTexture.get(tex.uuid);
      if (!entry) {
        const bytes = await textureBytes(tex);
        const name = tex.name || (tex.image as { src?: string } | undefined)?.src?.split('/').pop()?.split('?')[0] || `${m.name || 'material'}-${spec.key}`;
        const checked = bytes ? checkTextureFile(bytes) : null;
        entry =
          bytes && checked && 'header' in checked
            ? { id: textureImageId(bytes), name, bytes, width: checked.header.width, height: checked.header.height, materials: [], dropped: null }
            : { id: '', name, bytes: null, width: 0, height: 0, materials: [], dropped: checked && 'reason' in checked ? checked.reason : 'unreadable' };
        byTexture.set(tex.uuid, entry);
        out.push(entry);
      }
      if (!entry.materials.includes(id)) entry.materials.push(id);
      if (!spec.slot) {
        if (!entry.unused && !entry.dropped) out.push({ ...entry, bytes: null, unused: spec.unused, materials: [id] });
        continue;
      }
      if (entry.dropped) continue;
      const slot: TextureSlot = newSlot(spec.slot, { id: entry.id, name: entry.name, width: entry.width, height: entry.height });
      const mapping = mappingOfTexture(tex);
      // Three reads roughness from G, metal from B and alpha from G.
      if (spec.slot === 'alpha') slot.channel = 'G';
      if (spec.key === 'normalMap') slot.strength = Math.abs(any.normalScale?.x ?? 1);
      if (spec.key === 'bumpMap') {
        slot.height = true;
        slot.strength = Math.max(0, any.bumpScale ?? 1);
      }
      if (spec.slot === 'emission') {
        const e = any.emissive ?? new THREE.Color(1, 1, 1);
        slot.tint = [e.r, e.g, e.b];
        slot.strength = any.emissiveIntensity ?? 1;
      }
      slot.mapping = JSON.stringify(mapping) === JSON.stringify(shared) ? null : mapping;
      textures[spec.slot] = slot;
    }
    // A colour map with alpha on a material that is see-through or cut out: the alpha comes from it.
    const colour = textures.color;
    const alphaTest = any.alphaTest ?? 0;
    if (colour && !textures.alpha && (alphaTest > 0 || any.transparent === true)) {
      const entry = out.find((e) => e.id === colour.image.id && !e.unused);
      const png = entry?.bytes ? checkTextureFile(entry.bytes) : null;
      if (png && 'header' in png && png.header.channels === 4) {
        const alpha = newSlot('alpha', colour.image);
        alpha.channel = 'A';
        alpha.mapping = colour.mapping;
        alpha.cutout = alphaTest > 0;
        alpha.cutoff = alphaTest > 0 ? alphaTest : 0.5;
        textures.alpha = alpha;
      }
    }
    if (shared) textures.mapping = shared;
    c.materials[id] = { ...inst, textures };
  }
  return out;
}


/**
 * A loading manager that finds the files a model refers to (its textures) among the files dropped with it,
 * through object URLs; `dispose` frees them once the textures are read. Without companions or a browser it is
 * three's default manager.
 */
export function companionManager(companions: Companions | undefined): { manager: THREE.LoadingManager; dispose(): void } {
  const manager = new THREE.LoadingManager();
  const urls: string[] = [];
  if (!companions || companions.size === 0 || typeof URL.createObjectURL !== 'function') return { manager, dispose: () => undefined };
  const made = new Map<string, string>();
  manager.setURLModifier((url) => {
    if (/^(?:blob|data):/.test(url)) return url;
    const blob = findCompanion(companions, url);
    if (!blob) return url;
    const key = companionKey(url);
    let u = made.get(key);
    if (!u) {
      u = URL.createObjectURL(blob);
      made.set(key, u);
      urls.push(u);
    }
    return u;
  });
  return { manager, dispose: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}

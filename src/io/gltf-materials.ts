// The materials of a glTF file as the file has them (phase M2a): read from its JSON, not through three's loader,
// so the factors are exact, the images are the file's own bytes and Node reads them as the browser does.
//
//   - PBR metallic-roughness (glTF 2.0 §3.9.2): `baseColorFactor` (linear) and texture, `metallicFactor`,
//     `roughnessFactor` and `metallicRoughnessTexture` (G roughness, B metal), `normalTexture` with its `scale`,
//     `emissiveFactor` and texture (with KHR_materials_emissive_strength), `alphaMode` and `alphaCutoff` (the
//     alpha comes from the base colour texture's A and the factor's fourth value), `occlusionTexture` (no slot
//     for it: reported). KHR_materials_transmission, _ior and _clearcoat where our model has the field.
//   - KHR_texture_transform (offset, rotation, scale, texCoord) and the sampler's wrap as the slot's mapping,
//     turned to our v-up convention: glTF's v runs down, so for its transform M the mapping is F·M·F with
//     F(u, v) = (u, 1 − v), which is a transform of the same kind (`gltfMapping`; core/textures.ts conventions).
//   - Images: in a buffer view (GLB, with `mimeType`), a data URI, or a file named by `uri`, looked for among
//     the files dropped with the model. PNG and JPEG are kept as they are; anything else (WebP, KTX2) is dropped
//     and the sheet says so.
//
// `forLoader` gives three's GLTFLoader the same file without any texture, so it does not decode the images a
// second time (and does not try to in Node).

import type { MaterialParams } from '../data/types';
import { checkTextureFile, textureImageId } from '../core/texture-images';
import { defaultMapping, type TextureChannel, type TextureDropReason, type TextureMapping, type TextureSlotKey, type TextureWrap } from '../core/textures';
import { base64ToBytes } from './base64';
import { findCompanion, type Companions } from './mesh-common';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const index = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** The JSON of a glTF and the binary chunk of a GLB (null for a .gltf). */
export function splitGltf(bytes: Uint8Array): { json: Json; bin: Uint8Array | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 12 && view.getUint32(0, true) === GLB_MAGIC) {
    let json: unknown = null;
    let bin: Uint8Array | null = null;
    const total = Math.min(bytes.length, view.getUint32(8, true));
    for (let at = 12; at + 8 <= total; ) {
      const len = view.getUint32(at, true);
      const type = view.getUint32(at + 4, true);
      const body = bytes.subarray(at + 8, Math.min(total, at + 8 + len));
      if (type === CHUNK_JSON && json === null) json = JSON.parse(new TextDecoder('utf-8').decode(body));
      else if (type === CHUNK_BIN && bin === null) bin = body;
      at += 8 + ((len + 3) & ~3);
    }
    if (!isObject(json)) throw new Error('the GLB has no JSON');
    return { json, bin };
  }
  const json: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''));
  if (!isObject(json)) throw new Error('not a glTF file');
  return { json, bin: null };
}

/** What one textureInfo of a material asks for. */
export interface GltfSlotSpec {
  /** Index into `images` of `GltfAssets`. */
  image: number;
  mapping: TextureMapping;
  channel: TextureChannel;
  strength: number;
  tint: [number, number, number];
  cutout: boolean;
  cutoff: number;
}

/** A glTF material in our terms. */
export interface GltfMaterialSpec {
  name: string;
  params: MaterialParams;
  slots: Partial<Record<TextureSlotKey, GltfSlotSpec>>;
  /** Maps we have no slot for (`occlusion`), by image. */
  unused: { image: number; kind: string }[];
  /** Every image the material names, kept or not (for the sheet's report). */
  uses: number[];
}

/** An image of the file: its bytes when it is one we keep, or why not. */
export interface GltfImage {
  name: string;
  id: string;
  bytes: Uint8Array | null;
  width: number;
  height: number;
  channels: number;
  dropped: TextureDropReason | null;
}

export interface GltfAssets {
  materials: GltfMaterialSpec[];
  images: GltfImage[];
}

const WRAP: Record<number, TextureWrap> = { 10497: 'REPEAT', 33071: 'CLAMP', 33648: 'MIRROR' };

/** A textureInfo's transform and sampler as our mapping (see the header for the v turn). */
export function gltfMapping(info: Json, sampler: Json | null): TextureMapping {
  const m = defaultMapping();
  const ext = isObject(info.extensions) && isObject(info.extensions.KHR_texture_transform) ? info.extensions.KHR_texture_transform : null;
  const offset = ext && Array.isArray(ext.offset) ? [num(ext.offset[0], 0), num(ext.offset[1], 0)] : [0, 0];
  const scale = ext && Array.isArray(ext.scale) ? [num(ext.scale[0], 1), num(ext.scale[1], 1)] : [1, 1];
  const rot = ext ? num(ext.rotation, 0) : 0;
  const texCoord = ext && index(ext.texCoord) !== null ? index(ext.texCoord)! : (index(info.texCoord) ?? 0);
  // glTF turns by R(−rotation) (three.js reads it so too, `Matrix3.setUvTransform`): in the v-up space that is
  // R(+rotation), and the turned origin moves the offset: o' = (o_u, 1 − o_v) + R(rotation)(0, −s_v).
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  m.offset = [offset[0] + s * scale[1], 1 - offset[1] - c * scale[1]];
  m.rotationDeg = (rot * 180) / Math.PI;
  m.repeat = [scale[0], scale[1]];
  m.uvSet = texCoord === 1 ? 1 : 0;
  m.wrap = sampler ? (WRAP[num(sampler.wrapS, 10497)] ?? 'REPEAT') : 'REPEAT';
  // Plain zeros, not −0, so equal mappings are equal as text.
  m.offset = [m.offset[0] + 0, m.offset[1] + 0];
  m.rotationDeg += 0;
  return m;
}

/** The bytes of the file's images (async: a .gltf's buffers and images may be files dropped with it). */
async function imageBytes(json: Json, bin: Uint8Array | null, companions: Companions | undefined): Promise<GltfImage[]> {
  const buffers = list(json.buffers);
  const views = list(json.bufferViews);
  const loaded = new Map<number, Uint8Array | null>();
  const bufferOf = async (i: number): Promise<Uint8Array | null> => {
    if (loaded.has(i)) return loaded.get(i)!;
    const b = buffers[i];
    let out: Uint8Array | null = null;
    if (isObject(b)) {
      if (typeof b.uri !== 'string') out = i === 0 ? bin : null;
      else if (b.uri.startsWith('data:')) out = dataUri(b.uri);
      else {
        const f = findCompanion(companions, b.uri);
        out = f ? new Uint8Array(await f.arrayBuffer()) : null;
      }
    }
    loaded.set(i, out);
    return out;
  };
  const out: GltfImage[] = [];
  for (const [i, raw] of list(json.images).entries()) {
    const img = isObject(raw) ? raw : {};
    const name = typeof img.name === 'string' && img.name ? img.name : typeof img.uri === 'string' && !img.uri.startsWith('data:') ? decodeName(img.uri) : `image ${i}`;
    let bytes: Uint8Array | null = null;
    let missing = false;
    if (index(img.bufferView) !== null) {
      const v = views[index(img.bufferView)!];
      if (isObject(v)) {
        const buf = await bufferOf(index(v.buffer) ?? 0);
        const start = index(v.byteOffset) ?? 0;
        const len = index(v.byteLength) ?? 0;
        if (buf && start + len <= buf.length) bytes = buf.slice(start, start + len);
      }
    } else if (typeof img.uri === 'string') {
      if (img.uri.startsWith('data:')) bytes = dataUri(img.uri);
      else {
        const f = findCompanion(companions, img.uri);
        if (f) bytes = new Uint8Array(await f.arrayBuffer());
        else missing = true;
      }
    }
    if (!bytes) {
      out.push({ name, id: '', bytes: null, width: 0, height: 0, channels: 0, dropped: missing ? 'missing' : 'unreadable' });
      continue;
    }
    const checked = checkTextureFile(bytes);
    if ('reason' in checked) out.push({ name, id: '', bytes: null, width: 0, height: 0, channels: 0, dropped: checked.reason });
    else out.push({ name, id: textureImageId(bytes), bytes, width: checked.header.width, height: checked.header.height, channels: checked.header.channels, dropped: null });
  }
  return out;
}

function decodeName(uri: string): string {
  const last = uri.split('/').pop() ?? uri;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function dataUri(uri: string): Uint8Array | null {
  const comma = uri.indexOf(',');
  if (comma < 0 || !uri.slice(0, comma).includes(';base64')) return null;
  try {
    return base64ToBytes(uri.slice(comma + 1));
  } catch {
    return null;
  }
}

/**
 * The materials and images of a glTF file (the bytes of a .glb or a .gltf; a .gltf's other files among
 * `companions`).
 */
export async function readGltfAssets(bytes: Uint8Array, companions?: Companions): Promise<GltfAssets> {
  const { json, bin } = splitGltf(bytes);
  const images = await imageBytes(json, bin, companions);
  const textures = list(json.textures);
  const samplers = list(json.samplers);
  /** The image of a texture index: its source, or the one an extension gives (WebP, KTX2: dropped as a format). */
  const imageOfTexture = (t: unknown): number | null => {
    const tex = textures[index(t) ?? -1];
    if (!isObject(tex)) return null;
    const own = index(tex.source);
    if (own !== null) return own;
    const ext = isObject(tex.extensions) ? tex.extensions : {};
    for (const e of Object.values(ext)) if (isObject(e) && index(e.source) !== null) return index(e.source);
    return null;
  };
  const samplerOf = (t: unknown): Json | null => {
    const tex = textures[index(t) ?? -1];
    if (!isObject(tex)) return null;
    const s = samplers[index(tex.sampler) ?? -1];
    return isObject(s) ? s : null;
  };

  const materials = list(json.materials).map((raw, mi): GltfMaterialSpec => {
    const m = isObject(raw) ? raw : {};
    const pbr = isObject(m.pbrMetallicRoughness) ? m.pbrMetallicRoughness : {};
    const ext = isObject(m.extensions) ? m.extensions : {};
    const factor = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor.map((x) => num(x, 1)) : [1, 1, 1, 1];
    const alphaMode = m.alphaMode === 'MASK' || m.alphaMode === 'BLEND' ? m.alphaMode : 'OPAQUE';
    const params: MaterialParams = {
      baseColor: [factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1, 1],
      metallic: num(pbr.metallicFactor, 1),
      roughness: num(pbr.roughnessFactor, 1),
    };
    // Alpha counts only when the mode says so (glTF §3.9.4): OPAQUE ignores it.
    if (alphaMode === 'BLEND' && (factor[3] ?? 1) < 1) params.opacity = factor[3];
    if (isObject(ext.KHR_materials_transmission)) {
      const tr = num(ext.KHR_materials_transmission.transmissionFactor, 0);
      if (tr > 0) params.transmission = tr;
    }
    if (isObject(ext.KHR_materials_ior)) params.ior = num(ext.KHR_materials_ior.ior, 1.5);
    if (isObject(ext.KHR_materials_clearcoat)) {
      const cc = num(ext.KHR_materials_clearcoat.clearcoatFactor, 0);
      if (cc > 0) {
        params.coat = cc;
        params.coatRoughness = num(ext.KHR_materials_clearcoat.clearcoatRoughnessFactor, 0);
      }
    }
    const slots: GltfMaterialSpec['slots'] = {};
    const unused: GltfMaterialSpec['unused'] = [];
    const uses: number[] = [];
    const slot = (info: unknown, key: TextureSlotKey, extra: Partial<GltfSlotSpec> = {}): void => {
      if (!isObject(info)) return;
      const image = imageOfTexture(info.index);
      if (image === null || !images[image]) return;
      if (!uses.includes(image)) uses.push(image);
      // An image that was not kept leaves the slot empty (the sheet says why).
      if (images[image].dropped) return;
      slots[key] = { image, mapping: gltfMapping(info, samplerOf(info.index)), channel: 'R', strength: 1, tint: [1, 1, 1], cutout: false, cutoff: 0.5, ...extra };
    };
    slot(pbr.baseColorTexture, 'color');
    slot(pbr.metallicRoughnessTexture, 'roughness', { channel: 'G' });
    slot(pbr.metallicRoughnessTexture, 'metal', { channel: 'B' });
    slot(m.normalTexture, 'normal', { strength: isObject(m.normalTexture) ? num(m.normalTexture.scale, 1) : 1 });
    const emissive = Array.isArray(m.emissiveFactor) ? m.emissiveFactor.map((x) => num(x, 0)) : [0, 0, 0];
    const strength = isObject(ext.KHR_materials_emissive_strength) ? num(ext.KHR_materials_emissive_strength.emissiveStrength, 1) : 1;
    // glTF: emission = factor × texture (a texture with a black factor gives nothing).
    if (emissive.some((x) => x > 0)) slot(m.emissiveTexture, 'emission', { tint: [emissive[0] ?? 0, emissive[1] ?? 0, emissive[2] ?? 0], strength });
    if (alphaMode !== 'OPAQUE' && slots.color) {
      const img = images[slots.color.image];
      if (img && img.channels === 4) slots.alpha = { ...slots.color, channel: 'A', cutout: alphaMode === 'MASK', cutoff: num(m.alphaCutoff, 0.5) };
    }
    if (isObject(m.occlusionTexture)) {
      const image = imageOfTexture(m.occlusionTexture.index);
      if (image !== null && images[image]) unused.push({ image, kind: 'occlusion' });
    }
    return { name: typeof m.name === 'string' ? m.name : `Material ${mi + 1}`, params, slots, unused, uses };
  });
  return { materials, images };
}

/** Drops every `*Texture` reference of a JSON value, in place. */
function stripTextures(v: unknown): void {
  if (Array.isArray(v)) v.forEach(stripTextures);
  else if (isObject(v)) {
    for (const k of Object.keys(v)) {
      if (/Texture$/.test(k)) delete v[k];
      else stripTextures(v[k]);
    }
  }
}

/** The same glTF without textures, for three's loader (its geometry, nodes and materials' factors are what we take from it). */
export function forLoader(bytes: Uint8Array): ArrayBuffer {
  const { json, bin } = splitGltf(bytes);
  const copy = JSON.parse(JSON.stringify(json)) as Json;
  stripTextures(copy.materials);
  delete copy.textures;
  delete copy.images;
  delete copy.samplers;
  // Extensions that only bring textures in would be asked for files that are no longer there.
  for (const key of ['extensionsUsed', 'extensionsRequired'] as const) {
    if (Array.isArray(copy[key])) copy[key] = (copy[key] as unknown[]).filter((e) => e !== 'EXT_texture_webp' && e !== 'KHR_texture_basisu' && e !== 'KHR_texture_transform');
  }
  const text = new TextEncoder().encode(JSON.stringify(copy));
  if (!bin) return text.buffer.slice(text.byteOffset, text.byteOffset + text.byteLength) as ArrayBuffer;
  const jsonLen = (text.length + 3) & ~3;
  const binLen = (bin.length + 3) & ~3;
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLen);
  view.setUint32(20 + jsonLen, binLen, true);
  view.setUint32(24 + jsonLen, CHUNK_BIN, true);
  out.set(bin, 28 + jsonLen);
  return out.buffer;
}

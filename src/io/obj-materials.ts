// The materials of an OBJ (phase M2a): its `mtllib` libraries (io/mtl.ts) and the images they name, found among
// the files dropped with the model. The parts of an OBJ start with one grey instance per `usemtl` name
// (import.ts `assemble`); a material of a library that is there gives that instance its parameters and maps.
// A library that was not dropped with the model is noted (`mtlIgnored`), as before; an image that was not is
// reported as missing.

import type { ImportMessage, ImportTexture } from '../core/import-options';
import type { MaterialId, MaterialInstance } from '../core/materials';
import { checkTextureFile, textureImageId } from '../core/texture-images';
import { defaultMapping, newSlot, sharedMapping, TEXTURE_SLOTS, type TextureMapping } from '../core/textures';
import { findCompanion, type Companions } from './mesh-common';
import { parseMtl, type MtlMap, type MtlMaterial } from './mtl';

/** What a map statement we have no slot for is, in the words the sheet uses (`texture.unused.<kind>`). */
const UNUSED_KIND: Record<string, string> = { map_ka: 'ambient', disp: 'displacement', decal: 'decal', refl: 'reflection', map_ks: 'specular', map_ns: 'shininess', map_bump: 'bump', norm: 'normal' };

function mappingOf(map: MtlMap): TextureMapping {
  const m = defaultMapping();
  m.repeat = [map.repeat[0], map.repeat[1]];
  m.offset = [map.offset[0], map.offset[1]];
  m.wrap = map.wrap;
  return m;
}

/**
 * Gives the instances of an OBJ (by material name) what its libraries say, in place, and returns the images they
 * use and what to tell the person. `materials` are the instances `assemble` made; `libraries` the `mtllib` names.
 */
export async function applyObjMaterials(materials: Record<MaterialId, MaterialInstance>, libraries: readonly string[], companions: Companions | undefined): Promise<{ textures: ImportTexture[]; notes: ImportMessage[] }> {
  const notes: ImportMessage[] = [];
  const missing: string[] = [];
  const defs = new Map<string, MtlMaterial>();
  for (const lib of libraries) {
    const blob = findCompanion(companions, lib);
    if (!blob) {
      missing.push(lib);
      continue;
    }
    for (const def of parseMtl(await blob.text())) if (!defs.has(def.name)) defs.set(def.name, def);
  }
  if (missing.length > 0) notes.push({ code: 'mtlIgnored', params: { files: missing.join(', ') } });

  const images = new Map<string, ImportTexture>();
  const imageFor = async (file: string, material: MaterialId): Promise<ImportTexture> => {
    const key = file.toLowerCase();
    let e = images.get(key);
    if (!e) {
      const name = file.split(/[\\/]/).pop() ?? file;
      const blob = findCompanion(companions, file);
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      const checked = bytes ? checkTextureFile(bytes) : null;
      e =
        bytes && checked && 'header' in checked
          ? { id: textureImageId(bytes), name, bytes, width: checked.header.width, height: checked.header.height, materials: [], dropped: null }
          : { id: '', name, bytes: null, width: 0, height: 0, materials: [], dropped: !bytes ? 'missing' : checked && 'reason' in checked ? checked.reason : 'unreadable' };
      images.set(key, e);
    }
    if (!e.materials.includes(material)) e.materials.push(material);
    return e;
  };
  const unused: ImportTexture[] = [];
  for (const [id, inst] of Object.entries(materials)) {
    const def = inst.name ? defs.get(inst.name) : undefined;
    if (!def) continue;
    const textures = { ...inst.textures };
    const shared = sharedMapping(TEXTURE_SLOTS.flatMap((k) => (def.maps[k] ? [mappingOf(def.maps[k]!)] : [])));
    for (const key of TEXTURE_SLOTS) {
      const map = def.maps[key];
      if (!map) continue;
      const img = await imageFor(map.file, id);
      if (img.dropped) continue;
      const slot = newSlot(key, { id: img.id, name: img.name, width: img.width, height: img.height });
      const mapping = mappingOf(map);
      slot.mapping = JSON.stringify(mapping) === JSON.stringify(shared) ? null : mapping;
      slot.invert = map.invert;
      slot.height = map.height;
      // A separate greyscale map: its luminance, unless -imfchan names a channel.
      if (key === 'roughness' || key === 'metal' || key === 'alpha') slot.channel = map.channel ?? 'L';
      if (key === 'normal' && map.height) slot.strength = map.bumpMultiplier;
      if (key === 'emission' && map.tint) slot.tint = [...map.tint];
      textures[key] = slot;
    }
    if (shared) textures.mapping = shared;
    for (const u of def.unused) unused.push({ id: '', name: u.map.file.split(/[\\/]/).pop() ?? u.map.file, bytes: null, width: 0, height: 0, materials: [id], dropped: null, unused: UNUSED_KIND[u.keyword] ?? 'other' });
    materials[id] = { ...inst, params: { ...inst.params, ...def.params }, textures };
  }
  return { textures: [...images.values(), ...unused], notes };
}

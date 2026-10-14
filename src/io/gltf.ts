// GLB / glTF import through three's GLTFLoader (UI.md §5 allows it here).
// The scene goes through the shared converter (three-scene.ts): every mesh a
// PART, every node with children a GROUP, all under one MODEL named after the
// file. glTF is Y up and in metres by its specification (glTF 2.0 §3.4); the
// reader leaves the numbers as they are and says so in `detected`, so the
// import options do the conversion to Z up and millimetres like for any other
// format.
//
// Materials and textures (M2a) come from the file's JSON (gltf-materials.ts):
// the factors as the file has them, the maps as texture slots with their
// transforms, the images as the file's own PNG and JPEG bytes. The loader gets
// the same file without textures (it would decode every image again, and in
// Node it cannot), and its UVs are turned over to the model's v up.

import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type * as THREE from 'three';
import type { ImportMessage, ImportPayload, ImportTexture } from '../core/import-options';
import type { MaterialId } from '../core/materials';
import { newSlot, sharedMapping, TEXTURE_SLOTS, type TextureMapping } from '../core/textures';
import { forLoader, readGltfAssets, type GltfAssets } from './gltf-materials';
import { companionManager, convertScene, textureNotes, toPayload, type Companions, type ConvertedScene } from './three-scene';

function parse(buffer: ArrayBuffer, manager?: THREE.LoadingManager): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    new GLTFLoader(manager).parse(buffer, '', (gltf) => resolve(gltf), (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

/** A File, or anything with a name and its bytes (see `importFile` in import.ts). */
export type GltfSource = Pick<File, 'name' | 'arrayBuffer'>;

export type ReadResult = ImportPayload & { warnings: ImportMessage[]; notes: ImportMessage[] };

/** The glTF material behind a three material of the loader, or undefined (the loader's own default). */
function gltfIndex(gltf: GLTF, m: THREE.Material): number | undefined {
  return (gltf.parser.associations.get(m) as { materials?: number } | undefined)?.materials;
}

/**
 * The file's materials on the instances the converter made (in place): its factors, and its maps as slots of
 * images named by their content. Returns the images, kept and dropped, with the materials that use them.
 */
export function applyGltfMaterials(c: Pick<ConvertedScene, 'materials' | 'sources'>, indexOf: (m: THREE.Material) => number | undefined, assets: GltfAssets): ImportTexture[] {
  const entries = new Map<number, ImportTexture>();
  const unused: ImportTexture[] = [];
  const entry = (i: number): ImportTexture => {
    let e = entries.get(i);
    if (!e) {
      const img = assets.images[i];
      e = { id: img.id, name: img.name, bytes: img.bytes, width: img.width, height: img.height, materials: [], dropped: img.dropped };
      entries.set(i, e);
    }
    return e;
  };
  for (const [id, three] of c.sources) {
    const index = indexOf(three);
    const spec = index === undefined ? undefined : assets.materials[index];
    const inst = c.materials[id];
    if (!spec || !inst) continue;
    const textures = { ...inst.textures };
    // The slot most maps share is the material's mapping; a slot with another one keeps its own.
    const shared = sharedMapping(TEXTURE_SLOTS.map((k) => spec.slots[k]?.mapping).filter((m): m is TextureMapping => m !== undefined));
    if (shared) textures.mapping = shared;
    for (const key of TEXTURE_SLOTS) {
      const s = spec.slots[key];
      if (!s) continue;
      const img = assets.images[s.image];
      const slot = newSlot(key, { id: img.id, name: img.name, width: img.width, height: img.height });
      slot.channel = s.channel;
      slot.strength = s.strength;
      slot.tint = [...s.tint];
      slot.cutout = s.cutout;
      slot.cutoff = s.cutoff;
      slot.mapping = shared && JSON.stringify(s.mapping) === JSON.stringify(shared) ? null : { ...s.mapping };
      textures[key] = slot;
    }
    for (const i of spec.uses) {
      const e = entry(i);
      if (!e.materials.includes(id)) e.materials.push(id as MaterialId);
    }
    for (const u of spec.unused) {
      const img = assets.images[u.image];
      unused.push({ id: img.id, name: img.name, bytes: null, width: img.width, height: img.height, materials: [id], dropped: null, unused: u.kind });
    }
    // The factors as the file has them (three's reading of opacity ignores the alpha mode).
    c.materials[id] = { ...inst, params: { ...spec.params }, textures };
  }
  return [...entries.values(), ...unused];
}

export async function readGltf(file: GltfSource, companions?: Companions): Promise<ReadResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const assets = await readGltfAssets(bytes, companions);
  // A .gltf's buffers may be files next to it, dropped with it.
  const files = companionManager(companions);
  let gltf: GLTF;
  try {
    gltf = await parse(forLoader(bytes), files.manager);
  } finally {
    files.dispose();
  }
  const converted = convertScene(gltf.scene, {
    fileName: file.name,
    format: 'GLTF',
    // A primitive without a material gets the loader's built-in one, which no glTF material maps to:
    // the part takes the neutral Default instead. (Clones made for flat shading carry an undefined
    // mapping, so test the value.)
    isFallbackMaterial: (m) => gltfIndex(gltf, m) === undefined,
    flipV: true,
    // Two glTF materials are one instance only when their definitions are the same (the loader saw no maps).
    materialKey: (m) => JSON.stringify(assets.materials[gltfIndex(gltf, m) ?? -1] ?? null),
  });
  const textures = applyGltfMaterials(converted, (m) => gltfIndex(gltf, m), assets);
  const notes = textureNotes(textures);
  // glTF is Y up and in metres by definition.
  const payload = toPayload(converted, { units: 'm', upAxis: 'Y', upAxisDeclared: true }, textures);
  return { ...payload, warnings: converted.warnings, notes };
}

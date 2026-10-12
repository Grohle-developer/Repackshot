// GLB / glTF import through three's GLTFLoader (UI.md §5 allows it here).
// The scene goes through the shared converter (three-scene.ts): every mesh a
// PART, every node with children a GROUP, all under one MODEL named after the
// file. glTF is Y up and in metres by its specification (glTF 2.0 §3.4); the
// reader leaves the numbers as they are and says so in `detected`, so the
// import options do the conversion to Z up and millimetres like for any other
// format.

import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ImportMessage, ImportPayload } from '../core/import-options';
import { collectTextures, convertScene, toPayload } from './three-scene';

function parse(buffer: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf), (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

/** A File, or anything with a name and its bytes (see `importFile` in import.ts). */
export type GltfSource = Pick<File, 'name' | 'arrayBuffer'>;

export type ReadResult = ImportPayload & { warnings: ImportMessage[]; notes: ImportMessage[] };

export async function readGltf(file: GltfSource): Promise<ReadResult> {
  const gltf = await parse(await file.arrayBuffer());
  const converted = convertScene(gltf.scene, {
    fileName: file.name,
    format: 'GLTF',
    // A primitive without a material gets the loader's built-in one, which no glTF material maps to:
    // the part takes the neutral Default instead. (Clones made for flat shading carry an undefined
    // mapping, so test the value.)
    isFallbackMaterial: (m) => (gltf.parser.associations.get(m) as { materials?: number } | undefined)?.materials === undefined,
  });
  const textures = await collectTextures(converted.sources);
  const notes: ImportMessage[] = textures.length > 0 ? [{ code: 'texturesKept', params: { count: textures.length } }] : [];
  // glTF is Y up and in metres by definition.
  const payload = toPayload(converted, { units: 'm', upAxis: 'Y', upAxisDeclared: true }, textures);
  return { ...payload, warnings: converted.warnings, notes };
}

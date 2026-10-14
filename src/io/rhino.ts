// Rhino 3DM through three's Rhino3dmLoader and the rhino3dm package (openNURBS
// compiled to wasm, MIT). The library is not part of the bundle: the loader
// fetches `rhino3dm.js` and `rhino3dm.wasm` from `public/vendor/rhino3dm/`
// (copied from node_modules by tools/vendor.mjs at build time) and runs them in
// a worker, only when a .3dm is imported.
//
// What comes in: the render meshes saved in the file (meshes, and the render
// meshes of breps, extrusions and SubD), the layers as groups (a layer inside a
// layer is a group inside a group) with their visibility, and the materials of
// the file as SIMPLE instances. A brep saved without render meshes cannot be
// shown: the loader skips it and this reader counts them in a note that tells
// the person to save the file with render meshes (or to export STEP). The
// model's unit system is read from the document settings; Rhino models are Z up.

import * as THREE from 'three';
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js';
import type { ImportDetected, ImportMessage, ImportUnit } from '../core/import-options';
import type { ReadResult } from './gltf';
import { collectTextures, textureNotes, convertScene, toPayload } from './three-scene';

let libraryPath = `${import.meta.env.BASE_URL}vendor/rhino3dm/`;

/** Where the loader fetches rhino3dm.js and rhino3dm.wasm from (tests point it at node_modules). */
export function setRhinoLibraryPath(path: string): void {
  libraryPath = path.endsWith('/') ? path : `${path}/`;
}

const UNITS: Record<string, ImportUnit> = {
  UnitSystem_Millimeters: 'mm',
  UnitSystem_Centimeters: 'cm',
  UnitSystem_Meters: 'm',
  UnitSystem_Inches: 'in',
};
/** Unit systems that say nothing: the heuristic decides. */
const NO_UNITS = new Set(['UnitSystem_None', 'UnitSystem_Unset', 'UnitSystem_CustomUnits']);

interface RhinoLayer {
  index: number;
  id: string;
  name: string;
  fullPath: string;
  parentLayerId: string;
  visible: boolean;
}

interface RhinoAttributes {
  layerIndex?: number;
  visible?: boolean;
  mode?: { name?: string };
}

const ZERO_ID = '00000000-0000-0000-0000-000000000000';

/** The unit the document declares, with the note for one the sheet does not offer. */
export function rhinoUnits(settings: { modelUnitSystem?: { name?: string } | string } | undefined): { units: ImportUnit | null; unsupported?: string } {
  const u = settings?.modelUnitSystem;
  const name = typeof u === 'string' ? u : (u?.name ?? '');
  if (UNITS[name]) return { units: UNITS[name] };
  if (!name || NO_UNITS.has(name)) return { units: null };
  return { units: null, unsupported: name.replace(/^UnitSystem_/, '').toLowerCase() };
}

export async function readRhino(name: string, buffer: ArrayBuffer): Promise<ReadResult> {
  const loader = new Rhino3dmLoader().setLibraryPath(libraryPath).setWorkerLimit(1);
  let loaded: THREE.Object3D;
  try {
    loaded = await loader.parseAsync(buffer);
  } finally {
    const url = (loader as unknown as { workerSourceURL?: string }).workerSourceURL;
    loader.dispose();
    if (url) URL.revokeObjectURL(url);
  }
  const userData = loaded.userData as { layers?: RhinoLayer[]; settings?: Parameters<typeof rhinoUnits>[0]; warnings?: { type?: string }[] };
  const layers = userData.layers ?? [];

  // Layers become groups: a layer inside a layer is a group inside a group.
  const top = new THREE.Group();
  const groups = new Map<number, THREE.Group>();
  for (const l of layers) {
    const g = new THREE.Group();
    g.name = l.name;
    g.visible = l.visible !== false;
    groups.set(l.index, g);
  }
  for (const l of layers) {
    const parent = l.parentLayerId && l.parentLayerId !== ZERO_ID ? layers.find((p) => p.id === l.parentLayerId) : undefined;
    (parent ? groups.get(parent.index)! : top).add(groups.get(l.index)!);
  }
  const layerOfIndex = (i: number | undefined): RhinoLayer | undefined => (i === undefined ? undefined : layers.find((l) => l.index === i));
  for (const child of [...loaded.children]) {
    const attributes = (child.userData as { attributes?: RhinoAttributes }).attributes;
    if (!(child as THREE.Mesh).isMesh) {
      // Block instances arrive as groups of cloned meshes: kept where they are, under the root.
      top.add(child);
      continue;
    }
    // The loader hid the mesh with its layer; the layer is a group now, so only the object's own flag stays.
    child.visible = attributes?.visible !== false && attributes?.mode?.name !== 'ObjectMode_Hidden';
    (groups.get(attributes?.layerIndex ?? -1) ?? top).add(child);
  }

  const converted = convertScene(top, {
    fileName: name,
    format: '3DM',
    // A mesh without a material gets the loader's built-in white metal: the part takes the neutral Default.
    isFallbackMaterial: (m) => m.name === THREE.Loader.DEFAULT_MATERIAL_NAME,
    // The loader builds colours from Rhino's 0..255 values without converting them out of sRGB, and leaves
    // roughness at three's 1 for materials that are not physically based.
    srgbColors: true,
    roughnessWhenDefault: 0.5,
    layerOf: (mesh) => layerOfIndex((mesh.userData as { attributes?: RhinoAttributes }).attributes?.layerIndex)?.fullPath,
  });
  const textures = await collectTextures(converted);

  const notes: ImportMessage[] = [];
  const missing = (userData.warnings ?? []).filter((w) => w.type === 'missing mesh').length;
  if (missing > 0) notes.push({ code: 'brepNoMesh', params: { count: missing } });
  const { units, unsupported } = rhinoUnits(userData.settings);
  if (unsupported) notes.push({ code: 'unitsUnsupported', params: { unit: unsupported } });
  notes.push(...textureNotes(textures));
  // Rhino is Z up by definition.
  const detected: Pick<ImportDetected, 'units' | 'upAxis' | 'upAxisDeclared' | 'unsupportedUnit'> = { units, upAxis: 'Z', upAxisDeclared: true, ...(unsupported ? { unsupportedUnit: unsupported } : {}) };
  return { ...toPayload(converted, detected, textures), warnings: converted.warnings, notes };
}

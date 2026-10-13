// USD, USDA, USDC and USDZ through three's USDLoader (the loader behind the
// deprecated USDZLoader name). What three reads: the Xform/Scope hierarchy,
// Mesh prims (with GeomSubset materials, normals and primvar UVs), the
// implicit Cube, Sphere, Cylinder, Cone and Capsule, UsdPreviewSurface
// materials with their textures, references and payloads that resolve inside
// the package, the first variant of each variant set, skeletons, animation,
// cameras and lights. What it does not: NURBS patches and curves, BasisCurves,
// Points, PointInstancer, volumes, and references to files outside the file
// that is dropped. When a text layer shows one of those the reader adds a note
// listing them; a binary (usdc) root layer is not scanned.
//
// The loader scales the root by `metersPerUnit` and turns a Z-up stage to Y up;
// this reader reads both from the text layer (or from the root transform for
// a binary one, where an absent or 1 `metersPerUnit` cannot be told apart and
// reads as undeclared), undoes them and reports them in `detected`.

import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';
import * as THREE from 'three';
import { unitFromMillimetres, type ImportDetected, type ImportMessage, type UpAxis } from '../core/import-options';
import type { ReadResult } from './gltf';
import { collectTextures, convertScene, toPayload } from './three-scene';

const CRATE = 'PXR-USDC';
/** Prim types three's loader skips. */
const UNSUPPORTED_PRIMS = ['NurbsPatch', 'NurbsCurves', 'BasisCurves', 'HermiteCurves', 'Points', 'PointInstancer', 'Volume', 'TetMesh'];

const isCrate = (b: Uint8Array): boolean => new TextDecoder('latin1').decode(b.subarray(0, CRATE.length)) === CRATE;

/** The text of the root layer, when it is ASCII; with whether the file is a package. */
function rootLayerText(bytes: Uint8Array): { text: string | null; packaged: boolean } {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = unzipSync(bytes);
    const first = Object.keys(zip)[0];
    const layer = first ? zip[first] : undefined;
    return { text: layer && !isCrate(layer) && /\.usd[a]?$/i.test(first) ? new TextDecoder('utf-8').decode(layer) : null, packaged: true };
  }
  return { text: isCrate(bytes) ? null : new TextDecoder('utf-8').decode(bytes), packaged: false };
}

export interface UsdHeader {
  /** Metres in one unit; null when the layer does not say. */
  metersPerUnit: number | null;
  upAxis: 'Y' | 'Z' | 'X' | null;
}

/** `metersPerUnit` and `upAxis` from the stage metadata of a text layer. */
export function usdHeader(text: string): UsdHeader {
  const mpu = /\bmetersPerUnit\s*=\s*([-+0-9.eE]+)/.exec(text)?.[1];
  const axis = /\bupAxis\s*=\s*"([XYZ])"/.exec(text)?.[1] as UsdHeader['upAxis'] | undefined;
  const m = mpu === undefined ? NaN : Number(mpu);
  return { metersPerUnit: Number.isFinite(m) && m > 0 ? m : null, upAxis: axis ?? null };
}

/** Things in a text layer that three's loader does not read. */
export function usdUnsupported(text: string, packaged: boolean): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\bdef\s+(\w+)\s+"/g)) if (UNSUPPORTED_PRIMS.includes(m[1])) found.add(m[1]);
  if (!packaged && /\b(?:references|payload)\s*=\s*(?:\[\s*)?(?:<[^>]*>\s*)?@/.test(text)) found.add('external references');
  return [...found];
}

export async function readUsd(name: string, buffer: ArrayBuffer): Promise<ReadResult> {
  const bytes = new Uint8Array(buffer);
  const layer = rootLayerText(bytes);
  const group = await new Promise<THREE.Group>((resolve, reject) => {
    try {
      new USDLoader().parse(buffer, '', resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
  const unsupported = layer.text ? usdUnsupported(layer.text, layer.packaged) : [];

  // Declared values: from the text layer, else from what the loader did to the root.
  const header = layer.text ? usdHeader(layer.text) : null;
  const turned = Math.abs(group.rotation.x + Math.PI / 2) < 1e-9;
  const meters = header ? header.metersPerUnit : group.scale.x !== 1 ? group.scale.x : null;
  const axis: UsdHeader['upAxis'] = header ? header.upAxis : turned ? 'Z' : null;
  group.rotation.set(0, 0, 0);
  group.scale.set(1, 1, 1);

  let converted;
  try {
    // A text layer without `normals` gets smooth ones computed by the loader: ignore them, hard edges come from the angle.
    converted = convertScene(group, { fileName: name, format: 'USD', ignoreNormals: layer.text !== null && !/\bnormals\b/.test(layer.text) });
  } catch (err) {
    if (unsupported.length > 0 && err instanceof Error) throw new Error(`${err.message} (this file has ${unsupported.join(', ')}, which this version does not read)`);
    throw err;
  }
  const textures = await collectTextures(converted.sources);

  const notes: ImportMessage[] = [];
  if (unsupported.length > 0) notes.push({ code: 'usdUnsupported', params: { features: unsupported.join(', ') } });
  let units: ImportDetected['units'] = null;
  let unsupportedUnit: string | undefined;
  if (meters !== null) {
    units = unitFromMillimetres(meters * 1000);
    if (!units) {
      unsupportedUnit = `${Number(meters.toPrecision(6))} m`;
      notes.push({ code: 'unitsUnsupported', params: { unit: unsupportedUnit } });
    }
  }
  let upAxis: UpAxis = axis === 'Z' ? 'Z' : 'Y';
  if (axis === 'X') notes.push({ code: 'axisUnsupported', params: { axis: 'X' } });
  if (textures.length > 0) notes.push({ code: 'texturesKept', params: { count: textures.length } });
  const detected: Pick<ImportDetected, 'units' | 'upAxis' | 'upAxisDeclared' | 'unsupportedUnit'> = { units, upAxis, upAxisDeclared: axis !== null, ...(unsupportedUnit ? { unsupportedUnit } : {}) };
  return { ...toPayload(converted, detected, textures), warnings: converted.warnings, notes };
}

// Collada (.dae) through three's ColladaLoader: the visual scene hierarchy
// becomes groups, geometries parts, materials SIMPLE instances (Phong
// shininess to roughness). The loader scales the scene by `<unit meter>` and
// turns a Z_UP file to Y up (it says so itself); this reader reads
// `<asset>` first, undoes both on the scene root and reports them in
// `detected`, so the import options convert like they do for any format.

import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { unitFromMillimetres, type ImportDetected, type ImportMessage, type UpAxis } from '../core/import-options';
import type { ReadResult } from './gltf';
import { collectTextures, companionManager, convertScene, textureNotes, toPayload, type Companions } from './three-scene';

export interface ColladaAsset {
  /** Metres in one unit of the file; null when `<unit>` is absent. */
  meter: number | null;
  /** The `<up_axis>`; Y_UP when absent (the Collada default). */
  upAxis: 'X_UP' | 'Y_UP' | 'Z_UP';
  upAxisDeclared: boolean;
}

/** Reads `<asset><unit meter="..."/><up_axis>` from the text of a .dae. */
export function colladaAsset(text: string): ColladaAsset {
  const asset = /<asset\b[\s\S]*?<\/asset>/i.exec(text)?.[0] ?? '';
  const meter = /<unit\b[^>]*\bmeter\s*=\s*["']([^"']+)["']/i.exec(asset)?.[1];
  const axis = /<up_axis>\s*([XYZ]_UP)\s*<\/up_axis>/i.exec(asset)?.[1]?.toUpperCase() as ColladaAsset['upAxis'] | undefined;
  const m = meter === undefined ? NaN : Number(meter);
  return { meter: Number.isFinite(m) && m > 0 ? m : null, upAxis: axis ?? 'Y_UP', upAxisDeclared: axis !== undefined };
}

export async function readCollada(name: string, text: string, companions?: Companions): Promise<ReadResult> {
  const asset = colladaAsset(text);
  // The images a .dae names are files next to it: the ones dropped with it.
  const files = companionManager(companions);
  const result = new ColladaLoader(files.manager).parse(text, '');
  if (!result || !result.scene) throw new Error('not a Collada document');
  const root = result.scene;
  // The loader applied the unit and the Z_UP turn to the root: take them back.
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  const converted = convertScene(root, { fileName: name, format: 'DAE' });
  const textures = await collectTextures(converted);
  files.dispose();

  const notes: ImportMessage[] = [];
  let units: ImportDetected['units'] = null;
  let unsupportedUnit: string | undefined;
  if (asset.meter !== null) {
    units = unitFromMillimetres(asset.meter * 1000);
    if (!units) {
      unsupportedUnit = `${Number(asset.meter.toPrecision(6))} m`;
      notes.push({ code: 'unitsUnsupported', params: { unit: unsupportedUnit } });
    }
  }
  let upAxis: UpAxis = asset.upAxis === 'Z_UP' ? 'Z' : 'Y';
  if (asset.upAxis === 'X_UP') {
    upAxis = 'Y';
    notes.push({ code: 'axisUnsupported', params: { axis: 'X' } });
  }
  notes.push(...textureNotes(textures));
  const detected: Pick<ImportDetected, 'units' | 'upAxis' | 'upAxisDeclared' | 'unsupportedUnit'> = { units, upAxis, upAxisDeclared: asset.upAxisDeclared, ...(unsupportedUnit ? { unsupportedUnit } : {}) };
  return { ...toPayload(converted, detected, textures), warnings: converted.warnings, notes };
}

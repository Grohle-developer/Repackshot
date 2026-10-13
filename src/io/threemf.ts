// 3MF through three's ThreeMFLoader: every build item is a part (an item with
// several objects, a group), the materials the file names become SIMPLE
// instances with their colour. The loader does not convert units, so the root
// model's `unit` attribute goes to `detected` (micron, millimeter, centimeter,
// inch, foot, meter; millimetres when absent, as the 3MF core specification
// says). 3MF is Z up.

import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { type ImportDetected, type ImportMessage, type ImportUnit } from '../core/import-options';
import type { ReadResult } from './gltf';
import { collectTextures, convertScene, toPayload } from './three-scene';

const UNITS: Record<string, ImportUnit> = { millimeter: 'mm', centimeter: 'cm', meter: 'm', inch: 'in' };

/** The `unit` attribute of the root model of a 3MF package ('millimeter' when absent), or null when the package has no model. */
export function threeMfUnit(buffer: ArrayBuffer): string | null {
  const zip = unzipSync(new Uint8Array(buffer));
  const model = Object.keys(zip).find((n) => /^3D\/[^/]*\.model$/i.test(n));
  if (!model) return null;
  const text = new TextDecoder('utf-8').decode(zip[model].subarray(0, 4096));
  return /<model\b[^>]*\sunit\s*=\s*["']([^"']+)["']/.exec(text)?.[1].toLowerCase() ?? 'millimeter';
}

export async function readThreeMf(name: string, buffer: ArrayBuffer): Promise<ReadResult> {
  const unit = threeMfUnit(buffer);
  if (unit === null) throw new Error('not a 3MF package');
  const root = new ThreeMFLoader().parse(buffer);
  // A build item is a group around its mesh: it is the part. Base materials carry a colour and no roughness.
  const converted = convertScene(root, { fileName: name, format: '3MF', collapseSingleParts: true, roughnessWhenDefault: 0.5 });
  const textures = await collectTextures(converted.sources);
  const notes: ImportMessage[] = [];
  const units = UNITS[unit] ?? null;
  let unsupportedUnit: string | undefined;
  if (!units) {
    unsupportedUnit = unit;
    notes.push({ code: 'unitsUnsupported', params: { unit } });
  }
  if (textures.length > 0) notes.push({ code: 'texturesKept', params: { count: textures.length } });
  const detected: Pick<ImportDetected, 'units' | 'upAxis' | 'upAxisDeclared' | 'unsupportedUnit'> = { units, upAxis: 'Z', upAxisDeclared: true, ...(unsupportedUnit ? { unsupportedUnit } : {}) };
  return { ...toPayload(converted, detected, textures), warnings: converted.warnings, notes };
}

// FBX (binary and ASCII, version 7 and later) through three's FBXLoader: the
// hierarchy becomes groups, meshes parts, materials SIMPLE instances (colour
// from the diffuse colour, roughness from the Phong shininess, metal 0) and
// their maps the instances' texture slots (M2a; embedded images, or the files
// dropped with the model for the ones it only names).
//
// FBXLoader does not convert units, and for a Z-up file it only turns the
// scene (it says so itself), so this reader looks at `GlobalSettings` before
// loading: `UpAxis` (0 X, 1 Y, 2 Z) and `UnitScaleFactor` (centimetres in one
// file unit: 1 is cm, 100 is m, 0.1 is mm, 2.54 is inch). The loader's
// rotation is undone and both values go to `detected`, so the import options
// turn the geometry like they do for any other format.

import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { unitFromMillimetres, type ImportDetected, type ImportMessage, type UpAxis } from '../core/import-options';
import type { ReadResult } from './gltf';
import { collectTextures, companionManager, convertScene, textureNotes, toPayload, type Companions } from './three-scene';

export interface FbxGlobals {
  /** 0 X, 1 Y, 2 Z; null when the file does not say. */
  upAxis: number | null;
  /** Centimetres in one unit of the file; null when the file does not say. */
  unitScaleFactor: number | null;
}

const BINARY_MAGIC = 'Kaydara FBX Binary';

/** Reads `UpAxis` and `UnitScaleFactor` from the `GlobalSettings` of an ASCII or binary FBX without parsing the rest. */
export function scanFbxGlobals(buffer: ArrayBuffer): FbxGlobals {
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder('latin1').decode(bytes.subarray(0, BINARY_MAGIC.length)) === BINARY_MAGIC) return scanBinary(bytes);
  const text = new TextDecoder('latin1').decode(bytes);
  const section = text.slice(Math.max(0, text.indexOf('GlobalSettings:')));
  const num = (name: string): number | null => {
    const m = new RegExp(`P:\\s*"${name}"\\s*,\\s*"[^"]*"\\s*,\\s*"[^"]*"\\s*,\\s*"[^"]*"\\s*,\\s*(-?[0-9.]+(?:[eE][-+]?[0-9]+)?)`).exec(section);
    return m ? Number(m[1]) : null;
  };
  return { upAxis: num('UpAxis'), unitScaleFactor: num('UnitScaleFactor') };
}

function scanBinary(bytes: Uint8Array): FbxGlobals {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(23, true);
  const wide = version >= 7500;
  const out: FbxGlobals = { upAxis: null, unitScaleFactor: null };
  const utf8 = new TextDecoder('utf-8');

  interface Header {
    end: number;
    count: number;
    listLen: number;
    name: string;
    body: number;
  }
  const header = (p: number): Header | null => {
    if (p + (wide ? 25 : 13) > bytes.byteLength) return null;
    const end = wide ? Number(dv.getBigUint64(p, true)) : dv.getUint32(p, true);
    const count = wide ? Number(dv.getBigUint64(p + 8, true)) : dv.getUint32(p + 4, true);
    const listLen = wide ? Number(dv.getBigUint64(p + 16, true)) : dv.getUint32(p + 8, true);
    const nameLen = dv.getUint8(p + (wide ? 24 : 12));
    const start = p + (wide ? 25 : 13);
    if (end === 0) return null;
    return { end, count, listLen, name: utf8.decode(bytes.subarray(start, start + nameLen)), body: start + nameLen };
  };

  /** The first five properties of a node (enough for `P: name, type, label, flags, value`). */
  const props = (h: Header): unknown[] => {
    const values: unknown[] = [];
    let p = h.body;
    for (let i = 0; i < Math.min(h.count, 5); i++) {
      const t = String.fromCharCode(dv.getUint8(p++));
      switch (t) {
        case 'S': {
          const len = dv.getUint32(p, true);
          values.push(utf8.decode(bytes.subarray(p + 4, p + 4 + len)));
          p += 4 + len;
          break;
        }
        case 'R': {
          p += 4 + dv.getUint32(p, true);
          values.push(null);
          break;
        }
        case 'I':
          values.push(dv.getInt32(p, true));
          p += 4;
          break;
        case 'F':
          values.push(dv.getFloat32(p, true));
          p += 4;
          break;
        case 'D':
          values.push(dv.getFloat64(p, true));
          p += 8;
          break;
        case 'L':
          values.push(Number(dv.getBigInt64(p, true)));
          p += 8;
          break;
        case 'Y':
          values.push(dv.getInt16(p, true));
          p += 2;
          break;
        case 'C':
          values.push(dv.getUint8(p));
          p += 1;
          break;
        default:
          // Arrays: length, encoding, compressed length, data. Not part of GlobalSettings.
          return values;
      }
    }
    return values;
  };

  const children = (h: Header, visit: (child: Header) => void): void => {
    let p = h.body + h.listLen;
    while (p < h.end) {
      const c = header(p);
      if (!c) break;
      visit(c);
      p = c.end;
    }
  };

  let p = 27;
  for (;;) {
    const top = header(p);
    if (!top) break;
    if (top.name === 'GlobalSettings') {
      children(top, (properties) => {
        if (properties.name !== 'Properties70') return;
        children(properties, (node) => {
          if (node.name !== 'P') return;
          const v = props(node);
          if (v[0] === 'UpAxis' && typeof v[4] === 'number') out.upAxis = v[4];
          else if (v[0] === 'UnitScaleFactor' && typeof v[4] === 'number') out.unitScaleFactor = v[4];
        });
      });
      break;
    }
    p = top.end;
  }
  return out;
}

/** The detected values for what a file's global settings say. */
export function fbxDetected(globals: FbxGlobals): { detected: Pick<ImportDetected, 'units' | 'upAxis' | 'upAxisDeclared' | 'unsupportedUnit'>; notes: ImportMessage[] } {
  const notes: ImportMessage[] = [];
  let upAxis: UpAxis = 'Y';
  if (globals.upAxis === 2) upAxis = 'Z';
  else if (globals.upAxis === 0) notes.push({ code: 'axisUnsupported', params: { axis: 'X' } });
  let units: ImportDetected['units'] = null;
  let unsupportedUnit: string | undefined;
  if (globals.unitScaleFactor !== null && globals.unitScaleFactor > 0) {
    units = unitFromMillimetres(globals.unitScaleFactor * 10);
    if (!units) {
      unsupportedUnit = `${Number(globals.unitScaleFactor.toPrecision(6))} cm`;
      notes.push({ code: 'unitsUnsupported', params: { unit: unsupportedUnit } });
    }
  }
  return { detected: { units, upAxis, upAxisDeclared: globals.upAxis !== null, ...(unsupportedUnit ? { unsupportedUnit } : {}) }, notes };
}

export async function readFbx(name: string, buffer: ArrayBuffer, companions?: Companions): Promise<ReadResult> {
  const globals = scanFbxGlobals(buffer);
  // Textures the file names but does not embed are looked for among the files dropped with it.
  const files = companionManager(companions);
  const root = new FBXLoader(files.manager).parse(buffer, '');
  // The loader turned a Z-up scene to Y up: undo it, the import options own the axes.
  if (globals.upAxis === 2) root.rotation.set(0, 0, 0);
  const converted = convertScene(root, { fileName: name, format: 'FBX' });
  const textures = await collectTextures(converted);
  files.dispose();
  const found = fbxDetected(globals);
  const notes = [...found.notes, ...textureNotes(textures)];
  return { ...toPayload(converted, found.detected, textures), warnings: converted.warnings, notes };
}

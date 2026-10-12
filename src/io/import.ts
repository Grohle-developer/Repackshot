// Import entry point: detects the format by header and extension, reads the
// file with the right importer (each one loaded on demand) and builds the
// nodes the store adds. `importFile` is what the interface calls; the OBJ and
// STL readers return parts and this module does the rest: part pivots, the
// materials the file names, the neutral Default for parts without one, the
// MODEL node and the scale note.
//
// The caller (ui/commands.ts) then adds the payload with `scene/addModel`,
// rests it on the floor and frames the camera, exactly as for glTF.

import { defaultInstance, plainInstance, type MaterialId, type MaterialInstance } from '../core/materials';
import { boxCenter } from '../core/math';
import { positionsBounds, registerMesh } from '../core/meshes';
import type { FaceRange, ModelPayload, NodeId, SceneNode } from '../core/scene';
import { isBinaryStl, largestDimension, looksLikeAsciiStl, type ImportMessage, type ParsedModel } from './mesh-common';

export type ImportFormat = 'GLTF' | 'OBJ' | 'STL';

/** Something to import: a browser `File`, or a name with its bytes (tests, drops from other sources). */
export type ImportSource = File | { name: string; bytes: ArrayBuffer | ArrayBufferView };

export interface ImportResult extends ModelPayload {
  format: ImportFormat;
  /** Data that was repaired or dropped while reading. */
  warnings: ImportMessage[];
  /** Informational: a suspicious size, material libraries that were not read. */
  notes: ImportMessage[];
}

/** Largest dimension (mm) under which a file is probably in metres. */
export const SMALL_MODEL_MM = 1;
/** Largest dimension (mm) above which a file is probably in micrometres, or wrong. */
export const LARGE_MODEL_MM = 10_000;

let importCounter = 0;

const EXTENSIONS: Record<string, ImportFormat> = { glb: 'GLTF', gltf: 'GLTF', obj: 'OBJ', stl: 'STL' };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The text of the first few bytes, to sniff text formats. */
function head(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096))).replace(/^﻿/, '');
}

/**
 * Detects the format: a binary glTF by its magic number, then the extension,
 * then the header for a file without a known extension (binary STL by its
 * size, JSON glTF, ASCII STL, OBJ statements).
 */
export function detectFormat(name: string, bytes: Uint8Array): ImportFormat | null {
  const ext = extensionOf(name);
  const magic = bytes.byteLength >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
  if (magic && ext !== 'stl') return 'GLTF';
  const byExtension = EXTENSIONS[ext];
  if (byExtension) return byExtension;
  if (isBinaryStl(bytes)) return 'STL';
  const text = head(bytes).trimStart();
  if (text.startsWith('{') && text.includes('"asset"')) return 'GLTF';
  if (looksLikeAsciiStl(bytes)) return 'STL';
  if (/^(?:#.*\n|\s*\n)*\s*(?:v|vn|vt|f|o|g|mtllib|usemtl)\s/m.test(text)) return 'OBJ';
  return null;
}

async function readBytes(file: ImportSource): Promise<{ name: string; bytes: Uint8Array }> {
  // `Blob.bytes()` exists in current browsers, so test for arrayBuffer() to tell a File from {name, bytes}.
  if (typeof (file as File).arrayBuffer === 'function') return { name: file.name, bytes: new Uint8Array(await (file as File).arrayBuffer()) };
  const b = (file as { bytes: ArrayBuffer | ArrayBufferView }).bytes;
  return { name: file.name, bytes: b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength) };
}

/** Reads a model file. Throws an Error with a readable reason when it cannot. */
export async function importFile(file: ImportSource): Promise<ImportResult> {
  const { name, bytes } = await readBytes(file);
  const format = detectFormat(name, bytes);
  if (!format) throw new Error('unknown file format');
  if (format === 'GLTF') {
    const { readGltf } = await import('./gltf');
    const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
    const buffer = (whole ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as ArrayBuffer;
    const payload = await readGltf({ name, arrayBuffer: async () => buffer });
    return { ...payload, format, warnings: [], notes: [] };
  }
  let parsed: ParsedModel;
  if (format === 'OBJ') {
    const { parseObj } = await import('./obj');
    parsed = parseObj(new TextDecoder('utf-8').decode(bytes), name);
  } else {
    const { parseStl } = await import('./stl');
    parsed = parseStl(bytes, name);
  }
  return assemble(parsed, name, format);
}

/** Rounds to three significant digits, for messages. */
function round3(x: number): number {
  return Number(x.toPrecision(3));
}

/** Turns parsed parts into nodes, materials and registered meshes. */
export function assemble(parsed: ParsedModel, fileName: string, format: ImportFormat): ImportResult {
  const run = ++importCounter;
  const nodes: Record<NodeId, SceneNode> = {};
  const materials: Record<MaterialId, MaterialInstance> = {};
  let n = 0;
  const newId = () => `t${++n}`;
  const base = (id: string, name: string, kind: SceneNode['kind'], parent: string | null): SceneNode => ({
    id,
    name,
    kind,
    parent,
    children: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
  });
  const modelId = newId();
  nodes[modelId] = { ...base(modelId, fileName.replace(/\.[^.]+$/, '') || fileName, 'MODEL', null), source: { kind: 'FILE', name: fileName, format } };

  // One SIMPLE grey instance per material name, shared by every part that uses it;
  // faces without a material take the neutral Default.
  const byName = new Map<string, MaterialId>();
  const materialFor = (name: string | null): MaterialId => {
    if (name === null) {
      if (!materials.tm_default) materials.tm_default = defaultInstance('tm_default', 100);
      return 'tm_default';
    }
    let id = byName.get(name);
    if (!id) {
      id = `tm${byName.size + 1}`;
      materials[id] = plainInstance(id, name, { baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.5 });
      byName.set(name, id);
    }
    return id;
  };

  const size = largestDimension(parsed.parts.map((p) => p.mesh.positions));
  const notes = [...parsed.notes];
  if (size > 0 && size < SMALL_MODEL_MM) {
    notes.push({ code: 'scaleSmall', params: { size: round3(size), factor: 1000 } });
    nodes[modelId].source!.unitHint = 1000;
  } else if (size > LARGE_MODEL_MM) {
    notes.push({ code: 'scaleLarge', params: { size: round3(size), factor: 0.001 } });
    nodes[modelId].source!.unitHint = 0.001;
  }

  for (const part of parsed.parts) {
    const id = newId();
    const mesh = part.mesh;
    // Re-centre the part on its own bounds, as the glTF importer does: the node carries the offset.
    const c = boxCenter(positionsBounds(mesh.positions));
    for (let i = 0; i < mesh.positions.length; i += 3) {
      mesh.positions[i] -= c[0];
      mesh.positions[i + 1] -= c[1];
      mesh.positions[i + 2] -= c[2];
    }
    const ref = registerMesh(`${format.toLowerCase()}:${run}:${id}`, mesh);
    const node: SceneNode = { ...base(id, part.name || `Part ${n}`, 'PART', modelId), mesh: ref, material: materialFor(part.material), smooth: true };
    if (part.ranges.length > 0) {
      const ranges: FaceRange[] = part.ranges.map((r) => ({ start: r.start, count: r.count, material: materialFor(r.material) }));
      node.faceMaterials = ranges;
    }
    node.transform.position = c;
    nodes[id] = node;
    nodes[modelId].children.push(id);
  }
  return { nodes, roots: [modelId], materials, format, warnings: parsed.warnings, notes };
}

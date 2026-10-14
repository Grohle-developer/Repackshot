// Import entry point: detects the format by header and extension and reads the
// file with the right importer (each one loaded on demand, so none is in the
// initial chunk). A reader returns the model as the file has it: the units and
// axes of the file, one MODEL with GROUP and PART nodes, the file's materials as
// SIMPLE instances, and in `detected` what the file says about its units and up
// axis. The import sheet (ui/panels/import-sheet.ts) chooses the options and
// `applyImportOptions` (core/import-options.ts) turns that into the nodes the
// store adds, the same way for every format.
//
// The OBJ and STL readers are our own (phase I1); glTF, FBX, 3DM, 3MF, PLY,
// DAE and USD go through three.js loaders (ARCHITECTURE §1) and the shared
// converter in three-scene.ts; STEP and IGES through occt-import-js in a
// worker (step.ts, phase I2), tessellated with the quality the sheet asks for.

import { payloadSize, type ImportMessage, type ImportPayload, type ImportReadOptions } from '../core/import-options';
import { defaultInstance, plainInstance, type MaterialId, type MaterialInstance } from '../core/materials';
import { boxCenter } from '../core/math';
import { positionsBounds, registerMesh } from '../core/meshes';
import type { FaceRange, NodeId, SceneNode } from '../core/scene';
import { isBinaryStl, looksLikeAsciiStl, type ParsedModel } from './mesh-common';

export { LARGE_MODEL_MM, SMALL_MODEL_MM } from '../core/import-options';

export type ImportFormat = 'GLTF' | 'OBJ' | 'STL' | 'FBX' | '3DM' | '3MF' | 'PLY' | 'DAE' | 'USD' | 'STEP' | 'IGES';

/** What a read can be told (core/import-options.ts): the tessellation of STEP and IGES, a cancel signal, progress. */
export type ImportFileOptions = ImportReadOptions;

/** Something to import: a browser `File`, or a name with its bytes (tests, drops from other sources). */
export type ImportSource = File | { name: string; bytes: ArrayBuffer | ArrayBufferView };

/** A model as the file has it (units, axes, materials) plus what the reader found out about it. */
export interface ImportResult extends ImportPayload {
  format: ImportFormat;
  /** Data that was repaired or dropped while reading. */
  warnings: ImportMessage[];
  /** Informational: material libraries that were not read, B-reps without a mesh, textures kept. */
  notes: ImportMessage[];
}

let importCounter = 0;

const EXTENSIONS: Record<string, ImportFormat> = {
  glb: 'GLTF',
  gltf: 'GLTF',
  obj: 'OBJ',
  stl: 'STL',
  fbx: 'FBX',
  '3dm': '3DM',
  '3mf': '3MF',
  ply: 'PLY',
  dae: 'DAE',
  usd: 'USD',
  usda: 'USD',
  usdc: 'USD',
  usdz: 'USD',
  step: 'STEP',
  stp: 'STEP',
  iges: 'IGES',
  igs: 'IGES',
};

/** Extensions this version reads (the interface lists them; it cannot import this module). */
export const READ_EXTENSIONS: readonly string[] = Object.keys(EXTENSIONS);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The text of the first few bytes, to sniff text formats. */
function head(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096))).replace(/^﻿/, '');
}

const latin1 = (bytes: Uint8Array, from: number, to: number): string => new TextDecoder('latin1').decode(bytes.subarray(from, Math.min(bytes.byteLength, to)));

/** The format a file's own header gives away (not STL or OBJ, which have no magic of their own), or null. */
function sniffHeader(bytes: Uint8Array): ImportFormat | null {
  const top = latin1(bytes, 0, 64);
  if (top.startsWith('Kaydara FBX Binary')) return 'FBX';
  if (top.startsWith('3D Geometry File Format')) return '3DM';
  if (top.startsWith('PXR-USDC')) return 'USD';
  if (/^\s*ISO-10303-21\s*;/.test(top)) return 'STEP';
  // IGES: 80-column records with the section letter in column 73, starting with the Start section.
  if (/^[^\r\n]{72}S[ \d]{7}\r?\n/.test(top + latin1(bytes, 64, 90))) return 'IGES';
  if (/^ply\r?\n/.test(top)) return 'PLY';
  const text = head(bytes).trimStart();
  if (text.startsWith('#usda')) return 'USD';
  if (text.startsWith('; FBX')) return 'FBX';
  if (/<COLLADA[\s>]/.test(text)) return 'DAE';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) {
    // A zip: the names of its entries are stored in plain text, at the front and in the directory at the back.
    const names = latin1(bytes, 0, 8192) + latin1(bytes, Math.max(0, bytes.byteLength - 65536), bytes.byteLength);
    if (/3D\/[^\0]*\.model/i.test(names)) return '3MF';
    if (/\.usd[acz]?\b/i.test(names)) return 'USD';
  }
  return null;
}

/**
 * Detects the format: a binary glTF by its magic number, then the extension,
 * then the header for a file without a known extension (the magic numbers and
 * first lines of FBX, 3DM, PLY, USD, DAE, 3MF, STEP, IGES; binary STL by its
 * size, JSON glTF, ASCII STL, OBJ statements).
 */
export function detectFormat(name: string, bytes: Uint8Array): ImportFormat | null {
  const ext = extensionOf(name);
  const magic = bytes.byteLength >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
  if (magic && ext !== 'stl') return 'GLTF';
  const byExtension = EXTENSIONS[ext];
  if (byExtension) return byExtension;
  const byHeader = sniffHeader(bytes);
  if (byHeader) return byHeader;
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

/** The bytes of a view as an ArrayBuffer of exactly that length (a copy only when the view is a slice). */
function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  return (whole ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as ArrayBuffer;
}

/**
 * Reads a model file in the units and axes of the file; throws an Error with a readable reason when it
 * cannot. The caller applies the import options (`applyImportOptions`) to get something the store adds.
 */
export async function importFile(file: ImportSource, options: ImportFileOptions = {}): Promise<ImportResult> {
  const { name, bytes } = await readBytes(file);
  const format = detectFormat(name, bytes);
  if (!format) throw new Error('unknown file format');
  switch (format) {
    case 'STEP':
    case 'IGES': {
      const { readStep } = await import('./step');
      return { ...(await readStep(name, bytes, format, options)), format };
    }
    case 'GLTF': {
      const { readGltf } = await import('./gltf');
      const buffer = arrayBufferOf(bytes);
      return { ...(await readGltf({ name, arrayBuffer: async () => buffer }, options.companions)), format };
    }
    case 'FBX': {
      const { readFbx } = await import('./fbx');
      return { ...(await readFbx(name, arrayBufferOf(bytes), options.companions)), format };
    }
    case '3DM': {
      const { readRhino } = await import('./rhino');
      return { ...(await readRhino(name, arrayBufferOf(bytes).slice(0))), format };
    }
    case '3MF': {
      const { readThreeMf } = await import('./threemf');
      return { ...(await readThreeMf(name, arrayBufferOf(bytes))), format };
    }
    case 'PLY': {
      const { readPly } = await import('./ply');
      return { ...(await readPly(name, arrayBufferOf(bytes))), format };
    }
    case 'DAE': {
      const { readCollada } = await import('./collada');
      return { ...(await readCollada(name, new TextDecoder('utf-8').decode(bytes), options.companions)), format };
    }
    case 'USD': {
      const { readUsd } = await import('./usd');
      return { ...(await readUsd(name, arrayBufferOf(bytes), options.companions)), format };
    }
    case 'OBJ': {
      const { parseObj } = await import('./obj');
      const parsed = parseObj(new TextDecoder('utf-8').decode(bytes), name);
      const result = assemble(parsed, name, format);
      if (!parsed.libraries?.length || !options.companions?.size) return result;
      // M2a: the material libraries and their images, when they were dropped with the file.
      const { applyObjMaterials } = await import('./obj-materials');
      const { textureNotes } = await import('./texture-notes');
      const { textures, notes } = await applyObjMaterials(result.materials, parsed.libraries, options.companions);
      const others = result.notes.filter((n) => n.code !== 'mtlIgnored');
      return { ...result, notes: [...others, ...notes, ...textureNotes(textures)], ...(textures.length > 0 ? { textures } : {}) };
    }
    case 'STL': {
      const { parseStl } = await import('./stl');
      return assemble(parseStl(bytes, name), name, format);
    }
  }
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

  for (const part of parsed.parts) {
    const id = newId();
    const mesh = part.mesh;
    // Re-centre the part on its own bounds: the node carries the offset.
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
  const payload = { nodes, roots: [modelId], materials };
  // OBJ and STL declare neither axis nor units: OBJ is taken as Y up (like glTF), STL as Z up (CAD and printing);
  // the units come from the size heuristic in the defaults (core/import-options.ts).
  const detected = { units: null, upAxis: format === 'OBJ' ? ('Y' as const) : ('Z' as const), upAxisDeclared: false, size: payloadSize(payload), hasLayers: false, hiddenParts: 0 };
  return { ...payload, detected, format, warnings: parsed.warnings, notes: [...parsed.notes] };
}

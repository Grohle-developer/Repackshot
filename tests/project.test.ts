// The project file (phase U2, ARCHITECTURE §8): base64 and GLB for the embedded meshes, the round trip of a whole
// project, the fixed files that must keep loading in every version, and the refusals (a newer version, damage,
// something that is not a project), which must leave the registry and the open project as they were.

import { writeFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as doctor from '../src/core/doctor';
import { applyImportOptions, defaultImportOptions } from '../src/core/import-options';
import { assignAction } from '../src/core/materials';
import { getMesh, meshIds, registerMesh, retainMeshes, setTriangleSource, triangleSource, type MeshData } from '../src/core/meshes';
import type { SceneNode } from '../src/core/scene';
import { createInitialState, createStore, type ProjectState } from '../src/core/store';
import { defaultPatternParams } from '../src/core/transform';
import * as base64 from '../src/io/base64';
import { base64ToBytes, bytesToBase64 } from '../src/io/base64';
import { glbToMesh, meshToGlb, packUint32, unpackUint32 } from '../src/io/glb';
import { importFile } from '../src/io/import';
import { occtToPayload } from '../src/io/occt-convert';
import type { OcctMesh } from '../src/io/occt-protocol';
import { loadProject, migrateProject, parseProject, PROJECT_FORMAT, PROJECT_SCHEMA, ProjectError, readProjectFile, sameMesh, serializeProject, STEPS } from '../src/io/project';
import { releaseCadWorker, setCadWorkerFactory } from '../src/io/step';
import { confirmImport, importFiles, setImportOptions } from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import { createUiStore } from '../src/ui/ui-state';
import v1Text from './fixtures/project-v1.json?raw';
import v2Text from './fixtures/project-v2.json?raw';
import { apply, exampleState, keyIds } from './helpers';
import { encode, readWithDefaults } from './io-helpers';
import { fixture, inProcessWorker, loadOcct, readCad } from './occt-node';

// --- Helpers -------------------------------------------------------------------------------------------------

/** Equal byte arrays (`toEqual` on hundreds of thousands of elements is far too slow to be a test). */
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const clean = (s: ProjectState): ProjectState => ({ ...s, meta: { ...s.meta, dirty: false } });
const text = (s: ProjectState): Promise<string> => serializeProject(s).text();
const partsOf = (s: ProjectState): SceneNode[] => Object.values(s.scene.nodes).filter((n) => n.kind === 'PART');
const nameOf = (s: ProjectState, name: string): SceneNode => Object.values(s.scene.nodes).find((n) => n.name === name)!;
/** A new browser session as far as geometry goes: nothing registered, importers numbering from 1 again. */
const newSession = (): void => retainMeshes(new Set());

/** A box of 20 with UVs on the caps and two `usemtl` on the body: 2 parts, face ranges, hard edges. */
const BOX_OBJ = `# written by tests/project.test.ts
v -10 -10 -10
v  10 -10 -10
v  10  10 -10
v -10  10 -10
v -10 -10  10
v  10 -10  10
v  10  10  10
v -10  10  10
vt 0 0
vt 1 0
vt 1 1
vt 0 1
g Caps
f 5/1 6/2 7/3 8/4
f 1/1 4/4 3/3 2/2
g Body
usemtl Steel
f 1 2 6 5
f 3 4 8 7
usemtl Brass
f 1 5 8 4
f 2 3 7 6
`;

/**
 * A project made the way a person makes one: an imported OBJ (Caps with UVs; Body with two materials by face
 * range), Gold on the caps, a linked copy and a flip (a derived mesh id), a studio, a second camera, an
 * animation, a queued render, a name. Two parts at the start, three materials, one mesh shared by two parts.
 */
async function buildProject(): Promise<ProjectState> {
  const r = await readWithDefaults({ name: 'box.obj', bytes: encode(BOX_OBJ) });
  let s = apply(createInitialState(), { type: 'scene/addModel', payload: { nodes: r.nodes, roots: r.roots, materials: r.materials }, replace: true });
  s = apply(s, { type: 'scene/select', ids: [nameOf(s, 'Caps').id], mode: 'set', level: 'PART' });
  s = apply(s, assignAction(s, { preset: 'GOLD' }));
  s = apply(s, { type: 'camera/frame' });
  return s;
}

/** The same project with everything else a project holds. */
async function buildBusyProject(): Promise<ProjectState> {
  let s = await buildProject();
  const body = nameOf(s, 'Body');
  s = apply(
    s,
    { type: 'scene/duplicate', ids: [body.id], linked: true },
    { type: 'scene/flipNormals', ids: [nameOf(s, 'Caps').id] },
    { type: 'studio/setPreset', key: 'JEWELLERY' },
    { type: 'studio/build' },
    { type: 'studio/setSetup', key: 'REMBRANDT' },
    { type: 'camera/add', name: 'Detail' },
    { type: 'camera/set', id: 'cam2', patch: { focalMm: 135, azimuth: 20, elevation: 10 } },
    { type: 'env/set', patch: { strength: 0.8, rotationDeg: 40 } },
    { type: 'image/set', patch: { exposureEv: 0.5, vignette: 0.2 } },
    { type: 'anim/preset', key: 'HERO' },
    { type: 'render/set', patch: { width: 1080, height: 1350, format: 'JPEG' } },
    { type: 'render/enqueue', at: 1, position: 'LAST' },
    { type: 'meta/rename', name: 'Box project' },
  );
  return s;
}

/** A project of one part that holds exactly this geometry (and triangle map). */
function onePart(id: string, data: MeshData, source?: Uint32Array): ProjectState {
  const ref = registerMesh(id, data);
  if (source) setTriangleSource(id, source);
  const part: SceneNode = {
    id: 'n1',
    name: 'Plate',
    kind: 'PART',
    parent: null,
    children: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    mesh: ref,
    material: null,
    smooth: true,
  };
  return { ...createInitialState(), scene: { nodes: { n1: part }, roots: ['n1'], partSizeMm: 100 } };
}

/** Two triangles of a quad, with the optional extras. */
function quad(extra: Partial<MeshData> = {}): MeshData {
  return {
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    ...extra,
  };
}

/** Wraps a project body with the envelope, for hand-made files. */
const envelope = (state: unknown, extra: Record<string, unknown> = {}, schema: number = PROJECT_SCHEMA): string => JSON.stringify({ format: PROJECT_FORMAT, schema, state, ...extra });
const withState = (s: ProjectState, edit: (raw: Record<string, any>) => void): string => {
  const raw = JSON.parse(JSON.stringify(s));
  edit(raw);
  return envelope(raw);
};

afterEach(() => newSession());

// --- Base64 --------------------------------------------------------------------------------------------------

describe('base64 for big buffers', () => {
  const bytesOf = (s: string) => new TextEncoder().encode(s);

  it('matches the vectors of RFC 4648', () => {
    for (const [plain, coded] of [['', ''], ['f', 'Zg=='], ['fo', 'Zm8='], ['foo', 'Zm9v'], ['foob', 'Zm9vYg=='], ['fooba', 'Zm9vYmE='], ['foobar', 'Zm9vYmFy']]) {
      expect(bytesToBase64(bytesOf(plain)), plain).toBe(coded);
      expect(new TextDecoder().decode(base64ToBytes(coded)), coded).toBe(plain);
    }
  });

  it('round trips every length around the chunk sizes, and ignores line breaks', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 12287, 12288, 12289, 24576, 65535, 65536, 65537, 100_003]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 131 + (i >> 8) * 7) & 255);
      const coded = bytesToBase64(bytes);
      expect(sameBytes(base64ToBytes(coded), bytes), `${n} bytes`).toBe(true);
      if (n > 100) expect(sameBytes(base64ToBytes(coded.replace(/(.{76})/g, '$1\r\n')), bytes), `${n} bytes wrapped`).toBe(true);
    }
  });

  it('refuses what is not base64', () => {
    for (const bad of ['A', 'AAA', '@@@@', 'AA=A', 'A===', 'AAAA=', 'ab!d', 'é===']) expect(() => base64ToBytes(bad), bad).toThrow('not base64');
  });

  it('handles tens of megabytes (no argument list of millions of numbers, no string grown by pieces)', { timeout: 30_000 }, () => {
    // `String.fromCharCode(...bytes)` on this many bytes throws a RangeError; so does anything that is not chunked.
    const big = new Uint8Array(24 * 1024 * 1024).map((_, i) => (i * 2654435761) >>> 24);
    const coded = bytesToBase64(big);
    expect(coded.length).toBe(32 * 1024 * 1024);
    const back = base64ToBytes(coded);
    expect(sameBytes(back, big)).toBe(true);
  });
});

// --- GLB -----------------------------------------------------------------------------------------------------

describe('a mesh as a GLB', () => {
  it('is a valid binary glTF 2.0 container', () => {
    const glb = meshToGlb('stl:1:n3', quad({ uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) }));
    const view = new DataView(glb.buffer);
    expect([view.getUint32(0, true), view.getUint32(4, true), view.getUint32(8, true)]).toEqual([0x46546c67, 2, glb.length]);
    expect(glb.length % 4).toBe(0);
    const jsonLength = view.getUint32(12, true);
    expect(view.getUint32(16, true)).toBe(0x4e4f534a);
    expect(jsonLength % 4).toBe(0);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
    expect(json.asset).toMatchObject({ version: '2.0', generator: 'Repackshot' });
    expect(json.meshes[0]).toMatchObject({ name: 'stl:1:n3', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, mode: 4 }] });
    expect(json.accessors.map((a: { count: number; type: string }) => [a.count, a.type])).toEqual([[4, 'VEC3'], [4, 'VEC3'], [4, 'VEC2'], [6, 'SCALAR']]);
    expect(json.accessors[0]).toMatchObject({ componentType: 5126, min: [0, 0, 0], max: [10, 10, 0] });
    expect(json.accessors[3].componentType).toBe(5125);
    // Binary chunk: 48 + 48 + 32 + 24 bytes.
    const binAt = 20 + jsonLength;
    expect([view.getUint32(binAt, true), view.getUint32(binAt + 4, true)]).toEqual([152, 0x004e4942]);
    expect(glb.length).toBe(binAt + 8 + 152);
  });

  it('keeps the layout it was given (golden bytes of a triangle)', () => {
    const tri = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) };
    expect(bytesToBase64(meshToGlb('tri', tri))).toBe(GOLDEN_TRIANGLE);
    expect(glbToMesh(base64ToBytes(GOLDEN_TRIANGLE))).toEqual({ name: 'tri', mesh: { ...tri, uvs: undefined } });
  });

  it('brings every number back bit for bit', () => {
    const odd = new Float32Array([-0, 0, 1e-45, -1e-45, 3.4028234663852886e38, Math.PI, NaN, Infinity, -Infinity, 0.1, 1 / 3, 255]);
    const cases: MeshData[] = [
      quad(),
      quad({ uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) }),
      quad({ uvs: new Float32Array(0) }),
      { positions: odd, normals: odd.slice().reverse(), indices: new Uint32Array([0, 1, 2, 3, 2, 1, 0xffffffff, 7, 7]) },
      { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) },
    ];
    for (const [i, mesh] of cases.entries()) {
      const back = glbToMesh(meshToGlb('m', mesh)).mesh;
      expect(sameMesh({ ...back }, { ...mesh, sharpEdges: undefined }), `case ${i}`).toBe(true);
      expect(Object.is(back.uvs === undefined, mesh.uvs === undefined), `case ${i} uvs`).toBe(true);
    }
  });

  it('reads views of a bigger buffer (meshes share arrays: a flip shares positions and UVs)', () => {
    const big = new Float32Array(100).map((_, i) => i);
    const positions = big.subarray(10, 22);
    const back = glbToMesh(meshToGlb('v', { positions, normals: big.subarray(40, 52), indices: new Uint32Array([0, 1, 2, 3, 2, 1]) })).mesh;
    expect([...back.positions]).toEqual([...positions]);
    expect([...back.normals]).toEqual([...big.subarray(40, 52)]);
  });

  it('packs 32-bit lists little endian', () => {
    expect([...packUint32(Uint32Array.of(1, 0x01020304))]).toEqual([1, 0, 0, 0, 4, 3, 2, 1]);
    expect([...unpackUint32(Uint8Array.of(1, 0, 0, 0, 4, 3, 2, 1))]).toEqual([1, 0x01020304]);
    expect(() => unpackUint32(Uint8Array.of(1, 2, 3))).toThrow();
  });

  it('refuses what it did not write, with a reason', () => {
    const glb = meshToGlb('m', quad());
    const view = (b: Uint8Array) => new DataView(b.buffer);
    const edit = (f: (b: Uint8Array, v: DataView) => void): Uint8Array => {
      const b = glb.slice();
      f(b, view(b));
      return b;
    };
    const jsonOf = (b: Uint8Array): { json: Record<string, any>; length: number } => {
      const length = view(b).getUint32(12, true);
      return { json: JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + length))), length };
    };
    /** The same GLB with its JSON chunk rewritten (any length): header, new JSON chunk, the binary chunk as it was. */
    const withJson = (f: (j: Record<string, any>) => void): Uint8Array => {
      const { json, length } = jsonOf(glb);
      f(json);
      const text = new TextEncoder().encode(JSON.stringify(json));
      const padded = (text.length + 3) & ~3;
      const bin = glb.subarray(20 + length);
      const out = new Uint8Array(20 + padded + bin.length);
      out.set(glb.subarray(0, 20));
      out.set(text, 20);
      out.fill(0x20, 20 + text.length, 20 + padded);
      out.set(bin, 20 + padded);
      const v = view(out);
      v.setUint32(8, out.length, true);
      v.setUint32(12, padded, true);
      return out;
    };
    const bad: [string, Uint8Array, RegExp][] = [
      ['too short', glb.slice(0, 10), /too short/],
      ['magic', edit((_, v) => v.setUint32(0, 0x12345678, true)), /bad magic/],
      ['version', edit((_, v) => v.setUint32(4, 1, true)), /version 1/],
      ['cut short', glb.slice(0, glb.length - 8), /cut short/],
      ['chunk past the end', edit((_, v) => v.setUint32(12, 1_000_000, true)), /past the end/],
      ['json', edit((b) => void b.fill(0x7b, 20, 30)), /JSON is damaged/],
      ['no binary chunk', edit((_, v) => v.setUint32(20 + v.getUint32(12, true) + 4, 0x12345678, true)), /no binary chunk/],
      ['no triangles', withJson((j) => (j.meshes[0].primitives[0].mode = 1)), /not made of triangles/],
      ['no mesh', withJson((j) => (j.meshes = [])), /no triangle mesh/],
      ['component type', withJson((j) => (j.accessors[0].componentType = 5123)), /POSITION: unsupported type/],
      ['type', withJson((j) => (j.accessors[2].type = 'VEC3')), /indices: unsupported type/],
      ['sparse', withJson((j) => (j.accessors[1].sparse = {})), /sparse/],
      ['count past the buffer', withJson((j) => (j.accessors[0].count = 100)), /POSITION: runs past the buffer/],
      ['stride', withJson((j) => (j.bufferViews[0].byteStride = 16)), /interleaved/],
      ['no accessor', withJson((j) => (j.meshes[0].primitives[0].indices = 9)), /indices: the accessor is missing/],
      ['negative offset', withJson((j) => (j.bufferViews[1].byteOffset = -4)), /NORMAL: bad sizes/],
    ];
    for (const [what, bytes, why] of bad) expect(() => glbToMesh(bytes), what).toThrow(why);
  });
});

// A triangle written by this version, as base64 (the layout is part of the file format).
const GOLDEN_TRIANGLE =
  'Z2xURgIAAACMAwAAHAMAAEpTT057ImFzc2V0Ijp7InZlcnNpb24iOiIyLjAiLCJnZW5lcmF0b3IiOiJSZXBhY2tzaG90IiwiZXh0cmFzIjp7InVwIjoiWiIsInVuaXQiOiJtbSJ9fSwic2NlbmUiOjAsInNjZW5lcyI6W3sibm9kZXMiOlswXX1dLCJub2RlcyI6W3sibmFtZSI6InRyaSIsIm1lc2giOjAsInJvdGF0aW9uIjpbLTAuNzA3MTA2NzgxMTg2NTQ3NiwwLDAsMC43MDcxMDY3ODExODY1NDc2XSwic2NhbGUiOlswLjAwMSwwLjAwMSwwLjAwMV19XSwibWVzaGVzIjpbeyJuYW1lIjoidHJpIiwicHJpbWl0aXZlcyI6W3siYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6MCwiTk9STUFMIjoxfSwiaW5kaWNlcyI6MiwibW9kZSI6NH1dfV0sImFjY2Vzc29ycyI6W3siYnVmZmVyVmlldyI6MCwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjMsInR5cGUiOiJWRUMzIiwibWluIjpbMCwwLDBdLCJtYXgiOlsxLDEsMF19LHsiYnVmZmVyVmlldyI6MSwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjMsInR5cGUiOiJWRUMzIn0seyJidWZmZXJWaWV3IjoyLCJjb21wb25lbnRUeXBlIjo1MTI1LCJjb3VudCI6MywidHlwZSI6IlNDQUxBUiJ9XSwiYnVmZmVyVmlld3MiOlt7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MCwiYnl0ZUxlbmd0aCI6MzYsInRhcmdldCI6MzQ5NjJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjozNiwiYnl0ZUxlbmd0aCI6MzYsInRhcmdldCI6MzQ5NjJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo3MiwiYnl0ZUxlbmd0aCI6MTIsInRhcmdldCI6MzQ5NjN9XSwiYnVmZmVycyI6W3siYnl0ZUxlbmd0aCI6ODR9XX0gVAAAAEJJTgAAAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAQAAAAIAAAA=';

// --- The round trip ------------------------------------------------------------------------------------------

describe('a project to a file and back', () => {
  it('two parts, three materials and face ranges come back as the same state', async () => {
    const s = await buildProject();
    expect(partsOf(s).map((p) => p.name)).toEqual(['Caps', 'Body']);
    expect(Object.values(s.materials).map((m) => m.name ?? m.preset ?? m.id)).toHaveLength(3);
    const body = nameOf(s, 'Body');
    expect(body.faceMaterials).toEqual([{ start: 4, count: 4, material: expect.any(String) }]);
    expect(nameOf(s, 'Caps').mesh!.vertices).toBe(8);

    const loaded = loadProject(await text(s));
    expect(loaded.warnings).toEqual([]);
    expect(loaded.state).toEqual(clean(s));
    // And the geometry, bit for bit, under the same ids (the registry held exactly that geometry already).
    for (const p of partsOf(s)) expect(sameMesh(getMesh(loaded.state.scene.nodes[p.id].mesh!.id)!, getMesh(p.mesh!.id)!)).toBe(true);
  });

  it('a busy project (studio, cameras, animation, queue, linked copy, flip) too', async () => {
    const s = await buildBusyProject();
    const body = nameOf(s, 'Body');
    const copy = Object.values(s.scene.nodes).find((n) => n.kind === 'PART' && n.id !== body.id && n.name.startsWith('Body'))!;
    expect(copy.mesh!.id).toBe(body.mesh!.id); // linked: one mesh, two parts
    expect(nameOf(s, 'Caps').mesh!.id).toMatch(/~flip$/); // derived id
    expect(s.render.queue).toHaveLength(1);
    expect(Object.keys(s.camera.cameras)).toEqual(['cam1', 'cam2']);
    const loaded = loadProject(await text(s)).state;
    expect(loaded).toEqual(clean(s));
  });

  it('writes the envelope, the state, and each mesh once (a linked copy shares it)', async () => {
    const s = await buildBusyProject();
    const body = JSON.parse(await text(s));
    expect(Object.keys(body)).toEqual(['format', 'schema', 'state', 'meshes']);
    expect([body.format, body.schema]).toEqual([PROJECT_FORMAT, PROJECT_SCHEMA]);
    const used = new Set(partsOf(s).map((p) => p.mesh!.id));
    expect(used.size).toBe(2);
    expect(partsOf(s)).toHaveLength(3);
    expect(body.meshes.map((m: { id: string }) => m.id).sort()).toEqual([...used].sort());
    // Each entry is a GLB and, for the cube body, carries its hard edges.
    const entry = body.meshes.find((m: { id: string }) => m.id === body.state.scene.nodes[nameOf(s, 'Body').id].mesh.id);
    expect(base64ToBytes(entry.glb).slice(0, 4)).toEqual(Uint8Array.of(0x67, 0x6c, 0x54, 0x46));
    expect(unpackUint32(base64ToBytes(entry.sharpEdges)).length / 2).toBe(4);
    // A file on disk is the saved state: the flag is written clean whatever it was.
    const unsaved = { ...s, meta: { ...s.meta, dirty: true } };
    expect(JSON.parse(await text(unsaved)).state.meta.dirty).toBe(false);
    expect(body.state.meta.dirty).toBe(false);
  });

  it('a new session gets fresh ids, so nothing a later import registers can replace a loaded mesh', async () => {
    const s = await buildBusyProject();
    const file = await text(s);
    const before = new Map(partsOf(s).map((p) => [p.id, getMesh(p.mesh!.id)!]));
    newSession();
    const first = loadProject(file);
    const ids = partsOf(first.state).map((p) => p.mesh!.id);
    for (const id of ids) expect(id).toMatch(/^prj\d+:/);
    // Same state but for the ids; the flip stays a derived id of its stem (the app derives names from them).
    const ren = (st: ProjectState) => JSON.parse(JSON.stringify(st).replace(/prj\d+:/g, ''));
    expect(ren(first.state)).toEqual(ren(clean(s)));
    expect(ids.some((id) => id.endsWith('~flip'))).toBe(true);
    for (const p of partsOf(first.state)) expect(sameMesh(getMesh(p.mesh!.id)!, before.get(p.id)!)).toBe(true);
    // Loading it again (another file, or the same one) takes other ids and disturbs nothing.
    const second = loadProject(file);
    expect(partsOf(second.state).map((p) => p.mesh!.id).some((id) => ids.includes(id))).toBe(false);
    expect(partsOf(first.state).every((p) => getMesh(p.mesh!.id) !== undefined)).toBe(true);
  });

  it('meshes that share a base id move together: a copy, a flipped copy and the original keep their relation', async () => {
    let s = await buildProject();
    const body = nameOf(s, 'Body');
    s = apply(s, { type: 'scene/duplicate', ids: [body.id], linked: false });
    const copy = Object.values(s.scene.nodes).find((n) => n.kind === 'PART' && n.id !== body.id && n.name.startsWith('Body'))!;
    s = apply(s, { type: 'scene/flipNormals', ids: [copy.id] });
    const stems = (st: ProjectState) => partsOf(st).map((p) => p.mesh!.id.replace(/^prj\d+:/, ''));
    const ids = stems(s);
    expect(new Set(ids.map((id) => id.split('~')[0])).size).toBeLessThan(ids.length); // two meshes of one base
    const geometry = new Map(partsOf(s).map((p) => [p.id, getMesh(p.mesh!.id)!]));
    const file = await text(s);
    newSession();
    const loaded = loadProject(file).state;
    const prefixes = new Set(partsOf(loaded).filter((p) => p.name.startsWith('Body')).map((p) => /^(prj\d+):/.exec(p.mesh!.id)![1]));
    expect(prefixes.size).toBe(1); // the family of the body took one prefix
    expect(stems(loaded)).toEqual(ids);
    for (const p of partsOf(loaded)) expect(sameMesh(getMesh(p.mesh!.id)!, geometry.get(p.id)!), p.name).toBe(true);
  });

  it('a project after every kind of geometry operation (separate by material, smoothing, flip, pattern, group) round trips with its derived meshes', async () => {
    let s = await buildProject();
    s = apply(s, { type: 'scene/separateByMaterial', ids: [nameOf(s, 'Body').id] });
    const capsId = nameOf(s, 'Caps').id;
    s = apply(s, { type: 'scene/setSmoothAngle', ids: [capsId], deg: 45 });
    s = apply(s, { type: 'scene/flipNormals', ids: [capsId] });
    s = apply(s, { type: 'scene/pattern', ids: [capsId], params: defaultPatternParams(s, [capsId], 'LINEAR'), name: 'Row' });
    const parts = partsOf(s);
    expect(parts.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(parts.map((p) => p.mesh!.id));
    expect([...ids].some((id) => id.includes('~tris'))).toBe(true); // slices
    expect([...ids].some((id) => id.includes('~s45'))).toBe(true); // re-smoothed
    expect([...ids].some((id) => id.endsWith('~flip'))).toBe(true);
    expect(ids.size).toBeLessThan(parts.length); // the pattern shares a mesh
    const geometry = new Map(parts.map((p) => [p.id, getMesh(p.mesh!.id)!]));
    const file = await text(s);
    for (const fresh of [false, true]) {
      if (fresh) newSession();
      const loaded = loadProject(file).state;
      const ren = (st: ProjectState) => JSON.parse(JSON.stringify(st).replace(/prj\d+:/g, ''));
      expect(ren(loaded), fresh ? 'new session' : 'same session').toEqual(ren(clean(s)));
      for (const p of partsOf(loaded)) expect(sameMesh(getMesh(p.mesh!.id)!, geometry.get(p.id)!), `${p.name} (${fresh ? 'new' : 'same'} session)`).toBe(true);
    }
  });

  it('never overwrites a different mesh that has the file’s id (importers number from 1 in every session)', async () => {
    const s = await buildProject();
    const file = await text(s);
    const geometry = new Map(partsOf(s).map((p) => [p.id, getMesh(p.mesh!.id)!]));
    newSession();
    // The new session imported something else first: the same ids, other geometry.
    const strangers = new Map<string, MeshData>();
    for (const p of partsOf(s)) {
      const other = quad({ positions: new Float32Array([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0]) });
      registerMesh(p.mesh!.id, other);
      strangers.set(p.mesh!.id, other);
    }
    const loaded = loadProject(file).state;
    for (const [id, other] of strangers) expect(getMesh(id), id).toBe(other);
    for (const p of partsOf(loaded)) {
      expect(strangers.has(p.mesh!.id)).toBe(false);
      expect(sameMesh(getMesh(p.mesh!.id)!, geometry.get(p.id)!), p.name).toBe(true);
    }
  });

  it('keeps hard edges, UVs, the triangle map, and the difference between "none" and "empty"', async () => {
    const cases: [string, MeshData, Uint32Array | undefined][] = [
      ['plain', quad(), undefined],
      ['everything', quad({ uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), sharpEdges: Uint32Array.of(0, 1, 2, 3) }), Uint32Array.of(1, 0)],
      ['empty hard edges', quad({ sharpEdges: new Uint32Array(0) }), undefined],
    ];
    for (const [name, data, source] of cases) {
      const s = onePart(`test:${name}`, data, source);
      const file = await text(s);
      newSession();
      const loaded = loadProject(file).state;
      const id = loaded.scene.nodes.n1.mesh!.id;
      const back = getMesh(id)!;
      expect(sameMesh(back, data), name).toBe(true);
      expect(back.sharpEdges === undefined, `${name}: sharpEdges ${back.sharpEdges}`).toBe(data.sharpEdges === undefined);
      expect(back.uvs === undefined, `${name}: uvs`).toBe(data.uvs === undefined);
      expect(triangleSource(id) ? [...triangleSource(id)!] : null, `${name}: triangle map`).toEqual(source ? [...source] : null);
    }
  });

  it('opening the file just saved reuses the meshes: nothing is registered twice', async () => {
    const s = await buildBusyProject();
    const file = await text(s);
    const ids = meshIds();
    const loaded = loadProject(file).state;
    expect(meshIds().sort()).toEqual(ids.sort());
    expect(loaded).toEqual(clean(s));
  });

  it('the example round trips (UVs, five parts, groups)', async () => {
    const s = exampleState();
    const loaded = loadProject(await text(s)).state;
    expect(loaded).toEqual(clean(s));
    const cap = getMesh(loaded.scene.nodes[keyIds(loaded).cap].mesh!.id)!;
    expect(cap.uvs).toBeDefined();
    expect(cap.uvs!.length).toBe((cap.positions.length / 3) * 2);
  });

  it('a model of hundreds of thousands of triangles is written and read in one piece', { timeout: 30_000 }, async () => {
    const n = 450; // 451 x 451 vertices, 405 000 triangles
    const stride = n + 1;
    const positions = new Float32Array(stride * stride * 3);
    const normals = new Float32Array(positions.length);
    for (let y = 0; y < stride; y++) {
      for (let x = 0; x < stride; x++) {
        const o = 3 * (y * stride + x);
        positions.set([x * 0.37, y * 0.37, Math.sin(x * 0.11) * Math.cos(y * 0.07) * 3.3], o);
        normals.set([0.1, -0.2, 0.97], o);
      }
    }
    const indices = new Uint32Array(n * n * 6);
    let o = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const a = y * stride + x;
        indices.set([a, a + 1, a + stride, a + 1, a + stride + 1, a + stride], o);
        o += 6;
      }
    }
    const data: MeshData = { positions, normals, indices, uvs: new Float32Array(stride * stride * 2).map((_, i) => i / 7) };
    const s = onePart('test:big', data);
    expect(s.scene.nodes.n1.mesh!.triangles).toBe(405_000);
    const file = await text(s);
    newSession();
    const loaded = loadProject(file).state;
    expect(sameMesh(getMesh(loaded.scene.nodes.n1.mesh!.id)!, data)).toBe(true);
  });

  it('nothing plays or runs after a load, the Doctor is the current one, language and theme are kept as saved', async () => {
    const s = apply(await buildProject(), { type: 'anim/preset', key: 'HERO' }, { type: 'anim/play', playing: true });
    expect(s.animation.playing).toBe(true);
    const doctored = withState(s, (raw) => (raw.doctor = { results: [{ key: 'not-a-check', status: 'FAIL' }], stamp: 41 }));
    const loaded = loadProject(doctored).state;
    expect(loaded.animation.playing).toBe(false);
    expect(loaded.doctor.stamp).toBe(41);
    expect(loaded.doctor.results.map((r) => r.key)).not.toContain('not-a-check');
    expect(loaded.doctor.results.length).toBeGreaterThan(5);
  });

  it('a file with a byte order mark (some editors add one) opens', async () => {
    const s = await buildProject();
    expect(loadProject(`\uFEFF${await text(s)}`).state).toEqual(clean(s));
  });

  it('an old project loads with the defaults of the fields it predates, and a selection that points at nothing is dropped', async () => {
    const s = await buildProject();
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.studio.floor;
    delete raw.environment;
    raw.selection = { level: 'PART', ids: ['n2', 'ghost'] };
    const loaded = loadProject(envelope(raw, { meshes: JSON.parse(await text(s)).meshes })).state;
    expect(loaded.studio.floor).toBe(true);
    expect(loaded.environment).toEqual(createInitialState().environment);
    expect(loaded.selection.ids).toEqual(['n2']);
  });
});

// --- The fixed files -----------------------------------------------------------------------------------------

describe('fixtures: files written by earlier versions keep loading', () => {
  it('there is a migration step for every schema below the current one', () => {
    expect(Object.keys(STEPS).map(Number).sort()).toEqual(Array.from({ length: PROJECT_SCHEMA - 1 }, (_, i) => i + 1));
  });

  it('project-v1.json, as U1 wrote it (schema 1: no meshes block, the old render block)', () => {
    const raw = JSON.parse(v1Text);
    expect([raw.format, raw.schema, 'meshes' in raw]).toEqual([PROJECT_FORMAT, 1, false]);
    expect(raw.state.render.queue[0]).not.toHaveProperty('settings'); // U1's flat job
    expect(raw.state.meta.dirty).toBe(true); // U1 saved the flag as it was

    const { state, warnings } = loadProject(v1Text);
    // The example's geometry is code: it came back, and nothing is reported missing.
    expect(warnings).toEqual([]);
    for (const p of partsOf(state)) expect(getMesh(p.mesh!.id), p.name).toBeDefined();
    expect(state.meta).toMatchObject({ name: 'Fragrance bottle', dirty: false, lang: 'en', theme: 'dark' });
    expect(partsOf(state).map((p) => p.name)).toEqual(['base', 'body', 'label', 'collar', 'cap']);
    expect(Object.values(state.scene.nodes)).toHaveLength(7);
    const cap = Object.values(state.scene.nodes).find((n) => n.key === 'cap')!;
    expect(state.materials[cap.material!].preset).toBe('COPPER');
    const body = Object.values(state.scene.nodes).find((n) => n.key === 'body')!;
    expect(body.faceMaterials).toEqual([{ start: 4, count: 3, material: expect.any(String) }, { start: 10, count: 1, material: expect.any(String) }]);
    expect(state.studio).toMatchObject({ preset: 'JEWELLERY', lightSetup: 'REMBRANDT', built: true });
    expect(Object.keys(state.camera.cameras)).toEqual(['cam1', 'cam2']);
    expect(state.camera.cameras.cam2).toMatchObject({ focalMm: 135, azimuth: 20, elevation: 10 });
    expect([state.environment.strength, state.environment.rotationDeg, state.image.exposureEv, state.image.vignette]).toEqual([0.8, 40, 0.5, 0.2]);
    expect(state.animation.shots.length).toBeGreaterThan(0);
    // The render block went through U5's migration.
    expect(state.render).toMatchObject({ width: 1080, height: 1350, format: 'JPEG', running: null });
    expect(state.render.queue).toHaveLength(1);
    expect(state.render.queue[0].settings).toMatchObject({ name: 'Hero shot', width: 1080, camera: { kind: 'ONE', id: 'cam2' } });
    expect(state.doctor.results.length).toBeGreaterThan(5);
    // And the same without the registry: the example is regenerated, not found by luck.
    newSession();
    expect(loadProject(v1Text).warnings).toEqual([]);
    expect(getMesh('example:body')).toBeDefined();
  });

  it('project-v1.json: a part whose geometry no file can give stays, and the load says so', () => {
    const body = JSON.parse(v1Text);
    body.state.scene.nodes.n3.mesh.id = 'obj:1:gone';
    const loaded = loadProject(JSON.stringify(body));
    expect(loaded.warnings).toEqual([{ code: 'MISSING_MESHES', count: 1 }]);
    expect(loaded.state.scene.nodes.n3.mesh!.id).toBe('obj:1:gone');
    expect(getMesh('obj:1:gone')).toBeUndefined();
  });

  it('project-v2.json, as this phase writes it (schema 2 with the meshes block)', () => {
    const body = JSON.parse(v2Text);
    expect([body.format, body.schema, Object.keys(body)]).toEqual([PROJECT_FORMAT, 2, ['format', 'schema', 'state', 'meshes']]);
    expect(body.meshes).toHaveLength(2);
    newSession();
    const { state, warnings } = loadProject(v2Text);
    expect(warnings).toEqual([]);
    expect(state.meta).toMatchObject({ name: 'Box project', dirty: false });
    expect(partsOf(state).map((p) => p.name)).toEqual(['Caps', 'Body', 'Body 2']);
    expect(Object.keys(state.materials)).toHaveLength(3);
    const [caps, bodyPart, copy] = partsOf(state);
    expect(caps.mesh).toMatchObject({ vertices: 8, triangles: 4 });
    expect(bodyPart.mesh).toMatchObject({ vertices: 16, triangles: 8 });
    expect(copy.mesh!.id).toBe(bodyPart.mesh!.id);
    expect(bodyPart.faceMaterials).toEqual([{ start: 4, count: 4, material: expect.any(String) }]);
    expect(state.materials[caps.material!].preset).toBe('GOLD');
    // Geometry: the caps carry the UVs of the OBJ, the body its four hard edges.
    const uvs = getMesh(caps.mesh!.id)!.uvs!;
    expect(uvs.length).toBe(16);
    expect(uvs.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(getMesh(bodyPart.mesh!.id)!.sharpEdges!.length).toBe(8);
    expect(state.studio).toMatchObject({ preset: 'JEWELLERY', lightSetup: 'REMBRANDT' });
    expect(state.render.queue).toHaveLength(1);
  });

  it('a schema-2 file written before the meshes block loads without geometry, and says how many parts', () => {
    const body = JSON.parse(v2Text);
    delete body.meshes;
    newSession();
    const loaded = loadProject(JSON.stringify(body));
    expect(loaded.warnings).toEqual([{ code: 'MISSING_MESHES', count: 3 }]);
    expect(partsOf(loaded.state)).toHaveLength(3);
    // The state alone (no geometry) is what `parseProject` and `migrateProject` give.
    const text = JSON.stringify(body);
    expect(parseProject(text)).toEqual(migrateProject(JSON.parse(text)));
    expect(parseProject(text)).toEqual(loaded.state);
  });

  it('writes the fixtures when asked (REPACK_WRITE_FIXTURES=1 npx vitest run tests/project.test.ts)', async () => {
    const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env;
    if (!env?.REPACK_WRITE_FIXTURES) return;
    newSession();
    writeFileSync('tests/fixtures/project-v2.json', await text(await buildBusyProject()));
  });
});

// --- Refusals ------------------------------------------------------------------------------------------------

describe('what is not opened, and what it leaves alone', () => {
  const refused = async (src: string, code: string, message?: RegExp): Promise<ProjectError> => {
    const before = meshIds().sort();
    let error: unknown;
    try {
      loadProject(src);
    } catch (err) {
      error = err;
    }
    expect(error, `loaded: ${src.slice(0, 80)}`).toBeInstanceOf(ProjectError);
    const e = error as ProjectError;
    expect(e.code, e.message).toBe(code);
    if (message) expect(e.message).toMatch(message);
    // Nothing was registered or forgotten on the way.
    expect(meshIds().sort(), 'the registry changed').toEqual(before);
    // The reader the interface uses says the same without throwing.
    const result = await readProjectFile(new Blob([src]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fault.code).toBe(code);
    expect(meshIds().sort()).toEqual(before);
    return e;
  };

  it('a file from a newer version', async () => {
    const e = await refused(envelope({}, {}, PROJECT_SCHEMA + 1), 'NEWER_VERSION', /newer/);
    expect(e.schema).toBe(PROJECT_SCHEMA + 1);
    await refused(envelope({}, {}, 99), 'NEWER_VERSION');
    expect(() => migrateProject({ format: PROJECT_FORMAT, schema: 99, state: {} })).toThrow(/newer/);
  });

  it('something that is not a project', async () => {
    for (const src of ['', 'null', '42', '[]', '"repackshot"', '{}', '{"format":"other","schema":1,"state":{}}', JSON.stringify({ schema: 1, state: {} }), 'v 0 0 0\nf 1 1 1\n', 'solid tetra\nendsolid', '<html></html>', '{"meshes":[]}']) {
      await refused(src, 'NOT_A_PROJECT');
    }
    expect(() => parseProject('{')).toThrow();
  });

  it('a project that was cut short, or whose JSON is damaged', async () => {
    const cut = v2Text.slice(0, Math.floor(v2Text.length * 0.6));
    await refused(cut, 'DAMAGED', /cut short|damaged/);
    await refused(v2Text.slice(0, 200), 'DAMAGED');
    await refused(v2Text.replace('"state"', '"state" 1'), 'DAMAGED');
  });

  it('a state that would crash the interface', async () => {
    const s = await buildProject();
    const caps = nameOf(s, 'Caps').id;
    const body = nameOf(s, 'Body').id;
    const model = s.scene.roots[0];
    const bad: [string, (raw: Record<string, any>) => void, RegExp][] = [
      ['no state', () => undefined, /no state/],
      ['a block of the wrong kind', (raw) => (raw.studio = 'x'), /studio has the wrong kind of value/],
      ['a field of the wrong kind', (raw) => (raw.environment.strength = 'loud'), /environment.strength has the wrong kind of value/],
      ['nodes', (raw) => (raw.scene.nodes = []), /scene.nodes has the wrong kind of value/],
      ['a node under the wrong id', (raw) => (raw.scene.nodes[caps].id = 'zzz'), /is not a node/],
      ['a node without a kind', (raw) => delete raw.scene.nodes[caps].kind, /name, kind or visibility/],
      ['a transform', (raw) => (raw.scene.nodes[caps].transform.position = [1, 2]), /transform is damaged/],
      ['a child that does not exist', (raw) => raw.scene.nodes[model].children.push('ghost'), /child that does not exist/],
      ['a parent that does not exist', (raw) => (raw.scene.nodes[caps].parent = 'ghost'), /parent/],
      ['a child that disagrees about its parent', (raw) => (raw.scene.nodes[caps].parent = body), /disagree|not a child/],
      ['a child that its parent lists but that has none', (raw) => (raw.scene.nodes[caps].parent = null), /disagree/],
      ['a root that is not on top', (raw) => raw.scene.roots.push(caps), /not a top-level node/],
      ['a loop', (raw) => { raw.scene.nodes[model].parent = caps; raw.scene.nodes[caps].children.push(model); raw.scene.roots = []; }, /loops|top-level/],
      ['a mesh ref', (raw) => delete raw.scene.nodes[caps].mesh.bounds, /mesh is damaged/],
      ['a material that does not exist', (raw) => (raw.scene.nodes[caps].material = 'm99'), /material that does not exist/],
      ['a face range with no material', (raw) => (raw.scene.nodes[body].faceMaterials[0].material = 'm99'), /faceMaterials is damaged/],
      ['CAD faces that are not runs of triangles', (raw) => (raw.scene.nodes[caps].faceRanges = [{ start: 'x', count: 2 }]), /faceRanges is damaged/],
      ['CAD faces that are not a list', (raw) => (raw.scene.nodes[caps].faceRanges = 3), /faceRanges is not a list/],
      ['a CAD face with no triangles', (raw) => (raw.scene.nodes[caps].faceRanges = [{ start: 0, count: 0 }]), /faceRanges is damaged/],
      ['a material under the wrong id', (raw) => (raw.materials.m2.id = 'm9'), /is not a material/],
      ['no active camera', (raw) => (raw.camera.active = 'cam9'), /camera.active/],
      ['lights', (raw) => (raw.studio.lights = [1]), /lights is damaged/],
    ];
    for (const [what, edit, why] of bad) {
      const raw = JSON.parse(JSON.stringify(s));
      edit(raw);
      const meshes = JSON.parse(await text(s)).meshes;
      await refused(envelope(what === 'no state' ? undefined : raw, { meshes }), 'DAMAGED', why).catch((err: Error) => {
        throw new Error(`${what}: ${err.message}`);
      });
    }
    // A schema that is not a number.
    await refused(JSON.stringify({ format: PROJECT_FORMAT, schema: 'two', state: {} }), 'DAMAGED', /schema/);
    await refused(JSON.stringify({ format: PROJECT_FORMAT, schema: 0, state: {} }), 'DAMAGED', /schema/);
  });

  it('meshes that are damaged or do not fit the state', async () => {
    const s = await buildProject();
    const { meshes } = JSON.parse(await text(s)) as { meshes: { id: string; glb: string; sharpEdges?: string }[] };
    const edits: [string, (m: typeof meshes) => unknown, RegExp][] = [
      ['not a list', () => 'x', /meshes is not a list/],
      ['not a mesh', () => [1], /meshes\[0\] is not a mesh/],
      ['no id', (m) => [{ ...m[0], id: '' }], /meshes\[0\] is not a mesh/],
      ['not base64', (m) => [{ ...m[0], glb: m[0].glb.slice(0, 40) + '!!!!' + m[0].glb.slice(44) }], /not base64/],
      ['not a GLB', (m) => [{ ...m[0], glb: bytesToBase64(new TextEncoder().encode('hello, this is not a GLB at all')) }], /bad magic/],
      ['cut GLB', (m) => [{ ...m[0], glb: bytesToBase64(base64ToBytes(m[0].glb).slice(0, 200)) }], /cut short/],
      ['twice', (m) => [m[0], m[0]], /in the file twice/],
      ['hard edges that are not a list of pairs', (m) => [{ ...m[1], sharpEdges: bytesToBase64(Uint8Array.of(1, 0, 0, 0)) }, m[0]], /sharpEdges does not fit/],
      ['hard edges past the end', (m) => [{ ...m[1], sharpEdges: bytesToBase64(packUint32(Uint32Array.of(0, 999))) }, m[0]], /sharpEdges does not fit/],
      ['hard edges that are not base64', (m) => [{ ...m[1], sharpEdges: 7 }, m[0]], /sharpEdges is damaged/],
      ['triangle map of the wrong size', (m) => [{ ...m[1], triangleSource: bytesToBase64(packUint32(Uint32Array.of(0, 1))) }, m[0]], /triangleSource does not fit/],
      [
        'positions that are not numbers',
        (m) => {
          const glb = base64ToBytes(m[0].glb).slice();
          // The positions are the first stream of the binary chunk; 0x7fc00000 is a NaN.
          new DataView(glb.buffer).setUint32(20 + new DataView(glb.buffer).getUint32(12, true) + 8, 0x7fc00000, true);
          return [{ ...m[0], glb: bytesToBase64(glb) }, m[1]];
        },
        /not a number/,
      ],
    ];
    for (const [what, make, why] of edits) {
      const body = JSON.parse(await text(s));
      body.meshes = make(meshes);
      await refused(JSON.stringify(body), 'DAMAGED', why).catch((err: Error) => {
        throw new Error(`${what}: ${err.message}`);
      });
    }
    // The state says 8 vertices; the GLB has 4: the pair does not belong together.
    const other = onePart('test:other', quad());
    const swapped = JSON.parse(await text(s));
    const quadEntry = JSON.parse(await text(other)).meshes[0];
    swapped.meshes[0] = { ...quadEntry, id: swapped.meshes[0].id };
    await refused(JSON.stringify(swapped), 'DAMAGED', /does not have the vertices and triangles/);
  });

  it('a state the program cannot evaluate after all takes its meshes back out of the registry', async () => {
    const s = await buildProject();
    const file = await text(s);
    newSession();
    // (A new project runs the Doctor too: only the evaluation of this scene fails.)
    const original = doctor.runDoctor;
    const spy = vi.spyOn(doctor, 'runDoctor').mockImplementation((state) => {
      if (Object.keys(state.scene.nodes).length > 0) throw new Error('the Doctor choked');
      return original(state);
    });
    try {
      let error: unknown;
      try {
        loadProject(file);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ProjectError);
      expect((error as ProjectError).code).toBe('DAMAGED');
      expect((error as ProjectError).message).toMatch(/could not be evaluated \(the Doctor choked\)/);
      // The meshes this load had registered are gone again (and it did register some: see the next load).
      expect(meshIds()).toEqual([]);
      spy.mockRestore();
      expect(loadProject(file).state.scene.roots).toHaveLength(1);
      expect(meshIds().length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('a file or a mesh too big for the browser is its own message', async () => {
    const big = { text: async () => Promise.reject(new RangeError('Invalid string length')) } as unknown as Blob;
    expect(await readProjectFile(big)).toMatchObject({ ok: false, fault: { code: 'TOO_LARGE' } });
    const unreadable = { text: async () => Promise.reject(new Error('NotReadableError')) } as unknown as Blob;
    expect(await readProjectFile(unreadable)).toMatchObject({ ok: false, fault: { code: 'DAMAGED' } });
    // The memory giving out while a file is evaluated.
    const s = await buildProject();
    const file = await text(s);
    newSession();
    const original = doctor.runDoctor;
    const spy = vi.spyOn(doctor, 'runDoctor').mockImplementation((state) => {
      if (Object.keys(state.scene.nodes).length > 0) throw new RangeError('Maximum call stack size exceeded');
      return original(state);
    });
    try {
      expect(await readProjectFile(new Blob([file]))).toMatchObject({ ok: false, fault: { code: 'TOO_LARGE' } });
      expect(meshIds()).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    // A mesh whose base64 is longer than a string can be: saving says so instead of failing in the middle.
    const encode = vi.spyOn(base64, 'bytesToBase64').mockImplementation(() => {
      throw new RangeError('Invalid string length');
    });
    try {
      const one = onePart('test:huge', quad());
      expect(() => serializeProject(one)).toThrow(ProjectError);
      expect(() => serializeProject(one)).toThrow(/too large to save/);
    } finally {
      encode.mockRestore();
    }
  });

  it('a triangle that uses a vertex that does not exist', async () => {
    const s = onePart('test:bad-index', quad());
    const body = JSON.parse(await text(s));
    const glb = base64ToBytes(body.meshes[0].glb).slice();
    // The last index is the last four bytes of the binary chunk.
    new DataView(glb.buffer).setUint32(glb.length - 4, 9, true);
    body.meshes[0].glb = bytesToBase64(glb);
    await refused(JSON.stringify(body), 'DAMAGED', /vertex that does not exist/);
  });
});

// --- A project made from STEP (phase I2 meets U2) ------------------------------------------------------------
//
// What the CAD readers add to a project: parts with `faceRanges` (one run of triangles per CAD face), materials
// named by the colour of the file, a group hierarchy, and meshes with `sharpEdges` that mark every edge between
// two CAD faces. The real occt-import-js reads the fixtures in this thread (tests/occt-node.ts), and the project
// is made the way the interface makes it: the sheet, then Import.

describe('a STEP-imported project', () => {
  beforeAll(async () => {
    await loadOcct();
    setCadWorkerFactory(() => inProcessWorker());
  }, 60_000);
  afterEach(() => releaseCadWorker());

  /** A file through the import sheet and Import, as a person does it; `options` are the sheet's values. */
  async function importCad(name: string, options: Parameters<typeof setImportOptions>[1] = {}): Promise<ProjectState> {
    const services = { viewport: null, importFile: (file: File, o?: Parameters<typeof importFile>[1]) => importFile(file, o) } as unknown as AppServices;
    const ctx = { store: createStore(createInitialState()), ui: createUiStore(), services };
    await importFiles(ctx, [new File([fixture(name) as BlobPart], name)]);
    for (let i = 0; i < 400 && ctx.ui.get().importSheet?.cad?.stage !== 'ready'; i++) await new Promise((r) => setTimeout(r, 5));
    expect(ctx.ui.get().importSheet?.cad?.stage).toBe('ready');
    setImportOptions(ctx, options);
    confirmImport(ctx);
    expect(ctx.ui.get().importSheet).toBeNull();
    return ctx.store.get();
  }

  /** Two CAD faces of different colours in one part, as a STEP with a coloured face reads: a face material. */
  function colouredPair(): ProjectState {
    const mesh: OcctMesh = {
      name: 'pair',
      color: [0.5, 0.5, 0.5],
      brep_faces: [
        { first: 0, last: 1, color: null },
        { first: 2, last: 3, color: [1, 0, 0] },
      ],
      attributes: {
        position: { array: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, -1, 0, 0, -1] },
        normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1, 0] },
      },
      index: { array: [0, 1, 2, 0, 2, 3, 0, 4, 1, 0, 5, 4] },
    };
    const read = occtToPayload({ success: true, root: { name: '', meshes: [], children: [{ name: 'Pair', meshes: [0], children: [] }] }, meshes: [mesh] }, { fileName: 'pair.step', format: 'STEP', units: 'mm' });
    const applied = applyImportOptions(read, defaultImportOptions(read.detected, false));
    return apply(createInitialState(), { type: 'scene/addModel', payload: { nodes: applied.nodes, roots: applied.roots, materials: applied.materials }, replace: true });
  }

  const byName = (s: ProjectState, name: string): SceneNode => nameOf(s, name);
  const materialNames = (s: ProjectState): string[] => Object.values(s.materials).map((m) => m.name as string).sort();
  /** The ids a new session gives the meshes (`prjN:`) are the only difference from the state that was saved. */
  const withoutPrefix = (st: ProjectState) => JSON.parse(JSON.stringify(st).replace(/prj\d+:/g, ''));

  /** Saves, forgets the geometry (a new session) or not, opens: the project and what the reader said. */
  async function roundTrip(s: ProjectState, freshSession: boolean): Promise<ProjectState> {
    const file = await text(s);
    if (freshSession) newSession();
    const result = await readProjectFile(new Blob([file]));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.warnings).toEqual([]);
    return result.state;
  }

  /** The geometry of each part by part id, taken before a new session forgets it. */
  const geometryOf = (s: ProjectState): Map<string, MeshData> => new Map(partsOf(s).map((p) => [p.id, getMesh(p.mesh!.id)!]));

  /** Same geometry, bit for bit, hard edges included, part by part. */
  function expectSameGeometry(was: Map<string, MeshData>, loaded: ProjectState): void {
    expect(partsOf(loaded).map((p) => p.id)).toEqual([...was.keys()]);
    for (const p of partsOf(loaded)) {
      const before = was.get(p.id)!;
      const now = getMesh(p.mesh!.id)!;
      expect(sameMesh(now, before), `${p.name}: positions, normals, indices, uvs and sharpEdges`).toBe(true);
      expect(now.sharpEdges, `${p.name}: sharpEdges`).toEqual(before.sharpEdges);
    }
  }

  it('box.step: one part with its six CAD faces, a colour named by its hex, and hard edges, come back exactly', async () => {
    const s = await importCad('box.step');
    const box = byName(s, 'Box');
    expect(box.faceRanges).toHaveLength(6);
    expect(box.faceRanges!.every((f) => f.count === 2)).toBe(true);
    expect(box.mesh).toMatchObject({ vertices: 24, triangles: 12 });
    expect(getMesh(box.mesh!.id)!.sharpEdges!.length).toBe(24);
    expect(materialNames(s)).toEqual(['#CC3319']);
    const geometry = geometryOf(s);
    for (const fresh of [false, true]) {
      const loaded = await roundTrip(s, fresh);
      const label = fresh ? 'new session' : 'same session';
      if (!fresh) expect(loaded, label).toEqual(clean(s));
      else expect(withoutPrefix(loaded), label).toEqual(withoutPrefix(clean(s)));
      expect(byName(loaded, 'Box').faceRanges, label).toEqual(box.faceRanges);
      expect(materialNames(loaded), label).toEqual(['#CC3319']);
      expectSameGeometry(geometry, loaded);
    }
  });

  it('assembly.step: the group, two parts with 6 and 3 faces, two colours and their hard edges come back exactly', async () => {
    const s = await importCad('assembly.step');
    const model = s.scene.nodes[s.scene.roots[0]];
    const bottle = byName(s, 'Bottle');
    expect([model.name, model.kind, model.source]).toEqual(['assembly', 'MODEL', { kind: 'FILE', name: 'assembly.step', format: 'STEP' }]);
    expect([bottle.kind, bottle.parent, bottle.children.map((c) => s.scene.nodes[c].name)]).toEqual(['GROUP', model.id, ['Body', 'Cap']]);
    expect([byName(s, 'Body').faceRanges!.length, byName(s, 'Cap').faceRanges!.length]).toEqual([6, 3]);
    expect(materialNames(s)).toEqual(['#194CCC', '#E51919']);
    expect([byName(s, 'Body'), byName(s, 'Cap')].map((p) => getMesh(p.mesh!.id)!.sharpEdges!.length)).toEqual([24, 272]);
    const geometry = geometryOf(s);
    for (const fresh of [false, true]) {
      const loaded = await roundTrip(s, fresh);
      const label = fresh ? 'new session' : 'same session';
      if (!fresh) expect(loaded, label).toEqual(clean(s));
      else expect(withoutPrefix(loaded), label).toEqual(withoutPrefix(clean(s)));
      const g = byName(loaded, 'Bottle');
      expect([g.kind, g.children.map((c) => loaded.scene.nodes[c].name)], label).toEqual(['GROUP', ['Body', 'Cap']]);
      expect([byName(loaded, 'Body').faceRanges, byName(loaded, 'Cap').faceRanges], label).toEqual([byName(s, 'Body').faceRanges, byName(s, 'Cap').faceRanges]);
      expect(materialNames(loaded), label).toEqual(['#194CCC', '#E51919']);
      expectSameGeometry(geometry, loaded);
    }
  });

  it('a CAD part with a coloured face (faceMaterials next to faceRanges) comes back exactly', async () => {
    const s = colouredPair();
    const pair = byName(s, 'Pair');
    expect(pair.faceRanges).toEqual([
      { start: 0, count: 2 },
      { start: 2, count: 2 },
    ]);
    expect(pair.faceMaterials).toEqual([{ start: 2, count: 2, material: expect.any(String) }]);
    expect(materialNames(s)).toEqual(['#BCBCBC', '#FF0000']);
    const geometry = geometryOf(s);
    for (const fresh of [false, true]) {
      const loaded = await roundTrip(s, fresh);
      const label = fresh ? 'new session' : 'same session';
      if (!fresh) expect(loaded, label).toEqual(clean(s));
      else expect(withoutPrefix(loaded), label).toEqual(withoutPrefix(clean(s)));
      expect(byName(loaded, 'Pair').faceMaterials, label).toEqual(pair.faceMaterials);
      expect(byName(loaded, 'Pair').faceRanges, label).toEqual(pair.faceRanges);
      expect(materialNames(loaded), label).toEqual(['#BCBCBC', '#FF0000']);
      expectSameGeometry(geometry, loaded);
    }
  });

  it('a model imported with "separate by CAD face" (a part per face, sliced meshes) round trips too', async () => {
    const s = await importCad('assembly.step', { separate: 'face' });
    expect(partsOf(s)).toHaveLength(9);
    for (const p of partsOf(s)) expect(p.faceRanges).toHaveLength(1);
    const geometry = geometryOf(s);
    for (const fresh of [false, true]) {
      const loaded = await roundTrip(s, fresh);
      if (!fresh) expect(loaded).toEqual(clean(s));
      else expect(withoutPrefix(loaded)).toEqual(withoutPrefix(clean(s)));
      expectSameGeometry(geometry, loaded);
    }
  });

  it('Separate by CAD face still works on the reopened project, and gives what it gives on the project that was saved', async () => {
    for (const name of ['box.step', 'assembly.step']) {
      const s = await importCad(name);
      const detected = (await readCad(name)).detected;
      /** The sheet's "separate by CAD face" over the parts of a project (their meshes come from the registry). */
      const separated = (st: ProjectState) =>
        applyImportOptions(
          { nodes: structuredClone(st.scene.nodes), roots: [...st.scene.roots], materials: structuredClone(st.materials), detected },
          { ...defaultImportOptions(detected, false), separate: 'face', center: false, restOnFloor: false },
        );
      const was = separated(s);
      const wasMeshes = Object.values(was.nodes).filter((n) => n.kind === 'PART').map((p) => getMesh(p.mesh!.id)!);
      for (const fresh of [false, true]) {
        const loaded = await roundTrip(s, fresh);
        const now = separated(loaded);
        const label = `${name} (${fresh ? 'new' : 'same'} session)`;
        const pieces = (a: typeof was) => Object.values(a.nodes).filter((n) => n.kind === 'PART');
        const [pw, pn] = [pieces(was), pieces(now)];
        expect(pw.length, label).toBe(name === 'box.step' ? 6 : 9);
        expect(pn.map((p) => [p.name, p.mesh!.triangles, p.mesh!.vertices, p.faceRanges]), label).toEqual(pw.map((p) => [p.name, p.mesh!.triangles, p.mesh!.vertices, p.faceRanges]));
        expect(pn.map((p) => now.materials[p.material!].name), label).toEqual(pw.map((p) => was.materials[p.material!].name));
        for (const [i, p] of pw.entries()) {
          expect(p.faceRanges, `${label}: ${p.name} is one face`).toHaveLength(1);
          expect(sameMesh(getMesh(pn[i].mesh!.id)!, wasMeshes[i]), `${label}: ${p.name} geometry`).toBe(true);
          // Each piece keeps the hard edges of its own face, so the face still has its outline.
          expect(getMesh(pn[i].mesh!.id)!.sharpEdges, `${label}: ${p.name}`).toEqual(wasMeshes[i].sharpEdges);
        }
      }
    }
  });
});

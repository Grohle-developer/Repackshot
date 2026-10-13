// A reader of RSB v1 for the tests only (the interface never reads RSB): splits a file into its
// sections and decodes each one back into the shapes of src/io/rsb.ts, so a round trip can be
// compared field by field. Layout: engine/crates/rt-core/src/scene/rsb.rs.

import type { RsbCamera, RsbEnvironment, RsbFloor, RsbInstance, RsbLight, RsbMaterial, RsbMesh, RsbRender, RsbScene, RsbVec } from '../src/io/rsb';

export interface Section {
  tag: string;
  payload: DataView;
}

export function sections(bytes: Uint8Array): Section[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'RSB1') throw new Error('not an RSB file');
  let pos = 8 + view.getUint32(4, true);
  const out: Section[] = [];
  while (pos < bytes.length) {
    const tag = String.fromCharCode(...bytes.subarray(pos, pos + 4));
    const len = view.getUint32(pos + 4, true);
    if (pos + 8 + len > bytes.length) throw new Error(`section ${tag} is truncated`);
    out.push({ tag, payload: new DataView(bytes.buffer, bytes.byteOffset + pos + 8, len) });
    pos += 8 + len;
  }
  return out;
}

class Cursor {
  private pos = 0;
  constructor(private readonly v: DataView) {}
  u32(): number {
    const x = this.v.getUint32(this.pos, true);
    this.pos += 4;
    return x;
  }
  f32(): number {
    const x = this.v.getFloat32(this.pos, true);
    this.pos += 4;
    return x;
  }
  vec(): RsbVec {
    return [this.f32(), this.f32(), this.f32()];
  }
  get remaining(): number {
    return this.v.byteLength - this.pos;
  }
}

export function readCamera(p: DataView): RsbCamera {
  const c = new Cursor(p);
  return { position: c.vec(), target: c.vec(), up: c.vec(), focalMm: c.f32(), sensorMm: c.f32(), fstop: c.f32(), focusDist: c.f32(), ortho: c.u32() !== 0, orthoWidth: c.f32() };
}

export function readMaterial(p: DataView): RsbMaterial {
  const c = new Cursor(p);
  const m = { kind: c.u32(), baseColor: c.vec(), metallic: c.f32(), roughness: c.f32(), ior: c.f32(), transmission: c.f32(), coat: c.f32(), coatRoughness: c.f32(), emission: c.vec(), emissionPower: c.f32(), flags: 0 };
  m.flags = c.remaining >= 4 ? c.u32() : 0;
  return m;
}

export function readMesh(p: DataView): RsbMesh {
  const c = new Cursor(p);
  const n = c.u32();
  const m = c.u32();
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) positions[i] = c.f32();
  for (let i = 0; i < n * 3; i++) normals[i] = c.f32();
  const indices = new Uint32Array(m);
  for (let i = 0; i < m; i++) indices[i] = c.u32();
  return { positions, normals, indices, materialId: c.u32() };
}

export function readInstance(p: DataView): RsbInstance {
  const c = new Cursor(p);
  const mesh = c.u32();
  const transform: number[] = [];
  for (let i = 0; i < 12; i++) transform.push(c.f32());
  return { mesh, transform, materialId: c.u32(), flags: c.u32() };
}

export function readLight(p: DataView): RsbLight {
  const c = new Cursor(p);
  return { kind: c.u32(), position: c.vec(), direction: c.vec(), up: c.vec(), sizeX: c.f32(), sizeY: c.f32(), color: c.vec(), power: c.f32(), spreadDeg: c.f32(), angleDeg: c.f32(), flags: c.u32() };
}

export function readEnvironment(p: DataView): RsbEnvironment {
  const c = new Cursor(p);
  return { kind: c.u32(), floor: c.f32(), horizon: c.f32(), zenith: c.f32(), strength: c.f32(), rotationDeg: c.f32(), backgroundColor: c.vec(), backgroundMode: c.u32() };
}

export function readFloor(p: DataView): RsbFloor {
  const c = new Cursor(p);
  return { mode: c.u32(), z: c.f32(), color: c.vec() };
}

export function readRender(p: DataView): RsbRender {
  const c = new Cursor(p);
  const r = { width: c.u32(), height: c.u32(), maxSamples: c.u32(), seed: c.u32(), maxSeconds: c.f32(), exposureEv: c.f32(), tonemap: c.u32(), maxDepth: 8, clampIndirect: 0 };
  if (c.remaining >= 4) r.maxDepth = c.u32();
  if (c.remaining >= 4) r.clampIndirect = c.f32();
  return r;
}

/** The whole file (singletons that are missing are left undefined). */
export function readRsb(bytes: Uint8Array): Partial<RsbScene> & { materials: RsbMaterial[]; meshes: RsbMesh[]; lights: RsbLight[]; instances: RsbInstance[] | null; tags: string[] } {
  const out: Partial<RsbScene> & { materials: RsbMaterial[]; meshes: RsbMesh[]; lights: RsbLight[]; instances: RsbInstance[] | null; tags: string[] } = {
    materials: [],
    meshes: [],
    lights: [],
    instances: null,
    tags: [],
  };
  for (const s of sections(bytes)) {
    out.tags.push(s.tag);
    switch (s.tag) {
      case 'CAMR':
        out.camera = readCamera(s.payload);
        break;
      case 'MATL':
        out.materials.push(readMaterial(s.payload));
        break;
      case 'MESH':
        out.meshes.push(readMesh(s.payload));
        break;
      case 'INST':
        (out.instances ??= []).push(readInstance(s.payload));
        break;
      case 'LGHT':
        out.lights.push(readLight(s.payload));
        break;
      case 'ENVR':
        out.environment = readEnvironment(s.payload);
        break;
      case 'FLOR':
        out.floor = readFloor(s.payload);
        break;
      case 'RNDR':
        out.render = readRender(s.payload);
        break;
    }
  }
  return out;
}

/** Numbers as the f32 a file holds them, recursively (typed arrays become plain arrays). */
export function asF32<T>(v: T): T {
  if (typeof v === 'number') return (Number.isInteger(v) ? v : Math.fround(v)) as T;
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>, (x) => Math.fround(x)) as T;
  if (Array.isArray(v)) return v.map((x) => asF32(x)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, asF32(x)])) as T;
  return v;
}

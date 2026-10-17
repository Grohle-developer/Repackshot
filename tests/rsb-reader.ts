// A reader of RSB v1 for the tests only (the interface never reads RSB): splits a file into its
// sections and decodes each one back into the shapes of src/io/rsb.ts, so a round trip can be
// compared field by field. Layout: engine/crates/rt-core/src/scene/rsb.rs.

import type { RsbBitmap, RsbCamera, RsbEffect, RsbEnvironment, RsbFloor, RsbImage, RsbInstance, RsbLabel, RsbLens, RsbLight, RsbMaterial, RsbMesh, RsbPattern, RsbRender, RsbScene, RsbSection, RsbTextures, RsbTextureSlot, RsbVec } from '../src/io/rsb';
import { defaultMaterial } from '../src/io/rsb';

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
  get offset(): number {
    return this.pos;
  }
}

export function readCamera(p: DataView): RsbCamera {
  const c = new Cursor(p);
  return { position: c.vec(), target: c.vec(), up: c.vec(), focalMm: c.f32(), sensorMm: c.f32(), fstop: c.f32(), focusDist: c.f32(), ortho: c.u32() !== 0, orthoWidth: c.f32() };
}

export function readMaterial(p: DataView): RsbMaterial {
  const c = new Cursor(p);
  const m: RsbMaterial = { ...defaultMaterial(), kind: c.u32(), baseColor: c.vec(), metallic: c.f32(), roughness: c.f32(), ior: c.f32(), transmission: c.f32(), coat: c.f32(), coatRoughness: c.f32(), emission: c.vec(), emissionPower: c.f32(), flags: 0, opacity: 1, anisotropy: 0, absorptionMm: 0 };
  m.flags = c.remaining >= 4 ? c.u32() : 0;
  // E5 fields.
  if (c.remaining >= 12) {
    m.opacity = c.f32();
    m.anisotropy = c.f32();
    m.absorptionMm = c.f32();
  }
  // E6's bevel; E9 adds the scattering medium and the Abbe number (all optional).
  if (c.remaining >= 4) m.bevelMm = c.f32();
  if (c.remaining >= 4) m.scatterMm = c.f32();
  if (c.remaining >= 12) m.scatterColor = c.vec();
  if (c.remaining >= 4) m.scatterG = c.f32();
  if (c.remaining >= 4) m.abbe = c.f32();
  // M2b: the texture block from byte 100 (version 1).
  if (c.remaining >= 4 && c.offset === 100 && c.u32() === 1) m.textures = readTextureBlock(c);
  return m;
}

/** The texture block of a MATL after its version word (ARCHITECTURE §5.2, M2a's contract that M2b reads). */
function readTextureBlock(c: Cursor): RsbTextures {
  const image = (v: number) => (v === 0xffffffff ? -1 : v);
  const slots: RsbTextureSlot[] = Array.from({ length: 6 }, () => ({
    image: image(c.u32()),
    projection: c.u32(),
    axis: c.u32(),
    uvSet: c.u32(),
    sizeMm: c.f32(),
    rotationDeg: c.f32(),
    offset: [c.f32(), c.f32()],
    repeat: [c.f32(), c.f32()],
    wrap: c.u32(),
    channel: c.u32(),
    flags: c.u32(),
    strength: c.f32(),
    cutoff: c.f32(),
  }));
  const emissionTint = c.vec();
  const labels: RsbLabel[] = Array.from({ length: c.u32() }, () => ({
    image: image(c.u32()),
    origin: c.vec(),
    u: c.vec(),
    v: c.vec(),
    normal: c.vec(),
    widthMm: c.f32(),
    heightMm: c.f32(),
    depthMm: c.f32(),
    roughness: c.f32(),
    coat: c.f32(),
    relief: c.f32(),
  }));
  return { slots, emissionTint, labels };
}

/** The IMGS section (M2b): the images, their rows without the padding. */
export function readImages(p: DataView): RsbImage[] {
  const c = new Cursor(p);
  const count = c.u32();
  const out: RsbImage[] = [];
  let at = 4;
  for (let i = 0; i < count; i++) {
    const width = p.getUint32(at, true);
    const height = p.getUint32(at + 4, true);
    const channels = p.getUint32(at + 8, true);
    const colorSpace = p.getUint32(at + 12, true);
    const len = width * height * channels;
    const data = new Uint8Array(p.buffer.slice(p.byteOffset + at + 16, p.byteOffset + at + 16 + len));
    out.push({ width, height, channels, colorSpace, data });
    at += 16 + len + ((4 - (len % 4)) % 4);
  }
  return out;
}

export function readPattern(p: DataView): RsbPattern {
  const c = new Cursor(p);
  return {
    material: c.u32(),
    kind: c.u32(),
    colorA: c.vec(),
    colorB: c.vec(),
    scaleMm: c.f32(),
    params: Array.from({ length: 16 }, () => c.f32()),
    variant: c.u32(),
    seed: c.u32(),
  };
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
  const mesh: RsbMesh = { positions, normals, indices, materialId: c.u32() };
  // M2b: the UV sets, when the scene carries textures.
  if (c.remaining >= 4) {
    const sets = c.u32();
    const set = () => Float32Array.from({ length: 2 * n }, () => c.f32());
    if (sets >= 1) mesh.uvs = set();
    if (sets >= 2) mesh.uvs2 = set();
  }
  return mesh;
}

/** True when a MESH payload carries the UV sets word (M2b). */
export function meshHasUvWord(p: DataView): boolean {
  const n = p.getUint32(0, true);
  const m = p.getUint32(4, true);
  return p.byteLength >= 4 * (2 + 6 * n + m + 1) + 4;
}

export function readInstance(p: DataView): RsbInstance {
  const c = new Cursor(p);
  const mesh = c.u32();
  const transform: number[] = [];
  for (let i = 0; i < 12; i++) transform.push(c.f32());
  return { mesh, transform, materialId: c.u32(), flags: c.u32() };
}

/** A light; an IES light (L5, 80 bytes) also says the position of its profile among the IESP sections (`profile`, read by `readRsb`). */
export function readLight(p: DataView): RsbLight & { profile?: number } {
  const c = new Cursor(p);
  const light: RsbLight & { profile?: number } = { kind: c.u32(), position: c.vec(), direction: c.vec(), up: c.vec(), sizeX: c.f32(), sizeY: c.f32(), color: c.vec(), power: c.f32(), spreadDeg: c.f32(), angleDeg: c.f32(), flags: c.u32() };
  if (light.kind === 5 && p.byteLength >= 80) light.profile = c.u32();
  return light;
}

/** An IESP payload: the file as text, one character per byte (the length, the bytes, zero padding to 4). */
export function readProfile(p: DataView): string {
  const n = p.getUint32(0, true);
  let text = '';
  for (let i = 0; i < n; i++) text += String.fromCharCode(p.getUint8(4 + i));
  return text;
}

export function readEnvironment(p: DataView): RsbEnvironment {
  const c = new Cursor(p);
  const e: RsbEnvironment = {
    kind: c.u32(),
    floor: c.f32(),
    horizon: c.f32(),
    zenith: c.f32(),
    strength: c.f32(),
    rotationDeg: c.f32(),
    backgroundColor: c.vec(),
    backgroundMode: c.u32(),
    hdriMap: 0xffffffff,
    backplateMap: 0xffffffff,
    backplateFit: 0,
    skyTurbidity: 3,
    sunAzimuthDeg: 0,
    sunElevationDeg: 45,
    backplateRect: [0, 0, 1, 1],
    skyModel: 0,
  };
  // E5 fields.
  if (c.remaining >= 40) {
    e.hdriMap = c.u32();
    e.backplateMap = c.u32();
    e.backplateFit = c.u32();
    e.skyTurbidity = c.f32();
    e.sunAzimuthDeg = c.f32();
    e.sunElevationDeg = c.f32();
    e.backplateRect = [c.f32(), c.f32(), c.f32(), c.f32()];
  }
  // E5c: the sky model (absent: 0, the physical sky).
  if (c.remaining >= 4) e.skyModel = c.u32();
  return e;
}

/** A BMAP section (E5): format, size, the data (without its padding). */
export function readBitmap(p: DataView): RsbBitmap {
  const c = new Cursor(p);
  const format = c.u32();
  const width = c.u32();
  const height = c.u32();
  const len = c.u32();
  const data = new Uint8Array(p.buffer.slice(p.byteOffset + 16, p.byteOffset + 16 + len));
  return { format, width, height, data };
}

/** A LENS section (O1): the numbers, then the picture (without its padding). */
export function readLens(p: DataView): RsbLens {
  const c = new Cursor(p);
  const l: RsbLens = {
    blades: c.u32(),
    roundness: c.f32(),
    rotationDeg: c.f32(),
    profile: c.u32(),
    profileParam: c.f32(),
    obstruction: c.f32(),
    catsEye: c.f32(),
    squeeze: c.f32(),
    shiftXMm: c.f32(),
    shiftYMm: c.f32(),
    tiltDeg: c.f32(),
    tiltAxisDeg: c.f32(),
    caAmount: c.f32(),
    swirl: c.f32(),
    fieldMm: c.f32(),
    maskKind: c.u32(),
    maskWidth: c.u32(),
    maskHeight: c.u32(),
    mask: new Uint8Array(0),
  };
  const len = l.maskWidth * l.maskHeight;
  l.mask = new Uint8Array(p.buffer.slice(p.byteOffset + 72, p.byteOffset + 72 + len));
  // O3a: the three filter slots after the picture's padding, when the section goes on.
  const at = 72 + Math.ceil(len / 4) * 4;
  if (p.byteLength - at >= 84) {
    const f = new Cursor(new DataView(p.buffer, p.byteOffset + at, 84));
    l.filters = [0, 1, 2].map(() => ({ kind: f.u32(), grade: f.f32(), tint: [f.f32(), f.f32(), f.f32()] as [number, number, number], angleDeg: f.f32(), points: f.u32() }));
  }
  // O2: the prescription of a traced lens after the slots, when the section goes on.
  const tracedAt = at + 84;
  if (p.byteLength - tracedAt >= 4) {
    const t = new Cursor(new DataView(p.buffer, p.byteOffset + tracedAt, p.byteLength - tracedAt));
    const count = t.u32();
    if (count > 0) {
      const stop = t.u32();
      const focusMode = t.u32();
      const [fNumberMin, m0, m1, distortion, vignetting, spherical, breathing] = [0, 1, 2, 3, 4, 5, 6].map(() => t.f32());
      const moving = Array.from({ length: t.u32() }, () => ({ surface: t.u32(), base: t.f32(), near: t.f32() }));
      const surfaces = Array.from({ length: count }, () => ({
        kind: t.u32(),
        radius: t.f32(),
        thickness: t.f32(),
        nd: t.f32(),
        vd: t.f32(),
        semiAperture: t.f32(),
        coating: t.u32(),
        conic: t.f32(),
        aspheric: [t.f32(), t.f32(), t.f32(), t.f32()] as [number, number, number, number],
      }));
      l.prescription = { stop, focusMode, fNumberMin, magnification: [m0, m1], distortion, vignetting, spherical, breathing, moving, surfaces };
    }
  }
  return l;
}

/** Q1: a SECT payload (`u32 flags; f32 normal[3] distance`); the bits of flags the page does not write are dropped. */
export function readSection(p: DataView): RsbSection {
  const c = new Cursor(p);
  const flags = c.u32();
  return { cap: (flags & 1) !== 0, normal: c.vec(), distance: c.f32() };
}

export function readFloor(p: DataView): RsbFloor {
  const c = new Cursor(p);
  return { mode: c.u32(), z: c.f32(), color: c.vec() };
}

export function readRender(p: DataView): RsbRender {
  const c = new Cursor(p);
  const r = { width: c.u32(), height: c.u32(), maxSamples: c.u32(), seed: c.u32(), maxSeconds: c.f32(), exposureEv: c.f32(), tonemap: c.u32(), maxDepth: 8, clampIndirect: 0, passes: 0, denoise: 0, causticPhotons: 0, causticRadius: 0, denoiseStrength: 1, pixelFilter: 0, edgeSupersample: 1, adaptive: 0, noiseThreshold: 0 };
  if (c.remaining >= 4) r.maxDepth = c.u32();
  if (c.remaining >= 4) r.clampIndirect = c.f32();
  // X2: the pass mask.
  if (c.remaining >= 4) r.passes = c.u32();
  if (c.remaining >= 4) r.denoise = c.u32();
  if (c.remaining >= 4) r.causticPhotons = c.u32();
  if (c.remaining >= 4) r.causticRadius = c.f32();
  if (c.remaining >= 4) r.denoiseStrength = c.f32();
  // E11: the pixel filter and the edge samples.
  if (c.remaining >= 4) r.pixelFilter = c.u32();
  if (c.remaining >= 4) r.edgeSupersample = c.u32();
  // E10: adaptive sampling and its noise target (written only when set).
  if (c.remaining >= 4) r.adaptive = c.u32();
  if (c.remaining >= 4) r.noiseThreshold = c.f32();
  return r;
}

/** The whole file (singletons that are missing are left undefined). */
/** S4a: an FXAM payload (rt_sim::params), the trailing fields read as their defaults when the payload ends first. */
export function readEffect(p: DataView): RsbEffect {
  const c = new Cursor(p);
  const e: RsbEffect = {
    kind: c.u32(),
    seed: c.u32(),
    time: c.f32(),
    count: c.u32(),
    regionCenter: c.vec(),
    regionHalf: c.vec(),
    band: [c.f32(), c.f32()],
    sizeMm: c.f32(),
    sizeVar: c.f32(),
    shape: c.u32(),
    fallSpeed: c.f32(),
    fallVar: c.f32(),
    wind: c.vec(),
    turbulence: c.vec(),
    cloudCenter: c.vec(),
    cloudRadius: c.f32(),
    cloudSoftness: c.f32(),
    materialId: c.u32(),
    tintVar: c.f32(),
    flags: c.u32(),
    streak: c.f32(),
    gravity: 1,
    energy: 0,
    spin: 0,
    palette: [],
    forward: 0,
    forwardG: 0,
  };
  if (c.remaining >= 16) {
    e.gravity = c.f32();
    e.energy = c.f32();
    e.spin = c.f32();
    const n = c.u32();
    const tints = [c.vec(), c.vec(), c.vec(), c.vec()];
    e.palette = tints.slice(0, n);
  }
  if (c.remaining >= 8) {
    e.forward = c.f32();
    e.forwardG = c.f32();
  }
  return e;
}

export function readRsb(bytes: Uint8Array): Partial<RsbScene> & { materials: RsbMaterial[]; meshes: RsbMesh[]; lights: RsbLight[]; instances: RsbInstance[] | null; bitmaps: RsbBitmap[]; tags: string[] } {
  const out: Partial<RsbScene> & { materials: RsbMaterial[]; meshes: RsbMesh[]; lights: RsbLight[]; instances: RsbInstance[] | null; bitmaps: RsbBitmap[]; tags: string[] } = {
    materials: [],
    meshes: [],
    lights: [],
    instances: null,
    bitmaps: [],
    tags: [],
  };
  const profiles: string[] = [];
  for (const s of sections(bytes)) {
    out.tags.push(s.tag);
    switch (s.tag) {
      case 'CAMR':
        out.camera = { ...readCamera(s.payload), ...(out.camera?.lens ? { lens: out.camera.lens } : {}) };
        break;
      case 'LENS':
        out.camera = { ...(out.camera as RsbCamera), lens: readLens(s.payload) };
        break;
      case 'MATL':
        out.materials.push(readMaterial(s.payload));
        break;
      case 'PATN':
        (out.patterns ??= []).push(readPattern(s.payload));
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
      case 'IESP':
        profiles.push(readProfile(s.payload));
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
      case 'BMAP':
        out.bitmaps.push(readBitmap(s.payload));
        break;
      case 'FXAM':
        (out.effects ??= []).push(readEffect(s.payload));
        break;
      case 'SECT':
        out.section = readSection(s.payload);
        break;
      case 'IMGS':
        out.images = readImages(s.payload);
        out.textures = true;
        break;
      case 'PROG':
        // M3b: a material's program, its bytes as written (core/material-program.ts `decodeProgram` reads them).
        (out.programs ??= []).push({ material: s.payload.getUint32(0, true), bytes: new Uint8Array(s.payload.buffer, s.payload.byteOffset + 4, s.payload.byteLength - 4).slice() });
        break;
    }
    if ((s.tag === 'MESH' && meshHasUvWord(s.payload)) || (s.tag === 'MATL' && s.payload.byteLength > 100)) out.textures = true;
  }
  // L5: each IES light with the text of the profile it names.
  out.lights = out.lights.map((l) => {
    const { profile, ...rest } = l as RsbLight & { profile?: number };
    return profile === undefined ? rest : { ...rest, ies: profiles[profile] };
  });
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

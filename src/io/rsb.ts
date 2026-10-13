// RSB v1, the engine's binary scene (ARCHITECTURE §5.2), written from TypeScript.
//
// The byte layout and the meaning of every value are those of
// engine/crates/rt-core/src/scene/rsb.rs: `writeRsb` mirrors its reference
// writer (`Scene::to_rsb`) byte for byte, section order and defaults included
// (tests/rsb.test.ts compares against a file written by `rt --write-example`).
// `projectScene` maps a ProjectState onto it: the active camera, a mesh per
// distinct geometry, an instance per visible part, a material per material
// instance, the resolved rig, the environment (dome, sky, flat or HDRI, and the
// background image), the floor and the render settings. Model space only (Z up,
// millimetres): no three.js here.

import { evaluate, type Pose } from '../core/animation';
import { activeCamera, cameraPosition, outputFrameRect, SENSOR_MM, type CameraId, type CameraState } from '../core/camera';
import { kelvinToRgb } from '../core/light-math';
import { lightPosition, rigPivot, type LightInstance } from '../core/lighting';
import type { MaterialInstance } from '../core/materials';
import { mat4Compose, mat4Multiply, normalize, sub, type Mat4 } from '../core/math';
import { getMesh, type MeshData } from '../core/meshes';
import { areaLightFlux, EMIT_RADIANCE_PER_WATT, SUN_IRRADIANCE_PER_POWER } from '../core/photometry';
import { getImage } from '../core/images';
import { polar, toWorldAzimuth } from '../core/light-math';
import { allParts, localMatrix, type NodeId, type SceneNode } from '../core/scene';
import type { ProjectState } from '../core/store';
import { QUALITY_PRESETS } from '../data/quality';
import { DOME_FLOOR, DOME_HORIZON, DOME_ZENITH } from '../data/environment';

// ------------------------------------------------------------------ format

export const RSB_MAGIC = 'RSB1';
export const TAG_CAMR = 'CAMR';
export const TAG_MESH = 'MESH';
export const TAG_MATL = 'MATL';
export const TAG_LGHT = 'LGHT';
export const TAG_ENVR = 'ENVR';
export const TAG_FLOR = 'FLOR';
export const TAG_RNDR = 'RNDR';
export const TAG_INST = 'INST';
export const TAG_BMAP = 'BMAP';

/** `MATL.kind`. */
export const MATERIAL_PRINCIPLED = 0;
export const MATERIAL_GLASS = 1;
export const MATERIAL_EMISSIVE = 2;
/** `MATL.flags` bit 0: the emitter is also sampled as a light. */
export const MATERIAL_FLAG_LIGHT = 1;
/** `MATL.flags` bit 1: the clear part is a thin wall (straight transmission, no refraction). */
export const MATERIAL_FLAG_THIN = 2;
/** `LGHT.kind`. */
export const LIGHT_RECT = 0;
export const LIGHT_DISK = 1;
export const LIGHT_SUN = 2;
/** `LGHT.flags`. */
export const LIGHT_FLAG_GLOSSY = 1;
export const LIGHT_FLAG_CAMERA = 2;
/** `ENVR.kind`. */
export const ENV_STUDIO = 0;
export const ENV_FLAT = 1;
export const ENV_SKY = 2;
export const ENV_HDRI = 3;
/** `ENVR.background_mode`. */
export const BACKGROUND_ENVIRONMENT = 0;
export const BACKGROUND_COLOR = 1;
export const BACKGROUND_TRANSPARENT = 2;
export const BACKGROUND_BACKPLATE = 3;
/** `ENVR.hdri_map` and `ENVR.backplate_map` without a bitmap. */
export const NO_BITMAP = 0xffffffff;
/** `ENVR.backplate_fit`. */
export const BACKPLATE_FILL = 0;
export const BACKPLATE_FIT = 1;
export const BACKPLATE_STRETCH = 2;
/** `BMAP.format`. */
export const BITMAP_RGB8 = 0;
export const BITMAP_RGBA8 = 1;
export const BITMAP_RGB_F32 = 2;
export const BITMAP_HDR = 16;
export const BITMAP_EXR = 17;
/** `ENVR.sky_turbidity` when nothing says otherwise. */
export const DEFAULT_TURBIDITY = 3;
/** `FLOR.mode`. */
export const FLOOR_NONE = 0;
export const FLOOR_VISIBLE = 1;
export const FLOOR_SHADOW_CATCHER = 2;
/** `RNDR.tonemap`. */
export const TONEMAP_LINEAR = 0;
export const TONEMAP_ACES = 1;
export const TONEMAP_FILMIC = 2;
export const TONEMAP_AGX = 3;
export const TONEMAP_STANDARD = 4;
/** `RNDR.max_depth` 0 means this. */
export const DEFAULT_MAX_DEPTH = 8;
/** Largest image side the engine accepts. */
export const MAX_DIMENSION = 16384;

export type RsbVec = [number, number, number];

export interface RsbCamera {
  position: RsbVec;
  target: RsbVec;
  up: RsbVec;
  focalMm: number;
  /** Along the longer image side. */
  sensorMm: number;
  fstop: number;
  focusDist: number;
  ortho: boolean;
  orthoWidth: number;
}

export interface RsbMaterial {
  kind: number;
  baseColor: RsbVec;
  metallic: number;
  roughness: number;
  ior: number;
  transmission: number;
  coat: number;
  coatRoughness: number;
  emission: RsbVec;
  emissionPower: number;
  flags: number;
  /** E5: coverage (below one, a stochastic cut-out). */
  opacity: number;
  /** E5: anisotropy of the GGX lobes, 0..1. */
  anisotropy: number;
  /** E5: absorption distance of the clear part in mm (0: a surface tint). */
  absorptionMm: number;
}

export interface RsbMesh {
  positions: ArrayLike<number>;
  /** Empty, or one per position (zero normals: the face normal). */
  normals: ArrayLike<number>;
  indices: ArrayLike<number>;
  materialId: number;
}

export interface RsbInstance {
  mesh: number;
  /** The 3 x 4 object-to-world matrix by rows (12 numbers). */
  transform: number[];
  materialId: number;
  flags: number;
}

export interface RsbLight {
  kind: number;
  position: RsbVec;
  direction: RsbVec;
  up: RsbVec;
  sizeX: number;
  sizeY: number;
  color: RsbVec;
  power: number;
  spreadDeg: number;
  angleDeg: number;
  flags: number;
}

export interface RsbEnvironment {
  kind: number;
  floor: number;
  horizon: number;
  zenith: number;
  strength: number;
  rotationDeg: number;
  backgroundColor: RsbVec;
  backgroundMode: number;
  /** E5: the bitmap of the HDRI, or NO_BITMAP. */
  hdriMap: number;
  /** E5: the bitmap of the background image, or NO_BITMAP. */
  backplateMap: number;
  backplateFit: number;
  skyTurbidity: number;
  /** E5: where the sky's sun is, degrees: azimuth from +X towards +Y, elevation above the horizon. */
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  /** E5: the output frame inside the image, `[u0, v0, u1, v1]` from the top left. */
  backplateRect: [number, number, number, number];
}

/** E5: an image the environment refers to (RSB `BMAP`). */
export interface RsbBitmap {
  format: number;
  /** The size for the raw formats; 0 for the files that carry theirs. */
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RsbFloor {
  mode: number;
  z: number;
  color: RsbVec;
}

export interface RsbRender {
  width: number;
  height: number;
  maxSamples: number;
  seed: number;
  maxSeconds: number;
  exposureEv: number;
  tonemap: number;
  maxDepth: number;
  clampIndirect: number;
}

/** What the engine renders: `rt_core::scene::Scene`, field for field. */
export interface RsbScene {
  camera: RsbCamera;
  materials: RsbMaterial[];
  meshes: RsbMesh[];
  /** null: one identity instance per mesh with the mesh's material (no INST sections). */
  instances: RsbInstance[] | null;
  lights: RsbLight[];
  environment: RsbEnvironment;
  floor: RsbFloor;
  render: RsbRender;
  /** E5: the bitmaps, referred to by index from the environment. */
  bitmaps: RsbBitmap[];
}

// The defaults of rt-core (`impl Default` of each struct): what a field the
// interface does not have is written as.

export function defaultCamera(): RsbCamera {
  return { position: [0, -1000, 0], target: [0, 0, 0], up: [0, 0, 1], focalMm: 50, sensorMm: 36, fstop: 0, focusDist: 1000, ortho: false, orthoWidth: 1000 };
}

export function defaultMaterial(): RsbMaterial {
  return { kind: MATERIAL_PRINCIPLED, baseColor: [0.8, 0.8, 0.8], metallic: 0, roughness: 0.5, ior: 1.5, transmission: 0, coat: 0, coatRoughness: 0, emission: [0, 0, 0], emissionPower: 0, flags: 0, opacity: 1, anisotropy: 0, absorptionMm: 0 };
}

export function defaultLight(): RsbLight {
  return { kind: LIGHT_RECT, position: [0, 0, 1000], direction: [0, 0, -1], up: [0, 1, 0], sizeX: 500, sizeY: 500, color: [1, 1, 1], power: 1, spreadDeg: 180, angleDeg: 0.5, flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA };
}

export function defaultEnvironment(): RsbEnvironment {
  return {
    kind: ENV_STUDIO,
    floor: 0.1,
    horizon: 0.3,
    zenith: 0.6,
    strength: 1,
    rotationDeg: 0,
    backgroundColor: [0.05, 0.05, 0.05],
    backgroundMode: BACKGROUND_ENVIRONMENT,
    hdriMap: NO_BITMAP,
    backplateMap: NO_BITMAP,
    backplateFit: BACKPLATE_FILL,
    skyTurbidity: DEFAULT_TURBIDITY,
    sunAzimuthDeg: 0,
    sunElevationDeg: 45,
    backplateRect: [0, 0, 1, 1],
  };
}

export function defaultFloor(): RsbFloor {
  return { mode: FLOOR_NONE, z: 0, color: [0.5, 0.5, 0.5] };
}

export function defaultRender(): RsbRender {
  return { width: 640, height: 360, maxSamples: 64, seed: 0, maxSeconds: 0, exposureEv: 0, tonemap: TONEMAP_ACES, maxDepth: DEFAULT_MAX_DEPTH, clampIndirect: 0 };
}

export const IDENTITY_ROWS: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** The instances a file without INST sections means. */
export function implicitInstances(meshes: readonly RsbMesh[]): RsbInstance[] {
  return meshes.map((m, i) => ({ mesh: i, transform: [...IDENTITY_ROWS], materialId: m.materialId, flags: 0 }));
}

function sameInstances(a: readonly RsbInstance[], b: readonly RsbInstance[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.mesh !== y.mesh || x.materialId !== y.materialId || x.flags !== y.flags) return false;
    // Compared as the f32 the file holds, like rt-core compares its Transform.
    for (let k = 0; k < 12; k++) if (Math.fround(x.transform[k]) !== Math.fround(y.transform[k])) return false;
  }
  return true;
}

export interface WriteOptions {
  /**
   * false: leave the MESH and BMAP sections out, for `rt_scene_update` on a scene that already has
   * these meshes and bitmaps (the engine keeps them, and the meshes' BVHs). The INST sections are then
   * always written. The project's mesh key names both, so a change of either sends everything.
   */
  meshes?: boolean;
}

const CAMR_BYTES = 60;
const MATL_BYTES = 72;
const LGHT_BYTES = 76;
const ENVR_BYTES = 80;
const FLOR_BYTES = 20;
const RNDR_BYTES = 36;
const INST_BYTES = 60;

function meshBytes(m: RsbMesh): number {
  return 4 * (2 + (m.positions.length / 3) * 6 + m.indices.length + 1);
}

/** A BMAP payload: four words, the data, zero padding to a multiple of four. */
function bitmapBytes(b: RsbBitmap): number {
  return 16 + b.data.length + ((4 - (b.data.length % 4)) % 4);
}

/** Little-endian writer over a buffer of the exact final size. */
class ByteWriter {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private pos = 0;
  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  tag(t: string): void {
    for (let i = 0; i < 4; i++) this.bytes[this.pos + i] = t.charCodeAt(i);
    this.pos += 4;
  }
  u32(v: number): void {
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }
  f32(v: number): void {
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }
  vec(v: readonly number[]): void {
    this.f32(v[0]);
    this.f32(v[1]);
    this.f32(v[2]);
  }
  raw(data: Uint8Array): void {
    this.bytes.set(data, this.pos);
    this.pos += data.length;
  }
  pad(n: number): void {
    this.pos += n; // the buffer starts zeroed
  }
  section(t: string, len: number, body: () => void): void {
    this.tag(t);
    this.u32(len);
    const end = this.pos + len;
    body();
    if (this.pos !== end) throw new Error(`RSB ${t}: wrote ${this.pos - end + len} bytes, expected ${len}`);
  }
  get length(): number {
    return this.pos;
  }
}

/** Serialises a scene exactly as rt-core's `Scene::to_rsb` does. */
export function writeRsb(scene: RsbScene, opts: WriteOptions = {}): Uint8Array {
  const withMeshes = opts.meshes !== false;
  const implicit = implicitInstances(scene.meshes);
  const given = scene.instances ?? implicit;
  // rt-core writes INST only when the instances differ from the implicit ones; an update without
  // meshes always carries them, so the engine never pairs kept meshes with stale materials.
  const instances = !withMeshes || !sameInstances(given, implicit) ? given : null;

  let size = 8 + 8 + CAMR_BYTES + scene.materials.length * (8 + MATL_BYTES) + scene.lights.length * (8 + LGHT_BYTES);
  size += 8 + ENVR_BYTES + 8 + FLOR_BYTES + 8 + RNDR_BYTES;
  if (withMeshes) for (const m of scene.meshes) size += 8 + meshBytes(m);
  if (withMeshes) for (const b of scene.bitmaps) size += 8 + bitmapBytes(b);
  if (instances) size += instances.length * (8 + INST_BYTES);

  const w = new ByteWriter(size);
  w.tag(RSB_MAGIC);
  w.u32(0); // header_len

  const c = scene.camera;
  w.section(TAG_CAMR, CAMR_BYTES, () => {
    w.vec(c.position);
    w.vec(c.target);
    w.vec(c.up);
    w.f32(c.focalMm);
    w.f32(c.sensorMm);
    w.f32(c.fstop);
    w.f32(c.focusDist);
    w.u32(c.ortho ? 1 : 0);
    w.f32(c.orthoWidth);
  });
  for (const m of scene.materials) {
    w.section(TAG_MATL, MATL_BYTES, () => {
      w.u32(m.kind);
      w.vec(m.baseColor);
      for (const v of [m.metallic, m.roughness, m.ior, m.transmission, m.coat, m.coatRoughness]) w.f32(v);
      w.vec(m.emission);
      w.f32(m.emissionPower);
      w.u32(m.flags);
      w.f32(m.opacity);
      w.f32(m.anisotropy);
      w.f32(m.absorptionMm);
    });
  }
  if (withMeshes) {
    for (const mesh of scene.meshes) {
      w.section(TAG_MESH, meshBytes(mesh), () => {
        const n = mesh.positions.length / 3;
        w.u32(n);
        w.u32(mesh.indices.length);
        for (let i = 0; i < n * 3; i++) w.f32(mesh.positions[i]);
        if (mesh.normals.length === n * 3) for (let i = 0; i < n * 3; i++) w.f32(mesh.normals[i]);
        else for (let i = 0; i < n * 3; i++) w.f32(0);
        for (let i = 0; i < mesh.indices.length; i++) w.u32(mesh.indices[i]);
        w.u32(mesh.materialId);
      });
    }
  }
  if (instances) {
    for (const inst of instances) {
      w.section(TAG_INST, INST_BYTES, () => {
        w.u32(inst.mesh);
        for (let k = 0; k < 12; k++) w.f32(inst.transform[k]);
        w.u32(inst.materialId);
        w.u32(inst.flags);
      });
    }
  }
  for (const l of scene.lights) {
    w.section(TAG_LGHT, LGHT_BYTES, () => {
      w.u32(l.kind);
      w.vec(l.position);
      w.vec(l.direction);
      w.vec(l.up);
      w.f32(l.sizeX);
      w.f32(l.sizeY);
      w.vec(l.color);
      w.f32(l.power);
      w.f32(l.spreadDeg);
      w.f32(l.angleDeg);
      w.u32(l.flags);
    });
  }
  if (withMeshes) {
    for (const b of scene.bitmaps) {
      w.section(TAG_BMAP, bitmapBytes(b), () => {
        w.u32(b.format);
        w.u32(b.width);
        w.u32(b.height);
        w.u32(b.data.length);
        w.raw(b.data);
        w.pad((4 - (b.data.length % 4)) % 4);
      });
    }
  }
  const e = scene.environment;
  w.section(TAG_ENVR, ENVR_BYTES, () => {
    w.u32(e.kind);
    for (const v of [e.floor, e.horizon, e.zenith, e.strength, e.rotationDeg]) w.f32(v);
    w.vec(e.backgroundColor);
    w.u32(e.backgroundMode);
    w.u32(e.hdriMap);
    w.u32(e.backplateMap);
    w.u32(e.backplateFit);
    w.f32(e.skyTurbidity);
    w.f32(e.sunAzimuthDeg);
    w.f32(e.sunElevationDeg);
    for (const v of e.backplateRect) w.f32(v);
  });
  const f = scene.floor;
  w.section(TAG_FLOR, FLOR_BYTES, () => {
    w.u32(f.mode);
    w.f32(f.z);
    w.vec(f.color);
  });
  const r = scene.render;
  w.section(TAG_RNDR, RNDR_BYTES, () => {
    w.u32(r.width);
    w.u32(r.height);
    w.u32(r.maxSamples);
    w.u32(r.seed);
    w.f32(r.maxSeconds);
    w.f32(r.exposureEv);
    w.u32(r.tonemap);
    w.u32(r.maxDepth);
    w.f32(r.clampIndirect);
  });
  if (w.length !== size) throw new Error(`RSB: wrote ${w.length} bytes, expected ${size}`);
  return w.bytes;
}

// ------------------------------------------------------------------ project

/** How the image is framed and sampled. */
export interface SceneView {
  /** Image size in pixels. */
  width: number;
  height: number;
  maxSamples: number;
  maxSeconds: number;
  /** Background as alpha 0 (a transparent PNG), whatever the environment says. */
  transparent?: boolean;
  /** Camera to render through (default: the active one). */
  camera?: CameraId;
  /** The camera as a gesture has it right now (orbit, pan, zoom before the store hears of it). */
  cameraPatch?: Partial<Omit<CameraState, 'id'>>;
  /**
   * The viewport: the image covers a view of `viewW x viewH` CSS pixels in which the output
   * frame sits inset exactly as the preview draws it (`outputFrameRect`). Absent: the image is
   * the output frame itself (Render).
   */
  viewport?: { viewW: number; viewH: number };
  /** The animation pose to render (default: the playhead's, when clips move anything). */
  pose?: Pose | null;
  /** `RNDR.max_depth` (default: the quality tier's bounces). */
  maxDepth?: number;
  /** `RNDR.clamp_indirect` (default 0: off). */
  clampIndirect?: number;
  /** `RNDR.seed` (default 0). */
  seed?: number;
}

/** A scene and the identity of its geometry: an equal `meshKey` means the same MESH sections. */
export interface ProjectScene {
  scene: RsbScene;
  meshKey: string;
}

/** `image.viewTransform` to `RNDR.tonemap`. */
export function tonemapFor(viewTransform: ProjectState['image']['viewTransform']): number {
  return viewTransform === 'STANDARD' ? TONEMAP_STANDARD : viewTransform === 'AGX' ? TONEMAP_AGX : TONEMAP_FILMIC;
}

/** Linear value of the preview's fallback grey (#b3b3b3) for a part without material. */
const FALLBACK_GREY = ((179 / 255 + 0.055) / 1.055) ** 2.4;

function rgbOf(v: unknown, fallback: readonly number[]): RsbVec {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1], v[2]] : [fallback[0], fallback[1], fallback[2]];
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Absorption distance of a GLASS material without its own (`absorptionMm` of core/materials.ts). */
export const GLASS_ABSORPTION_MM = 50;

/**
 * A material instance with the semantics of rt-core: SIMPLE, WOOD and FABRIC as principled (wood
 * and fabric as their mean colour until E6, like the preview; SIMPLE with its transmission,
 * opacity and anisotropy, E5), GLASS as kind 1 (clear glass: its colour after `absorptionMm`
 * millimetres inside, or a surface tint at 0; a thin wall with `walls` THIN), EMISSIVE as kind 2
 * with radiance `colour x emitPower x EMIT_RADIANCE_PER_WATT` (the colour of a black body at its
 * temperature, normalised to its largest channel, or the colour given), sampled as a light when
 * it emits. Wear, wood and fabric patterns, bevel and subsurface come later (E6, E7).
 */
export function materialToRsb(inst: MaterialInstance | null | undefined): RsbMaterial {
  const m = defaultMaterial();
  if (!inst) {
    m.baseColor = [FALLBACK_GREY, FALLBACK_GREY, FALLBACK_GREY];
    return m;
  }
  const p = inst.params;
  switch (inst.family) {
    case 'SIMPLE':
      m.baseColor = rgbOf(p.baseColor, [0.8, 0.8, 0.8]);
      m.metallic = clamp01(num(p.metallic, 0));
      m.roughness = clamp01(num(p.roughness, 0.5));
      m.coat = clamp01(num(p.coat, 0));
      m.coatRoughness = clamp01(num(p.coatRoughness, 0.03));
      m.ior = Math.max(1, num(p.ior, 1.5));
      m.transmission = clamp01(num(p.transmission, 0));
      m.opacity = clamp01(num(p.opacity, 1));
      m.anisotropy = clamp01(num(p.anisotropic, 0));
      break;
    case 'GLASS':
      m.kind = MATERIAL_GLASS;
      m.baseColor = rgbOf(p.baseColor, [1, 1, 1]);
      m.roughness = clamp01(num(p.roughness, 0));
      m.ior = Math.max(1, num(p.ior, 1.52));
      m.transmission = clamp01(num(p.transmission, 1));
      m.absorptionMm = Math.max(0, num(p.absorptionMm, GLASS_ABSORPTION_MM));
      m.flags = p.walls === 'THIN' ? MATERIAL_FLAG_THIN : 0;
      break;
    case 'WOOD': {
      const a = rgbOf(p.woodColor1, [0.56, 0.38, 0.21]);
      const b = rgbOf(p.woodColor2, [0.3, 0.18, 0.09]);
      m.baseColor = [a[0] * 0.6 + b[0] * 0.4, a[1] * 0.6 + b[1] * 0.4, a[2] * 0.6 + b[2] * 0.4];
      m.roughness = clamp01(num(p.roughness, 0.45));
      m.coat = clamp01(num(p.coat, 0));
      m.coatRoughness = 0.03;
      break;
    }
    case 'FABRIC': {
      const a = rgbOf(p.threadColor1, [0.7, 0.7, 0.68]);
      const b = rgbOf(p.threadColor2, [0.6, 0.6, 0.58]);
      m.baseColor = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      m.roughness = clamp01(num(p.roughness, 0.75));
      m.coat = clamp01(num(p.coat, 0));
      m.coatRoughness = clamp01(num(p.coatRoughness, 0.05));
      break;
    }
    case 'EMISSIVE': {
      m.kind = MATERIAL_EMISSIVE;
      m.baseColor = [0.03, 0.03, 0.03];
      m.roughness = 0.4;
      m.emission = p.emitKind === 'COLOR' ? rgbOf(p.emitColor, [1, 1, 1]) : (kelvinToRgb(num(p.temperature, 5600)) as RsbVec);
      m.emissionPower = Math.max(0, num(p.emitPower, 50)) * EMIT_RADIANCE_PER_WATT;
      m.flags = m.emissionPower > 0 ? MATERIAL_FLAG_LIGHT : 0;
      break;
    }
  }
  return m;
}

/**
 * One light of the resolved rig: placed like the preview places it (`lightPosition`, around and
 * aimed at the rig pivot), rect / disk / sun, its power converted to the engine's units
 * (`areaLightFlux`; a sun's power is its irradiance). An ellipse becomes the disk of the same
 * area (the engine has no ellipse); `LightInstance.angle` and `angle_deg` are both degrees
 * (0.545 is the real sun's angular diameter, as in EZ Packshot's recipes).
 */
export function lightToRsb(state: ProjectState, l: LightInstance): RsbLight {
  const size = state.scene.partSizeMm || 1;
  const pos = lightPosition(state, l);
  const target = rigPivot(state);
  let dir = normalize(sub(target, pos));
  if (dir[0] === 0 && dir[1] === 0 && dir[2] === 0) dir = [0, 0, -1];
  const flags = (l.glossy ? LIGHT_FLAG_GLOSSY : 0) | (l.camera ? LIGHT_FLAG_CAMERA : 0);
  const color: RsbVec = [l.color[0], l.color[1], l.color[2]];
  if (l.type === 'SUN') {
    return { ...defaultLight(), kind: LIGHT_SUN, position: pos, direction: dir, up: [0, 0, 1], color, power: Math.max(0, l.power) * SUN_IRRADIANCE_PER_POWER, spreadDeg: 180, angleDeg: Math.max(0, l.angle), flags };
  }
  const w = Math.max(1e-3, l.size) * size;
  const h = Math.max(1e-3, l.shape === 'SQUARE' || l.shape === 'DISK' ? l.size : l.sizeY) * size;
  const disk = l.shape === 'DISK' || l.shape === 'ELLIPSE';
  const sizeX = l.shape === 'ELLIPSE' ? Math.sqrt(w * h) : w;
  return {
    kind: disk ? LIGHT_DISK : LIGHT_RECT,
    position: pos,
    direction: dir,
    up: [0, 0, 1],
    sizeX,
    sizeY: disk ? sizeX : h,
    color,
    power: areaLightFlux(Math.max(0, l.power), state.scene.partSizeMm),
    spreadDeg: Math.min(180, Math.max(1, l.spread)),
    angleDeg: defaultLight().angleDeg,
    flags,
  };
}

/**
 * The camera for an image of `width x height` pixels. Without `viewport` it is the output
 * frame: the 36 mm sensor on the longer side, as the engine assumes. With it, the image covers
 * the whole viewport and the output frame sits inset where the preview draws it, so the sensor
 * (and an orthographic width) grows by the viewport over the frame.
 */
export function cameraToRsb(cam: CameraState, outW: number, outH: number, width: number, height: number, viewport?: { viewW: number; viewH: number }): RsbCamera {
  let sensorMm = SENSOR_MM;
  let orthoWidth = cam.orthoWidth;
  if (viewport && viewport.viewW > 0 && viewport.viewH > 0) {
    const frame = outputFrameRect(viewport.viewW, viewport.viewH, outW, outH);
    const outAspect = outW > 0 && outH > 0 ? outW / outH : 16 / 9;
    // Millimetres of sensor per CSS pixel of the viewport, then per image pixel.
    const mmPerCss = outAspect >= 1 ? SENSOR_MM / frame.width : SENSOR_MM / frame.height;
    const mmPerPx = (mmPerCss * viewport.viewW) / Math.max(1, width);
    sensorMm = mmPerPx * Math.max(width, height);
    orthoWidth = (cam.orthoWidth * viewport.viewW) / frame.width;
  }
  return {
    position: cameraPosition(cam),
    target: [cam.target[0], cam.target[1], cam.target[2]],
    up: [0, 0, 1],
    focalMm: Math.max(1, cam.focalMm),
    sensorMm,
    fstop: Math.max(0, cam.fstop),
    focusDist: Math.max(0, cam.focusDistance),
    ortho: cam.projection === 'ORTHOGRAPHIC',
    orthoWidth: Math.max(1e-3, orthoWidth),
  };
}

/** The 3 x 4 rows of a column-major Mat4. */
export function matrixRows(m: Mat4): number[] {
  return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]];
}

/** Derived meshes (flat shading, face-material groups), cached per registry entry. */
const derived = new WeakMap<MeshData, Map<string, RsbMesh>>();

/** The triangles of each material of a part with face materials, in order of first appearance. */
function faceGroups(node: SceneNode, triangles: number): { material: string | null; tris: number[] }[] {
  const per = new Array<string | null>(triangles).fill(node.material ?? null);
  for (const f of node.faceMaterials ?? []) for (let t = f.start; t < f.start + f.count && t < triangles; t++) per[t] = f.material;
  const groups: { material: string | null; tris: number[] }[] = [];
  const index = new Map<string | null, number>();
  for (let t = 0; t < triangles; t++) {
    let g = index.get(per[t]);
    if (g === undefined) {
      g = groups.push({ material: per[t], tris: [] }) - 1;
      index.set(per[t], g);
    }
    groups[g].tris.push(t);
  }
  return groups;
}

/** A sub-mesh of some triangles, its vertices compacted. */
function subMesh(data: MeshData, tris: readonly number[], flat: boolean): RsbMesh {
  const remap = new Map<number, number>();
  const indices = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    for (let k = 0; k < 3; k++) {
      const v = data.indices[tris[i] * 3 + k];
      let r = remap.get(v);
      if (r === undefined) {
        r = remap.size;
        remap.set(v, r);
      }
      indices[i * 3 + k] = r;
    }
  }
  const positions = new Float32Array(remap.size * 3);
  const normals = flat ? new Float32Array(0) : new Float32Array(remap.size * 3);
  for (const [v, r] of remap) {
    positions.set(data.positions.subarray(v * 3, v * 3 + 3), r * 3);
    if (!flat) normals.set(data.normals.subarray(v * 3, v * 3 + 3), r * 3);
  }
  return { positions, normals, indices, materialId: 0 };
}

function partMeshes(node: SceneNode, data: MeshData): { key: string; mesh: RsbMesh; material: string | null }[] {
  const flat = node.smooth === false;
  const base = `${node.mesh!.id}|${flat ? 'f' : 's'}`;
  let cache = derived.get(data);
  if (!cache) {
    cache = new Map();
    derived.set(data, cache);
  }
  if (!node.faceMaterials?.length) {
    let mesh = cache.get(base);
    if (!mesh) {
      // Flat shading: zero normals, which the engine reads as "use the face normal".
      mesh = { positions: data.positions, normals: flat ? new Float32Array(0) : data.normals, indices: data.indices, materialId: 0 };
      cache.set(base, mesh);
    }
    return [{ key: base, mesh, material: node.material ?? null }];
  }
  const groups = faceGroups(node, data.indices.length / 3);
  const sig = groups.map((g) => g.tris.length).join(',') + ':' + JSON.stringify(node.faceMaterials.map((f) => [f.start, f.count]));
  return groups.map((g, i) => {
    const key = `${base}|${sig}|${i}`;
    let mesh = cache!.get(key);
    if (!mesh) {
      mesh = subMesh(data, g.tris, flat);
      cache!.set(key, mesh);
    }
    return { key, mesh, material: g.material };
  });
}

/** The pose the preview shows: the playhead's, when clips exist and the playhead moved. */
export function currentPose(state: ProjectState): Pose | null {
  const anim = state.animation;
  return anim.clips.length > 0 && (anim.playing || anim.playhead > 0) ? evaluate(state, anim.playhead) : null;
}

/** The engine's scene for a project state and a view. */
export function projectScene(state: ProjectState, view: SceneView): ProjectScene {
  const pose = view.pose === undefined ? currentPose(state) : view.pose;
  const width = Math.max(1, Math.min(MAX_DIMENSION, Math.round(view.width)));
  const height = Math.max(1, Math.min(MAX_DIMENSION, Math.round(view.height)));

  // Camera: the one asked for, the shot's when an animation poses it, a gesture's live view.
  const chosen = (view.camera && state.camera.cameras[view.camera]) || activeCamera(state);
  let cam: CameraState = chosen;
  if (!view.camera && pose?.camera) {
    const base = state.camera.cameras[pose.camera.camera] ?? chosen;
    cam = { ...base, ...pose.camera, id: base.id };
  }
  if (view.cameraPatch) cam = { ...cam, ...view.cameraPatch };
  const camera = cameraToRsb(cam, state.render.width, state.render.height, width, height, view.viewport);

  // Geometry: a mesh per distinct (mesh, shading, face groups), an instance per visible part.
  const nodes = state.scene.nodes;
  const worlds = new Map<NodeId, Mat4>();
  const worldOf = (id: NodeId): Mat4 => {
    const hit = worlds.get(id);
    if (hit) return hit;
    const node = nodes[id];
    const p = pose?.nodes[id];
    const local = p ? mat4Compose(p.position, p.rotation, p.scale) : localMatrix(node);
    const m = node.parent && nodes[node.parent] ? mat4Multiply(worldOf(node.parent), local) : local;
    worlds.set(id, m);
    return m;
  };
  const visible = (id: NodeId): boolean => {
    for (let n: SceneNode | undefined = nodes[id]; n; n = n.parent ? nodes[n.parent] : undefined) {
      if (!(pose?.nodes[n.id]?.visible ?? n.visible)) return false;
    }
    return true;
  };

  const materials: RsbMaterial[] = [];
  const materialIndex = new Map<string | null, number>();
  const materialFor = (id: string | null): number => {
    const key = id && state.materials[id] ? id : null;
    let i = materialIndex.get(key);
    if (i === undefined) {
      i = materials.push(materialToRsb(key ? state.materials[key] : null)) - 1;
      materialIndex.set(key, i);
    }
    return i;
  };

  const meshes: RsbMesh[] = [];
  const meshKeys: string[] = [];
  const meshIndex = new Map<string, number>();
  const instances: RsbInstance[] = [];
  for (const id of allParts(state)) {
    const node = nodes[id];
    if (!node.mesh || !visible(id)) continue;
    const data = getMesh(node.mesh.id);
    if (!data || data.indices.length === 0) continue;
    const rows = matrixRows(worldOf(id));
    for (const part of partMeshes(node, data)) {
      const materialId = materialFor(part.material);
      let mi = meshIndex.get(part.key);
      if (mi === undefined) {
        // The instances carry the materials. A mesh names material 0, valid in any scene that has
        // a mesh, so meshes the workers keep across updates never point past a shorter MATL list.
        mi = meshes.push({ ...part.mesh, materialId: 0 }) - 1;
        meshIndex.set(part.key, mi);
        meshKeys.push(part.key);
      }
      instances.push({ mesh: mi, transform: rows, materialId, flags: 0 });
    }
  }
  // A scene without parts still needs no material; one with parts always has its materials.

  // The resolved rig, posed like the preview poses it.
  const lights: RsbLight[] = [];
  // The sky's sun is the rig's (first) sun light: SPEC §3.4, "sky and sun from the sun light".
  let toSun: RsbVec | null = null;
  for (const l0 of state.studio.lights) {
    const lp = pose?.lights[l0.id];
    const l = lp ? { ...l0, power: lp.power, color: lp.color, az: lp.az, el: lp.el, enabled: lp.enabled } : l0;
    if (!l.enabled || !(l.power > 0)) continue;
    const light = lightToRsb(state, l);
    if (l.type === 'SUN' && !toSun) toSun = [-light.direction[0], -light.direction[1], -light.direction[2]];
    lights.push(light);
  }

  const env = state.environment;
  const flat = env.kind === 'FLAT';
  // The engine's flat environment is grey: the colour's luminance.
  const grey = 0.2126 * env.color[0] + 0.7152 * env.color[1] + 0.0722 * env.color[2];
  // The bitmaps: the HDRI when it lights, the background image when it shows (and is loaded).
  const bitmaps: RsbBitmap[] = [];
  const imageKeys: string[] = [];
  const hdri = env.kind === 'HDRI' && env.hdri ? getImage(env.hdri.id) : undefined;
  const hdriMap = hdri && (hdri.format === 'HDR' || hdri.format === 'EXR') ? bitmaps.push({ format: hdri.format === 'HDR' ? BITMAP_HDR : BITMAP_EXR, width: 0, height: 0, data: hdri.bytes }) - 1 : NO_BITMAP;
  if (hdriMap !== NO_BITMAP) imageKeys.push(env.hdri!.id);
  const plate = !view.transparent && env.background === 'BACKPLATE' && env.backplate ? getImage(env.backplate.id) : undefined;
  const backplateMap = plate?.rgba8 ? bitmaps.push({ format: BITMAP_RGBA8, width: plate.width, height: plate.height, data: plate.rgba8 }) - 1 : NO_BITMAP;
  if (backplateMap !== NO_BITMAP) imageKeys.push(env.backplate!.id);
  // Without a sun light the sky's sun is the environment's own, placed like a light (camera-relative).
  const sun = toSun ?? polar(toWorldAzimuth(env.skySun.az), env.skySun.el, 1);
  const sunLength = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  // The output frame inside a viewport image: the background image fits it.
  let backplateRect: [number, number, number, number] = [0, 0, 1, 1];
  if (view.viewport && view.viewport.viewW > 0 && view.viewport.viewH > 0) {
    const f = outputFrameRect(view.viewport.viewW, view.viewport.viewH, state.render.width, state.render.height);
    backplateRect = [f.x / view.viewport.viewW, f.y / view.viewport.viewH, (f.x + f.width) / view.viewport.viewW, (f.y + f.height) / view.viewport.viewH];
  }
  const environment: RsbEnvironment = {
    kind: flat ? ENV_FLAT : env.kind === 'SKY' ? ENV_SKY : env.kind === 'HDRI' ? ENV_HDRI : ENV_STUDIO,
    floor: flat ? grey : DOME_FLOOR,
    horizon: flat ? grey : DOME_HORIZON,
    zenith: flat ? grey : DOME_ZENITH,
    strength: Math.max(0, env.strength),
    rotationDeg: pose ? pose.envRotationDeg : env.rotationDeg,
    backgroundColor: [env.color[0], env.color[1], env.color[2]],
    backgroundMode: view.transparent
      ? BACKGROUND_TRANSPARENT
      : env.background === 'COLOR'
        ? BACKGROUND_COLOR
        : env.background === 'TRANSPARENT'
          ? BACKGROUND_TRANSPARENT
          : env.background === 'BACKPLATE'
            ? BACKGROUND_BACKPLATE
            : BACKGROUND_ENVIRONMENT,
    hdriMap,
    backplateMap,
    backplateFit: env.backplateFit === 'FIT' ? BACKPLATE_FIT : env.backplateFit === 'STRETCH' ? BACKPLATE_STRETCH : BACKPLATE_FILL,
    skyTurbidity: Number.isFinite(env.skyTurbidity) ? Math.min(10, Math.max(1.7, env.skyTurbidity)) : DEFAULT_TURBIDITY,
    sunAzimuthDeg: (Math.atan2(sun[1], sun[0]) * 180) / Math.PI,
    sunElevationDeg: (Math.asin(Math.max(-1, Math.min(1, sun[2] / sunLength))) * 180) / Math.PI,
    backplateRect,
  };

  // The preview's floor is a shadow catcher (a shadow on nothing), shown when floor and shadow are on.
  const floor: RsbFloor = { ...defaultFloor(), mode: state.studio.floor && state.studio.shadow && state.scene.roots.length > 0 ? FLOOR_SHADOW_CATCHER : FLOOR_NONE };

  const quality = state.render.quality;
  const render: RsbRender = {
    ...defaultRender(),
    width,
    height,
    maxSamples: Math.max(0, Math.round(view.maxSamples)),
    maxSeconds: Math.max(0, view.maxSeconds),
    exposureEv: state.image.exposureEv,
    tonemap: tonemapFor(state.image.viewTransform),
    maxDepth: view.maxDepth !== undefined && view.maxDepth > 0 ? Math.round(view.maxDepth) : quality === 'CUSTOM' ? DEFAULT_MAX_DEPTH : (QUALITY_PRESETS[quality]?.bounces ?? DEFAULT_MAX_DEPTH),
    clampIndirect: Math.max(0, view.clampIndirect ?? 0),
    seed: Math.max(0, Math.round(view.seed ?? 0)) >>> 0,
  };

  return {
    scene: { camera, materials, meshes, instances, lights, environment, floor, render, bitmaps },
    // The bitmaps travel with the meshes (an update keeps both): a new image is a new key.
    meshKey: meshKeys.join(';') + (imageKeys.length ? `|images:${imageKeys.join(',')}` : ''),
  };
}

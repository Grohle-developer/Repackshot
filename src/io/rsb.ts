// RSB v1, the engine's binary scene (ARCHITECTURE §5.2), written from TypeScript.
//
// The byte layout and the meaning of every value are those of
// engine/crates/rt-core/src/scene/rsb.rs: `writeRsb` mirrors its reference
// writer (`Scene::to_rsb`) byte for byte, section order and defaults included
// (tests/rsb.test.ts compares against a file written by `rt --write-example`).
// `projectScene` maps a ProjectState onto it: the active camera, a mesh per
// distinct geometry, an instance per visible part, a material per material
// instance, the resolved rig, the environment (dome, sky, flat or HDRI, and the
// background image), the floor, the render settings and the ambient effects
// (S4a: one FXAM section of parameters per effect, with a material of its own
// after the parts' ones). Model space only (Z up, millimetres): no three.js here.

import { evaluate, poseActive, type Pose } from '../core/animation';
import { effectFxam, engineParticleCap, fxamPayload, FXAM_BYTES, type AmbientEffect, type FxamFields } from '../core/effects';
import { instanceFromPreset } from '../core/materials';
import type { EffectMaterial } from '../data/effects';
import { activeCamera, cameraPosition, outputFrameRect, SENSOR_MM, type CameraId, type CameraState } from '../core/camera';
import { kelvinToRgb } from '../core/light-math';
import { isSphereLike, lightFrame, SPOT_DEFAULTS, type LightInstance } from '../core/lighting';
import type { MaterialInstance } from '../core/materials';
import { mat4Compose, mat4Multiply, type Mat4 } from '../core/math';
import { getMesh, type MeshData } from '../core/meshes';
import type { PassIds, PassInstance } from '../core/pass-ids';
import { passMask, type PassKey } from '../core/passes';
import { autoCaustics, causticsFields, isCaster, type CausticsMode, type CausticsQuality } from '../core/caustics';
import { areaLightFlux, EMIT_RADIANCE_PER_WATT, pointLightFlux, SUN_IRRADIANCE_PER_POWER } from '../core/photometry';
import { getImage, gradientPixels, GRADIENT_COLUMNS, GRADIENT_ROWS } from '../core/images';
import { labelFrame, slotMapping, TEXTURE_SLOTS, type MaterialTextures, type TextureSlotKey } from '../core/textures';
import { APERTURE_SIZE, combinePictures, getAperturePicture } from '../core/aperture';
import { isNeutralOptics, type CameraOptics } from '../core/optics';
import type { PupilProfile } from '../data/bokeh';
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
/** M2a (read by the engine from M2b): the texture images, decoded to 8-bit rows (ARCHITECTURE §5.2). */
export const TAG_IMGS = 'IMGS';
/** O1: the camera's optics beyond the plain thin lens (optional, right after CAMR). */
export const TAG_LENS = 'LENS';
/** S4a: an ambient effect's parameters (rt_sim::params; the engine evaluates the particles). */
export const TAG_FXAM = 'FXAM';

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
/** L4: a point light (a sphere of diameter `size_x`; 0 is a point) and a spot (the same, inside a cone). */
export const LIGHT_POINT = 3;
export const LIGHT_SPOT = 4;
/** `LGHT.flags`. */
export const LIGHT_FLAG_GLOSSY = 1;
export const LIGHT_FLAG_CAMERA = 2;
/** L4: the light casts no shadow (its shadow rays are not traced). */
export const LIGHT_FLAG_NO_SHADOW = 4;
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
/** `ENVR.sky_model` (E5c): 0 the physical sky (and what a file without the field means), 1 the classic one. */
export const SKY_MODEL_PHYSICAL = 0;
export const SKY_MODEL_CLASSIC = 1;
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
  /** O1: the LENS section (rt-core `optics::LensParams`); absent or null: none, the plain thin lens. */
  lens?: RsbLens | null;
}

/** `LENS.profile`. */
export const LENS_PROFILE: Readonly<Record<PupilProfile, number>> = { uniform: 0, centreBright: 1, ringBright: 2, apodized: 3 };
/** `LENS.mask_kind`: none, an aperture mask that replaces the iris, a texture multiplied with it. */
export const MASK_NONE = 0;
export const MASK_APERTURE = 1;
export const MASK_TEXTURE = 2;

/** The LENS section, field for field (rt-core `optics::LensParams`). */
export interface RsbLens {
  blades: number;
  roundness: number;
  rotationDeg: number;
  profile: number;
  profileParam: number;
  obstruction: number;
  catsEye: number;
  squeeze: number;
  shiftXMm: number;
  shiftYMm: number;
  tiltDeg: number;
  tiltAxisDeg: number;
  caAmount: number;
  swirl: number;
  /** Image height of the frame's corner on the sensor, mm (0: half the image's diagonal). */
  fieldMm: number;
  maskKind: number;
  maskWidth: number;
  maskHeight: number;
  /** maskWidth × maskHeight bytes, rows top to bottom (empty without a mask). */
  mask: Uint8Array;
}

/** M2a: how a slot reads its image (one of the six of the MATL texture block). */
export interface RsbTextureSlot {
  /** Index into the IMGS images, or -1: no image. */
  image: number;
  projection: number;
  axis: number;
  uvSet: number;
  sizeMm: number;
  rotationDeg: number;
  offset: [number, number];
  repeat: [number, number];
  wrap: number;
  channel: number;
  flags: number;
  strength: number;
  cutoff: number;
}

/** M2a: a label, its frame in the part's own space with the turn applied. */
export interface RsbLabel {
  image: number;
  origin: RsbVec;
  u: RsbVec;
  v: RsbVec;
  normal: RsbVec;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  roughness: number;
  coat: number;
  relief: number;
}

/** M2a: the texture block at the end of a MATL section. */
export interface RsbTextures {
  /** color, roughness, metal, normal, alpha, emission (core/textures.ts TEXTURE_SLOTS). */
  slots: RsbTextureSlot[];
  emissionTint: RsbVec;
  labels: RsbLabel[];
}

/** M2a: a texture image of the IMGS section. */
export interface RsbImage {
  width: number;
  height: number;
  /** 1, 3 or 4 bytes per pixel. */
  channels: number;
  /** IMAGE_SRGB or IMAGE_LINEAR. */
  colorSpace: number;
  /** width × height × channels bytes, rows from the top. */
  data: Uint8Array;
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
  /** M2a: the texture block, written only when the scene carries textures (`RsbScene.textures`). */
  textures?: RsbTextures;
}

export interface RsbMesh {
  positions: ArrayLike<number>;
  /** Empty, or one per position (zero normals: the face normal). */
  normals: ArrayLike<number>;
  indices: ArrayLike<number>;
  materialId: number;
  /** M2a: texture coordinates (2 per vertex), written only when the scene carries textures. */
  uvs?: ArrayLike<number>;
  uvs2?: ArrayLike<number>;
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
  /** E5c: SKY_MODEL_PHYSICAL or SKY_MODEL_CLASSIC. */
  skyModel: number;
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
  /** X2: the exact passes to write next to the image, bit i = PASS_KEYS[i] of core/passes.ts (0: none). */
  passes: number;
  /** E5b-1: what the host hands out, bit 0 the denoised image, bit 1 also the one without denoise (core/caustics.ts). */
  denoise: number;
  /** E5b-1: caustic photons per sample (0: none). */
  causticPhotons: number;
  /** E5b-1: the caustics' first gather radius in pixels at the camera's target distance (0: the engine's 3). */
  causticRadius: number;
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
  /**
   * M2a: the scene carries textures: the IMGS section, the MATL texture blocks and the meshes' UVs. Off (absent),
   * the file is byte for byte what it was before M2a; M2b turns it on when the engine reads them.
   */
  textures?: boolean;
  /** M2a: the texture images (IMGS), referred to by index from the materials' slots and labels. */
  images?: RsbImage[];
  /** S4a: the ambient effects (FXAM), each referring to its material by index. */
  effects?: RsbEffect[];
}

/** S4a: an ambient effect, the fields of `FXAM` (core/effects.ts `effectFxam`). */
export type RsbEffect = FxamFields;

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
    skyModel: SKY_MODEL_PHYSICAL,
  };
}

export function defaultFloor(): RsbFloor {
  return { mode: FLOOR_NONE, z: 0, color: [0.5, 0.5, 0.5] };
}

export function defaultRender(): RsbRender {
  return { width: 640, height: 360, maxSamples: 64, seed: 0, maxSeconds: 0, exposureEv: 0, tonemap: TONEMAP_ACES, maxDepth: DEFAULT_MAX_DEPTH, clampIndirect: 0, passes: 0, denoise: 0, causticPhotons: 0, causticRadius: 0 };
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
/** LENS without its picture: 15 numbers before the picture's three words. */
const LENS_BYTES = 72;
const MATL_BYTES = 72;
/**
 * M2a: where the texture block of a MATL starts: after E6's `bevel_mm` (72) and E9's `scatter_mm scatter_color[3]
 * scatter_g abbe` (76 to 100). Until those phases write their fields the writer fills them with zeros (no bevel,
 * no medium, no dispersion), which only happens once the engine reads textures (M2b, after E6 and E9).
 */
export const MATL_TEXTURE_OFFSET = 100;
/** M2a: version of the texture block (its first word). */
export const TEXTURE_BLOCK_VERSION = 1;
/** Words of one slot of the texture block. */
const TEXTURE_SLOT_WORDS = 15;
/** Words of one label. */
const LABEL_WORDS = 19;
/** `IMGS` colour spaces. */
export const IMAGE_SRGB = 0;
export const IMAGE_LINEAR = 1;
/** Texture slot `projection`, `axis`, `wrap`, `channel` and `flags` codes. */
export const PROJECTION_CODES = { UV: 0, BOX: 1, PLANAR: 2, CYLINDRICAL: 3, SPHERICAL: 4 } as const;
export const AXIS_CODES = { X: 0, Y: 1, Z: 2 } as const;
export const WRAP_CODES = { REPEAT: 0, CLAMP: 1, MIRROR: 2 } as const;
export const CHANNEL_CODES = { R: 0, G: 1, B: 2, A: 3, L: 4 } as const;
export const SLOT_FLAG_INVERT = 1;
export const SLOT_FLAG_CUTOUT = 2;
export const SLOT_FLAG_HEIGHT = 4;

/** A MATL payload: the fields of E5, and with a texture block the padding to it and the block. */
function materialBytes(m: RsbMaterial): number {
  if (!m.textures) return MATL_BYTES;
  return MATL_TEXTURE_OFFSET + 4 * (1 + 6 * TEXTURE_SLOT_WORDS + 3 + 1 + m.textures.labels.length * LABEL_WORDS);
}

/** An IMGS payload: the count, then per image four words and its rows, each padded to four bytes. */
function imagesBytes(images: readonly RsbImage[]): number {
  let n = 4;
  for (const im of images) n += 16 + im.data.length + ((4 - (im.data.length % 4)) % 4);
  return n;
}
const LGHT_BYTES = 76;
const ENVR_BYTES = 84;
const FLOR_BYTES = 20;
const RNDR_BYTES = 52;
const INST_BYTES = 60;

function meshBytes(m: RsbMesh, uvs = false): number {
  const n = m.positions.length / 3;
  const base = 4 * (2 + n * 6 + m.indices.length + 1);
  if (!uvs) return base;
  // M2a: u32 uv_sets, then each set's 2n floats.
  const sets = m.uvs && m.uvs.length === 2 * n ? (m.uvs2 && m.uvs2.length === 2 * n ? 2 : 1) : 0;
  return base + 4 + sets * 8 * n;
}

/** A BMAP payload: four words, the data, zero padding to a multiple of four. */
function bitmapBytes(b: RsbBitmap): number {
  return 16 + b.data.length + ((4 - (b.data.length % 4)) % 4);
}

/** A LENS payload: the numbers, the picture, zero padding to a multiple of four. */
function lensBytes(l: RsbLens): number {
  return LENS_BYTES + l.mask.length + ((4 - (l.mask.length % 4)) % 4);
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

/** M2a: the texture block of a MATL, from MATL_TEXTURE_OFFSET (the fields between E5's and it are zeros until E6 and E9 write theirs). */
function writeTextureBlock(w: ByteWriter, t: RsbTextures): void {
  w.pad(MATL_TEXTURE_OFFSET - MATL_BYTES);
  w.u32(TEXTURE_BLOCK_VERSION);
  for (let k = 0; k < 6; k++) {
    const s = t.slots[k] ?? noTextureSlot();
    w.u32(s.image < 0 ? 0xffffffff : s.image);
    w.u32(s.projection);
    w.u32(s.axis);
    w.u32(s.uvSet);
    w.f32(s.sizeMm);
    w.f32(s.rotationDeg);
    w.f32(s.offset[0]);
    w.f32(s.offset[1]);
    w.f32(s.repeat[0]);
    w.f32(s.repeat[1]);
    w.u32(s.wrap);
    w.u32(s.channel);
    w.u32(s.flags);
    w.f32(s.strength);
    w.f32(s.cutoff);
  }
  w.vec(t.emissionTint);
  w.u32(t.labels.length);
  for (const l of t.labels) {
    w.u32(l.image < 0 ? 0xffffffff : l.image);
    w.vec(l.origin);
    w.vec(l.u);
    w.vec(l.v);
    w.vec(l.normal);
    w.f32(l.widthMm);
    w.f32(l.heightMm);
    w.f32(l.depthMm);
    w.f32(l.roughness);
    w.f32(l.coat);
    w.f32(l.relief);
  }
}

/** A slot without an image (what an empty slot of the texture block holds). */
export function noTextureSlot(): RsbTextureSlot {
  return { image: -1, projection: 0, axis: 2, uvSet: 0, sizeMm: 100, rotationDeg: 0, offset: [0, 0], repeat: [1, 1], wrap: 0, channel: 0, flags: 0, strength: 1, cutoff: 0.5 };
}

/** Serialises a scene exactly as rt-core's `Scene::to_rsb` does. */
export function writeRsb(scene: RsbScene, opts: WriteOptions = {}): Uint8Array {
  const withMeshes = opts.meshes !== false;
  const implicit = implicitInstances(scene.meshes);
  const given = scene.instances ?? implicit;
  // rt-core writes INST only when the instances differ from the implicit ones; an update without
  // meshes always carries them, so the engine never pairs kept meshes with stale materials.
  const instances = !withMeshes || !sameInstances(given, implicit) ? given : null;

  const tex = scene.textures === true;
  const images = tex ? (scene.images ?? []) : [];
  const effects = scene.effects ?? [];
  let size = 8 + 8 + CAMR_BYTES + scene.lights.length * (8 + LGHT_BYTES) + effects.length * (8 + FXAM_BYTES);
  for (const m of scene.materials) size += 8 + (tex ? materialBytes(m) : MATL_BYTES);
  const lens = scene.camera.lens ?? null;
  if (lens) size += 8 + lensBytes(lens);
  size += 8 + ENVR_BYTES + 8 + FLOR_BYTES + 8 + RNDR_BYTES;
  if (withMeshes) for (const m of scene.meshes) size += 8 + meshBytes(m, tex);
  if (withMeshes) for (const b of scene.bitmaps) size += 8 + bitmapBytes(b);
  if (withMeshes && images.length > 0) size += 8 + imagesBytes(images);
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
  if (lens) {
    w.section(TAG_LENS, lensBytes(lens), () => {
      w.u32(lens.blades);
      w.f32(lens.roundness);
      w.f32(lens.rotationDeg);
      w.u32(lens.profile);
      for (const v of [lens.profileParam, lens.obstruction, lens.catsEye, lens.squeeze, lens.shiftXMm, lens.shiftYMm, lens.tiltDeg, lens.tiltAxisDeg, lens.caAmount, lens.swirl, lens.fieldMm]) w.f32(v);
      w.u32(lens.maskKind);
      w.u32(lens.maskWidth);
      w.u32(lens.maskHeight);
      w.raw(lens.mask);
      w.pad((4 - (lens.mask.length % 4)) % 4);
    });
  }
  for (const m of scene.materials) {
    const t = tex ? m.textures : undefined;
    w.section(TAG_MATL, t ? materialBytes(m) : MATL_BYTES, () => {
      w.u32(m.kind);
      w.vec(m.baseColor);
      for (const v of [m.metallic, m.roughness, m.ior, m.transmission, m.coat, m.coatRoughness]) w.f32(v);
      w.vec(m.emission);
      w.f32(m.emissionPower);
      w.u32(m.flags);
      w.f32(m.opacity);
      w.f32(m.anisotropy);
      w.f32(m.absorptionMm);
      if (t) writeTextureBlock(w, t);
    });
  }
  if (withMeshes) {
    for (const mesh of scene.meshes) {
      w.section(TAG_MESH, meshBytes(mesh, tex), () => {
        const n = mesh.positions.length / 3;
        w.u32(n);
        w.u32(mesh.indices.length);
        for (let i = 0; i < n * 3; i++) w.f32(mesh.positions[i]);
        if (mesh.normals.length === n * 3) for (let i = 0; i < n * 3; i++) w.f32(mesh.normals[i]);
        else for (let i = 0; i < n * 3; i++) w.f32(0);
        for (let i = 0; i < mesh.indices.length; i++) w.u32(mesh.indices[i]);
        w.u32(mesh.materialId);
        if (tex) {
          const sets = mesh.uvs && mesh.uvs.length === 2 * n ? (mesh.uvs2 && mesh.uvs2.length === 2 * n ? 2 : 1) : 0;
          w.u32(sets);
          if (sets >= 1) for (let i = 0; i < 2 * n; i++) w.f32(mesh.uvs![i]);
          if (sets >= 2) for (let i = 0; i < 2 * n; i++) w.f32(mesh.uvs2![i]);
        }
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
  for (const e of effects) w.section(TAG_FXAM, FXAM_BYTES, () => w.raw(fxamPayload(e)));
  if (withMeshes && images.length > 0) {
    w.section(TAG_IMGS, imagesBytes(images), () => {
      w.u32(images.length);
      for (const im of images) {
        w.u32(im.width);
        w.u32(im.height);
        w.u32(im.channels);
        w.u32(im.colorSpace);
        w.raw(im.data);
        w.pad((4 - (im.data.length % 4)) % 4);
      }
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
    w.u32(e.skyModel);
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
    w.u32(r.passes);
    w.u32(r.denoise);
    w.u32(r.causticPhotons);
    w.f32(r.causticRadius);
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
  /** `RNDR.passes`: the exact passes the engine writes next to the image (AI-POST.md §7.4; default none). */
  passes?: readonly PassKey[];
  /** E5b-1, `RNDR.denoise` (core/caustics.ts `denoiseBits`; default 0). */
  denoise?: number;
  /** E5b-1: the caustics switch and quality; Automatic is decided here, from the scene (core/caustics.ts). Default off. */
  caustics?: { mode: CausticsMode; quality: CausticsQuality };
  /**
   * M2a: write the textures (IMGS, the MATL texture blocks, the meshes' UVs) for an engine that reads them (M2b
   * turns it on from the engine's own word). Off by default: the bytes are those of before M2a.
   */
  textures?: boolean;
  /** S4a: the engine's particle cap (default: core/effects.ts `engineParticleCap`, what Settings say here). */
  particleCap?: number;
}

/** A scene and the identity of its geometry: an equal `meshKey` means the same MESH sections. */
export interface ProjectScene {
  scene: RsbScene;
  meshKey: string;
  /**
   * What each instance of `scene.instances` was made from, in the same order: the ids of the passes
   * (`partId` is the index + 1, `materialId` the RSB material index + 1; AI-POST.md §7.4). The Fast-mode
   * preview draws the same numbers (render/preview-passes.ts) from it.
   */
  ids: PassIds;
  /**
   * The project material of every RSB material, in RSB order (`materialId` `i + 1` is `materialOrder[i]`; null:
   * the neutral material of a part without one). What the AI guard's table is made from (`guardMaterials`).
   */
  materialOrder: (string | null)[];
}

/** An axis-aligned box. */
interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

const localBounds = new WeakMap<RsbMesh, Bounds | null>();

/** The box of a mesh's positions (cached per mesh). */
function meshBounds(m: RsbMesh): Bounds | null {
  if (localBounds.has(m)) return localBounds.get(m)!;
  const p = m.positions;
  let b: Bounds | null = null;
  for (let i = 0; i + 2 < p.length; i += 3) {
    if (!b) b = { min: [p[i], p[i + 1], p[i + 2]], max: [p[i], p[i + 1], p[i + 2]] };
    for (let k = 0; k < 3; k++) {
      b.min[k] = Math.min(b.min[k], p[i + k]);
      b.max[k] = Math.max(b.max[k], p[i + k]);
    }
  }
  localBounds.set(m, b);
  return b;
}

/** `into` grown by the box `b` moved by the 3 × 4 rows of an instance (its eight corners). */
function extendBounds(into: Bounds | null, b: Bounds | null, rows: readonly number[]): Bounds | null {
  if (!b) return into;
  let out = into;
  for (let c = 0; c < 8; c++) {
    const v = [c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]];
    const w: [number, number, number] = [0, 0, 0];
    for (let r = 0; r < 3; r++) w[r] = rows[r * 4] * v[0] + rows[r * 4 + 1] * v[1] + rows[r * 4 + 2] * v[2] + rows[r * 4 + 3];
    if (!out) out = { min: [...w], max: [...w] };
    else
      for (let k = 0; k < 3; k++) {
        out.min[k] = Math.min(out.min[k], w[k]);
        out.max[k] = Math.max(out.max[k], w[k]);
      }
  }
  return out;
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

/** S4a: an effect's own material (data/effects.ts) as the engine's. */
export function effectMaterialToRsb(m: EffectMaterial): RsbMaterial {
  const out = defaultMaterial();
  out.kind = m.kind === 'GLASS' ? MATERIAL_GLASS : MATERIAL_PRINCIPLED;
  out.baseColor = [m.baseColor[0], m.baseColor[1], m.baseColor[2]];
  out.roughness = clamp01(m.roughness);
  out.ior = Math.max(1, m.ior);
  out.transmission = clamp01(m.transmission);
  out.absorptionMm = Math.max(0, m.absorptionMm);
  out.flags = m.thin ? MATERIAL_FLAG_THIN : 0;
  return out;
}

/** S4a: the material an effect renders with: a catalogue material by key, or its own. */
export function effectMaterial(state: ProjectState, e: AmbientEffect): RsbMaterial {
  const inst = e.material ? instanceFromPreset(`fx:${e.id}`, e.material, state.scene.partSizeMm) : null;
  return inst ? materialToRsb(inst) : effectMaterialToRsb(e.ownMaterial);
}

/**
 * One light of the resolved rig: placed like the preview places it (`lightFrame`: around the rig pivot, aimed at
 * it or at its own aim, turned by its roll), its power converted to the engine's units. Rect / disk (an ellipse is
 * the disk of the same area: the engine has no ellipse) with `areaLightFlux`; a sun's power is its irradiance;
 * a point, and an area light of shape SPHERE, are kind 3 (a glowing sphere of diameter `size_x`) and a spot kind 4
 * (the same inside a cone of `spread_deg` with a soft edge of `angle_deg`), both with `pointLightFlux` (L4).
 * `LightInstance.angle` and `angle_deg` of a sun are both degrees (0.545 is the real sun's angular diameter, as
 * in EZ Packshot's recipes). A light that casts no shadow has LIGHT_FLAG_NO_SHADOW.
 */
export function lightToRsb(state: ProjectState, l: LightInstance): RsbLight {
  const size = state.scene.partSizeMm || 1;
  const frame = lightFrame(state, l);
  const pos = frame.position;
  const dir = frame.forward;
  // Without a roll the engine squares the world's Z to the axis itself (what every file before L4 says); a light
  // straight up or down, or turned, gets its own up.
  const up: RsbVec = !l.roll && Math.abs(dir[2]) < 0.9999 ? [0, 0, 1] : [frame.up[0], frame.up[1], frame.up[2]];
  const flags = (l.glossy ? LIGHT_FLAG_GLOSSY : 0) | (l.camera ? LIGHT_FLAG_CAMERA : 0) | (l.shadow === false ? LIGHT_FLAG_NO_SHADOW : 0);
  const color: RsbVec = [l.color[0], l.color[1], l.color[2]];
  if (l.type === 'SUN') {
    return { ...defaultLight(), kind: LIGHT_SUN, position: pos, direction: dir, up, color, power: Math.max(0, l.power) * SUN_IRRADIANCE_PER_POWER, spreadDeg: 180, angleDeg: Math.max(0, l.angle), flags };
  }
  if (isSphereLike(l)) {
    const diameter = Math.max(0, l.size) * size;
    const spot = l.type === 'SPOT';
    const cone = Math.min(179, Math.max(1, l.spread));
    return {
      kind: spot ? LIGHT_SPOT : LIGHT_POINT,
      position: pos,
      direction: dir,
      up,
      sizeX: diameter,
      sizeY: diameter,
      color,
      power: pointLightFlux(Math.max(0, l.power), state.scene.partSizeMm),
      spreadDeg: spot ? cone : 180,
      // A spot's soft edge in degrees, inward from the edge of its cone.
      angleDeg: spot ? (Math.min(1, Math.max(0, l.blend ?? SPOT_DEFAULTS.blend)) * cone) / 2 : 0,
      flags,
    };
  }
  const w = Math.max(1e-3, l.size) * size;
  const h = Math.max(1e-3, l.shape === 'SQUARE' || l.shape === 'DISK' ? l.size : l.sizeY) * size;
  const disk = l.shape === 'DISK' || l.shape === 'ELLIPSE';
  const sizeX = l.shape === 'ELLIPSE' ? Math.sqrt(w * h) : w;
  return {
    kind: disk ? LIGHT_DISK : LIGHT_RECT,
    position: pos,
    direction: dir,
    up,
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
  const ortho = cam.projection === 'ORTHOGRAPHIC';
  const lens = !ortho && cam.optics && !isNeutralOptics(cam.optics) ? lensToRsb(cam.optics, outW, outH) : null;
  return {
    position: cameraPosition(cam),
    target: [cam.target[0], cam.target[1], cam.target[2]],
    up: [0, 0, 1],
    focalMm: Math.max(1, cam.focalMm),
    sensorMm,
    fstop: Math.max(0, cam.fstop),
    focusDist: Math.max(0, cam.focusDistance),
    ortho,
    orthoWidth: Math.max(1e-3, orthoWidth),
    ...(lens ? { lens } : {}),
  };
}

/** Half the diagonal of the output frame on the reference sensor (36 mm along its longer side), mm. */
export function frameFieldMm(outW: number, outH: number): number {
  const aspect = outW > 0 && outH > 0 ? outW / outH : 16 / 9;
  const [w, h] = aspect >= 1 ? [SENSOR_MM, SENSOR_MM / aspect] : [SENSOR_MM * aspect, SENSOR_MM];
  return Math.hypot(w, h) / 2;
}

/**
 * The LENS section of a camera's optics (O1) for an output frame of `outW × outH`: the field effects (cat's eye,
 * swirl, chromatic aberration) grow towards the frame's corner whatever part of the viewport the image covers. The
 * pictures come from core/aperture.ts; one that has not been read yet is left out (the iris draws the shape) until
 * it arrives. The onion-ring texture is a modulation the camera's amplitude scales; the others apply as they are.
 */
export function lensToRsb(o: CameraOptics, outW: number, outH: number): RsbLens {
  const mask = o.mask ? (getAperturePicture(o.mask) ?? null) : null;
  const texture = o.texture ? (getAperturePicture(o.texture) ?? null) : null;
  const amount = o.texture === 'onion_rings' ? o.onionAmplitude : 1;
  const picture = mask || texture ? combinePictures(mask, texture, amount) : null;
  const kind = mask ? MASK_APERTURE : texture ? MASK_TEXTURE : MASK_NONE;
  const blades = o.blades >= 3 ? Math.min(18, Math.round(o.blades)) : 0;
  const unit = (v: number) => Math.min(1, Math.max(0, v));
  return {
    blades,
    roundness: unit(o.roundness),
    rotationDeg: o.rotationDeg,
    profile: LENS_PROFILE[o.profile] ?? 0,
    profileParam: unit(o.profileParam),
    obstruction: Math.min(0.95, Math.max(0, o.obstruction)),
    catsEye: unit(o.catsEye),
    squeeze: Math.min(4, Math.max(1, o.squeeze)),
    shiftXMm: o.shiftXMm,
    shiftYMm: o.shiftYMm,
    tiltDeg: Math.min(45, Math.max(-45, o.tiltDeg)),
    tiltAxisDeg: o.tiltAxisDeg,
    caAmount: unit(o.caAmount),
    swirl: unit(o.swirl),
    fieldMm: frameFieldMm(outW, outH),
    maskKind: kind,
    maskWidth: picture ? APERTURE_SIZE : 0,
    maskHeight: picture ? APERTURE_SIZE : 0,
    mask: picture ?? new Uint8Array(0),
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
  const uvs = data.uvs ? new Float32Array(remap.size * 2) : undefined;
  const uvs2 = data.uvs && data.uvs2 ? new Float32Array(remap.size * 2) : undefined;
  for (const [v, r] of remap) {
    positions.set(data.positions.subarray(v * 3, v * 3 + 3), r * 3);
    if (!flat) normals.set(data.normals.subarray(v * 3, v * 3 + 3), r * 3);
    if (uvs && data.uvs) uvs.set(data.uvs.subarray(v * 2, v * 2 + 2), r * 2);
    if (uvs2 && data.uvs2) uvs2.set(data.uvs2.subarray(v * 2, v * 2 + 2), r * 2);
  }
  return { positions, normals, indices, materialId: 0, ...(uvs ? { uvs } : {}), ...(uvs2 ? { uvs2 } : {}) };
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
      mesh = { positions: data.positions, normals: flat ? new Float32Array(0) : data.normals, indices: data.indices, materialId: 0, ...(data.uvs ? { uvs: data.uvs } : {}), ...(data.uvs2 ? { uvs2: data.uvs2 } : {}) };
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

/** RGBA rows as rows of `channels` bytes per pixel (1: the red, a grey image's value; 3: RGB; 4: as they are). */
export function channelsOf(rgba: Uint8Array, channels: number): Uint8Array {
  if (channels === 4) return rgba;
  const n = rgba.length / 4;
  const out = new Uint8Array(n * channels);
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[i * channels + c] = rgba[4 * i + c];
  return out;
}

/** The slots whose image is colour (decoded from sRGB by the engine); the others are data. */
const SRGB_SLOTS: readonly TextureSlotKey[] = ['color', 'emission'];

/**
 * M2a: a material's textures as its MATL texture block: every slot with the mapping it uses (its own or the
 * shared one) and its image's index (`imageFor`, which may say -1: not decoded), the labels with their frames.
 */
export function texturesToRsb(t: MaterialTextures, imageFor: (id: string, colorSpace: number) => number): RsbTextures {
  const slots = TEXTURE_SLOTS.map((k): RsbTextureSlot => {
    const s = t[k];
    if (!s) return noTextureSlot();
    const m = slotMapping(t, k);
    return {
      image: imageFor(s.image.id, SRGB_SLOTS.includes(k) ? IMAGE_SRGB : IMAGE_LINEAR),
      projection: PROJECTION_CODES[m.projection],
      axis: AXIS_CODES[m.axis],
      uvSet: m.uvSet,
      sizeMm: m.sizeMm,
      rotationDeg: m.rotationDeg,
      offset: [m.offset[0], m.offset[1]],
      repeat: [m.repeat[0], m.repeat[1]],
      wrap: WRAP_CODES[m.wrap],
      channel: CHANNEL_CODES[s.channel],
      flags: (s.invert ? SLOT_FLAG_INVERT : 0) | (s.cutout ? SLOT_FLAG_CUTOUT : 0) | (s.height ? SLOT_FLAG_HEIGHT : 0),
      strength: s.strength,
      cutoff: s.cutoff,
    };
  });
  const tint = t.emission?.tint ?? [1, 1, 1];
  const labels = t.labels.map((l): RsbLabel => {
    const f = labelFrame(l, l.image.width / l.image.height);
    return { image: imageFor(l.image.id, IMAGE_SRGB), origin: f.origin, u: f.u, v: f.v, normal: f.normal, widthMm: f.width, heightMm: f.height, depthMm: f.depth, roughness: l.roughness, coat: l.coat, relief: l.relief };
  });
  return { slots, emissionTint: [tint[0], tint[1], tint[2]], labels };
}

/** The pose the preview shows: the playhead's, when clips exist and the playhead moved (or a reversed clip holds its end). */
export function currentPose(state: ProjectState): Pose | null {
  return poseActive(state) ? evaluate(state, state.animation.playhead) : null;
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
  // The frame of a viewport image is the image of the camera on screen, with its ratio (U13).
  const frame = chosen.aspect;
  const camera = cameraToRsb(cam, frame.w, frame.h, width, height, view.viewport);

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
  const materialOrder: (string | null)[] = [];
  const materialIndex = new Map<string | null, number>();
  // M2a: the texture images in IMGS order, one per image and colour space, when the scene carries textures.
  const images: RsbImage[] = [];
  const imageIds: string[] = [];
  const imageIndex = new Map<string, number>();
  const imageFor = (id: string, colorSpace: number): number => {
    const key = `${id}|${colorSpace}`;
    let i = imageIndex.get(key);
    if (i === undefined) {
      const im = getImage(id);
      const channels = im?.channels ?? 4;
      // The pixels are decoded before the scene is written (io/texture-pixels.ts); without them the slot is empty.
      i = im?.rgba8 ? images.push({ width: im.width, height: im.height, channels, colorSpace, data: channelsOf(im.rgba8, channels) }) - 1 : -1;
      imageIndex.set(key, i);
      if (i >= 0) imageIds.push(key);
    }
    return i;
  };
  const materialFor = (id: string | null): number => {
    const key = id && state.materials[id] ? id : null;
    let i = materialIndex.get(key);
    if (i === undefined) {
      const m = materialToRsb(key ? state.materials[key] : null);
      if (view.textures && key) m.textures = texturesToRsb(state.materials[key].textures, imageFor);
      i = materials.push(m) - 1;
      materialOrder.push(key);
      materialIndex.set(key, i);
    }
    return i;
  };

  const meshes: RsbMesh[] = [];
  const meshKeys: string[] = [];
  const meshIndex = new Map<string, number>();
  const instances: RsbInstance[] = [];
  const passInstances: PassInstance[] = [];
  let casterBounds: Bounds | null = null;
  let litEmitter = false;
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
      passInstances.push({ node: id, material: part.material, materialId: materialId + 1 });
      // Automatic caustics: where the glass and polished metal are (E5b-1).
      if (view.caustics?.mode === 'AUTO') {
        const m = materials[materialId];
        if (isCaster(m)) casterBounds = extendBounds(casterBounds, meshBounds(meshes[mi]), rows);
        if (m.kind === MATERIAL_EMISSIVE && m.flags & MATERIAL_FLAG_LIGHT) litEmitter = true;
      }
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

  // S4a: the ambient effects, each with a material of its own after the parts' (its passes' materialId).
  const cap = view.particleCap ?? engineParticleCap();
  const effects: RsbEffect[] = [];
  for (const e of state.effects) {
    if (!e.enabled) continue;
    const materialId = materials.push(effectMaterial(state, e)) - 1;
    materialOrder.push(null);
    effects.push(effectFxam(state, e, materialId, cap));
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
  // L6: a GRADIENT background is an image made from its two colours, stretched over the output frame.
  const gradient = !view.transparent && env.background === 'GRADIENT' ? gradientPixels(env.gradient.top, env.gradient.bottom) : null;
  const backplateMap = plate?.rgba8
    ? bitmaps.push({ format: BITMAP_RGBA8, width: plate.width, height: plate.height, data: plate.rgba8 }) - 1
    : gradient
      ? bitmaps.push({ format: BITMAP_RGBA8, width: GRADIENT_COLUMNS, height: GRADIENT_ROWS, data: gradient }) - 1
      : NO_BITMAP;
  if (backplateMap !== NO_BITMAP) imageKeys.push(gradient ? `gradient:${[...env.gradient.top, ...env.gradient.bottom].join(',')}` : env.backplate!.id);
  // Without a sun light the sky's sun is the environment's own, placed like a light (camera-relative).
  const sun = toSun ?? polar(toWorldAzimuth(env.skySun.az), env.skySun.el, 1);
  const sunLength = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  // The output frame inside a viewport image: the background image fits it.
  let backplateRect: [number, number, number, number] = [0, 0, 1, 1];
  if (view.viewport && view.viewport.viewW > 0 && view.viewport.viewH > 0) {
    const f = outputFrameRect(view.viewport.viewW, view.viewport.viewH, frame.w, frame.h);
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
          : env.background === 'BACKPLATE' || env.background === 'GRADIENT'
            ? BACKGROUND_BACKPLATE
            : BACKGROUND_ENVIRONMENT,
    hdriMap,
    backplateMap,
    backplateFit: gradient || env.backplateFit === 'STRETCH' ? BACKPLATE_STRETCH : env.backplateFit === 'FIT' ? BACKPLATE_FIT : BACKPLATE_FILL,
    // Each model clamps the turbidity to its own range (the physical sky 1 to 10, the classic one 1.7 to 10).
    skyTurbidity: Number.isFinite(env.skyTurbidity) ? Math.min(10, Math.max(1, env.skyTurbidity)) : DEFAULT_TURBIDITY,
    skyModel: env.skyModel === 'CLASSIC' ? SKY_MODEL_CLASSIC : SKY_MODEL_PHYSICAL,
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
    passes: passMask(view.passes ?? []),
    denoise: Math.max(0, Math.round(view.denoise ?? 0)) >>> 0,
  };
  if (view.caustics) {
    const centre: [number, number, number] | null = casterBounds
      ? [(casterBounds.min[0] + casterBounds.max[0]) / 2, (casterBounds.min[1] + casterBounds.max[1]) / 2, (casterBounds.min[2] + casterBounds.max[2]) / 2]
      : null;
    const auto =
      view.caustics.mode === 'AUTO' &&
      autoCaustics(
        centre,
        lights.map((l) => ({ kind: l.kind, position: l.position, sizeX: l.sizeX, sizeY: l.sizeY, angleDeg: l.angleDeg, glossy: (l.flags & LIGHT_FLAG_GLOSSY) !== 0 })),
        litEmitter,
      );
    const c = causticsFields(view.caustics.mode, view.caustics.quality, auto);
    render.causticPhotons = c.photons;
    render.causticRadius = c.radiusPx;
  }

  return {
    scene: { camera, materials, meshes, instances, lights, environment, floor, render, bitmaps, ...(view.textures ? { textures: true, images } : {}), ...(effects.length > 0 ? { effects } : {}) },
    // The bitmaps travel with the meshes (an update keeps both): a new image is a new key. With textures (M2a) the
    // meshes carry their UVs and IMGS travels with them too.
    meshKey: meshKeys.join(';') + (imageKeys.length ? `|images:${imageKeys.join(',')}` : '') + (view.textures ? `|textures:${imageIds.join(',')}` : ''),
    ids: {
      instances: passInstances,
      floor:
        floor.mode === FLOOR_NONE
          ? null
          : { z: floor.z, albedo: [floor.color[0], floor.color[1], floor.color[2]], camera: { position: camera.position, target: camera.target, up: camera.up, focalMm: camera.focalMm, sensorMm: camera.sensorMm, ortho: camera.ortho, orthoWidth: camera.orthoWidth } },
    },
    materialOrder,
  };
}

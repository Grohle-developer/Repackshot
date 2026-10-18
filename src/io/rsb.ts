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

import { fabricRecipe, PATN_PARAMS, seedOf, woodRecipe } from '../core/pattern-recipe';
import { playheadPose, posedMaterial, type Pose } from '../core/animation';
import { partIsExempt, resolveSection } from '../core/section';
import { effectFxam, engineParticleCap, fxamPayload, type AmbientEffect, type FxamFields } from '../core/effects';
import { instanceFromPreset } from '../core/materials';
import type { EffectMaterial } from '../data/effects';
import { flattenGraph } from '../core/material-preview';
import { compileGraph, encodeProgram, OUTPUT_KEYS, type Program } from '../core/material-program';
import type { MaterialGraph } from '../core/material-graph';
import { activeCamera, cameraPosition, isPanoramic, outputFrameRect, SENSOR_MM, type CameraId, type CameraState } from '../core/camera';
import { exteriorOf, renderedCamera } from '../core/interior-camera';
import { panoramaFov, projectionCode } from '../core/panorama';
import type { CameraAspect } from '../core/aspect';
import { kelvinToRgb } from '../core/light-math';
import { iesBytesOf, iesProfileOf, iesSpot } from '../core/ies';
import { isSphereLike, lightFrame, SPOT_DEFAULTS, type LightInstance } from '../core/lighting';
import { fabricMeanColor, type MaterialInstance } from '../core/materials';
import { mat4Compose, mat4Multiply, type Mat4 } from '../core/math';
import { getMesh, type MeshData } from '../core/meshes';
import type { PassIds, PassInstance } from '../core/pass-ids';
import { passMask, type PassKey } from '../core/passes';
import { autoCaustics, causticsFields, isCaster, type CausticsMode, type CausticsQuality } from '../core/caustics';
import { areaLightFlux, EMIT_RADIANCE_PER_WATT, pointLightFlux, SUN_IRRADIANCE_PER_POWER } from '../core/photometry';
import { getImage, gradientPixels, GRADIENT_COLUMNS, GRADIENT_ROWS } from '../core/images';
import { labelFrame, slotMapping, TEXTURE_SLOTS, type MaterialTextures, type TextureSlotKey } from '../core/textures';
import { APERTURE_SIZE, combinePictures, getAperturePicture } from '../core/aperture';
import { filtersOf, frontGlassOf, glassFromScene, isNeutralOptics, type CameraOptics, type FrontGlass, type LensFilter } from '../core/optics';
import { paneAxes, recordedGlass, type GlassFrame, type PaneAxes } from '../core/wet';
import { FRONT_GLASS_FIXED } from '../data/front-glass';
import { resolvedFocusDistance } from '../core/focus';
import type { PupilProfile } from '../data/bokeh';
import { lensFilterType } from '../data/lens-filters';
import type { CoatingId, LensSurface } from '../data/lenses';
import { composeLens, tracedLensTilts, type ComposedLens, type TracedLens } from '../core/traced-lens';
import { polar, toWorldAzimuth } from '../core/light-math';
import { allParts, hiddenToCamera, localMatrix, type NodeId, type SceneNode } from '../core/scene';
import type { ProjectState } from '../core/store';
import { QUALITY_PRESETS } from '../data/quality';
import { DOME_FLOOR, DOME_HORIZON, DOME_ZENITH } from '../data/environment';

// ------------------------------------------------------------------ format

export const RSB_MAGIC = 'RSB1';
export const TAG_CAMR = 'CAMR';
export const TAG_MESH = 'MESH';
export const TAG_MATL = 'MATL';
export const TAG_PATN = 'PATN';
export const TAG_LGHT = 'LGHT';
export const TAG_ENVR = 'ENVR';
export const TAG_FLOR = 'FLOR';
export const TAG_RNDR = 'RNDR';
export const TAG_INST = 'INST';
export const TAG_BMAP = 'BMAP';
/** M2a (read by the engine from M2b): the texture images, decoded to 8-bit rows (ARCHITECTURE §5.2). */
export const TAG_IMGS = 'IMGS';
/**
 * M3b: a material's program (the compiled graph of a node material, core/material-program.ts `encodeProgram`, its
 * images as IMGS indices), for an engine that runs them (render/engine.ts `readsPrograms`). Written last.
 */
export const TAG_PROG = 'PROG';
/** O1: the camera's optics beyond the plain thin lens (optional, right after CAMR). */
export const TAG_LENS = 'LENS';
/** S4a: an ambient effect's parameters (rt_sim::params; the engine evaluates the particles). */
export const TAG_FXAM = 'FXAM';
/** Q1: the section view's plane (written after the FXAM sections; absent without a section). */
export const TAG_SECT = 'SECT';
/** `INST.flags` bit 1: the section view does not cut this instance (the studio, not the model). Written only with a section. */
export const INSTANCE_NO_SECTION = 2;
/** `INST.flags` bit 2 (K3): the camera does not see this instance; everything else does (rt-core `INSTANCE_NO_CAMERA`). */
export const INSTANCE_NO_CAMERA = 4;
/** `SECT.flags` bit 0: the cut solids are capped. */
export const SECTION_CAP = 1;
/** Bytes of a `SECT` payload: `u32 flags; f32 normal[3] distance`. */
export const SECT_BYTES = 20;
/**
 * L5: an IES photometric profile, the file's text (`u32 byte_len`, the bytes, zero padding to 4), once for each distinct profile
 * the IES lights use, after the LGHT sections; an LGHT of kind 5 names its profile by position among them.
 */
export const TAG_IESP = 'IESP';

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
/**
 * L5: an IES light: the point light of `power` watts and diameter `size_x` whose intensity follows the profile of the IESP
 * section named by the 80th byte of its LGHT (the light's `direction` is the profile's axis, `up` its horizontal angle 0).
 */
export const LIGHT_IES = 5;
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
  /**
   * K3, the end of CAMR (rt-core `Camera::projection`, `fov_x_deg`, `fov_y_deg`, `exterior`; core/panorama.ts): the
   * projection (0 the camera of `ortho`, 1 equirectangular, 2 fisheye), its fields of view across the image's width and
   * height in degrees, and the exterior factor of the camera ray. Absent: 0, 360, 180 and 1, and then the 16 bytes are
   * not written, as before K3.
   */
  projection?: number;
  fovXDeg?: number;
  fovYDeg?: number;
  exterior?: number;
  /** S3: the front glass (GLAS, written right after LENS; rt-core `optics::glass::GlassParams`); absent: none. */
  glass?: RsbGlass | null;
}

/** S3: the front glass, field for field (rt-core `optics::glass::GlassParams`, the `GLAS` payload). */
export interface RsbGlass {
  flags: number;
  distanceMm: number;
  seed: number;
  dropCoverage: number;
  dropSizeMm: number;
  dropSizeVar: number;
  contactAngleDeg: number;
  ior: number;
  dustCoverage: number;
  dustSizeMm: number;
  dustSizeVar: number;
  dustOpacity: number;
  /**
   * S3b: the drops (x, y, a) and the motes (x, y, r) one by one, mm in the pane's axes (a pane fed by the scene: the
   * frame of its recorded simulation), appended to the 48 bytes; the coverage fields are then 0. Only for an engine
   * with bit 7 (render/engine.ts `readsGlassLayout`, `SceneView.glassLayout`).
   */
  layout?: { drops: Float32Array; motes: Float32Array };
}

/** S3b: word 48 of a GLAS payload that lists its drops and motes (rt-core `GLAS_LAYOUT_VERSION`). */
export const GLAS_LAYOUT_VERSION = 1;

/** Bytes of a GLAS payload: its 48, and its layout when it has one. */
export function glasBytes(g: RsbGlass): number {
  return GLAS_BYTES + (g.layout ? 4 * (3 + g.layout.drops.length + g.layout.motes.length) : 0);
}

/** Tag and size of the front glass section (S3). */
export const TAG_GLAS = 'GLAS';
export const GLAS_BYTES = 48;

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
  /** O3a: the stack of effect filters (up to three; absent or empty: none, and the O1 bytes). */
  filters?: RsbLensFilter[];
  /** O2: the traced lens, after the filter slots (absent: the thin lens). */
  prescription?: RsbPrescription;
  /**
   * F1: after the prescription, the output frame's sensor along its longer side (mm) when the camera's sensor covers more
   * than the frame (a viewport's image): the traced lens derives what belongs to the frame's corner from it, so the
   * viewport sees the lens of the render. Absent or 0: the camera's own (and the bytes of before).
   */
  frameSensorMm?: number;
}

/** `LENS` surface kinds (rt-core `optics::traced::SURFACE_*`). */
export const SURFACE_KIND = { sphere: 0, plane: 1, asphere: 2, cylinderX: 3, cylinderY: 4, mirror: 5 } as const;
/** `LENS` surface coatings (rt-core `COATING_*`): 0 is a surface that is not air–glass. */
export const SURFACE_COATING: Readonly<Record<CoatingId, number>> = { none: 1, single: 2, multi: 3 };
/** `LENS` focus modes (rt-core `FOCUS_*`). */
export const FOCUS_MODE = { unit: 0, internal: 1, floating: 2, anamorphic: 3 } as const;

/** One surface of a traced lens (rt-core `optics::traced::SurfaceSpec`). */
export interface RsbSurface {
  kind: number;
  /** 0: a plane. */
  radius: number;
  thickness: number;
  /** The medium after the surface: 1 is air. */
  nd: number;
  vd: number;
  /** 0: derived by the engine. */
  semiAperture: number;
  coating: number;
  conic: number;
  aspheric: [number, number, number, number];
}

/** The traced lens of a LENS section (rt-core `optics::traced::Prescription`). */
export interface RsbPrescription {
  stop: number;
  focusMode: number;
  fNumberMin: number;
  magnification: [number, number];
  distortion: number;
  vignetting: number;
  spherical: number;
  breathing: number;
  moving: { surface: number; base: number; near: number }[];
  surfaces: RsbSurface[];
}

/** Size of a prescription after the filter slots. */
function prescriptionSize(t: RsbPrescription): number {
  return 4 + 8 + 7 * 4 + 4 + t.moving.length * 12 + t.surfaces.length * 48;
}

/** The bytes of a prescription at the end of LENS (rt-core `scene::rsb::prescription_bytes`). */
export function prescriptionBytes(t: RsbPrescription): Uint8Array {
  const out = new Uint8Array(prescriptionSize(t));
  const v = new DataView(out.buffer);
  let o = 0;
  const u32 = (x: number) => (v.setUint32(o, x >>> 0, true), (o += 4));
  const f32 = (x: number) => (v.setFloat32(o, x, true), (o += 4));
  u32(t.surfaces.length);
  u32(t.stop);
  u32(t.focusMode);
  for (const x of [t.fNumberMin, t.magnification[0], t.magnification[1], t.distortion, t.vignetting, t.spherical, t.breathing]) f32(x);
  u32(t.moving.length);
  for (const m of t.moving) {
    u32(m.surface);
    f32(m.base);
    f32(m.near);
  }
  for (const sf of t.surfaces) {
    u32(sf.kind);
    for (const x of [sf.radius, sf.thickness, sf.nd, sf.vd, sf.semiAperture]) f32(x);
    u32(sf.coating);
    f32(sf.conic);
    for (const x of sf.aspheric) f32(x);
  }
  return out;
}

/** One LENS filter slot (rt-core `optics::filters::FilterParams`). */
export interface RsbLensFilter {
  /** `FILTER_*`: 0 none, 1 white, 2 black, 3 gold diffusion, 4 glimmer, 5 soft, 6 net, 7 star, 8 streak. */
  kind: number;
  grade: number;
  /** All zero: the kind's own. */
  tint: [number, number, number];
  angleDeg: number;
  /** Star: 4, 6 or 8 (0: 6). */
  points: number;
}

/** The three filter slots of a LENS section: 28 bytes each. */
export const LENS_FILTER_SLOTS = 3;
const LENS_FILTER_BYTES = 28;

/** True when a slot holds anything (the engine writes the slots when one does). */
function filterSlotUsed(f: RsbLensFilter): boolean {
  return f.kind !== 0 || f.grade !== 0 || f.tint.some((v) => v !== 0) || f.angleDeg !== 0 || f.points !== 0;
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
  /** E6: edge bevel radius in mm (0: sharp edges); the engine rounds the shading normal near the mesh's sharp edges. */
  bevelMm: number;
  /** E9: mean free path of the scattering medium inside a clear solid, mm (0: none). */
  scatterMm: number;
  /** E9: single-scattering albedo of that medium, per channel (linear RGB). */
  scatterColor: RsbVec;
  /** E9: Henyey–Greenstein anisotropy of that medium, -0.9 (backwards) to 0.9 (forwards). */
  scatterG: number;
  /** E9c: Abbe number of solid glass without a medium (0: no dispersion). */
  abbe: number;
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
  /**
   * L5, kind LIGHT_IES: the profile's file (one character per byte, core/ies.ts). `writeRsb` writes each distinct text once
   * as an IESP section and the light with the position of its profile; the LGHT is 80 bytes then, 76 for every other kind.
   */
  ies?: string;
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
  /** U11b: how much of the denoised image is handed out, 0..1 (noisy × (1 − s) + denoised × s; default 1). */
  denoiseStrength: number;
  /** E11: the pixel filter (core/antialias.ts: 0 the box of one pixel, 1 the centre, 2 a tent, 3 Blackman–Harris). */
  pixelFilter: number;
  /** E11: the samples an edge pixel takes per sample index (1: none more; at most 16). */
  edgeSupersample: number;
  /** E10: bit 0, adaptive sampling (render/adaptive.ts; 0 or absent: every pixel alike, as before). */
  adaptive?: number;
  /** E10: with adaptive sampling, the noise target, a fraction 0..1 (0 or absent: none). */
  noiseThreshold?: number;
}

/** What the engine renders: `rt_core::scene::Scene`, field for field. */
// `PATN.kind` and `variant` codes of the patterns (E6), and their recipes: core/pattern-recipe.ts (M3c: the Wood and
// Fabric nodes of a graph compile from the same).
export { PATTERN_CLOTH, PATTERN_WOOD, WEAVES, WOOD_FIGURES } from '../core/pattern-recipe';

/** E6: the procedural pattern of a material (`PATN`, 108 B, written right after the MATL sections). */
export interface RsbPattern {
  /** Index of its material among the MATL sections. */
  material: number;
  kind: number;
  /** Wood: the spring wood (light). Cloth: the warp (`threadColor1`). Linear RGB. */
  colorA: RsbVec;
  /** Wood: the summer wood (dark). Cloth: the weft (`threadColor2`). */
  colorB: RsbVec;
  /** Wood: the ring spacing (bamboo: the strip width), mm. Cloth: the distance between threads, mm. */
  scaleMm: number;
  /**
   * Wood: ring variation, ring noise, axial noise, colour noise, contrast (0: the colours as given), pore width
   * (mm, 0: none), pore depth, pore band (0 diffuse- to 1 ring-porous), fibre, anisotropy along the grain; knots
   * (figure RINGS only): count (0 to 12), diameter (mm), variation of the diameter (± fraction), darkness; two
   * unused (0). Cloth: the relief (`weaveDepth`), the yarn's twist (`yarnTwist`), then 0. PATN_PARAMS of them.
   */
  params: number[];
  /** Wood: the figure (WOOD_FIGURES). Cloth: the weave (WEAVES). */
  variant: number;
  /** The material's seed (`wear.seed`): where the knots are. */
  seed: number;
}

export { PATN_PARAMS } from '../core/pattern-recipe';

export interface RsbScene {
  camera: RsbCamera;
  materials: RsbMaterial[];
  /** E6: the materials' procedural patterns (absent: none). */
  patterns?: RsbPattern[];
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
  /** M3b: the materials' programs (PROG, last), each referring to its material by index. */
  programs?: RsbProgram[];
  /** Q1: the section view's plane (SECT): `normal · p = distance` (mm), what stays is `<=`; absent: the whole model. */
  section?: RsbSection;
}

/** Q1: the section view's plane, as `SECT` holds it (core/section.ts `resolveSection`). */
export interface RsbSection {
  normal: RsbVec;
  distance: number;
  cap: boolean;
}

/** M3b: a material's program, the payload of `PROG` after its material index. */
export interface RsbProgram {
  /** Index of its material among the MATL sections. */
  material: number;
  /** The program's bytes (`encodeProgram`, its images as indices into IMGS). */
  bytes: Uint8Array;
}

/** S4a: an ambient effect, the fields of `FXAM` (core/effects.ts `effectFxam`). */
export type RsbEffect = FxamFields;

// The defaults of rt-core (`impl Default` of each struct): what a field the
// interface does not have is written as.

export function defaultCamera(): RsbCamera {
  return { position: [0, -1000, 0], target: [0, 0, 0], up: [0, 0, 1], focalMm: 50, sensorMm: 36, fstop: 0, focusDist: 1000, ortho: false, orthoWidth: 1000 };
}

export function defaultMaterial(): RsbMaterial {
  return {
    kind: MATERIAL_PRINCIPLED,
    baseColor: [0.8, 0.8, 0.8],
    metallic: 0,
    roughness: 0.5,
    ior: 1.5,
    transmission: 0,
    coat: 0,
    coatRoughness: 0,
    emission: [0, 0, 0],
    emissionPower: 0,
    flags: 0,
    opacity: 1,
    anisotropy: 0,
    absorptionMm: 0,
    bevelMm: 0,
    scatterMm: 0,
    scatterColor: [1, 1, 1],
    scatterG: 0,
    abbe: 0,
  };
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
  return { width: 640, height: 360, maxSamples: 64, seed: 0, maxSeconds: 0, exposureEv: 0, tonemap: TONEMAP_ACES, maxDepth: DEFAULT_MAX_DEPTH, clampIndirect: 0, passes: 0, denoise: 0, causticPhotons: 0, causticRadius: 0, denoiseStrength: 1, pixelFilter: 0, edgeSupersample: 1, adaptive: 0, noiseThreshold: 0 };
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
/** K3: the projection, the two fields of view and the exterior factor after the 60 bytes of before. */
const CAMR_K3_BYTES = 16;

/** K3: true when a camera carries a K3 field that is not its default, and so writes the 76-byte CAMR. */
export function writesCameraK3(c: RsbCamera): boolean {
  return (c.projection ?? 0) !== 0 || (c.fovXDeg ?? 360) !== 360 || (c.fovYDeg ?? 180) !== 180 || (c.exterior ?? 1) !== 1;
}
/** LENS without its picture: 15 numbers before the picture's three words. */
const LENS_BYTES = 72;
/** MATL with E6's `bevel_mm` and E9's fields (the medium and the Abbe number). */
const MATL_BYTES = 100;
const PATN_BYTES = 108;
/**
 * M2a: where the texture block of a MATL starts: after E6's `bevel_mm` (72 to 76) and E9's `scatter_mm scatter_color[3]
 * scatter_g abbe` (76 to 100), written in every MATL.
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

/** A MATL payload: the fields of E5 and E6 (`bevel_mm`), and with a texture block the padding to it and the block. */
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
/** L5: an IES light's LGHT carries the position of its profile after the flags. */
const LGHT_IES_BYTES = 80;
/** IESP: the length of the file, the file, zero padding to 4. */
const iespBytes = (profile: Uint8Array): number => 4 + profile.length + ((4 - (profile.length % 4)) % 4);
const ENVR_BYTES = 84;
const FLOR_BYTES = 20;
const RNDR_BYTES = 64;
/** E10: with adaptive sampling asked for, `adaptive` and `noise_threshold` after it (rt-core writes them only then). */
const RNDR_BYTES_ADAPTIVE = 72;

/** The bytes of a render section: 64 as E11 wrote it, 72 with adaptive sampling (E10). */
function renderBytes(r: RsbRender): number {
  return (r.adaptive ?? 0) !== 0 || (r.noiseThreshold ?? 0) !== 0 ? RNDR_BYTES_ADAPTIVE : RNDR_BYTES;
}
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

/** True when a LENS section writes its filter slots: there is a filter, or a prescription follows them. */
function writesFilterSlots(l: RsbLens): boolean {
  return (l.filters ?? []).some(filterSlotUsed) || l.prescription !== undefined;
}

/** A LENS payload: the numbers, the picture, zero padding to a multiple of four, the filters when there are any (or a prescription), and the prescription. */
function lensBytes(l: RsbLens): number {
  const filters = writesFilterSlots(l) ? LENS_FILTER_SLOTS * LENS_FILTER_BYTES : 0;
  const traced = l.prescription ? prescriptionSize(l.prescription) + (l.frameSensorMm ? 4 : 0) : 0;
  return LENS_BYTES + l.mask.length + ((4 - (l.mask.length % 4)) % 4) + filters + traced;
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

/** M2a: the texture block of a MATL, from MATL_TEXTURE_OFFSET (right after E9's fields: no padding left). */
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

  const patterns = scene.patterns ?? [];
  const tex = scene.textures === true;
  const images = tex ? (scene.images ?? []) : [];
  const effects = scene.effects ?? [];
  const programs = scene.programs ?? [];
  const section = scene.section ?? null;
  // L5: the IES lights' profiles, once each, in the order of first use.
  const profileTexts: string[] = [];
  for (const l of scene.lights) if (l.kind === LIGHT_IES && l.ies !== undefined && !profileTexts.includes(l.ies)) profileTexts.push(l.ies);
  const profiles = profileTexts.map(iesBytesOf);
  const written = scene.lights.filter((l) => l.kind !== LIGHT_IES || l.ies !== undefined);
  const camrBytes = CAMR_BYTES + (writesCameraK3(scene.camera) ? CAMR_K3_BYTES : 0);
  // S3: an effect's payload is longer with the S3 fields.
  const fxams = effects.map(fxamPayload);
  let size = 8 + 8 + camrBytes + fxams.reduce((n, p) => n + 8 + p.length, 0) + patterns.length * (8 + PATN_BYTES);
  for (const l of written) size += 8 + (l.kind === LIGHT_IES ? LGHT_IES_BYTES : LGHT_BYTES);
  for (const p of profiles) size += 8 + iespBytes(p);
  for (const m of scene.materials) size += 8 + (tex ? materialBytes(m) : MATL_BYTES);
  const lens = scene.camera.lens ?? null;
  if (lens) size += 8 + lensBytes(lens);
  const glass = scene.camera.glass ?? null;
  if (glass) size += 8 + glasBytes(glass);
  size += 8 + ENVR_BYTES + 8 + FLOR_BYTES + 8 + renderBytes(scene.render);
  if (withMeshes) for (const m of scene.meshes) size += 8 + meshBytes(m, tex);
  if (withMeshes) for (const b of scene.bitmaps) size += 8 + bitmapBytes(b);
  if (withMeshes && images.length > 0) size += 8 + imagesBytes(images);
  if (instances) size += instances.length * (8 + INST_BYTES);
  for (const p of programs) size += 8 + 4 + p.bytes.length;
  if (section) size += 8 + SECT_BYTES;

  const w = new ByteWriter(size);
  w.tag(RSB_MAGIC);
  w.u32(0); // header_len

  const c = scene.camera;
  w.section(TAG_CAMR, camrBytes, () => {
    w.vec(c.position);
    w.vec(c.target);
    w.vec(c.up);
    w.f32(c.focalMm);
    w.f32(c.sensorMm);
    w.f32(c.fstop);
    w.f32(c.focusDist);
    w.u32(c.ortho ? 1 : 0);
    w.f32(c.orthoWidth);
    // K3: only when one is set, so a camera of before keeps its bytes.
    if (camrBytes > CAMR_BYTES) {
      w.u32(c.projection ?? 0);
      w.f32(c.fovXDeg ?? 360);
      w.f32(c.fovYDeg ?? 180);
      w.f32(c.exterior ?? 1);
    }
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
      const filters = lens.filters ?? [];
      if (writesFilterSlots(lens)) {
        for (let i = 0; i < LENS_FILTER_SLOTS; i++) {
          const f = filters[i] ?? { kind: 0, grade: 0, tint: [0, 0, 0], angleDeg: 0, points: 0 };
          w.u32(f.kind);
          w.f32(f.grade);
          for (const v of f.tint) w.f32(v);
          w.f32(f.angleDeg);
          w.u32(f.points);
        }
      }
      if (lens.prescription) {
        w.raw(prescriptionBytes(lens.prescription));
        if (lens.frameSensorMm) w.f32(lens.frameSensorMm);
      }
    });
  }
  // S3: the front glass, right after the camera's optics, only when there is one.
  if (glass) {
    w.section(TAG_GLAS, glasBytes(glass), () => {
      w.u32(glass.flags);
      w.f32(glass.distanceMm);
      w.u32(glass.seed);
      for (const v of [glass.dropCoverage, glass.dropSizeMm, glass.dropSizeVar, glass.contactAngleDeg, glass.ior, glass.dustCoverage, glass.dustSizeMm, glass.dustSizeVar, glass.dustOpacity]) w.f32(v);
      // S3b: the drops and motes one by one.
      const l = glass.layout;
      if (l) {
        w.u32(GLAS_LAYOUT_VERSION);
        w.u32(l.drops.length / 3);
        w.u32(l.motes.length / 3);
        for (const v of l.drops) w.f32(v);
        for (const v of l.motes) w.f32(v);
      }
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
      w.f32(m.bevelMm);
      // E9 appends the medium and the Abbe number.
      w.f32(m.scatterMm);
      w.vec(m.scatterColor);
      w.f32(m.scatterG);
      w.f32(m.abbe);
      if (t) writeTextureBlock(w, t);
    });
  }
  for (const p of patterns) {
    w.section(TAG_PATN, PATN_BYTES, () => {
      w.u32(p.material);
      w.u32(p.kind);
      w.vec(p.colorA);
      w.vec(p.colorB);
      w.f32(p.scaleMm);
      for (let i = 0; i < PATN_PARAMS; i++) w.f32(p.params[i] ?? 0);
      w.u32(p.variant);
      w.u32(p.seed >>> 0);
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
  // An IES light without its profile is no light for the engine, and is not written (rt_core `Scene::to_rsb`).
  for (const l of written) {
    w.section(TAG_LGHT, l.kind === LIGHT_IES ? LGHT_IES_BYTES : LGHT_BYTES, () => {
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
      if (l.kind === LIGHT_IES) w.u32(profileTexts.indexOf(l.ies!));
    });
  }
  for (const p of profiles) {
    w.section(TAG_IESP, iespBytes(p), () => {
      w.u32(p.length);
      w.raw(p);
      w.pad((4 - (p.length % 4)) % 4);
    });
  }
  for (const p of fxams) w.section(TAG_FXAM, p.length, () => w.raw(p));
  // Q1: the section view, only when there is one: a scene without it is the bytes of before.
  if (section) {
    w.section(TAG_SECT, SECT_BYTES, () => {
      w.u32(section.cap ? SECTION_CAP : 0);
      w.vec(section.normal);
      w.f32(section.distance);
    });
  }
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
  w.section(TAG_RNDR, renderBytes(r), () => {
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
    w.f32(r.denoiseStrength);
    w.u32(r.pixelFilter);
    w.u32(r.edgeSupersample);
    if (renderBytes(r) === RNDR_BYTES_ADAPTIVE) {
      w.u32(r.adaptive ?? 0);
      w.f32(r.noiseThreshold ?? 0);
    }
  });
  // M3b: the materials' programs, last.
  for (const p of programs) {
    w.section(TAG_PROG, 4 + p.bytes.length, () => {
      w.u32(p.material);
      w.raw(p.bytes);
    });
  }
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
   * F1: the frames of a gesture: a traced lens's focus on a point or an object takes the engine's last answer for the
   * lens instead of solving it again (core/focus.ts `resolvedFocusDistance`).
   */
  focusFast?: boolean;
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
  /** U11b, `RNDR.denoise_strength`: 0..1 (core/render.ts `denoiseFraction`; default 1). */
  denoiseStrength?: number;
  /** E11, `RNDR.pixel_filter` (core/antialias.ts `pixelFilterFields`; default 0, the box). */
  pixelFilter?: number;
  /** E11, `RNDR.edge_supersample`: 1..16 (default 1). */
  edgeSupersample?: number;
  /**
   * E10, `RNDR.adaptive` and `RNDR.noise_threshold`: adaptive sampling to this noise target (a fraction, core/render.ts
   * `noiseFraction`; 0: none, the samples or the time end it). Absent: every pixel alike, the bytes of before.
   */
  adaptive?: { noiseThreshold: number };
  /** E5b-1: the caustics switch and quality; Automatic is decided here, from the scene (core/caustics.ts). Default off. */
  caustics?: { mode: CausticsMode; quality: CausticsQuality };
  /**
   * M2a: write the textures (IMGS, the MATL texture blocks, the meshes' UVs) for an engine that reads them (M2b
   * turns it on from the engine's own word). Off by default: the bytes are those of before M2a.
   */
  textures?: boolean;
  /**
   * M3b: write each node material's program (PROG) for an engine that runs them (render/engine.ts `readsPrograms`);
   * only with `textures` (a program reads IMGS and the UVs). Off by default: a node material is the mean of its
   * outputs, as before.
   */
  programs?: boolean;
  /**
   * M3c: with `programs`, false for an engine that runs programs but not their pattern instructions (the Wood and
   * Fabric nodes, render/engine.ts `readsPatternNodes`): a node material with them is then the mean of its outputs.
   */
  patternNodes?: boolean;
  /**
   * L5: write the IES lights as such (LGHT kind 5 and the IESP sections) for an engine that renders them (render/engine.ts
   * `readsIes`). Off by default: an IES light is the spot light that stands for it in Fast, which any engine reads.
   */
  ies?: boolean;
  /**
   * K3: write the interior cameras (the projection, the fields of view and the exterior factor at the end of CAMR, and
   * the parts hidden to the camera as `INST.flags` bit 2) for an engine that reads them (render/engine.ts
   * `readsCameras`). Off by default: an engine of before K3 shows every part and renders the standard camera, and the
   * page writes what it reads.
   */
  cameras?: boolean;
  /**
   * S3: write the drops (the drop shape, the mixes of shapes and the shape variation of the effects, the S3 fields of
   * FXAM) and the camera's front glass (GLAS) for an engine that draws them (render/engine.ts `readsDrops`). Off by
   * default: an effect of drops is written as spheres, a mix as its heaviest shape, and no front glass.
   */
  drops?: boolean;
  /**
   * S3b: write a front glass fed by the scene, drop by drop (the frame of its recorded simulation at the pose's instant:
   * the tail of GLAS), for an engine with bit 7 (render/engine.ts `readsGlassLayout`). Off by default: an engine of S3
   * would draw the coverage fields, which such a pane has at 0, so the page writes no such pane for it.
   */
  glassLayout?: boolean;
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

/** Largest |g| of a scattering medium's Henyey–Greenstein phase (the engine clamps to it too). */
export const SCATTER_G_MAX = 0.9;

/** Absorption distance of a GLASS material without its own (`absorptionMm` of core/materials.ts). */
export const GLASS_ABSORPTION_MM = 50;

/**
 * A material instance with the semantics of rt-core: SIMPLE, WOOD and FABRIC as principled (wood
 * and fabric with the mean colour of their pattern, which `patternToRsb` sends; SIMPLE with its transmission,
 * opacity and anisotropy, E5), GLASS as kind 1 (clear glass: its colour after `absorptionMm`
 * millimetres inside, or a surface tint at 0; a thin wall with `walls` THIN; E9: a scattering
 * medium inside with `scatterMm`, `scatterColor` and `scatterG`, and dispersion with `abbe`),
 * EMISSIVE as kind 2 with radiance `colour x emitPower x EMIT_RADIANCE_PER_WATT` (the colour of a
 * black body at its temperature, normalised to its largest channel, or the colour given), sampled
 * as a light when it emits. The edge bevel (E6, `bevelRadiusMm`) goes to every family but the
 * emitter, which has none. Wear comes later (E7).
 */
export function materialToRsb(inst: MaterialInstance | null | undefined, opts: { program?: Program | null } = {}): RsbMaterial {
  const m = defaultMaterial();
  if (!inst) {
    m.baseColor = [FALLBACK_GREY, FALLBACK_GREY, FALLBACK_GREY];
    return m;
  }
  // M3a: a material of nodes is the means of its outputs: all an engine that does not run graphs gets, and the base of
  // the program (`opts.program`, PROG) for one that does (M3b): what it does not read point by point (the kind, the
  // absorption, the thin walls, the bevel radius). A program whose emission varies is no emitter: it reflects and
  // adds its emission where it has some, as Fast draws it.
  if (inst.graph) inst = { ...inst, ...flattenGraph(inst.graph, !(opts.program && emissionVaries(opts.program))) };
  const p = inst.params;
  if (inst.family !== 'EMISSIVE') m.bevelMm = Math.max(0, num(inst.bevelRadiusMm, 0));
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
      // E9: a scattering medium inside the solid (mean free path, albedo, direction) and the
      // dispersion of the glass (its Abbe number). A project without them writes the defaults.
      m.scatterMm = Math.max(0, num(p.scatterMm, 0));
      m.scatterColor = rgbOf(p.scatterColor, [1, 1, 1]).map(clamp01) as RsbVec;
      m.scatterG = Math.min(SCATTER_G_MAX, Math.max(-SCATTER_G_MAX, num(p.scatterG, 0)));
      m.abbe = Math.max(0, num(p.abbe, 0));
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
      m.baseColor = fabricMeanColor(p);
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

/** M3b: the emission or its strength is not a constant of the program (it varies over the part). */
export function emissionVaries(p: Program): boolean {
  const at = (k: string) => p.outputs[OUTPUT_KEYS.indexOf(k)];
  return [at('emission'), at('emissionStrength')].some((o) => o.kind === 'F' || o.kind === 'V');
}

const programCache = new WeakMap<MaterialGraph, Program | null>();

/**
 * M3b: the program a node material is written as for an engine that runs them: its graph compiled (cached per graph
 * object); null when it does not compile or a value of it is not finite (the RSB holds finite numbers only): the
 * material is then its mean alone.
 */
export function graphProgram(g: MaterialGraph): Program | null {
  const hit = programCache.get(g);
  if (hit !== undefined) return hit;
  const { program } = compileGraph(g);
  const ok = program && Number.isFinite(program.absorptionMm) && program.consts.every((x) => Number.isFinite(x)) ? program : null;
  programCache.set(g, ok);
  return ok;
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
 * in the recipes). A light that casts no shadow has LIGHT_FLAG_NO_SHADOW.
 */
export function lightToRsb(state: ProjectState, l: LightInstance, opts: { ies?: boolean } = {}): RsbLight {
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
    const power = pointLightFlux(Math.max(0, l.power), state.scene.partSizeMm);
    // L5: an IES light whose profile reads is that profile for an engine that has IES lights (`opts.ies`), and for one that
    // has not, the spot light that stands for it in Fast (core/ies.ts `iesSpot`); one whose file does not read is a point.
    const profile = l.type === 'IES' && l.ies ? iesProfileOf(l.ies.text) : null;
    if (profile && opts.ies) {
      return { kind: LIGHT_IES, position: pos, direction: dir, up, sizeX: diameter, sizeY: diameter, color, power, spreadDeg: 180, angleDeg: 0, flags, ies: l.ies!.text };
    }
    const approx = profile ? iesSpot(profile) : null;
    const spot = l.type === 'SPOT' || approx !== null;
    const cone = approx ? Math.min(179, approx.cone) : Math.min(179, Math.max(1, l.spread));
    const blend = approx ? approx.blend : Math.min(1, Math.max(0, l.blend ?? SPOT_DEFAULTS.blend));
    return {
      kind: spot ? LIGHT_SPOT : LIGHT_POINT,
      position: pos,
      direction: dir,
      up,
      sizeX: diameter,
      sizeY: diameter,
      color,
      power,
      spreadDeg: spot ? cone : 180,
      // A spot's soft edge in degrees, inward from the edge of its cone.
      angleDeg: spot ? (blend * cone) / 2 : 0,
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

export { CLOTH_SPAN_MM, MAX_KNOTS, WOOD_ANISOTROPY, WOOD_RING_SPAN_MM } from '../core/pattern-recipe';

/**
 * The procedural pattern of a material instance (E6, `PATN`; null for the families without one), as
 * rt_core::pattern draws it. Wood: its two colours, `ringDensity` rings per 100 mm (physical: the ring spacing is
 * `100 / ringDensity` mm times `woodScale`, whatever the part's size), contrast, variation, noises, pores and figure;
 * fibres at full strength and the roughness stretched along the grain; its knots (only woods with rings have them:
 * `knotCount` 0 elsewhere), placed by the material's seed. Fallbacks are FAMILY_PARAMS' and, for the recipe-only
 * fields, those of a diffuse-porous wood. Cloth: warp and weft colours, `threadCount` threads per cm (physical: the
 * thread spacing is `10 / threadCount` mm whatever the part's size), its relief, its yarn's twist (none on carbon tows
 * and mesh) and its weave; the fuzz is not drawn.
 */
export function patternToRsb(inst: MaterialInstance | null | undefined, _partSizeMm: number, material: number): RsbPattern | null {
  // M3a: a material of nodes has no pattern (its graph is its program, M3b, or the means of its outputs).
  if (!inst || inst.graph) return null;
  const seed = inst.wear?.seed;
  const recipe = inst.family === 'WOOD' ? woodRecipe(inst.params, seedOf(seed)) : inst.family === 'FABRIC' ? fabricRecipe(inst.params, seedOf(seed)) : null;
  return recipe ? { material, kind: recipe.kind, colorA: recipe.colorA, colorB: recipe.colorB, scaleMm: recipe.scaleMm, params: recipe.params, variant: recipe.variant, seed: recipe.seed } : null;
}

/**
 * The camera for an image of `width x height` pixels. Without `viewport` it is the output
 * frame: the 36 mm sensor on the longer side, as the engine assumes. With it, the image covers
 * the whole viewport and the output frame sits inset where the preview draws it, so the sensor
 * (and an orthographic width, and a panorama's fields of view) grows by the viewport over the frame.
 * K3: the camera rendered is `renderedCamera` (the straight verticals: level, with the lens shift
 * that keeps the frame), and a panorama writes its projection and fields of view (core/panorama.ts).
 */
export function cameraToRsb(cam0: CameraState, outW: number, outH: number, width: number, height: number, viewport?: { viewW: number; viewH: number }): RsbCamera {
  const cam = renderedCamera(cam0);
  let sensorMm = SENSOR_MM;
  let orthoWidth = cam.orthoWidth;
  // K3: the output frame inside the image, in the image's proportions (for a panorama's fields of view).
  let frameW = width;
  let frameH = height;
  if (viewport && viewport.viewW > 0 && viewport.viewH > 0) {
    const frame = outputFrameRect(viewport.viewW, viewport.viewH, outW, outH);
    const outAspect = outW > 0 && outH > 0 ? outW / outH : 16 / 9;
    // Millimetres of sensor per CSS pixel of the viewport, then per image pixel.
    const mmPerCss = outAspect >= 1 ? SENSOR_MM / frame.width : SENSOR_MM / frame.height;
    const mmPerPx = (mmPerCss * viewport.viewW) / Math.max(1, width);
    sensorMm = mmPerPx * Math.max(width, height);
    orthoWidth = (cam.orthoWidth * viewport.viewW) / frame.width;
    frameW = (frame.width * width) / viewport.viewW;
    frameH = (frame.height * height) / viewport.viewH;
  }
  const ortho = cam.projection === 'ORTHOGRAPHIC';
  const panoramic = isPanoramic(cam.projection);
  const lens = cam.projection === 'PERSPECTIVE' && cam.optics && !isNeutralOptics(cam.optics) ? lensToRsb(cam.optics, outW, outH) : null;
  // F1: the sensor of a viewport's image covers the frame and what lies around it; a traced lens is still the frame's
  // (its rims, the corner its artistic distortion is measured against), so the Full view and the render agree.
  if (lens?.prescription && sensorMm !== SENSOR_MM) lens.frameSensorMm = SENSOR_MM;
  const fov = panoramic ? panoramaFov(cam, frameW, frameH, width, height) : null;
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
    ...(fov ? { projection: projectionCode(cam.projection), fovXDeg: Math.min(MAX_FOV_DEG, fov.x), fovYDeg: Math.min(MAX_FOV_DEG, fov.y) } : {}),
  };
}

/**
 * S3: the GLAS fields of a front glass: its knobs, the rest the pane's fixed values (data/front-glass.ts). S3b: with
 * the frame of a recorded simulation, its drops and motes one by one (no coverage, the cap angle it was recorded with).
 */
export function glassToRsb(g: FrontGlass, frame?: GlassFrame & { capAngleDeg: number }): RsbGlass {
  const F = FRONT_GLASS_FIXED;
  if (frame) {
    return {
      flags: 0,
      distanceMm: Math.max(0, g.distanceMm),
      seed: Math.max(0, Math.round(g.seed)) >>> 0,
      dropCoverage: 0,
      dropSizeMm: 0,
      dropSizeVar: F.dropSizeVar,
      contactAngleDeg: Math.min(175, Math.max(5, frame.capAngleDeg)),
      ior: F.ior,
      dustCoverage: 0,
      dustSizeMm: F.dustSizeMm,
      dustSizeVar: F.dustSizeVar,
      dustOpacity: F.dustOpacity,
      layout: { drops: frame.drops, motes: frame.motes },
    };
  }
  return {
    flags: 0,
    distanceMm: Math.max(0, g.distanceMm),
    seed: Math.max(0, Math.round(g.seed)) >>> 0,
    dropCoverage: Math.min(0.9, Math.max(0, g.drops)),
    dropSizeMm: Math.min(50, Math.max(0, g.dropSizeMm)),
    dropSizeVar: F.dropSizeVar,
    contactAngleDeg: F.contactAngleDeg,
    ior: F.ior,
    dustCoverage: Math.min(0.5, Math.max(0, g.dust)),
    dustSizeMm: F.dustSizeMm,
    dustSizeVar: F.dustSizeVar,
    dustOpacity: F.dustOpacity,
  };
}

/** Widest field of view the engine reads (`CAMR.fov_x_deg`, rt-core `MAX_FOV_DEG`). */
export const MAX_FOV_DEG = 3600;

/**
 * O2: the scene the engine reads to tell what it makes of a camera's traced lens (`rt_scene_lens_info`, the
 * launcher's /api/lens/info): the camera and its LENS section for an output frame of `outW × outH`, nothing else.
 */
export function lensInfoRsb(cam: CameraState, outW: number, outH: number): Uint8Array {
  const camera = cameraToRsb(cam, outW, outH, outW, outH);
  return writeRsb({
    camera,
    materials: [],
    meshes: [],
    instances: null,
    lights: [],
    environment: defaultEnvironment(),
    floor: defaultFloor(),
    render: { ...defaultRender(), width: Math.max(1, outW), height: Math.max(1, outH) },
    bitmaps: [],
  });
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
  const composed = o.traced ? composeLens(o.traced) : null;
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
    // A mirror lens's central obstruction and an anamorphic adapter's squeeze are the traced lens's own.
    obstruction: Math.min(0.95, Math.max(0, composed ? Math.max(o.obstruction, composed.obstruction) : o.obstruction)),
    catsEye: unit(o.catsEye),
    // With a traced lens, the thin lens's squeeze does not apply (the engine desqueezes by what it traces).
    squeeze: Math.min(4, Math.max(1, composed ? composed.squeeze : o.squeeze)),
    shiftXMm: o.shiftXMm,
    shiftYMm: o.shiftYMm,
    // O4: a traced lens has its own tilt (the simple lens's, which the engine ignored with a traced lens before O4,
    // does not apply to it), and a lens with cylinders none.
    tiltDeg: Math.min(45, Math.max(-45, composed ? (tracedLensTilts(o.traced!) ? (o.tracedTiltDeg ?? 0) : 0) : o.tiltDeg)),
    tiltAxisDeg: composed ? (o.tracedTiltAxisDeg ?? 0) : o.tiltAxisDeg,
    caAmount: unit(o.caAmount),
    swirl: unit(o.swirl),
    fieldMm: frameFieldMm(outW, outH),
    maskKind: kind,
    maskWidth: picture ? APERTURE_SIZE : 0,
    maskHeight: picture ? APERTURE_SIZE : 0,
    mask: picture ?? new Uint8Array(0),
    ...(filtersOf(o).length > 0 ? { filters: filtersToRsb(filtersOf(o)) } : {}),
    ...(o.traced && composed ? { prescription: prescriptionToRsb(o.traced, composed) } : {}),
  };
}

/**
 * The LENS prescription of a camera's traced lens (O2): the surfaces of `composed` (core/traced-lens.ts
 * `composeLens`: the catalogue's, with the person's coating and variable gap, an adapter in front of its lens) as
 * the engine reads them, and the artistic overrides. rt-core's tests convert the catalogue the same way.
 */
export function prescriptionToRsb(t: TracedLens, composed: ComposedLens): RsbPrescription {
  const kindOf = (s: LensSurface): number => {
    switch (s.kind) {
      case 'plane':
        return SURFACE_KIND.plane;
      case 'asphere':
        return SURFACE_KIND.asphere;
      case 'cylinder':
        return s.axis === 'x' ? SURFACE_KIND.cylinderX : SURFACE_KIND.cylinderY;
      case 'mirror':
        return SURFACE_KIND.mirror;
      default:
        return SURFACE_KIND.sphere;
    }
  };
  const focus = composed.focus;
  const unitOr = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
  const squeeze = composed.squeezeFocus;
  return {
    stop: composed.stop,
    focusMode: squeeze ? FOCUS_MODE.anamorphic : focus.mode === 'internal' ? FOCUS_MODE.internal : focus.mode === 'floating' ? FOCUS_MODE.floating : FOCUS_MODE.unit,
    fNumberMin: composed.fNumberMin,
    magnification: composed.magnification,
    distortion: unitOr(t.distortion, -1, 1),
    vignetting: unitOr(t.vignetting, 0, 1),
    spherical: unitOr(t.spherical, -1, 1),
    breathing: unitOr(t.breathing, -1, 1),
    moving: (squeeze ? [squeeze] : (focus.moving ?? [])).map((m) => ({ surface: m.surface, base: m.dBase, near: m.dNear })),
    surfaces: composed.surfaces.map((s) => {
      const a = s.kind === 'asphere' ? (s.asphere?.coefficients ?? []) : [];
      return {
        kind: kindOf(s),
        radius: s.r ?? 0,
        thickness: s.d ?? 0,
        nd: s.glass?.nd ?? 1,
        vd: s.glass?.vd ?? 0,
        semiAperture: s.semiAperture ?? 0,
        coating: s.coating === null ? 0 : SURFACE_COATING[s.coating],
        conic: s.kind === 'asphere' ? (s.asphere?.conic ?? 0) : 0,
        aspheric: [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0],
      };
    }),
  };
}

/** The LENS filter slots of a camera's filters (O3a): the type's kind, the grade, the tint (zeros: the type's own). */
export function filtersToRsb(filters: readonly LensFilter[]): RsbLensFilter[] {
  return filters.slice(0, LENS_FILTER_SLOTS).map((f) => {
    const type = lensFilterType(f.type);
    return {
      kind: type?.kind ?? 0,
      grade: Math.min(2, Math.max(0, f.grade)),
      tint: type?.tint && f.tint ? [f.tint[0], f.tint[1], f.tint[2]] : [0, 0, 0],
      angleDeg: type?.angle ? f.angleDeg : 0,
      points: type?.points ? (f.points === 4 || f.points === 8 ? f.points : 6) : 0,
    };
  });
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

/** The pose the preview shows (core/animation.ts playheadPose): the playhead's, when clips exist and it moved. */
export function currentPose(state: ProjectState): Pose | null {
  return playheadPose(state);
}

/**
 * The camera a view renders and the frame it takes (what `projectScene` writes): the one asked for, the shot's when an
 * animation poses it, then a gesture's live view or the camera looked through (`cameraPatch`); the frame of a viewport
 * image is the image of the camera on screen, with its ratio (U13): a camera looked through has its own (F1: it used to
 * take the active camera's, and the Full view showed another picture than the one the click was picked on), the shot's
 * camera of an animation the output's. Its focus distance is the one it resolves to as it is now (F1, core/focus.ts:
 * a point or an object it follows, from the camera and the scene at the pose; `focusFast` for a gesture's frames).
 */
export function viewCamera(state: ProjectState, view: Pick<SceneView, 'camera' | 'cameraPatch' | 'focusFast'>, pose: Pose | null): { cam: CameraState; frame: CameraAspect } {
  const chosen = (view.camera && state.camera.cameras[view.camera]) || activeCamera(state);
  let cam: CameraState = chosen;
  if (!view.camera && pose?.camera) {
    const base = state.camera.cameras[pose.camera.camera] ?? chosen;
    cam = { ...base, ...pose.camera, id: base.id };
  }
  if (view.cameraPatch) cam = { ...cam, ...view.cameraPatch };
  const frame = view.cameraPatch?.aspect ?? chosen.aspect;
  cam = { ...cam, focusDistance: resolvedFocusDistance(state, cam, pose, { fast: view.focusFast === true }) };
  return { cam, frame };
}

/**
 * F1: the scene the engine reads to tell what a view's pixel shows (`rt_scene_pick`, focus with a click): the camera of
 * `view` exactly as `projectScene` writes it (the pose, the camera looked through, the viewport's frame inset in its
 * image), at the view's size, and nothing else: the engine gives the chief ray of a point of that image, and the
 * viewport finds what it meets.
 */
export function focusPickRsb(state: ProjectState, view: Pick<SceneView, 'width' | 'height' | 'camera' | 'cameraPatch' | 'viewport' | 'pose'>): Uint8Array {
  const pose = view.pose === undefined ? currentPose(state) : view.pose;
  const width = Math.max(1, Math.min(MAX_DIMENSION, Math.round(view.width)));
  const height = Math.max(1, Math.min(MAX_DIMENSION, Math.round(view.height)));
  const { cam, frame } = viewCamera(state, view, pose);
  return writeRsb({
    camera: cameraToRsb(cam, frame.w, frame.h, width, height, view.viewport),
    materials: [],
    meshes: [],
    instances: null,
    lights: [],
    environment: defaultEnvironment(),
    floor: defaultFloor(),
    render: { ...defaultRender(), width, height },
    bitmaps: [],
  });
}

/**
 * S3b: the scene the engine reads to lay out a view's front glass (`rt_scene_glass`): the camera of `view` as
 * `projectScene` writes it, with its front glass even when nothing is on it by hand (a pane fed by the scene, or one
 * without drops: the engine still says where the pane is and how much of it the rays cross), and nothing else. Null when
 * the camera has no front glass switched on, or is panoramic.
 */
export function glassPaneRsb(state: ProjectState, view: Pick<SceneView, 'width' | 'height' | 'camera' | 'cameraPatch' | 'viewport' | 'pose'>): Uint8Array | null {
  const pose = view.pose === undefined ? currentPose(state) : view.pose;
  const width = Math.max(1, Math.min(MAX_DIMENSION, Math.round(view.width)));
  const height = Math.max(1, Math.min(MAX_DIMENSION, Math.round(view.height)));
  const { cam, frame } = viewCamera(state, view, pose);
  const g = cam.optics?.frontGlass;
  if (!g?.on || isPanoramic(cam.projection)) return null;
  const camera = cameraToRsb(cam, frame.w, frame.h, width, height, view.viewport);
  camera.glass = glassFromScene(g) ? { ...glassToRsb(g), dropCoverage: 0, dustCoverage: 0 } : glassToRsb(g);
  return writeRsb({
    camera,
    materials: [],
    meshes: [],
    instances: null,
    lights: [],
    environment: defaultEnvironment(),
    floor: defaultFloor(),
    render: { ...defaultRender(), width, height },
    bitmaps: [],
  });
}

/**
 * S3b: the scene the engine lays out camera `cameraId`'s front glass for the render's frame (its aspect, as the render
 * sees it: the square of the pane the simulation of the scene's rain wets), and the axes of that pane as the engine
 * makes them from the camera it writes (right, up, forward). Null without a front glass switched on.
 */
export function glassFrameRsb(state: ProjectState, cameraId: string): { rsb: Uint8Array; axes: PaneAxes } | null {
  const cam = state.camera.cameras[cameraId];
  if (!cam) return null;
  const rsb = glassPaneRsb(state, { width: cam.aspect.w, height: cam.aspect.h, camera: cameraId, pose: null });
  if (!rsb) return null;
  const { cam: seen, frame } = viewCamera(state, { camera: cameraId }, null);
  const c = cameraToRsb(seen, frame.w, frame.h, cam.aspect.w, cam.aspect.h);
  return { rsb, axes: paneAxes(c.position, c.target, c.up) };
}

/** The engine's scene for a project state and a view. */
export function projectScene(state: ProjectState, view: SceneView): ProjectScene {
  const pose = view.pose === undefined ? currentPose(state) : view.pose;
  const width = Math.max(1, Math.min(MAX_DIMENSION, Math.round(view.width)));
  const height = Math.max(1, Math.min(MAX_DIMENSION, Math.round(view.height)));

  const { cam, frame } = viewCamera(state, view, pose);
  const camera = cameraToRsb(cam, frame.w, frame.h, width, height, view.viewport);
  // S3: the front glass, for an engine that draws it (not through a panoramic camera, which has no front element).
  // S3b: one fed by the scene goes drop by drop (the frame of its recording the pose shows), for an engine that reads
  // that; without a recording it is a dry pane, which changes nothing and is left out.
  const glass = view.drops && !isPanoramic(cam.projection) ? frontGlassOf(cam.optics) : null;
  if (glass && !glassFromScene(glass)) camera.glass = glassToRsb(glass);
  else if (glass && view.glassLayout) {
    const frame = recordedGlass(state, pose, cam.id);
    if (frame) camera.glass = glassToRsb(glass, frame);
  }
  // K3: the exterior factor of the camera ray, and the panorama, only for an engine that reads them.
  const exterior = exteriorOf(state.environment.exterior);
  if (view.cameras && exterior !== 1) camera.exterior = exterior;
  if (!view.cameras) {
    delete camera.projection;
    delete camera.fovXDeg;
    delete camera.fovYDeg;
  }

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
  // N1: what the FADE clips leave of a part's opacity: its own and its ancestors', multiplied (1 without fades).
  const opacityOf = (id: NodeId): number => {
    let o = 1;
    for (let n: SceneNode | undefined = nodes[id]; n; n = n.parent ? nodes[n.parent] : undefined) o *= pose?.nodes[n.id]?.opacity ?? 1;
    return o;
  };

  const materials: RsbMaterial[] = [];
  const patterns: RsbPattern[] = [];
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
  // M3b: the programs of the node materials, for an engine that runs them (they read IMGS and the UVs: textures on).
  const programs: RsbProgram[] = [];
  // N1: a material the animation changes (its colour, its opacity), and a part's fade on top: a copy of the material
  // for each opacity a part wears it at. Without fades every key is the material's id, as before.
  const fadedIndex = new Map<string, number>();
  const baseFor = (key: string | null, mp: Pose['materials'][string] | undefined): number => {
    let i = materialIndex.get(key);
    if (i === undefined) {
      const inst = key ? posedMaterial(state.materials[key], mp) : null;
      const compiled = view.programs && view.textures && inst?.graph ? graphProgram(inst.graph) : null;
      const program = compiled && (view.patternNodes !== false || !compiled.uses.patterns) ? compiled : null;
      const m = materialToRsb(inst, { program });
      if (view.textures && key) m.textures = texturesToRsb(state.materials[key].textures, imageFor);
      i = materials.push(m) - 1;
      if (program) programs.push({ material: i, bytes: encodeProgram(program, (ref, k) => imageFor(ref.id, program.images[k].srgb ? IMAGE_SRGB : IMAGE_LINEAR)) });
      const pattern = patternToRsb(inst, state.scene.partSizeMm, i);
      if (pattern) patterns.push(pattern);
      materialOrder.push(key);
      materialIndex.set(key, i);
    }
    return i;
  };
  const materialFor = (id: string | null, partOpacity = 1): number => {
    const key = id && state.materials[id] ? id : null;
    const mp = key ? pose?.materials[key] : undefined;
    const i = baseFor(key, mp);
    const opacity = (mp?.opacity ?? 1) * partOpacity;
    if (!(opacity < 1)) return i;
    const fk = `${i}|${opacity}`;
    let fi = fadedIndex.get(fk);
    if (fi === undefined) {
      const m: RsbMaterial = { ...materials[i] };
      // A cut-out lets the light through with probability 1 - opacity; an emitter, which has no coverage, dims.
      if (m.kind === MATERIAL_EMISSIVE) m.emissionPower *= opacity;
      else m.opacity *= opacity;
      fi = materials.push(m) - 1;
      // The copy draws like its material: the same pattern (wood, fabric) and program (a graph).
      const pattern = patterns.find((p) => p.material === i);
      if (pattern) patterns.push({ ...pattern, material: fi });
      const program = programs.find((p) => p.material === i);
      if (program) programs.push({ ...program, material: fi });
      materialOrder.push(key);
      fadedIndex.set(fk, fi);
    }
    return fi;
  };

  // Q1: the cutting plane where the animation has put it, for an engine that cuts (every one this version ships).
  const cutting = resolveSection(state.section, pose?.sectionOffsetMm ?? 0);

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
    // N1: a part faded out all the way is not there (nor its shadow), like a hidden one.
    const partOpacity = opacityOf(id);
    if (!(partOpacity > 0)) continue;
    const data = getMesh(node.mesh.id);
    if (!data || data.indices.length === 0) continue;
    const rows = matrixRows(worldOf(id));
    for (const part of partMeshes(node, data)) {
      const materialId = materialFor(part.material, partOpacity);
      let mi = meshIndex.get(part.key);
      if (mi === undefined) {
        // The instances carry the materials. A mesh names material 0, valid in any scene that has
        // a mesh, so meshes the workers keep across updates never point past a shorter MATL list.
        mi = meshes.push({ ...part.mesh, materialId: 0 }) - 1;
        meshIndex.set(part.key, mi);
        meshKeys.push(part.key);
      }
      // Q1: the studio around the product (a set's backdrop, floor and cards) is not cut by the section.
      // K3: a part hidden to the camera, for an engine that reads it.
      const flags = (cutting && partIsExempt(state, id) ? INSTANCE_NO_SECTION : 0) | (view.cameras && hiddenToCamera(state, id) ? INSTANCE_NO_CAMERA : 0);
      instances.push({ mesh: mi, transform: rows, materialId, flags });
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
    const light = lightToRsb(state, l, { ies: view.ies === true });
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
    effects.push(effectFxam(state, e, materialId, cap, view.drops === true));
  }

  // Q1: the cutting plane, as it goes to the engine (`cutting`, resolved before the instances).
  const section: RsbSection | null = cutting ? { normal: [cutting.normal[0], cutting.normal[1], cutting.normal[2]], distance: cutting.distance, cap: cutting.cap } : null;

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
  // Without a sun light the sky's sun is the environment's own, placed like a light (camera-relative); N1: where a
  // SUN_ARC has put it.
  const skySun = pose?.skySun ?? env.skySun;
  const sun = toSun ?? polar(toWorldAzimuth(skySun.az), skySun.el, 1);
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
    denoiseStrength: Number.isFinite(view.denoiseStrength) ? Math.max(0, Math.min(1, view.denoiseStrength!)) : 1,
    pixelFilter: Math.max(0, Math.round(view.pixelFilter ?? 0)) >>> 0,
    edgeSupersample: Math.max(1, Math.min(16, Math.round(Number.isFinite(view.edgeSupersample) ? view.edgeSupersample! : 1))),
    adaptive: view.adaptive ? 1 : 0,
    noiseThreshold: view.adaptive && Number.isFinite(view.adaptive.noiseThreshold) ? Math.max(0, Math.min(1, view.adaptive.noiseThreshold)) : 0,
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
    scene: { camera, materials, patterns, meshes, instances, lights, environment, floor, render, bitmaps, ...(view.textures ? { textures: true, images } : {}), ...(effects.length > 0 ? { effects } : {}), ...(programs.length > 0 ? { programs } : {}), ...(section ? { section } : {}) },
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

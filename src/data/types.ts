// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (PolyForm Noncommercial 1.0.0); values are data, the implementation is new.

// Shared contracts for the data catalogues in src/data and the pure helpers
// in src/core. Catalogue keys (STUDIO_PRESETS, LIGHT_SETUPS, MATERIAL_PRESETS,
// ...) are the upstream keys, unchanged; keys inside objects are camelCase.

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export type Lang = 'es' | 'en';

/** A user-facing string in both supported languages. */
export interface Label {
  es: string;
  en: string;
}

/** Linear RGB, 0..1. */
export type RGB = readonly [number, number, number];
/** Linear RGBA, 0..1. */
export type RGBA = readonly [number, number, number, number];

// ---------------------------------------------------------------------------
// Render quality and output resolution
// ---------------------------------------------------------------------------

export type QualityKey = 'DRAFT' | 'PREVIEW' | 'FINAL';

export interface QualityPreset {
  key: QualityKey;
  label: Label;
  /** Path-tracing samples per pixel. */
  samples: number;
  /** Adaptive-sampling noise threshold (lower is cleaner and slower). */
  threshold: number;
  /** Resolution scale in percent of the chosen output size. */
  resPct: number;
  /** Maximum light bounces. */
  bounces: number;
}

export type ResolutionKey = 'HD' | 'UHD' | 'SQUARE' | 'PORTRAIT' | 'PRINT';

export interface ResolutionPreset {
  key: ResolutionKey;
  label: Label;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

export type LightRole = 'KEY' | 'FILL' | 'RIM' | 'TOP';
export type LightType = 'AREA' | 'SUN';
export type LightShape = 'RECTANGLE' | 'SQUARE' | 'DISK' | 'ELLIPSE';

/**
 * One light of a studio preset or of a light-setup recipe.
 *
 * Azimuth convention: `az` is in degrees RELATIVE TO THE CAMERA AXIS. 0 is
 * behind the camera (the light shines along the view direction), negative is
 * camera-left, positive is camera-right, 180 is behind the part (backlight).
 * `el` is the elevation above the horizon. `dist`, `size` and `sizeY` are in
 * multiples of the part size, so the same recipe fits a ring or a sofa.
 * World azimuth = `az + CAMERA_AZIMUTH_DEG` (see core/light-math.ts).
 */
export interface LightSpec {
  role: LightRole;
  type?: LightType;
  shape?: LightShape;
  /** In part sizes. */
  size: number;
  /** In part sizes; ignored for SQUARE and DISK. */
  sizeY?: number;
  /** Degrees relative to the camera axis (see above). */
  az: number;
  /** Degrees above the horizon. */
  el: number;
  /** Distance in part sizes. */
  dist: number;
  /** Beam spread in degrees: 180 is a fabric diffuser, 60 a honeycomb grid. */
  spread?: number;
  /** Angular diameter of a SUN, in degrees (0.545 is the real sun; EZ Packshot converted to radians only for Blender). */
  angle?: number;
  /** Colour temperature of a white source. Ignored when `color` is set. */
  kelvin?: number;
  /** Explicit colour; wins over `kelvin`. */
  color?: RGB;
  /** Setups: fraction of the total irradiance (shares of a setup sum to 1). */
  share?: number;
  /** Studio presets: watts at part size 1. */
  energy?: number;
  /** Visible in glossy reflections. */
  glossy?: boolean;
  /** A luminous panel the camera does see (bright-field backlight). */
  camera?: boolean;
  /** Legacy mark: take the colour of the active product preset's rig. */
  colorFromPreset?: boolean;
}

/** The defaults a LightSpec falls back to when a field is absent. */
export interface SpecDefaults {
  type: LightType;
  shape: LightShape;
  spread: number;
  angle: number;
  kelvin: number;
  glossy: boolean;
  camera: boolean;
}

/**
 * A light after a recipe has been resolved against a product preset:
 * world azimuth, absolute energy, concrete colour, all defaults filled in.
 */
export interface ResolvedLight {
  role: LightRole;
  type: LightType;
  shape: LightShape;
  size: number;
  sizeY: number;
  /** Degrees in world space (camera-relative az + CAMERA_AZIMUTH_DEG), not wrapped. */
  azimuthWorld: number;
  elevation: number;
  dist: number;
  /** Watts for AREA lights, W/m2 for SUN lights. */
  energy: number;
  color: RGB;
  glossy: boolean;
  camera: boolean;
  spread: number;
  angle: number;
}

export type WorldKind = 'STUDIO' | 'SKY' | 'FLAT';
export type BackgroundMode = 'FLAT' | 'HDRI';

export interface StudioPreset {
  key: string;
  label: Label;
  /** Typical part size in millimetres. */
  sizeMm: number;
  focalMm: number;
  fstop: number;
  /** Environment strength. */
  envStrength: number;
  /** Exposure in EV stops. */
  exposure: number;
  background: BackgroundMode;
  backgroundColor: RGBA;
  floor: boolean;
  shadow: boolean;
  caustics: boolean;
  quality: QualityKey;
  lights: LightSpec[];
}

export type LightStyle =
  | 'PRODUCT'
  | 'TRADITIONAL'
  | 'CINEMATIC'
  | 'CREATIVE'
  | 'EMOTIONAL'
  | 'EXPERIMENTAL'
  | 'SIGNATURE'
  | 'SPICY';

export interface LightStyleEntry {
  key: LightStyle;
  label: Label;
}

export interface LightSetup {
  key: string;
  label: Label;
  intent: Label;
  style: LightStyle;
  world: WorldKind;
  /** `null` only for PRESET, which means "use the product preset's own rig". */
  lights: LightSpec[] | null;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export type MaterialCategory =
  | 'METAL'
  | 'PLASTIC'
  | 'WOOD'
  | 'FABRIC'
  | 'GLASS'
  | 'EMISSIVE'
  | 'OTHER';

/** Which shader recipe a preset needs. A category may hold several families. */
export type MaterialFamily = 'SIMPLE' | 'GLASS' | 'WOOD' | 'FABRIC' | 'EMISSIVE';

export interface MaterialCategoryEntry {
  key: MaterialCategory;
  label: Label;
}

export interface MaterialParams {
  baseColor?: RGBA;
  metallic?: number;
  roughness?: number;
  ior?: number;
  anisotropic?: number;
  coat?: number;
  coatRoughness?: number;
  subsurface?: number;
  transmission?: number;
  /** WOOD: colour 1 is the spring wood (light), colour 2 the summer wood (dark). */
  woodColor1?: RGBA;
  woodColor2?: RGBA;
  ringDensity?: number;
  ringVariation?: number;
  ringNoise?: number;
  axialNoise?: number;
  colorNoise?: number;
  grainStretch?: number;
  poreDepth?: number;
  threadColor1?: RGBA;
  threadColor2?: RGBA;
  /** FABRIC weave pattern: PLAIN, TWILL, SATIN, CANVAS, KNIT or FELT. */
  weave?: string;
  threadCount?: number;
  weaveDepth?: number;
  fuzz?: number;
  fuzzRoughness?: number;
  /** EMISSIVE: BLACKBODY uses `temperature`, COLOR uses `emitColor`. */
  emitKind?: 'BLACKBODY' | 'COLOR';
  /** Kelvin. */
  temperature?: number;
  emitColor?: RGBA;
  emitPower?: number;
  [extra: string]: unknown;
}

export interface MaterialPreset {
  key: string;
  label: Label;
  category: MaterialCategory;
  family: MaterialFamily;
  params: MaterialParams;
}

// ---------------------------------------------------------------------------
// Wear (procedural ageing layer)
// ---------------------------------------------------------------------------

/** The eight wear types. Upstream `rough_var` is `roughVar` here. */
export type WearType =
  | 'edges'
  | 'scratches'
  | 'smudges'
  | 'dust'
  | 'dirt'
  | 'patina'
  | 'roughVar'
  | 'dents';

export interface WearTypeInfo {
  key: WearType;
  label: Label;
  /** One line: how the effect is produced and what it touches. */
  description: Label;
}

/**
 * Every wear property with its meaning. Upstream names carry a `wear_` prefix
 * that is dropped here (`wear_edge_color` is `edgeColor`); the intensity of a
 * wear type is the property with the type's own name, so `props[type]` works.
 * Scales are in part sizes, `refSize` is the reference part size in metres.
 */
export interface WearProps {
  /** Master amount, multiplies all eight types. */
  amount: number;
  scale: number;
  seed: number;
  perObject: boolean;
  /** Reference part size in metres. */
  refSize: number;
  edges: number;
  edgeWidth: number;
  /** Substrate colour exposed on worn edges. */
  edgeColor: RGBA;
  edgeRough: number;
  edgeMetal: number;
  scratches: number;
  scratchScale: number;
  scratchDepth: number;
  smudges: number;
  smudgeScale: number;
  dust: number;
  dustColor: RGBA;
  dirt: number;
  dirtColor: RGBA;
  dirtDistance: number;
  patina: number;
  patinaColor: RGBA;
  patinaScale: number;
  roughVar: number;
  roughScale: number;
  dents: number;
  dentScale: number;
  /** Key of the last one-click basic applied (WEAR_PRESETS), or ''. */
  preset: string;
  accumInside: number;
  accumOutside: number;
  relief: number;
  /** Colour of the groove of a scratch. */
  scratchColor: RGBA;
  colorVar: number;
  colorScale: number;
}

export type WearPatch = Readonly<Partial<WearProps>>;

export interface WearPreset {
  key: string;
  label: Label;
  /** Master amount plus the mix of the eight types. Colours and scales are untouched. */
  props: WearPatch;
}

export interface WearLevel {
  key: 'new' | 'used' | 'old';
  label: Label;
  /** Master amount this quick button sets. */
  amount: number;
}

// ---------------------------------------------------------------------------
// Fuzz and hair
// ---------------------------------------------------------------------------

export type FuzzCurl = 'NO' | 'CURL' | 'WAVE';

export interface FuzzParams {
  /** Fibre length in metres, at the 0.2 m reference part size. */
  length: number;
  /** Random variation of the length, 0..1. */
  lengthVar: number;
  /** Parent fibres per FUZZ_REF_AREA_M2 (one dm2). */
  density: number;
  /** Fibre radius at the root and at the tip, in metres. */
  rootRadius: number;
  tipRadius: number;
  straightness: number;
  frizz: number;
  curl: FuzzCurl;
  curlAmplitude?: number;
  curlFrequency?: number;
  /** Preferred growth direction, when the fibres are combed one way. */
  direction?: readonly [number, number, number];
  gravity: number;
  clump: number;
  /** Segments per fibre. */
  segments: number;
}

export interface FuzzPreset {
  key: string;
  label: Label;
  params: FuzzParams;
}

// ---------------------------------------------------------------------------
// Camera lenses
// ---------------------------------------------------------------------------

export interface LensPreset {
  key: string;
  label: Label;
  focalMm: number;
  fstop: number;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export type MoveKind =
  | 'ORBIT'
  | 'RISE'
  | 'DOLLY'
  | 'TRACK'
  | 'MOVE'
  | 'SPIN'
  | 'TUMBLE'
  | 'SCALE'
  | 'ZOOM'
  | 'FOCUS'
  | 'INTENSITY'
  | 'TINT'
  | 'HDRI'
  | 'EXPLODE'
  | 'VISIBILITY';

export type EasingKind = 'LINEAR' | 'EASE' | 'EASE_IN' | 'EASE_OUT' | 'EASE_STRONG';

/** What a clip animates. */
export type TargetKind = 'OBJECT' | 'SUBJECT' | 'SCENE';

export type ExplodeMode = 'RADIAL' | 'AXIS_X' | 'AXIS_Y' | 'AXIS_Z' | 'CYLINDRICAL' | 'CUSTOM';

export interface MoveItem {
  key: MoveKind;
  label: Label;
  description: Label;
  /** What the clip's single `amount` means for this move, when it has one. */
  amountLabel?: Label;
}

export interface EasingItem {
  key: EasingKind;
  label: Label;
  description: Label;
}

export interface TargetItem {
  key: TargetKind;
  label: Label;
  description: Label;
}

export interface ExplodeItem {
  key: ExplodeMode;
  label: Label;
  description: Label;
}

/**
 * Where a sequence-preset clip points. `CAM` is a preset-only shorthand for
 * "the camera of shot number `shot`" (it becomes an OBJECT target once the
 * shot cameras exist); SUBJECT and SCENE are as in TargetKind.
 */
export type SequenceClipTarget = 'CAM' | 'SUBJECT' | 'SCENE';

export interface SequenceClip {
  move: MoveKind;
  target: SequenceClipTarget;
  /** Index into the preset's `shots` for a CAM target, otherwise null. */
  shot: number | null;
  /** Seconds. */
  start: number;
  /** Seconds. */
  duration: number;
  /** Degrees, percent, factor... see MoveItem.amountLabel. */
  amount: number;
  easing: EasingKind;
}

export interface SequencePreset {
  key: string;
  label: Label;
  /** Duration of each shot in seconds, in order. */
  shots: readonly number[];
  clips: readonly SequenceClip[];
}

// ---------------------------------------------------------------------------
// Scene doctor
// ---------------------------------------------------------------------------

export type DoctorCheckKey =
  | 'engine'
  | 'lighttree'
  | 'denoise'
  | 'color'
  | 'scale'
  | 'transform'
  | 'origin'
  | 'shading'
  | 'bevel'
  | 'clip'
  | 'lights'
  | 'caustics'
  | 'persist'
  | 'output';

/** Descriptor only: what the check looks for and what its one-click fix does. */
export interface DoctorCheck {
  key: DoctorCheckKey;
  label: Label;
  checks: Label;
  fix: Label;
}

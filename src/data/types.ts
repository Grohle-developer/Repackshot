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
/**
 * AREA: a panel (or a glowing sphere, shape SPHERE); POINT: a small round source; SPOT: a point with a cone (L4); SUN: distant;
 * IES (L5): a point whose intensity follows a photometric profile, an IES LM-63 file (`LightInstance.ies`).
 */
export type LightType = 'AREA' | 'POINT' | 'SPOT' | 'SUN' | 'IES';

/**
 * An IES photometric profile as a light carries it (L5): the file's text, one character per byte (core/ies.ts), and the name
 * shown for it (the file's luminaire description, else the file's name). It travels in the project, the studios and the library,
 * so the light opens elsewhere without the file.
 */
export interface IesRef {
  name: string;
  text: string;
}
/** Shapes of an AREA light; SPHERE (L4) glows the same in every direction, like a point light with a size. */
export type LightShape = 'RECTANGLE' | 'SQUARE' | 'DISK' | 'ELLIPSE' | 'SPHERE';

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
  /** SPOT (L4): the soft edge, as a fraction of the cone's half-angle (0 hard, 1 soft from the centre). `spread` is its cone angle. */
  blend?: number;
  /** L4: the light casts shadows (default true). */
  shadow?: boolean;
  /** L4: the point it aims at, in part sizes from the rig's pivot (default: the pivot itself). */
  aim?: [number, number, number];
  /** L4: turn about its own axis, degrees (a panel's long side, default 0: level with the floor). */
  roll?: number;
  /** IES (L5): the photometric profile of an IES light; its `power` is the level, the profile the shape. */
  ies?: IesRef;
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
  /**
   * L6: the set this type's own rig is (light-setups.ts): its lights are the set's, and with the type's own rig
   * (setup PRESET) its decoration and look come too. The set's exposure offset is already in `exposure`.
   */
  set?: string;
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
  | 'SETS'
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

/** The object a set's thumbnail shows (L6): the one the set is designed for. */
export type SetHero = 'BOTTLE' | 'BOX' | 'RING' | 'CHROME' | 'SHOE' | 'SPHERES';

/**
 * What stands behind the product in a set (L6). FLAT: a background colour; GRADIENT: a background image made from
 * two colours, top to bottom; SWEEP: the infinity sweep of U9 (a primitive fitted to the camera), in a matte paper of
 * `color`, which takes light and shadow. Neither FLAT nor GRADIENT is something light can land on: a set with a
 * `pool` and one of them gets a sweep of that colour instead (the pool needs a wall).
 */
export interface SetBackdrop {
  kind: 'FLAT' | 'GRADIENT' | 'SWEEP';
  /** FLAT and SWEEP: the colour (linear RGB). */
  color?: RGB;
  /** GRADIENT: the colour at the top and at the bottom of the frame. */
  top?: RGB;
  bottom?: RGB;
}

/**
 * The pool of light on the backdrop behind the product (L6): a spot aimed from behind the product (`az` / `el`,
 * camera-relative, from the rig pivot) at the backdrop the camera sees over the product; `cone` (degrees) is how wide
 * the pool is (the cone that would light it from POOL_THROW away), `share` its weight among the lights of the set
 * (measured where it lands), white at `kelvin` or of `color` (core/sets.ts).
 */
export interface SetPool {
  az: number;
  el: number;
  cone: number;
  share: number;
  kelvin?: number;
  color?: RGB;
}

/**
 * The floor of a set (L6). CATCHER: the studio's shadow catcher (the default); MATTE: a matte floor of `color` (the
 * sweep's own floor when the backdrop is a sweep, a plane otherwise); GLOSSY and MIRROR: a catalogue material under
 * the product (`material`; the floor of the sweep when there is one, a plane otherwise).
 */
export interface SetFloor {
  kind: 'CATCHER' | 'MATTE' | 'GLOSSY' | 'MIRROR';
  /** MATTE: the colour (linear RGB). */
  color?: RGB;
  /** GLOSSY and MIRROR: the catalogue material. */
  material?: string;
  /** GLOSSY and MIRROR: the sheet's own roughness, over its material's (a softer reflection). */
  roughness?: number;
}

/**
 * A card of a set (L6): a flat primitive of a catalogue material (white, black or silver card) that the product
 * reflects, facing the rig pivot from `az` / `el` / `dist` (camera-relative, part sizes, as a light), `size` wide and
 * `sizeY` tall in part sizes, turned `roll` degrees about its axis. Out of the frame by construction (L6:
 * |az| >= 55 or el >= 60; a test checks it with every product type's focal length).
 */
export interface SetCard {
  material: string;
  az: number;
  el: number;
  dist: number;
  size: number;
  sizeY?: number;
  roll?: number;
}

/** The camera a set suggests (L6): applied only with "Use the set's camera". */
export interface SetCamera {
  /** Elevation above the horizon, degrees. */
  el?: number;
  focalMm?: number;
}

export interface LightSetup {
  key: string;
  label: Label;
  intent: Label;
  style: LightStyle;
  world: WorldKind;
  /** `null` only for PRESET, which means "use the product preset's own rig". */
  lights: LightSpec[] | null;
  // --- L6: a set is a setup with some of these (all optional: the 72 setups before L6 have none) ---
  backdrop?: SetBackdrop;
  pool?: SetPool;
  floor?: SetFloor;
  cards?: SetCard[];
  /** Exposure offset over the product type's, EV. */
  exposureEv?: number;
  /** Strength of the environment (the studio dome) while the set is in force. */
  envStrength?: number;
  /** The camera the set suggests (not applied on its own). */
  camera?: SetCamera;
  /** The object of its thumbnail. */
  hero?: SetHero;
  /** The photographic reason, two sentences (the thumbnail's tooltip). */
  why?: Label;
  /** Caustics matter in this set (its thumbnail renders them; the render's Automatic picks them up). */
  caustics?: boolean;
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
  /** WOOD (E6): Michelson contrast of spring and summer wood (0: the two colours as they are). */
  ringContrast?: number;
  /** WOOD (E6): pore width in mm (0: none); their depth is `poreDepth`. */
  poreSize?: number;
  poreDepth?: number;
  /** WOOD (E6): 1 ring-porous (pores in the spring wood only), 0 diffuse-porous. */
  poreBand?: number;
  /** WOOD (E6): RINGS (default), STRIPS (bamboo), SPECKLE (fibreboard) or STREAKED (ebony). */
  woodFigure?: string;
  /** WOOD (E6): multiplier of the ring spacing (1: the species'). */
  woodScale?: number;
  /** WOOD (E6): knots per piece, 0 to 12 (only woods with rings: woodFigure RINGS). */
  knotCount?: number;
  /** WOOD (E6): diameter of a knot at the middle of the piece, mm (5 to 40). */
  knotSize?: number;
  /** WOOD (E6): variation of the knots' diameter, ± this fraction (0 to 1). */
  knotSizeVar?: number;
  /** WOOD (E6): how much darker a knot is, 0 to 1 (35 % darker at 1). */
  knotDarkness?: number;
  threadColor1?: RGBA;
  threadColor2?: RGBA;
  /** FABRIC weave pattern: PLAIN, TWILL (2/2), SATIN, CANVAS, KNIT, FELT or TWILL31 (3/1, denim; E6). */
  weave?: string;
  /** FABRIC (E6): threads per cm, physical (knit: stitches per cm; felt: fibres of 1/threadCount cm). */
  threadCount?: number;
  /** FABRIC: relief of the threads, 0 to 1 (half a thread spacing at 1). */
  weaveDepth?: number;
  /** FABRIC (E6): how much the yarn's twist shows on the threads, 0 (smooth filaments: carbon tows, mesh) to 1 (default). */
  yarnTwist?: number;
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
  | 'VISIBILITY'
  /** A recorded simulation (S2): the clip carries the baked track and plays it. */
  | 'PHYSICS'
  /** The section view's plane (Q1): its offset along its normal over the clip. */
  | 'SECTION';

export type EasingKind = 'LINEAR' | 'EASE' | 'EASE_IN' | 'EASE_OUT' | 'EASE_STRONG';

/** What a clip animates. */
export type TargetKind = 'OBJECT' | 'SUBJECT' | 'SCENE';

/**
 * How an EXPLODE separates the parts (core/explode.ts). LINEAR, CYLINDRICAL and SPHERICAL are the three geometries
 * of N6; RADIAL is a synonym of SPHERICAL (its meaning since it was ported), AXIS_X/Y/Z are LINEAR (separate) along
 * that axis, CUSTOM (a direction per part) is not built and reads as SPHERICAL.
 */
export type ExplodeMode = 'RADIAL' | 'AXIS_X' | 'AXIS_Y' | 'AXIS_Z' | 'CYLINDRICAL' | 'CUSTOM' | 'LINEAR' | 'SPHERICAL';

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
  /** D1: the SIMD build of the engine runs (not ported; it follows `engine`). */
  | 'simd'
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
  | 'output'
  /** D1: the render's time budget against the speed the engine measured (not ported; it follows `output`). */
  | 'budget'
  | 'aspect'
  /** S2: a dynamic part starts below the floor (not ported). */
  | 'physics'
  /** S4a: an ambient effect asks for more particles than its cap. */
  | 'particles';

/** Descriptor only: what the check looks for and what its one-click fix does. */
export interface DoctorCheck {
  key: DoctorCheckKey;
  label: Label;
  checks: Label;
  fix: Label;
}

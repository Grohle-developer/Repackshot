// Image textures and labels of a material (phase M2a, SPEC §3.3). Pure: no DOM, no three.
//
// A material carries up to six image maps, one per slot (colour, roughness, metal, normal, alpha, emission), a
// mapping they share (each slot may have its own instead), and labels: images with alpha laid on the part by a
// planar projection from where they were placed. The images themselves live in the image registry
// (core/images.ts), as the PNG or JPEG files they came in; a slot or a label keeps an `ImageRef`.
//
// The maths of the projections and of the labels below is the contract the preview's shader (render/
// texture-shader.ts) and the engine (M2b, RSB `MATL` texture block, ARCHITECTURE §5.2) follow: the tests pin it
// here and the shader mirrors it line by line.
//
// Conventions:
//   - Texture coordinates (u, v): u to the right, **v up**; (0, 0) is the bottom-left corner of the image and
//     (1, 1) its top-right (the OBJ, FBX, Collada and USD convention; glTF's v runs down and its reader turns it
//     over). A texel is read at column `u * width` and row `(1 - v) * height` of the image's rows from the top.
//   - Projections work in the part's own space (its mesh coordinates: millimetres, Z up), so a texture moves,
//     turns and scales with the part, and a material shared by several parts sits on each the same way.
//   - Image values multiply the material's own: colour × base colour, roughness × roughness, metal × metal,
//     alpha × opacity (glTF's rule, so an imported material is the file's). Emission is added: tint × image ×
//     strength, radiance (1 is white at exposure 0, as for the engine's film).

import type { ImageRef } from './images';
import { cross, dot, mat4Invert, normalize, rotateAbout, transformDirection, transformPoint, type Mat4, type Vec3 } from './math';
import { nextId } from './ids';
import type { ActionBase, ProjectState } from './store';
import type { MaterialId, MaterialInstance } from './materials';
import { graphImageRefs } from './material-graph';

// --- Vocabulary -------------------------------------------------------------------------------

export type TextureSlotKey = 'color' | 'roughness' | 'metal' | 'normal' | 'alpha' | 'emission';
/** The slots in the order the inspector lists them and the RSB writes them. */
export const TEXTURE_SLOTS: readonly TextureSlotKey[] = ['color', 'roughness', 'metal', 'normal', 'alpha', 'emission'];

export type TextureProjection = 'UV' | 'BOX' | 'PLANAR' | 'CYLINDRICAL' | 'SPHERICAL';
export const TEXTURE_PROJECTIONS: readonly TextureProjection[] = ['UV', 'BOX', 'PLANAR', 'CYLINDRICAL', 'SPHERICAL'];
export type TextureAxis = 'X' | 'Y' | 'Z';
export const TEXTURE_AXES: readonly TextureAxis[] = ['X', 'Y', 'Z'];
/** Past the edge of the image: repeat it, hold its edge pixels, or repeat it mirrored. */
export type TextureWrap = 'REPEAT' | 'CLAMP' | 'MIRROR';
export const TEXTURE_WRAPS: readonly TextureWrap[] = ['REPEAT', 'CLAMP', 'MIRROR'];
/** The channel a scalar slot (roughness, metal, alpha) reads; L is the luminance of the colour. */
export type TextureChannel = 'R' | 'G' | 'B' | 'A' | 'L';
export const TEXTURE_CHANNELS: readonly TextureChannel[] = ['R', 'G', 'B', 'A', 'L'];

/** How an image lands on the part. */
export interface TextureMapping {
  projection: TextureProjection;
  /** PLANAR: the axis it looks along; CYLINDRICAL: the cylinder's axis; SPHERICAL: the poles'. Part axes. */
  axis: TextureAxis;
  /** UV: which set of the mesh (0 the first, 1 the second). */
  uvSet: 0 | 1;
  /**
   * Every projection but UV: millimetres one repeat of the image spans across (its height follows the image's
   * proportions). CYLINDRICAL: the circumference the image is drawn for (one turn is always one repeat across;
   * this sets how tall it is). SPHERICAL ignores it.
   */
  sizeMm: number;
  /** Counter-clockwise, in the image's plane (v up), about the image centre (about uv 0, 0 for UV). */
  rotationDeg: number;
  /** Added after the turn, in repeats (fractions of the image). */
  offset: [number, number];
  /** Repeats per unit (UV) or per `sizeMm` (projections), along u and v. */
  repeat: [number, number];
  wrap: TextureWrap;
}

/** An image in a slot. Every slot has every field; the ones a slot has no use for keep their defaults. */
export interface TextureSlot {
  image: ImageRef;
  /** Its own mapping, or null for the material's. */
  mapping: TextureMapping | null;
  /** Roughness, metal, alpha: the channel read (glTF packs roughness in G and metal in B). */
  channel: TextureChannel;
  /** Roughness, metal, alpha: `1 - value` (a gloss or shininess map as roughness). */
  invert: boolean;
  /** Normal: how much the map bends the normal (glTF `normalTexture.scale`); emission: the radiance multiplier. */
  strength: number;
  /** Normal: the image is a height map (bump), white high, not a tangent-space normal map. */
  height: boolean;
  /** Alpha: a hard cut-out at `cutoff` (glTF `MASK`); otherwise the value is a coverage that blends. */
  cutout: boolean;
  cutoff: number;
  /** Emission: the linear colour the image is multiplied by (glTF `emissiveFactor`). */
  tint: [number, number, number];
}

/** A label: an image with alpha laid on the part, planar from where it was placed, with its own finish. */
export interface TextureLabel {
  id: string;
  image: ImageRef;
  /** Where it sits, in the part's own space (mm), and the surface normal there (unit). */
  origin: Vec3;
  normal: Vec3;
  /** The image's right at rotation 0: unit, perpendicular to `normal`. Its up is `normal × uAxis`. */
  uAxis: Vec3;
  /** Width in mm (of the part's space); the height follows the image's proportions. */
  widthMm: number;
  /** Counter-clockwise about the normal, seen from outside. */
  rotationDeg: number;
  /** How far in front of and behind its plane it reaches, mm; 0: half its larger side. */
  depthMm: number;
  /** Its finish where it covers: roughness, clear coat and how much the paper's edge stands out. */
  roughness: number;
  coat: number;
  relief: number;
}

/** The image textures of a material. */
export interface MaterialTextures {
  color: TextureSlot | null;
  roughness: TextureSlot | null;
  metal: TextureSlot | null;
  normal: TextureSlot | null;
  alpha: TextureSlot | null;
  emission: TextureSlot | null;
  /** What every slot without its own mapping uses. */
  mapping: TextureMapping;
  /** In order: each one over the ones before it. */
  labels: TextureLabel[];
}

// --- Limits -----------------------------------------------------------------------------------

/** The largest texture file kept (the import sheet and Load… refuse larger ones and say so). */
export const TEXTURE_MAX_BYTES = 16 * 1024 * 1024;
/** The texture files of one project together (they travel in the project file, base64). */
export const PROJECT_TEXTURE_MAX_BYTES = 64 * 1024 * 1024;
/** The longest side a texture may have (what any WebGL 2 device can hold). */
export const TEXTURE_MAX_SIDE = 8192;
/** The most labels the Fast preview draws on one material (each is a sampler of its shader); the engine draws them all. */
export const PREVIEW_LABELS_MAX = 6;

// --- Defaults ---------------------------------------------------------------------------------

/** Size of a repeat before a part says otherwise (the size a new instance is made for). */
export const DEFAULT_TEXTURE_SIZE_MM = 100;

export function defaultMapping(sizeMm = DEFAULT_TEXTURE_SIZE_MM): TextureMapping {
  return { projection: 'UV', axis: 'Z', uvSet: 0, sizeMm, rotationDeg: 0, offset: [0, 0], repeat: [1, 1], wrap: 'REPEAT' };
}

export function defaultTextures(): MaterialTextures {
  return { color: null, roughness: null, metal: null, normal: null, alpha: null, emission: null, mapping: defaultMapping(), labels: [] };
}

/** A slot for `image`, with what that slot reads by default. */
export function newSlot(key: TextureSlotKey, image: ImageRef): TextureSlot {
  return {
    image: { ...image },
    mapping: null,
    // A separate greyscale map reads the same in any channel; G is what glTF's packed roughness uses.
    channel: key === 'metal' ? 'B' : key === 'roughness' ? 'G' : key === 'alpha' ? 'A' : 'R',
    invert: false,
    strength: 1,
    height: false,
    cutout: false,
    cutoff: 0.5,
    tint: [1, 1, 1],
  };
}

/** The defaults of a label's finish: matte paper. */
export const LABEL_FINISH = { roughness: 0.6, coat: 0, relief: 0.3 } as const;

export function hasTextures(t: MaterialTextures): boolean {
  return TEXTURE_SLOTS.some((k) => t[k] !== null) || t.labels.length > 0;
}

/** The mapping a slot uses. */
export function slotMapping(t: MaterialTextures, key: TextureSlotKey): TextureMapping {
  return t[key]?.mapping ?? t.mapping;
}

/**
 * The mapping most of a material's slots share (the first of the most common, in slot order), for a reader that
 * found one mapping per map: it becomes the material's, the others the slots' own. Null without any.
 */
export function sharedMapping(mappings: readonly TextureMapping[]): TextureMapping | null {
  let best: TextureMapping | null = null;
  let bestCount = 0;
  const counts = new Map<string, number>();
  for (const m of mappings) {
    const k = JSON.stringify(m);
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    if (n > bestCount) {
      bestCount = n;
      best = m;
    }
  }
  return best ? cloneMapping(best) : null;
}

/** The ids of every image a set of textures uses. */
export function texturesImageIds(t: MaterialTextures): string[] {
  const out: string[] = [];
  for (const k of TEXTURE_SLOTS) {
    const s = t[k];
    if (s && !out.includes(s.image.id)) out.push(s.image.id);
  }
  for (const l of t.labels) if (!out.includes(l.image.id)) out.push(l.image.id);
  return out;
}

/** The images every material of a project uses, by id: its slots, its labels and its graph's image nodes (M3a). */
export function textureImages(state: Pick<ProjectState, 'materials'>): Map<string, ImageRef> {
  const out = new Map<string, ImageRef>();
  for (const m of Object.values(state.materials)) {
    const t = m.textures;
    for (const k of TEXTURE_SLOTS) {
      const s = t[k];
      if (s && !out.has(s.image.id)) out.set(s.image.id, s.image);
    }
    for (const l of t.labels) if (!out.has(l.image.id)) out.set(l.image.id, l.image);
    for (const r of graphImageRefs(m.graph)) if (!out.has(r.id)) out.set(r.id, r);
  }
  return out;
}

function cloneMapping(m: TextureMapping): TextureMapping {
  return { ...m, offset: [m.offset[0], m.offset[1]], repeat: [m.repeat[0], m.repeat[1]] };
}

function cloneSlot(s: TextureSlot): TextureSlot {
  return { ...s, image: { ...s.image }, mapping: s.mapping ? cloneMapping(s.mapping) : null, tint: [s.tint[0], s.tint[1], s.tint[2]] };
}

function cloneLabel(l: TextureLabel): TextureLabel {
  return { ...l, image: { ...l.image }, origin: [...l.origin], normal: [...l.normal], uAxis: [...l.uAxis] };
}

/** A copy that shares no arrays or objects with `t`. */
export function cloneTextures(t: MaterialTextures): MaterialTextures {
  const out = { ...t, mapping: cloneMapping(t.mapping), labels: t.labels.map(cloneLabel) };
  for (const k of TEXTURE_SLOTS) out[k] = t[k] ? cloneSlot(t[k]!) : null;
  return out;
}

// --- Reading what a file or an older version wrote ------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const pair = (v: unknown, fallback: readonly [number, number]): [number, number] =>
  Array.isArray(v) && v.length === 2 ? [finite(v[0], fallback[0]), finite(v[1], fallback[1])] : [fallback[0], fallback[1]];
const vec3 = (v: unknown, fallback: Vec3): Vec3 =>
  Array.isArray(v) && v.length === 3 ? [finite(v[0], fallback[0]), finite(v[1], fallback[1]), finite(v[2], fallback[2])] : [...fallback];
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** `a` at unit length; one that already is (to 1e-9) is returned as it is, so a file read and written keeps its bits. */
function unit(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return Math.abs(l - 1) <= 1e-9 ? a : normalize(a);
}

function imageRefOf(v: unknown): ImageRef | null {
  if (!isObject(v) || typeof v.id !== 'string' || v.id === '' || typeof v.name !== 'string') return null;
  const w = finite(v.width, 0);
  const h = finite(v.height, 0);
  if (!(w > 0 && h > 0)) return null;
  return { id: v.id, name: v.name, width: Math.round(w), height: Math.round(h) };
}

/** A mapping as a file has it, every field checked and kept in range. */
export function normalizeMapping(v: unknown, fallback: TextureMapping = defaultMapping()): TextureMapping {
  if (!isObject(v)) return cloneMapping(fallback);
  const d = fallback;
  const repeat = pair(v.repeat, d.repeat).map((r) => (Math.abs(r) < 1e-4 ? (r < 0 ? -1e-4 : 1e-4) : clamp(r, -1e4, 1e4))) as [number, number];
  return {
    projection: oneOf(v.projection, TEXTURE_PROJECTIONS, d.projection),
    axis: oneOf(v.axis, TEXTURE_AXES, d.axis),
    uvSet: v.uvSet === 1 ? 1 : 0,
    sizeMm: clamp(finite(v.sizeMm, d.sizeMm), 0.01, 1e6),
    rotationDeg: clamp(finite(v.rotationDeg, d.rotationDeg), -3600, 3600),
    offset: pair(v.offset, d.offset).map((o) => clamp(o, -1e4, 1e4)) as [number, number],
    repeat,
    wrap: oneOf(v.wrap, TEXTURE_WRAPS, d.wrap),
  };
}

/** A slot as a file has it; null when it has no usable image (a slot of an older version was a string). */
export function normalizeSlot(key: TextureSlotKey, v: unknown): TextureSlot | null {
  if (!isObject(v)) return null;
  const image = imageRefOf(v.image);
  if (!image) return null;
  const d = newSlot(key, image);
  return {
    image,
    mapping: v.mapping === null || v.mapping === undefined ? null : normalizeMapping(v.mapping),
    channel: oneOf(v.channel, TEXTURE_CHANNELS, d.channel),
    invert: v.invert === true,
    strength: clamp(finite(v.strength, d.strength), 0, 1e4),
    height: v.height === true,
    cutout: v.cutout === true,
    cutoff: clamp(finite(v.cutoff, d.cutoff), 0, 1),
    tint: vec3(v.tint, [1, 1, 1]).map((c) => clamp(c, 0, 1e4)) as [number, number, number],
  };
}

export function normalizeLabel(v: unknown): TextureLabel | null {
  if (!isObject(v) || typeof v.id !== 'string' || v.id === '') return null;
  const image = imageRefOf(v.image);
  if (!image) return null;
  const normal = unit(vec3(v.normal, [0, -1, 0]));
  if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) return null;
  let uAxis = vec3(v.uAxis, [1, 0, 0]);
  // Keep the axis in the label's plane, whatever the file says (one that already is stays bit for bit).
  const k = dot(uAxis, normal);
  if (Math.abs(k) > 1e-9) uAxis = [uAxis[0] - k * normal[0], uAxis[1] - k * normal[1], uAxis[2] - k * normal[2]];
  uAxis = unit(uAxis);
  if (uAxis[0] === 0 && uAxis[1] === 0 && uAxis[2] === 0) uAxis = tangentOf(normal);
  return {
    id: v.id,
    image,
    origin: vec3(v.origin, [0, 0, 0]),
    normal,
    uAxis,
    widthMm: clamp(finite(v.widthMm, 10), 0.01, 1e6),
    rotationDeg: clamp(finite(v.rotationDeg, 0), -3600, 3600),
    depthMm: clamp(finite(v.depthMm, 0), 0, 1e6),
    roughness: clamp(finite(v.roughness, LABEL_FINISH.roughness), 0, 1),
    coat: clamp(finite(v.coat, LABEL_FINISH.coat), 0, 1),
    relief: clamp(finite(v.relief, LABEL_FINISH.relief), 0, 1),
  };
}

/**
 * The textures of a material as a file has them. Before M2a the shape was flat (`color`... as image names that
 * were never filled, and `projection`, `scale`, `rotationDeg`, `offset` for one mapping that nothing drew): its
 * projection, turn and offset become the mapping, its scale the repeat. Anything else that does not fit is
 * dropped, never a reason not to open.
 */
export function normalizeTextures(v: unknown): MaterialTextures {
  const out = defaultTextures();
  if (!isObject(v)) return out;
  if (isObject(v.mapping)) out.mapping = normalizeMapping(v.mapping);
  else {
    const scale = finite(v.scale, 1);
    out.mapping = normalizeMapping({ projection: v.projection, rotationDeg: v.rotationDeg, offset: v.offset, repeat: [scale, scale] });
  }
  for (const k of TEXTURE_SLOTS) out[k] = normalizeSlot(k, v[k]);
  if (Array.isArray(v.labels)) {
    const seen = new Set<string>();
    for (const raw of v.labels) {
      const l = normalizeLabel(raw);
      if (l && !seen.has(l.id)) {
        seen.add(l.id);
        out.labels.push(l);
      }
    }
  }
  return out;
}

// --- Projections ------------------------------------------------------------------------------

/** One way a point reads an image: the texture coordinates before wrapping, and how much it counts. */
export interface ProjectedUv {
  u: number;
  v: number;
  weight: number;
}

/** The planar image axes (right, up) looking along `axis`: Z from above, Y from the front (−Y), X from +X. */
export function planarCoords(axis: TextureAxis, p: readonly number[]): [number, number] {
  if (axis === 'Z') return [p[0], p[1]];
  if (axis === 'Y') return [p[0], p[2]];
  return [p[1], p[2]];
}

/**
 * BOX: the image seen from outside each face, never mirrored: right is +X on the front (normal −Y) and on top,
 * −X on the back and underneath, +Y on the +X side and −Y on the −X side; up is +Z on the sides and +Y on top
 * and underneath.
 */
export function boxCoords(axis: TextureAxis, p: readonly number[], n: readonly number[]): [number, number] {
  if (axis === 'Z') return [n[2] >= 0 ? p[0] : -p[0], p[1]];
  if (axis === 'Y') return [n[1] <= 0 ? p[0] : -p[0], p[2]];
  return [n[0] >= 0 ? p[1] : -p[1], p[2]];
}

/** How much each axis counts in a BOX projection: |n|⁴, normalised (a face square to an axis takes that axis alone). */
export function boxWeights(n: readonly number[]): [number, number, number] {
  const w = [n[0] ** 4, n[1] ** 4, n[2] ** 4];
  const s = w[0] + w[1] + w[2];
  return s > 1e-12 ? [w[0] / s, w[1] / s, w[2] / s] : [0, 0, 1];
}

/** The cross-section axes (S, T) of a cylinder about `axis`; its front (T = −1) is where u is 0.5. */
function sectionAxes(axis: TextureAxis): [number, number, number] {
  // Indices of S, T and the axis in (x, y, z).
  if (axis === 'Z') return [0, 1, 2];
  if (axis === 'X') return [1, 2, 0];
  return [2, 0, 1];
}

/** Turns around `axis`, centred on the front: −0.5 to 0.5, 0 facing T = −1, growing counter-clockwise seen from +axis. */
function turnsAbout(axis: TextureAxis, p: readonly number[]): number {
  const [s, t] = sectionAxes(axis);
  const theta = Math.atan2(p[t], p[s]);
  let c = (theta + Math.PI / 2) / (2 * Math.PI);
  c -= Math.floor(c + 0.5);
  return c;
}

/** `(c ⊙ repeat)` turned and offset, the step every projection ends with. */
export function transformUv(m: TextureMapping, cu: number, cv: number): [number, number] {
  const a = (m.rotationDeg * Math.PI) / 180;
  const x = cu * m.repeat[0];
  const y = cv * m.repeat[1];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * x - s * y + m.offset[0], s * x + c * y + m.offset[1]];
}

/**
 * Where the point `p` of the part (its own space, mm) with normal `n` reads the image of a slot with mapping `m`,
 * for an image `aspect` = width / height: one coordinate pair for every projection but BOX, which blends three
 * by `boxWeights`. UV reads `uv` (the mesh's coordinates of the set the mapping names).
 */
export function projectPoint(m: TextureMapping, p: readonly number[], n: readonly number[], aspect: number, uv: readonly [number, number] = [0, 0]): ProjectedUv[] {
  const w = m.sizeMm;
  const h = m.sizeMm / (aspect > 0 ? aspect : 1);
  const centred = (cu: number, cv: number, weight: number): ProjectedUv => {
    const [u, v] = transformUv(m, cu, cv);
    return { u: u + 0.5, v: v + 0.5, weight };
  };
  switch (m.projection) {
    case 'UV': {
      const [u, v] = transformUv(m, uv[0], uv[1]);
      return [{ u, v, weight: 1 }];
    }
    case 'PLANAR': {
      const [s, t] = planarCoords(m.axis, p);
      return [centred(s / w, t / h, 1)];
    }
    case 'BOX': {
      const weights = boxWeights(n);
      return TEXTURE_AXES.map((axis, i) => {
        const [s, t] = boxCoords(axis, p, n);
        return centred(s / w, t / h, weights[i]);
      }).filter((x) => x.weight > 0);
    }
    case 'CYLINDRICAL': {
      const along = p[sectionAxes(m.axis)[2]];
      return [centred(turnsAbout(m.axis, p), along / h, 1)];
    }
    case 'SPHERICAL': {
      const along = p[sectionAxes(m.axis)[2]];
      const r = Math.hypot(p[0], p[1], p[2]);
      const lat = r > 1e-12 ? Math.asin(Math.max(-1, Math.min(1, along / r))) / Math.PI : 0;
      return [centred(turnsAbout(m.axis, p), lat, 1)];
    }
  }
}

/** A coordinate past the image's edge, brought back by the wrap mode. */
export function wrapCoord(x: number, wrap: TextureWrap): number {
  if (wrap === 'CLAMP') return Math.min(1, Math.max(0, x));
  if (wrap === 'MIRROR') {
    const f = x - 2 * Math.floor(x / 2);
    return f > 1 ? 2 - f : f;
  }
  return x - Math.floor(x);
}

/** The pixel (column, row from the top, both from 0) a wrapped coordinate falls in, for an image of `width` × `height`. */
export function texelOf(u: number, v: number, width: number, height: number): [number, number] {
  const col = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
  const row = Math.min(height - 1, Math.max(0, Math.floor((1 - v) * height)));
  return [col, row];
}

// --- Labels -------------------------------------------------------------------------------------

/** A unit vector perpendicular to `n`, upright where it can be: the part's +Z laid on the plane, else +Y. */
export function tangentOf(n: readonly number[], up: readonly number[] = [0, 0, 1]): Vec3 {
  const candidates: (readonly number[])[] = [up, [0, 0, 1], [0, 1, 0], [1, 0, 0]];
  for (const c of candidates) {
    const k = dot(c, n);
    const onPlane: Vec3 = [c[0] - k * n[0], c[1] - k * n[1], c[2] - k * n[2]];
    const l = Math.hypot(onPlane[0], onPlane[1], onPlane[2]);
    if (l > 0.05) {
      // The image's up is this; its right is up × n (so right × up = n, the label faces out).
      return normalize(cross([onPlane[0] / l, onPlane[1] / l, onPlane[2] / l], n));
    }
  }
  return [1, 0, 0];
}

/** Where a label's image is: its centre, right and up (unit, turned), normal, size and reach. */
export interface LabelFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  normal: Vec3;
  width: number;
  height: number;
  depth: number;
}

/** The frame of a label, for an image `aspect` = width / height. */
export function labelFrame(l: TextureLabel, aspect: number): LabelFrame {
  // `+ 0`: plain zeros, never −0, so equal frames are equal bytes.
  const u = normalize(rotateAbout(l.uAxis, l.normal, l.rotationDeg)).map((x) => x + 0) as Vec3;
  const v = normalize(cross(l.normal, u)).map((x) => x + 0) as Vec3;
  const width = l.widthMm;
  const height = l.widthMm / (aspect > 0 ? aspect : 1);
  const depth = l.depthMm > 0 ? l.depthMm : 0.5 * Math.max(width, height);
  return { origin: [...l.origin], u, v, normal: [...l.normal], width, height, depth };
}

/**
 * Where the point `p` (part space) with normal `n` reads a label's image: (s, t) in 0..1 with t up, or null where
 * the label does not reach: outside the image, farther than its depth from its plane, or on a surface facing away.
 */
export function labelCoords(f: LabelFrame, p: readonly number[], n: readonly number[]): [number, number] | null {
  const d: Vec3 = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  const s = dot(d, f.u) / f.width + 0.5;
  const t = dot(d, f.v) / f.height + 0.5;
  if (s < 0 || s > 1 || t < 0 || t > 1) return null;
  if (Math.abs(dot(d, f.normal)) > f.depth) return null;
  if (dot(n, f.normal) <= 0) return null;
  return [s, t];
}

/**
 * A label placed where the person clicked: the point and the surface normal there (model space, the viewport's
 * pick) brought into the part's own space through the inverse of its world matrix, upright as seen along `viewUp`
 * (model space; the camera's up) where the surface allows.
 */
export function placeLabel(world: Mat4, point: readonly number[], normal: readonly number[], viewUp: readonly number[] = [0, 0, 1]): Pick<TextureLabel, 'origin' | 'normal' | 'uAxis'> {
  const inv = mat4Invert(world);
  const origin = transformPoint(inv, point);
  // Normals go back with the transpose of the world matrix (the inverse of their inverse-transpose).
  const n = normalize([
    world[0] * normal[0] + world[1] * normal[1] + world[2] * normal[2],
    world[4] * normal[0] + world[5] * normal[1] + world[6] * normal[2],
    world[8] * normal[0] + world[9] * normal[1] + world[10] * normal[2],
  ]);
  const up = normalize(transformDirection(inv, viewUp));
  return { origin, normal: n, uAxis: tangentOf(n, up) };
}

/**
 * The width a drag gives a label: twice how far the cursor's point on the surface (part space) is from the label's
 * centre, measured in its plane, the vertical distance counted through the image's proportions.
 */
export function labelWidthFromDrag(l: Pick<TextureLabel, 'origin' | 'normal' | 'uAxis' | 'rotationDeg'>, aspect: number, point: readonly number[], minMm: number): number {
  const f = labelFrame({ ...l, widthMm: 1, depthMm: 0 } as TextureLabel, aspect);
  const d: Vec3 = [point[0] - l.origin[0], point[1] - l.origin[1], point[2] - l.origin[2]];
  const a = Math.abs(dot(d, f.u));
  const b = Math.abs(dot(d, f.v)) * (aspect > 0 ? aspect : 1);
  return Math.max(minMm, 2 * Math.max(a, b));
}

/** The id the next label of `t` gets. */
export function nextLabelId(t: MaterialTextures): string {
  return nextId('lb', t.labels.map((l) => l.id));
}

/** A label as placed, with the default finish. */
export function newLabel(id: string, image: ImageRef, at: Pick<TextureLabel, 'origin' | 'normal' | 'uAxis'>, widthMm: number): TextureLabel {
  return { id, image: { ...image }, origin: [...at.origin], normal: [...at.normal], uAxis: [...at.uAxis], widthMm, rotationDeg: 0, depthMm: 0, ...LABEL_FINISH };
}

// --- Budget -------------------------------------------------------------------------------------

/** Why a texture image was not kept. */
export type TextureDropReason = 'tooLarge' | 'tooManyPixels' | 'format' | 'budget' | 'missing' | 'unreadable';

/** The total size of the distinct texture images the materials use, by the sizes the registry knows. */
export function textureBytesInUse(state: Pick<ProjectState, 'materials'>, sizeOf: (id: string) => number): number {
  let total = 0;
  for (const id of textureImages(state).keys()) total += sizeOf(id);
  return total;
}

// --- Actions ------------------------------------------------------------------------------------

export type TextureAction =
  /** Puts an image in a slot (replacing what was there) or empties it (`value` null). */
  | ({ type: 'texture/setSlot'; material: MaterialId; slot: TextureSlotKey; value: TextureSlot | null } & ActionBase)
  /** Changes how a slot reads its image (channel, strength, cut-out, tint...). */
  | ({ type: 'texture/patchSlot'; material: MaterialId; slot: TextureSlotKey; patch: Partial<Omit<TextureSlot, 'image' | 'mapping'>> } & ActionBase)
  /** Changes the shared mapping, or (with `slot`) that slot's own, made from the shared one when it has none. */
  | ({ type: 'texture/setMapping'; material: MaterialId; slot?: TextureSlotKey; patch: Partial<TextureMapping> } & ActionBase)
  /** The slot drops its own mapping and uses the shared one. */
  | ({ type: 'texture/shareMapping'; material: MaterialId; slot: TextureSlotKey } & ActionBase)
  | ({ type: 'texture/addLabel'; material: MaterialId; value: TextureLabel } & ActionBase)
  | ({ type: 'texture/setLabel'; material: MaterialId; labelId: string; patch: Partial<Omit<TextureLabel, 'id'>> } & ActionBase)
  | ({ type: 'texture/removeLabel'; material: MaterialId; labelId: string } & ActionBase)
  /** Moves a label to position `index` of the list (0: under every other). */
  | ({ type: 'texture/moveLabel'; material: MaterialId; labelId: string; index: number } & ActionBase);

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Applies `fn` to a material's textures; an unchanged result is the same state (no undo entry). Edits make the material the user's own. */
function editTextures(state: ProjectState, id: MaterialId, fn: (t: MaterialTextures, m: MaterialInstance) => MaterialTextures | null): ProjectState {
  const m = state.materials[id];
  if (!m) return state;
  const next = fn(m.textures, m);
  if (!next || sameValue(next, m.textures)) return state;
  const inst: MaterialInstance = { ...m, textures: next, preset: null, edited: true };
  return { ...state, materials: { ...state.materials, [id]: inst } };
}

const withoutUndefined = <T extends object>(patch: Partial<T>): Partial<T> => {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
};

export function reduceTextures(state: ProjectState, action: TextureAction): ProjectState {
  switch (action.type) {
    case 'texture/setSlot':
      return editTextures(state, action.material, (t) => {
        const next = { ...t, [action.slot]: action.value ? cloneSlot(action.value) : null };
        // The first image of a material: one repeat spans the part, so the image is seen whole at once.
        if (action.value && !hasTextures(t)) next.mapping = { ...cloneMapping(t.mapping), sizeMm: state.scene.partSizeMm > 0 ? state.scene.partSizeMm : t.mapping.sizeMm };
        return next;
      });
    case 'texture/patchSlot':
      return editTextures(state, action.material, (t) => {
        const s = t[action.slot];
        if (!s) return null;
        const patch = withoutUndefined(action.patch);
        const merged = { ...s, ...patch };
        if (patch.tint) merged.tint = [patch.tint[0], patch.tint[1], patch.tint[2]];
        return { ...t, [action.slot]: normalizeSlot(action.slot, merged) ?? s };
      });
    case 'texture/setMapping':
      return editTextures(state, action.material, (t) => {
        const patch = withoutUndefined(action.patch);
        if (action.slot) {
          const s = t[action.slot];
          if (!s) return null;
          const mapping = normalizeMapping({ ...(s.mapping ?? t.mapping), ...patch });
          return { ...t, [action.slot]: { ...s, mapping } };
        }
        return { ...t, mapping: normalizeMapping({ ...t.mapping, ...patch }) };
      });
    case 'texture/shareMapping':
      return editTextures(state, action.material, (t) => {
        const s = t[action.slot];
        return s && s.mapping ? { ...t, [action.slot]: { ...s, mapping: null } } : null;
      });
    case 'texture/addLabel':
      return editTextures(state, action.material, (t) => {
        const l = normalizeLabel(action.value);
        if (!l || t.labels.some((x) => x.id === l.id)) return null;
        return { ...t, labels: [...t.labels, l] };
      });
    case 'texture/setLabel':
      return editTextures(state, action.material, (t) => {
        const i = t.labels.findIndex((l) => l.id === action.labelId);
        if (i < 0) return null;
        const l = normalizeLabel({ ...t.labels[i], ...withoutUndefined(action.patch), id: action.labelId });
        if (!l) return null;
        const labels = [...t.labels];
        labels[i] = l;
        return { ...t, labels };
      });
    case 'texture/removeLabel':
      return editTextures(state, action.material, (t) => (t.labels.some((l) => l.id === action.labelId) ? { ...t, labels: t.labels.filter((l) => l.id !== action.labelId) } : null));
    case 'texture/moveLabel':
      return editTextures(state, action.material, (t) => {
        const i = t.labels.findIndex((l) => l.id === action.labelId);
        if (i < 0) return null;
        const to = Math.max(0, Math.min(t.labels.length - 1, Math.round(action.index)));
        if (to === i) return null;
        const labels = [...t.labels];
        const [l] = labels.splice(i, 1);
        labels.splice(to, 0, l);
        return { ...t, labels };
      });
    default:
      return state;
  }
}

// The pass files of a render (phase N2, SPEC §3.8): which passes the render window offers, how a pass becomes the
// numbers of a file (16-bit words for a PNG, floats for an EXR), and how the files are named. Pure: the engine's
// planes (core/passes.ts `RenderPasses`) go in, words and numbers come out; io/passes.ts writes the bytes.
//
// The passes are the engine's (AI-POST.md §7.4, N2's alpha): the four of the brief and nothing else are offered,
// though the engine renders albedo, material id and circle of confusion too. An output key is the engine's key.
//
//   alpha   coverage of the objects, 0..1      PNG: grey 0..65535        EXR: A, as it is
//   depth   distance along the view axis       PNG: grey, 65535 nearest  EXR: Z, as it is (+Infinity on the background)
//   normal  world-space unit normal (Z up)     PNG: RGB, n * 0.5 + 0.5   EXR: R G B, as it is (0 0 0 on the background)
//   partId  RSB instance index + 1             PNG: grey, the id         EXR: Y, the id (a float; exact to 2^24)
//
// In a PNG, depth 0 is the background and 1 the farthest surface, so the picture is a z-depth map (near is white)
// with the range written in the file (`tEXt`, "Depth range"); the ids are clamped at 65534 and the studio floor is
// 65535, in both formats. A legend (`<name>_partId.json`) says which part each id is.

import { FLOOR_ID, type PassKey } from './passes';

/** The passes the render window offers, in the order it lists them. Stable: add at the end. */
export const PASS_OUTPUT_KEYS = ['alpha', 'depth', 'normal', 'partId'] as const;
export type PassOutputKey = (typeof PASS_OUTPUT_KEYS)[number];
/** The file formats of the passes: 16-bit PNG, or OpenEXR (32-bit float, one file per pass). */
export const PASS_FORMATS = ['EXR', 'PNG16'] as const;
export type PassFormat = (typeof PASS_FORMATS)[number];

/** What a render asks of the passes: which, and in which format. No keys: no pass files. */
export interface PassesOutput {
  keys: PassOutputKey[];
  format: PassFormat;
}

/** A new project writes no pass files; when it does, as EXR (the depth and the normals are floats). */
export const NO_PASSES: Readonly<PassesOutput> = Object.freeze({ keys: [], format: 'EXR' });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The passes settings of anything that looks like them (an older project has none; a hand-edited file): known keys
 * only, each once, in the order of `PASS_OUTPUT_KEYS`; an unknown format is `base`'s. Pure, idempotent, and it returns
 * `base` itself when nothing differs (watchers compare by reference).
 */
export function normalisePasses(raw: unknown, base: PassesOutput = NO_PASSES): PassesOutput {
  if (!isRecord(raw)) return base;
  const asked = Array.isArray(raw.keys) ? new Set(raw.keys) : new Set<unknown>(base.keys);
  const keys = PASS_OUTPUT_KEYS.filter((k) => asked.has(k));
  const format = (PASS_FORMATS as readonly unknown[]).includes(raw.format) ? (raw.format as PassFormat) : base.format;
  return format === base.format && keys.length === base.keys.length && keys.every((k, i) => k === base.keys[i]) ? base : { keys, format };
}

/** The engine's pass keys a set of outputs needs, in `PASS_KEYS` order's subset: the output keys are the engine's. */
export function enginePasses(keys: readonly PassOutputKey[]): PassKey[] {
  return [...keys];
}

/** The file extension of a pass format. */
export function passExtension(format: PassFormat): 'png' | 'exr' {
  return format === 'EXR' ? 'exr' : 'png';
}

/**
 * The file name of one pass of an image: the image's name (its template, expanded) with `_<pass>` before the extension
 * and the pass format's extension: `Bottle_Camera 1_0001.png` → `Bottle_Camera 1_0001_depth.exr`. The name of a file
 * without an extension just gets the suffix.
 */
export function passFileName(imageName: string, key: PassOutputKey, format: PassFormat): string {
  return `${stem(imageName)}_${key}.${passExtension(format)}`;
}

/** The part-id legend's file name: the same stem, `.json`. */
export function legendFileName(imageName: string): string {
  return `${stem(imageName)}_partId.json`;
}

/** The names the files of a render's passes will have, in the order they are written: the passes, then the legend. */
export function passFileNames(imageName: string, output: PassesOutput): string[] {
  const names = output.keys.map((k) => passFileName(imageName, k, output.format));
  if (output.keys.includes('partId')) names.push(legendFileName(imageName));
  return names;
}

/** A name without its extension (a dot after the last separator, not at the start). */
function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return dot > slash + 1 ? name.slice(0, dot) : name;
}

// ------------------------------------------------------------------ the numbers of the files

/** The largest id a 16-bit file holds as a part: 65535 is the studio floor. */
export const MAX_PART_ID = 65534;
/** What the studio floor is in the id files (both formats). */
export const FLOOR_VALUE = 65535;

const word = (v: number): number => Math.max(0, Math.min(65535, Math.round(v)));

/** Alpha as 16-bit words: 0 transparent … 65535 covered. */
export function alphaWords(alpha: Float32Array): Uint16Array {
  const out = new Uint16Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) out[i] = word(alpha[i] * 65535);
  return out;
}

/** The nearest and farthest depth of the surfaces in a depth plane (the background is +Infinity); null without any. */
export function depthRange(depth: Float32Array): { near: number; far: number } | null {
  let near = Infinity;
  let far = -Infinity;
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i];
    if (d === Infinity || !(d === d)) continue;
    if (d < near) near = d;
    if (d > far) far = d;
  }
  return near === Infinity ? null : { near, far };
}

/**
 * Depth as 16-bit words, a z-depth map: 0 is the background, the farthest surface 1 and the nearest 65535, linear in
 * the distance in between (all 65535 when every surface is at the same depth).
 */
export function depthWords(depth: Float32Array, range: { near: number; far: number } | null = depthRange(depth)): Uint16Array {
  const out = new Uint16Array(depth.length);
  if (!range) return out;
  const span = range.far - range.near;
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i];
    if (d === Infinity || !(d === d)) continue;
    const t = span > 0 ? (d - range.near) / span : 0;
    out[i] = word(1 + (1 - Math.max(0, Math.min(1, t))) * 65534);
  }
  return out;
}

/** Normals as 16-bit RGB words, `n * 0.5 + 0.5` per channel: the background (0, 0, 0) is the middle grey 32768. */
export function normalWords(normal: Float32Array): Uint16Array {
  const out = new Uint16Array(normal.length);
  for (let i = 0; i < normal.length; i++) out[i] = word((Math.max(-1, Math.min(1, normal[i])) * 0.5 + 0.5) * 65535);
  return out;
}

/** The value an id has in the files: 0 the background, the studio floor 65535, the others as they are, at most 65534. */
export function idValue(id: number): number {
  return id === FLOOR_ID ? FLOOR_VALUE : Math.min(id, MAX_PART_ID);
}

/** Ids as 16-bit words, and how many were above `MAX_PART_ID` and so clamped (parts beyond the 65534th). */
export function idWords(ids: Uint32Array): { words: Uint16Array; clamped: number } {
  const words = new Uint16Array(ids.length);
  let clamped = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id !== FLOOR_ID && id > MAX_PART_ID) clamped++;
    words[i] = idValue(id);
  }
  return { words, clamped };
}

/** Ids as floats for an EXR (the same values as the 16-bit files). */
export function idFloats(ids: Uint32Array): Float32Array {
  const out = new Float32Array(ids.length);
  for (let i = 0; i < ids.length; i++) out[i] = idValue(ids[i]);
  return out;
}

// ------------------------------------------------------------------ the legend of the part ids

/** One part of the legend: its id in the pass, the part and the material it wears. */
export interface LegendPart {
  id: number;
  part: string;
  material: string | null;
}

/** The legend file: what each id of the part-id pass is, as JSON. */
export function partLegend(parts: readonly LegendPart[]): string {
  return `${JSON.stringify({ format: 'repackshot-part-ids', version: 1, background: 0, floor: FLOOR_VALUE, parts }, null, 2)}\n`;
}

/** The note a depth PNG carries, so the picture can be turned back into distances. */
export function depthNote(range: { near: number; far: number } | null): string {
  return range ? `near=${range.near} far=${range.far} (65535 nearest, 1 farthest, 0 background; scene units)` : 'no surface in view (all background)';
}

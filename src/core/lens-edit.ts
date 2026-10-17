// The elements of a traced lens, edited (phase O2c, the triage's 1.5: «editar los elementos, cambiar tamaño o
// distancias entre cada elemento, añadir uno nuevo, rotarlo 180º»). A lens of the catalogue is never edited in place:
// editing starts from a copy of the surfaces the engine traces for it (`startEdit`: the person's coating and variable
// gap already in), kept with the traced lens as `edited` (core/traced-lens.ts), at the design's own scale: the engine
// scales the whole lens to the camera's focal length, as it does a catalogue lens. Pure and without a DOM, so that
// every operation can be tested on the prescription as it is:
//
//   - the list the editor shows (`lensRows`): each glass element (a cemented one says so) and the iris;
//   - the operations, each one prescription in and one out: an element's radii, thickness, glass and clear aperture
//     (`setElement`), its size (`scaleElement`), the air to the next (`setGapAfter`), a new singlet where the person
//     chooses (`insertElement`), deleting one (`deleteElement`), and turning one round (`rotateElement`, which swaps
//     and negates its radii; a cemented group turns as one);
//   - how the lens focuses after them: the catalogue lens's moving gaps followed through the edits, and the whole
//     lens moving as one unit when an edit takes one of them away;
//   - what is wrong with a prescription before the engine is asked (`structuralProblems`: negative gaps, glass with no
//     thickness, rims that cross) and with what the engine makes of it (`refusalProblem`, `engineProblems`: no image,
//     no light through it, the image inside the lens). An invalid lens can still be edited and is never put on a
//     camera (ui/lens-edit-commands.ts).
//
// Nothing here makes a number the interface shows of the lens (rule 10): those are the engine's.

import { LENS_PRESCRIPTIONS, type CoatingId, type LensFocus, type LensGlass, type LensPrescription, type LensSurface } from '../data/lenses';
import type { EngineLensInfo } from './traced-lens';

/** A lens whose elements were edited: what replaces the catalogue's surfaces (TracedLens.edited). */
export interface EditedLens {
  /** The name the person gave it (a copy is named after the lens it came from). */
  name: string;
  /**
   * The prescription as edited, at the design's scale (mm), light from the left, in air before and after; the stop
   * is the surface whose role is `stop`. The same conventions as src/data/lenses.json.
   */
  surfaces: LensSurface[];
  /** How it focuses: the catalogue lens's focus with its moving gaps followed through the edits (unit when one went). */
  focus: LensFocus;
}

/** At most this many surfaces (rt-core accepts 2 to 64). */
export const MAX_SURFACES = 64;

/** True when the elements of `p` can be edited here: a lens that refracts only (no mirror, no cylinder: not the adapter). */
export function editableLens(p: LensPrescription): boolean {
  return p.focus.mode !== 'none' && p.surfaces.every((s) => s.kind !== 'mirror' && s.kind !== 'cylinder');
}

// --- the glasses -------------------------------------------------------------------------------------------------

/**
 * The glasses an element can be made of: every glass of the catalogue's prescriptions (index and Abbe number at the
 * d line, never a maker's name), once each, by index. Clean room: what the lenses of src/data/lenses.json use.
 */
export const LENS_GLASSES: readonly LensGlass[] = /* @__PURE__ */ (() => {
  const seen = new Map<string, LensGlass>();
  for (const p of LENS_PRESCRIPTIONS) for (const s of p.surfaces) if (s.glass && !seen.has(glassKey(s.glass))) seen.set(glassKey(s.glass), { ...s.glass });
  return [...seen.values()].sort((a, b) => a.nd - b.nd || b.vd - a.vd);
})();

/** The key of a glass in the list: its index and Abbe number. */
export function glassKey(g: LensGlass): string {
  return `${g.nd}/${g.vd}`;
}

/** The glass of a new element: the one of the catalogue's single-element lens (a common crown), else the first. */
export function defaultGlass(): LensGlass {
  const single = LENS_PRESCRIPTIONS.find((p) => p.key === 'meniscus_single')?.surfaces.find((s) => s.glass)?.glass;
  return { ...(single ?? LENS_GLASSES[0] ?? { nd: 1.517, vd: 64.2 }) };
}

/** Crown or flint by the Abbe number (the usual line at 50): what the glass list says of each glass. */
export function glassFamily(g: LensGlass): 'crown' | 'flint' {
  return g.vd >= 50 ? 'crown' : 'flint';
}

// --- the list ----------------------------------------------------------------------------------------------------

/** One row of the editor's list: a glass element (between its front and back surfaces) or the iris (a surface in air). */
export type LensRow =
  | {
      kind: 'element';
      /** 1, 2, 3… from the front. */
      number: number;
      front: number;
      back: number;
      /** Cemented to the element before or after it (they share a surface). */
      cementedBefore: boolean;
      cementedAfter: boolean;
    }
  | { kind: 'stop'; surface: number }
  | { kind: 'plane'; surface: number };

/** The rows of a prescription, front to back. */
export function lensRows(surfaces: readonly LensSurface[]): LensRow[] {
  const rows: LensRow[] = [];
  let number = 0;
  let i = 0;
  while (i < surfaces.length) {
    const s = surfaces[i];
    if (s.glass !== null && i + 1 < surfaces.length) {
      const cementedAfter = surfaces[i + 1].glass !== null && i + 2 < surfaces.length;
      rows.push({ kind: 'element', number: ++number, front: i, back: i + 1, cementedBefore: i > 0 && surfaces[i - 1].glass !== null, cementedAfter });
      i += cementedAfter ? 1 : 2;
      continue;
    }
    rows.push(s.role === 'stop' ? { kind: 'stop', surface: i } : { kind: 'plane', surface: i });
    i += 1;
  }
  return rows;
}

/** The elements of a prescription. */
export function lensElements(surfaces: readonly LensSurface[]): Extract<LensRow, { kind: 'element' }>[] {
  return lensRows(surfaces).filter((r): r is Extract<LensRow, { kind: 'element' }> => r.kind === 'element');
}

/** The surface whose distance to the next is the air after row `r` (null when it has none: cemented, or the last). */
export function gapSurfaceOf(surfaces: readonly LensSurface[], r: LensRow): number | null {
  const s = r.kind === 'element' ? (r.cementedAfter ? null : r.back) : r.surface;
  return s === null || s >= surfaces.length - 1 ? null : s;
}

/** The first and last surface of the cemented group element `front` belongs to. */
export function groupOf(surfaces: readonly LensSurface[], front: number): [number, number] {
  let a = front;
  while (a > 0 && surfaces[a - 1].glass !== null) a--;
  let b = front + 1;
  while (b < surfaces.length - 1 && surfaces[b].glass !== null) b++;
  return [a, b];
}

// --- the copy ----------------------------------------------------------------------------------------------------

/** A copy of `surfaces` that shares nothing with it. */
function copySurfaces(surfaces: readonly LensSurface[]): LensSurface[] {
  return surfaces.map((s) => ({
    ...s,
    glass: s.glass ? { ...s.glass, ...(s.glass.native ? { native: { ...s.glass.native } } : {}) } : null,
    ...(s.asphere ? { asphere: { conic: s.asphere.conic, coefficients: [...s.asphere.coefficients] } } : {}),
  }));
}

/**
 * The focus of an edited lens as it is kept: one unit (nothing else said), or internal or floating with its moving
 * gaps (and the names of its two states, which give a floating lens its magnifications).
 */
export function editedFocus(focus: LensFocus): LensFocus {
  const moving = (focus.moving ?? []).map((m) => ({ surface: m.surface, dBase: m.dBase, dNear: m.dNear }));
  if (focus.mode === 'unit' || focus.mode === 'none' || moving.length === 0) return { mode: 'unit' };
  return { mode: focus.mode, moving, ...(focus.base !== undefined ? { base: focus.base } : {}), ...(focus.near !== undefined ? { near: focus.near } : {}) };
}

/** An edited lens of `surfaces` (what the engine traces of a lens: core/traced-lens.ts composeLens) and its focus. */
export function editedFrom(name: string, surfaces: readonly LensSurface[], focus: LensFocus): EditedLens {
  return { name, surfaces: copySurfaces(surfaces), focus: editedFocus(focus) };
}

// --- the operations ----------------------------------------------------------------------------------------------

/**
 * The result of an operation on the surfaces: the new list, and for each air gap of it (the distance after surface
 * g) the gap of the old list it continues, or null for a gap that is new or was made of others (a moving gap that
 * goes there is lost: the lens then focuses as one unit).
 */
interface Rebuilt {
  surfaces: LensSurface[];
  gapFrom: (number | null)[];
}

const identity = (surfaces: LensSurface[]): Rebuilt => ({ surfaces, gapFrom: surfaces.map((_, i) => i) });

/** The edited lens with `r` in it, its focus followed. */
function rebuilt(e: EditedLens, r: Rebuilt): EditedLens {
  const moving = e.focus.moving ?? [];
  if (moving.length === 0) return { ...e, surfaces: r.surfaces };
  const next: NonNullable<LensFocus['moving']> = [];
  for (const m of moving) {
    const g = r.gapFrom.indexOf(m.surface);
    const old = e.surfaces[m.surface]?.d;
    const now = g >= 0 ? r.surfaces[g]?.d : null;
    if (g < 0 || g >= r.surfaces.length - 1 || r.surfaces[g].glass !== null || old === null || old === undefined || now === null || now === undefined) {
      // A moving gap went: the lens moves as one unit (the catalogue's base distances are no longer the lens's).
      return { ...e, surfaces: r.surfaces, focus: { mode: 'unit' } };
    }
    // The gap's travel follows its new value.
    const delta = now - old;
    next.push({ surface: g, dBase: Math.max(0, m.dBase + delta), dNear: Math.max(0, m.dNear + delta) });
  }
  return { ...e, surfaces: r.surfaces, focus: editedFocus({ ...e.focus, moving: next }) };
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** A radius as the prescription keeps it: null (a plane) for 0, a non-number or one beyond ±1e6 mm. */
function radius(r: number | null): number | null {
  return finite(r) && r !== 0 && Math.abs(r) < 1e6 ? r : null;
}

/** A surface with radius `r` (a plane when null; an asphere keeps its kind). */
function withRadius(s: LensSurface, r: number | null): LensSurface {
  const v = radius(r);
  if (v === null) return { ...s, r: null, kind: s.kind === 'asphere' ? 'asphere' : 'plane' };
  return { ...s, r: v, kind: s.kind === 'plane' ? 'sphere' : s.kind };
}

/** What an element edit can change. */
export interface ElementPatch {
  /** The front and back radii, mm (null or 0: a plane). */
  front?: number | null;
  back?: number | null;
  /** The glass's thickness on the axis, mm. */
  thickness?: number;
  glass?: LensGlass;
  /**
   * The clear diameter, mm: both surfaces' semi-apertures scaled so that the larger is half of it (null: both
   * automatic again, the engine sizes them from the beam). `derived` gives the engine's for automatic ones.
   */
  diameter?: number | null;
}

/** The semi-apertures of an element's two surfaces: the prescription's, or the engine's for an automatic one (null when unknown). */
export function elementSemis(surfaces: readonly LensSurface[], front: number, derived?: readonly (number | null)[]): [number | null, number | null] {
  const at = (i: number) => surfaces[i]?.semiAperture ?? derived?.[i] ?? null;
  return [at(front), at(front + 1)];
}

/** Element `front` edited. */
export function setElement(e: EditedLens, front: number, patch: ElementPatch, derived?: readonly (number | null)[]): EditedLens {
  const s = e.surfaces;
  if (!s[front]?.glass || !s[front + 1]) return e;
  const out = copySurfaces(s);
  if (patch.front !== undefined) out[front] = withRadius(out[front], patch.front);
  if (patch.back !== undefined) out[front + 1] = withRadius(out[front + 1], patch.back);
  if (patch.thickness !== undefined && finite(patch.thickness)) out[front] = { ...out[front], d: patch.thickness };
  if (patch.glass && finite(patch.glass.nd) && finite(patch.glass.vd)) out[front] = { ...out[front], glass: { ...patch.glass } };
  if (patch.diameter !== undefined) {
    if (patch.diameter === null) {
      out[front] = { ...out[front], semiAperture: null };
      out[front + 1] = { ...out[front + 1], semiAperture: null };
    } else if (finite(patch.diameter) && patch.diameter > 0) {
      const [a, b] = elementSemis(s, front, derived);
      const largest = Math.max(a ?? 0, b ?? 0);
      const half = patch.diameter / 2;
      const k = largest > 0 ? half / largest : 1;
      out[front] = { ...out[front], semiAperture: a !== null && largest > 0 ? a * k : half };
      out[front + 1] = { ...out[front + 1], semiAperture: b !== null && largest > 0 ? b * k : half };
    }
  }
  return rebuilt(e, identity(out));
}

/**
 * Element `front` made `factor` times as wide (its clear aperture; its curvature and thickness stay): an automatic
 * semi-aperture becomes the engine's times the factor; one the engine has not told stays automatic.
 */
export function scaleElement(e: EditedLens, front: number, factor: number, derived?: readonly (number | null)[]): EditedLens {
  if (!e.surfaces[front]?.glass || !(finite(factor) && factor > 0)) return e;
  const out = copySurfaces(e.surfaces);
  const [a, b] = elementSemis(e.surfaces, front, derived);
  if (a !== null) out[front] = { ...out[front], semiAperture: a * factor };
  if (b !== null) out[front + 1] = { ...out[front + 1], semiAperture: b * factor };
  return rebuilt(e, identity(out));
}

/** The air after surface `surface` (the distance to the next surface) set to `d`, mm. */
export function setGapAfter(e: EditedLens, surface: number, d: number): EditedLens {
  const s = e.surfaces[surface];
  if (!s || s.glass !== null || surface >= e.surfaces.length - 1 || !finite(d)) return e;
  const out = copySurfaces(e.surfaces);
  out[surface] = { ...s, d };
  return rebuilt(e, identity(out));
}

/** The coating of new air–glass surfaces: the one most of the lens's have (multi-layer when none has one). */
export function lensCoating(surfaces: readonly LensSurface[]): CoatingId {
  const count = new Map<CoatingId, number>();
  for (const s of surfaces) if (s.coating) count.set(s.coating, (count.get(s.coating) ?? 0) + 1);
  let best: CoatingId = 'multi';
  let n = 0;
  for (const [c, k] of count) if (k > n) [best, n] = [c, k];
  return best;
}

/** What a new element is: its radii (front, back), thickness and glass. */
export interface Singlet {
  front: number | null;
  back: number | null;
  thickness: number;
  glass: LensGlass;
  /** Its clear semi-aperture, mm (null or absent: automatic, the engine sizes it to the beam). */
  semiAperture?: number | null;
}

/**
 * The element `insertElement` adds when nothing else is said: a weak equiconvex singlet of the default glass, its
 * radii four times the lens's focal length and its thickness 4 % of it (between 1 and 12 mm): a positive element
 * that changes the lens a little. `focal` is the design's focal length (the engine's, or the catalogue's).
 */
export function defaultSinglet(focal: number): Singlet {
  const f = finite(focal) && focal > 0 ? focal : 100;
  const r = Math.round(4 * f);
  return { front: r, back: -r, thickness: Math.round(10 * Math.min(12, Math.max(1, 0.04 * f))) / 10, glass: defaultGlass() };
}

/** Where a new element goes: in front of the first surface, or after row `after` of `lensRows` (after its group). */
export type InsertAt = { front: true } | { after: number };

/** The surfaces either side of where `at` puts a new element: the one before it and the one after it (null at the ends). */
export function insertionNeighbours(e: EditedLens, at: InsertAt): [number | null, number | null] {
  const s = e.surfaces;
  if ('front' in at) return [null, 0];
  const row = lensRows(s)[at.after];
  if (!row) return [null, null];
  const g = row.kind === 'element' ? groupOf(s, row.front)[1] : row.surface;
  return [g, g >= s.length - 1 ? null : g + 1];
}

/**
 * The clear semi-aperture a new element at `at` takes: as wide as the narrower of its neighbours (theirs, or the
 * engine's for an automatic one, at the design's scale); null when neither is known (it is then automatic).
 */
export function insertionAperture(e: EditedLens, at: InsertAt, derived?: readonly (number | null)[]): number | null {
  const semis = insertionNeighbours(e, at)
    .filter((i): i is number => i !== null)
    .map((i) => e.surfaces[i].semiAperture ?? derived?.[i] ?? null)
    .filter((v): v is number => finite(v) && v > 0);
  return semis.length > 0 ? Math.min(...semis) : null;
}

/** The air surface `b` needs after surface `a` so that they are `margin` apart up to height `h` (on the axis when 0). */
function airFor(a: LensSurface, b: LensSurface, h: number, margin: number): number {
  const top = Math.min(h, a.semiAperture ?? h, b.semiAperture ?? h);
  let worst = 0;
  for (let k = 1; k <= 8 && top > 0; k++) {
    const y = (top * k) / 8;
    worst = Math.min(worst, sagOf(b, y) - sagOf(a, y));
  }
  return margin - worst;
}

/**
 * A new element in the lens. In the air after a row it sits in the middle of the gap when the gap is wide enough for
 * it and some air either side, at the rims too (the rest of the lens stays where it was); otherwise the lens grows
 * to make room. In front, or after the last element, it stands `air` away (the design's 5 %). An element with a
 * clear aperture is made at least thick enough for its own edge.
 */
export function insertElement(e: EditedLens, at: InsertAt, singlet: Singlet, focal: number): EditedLens {
  const s = e.surfaces;
  if (s.length + 2 > MAX_SURFACES) return e;
  const f = finite(focal) && focal > 0 ? focal : 100;
  const air = Math.round(50 * f) / 1000;
  const margin = Math.max(0.1, Math.round(10 * f) / 1000);
  const semi = finite(singlet.semiAperture) && singlet.semiAperture > 0 ? singlet.semiAperture : null;
  const h = semi ?? 0;
  const coat = lensCoating(s);
  const front0 = withRadius({ kind: 'sphere', r: null, d: 0, glass: { ...singlet.glass }, semiAperture: semi, role: 'normal', coating: coat }, singlet.front);
  const back0 = withRadius({ kind: 'sphere', r: null, d: null, glass: null, semiAperture: semi, role: 'normal', coating: coat }, singlet.back);
  const t = Math.max(finite(singlet.thickness) && singlet.thickness > 0 ? singlet.thickness : 1, h > 0 ? airFor(front0, back0, h, margin) : 0);
  const make = (gapAfter: number | null): [LensSurface, LensSurface] => [
    { ...front0, d: Math.round(1e4 * t) / 1e4 },
    { ...back0, d: gapAfter === null ? null : Math.round(1e4 * gapAfter) / 1e4 },
  ];
  const old = copySurfaces(s);
  if ('front' in at) {
    const surfaces = [...make(Math.max(air, airFor(back0, old[0], h, margin))), ...old];
    return rebuilt(e, { surfaces, gapFrom: surfaces.map((_, i) => (i < 2 ? null : i - 2)) });
  }
  const [g, next] = insertionNeighbours(e, at);
  if (g === null) return e;
  const gap = old[g].d;
  let before: number;
  let after: number | null;
  if (next === null) {
    before = Math.max(air, airFor(old[g], front0, h, margin));
    after = gap;
  } else {
    before = airFor(old[g], front0, h, margin);
    after = airFor(back0, old[next], h, margin);
    const room = (finite(gap) ? gap : 0) - before - t - after;
    if (room > 0) {
      before += room / 2;
      after += room / 2;
    }
  }
  old[g] = { ...old[g], d: Math.round(1e4 * before) / 1e4 };
  const surfaces = [...old.slice(0, g + 1), ...make(after), ...old.slice(g + 1)];
  // The gap that was split is new on both sides; the ones after it move two places along.
  return rebuilt(e, { surfaces, gapFrom: surfaces.map((_, i) => (i < g ? i : i <= g + 2 ? null : i - 2)) });
}

/**
 * Element `front` taken out. A single element in air: its glass and the air on either side become one gap, so the
 * rest of the lens stays where it was. One of a cemented group: the others stay cemented, its shared surface goes
 * with it (the last of a group leaves its neighbour's back in air). A lens keeps at least one element.
 */
export function deleteElement(e: EditedLens, front: number): EditedLens {
  const s = e.surfaces;
  const rows = lensElements(s);
  const row = rows.find((r) => r.front === front);
  if (!row || rows.length <= 1) return e;
  const old = copySurfaces(s);
  const n = s.length;
  const dropped = (removed: number[], merged: number | null): Rebuilt => {
    const surfaces = old.filter((_, i) => !removed.includes(i));
    const from = old.map((_, i) => i).filter((i) => !removed.includes(i));
    return { surfaces, gapFrom: from.map((i, k) => (merged !== null && k === merged ? null : i)) };
  };
  const t = s[front].d ?? 0;
  if (!row.cementedBefore && !row.cementedAfter) {
    const afterGap = s[row.back].d;
    if (front > 0) {
      const prev = s[front - 1].d ?? 0;
      old[front - 1] = { ...old[front - 1], d: row.back >= n - 1 ? afterGap : prev + t + (afterGap ?? 0) };
      return rebuilt(e, dropped([front, row.back], front - 1));
    }
    return rebuilt(e, dropped([front, row.back], null));
  }
  if (!row.cementedBefore) {
    // The first of a group: the next element's front is the shared surface; the air before takes the thickness.
    if (front > 0) old[front - 1] = { ...old[front - 1], d: (s[front - 1].d ?? 0) + t };
    return rebuilt(e, dropped([front], front > 0 ? front - 1 : null));
  }
  if (!row.cementedAfter) {
    // The last of a group: the shared surface is the element before's back, now in air.
    const afterGap = s[row.back].d;
    old[front] = { ...old[front], glass: null, coating: lensCoating(s), d: row.back >= n - 1 ? afterGap : t + (afterGap ?? 0) };
    return rebuilt(e, dropped([row.back], front));
  }
  // In the middle of a group: the glass before goes straight on to the one after.
  return rebuilt(e, dropped([front], null));
}

/** An asphere's sag turned round: the conic stays, the coefficients change sign with the radius. */
function turnedAsphere(a: LensSurface['asphere']): LensSurface['asphere'] {
  return a ? { conic: a.conic, coefficients: a.coefficients.map((c) => -c) } : undefined;
}

/**
 * Element `front` turned round 180° about an axis across the lens: its surfaces in the opposite order with their
 * radii negated (a singlet's front radius becomes minus its back's, and the other way), the glasses and thicknesses
 * in the opposite order, its coatings and clear apertures with their surfaces. A cemented element turns with its
 * group (they are one piece of glass). It stays in the same place: the air before and after are as they were.
 */
export function rotateElement(e: EditedLens, front: number): EditedLens {
  const s = e.surfaces;
  if (!s[front]?.glass) return e;
  const [a, b] = groupOf(s, front);
  const out = copySurfaces(s);
  const k = b - a;
  for (let j = 0; j <= k; j++) {
    const src = s[b - j];
    const r = src.r === null ? null : -src.r;
    const { asphere: _a, ...rest } = src;
    const turned = src.asphere ? turnedAsphere(src.asphere) : undefined;
    out[a + j] = {
      ...rest,
      r,
      glass: j < k ? (s[b - 1 - j].glass ? { ...s[b - 1 - j].glass! } : null) : null,
      d: j < k ? s[b - 1 - j].d : s[b].d,
      ...(turned ? { asphere: turned } : {}),
    };
  }
  return rebuilt(e, identity(out));
}

/** The edited lens renamed. */
export function renameEdited(e: EditedLens, name: string): EditedLens {
  const v = name.trim().slice(0, 64);
  return v && v !== e.name ? { ...e, name: v } : e;
}

// --- what is wrong ------------------------------------------------------------------------------------------------

/** Why a prescription cannot be put on a camera. `row` is the index into `lensRows` it is about, when there is one. */
export type LensProblemCode =
  /** Fewer than 2 or more than 64 surfaces. */
  | 'surfaces'
  /** No glass at all. */
  | 'noElement'
  /** A glass thickness that is not positive. */
  | 'thickness'
  /** A negative air gap. */
  | 'gap'
  /** A number that is not one (never reaches the engine). */
  | 'number'
  /** A clear aperture wider than its surface's sphere. */
  | 'radius'
  /** Not exactly one stop. */
  | 'stop'
  /** The engine: the lens forms no real image (it diverges, or is afocal). */
  | 'noImage'
  /** The engine: no light gets through on the axis (an element or the iris blocks it). */
  | 'blocked'
  /** The engine: the image falls inside the lens. */
  | 'inside'
  /** An element's two surfaces cross inside its clear aperture (its edge is thinner than nothing). */
  | 'edge'
  /** Two neighbouring elements overlap inside their clear apertures. */
  | 'overlap'
  /** The engine refused it for another reason, in its own words (`detail`). */
  | 'engine';

export interface LensProblem {
  code: LensProblemCode;
  row?: number;
  /** The engine's own words, for `engine`. */
  detail?: string;
}

/** The row a surface belongs to (an element's front or back, the iris). */
function rowOfSurface(rows: readonly LensRow[], surface: number): number | undefined {
  const i = rows.findIndex((r) => (r.kind === 'element' ? surface === r.front || (surface === r.back && !r.cementedAfter) : r.surface === surface));
  return i >= 0 ? i : undefined;
}

/** What is wrong with a prescription on its own (before the engine is asked): the engine is only asked about one with none. */
export function structuralProblems(e: EditedLens): LensProblem[] {
  const s = e.surfaces;
  const out: LensProblem[] = [];
  if (s.length < 2 || s.length > MAX_SURFACES) out.push({ code: 'surfaces' });
  const rows = lensRows(s);
  if (!rows.some((r) => r.kind === 'element')) out.push({ code: 'noElement' });
  if (s.filter((x) => x.role === 'stop').length !== 1) out.push({ code: 'stop' });
  if (s.length > 0 && s[s.length - 1].glass !== null) out.push({ code: 'noElement' });
  s.forEach((x, i) => {
    const row = rowOfSurface(rows, i);
    const bad = (x.r !== null && !finite(x.r)) || (x.d !== null && !finite(x.d)) || (x.semiAperture !== null && !(finite(x.semiAperture) && x.semiAperture >= 0));
    const glassBad = x.glass !== null && !(finite(x.glass.nd) && x.glass.nd >= 1 && x.glass.nd <= 3 && finite(x.glass.vd) && x.glass.vd >= 0);
    if (bad || glassBad) {
      out.push({ code: 'number', row });
      return;
    }
    if (i < s.length - 1) {
      if (x.glass !== null && !((x.d ?? 0) > 0)) out.push({ code: 'thickness', row });
      if (x.glass === null && (x.d ?? 0) < 0) out.push({ code: 'gap', row });
    }
    if (x.r !== null && x.semiAperture !== null && x.semiAperture > Math.abs(x.r)) out.push({ code: 'radius', row });
  });
  return out.length > 0 ? out : rimProblems(s, rows);
}

/** The engine's reason for refusing a lens as one of ours (its words are English and stay in `detail`). */
export function refusalProblem(reason: string): LensProblem {
  const r = reason.toLowerCase();
  if (r.includes('real image') || r.includes('afocal')) return { code: 'noImage' };
  if (r.includes('no light passes')) return { code: 'blocked' };
  return { code: 'engine', detail: reason };
}

/** The sag of a surface of a prescription at height `y` (sphere, conic and even asphere), mm from its vertex. */
function sagOf(s: LensSurface, y: number): number {
  const c = s.r === null ? 0 : 1 / s.r;
  const conic = s.kind === 'asphere' ? (s.asphere?.conic ?? 0) : 0;
  const y2 = y * y;
  let z = 0;
  if (c !== 0) z = (c * y2) / (1 + Math.sqrt(Math.max(0, 1 - (1 + conic) * c * c * y2)));
  let yk = y2 * y2;
  for (const a of s.kind === 'asphere' ? (s.asphere?.coefficients ?? []) : []) {
    z += a * yk;
    yk *= y2;
  }
  return z;
}

/** The least distance along the axis between surfaces `a` and `b` (`d` apart on the axis) at heights up to `h`. */
function leastSpacing(a: LensSurface, b: LensSurface, d: number, h: number): number {
  let worst = Infinity;
  for (let k = 0; k <= 8; k++) {
    const y = (h * k) / 8;
    worst = Math.min(worst, d + sagOf(b, y) - sagOf(a, y));
  }
  return worst;
}

/**
 * Where the clear apertures the prescription gives make the lens impossible: an element whose two surfaces cross
 * inside the smaller of their apertures (its edge thinner than nothing), and two neighbouring elements that overlap
 * inside theirs. Only surfaces with an aperture of their own are checked (the engine sizes the others to the beam).
 */
function rimProblems(s: readonly LensSurface[], rows: readonly LensRow[]): LensProblem[] {
  const out: LensProblem[] = [];
  const elements = rows.map((r, i) => [r, i] as const).filter(([r]) => r.kind === 'element') as [Extract<LensRow, { kind: 'element' }>, number][];
  const semi = (i: number) => s[i].semiAperture;
  for (const [r, i] of elements) {
    const a = semi(r.front);
    const b = semi(r.back);
    if (a !== null && b !== null && finite(s[r.front].d) && leastSpacing(s[r.front], s[r.back], s[r.front].d!, Math.min(a, b)) < -1e-3) out.push({ code: 'edge', row: i });
  }
  for (let k = 0; k + 1 < elements.length; k++) {
    const [r] = elements[k];
    const [next, j] = elements[k + 1];
    if (r.cementedAfter || next.front !== r.back + 1) continue;
    const a = semi(r.back);
    const b = semi(next.front);
    if (a !== null && b !== null && finite(s[r.back].d) && leastSpacing(s[r.back], s[next.front], s[r.back].d!, Math.min(a, b)) < -1e-3) out.push({ code: 'overlap', row: j });
  }
  return out;
}

/** What is wrong with what the engine prepared of a lens: the image inside the lens (behind its last vertex there is none). */
export function engineProblems(info: EngineLensInfo): LensProblem[] {
  return info.sensorMm > 0 ? [] : [{ code: 'inside' }];
}

/** The scale the camera puts on the design (its focal length over the design's), from the engine's numbers; null without them. */
export function designScale(info: EngineLensInfo | null | undefined): number | null {
  const d = info?.designEflMm;
  return info && finite(d) && d > 0 && finite(info.eflMm) && info.eflMm > 0 ? info.eflMm / d : null;
}

/** The semi-aperture of each surface as the engine sized it, at the design's scale (null where it has not told). */
export function derivedSemis(e: EditedLens, info: EngineLensInfo | null | undefined): (number | null)[] {
  const k = designScale(info);
  const sec = info?.section;
  if (!k || !sec || sec.surfaces.length !== e.surfaces.length) return e.surfaces.map(() => null);
  return sec.surfaces.map((s) => (finite(s.semiAperture) ? s.semiAperture / k : null));
}

/**
 * The image circle the lens gives the frame, from the engine's relative illumination over the frame's half
 * diagonal: the diameter out to the last height with light, and whether that is the whole frame.
 */
export function imageCircle(info: EngineLensInfo): { diameterMm: number; covers: boolean } | null {
  const ri = info.relativeIllumination;
  if (ri.length === 0) return null;
  let last = 0;
  for (const [h, v] of ri) if (v > 0.001) last = h;
  const corner = ri[ri.length - 1][0];
  return { diameterMm: 2 * last, covers: last >= corner };
}

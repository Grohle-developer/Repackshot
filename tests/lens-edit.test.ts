// The lens editor's operations on a prescription (phase O2c, core/lens-edit.ts), what they do to the lens as the
// engine sees it (with the real rt.wasm: the focal length and back focus of the design, the distortion), what is wrong
// with an invalid lens and why, the copy and its undo through the store (ui/lens-edit-commands.ts), and the edited lens
// in the project file and in the library.

import { describe, expect, it } from 'vitest';
import { makeCamera, type CameraState } from '../src/core/camera';
import {
  defaultSinglet,
  deleteElement,
  derivedSemis,
  designScale,
  editableLens,
  editedFrom,
  engineProblems,
  gapSurfaceOf,
  imageCircle,
  insertElement,
  insertionAperture,
  LENS_GLASSES,
  lensElements,
  lensRows,
  refusalProblem,
  renameEdited,
  rotateElement,
  scaleElement,
  setElement,
  setGapAfter,
  structuralProblems,
  type EditedLens,
} from '../src/core/lens-edit';
import { OPTICS_NEUTRAL, opticsOf, tracedOf, type CameraOptics } from '../src/core/optics';
import { createStore } from '../src/core/store';
import { composeLens, newTracedLens, normalizeTracedLens, startEdit, type EngineLensInfo, type TracedLens } from '../src/core/traced-lens';
import { LENS_PRESCRIPTIONS, lensPrescription, type LensSurface } from '../src/data/lenses';
import { lensInfoRsb, lensToRsb } from '../src/io/rsb';
import { hasLensInfoExport, readLensVerdict, type LensVerdict } from '../src/render/lens-info';
import { addElement, applyLensDraft, discardLensDraft, editLens, editorLens, insertPlace, openLensEditor } from '../src/ui/lens-edit-commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { createUiStore } from '../src/ui/ui-state';
import { exampleState } from './helpers';
import { loadRt, RT_WASM } from './wasm-engine';

const CROWN = { nd: 1.517, vd: 64.2 };
const FLINT = { nd: 1.62, vd: 36.4 };
const surf = (r: number | null, d: number | null, glass: { nd: number; vd: number } | null, extra: Partial<LensSurface> = {}): LensSurface => ({
  kind: r === null ? 'plane' : 'sphere',
  r,
  d,
  glass,
  semiAperture: null,
  role: 'normal',
  coating: 'multi',
  ...extra,
});
const stop = (d: number): LensSurface => ({ kind: 'plane', r: null, d, glass: null, semiAperture: 12, role: 'stop', coating: null });
const lens = (surfaces: LensSurface[]): EditedLens => ({ name: 'Test', surfaces, focus: { mode: 'unit' } });
/** A stop in front of one element. */
const singlet = (front: number | null, back: number | null, thickness = 5, glass = CROWN) => lens([stop(5), surf(front, thickness, glass), surf(back, null, null)]);
/** The edited copy of a catalogue lens. */
const copyOf = (key: string): EditedLens => startEdit(newTracedLens(key), 'Copy')!.edited!;
/** Vertex positions along the axis. */
const vertices = (s: readonly LensSurface[]) => s.reduce<number[]>((z, _x, i) => [...z, i === 0 ? 0 : z[i - 1] + (s[i - 1].d ?? 0)], []);

describe('the elements of a lens', () => {
  it('lists every element (cemented ones say so) and the iris, and copies only lenses that refract', () => {
    const dg = copyOf('double_gauss_normal');
    expect(lensRows(dg.surfaces).map((r) => (r.kind === 'element' ? `${r.number}${r.cementedAfter ? 'c' : ''}` : r.kind))).toEqual(['1', '2c', '3', 'stop', '4c', '5', '6']);
    expect(lensElements(copyOf('achromat_doublet').surfaces).map((r) => [r.front, r.back, r.cementedBefore, r.cementedAfter])).toEqual([
      [1, 2, false, true],
      [2, 3, true, false],
    ]);
    // The adapter (cylinders) and the mirror lens cannot be edited here; the copy of any other is the lens as traced.
    expect(LENS_PRESCRIPTIONS.filter((p) => !editableLens(p)).map((p) => p.key)).toEqual(['catadioptric_mirror', 'anamorphic_adapter_2x']);
    expect(startEdit(newTracedLens('anamorphic_adapter_2x'), 'x')).toBeNull();
    const soft = startEdit({ ...newTracedLens('soft_focus_variable'), variable: 3.3, coating: 'none' }, 'Soft copy')!;
    expect(soft.edited!.surfaces).toEqual(composeLens({ ...newTracedLens('soft_focus_variable'), variable: 3.3, coating: 'none' })!.surfaces);
    expect([soft.variable, soft.edited!.name]).toEqual([null, 'Soft copy']);
    // Every catalogue lens that can be edited is a valid lens as copied.
    for (const p of LENS_PRESCRIPTIONS.filter(editableLens)) expect(structuralProblems(copyOf(p.key)), p.key).toEqual([]);
  });

  it('turns an element 180°: its radii swap and change sign, its glass and place stay; twice is the lens again', () => {
    const e = singlet(80, -300, 6);
    const r = rotateElement(e, 1);
    expect(r.surfaces.map((s) => [s.r, s.d, s.glass])).toEqual([
      [null, 5, null],
      [300, 6, CROWN],
      [-80, null, null],
    ]);
    expect(rotateElement(r, 1)).toEqual(e);
    // A plane turned round is a plane; a biconvex lens is itself.
    expect(rotateElement(singlet(null, -50), 1).surfaces.map((s) => s.r)).toEqual([null, 50, null]);
    expect(rotateElement(singlet(60, -60), 1).surfaces).toEqual(singlet(60, -60).surfaces);
    // A cemented doublet turns as one piece: the flint goes in front, the shared surface negated, the air after kept.
    const d = copyOf('achromat_doublet');
    const t = rotateElement(d, 2);
    expect(t).toEqual(rotateElement(d, 1));
    expect(t.surfaces.slice(1).map((s) => [s.r, s.glass?.nd ?? null])).toEqual([
      [-d.surfaces[3].r!, d.surfaces[2].glass!.nd],
      [-d.surfaces[2].r!, d.surfaces[1].glass!.nd],
      [-d.surfaces[1].r!, null],
    ]);
    expect([t.surfaces[1].d, t.surfaces[2].d, t.surfaces[3].d]).toEqual([d.surfaces[2].d, d.surfaces[1].d, d.surfaces[3].d]);
    expect(t.surfaces[0]).toEqual(d.surfaces[0]);
    // The iris is not an element: nothing turns.
    expect(rotateElement(d, 0)).toBe(d);
  });

  it('edits an element’s radii, thickness, glass and clear aperture, and sizes it', () => {
    const e = singlet(80, -300, 6);
    const x = setElement(e, 1, { front: 90, back: 0, thickness: 7.5, glass: FLINT });
    expect(x.surfaces.slice(1).map((s) => [s.kind, s.r, s.glass])).toEqual([
      ['sphere', 90, FLINT],
      ['plane', null, null],
    ]);
    expect(x.surfaces[1].d).toBe(7.5);
    // A plane given a radius is a sphere again.
    expect(setElement(x, 1, { back: -120 }).surfaces[2].kind).toBe('sphere');
    // The diameter: both apertures scaled so that the larger is half of it (their ratio kept); null is automatic.
    const sized = setElement(setElement(e, 1, { diameter: 20 }), 1, { diameter: 30 });
    expect([sized.surfaces[1].semiAperture, sized.surfaces[2].semiAperture]).toEqual([15, 15]);
    const uneven = { ...e, surfaces: e.surfaces.map((s, i) => (i === 1 ? { ...s, semiAperture: 10 } : i === 2 ? { ...s, semiAperture: 8 } : s)) };
    const u = setElement(uneven, 1, { diameter: 30 });
    expect([u.surfaces[1].semiAperture, u.surfaces[2].semiAperture]).toEqual([15, 12]);
    expect([setElement(u, 1, { diameter: null }).surfaces[1].semiAperture, setElement(u, 1, { diameter: null }).surfaces[2].semiAperture]).toEqual([null, null]);
    // Larger and smaller: the apertures times the factor; an automatic one from the engine's, or left automatic.
    const big = scaleElement(uneven, 1, 1.1);
    expect([big.surfaces[1].semiAperture, big.surfaces[2].semiAperture].map((v) => +v!.toFixed(6))).toEqual([11, 8.8]);
    expect(scaleElement(e, 1, 1.1).surfaces[1].semiAperture).toBeNull();
    expect(scaleElement(e, 1, 2, [12, 9, 9]).surfaces.map((s) => s.semiAperture)).toEqual([12, 18, 18]);
    // What is not a number changes nothing.
    expect(setElement(e, 1, { thickness: Number.NaN, glass: { nd: Number.NaN, vd: 3 } })).toEqual(e);
    expect(scaleElement(e, 1, Number.NaN)).toBe(e);
    expect(setGapAfter(e, 0, Number.POSITIVE_INFINITY)).toBe(e);
  });

  it('changes the air to the next element, and nowhere else', () => {
    const dg = copyOf('double_gauss_normal');
    const rows = lensRows(dg.surfaces);
    const g = gapSurfaceOf(dg.surfaces, rows[0])!;
    const x = setGapAfter(dg, g, 4.25);
    expect(x.surfaces[g].d).toBe(4.25);
    expect(x.surfaces.filter((_, i) => i !== g)).toEqual(dg.surfaces.filter((_, i) => i !== g));
    // A cemented element has no air after it; the last has the back focus, which is the engine's.
    expect(gapSurfaceOf(dg.surfaces, rows[1])).toBeNull();
    expect(gapSurfaceOf(dg.surfaces, rows[rows.length - 1])).toBeNull();
    // Glass is not air.
    expect(setGapAfter(dg, 0, 3)).toBe(dg);
  });

  it('adds a default singlet where it is asked, in the middle of a wide gap or pushing the lens apart', () => {
    const f = 100;
    const s = defaultSinglet(f);
    expect(s).toEqual({ front: 400, back: -400, thickness: 4, glass: { nd: 1.517, vd: 64.2, vdEstimated: true } });
    // In a wide gap: in its middle, and every vertex after it where it was.
    const wide = lens([stop(5), surf(60, 6, CROWN), surf(-200, 30, null), surf(-80, 4, FLINT), surf(200, null, null)]);
    const z0 = vertices(wide.surfaces);
    const a = insertElement(wide, { after: 1 }, s, f);
    expect(a.surfaces).toHaveLength(7);
    expect(a.surfaces[2].d).toBe(13);
    expect(a.surfaces[3]).toMatchObject({ r: 400, d: 4, glass: s.glass, semiAperture: null });
    expect(a.surfaces[4]).toMatchObject({ r: -400, d: 13, glass: null });
    const z1 = vertices(a.surfaces);
    expect([z1[5], z1[6]]).toEqual([z0[3], z0[4]]);
    expect(lensElements(a.surfaces).map((r) => r.number)).toEqual([1, 2, 3]);
    // A narrow gap: some air either side of it, and the lens longer.
    const narrow = setGapAfter(wide, 2, 1);
    const b = insertElement(narrow, { after: 1 }, s, f);
    expect([b.surfaces[2].d, b.surfaces[4].d]).toEqual([1, 1]);
    expect(vertices(b.surfaces)[5] - vertices(narrow.surfaces)[3]).toBeCloseTo(5, 9);
    // In front, and after the last element: 5 % of the focal length away; the back focus stays the last surface's.
    const front = insertElement(wide, { front: true }, s, f);
    expect([front.surfaces[0].r, front.surfaces[1].d, front.surfaces[2]]).toEqual([400, 5, wide.surfaces[0]]);
    const back = insertElement(wide, { after: 2 }, s, f);
    expect([back.surfaces[4].d, back.surfaces[6].d]).toEqual([5, null]);
    // Never into a cemented group: before its first element, after its last.
    const dg = copyOf('double_gauss_normal');
    expect(insertPlace(dg, 1, 'before')).toEqual({ after: 0 });
    expect(insertPlace(dg, 2, 'before')).toEqual({ after: 0 });
    expect(insertPlace(dg, 0, 'before')).toEqual({ front: true });
    const c = insertElement(dg, { after: 1 }, s, f);
    expect(lensRows(c.surfaces).map((r) => (r.kind === 'element' ? `${r.number}${r.cementedAfter ? 'c' : ''}` : r.kind))).toEqual(['1', '2c', '3', '4', 'stop', '5c', '6', '7']);
  });

  it('makes a new element as wide as its neighbours, clear of them at the rims, wherever it goes', () => {
    for (const key of ['double_gauss_normal', 'triplet', 'symmetric_5', 'achromat_doublet']) {
      const e = copyOf(key);
      const rows = lensRows(e.surfaces);
      for (let r = -1; r < rows.length; r++) {
        const at = r < 0 ? ({ front: true } as const) : { after: r };
        const semi = insertionAperture(e, at);
        const x = insertElement(e, at, { ...defaultSinglet(100), semiAperture: semi }, 100);
        expect(x.surfaces.length, `${key} ${r}`).toBe(e.surfaces.length + 2);
        expect(structuralProblems(x), `${key} after row ${r}`).toEqual([]);
      }
    }
    // Its aperture: the narrower neighbour's, the engine's for an automatic one; none known, automatic.
    const e = lens([stop(5), surf(60, 6, CROWN, { semiAperture: 14 }), surf(-200, 30, null, { semiAperture: 13 }), surf(-80, 4, FLINT), surf(200, null, null)]);
    expect(insertionAperture(e, { after: 1 })).toBe(13);
    expect(insertionAperture(e, { after: 1 }, [null, null, null, 11, null])).toBe(11);
    expect(insertionAperture(lens([stop(5), surf(60, 6, CROWN), surf(-200, null, null)]), { after: 1 })).toBeNull();
    // Thick enough for its own edge.
    const fat = insertElement(e, { after: 1 }, { front: 20, back: -20, thickness: 1, glass: CROWN, semiAperture: 13 }, 100);
    expect(structuralProblems(fat)).toEqual([]);
    expect(fat.surfaces[3].d!).toBeGreaterThan(10);
  });

  it('deletes an element: a single one leaves the rest where it was; one of a cemented group leaves the others cemented', () => {
    const wide = lens([stop(5), surf(60, 6, CROWN), surf(-200, 30, null), surf(-80, 4, FLINT), surf(200, null, null)]);
    const z0 = vertices(wide.surfaces);
    const a = deleteElement(wide, 1);
    expect(a.surfaces).toHaveLength(3);
    expect(a.surfaces[0].d).toBe(41);
    expect(vertices(a.surfaces)[1]).toBe(z0[3]);
    // The last one: the element before it ends the lens.
    expect(deleteElement(wide, 3).surfaces.map((s) => s.d)).toEqual([5, 6, null]);
    // The only element is never deleted.
    expect(deleteElement(deleteElement(wide, 3), 1).surfaces).toHaveLength(3);
    // A cemented doublet: deleting the crown leaves the flint, deleting the flint leaves the crown's back in air.
    const d = copyOf('achromat_doublet');
    const noCrown = deleteElement(d, 1);
    expect(noCrown.surfaces.map((s) => [s.r, s.glass?.nd ?? null])).toEqual([
      [null, null],
      [d.surfaces[2].r, d.surfaces[2].glass!.nd],
      [d.surfaces[3].r, null],
    ]);
    expect(noCrown.surfaces[0].d).toBe(d.surfaces[0].d! + d.surfaces[1].d!);
    const noFlint = deleteElement(d, 2);
    expect(noFlint.surfaces.map((s) => [s.r, s.glass?.nd ?? null, s.coating])).toEqual([
      [null, null, null],
      [d.surfaces[1].r, d.surfaces[1].glass!.nd, d.surfaces[1].coating],
      [d.surfaces[2].r, null, 'single'],
    ]);
    expect(structuralProblems(noCrown)).toEqual([]);
    expect(structuralProblems(noFlint)).toEqual([]);
  });

  it('follows the focusing gaps of an internal-focus lens, and focuses as one unit when an edit takes one away', () => {
    const tele = copyOf('telephoto_internal_focus');
    const moving = tele.focus.moving!;
    expect(tele.focus.mode).toBe('internal');
    // Editing a focusing gap moves its travel with it.
    const g = moving[0].surface;
    const x = setGapAfter(tele, g, tele.surfaces[g].d! + 1);
    expect(x.focus.moving![0]).toEqual({ surface: g, dBase: moving[0].dBase + 1, dNear: moving[0].dNear + 1 });
    // An element added in front: the gaps move two surfaces along.
    const front = insertElement(tele, { front: true }, defaultSinglet(100), 100);
    expect(front.focus.moving!.map((m) => m.surface)).toEqual(moving.map((m) => m.surface + 2));
    // Turning an element round keeps the gaps around it.
    expect(rotateElement(tele, 0).focus).toEqual(tele.focus);
    // An element added inside a focusing gap: the lens moves as one unit.
    const rows = lensRows(tele.surfaces);
    const inGap = rows.findIndex((r) => gapSurfaceOf(tele.surfaces, r) === g);
    expect(inGap).toBeGreaterThanOrEqual(0);
    expect(insertElement(tele, { after: inGap }, defaultSinglet(100), 100).focus).toEqual({ mode: 'unit' });
    expect(normalizeTracedLens({ ...newTracedLens('telephoto_internal_focus'), edited: x })!.edited!.focus).toEqual(x.focus);
  });

  it('says what is wrong with a lens before the engine is asked, and where', () => {
    const e = lens([stop(5), surf(60, 6, CROWN), surf(-200, 3, null), surf(-80, 4, FLINT), surf(200, null, null)]);
    expect(structuralProblems(e)).toEqual([]);
    expect(structuralProblems(setGapAfter(e, 2, -0.5))).toEqual([{ code: 'gap', row: 1 }]);
    expect(structuralProblems(setGapAfter(e, 0, -1))).toEqual([{ code: 'gap', row: 0 }]);
    expect(structuralProblems(setElement(e, 3, { thickness: 0 }))).toEqual([{ code: 'thickness', row: 2 }]);
    expect(structuralProblems({ ...e, surfaces: e.surfaces.map((s, i) => (i === 1 ? { ...s, r: Number.NaN } : s)) })).toEqual([{ code: 'number', row: 1 }]);
    // A clear aperture wider than the surface's sphere; two surfaces that cross inside the aperture: the edge.
    expect(structuralProblems(setElement(e, 1, { diameter: 130 }))[0]).toEqual({ code: 'radius', row: 1 });
    expect(structuralProblems(setElement(setElement(e, 1, { thickness: 0.5 }), 1, { diameter: 40 }))).toEqual([{ code: 'edge', row: 1 }]);
    // Two elements that run into each other inside their apertures.
    const close = setElement(setElement(setGapAfter(setElement(setElement(e, 1, { back: 40 }), 3, { front: -40 }), 2, 0.2), 1, { diameter: 30 }), 3, { diameter: 30 });
    expect(structuralProblems(close).map((p) => p.code)).toContain('overlap');
    expect(structuralProblems({ ...e, surfaces: e.surfaces.map((s) => ({ ...s, role: 'normal' as const })) })).toEqual([{ code: 'stop' }]);
    // The engine's words as a reason the editor can say.
    expect(refusalProblem('RSB section LENS is invalid: the prescription does not form a real image')).toEqual({ code: 'noImage' });
    expect(refusalProblem('RSB section LENS is invalid: no real image at infinity')).toEqual({ code: 'noImage' });
    expect(refusalProblem('RSB section LENS is invalid: the prescription is afocal')).toEqual({ code: 'noImage' });
    expect(refusalProblem('RSB section LENS is invalid: no light passes the lens on its axis')).toEqual({ code: 'blocked' });
    expect(refusalProblem('something else')).toEqual({ code: 'engine', detail: 'something else' });
    expect(engineProblems({ sensorMm: -2 } as EngineLensInfo)).toEqual([{ code: 'inside' }]);
    expect(engineProblems({ sensorMm: 40 } as EngineLensInfo)).toEqual([]);
    // The glasses: every one of the catalogue once, by index; renaming trims and refuses an empty name.
    expect(new Set(LENS_GLASSES.map((g) => `${g.nd}/${g.vd}`)).size).toBe(LENS_GLASSES.length);
    expect(LENS_GLASSES.every((g, i) => i === 0 || g.nd >= LENS_GLASSES[i - 1].nd)).toBe(true);
    expect(renameEdited(e, '  Mine  ').name).toBe('Mine');
    expect(renameEdited(e, '   ')).toBe(e);
  });
});

describe.skipIf(!RT_WASM)('the edited lens as the real engine sees it', () => {
  const camera = (t: TracedLens): CameraState => ({ ...makeCamera('cam1', '', 200), focalMm: 50, fstop: 4, focusDistance: 3000, optics: { ...OPTICS_NEUTRAL, traced: t } });
  const ask = async (e: EditedLens, key = 'meniscus_single'): Promise<LensVerdict> => {
    const rt = await loadRt();
    if (!hasLensInfoExport(rt)) throw new Error('rt.wasm without lens information');
    return readLensVerdict(rt, lensInfoRsb(camera({ ...newTracedLens(key), edited: e }), 640, 480));
  };
  const info = async (e: EditedLens, key?: string): Promise<EngineLensInfo> => {
    const v = await ask(e, key);
    if (v.state !== 'ready') throw new Error(`refused: ${JSON.stringify(v)}`);
    return v.info;
  };

  it('tells the design’s focal length, which the camera scales; every catalogue copy is a lens it traces', async () => {
    for (const p of LENS_PRESCRIPTIONS.filter(editableLens)) {
      const i = await info(copyOf(p.key), p.key);
      expect(i.eflMm, p.key).toBeCloseTo(50, 2);
      expect(Math.abs(i.designEflMm - (p.reported.eflMm ?? 0)) / (p.reported.eflMm ?? 1), p.key).toBeLessThan(5e-3);
      expect(designScale(i)! * i.designEflMm, p.key).toBeCloseTo(50, 3);
      expect(engineProblems(i), p.key).toEqual([]);
      expect(imageCircle(i)?.covers, p.key).toBe(true);
      // The automatic apertures as the engine sized them, at the design's scale.
      expect(derivedSemis(copyOf(p.key), i).every((v) => v !== null && v > 0), p.key).toBe(true);
    }
  }, 120000);

  it('turning an equiconvex lens round changes nothing; an asymmetric one keeps its focal length, not its back focus or its aberrations', async () => {
    const bi = singlet(80, -80, 8);
    const [a, b] = [await info(bi), await info(rotateElement(bi, 1))];
    expect([b.designEflMm, b.bflMm, b.distortion]).toEqual([a.designEflMm, a.bflMm, a.distortion]);
    // A strongly bent element (plano-convex), the curved side towards the subject and then towards the sensor.
    const pc = singlet(50, null, 8);
    const [c, d] = [await info(pc), await info(rotateElement(pc, 1))];
    expect(Math.abs(d.designEflMm - c.designEflMm) / c.designEflMm).toBeLessThan(1e-4);
    // Its back focus moves by the shift of its rear principal plane: from the curved front vertex to the curved back
    // one, t / n for a plano-convex lens (the curved side at the front, BFL = f − t / n; at the back, BFL = f).
    const n = CROWN.nd;
    const scale = designScale(c)!;
    expect((d.bflMm - c.bflMm) / scale).toBeCloseTo(8 / n, 1);
    // And it bends the rays otherwise: another distortion, another falloff towards the corner.
    expect(d.distortion).not.toEqual(c.distortion);
    const corner = (x: EngineLensInfo) => x.distortion[x.distortion.length - 1][1];
    expect(Math.abs(corner(d) - corner(c))).toBeGreaterThan(0.01);
    // A cemented achromat turned round: the same focal length, another back focus.
    const ach = copyOf('achromat_doublet');
    const [e, f] = [await info(ach, 'achromat_doublet'), await info(rotateElement(ach, 1), 'achromat_doublet')];
    expect(Math.abs(f.designEflMm - e.designEflMm) / e.designEflMm).toBeLessThan(1e-4);
    expect(Math.abs(f.bflMm - e.bflMm)).toBeGreaterThan(0.5);
  }, 120000);

  it('adding a positive element shortens the focal length of the design, deleting it gives it back', async () => {
    const dg = copyOf('double_gauss_normal');
    const base = await info(dg, 'double_gauss_normal');
    const added = insertElement(dg, { front: true }, defaultSinglet(base.designEflMm), base.designEflMm);
    const more = await info(added, 'double_gauss_normal');
    expect(more.designEflMm).toBeLessThan(base.designEflMm * 0.97);
    expect(more.elements).toBe(base.elements + 1);
    expect((await info(deleteElement(added, 0), 'double_gauss_normal')).designEflMm).toBe(base.designEflMm);
  }, 120000);

  it('takes a new element wherever it goes in any lens of the catalogue: valid, traced, one more element', async () => {
    for (const p of LENS_PRESCRIPTIONS.filter(editableLens)) {
      const e = copyOf(p.key);
      const base = await info(e, p.key);
      const derived = derivedSemis(e, base);
      const rows = lensRows(e.surfaces);
      for (let r = -1; r < rows.length; r++) {
        const at = r < 0 ? ({ front: true } as const) : { after: r };
        const x = insertElement(e, at, { ...defaultSinglet(base.designEflMm), semiAperture: insertionAperture(e, at, derived) }, base.designEflMm);
        expect(structuralProblems(x), `${p.key} after row ${r}`).toEqual([]);
        const v = await ask(x, p.key);
        expect(v.state, `${p.key} after row ${r}`).toBe('ready');
        if (v.state !== 'ready') continue;
        expect(engineProblems(v.info), `${p.key} after row ${r}`).toEqual([]);
        expect(v.info.elements, `${p.key} after row ${r}`).toBe(base.elements + 1);
      }
    }
  }, 240000);

  it('says why it refuses a lens: no real image, or afocal; never a number that is not one', async () => {
    const neg = await ask(singlet(-100, 100));
    expect(neg.state).toBe('refused');
    expect(neg.state === 'refused' && refusalProblem(neg.reason).code).toBe('noImage');
    const flat = await ask(singlet(null, null));
    expect(flat.state === 'refused' && refusalProblem(flat.reason).code).toBe('noImage');
    // Every number of a lens the engine took is a number.
    const ok = await info(singlet(60, -200));
    const all = [ok.eflMm, ok.designEflMm, ok.bflMm, ok.fNumber, ok.tStop, ok.lengthMm, ...ok.distortion.flat(), ...ok.relativeIllumination.flat()];
    expect(all.every(Number.isFinite)).toBe(true);
  }, 120000);
});

describe('the copy in the store (ui/lens-edit-commands.ts)', () => {
  const setup = () => {
    const store = createStore(exampleState());
    const camId = store.get().camera.active;
    const cam0 = store.get().camera.cameras[camId];
    store.dispatch({ type: 'camera/set', id: camId, patch: { optics: { ...opticsOf(cam0), traced: newTracedLens('double_gauss_normal') } } });
    const ctx: Ctx = { store, ui: createUiStore(), services: {} as AppServices };
    const cam = () => store.get().camera.cameras[camId];
    const newCopy = () => copyOf('double_gauss_normal');
    return { store, ctx, camId, cam, newCopy, undos: () => store.history().undo.length };
  };

  it('copies the lens on the first edit, one undo entry per edit or gesture, and never touches the catalogue', () => {
    const catalogue = JSON.stringify(LENS_PRESCRIPTIONS);
    const { store, ctx, camId, cam, newCopy, undos } = setup();
    const before = undos();
    expect(openLensEditor(ctx, camId)).toBe(true);
    expect(ctx.ui.get().lensEditor).toEqual({ camera: camId });
    expect([cam().lensDraft, undos()]).toEqual([undefined, before]);
    // One edit: the copy, with its name, and one entry; the camera's lens is untouched.
    expect(editLens(ctx, camId, (e) => rotateElement(e, 0), 'lensEditor.op.rotate')).toBe(true);
    expect(cam().lensDraft?.edited?.name).toBe('Double-Gauss normal (edited)');
    expect(tracedOf(opticsOf(cam()))).toEqual(newTracedLens('double_gauss_normal'));
    expect(undos()).toBe(before + 1);
    // A drag: many changes, one gesture, one entry.
    for (const v of [3, 3.5, 4, 4.5]) editLens(ctx, camId, (e) => setGapAfter(e, 1, v), 'lensEditor.op.gap', 'drag-1');
    expect(undos()).toBe(before + 2);
    expect(cam().lensDraft!.edited!.surfaces[1].d).toBe(4.5);
    // Nothing changed, nothing recorded.
    expect(editLens(ctx, camId, (e) => setGapAfter(e, 1, 4.5), 'lensEditor.op.gap')).toBe(false);
    expect(undos()).toBe(before + 2);
    // Undo: the gap back, then no copy at all.
    store.undo();
    expect(cam().lensDraft!.edited!.surfaces[1].d).toBe(newCopy().surfaces[1].d);
    store.undo();
    expect(cam().lensDraft).toBeUndefined();
    expect(editorLens(cam())).toEqual(newTracedLens('double_gauss_normal'));
    expect(JSON.stringify(LENS_PRESCRIPTIONS)).toBe(catalogue);
    // Adding through the command: after the chosen row, its element the one after it.
    expect(addElement(ctx, camId, 0, 'after', defaultSinglet(100), 100)).toBe(true);
    expect(lensElements(cam().lensDraft!.edited!.surfaces)).toHaveLength(7);
  });

  it('applies only the lens the engine checked, as one entry, and discards a copy', () => {
    const { store, ctx, camId, cam, undos } = setup();
    editLens(ctx, camId, (e) => rotateElement(e, 0), 'lensEditor.op.rotate');
    const draft = cam().lensDraft!;
    // A lens other than the copy (an older check) is refused.
    expect(applyLensDraft(ctx, camId, { ...draft, edited: rotateElement(draft.edited!, 0) })).toBe(false);
    expect(tracedOf(opticsOf(cam()))?.edited).toBeUndefined();
    const n = undos();
    expect(applyLensDraft(ctx, camId, draft)).toBe(true);
    expect([tracedOf(opticsOf(cam())), cam().lensDraft, undos()]).toEqual([draft, undefined, n + 1]);
    // The engine is sent the edited surfaces.
    const sent = lensToRsb(opticsOf(cam()), 640, 480).prescription!;
    expect(sent.surfaces.map((s) => s.radius)).toEqual(draft.edited!.surfaces.map((s) => s.r ?? 0));
    store.undo();
    expect([tracedOf(opticsOf(cam()))?.edited, cam().lensDraft]).toEqual([undefined, draft]);
    discardLensDraft(ctx, camId);
    expect(cam().lensDraft).toBeUndefined();
    store.undo();
    expect(cam().lensDraft).toEqual(draft);
    // A camera with the simple lens, or a lens that cannot be edited, does not open the editor.
    const thin = createStore(exampleState());
    const thinCtx: Ctx = { store: thin, ui: createUiStore(), services: {} as AppServices };
    expect(openLensEditor(thinCtx, thin.get().camera.active)).toBe(false);
    thin.dispatch({ type: 'camera/set', id: thin.get().camera.active, patch: { optics: { ...OPTICS_NEUTRAL, traced: newTracedLens('catadioptric_mirror') } } });
    expect(openLensEditor(thinCtx, thin.get().camera.active)).toBe(false);
    expect(thinCtx.ui.get().lensEditor).toBeNull();
  });
});

describe('the edited lens in the project and the library', () => {
  it('goes through the project file and back, with its name, its focus and the copy being edited', async () => {
    const { parseProject, serializeProject } = await import('../src/io/project');
    const store = createStore(exampleState());
    const camId = store.get().camera.active;
    const e = renameEdited(rotateElement(copyOf('telephoto_internal_focus'), 0), 'My tele');
    const applied: TracedLens = { ...newTracedLens('telephoto_internal_focus'), coating: 'single', edited: e };
    const draft: TracedLens = { ...applied, edited: setGapAfter(e, e.focus.moving![0].surface, 9) };
    store.dispatch({ type: 'camera/set', id: camId, patch: { optics: { ...opticsOf(store.get().camera.cameras[camId]), traced: applied }, lensDraft: draft } });
    const back = parseProject(await serializeProject(store.get()).text());
    expect(tracedOf(back.camera.cameras[camId].optics)).toEqual(applied);
    expect(back.camera.cameras[camId].lensDraft).toEqual(draft);
    // A lens of before O2c stays byte for byte as it was: no `edited`, no `lensDraft`.
    expect(JSON.stringify(normalizeTracedLens(newTracedLens('triplet')))).toBe(JSON.stringify(newTracedLens('triplet')));
    // Edited surfaces that cannot be read open as the catalogue lens; a copy that cannot be read is dropped.
    const raw = JSON.parse(await serializeProject(store.get()).text());
    const cam = raw.state?.camera?.cameras?.[camId] ?? raw.camera?.cameras?.[camId];
    cam.optics.traced.edited.surfaces[1].d = 'thick';
    cam.lensDraft.edited = { surfaces: [] };
    const damaged = parseProject(JSON.stringify(raw));
    expect(tracedOf(damaged.camera.cameras[camId].optics)?.edited).toBeUndefined();
    expect(tracedOf(damaged.camera.cameras[camId].optics)?.key).toBe('telephoto_internal_focus');
    expect('lensDraft' in damaged.camera.cameras[camId]).toBe(false);
  });

  it('is saved to the library as a lens of one’s own and comes back the same; a damaged one is refused', async () => {
    const { emptyLibrary, fromCameraLens, opticsWithLensItem, addItem, itemsOf, renameItem } = await import('../src/core/library');
    const { exportLibrary, importLibrary } = await import('../src/io/library');
    const e = renameEdited(insertElement(copyOf('triplet'), { front: true }, defaultSinglet(100), 100), 'Four');
    const optics: CameraOptics = { ...OPTICS_NEUTRAL, traced: { ...newTracedLens('triplet'), edited: e }, blades: 7 };
    const item = fromCameraLens(emptyLibrary(), optics, 'Four', { id: 'lns-1', now: 1 })!;
    expect(item.lens.traced.edited).toEqual(e);
    const lib = renameItem(addItem(emptyLibrary(), item), 'lens', 'lns-1', 'Four, renamed');
    const again = importLibrary(exportLibrary(lib), emptyLibrary());
    expect(itemsOf(again.lib, 'lens').map((i) => [i.name, i.lens.traced.edited])).toEqual([['Four, renamed', e]]);
    expect(opticsWithLensItem(OPTICS_NEUTRAL, itemsOf(again.lib, 'lens')[0]).traced).toEqual(optics.traced);
    const bad = JSON.parse(exportLibrary(lib));
    bad.items[0].lens.traced.edited.surfaces = 'none';
    const refused = importLibrary(JSON.stringify(bad), emptyLibrary());
    expect([itemsOf(refused.lib, 'lens').length, refused.skipped[0]?.code]).toEqual([0, 'invalid']);
    // An edited lens keeps the catalogue key it came from (its iris, its source), never a new key.
    expect(lensPrescription(item.lens.traced.key)?.key).toBe('triplet');
    expect(editedFrom('x', e.surfaces, e.focus)).toEqual({ ...e, name: 'x' });
  });
});

describe('around the editor', () => {
  it('draws the chosen element stronger and numbers the elements in the section', async () => {
    const { lensSectionSvg } = await import('../src/ui/components/lens-section');
    const s = (z: number, curvature: number, index: number) => ({ z, kind: 0, curvature, semiAperture: 10, index, conic: 0, aspheric: [0, 0, 0, 0] as [number, number, number, number] });
    const section = { surfaces: [s(0, 1 / 50, 1.5), s(5, -1 / 50, 1), s(8, 1 / 40, 1.6), s(12, 0, 1)], stop: 1, stopRadiusMm: 4, sensorZMm: 60 };
    const svg = lensSectionSvg(section, { width: 300, height: 120, highlight: [[2, 3]], labels: [{ front: 0, back: 1, text: '1' }, { front: 2, back: 3, text: '2<' }] });
    expect(svg.match(/data-surface="\d"/g)).toEqual(['data-surface="0"', 'data-surface="2"']);
    expect(svg.match(/data-selected/g)).toHaveLength(1);
    expect(svg).toContain('data-surface="2" data-selected="" fill="currentColor" fill-opacity="0.42"');
    expect(svg.match(/<text[^>]*>[^<]*<\/text>/g)?.map((x) => x.replace(/<[^>]+>/g, ''))).toEqual(['1', '2&lt;']);
    // Without them, the drawing of O2 (one glass fill, the same opacity).
    expect(lensSectionSvg(section, { width: 300, height: 120 }).match(/fill-opacity="0.16"/g)).toHaveLength(2);
  });

  it('the window of the list shows the catalogue lens for the lens an edited one came from', async () => {
    const { peekCamera } = await import('../src/ui/lens-peek');
    const edited: TracedLens = { ...newTracedLens('triplet'), edited: copyOf('triplet') };
    const cam: CameraState = { ...makeCamera('cam1', '', 200), optics: { ...OPTICS_NEUTRAL, traced: edited } };
    expect(tracedOf(peekCamera(cam, 'triplet').optics)).toEqual(newTracedLens('triplet'));
    const plain: CameraState = { ...cam, optics: { ...OPTICS_NEUTRAL, traced: newTracedLens('triplet') } };
    expect(peekCamera(plain, 'triplet')).toBe(plain);
  });
});

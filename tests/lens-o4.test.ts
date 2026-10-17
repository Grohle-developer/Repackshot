// Phase O4, the project's side: the simple lens's name (stored as `thin`, as every project keeps it), the bokeh and the
// Advanced optics belonging to the simple lens (a bokeh never takes a camera out of its traced lens, through any path;
// switching back finds them as they were), the traced lens's own tilt and the shift in the RSB, the plane of sharp focus
// through two or three points (core/focus-plane.ts) and its overlay, and the two-point pick as one undo entry. With the
// real rt.wasm, the O4 scene (the traced double Gauss tilted and shifted) renders to the native engine's pinned hash.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cameraBasis, cameraPosition, makeCamera, type CameraState } from '../src/core/camera';
import { focusPlaneHint, focusPlaneOf, isTiltSolution, planeDistance, recedeOf, solveTilt, tiltFromRecede, type TiltSolution } from '../src/core/focus-plane';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../src/core/math';
import { bokehApplies, canTilt, lensModelOf, normalizeOptics, OPTICS_NEUTRAL, opticsForBokeh, opticsOf, opticsWithLensModel, tiltOf, withTilt, type CameraOptics } from '../src/core/optics';
import { createStore } from '../src/core/store';
import { newTracedLens, parseLensInfo } from '../src/core/traced-lens';
import { BOKEH_TYPES } from '../src/data/bokeh';
import { serializeProject, parseProject } from '../src/io/project';
import { cameraToRsb, lensToRsb, writeRsb, type RsbScene } from '../src/io/rsb';
import { applyBokeh, armTiltPick, finishTiltPick, setLensModel } from '../src/ui/lens-commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { STRINGS } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { exampleState } from './helpers';
import { readRsb } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const camera = (optics: CameraOptics | undefined, patch: Partial<CameraState> = {}): CameraState => ({ ...makeCamera('cam1', '', 200), ...(optics ? { optics } : {}), ...patch });
const traced = (key = 'double_gauss_normal', patch: Partial<CameraOptics> = {}): CameraOptics => ({ ...OPTICS_NEUTRAL, traced: newTracedLens(key), ...patch });

/** A store with the example and an interface store, as the panels get them. */
function context(optics?: CameraOptics): { ctx: Ctx; camId: string } {
  const store = createStore(exampleState());
  const camId = store.get().camera.active;
  if (optics) store.dispatch({ type: 'camera/set', id: camId, patch: { optics } });
  return { ctx: { store, ui: createUiStore(), services: {} as AppServices }, camId };
}
const opticsIn = (ctx: Ctx, camId: string) => opticsOf(ctx.store.get().camera.cameras[camId]);

describe('the simple lens (O4: the thin lens renamed)', () => {
  it('is called Simple lens and Lente simple, and no string of the interface says thin lens any more', () => {
    expect([STRINGS.en['camera.lensThin'], STRINGS.es['camera.lensThin']]).toEqual(['Simple lens', 'Lente simple']);
    expect([STRINGS.en['camera.lensAdvanced'], STRINGS.es['camera.lensAdvanced']]).toEqual(['More options', 'Más opciones']);
    for (const [key, en] of Object.entries(STRINGS.en)) expect(/thin lens/i.test(en), key).toBe(false);
    for (const [key, es] of Object.entries(STRINGS.es)) expect(/lente fina/i.test(es), key).toBe(false);
  });

  it('keeps the stored values: a camera of an old project opens and saves byte for byte', () => {
    expect(lensModelOf(OPTICS_NEUTRAL)).toBe('thin');
    expect(lensModelOf(traced())).toBe('traced');
    // A project saved before O4: a simple lens with a bokeh and a tilt, a traced camera with a stale simple-lens tilt.
    const s0 = exampleState();
    const id = s0.camera.active;
    const old: CameraOptics = { ...OPTICS_NEUTRAL, bokeh: 'bubble', blades: 7, tiltDeg: 3, tiltAxisDeg: 20, shiftYMm: 2 };
    const oldTraced: CameraOptics = { ...traced('triplet'), tiltDeg: 4, tiltAxisDeg: 10, shiftXMm: -1 };
    const s1 = { ...s0, camera: { ...s0.camera, cameras: { ...s0.camera.cameras, [id]: { ...s0.camera.cameras[id], optics: old }, cam9: { ...s0.camera.cameras[id], id: 'cam9', optics: oldTraced } } } };
    const text = () => new Response(serializeProject(s1)).text();
    return text().then((t1) => {
      const back = parseProject(t1);
      expect(back.camera.cameras[id].optics).toEqual(old);
      expect(back.camera.cameras.cam9.optics).toEqual(oldTraced);
      // No O4 field appears in what was saved before O4.
      expect('tracedTiltDeg' in back.camera.cameras.cam9.optics!).toBe(false);
      return new Response(serializeProject(back)).text().then((t2) => expect(JSON.parse(t2).state.camera).toEqual(JSON.parse(t1).state.camera));
    });
  });

  it('an old traced camera with a simple-lens tilt left in it does not start tilting (the engine ignored it before O4)', () => {
    const oldTraced: CameraOptics = { ...traced('triplet'), tiltDeg: 4, tiltAxisDeg: 10 };
    const lens = lensToRsb(oldTraced, 640, 480);
    expect([lens.tiltDeg, lens.tiltAxisDeg]).toEqual([0, 0]);
    // The traced lens's own tilt goes; the simple lens's stays for the simple lens.
    const both = lensToRsb({ ...oldTraced, tracedTiltDeg: 5, tracedTiltAxisDeg: 30 }, 640, 480);
    expect([both.tiltDeg, both.tiltAxisDeg]).toEqual([5, 30]);
    expect(lensToRsb({ ...OPTICS_NEUTRAL, tiltDeg: 4, tiltAxisDeg: 10, tracedTiltDeg: 7 }, 640, 480).tiltDeg).toBe(4);
    // A lens with cylinders does not tilt: the engine refuses one, so none is written.
    const ana = { ...traced('anamorphic_adapter_2x'), tracedTiltDeg: 5 };
    expect(canTilt(ana)).toBe(false);
    expect(lensToRsb(ana, 640, 480).tiltDeg).toBe(0);
    expect(canTilt(traced('telephoto_internal_focus'))).toBe(true);
    // The shift is the camera's, whichever lens it has (it moved a traced lens's frame already in O2).
    expect(lensToRsb({ ...traced(), shiftXMm: 2, shiftYMm: -3 }, 640, 480)).toMatchObject({ shiftXMm: 2, shiftYMm: -3 });
  });

  it('normalises the traced tilt of a file, and keeps it absent where it was', () => {
    expect(normalizeOptics({ tracedTiltDeg: 30, tracedTiltAxisDeg: 900 })).toMatchObject({ tracedTiltDeg: 12, tracedTiltAxisDeg: 360 });
    expect('tracedTiltDeg' in normalizeOptics({ tiltDeg: 3 })).toBe(false);
  });
});

describe('the bokeh and the Advanced optics are the simple lens’s (O4)', () => {
  it('no bokeh type applies to a traced camera, and none takes it out of its lens (the bug)', () => {
    const o = traced('petzval_portrait', { blades: 9 });
    expect(bokehApplies(o)).toBe(false);
    for (const t of BOKEH_TYPES) expect(opticsForBokeh(o, t.key), t.key).toBeNull();
    for (const t of BOKEH_TYPES) for (const v of t.variants) expect(opticsForBokeh(o, t.key, v.key), `${t.key}/${v.key}`).toBeNull();
  });

  it('the command every bokeh goes through keeps a traced camera’s lens and says why, and applies on a simple lens', () => {
    const { ctx, camId } = context(traced('petzval_portrait'));
    const before = ctx.store.get();
    for (const t of BOKEH_TYPES) {
      expect(applyBokeh(ctx, camId, t.key, t.variants[0]?.key ?? null), t.key).toBe(false);
      expect(lensModelOf(opticsIn(ctx, camId)), t.key).toBe('traced');
    }
    expect(ctx.store.get()).toBe(before);
    expect(ctx.ui.get().toasts.map((x) => x.text)).toContain(STRINGS.en['camera.bokehSimpleOnly']);
    // The same camera with the simple lens takes it, one undo entry.
    setLensModel(ctx, camId, 'thin');
    expect(applyBokeh(ctx, camId, 'bubble', null)).toBe(true);
    expect(opticsIn(ctx, camId).bokeh).toBe('bubble');
    expect(ctx.store.history().undo[0]).toMatch(/Bokeh type/);
  });

  it('switching to the traced lens and back finds the bokeh and the Advanced optics as they were', () => {
    const { ctx, camId } = context();
    expect(applyBokeh(ctx, camId, 'cats_eye', null)).toBe(true);
    const custom = withTilt({ ...opticsIn(ctx, camId), profile: 'ringBright', profileParam: 0.4, squeeze: 2, tiltDeg: 0 }, 3, 15);
    ctx.store.dispatch({ type: 'camera/set', id: camId, patch: { optics: custom } });
    const simple = opticsIn(ctx, camId);
    setLensModel(ctx, camId, 'traced');
    const tr = opticsIn(ctx, camId);
    expect(lensModelOf(tr)).toBe('traced');
    // In the state, untouched, while the traced lens is on (its own tilt is apart).
    expect([tr.bokeh, tr.variant, tr.profile, tr.profileParam, tr.squeeze, tr.tiltDeg, tr.tiltAxisDeg]).toEqual([simple.bokeh, simple.variant, 'ringBright', 0.4, 2, 3, 15]);
    expect(tiltOf(tr)).toEqual({ deg: 0, axisDeg: 0 });
    ctx.store.dispatch({ type: 'camera/set', id: camId, patch: { optics: withTilt(tr, 5, 90) } });
    setLensModel(ctx, camId, 'thin');
    const back = opticsIn(ctx, camId);
    expect({ ...back, traced: undefined, tracedTiltDeg: undefined, tracedTiltAxisDeg: undefined }).toEqual({ ...simple, traced: undefined, tracedTiltDeg: undefined, tracedTiltAxisDeg: undefined });
    expect(back.traced).toBeNull();
    // And the traced lens's tilt is kept for it.
    expect([back.tracedTiltDeg, back.tracedTiltAxisDeg]).toEqual([5, 90]);
    expect(opticsWithLensModel(back, 'thin')).toBe(back);
  });
});

/** The point of `cam`'s view at `x`, `y` of the frame's half-width (−1 … 1) and `depth` along the view. */
function pointAt(cam: CameraState, x: number, y: number, depth: number): Vec3 {
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const k = (depth * 18) / cam.focalMm;
  return add(cameraPosition(cam), add(scale(forward, depth), add(scale(right, x * k), scale(up, y * k * 0.6))));
}

describe('the plane of sharp focus (core/focus-plane.ts)', () => {
  const cam = camera(undefined, { focalMm: 85, focusDistance: 600, distance: 600 });

  it('is the engine’s hinge rule: through the focus point, normal f·forward + u·sin α·b', () => {
    const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
    const p = focusPlaneOf(cam, { deg: 6, axisDeg: 0 });
    expect(planeDistance(p, add(cameraPosition(cam), scale(forward, 600)))).toBeCloseTo(0, 6);
    const b = cross(forward, right);
    const n = normalize(add(scale(forward, 85), scale(b, 600 * Math.sin((6 * Math.PI) / 180))));
    for (let i = 0; i < 3; i++) expect(p.normal[i]).toBeCloseTo(n[i], 9);
    // A positive tilt about the horizontal axis lays the plane back to the floor: higher up it is farther.
    expect(dot(p.normal, up)).toBeLessThan(0);
    // Untilted, square to the view.
    expect(focusPlaneOf(cam, { deg: 0, axisDeg: 37 }).normal.map((v, i) => v - forward[i]).every((v) => Math.abs(v) < 1e-12)).toBe(true);
  });

  it('goes through two points: the least tilted plane, within the lens’s limits', () => {
    const cases: [Vec3, Vec3][] = [
      [pointAt(cam, 0, -0.8, 520), pointAt(cam, 0, 0.8, 700)],
      [pointAt(cam, -0.8, 0, 640), pointAt(cam, 0.7, 0.1, 560)],
      [pointAt(cam, -0.5, -0.5, 560), pointAt(cam, 0.6, 0.7, 660)],
    ];
    for (const [a, b] of cases) {
      const r = solveTilt(cam, [a, b]);
      expect(isTiltSolution(r)).toBe(true);
      const s = r as TiltSolution;
      expect(Math.abs(s.tiltDeg)).toBeLessThanOrEqual(12);
      expect(s.axisDeg).toBeGreaterThan(-90);
      expect(s.axisDeg).toBeLessThanOrEqual(90);
      const solved = { ...cam, focusDistance: s.focusDistance };
      const plane = focusPlaneOf(solved, { deg: s.tiltDeg, axisDeg: s.axisDeg });
      expect(Math.abs(planeDistance(plane, a))).toBeLessThan(1e-6);
      expect(Math.abs(planeDistance(plane, b))).toBeLessThan(1e-6);
      // The least tilted of the planes through the two: its normal is as close to the view as any of theirs.
      const { forward } = cameraBasis(cam.azimuth, cam.elevation);
      const l = normalize(sub(b, a));
      const best = normalize(sub(forward, scale(l, dot(forward, l))));
      expect(dot(plane.normal, best)).toBeCloseTo(1, 9);
    }
    // The first case is a plane lying back towards the floor: a positive tilt about the horizontal axis.
    const floor = solveTilt(cam, cases[0]) as TiltSolution;
    expect(floor.tiltDeg).toBeGreaterThan(0);
    expect(Math.abs(floor.axisDeg)).toBeLessThan(1e-6);
  });

  it('goes through three points, and two at the same depth only focus', () => {
    const pts: Vec3[] = [pointAt(cam, -0.6, -0.4, 560), pointAt(cam, 0.6, -0.3, 600), pointAt(cam, 0.1, 0.7, 680)];
    const s = solveTilt(cam, pts) as TiltSolution;
    expect(isTiltSolution(s)).toBe(true);
    const plane = focusPlaneOf({ ...cam, focusDistance: s.focusDistance }, { deg: s.tiltDeg, axisDeg: s.axisDeg });
    for (const p of pts) expect(Math.abs(planeDistance(plane, p))).toBeLessThan(1e-6);
    const flat = solveTilt(cam, [pointAt(cam, -0.7, 0.2, 640), pointAt(cam, 0.7, -0.2, 640)]) as TiltSolution;
    expect(flat.tiltDeg).toBe(0);
    expect(flat.focusDistance).toBeCloseTo(640, 6);
  });

  it('says why when no tilt does it', () => {
    const a = pointAt(cam, 0.2, 0.1, 600);
    expect(solveTilt(cam, [a, a])).toEqual({ reason: 'same' });
    const { forward } = cameraBasis(cam.azimuth, cam.elevation);
    expect(solveTilt(cam, [a, add(a, scale(forward, 50))])).toEqual({ reason: 'line' });
    const steep = solveTilt(cam, [pointAt(cam, 0, -0.2, 300), pointAt(cam, 0, 0.2, 1500)]);
    expect(steep).toMatchObject({ reason: 'steep' });
    expect((steep as { neededDeg: number }).neededDeg).toBeGreaterThan(12);
    // Three points in a line make no plane.
    expect(solveTilt(cam, [pointAt(cam, 0, 0, 500), pointAt(cam, 0.5, 0.5, 500), pointAt(cam, 1, 1, 500)])).toEqual({ reason: 'line' });
  });

  it('reads a tilt as where the plane runs away on the image, and back to the same plane', () => {
    expect(recedeOf(5, 0)).toEqual({ amountDeg: 5, recedeDeg: 90 });
    expect(recedeOf(-5, 0)).toEqual({ amountDeg: 5, recedeDeg: 270 });
    expect(tiltFromRecede(4, 180)).toEqual({ tiltDeg: 4, axisDeg: 90 });
    for (const [deg, axis] of [[5, 0], [-3, 40], [7, -120], [-2, 170]]) {
      const r = recedeOf(deg, axis);
      const back = tiltFromRecede(r.amountDeg, r.recedeDeg);
      const p = focusPlaneOf(cam, { deg, axisDeg: axis });
      const q = focusPlaneOf(cam, { deg: back.tiltDeg, axisDeg: back.axisDeg });
      for (let i = 0; i < 3; i++) expect(q.normal[i]).toBeCloseTo(p.normal[i], 9);
    }
  });

  it('draws a square on the plane around the product, with the focus point and the points picked', () => {
    const s = exampleState();
    const id = s.camera.active;
    const c = { ...s.camera.cameras[id], optics: withTilt(OPTICS_NEUTRAL, 6, 30) };
    const state = { ...s, camera: { ...s.camera, cameras: { ...s.camera.cameras, [id]: c } } };
    const picked: Vec3 = [1, 2, 3];
    const hint = focusPlaneHint(state, id, [picked])!;
    const plane = focusPlaneOf(c);
    for (const p of [...hint.quad, ...hint.lines]) expect(Math.abs(planeDistance(plane, p))).toBeLessThan(1e-6);
    expect(hint.dots[0]).toEqual(plane.point);
    expect(hint.dots[1]).toEqual(picked);
    expect(focusPlaneHint({ ...state, camera: { ...state.camera, cameras: { ...state.camera.cameras, [id]: { ...c, projection: 'ORTHOGRAPHIC' } } } }, id)).toBeNull();
  });
});

describe('the plane through two points, in the viewport (one undo entry)', () => {
  for (const model of ['thin', 'traced'] as const) {
    it(`sets the tilt and the focus distance of a camera with the ${model === 'thin' ? 'simple' : 'traced'} lens so that both points are sharp`, () => {
      const { ctx, camId } = context(model === 'traced' ? { ...traced(), tiltDeg: 2, tiltAxisDeg: 5 } : undefined);
      const cam0 = ctx.store.get().camera.cameras[camId];
      const a = pointAt(cam0, 0, -0.6, cam0.focusDistance * 0.9);
      const b = pointAt(cam0, 0.2, 0.6, cam0.focusDistance * 1.1);
      const undos = ctx.store.history().undo.length;
      armTiltPick(ctx, camId);
      expect(ctx.ui.get().pickMode).toEqual({ kind: 'tiltPlane', camera: camId, first: null });
      finishTiltPick(ctx, a);
      expect(ctx.store.history().undo.length).toBe(undos);
      finishTiltPick(ctx, b);
      expect(ctx.ui.get().pickMode).toBeNull();
      expect(ctx.store.history().undo.length).toBe(undos + 1);
      expect(ctx.store.history().undo[0]).toBe('Tilt the focus plane through two points');
      const cam = ctx.store.get().camera.cameras[camId];
      const plane = focusPlaneOf(cam);
      expect(Math.abs(planeDistance(plane, a))).toBeLessThan(1e-6);
      expect(Math.abs(planeDistance(plane, b))).toBeLessThan(1e-6);
      expect(lensModelOf(opticsOf(cam))).toBe(model);
      // The other lens's tilt is left alone.
      if (model === 'traced') expect([opticsOf(cam).tiltDeg, opticsOf(cam).tiltAxisDeg]).toEqual([2, 5]);
      ctx.store.undo();
      expect(ctx.store.get().camera.cameras[camId]).toEqual(cam0);
    });
  }

  it('refuses a second point no tilt reaches, with a notice, and waits for another', () => {
    const { ctx, camId } = context();
    const cam = ctx.store.get().camera.cameras[camId];
    armTiltPick(ctx, camId);
    const a = pointAt(cam, 0, 0, cam.focusDistance);
    finishTiltPick(ctx, a);
    finishTiltPick(ctx, a);
    expect(ctx.ui.get().pickMode).toMatchObject({ kind: 'tiltPlane', first: a });
    expect(ctx.ui.get().toasts.at(-1)?.text).toBe(STRINGS.en['camera.tiltRefused.same']);
    // Pressing the button again puts the pick down.
    armTiltPick(ctx, camId);
    expect(ctx.ui.get().pickMode).toBeNull();
  });
});

describe('the engine’s numbers of a tilted traced lens', () => {
  it('reads the angle the lens takes, 0 when the engine says none', () => {
    const base = { traced: true, eflMm: 50, bflMm: 30, eflFocusedMm: 51, imageScaleMm: 51, fNumber: 4, fNumberMin: 2, tStop: 4.2, transmittance: [0.9, 0.9, 0.9], lengthMm: 40, entrancePupilMm: [20, 12], elements: 6, groups: 4, sensorMm: 31, squeeze: 1, distortion: [[1, 0]], relativeIllumination: [[0, 1]] };
    expect(parseLensInfo(JSON.stringify(base))!.tiltDeg).toBe(0);
    expect(parseLensInfo(JSON.stringify({ ...base, tiltDeg: 6.2 }))!.tiltDeg).toBe(6.2);
  });

  it('writes the O4 fixture’s LENS from the page’s optics (tests/fixtures/o4.rsb, rt --write-o4-example)', () => {
    const fixture = readRsb(new Uint8Array(readFileSync('tests/fixtures/o4.rsb'))) as RsbScene;
    const lens = fixture.camera.lens!;
    expect([lens.tiltDeg, lens.tiltAxisDeg, lens.shiftXMm, lens.shiftYMm]).toEqual([6, 0, 2, -3]);
    const page = lensToRsb({ ...traced('double_gauss_normal'), blades: 7, roundness: 0.3, tracedTiltDeg: 6, shiftXMm: 2, shiftYMm: -3 }, 640, 480);
    for (const k of ['tiltDeg', 'tiltAxisDeg', 'shiftXMm', 'shiftYMm', 'blades'] as const) expect(page[k], k).toBe(lens[k]);
    expect(Math.fround(page.roundness)).toBe(lens.roundness);
    // The camera of the page writes it the same way.
    expect(cameraToRsb(camera(page as unknown as CameraOptics), 640, 480, 640, 480)).toBeTruthy();
    expect(writeRsb(fixture).length).toBe(readFileSync('tests/fixtures/o4.rsb').length);
  });
});

describe.skipIf(!RT_WASM)('the real rt.wasm', () => {
  it('renders the O4 fixture to the native engine’s pinned hash', async () => {
    const rt = await loadRt();
    const rsb = new Uint8Array(readFileSync('tests/fixtures/o4.rsb'));
    const { image } = renderWithPasses(rt, rsb, 256, 192, 4, 0);
    expect(fnv1a(resolveRgb(image, 4)).toString(16)).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_O4_TRACED_TILT_4SPP').toString(16));
  }, 120000);
});

// The traced lens (phase O2): the project's side (core/traced-lens.ts, the optics of a camera), the LENS
// prescription of the RSB writer against rt byte for byte (tests/fixtures/o2.rsb), and with the real rt.wasm the
// engine's pinned image of the O2 scene and its lens information for every lens of the catalogue.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeCamera, type CameraState } from '../src/core/camera';
import { isNeutralOptics, normalizeOptics, OPTICS_NEUTRAL, opticsForBokeh, type CameraOptics } from '../src/core/optics';
import { ADAPTER_FOCUS_TRAVEL, composeLens, DEFAULT_MASTER, isAdapter, masterLenses, newTracedLens, normalizeTracedLens, parseLensInfo, stateMagnification, type TracedLens } from '../src/core/traced-lens';
import { LENS_PRESCRIPTIONS, lensPrescription } from '../src/data/lenses';
import { FOCUS_MODE, lensInfoRsb, lensToRsb, prescriptionBytes, prescriptionToRsb, writeRsb, type RsbPrescription, type RsbScene } from '../src/io/rsb';
import { hasLensInfoExport, readLensInfo } from '../src/render/lens-info';
import { lensProfileTable, PROFILE_SIZE, profileSource, shownOfSource, sourceOfShown, type LensProfile } from '../src/render/lens-profile';
import { readRsb } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const camera = (optics: CameraOptics, patch: Partial<CameraState> = {}): CameraState => ({ ...makeCamera('cam1', '', 200), optics, ...patch });
const traced = (key: string, patch: Partial<TracedLens> = {}): CameraOptics => ({ ...OPTICS_NEUTRAL, traced: { ...newTracedLens(key), ...patch } });
/** A prescription as f32 (what the file holds). */
const f32 = (t: RsbPrescription): RsbPrescription => JSON.parse(JSON.stringify(t, (_k, v) => (typeof v === 'number' ? Math.fround(v) : v))) as RsbPrescription;

describe('the traced lens of a camera', () => {
  it('is kept from a project file only with a known key, within the limits', () => {
    expect(normalizeTracedLens({ key: 'not_a_lens' })).toBeNull();
    const t = normalizeTracedLens({ key: 'soft_focus_variable', coating: 'single', variable: 99, distortion: 3, vignetting: -1, spherical: -0.5, breathing: 2, master: 'triplet' })!;
    const gap = lensPrescription('soft_focus_variable')!.variable![0];
    expect(t).toEqual({ key: 'soft_focus_variable', coating: 'single', variable: gap.max, distortion: 1, vignetting: 0, spherical: -0.5, breathing: 1, master: null });
    // A master only for an adapter, and never an adapter itself.
    expect(normalizeTracedLens({ key: 'anamorphic_adapter_2x', master: 'triplet' })!.master).toBe('triplet');
    expect(normalizeTracedLens({ key: 'anamorphic_adapter_2x', master: 'anamorphic_adapter_2x' })!.master).toBeNull();
    // Optics saved before O2 have no traced field, and stay so; a traced lens makes the optics non-neutral.
    expect('traced' in normalizeOptics({ blades: 6 })).toBe(false);
    expect(normalizeOptics({ traced: { key: 'triplet' } }).traced?.key).toBe('triplet');
    expect(isNeutralOptics(traced('triplet'))).toBe(false);
  });

  it('comes from the bokeh types that need it, and no bokeh type takes a traced camera out of its lens (O4)', () => {
    const coma = opticsForBokeh(OPTICS_NEUTRAL, 'coma_comet')!;
    expect(coma.traced?.key).toBe('double_gauss_fast');
    expect(opticsForBokeh(OPTICS_NEUTRAL, 'focus_breathing')!.traced?.key).toBe('telephoto_internal_focus');
    expect(opticsForBokeh(OPTICS_NEUTRAL, 'variable_sa')!.traced?.key).toBe('soft_focus_variable');
    expect(opticsForBokeh(OPTICS_NEUTRAL, 'diffraction_ring')).toBeNull();
    // Before O4 a simple-lens type took the camera back to the simple lens: the bug the person met. Now nothing applies.
    expect(opticsForBokeh(coma, 'cats_eye')).toBeNull();
    expect(opticsForBokeh(coma, 'focus_breathing')).toBeNull();
    expect('traced' in opticsForBokeh(OPTICS_NEUTRAL, 'cats_eye')!).toBe(false);
  });

  it('composes the person’s coating, the variable gap and an adapter in front of its lens', () => {
    const multi = composeLens({ ...newTracedLens('triplet'), coating: 'none' })!;
    const own = lensPrescription('triplet')!.surfaces;
    multi.surfaces.forEach((s, i) => expect(s.coating).toBe(own[i].coating === null ? null : 'none'));
    const soft = lensPrescription('soft_focus_variable')!;
    const gap = soft.variable![0];
    expect(composeLens({ ...newTracedLens(soft.key), variable: gap.soft })!.surfaces[gap.surface].d).toBe(gap.soft);
    expect(composeLens(newTracedLens(soft.key))!.surfaces[gap.surface].d).toBe(soft.surfaces[gap.surface].d);
    // The adapter: its surfaces without its placeholder stop, then the master's, the master's stop and focus.
    const adapter = lensPrescription('anamorphic_adapter_2x')!;
    expect(isAdapter(adapter)).toBe(true);
    expect(masterLenses().some(isAdapter)).toBe(false);
    const c = composeLens(newTracedLens(adapter.key))!;
    const master = composeLens(newTracedLens(DEFAULT_MASTER))!;
    const front = adapter.surfaces.length - 1;
    expect(c.surfaces.length).toBe(front + master.surfaces.length);
    expect(c.stop).toBe(master.stop + front);
    expect(c.squeeze).toBe(2);
    expect(c.surfaces.slice(front)).toEqual(master.surfaces);
    // Scaled to clear the master's front: its strongest radius 2.2 times that semi-aperture.
    const strongest = Math.min(...c.surfaces.slice(0, front).filter((s) => s.r !== null).map((s) => Math.abs(s.r!)));
    expect(strongest).toBeCloseTo(2.2 * master.surfaces[0].semiAperture!, 6);
    // It focuses with its widest air gap (between the cylinders), its lens moving as one unit (rt-core
    // FOCUS_ANAMORPHIC); in front of a lens that focuses otherwise, that lens's own focus.
    expect(c.squeezeFocus).toEqual({ surface: 1, dBase: c.surfaces[1].d, dNear: c.surfaces[1].d! * ADAPTER_FOCUS_TRAVEL });
    const rsb = prescriptionToRsb(newTracedLens(adapter.key), c);
    expect([rsb.focusMode, rsb.moving]).toEqual([FOCUS_MODE.anamorphic, [{ surface: 1, base: c.surfaces[1].d, near: c.surfaces[1].d! * ADAPTER_FOCUS_TRAVEL }]]);
    const tele = composeLens({ ...newTracedLens(adapter.key), master: 'telephoto_internal_focus' })!;
    expect(tele.squeezeFocus).toBeNull();
    expect(prescriptionToRsb(newTracedLens(adapter.key), tele).focusMode).toBe(FOCUS_MODE.internal);
    expect(stateMagnification('magnification 0.2')).toBe(0.2);
    expect(stateMagnification('infinity')).toBe(0);
  });

  it('gives the Fast viewport the engine’s scale, distortion and falloff (render/lens-profile.ts)', () => {
    const info = parseLensInfo(
      JSON.stringify({ traced: true, eflMm: 50, bflMm: 40, eflFocusedMm: 50, imageScaleMm: 55, fNumber: 2, fNumberMin: 2, tStop: 2.1, transmittance: [0.9, 0.9, 0.9], lengthMm: 60, entrancePupilMm: [20, 25], elements: 6, groups: 4, sensorMm: 45, squeeze: 1, distortion: [[10, 5], [20, 10]], relativeIllumination: [[0, 1], [10, 0.8], [20, 0.5]] }),
    )!;
    expect(info.section).toBeNull();
    const { table, hMaxMm } = lensProfileTable(info, 50);
    expect(hMaxMm).toBe(20);
    // On the axis the frame is the pinhole's over the engine's image scale (a lens focused close frames less: not its
    // focal length), at the corner that and the distortion; the falloff as the engine measured it.
    expect(table[0]).toBeCloseTo(50 / 55, 6);
    expect(table[(PROFILE_SIZE - 1) * 2]).toBeCloseTo(50 / 55 / 1.1, 6);
    expect(table[1]).toBe(1);
    expect(table[(PROFILE_SIZE - 1) * 2 + 1]).toBeCloseTo(0.5, 6);
  });

  it('maps the screen to the undistorted picture and back with one map, read between its entries (render/lens-profile.ts)', () => {
    // A barrel of −20 % at 21.6 mm, 240 × 160 pixels for 36 × 24 mm, the axis a little off the centre (a shift).
    const table = new Float32Array(PROFILE_SIZE * 2);
    for (let i = 0; i < PROFILE_SIZE; i++) {
      const t = i / (PROFILE_SIZE - 1);
      table[i * 2] = 1 / (1 - 0.2 * t * t);
      table[i * 2 + 1] = 1 - 0.3 * t;
    }
    const p: LensProfile = { table, hMaxMm: 21.6, pxPerMm: 240 / 36, axis: [0.52, 0.48] };
    const view = { width: 240, height: 160, bufW: 240, bufH: 160 };
    // The thin lens (no profile): the point itself, in full light, both ways.
    expect(profileSource(null, 240, 160, 0.3, 0.7)).toEqual([0.3, 0.7, 1]);
    expect(sourceOfShown(null, view, 17.5, 80.25)).toEqual([17.5, 80.25]);
    expect(shownOfSource(null, view, 17.5, 80.25)).toEqual([17.5, 80.25]);
    // On the axis nothing moves; at an entry the table's own numbers.
    expect(profileSource(p, 240, 160, 0.52, 0.48)).toEqual([0.52, 0.48, 1]);
    const at = (i: number): [number, number] => [0.52 + (i * (21.6 / 63) * (240 / 36)) / 240, 0.48];
    const [u10, , l10] = profileSource(p, 240, 160, ...at(10));
    expect((u10 - 0.52) * 240).toBeCloseTo(10 * (21.6 / 63) * (240 / 36) * table[20], 3);
    expect(l10).toBeCloseTo(table[21], 6);
    // Between entries the map runs on without a step (the screen pass read the nearest entry: a ring at each one).
    let worst = 0;
    let prev = profileSource(p, 240, 160, 0.52, 0.48)[0];
    for (let k = 1; k <= 4000; k++) {
      const u = 0.52 + (0.47 * k) / 4000;
      const s = profileSource(p, 240, 160, u, 0.48)[0];
      worst = Math.max(worst, ((s - prev) * 240) / ((0.47 * 240) / 4000));
      prev = s;
    }
    expect(worst).toBeLessThan(1.6);
    // Back and forth: where the screen shows a point is where its picture comes from (inside the frame).
    for (const [x, y] of [[10, 12], [120, 80], [200, 150], [33.3, 140.7], [239, 1]]) {
      const [sx, sy] = sourceOfShown(p, view, x, y);
      const [bx, by] = shownOfSource(p, view, sx, sy);
      if (sx > 0 && sx < 240 && sy > 0 && sy < 160) {
        expect(bx).toBeCloseTo(x, 4);
        expect(by).toBeCloseTo(y, 4);
      }
    }
    // A barrel brings what is off the axis nearer it on the screen.
    const [ex, ey] = shownOfSource(p, view, 10, 12);
    expect(Math.hypot(ex - 0.52 * 240, ey - 0.52 * 160)).toBeLessThan(Math.hypot(10 - 0.52 * 240, 12 - 0.52 * 160));
  });

  it('reads the engine’s lens information, and refuses what is not one', () => {
    expect(parseLensInfo('{"traced":false}')).toBeNull();
    expect(parseLensInfo('not json')).toBeUndefined();
    expect(parseLensInfo('{"traced":true,"eflMm":50}')).toBeUndefined();
  });
});

describe('the LENS prescription', () => {
  it('round-trips the O2 fixture byte for byte with rt (tests/fixtures/o2.rsb)', () => {
    const bytes = new Uint8Array(readFileSync('tests/fixtures/o2.rsb'));
    const scene = readRsb(bytes) as RsbScene;
    expect(scene.camera.lens?.prescription?.surfaces.length).toBe(11);
    expect(sameBytes(writeRsb(scene), bytes)).toBe(true);
  });

  it('is what rt writes for the double Gauss of the catalogue (rt-core `example::double_gauss`)', () => {
    const fixture = (readRsb(new Uint8Array(readFileSync('tests/fixtures/o2.rsb'))) as RsbScene).camera.lens!.prescription!;
    const t = newTracedLens('double_gauss_normal');
    expect(f32(prescriptionToRsb(t, composeLens(t)!))).toEqual(fixture);
    // Through the camera's LENS section too, with the iris on top.
    const lens = lensToRsb({ ...traced('double_gauss_normal'), blades: 7, roundness: 0.3 }, 640, 480);
    expect(f32(lens.prescription!)).toEqual(fixture);
    expect(lens.blades).toBe(7);
  });

  it('is what rt sends the engine for every lens of the catalogue (tests/fixtures/lens-catalogue.json)', () => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/lens-catalogue.json', 'utf8')) as { lenses: { key: string; squeeze: number; obstruction: number; prescription: string }[] };
    expect(fixture.lenses.map((l) => l.key)).toEqual(LENS_PRESCRIPTIONS.map((p) => p.key));
    for (const row of fixture.lenses) {
      const lens = lensToRsb(traced(row.key), 640, 480);
      const hex = Array.from(prescriptionBytes(lens.prescription!), (b) => b.toString(16).padStart(2, '0')).join('');
      expect(hex, row.key).toBe(row.prescription);
      expect(lens.squeeze, row.key).toBeCloseTo(row.squeeze, 6);
      expect(lens.obstruction, row.key).toBeCloseTo(row.obstruction, 6);
    }
  });

  it('carries the artistic overrides, the adapter’s squeeze and a mirror lens’s obstruction', () => {
    const lens = lensToRsb(traced('petzval_portrait', { distortion: -0.5, vignetting: 0.25, spherical: 0.75, breathing: -1 }), 640, 480);
    expect([lens.prescription!.distortion, lens.prescription!.vignetting, lens.prescription!.spherical, lens.prescription!.breathing]).toEqual([-0.5, 0.25, 0.75, -1]);
    expect(lensToRsb(traced('anamorphic_adapter_2x'), 640, 480).squeeze).toBe(2);
    // The thin lens's squeeze does not apply to a traced lens (it would stretch a spherical lens's image).
    expect(lensToRsb({ ...traced('triplet'), squeeze: 2 }, 640, 480).squeeze).toBe(1);
    expect(lensToRsb({ ...traced('anamorphic_adapter_2x'), squeeze: 1.33 }, 640, 480).squeeze).toBe(2);
    expect(lensToRsb(traced('catadioptric_mirror'), 640, 480).obstruction).toBeCloseTo(0.49, 6);
    expect(lensToRsb(traced('macro_floating'), 640, 480).prescription!.magnification).toEqual([0.1, 0.2]);
    expect(lensToRsb(traced('telephoto_internal_focus'), 640, 480).prescription!.moving).toHaveLength(2);
  });
});

describe.skipIf(!RT_WASM)('the real rt.wasm', () => {
  it('renders the O2 fixture to the native engine’s pinned hash', async () => {
    const rt = await loadRt();
    const rsb = new Uint8Array(readFileSync('tests/fixtures/o2.rsb'));
    const { image } = renderWithPasses(rt, rsb, 256, 192, 4, 0);
    expect(fnv1a(resolveRgb(image, 4)).toString(16)).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_O2_TRACED_4SPP').toString(16));
  }, 120000);

  it('prepares every lens of the catalogue as the page writes it, and tells its numbers', async () => {
    const rt = await loadRt();
    expect(hasLensInfoExport(rt)).toBe(true);
    if (!hasLensInfoExport(rt)) return;
    for (const p of LENS_PRESCRIPTIONS) {
      const cam = camera(traced(p.key), { focalMm: 50, fstop: 0, focusDistance: 2000 });
      const info = readLensInfo(rt, lensInfoRsb(cam, 640, 480));
      expect(info, p.key).toBeTruthy();
      if (!info) continue;
      expect(info.eflMm, p.key).toBeCloseTo(50, 2);
      expect(info.tStop, p.key).toBeGreaterThanOrEqual(info.fNumber);
      expect(info.relativeIllumination.length, p.key).toBeGreaterThan(0);
      expect(info.elements, p.key).toBeGreaterThanOrEqual(1);
      // The scale near the axis is the focal length's, a little more at 2 m; and the section is the lens as traced.
      expect(info.imageScaleMm, p.key).toBeGreaterThan(49);
      expect(info.section?.surfaces.length, p.key).toBe(composeLens(newTracedLens(p.key))!.surfaces.length);
      expect(info.section!.surfaces.every((s) => s.semiAperture > 0), p.key).toBe(true);
    }
    // The adapter's squeeze as the engine traces it at the focus (2 m: a little under its 2x at infinity).
    const ana = readLensInfo(rt, lensInfoRsb(camera(traced('anamorphic_adapter_2x'), { focalMm: 50, fstop: 0, focusDistance: 2000 }), 640, 480))!;
    expect(ana.squeeze).toBeGreaterThan(1.5);
    expect(ana.squeeze).toBeLessThan(2);
    expect(readLensInfo(rt, lensInfoRsb(camera(traced('triplet')), 640, 480))!.squeeze).toBe(1);
    // The thin lens says so.
    expect(readLensInfo(rt, lensInfoRsb(camera(OPTICS_NEUTRAL), 640, 480))).toBeNull();
  }, 120000);
});

describe('a lens of one’s own (Save lens as…, the library)', () => {
  it('keeps the traced lens, the iris and the artistic knobs, and puts them back on a camera', async () => {
    const { emptyLibrary, fromCameraLens, opticsWithLensItem, addItem, itemsOf } = await import('../src/core/library');
    const { exportLibrary, importLibrary } = await import('../src/io/library');
    const optics: CameraOptics = { ...traced('soft_focus_variable', { variable: 3.1, spherical: -0.4, coating: 'single' }), blades: 9, roundness: 0.5, rotationDeg: 12, caAmount: 0.2, swirl: 0.1, tiltDeg: 2 };
    expect(fromCameraLens(emptyLibrary(), OPTICS_NEUTRAL, 'x')).toBeNull();
    const item = fromCameraLens(emptyLibrary(), optics, 'Dreamy', { id: 'lns-1', now: 1 })!;
    expect(item.lens).toEqual({ traced: optics.traced, blades: 9, roundness: 0.5, rotationDeg: 12, caAmount: 0.2, swirl: 0.1 });
    expect(item.source).toBe('soft_focus_variable');
    // Back on a camera: its lens, iris and knobs; the tilt and the rest of the camera's optics stay.
    const back = opticsWithLensItem({ ...OPTICS_NEUTRAL, tiltDeg: 3, filters: [] }, item);
    expect([back.traced, back.blades, back.caAmount, back.tiltDeg, back.bokeh]).toEqual([optics.traced, 9, 0.2, 3, null]);
    // Through the library file and back, and a lens of an unknown key is refused.
    const lib = addItem(emptyLibrary(), item);
    const again = importLibrary(exportLibrary(lib), emptyLibrary());
    expect(itemsOf(again.lib, 'lens')).toEqual([item]);
    const bad = JSON.parse(exportLibrary(lib));
    bad.items[0].lens.traced.key = 'no_such_lens';
    const refused = importLibrary(JSON.stringify(bad), emptyLibrary());
    expect([itemsOf(refused.lib, 'lens').length, refused.skipped[0]?.code]).toEqual([0, 'invalid']);
  });
});

describe('the cross-section (ui/components/lens-section.ts)', () => {
  it('draws the glass of each element, the iris and the sensor from the engine’s section', async () => {
    const { lensSectionSvg, sag, profileChartSvg } = await import('../src/ui/components/lens-section');
    // A biconvex singlet and a plane stop behind it: one piece of glass, two blades of the iris.
    const s = (z: number, kind: number, curvature: number, index: number, semiAperture = 10) => ({ z, kind, curvature, semiAperture, index, conic: 0, aspheric: [0, 0, 0, 0] as [number, number, number, number] });
    const section = { surfaces: [s(0, 0, 1 / 50, 1.5), s(5, 0, -1 / 50, 1), s(8, 1, 0, 1, 6)], stop: 2, stopRadiusMm: 4, sensorZMm: 60 };
    const svg = lensSectionSvg(section, { width: 200, height: 100, sensorHalfMm: 12 });
    expect(svg.match(/fill-opacity="0.16"/g)?.length).toBe(1);
    expect(svg.match(/stroke-width="2.5"/g)?.length).toBe(2);
    expect(svg.includes('<line')).toBe(true);
    // The sag of a sphere: R − sqrt(R² − y²).
    expect(sag(section.surfaces[0], 10)).toBeCloseTo(50 - Math.sqrt(2500 - 100), 9);
    // A doublet cemented: two pieces of glass (one per medium), and a mirror is a thick line, not glass.
    const doublet = { surfaces: [s(0, 0, 1 / 40, 1.5), s(4, 0, -1 / 30, 1.7), s(6, 0, -1 / 90, 1), s(9, 1, 0, 1)], stop: 3, stopRadiusMm: 4, sensorZMm: 50 };
    expect(lensSectionSvg(doublet, { width: 200, height: 100 }).match(/fill-opacity="0.16"/g)?.length).toBe(2);
    const mirror = { surfaces: [s(0, 1, 0, 1), s(30, 5, -1 / 100, 1), s(10, 1, 0, 1)], stop: 0, stopRadiusMm: 8, sensorZMm: 0 };
    const m = lensSectionSvg(mirror, { width: 200, height: 100 });
    expect([m.match(/fill-opacity="0.16"/g), m.match(/stroke-width="3"/g)?.length]).toEqual([null, 1]);
    expect(profileChartSvg([[10, 1], [20, 2]], { width: 100, height: 40, min: -2, max: 2, zero: 0 }).startsWith('<svg')).toBe(true);
  });
});

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

  it('comes from the bokeh types that need it, and a thin-lens type takes the camera back to the thin lens', () => {
    const coma = opticsForBokeh(OPTICS_NEUTRAL, 'coma_comet')!;
    expect(coma.traced?.key).toBe('double_gauss_fast');
    expect(opticsForBokeh(OPTICS_NEUTRAL, 'focus_breathing')!.traced?.key).toBe('telephoto_internal_focus');
    expect(opticsForBokeh(OPTICS_NEUTRAL, 'variable_sa')!.traced?.key).toBe('soft_focus_variable');
    expect(opticsForBokeh(OPTICS_NEUTRAL, 'diffraction_ring')).toBeNull();
    const back = opticsForBokeh(coma, 'cats_eye')!;
    expect(back.traced).toBeNull();
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

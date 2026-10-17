// Phase K1: the interior Doctor (INTERIORS.md §3.6). Seven checks that need no engine, run only while the scene type is Interior:
// scale and units, an opening for the sun and the sky, window glass, a lens wider than 18 mm, eye height, the near clip against the
// nearest wall, inverted normals. Each detects its case, each fix clears it, and each fix is one undo step.

import { describe, expect, it } from 'vitest';
import { INTERIOR_DOCTOR_CHECKS } from '../src/data/doctor-interior';
import { DOCTOR_CHECKS, doctorCheck } from '../src/data/doctor';
import type { InteriorCheckKey } from '../src/data/types';
import { cameraPosition, type CameraState } from '../src/core/camera';
import { runDoctor, warningCount, type DoctorResult } from '../src/core/doctor';
import {
  atEyeHeight,
  clearClip,
  EYE_MAX_MM,
  EYE_MIN_MM,
  EYE_STANDING_MM,
  INTERIOR_CHECKS,
  INTERIOR_LENS_MM,
  INTERIOR_MAX_MM,
  INTERIOR_NORMALS_TRIANGLES,
  INTERIOR_MIN_MM,
  interiorScaleFactor,
  OPENING_FIX_SETUP,
  WIDE_LENS_MM,
} from '../src/core/doctor-interior';
import { partMaterials } from '../src/core/materials';
import { measuredSizeMm, type NodeId } from '../src/core/scene';
import { createInitialState, createStore, reduce, type Action, type ProjectState } from '../src/core/store';
import { exampleState, apply } from './helpers';

const result = (s: ProjectState, key: InteriorCheckKey): DoctorResult => runDoctor(s).find((r) => r.key === key)!;
const status = (s: ProjectState, key: InteriorCheckKey) => result(s, key).status;
const fix = (s: ProjectState, key: InteriorCheckKey) => apply(s, { type: 'doctor/fix', key });
const cam = (s: ProjectState, id = s.camera.active): CameraState => s.camera.cameras[id];
const eye = (s: ProjectState, id?: string) => cameraPosition(cam(s, id))[2];

const box = (name: string, size: [number, number, number], position: [number, number, number], material?: string, rotation?: [number, number, number]): Action => ({
  type: 'scene/addPrimitive',
  kind: 'BOX',
  params: { width: size[0], depth: size[1], height: size[2], bevel: 0, bevelSegments: 1 },
  position,
  name,
  ...(material ? { material } : {}),
  ...(rotation ? { rotation } : {}),
});
const plane = (name: string, size: [number, number], position: [number, number, number], rotation: [number, number, number]): Action => ({
  type: 'scene/addPrimitive',
  kind: 'PLANE',
  params: { width: size[0], depth: size[1] },
  position,
  name,
  rotation,
});
const interior = (s: ProjectState): ProjectState => reduce(s, { type: 'scene/setType', sceneType: 'INTERIOR' });
const partNamed = (s: ProjectState, name: string): NodeId => Object.values(s.scene.nodes).find((n) => n.name === name)!.id;

/** A 4 x 4 x 2.6 m box standing on the floor: a room as far as the Doctor can tell from its bounds. */
const ROOM = box('Room', [4000, 4000, 2600], [0, 0, 1300]);
/** The camera of a person in the middle of the room, 1.3 m up, looking at the far wall. */
const inside = (extra: Partial<CameraState> = {}): Action => ({ type: 'camera/set', id: 'cam1', patch: { target: [0, 0, 1300], distance: 1200, azimuth: 0, elevation: 0, ...extra } });
const room = (...more: Action[]): ProjectState => interior(apply(createInitialState(), ROOM, inside(), ...more));
/** The same room with its faces turned in, as a modeller makes a room: the camera inside it is then right. */
const roomWithInwardWalls = (...more: Action[]): ProjectState => {
  const s = interior(apply(createInitialState(), ROOM));
  const flipped = apply(s, { type: 'scene/flipNormals', ids: [partNamed(s, 'Room')] }, inside(), ...more);
  return flipped;
};

describe('the interior Doctor in the list', () => {
  it('has seven checks with stable keys and descriptors in both languages, after the checks of the Doctor', () => {
    expect(INTERIOR_CHECKS).toEqual(['interiorScale', 'interiorOpening', 'interiorGlass', 'interiorLens', 'interiorEye', 'interiorClip', 'interiorNormals']);
    expect(INTERIOR_DOCTOR_CHECKS.map((c) => c.key)).toEqual(INTERIOR_CHECKS);
    for (const c of INTERIOR_DOCTOR_CHECKS) {
      expect(c.label.es && c.label.en && c.checks.es && c.checks.en && c.fix.es && c.fix.en, c.key).toBeTruthy();
      expect(doctorCheck(c.key), c.key).toBe(c);
    }
    expect(DOCTOR_CHECKS.some((c) => (INTERIOR_CHECKS as readonly string[]).includes(c.key))).toBe(false);
  });

  it('runs only while the scene is an interior; its rows come after the others and all are fixable', () => {
    const product = exampleState();
    expect(runDoctor(product).map((r) => r.key)).toEqual(DOCTOR_CHECKS.map((c) => c.key));
    const s = interior(product);
    const keys = runDoctor(s).map((r) => r.key);
    expect(keys).toEqual([...DOCTOR_CHECKS.map((c) => c.key), ...INTERIOR_CHECKS]);
    for (const k of INTERIOR_CHECKS) expect(result(s, k).fixable, k).toBe(true);
    // Back to Product: they are gone, the results of the state are the Doctor's alone.
    const back = reduce(s, { type: 'scene/setType', sceneType: 'PRODUCT' });
    expect(back.doctor.results.map((r) => r.key)).toEqual(DOCTOR_CHECKS.map((c) => c.key));
  });

  it('keeps its results in the state, refreshed when the type changes', () => {
    const s = exampleState();
    expect(s.doctor.results).toHaveLength(DOCTOR_CHECKS.length);
    const i = interior(s);
    expect(i.doctor.results).toEqual(runDoctor(i));
    expect(i.doctor.results).toHaveLength(DOCTOR_CHECKS.length + 7);
  });

  it('writes the numbers its descriptors speak of', () => {
    const text = (k: InteriorCheckKey) => INTERIOR_DOCTOR_CHECKS.find((c) => c.key === k)!;
    expect(text('interiorLens').checks.en).toContain(`${WIDE_LENS_MM} mm`);
    expect(text('interiorLens').fix.en).toContain(`${INTERIOR_LENS_MM} mm`);
    expect(text('interiorScale').checks.en).toContain(`${INTERIOR_MIN_MM} mm`);
    expect(text('interiorScale').checks.en).toContain(`${INTERIOR_MAX_MM / 1000} m`);
    expect(text('interiorEye').checks.en).toContain(`${EYE_MIN_MM / 1000} to ${EYE_MAX_MM / 1000} m`);
    expect(text('interiorEye').fix.en).toContain(`${EYE_STANDING_MM / 1000} m`);
    expect(text('interiorEye').fix.es).toContain(`${String(EYE_STANDING_MM / 1000).replace('.', ',')} m`);
    expect(OPENING_FIX_SETUP).toBe('INT_WHITE_ROOM');
  });

  it('every fix is one undo step', () => {
    const cases: [InteriorCheckKey, ProjectState][] = [
      ['interiorScale', interior(apply(exampleState(), { type: 'scene/setPartSize', mm: 2 }))],
      ['interiorLens', apply(interior(exampleState()), { type: 'camera/set', id: 'cam1', patch: { focalMm: 14 } })],
      ['interiorEye', apply(interior(exampleState()), { type: 'camera/set', id: 'cam1', patch: { target: [0, 0, 0], distance: 250, elevation: 60 } })],
      ['interiorOpening', room()],
      ['interiorClip', room(inside({ distance: 1900, clipStart: 150 }))],
    ];
    for (const [key, s] of cases) {
      const store = createStore(s);
      expect(result(store.get(), key).status, key).toBe('WARN');
      store.dispatch({ type: 'doctor/fix', key, label: 'Fix' });
      expect(store.history().undo, key).toEqual(['Fix']);
      expect(status(store.get(), key), key).toBe('OK');
      store.undo();
      expect(status(store.get(), key), key).toBe('WARN');
    }
  });
});

describe('scale and units', () => {
  it('a scene of the size of a piece of furniture or a room is fine, at its edges too', () => {
    expect(status(interior(exampleState()), 'interiorScale')).toBe('OK');
    for (const mm of [INTERIOR_MIN_MM, 2000, INTERIOR_MAX_MM]) {
      const s = interior(apply(exampleState(), { type: 'scene/setPartSize', mm }));
      expect(status(s, 'interiorScale'), `${mm} mm`).toBe('OK');
    }
    expect(status(interior(createInitialState()), 'interiorScale')).toBe('OK');
  });

  it('a scene that is a model in metres read as millimetres is too small, and the fix brings it to the range by a power of ten', () => {
    for (const [mm, factor] of [[50, 10], [2, 100], [0.5, 1000]] as const) {
      const s = interior(apply(exampleState(), { type: 'scene/setPartSize', mm }));
      expect(result(s, 'interiorScale'), `${mm}`).toMatchObject({ status: 'WARN', detail: { reason: 'small', actual: mm, min: INTERIOR_MIN_MM, factor } });
      const f = fix(s, 'interiorScale');
      expect(status(f, 'interiorScale'), `${mm}`).toBe('OK');
      expect(measuredSizeMm(f)).toBeCloseTo(mm * factor, 6);
      expect(f.scene.partSizeMm).toBeCloseTo(mm * factor, 6);
    }
  });

  it('a scene that is a model in millimetres read as metres is too large, and the fix scales it down', () => {
    const s = interior(apply(exampleState(), { type: 'scene/setPartSize', mm: 5_000_000 }));
    expect(result(s, 'interiorScale')).toMatchObject({ status: 'WARN', detail: { reason: 'large', max: INTERIOR_MAX_MM, factor: 0.001 } });
    const f = fix(s, 'interiorScale');
    expect(status(f, 'interiorScale')).toBe('OK');
    expect(measuredSizeMm(f)).toBeCloseTo(5000, 6);
    // One that no power of ten can bring in (the most absurd) lands on the bound.
    expect(interiorScaleFactor(1e-9)).toBe(INTERIOR_MIN_MM / 1e-9);
    expect(interiorScaleFactor(1e12)).toBe(INTERIOR_MAX_MM / 1e12);
    const huge = interior(apply(exampleState(), { type: 'scene/setPartSize', mm: 1e12 }));
    expect(measuredSizeMm(fix(huge, 'interiorScale'))).toBeCloseTo(INTERIOR_MAX_MM, 3);
  });

  it('the factor an importer suggested wins when it lands in the range, and is spent by the fix', () => {
    const hinted = (hint: 1000 | 0.001, mm: number): ProjectState => {
      const s0 = exampleState();
      const root = s0.scene.roots[0];
      const s1: ProjectState = { ...s0, scene: { ...s0.scene, nodes: { ...s0.scene.nodes, [root]: { ...s0.scene.nodes[root], source: { kind: 'FILE', name: 'room.obj', format: 'OBJ', unitHint: hint } } } } };
      return interior(apply(s1, { type: 'scene/setPartSize', mm }));
    };
    // 2 mm: the power of ten would be 100 (200 mm), the importer says 1000 (2 m).
    const s = hinted(1000, 2);
    expect(result(s, 'interiorScale').detail).toMatchObject({ factor: 1000, hint: 1000 });
    const f = fix(s, 'interiorScale');
    expect(measuredSizeMm(f)).toBeCloseTo(2000, 6);
    expect(f.scene.nodes[f.scene.roots[0]].source).toEqual({ kind: 'FILE', name: 'room.obj', format: 'OBJ' });
    // Micrometres: 4 million, so ÷1000 gives 4000.
    expect(measuredSizeMm(fix(hinted(0.001, 4_000_000), 'interiorScale'))).toBeCloseTo(4000, 6);
    // A hint whose factor would still leave it out of range is not used.
    expect(interiorScaleFactor(0.01, 1000)).toBe(10000);
    expect(interiorScaleFactor(2, 1000)).toBe(1000);
    expect(interiorScaleFactor(2)).toBe(100);
  });

  it('the product type’s size is not the size to expect of an interior: the Doctor’s scale check leaves a room alone', () => {
    // 5 m under a Standard studio (200 mm): 25 times the product type, a warning for a product, none for a room.
    const big = apply(exampleState(), { type: 'scene/setPartSize', mm: 5000 });
    expect(runDoctor(big).find((r) => r.key === 'scale')!.status).toBe('WARN');
    const s = interior(big);
    expect(runDoctor(s).find((r) => r.key === 'scale')!.status).toBe('OK');
    expect(status(s, 'interiorScale')).toBe('OK');
    // The declared size is still asked about: a model 25 times what it says it is.
    const lie = interior({ ...big, scene: { ...big.scene, partSizeMm: 200 } });
    expect(runDoctor(lie).find((r) => r.key === 'scale')).toMatchObject({ status: 'WARN', detail: { reason: 'declared', actual: 5000, expected: 200 } });
  });
});

describe('an opening for the sun and the sky', () => {
  it('a closed room that the sky lights, with no glass, is dark: warned, and the fix lights it with the white room recipe', () => {
    const s = apply(room(), { type: 'env/set', patch: { kind: 'SKY' } });
    expect(result(s, 'interiorOpening')).toMatchObject({ status: 'WARN', detail: { camera: 'cam1' } });
    const f = fix(s, 'interiorOpening');
    expect(status(f, 'interiorOpening')).toBe('OK');
    expect(f.studio.lightSetup).toBe(OPENING_FIX_SETUP);
    expect(f.environment.kind).toBe('STUDIO');
    expect(f.studio.lights.some((l) => l.type === 'SUN')).toBe(false);
  });

  it('the sun alone is enough to be asked about, with the dome of the studio around it', () => {
    const sunny = apply(room(), { type: 'studio/setSetup', key: 'INT_WINDOW_NOON' }, { type: 'env/set', patch: { kind: 'STUDIO' } });
    expect(sunny.studio.lights.some((l) => l.type === 'SUN')).toBe(true);
    expect(status(sunny, 'interiorOpening')).toBe('WARN');
    expect(status(apply(sunny, { type: 'studio/setLight', id: sunny.studio.lights.find((l) => l.type === 'SUN')!.id, patch: { enabled: false } }), 'interiorOpening')).toBe('OK');
  });

  it('lamps and panels need no opening, and an HDRI the person loaded is not asked about', () => {
    expect(status(apply(room(), { type: 'studio/setSetup', key: 'INT_NIGHT_LAMPS' }), 'interiorOpening')).toBe('OK');
    // C1: Interior now starts with the midday window, whose sun is asked about whatever the environment; the HDRI alone
    // (over lamps) is not.
    expect(room().studio.lightSetup).toBe('INT_WINDOW_NOON');
    expect(status(apply(room(), { type: 'env/set', patch: { kind: 'HDRI' } }), 'interiorOpening')).toBe('WARN');
    expect(status(apply(room(), { type: 'studio/setSetup', key: 'INT_NIGHT_LAMPS' }, { type: 'env/set', patch: { kind: 'HDRI' } }), 'interiorOpening')).toBe('OK');
  });

  it('a window of glass, or of a transparent material, is the opening: nothing to say', () => {
    const sky = { type: 'env/set', patch: { kind: 'SKY' } } as const;
    const glass = apply(room(), box('Window', [1200, 40, 1000], [0, 1990, 1300], 'GLASS_CLEAR'), sky);
    expect(status(glass, 'interiorOpening')).toBe('OK');
    const base = apply(room(), box('Window', [1200, 40, 1000], [0, 1990, 1300]), sky);
    expect(status(base, 'interiorOpening')).toBe('WARN');
    const id = base.scene.nodes[partNamed(base, 'Window')].material!;
    expect(status(apply(base, { type: 'material/setParam', id, key: 'transmission', value: 0.9 }), 'interiorOpening')).toBe('OK');
    expect(status(apply(base, { type: 'material/setParam', id, key: 'opacity', value: 0.3 }), 'interiorOpening')).toBe('OK');
    expect(status(apply(base, { type: 'material/setParam', id, key: 'opacity', value: 0.9 }), 'interiorOpening')).toBe('WARN');
    // A window that is hidden lets nothing in.
    const hidden = apply(glass, { type: 'scene/setVisible', ids: [partNamed(glass, 'Window')], visible: false });
    expect(status(hidden, 'interiorOpening')).toBe('WARN');
  });

  it('is asked only about a camera that is inside a room: outside it, or inside something small, there is nothing to ask', () => {
    const sky = { type: 'env/set', patch: { kind: 'SKY' } } as const;
    expect(status(apply(room(), sky), 'interiorOpening')).toBe('WARN');
    expect(status(apply(room(), sky, { type: 'camera/set', id: 'cam1', patch: { distance: 9000, elevation: 20 } }), 'interiorOpening')).toBe('OK');
    // A table: the camera is not inside it, whatever it sees; a box of 1 m is no room even if the camera were in it.
    const table = interior(apply(createInitialState(), box('Table', [1000, 1000, 800], [0, 0, 400]), { type: 'camera/set', id: 'cam1', patch: { target: [0, 0, 400], distance: 100, elevation: 0 } }, sky));
    expect(status(table, 'interiorOpening')).toBe('OK');
    // Product scenes do not have the check at all.
    expect(runDoctor(reduce(apply(room(), sky), { type: 'scene/setType', sceneType: 'PRODUCT' })).some((r) => r.key === 'interiorOpening')).toBe(false);
  });
});

describe('window glass', () => {
  const PANE = box('Pane', [1500, 30, 1000], [0, 0, 1000], 'GLASS_CLEAR');
  const glass = (...more: Action[]): ProjectState => interior(apply(createInitialState(), PANE, ...more));
  const walls = (s: ProjectState, name: string) => s.materials[s.scene.nodes[partNamed(s, name)].material!].params.walls;

  it('a flat pane of glass with solid walls is thick or refractive: warned, and the fix makes it thin', () => {
    const s = glass();
    expect(walls(s, 'Pane') ?? 'SOLID').toBe('SOLID');
    expect(result(s, 'interiorGlass')).toMatchObject({ status: 'WARN', detail: { count: 1, name: 'Pane' } });
    const f = fix(s, 'interiorGlass');
    expect(status(f, 'interiorGlass')).toBe('OK');
    expect(walls(f, 'Pane')).toBe('THIN');
  });

  it('a pane that is already thin, a plate that is not glass, a glass that is not a pane and a pane too small to be a window are fine', () => {
    const thin = apply(glass(), { type: 'material/setParam', id: glass().scene.nodes[partNamed(glass(), 'Pane')].material!, key: 'walls', value: 'THIN' });
    expect(status(thin, 'interiorGlass')).toBe('OK');
    expect(status(interior(apply(createInitialState(), box('Plate', [1500, 30, 1000], [0, 0, 1000], 'ABS_GLOSS'))), 'interiorGlass')).toBe('OK');
    expect(status(interior(apply(createInitialState(), box('Vase', [300, 300, 400], [0, 0, 200], 'GLASS_CLEAR'))), 'interiorGlass')).toBe('OK');
    expect(status(interior(apply(createInitialState(), box('Rod', [20, 20, 1500], [0, 0, 750], 'GLASS_CLEAR'))), 'interiorGlass')).toBe('OK');
    expect(status(interior(apply(createInitialState(), box('Slide', [200, 8, 100], [0, 0, 50], 'GLASS_CLEAR'))), 'interiorGlass')).toBe('OK');
  });

  it('a pane that is turned is as flat as it was; one stretched from a cube is a pane, a cube is not; a hidden pane is not asked about', () => {
    const turned = interior(apply(createInitialState(), box('Pane', [1500, 30, 1000], [0, 0, 1000], 'GLASS_CLEAR', [37, 52, 71])));
    expect(status(turned, 'interiorGlass')).toBe('WARN');
    expect(status(apply(turned, { type: 'scene/setVisible', ids: [partNamed(turned, 'Pane')], visible: false }), 'interiorGlass')).toBe('OK');
    // A cube of 100 mm made 1.5 m by 30 mm by 1 m by its scale, and turned: the glass of a window modelled the lazy way.
    const cube = interior(apply(createInitialState(), box('Cube', [100, 100, 100], [0, 0, 1000], 'GLASS_CLEAR', [10, 20, 30])));
    expect(status(cube, 'interiorGlass')).toBe('OK');
    const stretched = apply(cube, { type: 'scene/setTransform', id: partNamed(cube, 'Cube'), transform: { scale: [15, 0.3, 10] } });
    expect(status(stretched, 'interiorGlass')).toBe('WARN');
    expect(status(fix(stretched, 'interiorGlass'), 'interiorGlass')).toBe('OK');
  });

  it('a glass shared with a part that is not a pane is copied: the pane goes thin, the other keeps its refraction', () => {
    const s = glass(box('Vase', [300, 300, 400], [1500, 0, 200], 'GLASS_CLEAR'));
    // Both use the one instance of the catalogue's glass.
    expect(s.scene.nodes[partNamed(s, 'Pane')].material).toBe(s.scene.nodes[partNamed(s, 'Vase')].material);
    const f = fix(s, 'interiorGlass');
    expect(status(f, 'interiorGlass')).toBe('OK');
    expect(walls(f, 'Pane')).toBe('THIN');
    expect(walls(f, 'Vase') ?? 'SOLID').toBe('SOLID');
    expect(f.scene.nodes[partNamed(f, 'Pane')].material).not.toBe(f.scene.nodes[partNamed(f, 'Vase')].material);
    // The copy is the pane's own, a glass still.
    expect(partMaterials(f.scene.nodes[partNamed(f, 'Pane')]).every((m) => f.materials[m].family === 'GLASS')).toBe(true);
  });

  it('two panes of one glass share the thin copy', () => {
    const s = glass(box('Pane 2', [1500, 30, 1000], [2000, 0, 1000], 'GLASS_CLEAR'), box('Vase', [300, 300, 400], [1500, 1500, 200], 'GLASS_CLEAR'));
    expect(result(s, 'interiorGlass').detail.count).toBe(2);
    const f = fix(s, 'interiorGlass');
    expect(f.scene.nodes[partNamed(f, 'Pane')].material).toBe(f.scene.nodes[partNamed(f, 'Pane 2')].material);
    expect(status(f, 'interiorGlass')).toBe('OK');
  });
});

describe('a lens wider than 18 mm', () => {
  const lens = (mm: number, id = 'cam1') => ({ type: 'camera/set', id, patch: { focalMm: mm } }) as const;

  it('a camera under 18 mm stretches the edges: warned with its lens, and the fix sets 24 mm and no lens preset', () => {
    const s = apply(interior(exampleState()), lens(14));
    expect(result(s, 'interiorLens')).toMatchObject({ status: 'WARN', detail: { count: 1, camera: 'cam1', focal: 14, wide: 18, fixed: 24 } });
    const f = fix(s, 'interiorLens');
    expect(status(f, 'interiorLens')).toBe('OK');
    expect(cam(f)).toMatchObject({ focalMm: 24, lens: null });
    // A camera that still names the preset it had (the lens preset of a camera set by hand) does not keep it: 24 mm is no preset's.
    const preset = apply(interior(exampleState()), { type: 'camera/set', id: 'cam1', patch: { focalMm: 14, lens: 'WIDE_ANGLE' } });
    expect(cam(preset).lens).toBe('WIDE_ANGLE');
    expect(cam(fix(preset, 'interiorLens')).lens).toBeNull();
    // The rest of the camera is as it was.
    expect({ ...cam(f), focalMm: 0, lens: null }).toEqual({ ...cam(s), focalMm: 0, lens: null });
  });

  it('18 mm and wider lenses are fine, and so is a camera that is orthographic', () => {
    const base = interior(exampleState());
    expect(status(apply(base, lens(18)), 'interiorLens')).toBe('OK');
    expect(status(apply(base, lens(17.9)), 'interiorLens')).toBe('WARN');
    expect(status(apply(base, lens(24)), 'interiorLens')).toBe('OK');
    expect(status(apply(base, lens(10), { type: 'camera/set', id: 'cam1', patch: { projection: 'ORTHOGRAPHIC' } }), 'interiorLens')).toBe('OK');
    // The type itself puts 28 mm: a fresh interior is no warning.
    expect(status(base, 'interiorLens')).toBe('OK');
  });

  it('every camera of the scene counts, and the fix leaves the wide-enough ones alone', () => {
    const s = apply(interior(exampleState()), { type: 'camera/add', name: 'Second' }, { type: 'camera/add', name: 'Third' }, lens(12, 'cam1'), lens(16, 'cam2'), lens(35, 'cam3'));
    expect(result(s, 'interiorLens').detail).toMatchObject({ count: 2, camera: 'cam1', focal: 12 });
    const f = fix(s, 'interiorLens');
    expect(f.camera.cameras.cam1.focalMm).toBe(24);
    expect(f.camera.cameras.cam2.focalMm).toBe(24);
    expect(f.camera.cameras.cam3.focalMm).toBe(35);
    expect(status(f, 'interiorLens')).toBe('OK');
  });
});

describe('eye height', () => {
  const at = (target: [number, number, number], distance: number, elevation: number, extra: Partial<CameraState> = {}): Action => ({ type: 'camera/set', id: 'cam1', patch: { target, distance, elevation, azimuth: 30, ...extra } });

  it('a camera at the height of a person, standing or sitting, is fine', () => {
    for (const z of [EYE_MIN_MM, 1100, 1500, EYE_MAX_MM]) expect(status(interior(apply(exampleState(), at([0, 0, z], 3000, 0))), 'interiorEye'), `${z}`).toBe('OK');
  });

  it('a camera that is too low or too high is warned with its height, and the fix puts it at 1.5 m looking at the same point', () => {
    for (const [elevation, target] of [[50, [0, 0, 500]], [-30, [0, 0, 100]], [35, [0, 0, 2000]]] as const) {
      const s = interior(apply(exampleState(), at([...target], 3000, elevation)));
      expect(result(s, 'interiorEye').status, `${elevation}`).toBe('WARN');
      expect(result(s, 'interiorEye').detail).toMatchObject({ count: 1, camera: 'cam1', height: Math.round(eye(s)), fixed: EYE_STANDING_MM });
      const f = fix(s, 'interiorEye');
      expect(status(f, 'interiorEye')).toBe('OK');
      expect(eye(f)).toBeCloseTo(EYE_STANDING_MM, 3);
      // The subject stays framed: same target, same side, same distance.
      expect(cam(f).target).toEqual(cam(s).target);
      expect(cam(f).azimuth).toBe(cam(s).azimuth);
      expect(cam(f).distance).toBeCloseTo(cam(s).distance, 6);
    }
  });

  it('a camera too close to its target to reach 1.5 m at a sane angle steps back, and its focus with it', () => {
    const s = interior(apply(exampleState(), at([0, 0, 0], 250, 60, { focusDistance: 250 })));
    expect(status(s, 'interiorEye')).toBe('WARN');
    const f = fix(s, 'interiorEye');
    expect(eye(f)).toBeCloseTo(EYE_STANDING_MM, 3);
    expect(cam(f).elevation).toBeCloseTo(80, 4);
    expect(cam(f).distance).toBeGreaterThan(cam(s).distance);
    expect(cam(f).focusDistance / cam(f).distance).toBeCloseTo(cam(s).focusDistance / cam(s).distance, 6);
    expect(status(f, 'interiorEye')).toBe('OK');
    // A camera with no distance is left as it is.
    const c = cam(s);
    expect(atEyeHeight({ ...c, distance: 0 })).toEqual({ ...c, distance: 0 });
  });

  it('a camera that is locked, or orthographic, is the person’s: it is not asked about', () => {
    const high = at([0, 0, 500], 4000, 50);
    expect(status(interior(apply(exampleState(), high)), 'interiorEye')).toBe('WARN');
    expect(status(interior(apply(exampleState(), high, { type: 'camera/set', id: 'cam1', patch: { locked: true } })), 'interiorEye')).toBe('OK');
    expect(status(interior(apply(exampleState(), high, { type: 'camera/set', id: 'cam1', patch: { projection: 'ORTHOGRAPHIC' } })), 'interiorEye')).toBe('OK');
  });

  it('counts every camera, and the fix moves only those that are off', () => {
    const s = interior(apply(exampleState(), { type: 'camera/add', name: 'Second' }, at([0, 0, 500], 4000, 50), { type: 'camera/set', id: 'cam2', patch: { target: [0, 0, 1000], distance: 3000, elevation: 0 } }));
    expect(result(s, 'interiorEye').detail.count).toBe(1);
    const f = fix(s, 'interiorEye');
    expect(f.camera.cameras.cam2).toEqual(s.camera.cameras.cam2);
    expect(eye(f, 'cam1')).toBeCloseTo(EYE_STANDING_MM, 3);
  });
});

describe('the near clip against the nearest wall', () => {
  it('a near clip that reaches the wall is warned with both distances, and the fix puts it half way', () => {
    // 1.9 m from the centre of a 4 m room: the wall is 100 mm behind... in front, 100 mm away.
    const s = roomWithInwardWalls({ type: 'camera/set', id: 'cam1', patch: { distance: 1900, clipStart: 150 } });
    expect(cameraPosition(cam(s))).toEqual([0, -1900, 1300]);
    expect(result(s, 'interiorClip')).toMatchObject({ status: 'WARN', detail: { count: 1, camera: 'cam1', clip: 150, wall: 100, fixed: 50 } });
    const f = fix(s, 'interiorClip');
    expect(status(f, 'interiorClip')).toBe('OK');
    expect(cam(f).clipStart).toBe(50);
    // Only the near clip changed.
    expect({ ...cam(f), clipStart: 0 }).toEqual({ ...cam(s), clipStart: 0 });
  });

  it('a near clip short of the wall is fine, and so is one on a camera that is not in the room', () => {
    expect(status(roomWithInwardWalls({ type: 'camera/set', id: 'cam1', patch: { distance: 1900, clipStart: 99.9 } }), 'interiorClip')).toBe('OK');
    expect(status(roomWithInwardWalls({ type: 'camera/set', id: 'cam1', patch: { distance: 1900, clipStart: 100 } }), 'interiorClip')).toBe('WARN');
    expect(status(roomWithInwardWalls(), 'interiorClip')).toBe('OK');
    // Outside the room the generic clip check of the Doctor is the one that speaks.
    expect(status(roomWithInwardWalls({ type: 'camera/set', id: 'cam1', patch: { distance: 6000, clipStart: 3000 } }), 'interiorClip')).toBe('OK');
  });

  it('the clip it puts is half the distance, at least a hundredth of a millimetre', () => {
    expect(clearClip(100)).toBe(50);
    expect(clearClip(0.5)).toBe(0.25);
    expect(clearClip(0)).toBe(0.01);
    expect(clearClip(333)).toBe(166.5);
  });

  it('every camera in the room counts', () => {
    const s = roomWithInwardWalls({ type: 'camera/add', name: 'Second' }, { type: 'camera/set', id: 'cam1', patch: { distance: 1900, clipStart: 150 } }, { type: 'camera/set', id: 'cam2', patch: { distance: 1700, clipStart: 400 } });
    expect(result(s, 'interiorClip').detail.count).toBe(2);
    const f = fix(s, 'interiorClip');
    expect(f.camera.cameras.cam1.clipStart).toBe(50);
    expect(f.camera.cameras.cam2.clipStart).toBe(clearClip(300));
    expect(status(f, 'interiorClip')).toBe('OK');
  });
});

describe('inverted normals', () => {
  const faces = (s: ProjectState, name: string) => s.scene.nodes[partNamed(s, name)].mesh!.id;

  it('a room whose walls face out, seen from inside, is warned; turned in, it is right; the fix flips it', () => {
    const s = room();
    expect(result(s, 'interiorNormals')).toMatchObject({ status: 'WARN', detail: { count: 1, name: 'Room' } });
    const f = fix(s, 'interiorNormals');
    expect(status(f, 'interiorNormals')).toBe('OK');
    expect(faces(f, 'Room')).not.toBe(faces(s, 'Room'));
    expect(status(roomWithInwardWalls(), 'interiorNormals')).toBe('OK');
    // The fix is the program's own flip: one more flip puts the walls back as they were.
    expect(status(apply(f, { type: 'scene/flipNormals', ids: [partNamed(f, 'Room')] }), 'interiorNormals')).toBe('WARN');
  });

  it('a solid seen from outside faces out; a solid turned inside out is warned, and the fix turns it right', () => {
    const table = interior(apply(createInitialState(), box('Table', [1000, 1000, 800], [0, 0, 400])));
    expect(status(table, 'interiorNormals')).toBe('OK');
    const inverted = apply(table, { type: 'scene/flipNormals', ids: [partNamed(table, 'Table')] });
    expect(result(inverted, 'interiorNormals')).toMatchObject({ status: 'WARN', detail: { count: 1, name: 'Table' } });
    const f = fix(inverted, 'interiorNormals');
    expect(status(f, 'interiorNormals')).toBe('OK');
    expect(faces(f, 'Table')).toBe(faces(table, 'Table'));
  });

  it('a part that is mirrored faces the other way, and is asked about as it is in the world', () => {
    const table = interior(apply(createInitialState(), box('Table', [1000, 1000, 800], [0, 0, 400])));
    const mirrored = apply(table, { type: 'scene/setTransform', id: partNamed(table, 'Table'), transform: { scale: [-1, 1, 1] } });
    expect(status(mirrored, 'interiorNormals')).toBe('WARN');
    // Mirrored and flipped: right again.
    expect(status(apply(mirrored, { type: 'scene/flipNormals', ids: [partNamed(mirrored, 'Table')] }), 'interiorNormals')).toBe('OK');
  });

  it('a flat wall of the room that faces away from the camera is warned; one that faces it is right', () => {
    const floor = plane('Floor', [4000, 4000], [0, 0, 0], [0, 0, 0]);
    // A wall 2 m ahead of the camera, standing: a rotation of 90 degrees about X turns the plane's normal (+Z) to -Y or +Y.
    const wall = (rx: number) => plane('Wall', [4000, 2600], [0, 2000, 1300], [rx, 0, 0]);
    const ceiling = plane('Ceiling', [4000, 4000], [0, 0, 2600], [180, 0, 0]);
    const scene = (rx: number) => interior(apply(createInitialState(), floor, wall(rx), ceiling, inside()));
    const facing = [90, -90].map((rx) => ({ rx, s: scene(rx), r: result(scene(rx), 'interiorNormals') }));
    // The camera looks along +Y at the wall: the wall faces it when its normal is -Y. Exactly one of the two turns does.
    expect(facing.filter((f) => f.r.status === 'WARN')).toHaveLength(1);
    const bad = facing.find((f) => f.r.status === 'WARN')!;
    expect(bad.r.detail).toMatchObject({ count: 1, name: 'Wall' });
    const f = fix(bad.s, 'interiorNormals');
    expect(status(f, 'interiorNormals')).toBe('OK');
    expect(status(facing.find((x) => x.r.status === 'OK')!.s, 'interiorNormals')).toBe('OK');
  });

  it('a sheet that is no wall (small), or a camera that is not in the room, is not asked about', () => {
    const card = interior(apply(createInitialState(), ROOM, plane('Card', [400, 300], [0, 1500, 1300], [90, 0, 0]), plane('Card 2', [400, 300], [0, 1500, 1500], [-90, 0, 0]), inside()));
    // The room itself is the only warning (its walls face out): the cards are neither.
    expect(result(card, 'interiorNormals').detail.count).toBe(1);
    const outside = interior(apply(createInitialState(), plane('Wall', [4000, 2600], [0, 2000, 1300], [90, 0, 0]), plane('Floor', [4000, 4000], [0, 0, 0], [0, 0, 0]), { type: 'camera/set', id: 'cam1', patch: { target: [0, 0, 1300], distance: 9000, azimuth: 0, elevation: 10 } }));
    expect(status(outside, 'interiorNormals')).toBe('OK');
  });

  it('looks at the normals of a budget of triangles per run, parts in tree order, and says nothing of the parts past it', () => {
    const sphere = (i: number): Action => ({ type: 'scene/addPrimitive', kind: 'SPHERE', params: { radius: 100, segments: 256 }, position: [i * 300, 0, 100], name: `S${i}` });
    let s = interior(apply(createInitialState(), sphere(0)));
    const each = s.scene.nodes[partNamed(s, 'S0')].mesh!.triangles;
    const fit = Math.floor(INTERIOR_NORMALS_TRIANGLES / each);
    for (let i = 1; i <= fit; i++) s = apply(s, sphere(i));
    // fit + 1 spheres: the last does not fit in the budget.
    expect(Object.keys(s.scene.nodes)).toHaveLength(fit + 1);
    expect(status(s, 'interiorNormals')).toBe('OK');
    const flip = (name: string) => apply(s, { type: 'scene/flipNormals', ids: [partNamed(s, name)] });
    expect(result(flip('S0'), 'interiorNormals')).toMatchObject({ status: 'WARN', detail: { count: 1, name: 'S0' } });
    expect(status(flip(`S${fit}`), 'interiorNormals')).toBe('OK');
    // The same answer however many times it is asked: the budget counts triangles, not what is cached.
    expect(status(flip(`S${fit}`), 'interiorNormals')).toBe('OK');
    expect(status(flip(`S${fit - 1}`), 'interiorNormals')).toBe('WARN');
    // It has to fill the whole budget (half a million triangles) and ask six times: about 3.5 s alone, more
    // on a loaded runner, so it gets its own limit like the other heavy tests.
  }, 60_000);

  it('a part without a mesh in the registry, or hidden, is not asked about', () => {
    const s = room();
    expect(status(apply(s, { type: 'scene/setVisible', ids: [partNamed(s, 'Room')], visible: false }), 'interiorNormals')).toBe('OK');
  });
});

describe('fix all and the badge', () => {
  it('clears every warning of an interior that has them all, in the order of the list', () => {
    const s = apply(
      interior(apply(createInitialState(), ROOM, box('Pane', [1500, 30, 1000], [0, 1990, 1300], 'GLASS_CLEAR'))),
      { type: 'camera/set', id: 'cam1', patch: { target: [0, 0, 1300], distance: 1900, azimuth: 0, elevation: 0, focalMm: 12, clipStart: 400 } },
    );
    const warned = runDoctor(s).filter((r) => r.status === 'WARN').map((r) => r.key);
    for (const k of ['interiorGlass', 'interiorLens', 'interiorClip', 'interiorNormals']) expect(warned, k).toContain(k);
    const f = apply(s, { type: 'doctor/fixAll' });
    expect(runDoctor(f).filter((r) => r.status === 'WARN').map((r) => r.key).filter((k) => (INTERIOR_CHECKS as readonly string[]).includes(k))).toEqual([]);
    expect(warningCount(runDoctor(f))).toBeLessThan(warningCount(runDoctor(s)));
  });

  it('the Doctor of a product scene does not know the interior checks, and a fix asked of one does nothing', () => {
    const s = exampleState();
    for (const k of INTERIOR_CHECKS) expect(apply(s, { type: 'doctor/fix', key: k }), k).toBe(s);
  });
});

// E6: the procedural patterns of wood (PATN) as the interface writes them, and the fixture the engine's
// sheet renders (tests/fixtures/patterns.rsb: every wood of the catalogue on a part of 100 mm).
//
//   REPACK_WRITE_FIXTURES=1 npx vitest run tests/patterns.test.ts     rewrites the fixture
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FAMILY_PARAMS, instanceFromPreset, paramEnabled } from '../src/core/materials';
import { knotSpecOf, meetsBox, meetsSurface, partKnots, placeKnots, woodFrame } from '../src/core/knots';
import { MATERIAL_PRESETS } from '../src/data/materials';
import {
  defaultCamera,
  defaultEnvironment,
  defaultFloor,
  defaultRender,
  materialToRsb,
  PATTERN_WOOD,
  patternToRsb,
  WOOD_FIGURES,
  projectScene,
  writeRsb,
  type RsbScene,
} from '../src/io/rsb';
import { apply, exampleState, keyIds } from './helpers';
import { readRsb, sections } from './rsb-reader';

const FIXTURE = 'tests/fixtures/patterns.rsb';
/** The part size of the sheet's spheres (their diameter). */
const SHEET_PART_MM = 100;

/** The presets the sheet shows: every wood. */
function sheetPresets() {
  return MATERIAL_PRESETS.filter((m) => m.family === 'WOOD');
}

/** The fixture: the presets' materials and patterns, and a NAME section with `KEY\tLabel` per material. */
function sheetFixture(): Uint8Array {
  const presets = sheetPresets();
  const materials = presets.map((m) => materialToRsb(instanceFromPreset(m.key, m.key, SHEET_PART_MM)));
  const patterns = presets.map((m, i) => patternToRsb(instanceFromPreset(m.key, m.key, SHEET_PART_MM), SHEET_PART_MM, i)!);
  const scene: RsbScene = {
    camera: defaultCamera(),
    materials,
    patterns,
    meshes: [],
    instances: null,
    lights: [],
    environment: defaultEnvironment(),
    floor: defaultFloor(),
    render: defaultRender(),
    bitmaps: [],
  };
  const body = writeRsb(scene);
  const names = presets.map((m) => new TextEncoder().encode(`${m.key}\t${m.label.en}`));
  const payload = 4 + names.reduce((n, b) => n + 4 + Math.ceil(b.length / 4) * 4, 0);
  const out = new Uint8Array(body.length + 8 + payload);
  out.set(body);
  const v = new DataView(out.buffer);
  let at = body.length;
  for (const c of 'NAME') out[at++] = c.charCodeAt(0);
  v.setUint32(at, payload, true);
  v.setUint32(at + 4, names.length, true);
  at += 8;
  for (const b of names) {
    v.setUint32(at, b.length, true);
    out.set(b, at + 4);
    at += 4 + Math.ceil(b.length / 4) * 4;
  }
  return out;
}

describe('E6 patterns: wood', () => {
  it('a wood carries its rings: two colours, ringDensity rings per 100 mm whatever the part, its noises and pores', () => {
    const oak = instanceFromPreset('o', 'OAK', 200)!;
    const p = patternToRsb(oak, 200, 3)!;
    expect(p.material).toBe(3);
    expect(p.kind).toBe(PATTERN_WOOD);
    expect(p.colorA).toEqual([0.56, 0.38, 0.21]);
    expect(p.colorB).toEqual([0.3, 0.18, 0.09]);
    expect(p.scaleMm).toBeCloseTo(100 / 33, 6);
    // Physical: the same rings on a ring box and on a sofa.
    expect(patternToRsb(instanceFromPreset('o', 'OAK', 30), 30, 0)!.scaleMm).toBe(p.scaleMm);
    expect(patternToRsb(instanceFromPreset('o', 'OAK', 2000), 2000, 0)!.scaleMm).toBe(p.scaleMm);
    expect(p.params).toEqual([0.45, 0.35, 0.25, 0.2, 0.35, 0.3, 0.5, 1, 1, 0.3, 0, 15, 0.3, 0.6, 0, 0]);
    expect(p.seed).toBe(oak.wear.seed);
    expect(p.variant).toBe(WOOD_FIGURES.RINGS);
    // The scale multiplies the spacing; edited values, fallbacks and limits.
    const edited = patternToRsb({ ...oak, params: { ...oak.params, ringDensity: 0, ringNoise: 3, woodScale: 2.5, poreDepth: 0.8 } }, 50, 0)!;
    expect(edited.scaleMm).toBeCloseTo(250, 6);
    expect(edited.params[1]).toBe(1);
    expect(edited.params[6]).toBe(0.8);
    const bare = patternToRsb({ ...oak, params: {} }, 140, 0)!;
    expect(bare.scaleMm).toBeCloseTo(100 / 33, 6);
    expect(bare.params).toEqual([0.4, 0.3, 0.2, 0.2, 0.3, 0.2, 0.3, 0, 1, 0.3, 0, 15, 0.3, 0.6, 0, 0]);
    // Species: pine has no pores, ash is ring-porous, bamboo strips, MDF a speckle without grain, ebony streaks.
    const of = (key: string) => patternToRsb(instanceFromPreset('w', key, 100), 100, 0)!;
    expect(of('PINE').params[5]).toBe(0);
    expect(of('ASH').params[7]).toBe(1);
    expect(of('MAPLE').scaleMm).toBeCloseTo(2.5, 6);
    expect([of('BAMBOO').variant, of('MDF').variant, of('EBONY').variant]).toEqual([1, 2, 3]);
    expect(of('MDF').params[9]).toBe(0);
    // The lead's pores: none on ebony, half as deep on walnut and mahogany.
    expect(of('EBONY').params[6]).toBe(0);
    expect([of('WALNUT').params[6], of('MAHOGANY').params[6]]).toEqual([0.175, 0.175]);
    // The other families have no pattern (yet).
    for (const key of ['WHITE_STUDIO', 'GLASS_CLEAR', 'LED_WARM']) expect(patternToRsb(instanceFromPreset('m', key, 200), 200, 0), key).toBeNull();
    expect(patternToRsb(null, 200, 0)).toBeNull();
  });

  it('projectScene sends the pattern with its material, in the order of the materials, and the bytes round trip', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const s = apply(s0, { type: 'material/assign', preset: 'WALNUT', targets: [ids.body], mode: 'REPLACE' });
    const { scene, materialOrder } = projectScene(s, { width: 64, height: 48, maxSamples: 1, maxSeconds: 0 });
    expect(scene.patterns!.length).toBe(1);
    const p = scene.patterns![0];
    const walnut = materialOrder.indexOf(s.scene.nodes[ids.body].material!);
    expect(p.material).toBe(walnut);
    expect(p.scaleMm).toBeCloseTo(100 / 33, 5);
    const bytes = writeRsb(scene);
    const tags = sections(bytes).map((x) => x.tag);
    expect(tags.lastIndexOf('MATL') + 1).toBe(tags.indexOf('PATN'));
    expect(sections(bytes).find((x) => x.tag === 'PATN')!.payload.byteLength).toBe(108);
    const back = readRsb(bytes);
    expect(back.patterns).toHaveLength(1);
    expect(back.patterns![0].scaleMm).toBe(Math.fround(p.scaleMm));
    expect(back.patterns![0].material).toBe(walnut);
    expect(back.patterns![0].params).toEqual(p.params.map((v) => Math.fround(v)));
    expect(back.patterns![0].seed).toBe(p.seed);
  });

  it('knots: count, size, variation and darkness per species, following the seed; none on bamboo, MDF and ebony', () => {
    const of = (key: string, params: Record<string, unknown> = {}, seed?: number) => {
      const inst = instanceFromPreset('w', key, 100)!;
      return patternToRsb({ ...inst, params: { ...inst.params, ...params }, wear: { ...inst.wear, seed: seed ?? inst.wear.seed } }, 100, 0)!;
    };
    const knots = (key: string) => of(key).params.slice(10, 14);
    expect(knots('PINE')).toEqual([4, 17.5, 0.43, 0.9]);
    expect(knots('CHERRY')[0]).toBe(1);
    expect(knots('WALNUT')[0]).toBe(1);
    for (const key of ['OAK', 'OAK_WHITE', 'ASH', 'TEAK', 'MAHOGANY', 'MAPLE', 'BIRCH']) expect(knots(key)[0], key).toBe(0);
    // Asked of a wood without rings, none are sent.
    for (const key of ['BAMBOO', 'MDF', 'EBONY']) expect(of(key, { knotCount: 6 }).params[10], key).toBe(0);
    // Limits, and the material's seed.
    expect(of('PINE', { knotCount: 40 }).params[10]).toBe(12);
    expect(of('PINE', { knotCount: 2.6, knotDarkness: 3, knotSizeVar: -1 }).params.slice(10, 14)).toEqual([3, 17.5, 0, 1]);
    expect(of('PINE', {}, 1234).seed).toBe(1234);
  });

  it('the knot knobs are disabled, with a note, where the wood has no rings', () => {
    const specs = FAMILY_PARAMS.WOOD.filter((p) => p.key.startsWith('knot'));
    expect(specs.map((p) => p.key)).toEqual(['knotCount', 'knotSize', 'knotSizeVar', 'knotDarkness']);
    for (const key of ['PINE', 'OAK', 'WALNUT']) for (const p of specs) expect(paramEnabled(instanceFromPreset('w', key, 100)!, p), key).toBe(true);
    for (const key of ['BAMBOO', 'MDF', 'EBONY']) for (const p of specs) expect(paramEnabled(instanceFromPreset('w', key, 100)!, p), key).toBe(false);
    expect(specs.every((p) => p.enabledWhen?.note === 'material.noKnots')).toBe(true);
  });

  it('the preview places the knots where the engine does (rt-core pattern/knots.rs pins the same numbers)', () => {
    const knots = placeKnots({ count: 4, diameterMm: 17.5, variation: 0.3, darkness: 0.7, seed: 7 }, [70, 160, 0], [60, 10, 200], meetsBox([70, 160, 0], [60, 10, 200]));
    const mids = knots.map((k) => [...k.origin.map((o, i) => o + k.axis[i] * k.middle), k.radius]);
    const pinned = [
      [51.081, 154.164, -45.991, 9.3261],
      [103.234, 169.191, -82.813, 10.2775],
      [121.727, 166.949, -189.95, 7.074],
      [68.936, 161.181, 20.757, 9.3602],
    ];
    expect(mids.length).toBe(4);
    mids.forEach((m, i) => m.forEach((v, j) => expect(Math.abs(v - pinned[i][j]), `${i}.${j}`).toBeLessThan(2e-3)));
    // The frame: a 200 mm board 40 wide and 18 thick, its pith 160 mm below and 70 mm aside (rt-core's test).
    const frame = woodFrame([0, 0, 0], [40, 200, 18], 1);
    [20 - 70, 100, 9 - 160].forEach((v, i) => expect(frame.origin[i]).toBeCloseTo(v, 9));
    // The spec the preview reads is the one the RSB carries; none for bamboo, MDF, ebony or a wood without knots.
    const pine = instanceFromPreset('w', 'PINE', 100)!;
    expect(knotSpecOf(pine)).toEqual({ count: 4, diameterMm: 17.5, variation: 0.43, darkness: 0.9, seed: pine.wear.seed });
    for (const key of ['BAMBOO', 'MDF', 'EBONY', 'OAK', 'WHITE_STUDIO']) expect(knotSpecOf(instanceFromPreset('w', key, 100)), key).toBeNull();
    // Knots meet the surface squarely, or are drawn again: a 20 mm cube (two triangles a face), mesh = world.
    const cube = {
      positions: [-10, -10, -10, 10, -10, -10, 10, 10, -10, -10, 10, -10, -10, -10, 10, 10, -10, 10, 10, 10, 10, -10, 10, 10],
      indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7],
    };
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const meets = (a: [number, number, number], b: [number, number, number], m = id) => meetsSurface(cube.positions, cube.indices, all, m, a, b);
    expect(meets([2, 1, -10], [2, 1, 10])).toBe(true); // straight through
    expect(meets([-9, 0, -10.8], [9, 0, -7.6])).toBe(false); // into the bottom at 10°
    expect(meets([-5, 0, -10], [5, 0, 10])).toBe(true); // 63°
    expect(meets([20, 20, -10], [20, 20, 10])).toBe(false); // misses
    // A non-uniform scale tilts the axis: measured in the world (x stretched 4 times, 59° becomes 23°).
    expect(meets([-6, 0, -10], [6, 0, 10])).toBe(true);
    expect(meets([-6, 0, -10], [6, 0, 10], [4, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toBe(false);
    // A part's knots: the bottle's body in pine, as the engine places them (inside the body's box).
    const s0 = exampleState();
    const ids = keyIds(s0);
    const st = apply(s0, { type: 'material/assign', preset: 'PINE', targets: [ids.body], mode: 'REPLACE' });
    const mat = st.scene.nodes[ids.body].material!;
    const pk = partKnots(st, ids.body, mat)!;
    expect(pk.asked).toBe(4);
    expect(pk.knots.length).toBeGreaterThan(0);
    expect(pk.knots.length).toBeLessThanOrEqual(4);
    expect(partKnots(st, ids.body, mat)).toBe(pk); // cached
    // No knots asked, none placed; the cap keeps its own material.
    const none = apply(st, { type: 'material/setParam', id: mat, key: 'knotCount', value: 0, label: 'x' } as never);
    expect(partKnots(none, ids.body, mat)).toBeNull();
    expect(frame.axes).toEqual([[1, 0, 0], [0, 0, 1], [0, 1, 0]]);
  });

  it(`the sheet's fixture (${FIXTURE}) is what the writer writes now`, () => {
    const bytes = sheetFixture();
    if (process.env.REPACK_WRITE_FIXTURES === '1') writeFileSync(FIXTURE, bytes);
    const committed = new Uint8Array(readFileSync(FIXTURE));
    expect(committed.length).toBe(bytes.length);
    expect(committed.every((b, i) => b === bytes[i])).toBe(true);
    expect(readRsb(committed).patterns!.length).toBe(sheetPresets().length);
  });
});

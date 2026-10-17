// E6: the procedural patterns of wood and cloth (PATN) as the interface writes them, and the fixture the
// engine's sheet renders (tests/fixtures/patterns.rsb: every wood and fabric of the catalogue on a part of 100 mm).
//
//   REPACK_WRITE_FIXTURES=1 npx vitest run tests/patterns.test.ts     rewrites the fixture
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fabricMeanColor, FAMILY_PARAMS, instanceFromPreset, paramEnabled, WEAVE_WARP_SHARE } from '../src/core/materials';
import { knotSpecOf, meetsBox, meetsSurface, partKnots, placeKnots, woodFrame } from '../src/core/knots';
import { MATERIAL_PRESETS } from '../src/data/materials';
import {
  defaultCamera,
  defaultEnvironment,
  defaultFloor,
  defaultRender,
  materialToRsb,
  PATTERN_CLOTH,
  PATTERN_WOOD,
  patternToRsb,
  WEAVES,
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

/** The presets the sheet shows: every wood, then every fabric (carbon fibre among them). */
function sheetPresets() {
  return [...MATERIAL_PRESETS.filter((m) => m.family === 'WOOD'), ...MATERIAL_PRESETS.filter((m) => m.family === 'FABRIC')];
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
      [61.512, 158.414, 21.696, 7.2598],
      [44.389, 161.345, -18.294, 9.2944],
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
    // The threshold is 45°: into the bottom at 50°, kept; at 40°, drawn again.
    expect(meets([-4.2, 0, -10.5], [4.2, 0, -0.5])).toBe(true);
    expect(meets([-5.95, 0, -10.5], [5.95, 0, -0.5])).toBe(false);
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

describe('E6 patterns: cloth', () => {
  const of = (key: string, params: Record<string, unknown> = {}, part = 100) => {
    const inst = instanceFromPreset('f', key, part)!;
    return patternToRsb({ ...inst, params: { ...inst.params, ...params } }, part, 2)!;
  };

  it('a fabric carries its weave: two thread colours, threadCount threads per cm whatever the part, its relief', () => {
    const denim = of('DENIM');
    expect(denim.material).toBe(2);
    expect(denim.kind).toBe(PATTERN_CLOTH);
    expect(denim.colorA).toEqual([0.1, 0.16, 0.3]);
    expect(denim.colorB).toEqual([0.66, 0.66, 0.64]);
    expect(denim.scaleMm).toBeCloseTo(10 / 24, 9);
    expect(denim.params).toEqual([0.6, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Smooth filaments: carbon's tows and the mesh show no twist.
    expect([of('CARBON').params[1], of('MESH').params[1], of('COTTON').params[1]]).toEqual([0, 0, 1]);
    // The lead's verdict: carbon with a shallow relief, 0.05 (its clear coat follows it).
    expect(of('CARBON').params[0]).toBe(0.05);
    expect(denim.variant).toBe(WEAVES.TWILL31);
    // Physical: the same threads on a phone case and on a sofa.
    expect(of('DENIM', {}, 30).scaleMm).toBe(denim.scaleMm);
    expect(of('DENIM', {}, 3000).scaleMm).toBe(denim.scaleMm);
    // Every fabric with its own weave and real thread spacing (the engine's variants, rt-core pattern/cloth.rs).
    const weaves = Object.fromEntries(MATERIAL_PRESETS.filter((m) => m.family === 'FABRIC').map((m) => [m.key, [of(m.key).variant, +(10 / of(m.key).scaleMm).toFixed(3)]]));
    expect(weaves).toEqual({
      COTTON: [0, 40], LINEN: [0, 18], TWILL: [1, 36], DENIM: [6, 24], SATIN: [2, 100], CANVAS: [3, 14],
      VELVET: [4, 30], FELT: [5, 20], KNIT: [4, 4], MESH: [0, 8], MICROFIB: [2, 120], CARBON: [1, 5],
    });
    expect(WEAVES).toEqual({ PLAIN: 0, TWILL: 1, SATIN: 2, CANVAS: 3, KNIT: 4, FELT: 5, TWILL31: 6 });
    // Edited values, limits and fallbacks; an unknown weave is plain.
    expect(of('COTTON', { threadCount: 1000, weaveDepth: 4 }).scaleMm).toBeCloseTo(10 / 200, 9);
    expect(of('COTTON', { threadCount: 0 }).scaleMm).toBeCloseTo(5, 9);
    expect(of('COTTON', { weaveDepth: 4, yarnTwist: -2 }).params.slice(0, 2)).toEqual([1, 0]);
    expect(of('COTTON', { weave: 'LACE' }).variant).toBe(0);
    const bare = patternToRsb({ ...instanceFromPreset('f', 'COTTON', 100)!, params: {} }, 100, 0)!;
    expect([bare.scaleMm, bare.params[0], bare.params[1], bare.variant]).toEqual([0.25, 0.35, 1, 0]);
    expect(bare.colorA).toEqual([0.7, 0.7, 0.68]);
  });

  it('the mean colour is the weave\'s: warp-faced satin and 3/1 twill show mostly warp, the preview and the engine agree', () => {
    // rt-core's Weave::warp_share pins the same shares (measured over the weave).
    expect(WEAVE_WARP_SHARE).toEqual({ SATIN: 0.72, TWILL31: 0.685 });
    for (const key of ['COTTON', 'DENIM', 'SATIN', 'KNIT', 'CARBON']) {
      const inst = instanceFromPreset('f', key, 100)!;
      expect(materialToRsb(inst).baseColor, key).toEqual(fabricMeanColor(inst.params));
    }
    const denim = fabricMeanColor(instanceFromPreset('f', 'DENIM', 100)!.params);
    [0.1 * 0.685 + 0.66 * 0.315, 0.16 * 0.685 + 0.66 * 0.315, 0.3 * 0.685 + 0.64 * 0.315].forEach((v, i) => expect(denim[i]).toBeCloseTo(v, 9));
    const cotton = fabricMeanColor(instanceFromPreset('f', 'COTTON', 100)!.params);
    [0.67, 0.66, 0.63].forEach((v, i) => expect(cotton[i]).toBeCloseTo(v, 9));
  });

  it('the weave, its density and relief are drawn by the engine; the fuzz roughness is stored', () => {
    const spec = (key: string) => FAMILY_PARAMS.FABRIC.find((p) => p.key === key)!;
    for (const key of ['weave', 'threadCount', 'weaveDepth']) expect([spec(key).preview, spec(key).engine], key).toEqual([false, true]);
    expect([spec('fuzzRoughness').preview, spec('fuzzRoughness').engine]).toEqual([false, undefined]);
    expect([spec('threadCount').min, spec('threadCount').max, spec('threadCount').unit, spec('threadCount').fallback]).toEqual([2, 200, '/cm', 40]);
    expect(spec('weave').options).toContain('TWILL31');
  });

  it('projectScene sends a fabric part\'s weave with its material', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const s = apply(s0, { type: 'material/assign', preset: 'DENIM', targets: [ids.body], mode: 'REPLACE' });
    const { scene, materialOrder } = projectScene(s, { width: 64, height: 48, maxSamples: 1, maxSeconds: 0 });
    const p = scene.patterns!.find((x) => x.kind === PATTERN_CLOTH)!;
    expect(p.material).toBe(materialOrder.indexOf(s.scene.nodes[ids.body].material!));
    expect(p.variant).toBe(WEAVES.TWILL31);
    const back = readRsb(writeRsb(scene)).patterns!.find((x) => x.kind === PATTERN_CLOTH)!;
    expect(back.scaleMm).toBe(Math.fround(10 / 24));
    expect(back.variant).toBe(WEAVES.TWILL31);
  });
});

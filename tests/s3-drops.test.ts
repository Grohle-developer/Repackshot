// Phase S3 on the page: the drop shape, the mixes of shapes and the variation of the ambient effects (core/effects.ts,
// the S3 fields of FXAM), and the front glass of a camera (core/optics.ts `frontGlass`, the GLAS section). The payloads
// byte for byte as the engine writes them (tests/fixtures/s3-drops.rsb and s3-glass.rsb, `rt --write-s3-drops-example`
// and `--write-s3-glass-example`), what an engine without the S3 bit gets, the store, the project files; with the real
// rt.wasm, the shapes the Fast preview reads and the two scenes' images, against the native pins.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeCamera } from '../src/core/camera';
import {
  effectFxam,
  effectHasShape,
  FXAM_BYTES,
  FXAM_S3_BYTES,
  fxamPayload,
  hasS3Fields,
  heaviestShape,
  makeEffect,
  mixWeights,
  normalizeEffects,
} from '../src/core/effects';
import { frontGlassOf, newFrontGlass, normalizeFrontGlass, normalizeOptics, opticsOf } from '../src/core/optics';
import { createStore, type ProjectState } from '../src/core/store';
import { AVAILABLE_EFFECTS, DEFAULT_MIX, DROP_TAIL, DROP_TIP, effectPreset } from '../src/data/effects';
import { FRONT_GLASS_FIXED, FRONT_GLASS_LIMITS } from '../src/data/front-glass';
import { loadProject, serializeProject } from '../src/io/project';
import { GLAS_BYTES, glassToRsb, projectScene, writeRsb, type RsbGlass, type RsbScene } from '../src/io/rsb';
import { readsDrops } from '../src/render/engine';
import { dropOutline, evalParticles, evalShapes, hasShapeExport, PARTICLE_FLOATS } from '../src/render/particles';
import { apply, exampleState } from './helpers';
import { readEffect, readRsb, sections } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const drops = new Uint8Array(readFileSync('tests/fixtures/s3-drops.rsb'));
const glass = new Uint8Array(readFileSync('tests/fixtures/s3-glass.rsb'));
const S3_TESTS = 'engine/crates/rt-core/src/render/s3_tests.rs';
const view = { width: 160, height: 120, maxSamples: 4, maxSeconds: 0 };

/** The GLAS fields of a payload (rt-core `GlassParams::decode`). */
function readGlass(p: DataView): RsbGlass {
  const u = (i: number) => p.getUint32(4 * i, true);
  const f = (i: number) => p.getFloat32(4 * i, true);
  return { flags: u(0), distanceMm: f(1), seed: u(2), dropCoverage: f(3), dropSizeMm: f(4), dropSizeVar: f(5), contactAngleDeg: f(6), ior: f(7), dustCoverage: f(8), dustSizeMm: f(9), dustSizeVar: f(10), dustOpacity: f(11) };
}

function withEffect(preset: Parameters<typeof makeEffect>[1] = 'RAIN'): ProjectState {
  return apply(exampleState(), { type: 'effect/add', preset });
}

describe('S3: the payloads of the engine', () => {
  it('writes the FXAM of drops and of a mix byte for byte as the engine does, with its 28 bytes more', () => {
    const fx = sections(drops).filter((x) => x.tag === 'FXAM');
    expect(fx).toHaveLength(2);
    for (const s of fx) {
      expect(s.payload.byteLength).toBe(FXAM_S3_BYTES);
      const bytes = new Uint8Array(s.payload.buffer, s.payload.byteOffset, s.payload.byteLength);
      const e = readEffect(s.payload);
      expect(hasS3Fields(e)).toBe(true);
      expect(Array.from(fxamPayload(e))).toEqual(Array.from(bytes));
    }
    // The rain of drops; the mix of 1 : 1 : 1 : 2 with its drop of 2 × and a tip of 0.2.
    const [rain, mix] = fx.map((s) => readEffect(s.payload));
    expect(rain.shape).toBe(3);
    expect(rain.mix).toEqual([0, 0, 0, 0]);
    expect(rain.shapeVar).toBe(Math.fround(0.4));
    expect(mix.mix).toEqual([1, 1, 1, 2]);
    expect([mix.dropTail, mix.dropTip]).toEqual([2, Math.fround(0.2)]);
  });

  it('writes the GLAS of a front glass byte for byte as the engine does', () => {
    const g = sections(glass).filter((x) => x.tag === 'GLAS');
    expect(g).toHaveLength(1);
    expect(g[0].payload.byteLength).toBe(GLAS_BYTES);
    // Right after the camera (no LENS in this scene).
    const tags = sections(glass).map((x) => x.tag);
    expect(tags.indexOf('GLAS')).toBe(tags.indexOf('CAMR') + 1);
    const fields = readGlass(g[0].payload);
    const scene = readRsb(glass);
    const again = writeRsb({ ...(scene as unknown as RsbScene), camera: { ...scene.camera!, glass: fields } });
    const back = sections(again).find((x) => x.tag === 'GLAS')!;
    expect(Array.from(new Uint8Array(back.payload.buffer, back.payload.byteOffset, back.payload.byteLength))).toEqual(
      Array.from(new Uint8Array(g[0].payload.buffer, g[0].payload.byteOffset, g[0].payload.byteLength)),
    );
    expect(fields.dropCoverage).toBe(Math.fround(0.35));
    expect(fields.dustOpacity).toBe(Math.fround(0.9));
  });
});

describe('S3: drops and mixes of the ambient effects', () => {
  it('a new effect has the default drop, no variation and its mix off; S4b payloads keep their 200 bytes', () => {
    const s = withEffect('RAIN');
    const e = s.effects[0];
    expect([e.dropTail, e.dropTip, e.shapeVar]).toEqual([DROP_TAIL, DROP_TIP, 0]);
    expect(e.shapeMix).toEqual(DEFAULT_MIX);
    expect(e.shapeMix.on).toBe(false);
    const f = effectFxam(s, e, 0, 100_000);
    expect(hasS3Fields(f)).toBe(false);
    expect(fxamPayload(f)).toHaveLength(FXAM_BYTES);
    expect(f.shape).toBe(2);
  });

  it('the Water drops preset is drops of clear water, and the catalogue keeps its keys', () => {
    const p = effectPreset('WATER_DROPS')!;
    expect(p.code).toBe(12);
    expect(p.values!.shape).toBe('DROP');
    expect(p.material!.kind).toBe('GLASS');
    expect(AVAILABLE_EFFECTS.map((x) => x.key)).toContain('WATER_DROPS');
    const s = withEffect('WATER_DROPS');
    const f = effectFxam(s, s.effects[0], 0, 100_000);
    expect(f.shape).toBe(3);
    expect(f.shapeVar).toBeCloseTo(0.3);
    expect(fxamPayload(f)).toHaveLength(FXAM_S3_BYTES);
  });

  it('a mix writes its weights and, for an older engine, the shape it draws most', () => {
    let s = withEffect('SNOW');
    s = apply(s, { type: 'effect/set', id: 'fx1', patch: { shapeMix: { on: true, SPHERE: 1, DISC: 0, CAPSULE: 2, DROP: 3 }, streak: 0.01 } });
    const e = s.effects[0];
    expect(mixWeights(e)).toEqual([1, 0, 2, 3]);
    expect(heaviestShape(e)).toBe('DROP');
    expect(effectHasShape(e, 'CAPSULE') && effectHasShape(e, 'DROP') && !effectHasShape(e, 'DISC')).toBe(true);
    const f = effectFxam(s, e, 0, 100_000);
    expect(f.mix).toEqual([1, 0, 2, 3]);
    expect(f.shape).toBe(3);
    // A mix with capsules carries the streak; a snow of discs alone would not.
    expect(f.streak).toBeCloseTo(0.01);
    // Without the S3 bit: no mix, no drop (the heaviest shape, a drop, is a sphere then), no S3 fields at all.
    const old = effectFxam(s, e, 0, 100_000, false);
    expect(old.mix).toEqual([0, 0, 0, 0]);
    expect(old.shape).toBe(0);
    expect(old.streak).toBe(0);
    expect(fxamPayload(old)).toHaveLength(FXAM_BYTES);
    // A mix switched off, or with no weight, is the effect's shape.
    const off = apply(s, { type: 'effect/set', id: 'fx1', patch: { shapeMix: { ...e.shapeMix, on: false } } });
    expect(mixWeights(off.effects[0])).toBeNull();
    expect(effectFxam(off, off.effects[0], 0, 100_000).shape).toBe(1);
    const empty = apply(s, { type: 'effect/set', id: 'fx1', patch: { shapeMix: { on: true, SPHERE: 0, DISC: 0, CAPSULE: 0, DROP: 0 } } });
    expect(mixWeights(empty.effects[0])).toBeNull();
  });

  it('the store keeps the S3 knobs in range, one undo entry each', () => {
    const store = createStore(withEffect('WATER_DROPS'));
    store.dispatch({ type: 'effect/set', id: 'fx1', patch: { dropTail: 99, dropTip: -1, shapeVar: 3 } });
    const e = store.get().effects[0];
    expect([e.dropTail, e.dropTip, e.shapeVar]).toEqual([16, 0, 1]);
    store.dispatch({ type: 'effect/set', id: 'fx1', patch: { shapeMix: { on: true, SPHERE: -2, DISC: Number.NaN, CAPSULE: 1, DROP: 1 } } });
    expect(store.get().effects[0].shapeMix).toEqual({ on: true, SPHERE: 0, DISC: 0, CAPSULE: 1, DROP: 1 });
    store.undo();
    expect(store.get().effects[0].shapeMix.on).toBe(false);
    store.undo();
    expect(store.get().effects[0].dropTail).toBe(DROP_TAIL);
  });

  it("an effect saved before S3 opens with its preset's drop and no mix; a saved mix opens as it was", async () => {
    const s = withEffect('WATER_DROPS');
    const { dropTail: _t, dropTip: _p, shapeVar: _v, shapeMix: _m, ...before } = s.effects[0];
    const back = normalizeEffects([before], s);
    expect(back[0].shapeMix.on).toBe(false);
    expect(back[0].dropTail).toBe(DROP_TAIL);
    expect(back[0].shapeVar).toBeCloseTo(0.3);
    const mixed = apply(s, { type: 'effect/set', id: 'fx1', patch: { shape: 'DROP', shapeMix: { on: true, SPHERE: 0, DISC: 1, CAPSULE: 0, DROP: 4 }, dropTail: 2.5 } });
    const loaded = loadProject(await serializeProject(mixed).text());
    expect(loaded.state.effects[0].shapeMix).toEqual({ on: true, SPHERE: 0, DISC: 1, CAPSULE: 0, DROP: 4 });
    expect(loaded.state.effects[0].dropTail).toBe(2.5);
    // A shape this version does not know is the preset's.
    expect(normalizeEffects([{ ...mixed.effects[0], shape: 'CUBE' }], s)[0].shape).toBe('DROP');
  });

  it("the preview's outline of a drop is the engine's: a body of radius one, a tip `tail` up the axis", () => {
    const pts = dropOutline(1.6, 0.15);
    expect(pts[0]).toEqual([0, -1]);
    expect(pts.at(-1)![0]).toBe(0);
    expect(pts.at(-1)![1]).toBeCloseTo(1.6 + 0.15);
    // Up the axis all the way, and never wider than the body.
    for (let i = 1; i < pts.length; i++) expect(pts[i][1]).toBeGreaterThanOrEqual(pts[i - 1][1] - 1e-9);
    expect(Math.max(...pts.map((p) => p[0]))).toBeLessThanOrEqual(1 + 1e-9);
    // A tail too short to show the tip is lengthened, as the engine does.
    expect(dropOutline(0.1, 0.2).at(-1)![1]).toBeCloseTo(1 - 0.2 + 0.05 + 0.2);
  });
});

describe('S3: the front glass of a camera', () => {
  it('is off until switched on, and draws nothing without drops or dust', () => {
    const s = exampleState();
    expect(opticsOf(activeCamera(s)).frontGlass).toBeUndefined();
    expect(frontGlassOf(opticsOf(activeCamera(s)))).toBeNull();
    expect(frontGlassOf({ ...opticsOf(activeCamera(s)), frontGlass: { ...newFrontGlass(), drops: 0, dust: 0 } })).toBeNull();
    expect(frontGlassOf({ ...opticsOf(activeCamera(s)), frontGlass: { ...newFrontGlass(), on: false } })).toBeNull();
    expect(frontGlassOf({ ...opticsOf(activeCamera(s)), frontGlass: newFrontGlass() })).not.toBeNull();
  });

  it('a file keeps it within the engine limits', () => {
    expect(normalizeFrontGlass(null)).toBeUndefined();
    const g = normalizeFrontGlass({ on: true, drops: 5, dropSizeMm: -1, dust: 'x', seed: 3.6, distanceMm: 1e9 })!;
    expect(g).toEqual({ on: true, drops: FRONT_GLASS_LIMITS.drops.max, dropSizeMm: FRONT_GLASS_LIMITS.dropSizeMm.min, dust: 0.02, seed: 4, distanceMm: FRONT_GLASS_LIMITS.distanceMm.max });
    expect(normalizeOptics({ frontGlass: { on: true, drops: 0.4 } }).frontGlass?.drops).toBe(0.4);
    expect(normalizeOptics({}).frontGlass).toBeUndefined();
  });

  it('goes to an engine that draws it as GLAS right after the camera, with the fixed values of the pane', () => {
    const store = createStore(exampleState());
    const id = store.get().camera.active;
    const optics = opticsOf(activeCamera(store.get()));
    store.dispatch({ type: 'camera/set', id, patch: { optics: { ...optics, frontGlass: { ...newFrontGlass(), drops: 0.4, dropSizeMm: 3, dust: 0.05, seed: 9, distanceMm: 30 } } } });
    const s = store.get();
    const bytes = writeRsb(projectScene(s, { ...view, drops: true }).scene);
    const tags = sections(bytes).map((x) => x.tag);
    expect(tags.indexOf('GLAS')).toBe(tags.indexOf('CAMR') + 1);
    const g = readGlass(sections(bytes).find((x) => x.tag === 'GLAS')!.payload);
    expect(g).toEqual({
      flags: 0,
      distanceMm: 30,
      seed: 9,
      dropCoverage: Math.fround(0.4),
      dropSizeMm: 3,
      dropSizeVar: Math.fround(FRONT_GLASS_FIXED.dropSizeVar),
      contactAngleDeg: FRONT_GLASS_FIXED.contactAngleDeg,
      ior: Math.fround(FRONT_GLASS_FIXED.ior),
      dustCoverage: Math.fround(0.05),
      dustSizeMm: Math.fround(FRONT_GLASS_FIXED.dustSizeMm),
      dustSizeVar: Math.fround(FRONT_GLASS_FIXED.dustSizeVar),
      dustOpacity: Math.fround(FRONT_GLASS_FIXED.dustOpacity),
    });
    expect(glassToRsb(newFrontGlass()).dropCoverage).toBe(0.3);
    // Not for an engine without the S3 bit, nor through a panoramic camera, nor switched off: the bytes of before.
    const plain = writeRsb(projectScene(exampleState(), view).scene);
    expect(Array.from(writeRsb(projectScene(s, view).scene))).toEqual(Array.from(plain));
    const pano = apply(s, { type: 'camera/set', id, patch: { projection: 'EQUIRECTANGULAR' } });
    expect(sections(writeRsb(projectScene(pano, { ...view, drops: true, cameras: true }).scene)).some((x) => x.tag === 'GLAS')).toBe(false);
    store.undo();
    expect(sections(writeRsb(projectScene(store.get(), { ...view, drops: true }).scene)).some((x) => x.tag === 'GLAS')).toBe(false);
  });

  it('is saved with the project and opened as it was', async () => {
    const s0 = exampleState();
    const id = s0.camera.active;
    const s = apply(s0, { type: 'camera/set', id, patch: { optics: { ...opticsOf(activeCamera(s0)), frontGlass: { ...newFrontGlass(), drops: 0.55, seed: 77 } } } });
    const loaded = loadProject(await serializeProject(s).text());
    expect(opticsOf(activeCamera(loaded.state)).frontGlass).toEqual({ ...newFrontGlass(), drops: 0.55, seed: 77 });
  });

  it('the engine says whether it draws drops: bit 6', () => {
    expect(readsDrops(64)).toBe(true);
    expect(readsDrops(63)).toBe(false);
    expect(readsDrops(undefined)).toBe(false);
    const lib = readFileSync('engine/crates/rt-core/src/lib.rs', 'utf8');
    expect(/pub const FEATURE_DROPS: u32 = (\d+);/.exec(lib)![1]).toBe('64');
  });
});

describe.skipIf(!RT_WASM)('S3 with the real rt.wasm', () => {
  it('gives the preview the shapes of a mix and the particles the native engine pins', async () => {
    const rt = await loadRt();
    expect(hasShapeExport(rt)).toBe(true);
    if (!hasShapeExport(rt)) return;
    const fx = sections(drops).filter((x) => x.tag === 'FXAM');
    const all: Float32Array[] = [];
    const shapes: Uint32Array[] = [];
    for (const s of fx) {
      const bytes = new Uint8Array(s.payload.buffer, s.payload.byteOffset, s.payload.byteLength);
      const n = readEffect(s.payload).count;
      all.push(evalParticles(rt, bytes, n)!);
      shapes.push(evalShapes(rt, bytes, n)!);
      expect(shapes.at(-1)!.length).toBe(n);
      expect(all.at(-1)!.length).toBe(n * PARTICLE_FLOATS);
    }
    const join = <T extends Float32Array | Uint32Array>(parts: T[], make: (n: number) => T): T => {
      const out = make(parts.reduce((k, a) => k + a.length, 0));
      let o = 0;
      for (const a of parts) {
        out.set(a as never, o);
        o += a.length;
      }
      return out;
    };
    expect(fnv1a(join(all, (n) => new Float32Array(n)))).toBe(pinned(S3_TESTS, 'PINNED_S3_DROPS_PARTICLES'));
    const codes = join(shapes, (n) => new Uint32Array(n));
    expect(fnv1a(new Float32Array(codes.buffer))).toBe(pinned(S3_TESTS, 'PINNED_S3_DROPS_SHAPES'));
    // The rain is all drops; the mix has every shape.
    expect(shapes[0].every((c) => c === 3)).toBe(true);
    expect(new Set(shapes[1])).toEqual(new Set([0, 1, 2, 3]));
  });

  it('renders the drops and the front glass to the native hashes through the page code', async () => {
    const rt = await loadRt();
    for (const [bytes, pin] of [
      [drops, 'PINNED_S3_DROPS_4SPP'],
      [glass, 'PINNED_S3_GLASS_4SPP'],
    ] as const) {
      const { image } = renderWithPasses(rt, bytes, 160, 120, 4, 0);
      expect(fnv1a(resolveRgb(image, 4)), pin).toBe(pinned(S3_TESTS, pin));
    }
  }, 240_000);

  it('a project with a front glass and an effect of drops loads, and the glass changes the picture', async () => {
    const rt = await loadRt();
    let s = withEffect('WATER_DROPS');
    const id = s.camera.active;
    const small = { width: 32, height: 24, maxSamples: 1, maxSeconds: 0, drops: true };
    const before = resolveRgb(renderWithPasses(rt, writeRsb(projectScene(s, small).scene), 32, 24, 1, 0).image, 1);
    s = apply(s, { type: 'camera/set', id, patch: { optics: { ...opticsOf(activeCamera(s)), frontGlass: { ...newFrontGlass(), drops: 0.6, dropSizeMm: 6 } } } });
    const after = resolveRgb(renderWithPasses(rt, writeRsb(projectScene(s, small).scene), 32, 24, 1, 0).image, 1);
    expect(Array.from(after)).not.toEqual(Array.from(before));
  }, 120_000);
});

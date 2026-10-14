// The ambient effects in the RSB (phase S4a): the FXAM payload byte for byte as the engine writes it (the sections
// of `rt --write-ambient-example`, tests/fixtures/ambient.rsb, read and written again), where projectScene puts the
// sections and the effects' materials, the units, the cap, and what is left out. With the real rt.wasm (`npm run
// engine:build`), the particles the Fast preview evaluates and the image of the fixture are the native engine's.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectFxam, fxamPayload, FXAM_BYTES, type AmbientEffect } from '../src/core/effects';
import type { ProjectState } from '../src/core/store';
import { effectMaterial, effectMaterialToRsb, MATERIAL_FLAG_THIN, MATERIAL_GLASS, MATERIAL_PRINCIPLED, projectScene, writeRsb } from '../src/io/rsb';
import { evalParticles, hasParticleExport, PARTICLE_FLOATS, previewTint } from '../src/render/particles';
import { apply, exampleState } from './helpers';
import { readEffect, readRsb, sections } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const fixture = new Uint8Array(readFileSync('tests/fixtures/ambient.rsb'));
const AMBIENT_TESTS = 'engine/crates/rt-core/src/render/ambient_tests.rs';
const view = { width: 160, height: 120, maxSamples: 4, maxSeconds: 0 };

function withEffects(...presets: AmbientEffect['preset'][]): ProjectState {
  let s = exampleState();
  for (const p of presets) s = apply(s, { type: 'effect/add', preset: p });
  return s;
}

describe('FXAM: the engine layout', () => {
  it('writes the payloads of the engine byte for byte', () => {
    const fx = sections(fixture).filter((x) => x.tag === 'FXAM');
    expect(fx).toHaveLength(3);
    for (const s of fx) {
      expect(s.payload.byteLength).toBe(FXAM_BYTES);
      const bytes = new Uint8Array(s.payload.buffer, s.payload.byteOffset, s.payload.byteLength);
      const again = fxamPayload(readEffect(s.payload));
      expect(Array.from(again)).toEqual(Array.from(bytes));
    }
  });

  it('puts the sections after the lights, one per effect that is on, each with its own material after the parts', () => {
    let s = withEffects('DUST_MOTES', 'RAIN', 'SNOW');
    s = apply(s, { type: 'effect/set', id: 'fx2', patch: { enabled: false } });
    const { scene, materialOrder } = projectScene(s, view);
    const bytes = writeRsb(scene);
    const tags = sections(bytes).map((x) => x.tag);
    const at = tags.indexOf('FXAM');
    expect(tags.filter((t) => t === 'FXAM')).toHaveLength(2);
    expect(tags[at - 1]).toBe('LGHT');
    expect(tags[at + 2]).toBe('ENVR');
    const read = readRsb(bytes);
    const parts = scene.materials.length - 2;
    expect(read.effects!.map((e) => e.materialId)).toEqual([parts, parts + 1]);
    expect(read.effects!.map((e) => e.kind)).toEqual([1, 4]);
    // The guard's table sees them as default materials.
    expect(materialOrder.slice(-2)).toEqual([null, null]);
    // An update without meshes carries them too.
    expect(sections(writeRsb(scene, { meshes: false })).filter((x) => x.tag === 'FXAM')).toHaveLength(2);
    // No effects: the bytes of before S4a.
    const plain = exampleState();
    expect(sections(writeRsb(projectScene(plain, view).scene)).some((x) => x.tag === 'FXAM')).toBe(false);
  });

  it('writes the effect in the engine units and at most the cap', () => {
    let s = withEffects('RAIN');
    s = apply(s, { type: 'effect/set', id: 'fx1', patch: { amountMode: 'COUNT', count: 5000, wind: [2, 0, 0] } });
    const capped = readRsb(writeRsb(projectScene(s, { ...view, particleCap: 1200 }).scene)).effects![0];
    expect(capped.count).toBe(1200);
    const e = readRsb(writeRsb(projectScene(s, { ...view, particleCap: 100_000 }).scene)).effects![0];
    expect(e.count).toBe(5000);
    expect(e.wind).toEqual([2000, 0, 0]);
    expect(e.fallSpeed).toBeCloseTo(s.effects[0].fallSpeed * 1000, 3);
    expect(e.shape).toBe(2);
    expect(e.flags).toBe(1 | 2);
    // The region box: the product with its margin, never under the floor.
    expect(e.regionCenter[2] - e.regionHalf[2]).toBe(0);
    const f = effectFxam(s, s.effects[0], e.materialId, 100_000);
    expect(e.regionHalf.map((v) => Math.fround(v))).toEqual(f.regionHalf.map((v) => Math.fround(v)));
  });

  it("gives an effect its own material or the catalogue's", () => {
    const s = withEffects('RAIN', 'SNOW');
    const rain = effectMaterial(s, s.effects[0]);
    expect(rain.kind).toBe(MATERIAL_GLASS);
    expect(rain.ior).toBeCloseTo(1.33, 6);
    expect(rain.transmission).toBe(1);
    const snow = effectMaterialToRsb(s.effects[1].ownMaterial);
    expect(snow.kind).toBe(MATERIAL_PRINCIPLED);
    expect(snow.flags & MATERIAL_FLAG_THIN).toBe(MATERIAL_FLAG_THIN);
    const gold = effectMaterial(s, { ...s.effects[1], material: 'GOLD' });
    expect(gold.metallic).toBe(1);
    // An unknown key falls back to the effect's own.
    expect(effectMaterial(s, { ...s.effects[1], material: 'NOPE' })).toEqual(snow);
  });
});

describe('the preview tint', () => {
  it('picks the palette tint the engine picks and varies the brightness within the variation', () => {
    const palette = [
      [1, 0, 0],
      [0, 0, 1],
    ];
    expect(previewTint(4, palette, 0)).toEqual([1, 0, 0]);
    expect(previewTint(5, palette, 0)).toEqual([0, 0, 1]);
    for (let seed = 0; seed < 200; seed++) {
      const [r] = previewTint(seed * 2654435761, [], 0.5);
      expect(r).toBeGreaterThanOrEqual(0.75);
      expect(r).toBeLessThanOrEqual(1.25);
    }
  });
});

describe.skipIf(!RT_WASM)('with the real rt.wasm', () => {
  it('evaluates the particles of the fixture as the native engine does', async () => {
    const rt = await loadRt();
    expect(hasParticleExport(rt)).toBe(true);
    if (!hasParticleExport(rt)) return;
    const all: Float32Array[] = [];
    for (const s of sections(fixture).filter((x) => x.tag === 'FXAM')) {
      const bytes = new Uint8Array(s.payload.buffer, s.payload.byteOffset, s.payload.byteLength);
      const n = readEffect(s.payload).count;
      const data = evalParticles(rt, bytes, n);
      expect(data!.length).toBe(n * PARTICLE_FLOATS);
      all.push(data!);
    }
    const joined = new Float32Array(all.reduce((k, a) => k + a.length, 0));
    let o = 0;
    for (const a of all) {
      joined.set(a, o);
      o += a.length;
    }
    expect(fnv1a(joined)).toBe(pinned(AMBIENT_TESTS, 'PINNED_AMBIENT_PARTICLES'));
  });

  it('gives the preview a prefix of the particles the engine renders', async () => {
    const rt = await loadRt();
    if (!hasParticleExport(rt)) return;
    const s = apply(withEffects('SNOW'), { type: 'effect/set', id: 'fx1', patch: { amountMode: 'COUNT', count: 500 } });
    const f = effectFxam(s, s.effects[0], 0, 100_000);
    expect(f.count).toBe(500);
    const all = evalParticles(rt, fxamPayload(f), f.count)!;
    const few = evalParticles(rt, fxamPayload(f), 25)!;
    expect(few.length).toBe(25 * PARTICLE_FLOATS);
    expect(Array.from(few)).toEqual(Array.from(all.subarray(0, 25 * PARTICLE_FLOATS)));
    // A payload the engine refuses gives nothing.
    expect(evalParticles(rt, new Uint8Array(40), 10)).toBeNull();
  });

  it('renders the fixture to the native hash through the page code', async () => {
    const rt = await loadRt();
    const { image } = renderWithPasses(rt, fixture, 160, 120, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned(AMBIENT_TESTS, 'PINNED_AMBIENT_4SPP'));
  }, 120_000);

  it('loads a project scene with effects', async () => {
    const rt = await loadRt();
    const s = withEffects('DUST_MOTES', 'CONFETTI');
    const bytes = writeRsb(projectScene(s, { width: 32, height: 24, maxSamples: 1, maxSeconds: 0 }).scene);
    const { image } = renderWithPasses(rt, bytes, 32, 24, 1, 0);
    expect(resolveRgb(image, 1).some((v) => v > 0)).toBe(true);
  }, 60_000);
});

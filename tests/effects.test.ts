// The ambient effects as project data (phase S4a, core/effects.ts): the four actions through the store (undo, the
// gestures, nothing recorded for no change), what the engine is sent (the region, the count from the density, the
// cap, the forward lobe of S4b), the Doctor's warning and fix, and the effects in a project file (an old one opens
// with none; an effect saved before S4b takes its preset's lobe).

import { describe, expect, it } from 'vitest';
import { AVAILABLE_EFFECTS, EFFECT_PRESETS, effectPreset, type EffectKind } from '../src/data/effects';
import { runDoctor } from '../src/core/doctor';
import {
  BROWSER_PARTICLE_CAP,
  effectCap,
  effectForward,
  effectFxam,
  effectParticles,
  effectRegion,
  effectVolumeM3,
  engineParticleCap,
  fitToCap,
  makeEffect,
  NATIVE_PARTICLE_CAP,
  normalizeEffects,
  overCap,
  particleCapFor,
  requestedParticles,
  setEngineParticleCap,
  windPolar,
  windVector,
  type AmbientEffect,
} from '../src/core/effects';
import { productBounds } from '../src/core/scene';
import { createInitialState, createStore, reduce, type ProjectState } from '../src/core/store';
import { loadProject, serializeProject } from '../src/io/project';
import v2Text from './fixtures/project-v2.json?raw';
import { apply, exampleState } from './helpers';

const added = (s: ProjectState, preset: EffectKind = 'DUST_MOTES') => apply(s, { type: 'effect/add', preset });

describe('the catalogue of effects', () => {
  it('has the eight presets of S4a with stable keys, and the three volumes of S5 coming soon', () => {
    expect(AVAILABLE_EFFECTS.map((p) => p.key)).toEqual(['DUST_MOTES', 'POLLEN', 'RAIN', 'SNOW', 'DUST_CLOUD', 'ASH', 'BUBBLES', 'CONFETTI']);
    expect(EFFECT_PRESETS.filter((p) => p.soon).map((p) => p.key)).toEqual(['HAZE', 'LIGHT_SHAFTS', 'GROUND_FOG']);
    // The FXAM kind codes are unique and never zero.
    const codes = EFFECT_PRESETS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => c > 0)).toBe(true);
    for (const p of AVAILABLE_EFFECTS) {
      expect(p.values && p.material, p.key).toBeTruthy();
      expect(p.label.en && p.label.es && p.intent.en && p.intent.es, p.key).toBeTruthy();
    }
    // What the brief names: rain is water as glass, the dust cloud has its envelope, bubbles rise, confetti has tints.
    expect(effectPreset('RAIN')!.material!.kind).toBe('GLASS');
    expect(effectPreset('RAIN')!.values!.shape).toBe('CAPSULE');
    expect(effectPreset('DUST_CLOUD')!.values!.cloudRadius).toBeGreaterThan(0);
    expect(effectPreset('BUBBLES')!.values!.gravity).toBeLessThan(0);
    expect(effectPreset('CONFETTI')!.values!.palette.length).toBeGreaterThan(1);
  });
});

describe('effects through the store', () => {
  it('a new project has none; adding one is undoable and marks the project changed', () => {
    const store = createStore(exampleState());
    expect(store.get().effects).toEqual([]);
    store.dispatch({ type: 'effect/add', preset: 'RAIN' });
    const [e] = store.get().effects;
    expect(e.id).toBe('fx1');
    expect(e.preset).toBe('RAIN');
    expect(e.shape).toBe('CAPSULE');
    expect(store.get().meta.dirty).toBe(true);
    store.undo();
    expect(store.get().effects).toEqual([]);
    expect(store.get().meta.dirty).toBe(false);
    store.redo();
    expect(store.get().effects).toHaveLength(1);
    // Ids are never reused while an effect with a higher one exists.
    store.dispatch({ type: 'effect/add', preset: 'SNOW' });
    store.dispatch({ type: 'effect/remove', id: 'fx1' });
    store.dispatch({ type: 'effect/add', preset: 'DUST_MOTES' });
    expect(store.get().effects.map((x) => x.id)).toEqual(['fx2', 'fx3']);
  });

  it('a preset coming soon, or one that does not exist, adds nothing', () => {
    const s = exampleState();
    expect(apply(s, { type: 'effect/add', preset: 'HAZE' })).toBe(s);
    expect(apply(s, { type: 'effect/add', preset: 'NOPE' as never })).toBe(s);
  });

  it('a drag of a knob is one undo entry; a value it already has changes nothing', () => {
    const store = createStore(added(exampleState()));
    const before = store.history().undo.length;
    for (const v of [0.2, 0.3, 0.4]) store.dispatch({ type: 'effect/set', id: 'fx1', patch: { sizeMm: v }, gesture: 'g1' });
    expect(store.get().effects[0].sizeMm).toBe(0.4);
    expect(store.history().undo.length).toBe(before + 1);
    store.undo();
    expect(store.get().effects[0].sizeMm).toBe(effectPreset('DUST_MOTES')!.values!.sizeMm);
    const s = store.get();
    store.dispatch({ type: 'effect/set', id: 'fx1', patch: { sizeMm: s.effects[0].sizeMm } });
    expect(store.get()).toBe(s);
    store.dispatch({ type: 'effect/set', id: 'nope', patch: { sizeMm: 2 } });
    expect(store.get()).toBe(s);
  });

  it('keeps values in range', () => {
    const s = apply(added(exampleState()), { type: 'effect/set', id: 'fx1', patch: { sizeVar: 3, density: -5, count: 1e12, tintVar: -1, seed: -4, palette: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1]] } });
    const e = s.effects[0];
    expect([e.sizeVar, e.density, e.tintVar, e.seed]).toEqual([1, 0, 0, 0]);
    expect(e.count).toBe(1 << 24);
    expect(e.palette).toHaveLength(4);
  });

  it('changing the preset takes its values but keeps where the effect is, its instant, seed, cap and name', () => {
    let s = added(exampleState(), 'DUST_MOTES');
    s = apply(s, { type: 'effect/set', id: 'fx1', patch: { name: 'Beam dust', time: 2.5, seed: 77, cap: 5000, region: { ...s.effects[0].region, marginMm: 40 } } });
    const changed = apply(s, { type: 'effect/preset', id: 'fx1', preset: 'SNOW' });
    const e = changed.effects[0];
    expect(e.preset).toBe('SNOW');
    expect(e.shape).toBe('DISC');
    expect(e.sizeMm).toBe(effectPreset('SNOW')!.values!.sizeMm);
    expect(e.ownMaterial.baseColor).toEqual(effectPreset('SNOW')!.material!.baseColor);
    expect([e.name, e.time, e.seed, e.cap, e.region.marginMm]).toEqual(['Beam dust', 2.5, 77, 5000, 40]);
    // To the preset it already has: nothing.
    expect(apply(changed, { type: 'effect/preset', id: 'fx1', preset: 'SNOW' })).toBe(changed);
    expect(apply(changed, { type: 'effect/preset', id: 'fx1', preset: 'GROUND_FOG' })).toBe(changed);
  });

  it('removing is undoable', () => {
    const store = createStore(added(added(exampleState()), 'RAIN'));
    store.dispatch({ type: 'effect/remove', id: 'fx1' });
    expect(store.get().effects.map((e) => e.id)).toEqual(['fx2']);
    store.undo();
    expect(store.get().effects.map((e) => e.id)).toEqual(['fx1', 'fx2']);
  });
});

describe('what the engine gets', () => {
  it('the region is the product box with the margin, never below the floor, and the band cuts it', () => {
    const s = added(exampleState());
    const e = s.effects[0];
    const b = productBounds(s);
    const r = effectRegion(s, e);
    const m = e.region.marginMm;
    expect(m).toBe(Math.round(0.75 * s.scene.partSizeMm));
    expect(r.min[0]).toBeCloseTo(b.min[0] - m, 6);
    expect(r.max[1]).toBeCloseTo(b.max[1] + m, 6);
    expect(r.min[2]).toBe(0);
    expect(r.max[2]).toBeCloseTo(b.max[2] + m, 6);
    const banded = { ...e, band: { on: true, min: 50, max: 120 } };
    expect([effectRegion(s, banded).min[2], effectRegion(s, banded).max[2]]).toEqual([50, 120]);
    const box: AmbientEffect = { ...e, region: { ...e.region, mode: 'BOX', center: [10, 20, 30], size: [100, 200, 300] } };
    expect(effectRegion(s, box)).toEqual({ min: [-40, -80, 0], max: [60, 120, 180] });
  });

  it('the count is the density times the volume in cubic metres, or the count; at most the cap', () => {
    const s = added(exampleState());
    const e = s.effects[0];
    const v = effectVolumeM3(s, e);
    expect(requestedParticles(s, e)).toBe(Math.round(e.density * v));
    const counted = { ...e, amountMode: 'COUNT' as const, count: 1234 };
    expect(requestedParticles(s, counted)).toBe(1234);
    const cloud = { ...e, cloud: { ...e.cloud, on: true, radiusMm: 100 } };
    expect(effectVolumeM3(s, cloud)).toBeCloseTo((4 / 3) * Math.PI * 0.001, 9);
    // The cap: the effect's own, at most the engine's.
    expect(effectCap(e, 100_000)).toBe(100_000);
    expect(effectCap({ ...e, cap: 500 }, 100_000)).toBe(500);
    expect(effectCap({ ...e, cap: 5_000_000 }, 100_000)).toBe(100_000);
    const many = { ...counted, count: 250_000 };
    expect(effectParticles(s, many, 100_000)).toBe(100_000);
    expect(effectParticles(s, { ...many, enabled: false }, 100_000)).toBe(0);
  });

  it('the FXAM fields are in the engine units: mm, mm/s, the strength from the chaos and the scale, the flags', () => {
    const s = added(exampleState(), 'RAIN');
    const e: AmbientEffect = { ...s.effects[0], wind: [1, -0.5, 0.25], energy: 0.3, chaos: 0.5, turbulenceScaleMm: 200, turbulenceSpeed: 0.1, camera: true, reflections: false, shadows: true, time: 1.5, seed: 9 };
    const f = effectFxam(s, e, 7, 1_000_000);
    expect(f.kind).toBe(3);
    expect(f.materialId).toBe(7);
    expect(f.wind).toEqual([1000, -500, 250]);
    expect(f.fallSpeed).toBe(e.fallSpeed * 1000);
    expect(f.energy).toBeCloseTo(300, 6);
    expect(f.turbulence).toEqual([100, 200, 100]);
    expect(f.flags).toBe(1 | 4);
    expect(f.shape).toBe(2);
    expect(f.streak).toBe(e.streak);
    expect([f.time, f.seed]).toEqual([1.5, 9]);
    // A streak only means something for capsules.
    expect(effectFxam(s, { ...e, shape: 'SPHERE' }, 0).streak).toBe(0);
    // The band is applied to the box, so the engine gets none.
    expect(f.band).toEqual([0, 0]);
  });

  it('S4b: dust, pollen and the dust cloud send their forward lobe; the others, and a catalogue material, none', () => {
    for (const p of AVAILABLE_EFFECTS) {
      const s = added(exampleState(), p.key);
      const f = effectFxam(s, s.effects[0], 0, 1_000_000);
      const lobe = ['DUST_MOTES', 'POLLEN', 'DUST_CLOUD'].includes(p.key);
      expect([f.forward, f.forwardG], p.key).toEqual(lobe ? [0.5, 0.7] : [0, 0]);
    }
    const s = added(exampleState(), 'DUST_MOTES');
    const e = s.effects[0];
    expect(effectForward({ ...e, material: 'GOLD' })).toEqual([0, 0]);
    // An unknown key renders with the effect's own material, and so its lobe.
    expect(effectForward({ ...e, material: 'NOPE' })).toEqual([0.5, 0.7]);
    // A clear own material gets none (the engine would not tell the lobe from the refraction).
    expect(effectForward({ ...e, ownMaterial: { ...e.ownMaterial, transmission: 0.3 } })).toEqual([0, 0]);
    expect(effectForward({ ...e, ownMaterial: { ...e.ownMaterial, kind: 'GLASS' } })).toEqual([0, 0]);
    // In range, whatever a file says.
    expect(effectForward({ ...e, ownMaterial: { ...e.ownMaterial, forward: 7, forwardG: -3 } })).toEqual([1, -0.95]);
    expect(effectForward({ ...e, ownMaterial: { ...e.ownMaterial, forward: Number.NaN } })).toEqual([0, 0]);
  });

  it('the wind knob is the horizontal part of the vector, as a speed and a direction', () => {
    expect(windVector(2, 90, 0.5)).toEqual([0, 2, 0.5]);
    const p = windPolar(windVector(1.5, 210));
    expect(p.speed).toBeCloseTo(1.5, 5);
    expect(p.dirDeg).toBeCloseTo(210, 6);
    expect(windPolar([0, 0, 3])).toEqual({ speed: 0, dirDeg: 0 });
  });

  it('the cap of the engine: the setting, or 100 000 in the browser and 1 000 000 natively', () => {
    expect(particleCapFor(0, false)).toBe(BROWSER_PARTICLE_CAP);
    expect(particleCapFor(0, true)).toBe(NATIVE_PARTICLE_CAP);
    expect(particleCapFor(25_000, true)).toBe(25_000);
    const was = engineParticleCap();
    setEngineParticleCap(-3);
    expect(engineParticleCap()).toBe(BROWSER_PARTICLE_CAP);
    setEngineParticleCap(was);
  });
});

describe('the Doctor and the cap', () => {
  it('warns when an effect asks for more than its cap and its fix brings the amount down to it', () => {
    let s = added(exampleState());
    expect(runDoctor(s).find((r) => r.key === 'particles')!.status).toBe('OK');
    s = apply(s, { type: 'effect/set', id: 'fx1', patch: { cap: 300 } });
    const e = s.effects[0];
    expect(requestedParticles(s, e)).toBeGreaterThan(300);
    const r = s.doctor.results.find((x) => x.key === 'particles')!;
    expect(r.status).toBe('WARN');
    expect(r.detail.cap).toBe(300);
    expect(r.detail.effect).toBe('fx1');
    const fixed = apply(s, { type: 'doctor/fix', key: 'particles' });
    expect(requestedParticles(fixed, fixed.effects[0])).toBeLessThanOrEqual(300);
    expect(requestedParticles(fixed, fixed.effects[0])).toBeGreaterThan(290);
    expect(fixed.doctor.results.find((x) => x.key === 'particles')!.status).toBe('OK');
    // A count is set to the cap.
    const counted = apply(s, { type: 'effect/set', id: 'fx1', patch: { amountMode: 'COUNT', count: 5000 } });
    expect(fitToCap(counted).effects[0].count).toBe(300);
    expect(overCap(fitToCap(counted))).toEqual([]);
    // An effect that is off asks for nothing.
    expect(overCap(apply(s, { type: 'effect/set', id: 'fx1', patch: { enabled: false } }))).toEqual([]);
  });

  it('runs again when the engine cap changes (doctor/refresh), without an undo entry', () => {
    const was = engineParticleCap();
    try {
      const store = createStore(apply(added(exampleState()), { type: 'effect/set', id: 'fx1', patch: { amountMode: 'COUNT', count: 50_000 } }));
      const entries = store.history().undo.length;
      expect(store.get().doctor.results.find((x) => x.key === 'particles')!.status).toBe('OK');
      setEngineParticleCap(20_000);
      store.dispatch({ type: 'doctor/refresh' });
      expect(store.get().doctor.results.find((x) => x.key === 'particles')!.status).toBe('WARN');
      expect(store.history().undo.length).toBe(entries);
      const s = store.get();
      store.dispatch({ type: 'doctor/refresh' });
      expect(store.get()).toBe(s);
    } finally {
      setEngineParticleCap(was);
    }
  });
});

describe('effects in project files', () => {
  it('are saved and opened as they were', async () => {
    let s = added(added(exampleState(), 'CONFETTI'), 'RAIN');
    s = apply(s, { type: 'effect/set', id: 'fx2', patch: { name: 'Storm', wind: [2, 0.5, 0], material: 'GLASS_CLEAR', shadows: true } });
    // Every field away from what the preset would fill in, so that a field the file loses shows.
    const fx1 = s.effects[0];
    const patch = {
      enabled: false,
      amountMode: 'COUNT',
      count: 4321,
      density: 77,
      sizeMm: 3.5,
      sizeVar: 0.15,
      shape: 'SPHERE',
      energy: 0.4,
      chaos: 1.2,
      turbulenceScaleMm: 55,
      turbulenceSpeed: 0.3,
      fallSpeed: 1.1,
      fallVar: 0.45,
      gravity: 0.7,
      spin: 2.5,
      streak: 0.02,
      region: { mode: 'BOX', marginMm: 33, center: [1, 2, 3], size: [40, 50, 60] },
      band: { on: true, min: 10, max: 90 },
      cloud: { on: true, center: [4, 5, 6], radiusMm: 70, softness: 0.25 },
      ownMaterial: { ...fx1.ownMaterial, baseColor: [0.1, 0.2, 0.3], roughness: 0.66 },
      tintVar: 0.85,
      palette: [[0.5, 0.25, 1]],
      time: 2.75,
      camera: false,
      reflections: false,
      shadows: false,
      cap: 999,
      seed: 424242,
    } as const satisfies Partial<AmbientEffect>;
    s = apply(s, { type: 'effect/set', id: 'fx1', patch: { ...patch, region: { ...patch.region, center: [1, 2, 3], size: [40, 50, 60] }, cloud: { ...patch.cloud, center: [4, 5, 6] }, ownMaterial: { ...patch.ownMaterial, baseColor: [0.1, 0.2, 0.3] }, palette: [[0.5, 0.25, 1]] } });
    const fresh = makeEffect(s, 'CONFETTI', 'fx1');
    for (const k of Object.keys(patch) as (keyof AmbientEffect)[]) expect(s.effects[0][k], k).not.toEqual(fresh[k]);
    const opened = loadProject(await serializeProject(s).text()).state;
    expect(opened.effects).toEqual(s.effects);
  });

  it('a project from before S4a opens with none', () => {
    const opened = loadProject(v2Text).state;
    expect(opened.effects).toEqual([]);
  });

  it('damaged entries are dropped, missing fields take their preset values, an unknown preset the first one', () => {
    const s = exampleState();
    const fresh = makeEffect(s, 'SNOW', 'fx4');
    const raw = [
      null,
      { id: 7 },
      { id: 'fx4', preset: 'SNOW', sizeMm: 9, wind: [1, 2], region: { mode: 'NOPE' } },
      { id: 'fx4', preset: 'RAIN' },
      { id: 'fx9', preset: 'FROM_THE_FUTURE', density: 12 },
    ];
    const out = normalizeEffects(raw, s);
    expect(out.map((e) => e.id)).toEqual(['fx4', 'fx9']);
    expect(out[0].sizeMm).toBe(9);
    expect(out[0].wind).toEqual(fresh.wind);
    expect(out[0].region).toEqual(fresh.region);
    expect(out[0].shape).toBe('DISC');
    expect(out[1].preset).toBe(AVAILABLE_EFFECTS[0].key);
    expect(out[1].density).toBe(12);
    expect(normalizeEffects('nope', s)).toEqual([]);
  });

  it('an effect saved before S4b takes the forward lobe of its preset; one saved with its own keeps it', () => {
    const s = exampleState();
    const old = { ...makeEffect(s, 'DUST_MOTES', 'fx1'), ownMaterial: { kind: 'SURFACE', baseColor: [0.5, 0.5, 0.5], roughness: 0.4, ior: 1.5, transmission: 0, absorptionMm: 0, thin: false } };
    const [opened] = normalizeEffects([old], s);
    expect([opened.ownMaterial.forward, opened.ownMaterial.forwardG]).toEqual([0.5, 0.7]);
    expect(opened.ownMaterial.baseColor).toEqual([0.5, 0.5, 0.5]);
    const own = { ...old, ownMaterial: { ...old.ownMaterial, forward: 0.25, forwardG: 0.6 } };
    expect(normalizeEffects([own], s)[0].ownMaterial).toMatchObject({ forward: 0.25, forwardG: 0.6 });
  });

  it('a new state is a valid project with effects in it', () => {
    const s = reduce(createInitialState(), { type: 'effect/add', preset: 'POLLEN' });
    expect(s.effects).toHaveLength(1);
    // Without parts the region stands on the floor around the origin, one part size across with the margin.
    const r = effectRegion(s, s.effects[0]);
    expect(r.min[2]).toBe(0);
    expect(r.max[0] - r.min[0]).toBeCloseTo(s.scene.partSizeMm + 2 * s.effects[0].region.marginMm, 6);
  });
});

// Phase K1: the Interior style of the light catalogue (INTERIORS.md §3.5). Seven recipes that each pick a world (the sun and sky of
// a window, or the studio dome) and bring their own exposure and strength of the environment; they bring no decoration; they pass
// the same normalisation as every other setup; and choosing one, or leaving one, touches nothing of the scene it does not own.

import { describe, expect, it } from 'vitest';
import { LIGHT_SETUPS, LIGHT_STYLES, lightSetup, setupsInStyle } from '../src/data/light-setups';
import { STUDIO_PRESETS, studioPreset } from '../src/data/studios';
import type { LightSetup } from '../src/data/types';
import { cameraBasis } from '../src/core/camera';
import { dot } from '../src/core/math';
import { lightsFromRig, skySunDirection } from '../src/core/lighting';
import { baseExposure, presetIrradiance, rigIrradiance, setupExposure, setupRig } from '../src/core/rig';
import { hasDecoration, isSet, setPieceIds } from '../src/core/sets';
import { reduce, type ProjectState } from '../src/core/store';
import { apply, exampleState } from './helpers';

const INTERIOR = setupsInStyle('INTERIOR');
const KEYS = ['INT_WINDOW_MORNING', 'INT_WINDOW_NOON', 'INT_WINDOW_AFTERNOON', 'INT_OVERCAST', 'INT_NIGHT_LAMPS', 'INT_BLUE_HOUR', 'INT_WHITE_ROOM'];
const choose = (s: ProjectState, key: string): ProjectState => reduce(s, { type: 'studio/setSetup', key });

describe('the Interior style', () => {
  it('is the last style of the catalogue, with the seven recipes of INTERIORS.md §3.5, in that order, after every earlier setup', () => {
    expect(LIGHT_STYLES.at(-1)).toMatchObject({ key: 'INTERIOR', label: { es: 'Interior', en: 'Interior' } });
    expect(INTERIOR.map((s) => s.key)).toEqual(KEYS);
    expect(LIGHT_SETUPS.slice(-7)).toEqual(INTERIOR);
    expect(INTERIOR.map((s) => s.label.es)).toEqual(['Ventana de mañana', 'Ventana de mediodía', 'Ventana de tarde', 'Nublado', 'Lámparas de noche', 'Hora azul', 'Sala blanca de estudio']);
    expect(INTERIOR.map((s) => s.label.en)).toEqual(['Morning window', 'Midday window', 'Afternoon window', 'Overcast', 'Night lamps', 'Blue hour', 'White studio room']);
    for (const s of INTERIOR) {
      expect(s.intent.es.length, s.key).toBeGreaterThan(20);
      expect(s.intent.en.length, s.key).toBeGreaterThan(20);
    }
  });

  it('gives each recipe its world and its exposure: the daylight ones and the blue hour the sky, the others the studio dome', () => {
    expect(Object.fromEntries(INTERIOR.map((s) => [s.key, s.world]))).toEqual({
      INT_WINDOW_MORNING: 'SKY', INT_WINDOW_NOON: 'SKY', INT_WINDOW_AFTERNOON: 'SKY', INT_OVERCAST: 'STUDIO', INT_NIGHT_LAMPS: 'STUDIO', INT_BLUE_HOUR: 'SKY', INT_WHITE_ROOM: 'STUDIO',
    });
    for (const s of INTERIOR) {
      expect(typeof s.exposureEv, s.key).toBe('number');
      expect(typeof s.envStrength, s.key).toBe('number');
      expect(s.envStrength!, s.key).toBeGreaterThanOrEqual(0);
      expect(s.exposureEv!, s.key).toBeGreaterThan(-2);
      expect(s.exposureEv!, s.key).toBeLessThan(2);
    }
    // The night has no sky to speak of; the white room and the overcast day are bright.
    expect(lightSetup('INT_NIGHT_LAMPS')!.envStrength!).toBeLessThan(0.1);
    expect(lightSetup('INT_NIGHT_LAMPS')!.exposureEv!).toBeLessThan(0);
    expect(lightSetup('INT_WHITE_ROOM')!.exposureEv!).toBeGreaterThan(0);
  });

  it('is made of sets that bring a look and no decoration, so the scene they come to is not dressed', () => {
    for (const s of INTERIOR) {
      expect(isSet(s), s.key).toBe(true);
      expect(hasDecoration(s), s.key).toBe(false);
      expect(s.hero, s.key).toBeUndefined();
      for (const f of ['backdrop', 'pool', 'floor', 'cards', 'camera'] as const) expect(s[f], `${s.key}.${f}`).toBeUndefined();
    }
    // The sets of L6 all have one.
    expect(LIGHT_SETUPS.filter((s) => s.style === 'SETS').every(hasDecoration)).toBe(true);
  });

  it('puts the sun of a sky recipe where its light says (the sky takes the sun of the rig), above the horizon', () => {
    for (const s of INTERIOR.filter((x) => x.world === 'SKY')) {
      const sun = s.lights!.find((l) => l.type === 'SUN')!;
      const state = choose(apply(exampleState(), { type: 'studio/build' }), s.key);
      expect(state.environment.kind, s.key).toBe('SKY');
      const dir = skySunDirection(state);
      expect(dir[2], s.key).toBeCloseTo(Math.sin((sun.el * Math.PI) / 180), 6);
      expect(sun.el, s.key).toBeGreaterThan(0);
    }
  });

  it('passes the normalisation: every recipe has the irradiance of the product type, for all 16 types', () => {
    let checked = 0;
    for (const p of STUDIO_PRESETS) {
      for (const s of INTERIOR) {
        const total = rigIrradiance(setupRig(p.key, s.key));
        expect(Math.abs(total / presetIrradiance(p.key) - 1), `${p.key} / ${s.key}`).toBeLessThan(1e-6);
        checked++;
      }
    }
    expect(checked).toBe(16 * 7);
  });

  it('keeps the shares of the recipes of panels alone summing to 1, and gives every light a size, a distance and a share', () => {
    for (const s of INTERIOR) {
      for (const l of s.lights!) {
        expect(l.share, s.key).toBeGreaterThan(0);
        expect(l.size, s.key).toBeGreaterThan(0);
        expect(l.dist, s.key).toBeGreaterThan(0);
        expect(l.energy, s.key).toBeUndefined();
      }
      // A sun counts its irradiance and a panel its watts over 4 pi d2: a recipe that mixes them has shares on that scale.
      if (!s.lights!.some((l) => l.type === 'SUN') && s.world === 'STUDIO') expect(s.lights!.reduce((a, l) => a + l.share!, 0), s.key).toBeCloseTo(1, 9);
    }
  });

  it('has no light the camera sees and no light of a type the catalogue does not use', () => {
    for (const s of INTERIOR) for (const l of s.lights!) {
      expect(l.camera, s.key).toBeFalsy();
      expect(['AREA', 'SUN', undefined], s.key).toContain(l.type);
      expect(['SPHERE', 'ELLIPSE'].includes(l.shape ?? ''), s.key).toBe(false);
    }
  });
});

describe('choosing an Interior recipe', () => {
  const built = (preset = 'GENERIC'): ProjectState => apply(exampleState(), { type: 'studio/setPreset', key: preset }, { type: 'studio/build' });

  it('puts the recipe’s lights, its world, its strength and its exposure over the product type’s, on every type', () => {
    for (const p of STUDIO_PRESETS) {
      const base = built(p.key);
      for (const s of INTERIOR) {
        const state = choose(base, s.key);
        expect(state.studio.lightSetup, `${p.key} ${s.key}`).toBe(s.key);
        expect(state.studio.lights.filter((l) => !l.setPiece), `${p.key} ${s.key}`).toEqual(lightsFromRig(p.key, s.key));
        expect(state.environment.kind, `${p.key} ${s.key}`).toBe(s.world);
        expect(state.environment.strength, `${p.key} ${s.key}`).toBe(s.envStrength);
        expect(state.image.exposureEv, `${p.key} ${s.key}`).toBeCloseTo(baseExposure(studioPreset(p.key)!) + s.exposureEv!, 9);
        expect(state.image.exposureEv, `${p.key} ${s.key}`).toBeCloseTo(setupExposure(studioPreset(p.key)!, s.key), 9);
      }
    }
  });

  it('dresses nothing: no piece in the scene, no pool, and the floor, the contact shadow and the background as they were', () => {
    // Under another setup (no set of L6 in force), the Interior type has no contact shadow of its own, and the person made the background white.
    const base = apply(choose(built('FURNITURE_IN'), 'KEY_RIM'), { type: 'scene/setType', sceneType: 'INTERIOR' }, { type: 'env/set', patch: { background: 'COLOR', color: [1, 1, 1, 1] } });
    expect(base.studio.shadow).toBe(false);
    for (const s of INTERIOR) {
      const state = choose(base, s.key);
      expect(setPieceIds(state), s.key).toEqual([]);
      expect(state.studio.lights.some((l) => l.setPiece), s.key).toBe(false);
      expect(state.studio.shadow, s.key).toBe(false);
      expect(state.studio.floor, s.key).toBe(base.studio.floor);
      expect(state.environment.background, s.key).toBe('COLOR');
      expect(state.environment.color, s.key).toEqual([1, 1, 1, 1]);
    }
  });

  it('after a set with a backdrop, the product type’s background comes back (the set’s is not left on the frame)', () => {
    const dark = choose(built(), 'REMBRANDT');
    const preset = studioPreset('GENERIC')!;
    expect(dark.environment.background).toBe(preset.background === 'FLAT' ? 'COLOR' : 'ENVIRONMENT');
    for (const set of ['STRIP_EDGE', 'JEWEL_BOX', 'HIGH_KEY_WHITE']) {
      const withSet = choose(built(), set);
      expect(withSet.environment.background === dark.environment.background && withSet.environment.color[0] === dark.environment.color[0], `${set}: the set paints the frame`).toBe(false);
      const interior = choose(withSet, 'INT_OVERCAST');
      expect(interior.environment.background, set).toBe(dark.environment.background);
      expect(interior.environment.color, set).toEqual(dark.environment.color);
      expect(setPieceIds(interior), set).toEqual([]);
    }
  });

  it('leaving it for another setup brings the type’s exposure and strength back, and keeps a background the person chose', () => {
    const base = apply(choose(built('JEWELLERY'), 'KEY_RIM'), { type: 'env/set', patch: { background: 'COLOR', color: [0.9, 0.2, 0.2, 1] } });
    const inside = choose(base, 'INT_NIGHT_LAMPS');
    expect(inside.image.exposureEv).not.toBeCloseTo(base.image.exposureEv, 3);
    const out = choose(inside, 'KEY_RIM');
    expect(out.image.exposureEv).toBeCloseTo(baseExposure(studioPreset('JEWELLERY')!), 9);
    expect(out.environment.strength).toBe(studioPreset('JEWELLERY')!.envStrength);
    expect(out.environment.background).toBe('COLOR');
    expect(out.environment.color).toEqual([0.9, 0.2, 0.2, 1]);
    // And from one recipe to the next.
    const next = choose(inside, 'INT_WHITE_ROOM');
    expect(next.environment.color).toEqual([0.9, 0.2, 0.2, 1]);
    expect(next.environment.strength).toBe(lightSetup('INT_WHITE_ROOM')!.envStrength);
  });

  it('Reset setup brings the recipe’s lights back, and Create studio keeps the recipe with its look', () => {
    const inside = choose(built(), 'INT_BLUE_HOUR');
    const moved = apply(inside, { type: 'studio/setLight', id: inside.studio.lights[1].id, patch: { az: 10 } });
    expect(moved.studio.modified).toBe(true);
    const reset = reduce(moved, { type: 'studio/resetLights' });
    expect(reset.studio.lights).toEqual(inside.studio.lights);
    const again = reduce(inside, { type: 'studio/build' });
    expect(again.studio.lightSetup).toBe('INT_BLUE_HOUR');
    expect(again.environment.strength).toBe(lightSetup('INT_BLUE_HOUR')!.envStrength);
    expect(again.image.exposureEv).toBeCloseTo(setupExposure(studioPreset('GENERIC')!, 'INT_BLUE_HOUR'), 9);
    expect(again.environment.kind).toBe('SKY');
  });

  it('the sun of a window recipe gives the sky its direction relative to the camera, as the sky setups of before do', () => {
    const state = choose(built(), 'INT_WINDOW_AFTERNOON');
    const sun = state.studio.lights.find((l) => l.type === 'SUN')!;
    const basis = cameraBasis(state.camera.cameras[state.camera.active].azimuth, 0);
    const dir = skySunDirection(state);
    // Camera-relative azimuth: the sun is on the camera's right (positive), low.
    expect(sun.az).toBeGreaterThan(0);
    expect(dot(dir, basis.right)).toBeGreaterThan(0);
  });

  it('is not what the catalogue lists as a set of L6', () => {
    const sets = LIGHT_SETUPS.filter((s: LightSetup) => s.style === 'SETS');
    expect(sets).toHaveLength(16);
    expect(INTERIOR.some((s) => sets.includes(s))).toBe(false);
  });
});

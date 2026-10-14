// Phase L4: own lights (area rectangle, disc and sphere; point; spot; sun) as lights of the rig with their own
// placement: added, duplicated, deleted, aimed, placed on a surface, saved as a setup of the library (with the
// exposure normalisation on another product type), reset to the setup, written to the engine (RSB LGHT) and kept in
// the project file.

import { describe, expect, it } from 'vitest';
import { CAMERA_AZIMUTH_DEG } from '../src/data/light-setups';
import { activeCamera } from '../src/core/camera';
import { applyLibrarySetup, customSetupOf, emptyLibrary, fromCurrentRig } from '../src/core/library';
import {
  isSphereLike,
  levelUp,
  lightAimPoint,
  lightFrame,
  lightIrradiance,
  lightLumens,
  lightPosition,
  lightShares,
  NEW_LIGHT,
  NEW_LIGHT_KINDS,
  newLight,
  nextLightId,
  placementOf,
  polarAboutPivot,
  rigPivot,
  skySunDirection,
  SPOT_DEFAULTS,
  type LightInstance,
} from '../src/core/lighting';
import { add, dot, length, normalize, scale, sub, type Vec3 } from '../src/core/math';
import { areaLightFlux, LUMENS_PER_WATT, pointLightFlux, pointLightIntensity, spotFraction } from '../src/core/photometry';
import { presetIrradiance, rigIrradiance } from '../src/core/rig';
import { createStore, type ProjectState } from '../src/core/store';
import { exportLibrary, importLibrary } from '../src/io/library';
import { loadProject, serializeProject } from '../src/io/project';
import { LIGHT_DISK, LIGHT_FLAG_NO_SHADOW, LIGHT_POINT, LIGHT_RECT, LIGHT_SPOT, LIGHT_SUN, lightToRsb, projectScene, writeRsb } from '../src/io/rsb';
import { readRsb } from './rsb-reader';
import { apply, exampleState } from './helpers';

const near = (a: readonly number[], b: readonly number[], eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));
const own = (s: ProjectState) => s.studio.lights.filter((l) => l.own);
const last = (s: ProjectState): LightInstance => s.studio.lights[s.studio.lights.length - 1];

describe('Add light', () => {
  it('adds each kind in front of and above the part, switched on, selected and own', () => {
    const s0 = exampleState();
    const cam = activeCamera(s0);
    for (const kind of NEW_LIGHT_KINDS) {
      const s = apply(s0, { type: 'studio/addLight', kind });
      const l = last(s);
      expect(s.studio.lights).toHaveLength(s0.studio.lights.length + 1);
      expect(l).toMatchObject({ own: true, enabled: true });
      expect(s.selection.ids).toEqual([l.id]);
      expect(s.studio.modified).toBe(true);
      const want = { RECTANGLE: ['AREA', 'RECTANGLE'], DISK: ['AREA', 'DISK'], SPHERE: ['AREA', 'SPHERE'], POINT: ['POINT'], SPOT: ['SPOT'], SUN: ['SUN'] }[kind];
      expect(l.type).toBe(want[0]);
      if (want[1]) expect(l.shape).toBe(want[1]);
      // In front: on the camera's side of the product, a little to its right, above the horizon.
      const toLight = sub(lightPosition(s, l), rigPivot(s));
      const toCam = sub(cam.target, [0, 0, 0]);
      void toCam;
      expect(l.az + CAMERA_AZIMUTH_DEG - cam.azimuth).toBeCloseTo(NEW_LIGHT.side, 9);
      expect(toLight[2]).toBeGreaterThan(0);
      expect(l.el).toBe(kind === 'SUN' ? NEW_LIGHT.sunEl : NEW_LIGHT.el);
      if (kind === 'SPOT') expect([l.spread, l.blend]).toEqual([SPOT_DEFAULTS.cone, SPOT_DEFAULTS.blend]);
    }
  });

  it('starts at the mean irradiance of the lights that are on, so the picture does not jump', () => {
    const s0 = exampleState();
    const on = s0.studio.lights.filter((l) => l.enabled);
    const mean = on.reduce((a, l) => a + lightIrradiance(l), 0) / on.length;
    for (const kind of NEW_LIGHT_KINDS) {
      const l = last(apply(s0, { type: 'studio/addLight', kind }));
      // A sun delivers its measure as it is, the others pi times theirs on their axis: it gets pi times the mean.
      expect(lightIrradiance(l)).toBeCloseTo(kind === 'SUN' ? Math.PI * mean : mean, 3);
    }
  });

  it('is one undo entry; ids never clash with lights, cameras or nodes; an unknown kind does nothing', () => {
    const store = createStore(exampleState());
    const before = store.get().studio.lights;
    store.dispatch({ type: 'studio/addLight', kind: 'SPOT', label: 'add' });
    store.dispatch({ type: 'studio/addLight', kind: 'POINT', label: 'add' });
    const ids = store.get().studio.lights.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(store.get().camera.cameras[id]).toBeUndefined();
      expect(store.get().scene.nodes[id]).toBeUndefined();
    }
    expect(nextLightId(store.get())).not.toBe(ids[ids.length - 1]);
    store.undo();
    store.undo();
    expect(store.get().studio.lights).toEqual(before);
    const s = store.get();
    expect(apply(s, { type: 'studio/addLight', kind: 'LASER' as never })).toBe(s);
  });

  it('duplicates (a little to the side, own, selected) and deletes, setup lights too', () => {
    let s = apply(exampleState(), { type: 'studio/addLight', kind: 'SPOT' });
    const spot = last(s);
    s = apply(s, { type: 'studio/setLight', id: spot.id, patch: { name: 'Hair light' } });
    s = apply(s, { type: 'studio/duplicateLight', id: spot.id });
    const copy = s.studio.lights[s.studio.lights.findIndex((l) => l.id === spot.id) + 1];
    expect(copy.id).not.toBe(spot.id);
    expect(copy).toMatchObject({ own: true, type: 'SPOT', spread: spot.spread, power: spot.power });
    expect(copy.name).toBeUndefined();
    expect(copy.az).toBeCloseTo(spot.az + 15, 9);
    expect(s.selection.ids).toEqual([copy.id]);
    const key = s.studio.lights[0];
    s = apply(s, { type: 'studio/deleteLight', id: key.id });
    expect(s.studio.lights.some((l) => l.id === key.id)).toBe(false);
    s = apply(s, { type: 'studio/deleteLight', id: copy.id });
    expect(s.selection.ids).toEqual([]);
    expect(apply(s, { type: 'studio/deleteLight', id: 'nope' })).toBe(s);
  });

  it('Reset to setup takes the own lights away and brings back the setup', () => {
    const s0 = exampleState();
    let s = apply(s0, { type: 'studio/addLight', kind: 'RECTANGLE' }, { type: 'studio/addLight', kind: 'SUN' }, { type: 'studio/deleteLight', id: s0.studio.lights[1].id });
    expect(own(s)).toHaveLength(2);
    s = apply(s, { type: 'studio/resetLights' });
    expect(own(s)).toHaveLength(0);
    expect(s.studio.lights).toEqual(s0.studio.lights);
    expect(s.studio.modified).toBe(false);
  });
});

describe('aim, roll and placement', () => {
  it('a light aims at the rig pivot until it is given its own aim; Aim at… moves only where it looks', () => {
    let s = apply(exampleState(), { type: 'studio/addLight', kind: 'SPOT' });
    const l = last(s);
    near(lightAimPoint(s, l), rigPivot(s));
    const pos = lightPosition(s, l);
    const target: Vec3 = add(rigPivot(s), [30, -10, 20]);
    s = apply(s, { type: 'studio/aimLight', id: l.id, target });
    const aimed = last(s);
    near(lightAimPoint(s, aimed), target, 1e-9);
    near(lightPosition(s, aimed), pos, 1e-9);
    near(lightFrame(s, aimed).forward, normalize(sub(target, pos)), 1e-9);
    // Null: at the pivot again (the setup's lights all aim there).
    s = apply(s, { type: 'studio/aimLight', id: l.id, target: null });
    expect(last(s).aim).toBeUndefined();
    // Aiming at itself is no aim.
    expect(apply(s, { type: 'studio/aimLight', id: l.id, target: pos })).toBe(s);
  });

  it('a roll turns the panel about its axis; level, its sides are square to the floor', () => {
    let s = apply(exampleState(), { type: 'studio/addLight', kind: 'RECTANGLE' });
    const l = last(s);
    const f0 = lightFrame(s, l);
    expect(f0.right[2]).toBeCloseTo(0, 9);
    near(f0.up, levelUp(f0.forward), 1e-12);
    expect(dot(f0.up, f0.forward)).toBeCloseTo(0, 12);
    // Right hand about where it shines: a quarter turn takes up to the right.
    s = apply(s, { type: 'studio/setLight', id: l.id, patch: { roll: 90 } });
    const f1 = lightFrame(s, last(s));
    near(f1.up, f0.right, 1e-9);
    near(f1.forward, f0.forward, 1e-12);
  });

  it('placementOf is lightFrame backwards: position, aim and roll', () => {
    const s = apply(exampleState(), { type: 'studio/addLight', kind: 'RECTANGLE' });
    const pos: Vec3 = add(rigPivot(s), [120, -260, 180]);
    const target: Vec3 = add(rigPivot(s), [10, 5, -20]);
    const fwd = normalize(sub(target, pos));
    const up = normalize(add(levelUp(fwd), scale(normalize([fwd[1], -fwd[0], 0]), 0.6)));
    const patch = placementOf(s, pos, target, up)!;
    const l = { ...last(s), ...patch };
    const f = lightFrame(s, l);
    near(f.position, pos, 1e-9);
    near(f.target, target, 1e-9);
    near(f.up, normalize(sub(up, scale(fwd, dot(up, fwd)))), 1e-9);
    expect(polarAboutPivot(s, rigPivot(s))).toBeNull();
  });

  it('Place on surface stands the light over the point along its normal, as far as it was from its aim', () => {
    let s = apply(exampleState(), { type: 'studio/addLight', kind: 'DISK' });
    const l = last(s);
    const reach = length(sub(lightPosition(s, l), lightAimPoint(s, l)));
    const point: Vec3 = add(rigPivot(s), [40, -30, 10]);
    const normal: Vec3 = normalize([0.3, -1, 0.4]);
    s = apply(s, { type: 'studio/placeOnSurface', id: l.id, point, normal });
    const placed = last(s);
    near(lightPosition(s, placed), add(point, scale(normal, reach)), 1e-6);
    near(lightAimPoint(s, placed), point, 1e-9);
    expect(apply(s, { type: 'studio/placeOnSurface', id: l.id, point, normal: [0, 0, 0] })).toBe(s);
  });
});

describe('a setup of own lights (L4 criterion)', () => {
  /** Three own lights (an area panel, a spot and a point) instead of the setup's, each at its own power. */
  function threeLights(preset: string): ProjectState {
    let s = apply(exampleState(), { type: 'studio/setPreset', key: preset }, { type: 'studio/build' });
    for (const l of [...s.studio.lights]) s = apply(s, { type: 'studio/deleteLight', id: l.id });
    s = apply(s, { type: 'studio/addLight', kind: 'RECTANGLE' }, { type: 'studio/addLight', kind: 'SPOT' }, { type: 'studio/addLight', kind: 'POINT' });
    const [a, b, c] = s.studio.lights;
    return apply(
      s,
      { type: 'studio/setLight', id: a.id, patch: { power: a.power * 3, az: -60, dist: 2.5 } },
      { type: 'studio/setLight', id: b.id, patch: { az: 150, el: 30, dist: 1.6, blend: 0.4, shadow: false } },
      { type: 'studio/aimLight', id: b.id, target: add(rigPivot(s), [0, 0, 15]) },
      { type: 'studio/setLight', id: c.id, patch: { power: c.power * 0.5, el: 70 } },
    );
  }

  it('saved and applied to another product type keeps that type’s total irradiance and its own shares', () => {
    const src = threeLights('JEWELLERY');
    expect(src.studio.lights.map((l) => l.type)).toEqual(['AREA', 'SPOT', 'POINT']);
    const item = fromCurrentRig(src, emptyLibrary(), 'Three own', { id: 'set-1', now: 1 })!;
    expect(item.lights.map((l) => l.type)).toEqual(['AREA', 'SPOT', 'POINT']);
    expect(item.lights[1]).toMatchObject({ blend: 0.4, shadow: false });
    expect(item.lights[1].aim).toBeDefined();
    for (const preset of ['WATCH', 'FURNITURE_IN', 'GENERIC']) {
      const dst = apply(exampleState(), { type: 'studio/setPreset', key: preset }, { type: 'studio/build' }, { type: 'studio/applySetup', setup: customSetupOf(item) });
      const total = dst.studio.lights.reduce((a, l) => a + lightIrradiance(l), 0);
      expect(total).toBeCloseTo(presetIrradiance(preset), 9);
      expect(rigIrradiance(applyLibrarySetup(preset, item))).toBeCloseTo(presetIrradiance(preset), 9);
      // The shape of the light travels: the same shares, types, aims and soft edges.
      lightShares(dst.studio.lights).forEach((v, i) => expect(v).toBeCloseTo(lightShares(src.studio.lights)[i], 9));
      expect(dst.studio.lights.map((l) => l.type)).toEqual(['AREA', 'SPOT', 'POINT']);
      expect(dst.studio.lights[1]).toMatchObject({ blend: 0.4, shadow: false });
      near(dst.studio.lights[1].aim!, src.studio.lights[1].aim!, 1e-12);
    }
  });

  it('travels through the library file with its own fields', () => {
    const src = threeLights('PERFUME');
    const item = fromCurrentRig(src, emptyLibrary(), 'Three own', { id: 'set-2', now: 2 })!;
    const lib = { ...emptyLibrary(), lightSetups: [item] };
    const back = importLibrary(exportLibrary(lib), emptyLibrary());
    expect(back.skipped).toEqual([]);
    expect(back.lib.lightSetups[0].lights).toEqual(item.lights);
  });
});

describe('the engine and the preview are told the same', () => {
  it('point, sphere and spot lights are LGHT kinds 3 and 4 with the flux of their watts', () => {
    let s = exampleState();
    const size = s.scene.partSizeMm;
    for (const kind of ['POINT', 'SPHERE', 'SPOT'] as const) s = apply(s, { type: 'studio/addLight', kind });
    const [point, sphere, spot] = own(s);
    expect(own(s).every(isSphereLike)).toBe(true);
    const p = lightToRsb(s, point);
    expect(p.kind).toBe(LIGHT_POINT);
    expect(p.power).toBeCloseTo(pointLightFlux(point.power, size), 9);
    expect(p.sizeX).toBeCloseTo(point.size * size, 9);
    const q = lightToRsb(s, sphere);
    expect(q.kind).toBe(LIGHT_POINT);
    expect(q.sizeX).toBeCloseTo(sphere.size * size, 9);
    const r = lightToRsb(s, { ...spot, blend: 0.5, spread: 60 });
    expect(r.kind).toBe(LIGHT_SPOT);
    expect(r.spreadDeg).toBe(60);
    // The soft edge in degrees, inward from the cone's edge: half of the 30 degree half-angle.
    expect(r.angleDeg).toBeCloseTo(15, 9);
    expect(r.flags & LIGHT_FLAG_NO_SHADOW).toBe(0);
    expect(lightToRsb(s, { ...spot, shadow: false }).flags & LIGHT_FLAG_NO_SHADOW).toBe(LIGHT_FLAG_NO_SHADOW);
    // Its direction is towards its aim.
    near(r.direction, lightFrame(s, spot).forward, 1e-12);
    // Panels and suns are what they were.
    const panel = apply(s, { type: 'studio/addLight', kind: 'DISK' });
    expect(lightToRsb(panel, last(panel)).kind).toBe(LIGHT_DISK);
    const sun = apply(s, { type: 'studio/addLight', kind: 'SUN' });
    expect(lightToRsb(sun, last(sun)).kind).toBe(LIGHT_SUN);
    expect(lightToRsb(s, s.studio.lights[0]).kind).toBe(LIGHT_RECT);
  });

  it('a sun aimed elsewhere places the sky’s sun from its aim, in the engine and the preview alike', () => {
    let s = apply(exampleState(), { type: 'studio/addLight', kind: 'SUN' }, { type: 'env/set', patch: { kind: 'SKY' } });
    const sun = last(s);
    s = apply(s, { type: 'studio/aimLight', id: sun.id, target: add(rigPivot(s), [200, 0, 0]) });
    const aimed = last(s);
    const want = normalize(sub(lightPosition(s, aimed), lightAimPoint(s, aimed)));
    near(skySunDirection(s), want, 1e-12);
    const { scene } = projectScene(s, { width: 16, height: 9, maxSamples: 1, maxSeconds: 0 });
    const az = (Math.atan2(want[1], want[0]) * 180) / Math.PI;
    expect(scene.environment.sunAzimuthDeg).toBeCloseTo(az, 4);
    expect(scene.environment.sunElevationDeg).toBeCloseTo((Math.asin(want[2]) * 180) / Math.PI, 4);
  });

  it('a light without roll writes the world up as before L4; a rolled one its own up', () => {
    const s = exampleState();
    const key = s.studio.lights[0];
    expect(lightToRsb(s, key).up).toEqual([0, 0, 1]);
    const rolled = lightToRsb(s, { ...key, roll: 30 });
    near(rolled.up, lightFrame(s, { ...key, roll: 30 }).up, 1e-12);
    expect(rolled.up[2]).toBeLessThan(1);
  });

  it('the scene the engine reads back has every own light, and the file parses', () => {
    let s = exampleState();
    for (const kind of NEW_LIGHT_KINDS) s = apply(s, { type: 'studio/addLight', kind });
    s = apply(s, { type: 'studio/setLight', id: own(s)[0].id, patch: { enabled: false } });
    const { scene } = projectScene(s, { width: 64, height: 36, maxSamples: 1, maxSeconds: 0 });
    const kinds = scene.lights.map((l) => l.kind);
    expect(kinds.filter((k) => k === LIGHT_POINT)).toHaveLength(2);
    expect(kinds.filter((k) => k === LIGHT_SPOT)).toHaveLength(1);
    const back = readRsb(writeRsb(scene));
    expect(back.lights).toHaveLength(scene.lights.length);
    expect(back.lights.map((l: { kind: number }) => l.kind)).toEqual(kinds);
  });

  it('the preview’s point intensity gives the engine’s irradiance at any part size, a panel’s on its axis', () => {
    for (const size of [5, 200, 3000]) {
      const power = 40;
      const dist = 2.2;
      // Engine: flux F, intensity F / 4π W/sr, at dist · size mm.
      const flux = pointLightFlux(power, size);
      const eEngine = flux / (4 * Math.PI) / (dist * size * 1e-3) ** 2;
      // Preview: E = I / d² with d in mm.
      const ePreview = pointLightIntensity(power, size) / (dist * size) ** 2;
      expect(ePreview).toBeCloseTo(eEngine, 9);
      // A panel of the same watts facing it from there (seen from far: its intensity F / π) gives the same.
      const ePanel = areaLightFlux(power, size) / Math.PI / (dist * size * 1e-3) ** 2;
      expect(eEngine).toBeCloseTo(ePanel, 9);
      expect(eEngine).toBeCloseTo(power / (4 * dist * dist), 9);
    }
  });

  it('lumens come from the engine’s flux: a hard cone’s share is its solid angle, a soft edge less', () => {
    expect(spotFraction(60, 0)).toBeCloseTo((1 - Math.cos(Math.PI / 6)) / 2, 4);
    expect(spotFraction(60, 0.5)).toBeLessThan(spotFraction(60, 0));
    expect(spotFraction(60, 0.5)).toBeGreaterThan((1 - Math.cos(Math.PI / 12)) / 2);
    let s = exampleState();
    for (const kind of ['RECTANGLE', 'POINT', 'SPOT', 'SUN'] as const) s = apply(s, { type: 'studio/addLight', kind });
    const [rect, point, spot, sun] = own(s);
    const y = LUMENS_PER_WATT * (0.2126 * rect.color[0] + 0.7152 * rect.color[1] + 0.0722 * rect.color[2]);
    expect(lightLumens(s, rect)).toEqual({ value: areaLightFlux(rect.power, s.scene.partSizeMm) * y, unit: 'lm' });
    expect(lightLumens(s, point).value).toBeCloseTo(pointLightFlux(point.power, s.scene.partSizeMm) * y, 9);
    expect(lightLumens(s, spot).value).toBeCloseTo(lightLumens(s, { ...spot, type: 'POINT' }).value * spotFraction(spot.spread, spot.blend!), 9);
    expect(lightLumens(s, sun)).toEqual({ value: sun.power * y, unit: 'lx' });
  });

  it('a new light of a kind is what the menu says it is', () => {
    const s = exampleState();
    expect(newLight(s, 'SPHERE', 'x').size).toBe(NEW_LIGHT.sphere);
    expect(newLight(s, 'POINT', 'x').size).toBe(NEW_LIGHT.bulb);
    expect(newLight(s, 'RECTANGLE', 'x')).toMatchObject({ size: NEW_LIGHT.rect[0], sizeY: NEW_LIGHT.rect[1] });
  });
});

describe('the project file', () => {
  it('keeps the own lights, their aims, rolls, soft edges and shadows, byte for byte', () => {
    let s = exampleState();
    for (const kind of NEW_LIGHT_KINDS) s = apply(s, { type: 'studio/addLight', kind });
    const [rect, , , , spot] = own(s);
    s = apply(
      s,
      { type: 'studio/setLight', id: rect.id, patch: { roll: 25, name: 'Strip' } },
      { type: 'studio/setLight', id: spot.id, patch: { blend: 0.6, shadow: false } },
      { type: 'studio/aimLight', id: spot.id, target: add(rigPivot(s), [5, 5, 5]) },
    );
    return serializeProject(s)
      .text()
      .then((text) => {
        const loaded = loadProject(text).state;
        expect(loaded.studio.lights).toEqual(s.studio.lights);
        expect(loaded.studio.modified).toBe(true);
      });
  });

  it('a project from before L4 (no own fields) opens with lights that aim at the pivot and cast shadows', () => {
    const s = exampleState();
    return serializeProject(s)
      .text()
      .then((text) => {
        const loaded = loadProject(text).state;
        for (const l of loaded.studio.lights) {
          expect(l.own).toBeUndefined();
          expect(l.aim).toBeUndefined();
          expect(lightToRsb(loaded, l).flags & LIGHT_FLAG_NO_SHADOW).toBe(0);
        }
        expect(dot(lightFrame(loaded, loaded.studio.lights[0]).forward, normalize(sub(rigPivot(loaded), lightPosition(loaded, loaded.studio.lights[0]))))).toBeCloseTo(1, 12);
      });
  });
});

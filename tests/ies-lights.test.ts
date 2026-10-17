// Phase L5: IES lights as lights of the rig. Add light ▸ IES… (a profile file makes a new own light, one undo step, a file the
// reader refuses adds nothing), the multiplier and the type that keep the profile, the lumens from the file's flux, a saved
// setup and a studio that carry the profile, the project file that opens it elsewhere (and the damaged profile that opens as a
// point), and what the engine and the preview are told: LGHT kind 5 with the profile once, or, for an engine that has no IES
// lights, the spot light that stands for it, byte for byte with `rt --write-l5-example`.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iesEfficiency, iesIntensity, iesProfileOf, iesSpot, iesTextOf } from '../src/core/ies';
import { applyLibrarySetup, customSetupOf, emptyLibrary, fromCurrentRig } from '../src/core/library';
import { isSphereLike, lightConeDeg, lightIrradiance, lightLumens, newIesLight, type LightInstance } from '../src/core/lighting';
import { LUMENS_PER_WATT, luminance, pointLightFlux } from '../src/core/photometry';
import { createStore, type ProjectState } from '../src/core/store';
import { exportLibrary, importLibrary } from '../src/io/library';
import { loadProject, serializeProject } from '../src/io/project';
import { glyphsOf, lookThroughCamera } from '../src/core/view-objects';
import {
  LIGHT_IES,
  LIGHT_POINT,
  LIGHT_SPOT,
  lightToRsb,
  projectScene,
  writeRsb,
  type RsbScene,
} from '../src/io/rsb';
import { ENGINE_FEATURE_IES, ENGINE_FEATURE_PROGRAMS, ENGINE_FEATURE_TEXTURES, readsIes } from '../src/render/engine';
import { apply, exampleState } from './helpers';
import { readRsb, sections } from './rsb-reader';

const read = (name: string): string => iesTextOf(new Uint8Array(readFileSync(`tests/fixtures/ies/${name}`)));
const DOWNLIGHT = read('downlight-symmetric.ies');
const WALL_WASHER = read('wall-washer.ies');
const down = { name: 'Test downlight', text: DOWNLIGHT };
const washer = { name: 'Test wall washer', text: WALL_WASHER };

const last = (s: ProjectState): LightInstance => s.studio.lights[s.studio.lights.length - 1];
const view = { width: 160, height: 120, maxSamples: 4, maxSeconds: 0 };

describe('Add light ▸ IES…', () => {
  it('adds a light that follows the profile, in front of and above the part, selected, as bright as the mean of the others', () => {
    const s0 = exampleState();
    const s = apply(s0, { type: 'studio/addIesLight', ies: down });
    const l = last(s);
    expect(s.studio.lights).toHaveLength(s0.studio.lights.length + 1);
    expect(l).toMatchObject({ type: 'IES', own: true, enabled: true, glossy: true, camera: false });
    expect(l.ies).toEqual({ name: 'Test downlight', text: DOWNLIGHT, base: l.power });
    expect(s.selection.ids).toEqual([l.id]);
    expect(s.studio.modified).toBe(true);
    // Calibrated like a new point light: the picture does not jump.
    const point = apply(s0, { type: 'studio/addLight', kind: 'POINT' });
    expect(l.power).toBe(last(point).power);
    expect(l.size).toBe(last(point).size);
    expect(lightIrradiance(l)).toBe(lightIrradiance(last(point)));
    expect(isSphereLike(l)).toBe(true);
    // The name before it has one: its kind, numbered.
    expect(newIesLight(s0, down, 'x').ies!.base).toBeGreaterThan(0);
  });

  it('is one undo step, and a file the reader refuses adds nothing', () => {
    const store = createStore(exampleState());
    const before = store.get().studio.lights.length;
    store.dispatch({ type: 'studio/addIesLight', ies: down, label: { en: 'Add IES', es: 'Añadir IES' } });
    expect(store.get().studio.lights).toHaveLength(before + 1);
    store.undo();
    expect(store.get().studio.lights).toHaveLength(before);
    const bad = { name: 'Bad', text: DOWNLIGHT.replace('TILT=NONE', 'TILT=INCLUDE') };
    const s1 = store.get();
    store.dispatch({ type: 'studio/addIesLight', ies: bad, label: { en: 'x', es: 'x' } });
    expect(store.get().studio.lights).toHaveLength(before);
    expect(store.get()).toBe(s1);
  });

  it('keeps the profile when it is duplicated or its type is changed to another, and back', () => {
    let s = apply(exampleState(), { type: 'studio/addIesLight', ies: washer });
    const id = last(s).id;
    s = apply(s, { type: 'studio/duplicateLight', id });
    expect(s.studio.lights.filter((l) => l.type === 'IES')).toHaveLength(2);
    expect(s.studio.lights.filter((l) => l.ies?.text === WALL_WASHER)).toHaveLength(2);
    s = apply(s, { type: 'studio/setLight', id, patch: { type: 'POINT' } });
    expect(s.studio.lights.find((l) => l.id === id)).toMatchObject({ type: 'POINT', ies: { name: 'Test wall washer' } });
    s = apply(s, { type: 'studio/setLight', id, patch: { type: 'IES' } });
    expect(s.studio.lights.find((l) => l.id === id)!.type).toBe('IES');
  });

  it('has a multiplier that is the power over the one it came in with', () => {
    let s = apply(exampleState(), { type: 'studio/addIesLight', ies: down });
    const l0 = last(s);
    s = apply(s, { type: 'studio/setLight', id: l0.id, patch: { power: l0.ies!.base * 2.5 } });
    expect(last(s).power / last(s).ies!.base).toBeCloseTo(2.5, 12);
    expect(lightIrradiance(last(s))).toBeCloseTo(2.5 * lightIrradiance(l0), 9);
  });

  it('shows its lumens from the file: the peak point’s flux times the profile’s efficiency, not the lumens the file was written for', () => {
    const s = apply(exampleState(), { type: 'studio/addIesLight', ies: down });
    const l = last(s);
    const profile = iesProfileOf(DOWNLIGHT)!;
    const y = luminance(l.color) * LUMENS_PER_WATT;
    const lm = lightLumens(s, l);
    expect(lm.unit).toBe('lm');
    expect(lm.value).toBeCloseTo(pointLightFlux(l.power, s.scene.partSizeMm) * iesEfficiency(profile) * y, 6);
    // A point of the same power sends 6 times as much (the cosine-squared downlight's efficiency is a sixth).
    expect(lightLumens(s, { ...l, type: 'POINT' }).value / lm.value).toBeCloseTo(1 / iesEfficiency(profile), 9);
    // The same shape written for ten times the lumens gives the same light.
    const scaled = { ...down, text: DOWNLIGHT.replace('1 2094 1 10', '1 20940 1 10') };
    const s2 = apply(exampleState(), { type: 'studio/addIesLight', ies: scaled });
    expect(lightLumens(s2, last(s2)).value).toBeCloseTo(lm.value, 6);
  });
});

describe('IES lights in a setup, a studio and the library', () => {
  it('a saved setup carries the profile and applies it with the level of the product type', () => {
    let src = apply(exampleState(), { type: 'studio/addIesLight', ies: down }, { type: 'studio/addIesLight', ies: washer });
    const item = fromCurrentRig(src, emptyLibrary(), 'With IES', { id: 'set-1', now: 1 })!;
    const specs = item.lights.filter((l) => l.type === 'IES');
    expect(specs.map((l) => l.ies)).toEqual([down, washer]);
    for (const preset of ['WATCH', 'GENERIC']) {
      const dst = apply(exampleState(), { type: 'studio/setPreset', key: preset }, { type: 'studio/build' }, { type: 'studio/applySetup', setup: customSetupOf(item) });
      const ies = dst.studio.lights.filter((l) => l.type === 'IES');
      expect(ies.map((l) => l.ies!.name)).toEqual(['Test downlight', 'Test wall washer']);
      // The multiplier starts again from the power the light has on that type.
      for (const l of ies) expect(l.ies!.base).toBe(l.power);
      expect(applyLibrarySetup(preset, item).filter((l) => l.type === 'IES')).toHaveLength(2);
    }
    src = apply(src, { type: 'studio/resetLights' });
    expect(src.studio.lights.some((l) => l.type === 'IES')).toBe(false);
  });

  it('travels through the library file, and a profile the reader refuses makes the item damaged', () => {
    const src = apply(exampleState(), { type: 'studio/addIesLight', ies: washer });
    const item = fromCurrentRig(src, emptyLibrary(), 'With IES', { id: 'set-2', now: 2 })!;
    const lib = { ...emptyLibrary(), lightSetups: [item] };
    const json = exportLibrary(lib);
    const back = importLibrary(json, emptyLibrary());
    expect(back.skipped).toEqual([]);
    expect(back.lib.lightSetups[0].lights).toEqual(item.lights);
    // The profile is part of the item: a text that is not a profile of the engine's is a damaged library, named by its path.
    const damaged = importLibrary(json.replace(/TILT=NONE/g, 'TILT=INCLUDE'), emptyLibrary());
    expect(damaged.lib.lightSetups).toHaveLength(0);
    expect(damaged.skipped.length).toBeGreaterThan(0);
    // An IES light without its profile is no light of a library.
    const bare = JSON.parse(json) as { items: { lights: { ies?: unknown }[] }[] };
    expect(bare.items[0].lights.some((l) => l.ies)).toBe(true);
    for (const l of bare.items[0].lights) delete l.ies;
    expect(importLibrary(JSON.stringify(bare), emptyLibrary()).lib.lightSetups).toHaveLength(0);
  });

  it('a saved studio keeps the lights as they are, profile included', () => {
    const s = apply(exampleState(), { type: 'studio/addIesLight', ies: down }, { type: 'studio/save', name: 'with IES' });
    const saved = s.studio.saved[0];
    const restored = apply(apply(s, { type: 'studio/resetLights' }), { type: 'studio/restore', id: saved.id });
    expect(restored.studio.lights.filter((l) => l.type === 'IES')).toEqual(s.studio.lights.filter((l) => l.type === 'IES'));
  });
});

describe('the project file', () => {
  it('opens an IES light elsewhere without the file: profile, name and level come back as they were', async () => {
    let s = apply(exampleState(), { type: 'studio/addIesLight', ies: washer });
    const id = last(s).id;
    s = apply(s, { type: 'studio/setLight', id, patch: { power: last(s).power * 3, roll: 40, name: 'Wash' } });
    const loaded = loadProject(await serializeProject(s).text()).state;
    expect(loaded.studio.lights).toEqual(s.studio.lights);
    expect(loaded.studio.lights.find((l) => l.id === id)!.ies!.text).toBe(WALL_WASHER);
  });

  it('a project from before L5 opens as it did, and a damaged profile opens as the point light', async () => {
    const s = exampleState();
    expect(loadProject(await serializeProject(s).text()).state.studio.lights.some((l) => l.ies !== undefined)).toBe(false);
    // Edited by hand: a profile text the reader refuses, a profile that is not an object, an IES light without any.
    const withIes = apply(s, { type: 'studio/addIesLight', ies: down });
    const body = JSON.parse(await serializeProject(withIes).text()) as { state: { studio: { lights: Record<string, unknown>[] } } };
    const lights = body.state.studio.lights;
    const target = lights[lights.length - 1];
    const open = (edit: (l: Record<string, unknown>) => void): LightInstance => {
      const copy = JSON.parse(JSON.stringify(body)) as typeof body;
      edit(copy.state.studio.lights[copy.state.studio.lights.length - 1]);
      return loadProject(JSON.stringify(copy)).state.studio.lights.slice(-1)[0];
    };
    expect(target.type).toBe('IES');
    for (const edit of [
      (l: Record<string, unknown>) => ((l.ies as { text: string }).text = 'TILT=INCLUDE'),
      (l: Record<string, unknown>) => (l.ies = 'nope'),
      (l: Record<string, unknown>) => delete l.ies,
      (l: Record<string, unknown>) => ((l.ies as { base: unknown }).base = 'x'),
    ]) {
      const l = open(edit);
      expect(l.type).toBe('POINT');
      expect(l.ies).toBeUndefined();
      expect(l.power).toBe(last(withIes).power);
    }
  });
});

describe('the engine and the preview are told the same', () => {
  it('an IES light is LGHT kind 5 with the flux of its peak’s point, the profile’s text, the axis and the up', () => {
    const s = apply(exampleState(), { type: 'studio/addLight', kind: 'POINT' }, { type: 'studio/addIesLight', ies: washer });
    const point = s.studio.lights[s.studio.lights.length - 2];
    const ies = last(s);
    const p = lightToRsb(s, { ...point, power: ies.power, size: ies.size, az: ies.az, el: ies.el, dist: ies.dist }, { ies: true });
    const l = lightToRsb(s, ies, { ies: true });
    expect(l.kind).toBe(LIGHT_IES);
    expect(l.ies).toBe(WALL_WASHER);
    expect(l.power).toBeCloseTo(pointLightFlux(ies.power, s.scene.partSizeMm), 9);
    // The same place, size, axis and flux as the point light it is the shape of.
    expect({ ...l, kind: LIGHT_POINT, ies: undefined }).toEqual({ ...p, ies: undefined });
    expect(l.spreadDeg).toBe(180);
    // Turning the light turns the pattern: the roll is in `up`.
    const turned = lightToRsb(s, { ...ies, roll: 40 }, { ies: true });
    expect(turned.up).not.toEqual(l.up);
  });

  it('an engine without IES lights is told the spot light that stands for it, whose intensity on its axis is the same', () => {
    const s = apply(exampleState(), { type: 'studio/addIesLight', ies: down });
    const l = lightToRsb(s, last(s));
    const approx = iesSpot(iesProfileOf(DOWNLIGHT)!);
    expect(l.kind).toBe(LIGHT_SPOT);
    expect(l.ies).toBeUndefined();
    expect(l.power).toBeCloseTo(pointLightFlux(last(s).power, s.scene.partSizeMm), 9);
    expect(l.spreadDeg).toBeCloseTo(approx.cone, 9);
    expect(l.angleDeg).toBeCloseTo((approx.blend * approx.cone) / 2, 9);
    expect(sections(writeRsb(projectScene(s, view).scene)).some((x) => x.tag === 'IESP')).toBe(false);
    // A file the reader cannot read (a damaged one that got past) is drawn as a point.
    const broken = lightToRsb(s, { ...last(s), ies: { name: 'x', text: 'TILT=INCLUDE', base: 1 } }, { ies: true });
    expect(broken.kind).toBe(LIGHT_POINT);
    // The cone the glyph and the look-through use is the beam: twice the half-intensity angle.
    expect(lightConeDeg(last(s))).toBeCloseTo(90, 5);
    expect(lightConeDeg({ type: 'POINT', spread: 180 })).toBeNull();
  });

  it('writes the profile once, however many lights use it, and 80 bytes for each IES light', () => {
    let s = apply(exampleState(), { type: 'studio/addIesLight', ies: down }, { type: 'studio/addIesLight', ies: washer }, { type: 'studio/addIesLight', ies: down });
    s = apply(s, { type: 'studio/setLight', id: s.studio.lights[s.studio.lights.length - 1].id, patch: { enabled: false } });
    const { scene } = projectScene(s, { ...view, ies: true });
    const bytes = writeRsb(scene);
    const parts = sections(bytes);
    expect(parts.filter((x) => x.tag === 'IESP')).toHaveLength(2);
    expect(parts.filter((x) => x.tag === 'LGHT').map((x) => x.payload.byteLength)).toEqual([76, 76, 76, 80, 80]);
    const back = readRsb(bytes);
    expect(back.lights.filter((l) => l.kind === LIGHT_IES).map((l) => l.ies)).toEqual([DOWNLIGHT, WALL_WASHER]);
    // Without IES lights, the bytes of before: no IESP, every LGHT 76.
    const plain = writeRsb(projectScene(exampleState(), { ...view, ies: true }).scene);
    expect(sections(plain).some((x) => x.tag === 'IESP')).toBe(false);
    expect(sections(plain).filter((x) => x.tag === 'LGHT').every((x) => x.payload.byteLength === 76)).toBe(true);
    // An update without meshes carries the lights and their profiles.
    expect(sections(writeRsb(scene, { meshes: false })).filter((x) => x.tag === 'IESP')).toHaveLength(2);
  });

  it('writes an IES light without its profile as nothing, as the engine does', () => {
    const { scene } = projectScene(apply(exampleState(), { type: 'studio/addIesLight', ies: down }), { ...view, ies: true });
    const orphan: RsbScene = { ...scene, lights: [...scene.lights, { ...scene.lights[0], kind: LIGHT_IES }] };
    expect(writeRsb(orphan)).toEqual(writeRsb(scene));
  });

  it('asks for IES lights only of an engine that says it renders them (feature bit 2)', () => {
    expect(ENGINE_FEATURE_IES).toBe(8);
    expect(readsIes(undefined)).toBe(false);
    expect(readsIes(ENGINE_FEATURE_TEXTURES | ENGINE_FEATURE_PROGRAMS)).toBe(false);
    expect(readsIes(ENGINE_FEATURE_TEXTURES | ENGINE_FEATURE_PROGRAMS | ENGINE_FEATURE_IES)).toBe(true);
    // The engine's own word, from the source of rt-core: the page and the engine agree on the bit.
    const lib = readFileSync('engine/crates/rt-core/src/lib.rs', 'utf8');
    expect(/pub const FEATURE_IES: u32 = (\d+);/.exec(lib)![1]).toBe(String(ENGINE_FEATURE_IES));
  });
});

describe('the viewport shows the beam', () => {
  it('draws the cone of the half-intensity angle as a spot of that angle does, and looking through frames it', () => {
    const s0 = apply(exampleState(), { type: 'studio/addIesLight', ies: down }, { type: 'studio/addLight', kind: 'SPOT' });
    const ies = s0.studio.lights[s0.studio.lights.length - 2];
    const spot = s0.studio.lights[s0.studio.lights.length - 1];
    // The downlight is half at 45 degrees: a beam of 90. A spot of 90 degrees at the same place, size and aim is the same cone.
    const same = apply(s0, { type: 'studio/setLight', id: spot.id, patch: { spread: 90, blend: 0, az: ies.az, el: ies.el, dist: ies.dist } });
    const glyph = (id: string) => glyphsOf(same, { all: false, selected: { kind: 'LIGHT', id } })[0];
    const a = glyph(ies.id);
    const b = glyph(spot.id);
    expect(a.lines.length).toBeGreaterThan(8);
    // The cone's rim and its four edges: the lines are the spot's but for the inner cone of a soft edge, which the IES has not.
    const rim = (g: typeof a) => g.lines.slice(0, 8);
    rim(a).forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(rim(b)[i][k], 6)));
    expect(a.dots).toEqual(b.dots);
    // Looking through: the focal that fits the cone in the frame is the spot's.
    const fa = lookThroughCamera(same, { kind: 'LIGHT', id: ies.id })!;
    const fb = lookThroughCamera(same, { kind: 'LIGHT', id: spot.id })!;
    expect(fa.focalMm).toBeCloseTo(fb.focalMm, 9);
    // A light of another kind has no cone in either.
    const point = apply(exampleState(), { type: 'studio/addLight', kind: 'POINT' });
    expect(lightConeDeg(point.studio.lights[point.studio.lights.length - 1])).toBeNull();
  });
});

describe('byte parity with rt-core: rt --write-l5-example', () => {
  const l5 = new Uint8Array(readFileSync('tests/fixtures/l5.rsb'));

  function firstDiff(a: Uint8Array, b: Uint8Array): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
    return a.length === b.length ? -1 : n;
  }

  it('reads the fixture into the shapes of src/io/rsb.ts and writes it back to the same bytes', () => {
    const r = readRsb(l5);
    expect(r.tags.filter((t) => t === 'IESP')).toHaveLength(2);
    expect(r.lights.map((l) => l.kind)).toEqual([0, LIGHT_IES, LIGHT_IES]);
    expect(r.lights[1].ies).toBe(read('downlight-symmetric.ies'));
    expect(r.lights[2].ies).toBe(WALL_WASHER);
    const scene: RsbScene = {
      camera: r.camera!,
      materials: r.materials,
      meshes: r.meshes,
      instances: r.instances,
      lights: r.lights,
      environment: r.environment!,
      floor: r.floor!,
      render: r.render!,
      bitmaps: r.bitmaps,
    };
    const bytes = writeRsb(scene);
    expect(bytes.length).toBe(l5.length);
    expect(firstDiff(bytes, l5)).toBe(-1);
    // The engine's two lights read as the page reads their profiles: the first is 1000 cd on its axis.
    expect(iesIntensity(iesProfileOf(r.lights[1].ies!)!, 0, 0)).toBe(1000);
  });
});

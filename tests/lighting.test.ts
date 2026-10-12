import { describe, expect, it } from 'vitest';
import { CAMERA_AZIMUTH_DEG, lightSetup } from '../src/data/light-setups';
import { studioPreset } from '../src/data/studios';
import { activeCamera, cameraPosition } from '../src/core/camera';
import { kelvinToRgb, polar } from '../src/core/light-math';
import { lightIrradiance, lightPosition, lightShares, lightsFromRig, placeByReflection, rigPivot } from '../src/core/lighting';
import { add, dot, normalize, sub } from '../src/core/math';
import { presetIrradiance, studioRig } from '../src/core/rig';
import { assignAction } from '../src/core/materials';
import { apply, exampleState, keyIds } from './helpers';

describe('light rig', () => {
  it('instances follow studioRig with camera-relative azimuth', () => {
    const lights = lightsFromRig('JEWELLERY', 'PRESET');
    const rig = studioRig('JEWELLERY');
    expect(lights).toHaveLength(rig.length);
    lights.forEach((l, i) => {
      expect(l.role).toBe(rig[i].role);
      expect(l.power).toBe(rig[i].energy);
      expect(l.az + CAMERA_AZIMUTH_DEG).toBeCloseTo(rig[i].azimuthWorld, 9);
      expect(l.color).toEqual([...rig[i].color]);
    });
  });

  it('a setup keeps the exposure of the product type (normalised irradiance)', () => {
    const s = apply(exampleState(), { type: 'studio/setPreset', key: 'WATCH' }, { type: 'studio/setSetup', key: 'REMBRANDT' });
    const total = s.studio.lights.reduce((a, l) => a + lightIrradiance(l), 0);
    expect(total).toBeCloseTo(presetIrradiance('WATCH'), 9);
    expect(lightShares(s.studio.lights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(s.studio.lights.map((l) => l.az)).toEqual(lightSetup('REMBRANDT')!.lights!.map((x) => x.az));
  });

  it('kelvin lights keep their temperature; explicit colours drop it', () => {
    const lights = lightsFromRig('GENERIC', 'NEON_NOIR');
    expect(lights.some((l) => l.kelvin === null)).toBe(true);
    let s = apply(exampleState(), { type: 'studio/setSetup', key: 'KEY_ONLY' });
    const id = s.studio.lights[0].id;
    s = apply(s, { type: 'studio/setLight', id, patch: { kelvin: 3200 } });
    expect(s.studio.lights[0].color).toEqual(kelvinToRgb(3200));
    expect(s.studio.modified).toBe(true);
    s = apply(s, { type: 'studio/setLight', id, patch: { color: [1, 0, 0] } });
    expect(s.studio.lights[0].kelvin).toBeNull();
    s = apply(s, { type: 'studio/resetLights' });
    expect(s.studio.modified).toBe(false);
    expect(s.studio.lights[0].kelvin).not.toBeNull();
  });

  it('lights sit at polar(toWorldAzimuth(az), el, dist · part size) around the pivot', () => {
    const s = exampleState();
    const l = s.studio.lights[0];
    const expected = add(rigPivot(s), polar(l.az + CAMERA_AZIMUTH_DEG, l.el, l.dist * s.scene.partSizeMm));
    lightPosition(s, l).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
  });

  it('placement by reflection puts the light on the reflected camera ray', () => {
    const s = exampleState();
    const cam = activeCamera(s);
    const eye = cameraPosition(cam);
    const point = rigPivot(s);
    // A surface facing the camera reflects the view ray straight back.
    const normal = normalize(sub(eye, point));
    const placed = placeByReflection(s, s.studio.lights[0], point, normal)!;
    const pos = lightPosition(s, { ...s.studio.lights[0], ...placed });
    expect(dot(normalize(sub(pos, point)), normal)).toBeGreaterThan(0.999);
    expect(placed.dist).toBeCloseTo(s.studio.lights[0].dist, 6);
  });
});

describe('studios', () => {
  it('Create studio applies the product type', () => {
    const s = apply(exampleState(), { type: 'studio/setPreset', key: 'JEWELLERY' }, { type: 'studio/build' });
    const p = studioPreset('JEWELLERY')!;
    const cam = activeCamera(s);
    expect([cam.focalMm, cam.fstop]).toEqual([p.focalMm, p.fstop]);
    expect(s.environment.strength).toBe(p.envStrength);
    expect(s.environment.background).toBe('COLOR');
    expect(s.image.exposureEv).toBe(p.exposure);
    expect([s.studio.floor, s.studio.shadow]).toEqual([p.floor, p.shadow]);
    expect(s.render.quality).toBe(p.quality);
    expect(s.studio.lights).toHaveLength(p.lights.length);
  });

  it('save and restore bring back camera, light and materials in one action', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = apply(s, { type: 'studio/setSetup', key: 'WRAP' }, { type: 'studio/save', name: 'A' });
    const saved = s.studio.saved[0].id;
    s = apply(
      s,
      { type: 'studio/setSetup', key: 'NEON_NOIR' },
      assignAction(s, { preset: 'COPPER' }, 'REPLACE', [ids.body]),
      { type: 'camera/view', view: 'TOP' },
    );
    s = apply(s, { type: 'studio/restore', id: saved });
    expect(s.studio.lightSetup).toBe('WRAP');
    expect(s.materials[s.scene.nodes[ids.body].material!].preset).toBe('PAINT_MET');
    expect(activeCamera(s).elevation).toBe(22);
  });
});

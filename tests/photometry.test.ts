// Light power (fix of the area-light convention): the recipes were tuned by eye in Blender Cycles, where
// an area light of power P and area A has the radiance L = P / (4 A). These tests pin the numbers the
// two engines take from the rig, and that a light setup is the dominant light of the studio, not a
// whisper under the dome.

import { describe, expect, it } from 'vitest';
import { rigPivot } from '../src/core/lighting';
import { areaLightFlux, areaLightRadiance } from '../src/core/photometry';
import { ENV_FLAT, LIGHT_DISK, LIGHT_RECT, LIGHT_SUN, projectScene, type RsbEnvironment, type RsbLight } from '../src/io/rsb';
import { apply, exampleState } from './helpers';

/**
 * On-axis irradiance (W/m2) at distance `d` (m) from a one-sided Lambertian rectangle of radiance
 * `l` and sides `w` x `h` (m), the point on the rectangle's axis: exact for any size
 * (L times pi times the form factor of a rectangle seen from a point above its centre).
 */
function rectIrradiance(l: number, w: number, h: number, d: number): number {
  const x = w / 2 / d;
  const y = h / 2 / d;
  const fx = Math.sqrt(1 + x * x);
  const fy = Math.sqrt(1 + y * y);
  return 2 * l * ((x / fx) * Math.atan(y / fx) + (y / fy) * Math.atan(x / fy));
}

/** The same for a disk of diameter `w` (m): L pi sin^2(alpha), tan(alpha) = r / d. */
function diskIrradiance(l: number, w: number, d: number): number {
  const r = w / 2;
  return (Math.PI * l * r * r) / (r * r + d * d);
}

describe('area light power: the Cycles convention', () => {
  it('a small panel of rig power P at d part sizes gives E = P / (4 d^2), through the flux and through the preview radiance', () => {
    for (const [power, partMm, dist, side] of [
      [30, 200, 10, 0.05],
      [90, 1000, 8, 0.1],
      [12, 30, 20, 0.02],
      [250, 4500, 15, 0.05],
    ]) {
      const s = partMm / 1000;
      const expected = power / (4 * dist * dist);

      // The engine: a panel of flux F is a Lambertian emitter of radiance F / (pi A); take it far away.
      const flux = areaLightFlux(power, partMm);
      const areaM2 = side * s * side * s;
      const dM = dist * s;
      expect(flux / (Math.PI * dM * dM)).toBeCloseTo(expected, 12);
      expect(rectIrradiance(flux / (Math.PI * areaM2), side * s, side * s, dM) / expected).toBeCloseTo(1, 3);

      // The preview: its RectAreaLight radiance over the same panel, in part sizes (the ratio L A / d^2
      // does not depend on the unit of length).
      const radiance = areaLightRadiance(power, side * side);
      expect((radiance * side * side) / (dist * dist)).toBeCloseTo(expected, 12);
      expect(rectIrradiance(radiance, side, side, dist) / expected).toBeCloseTo(1, 3);
    }
  });

  it('the flux is pi / 4 of the recipe watts at part size 1 and grows with the square of the part size', () => {
    expect(areaLightFlux(40, 1000)).toBeCloseTo((Math.PI / 4) * 40, 12);
    expect(areaLightFlux(40, 250)).toBeCloseTo(((Math.PI / 4) * 40) / 16, 12);
    // A part of unknown size is read as 1 m, like the recipes.
    expect(areaLightFlux(40, 0)).toBeCloseTo(areaLightFlux(40, 1000), 12);
  });

  it('the preview radiance does not depend on the part size and is Cycles\' P / (4 A)', () => {
    expect(areaLightRadiance(20, 0.5)).toBeCloseTo(10, 12);
    expect(areaLightRadiance(20, 2)).toBeCloseTo(2.5, 12);
  });
});

// ------------------------------------------------------------------ setups matter

/** Distance (m) from an RSB light (mm) to `target` (mm). */
const distanceM = (l: RsbLight, target: readonly number[]): number => Math.hypot(l.position[0] - target[0], l.position[1] - target[1], l.position[2] - target[2]) * 1e-3;

/**
 * On-axis irradiance (W/m2) of an RSB light at `target` as the rig's recipes measure it: the panel
 * as a point source of intensity F / pi, E = F / (pi d^2). A sun is its power.
 */
function farIrradiance(l: RsbLight, target: readonly number[]): number {
  if (l.kind === LIGHT_SUN) return l.power;
  const d = distanceM(l, target);
  return l.power / (Math.PI * d * d);
}

/** The same with the panel's real size (it is as wide as it is far): the integral over the emitter. */
function exactIrradiance(l: RsbLight, target: readonly number[]): number {
  if (l.kind === LIGHT_SUN) return l.power;
  const d = distanceM(l, target);
  const w = l.sizeX * 1e-3;
  if (l.kind === LIGHT_DISK) {
    const area = (Math.PI / 4) * w * w;
    return diskIrradiance(l.power / (Math.PI * area), w, d);
  }
  expect(l.kind).toBe(LIGHT_RECT);
  const h = l.sizeY * 1e-3;
  return rectIrradiance(l.power / (Math.PI * w * h), w, h, d);
}

/**
 * Irradiance (W/m2) of the dome on an upward-facing surface: the integral of L(z) cos(theta) over the
 * upper hemisphere, with the radiance as rt-core's `EnvLight::value` defines it (a ramp from `floor`
 * at z = -1 through `horizon` at 0 to `zenith` at +1, times the strength) and d(omega) = dz d(phi).
 */
function domeIrradiance(e: RsbEnvironment): number {
  const flat = e.kind === ENV_FLAT;
  const floor = (flat ? e.horizon : e.floor) * e.strength;
  const horizon = e.horizon * e.strength;
  const zenith = (flat ? e.horizon : e.zenith) * e.strength;
  const value = (z: number): number => (z < 0 ? floor * -z + horizon * (1 + z) : horizon * (1 - z) + zenith * z);
  const n = 20000;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const z = (i + 0.5) / n; // cos(theta) of an upward normal
    sum += value(z) * z;
  }
  return (2 * Math.PI * sum) / n;
}

describe('light setups matter: the rig dominates the dome', () => {
  const studio = (key: string) => apply(exampleState(), { type: 'studio/setPreset', key: 'JEWELLERY' }, { type: 'studio/build' }, { type: 'studio/setSetup', key });
  const view = { width: 480, height: 270, maxSamples: 64, maxSeconds: 0 };

  it('the dome\'s irradiance is pi times the cosine-weighted mean radiance of the upper hemisphere', () => {
    const e: RsbEnvironment = { ...projectScene(studio('REMBRANDT'), view).scene.environment };
    const closed = (Math.PI * ((e.horizon + 2 * e.zenith) / 3)) * e.strength;
    expect(domeIrradiance(e)).toBeCloseTo(closed, 6);
    // A flat environment of grey g is pi g.
    expect(domeIrradiance({ ...e, kind: ENV_FLAT, horizon: 0.5, strength: 2 })).toBeCloseTo(Math.PI, 6);
  });

  it('a finite panel\'s irradiance tends to the point formula when it is small', () => {
    const l = 5;
    expect(rectIrradiance(l, 0.01, 0.02, 3) / (l * 0.01 * 0.02 / 9)).toBeCloseTo(1, 4);
    expect(diskIrradiance(l, 0.01, 3) / (l * Math.PI * 0.005 * 0.005 / 9)).toBeCloseTo(1, 4);
    // A panel that fills the hemisphere (huge compared to its distance) gives pi L.
    expect(rectIrradiance(l, 1e4, 1e4, 1) / (Math.PI * l)).toBeCloseTo(1, 3);
    expect(diskIrradiance(l, 1e4, 1) / (Math.PI * l)).toBeCloseTo(1, 3);
  });

  it.each(['REMBRANDT', 'NEON_NOIR', 'KEY_ONLY'])('JEWELLERY x %s: the rig\'s on-axis irradiance at the part is at least twice the dome\'s on an upward surface', (key) => {
    const s = studio(key);
    const { scene } = projectScene(s, view);
    const pivot = rigPivot(s);
    const far = scene.lights.reduce((sum, l) => sum + farIrradiance(l, pivot), 0);
    const exact = scene.lights.reduce((sum, l) => sum + exactIrradiance(l, pivot), 0);
    const dome = domeIrradiance(scene.environment);
    expect(scene.lights.length).toBeGreaterThan(0);
    expect(dome).toBeGreaterThan(0);
    const note = `rig ${far.toFixed(3)} W/m2 (${exact.toFixed(3)} with the panels' size), dome ${dome.toFixed(3)} W/m2`;
    expect(far / dome, note).toBeGreaterThanOrEqual(2);
    // The panels are as wide as they are far (neon strips 6 part sizes long at 2.8), so they give less than
    // a point would; the rig still beats the dome by a quarter at least (1.4 to 1.9 today).
    expect(exact / dome, note).toBeGreaterThanOrEqual(1.25);
  });
});

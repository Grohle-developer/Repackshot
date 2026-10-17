// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (PolyForm Noncommercial 1.0.0); values are data, the implementation is new.

import { describe, it, expect } from 'vitest';
import { kelvinToRgb, specColor, specIrradiance } from '../src/core/light-math';
import {
  activeRig,
  presetIrradiance,
  rigByRole,
  rigFromRecipe,
  rigIrradiance,
  rigSpec,
  setupRig,
  studioRig,
} from '../src/core/rig';
import {
  CAMERA_AZIMUTH_DEG,
  LIGHT_ROLES,
  LIGHT_SETUPS,
  STUDIO_PRESETS,
  lightSetup,
  studioPreset,
} from '../src/data';
import type { LightSpec } from '../src/data';

// The setups of the catalogue that are not a set of L6 (the 71 of EZ Packshot and the 7 of Interior, K1): the sets also give part of the level to their pool (tests/sets.test.ts).
const SETUP_KEYS_WITHOUT_PRESET = LIGHT_SETUPS.filter((s) => s.key !== 'PRESET' && s.style !== 'SETS').map((s) => s.key);

describe('presetIrradiance', () => {
  it('sums the irradiance of the preset lights', () => {
    const expected = (studioPreset('GENERIC')?.lights ?? []).reduce((a, l) => a + l.energy! / (4 * Math.PI * l.dist * l.dist), 0);
    expect(presetIrradiance('GENERIC')).toBeCloseTo(expected, 12);
    // The levels before L6: the rigs of L6 keep them, so no product type's exposure moved.
    expect(presetIrradiance('GENERIC')).toBeCloseTo(1.6095942090472863, 12);
    expect(presetIrradiance('JEWELLERY')).toBeCloseTo(1.487770431075888, 12);
  });

  it('falls back to 1.6 for an unknown preset', () => {
    expect(presetIrradiance('NOPE')).toBe(1.6);
  });

  it('is positive and finite for all 16 presets', () => {
    for (const p of STUDIO_PRESETS) {
      expect(presetIrradiance(p.key), p.key).toBeGreaterThan(0);
      expect(Number.isFinite(presetIrradiance(p.key)), p.key).toBe(true);
    }
  });
});

describe('studioRig', () => {
  it('turns the three GENERIC lights into world space', () => {
    const rig = studioRig('GENERIC');
    expect(rig).toHaveLength(3);
    const lights = studioPreset('GENERIC')?.lights ?? [];
    rig.forEach((light, i) => {
      expect(light.azimuthWorld).toBe(lights[i].az + CAMERA_AZIMUTH_DEG);
      expect(light.role).toBe(lights[i].role);
      expect(light.energy).toBe(lights[i].energy);
      expect(light.elevation).toBe(lights[i].el);
      expect(light.color).toEqual(specColor(lights[i]));
    });
    // L6: the lights of GRADIENT_POOL (key -40, fill 60, rim 165, camera-relative).
    expect(rig.map((l) => l.azimuthWorld)).toEqual([-75, 25, 130]);
  });

  it('fills in the defaults of absent fields', () => {
    const key = studioRig('GENERIC')[0];
    expect(key).toMatchObject({
      type: 'AREA',
      shape: 'RECTANGLE',
      spread: 180,
      angle: 0.545,
      camera: false,
      glossy: true,
      size: 3,
      sizeY: 2.5,
      dist: 2.2,
    });
  });

  it('keeps the two key lights and the two rims of JEWELLERY apart', () => {
    const rig = studioRig('JEWELLERY');
    expect(rig.map((l) => l.role)).toEqual(['KEY', 'FILL', 'RIM', 'RIM', 'TOP', 'KEY']);
    expect(rig[5]).toMatchObject({ type: 'SPOT', size: 0.05, spread: 12 });
  });

  it('returns an empty rig for an unknown preset', () => {
    expect(studioRig('NOPE')).toEqual([]);
  });

  it('has a total irradiance equal to presetIrradiance for all presets', () => {
    for (const p of STUDIO_PRESETS) {
      expect(rigIrradiance(studioRig(p.key)), p.key).toBeCloseTo(presetIrradiance(p.key), 12);
    }
  });
});

describe('setupRig', () => {
  it('keeps the total irradiance of the preset for every setup and every preset', () => {
    // The 71 setups of EZ Packshot (PRESET apart) and the 7 of Interior (K1); the 16 sets of L6 are normalised by core/sets.ts.
    expect(SETUP_KEYS_WITHOUT_PRESET).toHaveLength(78);
    expect(STUDIO_PRESETS).toHaveLength(16);
    let checked = 0;
    for (const preset of STUDIO_PRESETS) {
      const target = presetIrradiance(preset.key);
      for (const setupKey of SETUP_KEYS_WITHOUT_PRESET) {
        const total = rigIrradiance(setupRig(preset.key, setupKey));
        expect(Math.abs(total - target) / target, `${preset.key} / ${setupKey}`).toBeLessThan(1e-6);
        checked++;
      }
    }
    expect(checked).toBe(16 * 78);
  });

  it('gives the preset own rig for PRESET and for unknown setups', () => {
    expect(setupRig('GENERIC', 'PRESET')).toEqual(studioRig('GENERIC'));
    expect(setupRig('GENERIC', 'NOPE')).toEqual(studioRig('GENERIC'));
  });

  it('gives a SUN setup one SUN light whose energy is the preset irradiance', () => {
    const rig = setupRig('GENERIC', 'SUN');
    expect(rig).toHaveLength(1);
    expect(rig[0].type).toBe('SUN');
    expect(rig[0].energy).toBeCloseTo(presetIrradiance('GENERIC'), 12);
    expect(rig[0].azimuthWorld).toBe(-55 + CAMERA_AZIMUTH_DEG);
    expect(rig[0].angle).toBe(0.545);
  });

  it('gives a light with kelvin and no colour the kelvin colour', () => {
    const recipe = lightSetup('KEY_RIM')?.lights ?? [];
    expect(recipe[0].kelvin).toBe(5200);
    expect(recipe[0].color).toBeUndefined();
    const rig = setupRig('GENERIC', 'KEY_RIM');
    expect(rig[0].color).toEqual(kelvinToRgb(5200));
    expect(rig[0].energy).toBeCloseTo(122.01270151441135, 9);
  });

  it('gives a light with neither colour nor kelvin the 5600 K default', () => {
    const rig = setupRig('GENERIC', 'KEY_ONLY');
    expect(rig[0].color).toEqual(kelvinToRgb(5600));
  });

  it('lets an explicit colour win over kelvin in the colour setups', () => {
    const withColor = LIGHT_SETUPS.filter((s) => s.lights?.some((l) => l.color !== undefined));
    expect(withColor.length).toBeGreaterThan(0);
    for (const setup of withColor) {
      const rig = setupRig('GENERIC', setup.key);
      setup.lights?.forEach((spec, i) => {
        if (spec.color !== undefined) expect(rig[i].color, `${setup.key}[${i}]`).toEqual(spec.color);
      });
    }
  });

  it('scales shares into energies with one common factor', () => {
    const rig = setupRig('JEWELLERY', 'WRAP');
    const shares = lightSetup('WRAP')?.lights?.map((l) => l.share ?? 0) ?? [];
    const ratios = rig.map((l, i) => l.energy / shares[i]);
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 9);
    expect(rig[0].energy).toBeCloseTo(38.35728410736743, 9);
    expect(rig.map((l) => l.role)).toEqual(['TOP', 'KEY', 'FILL', 'RIM', 'FILL']);
  });

  it('converts every recipe azimuth to world space', () => {
    for (const setup of LIGHT_SETUPS) {
      if (!setup.lights) continue;
      const rig = setupRig('GENERIC', setup.key);
      setup.lights.forEach((spec, i) => {
        expect(rig[i].azimuthWorld, `${setup.key}[${i}]`).toBe(spec.az + CAMERA_AZIMUTH_DEG);
      });
    }
  });
});

describe('rigFromRecipe', () => {
  const recipe = (extra: Partial<LightSpec>): LightSpec[] => [
    { role: 'KEY', size: 3, az: -45, el: 35, dist: 3, share: 1, ...extra },
  ];

  it('gives a colorFromPreset light the colour of the first light of the preset rig', () => {
    const rig = rigFromRecipe('GENERIC', recipe({ colorFromPreset: true }));
    expect(rig[0].color).toEqual(studioRig('GENERIC')[0].color);
    // L6: GENERIC's key has no colour of its own: the default temperature's.
    expect(rig[0].color).toEqual(kelvinToRgb(5600));
    // PERFUME starts with its key strip, at 5300 K.
    expect(rigFromRecipe('PERFUME', recipe({ colorFromPreset: true }))[0].color).toEqual(kelvinToRgb(5300));
    // An own product type whose first light has a colour hands it on.
    const own = { ...studioPreset('GENERIC')!, key: 'LIB:own', lights: [{ role: 'KEY' as const, size: 1, az: 0, el: 30, dist: 3, energy: 50, color: [1, 0.98, 0.95] as const }] };
    expect(rigFromRecipe(own, recipe({ colorFromPreset: true }))[0].color).toEqual([1, 0.98, 0.95]);
  });

  it('uses white when the preset is unknown and the light is marked colorFromPreset', () => {
    expect(rigFromRecipe('NOPE', recipe({ colorFromPreset: true }))[0].color).toEqual([1, 1, 1]);
  });

  it('prefers an explicit colour, then kelvin, over colorFromPreset', () => {
    expect(rigFromRecipe('GENERIC', recipe({ colorFromPreset: true, color: [0.2, 0.3, 0.4] }))[0].color).toEqual([
      0.2, 0.3, 0.4,
    ]);
    expect(rigFromRecipe('GENERIC', recipe({ colorFromPreset: false, kelvin: 3000 }))[0].color).toEqual(
      kelvinToRgb(3000),
    );
  });

  it('normalises any recipe to the preset irradiance', () => {
    const rig = rigFromRecipe('TOOL', [
      { role: 'KEY', size: 2, az: 0, el: 30, dist: 2, share: 3 },
      { role: 'FILL', size: 2, az: 90, el: 30, dist: 5, share: 1, type: 'SUN' },
    ]);
    expect(rigIrradiance(rig)).toBeCloseTo(presetIrradiance('TOOL'), 12);
    expect(specIrradiance({ type: rig[1].type, energy: rig[1].energy, dist: rig[1].dist })).toBeGreaterThan(0);
  });

  it('keeps a factor of 1 for a recipe with no irradiance', () => {
    const rig = rigFromRecipe('GENERIC', [{ role: 'KEY', size: 3, az: 0, el: 30, dist: 3, share: 0 }]);
    expect(rig[0].energy).toBe(0);
  });
});

describe('activeRig, rigByRole and rigSpec', () => {
  it('returns the setup rig, or the preset rig for PRESET', () => {
    expect(activeRig('GENERIC', 'PRESET')).toEqual(studioRig('GENERIC'));
    expect(activeRig('GENERIC', 'WRAP')).toEqual(setupRig('GENERIC', 'WRAP'));
  });

  it('falls back to KEY, FILL and RIM when nothing resolves', () => {
    const rig = activeRig('NOPE', 'PRESET');
    expect(rig.map((l) => l.role)).toEqual(['KEY', 'FILL', 'RIM']);
    expect(rig[0].azimuthWorld).toBe(-40);
    expect(rig[1].azimuthWorld).toBe(55);
    expect(rig[2].azimuthWorld).toBe(160);
    expect(rig[0].energy).toBe(LIGHT_ROLES.KEY.energy);
  });

  it('groups a rig by role in order', () => {
    const byRole = rigByRole(studioRig('JEWELLERY'));
    expect(Object.keys(byRole).sort()).toEqual(['FILL', 'KEY', 'RIM', 'TOP']);
    expect(byRole.KEY).toHaveLength(2);
    expect(byRole.KEY?.[0].size).toBe(3);
    expect(byRole.KEY?.[1].size).toBe(0.05);
  });

  it('hands each copy of a role its own recipe and fans out the extras', () => {
    const byRole = rigByRole(studioRig('JEWELLERY'));
    expect(rigSpec(byRole, 'KEY', 0)).toMatchObject({ light: { size: 3 }, fan: 0 });
    expect(rigSpec(byRole, 'KEY', 1)).toMatchObject({ light: { size: 0.05 }, fan: 0 });
    expect(rigSpec(byRole, 'KEY', 2)).toMatchObject({ light: { size: 0.05 }, fan: 1 });
    expect(rigSpec(byRole, 'KEY', 4)).toMatchObject({ light: { size: 0.05 }, fan: 3 });
    // A role the rig does not cover uses the generic fallback.
    const generic = rigByRole(studioRig('GENERIC'));
    expect(rigSpec(generic, 'TOP', 0)).toEqual({ light: LIGHT_ROLES.TOP, fan: 0 });
    expect(rigSpec(generic, 'TOP', 2)).toEqual({ light: LIGHT_ROLES.TOP, fan: 2 });
  });
});

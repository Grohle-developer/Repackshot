import { describe, expect, it } from 'vitest';
import { DOCTOR_CHECKS } from '../src/data/doctor';
import { SCENE_CHECKS, runDoctor, warningCount } from '../src/core/doctor';
import { boundsOf, measuredSizeMm, sceneBounds } from '../src/core/scene';
import type { ProjectState } from '../src/core/store';
import { apply, exampleState, keyIds } from './helpers';

const status = (s: ProjectState, key: string) => runDoctor(s).find((r) => r.key === key)!.status;
const fix = (s: ProjectState, key: string) => apply(s, { type: 'doctor/fix', key: key as never });

describe('doctor', () => {
  it('runs the fourteen checks in catalogue order; engine checks are unavailable', () => {
    const r = runDoctor(exampleState());
    expect(r.map((x) => x.key)).toEqual(DOCTOR_CHECKS.map((c) => c.key));
    for (const x of r) expect(x.status).toBe(SCENE_CHECKS.has(x.key) ? 'OK' : 'UNAVAILABLE');
  });

  it('the example loads clean', () => {
    expect(warningCount(runDoctor(exampleState()))).toBe(0);
  });

  it('keeps the results in the state', () => {
    const s = exampleState();
    expect(s.doctor.results).toEqual(runDoctor(s));
    const t = apply(s, { type: 'scene/setTransform', id: keyIds(s).model, transform: { position: [0, 0, 300] } });
    expect(t.doctor.stamp).toBeGreaterThan(s.doctor.stamp);
    expect(t.doctor.results.find((r) => r.key === 'origin')!.status).toBe('WARN');
  });

  it('scale: a model 20x off the declared size, and an implausible size for the product type', () => {
    const s = exampleState();
    // Declared 121 mm, actual 3 m.
    const big = apply(s, { type: 'scene/setTransform', id: keyIds(s).model, transform: { scale: [25, 25, 25] } });
    expect(status(big, 'scale')).toBe('WARN');
    const fixed = fix(big, 'scale');
    expect(status(fixed, 'scale')).toBe('OK');
    expect(measuredSizeMm(fixed)).toBeCloseTo(121, 3);
    // A 3 m model declared as 3 m but in a Jewellery studio (30 mm).
    const declared = apply(s, { type: 'scene/setPartSize', mm: 3000 }, { type: 'studio/setPreset', key: 'JEWELLERY' });
    expect(status(declared, 'scale')).toBe('WARN');
    const fixed2 = fix(declared, 'scale');
    expect(status(fixed2, 'scale')).toBe('OK');
    expect(measuredSizeMm(fixed2)).toBeCloseTo(30, 3);
  });

  it('origin: off-centre origin and a model floating above the floor', () => {
    const s = exampleState();
    const ids = keyIds(s);
    const floating = apply(s, { type: 'scene/setTransform', id: ids.model, transform: { position: [0, 0, 100] } });
    expect(status(floating, 'origin')).toBe('WARN');
    const a = fix(floating, 'origin');
    expect(status(a, 'origin')).toBe('OK');
    expect(sceneBounds(a).min[2]).toBeCloseTo(0, 6);

    // Move the geometry away from the origin: the children drift, the root stays.
    let off = s;
    for (const c of s.scene.nodes[ids.model].children) {
      const p = s.scene.nodes[c].transform.position;
      off = apply(off, { type: 'scene/setTransform', id: c, transform: { position: [p[0] + 200, p[1], p[2]] } });
    }
    off = apply(off, { type: 'scene/restOnFloor', ids: [] });
    expect(status(off, 'origin')).toBe('WARN');
    const before = boundsOf(off, [ids.model]);
    const b = fix(off, 'origin');
    expect(status(b, 'origin')).toBe('OK');
    const after = boundsOf(b, [ids.model]);
    expect(after.min[0]).toBeCloseTo(before.min[0], 6);
    expect(after.max[2]).toBeCloseTo(before.max[2], 6);
  });

  it('shading: a faceted mesh above 200 triangles', () => {
    const s = exampleState();
    const t = apply(s, { type: 'scene/setSmooth', ids: [keyIds(s).body], smooth: false });
    expect(status(t, 'shading')).toBe('WARN');
    expect(status(fix(t, 'shading'), 'shading')).toBe('OK');
  });

  it('bevel: a non-emissive material without bevel', () => {
    const s = exampleState();
    const m = s.scene.nodes[keyIds(s).cap].material!;
    const t = apply(s, { type: 'material/set', id: m, patch: { bevelRadiusMm: 0 } });
    expect(status(t, 'bevel')).toBe('WARN');
    const f = fix(t, 'bevel');
    expect(status(f, 'bevel')).toBe('OK');
    expect(f.materials[m].bevelRadiusMm).toBeCloseTo(121 * 0.0025, 2);
  });

  it('clip: a camera whose clip start cuts the part', () => {
    const s = exampleState();
    const t = apply(s, { type: 'camera/set', id: s.camera.active, patch: { clipStart: 50 } });
    expect(status(t, 'clip')).toBe('WARN');
    const f = fix(t, 'clip');
    expect(status(f, 'clip')).toBe('OK');
    expect(f.camera.cameras[f.camera.active].clipStart).toBeCloseTo(0.605, 6);
  });

  it('lights: a studio light visible to the camera, bright fields excepted', () => {
    const s = exampleState();
    const t = apply(s, { type: 'studio/setLight', id: s.studio.lights[0].id, patch: { camera: true, glossy: false } });
    expect(status(t, 'lights')).toBe('WARN');
    const f = fix(t, 'lights');
    expect(status(f, 'lights')).toBe('OK');
    expect(f.studio.lights[0].glossy).toBe(f.studio.lights[0].recipeGlossy);
    // A bright-field recipe (ECLIPSE) is left alone.
    const e = apply(s, { type: 'studio/setSetup', key: 'ECLIPSE' });
    expect(e.studio.lights.some((l) => l.camera && l.brightField)).toBe(true);
    expect(status(e, 'lights')).toBe('OK');
  });

  it('fix all clears every fixable warning', () => {
    const s = exampleState();
    const ids = keyIds(s);
    const broken = apply(
      s,
      { type: 'scene/setSmooth', ids: [ids.body], smooth: false },
      { type: 'camera/set', id: s.camera.active, patch: { clipStart: 50 } },
      { type: 'scene/setTransform', id: ids.model, transform: { position: [0, 0, 100] } },
    );
    expect(warningCount(runDoctor(broken))).toBe(3);
    expect(warningCount(runDoctor(apply(broken, { type: 'doctor/fixAll' })))).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '../src/data/materials';
import { WEAR_FAMILY_TYPES } from '../src/data/wear';
import {
  FAMILY_PARAMS,
  assignAction,
  indicesToRanges,
  instanceFromPreset,
  triangleMaterials,
  visibleParams,
  wearTypesFor,
} from '../src/core/materials';
import { apply, exampleState, keyIds } from './helpers';

describe('material instances', () => {
  it('every one of the 77 presets makes an instance with wear and bevel', () => {
    expect(MATERIAL_PRESETS).toHaveLength(77);
    for (const p of MATERIAL_PRESETS) {
      const m = instanceFromPreset('m1', p.key, 100)!;
      expect(m.family).toBe(p.family);
      expect(m.preset).toBe(p.key);
      expect(m.wear.amount).toBeGreaterThanOrEqual(0);
      if (p.family === 'EMISSIVE') expect(m.bevelRadiusMm).toBe(0);
      else expect(m.bevelRadiusMm).toBeCloseTo(0.25, 6);
    }
  });

  it('instances do not share arrays with the catalogue', () => {
    const m = instanceFromPreset('m1', 'GOLD', 100)!;
    expect(m.params.baseColor).not.toBe(MATERIAL_PRESETS.find((p) => p.key === 'GOLD')!.params.baseColor);
  });

  it('each family lists its own parameters', () => {
    expect(FAMILY_PARAMS.SIMPLE.map((p) => p.key)).toContain('metallic');
    expect(FAMILY_PARAMS.GLASS.map((p) => p.key)).toContain('ior');
    expect(FAMILY_PARAMS.WOOD.map((p) => p.key)).toContain('woodColor2');
    expect(FAMILY_PARAMS.FABRIC.map((p) => p.key)).toContain('weave');
    expect(FAMILY_PARAMS.EMISSIVE.map((p) => p.key)).toContain('emitPower');
  });

  it('emitters show temperature or colour depending on their kind', () => {
    const bb = instanceFromPreset('m1', 'LED_WARM', 100)!;
    expect(visibleParams(bb).map((p) => p.key)).toContain('temperature');
    expect(visibleParams(bb).map((p) => p.key)).not.toContain('emitColor');
    const neon = instanceFromPreset('m2', 'NEON_RED', 100)!;
    expect(visibleParams(neon).map((p) => p.key)).toContain('emitColor');
  });

  it('wear types follow the family', () => {
    expect(wearTypesFor('FABRIC').sort()).toEqual([...WEAR_FAMILY_TYPES.FABRIC].sort());
    expect(wearTypesFor('EMISSIVE')).toEqual([]);
  });
});

describe('editing', () => {
  it('editing a parameter detaches the instance from its preset', () => {
    const s = exampleState();
    const ids = keyIds(s);
    const capMat = s.scene.nodes[ids.cap].material!;
    const t = apply(s, { type: 'material/setParam', id: capMat, key: 'roughness', value: 0.5 });
    expect(t.materials[capMat].preset).toBeNull();
    expect(t.materials[capMat].origin).toBe('GOLD');
    expect(t.materials[capMat].edited).toBe(true);
    expect(t.materials[capMat].params.roughness).toBe(0.5);
    // A later Gold assignment gets a fresh, linked instance.
    const u = apply(t, assignAction(t, { preset: 'GOLD' }, 'REPLACE', [ids.body]));
    expect(u.scene.nodes[ids.body].material).not.toBe(capMat);
    expect(u.materials[u.scene.nodes[ids.body].material!].preset).toBe('GOLD');
  });

  it('make own material copies a shared instance for the given parts only', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = apply(s, assignAction(s, { preset: 'GOLD' }, 'REPLACE', [ids.closure]));
    const shared = s.scene.nodes[ids.cap].material!;
    expect(s.scene.nodes[ids.collar].material).toBe(shared);
    const t = apply(s, { type: 'material/detach', id: shared, parts: [ids.cap] });
    const own = t.scene.nodes[ids.cap].material!;
    expect(own).not.toBe(shared);
    expect(t.materials[own].edited).toBe(true);
    expect(t.scene.nodes[ids.collar].material).toBe(shared);
  });

  it('wear presets, levels and apply to the whole model', () => {
    const s = exampleState();
    const ids = keyIds(s);
    const body = s.scene.nodes[ids.body].material!;
    let t = apply(s, { type: 'material/wearPreset', id: body, key: 'WORKSHOP' });
    expect(t.materials[body].wear.preset).toBe('WORKSHOP');
    expect(t.materials[body].wear.dirt).toBe(0.8);
    t = apply(t, { type: 'material/setWear', id: body, patch: { amount: 0.35 } });
    expect(t.materials[body].wear.amount).toBe(0.35);
    t = apply(t, { type: 'material/wearToModel', id: body });
    const cap = t.scene.nodes[ids.cap].material!;
    expect(t.materials[cap].wear.dirt).toBe(0.8);
    expect(t.materials[cap].wear.amount).toBe(0.35);
  });
});

describe('face ranges', () => {
  it('indices become sorted runs', () => {
    expect(indicesToRanges([5, 1, 2, 3, 9, 9])).toEqual([
      { start: 1, count: 3 },
      { start: 5, count: 1 },
      { start: 9, count: 1 },
    ]);
  });

  it('later face assignments override earlier ones triangle by triangle', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = apply(s, { type: 'scene/selectFaces', part: ids.body, indices: [0, 1, 2, 3], mode: 'set' });
    s = apply(s, assignAction(s, { preset: 'RUBBER' }));
    s = apply(s, { type: 'scene/selectFaces', part: ids.body, indices: [2], mode: 'set' });
    s = apply(s, assignAction(s, { preset: 'GOLD' }));
    const per = triangleMaterials(s.scene.nodes[ids.body]);
    const preset = (i: number) => s.materials[per[i]!].preset;
    expect([0, 1, 2, 3, 4].map(preset)).toEqual(['RUBBER', 'RUBBER', 'GOLD', 'RUBBER', 'PAINT_MET']);
  });
});

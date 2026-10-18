// Phase M3d (M3c ◆3): the Fast preview bakes a wood of the family in Simple mode through the graph Simple → Nodes
// makes of it (`familyBakeGraph`), so that it shows its rings, pores and knots as the Wood node does, by the same bake.
// Here: the graph is the conversion's and the same program and maps as the material converted to nodes, for every
// wood of the catalogue; it is not made for a fabric, another family or a material with a graph of its own; and
// render/graph-preview.ts draws it with its baked maps (a colour map, white under it), not with its mean colour. What
// the viewport draws of it is tests/wood-fast-browser.test.ts (the same pixels as the node, in Chromium).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '../src/data/materials';
import { familyBakeGraph, FAST_BAKED_FAMILIES, minimalGraph } from '../src/core/material-graph';
import { compileGraph } from '../src/core/material-program';
import { bakeProgram, materialBounds, planBake } from '../src/core/material-preview';
import { instanceFromPreset, type MaterialInstance } from '../src/core/materials';
import { GraphBakes } from '../src/render/graph-preview';
import type { GraphWorkers } from '../src/render/graph-client';
import { BAKED_PREFIX, type TexturePreview } from '../src/render/texture-preview';
import { woodSphereScene } from './browser/programs-scene';

const woods = MATERIAL_PRESETS.filter((p) => p.family === 'WOOD').map((p) => p.key);

describe('the family’s wood in Fast goes through the Wood node’s bake (M3d)', () => {
  it('its graph is the one Simple → Nodes makes, for every wood of the catalogue, once per instance', () => {
    expect(FAST_BAKED_FAMILIES).toEqual(['WOOD']);
    expect(woods.length).toBeGreaterThanOrEqual(7);
    for (const key of woods) {
      const inst = instanceFromPreset('m', key, 120)!;
      const g = familyBakeGraph(inst)!;
      expect(g, key).toEqual(minimalGraph(inst));
      expect(g.nodes.some((n) => n.type === 'WOOD'), key).toBe(true);
      expect(familyBakeGraph(inst), `${key}: cached`).toBe(g);
      // A changed instance (the store replaces it) gets its own.
      const edited: MaterialInstance = { ...inst, params: { ...inst.params, ringDensity: 12 } };
      expect(familyBakeGraph(edited)).not.toBe(g);
      expect(familyBakeGraph(edited)!.nodes.find((n) => n.type === 'WOOD')!.params.ringDensity).toBe(12);
    }
  });

  it('is not made for a fabric, another family, or a material with a graph of its own', () => {
    for (const key of ['COTTON', 'DENIM', 'WHITE_STUDIO', 'GLASS_CLEAR']) expect(familyBakeGraph(instanceFromPreset('m', key, 120)!), key).toBeNull();
    const oak = instanceFromPreset('m', 'OAK', 120)!;
    expect(familyBakeGraph({ ...oak, graph: minimalGraph(oak) })).toBeNull();
  });

  for (const key of ['OAK', 'PINE']) {
    it(`${key}: the same program, plan and maps as the material converted to nodes`, () => {
      const family = woodSphereScene('FAMILY', 64, 48, key);
      const converted = woodSphereScene('CONVERTED', 64, 48, key);
      const id = Object.keys(family.materials).find((k) => family.materials[k].family === 'WOOD')!;
      expect(family.materials[id].graph).toBeUndefined();
      const a = compileGraph(familyBakeGraph(family.materials[id])!).program!;
      const b = compileGraph(converted.materials[id].graph!).program!;
      expect(Array.from(a.code)).toEqual(Array.from(b.code));
      expect(Array.from(a.consts)).toEqual(Array.from(b.consts));
      const pa = planBake(a, materialBounds(family, id), family.scene.partSizeMm);
      const pb = planBake(b, materialBounds(converted, id), converted.scene.partSizeMm);
      expect(pa).toEqual(pb);
      const ra = bakeProgram(a, [], pa, 48);
      const rb = bakeProgram(b, [], pb, 48);
      expect(ra).toEqual(rb);
      // Rings: a colour that varies over the part, and a normal map for the pores and the knots' relief.
      expect(ra.varying).toEqual(expect.arrayContaining(['baseColor', 'roughness', 'normal']));
      expect(ra.maps.color).toBeDefined();
      expect(ra.maps.normal).toBeDefined();
    });
  }

  it('render/graph-preview.ts draws it with its colour map (white under it), not with its mean colour', async () => {
    const s = woodSphereScene('FAMILY', 64, 48, 'OAK');
    const id = Object.keys(s.materials).find((k) => s.materials[k].family === 'WOOD')!;
    const inst = s.materials[id];
    const baked: string[] = [];
    let applied: MaterialInstance | null = null;
    const textures = {
      setBaked: (bakedId: string) => baked.push(bakedId),
      apply: (_m: THREE.MeshPhysicalMaterial, i: MaterialInstance) => (applied = i),
    } as unknown as TexturePreview;
    const workers = { bake: async (program, plan, size) => bakeProgram(program, [], plan, Math.min(size, 32)) } as Pick<GraphWorkers, 'bake'> as GraphWorkers;
    let ready = 0;
    const bakes = new GraphBakes(() => textures, () => ready++);
    bakes.setWorkers(workers);
    expect(bakes.hasWorkers()).toBe(true);
    const m = new THREE.MeshPhysicalMaterial();
    bakes.apply(m, { ...inst, graph: familyBakeGraph(inst)! }, s);
    for (let i = 0; i < 20 && ready < 2; i++) await new Promise((r) => setTimeout(r, 0));
    expect(ready).toBeGreaterThan(0);
    expect(baked.some((b) => b.startsWith(`${BAKED_PREFIX}${id}:`) && b.endsWith(':color'))).toBe(true);
    const t = (applied as MaterialInstance | null)!.textures;
    expect(t.color?.image?.id.startsWith(BAKED_PREFIX)).toBe(true);
    expect([m.color.r, m.color.g, m.color.b]).toEqual([1, 1, 1]);
    // The material's own preview without the bake would be its mean colour (0.6 light + 0.4 dark).
    expect(inst.family).toBe('WOOD');
  });
});

// Phase M3e (M3d ◆1 and ◆2, option b of each): what the Fast preview bakes of a family's wood or a Wood node, and of
// a family's fabric. ◆1: the bake leaves out the knots of the wood its colour comes from (`BakePlan.knotless`), and
// the preview draws them on top with E6's layer, part by part, where the engine puts them (`partKnots` with the Wood
// node's knots, `graphKnotSpec`: the same for the family and the node). ◆2: a fabric of the family is baked through
// the Fabric node only when one thread spans at least 2.5 texels of the 512² bake on its parts (`fastFamilyGraph`),
// and its fuzz goes on top of the bake (`GraphBakes.apply`'s `finish`). What the viewport draws is
// tests/wood-fast-browser.test.ts (the knots where Full puts them) and tests/fabric-fast-browser.test.ts (in Chromium).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '../src/data/materials';
import { knotSpecOf, partKnots } from '../src/core/knots';
import { familyBakeGraph, FAST_BAKED_FAMILIES, minimalGraph } from '../src/core/material-graph';
import { compileGraph } from '../src/core/material-program';
import { bakeProgram, fabricThreadTexels, FABRIC_MIN_THREAD_TEXELS, fastFamilyGraph, graphKnotSpec, materialBounds, planBake, programKnots, type BakePlan } from '../src/core/material-preview';
import type { MaterialInstance } from '../src/core/materials';
import type { ProjectState } from '../src/core/store';
import { GraphBakes } from '../src/render/graph-preview';
import type { GraphWorkers } from '../src/render/graph-client';
import { applyFuzz } from '../src/render/materials';
import type { TexturePreview } from '../src/render/texture-preview';
import { woodSphereScene } from './browser/programs-scene';

const matOf = (s: ProjectState, family: string) => Object.values(s.materials).find((m) => m.family === family)!;
const partOf = (s: ProjectState) => Object.values(s.scene.nodes).find((n) => n.kind === 'PART' && n.name === 'part')!;

/** The sphere's scene with its part's box (part space, mm) made `size` mm wide, deep and tall (what the bake reads). */
function sized(s: ProjectState, size: number): ProjectState {
  const part = partOf(s);
  const mesh = { ...part.mesh!, bounds: { min: [-size / 2, -size / 2, 0] as [number, number, number], max: [size / 2, size / 2, size] as [number, number, number] } };
  return { ...s, scene: { ...s.scene, nodes: { ...s.scene.nodes, [part.id]: { ...part, mesh } } } };
}

describe('the knots of a baked wood go on top, where the engine puts them (M3e ◆1)', () => {
  it('the knots the preview draws are the Wood node’s: the family’s and the converted one’s alike', () => {
    const family = woodSphereScene('FAMILY', 64, 48, 'PINE');
    const converted = woodSphereScene('CONVERTED', 64, 48, 'PINE');
    const inst = matOf(family, 'WOOD');
    const a = graphKnotSpec(familyBakeGraph(inst)!)!;
    const b = graphKnotSpec(converted.materials[inst.id].graph!)!;
    expect(a).toEqual(b);
    // The family's own (f64) values, through the recipe's f32 constants.
    const own = knotSpecOf(inst)!;
    expect(a.count).toBe(own.count);
    expect(a.seed).toBe(own.seed);
    for (const k of ['diameterMm', 'variation', 'darkness'] as const) expect(a[k]).toBeCloseTo(own[k], 6);
    // Placed on the part as the engine places them (its box, its mesh): the family's knots to a micrometre.
    const part = partOf(family);
    const byFamily = partKnots(family, part.id, inst.id)!;
    const byNode = partKnots(converted, part.id, inst.id, b)!;
    expect(byNode.knots.length).toBe(byFamily.knots.length);
    expect(byNode.knots.length).toBeGreaterThan(0);
    byNode.knots.forEach((k, i) => k.origin.forEach((v, j) => expect(Math.abs(v - byFamily.knots[i].origin[j])).toBeLessThan(1e-3)));
    // A wood without knots (the oak) has none to draw.
    expect(graphKnotSpec(familyBakeGraph(matOf(woodSphereScene('FAMILY', 64, 48, 'OAK'), 'WOOD'))!)).toBeNull();
  });

  it('the bake leaves them out: the pine’s colour map is the one of the pine with no knots asked', () => {
    const s = woodSphereScene('FAMILY', 64, 48, 'PINE');
    const bare = woodSphereScene('FAMILY', 64, 48, 'PINE', 'KNOTLESS');
    const id = matOf(s, 'WOOD').id;
    const p = compileGraph(familyBakeGraph(s.materials[id])!).program!;
    const q = compileGraph(familyBakeGraph(bare.materials[id])!).program!;
    const knots = programKnots(p)!;
    expect(knots).not.toBeNull();
    expect(programKnots(q)).toBeNull();
    const plan = planBake(p, materialBounds(s, id), s.scene.partSizeMm);
    const withKnots = bakeProgram(p, [], plan, 64);
    const without = bakeProgram(p, [], { ...plan, knotless: knots.k }, 64);
    const none = bakeProgram(q, [], planBake(q, materialBounds(bare, id), bare.scene.partSizeMm), 64);
    expect(Array.from(without.maps.color!)).toEqual(Array.from(none.maps.color!));
    expect(Array.from(withKnots.maps.color!)).not.toEqual(Array.from(none.maps.color!));
  });

  it('render/graph-preview.ts asks the workers for the bake without them (and with them where none are drawn on top)', async () => {
    const plans: BakePlan[] = [];
    const textures = { setBaked: () => undefined, apply: () => undefined } as unknown as TexturePreview;
    const workers = { bake: async (program, plan, size) => (plans.push(plan), bakeProgram(program, [], plan, Math.min(size, 16))) } as Pick<GraphWorkers, 'bake'> as GraphWorkers;
    const bakes = new GraphBakes(() => textures, () => undefined);
    bakes.setWorkers(workers);
    for (const preset of ['PINE', 'OAK']) {
      const s = woodSphereScene('FAMILY', 64, 48, preset);
      const inst = matOf(s, 'WOOD');
      plans.length = 0;
      bakes.apply(new THREE.MeshPhysicalMaterial(), { ...inst, graph: familyBakeGraph(inst)! }, s);
      expect(plans.length, preset).toBe(2);
      const want = programKnots(compileGraph(familyBakeGraph(inst)!).program!)?.k;
      for (const plan of plans) expect(plan.knotless, preset).toBe(want);
      expect(want === undefined, preset).toBe(preset === 'OAK');
    }
  });
});

describe('a fabric of the family is baked in Fast when its threads read (M3e ◆2)', () => {
  // M3d's report: the texels of a thread in the 512² bake of a 120 mm part (10 / threads per cm, over 120 / 512 mm).
  const AT_120: Record<string, number> = { COTTON: 1.07, TWILL: 1.19, VELVET: 1.42, DENIM: 1.78, SATIN: 0.43, MICROFIB: 0.36, LINEN: 2.37, FELT: 2.13, CANVAS: 3.05, MESH: 5.33, CARBON: 8.53, KNIT: 10.67 };

  it('the threads of each fabric of the catalogue on a 120 mm part, and which of them are baked', () => {
    expect(FAST_BAKED_FAMILIES).toEqual(['WOOD', 'FABRIC']);
    expect(FABRIC_MIN_THREAD_TEXELS).toBe(2.5);
    const fabrics = MATERIAL_PRESETS.filter((p) => p.family === 'FABRIC').map((p) => p.key);
    expect(fabrics.sort()).toEqual(Object.keys(AT_120).sort());
    const baked: string[] = [];
    for (const key of fabrics) {
      const s = sized(woodSphereScene('FAMILY', 64, 48, key), 120);
      const inst = matOf(s, 'FABRIC');
      const texels = fabricThreadTexels(s, inst);
      expect(texels, key).toBeCloseTo(AT_120[key], 2);
      const g = fastFamilyGraph(s, inst);
      if (g) {
        baked.push(key);
        expect(g, key).toBe(familyBakeGraph(inst));
        expect(g.nodes.some((n) => n.type === 'FABRIC'), key).toBe(true);
      }
    }
    // Linen (2.37) and felt (2.13) read in M3d's table of 2 to 3 texels, but not at 2.5.
    expect(baked.sort()).toEqual(['CANVAS', 'CARBON', 'KNIT', 'MESH']);
  });

  it('both sides of the threshold go with the part: cotton baked on a 50 mm part, not on a 52 mm one', () => {
    const s = woodSphereScene('FAMILY', 64, 48, 'COTTON');
    const small = sized(s, 50);
    const large = sized(s, 52);
    const inst = matOf(s, 'FABRIC');
    expect(fabricThreadTexels(small, inst)).toBeCloseTo(2.56, 2);
    expect(fabricThreadTexels(large, inst)).toBeCloseTo(2.46, 2);
    expect(fastFamilyGraph(small, inst)).toBe(familyBakeGraph(inst));
    expect(fastFamilyGraph(large, inst)).toBeNull();
    // The 100 mm sphere: the knit is baked, the cotton is not; nothing for a fabric with a graph of its own.
    expect(fastFamilyGraph(woodSphereScene('FAMILY', 64, 48, 'KNIT'), matOf(woodSphereScene('FAMILY', 64, 48, 'KNIT'), 'FABRIC'))).not.toBeNull();
    expect(fastFamilyGraph(s, inst)).toBeNull();
    const own: MaterialInstance = { ...inst, graph: minimalGraph(inst) };
    expect(fastFamilyGraph(small, own)).toBeNull();
    expect(Number.isNaN(fabricThreadTexels(small, own))).toBe(true);
    // A wood is baked whatever its parts.
    const oak = matOf(woodSphereScene('FAMILY', 64, 48, 'OAK'), 'WOOD');
    expect(fastFamilyGraph(sized(woodSphereScene('FAMILY', 64, 48, 'OAK'), 5000), oak)).toBe(familyBakeGraph(oak));
  });

  it('the fuzz survives the bake: render/graph-preview.ts runs `finish` after every drawing of the material', async () => {
    const s = woodSphereScene('FAMILY', 64, 48, 'KNIT');
    const inst = matOf(s, 'FABRIC');
    const textures = { setBaked: () => undefined, apply: () => undefined } as unknown as TexturePreview;
    const workers = { bake: async (program, plan, size) => bakeProgram(program, [], plan, Math.min(size, 16)) } as Pick<GraphWorkers, 'bake'> as GraphWorkers;
    let ready = 0;
    const bakes = new GraphBakes(() => textures, () => ready++);
    bakes.setWorkers(workers);
    const m = new THREE.MeshPhysicalMaterial();
    bakes.apply(m, { ...inst, graph: fastFamilyGraph(s, inst)! }, s, (x) => applyFuzz(x, inst.params));
    // While the bake comes (the graph's means) and once it is in (the maps): the fuzz of Simple mode.
    expect(m.sheen).toBe(inst.params.fuzz);
    for (let i = 0; i < 20 && ready < 2; i++) await new Promise((r) => setTimeout(r, 0));
    expect(ready).toBe(2);
    expect(m.sheen).toBe(inst.params.fuzz);
    expect(m.sheenRoughness).toBe(inst.params.fuzzRoughness);
    expect(m.sheen).toBeGreaterThan(0);
    // Without it the bake is a Simple material, with no sheen.
    const plain = new THREE.MeshPhysicalMaterial();
    bakes.apply(plain, { ...inst, graph: fastFamilyGraph(s, inst)! }, s);
    expect(plain.sheen).toBe(0);
  });
});

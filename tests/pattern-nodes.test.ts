// Phase M3c: the Wood and Fabric nodes of the material editor. Their recipe is the family's (the same parameters in
// the same units give the same PATN numbers and the same program constants), they compile to the pattern
// instructions, Simple → Nodes turns a wood or a fabric into its node and back exactly, the page writes their program
// only for an engine that runs it, and the Fast preview places them on the part's box. The bits of the instructions
// against the engine are the cross test's (tests/material-program-cross.test.ts).

import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '../src/data/materials';
import { nodeSpec } from '../src/data/material-nodes';
import { exampleGraph } from '../src/core/material-examples';
import { backToSimple, minimalGraph, patternGraphOf, PATTERN_LINKS } from '../src/core/material-graph';
import { compileGraph, disassemble, OP } from '../src/core/material-program';
import { bakePoint, bakeProgram, bakeRows, BAKE_STRIDE, patternPlacements, planBake } from '../src/core/material-preview';
import { ProgramRunner } from '../src/core/material-interp';
import { fabricRecipe, recipeConsts, woodRecipe } from '../src/core/pattern-recipe';
import { PERM_FIRST } from '../src/core/patterns';
import { instanceFromPreset, type MaterialInstance } from '../src/core/materials';
import { patternToRsb, projectScene } from '../src/io/rsb';
import { programsView } from '../src/render/engine';
import { createInitialState, reduce } from '../src/core/store';
import { registerMesh } from '../src/core/meshes';
import type { NodeId, SceneNode } from '../src/core/scene';
import { box, moved } from './browser/programs-scene';

const patterned = MATERIAL_PRESETS.filter((p) => p.family === 'WOOD' || p.family === 'FABRIC');

const opsOf = (g: ReturnType<typeof minimalGraph>) => disassemble(compileGraph(g).program!).map((l) => l.split(' ')[0]);

describe('the Wood and Fabric nodes (M3c)', () => {
  it('draw the E6 noise of the engine (its permutation, pinned in rt-core)', () => {
    expect(PERM_FIRST).toEqual([249, 98, 122, 132, 33, 141, 79, 48]);
  });

  it('have the family’s parameters, keys and units', () => {
    const wood = nodeSpec('WOOD')!;
    const fabric = nodeSpec('FABRIC')!;
    for (const k of ['woodColor1', 'woodColor2', 'ringDensity', 'woodScale', 'ringContrast', 'ringVariation', 'ringNoise', 'axialNoise', 'colorNoise', 'poreSize', 'poreDepth', 'poreBand', 'woodFigure', 'knotCount', 'knotSize', 'knotSizeVar', 'knotDarkness', 'seed'])
      expect(wood.params.map((p) => p.key), k).toContain(k);
    for (const k of ['threadColor1', 'threadColor2', 'weave', 'threadCount', 'weaveDepth', 'yarnTwist', 'fuzz', 'fuzzRoughness']) expect(fabric.params.map((p) => p.key), k).toContain(k);
    expect(fabric.params.find((p) => p.key === 'threadCount')?.unit).toBe('/cm');
    expect(wood.params.find((p) => p.key === 'poreSize')?.unit).toBe('mm');
    expect(wood.outputs.map((o) => o.key)).toEqual(['color', 'roughness', 'anisotropy', 'normal', 'height']);
    expect(fabric.outputs.map((o) => o.key)).toEqual(['color', 'roughness', 'anisotropy', 'normal', 'height', 'sheen']);
  });

  it('compile to the pattern instructions with the PATN recipe of the material they came from', () => {
    for (const p of patterned) {
      const m = instanceFromPreset('m1', p.key, 120)!;
      const g = minimalGraph(m);
      const program = compileGraph(g).program!;
      const pat = patternToRsb(m, 120, 0)!;
      const consts = recipeConsts({ kind: pat.kind, colorA: pat.colorA as [number, number, number], colorB: pat.colorB as [number, number, number], scaleMm: pat.scaleMm, params: pat.params, variant: pat.variant, seed: pat.seed });
      const ops = opsOf(g);
      const head = m.family === 'WOOD' ? 'WOOD' : 'CLOTH';
      expect(ops, p.key).toContain(head);
      expect(ops, p.key).toContain(`${head}R`);
      // The recipe's 25 constants, as the material's PATN writes them.
      const at = program.code.findIndex((_, i) => i % 6 === 0 && program.code[i] === OP[head as 'WOOD']);
      const k = program.code[at + 5];
      expect(Array.from(program.consts.slice(k, k + 25)), p.key).toEqual(consts.map((x) => Math.fround(x)));
      // A normal only where there is a relief to bend it by (pores, bamboo's nodes, knots; a weave's relief).
      const relief = m.family === 'WOOD' ? (pat.params[5] > 0 && pat.params[6] > 0) || pat.variant === 1 || pat.params[10] > 0 : pat.params[0] > 0;
      expect(ops.includes(`${head}N`), p.key).toBe(relief);
    }
  });

  it('take a material’s recipe from the same function as its PATN (woodRecipe, fabricRecipe)', () => {
    for (const p of patterned) {
      const m = instanceFromPreset('m1', p.key, 120)!;
      const r = m.family === 'WOOD' ? woodRecipe(m.params, m.wear.seed) : fabricRecipe(m.params, m.wear.seed);
      const pat = patternToRsb(m, 120, 3)!;
      expect({ ...pat, material: 0 }, p.key).toEqual({ material: 0, kind: r.kind, colorA: r.colorA, colorB: r.colorB, scaleMm: r.scaleMm, params: r.params, variant: r.variant, seed: r.seed });
    }
  });

  it('Simple → Nodes gives a wood its Wood node into the output, and back gives the material itself', () => {
    const m = instanceFromPreset('m1', 'PINE', 120)!;
    const g = minimalGraph(m);
    const pg = patternGraphOf(g)!;
    expect(pg.node.type).toBe('WOOD');
    expect(pg.node.params.knotCount).toBe(m.params.knotCount);
    expect(pg.node.params.woodColor1).toEqual((m.params.woodColor1 as readonly number[]).slice(0, 3));
    expect(pg.node.inputs.roughness).toBe(m.params.roughness);
    expect(g.links.map((l) => [l.output, l.input])).toEqual(PATTERN_LINKS.map(([o, i]) => [o, i]));
    const back = backToSimple({ ...m, graph: g });
    expect(back.exact).toBe(true);
    expect(back.material.params).toEqual(m.params);
  });

  it('a pattern node edited goes back exactly as its family with the node’s values', () => {
    const m = instanceFromPreset('m1', 'OAK', 120)!;
    const g = minimalGraph(m);
    const node = patternGraphOf(g)!.node;
    node.params.ringDensity = 21;
    node.params.woodColor2 = [0.2, 0.1, 0.05];
    node.inputs.roughness = 0.6;
    const back = backToSimple({ ...m, graph: g });
    expect(back.exact).toBe(true);
    expect(back.material.family).toBe('WOOD');
    expect(back.material.params.ringDensity).toBe(21);
    expect(back.material.params.woodColor2).toEqual([0.2, 0.1, 0.05, 1]);
    expect(back.material.params.roughness).toBe(0.6);
    // The same picture: the family's PATN of what came back has the node's recipe.
    const pat = patternToRsb(back.material, 120, 0)!;
    const program = compileGraph(g).program!;
    const at = program.code.findIndex((_, i) => i % 6 === 0 && program.code[i] === OP.WOOD);
    expect(Array.from(program.consts.slice(program.code[at + 5], program.code[at + 5] + 25))).toEqual(recipeConsts({ ...pat, colorA: pat.colorA as [number, number, number], colorB: pat.colorB as [number, number, number] }).map(Math.fround));
    // Another seed than the material's (where the knots are) is not the family's: it asks.
    node.params.seed = 7;
    expect(backToSimple({ ...m, graph: g }).exact).toBe(false);
    // Nor is a graph with another node, or a link less.
    const fabric = instanceFromPreset('m2', 'DENIM', 120)!;
    const fg = minimalGraph(fabric);
    expect(backToSimple({ ...fabric, graph: { ...fg, links: fg.links.slice(1) } }).exact).toBe(false);
    expect(backToSimple({ ...fabric, graph: fg }).exact).toBe(true);
  });

  it('are written as their program only for an engine that runs them (otherwise the mean)', () => {
    const mesh = registerMesh('m3c:plate', moved(box([-60, 0, 0], [60, 8, 90])));
    const mat: MaterialInstance = { ...instanceFromPreset('mPart', 'OAK', 120)! };
    const nodes: Record<NodeId, SceneNode> = {
      model: { id: 'model', name: 'model', kind: 'MODEL', parent: null, children: ['part'], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false },
      part: { id: 'part', name: 'part', kind: 'PART', parent: 'model', children: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false, mesh, material: 'mPart', smooth: true },
    };
    let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['model'], materials: { mPart: mat } }, replace: true });
    const id = Object.values(s.scene.nodes).find((n) => n.kind === 'PART')!.material!;
    s = reduce(s, { type: 'graph/enable', material: id });
    const view = { width: 32, height: 24, maxSamples: 1, maxSeconds: 0, textures: true };
    const programs = (extra: object) => projectScene(s, { ...view, ...extra }).scene.programs ?? [];
    expect(programs({ programs: true })).toHaveLength(1);
    expect(programs({ programs: true, patternNodes: false })).toHaveLength(0);
    // The engine's word: bit 5 (rt_core::FEATURE_PATTERN_NODES) with the programs' (bits 0 and 1).
    expect(programsView(1 | 2 | 32)).toEqual({ programs: true });
    expect(programsView(1 | 2)).toEqual({ programs: true, patternNodes: false });
    expect(programsView(1)).toEqual({});
    // A graph without pattern nodes does not depend on the bit.
    s = reduce(s, { type: 'graph/set', material: id, graph: exampleGraph('MARBLE', null)! });
    expect(programs({ programs: true, patternNodes: false })).toHaveLength(1);
  });

  it('are placed by the Fast preview on the part’s box: the wood’s frame and its knots', () => {
    const m = instanceFromPreset('m1', 'PINE', 120)!;
    const program = compileGraph(minimalGraph(m)).program!;
    expect(program.uses.patterns).toBe(true);
    const place = patternPlacements(program, { min: [-150, -50, 0], max: [150, -30, 100] })!;
    const at = program.code.findIndex((_, i) => i % 6 === 0 && program.code[i] === OP.WOOD);
    const p = place(program.code[at + 5], 1)!;
    // The pith along the longest side (x), below the box along its shortest (y), aside along z.
    expect(p.axes[2]).toEqual([1, 0, 0]);
    expect(p.origin[1]).toBeLessThan(-50);
    expect(p.knots.list.length).toBeGreaterThan(0);
    expect(p.knots.list.length).toBeLessThanOrEqual(Number(m.params.knotCount));
    // Without pattern nodes, nothing to place.
    expect(patternPlacements(compileGraph(exampleGraph('MARBLE', null)!).program!, null)).toBeUndefined();
  });

  it('the Fast bake runs the pattern placed on the parts’ box (a knotty pine)', () => {
    const m = instanceFromPreset('m1', 'PINE', 120)!;
    const program = compileGraph(minimalGraph(m)).program!;
    const bounds = { min: [-150, -40, 0] as [number, number, number], max: [150, -20, 100] as [number, number, number] };
    const plan = planBake(program, bounds, 300);
    const size = 8;
    const band = bakeRows(program, [], plan, size);
    const run = new ProgramRunner(program, [], patternPlacements(program, bounds));
    const out = new Float32Array(3);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const { pt } = bakePoint(plan, (col + 0.5) / size, 1 - (row + 0.5) / size);
        run.setPoint(pt);
        run.run();
        run.read(program.outputs[0], out);
        const i = (row * size + col) * BAKE_STRIDE;
        expect([band.floats[i], band.floats[i + 1], band.floats[i + 2]]).toEqual([out[0], out[1], out[2]]);
      }
    }
  });

  it('the wood example draws rings in Fast on the slice through the part (not a flat colour)', () => {
    const program = compileGraph(exampleGraph('WOOD_TWO_NOISES', null)!).program!;
    const plan = planBake(program, { min: [-60, 0, 0], max: [60, 8, 90] }, 120);
    expect(plan.mode).toBe('TRIPLANAR');
    const bake = bakeProgram(program, [], plan, 64);
    expect(bake.varying).toEqual(expect.arrayContaining(['baseColor', 'roughness', 'normal']));
    // Its mean colour is the oak's (0.6 light + 0.4 dark) within a few hundredths.
    const mean = bake.values.baseColor as number[];
    [0.456, 0.3, 0.162].forEach((v, i) => expect(Math.abs(mean[i] - v)).toBeLessThan(0.04));
  });
});

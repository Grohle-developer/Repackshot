// Phase M3a, what the interface shows of a graph (core/material-preview.ts): the surface the Fast maps are made on
// for each example, and that a projection's maps drawn back through the plan's mapping give the program's own values
// on the part; bands of a bake merged in any order are the bake; the node previews on their sphere; and the plain
// values that stand for a graph where it is not evaluated (the engine until M3b, the thumbnails).

import { describe, expect, it } from 'vitest';
import { MATERIAL_GRAPHS } from '../src/data/material-graphs';
import { graphOfExample, labelPixels, LABEL_HEIGHT, LABEL_WIDTH, registerLabelImage } from '../src/core/material-examples';
import { minimalGraph, newNode, normalizeGraph, type MaterialGraph } from '../src/core/material-graph';
import { compileGraph, OUTPUT_KEYS, type Program } from '../src/core/material-program';
import { ProgramRunner } from '../src/core/material-interp';
import { bakeNotes, bakeProgram, bakeRows, finishBake, flattenGraph, planBake, readOutputs, renderMaterialSphere, renderNodePreviews, spherePoint, type BakeResult } from '../src/core/material-preview';
import { projectPoint, texelOf, wrapCoord } from '../src/core/textures';
import { instanceFromPreset } from '../src/core/materials';
import { materialToRsb } from '../src/io/rsb';

/** The example bottle's body, part space: a cylinder of radius 31 from z 5 to 98. */
const BOTTLE = { min: [-31, -31, 5] as [number, number, number], max: [31, 31, 98] as [number, number, number] };

const program = (g: MaterialGraph): Program => {
  const r = compileGraph(g);
  expect(r.error).toBeNull();
  return r.program!;
};

const labelImages = (p: Program) => p.images.map((im) => (im.image ? { width: LABEL_WIDTH, height: LABEL_HEIGHT, rgba: labelPixels() } : null));

const srgbToLinear = (b: number) => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

describe('the surface of the Fast maps', () => {
  it('follows where each example’s coordinates come from, and says what it approximates', () => {
    const label = registerLabelImage();
    const modes: Record<string, [string, string | null, string[]]> = {};
    for (const def of MATERIAL_GRAPHS) {
      const p = program(graphOfExample(def, label));
      const plan = planBake(p, BOTTLE, 121);
      modes[def.key] = [plan.mode, plan.mode === 'PROJECTION' ? plan.mapping.projection : null, plan.notes];
    }
    expect(modes).toEqual({
      PLASTIC_LABEL: ['PROJECTION', 'CYLINDRICAL', []],
      BRUSHED_SCRATCHED: ['TRIPLANAR', null, ['TRIPLANAR']],
      MARBLE: ['TRIPLANAR', null, ['TRIPLANAR']],
      LEATHER: ['TRIPLANAR', null, ['TRIPLANAR']],
      WOOD_TWO_NOISES: ['TRIPLANAR', null, ['TRIPLANAR']],
      GLASS_DIRT: ['TRIPLANAR', null, ['FRESNEL', 'TRIPLANAR']],
      CHECKS: ['PROJECTION', 'BOX', ['BOX_BLEND']],
      METALLIC_FLAKES: ['TRIPLANAR', null, ['TRIPLANAR']],
      GLAZED_CERAMIC: ['TRIPLANAR', null, ['TRIPLANAR']],
      STRIPES: ['UV', null, []],
    });
  });

  it('a projection’s maps, read through the plan’s mapping on the part, are the program’s own values', () => {
    const label = registerLabelImage();
    const p = program(graphOfExample(MATERIAL_GRAPHS.find((g) => g.key === 'PLASTIC_LABEL')!, label));
    const plan = planBake(p, BOTTLE, 121);
    const size = 256;
    const r = bakeProgram(p, labelImages(p), plan, size);
    expect(r.varying).toEqual(expect.arrayContaining(['baseColor', 'roughness']));
    const run = new ProgramRunner(p, labelImages(p));
    let err = 0;
    let n = 0;
    let labelled = 0;
    for (let i = 0; i < 300; i++) {
      // Points of the body's wall between z 20 and 70, all the way round.
      const a = (i * 2.399) % (2 * Math.PI);
      const z = 20 + ((i * 7.31) % 50);
      const P = [31 * Math.cos(a), 31 * Math.sin(a), z];
      const N = [Math.cos(a), Math.sin(a), 0];
      run.setPoint({ P, N, UV0: [0, 0, 0], UV1: [0, 0, 0], I: N, T: [-Math.sin(a), Math.cos(a), 0], B: [0, 0, 1], dUVdT: [0, 0, 0], dUVdB: [0, 0, 0] });
      run.run();
      const want = readOutputs(run, p).baseColor as number[];
      // What the shader of M2a samples for that point with the plan's mapping (one sample: not box).
      const [uv] = projectPoint(plan.mapping, P, N, 1);
      const [col, row] = texelOf(wrapCoord(uv.u, plan.mapping.wrap), wrapCoord(uv.v, plan.mapping.wrap), size, size);
      const o = (row * size + col) * 4;
      const got = [0, 1, 2].map((c) => srgbToLinear(r.maps.color![o + c]));
      // The label's edges are a texel wide: points at an edge are not compared.
      const d = Math.max(...got.map((g, c) => Math.abs(g - want[c])));
      if (want[0] > 0.2) labelled++;
      if (d > 0.2) continue;
      err += d;
      n++;
    }
    expect(n).toBeGreaterThan(270);
    expect(labelled).toBeGreaterThan(40);
    expect(err / n).toBeLessThan(0.01);
  });

  it('a slice is drawn as a box projection whose front covers the part', () => {
    const p = program(graphOfExample(MATERIAL_GRAPHS.find((g) => g.key === 'MARBLE')!));
    const plan = planBake(p, BOTTLE, 121);
    for (const z of [5, 50, 98]) {
      for (const x of [-31, 0, 31]) {
        const [front] = projectPoint(plan.mapping, [x, -31, z], [0, -1, 0], 1).filter((s) => s.weight > 0.99);
        expect(front.u).toBeGreaterThanOrEqual(0);
        expect(front.u).toBeLessThanOrEqual(1);
        expect(front.v).toBeGreaterThanOrEqual(0);
        expect(front.v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the UV square is evaluated at the texel’s UVs', () => {
    const p = program(graphOfExample(MATERIAL_GRAPHS.find((g) => g.key === 'STRIPES')!));
    const plan = planBake(p, BOTTLE, 121);
    const size = 32;
    const r = bakeProgram(p, [], plan, size);
    const run = new ProgramRunner(p);
    const row = 9;
    const col = 20;
    run.setPoint({ P: [0, 0, 0], N: [0, -1, 0], UV0: [(col + 0.5) / size, 1 - (row + 0.5) / size, 0], UV1: [0, 0, 0], I: [0, -1, 0], T: [1, 0, 0], B: [0, 0, 1], dUVdT: [0, 0, 0], dUVdB: [0, 0, 0] });
    run.run();
    const want = readOutputs(run, p).roughness as number;
    expect(r.maps.roughness![(row * size + col) * 4]).toBe(Math.round(want * 255));
  });

  it('merges bands in any order into the bake made in one go', () => {
    const p = program(graphOfExample(MATERIAL_GRAPHS.find((g) => g.key === 'LEATHER')!));
    const plan = planBake(p, BOTTLE, 121);
    const size = 24;
    const whole = bakeProgram(p, [], plan, size);
    const bands = [bakeRows(p, [], plan, size, 16, 24), bakeRows(p, [], plan, size, 0, 7), bakeRows(p, [], plan, size, 7, 16)];
    const merged: BakeResult = finishBake(p, bands, size);
    expect(merged.varying).toEqual(whole.varying);
    for (const k of Object.keys(whole.maps) as (keyof BakeResult['maps'])[]) expect(merged.maps[k], k).toEqual(whole.maps[k]);
    for (const k of OUTPUT_KEYS) {
      const a = merged.values[k];
      const b = whole.values[k];
      if (typeof a === 'number') expect(a, k).toBeCloseTo(b as number, 10);
      else (a as number[]).forEach((x, i) => expect(x, k).toBeCloseTo((b as number[])[i], 10));
    }
  });

  it('lists the outputs that vary without a map of their own', () => {
    const p = program(graphOfExample(MATERIAL_GRAPHS.find((g) => g.key === 'GLASS_DIRT')!));
    const r = bakeProgram(p, [], planBake(p, BOTTLE, 121), 16);
    const { notes, means } = bakeNotes(planBake(p, BOTTLE, 121), r.varying);
    expect(means).toEqual(['transmission']);
    expect(notes).toContain('MEANS');
    // The surface's own normal is not a map: a graph that gives nothing to the normal has none.
    expect(r.maps.normal).toBeUndefined();
  });
});

describe('the node previews', () => {
  it('draw each probe as it is, on a disc, and the material shaded', () => {
    const g = normalizeGraph({ version: 1, nodes: [{ ...newNode('VALUE', 'v')!, params: { value: 0.5 } }, newNode('COLOR', 'c')!, newNode('OUTPUT', 'o')!], links: [] })!;
    const p = compileGraph(g, { probes: [{ node: 'v', socket: 'value' }, { node: 'c', socket: 'color' }] }).program!;
    const r = renderNodePreviews(p, [], 16);
    expect(r.probes).toHaveLength(2);
    const at = (img: Uint8ClampedArray, x: number, y: number) => [...img.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
    expect(at(r.probes[0], 8, 8)).toEqual([128, 128, 128, 255]);
    expect(at(r.probes[0], 0, 0)[3]).toBe(0);
    // The default grey of the colour node, 0.8 linear, in sRGB.
    expect(at(r.probes[1], 8, 8).slice(0, 3)).toEqual([231, 231, 231]);
    expect(at(r.material, 8, 8)[3]).toBe(255);
    expect(renderMaterialSphere(p, [], 32).length).toBe(32 * 32 * 4);
    // The sphere: its point in front faces the viewer and has u 0.5.
    const front = spherePoint(31.5, 31.5, 64)!;
    expect(front.N[1]).toBeLessThan(-0.99);
    expect(front.UV0[0]).toBeCloseTo(0.5, 2);
  });
});

describe('the plain values that stand for a graph', () => {
  it('are the material’s own for its minimal graph, and the means of a graph’s outputs otherwise', () => {
    const m = instanceFromPreset('m', 'ABS_GLOSS', 120)!;
    const flat = flattenGraph(minimalGraph(m));
    expect(flat.family).toBe('SIMPLE');
    expect(flat.params.roughness).toBeCloseTo(m.params.roughness as number, 6);
    expect((flat.params.baseColor as number[]).slice(0, 3).map((x) => +x.toFixed(5))).toEqual((m.params.baseColor as number[]).slice(0, 3).map((x) => +Math.fround(x).toFixed(5)));
    const marble = graphOfExample(MATERIAL_GRAPHS.find((g) => g.key === 'MARBLE')!);
    const mf = flattenGraph(marble);
    expect((mf.params.baseColor as number[])[0]).toBeGreaterThan(0.5);
    expect(mf.params.coat).toBeCloseTo(0.7, 6);
  });

  it('are what the engine’s scene gets for a material of nodes until it evaluates graphs', () => {
    const m = instanceFromPreset('m', 'ABS_GLOSS', 120)!;
    const marble = graphOfExample(MATERIAL_GRAPHS.find((g) => g.key === 'MARBLE')!);
    const withGraph = materialToRsb({ ...m, graph: marble });
    const flat = flattenGraph(marble);
    expect(withGraph.baseColor[0]).toBeCloseTo((flat.params.baseColor as number[])[0], 6);
    expect(withGraph.coat).toBeCloseTo(0.7, 6);
    // Without a graph, the material's own parameters, as before.
    expect(materialToRsb(m).roughness).toBe(m.params.roughness);
  });
});

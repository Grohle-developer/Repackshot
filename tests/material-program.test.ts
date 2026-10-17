// Phase M3a, the program a graph compiles to (core/material-program.ts) and the reference interpreter
// (core/material-interp.ts): the contract with the engine (M3b). The ten example graphs compile within the limits;
// a 30-node graph compiles in under a millisecond; a graph past a limit is refused with the reason; the bytes read
// back; every instruction does what ARCHITECTURE §5.2 quater says, in f32; and the values of each example at the
// 1000 points of the cross test are pinned (the engine's interpreter must give the same bits, M3b).

import { describe, expect, it } from 'vitest';
import { MATERIAL_GRAPHS } from '../src/data/material-graphs';
import { nodeSpec } from '../src/data/material-nodes';
import { graphOfExample, labelPixels, LABEL_HEIGHT, LABEL_WIDTH, registerLabelImage } from '../src/core/material-examples';
import { newNode, normalizeGraph, type GraphNode, type MaterialGraph } from '../src/core/material-graph';
import { compileGraph, CTX, decodeProgram, disassemble, encodeProgram, instructionCount, MAX_IMAGES, MAX_INSTRUCTIONS, OP, OUTPUT_KEYS, PROGRAM_MAGIC, WORDS, type Program } from '../src/core/material-program';
import { contractPoints, fresnel, outputsHash, ProgramRunner, smoothstep, SRGB_TO_LINEAR, type ShadingPoint } from '../src/core/material-interp';
import { fbm, hash3, perlin3, simplex3 } from '../src/core/noise';
import { projectPoint, type TextureMapping } from '../src/core/textures';

const f = Math.fround;

/** A graph from nodes and links ([from, output, to, input]); the output node is 'out'. */
function graph(nodes: (Partial<GraphNode> & { id: string; type: string })[], links: [string, string, string, string][]): MaterialGraph {
  const all = nodes.some((n) => n.type === 'OUTPUT') ? nodes : [...nodes, { id: 'out', type: 'OUTPUT' }];
  const g = normalizeGraph({
    version: 1,
    nodes: all.map((n) => {
      const base = newNode(n.type, n.id)!;
      return { ...base, params: { ...base.params, ...n.params }, inputs: { ...base.inputs, ...n.inputs } };
    }),
    links: links.map(([from, output, to, input]) => ({ from, output, to, input })),
  })!;
  expect(g.links.length, 'every link of the test graph is kept').toBe(links.length);
  return g;
}

const point = (over: Partial<ShadingPoint> = {}): ShadingPoint => ({
  P: [10, -20, 30],
  N: [0, -1, 0],
  UV0: [0.25, 0.75, 0],
  UV1: [0.5, 0.5, 0],
  I: [0, -1, 0],
  T: [1, 0, 0],
  B: [0, 0, 1],
  dUVdT: [0.01, 0, 0],
  dUVdB: [0, 0.01, 0],
  ...over,
});

/** The value of a probe of node `node`'s `socket` at a point. */
function probe(g: MaterialGraph, node: string, socket: string, pt: ShadingPoint = point(), images: ConstructorParameters<typeof ProgramRunner>[1] = []): number[] {
  const { program, error } = compileGraph(g, { probes: [{ node, socket }] });
  expect(error).toBeNull();
  const run = new ProgramRunner(program!, images);
  run.setPoint(pt);
  run.run();
  const out = [0, 0, 0];
  run.read(program!.probes[0].ref, out);
  return program!.probes[0].type === 'float' ? [out[0]] : out;
}

const mathOf = (op: string, a: number, b = 0, c = 0, clamp = false): number =>
  probe(graph([{ id: 'm', type: 'MATH', params: { op, clamp }, inputs: { a, b, c } }], []), 'm', 'value')[0];

describe('the ten example graphs', () => {
  it('are the ones of the criterion, keep every link and use only what the catalogue has', () => {
    expect(MATERIAL_GRAPHS.map((g) => g.key)).toEqual(['PLASTIC_LABEL', 'BRUSHED_SCRATCHED', 'MARBLE', 'LEATHER', 'WOOD_TWO_NOISES', 'GLASS_DIRT', 'CHECKS', 'METALLIC_FLAKES', 'GLAZED_CERAMIC', 'STRIPES']);
    for (const def of MATERIAL_GRAPHS) {
      expect(def.label.en && def.label.es && def.description.en && def.description.es, def.key).toBeTruthy();
      for (const n of def.nodes) {
        const spec = nodeSpec(n.type);
        expect(spec, `${def.key}.${n.id}`).toBeDefined();
        for (const k of Object.keys(n.params ?? {})) expect(spec!.params.some((p) => p.key === k), `${def.key}.${n.id}.${k}`).toBe(true);
        for (const k of Object.keys(n.inputs ?? {})) expect(spec!.inputs.some((p) => p.key === k), `${def.key}.${n.id}.${k}`).toBe(true);
      }
      const g = graphOfExample(def);
      expect(g.links.length, def.key).toBe(def.links.length);
      expect(g.nodes.length, def.key).toBe(def.nodes.length);
    }
  });

  it('compile within the limits, with every node reached from the output', () => {
    for (const def of MATERIAL_GRAPHS) {
      const { program, error } = compileGraph(graphOfExample(def));
      expect(error, def.key).toBeNull();
      expect(instructionCount(program!), def.key).toBeLessThan(80);
      expect(program!.nF, def.key).toBeLessThan(16);
    }
  });
});

describe('compiling', () => {
  /** 30 nodes, all feeding the output: a mapping, three noises, maths, ramps, mixes, a bump. */
  function thirtyNodes(): MaterialGraph {
    const nodes: (Partial<GraphNode> & { id: string; type: string })[] = [
      { id: 'map', type: 'MAPPING', params: { projection: 'OBJECT' } },
      { id: 'n1', type: 'NOISE' },
      { id: 'n2', type: 'NOISE', params: { kind: 'SIMPLEX' } },
      { id: 'n3', type: 'NOISE', params: { octaves: 2 } },
    ];
    const links: [string, string, string, string][] = [
      ['map', 'vector', 'n1', 'vector'],
      ['map', 'vector', 'n2', 'vector'],
      ['map', 'vector', 'n3', 'vector'],
    ];
    let prev = 'n1';
    for (let i = 0; i < 20; i++) {
      const id = `m${i}`;
      nodes.push({ id, type: 'MATH', params: { op: ['ADD', 'MULTIPLY', 'SMOOTH_MIN', 'POWER', 'MULTIPLY_ADD'][i % 5] } });
      links.push([prev, 'value', id, 'a'], [i % 2 ? 'n2' : 'n3', 'value', id, 'b']);
      prev = id;
    }
    nodes.push({ id: 'r', type: 'RAMP' }, { id: 'mix', type: 'MIX' }, { id: 'inv', type: 'INVERT' }, { id: 'bump', type: 'BUMP' }, { id: 'fr', type: 'FRESNEL' });
    links.push([prev, 'value', 'r', 'fac'], ['r', 'color', 'mix', 'a'], ['n2', 'color', 'mix', 'b'], ['fr', 'facing', 'mix', 'fac'], ['mix', 'color', 'inv', 'color'], ['inv', 'color', 'out', 'baseColor'], ['n3', 'value', 'bump', 'height'], ['bump', 'normal', 'out', 'normal']);
    const g = graph(nodes, links);
    expect(g.nodes).toHaveLength(30);
    return g;
  }

  it('takes less than a millisecond for a graph of 30 nodes', () => {
    const g = thirtyNodes();
    for (let i = 0; i < 30; i++) compileGraph(g);
    // The median of many runs: a loaded machine pre-empts some of them.
    const times: number[] = [];
    for (let i = 0; i < 41; i++) {
      const t = performance.now();
      const { program } = compileGraph(g);
      times.push(performance.now() - t);
      expect(program).not.toBeNull();
    }
    times.sort((a, b) => a - b);
    expect(times[20]).toBeLessThan(1);
  });

  it('refuses a graph past the instruction limit or the image limit, and says which', () => {
    // Bumps whose height comes from the facing of the bump before: each level evaluates the one before three times.
    const nodes: (Partial<GraphNode> & { id: string; type: string })[] = [];
    const links: [string, string, string, string][] = [];
    let normal: [string, string] | null = null;
    for (let i = 0; i < 9; i++) {
      nodes.push({ id: `f${i}`, type: 'FRESNEL' }, { id: `b${i}`, type: 'BUMP' });
      if (normal) links.push([normal[0], normal[1], `f${i}`, 'normal']);
      links.push([`f${i}`, 'facing', `b${i}`, 'height']);
      normal = [`b${i}`, 'normal'];
    }
    links.push([normal![0], normal![1], 'out', 'normal']);
    expect(compileGraph(graph(nodes, links)).error).toEqual({ code: 'TOO_MANY_INSTRUCTIONS', limit: MAX_INSTRUCTIONS });
    const imgs: (Partial<GraphNode> & { id: string; type: string })[] = [];
    const ilinks: [string, string, string, string][] = [];
    for (let i = 0; i <= MAX_IMAGES; i++) {
      imgs.push({ id: `i${i}`, type: 'IMAGE', params: { image: { id: `tex:${i}`, name: `${i}.png`, width: 2, height: 2 } } }, { id: `a${i}`, type: 'MATH', params: { op: 'ADD' } });
      ilinks.push([`i${i}`, 'alpha', `a${i}`, 'b']);
      if (i > 0) ilinks.push([`a${i - 1}`, 'value', `a${i}`, 'a']);
    }
    ilinks.push([`a${MAX_IMAGES}`, 'value', 'out', 'roughness']);
    expect(compileGraph(graph(imgs, ilinks)).error).toEqual({ code: 'TOO_MANY_IMAGES', limit: MAX_IMAGES });
  });

  it('gives a register back after its last read, never to a value read in the same instruction', () => {
    const nodes: (Partial<GraphNode> & { id: string; type: string })[] = [{ id: 'n', type: 'NOISE' }];
    const links: [string, string, string, string][] = [];
    let prev = 'n';
    for (let i = 0; i < 60; i++) {
      nodes.push({ id: `m${i}`, type: 'MATH', params: { op: 'ADD' }, inputs: { b: i } });
      links.push([prev, 'value', `m${i}`, 'a']);
      prev = `m${i}`;
    }
    links.push([prev, 'value', 'out', 'roughness']);
    const { program } = compileGraph(graph(nodes, links));
    expect(program!.nF).toBeLessThanOrEqual(4);
    for (let i = 0; i < program!.code.length; i += WORDS) {
      if (program!.code[i] !== OP.FADD) continue;
      const [d, a, b] = [program!.code[i + 1], program!.code[i + 2], program!.code[i + 3]];
      expect(d === a || d === b).toBe(false);
    }
    // The chain's value: noise + 0 + 1 + … + 59.
    const run = new ProgramRunner(program!);
    run.setPoint(point());
    run.run();
    const out = [0];
    run.read(program!.outputs[2], out);
    const noise = probe(graph([{ id: 'n', type: 'NOISE' }], []), 'n', 'value')[0];
    let want = noise;
    for (let i = 0; i < 60; i++) want = f(want + i);
    expect(out[0]).toBe(want);
  });

  it('converts between socket types with the documented instructions', () => {
    const g = graph(
      [
        { id: 'c', type: 'COLOR', params: { color: [0.2, 0.4, 0.8] } },
        { id: 'm', type: 'MAPPING', params: { projection: 'UV' } },
        { id: 'a', type: 'MATH', params: { op: 'ADD' } },
        { id: 'b', type: 'MATH', params: { op: 'ADD' } },
        { id: 'v', type: 'VALUE', params: { value: 0.3 } },
      ],
      [
        ['c', 'color', 'a', 'a'],
        ['m', 'vector', 'b', 'a'],
        ['a', 'value', 'out', 'roughness'],
        ['b', 'value', 'out', 'metallic'],
        ['v', 'value', 'out', 'baseColor'],
      ],
    );
    const text = disassemble(compileGraph(g).program!).join('\n');
    expect(text).toMatch(/VLUM/);
    expect(text).toMatch(/VAVG/);
    expect(text).toMatch(/F2V/);
    expect(probe(g, 'a', 'value')[0]).toBe(f(f(f(f(f(0.2) * f(0.2126)) + f(f(0.4) * f(0.7152))) + f(f(0.8) * f(0.0722))) + f(0.5)));
    // UV (0.25, 0.75, 0): the average.
    expect(probe(g, 'b', 'value')[0]).toBe(f(f(f(f(0.25 + 0.75) + 0) / 3) + f(0.5)));
  });

  it('leaves the outputs as they are when previews add probes', () => {
    for (const def of MATERIAL_GRAPHS) {
      const g = graphOfExample(def);
      const plain = compileGraph(g).program!;
      const probed = compileGraph(g, { probes: g.nodes.flatMap((n) => nodeSpec(n.type)!.outputs.map((o) => ({ node: n.id, socket: o.key }))) }).program!;
      const pts = contractPoints(50, 7);
      expect(outputsHash(new ProgramRunner(probed), pts), def.key).toBe(outputsHash(new ProgramRunner(plain), pts));
    }
  });
});

describe('the bytes of a program', () => {
  it('read back the same, with the header of the contract', () => {
    const label = registerLabelImage();
    const p = compileGraph(graphOfExample(MATERIAL_GRAPHS[0], label)).program!;
    const bytes = encodeProgram(p, () => 5);
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint32(0, true)).toBe(PROGRAM_MAGIC);
    expect(dv.getUint32(8, true)).toBe(instructionCount(p));
    expect(bytes.length).toBe(40 + p.code.length * 4 + p.consts.length * 4 + p.images.length * 12 + p.outputs.length * 8);
    const back = decodeProgram(bytes);
    expect(back.program.code).toEqual(p.code);
    expect(back.program.consts).toEqual(p.consts);
    expect(back.program.outputs).toEqual(p.outputs);
    expect([back.program.nF, back.program.nV, back.program.version]).toEqual([p.nF, p.nV, p.version]);
    expect(back.images).toEqual([{ index: 5, srgb: true, wrap: 1 }]);
  });
});

describe('the instructions', () => {
  it('of the Maths node, in f32, with the documented edge cases', () => {
    expect(mathOf('ADD', 0.1, 0.2)).toBe(f(f(0.1) + f(0.2)));
    expect(mathOf('SUBTRACT', 0.1, 0.2)).toBe(f(f(0.1) - f(0.2)));
    expect(mathOf('MULTIPLY', 0.1, 0.2)).toBe(f(f(0.1) * f(0.2)));
    expect(mathOf('DIVIDE', 1, 3)).toBe(f(1 / 3));
    expect(mathOf('DIVIDE', 1, 0)).toBe(0);
    expect(mathOf('MULTIPLY_ADD', 0.1, 0.2, 0.3)).toBe(f(f(f(0.1) * f(0.2)) + f(0.3)));
    expect(mathOf('POWER', 2, 3)).toBeCloseTo(8, 5);
    expect(mathOf('POWER', -2, 3)).toBeCloseTo(-8, 5);
    expect(mathOf('POWER', -2, 2)).toBeCloseTo(4, 5);
    expect(mathOf('POWER', -2, 0.5)).toBe(0);
    expect(mathOf('POWER', 0, 0)).toBe(1);
    expect(mathOf('POWER', 0, -1)).toBe(0);
    expect(mathOf('MINIMUM', 0.3, 0.2)).toBe(f(0.2));
    expect(mathOf('MAXIMUM', 0.3, 0.2)).toBe(f(0.3));
    expect(mathOf('SMOOTH_MIN', 0.3, 0.2, 0)).toBe(f(0.2));
    // h = (0.5 − 0.1) / 0.5 = 0.8; min − h² · k / 4 = 0.2 − 0.08.
    expect(mathOf('SMOOTH_MIN', 0.3, 0.2, 0.5)).toBeCloseTo(0.12, 6);
    expect(mathOf('SMOOTH_MAX', 0.3, 0.2, 0.5)).toBeCloseTo(0.38, 6);
    expect(mathOf('SMOOTHSTEP', 0.5, 0, 1)).toBe(0.5);
    expect(mathOf('SMOOTHSTEP', 0.2, 0.4, 0.4)).toBe(0);
    expect(mathOf('SMOOTHSTEP', 0.4, 0.4, 0.4)).toBe(1);
    expect(mathOf('ABSOLUTE', -0.7)).toBe(f(0.7));
    expect(mathOf('LESS_THAN', 0.1, 0.2)).toBe(1);
    expect(mathOf('GREATER_THAN', 0.1, 0.2)).toBe(0);
    expect(mathOf('FLOOR', -1.25)).toBe(-2);
    expect(mathOf('FRACTION', -1.25)).toBe(0.75);
    expect(mathOf('SINE', Math.PI / 2)).toBeCloseTo(1, 6);
    expect(mathOf('ADD', 0.8, 0.7, 0, true)).toBe(1);
    expect(smoothstep(0, 1, 0.25)).toBe(f(f(0.25 * 0.25) * f(3 - f(0.5))));
  });

  it('of the mapping, as the projections of the Textures section (M2a)', () => {
    let seed = 99;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (const projection of ['UV', 'PLANAR', 'BOX', 'CYLINDRICAL', 'SPHERICAL'] as const) {
      for (const axis of ['X', 'Y', 'Z'] as const) {
        for (let i = 0; i < 40; i++) {
          const m: TextureMapping = { projection, axis, uvSet: 0, sizeMm: 20 + 80 * rnd(), rotationDeg: 360 * rnd() - 180, offset: [rnd() - 0.5, rnd() - 0.5], repeat: [0.5 + 2 * rnd(), 0.5 + 2 * rnd()], wrap: 'REPEAT' };
          const P = [f(100 * rnd() - 50), f(100 * rnd() - 50), f(100 * rnd() - 50)];
          const nn = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
          const l = Math.hypot(nn[0], nn[1], nn[2]);
          const N = nn.map((x) => f(x / l));
          const UV = [f(rnd()), f(rnd()), 0];
          const g = graph([{ id: 'm', type: 'MAPPING', params: { projection, axis, sizeMm: m.sizeMm, rotationDeg: m.rotationDeg, offsetU: m.offset[0], offsetV: m.offset[1], repeatU: m.repeat[0], repeatV: m.repeat[1] } }], []);
          const got = probe(g, 'm', 'vector', point({ P, N, UV0: UV }));
          const ref = projectPoint(m, P, N, 1, [UV[0], UV[1]]);
          // BOX: the face that counts most (the program switches where the preview's shader blends).
          const want = ref.reduce((a, b) => (b.weight > a.weight ? b : a));
          const tag = `${projection} ${axis} ${i}`;
          // The turn of a cylinder wraps at the back: compare across the seam.
          const du = got[0] - want.u;
          expect(Math.abs(du - (projection === 'CYLINDRICAL' || projection === 'SPHERICAL' ? Math.round(du / m.repeat[0]) * m.repeat[0] : 0)), tag).toBeLessThan(2e-4 * Math.max(1, Math.abs(want.u)));
          expect(Math.abs(got[1] - want.v), tag).toBeLessThan(2e-4 * Math.max(1, Math.abs(want.v)));
          expect(got[2], tag).toBe(0);
        }
      }
    }
    // OBJECT: the part's coordinates over the size, on the section axes of the axis, turned about it.
    const g = graph([{ id: 'm', type: 'MAPPING', params: { projection: 'OBJECT', axis: 'Y', sizeMm: 10 } }], []);
    expect(probe(g, 'm', 'vector', point({ P: [10, -20, 30] }))).toEqual([3, 1, -2]);
  });

  it('of the image read: bilinear between texel centres, wrapped, sRGB decoded per texel; white and no alpha without pixels', () => {
    // 2 × 2: top row black, white; bottom row grey 128, red.
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 0, 255, 0, 0, 255]);
    const px = { width: 2, height: 2, rgba };
    const img = (wrap: string, colorSpace = 'LINEAR') => graph([{ id: 'i', type: 'IMAGE', params: { image: { id: 'tex:t', name: 't.png', width: 2, height: 2 }, wrap, colorSpace } }], []);
    const at = (u: number, v: number, wrap = 'REPEAT', cs = 'LINEAR', socket = 'color') => probe(img(wrap, cs), 'i', socket, point({ UV0: [u, v, 0] }), [px]);
    // Texel centres: (0.25, 0.75) is the top left, (0.75, 0.25) the bottom right.
    expect(at(0.25, 0.75)).toEqual([0, 0, 0]);
    expect(at(0.75, 0.75)).toEqual([1, 1, 1]);
    expect(at(0.75, 0.25)).toEqual([1, 0, 0]);
    expect(at(0.25, 0.25, 'REPEAT', 'SRGB')).toEqual([SRGB_TO_LINEAR[128], SRGB_TO_LINEAR[128], SRGB_TO_LINEAR[128]]);
    expect(at(0.25, 0.25, 'REPEAT', 'LINEAR', 'alpha')).toEqual([0]);
    // Half way between the two top texels.
    expect(at(0.5, 0.75)[0]).toBe(0.5);
    // Repeat: u 1.25 is u 0.25; clamp: u 1.25 is the right edge.
    expect(at(1.25, 0.75)).toEqual([0, 0, 0]);
    expect(at(1.25, 0.75, 'CLAMP')).toEqual([1, 1, 1]);
    // Mirror: u 1.25 is u 0.75.
    expect(at(1.25, 0.75, 'MIRROR')).toEqual([1, 1, 1]);
    // No pixels.
    expect(probe(img('REPEAT'), 'i', 'color', point(), [null])).toEqual([1, 1, 1]);
    expect(probe(img('REPEAT'), 'i', 'alpha', point(), [null])).toEqual([0]);
    expect(SRGB_TO_LINEAR[255]).toBe(1);
    expect(SRGB_TO_LINEAR[10]).toBe(f(f(10 / 255) / f(12.92)));
  });

  it('of the textures: checks, stripes, gradients and ramps', () => {
    const at = (type: string, socket: string, params: Record<string, unknown>, inputs: Record<string, unknown>, P: number[]) => probe(graph([{ id: 'x', type, params: params as never, inputs: inputs as never }], []), 'x', socket, point({ P }))[0];
    // OBJECT coordinates: P / 100. Scale 1: cells of 100 mm.
    expect(at('CHECKER', 'value', {}, { scale: 1 }, [10, 10, 10])).toBe(0);
    expect(at('CHECKER', 'value', {}, { scale: 1 }, [110, 10, 10])).toBe(1);
    expect(at('CHECKER', 'value', {}, { scale: 1 }, [-10, 10, 10])).toBe(1);
    expect(at('CHECKER', 'value', {}, { scale: 1 }, [-10, -10, 10])).toBe(0);
    // Stripes across x, width 0.5: inside the band about 0.25, outside about 0.75.
    expect(at('STRIPES', 'value', { softness: 0 }, { scale: 1, width: 0.5 }, [20, 0, 0])).toBe(1);
    expect(at('STRIPES', 'value', { softness: 0 }, { scale: 1, width: 0.5 }, [70, 0, 0])).toBe(0);
    expect(at('GRADIENT', 'value', { kind: 'LINEAR' }, {}, [40, 0, 0])).toBe(f(40 * f(0.01)));
    expect(at('GRADIENT', 'value', { kind: 'LINEAR' }, {}, [140, 0, 0])).toBe(1);
    expect(at('GRADIENT', 'value', { kind: 'QUADRATIC' }, {}, [-40, 0, 0])).toBe(0);
    expect(at('GRADIENT', 'value', { kind: 'SPHERICAL' }, {}, [30, 40, 0])).toBe(f(0.5));
    expect(at('GRADIENT', 'value', { kind: 'RADIAL' }, {}, [0, 10, 0])).toBe(0.75);
    const ramp = (interpolation: string, fac: number) =>
      probe(graph([{ id: 'r', type: 'RAMP', params: { interpolation, stops: [{ pos: 1, color: [1, 0, 0] }, { pos: 0, color: [0, 0, 1] }, { pos: 0.5, color: [0, 1, 0] }] }, inputs: { fac } }], []), 'r', 'color');
    expect(ramp('LINEAR', 0.25)).toEqual([0, 0.5, 0.5]);
    expect(ramp('CONSTANT', 0.75)).toEqual([0, 1, 0]);
    expect(ramp('EASE', 0.25)).toEqual([0, 0.5, 0.5]);
    expect(ramp('LINEAR', -1)).toEqual([0, 0, 1]);
    expect(ramp('LINEAR', 2)).toEqual([1, 0, 0]);
  });

  it('of the surface: Fresnel, facing, normal map and bump', () => {
    expect(fresnel(1.5, 1)).toBeCloseTo(0.04, 6);
    expect(fresnel(1.5, 0)).toBe(1);
    expect(fresnel(1, 0.5)).toBe(0);
    const facing = (blend: number, I: number[]) => probe(graph([{ id: 'x', type: 'FRESNEL', inputs: { blend } }], []), 'x', 'facing', point({ I }))[0];
    expect(facing(0.5, [0, -1, 0])).toBe(0);
    expect(facing(0.5, [0, -Math.SQRT1_2, Math.SQRT1_2])).toBeCloseTo(1 - Math.SQRT1_2, 6);
    // A flat normal map gives the normal back; one tilted along u turns it towards T.
    const nmap = (color: number[]) => probe(graph([{ id: 'x', type: 'NORMAL_MAP', inputs: { color: color as never } }], []), 'x', 'normal');
    expect(nmap([0.5, 0.5, 1])).toEqual([0, -1, 0]);
    const tilted = nmap([1, 0.5, 0.5]);
    expect(tilted[0]).toBeCloseTo(1, 6);
    // C1: a blue below 0.5 never points the normal into the surface; it bends it as the blue mirrored about 0.5 does.
    expect(nmap([0.5, 0.5, 0])).toEqual([0, -1, 0]);
    for (const color of [[1, 0.5, 0.2], [0.1, 0.9, 0.45], [0.73, 0.21, 0]]) {
      const n = nmap(color);
      expect(-n[1], `${color}`).toBeGreaterThanOrEqual(0);
      const up = nmap([color[0], color[1], 1 - color[2]]);
      for (let i = 0; i < 3; i++) expect(n[i]).toBeCloseTo(up[i], 6);
    }
    // C1: in the part's space too, at any strength: a map against the surface past 0.5 is mirrored across its plane.
    const part = (color: number[], strength: number) => probe(graph([{ id: 'x', type: 'NORMAL_MAP', params: { space: 'OBJECT' }, inputs: { color: color as never, strength } }], []), 'x', 'normal');
    for (const strength of [0.6, 1, 3, 10]) {
      const n = part([0.6, 1, 0.5], strength);
      expect(-n[1], `strength ${strength}`).toBeGreaterThanOrEqual(0);
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
    }
    expect(-part([0.5, 1, 0.5], 1)[1]).toBeGreaterThanOrEqual(0);
    // Under 0.5 nothing is folded: the same as before C1.
    expect(-part([0.6, 1, 0.5], 0.4)[1]).toBeGreaterThan(0);
    // A height rising along x bends the normal against x.
    const bumped = probe(
      graph(
        [
          { id: 'm', type: 'MAPPING', params: { projection: 'OBJECT', sizeMm: 1 } },
          { id: 's', type: 'SEPARATE_RGB' },
          { id: 'b', type: 'BUMP', inputs: { distance: 1, strength: 1 } },
        ],
        [
          ['m', 'vector', 's', 'color'],
          ['s', 'r', 'b', 'height'],
        ],
      ),
      'b',
      'normal',
    );
    // Height = x (mm): slope 1 along T = +x, so n = normalize(N − T) = (−1, −1, 0)/√2.
    expect(bumped[0]).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(bumped[1]).toBeCloseTo(-Math.SQRT1_2, 3);
  });

  it('of the noise: deterministic, within 0..1, about 0.5, zero on the lattice, decorrelated by the seed', () => {
    expect(perlin3(3, -2, 7, 0)).toBe(0);
    expect(hash3(1, 2, 3, 0)).toBe(hash3(1, 2, 3, 0));
    expect(hash3(1, 2, 3, 0)).not.toBe(hash3(1, 2, 3, 1));
    for (const kind of ['PERLIN', 'SIMPLEX'] as const) {
      let sum = 0;
      let lo = 1;
      let hi = 0;
      for (let i = 0; i < 4000; i++) {
        const v = fbm(kind, i * 0.173, i * 0.071, i * 0.031, 4, 2, 0.5, 3);
        sum += v;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      expect(lo, kind).toBeGreaterThanOrEqual(0);
      expect(hi, kind).toBeLessThanOrEqual(1);
      expect(sum / 4000, kind).toBeGreaterThan(0.45);
      expect(sum / 4000, kind).toBeLessThan(0.55);
      expect(hi - lo, kind).toBeGreaterThan(0.4);
    }
    // Pinned: the contract's bits (M3b reproduces them).
    expect([perlin3(0.3, 1.7, -2.2, 0), perlin3(10.5, -3.25, 0.125, 9), simplex3(0.3, 1.7, -2.2, 0), simplex3(10.5, -3.25, 0.125, 9), fbm('PERLIN', 1.1, 2.2, 3.3, 5, 2, 0.5, 4)]).toEqual(NOISE_PINS);
    expect(perlin3(2e9, 0, 0, 0)).toBe(0);
    expect(simplex3(Number.NaN, 0, 0, 0)).toBe(0);
  });
});

/** Values the contract fixes (the first run of this test printed them; a change here is a change of the contract). */
const NOISE_PINS = [-0.394427627325058, -0.08158119767904282, -0.3009605407714844, 0.48996973037719727, 0.48041778802871704];

/** FNV-1a of every output of each example at the 1000 points of `contractPoints(1000)`. */
const EXAMPLE_PINS: Record<string, string> = {
  PLASTIC_LABEL: 'ca47a410',
  BRUSHED_SCRATCHED: 'd7ac667e',
  MARBLE: '9068993f',
  LEATHER: '4ffd820c',
  WOOD_TWO_NOISES: '043e3493',
  GLASS_DIRT: 'ec1261b4',
  CHECKS: '27d9baac',
  METALLIC_FLAKES: '3795f601',
  GLAZED_CERAMIC: 'e17b0ee2',
  STRIPES: '9dd8d317',
};

describe('the cross test with the engine (its TS side)', () => {
  it('pins the values of each example at the 1000 points', () => {
    const label = registerLabelImage();
    const pts = contractPoints(1000);
    const got: Record<string, string> = {};
    for (const def of MATERIAL_GRAPHS) {
      const p: Program = compileGraph(graphOfExample(def, label)).program!;
      const images = p.images.map((im) => (im.image ? { width: LABEL_WIDTH, height: LABEL_HEIGHT, rgba: labelPixels() } : null));
      got[def.key] = outputsHash(new ProgramRunner(p, images), pts);
    }
    expect(got).toEqual(EXAMPLE_PINS);
  });

  it('C1: the metallic flakes face out of the surface at every point (a noise’s own blue put half of them into it)', () => {
    const def = MATERIAL_GRAPHS.find((g) => g.key === 'METALLIC_FLAKES')!;
    const p = compileGraph(graphOfExample(def, registerLabelImage())).program!;
    const run = new ProgramRunner(p);
    const at = OUTPUT_KEYS.indexOf('normal');
    const n = [0, 0, 0];
    let tilted = 0;
    const pts = contractPoints(1000);
    for (const pt of pts) {
      run.setPoint(pt);
      run.run();
      run.read(p.outputs[at], n);
      const cos = n[0] * pt.N[0] + n[1] * pt.N[1] + n[2] * pt.N[2];
      expect(cos).toBeGreaterThan(0);
      if (cos < 0.999) tilted++;
    }
    // And they do tilt: the flakes are there.
    expect(tilted).toBeGreaterThan(pts.length / 2);
  });

  it('makes the points the contract says', () => {
    const pts = contractPoints(3);
    for (const pt of pts) {
      expect(Math.hypot(...pt.N)).toBeCloseTo(1, 6);
      expect(Math.abs(pt.N[0] * pt.T[0] + pt.N[1] * pt.T[1] + pt.N[2] * pt.T[2])).toBeLessThan(1e-6);
      for (const v of [...pt.P, ...pt.N, ...pt.UV0, ...pt.T]) expect(f(v)).toBe(v);
    }
    expect(pts[0].P).toEqual(POINT_PIN);
    // The context's registers are where the contract says.
    expect([CTX.P, CTX.N, CTX.UV0, CTX.UV1, CTX.I, CTX.T, CTX.B, CTX.DUV_T, CTX.DUV_B]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

const POINT_PIN: number[] = [75.89328002929688, 9.065103530883789, -21.186220169067383];

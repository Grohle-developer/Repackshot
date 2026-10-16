// Phase M3a, the model of material graphs (core/material-graph.ts): the node catalogue and its stable keys, the
// typed links and the conversions they may make, the store's actions (undoable, one entry each, refused links leave
// no entry), Simple ↔ Nodes (back to Simple without a question only from a minimal graph), the project file (a graph
// saved and opened is the same graph, and saves again to the same text) and the library.

import { describe, expect, it } from 'vitest';
import { MATERIAL_NODES, nodeSpec, OUTPUT_INPUTS, SOCKET_TYPES, type SocketType } from '../src/data/material-nodes';
import { MATERIAL_PRESETS } from '../src/data/materials';
import { exampleGraph, registerLabelImage } from '../src/core/material-examples';
import {
  backToSimple,
  canConvert,
  duplicateIds,
  graphImageRefs,
  isMinimal,
  linkProblem,
  minimalGraph,
  newNode,
  nextNodeId,
  normalizeGraph,
  outputNode,
  outputSetup,
  type GraphAction,
  type MaterialGraph,
} from '../src/core/material-graph';
import { fabricMeanColor, instanceFromPreset, type MaterialInstance } from '../src/core/materials';
import { createStore, type ProjectState } from '../src/core/store';
import { textureImages } from '../src/core/textures';
import { emptyLibrary, fromMaterialInstance, instanceFromItem } from '../src/core/library';
import { loadProject, placeTextureImages, serializeProject } from '../src/io/project';
import { materialToRsb } from '../src/io/rsb';
import { exampleState, keyIds } from './helpers';

/** A store with the example bottle, its body in Nodes mode; returns the body's material id too. */
function graphStore(): { store: ReturnType<typeof createStore>; mat: string } {
  const store = createStore(exampleState());
  const mat = bodyMaterial(store.get());
  store.dispatch({ type: 'graph/enable', material: mat });
  return { store, mat };
}

const graphOf = (s: ProjectState, mat: string): MaterialGraph => s.materials[mat].graph!;
const bodyMaterial = (s: ProjectState): string => s.scene.nodes[keyIds(s).body].material!;

describe('the node catalogue', () => {
  it('has stable, unique keys and the keys of the brief', () => {
    const keys = MATERIAL_NODES.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Keys are added, never renamed (CLAUDE.md rule 7): projects keep them.
    expect(keys).toEqual(['OUTPUT', 'IMAGE', 'MAPPING', 'NOISE', 'GRADIENT', 'CHECKER', 'STRIPES', 'RAMP', 'MIX', 'MATH', 'FRESNEL', 'CURVATURE', 'VALUE', 'COLOR', 'SEPARATE_RGB', 'COMBINE_RGB', 'INVERT', 'NORMAL_MAP', 'BUMP']);
    expect(OUTPUT_INPUTS.map((s) => s.key)).toEqual(['baseColor', 'metallic', 'roughness', 'anisotropic', 'coat', 'coatRoughness', 'transmission', 'ior', 'subsurface', 'emission', 'emissionStrength', 'opacity', 'normal', 'bump', 'bevel']);
  });

  it('labels everything in both languages and gives every input a value or an implicit source of its type', () => {
    for (const n of MATERIAL_NODES) {
      expect(n.label.en && n.label.es && n.description.en && n.description.es, n.key).toBeTruthy();
      for (const list of [n.inputs, n.outputs]) {
        const ks = list.map((s) => s.key);
        expect(new Set(ks).size, n.key).toBe(ks.length);
        for (const s of list) expect(s.label.en && s.label.es, `${n.key}.${s.key}`).toBeTruthy();
      }
      for (const s of n.inputs) {
        const ok = s.implicit ? (s.type === 'vector' || s.type === 'normal') && s.default === undefined : s.type === 'float' ? typeof s.default === 'number' : Array.isArray(s.default) && s.default.length === 3;
        expect(ok, `${n.key}.${s.key}`).toBe(true);
      }
      for (const p of n.params) {
        expect(p.label.en && p.label.es, `${n.key}.${p.key}`).toBeTruthy();
        if (p.kind === 'enum') expect(p.options?.some((o) => o.value === p.default), `${n.key}.${p.key}`).toBe(true);
      }
    }
  });
});

describe('links between sockets', () => {
  it('convert as the table says, and a normal comes only from a normal', () => {
    const table: Record<SocketType, Record<SocketType, boolean>> = {
      float: { float: true, color: true, vector: true, normal: false },
      color: { float: true, color: true, vector: true, normal: false },
      vector: { float: true, color: true, vector: true, normal: false },
      normal: { float: false, color: false, vector: true, normal: true },
    };
    for (const a of SOCKET_TYPES) for (const b of SOCKET_TYPES) expect(canConvert(a, b), `${a} → ${b}`).toBe(table[a][b]);
  });

  it('are refused for the wrong types, a node into itself, a cycle, or ends that are not there', () => {
    const { store, mat } = graphStore();
    const add = (type: string, id: string) => store.dispatch({ type: 'graph/addNode', material: mat, node: newNode(type, id)! });
    add('NOISE', 'a');
    add('NORMAL_MAP', 'b');
    add('MATH', 'c');
    add('MATH', 'd');
    const g = () => graphOf(store.get(), mat);
    const out = outputNode(g())!.id;
    expect(linkProblem(g(), { from: 'a', output: 'color', to: out, input: 'normal' })).toBe('TYPE');
    expect(linkProblem(g(), { from: 'a', output: 'value', to: out, input: 'normal' })).toBe('TYPE');
    expect(linkProblem(g(), { from: 'b', output: 'normal', to: 'c', input: 'a' })).toBe('TYPE');
    expect(linkProblem(g(), { from: 'b', output: 'normal', to: out, input: 'baseColor' })).toBe('TYPE');
    expect(linkProblem(g(), { from: 'c', output: 'value', to: 'c', input: 'a' })).toBe('SELF');
    expect(linkProblem(g(), { from: 'x', output: 'value', to: 'c', input: 'a' })).toBe('NODE');
    expect(linkProblem(g(), { from: 'c', output: 'colour', to: 'd', input: 'a' })).toBe('SOCKET');
    // A colour into a number, a number into a colour, a normal into a vector: converted.
    expect(linkProblem(g(), { from: 'a', output: 'color', to: 'c', input: 'a' })).toBeNull();
    expect(linkProblem(g(), { from: 'c', output: 'value', to: out, input: 'baseColor' })).toBeNull();
    expect(linkProblem(g(), { from: 'b', output: 'normal', to: 'a', input: 'vector' })).toBeNull();
    store.dispatch({ type: 'graph/connect', material: mat, link: { from: 'c', output: 'value', to: 'd', input: 'a' } });
    expect(linkProblem(g(), { from: 'd', output: 'value', to: 'c', input: 'b' })).toBe('CYCLE');
  });

  it('that are refused change nothing and leave no undo entry; a new link replaces the one into the same input', () => {
    const { store, mat } = graphStore();
    store.dispatch({ type: 'graph/addNode', material: mat, node: newNode('NOISE', 'a')! });
    store.dispatch({ type: 'graph/addNode', material: mat, node: newNode('COLOR', 'b')! });
    const out = outputNode(graphOf(store.get(), mat))!.id;
    const before = store.get();
    const entries = store.history().undo.length;
    store.dispatch({ type: 'graph/connect', material: mat, link: { from: 'a', output: 'color', to: out, input: 'normal' } });
    expect(store.get()).toBe(before);
    expect(store.history().undo.length).toBe(entries);
    store.dispatch({ type: 'graph/connect', material: mat, link: { from: 'a', output: 'color', to: out, input: 'baseColor' } });
    store.dispatch({ type: 'graph/connect', material: mat, link: { from: 'b', output: 'color', to: out, input: 'baseColor' } });
    const into = graphOf(store.get(), mat).links.filter((l) => l.to === out && l.input === 'baseColor');
    expect(into).toEqual([{ from: 'b', output: 'color', to: out, input: 'baseColor' }]);
    expect(store.history().undo.length).toBe(entries + 2);
  });
});

describe('the actions on a graph', () => {
  it('keep the output node, take a node’s links with it, and duplicate with the links among the copies', () => {
    const { store, mat } = graphStore();
    const g0 = graphOf(store.get(), mat);
    const out = outputNode(g0)!.id;
    store.dispatch({ type: 'graph/removeNodes', material: mat, ids: [out] });
    expect(graphOf(store.get(), mat)).toBe(g0);
    store.dispatch({ type: 'graph/addNode', material: mat, node: newNode('NOISE', 'a', 10, 20)!, link: { from: 'a', output: 'value', to: out, input: 'roughness' } });
    store.dispatch({ type: 'graph/addNode', material: mat, node: newNode('RAMP', 'b')!, link: { from: 'b', output: 'color', to: out, input: 'baseColor' } });
    store.dispatch({ type: 'graph/connect', material: mat, link: { from: 'a', output: 'value', to: 'b', input: 'fac' } });
    const ids = duplicateIds(graphOf(store.get(), mat), ['a', 'b', out]);
    expect([...ids.entries()]).toEqual([
      ['a', 'n2'],
      ['b', 'n3'],
    ]);
    store.dispatch({ type: 'graph/duplicate', material: mat, ids: ['a', 'b', out], dx: 30, dy: 40 });
    const g = graphOf(store.get(), mat);
    expect(g.nodes.find((n) => n.id === 'n2')).toMatchObject({ type: 'NOISE', x: 40, y: 60 });
    expect(g.links).toContainEqual({ from: 'n2', output: 'value', to: 'n3', input: 'fac' });
    expect(g.links.filter((l) => l.from === 'n2' || l.to === 'n2' || l.from === 'n3' || l.to === 'n3')).toHaveLength(1);
    store.dispatch({ type: 'graph/removeNodes', material: mat, ids: ['a'] });
    expect(graphOf(store.get(), mat).links.some((l) => l.from === 'a' || l.to === 'a')).toBe(false);
  });

  it('keep values within their kinds and ranges, and ignore keys a node does not have', () => {
    const { store, mat } = graphStore();
    store.dispatch({ type: 'graph/addNode', material: mat, node: newNode('NOISE', 'a')! });
    store.dispatch({ type: 'graph/setParam', material: mat, node: 'a', key: 'octaves', value: 99.4 });
    store.dispatch({ type: 'graph/setParam', material: mat, node: 'a', key: 'kind', value: 'WORLEY' });
    store.dispatch({ type: 'graph/setInput', material: mat, node: 'a', input: 'scale', value: -3 });
    const before = store.get();
    store.dispatch({ type: 'graph/setParam', material: mat, node: 'a', key: 'nothing', value: 1 });
    store.dispatch({ type: 'graph/setInput', material: mat, node: 'a', input: 'vector', value: [1, 2, 3] });
    expect(store.get()).toBe(before);
    const n = graphOf(store.get(), mat).nodes.find((x) => x.id === 'a')!;
    expect(n.params.octaves).toBe(8);
    expect(n.params.kind).toBe('PERLIN');
    expect(n.inputs.scale).toBe(0);
  });

  it('make the material the user’s own, and a drag of a node is one undo entry', () => {
    const { store, mat } = graphStore();
    expect(store.get().materials[mat]).toMatchObject({ preset: null, edited: true });
    store.dispatch({ type: 'graph/addNode', material: mat, node: newNode('VALUE', 'a')!, label: 'Add' });
    const entries = store.history().undo.length;
    for (let i = 1; i <= 12; i++) store.dispatch({ type: 'graph/moveNodes', material: mat, moves: [{ id: 'a', x: i * 5, y: i * 3 }], gesture: 'drag-1' });
    expect(store.history().undo.length).toBe(entries + 1);
    expect(graphOf(store.get(), mat).nodes.find((n) => n.id === 'a')).toMatchObject({ x: 60, y: 36 });
    store.undo();
    expect(graphOf(store.get(), mat).nodes.find((n) => n.id === 'a')).toMatchObject({ x: 0, y: 0 });
  });

  it('undone and redone fifty at a time give back the graph they started from and the one they reached', () => {
    const { store, mat } = graphStore();
    // A seeded generator (xorshift32): the same fifty edits every run.
    let seed = 2463534242;
    const rnd = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
    const start = structuredClone(graphOf(store.get(), mat));
    const startEntries = store.history().undo.length;
    const types = MATERIAL_NODES.filter((n) => !n.unique).map((n) => n.key);
    let edits = 0;
    let guard = 0;
    while (edits < 50 && guard++ < 2000) {
      const g = graphOf(store.get(), mat);
      const nodes = g.nodes;
      const node = pick(nodes);
      const spec = nodeSpec(node.type)!;
      const kind = Math.floor(rnd() * 8);
      let action: GraphAction | null = null;
      if (kind === 0 || nodes.length < 3) action = { type: 'graph/addNode', material: mat, node: newNode(pick(types), nextNodeId(g), Math.round(rnd() * 800), Math.round(rnd() * 600))! };
      else if (kind === 1) {
        const from = pick(nodes.filter((n) => nodeSpec(n.type)!.outputs.length > 0));
        const to = pick(nodes.filter((n) => nodeSpec(n.type)!.inputs.length > 0));
        if (from && to) action = { type: 'graph/connect', material: mat, link: { from: from.id, output: pick(nodeSpec(from.type)!.outputs).key, to: to.id, input: pick(nodeSpec(to.type)!.inputs).key } };
      } else if (kind === 2 && spec.params.length > 0) {
        const p = pick(spec.params);
        const value = p.kind === 'enum' ? pick(p.options!).value : p.kind === 'bool' ? rnd() < 0.5 : p.kind === 'color' ? [rnd(), rnd(), rnd()] : p.kind === 'number' || p.kind === 'int' ? rnd() * 10 : null;
        if (value !== null) action = { type: 'graph/setParam', material: mat, node: node.id, key: p.key, value: value as never };
      } else if (kind === 3) {
        const ins = spec.inputs.filter((s) => s.default !== undefined);
        if (ins.length > 0) {
          const s = pick(ins);
          action = { type: 'graph/setInput', material: mat, node: node.id, input: s.key, value: s.type === 'float' ? Math.round(rnd() * 100) / 100 : [rnd(), rnd(), rnd()] };
        }
      } else if (kind === 4) action = { type: 'graph/moveNodes', material: mat, moves: [{ id: node.id, x: Math.round(rnd() * 900), y: Math.round(rnd() * 900) }] };
      else if (kind === 5 && g.links.length > 0) {
        const l = pick(g.links);
        action = { type: 'graph/disconnect', material: mat, node: l.to, input: l.input };
      } else if (kind === 6) action = { type: 'graph/duplicate', material: mat, ids: [node.id], dx: 20, dy: 20 };
      else if (kind === 7 && node.type !== 'OUTPUT') action = { type: 'graph/removeNodes', material: mat, ids: [node.id] };
      if (!action) continue;
      const before = store.get();
      store.dispatch(action);
      if (store.get() !== before) edits++;
    }
    expect(edits).toBe(50);
    expect(store.history().undo.length).toBe(startEntries + 50);
    const end = structuredClone(graphOf(store.get(), mat));
    expect(end).not.toEqual(start);
    for (let i = 0; i < 50; i++) store.undo();
    expect(graphOf(store.get(), mat)).toEqual(start);
    for (let i = 0; i < 50; i++) store.redo();
    expect(graphOf(store.get(), mat)).toEqual(end);
  });
});

describe('Simple and Nodes', () => {
  it('every catalogue material goes to its minimal graph and back to exactly itself', () => {
    for (const p of MATERIAL_PRESETS) {
      const m = instanceFromPreset('m1', p.key, 120)!;
      const g = minimalGraph(m);
      expect(isMinimal(g), p.key).toBe(true);
      const back = backToSimple({ ...m, graph: g });
      expect(back.exact, p.key).toBe(true);
      expect(back.material.family, p.key).toBe(m.family);
      expect(back.material.params, p.key).toEqual(m.params);
      expect('graph' in back.material, p.key).toBe(false);
    }
  });

  it('the minimal graph of every catalogue material gives the engine the colour the material gives it (a denim stays blue)', () => {
    for (const p of MATERIAL_PRESETS) {
      const m = instanceFromPreset('m1', p.key, 120)!;
      const engine = materialToRsb(m).baseColor;
      const nodes = materialToRsb({ ...m, graph: minimalGraph(m) }).baseColor;
      engine.forEach((v, i) => expect(nodes[i], `${p.key} channel ${i}`).toBeCloseTo(v, 6));
    }
    // The weave counts by its warp share: a 3/1 twill is not the plain mean of its two threads.
    const denim = instanceFromPreset('m1', 'DENIM', 120)!;
    const a = denim.params.threadColor1 as readonly number[];
    const b = denim.params.threadColor2 as readonly number[];
    expect(outputSetup(denim).inputs.baseColor).toEqual(fabricMeanColor(denim.params));
    expect(Math.abs((a[0] + b[0]) / 2 - fabricMeanColor(denim.params)[0])).toBeGreaterThan(0.01);
  });

  it('a minimal graph with other values goes back without asking when a family holds them exactly', () => {
    const { store, mat } = graphStore();
    const out = outputNode(graphOf(store.get(), mat))!.id;
    store.dispatch({ type: 'graph/setInput', material: mat, node: out, input: 'roughness', value: 0.71 });
    store.dispatch({ type: 'graph/setInput', material: mat, node: out, input: 'metallic', value: 0 });
    store.dispatch({ type: 'graph/disable', material: mat });
    const m = store.get().materials[mat];
    expect(m.graph).toBeUndefined();
    expect(m.family).toBe('SIMPLE');
    expect(m.params.roughness).toBe(0.71);
    // And Nodes again gives the same values.
    expect(outputSetup(m).inputs.roughness).toBe(0.71);
  });

  it('a graph with more than its output goes back only when forced, keeping the output’s own values', () => {
    const { store, mat } = graphStore();
    const out = outputNode(graphOf(store.get(), mat))!.id;
    store.dispatch({ type: 'graph/addNode', material: mat, node: newNode('NOISE', 'a')!, link: { from: 'a', output: 'value', to: out, input: 'roughness' } });
    store.dispatch({ type: 'graph/setInput', material: mat, node: out, input: 'baseColor', value: [0.1, 0.2, 0.3] });
    const before = store.get();
    store.dispatch({ type: 'graph/disable', material: mat });
    expect(store.get()).toBe(before);
    expect(backToSimple(before.materials[mat]).exact).toBe(false);
    store.dispatch({ type: 'graph/disable', material: mat, force: true });
    const m = store.get().materials[mat];
    expect(m.graph).toBeUndefined();
    expect(m.params.baseColor).toEqual([0.1, 0.2, 0.3, 1]);
    store.undo();
    expect(store.get().materials[mat].graph).toBeDefined();
  });

  it('an emitter and a glass keep their families; a minimal graph with an emitter’s values goes back as one, other emitting values ask', () => {
    for (const family of ['EMISSIVE', 'GLASS'] as const) {
      const preset = MATERIAL_PRESETS.find((p) => p.family === family)!;
      const m = instanceFromPreset('m1', preset.key, 120)!;
      const g = minimalGraph(m);
      g.nodes[0].inputs.roughness = family === 'GLASS' ? 0.11 : 0.4;
      const back = backToSimple({ ...m, graph: g });
      expect(back.material.family, preset.key).toBe(family);
      expect(back.exact, preset.key).toBe(true);
    }
    const plain = instanceFromPreset('m1', 'ABS_GLOSS', 120)!;
    const g = minimalGraph(plain);
    // The values an emitter's minimal graph has (its dark body, its colour, 50 W as radiance).
    Object.assign(g.nodes[0].inputs, outputSetup({ family: 'EMISSIVE', params: { emitKind: 'COLOR', emitColor: [1, 0.5, 0.2, 1], emitPower: 50 } }).inputs);
    const lit = backToSimple({ ...plain, graph: g });
    expect(lit.exact).toBe(true);
    expect(lit.material).toMatchObject({ family: 'EMISSIVE', params: { emitKind: 'COLOR', emitColor: [1, 0.5, 0.2, 1] } });
    expect(lit.material.params.emitPower).toBeCloseTo(50, 9);
    // A bright plastic that also emits: Simple has no emission and an emitter no base colour.
    g.nodes[0].inputs.baseColor = [0.8, 0.1, 0.1];
    expect(backToSimple({ ...plain, graph: g }).exact).toBe(false);
  });
});

describe('a graph in the project file', () => {
  it('opens as the same graph, with its image, and saves again to the same text', async () => {
    const label = registerLabelImage();
    const s0 = exampleState();
    const mat = bodyMaterial(s0);
    const store = createStore(s0);
    store.dispatch({ type: 'graph/enable', material: mat });
    store.dispatch({ type: 'graph/set', material: mat, graph: exampleGraph('PLASTIC_LABEL', label)! });
    const s = store.get();
    expect([...textureImages(s).keys()]).toContain(label.id);
    const text = await serializeProject(s).text();
    const loaded = loadProject(text);
    const placed = placeTextureImages(loaded.state, loaded.images);
    expect(placed.missing).toBe(0);
    expect(placed.state.materials[mat].graph).toEqual(s.materials[mat].graph);
    expect(graphImageRefs(placed.state.materials[mat].graph)).toEqual([label]);
    expect(await serializeProject(placed.state).text()).toBe(text);
    // A Simple material keeps no graph key at all.
    expect('graph' in placed.state.materials[s.scene.nodes[keyIds(s).cap].material!]).toBe(false);
  });

  it('is read node by node: unknown nodes and their links dropped, one output, no cycles, no newer schema', () => {
    const g = normalizeGraph({
      version: 1,
      nodes: [
        { id: 'a', type: 'MATH', x: 0, y: 0 },
        { id: 'b', type: 'MATH', x: 0, y: 0 },
        { id: 'w', type: 'WORLEY', x: 0, y: 0 },
        { id: 'o', type: 'OUTPUT', x: 0, y: 0 },
        { id: 'o2', type: 'OUTPUT', x: 0, y: 0 },
      ],
      links: [
        { from: 'a', output: 'value', to: 'b', input: 'a' },
        { from: 'b', output: 'value', to: 'a', input: 'a' },
        { from: 'w', output: 'value', to: 'o', input: 'roughness' },
        { from: 'b', output: 'value', to: 'o', input: 'roughness' },
      ],
    })!;
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'o']);
    expect(g.links).toEqual([
      { from: 'a', output: 'value', to: 'b', input: 'a' },
      { from: 'b', output: 'value', to: 'o', input: 'roughness' },
    ]);
    expect(normalizeGraph(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(normalizeGraph({ version: 2, nodes: [], links: [] })).toBeNull();
    expect(outputNode(normalizeGraph({ version: 1, nodes: [], links: [] })!)).toBeDefined();
  });

  it('travels in the library without the images of its image nodes', () => {
    const label = registerLabelImage();
    const m: MaterialInstance = { ...instanceFromPreset('m1', 'ABS_GLOSS', 120)!, graph: exampleGraph('PLASTIC_LABEL', label)! };
    const item = fromMaterialInstance(emptyLibrary(), m, 'Labelled', { now: 1, id: 'mat-1' });
    expect(item.material.graph?.nodes.length).toBe(m.graph!.nodes.length);
    expect(graphImageRefs(item.material.graph)).toEqual([]);
    expect(instanceFromItem(item).graph).toEqual(item.material.graph);
  });
});

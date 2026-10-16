// Phase M3b: the engine runs the material programs. The page writes a node material as its program (PROG) when the
// engine says it runs them (rt_features bit 1, `features` of the launcher's /api/info: render/engine.ts
// `readsPrograms`), the views of Full and of Render carry the switch, a scene without node materials keeps its bytes,
// the page's writer gives the bytes of `rt --write-m3b-example` (tests/fixtures/m3b.rsb), the page's reference
// interpreter gives the engine's values for the engine's own programs (the cross test the other way round), and the
// real rt.wasm renders the scene, through the page's own code, to rt-core's pinned image.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildExample } from '../src/core/example';
import { exampleGraph, registerLabelImage } from '../src/core/material-examples';
import { MATERIAL_GRAPHS } from '../src/data/material-graphs';
import { contractPoints, outputsHash, ProgramRunner, type ImagePixels } from '../src/core/material-interp';
import { compileGraph, decodeProgram, type Program } from '../src/core/material-program';
import { createInitialState, reduce, type ProjectState } from '../src/core/store';
import { ENGINE_FEATURE_PROGRAMS, ENGINE_FEATURE_TEXTURES, readsPrograms } from '../src/render/engine';
import { emissionVaries, graphProgram, materialToRsb, projectScene, writeRsb, type RsbImage, type RsbScene } from '../src/io/rsb';
import { PathTracerEngine, Pool, type SceneSource, type TracerView } from '../src/render/pathtracer';
import type { WorkerReply, WorkerRequest } from '../src/render/pool-protocol';
import { readRsb, sections } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const FIXTURE = new Uint8Array(readFileSync('tests/fixtures/m3b.rsb'));

function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** The example bottle, the material of its body (`key` of the graph examples) a node material; also the material id. */
function nodeProject(key: string): { state: ProjectState; material: string } {
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: buildExample(), replace: true });
  const body = Object.values(s.scene.nodes).find((n) => n.key === 'body')!;
  const material = body.material!;
  const def = MATERIAL_GRAPHS.find((g) => g.key === key)!;
  s = reduce(s, { type: 'graph/enable', material });
  s = reduce(s, { type: 'graph/set', material, graph: exampleGraph(key, def.labelImage ? registerLabelImage() : null)! });
  return { state: s, material };
}

/** A worker that says it is ready with `features` and loads any scene. */
class ReadyWorker {
  onmessage: ((e: { data: WorkerReply }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  constructor(private readonly features: number | undefined) {}
  postMessage(msg: WorkerRequest): void {
    queueMicrotask(() => {
      if (msg.type === 'init') this.onmessage?.({ data: { type: 'ready', version: 0x000300, ...(this.features === undefined ? {} : { features: this.features }) } });
      if (msg.type === 'scene') this.onmessage?.({ data: { type: 'scene', id: msg.id, error: null } });
      if (msg.type === 'job') {
        for (let k = 0; k < msg.tiles.length; k += 5) {
          const [, , w, h, index] = msg.tiles.subarray(k, k + 5);
          this.onmessage?.({ data: { type: 'tile', generation: msg.generation, index, first: msg.first, count: msg.count, data: new Float32Array(w * h * 4 * msg.count) } });
        }
        this.onmessage?.({ data: { type: 'done', generation: msg.generation } });
      }
      if (msg.type === 'tonemap') this.onmessage?.({ data: { type: 'pixels', id: msg.id, bytes: new Uint8ClampedArray((msg.sum.byteLength / 16) * 4) } });
    });
  }
  terminate(): void {}
}

function recording(views: TracerView[]): SceneSource {
  return {
    build: (_s, view) => {
      views.push(view);
      return { meshKey: 'k', bytes: (meshes) => new Uint8Array([meshes ? 2 : 1, view.width & 255, 0, 0]) };
    },
    tone: () => ({ exposureEv: 0, tonemap: 1 }),
  };
}

describe('the switch: the page writes the programs when the engine runs them (M3b)', () => {
  it('reads the bit the engine reports, with the textures’ (a program reads IMGS and the UVs)', () => {
    expect([ENGINE_FEATURE_TEXTURES, ENGINE_FEATURE_PROGRAMS]).toEqual([1, 2]);
    expect(readsPrograms(3)).toBe(true);
    expect(readsPrograms(7)).toBe(true);
    expect(readsPrograms(1)).toBe(false);
    expect(readsPrograms(2)).toBe(false);
    expect(readsPrograms(0)).toBe(false);
    expect(readsPrograms(undefined)).toBe(false);
  });

  for (const [what, features, on] of [
    ['an engine that runs them', 3, true],
    ['an engine of M2b (textures only)', 1, false],
    ['an rt.wasm of before M2b (no rt_features)', undefined, false],
  ] as const) {
    it(`a Render asks for them with ${what}, and the viewport too`, async () => {
      const pool = await Pool.create({} as WebAssembly.Module, 2, () => new ReadyWorker(features) as unknown as Worker);
      const views: TracerView[] = [];
      const engine = new PathTracerEngine(pool, recording(views), false);
      engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
      await engine.renderPixels({ width: 8, height: 4, maxSamples: 1, maxSeconds: 0, transparent: false });
      expect(views.length).toBeGreaterThan(0);
      expect(views.every((v) => (v.programs === true) === on)).toBe(true);
      expect(views.every((v) => (v.textures === true) === (features !== undefined))).toBe(true);
      engine.dispose();
    });
  }

  it('a node material goes as its program (PROG, last) over its mean; off, as the mean alone, as before', () => {
    const { state } = nodeProject('MARBLE');
    const view = { width: 64, height: 48, maxSamples: 4, maxSeconds: 0 };
    const on = writeRsb(projectScene(state, { ...view, textures: true, programs: true }).scene);
    const textured = writeRsb(projectScene(state, { ...view, textures: true }).scene);
    const off = writeRsb(projectScene(state, view).scene);
    const tags = sections(on).map((s) => s.tag);
    expect(tags.filter((t) => t === 'PROG')).toHaveLength(1);
    expect(tags.indexOf('PROG')).toBe(tags.length - 1);
    expect(sections(textured).map((s) => s.tag)).not.toContain('PROG');
    expect(sections(off).map((s) => s.tag)).not.toContain('PROG');
    // Without the textures (an engine of before M2b) there is no program either.
    expect(sections(writeRsb(projectScene(state, { ...view, programs: true }).scene)).map((s) => s.tag)).not.toContain('PROG');
    // The program is the graph's, its material the body's MATL, and everything before it is the textured scene's.
    const r = readRsb(on);
    const prog = r.programs![0];
    const body = Object.values(state.scene.nodes).find((n) => n.key === 'body')!;
    const graph = state.materials[body.material!].graph!;
    const p = decodeProgram(prog.bytes).program;
    expect(Array.from(p.code)).toEqual(Array.from(compileGraph(graph).program!.code));
    expect(r.materials[prog.material]).toEqual(readRsb(textured).materials[prog.material]);
    const cut = textured.length;
    expect(firstDiff(on.subarray(0, cut), textured)).toBe(-1);
  });

  it('a scene without node materials writes the same bytes with the switch on', () => {
    const s = reduce(createInitialState(), { type: 'scene/addModel', payload: buildExample(), replace: true });
    const view = { width: 32, height: 24, maxSamples: 2, maxSeconds: 0 };
    const on = writeRsb(projectScene(s, { ...view, textures: true, programs: true }).scene);
    const off = writeRsb(projectScene(s, { ...view, textures: true }).scene);
    expect(firstDiff(on, off)).toBe(-1);
  });

  it('a node material whose emission varies is no emitter (it reflects and adds it); a constant one is', () => {
    // Emission from a checker: varies. The minimal graph of an emitter: constant.
    const { state, material } = nodeProject('CHECKS');
    const g = state.materials[material].graph!;
    const out = g.nodes.find((n) => n.type === 'OUTPUT')!;
    const glowing = { ...g, links: [...g.links, { from: 'check', output: 'color', to: out.id, input: 'emission' }], nodes: g.nodes.map((n) => (n === out ? { ...n, inputs: { ...n.inputs, emissionStrength: 4 } } : n)) };
    const p = graphProgram(glowing)!;
    expect(emissionVaries(p)).toBe(true);
    const inst = { ...state.materials[material], graph: glowing };
    expect(materialToRsb(inst).kind).toBe(2);
    expect(materialToRsb(inst, { program: p }).kind).toBe(0);
    const lamp = { ...state.materials[material], graph: { ...g, links: [], nodes: g.nodes.filter((n) => n === out).map((n) => ({ ...n, inputs: { ...n.inputs, emission: [1, 0.9, 0.8] as [number, number, number], emissionStrength: 5 } })) } };
    const q = graphProgram(lamp.graph)!;
    expect(emissionVaries(q)).toBe(false);
    expect(materialToRsb(lamp, { program: q }).kind).toBe(2);
  });
});

/** The images of IMGS as the reference interpreter takes them (straight RGBA). */
function rgbaOf(im: RsbImage): ImagePixels {
  const n = im.width * im.height;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) rgba[4 * i + c] = im.data[i * im.channels + (im.channels === 1 ? 0 : c)];
    rgba[4 * i + 3] = im.channels === 4 ? im.data[i * 4 + 3] : 255;
  }
  return { width: im.width, height: im.height, rgba };
}

/** The pinned values of the engine's example programs (rt-core program/tests.rs). */
function pinnedProgramValues(): string[] {
  const src = readFileSync('engine/crates/rt-core/src/program/tests.rs', 'utf8');
  const block = /PINNED_M3B_PROGRAM_VALUES: \[u32; 7\] = \[([^\]]*)\]/.exec(src)![1];
  return [...block.matchAll(/0x([0-9a-f_]+)/g)].map((m) => m[1].replaceAll('_', '').padStart(8, '0'));
}

describe('the page’s writer and interpreter and the engine’s example of programs', () => {
  it('reads tests/fixtures/m3b.rsb (`rt --write-m3b-example`) and writes it back to the same bytes', () => {
    const r = readRsb(FIXTURE);
    expect(r.programs?.map((p) => p.material)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(r.tags.slice(-7)).toEqual(Array(7).fill('PROG'));
    const scene: RsbScene = {
      camera: r.camera!,
      materials: r.materials,
      meshes: r.meshes,
      instances: r.instances,
      lights: r.lights,
      environment: r.environment!,
      floor: r.floor!,
      render: r.render!,
      bitmaps: r.bitmaps,
      textures: true,
      images: r.images!,
      programs: r.programs!,
    };
    const bytes = writeRsb(scene);
    expect(bytes.length).toBe(FIXTURE.length);
    expect(firstDiff(bytes, FIXTURE)).toBe(-1);
  });

  it('runs the engine’s programs to the engine’s values (the cross test the other way round)', () => {
    const r = readRsb(FIXTURE);
    const pts = contractPoints(200);
    const got = r.programs!.map(({ bytes }) => {
      const d = decodeProgram(bytes);
      const program: Program = { ...d.program, images: d.images.map((im) => ({ image: im.index === 0xffffffff ? null : { id: `imgs:${im.index}`, name: '', width: 1, height: 1 }, srgb: im.srgb, wrap: im.wrap as 0 | 1 | 2 })), probes: [], uses: { coords: [], fresnel: false, curvature: false, bump: false } };
      const pixels = d.images.map((im) => (im.index === 0xffffffff ? null : rgbaOf(r.images![im.index])));
      return outputsHash(new ProgramRunner(program, pixels), pts);
    });
    expect(got).toEqual(pinnedProgramValues());
  });
});

const live = RT_WASM ? describe : describe.skip;

live('the real rt.wasm runs the programs', () => {
  it('says so, and renders the engine’s scene of programs through the page’s code to rt-core’s pinned image', async () => {
    const rt = await loadRt();
    const features = (rt as unknown as { rt_features?: () => number }).rt_features;
    expect(readsPrograms(features!())).toBe(true);
    const { image } = renderWithPasses(rt, FIXTURE, 160, 120, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_M3B_PROGRAMS_4SPP'));
  });

  it('renders a project’s node material: with its program the image is another than with its mean', async () => {
    const rt = await loadRt();
    const { state } = nodeProject('CHECKS');
    const view = { width: 48, height: 36, maxSamples: 2, maxSeconds: 0, textures: true };
    const on = renderWithPasses(rt, writeRsb(projectScene(state, { ...view, programs: true }).scene), 48, 36, 2, 0);
    const off = renderWithPasses(rt, writeRsb(projectScene(state, view).scene), 48, 36, 2, 0);
    expect(fnv1a(resolveRgb(on.image, 2))).not.toBe(fnv1a(resolveRgb(off.image, 2)));
  });
});

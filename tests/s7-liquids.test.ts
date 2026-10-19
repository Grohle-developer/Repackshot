// Phase S7 on the page: liquids. The presets (stable keys, both languages, the same numbers as the engine's contact
// sheet, engine/crates/rt-cli/src/liquid_sheet.rs), Convert to liquid and the Liquid section through the store (one
// undo step each), the LIQ1 scene the simulator is given, the record of a run (the liquid track: the cache) and the
// surface each frame shows, the PHYSICS clip of a liquid part saved and opened, the priorities the render gets (NEST,
// only for an engine with bit 14, and a scene without a liquid written as before), the physics bar pouring the liquid,
// the Liquid section's word on an older engine. With the real rt.wasm: the pour of the native tests
// (tests/fixtures/liquid-pour.json) to the same hashes, particles and triangles, the page's surface of a record the
// worker's, the page's own LIQ1 filled by the engine, and the engine reading the page's NEST.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate, playheadPose } from '../src/core/animation';
import {
  autoSpacing,
  convertible,
  frameLength,
  isLiquidTrack,
  liquidClip,
  liquidKey,
  liquidRecord,
  liquidRunSpec,
  liquidSpacing,
  LiquidTrackWriter,
  liquidVolume,
  meshVolume,
  posedLiquidMesh,
  presetOf,
  putLiquidMesh,
  readRecordHeader,
  renderedPriority,
  setLiquidSurfacer,
  surfaceMesh,
  type LiquidTrack,
} from '../src/core/liquid';
import { getMesh, registerMesh, type MeshData } from '../src/core/meshes';
import { instanceFromPreset } from '../src/core/materials';
import { liquidPreset as presetFor } from '../src/data/liquids';
import { physicsSpec, type PhysicsResult, type PhysicsRunHandle, type PhysicsStarted, type PhysicsUpdate } from '../src/core/physics';
import { wetPartsSpec } from '../src/core/wet-parts';
import { allParts, type ModelPayload, type NodeId, type SceneNode } from '../src/core/scene';
import { createStore, type ProjectState } from '../src/core/store';
import { CONTAINER_PRIORITY, DEFAULT_LIQUID, LIQUID_PRESETS, LIQUID_PRIORITY, LIQUID_SPACING_LIMITS, MAX_LIQUID_SECONDS } from '../src/data/liquids';
import { loadProject, serializeProject } from '../src/io/project';
import { projectScene, writeRsb } from '../src/io/rsb';
import { readsNested } from '../src/render/engine';
import { hasLiquidExports, LiquidSim, liquidSurface } from '../src/render/phys-wasm';
import * as phys from '../src/ui/physics';
import type { AppServices, PhysicsPort } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { STRINGS } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { apply, exampleState } from './helpers';
import { sections } from './rsb-reader';
import { RT_WASM } from './wasm-engine';

const SHEET = 'engine/crates/rt-cli/src/liquid_sheet.rs';
const POUR = JSON.parse(readFileSync('tests/fixtures/liquid-pour.json', 'utf8')) as { steps: number[]; hashes: string[]; particles: number; triangles: number; scene: string };

// ---------------------------------------------------------------------------
// A glass and what goes in it
// ---------------------------------------------------------------------------

/** A closed box between `lo` and `hi`, its faces outward (24 vertices: flat normals). */
function boxMesh(lo: [number, number, number], hi: [number, number, number]): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // Each face: its normal axis and sign; the corners counter-clockwise seen from outside.
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      const base = positions.length / 3;
      const c = sign < 0 ? lo[axis] : hi[axis];
      const corners: [number, number][] = sign > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
      for (const [a, b] of corners) {
        const p = [0, 0, 0];
        p[axis] = c;
        p[u] = a ? hi[u] : lo[u];
        p[v] = b ? hi[v] : lo[v];
        positions.push(...p);
        const n = [0, 0, 0];
        n[axis] = sign;
        normals.push(...n);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

/** Meshes as one. */
function merged(...parts: MeshData[]): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const m of parts) {
    const base = positions.length / 3;
    positions.push(...m.positions);
    normals.push(...m.normals);
    for (const i of m.indices) indices.push(base + i);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

/** A square glass 40 mm wide inside, walls 3 mm, bottom 3 mm, 50 mm tall, on the floor. */
function glassMesh(): MeshData {
  const w = 20;
  const t = 3;
  const h = 50;
  return merged(
    boxMesh([-w - t, -w - t, 0], [w + t, w + t, t]),
    boxMesh([-w - t, -w - t, t], [-w, w + t, h]),
    boxMesh([w, -w - t, t], [w + t, w + t, h]),
    boxMesh([-w, -w - t, t], [w, -w, h]),
    boxMesh([-w, w, t], [w, w + t, h]),
  );
}

/** A model with a glass (clear glass) and a block of 30 × 30 × 20 mm in it, 10 mm above its bottom. */
function glassState(): ProjectState {
  const glass = registerMesh('s7test:glass', glassMesh());
  const block = registerMesh('s7test:block', boxMesh([-15, -15, 13], [15, 15, 33]));
  const node = (id: string, mesh: typeof glass, material: string): SceneNode => ({
    id,
    name: id,
    kind: 'PART',
    parent: 'model',
    children: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    mesh,
    material,
    smooth: false,
  });
  const payload: ModelPayload = {
    nodes: {
      model: { id: 'model', name: 'model', kind: 'MODEL', parent: null, children: ['glass', 'block'], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false },
      glass: node('glass', glass, 'm_glass'),
      block: node('block', block, 'm_block'),
    },
    roots: ['model'],
    materials: { m_glass: instanceFromPreset('m_glass', 'GLASS_CLEAR', 50)!, m_block: instanceFromPreset('m_block', 'ABS_GLOSS', 50)! },
  };
  return apply(exampleState(), { type: 'scene/addModel', payload, replace: true });
}

/** The glass with its block converted to `preset`, and the liquid part's id. */
function poured(preset = DEFAULT_LIQUID): { state: ProjectState; liquid: NodeId; source: NodeId } {
  const s = glassState();
  const source = Object.values(s.scene.nodes).find((n) => n.name === 'block')!.id;
  const state = apply(s, { type: 'liquid/convert', source, preset });
  const liquid = state.selection.ids[0];
  return { state, liquid, source };
}

// ---------------------------------------------------------------------------
// Records and surfaces as the engine writes them
// ---------------------------------------------------------------------------

/** A frame record (rt_phys::liquid `frame_bytes`) of `n` particles, their 16-bit coordinates from `seed`. */
function frameRecord(n: number, spacing: number, seed = 1): Uint8Array {
  const out = new Uint8Array(frameLength(n));
  const v = new DataView(out.buffer);
  out.set([76, 81, 70, 49]);
  v.setUint32(4, n, true);
  v.setFloat32(8, spacing, true);
  [-10, -10, 0, 10, 10, 20].forEach((x, i) => v.setFloat32(12 + 4 * i, x, true));
  for (let i = 0; i < 3 * n; i++) v.setUint16(36 + 2 * i, (seed * 7919 + i * 104729) & 0xffff, true);
  return out;
}

/** The bytes of a surface (rt_phys::liquid `SurfaceMesh::to_bytes`). */
function surfaceBytes(m: MeshData): Uint8Array {
  const nv = m.positions.length / 3;
  const ni = m.indices.length;
  const out = new Uint8Array(8 + 24 * nv + 4 * ni);
  const v = new DataView(out.buffer);
  v.setUint32(0, nv, true);
  v.setUint32(4, ni, true);
  m.positions.forEach((x, i) => v.setFloat32(8 + 4 * i, x, true));
  m.normals.forEach((x, i) => v.setFloat32(8 + 12 * nv + 4 * i, x, true));
  m.indices.forEach((x, i) => v.setUint32(8 + 24 * nv + 4 * i, x, true));
  return out;
}

/** A track of `frames` records of `n` particles. */
function track(node: NodeId, frames: number, n = 10, key = 'liq1:00000001'): LiquidTrack {
  const w = new LiquidTrackWriter(24, key, node);
  for (let k = 0; k < frames; k++) w.push(frameRecord(n, 2, k + 1));
  return w.track();
}

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ---------------------------------------------------------------------------

describe('S7: the presets', () => {
  it('keep their keys (added, never renamed), each in both languages, water the default', () => {
    const keys = LIQUID_PRESETS.map((p) => p.key);
    for (const k of ['WATER', 'OIL', 'HONEY', 'MILK', 'GEL', 'SYRUP']) expect(keys).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_LIQUID).toBe('WATER');
    for (const p of LIQUID_PRESETS) {
      expect(p.label.en.length, p.key).toBeGreaterThan(0);
      expect(p.label.es.length, p.key).toBeGreaterThan(0);
      expect(p.density, p.key).toBeGreaterThan(500);
      expect(p.viscosity, p.key).toBeGreaterThan(0);
      // A look of their own, or the catalogue's recipe: always of the GLASS family, so the liquid refracts.
      expect(!!p.material !== !!p.look, p.key).toBe(true);
      if (p.material) expect(instanceFromPreset('x', p.material, 100)?.family, p.key).toBe('GLASS');
    }
    // Thick reads thick: honey and gel well above water, syrup between.
    const v = (k: string) => presetFor(k)!.viscosity;
    expect(v('HONEY')).toBeGreaterThanOrEqual(1000 * v('WATER'));
    expect(v('GEL')).toBeGreaterThan(v('SYRUP'));
    expect(v('SYRUP')).toBeGreaterThan(v('OIL'));
  });

  it('the contact sheet repeats them: the same keys in the same order, the same motion and the same look', () => {
    const src = readFileSync(SHEET, 'utf8');
    const num = String.raw`-?\d+(?:\.\d+)?`;
    const rgb = String.raw`\[(?:(${num}); 3|(${num}), (${num}), (${num}))\]`;
    const re = new RegExp(String.raw`p\(\s*"(\w+)",\s*"[^"]*",\s*moves\((${num}), (${num}), (${num}), (${num}), (${num})\),\s*look\(\s*${rgb},\s*(${num}),\s*(${num}),\s*(${num}),\s*(${num}),\s*${rgb},\s*(${num}),?\s*\),?\s*\)`, 'g');
    const color = (m: RegExpExecArray, at: number) => (m[at] !== undefined ? [m[at], m[at], m[at]] : [m[at + 1], m[at + 2], m[at + 3]]).map(Number);
    const rows = [...src.matchAll(re)].map((m) => ({
      key: m[1],
      moves: [2, 3, 4, 5, 6].map((i) => Number(m[i])),
      base: color(m, 7),
      roughness: Number(m[11]),
      ior: Number(m[12]),
      absorption: Number(m[13]),
      scatter: Number(m[14]),
      albedo: color(m, 15),
      g: Number(m[19]),
    }));
    expect(rows.map((r) => r.key)).toEqual(LIQUID_PRESETS.map((p) => p.key));
    for (const r of rows) {
      const p = presetFor(r.key)!;
      expect(r.moves, r.key).toEqual([p.density, p.viscosity, p.cohesion, p.surfaceTension, p.adhesion]);
      const look = p.look ?? (instanceFromPreset('x', p.material!, 100)!.params as unknown as NonNullable<typeof p.look>);
      expect(r.base, r.key).toEqual(look.baseColor.slice(0, 3));
      expect([r.roughness, r.ior, r.absorption], r.key).toEqual([look.roughness, look.ior, look.absorptionMm]);
      expect(r.scatter, r.key).toBe(look.scatterMm ?? 0);
      expect(r.albedo, r.key).toEqual((look.scatterColor ?? [1, 1, 1, 1]).slice(0, 3));
      expect(r.g, r.key).toBe(look.scatterG ?? 0);
    }
  });
});

describe('S7: Convert to liquid and the Liquid section', () => {
  it('Convert to liquid is one undo step: the part hidden, a Liquid part born with its shape, the preset and its look', () => {
    const s = glassState();
    const store = createStore(s);
    const source = Object.values(s.scene.nodes).find((n) => n.name === 'block')!.id;
    expect(convertible(s, [source])).toEqual([source]);
    store.dispatch({ type: 'liquid/convert', source, preset: 'HONEY', label: 'convert' });
    const after = store.get();
    expect(store.history().undo).toHaveLength(1);
    const id = after.selection.ids[0];
    const liquid = after.scene.nodes[id];
    expect(liquid.kind).toBe('PART');
    expect(liquid.parent).toBeNull();
    expect(after.scene.roots).toContain(id);
    expect(liquid.physics).toEqual({ role: 'LIQUID' });
    expect(liquid.liquid).toEqual({ preset: 'HONEY', source });
    expect(liquid.name).toBe('block (Honey)');
    expect(after.scene.nodes[source].visible).toBe(false);
    // Its shape in the world (the source's), its own mesh: 30 × 30 × 20 mm.
    expect(liquid.mesh!.id).not.toBe(after.scene.nodes[source].mesh!.id);
    expect(liquidVolume(after, id)).toBeCloseTo(18000, 3);
    // Its own material, the preset's look, of the GLASS family.
    const mat = after.materials[liquid.material!];
    expect(mat.family).toBe('GLASS');
    expect(mat.params.ior).toBe(presetFor('HONEY')!.look!.ior);
    expect(mat.params.baseColor).toEqual(presetFor('HONEY')!.look!.baseColor);
    // A liquid is not converted again, nor a hidden part.
    expect(convertible(after, [id, source])).toEqual([]);
    store.undo();
    expect(store.get().scene.nodes[id]).toBeUndefined();
    expect(store.get().scene.nodes[source].visible).toBe(true);
    store.redo();
    expect(store.get().scene.nodes[id].liquid).toEqual({ preset: 'HONEY', source });
  });

  it('a catalogue liquid wears the catalogue’s recipe; an unknown preset converts nothing', () => {
    const { state, liquid } = poured('MILK');
    const mat = state.materials[state.scene.nodes[liquid].material!];
    expect(mat.params.scatterMm).toBe(instanceFromPreset('x', 'MILK', 100)!.params.scatterMm);
    const s = glassState();
    const source = Object.values(s.scene.nodes).find((n) => n.name === 'block')!.id;
    expect(apply(s, { type: 'liquid/convert', source, preset: 'LAVA' })).toBe(s);
  });

  it('the Liquid section: a preset brings its motion and its look, the spacing is its own (within limits) or from the volume', () => {
    const { state, liquid } = poured();
    const store = createStore(state);
    store.dispatch({ type: 'liquid/set', ids: [liquid], preset: 'SYRUP', label: 'preset' });
    let s = store.get();
    expect(presetOf(s.scene.nodes[liquid]).key).toBe('SYRUP');
    expect(s.materials[s.scene.nodes[liquid].material!].params.baseColor).toEqual(presetFor('SYRUP')!.look!.baseColor);
    // Automatic: about the target count of particles in its 18 ml.
    expect(liquidSpacing(s, liquid)).toBe(autoSpacing(18000));
    expect(autoSpacing(18000)).toBeCloseTo(Math.cbrt(18000 / 4000), 2);
    store.dispatch({ type: 'liquid/set', ids: [liquid], spacingMm: 2.5, label: 'spacing' });
    expect(liquidSpacing(store.get(), liquid)).toBe(2.5);
    store.dispatch({ type: 'liquid/set', ids: [liquid], spacingMm: 1e6, label: 'spacing' });
    expect(store.get().scene.nodes[liquid].liquid!.spacingMm).toBe(LIQUID_SPACING_LIMITS.max);
    expect(liquidSpacing(store.get(), liquid)).toBe(LIQUID_SPACING_LIMITS.max);
    store.dispatch({ type: 'liquid/set', ids: [liquid], spacingMm: null, label: 'spacing' });
    s = store.get();
    expect(s.scene.nodes[liquid].liquid!.spacingMm).toBeUndefined();
    expect(store.history().undo).toHaveLength(4);
    store.undo();
    store.undo();
    store.undo();
    store.undo();
    expect(presetOf(store.get().scene.nodes[liquid]).key).toBe('WATER');
    // Nothing changed is no step.
    store.dispatch({ type: 'liquid/set', ids: [liquid], preset: 'WATER', label: 'same' });
    expect(store.history().undo).toHaveLength(0);
  });

  it('the strings of S7 exist in English and in Spanish', () => {
    const keys = Object.keys(STRINGS.en).filter((k) => k.startsWith('liquid.') || k === 'ops.toLiquid' || k === 'section.liquid' || k.startsWith('param.priority') || k === 'phys.roleTip.LIQUID' || k.startsWith('phys.liquid'));
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) {
      expect(STRINGS.es[k as keyof typeof STRINGS.es], k).toBeTruthy();
      expect(STRINGS.es[k as keyof typeof STRINGS.es], k).not.toBe(STRINGS.en[k as keyof typeof STRINGS.en]);
    }
  });
});

describe('S7: the scene the simulator is given (LIQ1)', () => {
  it('the liquid by its mesh, spacing and motion; every other visible part as a container; the floor; nothing without a liquid', () => {
    expect(liquidRunSpec(glassState())).toBeNull();
    const { state, liquid } = poured('HONEY');
    const run = liquidRunSpec(state)!;
    expect(run.nodes).toEqual([liquid]);
    expect(run.key).toBe(liquidKey(run.bytes));
    const v = new DataView(run.bytes.buffer, run.bytes.byteOffset);
    let at = 0;
    const u32 = () => ((at += 4), v.getUint32(at - 4, true));
    const f32 = () => ((at += 4), v.getFloat32(at - 4, true));
    expect(String.fromCharCode(...run.bytes.subarray(0, 4))).toBe('LIQ1');
    at = 4;
    expect(u32()).toBe(1);
    const meshes = u32();
    expect(meshes).toBe(2);
    const lens: number[] = [];
    for (let m = 0; m < meshes; m++) {
      const nv = u32();
      const ni = u32();
      lens.push(ni / 3);
      at += 12 * nv + 4 * ni;
    }
    // The glass (120 triangles: five boxes) is the one static; the hidden block is none.
    expect(u32()).toBe(1);
    const glassMeshIndex = u32();
    expect(lens[glassMeshIndex]).toBe(60);
    at += 48;
    expect(u32()).toBe(1);
    expect(f32()).toBe(0);
    expect(u32()).toBe(1);
    const liquidMesh = u32();
    expect(lens[liquidMesh]).toBe(12);
    at += 48;
    expect(f32()).toBeCloseTo(liquidSpacing(state, liquid), 5);
    const p = presetFor('HONEY')!;
    expect([f32(), f32(), f32(), f32(), f32()].map((x) => Math.fround(x))).toEqual([p.density, p.viscosity, p.cohesion, p.surfaceTension, p.adhesion].map(Math.fround));
    expect(at).toBe(run.bytes.length);
    // A part that moves in the run is no container; a liquid that moves is not poured.
    const glass = Object.values(state.scene.nodes).find((n) => n.name === 'glass')!.id;
    const moving = liquidRunSpec(state, new Set([glass]))!;
    expect(new DataView(moving.bytes.buffer).getUint32(8, true)).toBe(1);
    expect(liquidRunSpec(state, new Set([liquid]))).toBeNull();
    // Another preset is another run (another key).
    expect(liquidRunSpec(apply(state, { type: 'liquid/set', ids: [liquid], preset: 'WATER' }))!.key).not.toBe(run.key);
  });

  it('the volume of a closed mesh by the divergence theorem, and a mirrored part’s shape stays outward', () => {
    expect(meshVolume(boxMesh([0, 0, 0], [10, 20, 30]))).toBeCloseTo(6000, 6);
    const s = glassState();
    const block = Object.values(s.scene.nodes).find((n) => n.name === 'block')!;
    const mirrored = apply(s, { type: 'scene/setTransform', id: block.id, transform: { scale: [-1, 1, 1] } });
    const after = apply(mirrored, { type: 'liquid/convert', source: block.id, preset: 'WATER' });
    const id = after.selection.ids[0];
    expect(meshVolume(getMesh(after.scene.nodes[id].mesh!.id)!)).toBeCloseTo(18000, 3);
    // The shape where the part stands in the world (its mesh is its own: the part may move afterwards).
    const raised = apply(s, { type: 'scene/setTransform', id: block.id, transform: { position: [0, 0, 7] } });
    const moved = apply(raised, { type: 'liquid/convert', source: block.id, preset: 'WATER' });
    const z = getMesh(moved.scene.nodes[moved.selection.ids[0]].mesh!.id)!.positions.filter((_, i) => i % 3 === 2);
    expect([Math.min(...z), Math.max(...z)]).toEqual([20, 40]);
  });
});

describe('S7: the record of a run (the cache) and the surface of a frame', () => {
  it('a track grows a frame at a time, gives back every record, and a damaged one is no track', () => {
    const t = track('n1', 3, 7);
    expect(t.frames).toBe(3);
    expect(t.particles).toBe(7);
    expect(t.record).toBe(frameLength(7));
    expect(frameLength(7) % 12).toBe(0);
    expect(isLiquidTrack(t)).toBe(true);
    for (let k = 0; k < 3; k++) expect(Array.from(liquidRecord(t, k)!)).toEqual(Array.from(frameRecord(7, 2, k + 1)));
    expect(liquidRecord(t, 3)).toBeNull();
    expect(readRecordHeader(frameRecord(7, 2.5))).toEqual({ particles: 7, spacing: 2.5 });
    expect(isLiquidTrack({ ...t, data: t.data.slice(0, -4) })).toBe(false);
    expect(isLiquidTrack({ ...t, data: t.data + 'AAAA' })).toBe(false);
    expect(isLiquidTrack({ ...t, record: t.record + 12 })).toBe(false);
    expect(isLiquidTrack({ ...t, data: 'A'.repeat(t.data.length) })).toBe(false);
    const w = new LiquidTrackWriter(24, 'k', 'n1');
    w.push(frameRecord(7, 2));
    expect(() => w.push(frameRecord(12, 2))).toThrow(/another length/);
    expect(() => w.push(new Uint8Array(48))).toThrow(/not a frame record/);
  });

  it('the pose says the frame a liquid shows; the frame’s surface is its mesh in the render, its own mesh without one', () => {
    const { state: s, liquid } = poured();
    const t = track(liquid, 3, 10, 'liq1:000000aa');
    const state = { ...s, animation: { ...s.animation, clips: [liquidClip('c1', liquid, 0, t)] } };
    expect(evaluate(state, 0).liquids).toEqual({ [liquid]: { clip: 'c1', frame: 0 } });
    expect(evaluate(state, 1 / 24).liquids).toEqual({ [liquid]: { clip: 'c1', frame: 1 } });
    expect(evaluate(state, 10).liquids).toEqual({ [liquid]: { clip: 'c1', frame: 2 } });
    const pose = playheadPose(state)!;
    expect(Object.keys(pose.nodes)).toEqual([]);
    // No surface in hand and no module to rebuild it: the part shows its own mesh.
    setLiquidSurfacer(null);
    expect(posedLiquidMesh(state, pose, liquid)).toBeNull();
    // The worker's surface of frame 0, in hand.
    const tet = boxMesh([-1, -1, 0], [1, 1, 2]);
    const back = surfaceMesh(surfaceBytes(tet))!;
    expect(Array.from(back.indices)).toEqual(Array.from(tet.indices));
    expect(surfaceMesh(surfaceBytes(tet).subarray(0, 20))).toBeNull();
    const id = putLiquidMesh(state, t, 0, back);
    expect(posedLiquidMesh(state, pose, liquid)).toBe(id);
    // Frame 2 is rebuilt from its record by the page's module.
    const seen: Uint8Array[] = [];
    setLiquidSurfacer((record) => (seen.push(record), merged(boxMesh([0, 0, 0], [3, 3, 3]), boxMesh([4, 0, 0], [6, 3, 3]))));
    const later = apply(state, { type: 'anim/playhead', t: 10 });
    const posed = posedLiquidMesh(later, playheadPose(later), liquid)!;
    expect(seen).toHaveLength(1);
    expect(Array.from(seen[0])).toEqual(Array.from(liquidRecord(t, 2)!));
    expect(getMesh(posed)!.indices.length).toBe(72);
    // The render draws the frame's surface as the liquid part's mesh (its own has 36 indices).
    const view = { width: 64, height: 48, maxSamples: 4, maxSeconds: 0, transparent: false };
    const { scene, ids } = projectScene(later, view);
    const inst = ids.instances.findIndex((x) => x.node === liquid);
    expect(inst).toBeGreaterThanOrEqual(0);
    expect(scene.meshes[scene.instances![inst].mesh].indices.length).toBe(72);
    setLiquidSurfacer(null);
  });

  it('saved and opened with the project; a damaged track is left out, a spacing brought within limits, a lost source none', async () => {
    const { state: s, liquid, source } = poured('OIL');
    const t = track(liquid, 4, 9);
    const state = { ...s, animation: { ...s.animation, clips: [liquidClip('c1', liquid, 0, t)] } };
    const text = await serializeProject(state).text();
    const back = loadProject(text).state;
    expect(back.scene.nodes[liquid].liquid).toEqual({ preset: 'OIL', source });
    expect(back.scene.nodes[liquid].physics).toEqual({ role: 'LIQUID' });
    expect(getMesh(back.scene.nodes[liquid].mesh!.id)!.indices.length).toBe(36);
    expect(back.animation.clips).toHaveLength(1);
    expect(back.animation.clips[0].liquid).toEqual(t);
    const edit = (f: (raw: { scene: { nodes: Record<string, SceneNode & { liquid: Record<string, unknown> }> }; animation: { clips: { liquid: LiquidTrack }[] } }) => void) => {
      const raw = JSON.parse(text);
      f(raw.state ?? raw);
      return loadProject(JSON.stringify(raw)).state;
    };
    expect(edit((r) => (r.animation.clips[0].liquid.data = r.animation.clips[0].liquid.data.slice(8))).animation.clips).toHaveLength(0);
    expect(edit((r) => (r.scene.nodes[liquid].liquid.spacingMm = 400)).scene.nodes[liquid].liquid!.spacingMm).toBe(LIQUID_SPACING_LIMITS.max);
    expect(edit((r) => (r.scene.nodes[liquid].liquid.source = 'gone')).scene.nodes[liquid].liquid!.source).toBeNull();
    // A role LIQUID on a part that is not one is dropped (the part is then as if it had no role).
    expect(edit((r) => delete (r.scene.nodes[liquid] as Partial<SceneNode>).liquid).scene.nodes[liquid].physics).toBeUndefined();
  });
});

describe('S7: the priorities the render gets (nested dielectrics)', () => {
  const view = { width: 64, height: 48, maxSamples: 4, maxSeconds: 0, transparent: false };

  it('with a liquid, the liquid at 1 and the clear glass at 2, the rest 0; only for an engine with bit 14', () => {
    const { state, liquid } = poured();
    const glass = Object.values(state.scene.nodes).find((n) => n.name === 'glass')!;
    expect(renderedPriority(state, state.scene.nodes[liquid].material!)).toBe(LIQUID_PRIORITY);
    expect(renderedPriority(state, glass.material!)).toBe(CONTAINER_PRIORITY);
    expect(CONTAINER_PRIORITY).toBeGreaterThan(LIQUID_PRIORITY);
    expect(projectScene(state, view).scene.priorities).toBeUndefined();
    const { scene, ids } = projectScene(state, { ...view, nested: true });
    expect(scene.priorities).toHaveLength(scene.materials.length);
    const of = (node: NodeId) => scene.priorities![scene.instances![ids.instances.findIndex((x) => x.node === node)].materialId];
    expect(of(liquid)).toBe(1);
    expect(of(glass.id)).toBe(2);
    // NEST as the engine reads it: u32 count, then the priority of each material in MATL order.
    const nest = sections(writeRsb(scene)).filter((x) => x.tag === 'NEST');
    expect(nest).toHaveLength(1);
    const p = nest[0].payload;
    expect(p.getUint32(0, true)).toBe(scene.materials.length);
    expect(Array.from({ length: scene.materials.length }, (_, i) => p.getUint32(4 + 4 * i, true))).toEqual(scene.priorities);
    expect(readsNested(16384)).toBe(true);
    expect(readsNested(16383)).toBe(false);
  });

  it('a scene without a liquid and without priorities of its own is written as before, byte for byte', () => {
    const s = glassState();
    const plain = writeRsb(projectScene(s, view).scene);
    expect(Array.from(writeRsb(projectScene(s, { ...view, nested: true }).scene))).toEqual(Array.from(plain));
    expect(sections(plain).some((x) => x.tag === 'NEST')).toBe(false);
    // A priority of its own is written, liquid or not.
    const glass = Object.values(s.scene.nodes).find((n) => n.name === 'glass')!;
    const own = apply(s, { type: 'material/setParam', id: glass.material!, key: 'priority', value: 5 });
    expect(renderedPriority(own, glass.material!)).toBe(5);
    expect(projectScene(own, { ...view, nested: true }).scene.priorities).toContain(5);
  });
});

describe('S7: the physics bar pours the liquid', () => {
  function app(preset = 'WATER') {
    const { state, liquid } = poured(preset);
    const store = createStore(state);
    const ui = createUiStore();
    let onUpdate: ((u: PhysicsUpdate) => void) | null = null;
    let resolveDone: ((r: PhysicsResult) => void) | null = null;
    const runs: { bodies: number; liquid: Uint8Array | null; maxSeconds: number }[] = [];
    const surface = surfaceBytes(boxMesh([-1, -1, 0], [1, 1, 1]));
    const physics: PhysicsPort = {
      run(spec, options, update, _wet, _parts, liq): PhysicsRunHandle {
        runs.push({ bodies: spec.bodies.length, liquid: liq ?? null, maxSeconds: options.maxSeconds });
        onUpdate = update;
        const started: PhysicsStarted = { ids: new Uint32Array(0), initial: new Float32Array(0), bodies: 0, liquid: { records: [frameRecord(12, 2, 0)], surfaces: [surface] } };
        return {
          started: Promise.resolve(started),
          done: new Promise<PhysicsResult>((r) => (resolveDone = r)),
          pause() {},
          resume() {},
          stop() {
            resolveDone?.({ steps: 30, awake: 0, bodies: 0, settled: false, frames: [], liquid: [], poses: new Float32Array(0), reason: 'STOPPED' });
          },
        };
      },
    };
    const ctx = { store, ui, services: { physics } as unknown as AppServices } as Ctx;
    let k = 1;
    const emit = (n: number) => {
      const frames = Array.from({ length: n }, () => new Float32Array(0));
      const liquidFrames = Array.from({ length: n }, () => ({ records: [frameRecord(12, 2, k++)], surfaces: [surface] }));
      onUpdate?.({ steps: k * 10, awake: 0, bodies: 0, settled: false, frames, liquid: liquidFrames });
    };
    return { ctx, store, ui, runs, emit, liquid };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('Start pours it for its own time into a clip of the liquid part, each frame its record; Reset takes it away; one undo step', async () => {
    const { ctx, store, ui, runs, emit, liquid } = app();
    phys.start(ctx);
    await tick();
    expect(runs).toHaveLength(1);
    expect(runs[0].bodies).toBe(0);
    expect(String.fromCharCode(...runs[0].liquid!.subarray(0, 4))).toBe('LIQ1');
    expect(Array.from(runs[0].liquid!)).toEqual(Array.from(liquidRunSpec(store.get())!.bytes));
    expect(runs[0].maxSeconds).toBe(MAX_LIQUID_SECONDS);
    const clip = () => store.get().animation.clips.find((c) => c.move === 'PHYSICS' && c.liquid)!;
    expect(clip().target).toEqual({ kind: 'NODE', id: liquid });
    expect(clip().liquid!.key).toBe(liquidKey(runs[0].liquid!));
    emit(3);
    expect(clip().liquid!.frames).toBe(4);
    expect(Array.from(liquidRecord(clip().liquid!, 3)!)).toEqual(Array.from(frameRecord(12, 2, 3)));
    expect(ui.get().physics.liquid).toEqual({ particles: 12, liquids: 1 });
    // The frame the worker surfaced is in hand for the pose.
    const at = apply(store.get(), { type: 'anim/playhead', t: clip().start + 3 / 24 });
    expect(posedLiquidMesh(at, playheadPose(at), liquid)).toBe(`liquid:${clip().liquid!.key}:${liquid}:3`);
    phys.stop(ctx);
    await tick();
    expect(ui.get().physics).toMatchObject({ state: 'STOPPED', ended: 'STOPPED', canReset: true });
    expect(store.history().undo).toHaveLength(1);
    phys.reset(ctx);
    expect(store.get().animation.clips.some((c) => c.liquid)).toBe(false);
    store.undo();
    expect(clip().liquid!.frames).toBe(4);
  });

  it('a liquid is no solid the bodies meet, it is not dropped as a body, and Drop pours nothing', async () => {
    const { ctx, store, runs, liquid } = app();
    const glass = allParts(store.get()).find((p) => store.get().scene.nodes[p].name === 'glass')!;
    // The glass falls past the liquid, not onto it.
    const spec = physicsSpec(store.get(), [glass])!;
    expect(spec.statics.some((x) => x.piece.part === liquid)).toBe(false);
    // Dropping the liquid itself drops nothing, and it stays a liquid.
    expect(physicsSpec(store.get(), [liquid])).toBeNull();
    phys.drop(ctx, [liquid]);
    await tick();
    expect(runs).toHaveLength(0);
    expect(store.get().scene.nodes[liquid].physics?.role).toBe('LIQUID');
    phys.drop(ctx, [glass, liquid]);
    await tick();
    expect(runs).toHaveLength(1);
    expect(runs[0].liquid).toBeNull();
    expect(store.get().scene.nodes[liquid].physics?.role).toBe('LIQUID');
    expect(store.get().scene.nodes[glass].physics?.role).toBe('DYNAMIC');
  });

  it('a liquid part keeps its role, and LIQUID is no role for a solid one', () => {
    const { state, liquid } = poured();
    const glass = Object.values(state.scene.nodes).find((n) => n.name === 'glass')!.id;
    const s = apply(state, { type: 'physics/set', ids: [liquid, glass], patch: { role: 'DYNAMIC', friction: 0.3 } });
    expect(s.scene.nodes[liquid].physics).toEqual({ role: 'LIQUID', friction: 0.3 });
    expect(s.scene.nodes[glass].physics).toEqual({ role: 'DYNAMIC', friction: 0.3 });
    expect(apply(state, { type: 'physics/set', ids: [glass], patch: { role: 'LIQUID' } })).toBe(state);
  });

  it('the rain on the parts leaves the liquid out (its surface is rebuilt every frame)', () => {
    const { state, liquid } = poured();
    let s = apply(state, { type: 'effect/add', preset: 'RAIN' });
    s = apply(s, { type: 'effect/set', id: s.effects[s.effects.length - 1].id, patch: { wetParts: true } });
    const spec = wetPartsSpec(s)!;
    expect(spec.parts.length).toBeGreaterThan(0);
    expect(spec.parts.some((p) => p.node === liquid)).toBe(false);
  });
});

describe('S7: the Liquid section on an older engine', () => {
  it('says the liquid meets its glass as against air when the engine lacks bit 14, and main.ts hands the bit on', () => {
    expect(STRINGS.en['liquid.oldEngine']).toMatch(/against air/);
    expect(STRINGS.es['liquid.oldEngine']).toMatch(/aire/);
    const panel = readFileSync('src/ui/panels/insp-liquid.ts', 'utf8');
    expect(panel).toMatch(/'data-liquid': 'old-engine'/);
    expect(panel).toMatch(/engineInfo\?\.nested === false/);
    expect(panel).toMatch(/u\.engineInfo\?\.nested\] as const/);
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main.match(/nested: readsNested\([a-z]\.features\)/g)).toHaveLength(2);
    // The render writes NEST only for an engine that reads it, in both backends.
    for (const f of ['src/render/pathtracer.ts', 'src/render/native.ts']) expect(readFileSync(f, 'utf8').match(/readsNested\(this\.\w+\.features\) \? \{ nested: true \}/g), f).toHaveLength(2);
  });
});

describe('S7: through the real engine', () => {
  it.skipIf(!RT_WASM)('the native tests’ pour gives their hashes, particles and surface, twice the same; the page’s surface of a record is the worker’s', async () => {
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    expect(hasLiquidExports(rt)).toBe(true);
    if (!hasLiquidExports(rt)) return;
    const spec = bytesOf(POUR.scene);
    const run = () => {
      const sim = new LiquidSim(rt, spec);
      const hashes: string[] = [];
      for (const target of POUR.steps) {
        sim.step(target - sim.steps);
        hashes.push(`0x${sim.hash.toString(16).padStart(8, '0')}`);
      }
      const out = { hashes, particles: sim.count(0), frame: sim.frame(0), surface: sim.surface(0) };
      sim.free();
      return out;
    };
    const a = run();
    expect(a.hashes).toEqual(POUR.hashes);
    expect(a.particles).toBe(POUR.particles);
    expect(readRecordHeader(a.frame)!.particles).toBe(POUR.particles);
    const mesh = surfaceMesh(a.surface)!;
    expect(mesh.indices.length / 3).toBe(POUR.triangles);
    expect(Array.from(liquidSurface(rt, a.frame)!)).toEqual(Array.from(a.surface));
    const b = run();
    expect(b.hashes).toEqual(a.hashes);
    expect(Array.from(b.frame)).toEqual(Array.from(a.frame));
    expect(() => new LiquidSim(rt, new Uint8Array([1, 2, 3]))).toThrow(/LIQ1/);
  }, 120_000);

  it.skipIf(!RT_WASM)('the page’s LIQ1 is what the engine reads: the block filled with about the particles its volume says, held by the glass', async () => {
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    if (!hasLiquidExports(rt)) throw new Error('rt.wasm without liquids');
    const { state, liquid } = poured();
    const s = apply(state, { type: 'liquid/set', ids: [liquid], spacingMm: 2.5 });
    const sim = new LiquidSim(rt, liquidRunSpec(s)!.bytes);
    expect(sim.liquids).toBe(1);
    const n = sim.count(0);
    expect(Math.abs(n / (18000 / 2.5 ** 3) - 1)).toBeLessThan(0.1);
    sim.step(48);
    const head = readRecordHeader(sim.frame(0))!;
    expect(head.particles).toBe(n);
    // The record's bounds stay inside the glass (inner 40 × 40 above its bottom at 3 mm), give or take a spacing.
    const v = new DataView(sim.frame(0).buffer);
    const lo = [12, 16, 20].map((o) => v.getFloat32(o, true));
    const hi = [24, 28, 32].map((o) => v.getFloat32(o, true));
    expect(lo[0]).toBeGreaterThan(-20 - 2.5);
    expect(hi[0]).toBeLessThan(20 + 2.5);
    expect(lo[2]).toBeGreaterThan(3 - 2.5);
    expect(surfaceMesh(sim.surface(0))!.indices.length).toBeGreaterThan(0);
    sim.free();
  }, 120_000);

  it.skipIf(!RT_WASM)('the engine reads the page’s NEST: the liquid in its glass renders otherwise with the priorities', async () => {
    const { loadRt, renderWithPasses, fnv1a, resolveRgb } = await import('./wasm-engine');
    const rt = await loadRt();
    const { state } = poured();
    const view = { width: 32, height: 24, maxSamples: 2, maxSeconds: 0, transparent: false };
    const plain = writeRsb(projectScene(state, view).scene);
    const nested = writeRsb(projectScene(state, { ...view, nested: true }).scene);
    const hash = (rsb: Uint8Array) => fnv1a(resolveRgb(renderWithPasses(rt, rsb, 32, 24, 2, 0).image, 2));
    expect(hash(nested)).not.toBe(hash(plain));
    expect(hash(nested)).toBe(hash(nested));
  }, 240_000);
});

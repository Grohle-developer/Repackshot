// Phase S3c on the page: rain, dust and snow on the parts. The data (the wettability families and the family of a
// material, what each effect leaves on the parts, the engine's parity values), what the simulation is given (core/
// wet-parts.ts `wetPartsSpec`: the parts that do not move, the set's pieces as a film, each effect switched on for it),
// the WPT1 bytes as the engine reads them (tests/fixtures/s3c-parts.wpt1, `rt --write-s3c-parts-spec`), the record of a
// run (the parts track: the cache) rebuilt frame by frame, the PHYSICS clip of the scene (the pose's frame, saved and
// opened, a damaged one left out), the WETP sections the render gets for an engine with bit 8, the physics bar wetting
// the parts. With the real rt.wasm: the parts against the native pin, the weather of the last frame against the
// sections of the native parity scene (tests/fixtures/s3c-wet.rsb), and that scene's image.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate, playheadPose } from '../src/core/animation';
import { normalizeEffects } from '../src/core/effects';
import type { MeshData } from '../src/core/meshes';
import { partsClip, type PhysicsResult, type PhysicsRunHandle, type PhysicsStarted, type PhysicsUpdate } from '../src/core/physics';
import { allParts, effectiveVisible, isSetPiece } from '../src/core/scene';
import { createStore, type ProjectState } from '../src/core/store';
import {
  dustByte,
  isPartsTrack,
  NEVER,
  parseLayout,
  partsFeedingEffects,
  partsFrame,
  partsFrameIndex,
  PartsTrackWriter,
  partWeather,
  snowByte,
  wetPartsKey,
  wetPartsSpec,
  wptBytes,
  type PartsTrackPart,
  type WetPartsSpec,
} from '../src/core/wet-parts';
import { PARTS_FEED, PARTS_MAX_SAMPLES, MAX_PARTS_SECONDS } from '../src/data/wet-parts';
import { DUST_REPOSE_DEG, SNOW_REPOSE_DEG, wettability, WETTABILITY, wettabilityFamilyOf } from '../src/data/wettability';
import { loadProject, serializeProject } from '../src/io/project';
import { projectScene, writeRsb } from '../src/io/rsb';
import { readsWetParts } from '../src/render/engine';
import { hasPartsExports, PartsSim } from '../src/render/phys-wasm';
import * as phys from '../src/ui/physics';
import type { AppServices, PhysicsPort } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { STRINGS } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { apply, exampleState } from './helpers';
import { sections } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const PARTS_TESTS = 'engine/crates/rt-phys/tests/wet_parts.rs';
const EXAMPLE = 'engine/crates/rt-phys/src/example.rs';
const spec1 = new Uint8Array(readFileSync('tests/fixtures/s3c-parts.wpt1'));
const wetRsb = new Uint8Array(readFileSync('tests/fixtures/s3c-wet.rsb'));

/** The example with `preset` falling on the parts. */
function wetScene(preset: 'RAIN' | 'SNOW' | 'DUST_CLOUD' = 'RAIN'): ProjectState {
  const s = apply(exampleState(), { type: 'effect/add', preset });
  const e = s.effects[s.effects.length - 1];
  return apply(s, { type: 'effect/set', id: e.id, patch: { wetParts: true } });
}

/** Little-endian words as bytes. */
function bytesOf(words: number[]): Uint8Array {
  const out = new Uint8Array(4 * words.length);
  const v = new DataView(out.buffer);
  words.forEach((w, i) => v.setUint32(4 * i, w >>> 0, true));
  return out;
}
const bits = (v: number) => new Uint32Array(new Float32Array([v]).buffer)[0];

/** A frame record as the engine writes it (rt_phys::wet_parts `WetParts::frame`). */
function record(changed: [number, number, number, number, number, number, number][], gone: number[], wet: number[], wiped: number[], drips: number, drops: number): Uint8Array {
  const words: number[] = [changed.length];
  for (const [id, part, tri, x, y, z, a] of changed) words.push(id, part, tri, bits(x), bits(y), bits(z), bits(a));
  words.push(gone.length, ...gone, wet.length, ...wet, wiped.length, ...wiped, drips, drops);
  return bytesOf(words);
}

/** A layout of one part of `res` triangles, with dust rates `dust` (or none). */
function layout(res: number[], dust: number[] | null = null, snow: number[] | null = null): Uint8Array {
  const samples = res.reduce((n, r) => n + ((r + 1) * (r + 2)) / 2, 0);
  const words: number[] = [1, bits(1), res.length, samples, (dust ? 1 : 0) | (snow ? 2 : 0), bits(70)];
  const head = bytesOf(words);
  const resBytes = new Uint8Array(Math.ceil(res.length / 4) * 4);
  resBytes.set(res);
  const rates = bytesOf([...(dust ?? []).map(bits), ...(snow ?? []).map(bits)]);
  const out = new Uint8Array(head.length + resBytes.length + rates.length);
  out.set(head, 0);
  out.set(resBytes, head.length);
  out.set(rates, head.length + resBytes.length);
  return out;
}

/** Reads a WPT1 spec back into the page's shape, with a registry of its meshes (to write it again). */
function readSpec(bytes: Uint8Array): { spec: WetPartsSpec; meshes: Map<string, MeshData> } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 4;
  const u = () => {
    const x = v.getUint32(at, true);
    at += 4;
    return x;
  };
  const f = () => {
    const x = v.getFloat32(at, true);
    at += 4;
    return x;
  };
  u();
  const seed = u();
  const cellMm = f();
  const maxSamples = u();
  const reposeDeg = f();
  const snowReposeDeg = f();
  const meshes = new Map<string, MeshData>();
  const nm = u();
  for (let m = 0; m < nm; m++) {
    const nv = u();
    const ni = u();
    const positions = new Float32Array(3 * nv);
    for (let i = 0; i < 3 * nv; i++) positions[i] = f();
    const indices = new Uint32Array(ni);
    for (let i = 0; i < ni; i++) indices[i] = u();
    meshes.set(`m${m}`, { positions, normals: new Float32Array(3 * nv), indices });
  }
  const parts: WetPartsSpec['parts'] = [];
  const np = u();
  for (let p = 0; p < np; p++) {
    const mesh = `m${u()}`;
    const r = Array.from({ length: 12 }, f);
    const matrix = [r[0], r[4], r[8], 0, r[1], r[5], r[9], 0, r[2], r[6], r[10], 0, r[3], r[7], r[11], 1];
    const advancingDeg = f();
    const recedingDeg = f();
    const soakMmPerS = f();
    const film = u() === 1;
    parts.push({ node: `n${p}`, mesh, matrix, family: 'GLASS', advancingDeg, recedingDeg, soakMmPerS, porosity: 0, film });
  }
  const sources: WetPartsSpec['sources'] = [];
  const ns = u();
  for (let s = 0; s < ns; s++) {
    const k = u();
    sources.push({ kind: k === 0 ? 'DROPS' : k === 1 ? 'DUST' : 'SNOW', density: f(), velocity: [f(), f(), f()], sizeMm: f(), sizeVar: f(), effect: '' });
  }
  return { spec: { seed, cellMm, maxSamples, reposeDeg, snowReposeDeg, parts, sources }, meshes };
}

describe('S3c: the data', () => {
  it('the wettability table keeps its families and adds wood and fabric; plastic, metal, paper and snow are the engine’s parity values', () => {
    expect(WETTABILITY.map((w) => w.key)).toEqual(['GLASS', 'PLASTIC', 'METAL', 'PAPER', 'PAINT', 'WOOD', 'FABRIC']);
    for (const w of WETTABILITY) {
      expect(w.recedingDeg).toBeLessThanOrEqual(w.advancingDeg);
      expect(w.porosity).toBeGreaterThanOrEqual(0);
      expect(w.porosity).toBeLessThanOrEqual(1);
      expect(w.soakMmPerS).toBeGreaterThanOrEqual(0);
    }
    const rust = readFileSync(EXAMPLE, 'utf8');
    const value = (name: string) => Number(new RegExp(`pub const ${name}: f32 = ([0-9.]+);`).exec(rust)![1]);
    for (const k of ['PLASTIC', 'METAL', 'PAPER', 'PAINT'] as const) {
      const w = wettability(k);
      expect([w.advancingDeg, w.recedingDeg]).toEqual([value(`${k}_ADVANCING_DEG`), value(`${k}_RECEDING_DEG`)]);
    }
    expect(wettability('PAPER').porosity).toBe(value('PAPER_POROSITY'));
    expect(SNOW_REPOSE_DEG).toBe(value('SNOW_REPOSE_DEG'));
    expect(DUST_REPOSE_DEG).toBe(value('DUST_REPOSE_DEG'));
  });

  it('a material wets as the family of its category, or of its recipe', () => {
    const m = (category: string, family = 'SIMPLE', metallic = 0) => ({ category, family, params: { metallic } });
    expect(wettabilityFamilyOf(m('METAL'))).toBe('METAL');
    expect(wettabilityFamilyOf(m('PLASTIC', 'GLASS'))).toBe('PLASTIC');
    expect(wettabilityFamilyOf(m('GLASS'))).toBe('GLASS');
    expect(wettabilityFamilyOf(m('EMISSIVE', 'EMISSIVE'))).toBe('GLASS');
    expect(wettabilityFamilyOf(m('WOOD', 'WOOD'))).toBe('WOOD');
    expect(wettabilityFamilyOf(m('FABRIC', 'FABRIC'))).toBe('FABRIC');
    expect(wettabilityFamilyOf(m('OTHER', 'GLASS'))).toBe('GLASS');
    expect(wettabilityFamilyOf(m('OTHER', 'FABRIC'))).toBe('FABRIC');
    expect(wettabilityFamilyOf(m('OTHER', 'SIMPLE', 1))).toBe('METAL');
    expect(wettabilityFamilyOf(m('OTHER'))).toBe('PAINT');
    expect(wettabilityFamilyOf(null)).toBe('PAINT');
  });

  it('rain and drops of water wet the parts, dust, pollen, ash and the dust cloud dust them, snow piles; bubbles and confetti leave nothing', () => {
    const of = (k: string) => Object.entries(PARTS_FEED).filter(([, v]) => v === k).map(([e]) => e).sort();
    expect(of('DROPS')).toEqual(['RAIN', 'WATER_DROPS']);
    expect(of('DUST')).toEqual(['ASH', 'DUST_CLOUD', 'DUST_MOTES', 'POLLEN']);
    expect(of('SNOW')).toEqual(['SNOW']);
    expect(PARTS_FEED.BUBBLES).toBeNull();
    expect(PARTS_FEED.CONFETTI).toBeNull();
    expect(MAX_PARTS_SECONDS).toBeGreaterThan(30);
    expect(readsWetParts(511)).toBe(true);
    expect(readsWetParts(255)).toBe(false);
    for (const k of ['ambient.wetParts', 'ambient.wetPartsTip.DROPS', 'ambient.wetPartsTip.DUST', 'ambient.wetPartsTip.SNOW', 'phys.parts', 'phys.partsTip', 'status.partsWeather', 'say.PHYSICS_PARTS', 'say.parts'] as const) {
      expect(STRINGS.en[k]).toBeTruthy();
      expect(STRINGS.es[k]).toBeTruthy();
    }
  });
});

describe('S3c: what the simulation is given', () => {
  it('only an effect switched on for the parts falls on them, and it is saved with the project', () => {
    const plain = apply(exampleState(), { type: 'effect/add', preset: 'RAIN' });
    expect(plain.effects[0].wetParts).toBeUndefined();
    expect(partsFeedingEffects(plain)).toEqual([]);
    expect(wetPartsSpec(plain)).toBeNull();
    const s = wetScene();
    expect(partsFeedingEffects(s).map((e) => e.id)).toEqual([s.effects[0].id]);
    // A file keeps it; one that says something else than true does not have it.
    expect(normalizeEffects(JSON.parse(JSON.stringify(s.effects)), s)[0].wetParts).toBe(true);
    expect(normalizeEffects([{ ...s.effects[0], wetParts: 'yes' }], s)[0].wetParts).toBeUndefined();
    // Bubbles fall on nothing, whatever the switch.
    const b = apply(exampleState(), { type: 'effect/add', preset: 'BUBBLES' });
    const bubbles = apply(b, { type: 'effect/set', id: b.effects[0].id, patch: { wetParts: true } });
    expect(partsFeedingEffects(bubbles)).toEqual([]);
  });

  it('every visible part that does not move, where it stands, with its family; each effect’s density, velocity and size', () => {
    const s = wetScene();
    const spec = wetPartsSpec(s)!;
    const parts = allParts(s).filter((id) => s.scene.nodes[id].mesh && effectiveVisible(s, id));
    expect(spec.parts.map((p) => p.node)).toEqual(parts);
    for (const p of spec.parts) {
      const node = s.scene.nodes[p.node];
      const fam = wettabilityFamilyOf(node.material ? s.materials[node.material] : undefined);
      expect(p.family).toBe(fam);
      expect([p.advancingDeg, p.recedingDeg, p.porosity]).toEqual([wettability(fam).advancingDeg, wettability(fam).recedingDeg, wettability(fam).porosity]);
      expect(p.film).toBe(false);
    }
    const rain = s.effects[0];
    expect(spec.sources).toHaveLength(1);
    expect(spec.sources[0].kind).toBe('DROPS');
    expect(spec.sources[0].velocity[2]).toBeCloseTo((rain.wind[2] - rain.fallSpeed * rain.gravity) * 1000, 3);
    expect(spec.sources[0].velocity[0]).toBeCloseTo(rain.wind[0] * 1000, 3);
    expect(spec.maxSamples).toBe(PARTS_MAX_SAMPLES);
    expect(spec.seed).toBe(rain.seed >>> 0);
    // The parts the run moves stay out; with nothing left, nothing to wet.
    expect(wetPartsSpec(s, new Set([parts[0]]))!.parts.map((p) => p.node)).toEqual(parts.slice(1));
    expect(wetPartsSpec(s, new Set(parts))).toBeNull();
  });

  it('a set’s pieces wet as a film', () => {
    const s = apply(wetScene(), { type: 'studio/setPreset', key: 'PERFUME' }, { type: 'studio/build' });
    const spec = wetPartsSpec(s)!;
    const pieces = spec.parts.filter((p) => isSetPiece(s.scene.nodes[p.node]));
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((p) => p.film)).toBe(true);
    expect(spec.parts.filter((p) => !p.film).length).toBeGreaterThan(0);
  });

  it('writes the WPT1 bytes the engine reads, byte for byte (the parity parts’ spec)', () => {
    const { spec, meshes } = readSpec(spec1);
    expect(String.fromCharCode(...spec1.subarray(0, 4))).toBe('WPT1');
    expect(Array.from(wptBytes(spec, (id) => meshes.get(id)))).toEqual(Array.from(spec1));
    expect(wetPartsKey(wptBytes(spec, (id) => meshes.get(id)))).toBe(wetPartsKey(spec1));
    expect(wetPartsKey(wptBytes({ ...spec, seed: spec.seed + 1 }, (id) => meshes.get(id)))).not.toBe(wetPartsKey(spec1));
    // A part whose mesh is not in the registry is left out.
    const fewer = wptBytes(spec, (id) => (id === 'm1' ? undefined : meshes.get(id)));
    expect(new DataView(fewer.buffer).getUint32(28, true)).toBe(3);
  });
});

describe('S3c: the record of a run (the cache)', () => {
  const meta: PartsTrackPart[] = [{ node: 'p1', mesh: 'mesh1', triangles: 2, samples: 6, capAngleDeg: 70, porosity: 0.5 }];

  it('rebuilds every frame: the drops by number with what they were, the samples wet and the dust since the last wipe', () => {
    const w = new PartsTrackWriter(24, 'wpt1:00000000', meta, layout([1, 1], [0, 0, 0, 1, 2, 3], [0, 0, 0, 0, 0, 0.01]));
    w.push(record([], [], [], [], 0, 0));
    w.push(record([[0, 0, 1, 1, 2, 3, 0.5], [1, 0, 0, 4, 5, 6, 0.7]], [], [3, 4], [], 0, 2));
    w.push(record([[1, 0, 0, 4, 4, 6, 0.8]], [0], [5], [4, 5], 1, 1));
    const t = w.track();
    expect(isPartsTrack(t)).toBe(true);
    expect([t.frames, w.lastDrops, w.totalDrips]).toEqual([3, 1, 1]);
    const at = (k: number) => partsFrame(t, k)!;
    expect(at(0).parts[0].drops).toEqual([]);
    expect(at(0).drops).toBe(0);
    expect(at(1).parts[0].drops).toEqual([
      { triangle: 1, position: [1, 2, 3], radius: 0.5 },
      { triangle: 0, position: [4, 5, 6], radius: Math.fround(0.7) },
    ]);
    expect(at(2).parts[0].drops).toEqual([{ triangle: 0, position: [4, 4, 6], radius: Math.fround(0.8) }]);
    expect([at(2).drops, at(2).drips]).toEqual([1, 1]);
    // Wet from the frame it got wet in.
    const wet = (k: number) => Array.from({ length: 6 }, (_, s) => at(k).parts[0].values[3 * s]);
    expect(wet(0)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(wet(1)).toEqual([0, 0, 0, 255, 255, 0]);
    expect(wet(2)).toEqual([0, 0, 0, 255, 255, 255]);
    // The dust of a sample from its rate, since the start or since the rain last wiped it.
    const dust = (k: number, s: number) => at(k).parts[0].values[3 * s + 1];
    const t2 = 20 / 240;
    expect(dust(2, 3)).toBe(dustByte(1 - Math.exp(-1 * t2)));
    expect(dust(2, 4)).toBe(0); // wiped at frame 2
    expect(dust(1, 4)).toBe(dustByte(1 - Math.exp(-2 * (10 / 240))));
    expect(dust(1, 4)).toBeGreaterThan(0);
    // The snow from its rate: 0.01 mm/s for 1/12 s, in steps of 0.02 mm.
    expect(at(2).parts[0].values[3 * 5 + 2]).toBe(snowByte(0.01 * t2));
    // Past the last frame, the last one; the clip's phase picks the nearest frame.
    expect(at(9)).toBe(at(2));
    expect(partsFrameIndex(t, 0.74)).toBe(1);
    // A record that does not follow, or names what is not there, is refused.
    expect(() => w.push(record([], [], [], [], 0, 5))).toThrow();
    expect(() => w.push(record([[3, 1, 0, 0, 0, 0, 1]], [], [], [], 0, 2))).toThrow();
    expect(() => w.push(record([], [], [99], [], 0, 1))).toThrow();
    // A damaged track is not one.
    expect(isPartsTrack({ ...t, drops: t.drops.slice(0, -8) })).toBe(false);
    expect(isPartsTrack({ ...t, frames: 4 })).toBe(false);
    expect(isPartsTrack({ ...t, layout: t.layout.slice(0, -4) })).toBe(false);
    expect(isPartsTrack({ ...t, parts: [{ ...meta[0], triangles: 3 }] })).toBe(false);
    expect(NEVER).toBe(0xffffffff);
    expect(parseLayout(new Uint8Array(3))).toBeNull();
  });

  it('a face group’s instance takes its triangles’ samples in its order and the drops on them', () => {
    const w = new PartsTrackWriter(24, 'k', [{ ...meta[0], samples: 9 }], layout([1, 2]));
    w.push(record([[0, 0, 1, 1, 2, 3, 0.5], [1, 0, 0, 4, 5, 6, 0.7]], [], [0, 3, 4], [], 0, 2));
    const t = w.track();
    const fr = partsFrame(t, 0)!;
    const all = partWeather(t, fr, 0, null)!;
    expect(Array.from(all.resolution)).toEqual([1, 2]);
    expect(all.values.length).toBe(3 * 9);
    const second = partWeather(t, fr, 0, [1])!;
    expect(Array.from(second.resolution)).toEqual([2]);
    expect(Array.from(second.values)).toEqual(Array.from(all.values.subarray(9)));
    expect(second.drops).toEqual([{ triangle: 0, position: [1, 2, 3], radius: 0.5 }]);
  });
});

describe('S3c: the PHYSICS clip of the scene and the render', () => {
  function recorded(): { state: ProjectState; part: string } {
    const s = exampleState();
    const part = allParts(s).find((id) => s.scene.nodes[id].mesh)!;
    const node = s.scene.nodes[part];
    const mesh = node.mesh!;
    const tris = mesh.triangles;
    const res = Array.from({ length: tris }, () => 1);
    const w = new PartsTrackWriter(s.animation.fps, 'wpt1:00000001', [{ node: part, mesh: mesh.id, triangles: tris, samples: 3 * tris, capAngleDeg: 75, porosity: 0.5 }], layout(res));
    w.push(record([], [], [], [], 0, 0));
    w.push(record([[0, 0, 2, 1, 2, 3, 1.5]], [], [0, 1, 2], [], 0, 1));
    const clip = partsClip('c1', 0, w.track());
    const state = { ...s, animation: { ...s.animation, clips: [clip] } };
    return { state, part };
  }

  it('the pose says the frame the parts show, at 0 too, and the clip moves nothing', () => {
    const { state } = recorded();
    expect(evaluate(state, 0).parts).toEqual({ clip: 'c1', frame: 0 });
    expect(evaluate(state, 10).parts).toEqual({ clip: 'c1', frame: 1 });
    const pose = playheadPose(state)!;
    expect(pose.parts).toEqual({ clip: 'c1', frame: 0 });
    expect(Object.keys(pose.nodes)).toEqual([]);
  });

  it('the render gets a WETP section per instance of a recorded part, only for an engine with bit 8', () => {
    const { state, part } = recorded();
    const posed = apply(state, { type: 'anim/playhead', t: 10 });
    const view = { width: 64, height: 48, maxSamples: 4, maxSeconds: 0, transparent: false };
    const without = projectScene(posed, view);
    expect(without.scene.wetParts).toBeUndefined();
    const { scene, ids } = projectScene(posed, { ...view, wetParts: true });
    expect(scene.wetParts).toHaveLength(1);
    const wp = scene.wetParts![0];
    expect(ids.instances[wp.instance].node).toBe(part);
    expect(wp.capAngleDeg).toBe(75);
    expect(wp.porosity).toBe(0.5);
    expect(wp.drops).toEqual([{ triangle: 2, position: [1, 2, 3], radius: 1.5 }]);
    expect(Array.from(wp.values.subarray(0, 9))).toEqual([255, 0, 0, 255, 0, 0, 255, 0, 0]);
    // The section, byte for byte as the engine reads it.
    const wetp = sections(writeRsb(scene)).filter((x) => x.tag === 'WETP');
    expect(wetp).toHaveLength(1);
    const p = wetp[0].payload;
    expect([p.getUint32(0, true), p.getUint32(4, true), p.getUint32(8, true), p.getUint32(12, true)]).toEqual([wp.instance, wp.resolution.length, wp.values.length / 3, 1]);
    expect(p.getFloat32(16, true)).toBe(75);
    // At the frame of the dry parts there is nothing to write.
    expect(projectScene(apply(state, { type: 'anim/playhead', t: 0 }), { ...view, wetParts: true }).scene.wetParts).toBeUndefined();
  });

  it('saved and opened with the project; a damaged track is left out, not the project', async () => {
    const { state } = recorded();
    const text = await serializeProject(state).text();
    const back = loadProject(text).state;
    const clip = back.animation.clips.find((c) => c.parts)!;
    expect(clip.target).toEqual({ kind: 'SCENE' });
    expect(partsFrame(clip.parts!, 1)!.parts[0].drops).toHaveLength(1);
    const broken = JSON.parse(text);
    const at = broken.animation ? broken.animation : broken.state.animation;
    at.clips[0].parts.drops = 'AAAA';
    expect(loadProject(JSON.stringify(broken)).state.animation.clips).toHaveLength(0);
  });
});

describe('S3c: the physics bar wets the parts', () => {
  function app() {
    const store = createStore(wetScene());
    const ui = createUiStore();
    let onUpdate: ((u: PhysicsUpdate) => void) | null = null;
    let resolveDone: ((r: PhysicsResult) => void) | null = null;
    const runs: { bodies: number; parts: Uint8Array | null; maxSeconds: number }[] = [];
    let triangles: number[] = [];
    const physics: PhysicsPort = {
      run(spec, options, update, _wet, parts): PhysicsRunHandle {
        runs.push({ bodies: spec.bodies.length, parts: parts ?? null, maxSeconds: options.maxSeconds });
        onUpdate = update;
        // The layout the engine would give: every triangle at resolution 1.
        const sp = wetPartsSpec(store.get())!;
        triangles = sp.parts.map((p) => store.get().scene.nodes[p.node].mesh!.triangles);
        const words: number[] = [triangles.length, bits(1)];
        const chunks: Uint8Array[] = [bytesOf(words)];
        for (const n of triangles) {
          chunks.push(bytesOf([n, 3 * n, 0, bits(75)]));
          const r = new Uint8Array(Math.ceil(n / 4) * 4);
          r.fill(1, 0, n);
          chunks.push(r);
        }
        const lay = new Uint8Array(chunks.reduce((k, c) => k + c.length, 0));
        let at = 0;
        for (const c of chunks) {
          lay.set(c, at);
          at += c.length;
        }
        const started: PhysicsStarted = { ids: new Uint32Array(0), initial: new Float32Array(0), bodies: 0, parts: { layout: lay, frame: record([], [], [], [], 0, 0) } };
        return {
          started: Promise.resolve(started),
          done: new Promise<PhysicsResult>((r) => (resolveDone = r)),
          pause() {},
          resume() {},
          stop() {
            resolveDone?.({ steps: 30, awake: 0, bodies: 0, settled: false, frames: [], parts: [], poses: new Float32Array(0), reason: 'STOPPED' });
          },
        };
      },
    };
    const ctx = { store, ui, services: { physics } as unknown as AppServices } as Ctx;
    let id = 0;
    const emit = (n: number) => {
      const frames = Array.from({ length: n }, () => new Float32Array(0));
      const records = Array.from({ length: n }, () => record([[id, 0, 0, 0, 0, 0, 1]], id > 0 ? [id - 1] : [], [id++], [], 1, 1));
      onUpdate?.({ steps: id * 10, awake: 0, bodies: 0, settled: false, frames, parts: records });
    };
    return { ctx, store, ui, runs, emit };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('Start with no Dynamic part wets the parts alone, for its own time, into a clip of the scene; Reset takes it away', async () => {
    const { ctx, store, ui, runs, emit } = app();
    phys.start(ctx);
    await tick();
    expect(runs).toHaveLength(1);
    expect(runs[0].bodies).toBe(0);
    expect(String.fromCharCode(...runs[0].parts!.subarray(0, 4))).toBe('WPT1');
    expect(runs[0].maxSeconds).toBe(MAX_PARTS_SECONDS);
    const clip = () => store.get().animation.clips.find((c) => c.move === 'PHYSICS' && c.parts)!;
    expect(clip().target).toEqual({ kind: 'SCENE' });
    expect(clip().parts!.key).toBe(wetPartsKey(runs[0].parts!));
    emit(3);
    expect(clip().parts!.frames).toBe(4);
    expect(ui.get().physics.parts).toEqual({ drops: 1, drips: 3 });
    phys.stop(ctx);
    await tick();
    expect(ui.get().physics).toMatchObject({ state: 'STOPPED', ended: 'STOPPED', canReset: true });
    expect(store.history().undo).toHaveLength(1);
    phys.reset(ctx);
    expect(store.get().animation.clips.some((c) => c.parts)).toBe(false);
    store.undo();
    expect(clip().parts!.frames).toBe(4);
  });

  it('a Dynamic part moves in the run and is not wetted where it stood: the other parts are', async () => {
    const { ctx, store, runs } = app();
    const part = allParts(store.get())[0];
    store.dispatch({ type: 'physics/set', ids: [part], patch: { role: 'DYNAMIC' } });
    phys.start(ctx);
    await tick();
    expect(runs).toHaveLength(1);
    expect(runs[0].bodies).toBeGreaterThan(0);
    const still = wetPartsSpec(store.get(), new Set([part]))!;
    expect(still.parts.some((p) => p.node === part)).toBe(false);
    expect(still.parts.length).toBe(wetPartsSpec(store.get())!.parts.length - 1);
    expect(Array.from(runs[0].parts!)).toEqual(Array.from(wptBytes(still)));
    phys.stop(ctx);
    await tick();
  });

  it('Drop wets nothing; Start with the effect switched off for the parts has nothing to do', async () => {
    const { ctx, store, runs } = app();
    store.dispatch({ type: 'effect/set', id: store.get().effects[0].id, patch: { wetParts: false } });
    phys.start(ctx);
    await tick();
    expect(runs).toHaveLength(0);
    expect(ctx.ui.get().physics.ended).toBe('NOTHING');
    store.dispatch({ type: 'effect/set', id: store.get().effects[0].id, patch: { wetParts: true } });
    phys.drop(ctx, [allParts(store.get())[0]]);
    await tick();
    expect(runs[0]?.parts ?? null).toBeNull();
  });
});

describe('S3c: through the real engine', () => {
  it.skipIf(!RT_WASM)('the parity parts give the native pin, two runs record the same track, and its last frame is the native weather', async () => {
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    expect(hasPartsExports(rt)).toBe(true);
    if (!hasPartsExports(rt)) return;
    const run = () => {
      const sim = new PartsSim(rt, spec1);
      const lay = parseLayout(sim.layout())!;
      const parts: PartsTrackPart[] = lay.parts.map((p, k) => ({ node: `n${k}`, mesh: `m${k}`, triangles: p.triangles, samples: p.samples, capAngleDeg: p.capAngleDeg, porosity: k === 3 ? 1 : 0 }));
      const w = new PartsTrackWriter(24, wetPartsKey(spec1), parts, sim.layout());
      w.push(sim.frame());
      for (let k = 1; k <= 120; k++) {
        sim.step(10);
        w.push(sim.frame());
      }
      const out = { hash: sim.hash, steps: sim.steps, track: w.track() };
      sim.free();
      return out;
    };
    const a = run();
    const b = run();
    expect(a.steps).toBe(1200);
    expect(a.hash).toBe(pinned(PARTS_TESTS, 'PINNED_WET_PARTS'));
    expect(b.track).toEqual(a.track);
    // The last frame is what the native parity scene carries in its WETP sections: the same samples (the dust within a
    // step of its byte: the page counts a wipe from its frame, the engine from its step) and the same drops.
    const last = partsFrame(a.track, 120)!;
    const wetp = sections(wetRsb).filter((x) => x.tag === 'WETP');
    expect(wetp).toHaveLength(4);
    let differ = 0;
    wetp.forEach((sec, k) => {
      const p = sec.payload;
      const tris = p.getUint32(4, true);
      const samples = p.getUint32(8, true);
      const drops = p.getUint32(12, true);
      expect(p.getUint32(0, true)).toBe(k);
      const page = partWeather(a.track, last, k, null)!;
      expect(Array.from(page.resolution)).toEqual(Array.from(new Uint8Array(p.buffer, p.byteOffset + 24, tris)));
      const valAt = 24 + Math.ceil(tris / 4) * 4;
      const native = new Uint8Array(p.buffer, p.byteOffset + valAt, 3 * samples);
      for (let i = 0; i < 3 * samples; i++) {
        const d = Math.abs(native[i] - page.values[i]);
        expect(d, `part ${k} byte ${i}`).toBeLessThanOrEqual(i % 3 === 0 ? 0 : 1);
        if (d) differ++;
      }
      const dropAt = valAt + Math.ceil((3 * samples) / 4) * 4;
      expect(page.drops).toHaveLength(drops);
      page.drops.forEach((d, i) => {
        const o = dropAt + 20 * i;
        expect(d.triangle).toBe(p.getUint32(o, true));
        expect(d.position).toEqual([p.getFloat32(o + 4, true), p.getFloat32(o + 8, true), p.getFloat32(o + 12, true)]);
        expect(d.radius).toBe(p.getFloat32(o + 16, true));
      });
    });
    expect(differ).toBeLessThan(100);
    expect(() => new PartsSim(rt, new Uint8Array([1, 2, 3]))).toThrow(/WPT1/);
  }, 120_000);

  it.skipIf(!RT_WASM)('the parity scene of the wet parts renders to the native hash through the page code', async () => {
    const rt = await loadRt();
    const { image } = renderWithPasses(rt, wetRsb, 160, 120, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned(PARTS_TESTS, 'PINNED_S3C_WET_4SPP'));
  }, 240_000);
});

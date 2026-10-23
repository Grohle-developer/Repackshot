// Phase S3e on the page: the parts a run moves go into the spec with their body, the wind of the rain, the studio floor
// under the effects' region and the set's fine samples (version 2 of WPT1, core/wet-parts.ts `wptBytes`); the studio
// floor and the two-byte resolutions in the layout and the record (`PartsTrackWriter`, `partsFrame`); the WETG section,
// WTP2 and the motes tail only for an engine with bits 11, 12 and 13 (io/rsb.ts), a coarser WETP for one without bit 12;
// Fast's floor and motes (render/weather-preview.ts; `motesOn` the twin of the engine's placement); the notes of an engine
// without bit 11 or 13. With the real rt.wasm: the engine reads the page's version 2, steps a moving part with its body,
// and renders the page's WETG, WTP2 and motes tail.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { playheadPose } from '../src/core/animation';
import { effectRegion } from '../src/core/effects';
import { getMesh } from '../src/core/meshes';
import { partsClip, physicsSpec } from '../src/core/physics';
import { allParts } from '../src/core/scene';
import type { ProjectState } from '../src/core/store';
import {
  coarseWeather,
  isPartsTrack,
  MAX_FINE_RESOLUTION,
  motesOn,
  needsWpt2,
  NO_BODY,
  parseLayout,
  partsFrame,
  partsRenderNoFloor,
  partsRenderNoMotes,
  partsResolution,
  PartsTrackWriter,
  wetPartsKey,
  wetPartsSpec,
  wptBytes,
  type PartsTrackPart,
  type WetPartsSpec,
} from '../src/core/wet-parts';
import { FLOOR_CELL_MM, FLOOR_MAX_CELLS, FLOOR_POROSITY, PARTS_EDGE_BUDGET, PARTS_EDGE_CELL_MM } from '../src/data/wet-parts';
import { writePhysicsScene } from '../src/io/phys';
import { projectScene, writeRsb } from '../src/io/rsb';
import { readsWetFine, readsWetFloor, readsWetMotes } from '../src/render/engine';
import { hasPartsExports, hasPhysExports, PartsSim, PhysWorld } from '../src/render/phys-wasm';
import { WeatherPreview } from '../src/render/weather-preview';
import { STRINGS } from '../src/ui/strings';
import { apply, exampleState } from './helpers';
import { sections } from './rsb-reader';
import { fnv1a, loadRt, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

function bytesOf(words: number[]): Uint8Array {
  const out = new Uint8Array(4 * words.length);
  const v = new DataView(out.buffer);
  words.forEach((w, i) => v.setUint32(4 * i, w >>> 0, true));
  return out;
}
const bits = (v: number) => new Uint32Array(new Float32Array([v]).buffer)[0];
const f32 = (v: number) => new Float32Array([v])[0];
const samplesOf = (r: number) => ((r + 1) * (r + 2)) / 2;

/** A layout of one part of `res` (S3e: two bytes each past 255), with dust rates when `dust`, and the studio floor. */
function layout(res: number[], dust: number | null, floor: { nx: number; ny: number; dust: number; snow: number } | null): Uint8Array {
  const wide = res.some((r) => r > 255);
  const samples = res.reduce((n, r) => n + samplesOf(r), 0);
  const words: number[] = [1, bits(1), res.length, samples, (dust !== null ? 1 : 0) | (wide ? 4 : 0), bits(70)];
  const r = new Uint8Array(Math.ceil(((wide ? 2 : 1) * res.length) / 4) * 4);
  const rv = new DataView(r.buffer);
  res.forEach((x, i) => (wide ? rv.setUint16(2 * i, x, true) : rv.setUint8(i, x)));
  for (let i = 0; i < r.length; i += 4) words.push(rv.getUint32(i, true));
  if (dust !== null) for (let s = 0; s < samples; s++) words.push(bits(dust));
  if (floor) {
    words.push(floor.nx, floor.ny, bits(-40), bits(-20), bits(2), bits(0), 3);
    for (let c = 0; c < floor.nx * floor.ny; c++) words.push(bits(c % 2 === 0 ? floor.dust : 0));
    for (let c = 0; c < floor.nx * floor.ny; c++) words.push(bits(floor.snow));
  }
  return bytesOf(words);
}

/** A frame record with no drop, and S3e's floor block of `cells` (or none). */
function record(wet: number[], cells: number[] | null): Uint8Array {
  const words: number[] = [0, 0, wet.length, ...wet, 0, 0, 0, 0, 0];
  if (cells) words.push(cells.length, ...cells);
  return bytesOf(words);
}

const view = { width: 64, height: 48, maxSamples: 4, maxSeconds: 0, transparent: false, wetParts: true };

const meta = (triangles: number, samples: number): PartsTrackPart[] => [{ node: 'p0', mesh: 'm0', triangles, samples, capAngleDeg: 70, porosity: 0 }];

/** The example with rain on the parts (a wind of 2 m/s along X). */
function rainy(): ProjectState {
  const s = apply(exampleState(), { type: 'effect/add', preset: 'RAIN' });
  const id = s.effects[s.effects.length - 1].id;
  return apply(s, { type: 'effect/set', id, patch: { wetParts: true, wind: [2, 0.5, 0] } });
}

describe('S3e: what the simulation is given', () => {
  it('a part the run moves goes with its body; the wind of the rain, the studio floor under the effects’ region and the set’s fine samples; version 2 of WPT1, and version 1 without any of them', () => {
    const s = rainy();
    expect(s.studio.floor).toBe(true);
    const parts = allParts(s).filter((id) => s.scene.nodes[id].mesh);
    const spec = wetPartsSpec(s, new Map([[parts[0], 0]]))!;
    expect(spec.parts[0].body).toBe(0);
    expect(spec.parts[0].film).toBe(false);
    expect(spec.parts.slice(1).every((p) => p.body === undefined)).toBe(true);
    spec.wind!.forEach((x, i) => expect(x).toBeCloseTo([2000, 500, 0][i], 6));
    const r = effectRegion(s, s.effects[s.effects.length - 1]);
    expect(spec.floor).toEqual({ z: 0, min: [r.min[0], r.min[1]], max: [r.max[0], r.max[1]], cellMm: FLOOR_CELL_MM, maxCells: FLOOR_MAX_CELLS });
    expect([spec.edgeCellMm, spec.edgeBudget]).toEqual([PARTS_EDGE_CELL_MM, PARTS_EDGE_BUDGET]);
    // Without the studio floor, none.
    expect(wetPartsSpec(apply(s, { type: 'studio/set', patch: { floor: false } }))!.floor).toBeNull();
    // The bytes: version 2, each part's body after its flags, the extras after the sources.
    const bytes = wptBytes(spec);
    const v = new DataView(bytes.buffer);
    expect(needsWpt2(spec)).toBe(true);
    expect(v.getUint32(4, true)).toBe(2);
    let at = 28;
    const meshes = v.getUint32(at, true);
    at += 4;
    for (let m = 0; m < meshes; m++) at += 8 + 4 * (3 * v.getUint32(at, true) + v.getUint32(at + 4, true));
    const np = v.getUint32(at, true);
    expect(np).toBe(spec.parts.length);
    at += 4;
    for (let p = 0; p < np; p++) {
      expect(v.getUint32(at + 68, true)).toBe(p === 0 ? 0 : NO_BODY);
      at += 72;
    }
    at += 4 + 28 * v.getUint32(at, true);
    expect([v.getFloat32(at, true), v.getFloat32(at + 4, true), v.getFloat32(at + 8, true)]).toEqual(spec.wind!.map(f32));
    expect(v.getUint32(at + 12, true)).toBe(1);
    expect(v.getFloat32(at + 16 + 4 * 5, true)).toBe(FLOOR_CELL_MM);
    expect(v.getUint32(at + 16 + 4 * 6, true)).toBe(FLOOR_MAX_CELLS);
    expect(v.getFloat32(at + 16 + 28, true)).toBe(PARTS_EDGE_CELL_MM);
    expect(v.getUint32(at + 16 + 32, true)).toBe(PARTS_EDGE_BUDGET);
    expect(at + 16 + 36).toBe(bytes.length);
    // A spec of before: version 1, the S3c layout.
    const old: WetPartsSpec = { ...spec, parts: spec.parts.map(({ body: _b, ...p }) => p), wind: [0, 0, 0], floor: null, edgeCellMm: 0, edgeBudget: 0 };
    expect(needsWpt2(old)).toBe(false);
    const ob = wptBytes(old);
    expect(new DataView(ob.buffer).getUint32(4, true)).toBe(1);
    expect(ob.length).toBe(bytes.length - 4 * np - 4 * (3 + 1 + 7 + 2));
    // The key is the format of now.
    expect(wetPartsKey(bytes).startsWith('wpt5:')).toBe(true);
  });
});

describe('S3e: the studio floor and the fine samples in the record of a run', () => {
  it('the layout carries the floor; each cell is wet from the frame it got wet, dusty and snowy at its rates; a damaged record is refused', () => {
    const lay = layout([1], 0.5, { nx: 4, ny: 3, dust: 0.4, snow: 0.01 });
    const parsed = parseLayout(lay)!;
    expect(parsed.floor).toMatchObject({ nx: 4, ny: 3, x0: -40, y0: -20, cell: 2, z: 0 });
    const w = new PartsTrackWriter(24, 'wpt4:00000001', meta(1, 3), lay, { sizeMm: 0.3, sizeVar: 0.5, seed: 7 });
    w.push(record([], []));
    w.push(record([0], [5, 2]));
    w.push(record([], [11]));
    // A record without the floor's block, or with a cell that is not there, is refused.
    expect(() => w.push(record([], null))).toThrow(/floor/);
    expect(() => w.push(record([], [12]))).toThrow(/floor/);
    const t = w.track();
    expect(isPartsTrack(t)).toBe(true);
    expect(t.motes).toEqual({ sizeMm: 0.3, sizeVar: 0.5, seed: 7 });
    const at = (f: number) => partsFrame(t, f)!.floor!;
    expect(at(0).values.filter((_, i) => i % 3 === 0).every((x) => x === 0)).toBe(true);
    expect([at(1).values[3 * 2], at(1).values[3 * 5], at(1).values[3 * 11]]).toEqual([255, 255, 0]);
    expect(at(2).values[3 * 11]).toBe(255);
    // Dust 1 − e^(−k t) on the even cells, none on the odd; snow by its rate (0.01 mm/s, a byte a 0.02 mm).
    const secs = 2 / 24;
    expect(at(2).values[3 * 4 + 1]).toBe(Math.floor((1 - Math.exp(-0.4 * secs)) * 255 + 0.5));
    expect(at(2).values[3 * 5 + 1]).toBe(0);
    expect(at(2).values[3 * 7 + 2]).toBe(Math.min(255, Math.floor((0.01 * secs) / 0.02 + 0.5)));
    // The floor's events of a track without a floor in its layout: not a track.
    const plain = new PartsTrackWriter(24, 'k', meta(1, 3), layout([1], null, null));
    plain.push(record([], null));
    expect(isPartsTrack(plain.track())).toBe(true);
    expect(partsFrame(plain.track(), 0)!.floor).toBeUndefined();
    expect(isPartsTrack({ ...plain.track(), floor: t.floor })).toBe(false);
    expect(isPartsTrack({ ...t, motes: { sizeMm: 0, sizeVar: 0, seed: 1 } })).toBe(false);
  });

  it('a resolution past 255 takes two bytes in the layout; an engine without bit 12 gets it coarser, at 255 steps', () => {
    const lay = layout([300, 2], null, null);
    const parsed = parseLayout(lay)!;
    expect(Array.from(parsed.parts[0].resolution)).toEqual([300, 2]);
    expect(parsed.parts[0].samples).toBe(samplesOf(300) + samplesOf(2));
    expect(parseLayout(layout([MAX_FINE_RESOLUTION + 1], null, null))).toBeNull();
    const w = new PartsTrackWriter(24, 'k', meta(2, parsed.parts[0].samples), lay);
    w.push(record([], null));
    expect(Array.from(partsResolution(w.track(), 0)!)).toEqual([300, 2]);
    // Coarser: the fine triangle at 255 steps, each point its nearest fine sample; the other as it is.
    const values = new Uint8Array(3 * (samplesOf(300) + samplesOf(2)));
    for (let k = 0; k < values.length / 3; k++) values[3 * k] = k % 251;
    const c = coarseWeather({ resolution: new Uint16Array([300, 2]), values });
    expect(Array.from(c.resolution)).toEqual([255, 2]);
    expect(c.values.length).toBe(3 * (samplesOf(255) + samplesOf(2)));
    // The corners are the corners, and the small triangle keeps its bytes.
    expect(c.values[0]).toBe(values[0]);
    expect(c.values[3 * 255]).toBe(values[3 * 300]);
    expect(c.values[3 * (samplesOf(255) - 1)]).toBe(values[3 * (samplesOf(300) - 1)]);
    expect(Array.from(c.values.subarray(3 * samplesOf(255)))).toEqual(Array.from(values.subarray(3 * samplesOf(300))));
    const small = { resolution: new Uint16Array([3]), values: new Uint8Array(30) };
    expect(coarseWeather(small)).toBe(small);
  });
});

describe('S3e: the floor, the fine samples and the motes in the render and in Fast', () => {
  /** The example with a recorded run: its first part with a fine triangle of dust, a floor that is wet and dusty. */
  function recorded(): { state: ProjectState; part: string } {
    const s = exampleState();
    const part = allParts(s).filter((id) => s.scene.nodes[id].mesh)[0];
    const mesh = s.scene.nodes[part].mesh!;
    const res = Array.from({ length: mesh.triangles }, (_, t) => (t === 0 ? 300 : 2));
    const samples = res.reduce((n, r) => n + samplesOf(r), 0);
    const lay = layout(res, 30, { nx: 4, ny: 3, dust: 2, snow: 0 });
    const m: PartsTrackPart[] = [{ node: part, mesh: mesh.id, triangles: mesh.triangles, samples, capAngleDeg: 75, porosity: 0 }];
    const w = new PartsTrackWriter(s.animation.fps, 'wpt4:00000001', m, lay, { sizeMm: 0.4, sizeVar: 0.3, seed: 5 });
    w.push(record([], []));
    w.push(record([0, 1, 2], [0, 1, 2, 3]));
    const clip = partsClip('c1', 0, w.track());
    return { state: { ...s, animation: { ...s.animation, clips: [clip] } }, part };
  }
  it('WETG only for an engine with bit 11 and the floor on; WTP2 for one with bit 12, a WETP at 255 steps for one without; the motes tail for one with bit 13', () => {
    const posed = apply(recorded().state, { type: 'anim/playhead', t: 10 });
    const tags = (v: object) => sections(writeRsb(projectScene(posed, { ...view, ...v }).scene)).map((x) => x.tag);
    expect(tags({})).toContain('WETP');
    expect(tags({})).not.toContain('WETG');
    expect(tags({})).not.toContain('WTP2');
    expect(tags({ wetFloor: true })).toContain('WETG');
    expect(tags({ wetFloor: true, wetFine: true })).toContain('WTP2');
    const off = apply(posed, { type: 'studio/set', patch: { floor: false } });
    expect(sections(writeRsb(projectScene(off, { ...view, wetFloor: true }).scene)).map((x) => x.tag)).not.toContain('WETG');
    // WETG: the frame's cells, the floor's porosity.
    const g = sections(writeRsb(projectScene(posed, { ...view, wetFloor: true }).scene)).find((x) => x.tag === 'WETG')!.payload;
    expect([g.getUint32(0, true), g.getUint32(4, true), g.getFloat32(8, true), g.getFloat32(12, true), g.getFloat32(16, true), g.getFloat32(20, true)]).toEqual([4, 3, -40, -20, 2, 0]);
    expect(g.getFloat32(24, true)).toBe(f32(FLOOR_POROSITY));
    expect([g.getUint8(32), g.getUint8(35), g.getUint8(3 * 4 + 32)]).toEqual([255, 255, 0]);
    expect(g.byteLength).toBe(32 + 36);
    // WTP2: two bytes a resolution; a WETP coarser for an engine without bit 12.
    const fine = sections(writeRsb(projectScene(posed, { ...view, wetFine: true }).scene)).find((x) => x.tag === 'WTP2')!.payload;
    expect(fine.getUint16(24, true)).toBe(300);
    expect(fine.getUint16(26, true)).toBe(2);
    const coarse = sections(writeRsb(projectScene(posed, view).scene)).find((x) => x.tag === 'WETP')!.payload;
    expect(coarse.getUint8(24)).toBe(255);
    const tris = coarse.getUint32(4, true);
    expect(coarse.getUint32(8, true)).toBe(samplesOf(255) + (tris - 1) * samplesOf(2));
    // The motes tail: after the drops (and the shapes), "MOT1", the size, its variation and the seed.
    const motes = sections(writeRsb(projectScene(posed, { ...view, wetMotes: true }).scene)).find((x) => x.tag === 'WETP')!.payload;
    expect(motes.byteLength).toBe(coarse.byteLength + 16);
    const end = coarse.byteLength;
    expect(String.fromCharCode(motes.getUint8(end), motes.getUint8(end + 1), motes.getUint8(end + 2), motes.getUint8(end + 3))).toBe('MOT1');
    expect([motes.getFloat32(end + 4, true), motes.getFloat32(end + 8, true), motes.getUint32(end + 12, true)]).toEqual([f32(0.4), f32(0.3), 5]);
  });

  it('Fast draws the floor’s cells over the shadow-catching floor and the dust’s motes on the part, where the engine places them', () => {
    const { state, part } = recorded();
    const root = new THREE.Group();
    const weather = new WeatherPreview(root);
    const obj = new THREE.Object3D();
    const objects = new Map([[part, obj] as const]);
    const geometryOf = (id: string) => {
      const data = getMesh(state.scene.nodes[id].mesh!.id)!;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(data.positions), 3));
      g.setIndex(Array.from(data.indices));
      return g;
    };
    const at = (s: ProjectState, t: number) => {
      const posed = apply(s, { type: 'anim/playhead', t });
      weather.update(posed, playheadPose(posed), objects, geometryOf);
      return posed;
    };
    const posed = at(state, 10);
    expect(weather.floorDrawn()).toBe(12);
    const floor = root.children.find((c) => c.name === 'floor:weather')!;
    expect([floor.position.x, floor.position.y, floor.scale.x, floor.scale.y]).toEqual([-36, -17, 8, 6]);
    // The motes: as many as the engine's placement gives for the frame (the twin of rt_core::weather::motes_on).
    const frame = partsFrame(posed.animation.clips[0].parts!, 1)!;
    const data = getMesh(state.scene.nodes[part].mesh!.id)!;
    const corner = (i: number): [number, number, number] => [data.positions[3 * i], data.positions[3 * i + 1], data.positions[3 * i + 2]];
    const want = motesOn(partsResolution(posed.animation.clips[0].parts!, 0)!, frame.parts[0].values, (t) => [corner(data.indices[3 * t]), corner(data.indices[3 * t + 1]), corner(data.indices[3 * t + 2])], { sizeMm: 0.4, sizeVar: 0.3, seed: 5 });
    expect(want.length).toBeGreaterThan(10);
    expect(weather.motesDrawn(part)).toBe(want.length);
    // They follow the part where it stands.
    obj.position.set(30, 0, 0);
    at(state, 10);
    const motes = root.children.find((c) => c.name === `motes:${part}`)!;
    expect(motes.matrix.elements[12]).toBe(30);
    // Without the studio floor, no floor.
    at(apply(state, { type: 'studio/set', patch: { floor: false } }), 10);
    expect(weather.floorDrawn()).toBe(0);
    weather.dispose();
  });

  it('the motes’ placement is the engine’s: the same grains for the same samples (rt-core’s test, DUSTY_MOTES)', () => {
    // rt-core `weather_s3e_tests.rs` `dusty(230, 40)`: two triangles of a 100 mm plate, the rows of the first's grid below
    // its middle at 230, the rest of it at 50, the second clean; grains of 0.5 mm ± 40 %, seed 9.
    const r = 40;
    const n = samplesOf(r);
    const values = new Uint8Array(3 * 2 * n);
    let k = 0;
    for (let j = 0; j <= r; j++) for (let i = 0; i <= r - j; i++) values[3 * k++ + 1] = 2 * j < r ? 230 : 50;
    const p: [number, number, number][] = [
      [-50, -50, 0],
      [50, -50, 0],
      [50, 50, 0],
      [-50, 50, 0],
    ];
    const motes = motesOn([r, r], values, (t) => (t === 0 ? [p[0], p[1], p[2]] : [p[0], p[2], p[3]]), { sizeMm: 0.5, sizeVar: 0.4, seed: 9 });
    const engine = Number(/const DUSTY_MOTES: usize = (\d+);/.exec(readFileSync('engine/crates/rt-core/src/weather_s3e_tests.rs', 'utf8'))![1]);
    expect(motes.length).toBe(engine);
    expect(motes.every((m) => m.triangle === 0 && (m.position[1] + 50) / 100 < 20.5 / 40 + 1e-4)).toBe(true);
    expect(motesOn([r, r], values, () => [p[0], p[1], p[2]], { sizeMm: 0.5, sizeVar: 0.4, seed: 9 }, 10)).toHaveLength(10);
  });

  it('bits 11, 12 and 13 of the engine; the notes say an engine of before draws the floor dry and the dust without its grains', () => {
    expect([readsWetFloor(16383), readsWetFine(16383), readsWetMotes(16383)]).toEqual([true, true, true]);
    expect([readsWetFloor(2047), readsWetFine(2047), readsWetMotes(2047)]).toEqual([false, false, false]);
    const rain = rainy();
    expect(partsRenderNoFloor(rain, true, false)).toBe(true);
    expect(partsRenderNoFloor(rain, true, true)).toBe(false);
    expect(partsRenderNoFloor(rain, true, undefined)).toBe(false);
    expect(partsRenderNoFloor(rain, false, false)).toBe(false);
    expect(partsRenderNoFloor(apply(rain, { type: 'studio/set', patch: { floor: false } }), true, false)).toBe(false);
    expect(partsRenderNoMotes(rain, true, false)).toBe(false);
    const d = apply(exampleState(), { type: 'effect/add', preset: 'DUST_CLOUD' });
    const dust = apply(d, { type: 'effect/set', id: d.effects[d.effects.length - 1].id, patch: { wetParts: true } });
    expect(partsRenderNoMotes(dust, true, false)).toBe(true);
    expect(partsRenderNoMotes(dust, true, true)).toBe(false);
    expect(partsRenderNoMotes(dust, undefined, false)).toBe(false);
    for (const key of ['ambient.wetFloorOldEngine', 'ambient.wetMotesOldEngine'] as const) {
      expect(STRINGS.en[key]).toBeTruthy();
      expect(STRINGS.es[key]).toBeTruthy();
    }
  });
});

describe('S3e: through the real engine', () => {
  it.skipIf(!RT_WASM)('the engine reads the page’s version 2 and steps a moving part with its body; its records follow', async () => {
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    expect(hasPartsExports(rt) && hasPhysExports(rt)).toBe(true);
    if (!hasPartsExports(rt) || !hasPhysExports(rt)) return;
    const s0 = rainy();
    const part = allParts(s0).filter((id) => s0.scene.nodes[id].mesh)[0];
    const s = apply(s0, { type: 'physics/set', ids: [part], patch: { role: 'DYNAMIC' } });
    const bodies = physicsSpec(s)!;
    const moving = new Map<string, number>();
    bodies.bodies.forEach((b, i) => b.pieces.forEach((p) => moving.set(p.part, i)));
    expect(moving.has(part)).toBe(true);
    const spec = wetPartsSpec(s, moving)!;
    const world = new PhysWorld(rt, writePhysicsScene(bodies), bodies.bodies.length);
    const sim = new PartsSim(rt, wptBytes(spec));
    expect(sim.moving).toBe(1);
    const lay = parseLayout(sim.layout())!;
    expect(lay.floor).not.toBeNull();
    expect(lay.floor!.nx * lay.floor!.ny).toBeLessThanOrEqual(FLOOR_MAX_CELLS);
    const metaParts: PartsTrackPart[] = lay.parts.map((p, k) => ({ node: spec.parts[k].node, mesh: spec.parts[k].mesh, triangles: p.triangles, samples: p.samples, capAngleDeg: p.capAngleDeg, porosity: 0 }));
    const w = new PartsTrackWriter(24, wetPartsKey(wptBytes(spec)), metaParts, sim.layout());
    w.push(sim.frame());
    for (let k = 0; k < 24; k++) {
      sim.stepWith(world, 10);
      w.push(sim.frame());
    }
    expect(sim.steps).toBe(240);
    expect(world.steps).toBe(240);
    const t = w.track();
    expect(isPartsTrack(t)).toBe(true);
    expect(partsFrame(t, 24)!.floor).toBeDefined();
    sim.free();
    world.free();
  }, 120_000);

  it.skipIf(!RT_WASM)('the page’s WETG, WTP2 and motes tail read and render, and change the image', async () => {
    const loaded = await loadRt();
    const { state } = (() => {
      const s = exampleState();
      const part = allParts(s).filter((id) => s.scene.nodes[id].mesh)[0];
      const mesh = s.scene.nodes[part].mesh!;
      const res = Array.from({ length: mesh.triangles }, (_, t) => (t === 0 ? 300 : 2));
      const samples = res.reduce((n, r) => n + samplesOf(r), 0);
      const w = new PartsTrackWriter(s.animation.fps, 'wpt4:1', [{ node: part, mesh: mesh.id, triangles: mesh.triangles, samples, capAngleDeg: 75, porosity: 0 }], layout(res, 30, { nx: 4, ny: 3, dust: 2, snow: 0 }), { sizeMm: 0.4, sizeVar: 0.3, seed: 5 });
      w.push(record([], []));
      w.push(record([0, 1, 2], [0, 1, 2, 3]));
      return { state: { ...s, animation: { ...s.animation, clips: [partsClip('c1', 0, w.track())] } } };
    })();
    const posed = apply(state, { type: 'anim/playhead', t: 10 });
    const v = { ...view, width: 32, height: 24 };
    const plain = renderWithPasses(loaded, writeRsb(projectScene(posed, v).scene), 32, 24, 1, 0);
    const all = renderWithPasses(loaded, writeRsb(projectScene(posed, { ...v, wetFloor: true, wetFine: true, wetMotes: true }).scene), 32, 24, 1, 0);
    expect(fnv1a(resolveRgb(all.image, 1))).not.toBe(fnv1a(resolveRgb(plain.image, 1)));
  }, 120_000);
});

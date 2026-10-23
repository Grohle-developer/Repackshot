// Phase S3d on the page: the drops in the air (drips and the drops splashes throw, rt_phys::wet_parts) and the meter
// that says what is on the parts. The record of a run keeps the drops in the air frame by frame (core/wet-parts.ts
// `PartsTrackWriter`, `partsFrame`), a track of before (without them) still reads; the meter's words for what a frame
// holds (`partsShown`, ui/sentence.ts `partsMeterText`): rain, dust and snow, alone or together, nothing yet; the WETF
// section the render gets only for an engine with bit 9, each drop from the instance of the part it left; the note of an
// engine with bit 8 but not 9. With the real rt.wasm: the parity parts' last frame in the air against the native S3d
// scene (tests/fixtures/s3d-flight.rsb, `rt --write-s3d-flight-example`), its image and its passes (a drop named as its
// part).

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { playheadPose } from '../src/core/animation';
import { getMesh } from '../src/core/meshes';
import { AI_PASS_KEYS, passMask } from '../src/core/passes';
import { partsClip } from '../src/core/physics';
import { allParts } from '../src/core/scene';
import type { ProjectState } from '../src/core/store';
import {
  isPartsTrack,
  parseLayout,
  partsFrame,
  partsRenderNoFlight,
  partsShown,
  PartsTrackWriter,
  wetPartsKey,
  type PartsFrame,
  type PartsTrackPart,
} from '../src/core/wet-parts';
import { NO_INSTANCE, projectScene, writeRsb } from '../src/io/rsb';
import { readsWetFlight, readsWetParts } from '../src/render/engine';
import { hasPartsExports, PartsSim } from '../src/render/phys-wasm';
import { WeatherPreview } from '../src/render/weather-preview';
import { partsMeterText } from '../src/ui/sentence';
import { STRINGS } from '../src/ui/strings';
import { apply, exampleState } from './helpers';
import { sections } from './rsb-reader';
import { fnv1a, loadRt, passHashes, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const PARTS_TESTS = 'engine/crates/rt-phys/tests/wet_parts.rs';
const spec1 = new Uint8Array(readFileSync('tests/fixtures/s3c-parts.wpt1'));
const flightRsb = new Uint8Array(readFileSync('tests/fixtures/s3d-flight.rsb'));

/** Little-endian words as bytes. */
function bytesOf(words: number[]): Uint8Array {
  const out = new Uint8Array(4 * words.length);
  const v = new DataView(out.buffer);
  words.forEach((w, i) => v.setUint32(4 * i, w >>> 0, true));
  return out;
}
const bits = (v: number) => new Uint32Array(new Float32Array([v]).buffer)[0];

/** A frame record as the engine writes it (rt_phys::wet_parts `WetParts::frame`), its drops in the air at the end. */
function record(changed: [number, number, number, number, number, number, number][], wet: number[], drips: number, drops: number, falling: [number, number, number, number, number, number][]): Uint8Array {
  const words: number[] = [changed.length];
  for (const [id, part, tri, x, y, z, a] of changed) words.push(id, part, tri, bits(x), bits(y), bits(z), bits(a));
  words.push(0, wet.length, ...wet, 0, drips, drops, falling.length);
  for (const [id, part, x, y, z, r] of falling) words.push(id, part, bits(x), bits(y), bits(z), bits(r));
  return bytesOf(words);
}

/** A layout of `n` parts of one triangle of resolution 1 (3 samples each), with dust and snow rates or none. */
function layout(n: number, dust = false, snow = false): Uint8Array {
  const words: number[] = [n, bits(1)];
  for (let k = 0; k < n; k++) {
    words.push(1, 3, (dust ? 1 : 0) | (snow ? 2 : 0), bits(70), 1);
    if (dust) words.push(bits(1), bits(1), bits(1));
    if (snow) words.push(bits(0.1), bits(0.1), bits(0.1));
  }
  return bytesOf(words);
}

const meta = (n: number): PartsTrackPart[] => Array.from({ length: n }, (_, k) => ({ node: `p${k}`, mesh: `m${k}`, triangles: 1, samples: 3, capAngleDeg: 70, porosity: 0 }));

/** A frame of `n` parts holding the bytes `values` (3 per sample) and `drops` drops, with `falling` drops in the air. */
function frameOf(values: number[][], drops: number[], falling: number[]): PartsFrame {
  return {
    parts: values.map((v, k) => ({ values: new Uint8Array(v), drops: Array.from({ length: drops[k] ?? 0 }, () => ({ triangle: 0, position: [0, 0, 0] as [number, number, number], radius: 1 })) })),
    drops: drops.reduce((a, b) => a + b, 0),
    drips: 0,
    falling: falling.map((part) => ({ part, position: [0, 0, 10], radius: 0.5 })),
  };
}

describe('S3d: the drops in the air in the record of a run', () => {
  it('every frame keeps its drops in the air, by the part each left; a damaged list is not a track', () => {
    const w = new PartsTrackWriter(24, wetPartsKey(new Uint8Array(4)), meta(2), layout(2));
    w.push(record([], [], 0, 0, []));
    w.push(record([[0, 0, 0, 1, 2, 3, 0.5]], [0], 1, 1, [[1, 0, 5, 6, 40, 0.75], [2, 1, -5, 0, 20.5, 0.5]]));
    w.push(record([], [], 0, 1, [[2, 1, -5, 0, 18, 0.5]]));
    expect(w.lastFalling).toBe(1);
    const t = w.track();
    expect(isPartsTrack(t)).toBe(true);
    expect(partsFrame(t, 0)!.falling).toEqual([]);
    expect(partsFrame(t, 1)!.falling).toEqual([
      { part: 0, position: [5, 6, 40], radius: 0.75 },
      { part: 1, position: [-5, 0, 20.5], radius: 0.5 },
    ]);
    expect(partsFrame(t, 2)!.falling).toEqual([{ part: 1, position: [-5, 0, 18], radius: 0.5 }]);
    // A drop in the air from a part that is not there, or a record without its drops in the air, is refused.
    expect(() => w.push(record([], [], 0, 1, [[3, 5, 0, 0, 0, 1]]))).toThrow(/part/);
    const old = record([], [], 0, 1, []).subarray(0, -4);
    expect(() => w.push(old)).toThrow();
    // A track whose list of drops in the air is cut short, or has a frame too few, is not one.
    expect(isPartsTrack({ ...t, falling: t.falling!.slice(0, -8) })).toBe(false);
    const short = new PartsTrackWriter(24, 'k', meta(2), layout(2));
    short.push(record([], [], 0, 0, []));
    expect(isPartsTrack({ ...t, falling: short.track().falling })).toBe(false);
  });

  it('a track of before (no drops in the air) still reads, with none', () => {
    const w = new PartsTrackWriter(24, 'wpt1:00000000', meta(1), layout(1));
    w.push(record([], [], 0, 0, []));
    w.push(record([[0, 0, 0, 1, 2, 3, 0.5]], [0, 1], 0, 1, []));
    const { falling: _gone, ...before } = w.track();
    expect(isPartsTrack(before)).toBe(true);
    expect(partsFrame(before, 1)!.falling).toEqual([]);
    expect(partsFrame(before, 1)!.parts[0].drops).toHaveLength(1);
    // The key of a simulation says the format: a track of before is not the simulation of now (S3f: 3).
    expect(wetPartsKey(spec1).startsWith('wpt5:')).toBe(true);
  });
});

describe('S3d: the meter says what is on the parts', () => {
  const say = (f: PartsFrame, lang: 'en' | 'es' = 'en') => partsMeterText(partsShown(f), lang);

  it('rain, dust and snow, alone or together, on the parts that hold them; nothing yet before anything lands', () => {
    // Two parts, three samples each: wet, dust, snow bytes.
    const dry = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(say(frameOf([dry, dry], [0, 0], []))).toBe('Nothing on the parts yet');
    expect(say(frameOf([dry, dry], [0, 0], []), 'es')).toBe('Aún nada en las piezas');
    // Only dust: no drops are spoken of.
    expect(say(frameOf([[0, 9, 0, 0, 0, 0, 0, 0, 0], dry], [0, 0], []))).toBe('Dust on 1 parts');
    expect(say(frameOf([[0, 0, 3, 0, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, 0, 0, 0]], [0, 0], []))).toBe('Snow on 2 parts');
    expect(say(frameOf([[0, 9, 3, 0, 0, 0, 0, 0, 0], dry], [0, 0], []), 'es')).toBe('Polvo y nieve en 1 piezas');
    // Rain: a wet film is rain, with no drop on it.
    expect(say(frameOf([[255, 0, 0, 0, 0, 0, 0, 0, 0], dry], [0, 0], []))).toBe('Rain on 1 parts: 0 drops, 0 in the air');
    // The drops on the parts and in the air.
    expect(say(frameOf([[255, 0, 0, 0, 0, 0, 0, 0, 0], [0, 7, 0, 0, 0, 0, 0, 0, 0]], [1200, 0], [0, 0, 1]))).toBe('Rain and dust on 2 parts: 1,200 drops, 3 in the air');
    expect(say(frameOf([[255, 0, 0, 0, 0, 0, 0, 0, 0], [0, 7, 2, 0, 0, 0, 0, 0, 0]], [12000, 0], [0]), 'es')).toBe('Lluvia, polvo y nieve en 2 piezas: 12.000 gotas, 1 en el aire');
    expect(say(frameOf([[255, 0, 4, 0, 0, 0, 0, 0, 0], dry], [2, 0], []))).toBe('Rain and snow on 1 parts: 2 drops, 0 in the air');
    // Drops in the air alone are rain already (the first drips, before they land).
    expect(partsShown(frameOf([dry, dry], [0, 0], [1])).rain).toBe(true);
  });

  it('counts only the parts the viewport draws, and their drops in the air', () => {
    const f = frameOf([[255, 0, 0, 0, 0, 0, 0, 0, 0], [0, 7, 0, 0, 0, 0, 0, 0, 0]], [3, 0], [0, 1, 1]);
    expect(partsShown(f, (k) => k === 1)).toEqual({ parts: 1, drops: 0, falling: 2, rain: true, dust: true, snow: false });
    expect(partsShown(f, (k) => k === 0)).toEqual({ parts: 1, drops: 3, falling: 1, rain: true, dust: false, snow: false });
  });

  it('every string of the meter, of the physics bar and of the note is in English and in Spanish', () => {
    for (const k of ['status.partsOn.R', 'status.partsOn.D', 'status.partsOn.S', 'status.partsOn.RD', 'status.partsOn.RS', 'status.partsOn.DS', 'status.partsOn.RDS', 'status.partsOn.none', 'status.partsDrops', 'phys.parts', 'ambient.wetFlightOldEngine'] as const) {
      expect(STRINGS.en[k]).toBeTruthy();
      expect(STRINGS.es[k]).toBeTruthy();
    }
    expect(STRINGS.en['phys.parts']).toContain('{falling}');
    expect(STRINGS.es['phys.parts']).toContain('{falling}');
  });
});

describe('S3d: the drops in the air in the render', () => {
  function recorded(): { state: ProjectState; parts: string[] } {
    const s = exampleState();
    // The track's parts in the other order than the file's instances: a drop's part index is not its instance.
    const parts = allParts(s).filter((id) => s.scene.nodes[id].mesh).slice(0, 2).reverse();
    const m = parts.map((id) => {
      const mesh = s.scene.nodes[id].mesh!;
      return { node: id, mesh: mesh.id, triangles: mesh.triangles, samples: 3 * mesh.triangles, capAngleDeg: 75, porosity: 0 };
    });
    const lay: number[] = [m.length, bits(1)];
    for (const p of m) {
      lay.push(p.triangles, p.samples, 0, bits(75));
      const res = new Array(Math.ceil(p.triangles / 4) * 4).fill(0).map((_, i) => (i < p.triangles ? 1 : 0));
      for (let i = 0; i < res.length; i += 4) lay.push(res[i] | (res[i + 1] << 8) | (res[i + 2] << 16) | (res[i + 3] << 24));
    }
    const w = new PartsTrackWriter(s.animation.fps, 'wpt2:00000001', m, bytesOf(lay));
    w.push(record([], [], 0, 0, []));
    w.push(record([], [0], 1, 0, [[0, 1, 3, 4, 50, 1.25], [1, 0, -3, 0, 20, 0.5]]));
    const clip = partsClip('c1', 0, w.track());
    return { state: { ...s, animation: { ...s.animation, clips: [clip] } }, parts };
  }

  it('a WETF section only for an engine with bit 9, each drop from the instance of the part it left', () => {
    const { state, parts } = recorded();
    const posed = apply(state, { type: 'anim/playhead', t: 10 });
    const view = { width: 64, height: 48, maxSamples: 4, maxSeconds: 0, transparent: false, wetParts: true };
    expect(projectScene(posed, view).scene.wetFalling).toBeUndefined();
    const { scene, ids } = projectScene(posed, { ...view, wetFlight: true });
    expect(scene.wetFalling).toHaveLength(2);
    const [a, b] = scene.wetFalling!;
    expect(ids.instances[a.instance].node).toBe(parts[1]);
    expect(ids.instances[b.instance].node).toBe(parts[0]);
    expect(a.position).toEqual([3, 4, 50]);
    expect(a.radius).toBe(1.25);
    // The section, byte for byte as the engine reads it (rt_core::weather `decode_falling`), after the WETP sections.
    const all = sections(writeRsb(scene));
    const wetf = all.filter((x) => x.tag === 'WETF');
    expect(wetf).toHaveLength(1);
    const p = wetf[0].payload;
    expect(p.byteLength).toBe(4 + 2 * 20);
    expect([p.getUint32(0, true), p.getUint32(4, true)]).toEqual([2, a.instance]);
    expect([p.getFloat32(8, true), p.getFloat32(12, true), p.getFloat32(16, true), p.getFloat32(20, true)]).toEqual([3, 4, 50, 1.25]);
    expect(all.findIndex((x) => x.tag === 'WETF')).toBeGreaterThan(all.map((x) => x.tag).lastIndexOf('WETP'));
    // A drop of a part that is not drawn is left out; at the frame of the dry parts there is none.
    const hidden = apply(posed, { type: 'scene/setVisible', ids: [parts[1]], visible: false });
    const fewer = projectScene(hidden, { ...view, wetFlight: true });
    expect(fewer.scene.wetFalling).toHaveLength(1);
    expect(fewer.ids.instances[fewer.scene.wetFalling![0].instance].node).toBe(parts[0]);
    expect(projectScene(apply(state, { type: 'anim/playhead', t: 0 }), { ...view, wetFlight: true }).scene.wetFalling).toBeUndefined();
    expect(NO_INSTANCE).toBe(0xffffffff);
  });

  it('Fast draws a sphere of water per drop in the air of a drawn part, where the engine has it, and the meter says it', () => {
    const { state, parts } = recorded();
    const root = new THREE.Group();
    const weather = new WeatherPreview(root);
    const objects = new Map(parts.map((id) => [id, new THREE.Object3D()] as const));
    const geometryOf = (id: string) => {
      const data = getMesh(state.scene.nodes[id].mesh!.id)!;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(data.positions), 3));
      g.setIndex(Array.from(data.indices));
      return g;
    };
    const at = (t: number) => {
      const s = apply(state, { type: 'anim/playhead', t });
      weather.update(s, playheadPose(s), objects, geometryOf);
    };
    at(10);
    expect(weather.fallingDrawn()).toBe(2);
    const spheres = root.children.find((c) => c.name === 'drops:air') as THREE.InstancedMesh;
    expect(spheres).toBeTruthy();
    const m = new THREE.Matrix4();
    spheres.getMatrixAt(0, m);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(p, q, scale);
    expect([p.x, p.y, p.z]).toEqual([3, 4, 50]);
    expect(scale.x).toBeCloseTo(1.25, 6);
    expect(weather.shown).toEqual({ parts: 1, drops: 0, falling: 2, rain: true, dust: false, snow: false });
    // At the frame of the dry parts, none; without the recording, none.
    at(0);
    expect(weather.fallingDrawn()).toBe(0);
    expect(weather.shown?.rain).toBe(false);
    weather.update({ ...state, animation: { ...state.animation, clips: [] } }, null, objects, geometryOf);
    expect(weather.fallingDrawn()).toBe(0);
    expect(weather.shown).toBeNull();
    weather.dispose();
  });

  it('bit 9 of the engine: the note says an engine of before draws the drips and splashes only once they land', () => {
    expect(readsWetFlight(1023)).toBe(true);
    expect(readsWetFlight(511)).toBe(false);
    expect(readsWetParts(511)).toBe(true);
    const s = apply(exampleState(), { type: 'effect/add', preset: 'RAIN' });
    const rain = apply(s, { type: 'effect/set', id: s.effects[s.effects.length - 1].id, patch: { wetParts: true } });
    expect(partsRenderNoFlight(rain, true, false)).toBe(true);
    // An engine that draws them, one not known yet, or one without bit 8 (its own note says more): no note.
    expect(partsRenderNoFlight(rain, true, true)).toBe(false);
    expect(partsRenderNoFlight(rain, true, undefined)).toBe(false);
    expect(partsRenderNoFlight(rain, false, false)).toBe(false);
    // Dust and snow have no drops in the air; an effect not on the parts, nothing.
    const d = apply(exampleState(), { type: 'effect/add', preset: 'DUST_CLOUD' });
    const dust = apply(d, { type: 'effect/set', id: d.effects[d.effects.length - 1].id, patch: { wetParts: true } });
    expect(partsRenderNoFlight(dust, true, false)).toBe(false);
    expect(partsRenderNoFlight(s, true, false)).toBe(false);
  });
});

describe('S3d: through the real engine', () => {
  it.skipIf(!RT_WASM)('the parity parts’ last frame has the native scene’s drops in the air, which renders to its pins', async () => {
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    expect(hasPartsExports(rt)).toBe(true);
    if (!hasPartsExports(rt)) return;
    const sim = new PartsSim(rt, spec1);
    const lay = parseLayout(sim.layout())!;
    const parts: PartsTrackPart[] = lay.parts.map((p, k) => ({ node: `n${k}`, mesh: `m${k}`, triangles: p.triangles, samples: p.samples, capAngleDeg: p.capAngleDeg, porosity: 0 }));
    const w = new PartsTrackWriter(24, wetPartsKey(spec1), parts, sim.layout());
    w.push(sim.frame());
    let seen = 0;
    for (let k = 1; k <= 120; k++) {
      sim.step(10);
      w.push(sim.frame());
      seen += w.lastFalling;
    }
    sim.free();
    expect(seen).toBeGreaterThan(0);
    const last = partsFrame(w.track(), 120)!;
    const wetf = sections(flightRsb).filter((x) => x.tag === 'WETF');
    expect(wetf).toHaveLength(1);
    const p = wetf[0].payload;
    expect(p.getUint32(0, true)).toBe(last.falling.length);
    last.falling.forEach((f, i) => {
      const o = 4 + 20 * i;
      // The parity scene's instance k is part k.
      expect(p.getUint32(o, true)).toBe(f.part);
      expect(f.position).toEqual([p.getFloat32(o + 4, true), p.getFloat32(o + 8, true), p.getFloat32(o + 12, true)]);
      expect(f.radius).toBe(p.getFloat32(o + 16, true));
    });
    const loaded = await loadRt();
    const { image, passes } = renderWithPasses(loaded, flightRsb, 160, 120, 4, passMask([...AI_PASS_KEYS]));
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned(PARTS_TESTS, 'PINNED_S3D_FLIGHT_4SPP'));
    expect(passHashes(passes)).toEqual(['ALBEDO', 'NORMAL', 'DEPTH', 'PART_ID', 'MATERIAL_ID', 'COC'].map((k) => pinned(PARTS_TESTS, `PINNED_S3D_PASS_${k}`)));
  }, 240_000);
});

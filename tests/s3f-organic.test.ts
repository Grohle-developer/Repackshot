// Phase S3f on the page: organic drops (rt_phys::wet_parts): the shape of every changed drop in the record of a run
// (core/wet-parts.ts `PartsTrackWriter`, `partsFrame`: a record or a track of before reads round), the shape tail of
// the WETP section only for an engine with bit 10 (io/rsb.ts, byte for byte as rt_core::weather reads it), the note of
// an engine with bit 8 but not 10, and Fast's deformed caps (render/weather-preview.ts: each instance carries its shape
// in its cap's frame, `shapePointLocal` the twin of the vertex shader, which keeps the volume). With the real rt.wasm:
// the S3f scene (tests/fixtures/s3f-organic.rsb, `rt --write-s3f-organic-example`) renders to its native pin.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { playheadPose } from '../src/core/animation';
import { getMesh } from '../src/core/meshes';
import { partsClip } from '../src/core/physics';
import { allParts } from '../src/core/scene';
import type { ProjectState } from '../src/core/store';
import { isPartsTrack, isRoundShape, isValidShape, partsFrame, partsRenderRound, PartsTrackWriter, ROUND_SHAPE, SHAPE_FLOATS, wetPartsKey, type PartsTrackPart } from '../src/core/wet-parts';
import { projectScene, writeRsb } from '../src/io/rsb';
import { readsWetShapes } from '../src/render/engine';
import { capGeometry, localShape, SHAPED_CAP_RINGS, shapePointLocal, WeatherPreview, type LocalShape } from '../src/render/weather-preview';
import { STRINGS } from '../src/ui/strings';
import { apply, exampleState } from './helpers';
import { sections } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const PARTS_TESTS = 'engine/crates/rt-phys/tests/wet_parts.rs';
const organicRsb = new Uint8Array(readFileSync('tests/fixtures/s3f-organic.rsb'));

function bytesOf(words: number[]): Uint8Array {
  const out = new Uint8Array(4 * words.length);
  const v = new DataView(out.buffer);
  words.forEach((w, i) => v.setUint32(4 * i, w >>> 0, true));
  return out;
}
const bits = (v: number) => new Uint32Array(new Float32Array([v]).buffer)[0];
const f32 = (v: number) => new Float32Array([v])[0];

/** A sliding drop's shape (axis +X of its part), a merging one's, a hanging one's. */
const SLIDING = [1, 0, 0, 2.2, 0.12, 0.3, 0, 0, 0, 1, 1, 0, 0, 0, 0];
const MERGING = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1.5, 0.8, 0.5, 0.4, 0, 0];
const HANGING = [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0.8, 0.5];

/** A frame record (rt_phys::wet_parts `WetParts::frame`); S3f: with the shapes of its changed drops, or none (of before). */
function record(changed: [number, number, number, number, number, number, number][], drops: number, shapes: number[][] | null): Uint8Array {
  const words: number[] = [changed.length];
  for (const [id, part, tri, x, y, z, a] of changed) words.push(id, part, tri, bits(x), bits(y), bits(z), bits(a));
  words.push(0, 0, 0, 0, drops, 0);
  if (shapes) {
    words.push(shapes.length);
    for (const s of shapes) for (const v of s) words.push(bits(v));
  }
  return bytesOf(words);
}

function layout(n: number, triangles = 1): Uint8Array {
  const words: number[] = [n, bits(1)];
  for (let k = 0; k < n; k++) {
    words.push(triangles, 3 * triangles, 0, bits(70));
    const res = new Array(Math.ceil(triangles / 4) * 4).fill(0).map((_, i) => (i < triangles ? 1 : 0));
    for (let i = 0; i < res.length; i += 4) words.push(res[i] | (res[i + 1] << 8) | (res[i + 2] << 16) | (res[i + 3] << 24));
  }
  return bytesOf(words);
}

const meta = (n: number): PartsTrackPart[] => Array.from({ length: n }, (_, k) => ({ node: `p${k}`, mesh: `m${k}`, triangles: 1, samples: 3, capAngleDeg: 70, porosity: 0 }));

describe('S3f: the shapes of the drops in the record of a run', () => {
  it('every changed drop keeps its shape with its version; a record of before reads round; a damaged one is refused', () => {
    const w = new PartsTrackWriter(24, wetPartsKey(new Uint8Array(4)), meta(1), layout(1));
    w.push(record([], 0, []));
    w.push(record([[0, 0, 0, 1, 2, 3, 0.5], [1, 0, 0, 4, 5, 6, 0.7]], 2, [SLIDING, MERGING]));
    w.push(record([[1, 0, 0, 4, 4, 6, 0.7]], 2, [HANGING]));
    // A record of an engine of before (no shapes): round.
    w.push(record([[0, 0, 0, 1, 1, 3, 0.5]], 2, null));
    const t = w.track();
    expect(isPartsTrack(t)).toBe(true);
    const shapeOf = (frame: number) => partsFrame(t, frame)!.parts[0].drops.map((d) => d.shape!.map(f32));
    expect(shapeOf(1)).toEqual([SLIDING.map(f32), MERGING.map(f32)]);
    expect(shapeOf(2)).toEqual([SLIDING.map(f32), HANGING.map(f32)]);
    expect(shapeOf(3)).toEqual([[...ROUND_SHAPE], HANGING.map(f32)]);
    // Shapes that are not one per changed drop, or not finite, are refused (and nothing of the record is kept).
    expect(() => w.push(record([[2, 0, 0, 0, 0, 0, 1]], 3, [SLIDING, SLIDING]))).toThrow(/shapes/);
    expect(() => w.push(record([[2, 0, 0, 0, 0, 0, 1]], 3, [[...SLIDING.slice(0, 14), NaN]]))).toThrow(/finite/);
    expect(w.frames).toBe(4);
    expect(isPartsTrack(w.track())).toBe(true);
    // A track whose shapes are out of their range, or one too few, is not one.
    const bad = new PartsTrackWriter(24, 'k', meta(1), layout(1));
    bad.push(record([[0, 0, 0, 1, 2, 3, 0.5]], 1, [[0, 0, 0, 0.5, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]]));
    expect(isPartsTrack(bad.track())).toBe(false);
    expect(isPartsTrack({ ...t, shapes: t.shapes!.slice(0, -8) })).toBe(false);
  });

  it('a track of before (no shapes) still reads, round; the key says the format of now', () => {
    const w = new PartsTrackWriter(24, 'wpt2:00000000', meta(1), layout(1));
    w.push(record([], 0, null));
    w.push(record([[0, 0, 0, 1, 2, 3, 0.5]], 1, null));
    const { shapes: _gone, ...before } = w.track();
    expect(isPartsTrack(before)).toBe(true);
    expect(partsFrame(before, 1)!.parts[0].drops[0].shape).toBeUndefined();
    expect(wetPartsKey(new Uint8Array(4)).startsWith('wpt3:')).toBe(true);
    expect(isRoundShape(ROUND_SHAPE) && !isRoundShape(SLIDING) && isValidShape(SLIDING) && SHAPE_FLOATS === 15).toBe(true);
  });
});

describe('S3f: the shapes in the render and in Fast', () => {
  function recorded(shaped: boolean): { state: ProjectState; part: string; triangles: number } {
    const s = exampleState();
    const part = allParts(s).filter((id) => s.scene.nodes[id].mesh)[0];
    const mesh = s.scene.nodes[part].mesh!;
    const m: PartsTrackPart[] = [{ node: part, mesh: mesh.id, triangles: mesh.triangles, samples: 3 * mesh.triangles, capAngleDeg: 75, porosity: 0 }];
    const w = new PartsTrackWriter(s.animation.fps, 'wpt3:00000001', m, layout(1, mesh.triangles));
    w.push(record([], 0, shaped ? [] : null));
    w.push(record([[0, 0, 2, 1, 2, 3, 1.5], [1, 0, 5, 4, 5, 6, 1.2], [2, 0, 7, 7, 8, 9, 2]], 3, shaped ? [SLIDING, MERGING, HANGING] : null));
    const clip = partsClip('c1', 0, w.track());
    return { state: { ...s, animation: { ...s.animation, clips: [clip] } }, part, triangles: mesh.triangles };
  }

  it('the WETP section ends in the shape tail only for an engine with bit 10, byte for byte as the engine reads it', () => {
    const { state } = recorded(true);
    const posed = apply(state, { type: 'anim/playhead', t: 10 });
    const view = { width: 64, height: 48, maxSamples: 4, maxSeconds: 0, transparent: false, wetParts: true };
    const plain = projectScene(posed, view).scene.wetParts!;
    expect(plain).toHaveLength(1);
    expect(plain[0].shapes).toBeUndefined();
    const shaped = projectScene(posed, { ...view, wetShapes: true }).scene;
    expect(shaped.wetParts![0].shapes!.map((s) => [...s])).toEqual([SLIDING.map(f32), MERGING.map(f32), HANGING.map(f32)]);
    const wetp = (scene: typeof shaped) => sections(writeRsb(scene)).filter((x) => x.tag === 'WETP')[0].payload;
    const a = wetp(projectScene(posed, view).scene);
    const b = wetp(shaped);
    // The S3c section, then "SHP1", the count, and 15 floats a drop.
    expect(b.byteLength).toBe(a.byteLength + 8 + 3 * 60);
    for (let i = 0; i < a.byteLength; i++) expect(b.getUint8(i)).toBe(a.getUint8(i));
    const end = a.byteLength;
    expect(String.fromCharCode(b.getUint8(end), b.getUint8(end + 1), b.getUint8(end + 2), b.getUint8(end + 3))).toBe('SHP1');
    expect(b.getUint32(end + 4, true)).toBe(3);
    for (let k = 0; k < 15; k++) expect(b.getFloat32(end + 8 + 4 * k, true)).toBe(f32(SLIDING[k]));
    expect(b.getFloat32(end + 8 + 60 + 4 * 11, true)).toBe(f32(MERGING[11]));
    // A track of before (round drops) gets no tail, even for an engine with the bit.
    const old = apply(recorded(false).state, { type: 'anim/playhead', t: 10 });
    expect(projectScene(old, { ...view, wetShapes: true }).scene.wetParts![0].shapes).toBeUndefined();
  });

  it('Fast deforms the caps of shaped drops, each instance with its shape in its cap’s frame', () => {
    const { state, part } = recorded(true);
    const root = new THREE.Group();
    const weather = new WeatherPreview(root);
    const objects = new Map([[part, new THREE.Object3D()] as const]);
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
    };
    at(state, 10);
    const caps = root.children.find((c) => c.name === `drops:${part}`) as THREE.InstancedMesh;
    expect(caps.userData.shaped).toBe(true);
    expect(caps.geometry.getAttribute('position').count).toBe(1 + SHAPED_CAP_RINGS * 16);
    const local = weather.capShapes(part)!;
    expect(local).toHaveLength(3);
    // In its cap's frame: the axis turned into the plane of the cap (unit), the numbers as recorded, gravity unit.
    const [slide, merge, hang] = local;
    expect(Math.hypot(slide.shape[0], slide.shape[1])).toBeCloseTo(1, 5);
    expect(slide.shape.slice(2, 5)).toEqual([f32(2.2), f32(0.12), f32(0.3)]);
    expect(Math.hypot(merge.shape[5], merge.shape[6])).toBeCloseTo(1, 5);
    expect(merge.shape.slice(7, 11)).toEqual([f32(1.5), f32(0.8), f32(0.5), f32(0.4)]);
    expect(hang.shape.slice(11, 13)).toEqual([f32(0.8), f32(0.5)]);
    expect(Math.hypot(hang.shape[13], hang.shape[14], hang.shape[15])).toBeCloseTo(1, 5);
    const theta = (75 * Math.PI) / 180;
    expect(slide.height).toBeCloseTo((1 - Math.cos(theta)) / Math.sin(theta), 5);
    // A track of before: round caps, as before.
    at(recorded(false).state, 10);
    expect((root.children.find((c) => c.name === `drops:${part}`) as THREE.InstancedMesh).userData.shaped).toBe(false);
    expect(weather.capShapes(part)).toBeNull();
    weather.dispose();
  });

  it('the vertex shader’s twin keeps the volume and gives each shape its form, as the engine does', () => {
    const q = new THREE.Quaternion();
    const down = new THREE.Vector3(0, 0, -1);
    const g = capGeometry(60, SHAPED_CAP_RINGS);
    const pos = g.getAttribute('position');
    const index = g.getIndex()!;
    const volume = (s: LocalShape | null) => {
      const p = Array.from({ length: pos.count }, (_, i) => {
        const v = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        return s ? shapePointLocal(v, s) : v;
      });
      let sum = 0;
      for (let t = 0; t < index.count; t += 3) {
        const [a, b, c] = [p[index.getX(t)], p[index.getX(t + 1)], p[index.getX(t + 2)]];
        sum += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      }
      return { v: Math.abs(sum), p };
    };
    const round = volume(null);
    // A ceiling's drop: gravity along its outward normal (+Z of the cap).
    const ceiling = new THREE.Vector3(0, 0, 1);
    const all = [localShape(SLIDING, q, down, 60), localShape(MERGING, q, down, 60), localShape(HANGING, q, ceiling, 60)];
    for (const s of all) expect(volume(s).v / round.v).toBeCloseTo(1, 1);
    const extent = (p: number[][], axis: number) => Math.max(...p.map((v) => v[axis])) - Math.min(...p.map((v) => v[axis]));
    // Sliding along +X: longer than wide, its top sheared forward.
    const slide = volume(all[0]).p;
    expect(extent(slide, 0)).toBeGreaterThan(1.9 * extent(slide, 1));
    expect(slide[0][0]).toBeGreaterThan(0.05);
    // Hanging: longer along gravity than a round cap is tall.
    expect(extent(volume(all[2]).p, 2)).toBeGreaterThan(1.6 * extent(round.p, 2));
    // On a face looking along +X, downhill (−Z of the part) and gravity are +X of the cap's own frame (its +Z the
    // normal): the shape is turned into the cap's frame, not out of it.
    const side = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
    const turned = localShape([0, 0, -1, 2, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0], side, down, 60);
    expect(turned.axis[0]).toBeCloseTo(1, 6);
    expect(turned.axis[1]).toBeCloseTo(0, 6);
    expect(turned.gravity[0]).toBeCloseTo(1, 6);
    // Round is round.
    const r = localShape(ROUND_SHAPE, q, down, 60);
    expect(shapePointLocal([0.3, 0.2, 0.1], r)).toEqual([0.3, 0.2, 0.1]);
    g.dispose();
  });

  it('bit 10 of the engine: the note says an engine of before draws the drops round', () => {
    expect(readsWetShapes(2047)).toBe(true);
    expect(readsWetShapes(1023)).toBe(false);
    const s = apply(exampleState(), { type: 'effect/add', preset: 'RAIN' });
    const rain = apply(s, { type: 'effect/set', id: s.effects[s.effects.length - 1].id, patch: { wetParts: true } });
    expect(partsRenderRound(rain, true, false)).toBe(true);
    expect(partsRenderRound(rain, true, true)).toBe(false);
    expect(partsRenderRound(rain, true, undefined)).toBe(false);
    expect(partsRenderRound(rain, false, false)).toBe(false);
    const d = apply(exampleState(), { type: 'effect/add', preset: 'DUST_CLOUD' });
    const dust = apply(d, { type: 'effect/set', id: d.effects[d.effects.length - 1].id, patch: { wetParts: true } });
    expect(partsRenderRound(dust, true, false)).toBe(false);
    expect(partsRenderRound(s, true, false)).toBe(false);
    for (const k of ['ambient.wetShapesOldEngine', 'ambient.wetPartsTip.DROPS'] as const) {
      expect(STRINGS.en[k]).toBeTruthy();
      expect(STRINGS.es[k]).toBeTruthy();
    }
  });
});

describe('S3f: through the real engine', () => {
  it.skipIf(!RT_WASM)('the S3f scene, its drops with their shapes, renders to its native pin', async () => {
    const wetp = sections(organicRsb).filter((x) => x.tag === 'WETP');
    expect(wetp.length).toBeGreaterThan(0);
    const loaded = await loadRt();
    const { image } = renderWithPasses(loaded, organicRsb, 160, 120, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned(PARTS_TESTS, 'PINNED_S3F_ORGANIC_4SPP'));
  }, 240_000);
});

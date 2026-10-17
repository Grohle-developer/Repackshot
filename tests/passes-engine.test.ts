// The engine's exact passes on the page (phase X2, AI-POST.md §7.4): how render/pass-planes.ts puts them
// together and reads the launcher's file, and, with the real rt.wasm, that the pool's way of rendering them
// gives the native engine's pinned planes bit for bit without touching the image, and that on the X4 test
// scene they are the passes of the contract (the ids of `projectScene`, the depth along the axis, the
// normals towards the camera, the albedo of the material, the studio floor as FLOOR_ID).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_PASS_KEYS, FLOOR_ID, PASS_KEYS, passMask } from '../src/core/passes';
import { projectScene, writeRsb } from '../src/io/rsb';
import { ALBEDO_BIT, ALPHA_BIT, EXACT_BITS, keysOfMask, parsePasses, PassAccumulator, SAMPLED_BITS, wordsPerPixel } from '../src/render/pass-planes';
import { tileGrid } from '../src/render/tiles';
import { passScene } from './browser/pass-scene';
import { referencePasses } from './browser/reference-passes';
import { fnv1a, loadRt, passHashes, pinned, pinnedPasses, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

/** The six passes of X2 (the AI guard's contract): what the pinned hashes of that phase are over. N2's alpha has its own tests below. */
const ALL = passMask([...AI_PASS_KEYS]);

describe('putting the passes together', () => {
  it('masks follow the keys', () => {
    expect([ALL, EXACT_BITS, ALBEDO_BIT]).toEqual([0b111111, 0b111110, 1]);
    expect(keysOfMask(0b100101 | (1 << 9))).toEqual(['albedo', 'depth', 'coc']);
    expect(wordsPerPixel(ALL)).toBe(10);
    expect(wordsPerPixel(EXACT_BITS)).toBe(7);
  });

  it('adds the albedo in sample order in f32 and divides like Film::resolve; the exact planes go where their tile is', () => {
    const tiles = tileGrid(40, 3, 32);
    const acc = new PassAccumulator(40, 3, ALL, tiles);
    const t = tiles[1]; // 8 x 3 at x = 32
    const sample = (s: number) => new Float32Array(t.w * t.h * 3).map((_, i) => 0.1 * (s + 1) + i / 1000);
    expect(acc.addAlbedo(1, 0, 1, sample(0))).toBe(true);
    expect(acc.addAlbedo(1, 2, 1, sample(2))).toBe(false); // out of order: refused
    const two = new Float32Array(t.w * t.h * 6);
    two.set(sample(1));
    two.set(sample(2), t.w * t.h * 3);
    expect(acc.addAlbedo(1, 1, 2, two)).toBe(true);
    // Exact planes of the tile: normal (3), depth, partId, materialId, coc words per pixel, in that order.
    const n = t.w * t.h;
    const words = new Uint32Array(n * 7);
    const f = new Float32Array(words.buffer);
    for (let i = 0; i < n; i++) {
      f[i * 3 + 2] = 1; // normal +Z
      f[n * 3 + i] = 50 + i; // depth
      words[n * 4 + i] = i === 0 ? FLOOR_ID : 3; // partId
      words[n * 5 + i] = 2; // materialId
      f[n * 6 + i] = 0.5; // coc
    }
    expect(acc.setExact(1, words)).toBe(true);
    expect(acc.setExact(1, words.subarray(1))).toBe(false);
    const r = acc.resolve();
    const p = (x: number, y: number) => y * 40 + x;
    // The pixel (33, 1): local index 9.
    // Every value of the tile: three samples summed in f32, times the f32 reciprocal of 3 (which is not
    // the same as dividing by 3 for every value: a power of two of samples would not tell them apart).
    const third = Math.fround(1 / 3);
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w * 3; x++) {
        const i = y * t.w * 3 + x;
        const v = (s: number) => Math.fround(0.1 * (s + 1) + i / 1000);
        const sum = Math.fround(Math.fround(v(0) + v(1)) + v(2));
        expect(r.albedo![(t.y + y) * 40 * 3 + t.x * 3 + x], `value ${i}`).toBe(Math.fround(sum * third));
      }
    expect([r.depth![p(33, 1)], r.partId![p(32, 0)], r.partId![p(33, 0)], r.materialId![p(33, 0)], r.coc![p(39, 2)]]).toEqual([59, FLOOR_ID, 3, 2, 0.5]);
    expect(Array.from(r.normal!.subarray(p(33, 1) * 3, p(33, 1) * 3 + 3))).toEqual([0, 0, 1]);
    // The tile that got nothing is background: depth +∞, the rest 0, no albedo.
    expect([r.depth![p(0, 0)], r.partId![p(0, 0)], r.albedo![p(0, 0) * 3], r.coc![p(0, 0)]]).toEqual([Infinity, 0, 0, 0]);
    // Only what was asked for exists.
    const some = new PassAccumulator(40, 3, passMask(['depth']), tiles).resolve();
    expect(Object.keys(some).sort()).toEqual(['depth', 'height', 'width']);
  });
});

describe('the launcher’s passes file', () => {
  const file = readFileSync('tests/fixtures/passes-3x2.rpp');
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

  it('reads as engine/crates/rt-app/src/kept.rs wrote it', () => {
    const { id, samples, passes } = parsePasses(buf);
    expect([id, samples, passes.width, passes.height]).toEqual([42, 7, 3, 2]);
    expect(Object.keys(passes).sort()).toEqual([...PASS_KEYS, 'height', 'width'].sort());
    for (let i = 0; i < 6; i++) {
      for (let c = 0; c < 3; c++) {
        expect(passes.albedo![i * 3 + c]).toBe(i * 0.5 + c * 0.125);
        expect(passes.normal![i * 3 + c]).toBe(-i * 0.25 + c);
      }
      expect(passes.depth![i]).toBe(i === 5 ? Infinity : 100 + i);
      expect(passes.partId![i]).toBe(i === 4 ? FLOOR_ID : i);
      expect(passes.materialId![i]).toBe(i === 4 ? FLOOR_ID : 2 * i);
      expect(passes.coc![i]).toBe(i / 8);
      // N2: the alpha plane, appended after the six.
      expect(passes.alpha![i]).toBe(Math.fround(i / 5));
    }
  });

  it('refuses what is not one', () => {
    expect(() => parsePasses(buf.slice(0, buf.byteLength - 4))).toThrow(/short/);
    expect(() => parsePasses(buf.slice(0, 16))).toThrow(/short/);
    const bad = buf.slice(0);
    new DataView(bad).setUint8(0, 0x58);
    expect(() => parsePasses(bad)).toThrow(/not a passes file/);
    const header = buf.slice(0);
    new DataView(header).setUint32(4, 30, true);
    expect(() => parsePasses(header)).toThrow(/header/);
  });
});

describe.skipIf(!RT_WASM)('the passes of the real rt.wasm, rendered the pool’s way', () => {
  it('are the native engine’s pinned planes, and the image keeps its pinned hash', async () => {
    const rt = await loadRt();
    for (const [fixture, image, prefix] of [
      ['tests/fixtures/example.rsb', 'PINNED_EXAMPLE_4SPP', ''],
      ['tests/fixtures/e5.rsb', 'PINNED_E5_HDRI_4SPP', 'E5_'],
      // E6: the edge bevel; its normal pass is the bevelled shading normal.
      ['tests/fixtures/e6.rsb', 'PINNED_E6_BEVEL_4SPP', 'E6_'],
    ] as const) {
      const rsb = new Uint8Array(readFileSync(fixture));
      const [w, h] = fixture.includes('example') ? [512, 384] : [160, 120];
      const { image: acc, passes } = renderWithPasses(rt, rsb, w, h, 4, ALL);
      expect(fnv1a(resolveRgb(acc, 4)), `${fixture}: the image`).toBe(pinned('engine/crates/rt-core/src/render.rs', image));
      expect(passHashes(passes).map((x) => x.toString(16)), `${fixture}: the passes`).toEqual(pinnedPasses(prefix).map((x) => x.toString(16)));
    }
  }, 120000);

  it('on the X4 scene: the ids of projectScene, the depth along the axis, normals towards the camera, the albedo, the floor as FLOOR_ID', async () => {
    const W = 192;
    const H = 108;
    const state = passScene(W, H);
    const { scene, ids } = projectScene(state, { width: W, height: H, maxSamples: 1, maxSeconds: 0, passes: [...AI_PASS_KEYS] });
    expect(scene.render.passes).toBe(ALL);
    // The studio floor is a shadow catcher here, which the engine's passes count as FLOOR_ID.
    expect(scene.floor.mode).toBe(2);
    const rt = await loadRt();
    const { passes } = renderWithPasses(rt, writeRsb(scene), W, H, 2, ALL);
    const ref = referencePasses(state, W, H);
    // Where a ray through the pixel centre may land on either side of an edge of the reference.
    const near = (i: number) => {
      const [x, y] = [i % W, Math.floor(i / W)];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * W + x + dx;
          if (x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= H) continue;
          if (ref.partId![j] !== ref.partId![i] || Math.abs(ref.depth![j] - ref.depth![i]) > 8) return true;
          const n = ref.normal!;
          if (n[i * 3] * n[j * 3] + n[i * 3 + 1] * n[j * 3 + 1] + n[i * 3 + 2] * n[j * 3 + 2] < 0.99) return true;
        }
      return false;
    };
    let floor = 0;
    let parts = 0;
    let sharp = 0;
    let edges = 0;
    for (let i = 0; i < W * H; i++) {
      const id = passes.partId![i];
      if (ref.partId![i] === FLOOR_ID) {
        // The studio floor (X3c: the reference casts it too): FLOOR_ID in both ids, facing up, at its depth.
        if (near(i)) {
          if (id !== FLOOR_ID) edges++;
          continue;
        }
        expect(id, `pixel ${i}`).toBe(FLOOR_ID);
        expect(passes.materialId![i]).toBe(FLOOR_ID);
        expect(Array.from(passes.normal!.subarray(i * 3, i * 3 + 3))).toEqual([0, 0, 1]);
        expect(Math.abs(passes.depth![i] - ref.depth![i])).toBeLessThan(1e-4 * ref.depth![i]);
        floor++;
        continue;
      }
      if (ref.partId![i] === 0) {
        if (!near(i)) {
          expect(id, `pixel ${i}`).toBe(0);
          expect(passes.depth![i]).toBe(Infinity);
        }
        continue;
      }
      if (near(i)) {
        if (id !== ref.partId![i]) edges++;
        continue;
      }
      expect(id, `pixel ${i}`).toBe(ref.partId![i]);
      expect(passes.materialId![i]).toBe(ref.materialId![i]);
      expect(passes.materialId![i]).toBe(ids.instances[id - 1].materialId);
      expect(Math.abs(passes.depth![i] - ref.depth![i])).toBeLessThan(1e-4 * ref.depth![i]);
      const n = passes.normal!.subarray(i * 3, i * 3 + 3);
      const r = ref.normal!.subarray(i * 3, i * 3 + 3);
      expect(n[0] * r[0] + n[1] * r[1] + n[2] * r[2]).toBeGreaterThan(0.9999);
      // The albedo follows the samples like the image, through the lens: where the lens blurs (f/2.8 here)
      // it mixes what the blur mixes, and is the material's colour where it does not.
      if (passes.coc![i] < 0.25) {
        for (let c = 0; c < 3; c++) expect(Math.abs(passes.albedo![i * 3 + c] - ref.albedo![i * 3 + c])).toBeLessThan(1e-6);
        sharp++;
      }
      parts++;
    }
    expect(parts).toBeGreaterThan(2000);
    expect(sharp).toBeGreaterThan(100);
    expect(floor).toBeGreaterThan(1000);
    expect(edges).toBeLessThan(W * H * 0.01);
  }, 120000);
});

// ------------------------------------------------------------------ N2: the alpha pass

describe('the alpha pass (N2): the seventh key, appended after the six', () => {
  it('is bit 6 of the mask, a sampled pass like the albedo, and the exact planes stay the same five', () => {
    expect(PASS_KEYS).toEqual([...AI_PASS_KEYS, 'alpha']);
    expect(passMask(['alpha'])).toBe(0b1000000);
    expect(ALPHA_BIT).toBe(64);
    expect(SAMPLED_BITS).toBe(0b1000001);
    expect(EXACT_BITS).toBe(0b111110);
    expect(keysOfMask(0b1000101)).toEqual(['albedo', 'depth', 'alpha']);
    expect(wordsPerPixel(0b1111111)).toBe(11);
  });

  it('adds the coverage in sample order in f32 and divides like Film::resolve; refuses out-of-order samples and a mask without it', () => {
    const tiles = tileGrid(40, 3, 32);
    const acc = new PassAccumulator(40, 3, passMask(['alpha']), tiles);
    const t = tiles[1]; // 8 x 3 at x = 32
    const sample = (s: number) => new Float32Array(t.w * t.h).map((_, i) => ((i + s) % 3 === 0 ? 0 : 1));
    expect(acc.addAlpha(1, 0, 1, sample(0))).toBe(true);
    expect(acc.addAlpha(1, 2, 1, sample(2))).toBe(false); // out of order
    const two = new Float32Array(t.w * t.h * 2);
    two.set(sample(1));
    two.set(sample(2), t.w * t.h);
    expect(acc.addAlpha(1, 1, 2, two)).toBe(true);
    expect(acc.addAlpha(1, 3, 1, new Float32Array(2))).toBe(false); // too short
    const r = acc.resolve();
    expect(Object.keys(r).sort()).toEqual(['alpha', 'height', 'width']);
    const third = Math.fround(1 / 3);
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const i = y * t.w + x;
        const sum = Math.fround(Math.fround(sample(0)[i] + sample(1)[i]) + sample(2)[i]);
        expect(r.alpha![(t.y + y) * 40 + t.x + x], `value ${i}`).toBe(Math.fround(sum * third));
      }
    // The tile that got nothing is transparent.
    expect(r.alpha![0]).toBe(0);
    // Without the bit nothing is accepted.
    expect(new PassAccumulator(40, 3, passMask(['albedo']), tiles).addAlpha(1, 0, 1, sample(0))).toBe(false);
  });
});

describe.skipIf(!RT_WASM)('the alpha pass of the real rt.wasm, rendered the pool’s way (N2)', () => {
  it('is the native engine’s pinned plane on the example and on the E5 scene, and asking for it changes no pixel of the image', async () => {
    const rt = await loadRt();
    for (const [fixture, image, alpha] of [
      ['tests/fixtures/example.rsb', 'PINNED_EXAMPLE_4SPP', 'PINNED_PASS_ALPHA'],
      ['tests/fixtures/e5.rsb', 'PINNED_E5_HDRI_4SPP', 'PINNED_E5_PASS_ALPHA'],
    ] as const) {
      const rsb = new Uint8Array(readFileSync(fixture));
      const [w, h] = fixture.includes('example') ? [512, 384] : [160, 120];
      const { image: acc, passes } = renderWithPasses(rt, rsb, w, h, 4, ALPHA_BIT);
      expect(fnv1a(resolveRgb(acc, 4)), `${fixture}: the image`).toBe(pinned('engine/crates/rt-core/src/render.rs', image));
      expect(Object.keys(passes).sort(), 'only the alpha plane').toEqual(['alpha', 'height', 'width']);
      expect(fnv1a(passes.alpha!).toString(16), `${fixture}: the alpha`).toBe(pinned('engine/crates/rt-core/src/render/passes_tests.rs', alpha).toString(16));
      const values = new Set(passes.alpha);
      expect(values.has(0) && values.has(1) && values.size > 2, 'background, object and soft edges').toBe(true);
    }
  }, 120000);

  it('with the six X2 passes beside it, they keep their pinned hashes (appending the alpha moved none)', async () => {
    const rt = await loadRt();
    const rsb = new Uint8Array(readFileSync('tests/fixtures/example.rsb'));
    const { passes } = renderWithPasses(rt, rsb, 512, 384, 4, ALL | ALPHA_BIT);
    expect(passHashes(passes).map((x) => x.toString(16))).toEqual(pinnedPasses('').map((x) => x.toString(16)));
    expect(fnv1a(passes.alpha!)).toBe(pinned('engine/crates/rt-core/src/render/passes_tests.rs', 'PINNED_PASS_ALPHA'));
  }, 120000);

  it('is the objects of the X4 scene: 1 on every part, 0 on the floor and the background, soft only on the edges', async () => {
    const W = 192;
    const H = 108;
    const state = passScene(W, H);
    const { scene } = projectScene(state, { width: W, height: H, maxSamples: 1, maxSeconds: 0, passes: ['partId', 'alpha'] });
    expect(scene.render.passes).toBe(passMask(['partId', 'alpha']));
    const rt = await loadRt();
    const { passes } = renderWithPasses(rt, writeRsb(scene), W, H, 4, passMask(['partId', 'alpha']));
    let parts = 0;
    let other = 0;
    let soft = 0;
    for (let i = 0; i < W * H; i++) {
      const id = passes.partId![i];
      const a = passes.alpha![i];
      if (a > 0 && a < 1) soft++;
      else if (id !== 0 && id !== FLOOR_ID) {
        // The centre of the pixel is on a part; the pixel is not soft: all its samples are on parts.
        expect(a, `pixel ${i}`).toBe(1);
        parts++;
      } else if (a === 0) other++;
    }
    expect(parts).toBeGreaterThan(2000);
    expect(other).toBeGreaterThan(2000);
    expect(soft).toBeGreaterThan(20);
    // A pixel whose centre ray sees the studio floor, and none of the samples touch a part: alpha 0.
    const floorOnly = Array.from({ length: W * H }, (_, i) => i).filter((i) => passes.partId![i] === FLOOR_ID && passes.alpha![i] === 0);
    expect(floorOnly.length).toBeGreaterThan(1000);
  }, 120000);
});

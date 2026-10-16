// Phase E10 on the page: adaptive sampling. The port of rt_core::adaptive (render/adaptive.ts) against the engine's
// pinned decisions of a synthetic image, the accumulator's counts per block, the live view's picture of an adaptive
// render (U14), the pass schedule with its noise target and time limit, the settings and the RSB fields, and, with
// the real rt.wasm, the E10 scene rendered through the page's own code to the engine's pinned image.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adaptiveOf, clampNoiseThreshold, defaultRenderSettings, DEFAULT_NOISE_THRESHOLD, migrateRender, noiseFraction, patchSettings } from '../src/core/render';
import { AdaptiveState, BLOCK, decide, floorFor, pixelError, rescale, rescaledSums, UNMEASURED, WARMUP, type Decision } from '../src/render/adaptive';
import { LivePicture } from '../src/render/live-frame';
import { adaptiveProgress, budgetLimits, runAdaptive } from '../src/render/schedule';
import { Accumulator, luminanceF32 } from '../src/render/tiles';
import { DisplayCurve } from '../src/render/tonemap';
import { readRender } from './rsb-reader';
import { fnv1a, loadRt, pinned, RT_WASM } from './wasm-engine';

const ADAPTIVE_RS = 'engine/crates/rt-core/src/adaptive/tests.rs';
const f = Math.fround;

/** FNV-1a over bytes (the engine's test hash). */
function fnvBytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  return h;
}

/** rt_core::adaptive::tests::synthetic: a colour and a spread per pixel from an integer hash, the sums of the counts. */
function synthetic(ad: AdaptiveState, width: number, height: number, round: number): { sums: Float32Array; lum2: Float32Array } {
  const hash = (v: number) => {
    let x = v >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x;
  };
  const sums = new Float32Array(width * height * 4);
  const lum2 = new Float32Array(width * height);
  const [R, G, B] = [f(0.2126), f(0.7152), f(0.0722)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const v = hash((Math.imul(p, 2654435761) ^ Math.imul(round, 0x9e3779b9)) >>> 0);
      const n = ad.samplesOf(ad.blockOf(x, y));
      const c = [f((v & 0xff) / 255), f(((v >>> 8) & 0xff) / 255), f(((v >>> 16) & 0xff) / 255)];
      const spread = f(f(f(((v >>> 24) & 0xff) / 255) * f(x < Math.floor(width / 3) ? 0.5 : 0.05)) * (y < 9 ? 2 : 1));
      const l = f(f(f(R * c[0]) + f(G * c[1])) + f(B * c[2]));
      sums.set([f(c[0] * n), f(c[1] * n), f(c[2] * n), n], p * 4);
      lum2[p] = f(f(f(l * l) + f(spread * spread)) * n);
    }
  }
  return { sums, lum2 };
}

describe('the port of the decision', () => {
  it('gives the engine’s pinned decisions of a synthetic image, bit for bit (PINNED_E10_DECISIONS)', () => {
    const [w, h] = [45, 37];
    const ad = new AdaptiveState(w, h, { ev: 0.5, target: 0.02, cap: 200 });
    const bytes: number[] = [];
    const word = (v: number) => bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    const bits = (v: number) => word(new Uint32Array(Float32Array.of(v).buffer)[0]);
    for (let round = 0; round < 6; round++) {
      ad.advance(ad.left);
      const { sums, lum2 } = synthetic(ad, w, h, round);
      const d = ad.decide(sums, 4, lum2);
      [d.round, d.active, d.blocks].forEach(word);
      [d.threshold, d.maxError, d.remaining].forEach(bits);
      for (const a of ad.active) bytes.push(a);
      if (ad.converged) break;
    }
    expect(fnvBytes(Uint8Array.from(bytes))).toBe(pinned(ADAPTIVE_RS, 'PINNED_E10_DECISIONS'));
  });

  it('measures the relative error of a pixel’s mean as the engine does', () => {
    const grey = (n: number, mean: number, spread: number) => {
      let s = 0;
      let l2 = 0;
      for (let i = 0; i < n; i++) {
        const v = f(i % 2 === 0 ? mean + spread : mean - spread);
        s = f(s + v);
        const l = luminanceF32(v, v, v);
        l2 = f(l2 + f(l * l));
      }
      return { s, l2 };
    };
    const floor = floorFor(0);
    expect(floor).toBe(f(0.01));
    const exact = grey(16, 0.5, 0);
    expect(pixelError(exact.s, exact.s, exact.s, exact.l2, 16, floor)).toBe(0);
    const noisy = grey(16, 0.5, 0.1);
    const e = pixelError(noisy.s, noisy.s, noisy.s, noisy.l2, 16, floor);
    expect(e).toBeCloseTo(Math.sqrt(0.01 / 15) / 0.51, 4);
    expect(pixelError(1, 1, 1, 1, 1, floor)).toBe(UNMEASURED);
    expect(pixelError(Number.NaN, 1, 1, 1, 8, floor)).toBe(UNMEASURED);
    expect(floorFor(2)).toBeLessThan(floor * 0.26);
  });

  it('sends the next round to the noisy blocks, and converges under the target or at the cap', () => {
    const [w, h] = [64, 16];
    const counts = new Int32Array(16).fill(16);
    const sums = new Float32Array(w * h * 4);
    const lum2 = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const spread = x < 32 ? 0.2 : 0;
        let s = 0;
        let l2 = 0;
        for (let i = 0; i < 16; i++) {
          const v = f(i % 2 === 0 ? 0.5 + spread : 0.5 - spread);
          s = f(s + v);
          l2 = f(l2 + f(v * v));
        }
        sums.set([s, s, s, 16], p * 4);
        lum2[p] = l2;
      }
    }
    const active = new Uint8Array(16);
    const d: Decision = decide(w, h, counts, sums, 4, lum2, floorFor(0), 0, 0, active);
    expect(d.round).toBe(16);
    for (let b = 0; b < 16; b++) if (active[b]) expect(b % 8).toBeLessThan(4);
    expect(decide(w, h, counts, sums, 4, lum2, floorFor(0), 0.5, 0, active).round).toBe(0);
    expect(decide(w, h, counts, sums, 4, lum2, floorFor(0), 0, 16, active).round).toBe(0);
  });

  it('rescales a sum of n samples to s, leaving equal counts alone', () => {
    expect(rescale(3, 4, 4)).toBe(3);
    expect(rescale(3, 0, 4)).toBe(0);
    expect(rescale(3, 6, 16) / 16).toBeCloseTo(0.5, 6);
    const acc = new Accumulator(16, 8, undefined, { blocks: true });
    acc.blockSamples.set([16, 32]);
    acc.sum.fill(16);
    const out = rescaledSums(acc.sum, 16, 8, acc.blockSamples, 32);
    expect(out[0]).toBe(f(f(16 * f(1 / 16)) * 32));
    expect(out[(0 * 16 + 9) * 4]).toBe(16);
  });
});

describe('the accumulator of an adaptive render', () => {
  it('adds a block’s samples where it stopped, counts them per block, and shows each pixel with its own count', () => {
    const acc = new Accumulator(40, 16, undefined, { blocks: true });
    expect(acc.adaptive).toBe(true);
    expect(acc.blockSamples.length).toBe(5 * 2);
    // The first round: whole tiles, every block of them.
    const tile = acc.tiles[0];
    const data = new Float32Array(2 * tile.w * tile.h * 4).fill(0.5);
    for (let i = 3; i < data.length; i += 4) data[i] = 1;
    expect(acc.add(0, 0, 2, data)).toBe(true);
    expect(Array.from(acc.blockSamples)).toEqual([2, 2, 2, 2, 0, 2, 2, 2, 2, 0]);
    // A block of a round: only from where it is, in order.
    const block = new Float32Array(3 * 8 * 8 * 4).fill(2);
    for (let i = 3; i < block.length; i += 4) block[i] = 1;
    expect(acc.addBlock(1, 8, 0, 8, 8, 0, 3, block)).toBe(false);
    expect(acc.addBlock(1, 8, 0, 8, 8, 2, 3, block)).toBe(true);
    expect(acc.blockSamples[1]).toBe(5);
    expect(acc.sampleRange).toEqual({ min: 0, max: 5 });
    expect(acc.samplesAt(9)).toBe(5);
    expect(acc.samplesAt(0)).toBe(2);
    // The squared luminance of every sample, f32, as Film::splat_alpha.
    const l = luminanceF32(2, 2, 2);
    const l0 = luminanceF32(0.5, 0.5, 0.5);
    expect(acc.lum2[9]).toBe(f(f(f(f(l0 * l0) + f(l0 * l0)) + f(l * l)) + f(l * l)) + f(l * l));
    // Shown: a pixel of block 0 is 0.5, one of block 1 (2 × 0.5 + 3 × 2) / 5.
    const bytes = new Uint8ClampedArray(tile.w * tile.h * 4);
    acc.tileBytes(0, new DisplayCurve(0, 0), bytes);
    expect(bytes[0]).toBeLessThan(bytes[9 * 4]);
  });

  it('U14: the live view’s picture of it divides every pixel by its own count (blocks of 8)', () => {
    const [w, h] = [16, 8];
    const sum = new Float32Array(w * h * 4);
    const counts = Int32Array.of(16, 64);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = counts[x < 8 ? 0 : 1];
        // Every pixel's mean is 0.25 whatever its count.
        sum.set([0.25 * n, 0.25 * n, 0.25 * n, n], (y * w + x) * 4);
      }
    }
    const curve = new DisplayCurve(0, 0);
    const pic = new LivePicture(w, h, 4, BLOCK);
    pic.update(sum, counts, curve);
    // Every box reads the same mean, the boxes over the many-sample block as those over the few.
    const first = Array.from(pic.rgba.subarray(0, 4));
    for (let i = 0; i < pic.width * pic.height; i++) expect(Array.from(pic.rgba.subarray(i * 4, i * 4 + 4))).toEqual(first);
    // With the tiles' counts it would be wrong: the picture needs the blocks'.
    const wrong = new LivePicture(w, h, 4);
    wrong.update(sum, Int32Array.of(16), curve);
    expect(Array.from(wrong.rgba.subarray(3 * 4, 3 * 4 + 4))).not.toEqual(first);
  });
});

describe('the passes of an adaptive render', () => {
  /** A fake engine: every block's noise falls as 1/sqrt(n) from where it starts (the left blocks are noisier). */
  function fakeImage(ad: AdaptiveState, w: number, h: number): { sums: Float32Array; lum2: Float32Array } {
    const sums = new Float32Array(w * h * 4);
    const lum2 = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = ad.samplesOf(ad.blockOf(x, y));
        const spread = x < w / 2 ? 0.3 : 0.02;
        const p = y * w + x;
        sums.set([f(0.5 * n), f(0.5 * n), f(0.5 * n), n], p * 4);
        const l = luminanceF32(0.5, 0.5, 0.5);
        lum2[p] = f(f(f(l * l) + f(spread * spread)) * n);
      }
    }
    return { sums, lum2 };
  }

  it('goes round by round, ends when every block is under the target, and says how long it expects', async () => {
    const [w, h] = [32, 16];
    const ad = new AdaptiveState(w, h, { ev: 0, target: 0.02, cap: 4096 });
    let clock = 0;
    const passes: { first: number; count: number; warm: boolean }[] = [];
    const etas: number[] = [];
    const result = await runAdaptive({ finishBy: 'NOISE', maxSamples: 4096, maxSeconds: 0 }, ad, {
      now: () => clock,
      pass: async (first, count) => {
        passes.push({ first, count, warm: ad.warmingUp });
        clock += ad.passCost(count) * 0.001;
        return true;
      },
      decide: () => {
        const { sums, lum2 } = fakeImage(ad, w, h);
        return ad.decide(sums, 4, lum2);
      },
      progress: (_s, _ms, eta) => etas.push(eta),
    });
    expect(result.reason).toBe('SAMPLES');
    expect(ad.converged).toBe(true);
    // The first round is every pixel's WARMUP samples, in passes of 1, 2, 4, 8 and the rest.
    expect(passes.filter((p) => p.warm).map((p) => p.count)).toEqual([1, 2, 4, 8, 1]);
    expect(passes.filter((p) => p.warm).reduce((n, p) => n + p.count, 0)).toBe(WARMUP);
    // The noisy half took more samples than the clean one, which stopped after the first round.
    expect(ad.samplesOf(0)).toBeGreaterThan(ad.samplesOf(ad.blockOf(w - 1, 0)));
    expect(ad.samplesOf(ad.blockOf(w - 1, 0))).toBe(WARMUP);
    expect(result.samples).toBe(ad.minMax().max);
    // After the first decision there is an estimate, and it falls.
    const known = etas.filter((e) => e >= 0);
    expect(known.length).toBeGreaterThan(2);
    expect(known[known.length - 1]).toBeLessThan(known[0]);
    expect(adaptiveProgress({ finishBy: 'NOISE', maxSamples: 4096, maxSeconds: 0 }, 32, 1000, 3)).toBeCloseTo(0.25, 5);
  });

  it('stops between passes near its time limit, and by noise its samples are the cap', async () => {
    expect(budgetLimits({ finishBy: 'NOISE', maxSamples: 300, maxSeconds: 9 })).toEqual({ samples: 300, ms: Infinity });
    const [w, h] = [32, 16];
    const ad = new AdaptiveState(w, h, { ev: 0, target: 0, cap: 0 });
    let clock = 0;
    const result = await runAdaptive({ finishBy: 'TIME', maxSamples: 0, maxSeconds: 1 }, ad, {
      now: () => clock,
      pass: async (_first, count) => {
        clock += ad.passCost(count) * 0.01;
        return true;
      },
      decide: () => {
        const { sums, lum2 } = fakeImage(ad, w, h);
        return ad.decide(sums, 4, lum2);
      },
    });
    expect(result.reason).toBe('TIME');
    expect(result.elapsedMs).toBeGreaterThan(900);
    expect(result.elapsedMs).toBeLessThan(1400);
  });
});

describe('Finish by Noise', () => {
  it('is a choice of the settings, with a threshold of 0.5 to 5 % (1 % by default), kept by a saved project', () => {
    const s = defaultRenderSettings();
    expect(s.noiseThreshold).toBe(DEFAULT_NOISE_THRESHOLD);
    const noisy = patchSettings(s, { finishBy: 'NOISE', noiseThreshold: 9 });
    expect([noisy.finishBy, noisy.noiseThreshold]).toEqual(['NOISE', 5]);
    expect(patchSettings(s, { noiseThreshold: 0.123 }).noiseThreshold).toBe(0.5);
    expect(clampNoiseThreshold(1.26)).toBe(1.3);
    expect(noiseFraction(1)).toBe(0.01);
    expect(adaptiveOf(noisy)).toEqual({ adaptive: { noiseThreshold: 0.05 } });
    expect(adaptiveOf(s)).toEqual({});
    const back = migrateRender(JSON.parse(JSON.stringify({ ...noisy, queue: [] })));
    expect([back.finishBy, back.noiseThreshold]).toEqual(['NOISE', 5]);
    // A project of before has none: 1 %.
    const old = migrateRender({ finishBy: 'SAMPLES', maxSamples: 64 });
    expect(old.noiseThreshold).toBe(DEFAULT_NOISE_THRESHOLD);
  });
});

const live = RT_WASM ? describe : describe.skip;

live('the E10 scene with the real rt.wasm through the page’s code', () => {
  it('is the engine’s pinned adaptive image (PINNED_E10_ADAPTIVE), with its range of samples', async () => {
    const path = 'tests/fixtures/e10.rsb';
    expect(existsSync(path)).toBe(true);
    const rsb = new Uint8Array(readFileSync(path));
    const rt = await loadRt();
    const ext = rt as unknown as { rt_render_block_rgba?: (h: number, x: number, y: number, w: number, hh: number, s: number, it: number, out: number) => number };
    if (typeof ext.rt_render_block_rgba !== 'function') throw new Error('this rt.wasm samples no blocks: npm run engine:build');
    // The scene's budget from its RNDR section.
    const v = new DataView(rsb.buffer, rsb.byteOffset, rsb.byteLength);
    let render = null;
    for (let pos = 8 + v.getUint32(4, true); pos + 8 <= rsb.length; ) {
      const tag = String.fromCharCode(...rsb.subarray(pos, pos + 4));
      const len = v.getUint32(pos + 4, true);
      if (tag === 'RNDR') render = readRender(new DataView(rsb.buffer, rsb.byteOffset + pos + 8, len));
      pos += 8 + len;
    }
    if (!render) throw new Error('no RNDR');
    expect(render.adaptive).toBe(1);
    const { width, height } = render;
    const ptr = rt.rt_alloc(rsb.length);
    new Uint8Array(rt.memory.buffer, ptr, rsb.length).set(rsb);
    const handle = rt.rt_scene_load(ptr, rsb.length);
    rt.rt_free(ptr, rsb.length);
    expect(handle).not.toBe(0);
    const ad = new AdaptiveState(width, height, { ev: render.exposureEv, target: render.noiseThreshold ?? 0, cap: render.maxSamples });
    const acc = new Accumulator(width, height, undefined, { blocks: true });
    const out = rt.rt_alloc(32 * 32 * 16);
    try {
      for (;;) {
        if (ad.left === 0) {
          ad.decide(acc.sum, 4, acc.lum2);
          if (ad.converged) break;
        }
        // Passes of 5 samples (where a round is cut changes no pixel).
        const count = Math.min(5, ad.left);
        if (ad.warmingUp) {
          for (const t of acc.tiles) {
            const data = new Float32Array(count * t.w * t.h * 4);
            for (let s = 0; s < count; s++) {
              expect(rt.rt_render_tile_rgba(handle, t.x, t.y, t.w, t.h, ad.iteration + s, out)).toBe(0);
              data.set(new Float32Array(rt.memory.buffer, out, t.w * t.h * 4), s * t.w * t.h * 4);
            }
            expect(acc.add(t.index, acc.samples[t.index], count, data)).toBe(true);
          }
        } else {
          for (const b of ad.work(count)) {
            const data = new Float32Array(b.count * b.w * b.h * 4);
            for (let s = 0; s < b.count; s++) {
              expect(ext.rt_render_block_rgba(handle, b.x, b.y, b.w, b.h, b.first + s, ad.iteration + s, out)).toBe(0);
              data.set(new Float32Array(rt.memory.buffer, out, b.w * b.h * 4), s * b.w * b.h * 4);
            }
            expect(acc.addBlock(b.block, b.x, b.y, b.w, b.h, b.first, b.count, data)).toBe(true);
          }
        }
        ad.advance(count);
      }
    } finally {
      rt.rt_free(out, 32 * 32 * 16);
      rt.rt_scene_free(handle);
    }
    // Each pixel divided by its own count (Film::resolve).
    const rgb = new Float32Array(width * height * 3);
    for (let p = 0; p < width * height; p++) {
      const inv = f(1 / acc.samplesAt(p));
      for (let c = 0; c < 3; c++) rgb[p * 3 + c] = f(acc.sum[p * 4 + c] * inv);
    }
    expect(fnv1a(rgb)).toBe(pinned(ADAPTIVE_RS, 'PINNED_E10_ADAPTIVE'));
    const m = /PINNED_E10_SAMPLES: \(u32, u32\) = \((\d+), (\d+)\);/.exec(readFileSync(ADAPTIVE_RS, 'utf8'));
    expect(m).not.toBeNull();
    expect(acc.sampleRange).toEqual({ min: Number(m![1]), max: Number(m![2]) });
  }, 300_000);
});

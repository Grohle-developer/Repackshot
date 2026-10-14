// Phase E5b-1 on the page: the settings (denoise, caustics), the denoiser's bands and their input, the squared
// luminance the accumulator sums, the pool's viewport and Render with denoise (stand-in workers), and, with the
// real rt.wasm, the engine's pinned denoised and caustic images through the page's own code.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoCaustics, causticsFields, CAUSTICS_PRESETS, denoiseBits, denoiseIn, lightAngleDeg, toggledViewportDenoise, DENOISE_IMAGE, DENOISE_KEEP_NOISY } from '../src/core/caustics';
import { DEFAULT_ADVANCED, defaultRenderSettings, engineFieldsOf, migrateRender, patchSettings } from '../src/core/render';
import { DENOISE_GUIDE_MASK, DENOISE_HALO, denoiseBand, denoiseBands, denoiseImage, hasDenoiseExport, MIN_BAND_ROWS, packBand } from '../src/render/denoise';
import { Accumulator, luminanceF32 } from '../src/render/tiles';
import { noisyName } from '../src/ui/render-queue';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

describe('denoise and caustics settings', () => {
  it('default to denoise both ways and automatic caustics, also for a project from before E5b-1', () => {
    expect(defaultRenderSettings().advanced).toEqual(DEFAULT_ADVANCED);
    expect([DEFAULT_ADVANCED.denoise, DEFAULT_ADVANCED.caustics, DEFAULT_ADVANCED.causticsQuality, DEFAULT_ADVANCED.saveNoisy]).toEqual(['BOTH', 'AUTO', 'MEDIUM', false]);
    const old = migrateRender({ advanced: { maxBounces: 4, clampIndirect: 2, seed: 9 } });
    expect(old.advanced).toEqual({ ...DEFAULT_ADVANCED, maxBounces: 4, clampIndirect: 2, seed: 9 });
    const saved = migrateRender({ advanced: { maxBounces: null, clampIndirect: 0, seed: 0, denoise: 'RENDER', saveNoisy: true, caustics: 'OFF', causticsQuality: 'HIGH' } });
    expect(saved.advanced).toMatchObject({ denoise: 'RENDER', saveNoisy: true, caustics: 'OFF', causticsQuality: 'HIGH' });
    // Nonsense becomes the default, through the store's patch too.
    const bad = patchSettings(defaultRenderSettings(), { advanced: { ...DEFAULT_ADVANCED, denoise: 'LOUD' as never, caustics: 7 as never, causticsQuality: 'ULTRA' as never } });
    expect([bad.advanced.denoise, bad.advanced.caustics, bad.advanced.causticsQuality]).toEqual(['BOTH', 'AUTO', 'MEDIUM']);
  });

  it('the viewport and the render each denoise as the mode says; the viewport never keeps the noisy image', () => {
    expect(['OFF', 'VIEWPORT', 'RENDER', 'BOTH'].map((m) => [denoiseIn(m as never, 'VIEWPORT'), denoiseIn(m as never, 'RENDER')])).toEqual([
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]);
    expect(denoiseBits('BOTH', 'RENDER', true)).toBe(DENOISE_IMAGE | DENOISE_KEEP_NOISY);
    expect(denoiseBits('BOTH', 'VIEWPORT', true)).toBe(DENOISE_IMAGE);
    expect(denoiseBits('VIEWPORT', 'RENDER', true)).toBe(0);
    // The Full viewport's switch flips only the viewport's part.
    expect(['OFF', 'VIEWPORT', 'RENDER', 'BOTH'].map((m) => toggledViewportDenoise(m as never))).toEqual(['VIEWPORT', 'OFF', 'BOTH', 'RENDER']);
    expect(engineFieldsOf({ ...DEFAULT_ADVANCED, saveNoisy: true }, 'RENDER')).toEqual({ denoise: 3, caustics: { mode: 'AUTO', quality: 'MEDIUM' } });
  });

  it('caustics: the quality is photons per sample and a first radius; Automatic needs a caster and a small light', () => {
    expect(causticsFields('ON', 'LOW', false)).toEqual({ photons: CAUSTICS_PRESETS.LOW.photons, radiusPx: CAUSTICS_PRESETS.LOW.radiusPx });
    expect(causticsFields('OFF', 'HIGH', true)).toEqual({ photons: 0, radiusPx: 0 });
    expect(causticsFields('AUTO', 'MEDIUM', false).photons).toBe(0);
    expect(causticsFields('AUTO', 'MEDIUM', true).photons).toBe(CAUSTICS_PRESETS.MEDIUM.photons);
    const panel = (size: number, z: number) => ({ kind: 0, position: [0, 0, z] as [number, number, number], sizeX: size, sizeY: size, angleDeg: 0, glossy: true });
    // A 40 mm panel 500 mm away subtends 4.6°; a 600 mm softbox at the same distance, 62°.
    expect(lightAngleDeg(panel(40, 500), [0, 0, 0])).toBeCloseTo(4.58, 2);
    expect(autoCaustics([0, 0, 0], [panel(40, 500)], false)).toBe(true);
    expect(autoCaustics([0, 0, 0], [panel(600, 500)], false)).toBe(false);
    expect(autoCaustics([0, 0, 0], [{ ...panel(40, 500), glossy: false }], false)).toBe(false);
    expect(autoCaustics(null, [panel(40, 500)], true)).toBe(false);
    expect(autoCaustics([0, 0, 0], [], true)).toBe(true);
  });

  it('the image before denoise is saved as <name>-noisy', () => {
    expect(noisyName('Render 3.png')).toBe('Render 3-noisy.png');
    expect(noisyName('out/a.b.exr')).toBe('out/a.b-noisy.exr');
    expect(noisyName('plain')).toBe('plain-noisy');
  });
});

describe('the denoiser’s input on the page', () => {
  it('cuts bands of at least 192 rows with a halo of 72 within the image', () => {
    expect(denoiseBands(100, 8)).toEqual([{ y0: 0, y1: 100, lo: 0, hi: 100 }]);
    const bands = denoiseBands(1080, 7);
    expect(bands).toHaveLength(5);
    expect(bands.every((b) => b.y1 - b.y0 >= MIN_BAND_ROWS)).toBe(true);
    expect(bands[0]).toEqual({ y0: 0, y1: 216, lo: 0, hi: 216 + DENOISE_HALO });
    expect(bands[4].hi).toBe(1080);
    expect(bands.map((b) => b.y0).concat(1080)).toEqual([0, 216, 432, 648, 864, 1080]);
  });

  it('packs the planes in the order of rt_wasm::denoise', () => {
    const w = 2;
    const h = 3;
    const n = w * h;
    const sums = Float32Array.from({ length: n * 4 }, (_, i) => i);
    const lum2 = Float32Array.from({ length: n }, (_, i) => 100 + i);
    const passes = {
      width: w,
      height: h,
      albedo: Float32Array.from({ length: n * 3 }, (_, i) => 200 + i),
      normal: Float32Array.from({ length: n * 3 }, (_, i) => 300 + i),
      depth: Float32Array.from({ length: n }, (_, i) => 400 + i),
      partId: Uint32Array.from({ length: n }, (_, i) => 500 + i),
      materialId: Uint32Array.from({ length: n }, (_, i) => 600 + i),
    };
    const words = packBand(w, sums, lum2, passes, 1, 3);
    const m = 4;
    const f = new Float32Array(words.buffer);
    expect(words.length).toBe(m * 14);
    expect(Array.from(f.subarray(0, 4))).toEqual([8, 9, 10, 11]);
    expect([f[m * 4], f[m * 5], f[m * 8], f[m * 11], words[m * 12], words[m * 13]]).toEqual([102, 206, 306, 402, 502, 602]);
  });

  it('sums the squared luminance of every sample in f32, as Film::splat_alpha does', () => {
    const acc = new Accumulator(2, 1, [{ index: 0, x: 0, y: 0, w: 2, h: 1 }], { lum2: true });
    const data = Float32Array.from([0.3, 0.6, 0.9, 1, 2, 0, 0, 1, 0.1, 0.2, 0.3, 1, 1, 1, 1, 1]);
    expect(acc.add(0, 0, 2, data)).toBe(true);
    const f = Math.fround;
    const l = (r: number, g: number, b: number) => f(f(f(f(0.2126) * f(r)) + f(f(0.7152) * f(g))) + f(f(0.0722) * f(b)));
    const sq = (x: number) => f(x * x);
    expect(luminanceF32(f(0.3), f(0.6), f(0.9))).toBe(l(0.3, 0.6, 0.9));
    expect(acc.lum2[0]).toBe(f(sq(l(0.3, 0.6, 0.9)) + sq(l(0.1, 0.2, 0.3))));
    expect(acc.lum2[1]).toBe(f(sq(l(2, 0, 0)) + sq(l(1, 1, 1))));
    // Without it nothing is summed (the plain image costs nothing more).
    expect(new Accumulator(2, 1).lum2.length).toBe(0);
  });

  it('puts the bands back where they belong, whatever the number of workers', async () => {
    const w = 3;
    const h = 500;
    const sums = Float32Array.from({ length: w * h * 4 }, (_, i) => i % 97);
    const lum2 = new Float32Array(w * h);
    const passes = { width: w, height: h, albedo: new Float32Array(w * h * 3), normal: new Float32Array(w * h * 3), depth: new Float32Array(w * h), partId: new Uint32Array(w * h), materialId: new Uint32Array(w * h) };
    // A stand-in band filter: the band's own rows of the sums.
    const echo = async (job: { width: number; band: { y0: number; y1: number; lo: number }; input: Uint32Array }) =>
      new Float32Array(job.input.buffer, (job.band.y0 - job.band.lo) * job.width * 16, (job.band.y1 - job.band.y0) * job.width * 4).slice();
    for (const workers of [1, 2, 7]) expect(await denoiseImage(w, h, 4, sums, lum2, passes, workers, echo)).toEqual(sums);
    // Without the guides: nothing.
    expect(await denoiseImage(w, h, 4, sums, lum2, { width: w, height: h }, 2, echo)).toBeNull();
  });
});

const live = RT_WASM ? describe : describe.skip;

live('the engine’s denoiser and caustics through the page’s code (the real rt.wasm)', () => {
  it('denoises the example to rt-post’s pinned image with any number of bands', async () => {
    const rt = await loadRt();
    if (!hasDenoiseExport(rt)) throw new Error(`${RT_WASM} has no rt_denoise: npm run engine:build`);
    const rsb = new Uint8Array(readFileSync('tests/fixtures/example.rsb'));
    const { image, passes } = renderWithPasses(rt, rsb, 512, 384, 4, DENOISE_GUIDE_MASK, { lum2: true });
    // The image keeps its own pinned hash.
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_EXAMPLE_4SPP'));
    const want = pinned('engine/crates/rt-post/src/denoise/tests.rs', 'PINNED_DENOISED_EXAMPLE_4SPP');
    for (const workers of [1, 2]) {
      const clean = await denoiseImage(512, 384, 4, image.sum, image.lum2, passes, workers, async (job) => denoiseBand(rt, job));
      const mean = new Accumulator(512, 384, image.tiles);
      mean.sum.set(clean!);
      expect(fnv1a(resolveRgb(mean, 4)), `${workers} workers`).toBe(want);
    }
  }, 120_000);

  it('renders the caustics of the E5b scene to rt-core’s pinned image, each worker tracing its photon maps', async () => {
    const rt = (await loadRt()) as Awaited<ReturnType<typeof loadRt>> & { rt_scene_caustics(h: number): number };
    const rsb = new Uint8Array(readFileSync('tests/fixtures/e5b.rsb'));
    const ptr = rt.rt_alloc(rsb.length);
    new Uint8Array(rt.memory.buffer, ptr, rsb.length).set(rsb);
    const handle = rt.rt_scene_load(ptr, rsb.length);
    rt.rt_free(ptr, rsb.length);
    expect(rt.rt_scene_caustics(handle)).toBe(2048);
    rt.rt_scene_free(handle);
    const { image } = renderWithPasses(rt, rsb, 160, 120, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_E5B_CAUSTICS_4SPP'));
  }, 120_000);
});

// The synthetic AI service (phase X4): a control at 0 leaves its aspect alone, everything at 0 gives the input
// bit for bit, the change is a smooth gain on the engine image, the same request gives the same pixels, the
// report is measured on what was done, and the guard's retry rule applies. Plus the colour difference and the
// measures it reports with.

import { describe, expect, it } from 'vitest';
import { createSyntheticService, SYNTHETIC_LIMITS, SYNTHETIC_MODEL_KEY, applySynthetic, edgeDisplacement, highBandSsim, pixelsOutside, regionName, sharpnessDeviation, softLuminance, weightsOf, type SyntheticLimits } from '../src/ai/synthetic';
import { deltaE2000, linearRgbToLab } from '../src/ai/color';
import { DEFAULT_AI_PIPELINE, MAX_ATTEMPTS, type AiPipelineSettings, type AiPostProgress, type AiPostResult, type LinearImage } from '../src/core/ai';
import { byteToLinear, linearToByte, linearToRgba8, luminance, rgba8ToLinear, sameImage, srgbToLinear, linearToSrgb } from '../src/core/ai-image';
import { FLOOR_ID, type RenderPasses } from '../src/core/passes';

const W = 96;
const H = 64;

/** A small deterministic scene: a lit background, a textured bottle (part 1, material 1) and a dark box (part 2, material 2). */
function scene(): { image: LinearImage; passes: RenderPasses } {
  const rgba = new Float32Array(W * H * 4);
  const partId = new Uint32Array(W * H);
  const materialId = new Uint32Array(W * H);
  let seed = 12345;
  const noise = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let r: number;
      let g: number;
      let b: number;
      if (x >= 12 && x < 52 && y >= 8 && y < 58) {
        // The bottle: a vertical gradient with fine texture (stripes and a little noise).
        const base = 0.1 + 0.5 * (y - 8) / 50;
        const stripe = (x + y) % 6 < 3 ? 0.06 : 0;
        [r, g, b] = [base * 0.9 + stripe + 0.01 * noise(), base * 0.4 + stripe + 0.01 * noise(), base * 0.2 + stripe + 0.01 * noise()];
        partId[i] = 1;
        materialId[i] = 1;
      } else if (x >= 60 && x < 88 && y >= 30 && y < 58) {
        // The box: dark, in the shadow.
        [r, g, b] = [0.03 + 0.01 * noise(), 0.035 + 0.01 * noise(), 0.05 + 0.01 * noise()];
        partId[i] = 2;
        materialId[i] = 2;
      } else {
        const v = 0.35 + 0.3 * (x / W);
        [r, g, b] = [v, v, v * 1.02];
      }
      rgba.set([Math.max(0, r), Math.max(0, g), Math.max(0, b), 1], i * 4);
    }
  }
  return { image: { width: W, height: H, rgba }, passes: { width: W, height: H, partId, materialId } };
}

const OFF: AiPipelineSettings = { intervention: 100, light: 0, bounce: 0, wear: 0, style: 'NATURAL', styleStrength: 0, seed: 7 };
const never = new AbortController().signal;

async function run(settings: AiPipelineSettings, opts: Parameters<typeof createSyntheticService>[0] = {}, withPasses = true): Promise<AiPostResult & { progress: AiPostProgress[] }> {
  const { image, passes } = scene();
  const progress: AiPostProgress[] = [];
  const svc = createSyntheticService(opts);
  const res = await svc.post({ source: { kind: 'INLINE', image, passes: withPasses ? passes : { width: W, height: H } }, settings, prompt: '', negative: '', modelKey: SYNTHETIC_MODEL_KEY }, (p) => progress.push(p), never);
  return { ...res, progress };
}

const luma = (img: LinearImage) => {
  const y = new Float32Array(img.width * img.height);
  for (let i = 0; i < y.length; i++) y[i] = luminance(img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]);
  return y;
};

/** Mean absolute change of the colour channels. */
function change(a: LinearImage, b: LinearImage): number {
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) for (let c = 0; c < 3; c++) n += Math.abs(a.rgba[i + c] - b.rgba[i + c]);
  return n / (a.width * a.height * 3);
}

describe('the synthetic service', () => {
  it('is always available, backend SYNTHETIC, and needs no model', async () => {
    const st = await createSyntheticService().status();
    expect(st).toMatchObject({ available: true, backend: 'SYNTHETIC', activeModel: SYNTHETIC_MODEL_KEY });
    expect(st.reason).toBeUndefined();
    expect(st.supports.length).toBeGreaterThan(0);
  });

  it('with everything at 0 returns the input bit for bit, as a copy', async () => {
    const { image } = scene();
    const cases: AiPipelineSettings[] = [
      { ...OFF }, // every aspect at 0
      { ...OFF, style: 'WARM', styleStrength: 0 }, // a style at no strength
      { ...OFF, style: 'NATURAL', styleStrength: 100 }, // Natural adds nothing
      { intervention: 0, light: 100, bounce: 100, wear: 100, style: 'CINEMATIC', styleStrength: 100, seed: 3 }, // Intervention 0 scales it all away
      { ...OFF, wear: 100 }, // wear has nothing to add
    ];
    for (const settings of cases) {
      const res = await run(settings);
      expect(sameImage(res.image, image), JSON.stringify(settings)).toBe(true);
      expect(res.image.rgba).not.toBe(image.rgba);
      expect(res.report).toMatchObject({ verdict: 'ACCEPTED', usedFraction: 1, attempts: 1 });
    }
  });

  it('each control at 0 leaves its aspect unchanged, and above 0 changes it', async () => {
    const { image } = scene();
    for (const key of ['light', 'bounce'] as const) {
      expect(sameImage((await run({ ...OFF, [key]: 0 })).image, image), `${key} at 0`).toBe(true);
      expect(change((await run({ ...OFF, [key]: 60 })).image, image), `${key} at 60`).toBeGreaterThan(1e-4);
    }
    expect(sameImage((await run({ ...OFF, style: 'WARM', styleStrength: 0 })).image, image)).toBe(true);
    expect(change((await run({ ...OFF, style: 'WARM', styleStrength: 60 })).image, image)).toBeGreaterThan(1e-4);
    // Wear adds nothing, whatever its value.
    expect(sameImage((await run({ ...OFF, wear: 80 })).image, image)).toBe(true);
    // A control at 0 does not switch the others off: Light alone is still Light when Bounces are asked as well.
    const both = (await run({ ...OFF, light: 60, bounce: 60 })).image;
    const lightOnly = (await run({ ...OFF, light: 60 })).image;
    expect(change(both, lightOnly)).toBeGreaterThan(1e-4);
  });

  it('keeps each aspect to itself: Light does not tint, Bounces and Style move colour, none of them touch an edge', async () => {
    const { image, passes } = scene();
    // Light: the same gain on all three channels, so the colour of every pixel is kept.
    const lit = (await run({ ...OFF, light: 100 })).image;
    for (let i = 0; i < W * H; i++) {
      const [r0, g0, b0] = [image.rgba[i * 4], image.rgba[i * 4 + 1], image.rgba[i * 4 + 2]];
      const [r1, g1, b1] = [lit.rgba[i * 4], lit.rgba[i * 4 + 1], lit.rgba[i * 4 + 2]];
      expect(Math.abs(r1 * g0 - r0 * g1)).toBeLessThan(1e-5);
      expect(Math.abs(b1 * g0 - b0 * g1)).toBeLessThan(1e-5);
    }
    // ... and it lifts the shadows (the dark box) more than the highlights.
    const gain = (img: LinearImage, x: number, y: number) => img.rgba[(y * W + x) * 4 + 2] / image.rgba[(y * W + x) * 4 + 2];
    expect(gain(lit, 70, 45)).toBeGreaterThan(gain(lit, 5, 5));
    // Bounces warm: the red-to-blue ratio goes up where the light is low.
    const bounced = (await run({ ...OFF, bounce: 100 })).image;
    const rb = (img: LinearImage, x: number, y: number) => img.rgba[(y * W + x) * 4] / img.rgba[(y * W + x) * 4 + 2];
    expect(rb(bounced, 70, 45)).toBeGreaterThan(rb(image, 70, 45) * 1.05);
    // Style: Warm warms, Cool cools.
    const warm = (await run({ ...OFF, style: 'WARM', styleStrength: 100 })).image;
    const cool = (await run({ ...OFF, style: 'COOL', styleStrength: 100 })).image;
    expect(rb(warm, 30, 30)).toBeGreaterThan(rb(image, 30, 30));
    expect(rb(cool, 30, 30)).toBeLessThan(rb(image, 30, 30));
    // The gain is smooth: next to the hard edge of the bottle it changes by little, so the edge stays where it is.
    for (const out of [lit, bounced, warm, cool, (await run({ ...OFF, light: 100, bounce: 100, style: 'CINEMATIC', styleStrength: 100 })).image]) {
      let worst = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 1; x < W; x++) {
          const a = (y * W + x) * 4;
          for (let c = 0; c < 3; c++) {
            if (image.rgba[a + c] < 0.02 || image.rgba[a - 4 + c] < 0.02) continue;
            worst = Math.max(worst, Math.abs(out.rgba[a + c] / image.rgba[a + c] - out.rgba[a - 4 + c] / image.rgba[a - 4 + c]));
          }
        }
      }
      // The gain moves by a few percent from one pixel to the next while the edge itself is a step of 100 % and more.
      expect(worst).toBeLessThan(0.15);
      // ... and the edge, as the guard measures it, has not moved at all.
      expect(edgeDisplacement(luma(image), luma(out), W, H, passes)).toBe(0);
    }
  });

  it('with Light at 0 the other aspects do not light the shadows, and with it on they do', async () => {
    const { image } = scene();
    // The dark box in the shadow (x 60..88, y 30..58): what Light lifts, a warm tint and a style hardly touch the green.
    const green = (img: LinearImage) => img.rgba[(45 * W + 70) * 4 + 1] / image.rgba[(45 * W + 70) * 4 + 1];
    const others = { ...OFF, bounce: 100, style: 'CINEMATIC' as const, styleStrength: 100 };
    const without = green((await run({ ...others, light: 0 })).image);
    expect(without).toBeLessThan(1.1);
    expect(green((await run({ ...others, light: 100 })).image)).toBeGreaterThan(without + 0.08);
  });

  it('changes more with a higher control and with a higher Intervention', async () => {
    const { image } = scene();
    const at = async (patch: Partial<AiPipelineSettings>) => change((await run({ ...OFF, ...patch })).image, image);
    expect(await at({ light: 80 })).toBeGreaterThan(await at({ light: 40 }));
    expect(await at({ light: 40 })).toBeGreaterThan(await at({ light: 10 }));
    expect(await at({ light: 80, intervention: 100 })).toBeGreaterThan(await at({ light: 80, intervention: 50 }));
    expect(await at({ light: 80, intervention: 50 })).toBeGreaterThan(await at({ light: 80, intervention: 10 }));
    expect(weightsOf({ ...OFF, light: 50, intervention: 50 }).light).toBeCloseTo(0.25, 12);
    expect(weightsOf({ ...OFF, style: 'NATURAL', styleStrength: 100 }).style).toBe(0);
  });

  it('is deterministic: the same request, the same pixels; the seed only shows when something is asked', async () => {
    const asked = { ...DEFAULT_AI_PIPELINE, seed: 11 };
    expect(sameImage((await run(asked)).image, (await run(asked)).image)).toBe(true);
    expect(sameImage((await run(asked)).image, (await run({ ...asked, seed: 12 })).image)).toBe(false);
    // Another variation is the same look, not another picture: the two stay close.
    expect(change((await run(asked)).image, (await run({ ...asked, seed: 12 })).image)).toBeLessThan(0.02);
    expect(sameImage((await run({ ...OFF, seed: 1 })).image, (await run({ ...OFF, seed: 2 })).image)).toBe(true);
  });

  it('leaves the background alone when the passes say where the objects are', async () => {
    const { image, passes } = scene();
    const res = await run({ ...DEFAULT_AI_PIPELINE, light: 100, intervention: 100 });
    expect(pixelsOutside(image, res.image, passes)).toBe(0);
    for (let i = 0; i < W * H; i++) if (passes.partId![i] === 0) expect(res.image.rgba[i * 4]).toBe(image.rgba[i * 4]);
    // Without passes the whole picture is the AI's to relight.
    const bare = await run({ ...DEFAULT_AI_PIPELINE, light: 100, intervention: 100 }, {}, false);
    expect(bare.image.rgba[0]).not.toBe(image.rgba[0]);
  });

  it('fills a report from what it did: ACCEPTED with its measured numbers', async () => {
    let clock = 0;
    const res = await run({ ...DEFAULT_AI_PIPELINE, seed: 42 }, { now: () => (clock += 250) });
    const r = res.report;
    expect(r).toMatchObject({ verdict: 'ACCEPTED', usedFraction: 1, attempts: 1, modelKey: SYNTHETIC_MODEL_KEY, runtime: 'synthetic', seed: 42 });
    expect(r.seconds).toBeCloseTo(0.25, 6);
    expect(r.size).toEqual({ ok: true, value: 1, limit: 1 });
    expect(r.outside).toEqual({ ok: true, value: 0, limit: 0 });
    expect(r.edges.ok && r.edges.value <= SYNTHETIC_LIMITS.edgePx).toBe(true);
    expect(r.detail.ok && r.detail.value >= SYNTHETIC_LIMITS.detail && r.detail.value <= 1).toBe(true);
    expect(r.focus.ok && r.focus.value <= SYNTHETIC_LIMITS.focus).toBe(true);
    expect(r.materials.map((m) => m.materialId)).toEqual([1, 2]);
    for (const m of r.materials) {
      expect(m.ok).toBe(true);
      expect(m.deltaEMean).toBeGreaterThan(0);
      expect(m.deltaEP95).toBeGreaterThanOrEqual(m.deltaEMean);
      expect(m.deltaEMean).toBeLessThanOrEqual(m.limit);
    }
    expect(r.reason).toBeUndefined();
    // Nothing asked: the measures are those of an unchanged picture.
    const none = (await run({ ...OFF })).report;
    expect(none.materials.every((m) => m.deltaEMean === 0 && m.deltaEP95 === 0)).toBe(true);
    expect(none.detail.value).toBeCloseTo(1, 9);
    expect(none.edges.value).toBe(0);
  });

  it('lowers its strength by the guard’s rule when a limit is broken: LIMITED', async () => {
    const strong: AiPipelineSettings = { intervention: 100, light: 100, bounce: 100, wear: 0, style: 'CINEMATIC', styleStrength: 100, seed: 0 };
    const loose: Partial<SyntheticLimits> = { deltaEMean: 100, deltaEP95: 100, detail: -1, focus: 100, edgePx: 100 };
    const full = await run(strong, { limits: loose });
    expect(full.report).toMatchObject({ verdict: 'ACCEPTED', attempts: 1 });
    const fullDE = Math.max(...full.report.materials.map((m) => m.deltaEMean));
    // A limit just under what full strength gives: the guard retries at 0.6, 0.36, ...
    const limits: Partial<SyntheticLimits> = { ...loose, deltaEMean: fullDE * 0.7 };
    const res = await run(strong, { limits });
    expect(res.report.verdict).toBe('LIMITED');
    expect(res.report.attempts).toBeGreaterThan(1);
    expect(res.report.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(res.report.usedFraction).toBeCloseTo(0.6 ** (res.report.attempts - 1), 6);
    expect(res.report.usedFraction).toBeLessThan(1);
    expect(res.report.reason).toMatch(/limited to \d+ %/);
    // What it delivers is the weaker result, and it passes.
    expect(change(res.image, scene().image)).toBeLessThan(change(full.image, scene().image));
    expect(res.report.materials.every((m) => m.ok)).toBe(true);
    expect(res.progress.some((p) => p.stage === 'RETRY')).toBe(true);
  });

  it('gives the engine’s image unchanged when no attempt passes: REJECTED', async () => {
    const { image } = scene();
    const res = await run({ ...DEFAULT_AI_PIPELINE, intervention: 100, light: 100 }, { limits: { deltaEMean: 1e-9, deltaEP95: 1e-9 } });
    expect(res.report).toMatchObject({ verdict: 'REJECTED', usedFraction: 0, attempts: MAX_ATTEMPTS });
    expect(res.report.reason).toMatch(/Material \d+ ΔE00/);
    expect(sameImage(res.image, image)).toBe(true);
    expect(res.progress.filter((p) => p.stage === 'RETRY')).toHaveLength(MAX_ATTEMPTS - 1);
  });

  it('reports progress inside 0..1, in order, and stops when it is aborted', async () => {
    const res = await run(DEFAULT_AI_PIPELINE);
    expect(res.progress.map((p) => p.stage)).toEqual(['CONDITIONING', 'INFERENCE', 'GUARD']);
    for (let i = 0; i < res.progress.length; i++) {
      expect(res.progress[i].fraction).toBeGreaterThanOrEqual(0);
      expect(res.progress[i].fraction).toBeLessThanOrEqual(1);
      if (i > 0) expect(res.progress[i].fraction).toBeGreaterThanOrEqual(res.progress[i - 1].fraction);
    }
    const { image, passes } = scene();
    const ctl = new AbortController();
    ctl.abort();
    await expect(createSyntheticService().post({ source: { kind: 'INLINE', image, passes }, settings: DEFAULT_AI_PIPELINE, prompt: '', negative: '', modelKey: '' }, () => undefined, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    // Aborted while it waits.
    const later = new AbortController();
    const pending = createSyntheticService({ delayMs: 50 }).post({ source: { kind: 'INLINE', image, passes }, settings: DEFAULT_AI_PIPELINE, prompt: '', negative: '', modelKey: '' }, () => undefined, later.signal);
    later.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    // It takes pictures sent along, not the desktop's kept renders.
    await expect(createSyntheticService().post({ source: { kind: 'RENDER', renderId: 'r1' }, settings: DEFAULT_AI_PIPELINE, prompt: '', negative: '', modelKey: '' }, () => undefined, never)).rejects.toThrow(/INLINE/);
  });
});

describe('what the report measures', () => {
  const { image, passes } = scene();
  const blurred = (): LinearImage => {
    const soft = softLuminance(image, 2);
    const rgba = new Float32Array(image.rgba);
    for (let i = 0; i < W * H; i++) {
      const y = luminance(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) || 1e-6;
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] *= soft[i] / y;
    }
    return { width: W, height: H, rgba };
  };

  it('counts pixels changed outside the objects', () => {
    const out: LinearImage = { width: W, height: H, rgba: new Float32Array(image.rgba) };
    expect(pixelsOutside(image, out, passes)).toBe(0);
    out.rgba[0] += 0.5; // the background corner
    out.rgba[(30 * W + 20) * 4] += 0.5; // inside the bottle
    expect(pixelsOutside(image, out, passes)).toBe(1);
    expect(pixelsOutside(image, out, null)).toBe(0);
  });

  it('finds an edge that moved, to the pixel', () => {
    // Two flat halves with a clean edge between them (a textured surface has steps of its own to confuse the count).
    const rgba = new Float32Array(W * H * 4);
    const partId = new Uint32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = x < 40 ? 0.6 : 0.1;
        rgba.set([v, v, v, 1], (y * W + x) * 4);
        partId[y * W + x] = x < 40 ? 0 : 1;
      }
    }
    const flat: LinearImage = { width: W, height: H, rgba };
    const edges: RenderPasses = { width: W, height: H, partId };
    const move = (dx: number): Float32Array => {
      const out = new Float32Array(rgba.length);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set(rgba.subarray((y * W + Math.max(0, x - dx)) * 4, (y * W + Math.max(0, x - dx)) * 4 + 4), (y * W + x) * 4);
      return luma({ width: W, height: H, rgba: out });
    };
    const y0 = luma(flat);
    expect(edgeDisplacement(y0, y0, W, H, edges)).toBe(0);
    expect(edgeDisplacement(y0, move(1), W, H, edges)).toBe(1);
    expect(edgeDisplacement(y0, move(2), W, H, edges)).toBe(2);
    expect(edgeDisplacement(y0, move(2), W, H, null)).toBe(0);
    // A smooth gain keeps an edge where it is.
    expect(edgeDisplacement(y0, luma(applySynthetic(flat, edges, { light: 1, bounce: 1, style: 1 }, 'CINEMATIC', 3)), W, H, edges)).toBe(0);
  });

  it('compares the high band by SSIM: 1 for the same detail, lower when it is washed out', () => {
    expect(highBandSsim(image, image)).toBeCloseTo(1, 9);
    const soft = highBandSsim(image, blurred());
    expect(soft).toBeLessThan(0.9);
    expect(soft).toBeGreaterThan(0);
  });

  it('compares sharpness tile by tile: nothing for the same picture, a good deal for a smeared one', () => {
    const y0 = luma(image);
    expect(sharpnessDeviation(y0, y0, W, H)).toBe(0);
    expect(sharpnessDeviation(y0, luma(blurred()), W, H)).toBeGreaterThan(0.25);
    // A plain gain is not a change of sharpness.
    const gained = applySynthetic(image, passes, { light: 1, bounce: 0, style: 0 }, 'NATURAL', 0);
    expect(sharpnessDeviation(y0, luma(gained), W, H)).toBeLessThan(SYNTHETIC_LIMITS.focus);
  });
});

describe('colour', () => {
  it('ΔE₀₀ agrees with the published test data of Sharma, Wu and Dalal', () => {
    const cases: [number[], number[], number][] = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
      [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
      [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    ];
    for (const [a, b, expected] of cases) {
      expect(deltaE2000(a[0], a[1], a[2], b[0], b[1], b[2])).toBeCloseTo(expected, 3);
      // Symmetric, and zero for the same colour.
      expect(deltaE2000(b[0], b[1], b[2], a[0], a[1], a[2])).toBeCloseTo(expected, 3);
    }
    expect(deltaE2000(40, 10, -20, 40, 10, -20)).toBe(0);
  });

  it('linear sRGB to Lab puts white at L 100, black at 0 and grey on the neutral axis', () => {
    expect(linearRgbToLab(1, 1, 1)).toEqual([expect.closeTo(100, 2), expect.closeTo(0, 1), expect.closeTo(0, 1)]);
    expect(linearRgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 6);
    const grey = linearRgbToLab(0.18, 0.18, 0.18);
    expect(grey[0]).toBeCloseTo(49.5, 0);
    expect(Math.abs(grey[1]) + Math.abs(grey[2])).toBeLessThan(0.05);
  });

  it('every display byte survives linear light and back, so an unchanged picture is the same file', () => {
    for (let b = 0; b < 256; b++) {
      expect(linearToByte(byteToLinear(b)), `byte ${b}`).toBe(b);
      expect(Math.abs(linearToSrgb(srgbToLinear(b / 255)) - b / 255)).toBeLessThan(1e-9);
    }
    const bytes = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + (i >> 3)) & 255;
    expect([...linearToRgba8(rgba8ToLinear(bytes, W, H))]).toEqual([...bytes]);
  });
});

describe('the studio floor in the synthetic service (X3c)', () => {
  it('is relit with its own colour check named Floor; the background still never changes', async () => {
    const { image, passes } = scene();
    // The background below row 58 is the studio floor (FLOOR_ID in both ids).
    const partId = new Uint32Array(passes.partId!);
    const materialId = new Uint32Array(passes.materialId!);
    for (let i = 58 * W; i < W * H; i++) {
      if (partId[i] === 0) {
        partId[i] = FLOOR_ID;
        materialId[i] = FLOOR_ID;
      }
    }
    const svc = createSyntheticService();
    const res = await svc.post(
      { source: { kind: 'INLINE', image, passes: { width: W, height: H, partId, materialId } }, settings: { ...OFF, light: 80, bounce: 60 }, prompt: '', negative: '', modelKey: SYNTHETIC_MODEL_KEY, materials: [{ materialId: 1, name: 'Bottle glass', allowsWear: false, locked: false }] },
      () => undefined,
      never,
    );
    let floorChanged = 0;
    let floor = 0;
    for (let i = 0; i < W * H; i++) {
      const same = [0, 1, 2, 3].every((c) => Object.is(res.image.rgba[i * 4 + c], image.rgba[i * 4 + c]));
      if (partId[i] === 0) expect(same, `background ${i}`).toBe(true);
      if (partId[i] === FLOOR_ID) {
        floor++;
        if (!same) floorChanged++;
      }
    }
    expect(floor).toBeGreaterThan(200);
    expect(floorChanged).toBeGreaterThan(floor * 0.9);
    const check = res.report.materials.find((m) => m.materialId === FLOOR_ID);
    expect(check).toMatchObject({ name: 'Floor', ok: true });
    // The request's table names the materials.
    expect(res.report.materials.find((m) => m.materialId === 1)?.name).toBe('Bottle glass');
    expect(res.report.materials.find((m) => m.materialId === 2)?.name).toBe('Material 2');
    expect(regionName(FLOOR_ID)).toBe('Floor');
  });
});

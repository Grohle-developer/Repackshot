// Phase D1, what the Doctor reads of an accumulation the real rt.wasm made (the pool’s way, tests/wasm-engine.ts):
// an ordinary image has no fireflies and a whole histogram, and a scene made to have them (mirrors lit by tiny, strong
// lights) has the isolated bright samples the scan counts. Skipped without public/engine/rt.wasm (npm run engine:build).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignAction } from '../src/core/materials';
import { reduce, type ProjectState } from '../src/core/store';
import { projectScene, writeRsb } from '../src/io/rsb';
import { scanFrame, SCAN_MIN_SAMPLES } from '../src/render/frame-scan';
import { exampleState } from './helpers';
import { loadRt, renderWithPasses, RT_WASM } from './wasm-engine';

const W = 128;
const H = 72;

/** The real engine’s accumulation of a project at `spp` samples, with the squared luminance the denoising viewport keeps. */
async function accumulate(state: ProjectState, spp: number) {
  const rt = await loadRt();
  const { scene } = projectScene(state, { width: W, height: H, maxSamples: 1, maxSeconds: 0 });
  return renderWithPasses(rt, writeRsb(scene), W, H, spp, 0, { lum2: true }).image;
}

/** Every part chrome and every light a tiny, strong, glossy one: a diffuse floor sees the lights only after a mirror. */
function mirrorsAndPinLights(): ProjectState {
  let s = exampleState();
  const parts = Object.values(s.scene.nodes).filter((n) => n.kind === 'PART').map((n) => n.id);
  s = reduce(s, assignAction(s, { preset: 'CHROME' }, 'REPLACE', parts));
  for (const l of s.studio.lights) s = reduce(s, { type: 'studio/setLight', id: l.id, patch: { size: 0.02, sizeY: 0.02, power: l.power * 40, glossy: true } });
  return s;
}

describe.skipIf(!RT_WASM)('the scan of the real engine’s accumulation', () => {
  it('finds no fireflies in an ordinary image at the first samples it is read, and puts every pixel in the histogram', async () => {
    const state = exampleState();
    const acc = await accumulate(state, SCAN_MIN_SAMPLES);
    const scan = scanFrame(acc, state);
    expect(scan.samples).toBe(SCAN_MIN_SAMPLES);
    expect(scan.fireflies).toEqual({ pixels: 0, peak: 0 });
    expect(scan.stops.reduce((a, b) => a + b, 0)).toBe(W * H);
    // The example is dim before the exposure: nothing in it is over white.
    expect(scan.stops.slice(8 + 1).reduce((a, b) => a + b, 0)).toBeLessThan((W * H) / 100);
  }, 120000);

  it('counts the isolated bright samples of mirrors lit by pin lights, the brightest several times display white', async () => {
    const state = mirrorsAndPinLights();
    const acc = await accumulate(state, 32);
    const scan = scanFrame(acc, state);
    expect(scan.fireflies).not.toBeNull();
    expect(scan.fireflies!.pixels).toBeGreaterThanOrEqual(1);
    expect(scan.fireflies!.pixels).toBeLessThan(50);
    expect(scan.fireflies!.peak).toBeGreaterThan(5);
    // Without the squared luminance the count can only be as high or higher: it is the same test minus one condition.
    const plain = scanFrame({ width: acc.width, height: acc.height, sum: acc.sum, lum2: new Float32Array(0), samplesAt: (p) => acc.samplesAt(p) }, state);
    expect(plain.fireflies!.pixels).toBeGreaterThanOrEqual(scan.fireflies!.pixels);
  }, 120000);
});

// ------------------------------------------------------------------ the worker says whether its rt.wasm can denoise

describe.skipIf(!RT_WASM)('the pool’s worker tells whether its rt.wasm exports the denoiser (the Doctor’s denoise check reads it)', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Runs the worker's `init` against `exports` (the module's own, or without some of them) and returns what it posts back. */
  async function ready(without: string[] = []): Promise<Record<string, unknown>> {
    const posted: Record<string, unknown>[] = [];
    const scope = { postMessage: (m: Record<string, unknown>) => void posted.push(m), onmessage: null as null | ((e: { data: unknown }) => Promise<void>) };
    (globalThis as unknown as { self: unknown }).self = scope;
    vi.resetModules();
    await import('../src/render/worker');
    const bytes = readFileSync(RT_WASM!);
    const module = await WebAssembly.compile(bytes);
    const real = await WebAssembly.instantiate(module, {});
    const exports = Object.fromEntries(Object.entries(real.exports).filter(([k]) => !without.includes(k)));
    vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({ exports } as never);
    await scope.onmessage!({ data: { type: 'init', module } });
    return posted.find((m) => m.type === 'ready' || m.type === 'failed')!;
  }

  it('says it can when the module has the denoiser, and that it cannot when it does not', async () => {
    expect(await ready()).toMatchObject({ type: 'ready', denoise: true });
    expect(await ready(['rt_denoise'])).toMatchObject({ type: 'ready', denoise: false });
  });
});

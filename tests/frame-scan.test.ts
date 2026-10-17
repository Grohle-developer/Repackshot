// Phase D1, what the Doctor reads of the Full viewport's accumulation (render/frame-scan.ts): fireflies, the frame's
// brightness by the stop, and when the engines hand it out (`status().scan`, the pool here with fake workers).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STOP_BINS, STOPS_FROM } from '../src/core/doctor-engine';
import { DEFAULT_ADVANCED } from '../src/core/render';
import { createInitialState, reduce, type ProjectState } from '../src/core/store';
import { NativeEngine } from '../src/render/native';
import { FIREFLY_ISOLATION, FIREFLY_LEVEL, FIREFLY_SHARE, SCAN_MIN_SAMPLES, ScanCache, scanFrame, stopBin, type ScanSource } from '../src/render/frame-scan';
import { PathTracerEngine, Pool, type SceneSource } from '../src/render/pathtracer';
import { Accumulator } from '../src/render/tiles';
import type { WorkerReply, WorkerRequest } from '../src/render/pool-protocol';
import { exampleState } from './helpers';
import { installDom, LauncherMock, viewBytes } from './launcher-mock';

const basis = createInitialState();

type Rgb = readonly [number, number, number];

/**
 * An accumulation of `samples` samples of a `w × h` frame in which pixel `p` sample `s` is `fn(p, s)`, the way the pool
 * fills it (tile by tile, one pass), with the squared luminance when `lum2`.
 */
function film(w: number, h: number, samples: number, fn: (p: number, s: number) => Rgb, lum2 = true): Accumulator {
  const acc = new Accumulator(w, h, undefined, { lum2 });
  for (const t of acc.tiles) {
    const data = new Float32Array(samples * t.w * t.h * 4);
    for (let s = 0; s < samples; s++)
      for (let y = 0; y < t.h; y++)
        for (let x = 0; x < t.w; x++) {
          const [r, g, b] = fn((t.y + y) * w + t.x + x, s);
          data.set([r, g, b, 1], (s * t.w * t.h + y * t.w + x) * 4);
        }
    expect(acc.add(t.index, 0, samples, data)).toBe(true);
  }
  return acc;
}

const grey = (v: number): Rgb => [v, v, v];

describe('stopBin', () => {
  it('puts a value in the bin of its stop, clamped at both ends', () => {
    expect(STOP_BINS).toBe(17);
    expect(STOPS_FROM).toBe(-8);
    expect(stopBin(1)).toBe(8);
    expect(stopBin(0.99)).toBe(7);
    expect(stopBin(2)).toBe(9);
    expect(stopBin(3.99)).toBe(9);
    expect(stopBin(4)).toBe(10);
    expect(stopBin(2 ** -8)).toBe(0);
    expect(stopBin(1e-9)).toBe(0);
    expect(stopBin(0)).toBe(0);
    expect(stopBin(NaN)).toBe(0);
    expect(stopBin(256)).toBe(16);
    expect(stopBin(1e9)).toBe(16);
  });
});

describe('scanFrame', () => {
  it('finds the pixel where one sample is far brighter than the rest, and nothing in an even image', () => {
    const w = 24;
    const h = 16;
    const spike = 7 * w + 11;
    // 64 samples of an even 0.4; one sample of one pixel is 640 (its mean becomes 10.4).
    const acc = film(w, h, 64, (p, s) => grey(p === spike && s === 9 ? 640 : 0.4));
    const scan = scanFrame(acc, basis);
    expect(scan.fireflies?.pixels).toBe(1);
    // 63 samples of 0.4 and one of 640, over 64.
    expect(scan.fireflies?.peak).toBeCloseTo((63 * 0.4 + 640) / 64, 2);
    expect(scan.samples).toBe(64);
    expect(scan.width).toBe(w);
    expect(scan.height).toBe(h);
    expect(scan.basis).toBe(basis);
    expect(scanFrame(film(w, h, 64, () => grey(0.4)), basis).fireflies).toEqual({ pixels: 0, peak: 0 });
  });

  it('counts every firefly, and leaves out the ones that are not bright enough', () => {
    const w = 32;
    const h = 32;
    const at = [3 * w + 3, 10 * w + 20, 29 * w + 5];
    const acc = film(w, h, 32, (p, s) => grey(s === 4 && at.includes(p) ? 320 : 0.3));
    expect(scanFrame(acc, basis).fireflies?.pixels).toBe(3);
    // The same single sample, but too dim to matter: a mean of 0.3 + 0.9 / 32 per sample is under the level.
    const dim = film(w, h, 32, (p, s) => grey(s === 4 && at.includes(p) ? 0.9 : 0.3));
    expect(scanFrame(dim, basis).fireflies?.pixels).toBe(0);
    expect(FIREFLY_LEVEL).toBe(1);
  });

  it('does not take a steady glint for one when the squared luminance is kept, and does when it is not', () => {
    const w = 16;
    const h = 16;
    const glint = 8 * w + 8;
    // Every sample of the pixel is 10: a sparkle, steady and isolated.
    const steady = (p: number) => grey(p === glint ? 10 : 0.3);
    expect(scanFrame(film(w, h, 64, steady, true), basis).fireflies?.pixels).toBe(0);
    // Without the squared luminance only brightness and isolation are known: it counts (the limit of the plain sums).
    expect(scanFrame(film(w, h, 64, steady, false), basis).fireflies?.pixels).toBe(1);
    // The same sparkle made of one sample is a firefly in both.
    const single = (p: number, s: number) => grey(p === glint && s === 0 ? 640 : 0.3);
    expect(scanFrame(film(w, h, 64, single, true), basis).fireflies?.pixels).toBe(1);
    expect(scanFrame(film(w, h, 64, single, false), basis).fireflies?.pixels).toBe(1);
    expect(FIREFLY_SHARE).toBe(0.5);
  });

  it('does not count a lamp: what its neighbours share is not isolated', () => {
    const w = 16;
    const h = 16;
    const lamp = (p: number) => {
      const x = p % w;
      const y = Math.floor(p / w);
      return grey(x >= 6 && x <= 8 && y >= 6 && y <= 8 ? 12 : 0.3);
    };
    expect(scanFrame(film(w, h, 32, lamp, false), basis).fireflies?.pixels).toBe(0);
  });

  it('draws the line of isolation at four times the brightest neighbour, and the line of brightness at 1', () => {
    const w = 16;
    const h = 16;
    const p0 = 5 * w + 5;
    expect(FIREFLY_ISOLATION).toBe(4);
    expect(FIREFLY_LEVEL).toBe(1);
    const times = (ratio: number, base: number) => (p: number) => grey(p === p0 ? base * ratio : base);
    expect(scanFrame(film(w, h, 32, times(3.9, 0.4), false), basis).fireflies?.pixels).toBe(0);
    expect(scanFrame(film(w, h, 32, times(4.1, 0.4), false), basis).fireflies?.pixels).toBe(1);
    // A pixel nine times its neighbours but under display white is not very bright.
    expect(scanFrame(film(w, h, 32, (p) => grey(p === p0 ? 0.9 : 0.1), false), basis).fireflies?.pixels).toBe(0);
    expect(scanFrame(film(w, h, 32, (p) => grey(p === p0 ? 1.1 : 0.1), false), basis).fireflies?.pixels).toBe(1);
  });

  it('reads the pixels at the edge and at the corners of the frame', () => {
    const w = 20;
    const h = 12;
    const spots = [0, w - 1, (h - 1) * w, h * w - 1, 5 * w];
    const acc = film(w, h, 32, (p, s) => grey(s === 0 && spots.includes(p) ? 640 : 0.2));
    expect(scanFrame(acc, basis).fireflies?.pixels).toBe(spots.length);
  });

  it('reads the denoised image as it is: no fireflies to tell, the brightness by the stop still', () => {
    const acc = film(16, 16, 32, (p, s) => grey(p === 40 && s === 0 ? 640 : 0.4));
    const scan = scanFrame(acc, basis, { denoised: true });
    expect(scan.fireflies).toBeNull();
    expect(scan.stops.reduce((a, b) => a + b, 0)).toBe(16 * 16);
  });

  it('counts every pixel once in the histogram of stops, brightest channel first', () => {
    const w = 8;
    const h = 8;
    // Half the frame is a mean of 0.3 (bin 6: [0.25, 0.5)), a quarter has 3 in the red only (bin 9: its luminance, 0.64, would be bin 7), a quarter 5 (bin 10).
    const acc = film(w, h, 16, (p) => (p < 32 ? grey(0.3) : p < 48 ? [3, 0.1, 0.1] : grey(5)));
    const { stops } = scanFrame(acc, basis);
    expect(stops).toHaveLength(STOP_BINS);
    expect(stops.reduce((a, b) => a + b, 0)).toBe(64);
    expect(stops[stopBin(0.3)]).toBe(32);
    expect(stops[stopBin(3)]).toBe(16);
    expect(stops[stopBin(0.64)]).toBe(0);
    expect(stops[stopBin(5)]).toBe(16);
  });

  it('does not let a negative lobe of the pixel filter hide a firefly: a negative channel counts as black', () => {
    const w = 12;
    const h = 12;
    const p0 = 5 * w + 5;
    // Red -0.5, green and blue 1.4 for every sample: 1.10 once the red is black, 1.00 - 0.0043 if the negative is taken at its word.
    const acc = film(w, h, 16, (p) => (p === p0 ? [-0.5, 1.4, 1.4] : grey(0.1)), false);
    expect(scanFrame(acc, basis).fireflies?.pixels).toBe(1);
  });

  it('leaves the pixels without a sample out of the histogram and reads no NaN from them', () => {
    const w = 4;
    const h = 2;
    const counts = [0, 16, 16, 16, 16, 16, 16, 16];
    const sum = new Float32Array(w * h * 4);
    for (let p = 0; p < w * h; p++) sum.set([0.5 * counts[p], 0.5 * counts[p], 0.5 * counts[p], counts[p]], p * 4);
    const scan = scanFrame({ width: w, height: h, sum, lum2: new Float32Array(0), samplesAt: (p) => counts[p] }, basis);
    expect(scan.samples).toBe(0);
    expect(scan.stops.reduce((a, b) => a + b, 0)).toBe(7);
    expect(scan.fireflies).toEqual({ pixels: 0, peak: 0 });
  });

  it('weighs each pixel by its own samples (adaptive sampling: some blocks have more)', () => {
    const w = 4;
    const h = 2;
    // Pixel 0 has 4 samples of 8 (mean 8), pixel 1 has 16 samples of 8 (mean 8); the sums are what the film holds.
    const counts = [4, 16, 16, 16, 16, 16, 16, 16];
    const sum = new Float32Array(w * h * 4);
    for (let p = 0; p < w * h; p++) sum.set([8 * counts[p], 8 * counts[p], 8 * counts[p], counts[p]], p * 4);
    const src: ScanSource = { width: w, height: h, sum, lum2: new Float32Array(0), samplesAt: (p) => counts[p] };
    const scan = scanFrame(src, basis);
    expect(scan.samples).toBe(4);
    // All eight are a mean of 8: no pixel is brighter than its neighbours.
    expect(scan.fireflies?.pixels).toBe(0);
    expect(scan.stops[stopBin(8)]).toBe(8);
  });
});

describe('ScanCache', () => {
  it('waits for the least samples, reads again only when they have doubled, and again for another accumulation or tag', () => {
    const cache = new ScanCache();
    const src = {};
    const make = vi.fn(() => scanFrame(film(8, 8, 16, () => grey(0.4)), basis));
    expect(SCAN_MIN_SAMPLES).toBe(16);
    expect(cache.get(src, 15, make)).toBeNull();
    expect(make).not.toHaveBeenCalled();
    const first = cache.get(src, 16, make);
    expect(first).not.toBeNull();
    expect(make).toHaveBeenCalledTimes(1);
    expect(cache.get(src, 31, make)).toBe(first);
    expect(make).toHaveBeenCalledTimes(1);
    expect(cache.get(src, 32, make)).not.toBe(first);
    expect(make).toHaveBeenCalledTimes(2);
    cache.get({}, 32, make);
    expect(make).toHaveBeenCalledTimes(3);
    const keep = {};
    cache.get(keep, 64, make, '');
    cache.get(keep, 64, make, 'denoised');
    expect(make).toHaveBeenCalledTimes(5);
    cache.clear();
    cache.get(keep, 64, make, 'denoised');
    expect(make).toHaveBeenCalledTimes(6);
  });
});

// ------------------------------------------------------------------ the pool hands it out

/** A worker whose pixel `spike` has one very bright sample, and the rest an even grey. */
class SpikeWorker {
  onmessage: ((e: { data: WorkerReply }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  constructor(private readonly width: number, private readonly spike: number) {}
  postMessage(msg: WorkerRequest): void {
    setTimeout(() => this.handle(msg), 1);
  }
  private handle(msg: WorkerRequest): void {
    const reply = (m: WorkerReply) => this.onmessage?.({ data: m });
    if (msg.type === 'init') reply({ type: 'ready', version: 0x000300 });
    else if (msg.type === 'scene') reply({ type: 'scene', id: msg.id, error: null });
    else if (msg.type === 'job') {
      for (let k = 0; k < msg.tiles.length; k += 5) {
        const [x, y, w, h, index] = msg.tiles.subarray(k, k + 5);
        const data = new Float32Array(msg.count * w * h * 4);
        for (let s = 0; s < msg.count; s++)
          for (let yy = 0; yy < h; yy++)
            for (let xx = 0; xx < w; xx++) {
              const p = (y + yy) * this.width + x + xx;
              const v = p === this.spike && msg.first + s === 3 ? 900 : 0.4;
              data.set([v, v, v, 1], (s * w * h + yy * w + xx) * 4);
            }
        reply({ type: 'tile', generation: msg.generation, index, first: msg.first, count: msg.count, data });
      }
      reply({ type: 'done', generation: msg.generation });
    }
  }
  terminate(): void {}
}

describe('the pool’s status().scan', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  async function view(width: number, height: number, spike: number) {
    const dom = installDom();
    restore = dom.restore;
    const pool = await Pool.create({} as WebAssembly.Module, 2, () => new SpikeWorker(width, spike) as unknown as Worker);
    const source: SceneSource = {
      build: (_s, v) => ({ meshKey: 'k', bytes: (meshes) => new Uint8Array([meshes ? 2 : 1, v.width & 255, v.height & 255]) }),
      tone: () => ({ exposureEv: 0, tonemap: 2 }),
    };
    const engine = new PathTracerEngine(pool, source, true);
    engine.setViewportLimit({ by: 'SAMPLES', samples: 100000, seconds: 120 });
    engine.mount(dom.canvas as unknown as HTMLCanvasElement);
    // Without the denoise the pool keeps no squared luminance and asks its workers for no guide passes.
    const state = reduce(exampleState(), { type: 'render/set', patch: { advanced: { ...DEFAULT_ADVANCED, denoise: 'OFF' } } });
    engine.sync(state, null);
    engine.resize(width, height, 1);
    engine.setActive(true);
    return { engine, state };
  }

  const settle = async (engine: PathTracerEngine, until: () => boolean, tries = 400) => {
    for (let i = 0; i < tries && !until(); i++) {
      engine.frame();
      await new Promise((r) => setTimeout(r, 3));
    }
  };

  it('is absent while the pixels have too few samples, then names the firefly and the project the image is of', async () => {
    const { engine, state } = await view(64, 32, 5 * 64 + 17);
    await settle(engine, () => engine.status().samples >= 1);
    expect(engine.status().samples).toBeGreaterThanOrEqual(1);
    expect(engine.status().samples).toBeLessThan(SCAN_MIN_SAMPLES);
    expect(engine.status().scan).toBeUndefined();
    await settle(engine, () => engine.status().samples >= 32);
    const scan = engine.status().scan;
    expect(scan).toBeDefined();
    expect(scan!.fireflies).toEqual({ pixels: 1, peak: expect.any(Number) });
    expect(scan!.samples).toBeGreaterThanOrEqual(SCAN_MIN_SAMPLES);
    expect(scan!.width).toBe(64);
    expect(scan!.height).toBe(32);
    // It is the project that started the image, not a later object.
    expect(scan!.basis).toBe(state);
    // The same object until the samples double.
    expect(engine.status().scan).toBe(scan);
    engine.setActive(false);
  });

  it('says nothing while the viewport is not at full resolution on screen (inactive engine)', async () => {
    const { engine } = await view(64, 32, 5);
    engine.setActive(false);
    expect(engine.status().scan).toBeUndefined();
  });
});


describe('the pool’s denoiser flag', () => {
  /** A worker that only starts: its first message says what the engine can do. */
  class ReadyWorker {
    onmessage: ((e: { data: WorkerReply }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    constructor(private readonly denoise: boolean | undefined) {}
    postMessage(msg: WorkerRequest): void {
      if (msg.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', version: 0x000300, ...(this.denoise === undefined ? {} : { denoise: this.denoise }) } }));
    }
    terminate(): void {}
  }
  const pool = (flags: (boolean | undefined)[]) => {
    let i = 0;
    return Pool.create({} as WebAssembly.Module, flags.length, () => new ReadyWorker(flags[i++]) as unknown as Worker);
  };
  const source: SceneSource = { build: () => ({ meshKey: 'k', bytes: () => new Uint8Array([1]) }), tone: () => ({ exposureEv: 0, tonemap: 2 }) };

  it('can denoise unless a worker says its rt.wasm cannot (one that says nothing is taken to)', async () => {
    expect((await pool([true, true])).hasDenoiser).toBe(true);
    expect((await pool([undefined])).hasDenoiser).toBe(true);
    expect((await pool([true, false])).hasDenoiser).toBe(false);
    expect(new PathTracerEngine(await pool([false]), source, true).canDenoise).toBe(false);
    expect(new PathTracerEngine(await pool([true]), source, true).canDenoise).toBe(true);
  });
});


describe('the launcher’s status().scan', () => {
  let restore: (() => void) | null = null;
  const engines: NativeEngine[] = [];
  beforeEach(() => {
    restore = installDom().restore;
  });
  afterEach(() => {
    engines.splice(0).forEach((e) => e.setActive(false));
    restore?.();
  });

  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  async function until(engine: NativeEngine, cond: () => boolean, ms = 10000): Promise<boolean> {
    const end = performance.now() + ms;
    while (!cond()) {
      if (performance.now() > end) return false;
      engine.frame();
      await tick(3);
    }
    return true;
  }

  it('reads the sums the launcher hands out: none of the fireflies while they are the denoised image, their count when they are not, the project the view was posted from', async () => {
    const launcher = new LauncherMock();
    // The view ends at 30 samples, so its samples never double again: only the image changing can make the scan be read anew.
    launcher.viewportSamples = 30;
    const source: SceneSource = {
      build: (_s, view) => ({ meshKey: 'm', bytes: (meshes) => viewBytes(view.width, view.height, meshes, (view.denoise ?? 0) + 1) }),
      tone: () => ({ exposureEv: 0, tonemap: 1 }),
    };
    const engine = new NativeEngine({ request: launcher.request }, source, { threads: 8, isa: 'avx2' });
    engines.push(engine);
    engine.mount(installDom().canvas as unknown as HTMLCanvasElement);
    const state = createInitialState({ lang: 'en', theme: 'dark' });
    engine.sync(state, null);
    engine.resize(8, 6, 1);
    engine.setActive(true);
    expect(engine.status().scan).toBeUndefined();
    // The launcher’s passes are 1, 2, 3… samples: it takes six to give every pixel sixteen.
    expect(await until(engine, () => engine.status().scan !== undefined)).toBe(true);
    const clean = engine.status().scan!;
    expect(engine.status().samples).toBeGreaterThanOrEqual(SCAN_MIN_SAMPLES);
    expect(engine.status().denoised).toBe(true);
    expect(clean.fireflies).toBeNull();
    expect(clean.basis).toBe(state);
    expect(clean.stops.reduce((a, b) => a + b, 0)).toBe(48);
    expect(engine.status().scan).toBe(clean);
    // The denoise off: the sums are the accumulation, and the scan counts its fireflies (this one is even: none).
    const off: ProjectState = { ...state, render: { ...state.render, advanced: { ...state.render.advanced, denoise: 'RENDER' } } };
    engine.sync(off, state);
    expect(await until(engine, () => engine.status().denoised !== true && engine.status().scan?.fireflies !== null && engine.status().scan?.fireflies !== undefined)).toBe(true);
    expect(engine.status().scan!.fireflies).toEqual({ pixels: 0, peak: 0 });
  });
});

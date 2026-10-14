// The path tracer in the browser (phase E4), the parts that need no browser: tiles and their
// workers, the pass schedule, the generation counter, the accumulation, the resolution of gesture
// frames, and the pool itself driven by fake workers.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathTracerEngine, Pool, SIMD_PROBE, simdSupported, viewportWorkers, type SceneSource, type TracerView } from '../src/render/pathtracer';
import { WATCHDOG } from '../src/render/watchdog';
import { installDom } from './launcher-mock';
import { exampleState } from './helpers';
import { DENOISE_GUIDE_MASK } from '../src/render/denoise';
import { DEFAULT_ADVANCED } from '../src/core/render';
import type { WorkerReply, WorkerRequest } from '../src/render/pool-protocol';
import { Accumulator, alphaByte, assignTiles, chooseScale, exactBytes, Generations, LIVE_ALBEDO_SAMPLES, LIVE_PASS_MS, livePassCap, MAX_PASS_SAMPLES, nextPass, poolSize, scaledSize, TILE, tileGrid, type TileResult } from '../src/render/tiles';
import { exactPixel, exposureGain } from '../src/render/tonemap';
import { ALBEDO_BIT, EXACT_BITS, PassAccumulator, wordsPerPixel } from '../src/render/pass-planes';
import { passMask } from '../src/core/passes';

const f = Math.fround;

describe('tiles and workers', () => {
  it('cuts the image row by row like rt_core::render::tile_grid', () => {
    const tiles = tileGrid(70, 40);
    expect(tiles.map((t) => [t.x, t.y, t.w, t.h])).toEqual([
      [0, 0, 32, 32], [32, 0, 32, 32], [64, 0, 6, 32],
      [0, 32, 32, 8], [32, 32, 32, 8], [64, 32, 6, 8],
    ]);
    expect(tiles.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(tileGrid(1, 1)).toEqual([{ index: 0, x: 0, y: 0, w: 1, h: 1 }]);
    expect(tileGrid(TILE * 3, TILE)).toHaveLength(3);
  });

  it('interleaves tiles by worker index, every tile once, always the same worker', () => {
    const tiles = tileGrid(200, 130);
    const parts = assignTiles(tiles, 3);
    expect(parts).toHaveLength(3);
    parts.forEach((list, w) => list.forEach((t) => expect(t.index % 3).toBe(w)));
    expect(parts.flat().map((t) => t.index).sort((a, b) => a - b)).toEqual(tiles.map((t) => t.index));
    // Balanced: no worker has more than one tile more than another.
    const sizes = parts.map((p) => p.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(assignTiles(tiles, 0)).toHaveLength(1);
  });

  it('sizes the pool from the cores: n - 1, between 1 and 8', () => {
    expect(poolSize(4)).toBe(3);
    expect(poolSize(1)).toBe(1);
    expect(poolSize(2)).toBe(1);
    expect(poolSize(32)).toBe(8);
    expect(poolSize(undefined)).toBe(1);
  });

  it('passes of 1, 2, 4, 8 and then 16 samples, the last cut at the budget', () => {
    const passes = (max: number, n = 8) => {
      const out: number[] = [];
      let done = 0;
      let prev = 0;
      for (let i = 0; i < n; i++) {
        const p = nextPass(done, prev, max);
        if (!p) break;
        expect(p.first).toBe(done);
        out.push(p.count);
        done += p.count;
        prev = p.count;
      }
      return out;
    };
    expect(passes(100)).toEqual([1, 2, 4, 8, 16, 16, 16, 16]);
    expect(passes(4)).toEqual([1, 2, 1]);
    expect(passes(1)).toEqual([1]);
    expect(passes(0, 6)).toEqual([1, 2, 4, 8, 16, 16]);
  });
});

describe('resolution of gesture frames', () => {
  it('starts at ¼ and picks ½ when it would fit in 50 ms', () => {
    expect(chooseScale(null, 4)).toBe(4);
    // ¼ took 10 ms: ½ has four times the pixels, 40 ms.
    expect(chooseScale(10, 4)).toBe(2);
    expect(chooseScale(13, 4)).toBe(4);
    expect(chooseScale(45, 2)).toBe(2);
    expect(chooseScale(60, 2)).toBe(4);
    expect(chooseScale(Number.NaN, 2)).toBe(4);
  });

  it('scales the image size up to whole pixels', () => {
    expect(scaledSize(1001, 875, 4)).toEqual({ width: 251, height: 219 });
    expect(scaledSize(1000, 874, 2)).toEqual({ width: 500, height: 437 });
    expect(scaledSize(3, 3, 4)).toEqual({ width: 1, height: 1 });
  });
});

/** A tile's samples: deterministic radiance per (pixel, sample), alpha 1. */
function sampleData(t: { x: number; y: number; w: number; h: number }, first: number, count: number, width: number, alpha = 1): Float32Array {
  const out = new Float32Array(count * t.w * t.h * 4);
  for (let s = 0; s < count; s++) {
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        const p = (t.y + y) * width + t.x + x;
        const o = (s * t.w * t.h + y * t.w + x) * 4;
        const v = f(((p * 7 + (first + s) * 13) % 97) / 37 + 0.001);
        out.set([v * alpha, f(v * 0.5) * alpha, f(v * 0.25) * alpha, alpha], o);
      }
    }
  }
  return out;
}

describe('accumulation', () => {
  it('adds each tile in sample order in f32 and resolves like Film::resolve', () => {
    const width = 40;
    const height = 33;
    const acc = new Accumulator(width, height);
    // Passes of 1 and 2 samples, then one of 3: as the pool sends them.
    for (const [first, count] of [
      [0, 1],
      [1, 2],
      [3, 3],
    ]) {
      for (const t of acc.tiles) expect(acc.add(t.index, first, count, sampleData(t, first, count, width))).toBe(true);
    }
    expect(acc.minSamples).toBe(6);
    expect(acc.complete).toBe(true);
    // The native film: one f32 add per sample, in sample order.
    const p = 32 * width + 37;
    let sum = 0;
    for (let s = 0; s < 6; s++) sum = f(sum + f(((p * 7 + s * 13) % 97) / 37 + 0.001));
    expect(acc.sum[p * 4]).toBe(sum);
    const px = [0, 0, 0, 0];
    acc.meanAt(p, 6, px);
    expect(px[0]).toBe(f(sum * f(1 / 6)));
    expect(px[3]).toBe(f(6 * f(1 / 6)));
  });

  it('refuses samples out of order (a tile always continues where it stopped)', () => {
    const acc = new Accumulator(64, 32);
    const t = acc.tiles[1];
    expect(acc.add(1, 1, 1, sampleData(t, 1, 1, 64))).toBe(false);
    expect(acc.add(1, 0, 2, sampleData(t, 0, 2, 64))).toBe(true);
    expect(acc.add(1, 0, 1, sampleData(t, 0, 1, 64))).toBe(false);
    expect(acc.add(1, 2, 1, new Float32Array(3))).toBe(false);
    expect(acc.add(9, 0, 1, sampleData(t, 0, 1, 64))).toBe(false);
    expect([...acc.samples]).toEqual([0, 2]);
    expect(acc.complete).toBe(false);
    expect(acc.minSamples).toBe(0);
  });

  it('the exact conversion equals Film::to_srgb8_tonemapped (rt --tone-table)', () => {
    const table = JSON.parse(readFileSync('tests/fixtures/tonemap.json', 'utf8')) as { inputs: number[][]; srgb8: { tonemap: number; ev: number; bytes: number[] }[] };
    const acc = new Accumulator(20, 1);
    const one = new Float32Array(20 * 4);
    table.inputs.forEach((c, i) => one.set([c[0], c[1], c[2], 1], i * 4));
    expect(acc.add(0, 0, 1, one)).toBe(true);
    for (const row of table.srgb8) {
      const bytes = exactBytes(acc.sum, 1, row.ev, row.tonemap);
      const rgb = [...bytes].filter((_, i) => i % 4 !== 3);
      expect(rgb, `tonemap ${row.tonemap} at ${row.ev} EV`).toEqual(row.bytes);
      expect([...bytes].filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true);
    }
  });

  it('a transparent background keeps its alpha and the colour is not premultiplied', () => {
    const acc = new Accumulator(2, 1);
    // Pixel 0: half covered by a white-ish 0.5 radiance; pixel 1: nothing.
    acc.add(0, 0, 1, new Float32Array([0.25, 0.25, 0.25, 0.5, 0, 0, 0, 0]));
    const out = exactBytes(acc.sum, 1, 0, 4);
    const straight = new Uint8Array(3);
    exactPixel(0.5, 0.5, 0.5, exposureGain(0), 4, straight, 0);
    expect([...out.subarray(0, 3)]).toEqual([...straight]);
    expect(out[3]).toBe(128);
    expect([...out.subarray(4)]).toEqual([0, 0, 0, 0]);
    expect([alphaByte(1), alphaByte(0.9999999), alphaByte(0), alphaByte(-1)]).toEqual([255, 255, 0, 0]);
  });
});

describe('generations', () => {
  it('a restart takes the next number and only it is accepted', () => {
    const g = new Generations();
    const a = g.next();
    expect(g.accepts(a)).toBe(true);
    const b = g.next();
    expect(b).toBe(a + 1);
    expect(g.accepts(a)).toBe(false);
    expect(g.accepts(b)).toBe(true);
    expect(g.current).toBe(b);
  });
});

// ------------------------------------------------------------------ the pool with fake workers

/** A tile's albedo samples: deterministic per (pixel, sample). */
function albedoData(t: { x: number; y: number; w: number; h: number }, first: number, count: number, width: number): Float32Array {
  const out = new Float32Array(count * t.w * t.h * 3);
  for (let s = 0; s < count; s++)
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const p = (t.y + y) * width + t.x + x;
        out.set([f(((p * 3 + (first + s) * 5) % 11) / 10), 0.5, f((first + s) / 8)], (s * t.w * t.h + y * t.w + x) * 3);
      }
  return out;
}

/** A tile's exact planes (`mask` & EXACT_BITS, key order): every word the pixel index plus the plane's number. */
function exactData(t: { x: number; y: number; w: number; h: number }, mask: number, width: number): Uint32Array {
  const n = t.w * t.h;
  const out = new Uint32Array(n * wordsPerPixel(mask & EXACT_BITS));
  for (let i = 0; i < out.length; i++) {
    const local = i % n;
    out[i] = (t.y + Math.floor(local / t.w)) * width + t.x + (local % t.w) + Math.floor(i / n) * 100000;
  }
  return out;
}

/** A worker that renders `sampleData` tiles, and can hold its replies until told to send them. */
class FakeWorker {
  onmessage: ((e: { data: WorkerReply }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  readonly got: WorkerRequest[] = [];
  held: WorkerReply[] | null = null;
  /** With `held`: only replies of these types wait (the others go at once). */
  holdOnly: Set<WorkerReply['type']> | null = null;
  terminated = false;
  /** Milliseconds a message takes (0: a microtask), so a viewport can render for a while. */
  delay = 0;
  /** U11: with this, a job's message takes this many milliseconds per sample instead (a pass costs what it renders). */
  sampleDelay = 0;
  /** The denoise requests it answered (E5b-1). */
  readonly denoised: Extract<WorkerRequest, { type: 'denoise' }>[] = [];
  constructor(private readonly width: number) {}
  postMessage(msg: WorkerRequest): void {
    this.got.push(msg);
    const ms = msg.type === 'job' && this.sampleDelay > 0 ? this.sampleDelay * msg.count : this.delay;
    if (ms > 0) setTimeout(() => this.handle(msg), ms);
    else queueMicrotask(() => this.handle(msg));
  }
  private reply(m: WorkerReply): void {
    if (this.held && (!this.holdOnly || this.holdOnly.has(m.type))) this.held.push(m);
    else this.onmessage?.({ data: m });
  }
  release(): void {
    const held = this.held ?? [];
    this.held = null;
    for (const m of held) this.onmessage?.({ data: m });
  }
  /** Sends the held replies of these types only; the others stay held. */
  releaseOnly(types: ReadonlySet<WorkerReply['type']>): void {
    const held = this.held ?? [];
    this.held = held.filter((m) => !types.has(m.type));
    for (const m of held) if (types.has(m.type)) this.onmessage?.({ data: m });
  }
  private handle(msg: WorkerRequest): void {
    switch (msg.type) {
      case 'init':
        this.reply({ type: 'ready', version: 0x000300 });
        break;
      case 'scene':
        this.reply({ type: 'scene', id: msg.id, error: new Uint8Array(msg.bytes)[0] === 0 ? 'bad scene' : null });
        break;
      case 'job':
        for (let k = 0; k < msg.tiles.length; k += 5) {
          const [x, y, w, h, index] = msg.tiles.subarray(k, k + 5);
          const t = { x, y, w, h };
          const passes = msg.passes ?? 0;
          this.reply({
            type: 'tile',
            generation: msg.generation,
            index,
            first: msg.first,
            count: msg.count,
            data: sampleData(t, msg.first, msg.count, this.width),
            ...(passes & ALBEDO_BIT ? { albedo: albedoData(t, msg.first, msg.count, this.width) } : {}),
            ...(passes & EXACT_BITS && msg.first === 0 ? { exact: exactData(t, passes, this.width) } : {}),
          });
        }
        this.reply({ type: 'done', generation: msg.generation });
        break;
      case 'tonemap':
        this.reply({ type: 'pixels', id: msg.id, bytes: exactBytes(new Float32Array(msg.sum), msg.samples, msg.ev, msg.tonemap) });
        break;
      case 'denoise': {
        // A stand-in for rt_denoise: the band's rows of the sums it was given, radiance halved (coverage as it was),
        // and (U11b) blended with the noisy rows as the engine does: noisy × (1 − s) + halved × s.
        const sums = new Float32Array(msg.input, 0, msg.width * (msg.hi - msg.lo) * 4);
        const rows = sums.slice((msg.y0 - msg.lo) * msg.width * 4, (msg.y1 - msg.lo) * msg.width * 4);
        const s = msg.strength ?? 1;
        for (let i = 0; i < rows.length; i++) if (i % 4 !== 3) rows[i] = s === 1 ? rows[i] * 0.5 : Math.fround(Math.fround(rows[i] * (1 - s)) + Math.fround(rows[i] * 0.5 * s));
        this.denoised.push(msg);
        this.reply({ type: 'denoised', id: msg.id, data: rows });
        break;
      }
      case 'cancel':
        break;
    }
  }
  terminate(): void {
    this.terminated = true;
  }
}

async function fakePool(n: number, width: number): Promise<{ pool: Pool; workers: FakeWorker[] }> {
  const workers: FakeWorker[] = [];
  const pool = await Pool.create({} as WebAssembly.Module, n, () => {
    const w = new FakeWorker(width);
    workers.push(w);
    return w as unknown as Worker;
  });
  return { pool, workers };
}

describe('the pool', () => {
  it('starts every worker on the engine and sends each its own copy of the scene', async () => {
    const { pool, workers } = await fakePool(3, 64);
    expect(pool.size).toBe(3);
    expect(workers.every((w) => w.got[0].type === 'init')).toBe(true);
    const bytes = new Uint8Array([82, 83, 66, 49]);
    await pool.scene(bytes, true);
    const sent = workers.map((w) => w.got.find((m) => m.type === 'scene') as Extract<WorkerRequest, { type: 'scene' }>);
    expect(sent.every((m) => m.full && new Uint8Array(m.bytes).join() === bytes.join())).toBe(true);
    expect(new Set(sent.map((m) => m.bytes)).size).toBe(3);
    await expect(pool.scene(new Uint8Array([0]), false)).rejects.toThrow('bad scene');
  });

  it('renders a pass, every tile on worker index mod n, and the image matches one built by hand', async () => {
    const width = 70;
    const height = 45;
    const { pool, workers } = await fakePool(3, width);
    const acc = new Accumulator(width, height);
    let p: ReturnType<typeof nextPass> = null;
    let done = 0;
    let prev = 0;
    while ((p = nextPass(done, prev, 7))) {
      const ok = await pool.run(5, acc.tiles, p.first, p.count, (r) => acc.add(r.index, r.first, r.count, r.data));
      expect(ok).toBe(true);
      done += p.count;
      prev = p.count;
    }
    expect(acc.minSamples).toBe(7);
    workers.forEach((w, i) => {
      for (const m of w.got) if (m.type === 'job') for (let k = 4; k < m.tiles.length; k += 5) expect(m.tiles[k] % 3).toBe(i);
    });
    const ref = new Accumulator(width, height);
    for (const t of ref.tiles) ref.add(t.index, 0, 7, sampleData(t, 0, 7, width));
    expect([...acc.sum]).toEqual([...ref.sum]);
    // The exact conversion in slices by the workers equals the conversion of the whole image.
    const sliced = await pool.tonemap(acc.sum, width, height, 7, 0.5, 2);
    expect([...sliced]).toEqual([...exactBytes(acc.sum, 7, 0.5, 2)]);
  });

  it('drops the tiles of a cancelled generation that arrive late, even while a newer one runs', async () => {
    const width = 64;
    const { pool, workers } = await fakePool(2, width);
    const acc = new Accumulator(width, 64);
    const gens = new Generations();
    const stale = gens.next();
    workers.forEach((w) => (w.held = []));
    const seenStale: TileResult[] = [];
    const first = pool.run(stale, acc.tiles, 0, 1, (r) => seenStale.push(r));
    await new Promise((r) => setTimeout(r, 0));
    // A restart: the new generation cancels the old one before its tiles came back...
    const fresh = gens.next();
    pool.cancel(fresh - 1);
    expect(await first).toBe(false);
    expect(workers.every((w) => w.got.some((m) => m.type === 'cancel' && m.generation === stale))).toBe(true);
    // ...and starts at once, so the old tiles arrive while it is running.
    const seenFresh: number[] = [];
    const second = pool.run(fresh, acc.tiles, 0, 1, (r) => {
      seenFresh.push(r.generation);
      acc.add(r.index, r.first, r.count, r.data);
    });
    await new Promise((r) => setTimeout(r, 0));
    workers.forEach((w) => w.release());
    expect(await second).toBe(true);
    expect(seenStale).toHaveLength(0);
    expect(seenFresh.every((g) => g === fresh)).toBe(true);
    expect(seenFresh).toHaveLength(acc.tiles.length);
    expect(acc.minSamples).toBe(1);
  });

  it('a worker that fails to start fails the pool, and every worker is stopped', async () => {
    const workers: FakeWorker[] = [];
    await expect(
      Pool.create({} as WebAssembly.Module, 2, () => {
        const w = new FakeWorker(8);
        if (workers.length === 1) w.postMessage = () => queueMicrotask(() => w.onmessage?.({ data: { type: 'failed', reason: 'outdated' } }));
        workers.push(w);
        return w as unknown as Worker;
      }),
    ).rejects.toThrow('outdated');
    expect(workers.every((w) => w.terminated)).toBe(true);
  });
});

describe('Render with the path tracer', () => {
  /** A scene source that records the views it was asked for. */
  function source(views: TracerView[]): SceneSource {
    return {
      build: (_s, view) => {
        views.push(view);
        // The bytes say what the scene is: another budget, another update (the meshes stay the same).
        return { meshKey: 'k', bytes: (meshes) => new Uint8Array([meshes ? 2 : 1, view.maxSamples & 255, view.width & 255, 0]) };
      },
      tone: () => ({ exposureEv: 0.5, tonemap: 2 }),
    };
  }

  it('renders the output size to its sample budget, reporting progress, converting exactly', async () => {
    const { pool, workers } = await fakePool(3, 96);
    const views: TracerView[] = [];
    const engine = new PathTracerEngine(pool, source(views), true);
    engine.sync(exampleState(), null);
    const progress: number[] = [];
    const samples: number[] = [];
    const px = await engine.renderPixels({ width: 96, height: 40, maxSamples: 7, maxSeconds: 0, transparent: true, onProgress: (p) => (progress.push(p.progress), samples.push(p.samples)) });
    expect([px.width, px.height, px.samples]).toEqual([96, 40, 7]);
    expect(views[0]).toMatchObject({ width: 96, height: 40, maxSamples: 7, transparent: true });
    // The first scene is a full load; passes of 1, 2 and 4 samples.
    expect(workers[0].got.find((m) => m.type === 'scene')).toMatchObject({ full: true });
    expect(workers[0].got.filter((m) => m.type === 'job').map((m) => (m as { count: number }).count)).toEqual([1, 2, 4]);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);
    expect(samples[samples.length - 1]).toBe(7);
    // The bytes are the exact conversion of what the workers rendered.
    const ref = new Accumulator(96, 40);
    for (const t of ref.tiles) ref.add(t.index, 0, 7, sampleData(t, 0, 7, 96));
    expect([...px.data]).toEqual([...exactBytes(ref.sum, 7, 0.5, 2)]);
    // A second render of the same geometry is an update, without the meshes.
    await engine.renderPixels({ width: 96, height: 40, maxSamples: 1, maxSeconds: 0, transparent: false });
    expect(workers[0].got.filter((m) => m.type === 'scene').map((m) => (m as { full: boolean }).full)).toEqual([true, false]);
  });

  it('with passes: the jobs ask for them, and the tiles’ passes come back put together like the image (X2)', async () => {
    const { pool, workers } = await fakePool(3, 70);
    const views: TracerView[] = [];
    const engine = new PathTracerEngine(pool, source(views), true);
    engine.sync(exampleState(), null);
    const keys = ['albedo', 'normal', 'partId', 'coc'] as const;
    const mask = passMask([...keys]);
    const px = await engine.renderPixels({ width: 70, height: 40, maxSamples: 7, maxSeconds: 0, transparent: false, passes: keys });
    // The view (and so RNDR.passes) and every job carry the passes.
    expect(views[0].passes).toEqual(keys);
    expect(workers.flatMap((w) => w.got.filter((m) => m.type === 'job').map((m) => (m as { passes?: number }).passes))).toEqual(Array(9).fill(mask));
    const ref = new PassAccumulator(70, 40, mask, tileGrid(70, 40));
    for (const t of ref.tiles) {
      ref.setExact(t.index, exactData(t, mask, 70));
      for (const [first, count] of [[0, 1], [1, 2], [3, 4]]) ref.addAlbedo(t.index, first, count, albedoData(t, first, count, 70));
    }
    const want = ref.resolve();
    expect(Object.keys(px.passes!).sort()).toEqual(['albedo', 'coc', 'height', 'normal', 'partId', 'width']);
    for (const k of keys) expect(Array.from(px.passes![k]!), k).toEqual(Array.from(want[k]!));
    // The image is the one without passes.
    const plain = await engine.renderPixels({ width: 70, height: 40, maxSamples: 7, maxSeconds: 0, transparent: false });
    expect(plain.passes).toBeUndefined();
    expect(Array.from(plain.data)).toEqual(Array.from(px.data));
    expect(views[1].passes).toBeUndefined();
  });

  it('leaving Full mode during a Render does not stop it; the stop button does', async () => {
    const { pool, workers } = await fakePool(2, 64);
    const engine = new PathTracerEngine(pool, source([]), false);
    engine.sync(exampleState(), null);
    engine.setActive(true);
    // The scene is loaded and the first pass is out, its tiles not back yet.
    workers.forEach((w) => ((w.held = []), (w.holdOnly = new Set(['tile', 'done']))));
    const running = engine.renderPixels({ width: 64, height: 32, maxSamples: 3, maxSeconds: 0, transparent: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.status().rendering).toBe(true);
    // Full mode is on: the render leaves the viewport its share (worker 1 of 2) and takes the rest.
    expect(workers[0].got.some((m) => m.type === 'job')).toBe(true);
    expect(workers[1].got.some((m) => m.type === 'job')).toBe(false);
    engine.setActive(false);
    workers.forEach((w) => ((w.holdOnly = null), w.release()));
    const px = await running;
    expect(px.samples).toBe(3);
    expect(engine.status().rendering).toBe(false);
    const ref = new Accumulator(64, 32);
    for (const t of ref.tiles) ref.add(t.index, 0, 3, sampleData(t, 0, 3, 64));
    expect([...px.data]).toEqual([...exactBytes(ref.sum, 3, 0.5, 2)]);

    // Two renders at once (Render while the queue runs): the second waits, both are whole.
    const [a, b] = await Promise.all([
      engine.renderPixels({ width: 64, height: 32, maxSamples: 2, maxSeconds: 0, transparent: false }),
      engine.renderPixels({ width: 64, height: 32, maxSamples: 3, maxSeconds: 0, transparent: false }),
    ]);
    expect([a.samples, b.samples]).toEqual([2, 3]);
    expect([...b.data]).toEqual([...px.data]);

    const stop = new AbortController();
    workers.forEach((w) => (w.held = []));
    const aborted = engine.renderPixels({ width: 64, height: 32, maxSamples: 3, maxSeconds: 0, transparent: false, signal: stop.signal });
    await new Promise((r) => setTimeout(r, 0));
    stop.abort();
    // The scene the workers were loading is acknowledged, then the render stops.
    workers.forEach((w) => w.release());
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.status().rendering).toBe(false);
  });
});

describe('simd128 detection', () => {
  it('the probe is a valid module only where simd128 is (Node has it)', () => {
    expect(WebAssembly.validate(SIMD_PROBE)).toBe(true);
    expect(simdSupported()).toBe(true);
    const broken = SIMD_PROBE.slice();
    broken[broken.length - 2] = 0xff; // not an opcode of simd128
    expect(WebAssembly.validate(broken)).toBe(false);
  });
});

// ------------------------------------------------------------------ phase P3a: the viewport never stuck, and live while rendering

describe('the pool hands workers over exactly', () => {
  it('a worker given to another generation stops the old one, and cancel stops only its own generation', async () => {
    const { pool, workers } = await fakePool(3, 64);
    const acc = new Accumulator(64, 64);
    workers.forEach((w) => (w.held = []));
    const a = pool.run(5, acc.tiles, 0, 1, () => undefined, [0, 1]);
    // Worker 1 goes to generation 6: generation 5 cannot finish without it, so it stops (on every worker).
    const b = pool.run(6, acc.tiles, 0, 1, () => undefined, [1]);
    expect(await a).toBe(false);
    const c = pool.run(7, acc.tiles, 0, 1, () => undefined, [0]);
    const d = pool.run(8, acc.tiles, 0, 1, () => undefined, [2]);
    // A Render and the viewport run side by side: cancelling one never touches the other.
    pool.cancel(7);
    expect(await c).toBe(false);
    workers.forEach((w) => w.release());
    expect(await b).toBe(true);
    expect(await d).toBe(true);
    // Only the workers that rendered generation 7 heard of its cancel.
    expect(workers.map((w) => w.got.some((m) => m.type === 'cancel' && m.generation === 7))).toEqual([true, false, false]);
  });

  it('remembers which scene each worker holds: the whole scene once, then updates, then the whole again after an error', async () => {
    const { pool, workers } = await fakePool(2, 64);
    const tag = (n: number) => ({ meshKey: 'k', update: new Uint8Array([n]) });
    await pool.scene(new Uint8Array([2]), true, [0, 1], tag(1));
    expect(pool.tagOf(0)?.update[0]).toBe(1);
    await pool.scene(new Uint8Array([1, 5]), false, [1], tag(5));
    expect([pool.tagOf(0)?.update[0], pool.tagOf(1)?.update[0]]).toEqual([1, 5]);
    // A worker that refuses its scene holds who knows what.
    await expect(pool.scene(new Uint8Array([0]), false, [0], tag(9))).rejects.toThrow('bad scene');
    expect(pool.tagOf(0)).toBeNull();
    expect(workers[0].got.filter((m) => m.type === 'scene')).toHaveLength(2);
  });
});

describe('the viewport of the pool', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
    vi.restoreAllMocks();
  });

  function viewSource(): SceneSource {
    return {
      build: (_s, view) => ({ meshKey: 'k', bytes: (meshes) => new Uint8Array([meshes ? 2 : 1, view.width & 255, view.height & 255, view.maxSamples & 255, (view.cameraPatch?.azimuth ?? 0) & 255]) }),
      tone: () => ({ exposureEv: 0.5, tonemap: 2 }),
    };
  }

  async function viewport(n: number, width = 96, height = 64) {
    const dom = installDom();
    restore = dom.restore;
    const { pool, workers } = await fakePool(n, width);
    workers.forEach((w) => (w.delay = 1));
    const engine = new PathTracerEngine(pool, viewSource(), true);
    // A viewport that does not converge during the test.
    engine.setViewportLimit({ by: 'SAMPLES', samples: 100000, seconds: 120 });
    engine.mount(dom.canvas as unknown as HTMLCanvasElement);
    engine.sync(exampleState(), null);
    engine.resize(width, height, 1);
    engine.setActive(true);
    return { engine, workers, canvas: dom.canvas };
  }

  const settle = async (engine: PathTracerEngine, times = 20) => {
    for (let i = 0; i < times; i++) {
      engine.frame();
      await new Promise((r) => setTimeout(r, 3));
    }
  };
  const jobsOf = (w: FakeWorker) => w.got.filter((m): m is Extract<WorkerRequest, { type: 'job' }> => m.type === 'job');

  it('Fast while a reduced-resolution frame is in flight does not keep Full from starting again', async () => {
    const { engine, workers } = await viewport(2, 64, 32);
    // A gesture: a reduced-resolution frame goes out and its tiles have not come back.
    workers.forEach((w) => ((w.held = []), (w.holdOnly = new Set(['tile', 'done']))));
    engine.beginGesture();
    engine.gestureView({ azimuth: 1 });
    await settle(engine, 3);
    expect(jobsOf(workers[0])).toHaveLength(1);
    // Fast, then Full again: the dropped frame no longer holds the next one back.
    engine.setActive(false);
    engine.endGesture();
    workers.forEach((w) => ((w.holdOnly = null), w.release()));
    engine.setActive(true);
    await settle(engine, 5);
    expect(jobsOf(workers[0]).length).toBeGreaterThan(1);
    expect(engine.status().samples).toBeGreaterThan(0);
  });

  it('stays live while a Render runs on its quarter of the workers, and the Render is the same bits either way', async () => {
    expect([viewportWorkers(1), viewportWorkers(2), viewportWorkers(4), viewportWorkers(8)]).toEqual([0, 1, 1, 2]);
    const { engine, workers } = await viewport(4);
    await settle(engine, 5);
    const before = workers.map((w) => jobsOf(w).length);
    // Five tiles: enough for every worker, so only the lanes keep the Render off the viewport's.
    const opts = { width: 160, height: 24, maxSamples: 7, maxSeconds: 0, transparent: false };
    const pending = engine.renderPixels(opts);
    // Render's tiles are 24 px tall (its whole height), the viewport's 32: they tell the jobs apart.
    const isRender = (m: Extract<WorkerRequest, { type: 'job' }>) => m.tiles[3] === 24;
    let shared = false;
    let rendering = true;
    void pending.finally(() => (rendering = false));
    while (rendering) {
      engine.frame();
      const st = engine.status();
      if (st.rendering && st.renderShare === 'SHARED' && st.share?.n === 1 && st.share.of === 4) shared = true;
      await new Promise((r) => setTimeout(r, 2));
    }
    const live = await pending;
    expect(shared).toBe(true);
    const during = workers.map((w, i) => jobsOf(w).slice(before[i]));
    // The Render never used the viewport's worker; the viewport went on there meanwhile.
    expect(during[3].some(isRender)).toBe(false);
    expect(during.slice(0, 3).every((jobs) => jobs.some(isRender))).toBe(true);
    expect(during[3].some((m) => !isRender(m))).toBe(true);
    // The same Render with no viewport (Fast): every worker, the same bytes.
    engine.setActive(false);
    const alone = await engine.renderPixels(opts);
    expect(Array.from(alone.data)).toEqual(Array.from(live.data));
    const ref = new Accumulator(160, 24);
    for (const t of ref.tiles) ref.add(t.index, 0, 7, sampleData(t, 0, 7, 96));
    expect(Array.from(live.data)).toEqual(Array.from(exactBytes(ref.sum, 7, 0.5, 2)));
  });

  it('a Render with passes while the viewport stays live: only the Render’s jobs ask for them, and they are the same as alone (X2)', async () => {
    const { engine, workers } = await viewport(4);
    await settle(engine, 5);
    const before = workers.map((w) => jobsOf(w).length);
    const keys = ['albedo', 'depth', 'partId'] as const;
    const mask = passMask([...keys]);
    const opts = { width: 160, height: 24, maxSamples: 7, maxSeconds: 0, transparent: false, passes: keys };
    const pending = engine.renderPixels(opts);
    let rendering = true;
    void pending.finally(() => (rendering = false));
    while (rendering) {
      engine.frame();
      await new Promise((r) => setTimeout(r, 2));
    }
    const live = await pending;
    const isRender = (m: Extract<WorkerRequest, { type: 'job' }>) => m.tiles[3] === 24;
    const during = workers.map((w, i) => jobsOf(w).slice(before[i]));
    // The viewport's worker rendered no part of the Render, and the viewport asks for no pass but the guides of its
    // denoise (E5b-1: denoise is on in the viewport by default).
    expect(during[3].some(isRender)).toBe(false);
    for (const jobs of during) for (const m of jobs) expect(m.passes ?? 0).toBe(isRender(m) ? mask : DENOISE_GUIDE_MASK);
    // Alone (Fast: every worker), the same passes, bit for bit, and what the tiles gave.
    engine.setActive(false);
    const alone = await engine.renderPixels(opts);
    const ref = new PassAccumulator(160, 24, mask, tileGrid(160, 24));
    for (const t of ref.tiles) {
      ref.setExact(t.index, exactData(t, mask, 96));
      for (const [first, count] of [[0, 1], [1, 2], [3, 4]]) ref.addAlbedo(t.index, first, count, albedoData(t, first, count, 96));
    }
    const want = ref.resolve();
    for (const k of keys) {
      expect(Array.from(live.passes![k]!), k).toEqual(Array.from(alone.passes![k]!));
      expect(Array.from(live.passes![k]!), k).toEqual(Array.from(want[k]!));
    }
  });

  it('denoises the Full viewport with its guide passes and shows the denoised image (E5b-1, U11: the viewport preset)', { timeout: 30000 }, async () => {
    const { engine, workers } = await viewport(3, 96, 64);
    await settle(engine, 30);
    // The jobs ask for the guides, and the denoiser runs on the viewport's workers with the viewport's preset, whose
    // halo is 24 rows (one band here: 64 rows).
    expect(workers.flatMap(jobsOf).every((m) => m.passes === DENOISE_GUIDE_MASK)).toBe(true);
    const asked = workers.flatMap((w) => w.denoised);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((m) => m.y0 === 0 && m.y1 === 64 && m.lo === 0 && m.hi === 64 && m.preset === 'VIEWPORT')).toBe(true);
    const st = engine.status();
    expect(st.denoised).toBe(true);
    expect(st.liveDenoise?.images).toBeGreaterThan(0);
    // The samples the meter shows are those of the denoised image on screen.
    expect(st.samples).toBe(asked[asked.length - 1].samples);
    // Viewport denoise off (U11): the image goes on (no new view), the accumulated sums are on screen at once, no more
    // denoise, and the guides' albedo only for the first samples.
    const on = exampleState();
    const off = { ...on, render: { ...on.render, advanced: { ...on.render.advanced, denoise: 'RENDER' as const } } };
    const before = workers.map((w) => [jobsOf(w).length, w.denoised.length]);
    // (Turned quickly off, on and off again: still no change of the image, so not a gesture's reduced frames either.)
    engine.sync(off, on);
    engine.sync(on, off);
    engine.sync(off, on);
    expect(engine.status().denoised).toBeUndefined();
    await settle(engine, 30);
    const after = workers.map((w, i) => jobsOf(w).slice(before[i][0]));
    expect(after.flat().length).toBeGreaterThan(0);
    expect(after.flat().every((m) => m.first > 0)).toBe(true);
    expect(engine.status().scale).toBe(1);
    expect(after.flat().every((m) => (m.first >= LIVE_ALBEDO_SAMPLES ? m.passes === (DENOISE_GUIDE_MASK & ~ALBEDO_BIT) : m.passes === DENOISE_GUIDE_MASK))).toBe(true);
    // (A denoise already on its way may still be answered, but none is asked for after.)
    await settle(engine, 10);
    const settled = workers.map((w) => w.denoised.length);
    await settle(engine, 20);
    workers.forEach((w, i) => expect(w.denoised.length).toBe(settled[i]));
    expect(settled.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(before.reduce((a, b) => a + b[1], 0) + workers.length);
    expect(engine.status().denoised).toBeUndefined();
  });

  it('a denoise in flight does not stop the passes, and the next starts on the newest pass when it is back (U11)', { timeout: 30000 }, async () => {
    const { engine, workers } = await viewport(2, 64, 64);
    // The denoise answers wait: the passes go on meanwhile.
    workers.forEach((w) => ((w.held = []), (w.holdOnly = new Set(['denoised']))));
    for (let i = 0; i < 100 && workers.every((w) => w.denoised.length === 0); i++) await settle(engine, 1);
    const first = workers.flatMap((w) => w.denoised);
    expect(first.length).toBeGreaterThan(0);
    const jobsThen = workers.map((w) => jobsOf(w).length);
    await settle(engine, 25);
    const later = workers.flatMap((w, i) => jobsOf(w).slice(jobsThen[i]));
    expect(later.length).toBeGreaterThan(2);
    // No second denoise while one is out, and nothing denoised on screen yet.
    expect(workers.flatMap((w) => w.denoised)).toHaveLength(first.length);
    expect(engine.status().denoised).toBeUndefined();
    // The passes stop where they are (the one out waits), and the denoise comes back: shown at once, and the next
    // denoise is of the newest pass done (where the pass that is out begins), not of one before it.
    workers.forEach((w) => (w.holdOnly = new Set(['denoised', 'tile', 'done'])));
    await settle(engine, 5);
    const newest = Math.max(...workers.flatMap(jobsOf).map((m) => m.first));
    workers.forEach((w) => w.releaseOnly(new Set(['denoised'])));
    await new Promise((r) => setTimeout(r, 0));
    engine.frame();
    expect(engine.status().denoised).toBe(true);
    expect(engine.status().samples).toBe(first[0].samples);
    const second = workers.flatMap((w) => w.got).filter((m): m is Extract<WorkerRequest, { type: 'denoise' }> => m.type === 'denoise').slice(first.length);
    expect(second.length).toBeGreaterThan(0);
    expect(second[0].samples).toBe(newest);
    expect(newest).toBeGreaterThan(first[0].samples);
    workers.forEach((w) => w.release());
  });

  it('turned on, it denoises the last pass at once, without starting the image over (U11)', { timeout: 30000 }, async () => {
    const { engine, workers } = await viewport(2, 64, 32);
    const on = exampleState();
    const off = { ...on, render: { ...on.render, advanced: { ...on.render.advanced, denoise: 'OFF' as const } } };
    engine.sync(off, on);
    engine.setViewportLimit({ by: 'SAMPLES', samples: 20, seconds: 120 });
    for (let i = 0; i < 200 && !engine.status().converged; i++) await settle(engine, 1);
    expect(engine.status().converged).toBe(true);
    expect(workers.flatMap((w) => w.denoised)).toHaveLength(0);
    const jobs = workers.flatMap(jobsOf).length;
    engine.sync(on, off);
    // Asked for at once, of the 20 samples there are; no pass is rendered for it.
    const asked = workers.flatMap((w) => w.got).filter((m): m is Extract<WorkerRequest, { type: 'denoise' }> => m.type === 'denoise');
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((m) => m.samples === 20)).toBe(true);
    await settle(engine, 5);
    expect(engine.status()).toMatchObject({ denoised: true, samples: 20, converged: true });
    expect(workers.flatMap(jobsOf)).toHaveLength(jobs);
    // Off and on again with nothing new: the same denoised image, at once, without denoising it again.
    const n = workers.flatMap((w) => w.denoised).length;
    engine.sync(off, on);
    expect(engine.status().denoised).toBeUndefined();
    engine.sync(on, off);
    expect(engine.status().denoised).toBe(true);
    expect(workers.flatMap((w) => w.denoised)).toHaveLength(n);
  });

  it('with the denoise on, the passes are about as long as a denoise; a gesture neither renders guides nor denoises (U11)', { timeout: 30000 }, async () => {
    expect([livePassCap(10, 400), livePassCap(40, 100), livePassCap(40, 400), livePassCap(500, 400), livePassCap(0, 400)]).toEqual([16, 6, 10, 1, MAX_PASS_SAMPLES]);
    expect(LIVE_PASS_MS).toBe(250);
    const { engine, workers } = await viewport(2, 64, 32);
    // A pass costs 60 ms a sample: four samples fill the 250 ms a pass aims at.
    workers.forEach((w) => ((w.delay = 0), (w.sampleDelay = 60)));
    engine.setViewportLimit({ by: 'SAMPLES', samples: 99999, seconds: 120 });
    const later = exampleState();
    engine.sync({ ...later, render: { ...later.render, maxSamples: later.render.maxSamples + 1 } }, later);
    const start = workers.map((w) => jobsOf(w).length);
    const t0 = Date.now();
    while (Date.now() - t0 < 1500) await settle(engine, 1);
    const counts = workers.flatMap((w, i) => jobsOf(w).slice(start[i])).map((m) => m.count);
    expect(counts.length).toBeGreaterThan(3);
    expect(Math.max(...counts)).toBeLessThanOrEqual(livePassCap(60, LIVE_PASS_MS));
    // A gesture: reduced frames, no guides, no denoise.
    workers.forEach((w) => ((w.sampleDelay = 0), (w.delay = 1)));
    const asked = workers.flatMap((w) => w.denoised).length;
    const before = workers.map((w) => jobsOf(w).length);
    engine.beginGesture();
    engine.gestureView({ azimuth: 2 });
    await settle(engine, 20);
    const gesture = workers.flatMap((w, i) => jobsOf(w).slice(before[i]));
    expect(gesture.length).toBeGreaterThan(0);
    expect(gesture.every((m) => (m.passes ?? 0) === 0)).toBe(true);
    expect(engine.status().scale).toBeGreaterThan(1);
    expect(engine.status().denoised).toBeUndefined();
    expect(workers.flatMap((w) => w.denoised).length).toBeLessThanOrEqual(asked + workers.length);
    engine.endGesture();
  });

  it('U11b: the live denoise of the view uses the project’s strength, and at 0 % none runs', { timeout: 30000 }, async () => {
    const { engine, workers } = await viewport(2, 64, 32);
    const base = exampleState();
    const at = (n: number) => ({ ...base, render: { ...base.render, advanced: { ...base.render.advanced, denoiseStrength: n } } });
    engine.sync(at(40), base);
    for (let i = 0; i < 100 && !workers.some((w) => w.denoised.some((m) => m.strength === 0.4)); i++) await settle(engine, 1);
    expect(workers.flatMap((w) => w.denoised).some((m) => m.strength === 0.4 && m.preset === 'VIEWPORT')).toBe(true);
    // At 0 % (a new view: the strength is in the scene the engine gets) nothing is denoised.
    engine.sync(at(0), at(40));
    await settle(engine, 20);
    const before = workers.map((w) => w.denoised.length);
    await settle(engine, 30);
    workers.forEach((w, i) => expect(w.denoised.length).toBe(before[i]));
    expect(engine.status().denoised).toBeUndefined();
  });

  it('a Render denoises its image at the end and hands back the one before denoise when asked (E5b-1)', async () => {
    const { pool, workers } = await fakePool(3, 64);
    const engine = new PathTracerEngine(pool, viewSource(), false);
    engine.sync(exampleState(), null);
    const advanced = { ...DEFAULT_ADVANCED, denoise: 'RENDER' as const, saveNoisy: true };
    const opts = { width: 64, height: 24, maxSamples: 3, maxSeconds: 0, transparent: false, keepLinear: true, advanced };
    const px = await engine.renderPixels(opts);
    expect(px.denoised).toBe(true);
    expect(px.noisy).toBeDefined();
    // The stand-in denoiser halves the radiance: the image is the noisy one halved, coverage as it was.
    const noisy = px.noisy!.sum!;
    expect(Array.from(px.sum!.filter((_, i) => i % 4 !== 3))).toEqual(Array.from(noisy.filter((_, i) => i % 4 !== 3)).map((v) => Math.fround(v * 0.5)));
    expect(Array.from(px.sum!.filter((_, i) => i % 4 === 3))).toEqual(Array.from(noisy.filter((_, i) => i % 4 === 3)));
    expect(px.noisy!.data).not.toEqual(px.data);
    // Every job asked for the guides; no pass came back that was not asked for.
    expect(workers.flatMap(jobsOf).every((m) => m.passes === DENOISE_GUIDE_MASK)).toBe(true);
    expect(px.passes).toBeUndefined();
    // Denoise off (or only in the viewport): none, and no noisy copy.
    const plain = await engine.renderPixels({ ...opts, advanced: { ...advanced, denoise: 'VIEWPORT' } });
    expect(plain.denoised).toBeUndefined();
    expect(plain.noisy).toBeUndefined();
    expect(Array.from(plain.sum!)).toEqual(Array.from(noisy));
    // U11b: at 50 % the workers are asked for that strength and the image is the blend; at 0 % none is asked for.
    const asked = workers.flatMap((w) => w.denoised).length;
    const half = await engine.renderPixels({ ...opts, advanced: { ...advanced, denoiseStrength: 50 } });
    const halfAsks = workers.flatMap((w) => w.denoised).slice(asked);
    expect(halfAsks.length).toBeGreaterThan(0);
    expect(halfAsks.every((m) => m.strength === 0.5 && m.preset === undefined)).toBe(true);
    expect(half.denoised).toBe(true);
    expect(Array.from(half.sum!.filter((_, i) => i % 4 !== 3))).toEqual(Array.from(noisy.filter((_, i) => i % 4 !== 3)).map((v) => Math.fround(Math.fround(v * 0.5) + Math.fround(v * 0.25))));
    const before = workers.flatMap((w) => w.denoised).length;
    const zero = await engine.renderPixels({ ...opts, advanced: { ...advanced, denoiseStrength: 0 } });
    expect(workers.flatMap((w) => w.denoised)).toHaveLength(before);
    expect(zero.denoised).toBeUndefined();
    expect(zero.noisy).toBeUndefined();
    expect(Array.from(zero.sum!)).toEqual(Array.from(noisy));
  });

  it('waits while a Render runs when the settings say Pause, and the Render takes every worker', async () => {
    const { engine, workers } = await viewport(4);
    engine.setWhileRender('PAUSE');
    await settle(engine, 5);
    const before = workers.map((w) => jobsOf(w).length);
    workers.forEach((w) => ((w.held = []), (w.holdOnly = new Set(['tile', 'done']))));
    const pending = engine.renderPixels({ width: 80, height: 24, maxSamples: 3, maxSeconds: 0, transparent: false });
    await settle(engine, 5);
    expect(engine.status()).toMatchObject({ rendering: true, renderShare: 'PAUSED' });
    workers.forEach((w) => ((w.holdOnly = null), w.release()));
    for (let i = 0; i < 10; i++) await settle(engine, 1);
    await pending;
    const during = workers.map((w, i) => jobsOf(w).slice(before[i]));
    expect(during.every((jobs) => jobs.length > 0)).toBe(true);
  }, 30000);

  it('the watchdog starts the view again when its tiles stop coming, and says so', async () => {
    const { engine, workers } = await viewport(2, 64, 32);
    await settle(engine, 5);
    const sent = () => workers[0].got.filter((m) => m.type === 'job').length;
    // A change; its tiles never come back.
    workers.forEach((w) => ((w.held = []), (w.holdOnly = new Set(['tile', 'done']))));
    const s = exampleState();
    engine.sync({ ...s, camera: { ...s.camera } }, s);
    await settle(engine, 3);
    const before = sent();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const clock = { now: performance.now() };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    for (let t = 0; t < WATCHDOG.tileMs + 1000; t += 250) {
      clock.now += 250;
      engine.frame();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(warn.mock.calls.some((c) => /watchdog \(pool\): no tile/.test(String(c[0])))).toBe(true);
    expect(engine.watchdogFires).toBe(1);
    expect(sent()).toBeGreaterThan(before);
    expect(engine.status().issue?.kind).toBe('RESTARTED');
  }, 20000);

  it('a worker handed from the viewport to a Render gets the Render scene as an update, and back', async () => {
    const { engine, workers } = await viewport(4);
    await settle(engine, 5);
    const scenes = (w: FakeWorker) => w.got.filter((m): m is Extract<WorkerRequest, { type: 'scene' }> => m.type === 'scene').map((m) => m.full);
    expect(workers.map(scenes)).toEqual([[true], [true], [true], [true]]);
    await engine.renderPixels({ width: 80, height: 24, maxSamples: 1, maxSeconds: 0, transparent: false });
    await settle(engine, 5);
    // The render's three workers: an update to the render's scene and one back to the view; the viewport's
    // worker kept its scene the whole time.
    expect(workers.map(scenes)).toEqual([[true, false, false], [true, false, false], [true, false, false], [true]]);
  });
});

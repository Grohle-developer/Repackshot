// The path tracer in the browser (phase E4), the parts that need no browser: tiles and their
// workers, the pass schedule, the generation counter, the accumulation, the resolution of gesture
// frames, and the pool itself driven by fake workers.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PathTracerEngine, Pool, SIMD_PROBE, simdSupported, type SceneSource, type TracerView } from '../src/render/pathtracer';
import { exampleState } from './helpers';
import type { WorkerReply, WorkerRequest } from '../src/render/pool-protocol';
import { Accumulator, alphaByte, assignTiles, chooseScale, exactBytes, Generations, nextPass, poolSize, scaledSize, TILE, tileGrid, type TileResult } from '../src/render/tiles';
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
  constructor(private readonly width: number) {}
  postMessage(msg: WorkerRequest): void {
    this.got.push(msg);
    queueMicrotask(() => this.handle(msg));
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
        return { meshKey: 'k', bytes: (meshes) => new Uint8Array([meshes ? 2 : 1, 0, 0, 0]) };
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
    expect(workers.every((w) => w.got.some((m) => m.type === 'job'))).toBe(true);
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

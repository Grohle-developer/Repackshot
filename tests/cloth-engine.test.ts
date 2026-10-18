// The cloth simulator through the page's own code (phase S9): the cloth parity scene of rt-phys, as the native tests
// write it (tests/fixtures/cloth-drape.json: its CLT1 and PHY1 bytes and the hashes they pin), stepped by the real
// rt.wasm through render/phys-wasm.ts (the cloth stepping the rigid world with itself, as the physics worker does), must
// give the native hashes at every checkpoint, with the scalar build and with the SIMD one: native = wasm, whatever the
// SIMD path. And a CLT1 the interface writes (core/cloth.ts) loads in the engine and drapes over the box under it.
// Skipped without rt.wasm (npm run engine:build) unless REPACK_REQUIRE_RT_WASM is set.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clothSpec, cltBytes } from '../src/core/cloth';
import { defaultParams } from '../src/core/primitives';
import { createInitialState, reduce } from '../src/core/store';
import { ClothSim, hasClothExports, hasPhysExports, PhysWorld, type ClothExports, type PhysExports } from '../src/render/phys-wasm';
import type { PhysicsReply, PhysicsRequest } from '../src/render/physics-worker';
import { RT_WASM } from './wasm-engine';

interface Fixture {
  steps: number[];
  cloth: string[];
  world: string[];
  vertices: number;
  spec: string;
  scene: string;
}

const fixture = JSON.parse(readFileSync('tests/fixtures/cloth-drape.json', 'utf8')) as Fixture;
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const hex = (h: number) => `0x${(h >>> 0).toString(16).padStart(8, '0')}`;
const SIMD = RT_WASM && /(^|\/)rt\.wasm$/.test(RT_WASM) ? RT_WASM.replace(/rt\.wasm$/, 'rt-simd.wasm') : null;

async function engine(path: string): Promise<PhysExports & ClothExports> {
  const { instance } = await WebAssembly.instantiate(readFileSync(path), {});
  const e = instance.exports;
  if (!hasPhysExports(e) || !hasClothExports(e)) throw new Error(`${path} does not simulate cloth: npm run engine:build`);
  return e as unknown as PhysExports & ClothExports;
}

describe.skipIf(!RT_WASM)('cloth in rt.wasm', () => {
  for (const [name, path] of [
    ['scalar', RT_WASM],
    ['SIMD', SIMD && existsSync(SIMD) ? SIMD : null],
  ] as const) {
    it.skipIf(!path)(`steps the cloth parity scene to the native hashes (${name} build)`, async () => {
      const rt = await engine(path!);
      const world = new PhysWorld(rt, bytes(fixture.scene), 1);
      const cloth = new ClothSim(rt, bytes(fixture.spec));
      try {
        expect(cloth.vertices).toBe(fixture.vertices);
        let at = 0;
        fixture.steps.forEach((steps, i) => {
          cloth.step(steps - at, world);
          at = steps;
          expect(cloth.steps).toBe(steps);
          expect(world.steps).toBe(steps);
          expect(hex(cloth.hash), `cloth after ${steps} steps`).toBe(fixture.cloth[i]);
          expect(hex(world.hash), `world after ${steps} steps`).toBe(fixture.world[i]);
        });
        const p = cloth.positions();
        expect(p.length).toBe(3 * fixture.vertices);
        for (let i = 2; i < p.length; i += 3) expect(p[i]).toBeGreaterThan(0);
      } finally {
        cloth.free();
        world.free();
      }
    }, 120_000);
  }

  it('loads the interface’s CLT1 and drapes it over the box under it', async () => {
    const rt = await engine(RT_WASM!);
    let s = createInitialState();
    s = reduce(s, { type: 'scene/addPrimitive', kind: 'BOX', params: { ...defaultParams('BOX', 200), width: 100, depth: 100, height: 100 }, position: [0, 0, 50], name: 'Box' });
    s = reduce(s, { type: 'scene/addPrimitive', kind: 'PLANE', params: { width: 300, depth: 300 }, position: [0, 0, 130], name: 'Sheet' });
    const sheet = s.selection.ids[0];
    s = reduce(s, { type: 'physics/set', ids: [sheet], patch: { role: 'CLOTH', cloth: { fabric: 'SILK' } } });
    const spec = clothSpec(s)!;
    const sim = new ClothSim(rt, cltBytes(spec));
    try {
      expect(sim.vertices).toBe(spec.pieces[0].positions.length / 3);
      sim.step(240);
      const p = sim.positions();
      let top = -Infinity;
      let low = Infinity;
      for (let i = 2; i < p.length; i += 3) {
        top = Math.max(top, p[i]);
        low = Math.min(low, p[i]);
      }
      // Resting on the top of the box (100 mm), at its thickness; the rest hangs down its sides.
      expect(top).toBeGreaterThan(100);
      expect(top).toBeLessThan(105);
      expect(low).toBeLessThan(80);
    } finally {
      sim.free();
    }
    expect(() => new ClothSim(rt, new TextEncoder().encode('PHY1 not cloth'))).toThrow(/CLT1/);
  }, 120_000);

  it('the physics worker runs a cloth alone: its vertices at step 0 and at every frame, and it settles', async () => {
    const replies: PhysicsReply[] = [];
    const scope = { postMessage: (m: PhysicsReply) => replies.push(m), onmessage: null as ((e: { data: PhysicsRequest }) => void) | null };
    (globalThis as { self?: unknown }).self = scope;
    await import('../src/render/physics-worker');
    const send = (data: PhysicsRequest) => scope.onmessage!({ data });
    send({ type: 'init', module: await WebAssembly.compile(readFileSync(RT_WASM!)) });
    const until = async (what: () => boolean, ms = 120000) => {
      const end = performance.now() + ms;
      while (!what()) {
        if (performance.now() > end) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    await until(() => replies.some((r) => r.type === 'ready'));
    let s = createInitialState();
    s = reduce(s, { type: 'scene/addPrimitive', kind: 'BOX', params: { ...defaultParams('BOX', 200), width: 60, depth: 60, height: 60 }, position: [0, 0, 30], name: 'Box' });
    s = reduce(s, { type: 'scene/addPrimitive', kind: 'PLANE', params: { width: 120, depth: 120 }, position: [0, 0, 70], name: 'Sheet' });
    s = reduce(s, { type: 'physics/set', ids: [s.selection.ids[0]], patch: { role: 'CLOTH', cloth: { fabric: 'DENIM', resolutionMm: 10 } } });
    const spec = clothSpec(s)!;
    const vertices = spec.pieces[0].positions.length / 3;
    send({ type: 'run', id: 3, scene: null, dynamic: 0, options: { fps: 24, maxSeconds: 30 }, cloth: cltBytes(spec).slice().buffer });
    await until(() => replies.some((r) => r.type === 'started'));
    const started = replies.find((r) => r.type === 'started') as Extract<PhysicsReply, { type: 'started' }>;
    expect(started.cloth?.length).toBe(3 * vertices);
    expect(started.noCloth).toBeUndefined();
    let acked = 0;
    await until(() => {
      const n = replies.reduce((k, r) => k + (r.type === 'progress' ? r.frames.length : 0), 0);
      if (n > acked) {
        send({ type: 'ack', id: 3, frames: n - acked });
        acked = n;
      }
      return replies.some((r) => r.type === 'done' || r.type === 'error');
    });
    const progress = replies.filter((r) => r.type === 'progress') as Extract<PhysicsReply, { type: 'progress' }>[];
    for (const p of progress) {
      expect(p.cloth).toHaveLength(p.frames.length);
      for (const c of p.cloth!) expect(c.length).toBe(3 * vertices);
    }
    const done = replies.find((r) => r.type === 'done') as Extract<PhysicsReply, { type: 'done' }>;
    expect(done.reason).toBe('SETTLED');
    // Resting on the box's top (60 mm) at its thickness.
    const last = (done.cloth?.at(-1) ?? progress.at(-1)!.cloth!.at(-1))!;
    let top = -Infinity;
    for (let i = 2; i < last.length; i += 3) top = Math.max(top, last[i]);
    expect(top).toBeGreaterThan(60);
    expect(top).toBeLessThan(64);
  }, 180_000);
});

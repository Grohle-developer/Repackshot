// The cloth simulator through the page's own code (phase S9): the cloth parity scene of rt-phys, as the native tests
// write it (tests/fixtures/cloth-drape.json: its CLT1 and PHY1 bytes and the hashes they pin), stepped by the real
// rt.wasm through render/phys-wasm.ts (the cloth stepping the rigid world with itself, as the physics worker does), must
// give the native hashes at every checkpoint, with the scalar build and with the SIMD one: native = wasm, whatever the
// SIMD path. And a CLT1 the interface writes (core/cloth.ts) loads in the engine and drapes over the box under it; silk
// laid over the example bottle by Drape over the part leaves no edge of the cap or of the bottle through the cloth.
// Skipped without rt.wasm (npm run engine:build) unless REPACK_REQUIRE_RT_WASM is set.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clothSpec, cltBytes, drapePlacement } from '../src/core/cloth';
import { defaultParams } from '../src/core/primitives';
import { createInitialState, reduce } from '../src/core/store';
import { ClothSim, hasClothExports, hasPhysExports, PhysWorld, type ClothExports, type PhysExports } from '../src/render/phys-wasm';
import type { PhysicsReply, PhysicsRequest } from '../src/render/physics-worker';
import { apply, exampleState } from './helpers';
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

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Whether the segment p0 p1 passes through the triangle a b c, strictly inside both (Möller and Trumbore). */
function pierces(p0: V, p1: V, a: V, b: V, c: V): boolean {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const d = sub(p1, p0);
  const h = cross(d, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return false;
  const s = sub(p0, a);
  const u = dot(s, h) / det;
  const q = cross(s, e1);
  const v = dot(d, q) / det;
  const t = dot(e2, q) / det;
  return u > 0 && v > 0 && u + v < 1 && t > 0 && t < 1;
}

/** The edges of a mesh (each once) that pass through a triangle of the cloth. */
function edgesThrough(mesh: { positions: Float32Array; indices: Uint32Array }, cloth: Float32Array, tris: Uint32Array): number {
  const at = (p: Float32Array, i: number): V => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const boxes: { lo: V; hi: V; k: number }[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [at(cloth, tris[t]), at(cloth, tris[t + 1]), at(cloth, tris[t + 2])];
    boxes.push({ lo: [0, 1, 2].map((k) => Math.min(a[k], b[k], c[k])) as V, hi: [0, 1, 2].map((k) => Math.max(a[k], b[k], c[k])) as V, k: t });
  }
  const seen = new Set<string>();
  let through = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let s = 0; s < 3; s++) {
      const i = mesh.indices[t + s];
      const j = mesh.indices[t + ((s + 1) % 3)];
      const p0 = at(mesh.positions, i);
      const p1 = at(mesh.positions, j);
      const key = [p0, p1].map((p) => p.join(',')).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const lo = [0, 1, 2].map((k) => Math.min(p0[k], p1[k]));
      const hi = [0, 1, 2].map((k) => Math.max(p0[k], p1[k]));
      for (const b of boxes) {
        if (b.lo[0] > hi[0] || b.hi[0] < lo[0] || b.lo[1] > hi[1] || b.hi[1] < lo[1] || b.lo[2] > hi[2] || b.hi[2] < lo[2]) continue;
        if (pierces(p0, p1, at(cloth, tris[b.k]), at(cloth, tris[b.k + 1]), at(cloth, tris[b.k + 2]))) {
          through++;
          break;
        }
      }
    }
  }
  return through;
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

  it('silk laid over the example bottle by Drape over the part leaves no edge of the cap or the bottle through it', async () => {
    const rt = await engine(RT_WASM!);
    const base = exampleState();
    const place = drapePlacement(base, base.scene.roots)!;
    let s = apply(base, { type: 'scene/addPrimitive', kind: 'PLANE', params: place.params, position: place.position, name: 'Cloth', material: place.material });
    s = apply(s, { type: 'physics/set', ids: [s.selection.ids[0]], patch: { role: 'CLOTH', cloth: { fabric: 'SILK' } } });
    const spec = clothSpec(s)!;
    const sim = new ClothSim(rt, cltBytes(spec));
    try {
      // Until it settles, or three seconds.
      for (let k = 0; k < 72 && !sim.settled; k++) sim.step(10);
      const p = sim.positions();
      const through = spec.statics.map((m) => edgesThrough(m, p, spec.pieces[0].indices));
      expect(spec.statics.length).toBeGreaterThanOrEqual(5);
      expect(through, `edges through the cloth, part by part, after ${sim.steps} steps`).toEqual(spec.statics.map(() => 0));
      // And it is over the bottle: down past the cap's top (121 mm).
      let low = Infinity;
      for (let i = 2; i < p.length; i += 3) low = Math.min(low, p[i]);
      expect(low).toBeLessThan(100);
    } finally {
      sim.free();
    }
  }, 300_000);

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

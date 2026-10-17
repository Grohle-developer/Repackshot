// Phase L5: the page writes the IES lights as such when the engine says it renders them (rt_features bit 2, `features` of the
// launcher's /api/info: render/engine.ts `readsIes`); for any other engine they go as the spot light that stands for them.
// The views of Render and of the Full viewport carry the switch, on the pool of wasm workers and on the native engine alike.

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/store';
import { ENGINE_FEATURE_IES, ENGINE_FEATURE_PROGRAMS, ENGINE_FEATURE_TEXTURES } from '../src/render/engine';
import { FLAG_DATA, FLAG_DONE, FRAME_HEADER, NativeEngine } from '../src/render/native';
import { PathTracerEngine, Pool, type SceneSource, type TracerView } from '../src/render/pathtracer';
import type { WorkerReply, WorkerRequest } from '../src/render/pool-protocol';
import { installDom } from './launcher-mock';

const ALL = ENGINE_FEATURE_TEXTURES | ENGINE_FEATURE_PROGRAMS | ENGINE_FEATURE_IES;

/** A worker that says it is ready with `features` and loads any scene. */
class ReadyWorker {
  onmessage: ((e: { data: WorkerReply }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  constructor(private readonly features: number | undefined) {}
  postMessage(msg: WorkerRequest): void {
    queueMicrotask(() => {
      if (msg.type === 'init') this.onmessage?.({ data: { type: 'ready', version: 0x000300, ...(this.features === undefined ? {} : { features: this.features }) } });
      if (msg.type === 'scene') this.onmessage?.({ data: { type: 'scene', id: msg.id, error: null } });
      if (msg.type === 'job') {
        for (let k = 0; k < msg.tiles.length; k += 5) {
          const [, , w, h, index] = msg.tiles.subarray(k, k + 5);
          this.onmessage?.({ data: { type: 'tile', generation: msg.generation, index, first: msg.first, count: msg.count, data: new Float32Array(w * h * 4 * msg.count) } });
        }
        this.onmessage?.({ data: { type: 'done', generation: msg.generation } });
      }
      if (msg.type === 'tonemap') this.onmessage?.({ data: { type: 'pixels', id: msg.id, bytes: new Uint8ClampedArray((msg.sum.byteLength / 16) * 4) } });
    });
  }
  terminate(): void {}
}

/** A finished frame of the launcher (render.rs `Frame::header`), its sums zero. */
function doneFrame(width: number, height: number): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_HEADER + width * height * 16);
  const v = new DataView(buf);
  'RPX1'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  [FRAME_HEADER, 1, 1, width, height].forEach((x, i) => v.setUint32(4 + i * 4, x, true));
  v.setFloat32(24, 0.5, true);
  v.setUint32(28, FLAG_DONE | FLAG_DATA, true);
  v.setUint32(32, 64, true);
  v.setUint32(36, 8, true);
  v.setBigUint64(40, 1n, true);
  return buf;
}

function recording(views: TracerView[]): SceneSource {
  return {
    build: (_s, view) => {
      views.push(view);
      return { meshKey: 'k', bytes: (meshes) => new Uint8Array([meshes ? 2 : 1, view.width & 255, 0, 0]) };
    },
    tone: () => ({ exposureEv: 0, tonemap: 1 }),
  };
}

describe('the switch: the page writes the IES lights when the engine renders them (L5)', () => {
  for (const [what, features, on] of [
    ['an engine that renders them', ALL, true],
    ['an engine of M3b (textures and programs)', ENGINE_FEATURE_TEXTURES | ENGINE_FEATURE_PROGRAMS, false],
    ['an rt.wasm of before M2b (no rt_features)', undefined, false],
  ] as const) {
    it(`a Render asks for them with ${what}, and the viewport too`, async () => {
      const pool = await Pool.create({} as WebAssembly.Module, 2, () => new ReadyWorker(features) as unknown as Worker);
      const views: TracerView[] = [];
      const engine = new PathTracerEngine(pool, recording(views), false);
      engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
      await engine.renderPixels({ width: 8, height: 4, maxSamples: 1, maxSeconds: 0, transparent: false });
      expect(views.length).toBeGreaterThan(0);
      expect(views.every((v) => (v.ies === true) === on)).toBe(true);
      const dom = installDom();
      try {
        views.length = 0;
        engine.mount(dom.canvas as unknown as HTMLCanvasElement);
        engine.resize(16, 8, 1);
        engine.setActive(true);
        for (let i = 0; i < 10 && !views.some((v) => v.viewport); i++) {
          engine.frame();
          await new Promise((r) => setTimeout(r, 3));
        }
        expect(views.some((v) => v.viewport)).toBe(true);
        expect(views.every((v) => (v.ies === true) === on)).toBe(true);
        engine.setActive(false);
      } finally {
        dom.restore();
      }
      engine.dispose();
    });
  }

  for (const [what, features, on] of [
    ['a launcher whose engine renders them', ALL, true],
    ['a launcher of M3b', ENGINE_FEATURE_TEXTURES | ENGINE_FEATURE_PROGRAMS, false],
    ['a launcher of before M2b (no features)', undefined, false],
  ] as const) {
    it(`a Render on the desktop asks for them with ${what}, and the viewport too`, async () => {
      const views: TracerView[] = [];
      const transport = {
        async request(_path: string, init: RequestInit = {}) {
          if (init.method === 'POST') return new Response(JSON.stringify({ id: 1 }));
          if (init.method === 'DELETE') return new Response(null, { status: 204 });
          return new Response(doneFrame(4, 3));
        },
      };
      const engine = new NativeEngine(transport, recording(views), { threads: 2, isa: 'avx2', ...(features === undefined ? {} : { features }) });
      engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
      await engine.renderPixels({ width: 4, height: 3, maxSamples: 1, maxSeconds: 0, transparent: false });
      expect(views.length).toBeGreaterThan(0);
      expect(views.every((v) => (v.ies === true) === on)).toBe(true);
      const dom = installDom();
      try {
        views.length = 0;
        engine.mount(dom.canvas as unknown as HTMLCanvasElement);
        engine.resize(16, 8, 1);
        engine.setActive(true);
        for (let i = 0; i < 10 && !views.some((v) => v.viewport); i++) {
          engine.frame();
          await new Promise((r) => setTimeout(r, 3));
        }
        expect(views.some((v) => v.viewport)).toBe(true);
        expect(views.every((v) => (v.ies === true) === on)).toBe(true);
        engine.setActive(false);
      } finally {
        dom.restore();
      }
    });
  }
});

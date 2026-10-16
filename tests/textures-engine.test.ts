// Phase M2b: the engine reads the textures. The page writes them when the engine says it does (rt_features of
// rt.wasm, `features` of the launcher's /api/info: render/engine.ts `readsTextures`), the views of Full and of Render
// carry the switch, the page's writer gives the bytes of `rt --write-m2b-example` for the engine's texture scene
// (tests/fixtures/m2b.rsb), and the real rt.wasm renders it, through the page's own code, to rt-core's pinned image.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/store';
import { ENGINE_FEATURE_TEXTURES, readsTextures } from '../src/render/engine';
import { projectScene, writeRsb, type RsbScene } from '../src/io/rsb';
import { decodeTexturePixels } from '../src/io/texture-pixels';
import { PathTracerEngine, Pool, type SceneSource, type TracerView } from '../src/render/pathtracer';
import type { WorkerReply, WorkerRequest } from '../src/render/pool-protocol';
import { readRsb, sections } from './rsb-reader';
import { fixtureDecoder, texturedProject } from './texture-helpers';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const FIXTURE = new Uint8Array(readFileSync('tests/fixtures/m2b.rsb'));

function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** A worker that says it is ready, with `features` (absent: an rt.wasm of before M2b), and loads any scene. */
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

function recording(views: TracerView[]): SceneSource {
  return {
    build: (_s, view) => {
      views.push(view);
      return { meshKey: 'k', bytes: (meshes) => new Uint8Array([meshes ? 2 : 1, view.width & 255, 0, 0]) };
    },
    tone: () => ({ exposureEv: 0, tonemap: 1 }),
  };
}

describe('the switch: the page writes the textures when the engine reads them (M2b)', () => {
  it('reads the bit the engine reports', () => {
    expect(ENGINE_FEATURE_TEXTURES).toBe(1);
    expect(readsTextures(1)).toBe(true);
    expect(readsTextures(3)).toBe(true);
    expect(readsTextures(0)).toBe(false);
    expect(readsTextures(2)).toBe(false);
    expect(readsTextures(undefined)).toBe(false);
  });

  for (const [what, features, on] of [
    ['an engine that reads them', 1, true],
    ['an rt.wasm of before M2b (no rt_features)', undefined, false],
  ] as const) {
    it(`a Render asks for them with ${what}`, async () => {
      const pool = await Pool.create({} as WebAssembly.Module, 2, () => new ReadyWorker(features) as unknown as Worker);
      expect(pool.features).toBe(features ?? 0);
      const views: TracerView[] = [];
      const engine = new PathTracerEngine(pool, recording(views), false);
      engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
      await engine.renderPixels({ width: 8, height: 4, maxSamples: 1, maxSeconds: 0, transparent: false });
      expect(views.length).toBeGreaterThan(0);
      expect(views.every((v) => (v.textures === true) === on)).toBe(true);
      engine.dispose();
    });
  }

  it('the scene written with the switch on carries IMGS, the texture blocks and the UVs; off, none of them', async () => {
    const s = await texturedProject();
    await decodeTexturePixels(s, fixtureDecoder);
    const view = { width: 64, height: 48, maxSamples: 4, maxSeconds: 0 };
    const on = sections(writeRsb(projectScene(s, { ...view, textures: true }).scene)).map((x) => x.tag);
    const off = sections(writeRsb(projectScene(s, view).scene)).map((x) => x.tag);
    expect(on).toContain('IMGS');
    expect(off).not.toContain('IMGS');
  });
});

describe('the page’s writer gives the engine’s texture scene byte for byte', () => {
  it('reads tests/fixtures/m2b.rsb (`rt --write-m2b-example`) and writes it back to the same bytes', () => {
    const r = readRsb(FIXTURE);
    expect(r.textures).toBe(true);
    expect(r.images?.map((im) => [im.width, im.height, im.channels, im.colorSpace])).toEqual([
      [64, 64, 3, 0],
      [32, 32, 3, 1],
      [64, 32, 4, 0],
      [16, 16, 1, 1],
      [32, 32, 1, 1],
      [32, 32, 3, 0],
      [16, 16, 1, 0],
      [8, 8, 4, 0],
    ]);
    // Every material has its block (the box: two slots and a label; the card: three slots and its tint).
    expect(r.materials.every((m) => m.textures)).toBe(true);
    expect(r.materials[1].textures!.labels).toHaveLength(1);
    expect(r.materials[1].textures!.slots.map((x) => x.image)).toEqual([0, -1, -1, 1, -1, -1]);
    expect(r.materials[4].textures!.slots[5]).toMatchObject({ image: 5, uvSet: 1, wrap: 1 });
    // The card has two UV sets, the lamp one, the others none.
    expect(r.meshes.map((m) => (m.uvs ? (m.uvs2 ? 2 : 1) : 0))).toEqual([0, 0, 0, 0, 2, 1]);
    const scene: RsbScene = {
      camera: r.camera!,
      materials: r.materials,
      meshes: r.meshes,
      instances: r.instances,
      lights: r.lights,
      environment: r.environment!,
      floor: r.floor!,
      render: r.render!,
      bitmaps: r.bitmaps,
      textures: true,
      images: r.images!,
    };
    const bytes = writeRsb(scene);
    expect(bytes.length).toBe(FIXTURE.length);
    expect(firstDiff(bytes, FIXTURE)).toBe(-1);
  });
});

const live = RT_WASM ? describe : describe.skip;

live('the real rt.wasm reads the textures', () => {
  it('says so, and renders the engine’s texture scene through the page’s code to rt-core’s pinned image', async () => {
    const rt = await loadRt();
    const features = (rt as unknown as { rt_features?: () => number }).rt_features;
    expect(typeof features).toBe('function');
    expect(readsTextures(features!())).toBe(true);
    const { image } = renderWithPasses(rt, FIXTURE, 160, 120, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_M2B_TEXTURES_4SPP'));
  });

  it('renders a project’s textures: with them the image is another than without', async () => {
    const rt = await loadRt();
    const s = await texturedProject();
    await decodeTexturePixels(s, fixtureDecoder);
    const view = { width: 48, height: 36, maxSamples: 2, maxSeconds: 0 };
    const on = renderWithPasses(rt, writeRsb(projectScene(s, { ...view, textures: true }).scene), 48, 36, 2, 0);
    const off = renderWithPasses(rt, writeRsb(projectScene(s, view).scene), 48, 36, 2, 0);
    expect(fnv1a(resolveRgb(on.image, 2))).not.toBe(fnv1a(resolveRgb(off.image, 2)));
  });
});

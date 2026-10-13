import { describe, expect, it, vi } from 'vitest';
import { connectNative, NativeClient, takeLaunchToken, TOKEN_KEY, type NativeInfo } from '../src/io/native';
import { exactBytesSliced, FLAG_DATA, FLAG_DONE, FRAME_HEADER, meshKeyHash, NativeEngine, parseFrame } from '../src/render/native';
import { exactBytes } from '../src/render/tiles';
import { createInitialState } from '../src/core/store';
import { FLOOR_ID } from '../src/core/passes';
import { readFileSync } from 'node:fs';

const TOKEN = '0123456789abcdef0123456789abcdef';

function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const INFO: NativeInfo = {
  app: 'repackshot',
  version: '0.1.0',
  engineVersion: '0.3.0',
  threads: 8,
  isa: 'avx2',
  simd: ['scalar', 'sse2', 'avx2'],
  os: 'linux',
  arch: 'x86_64',
  dataDir: '/d',
  modelsDir: '/d/models',
  logsDir: '/d/logs',
  resultsDir: '/d/results',
  portable: true,
  browser: 'chromium',
  pid: 1,
};

describe('the launcher token', () => {
  it('is taken from the fragment, kept for the session and removed from the address bar', () => {
    const storage = memoryStorage();
    const replaced: string[] = [];
    const token = takeLaunchToken({ hash: `#token=${TOKEN}`, pathname: '/', search: '?mode=full' }, storage, { replaceState: (_d, _u, url) => replaced.push(url ?? '') });
    expect(token).toBe(TOKEN);
    expect(storage.data.get(TOKEN_KEY)).toBe(TOKEN);
    expect(replaced).toEqual(['/?mode=full']);
    // A reload: the fragment is gone, the session still has it.
    expect(takeLaunchToken({ hash: '', pathname: '/', search: '' }, storage, null)).toBe(TOKEN);
  });

  it('is ignored when malformed, and absent in the web version', () => {
    const storage = memoryStorage();
    expect(takeLaunchToken({ hash: '#token=xyz', pathname: '/', search: '' }, storage, null)).toBeNull();
    expect(takeLaunchToken({ hash: `#token=${TOKEN.toUpperCase()}`, pathname: '/', search: '' }, storage, null)).toBeNull();
    storage.setItem(TOKEN_KEY, 'not-a-token');
    expect(takeLaunchToken({ hash: '', pathname: '/', search: '' }, storage, null)).toBeNull();
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(takeLaunchToken({ hash: `#a=1&token=${TOKEN}`, pathname: '/', search: '' }, broken, null)).toBe(TOKEN);
    expect(takeLaunchToken({ hash: '', pathname: '/', search: '' }, broken, null)).toBeNull();
  });
});

describe('connectNative', () => {
  const loc = { hash: `#token=${TOKEN}`, pathname: '/', search: '' };

  it('needs the token and an answer from /api/info', async () => {
    const calls: [string, Headers][] = [];
    const ok = async (url: string, init?: RequestInit) => {
      calls.push([url, new Headers(init?.headers)]);
      return new Response(JSON.stringify(INFO), { status: 200 });
    };
    const client = await connectNative({ location: loc, storage: memoryStorage(), history: null, fetch: ok });
    expect(client).toBeInstanceOf(NativeClient);
    expect(client!.info.threads).toBe(8);
    expect(calls[0][0]).toBe('/api/info');
    expect(calls[0][1].get('X-Repackshot-Token')).toBe(TOKEN);
    let called = false;
    expect(await connectNative({ location: { hash: '', pathname: '/', search: '' }, storage: memoryStorage(), history: null, fetch: async () => ((called = true), new Response('{}')) })).toBeNull();
    expect(called).toBe(false);
    expect(await connectNative({ location: loc, storage: null, history: null, fetch: async () => new Response('{}', { status: 401 }) })).toBeNull();
    expect(await connectNative({ location: loc, storage: null, history: null, fetch: async () => { throw new TypeError('offline'); } })).toBeNull();
    expect(await connectNative({ location: loc, storage: null, history: null, fetch: async () => new Response('{"app":"other"}') })).toBeNull();
  });
});

describe('the launcher client', () => {
  function client(reply: (url: string, init: RequestInit) => Response) {
    const seen: { url: string; init: RequestInit }[] = [];
    const c = new NativeClient(TOKEN, INFO, async (url, init) => {
      seen.push({ url, init: init ?? {} });
      return reply(url, init ?? {});
    });
    return { c, seen };
  }
  const sha = 'ab'.repeat(32);

  it('sends the token and the blob API as the launcher expects', async () => {
    const { c, seen } = client(() => new Response(JSON.stringify({ sha256: sha, state: 'partial', contiguous: 10, written: 10 })));
    const st = await c.putChunk(sha, 1024, new Uint8Array(4), 4096);
    expect(st.contiguous).toBe(10);
    expect(seen[0].url).toBe(`/api/models/blobs/${sha}?offset=1024&total=4096`);
    expect(seen[0].init.method).toBe('PUT');
    expect(new Headers(seen[0].init.headers).get('X-Repackshot-Token')).toBe(TOKEN);
    await c.blobStatus(sha);
    expect(seen[1].url).toBe(`/api/models/blobs/${sha}/status`);
    await c.remove('ZIMAGE_Q4', ['ZIMAGE_Q8']);
    expect(seen[2].url).toBe('/api/models/ZIMAGE_Q4?keep=ZIMAGE_Q8');
    expect(seen[2].init.method).toBe('DELETE');
    await c.readBlob(sha, [0, 99]);
    expect(new Headers(seen[3].init.headers).get('Range')).toBe('bytes=0-99');
    await c.openFolder('models');
    expect(seen[4].init.body).toBe('{"folder":"models"}');
    await expect(c.blobStatus('../x')).rejects.toThrow();
    await expect(c.putChunk(sha.toUpperCase(), 0, new Uint8Array(1))).rejects.toThrow();
    await expect(c.install('../KEY')).rejects.toThrow();
  });

  it('reports a damaged blob and API errors', async () => {
    const { c } = client((url) =>
      url.endsWith('/finish')
        ? new Response(JSON.stringify({ error: 'sha256-mismatch', actual: 'cd'.repeat(32) }), { status: 422 })
        : new Response(JSON.stringify({ error: 'missing', message: 'files of the model are not complete' }), { status: 409 }),
    );
    expect(await c.finishBlob(sha)).toEqual({ ok: false, status: 422, error: 'sha256-mismatch', actual: 'cd'.repeat(32) });
    await expect(c.install('ZIMAGE_Q8')).rejects.toMatchObject({ status: 409, code: 'missing' });
  });
});

/** A frame as the launcher writes it (render.rs `Frame::header`). */
function frame(f: { pass: number; samples: number; width: number; height: number; seconds?: number; flags: number; sums?: Float32Array }): ArrayBuffer {
  const data = f.sums && f.flags & FLAG_DATA ? f.sums.length * 4 : 0;
  const buf = new ArrayBuffer(FRAME_HEADER + data);
  const v = new DataView(buf);
  'RPX1'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  [FRAME_HEADER, f.pass, f.samples, f.width, f.height].forEach((x, i) => v.setUint32(4 + i * 4, x, true));
  v.setFloat32(24, f.seconds ?? 0.5, true);
  v.setUint32(28, f.flags, true);
  v.setUint32(32, 64, true);
  v.setUint32(36, 8, true);
  v.setBigUint64(40, 12345n, true);
  if (data) new Float32Array(buf, FRAME_HEADER).set(f.sums!);
  return buf;
}

describe('native frames', () => {
  it('parse the header and the sums', () => {
    const sums = new Float32Array([1, 2, 3, 4, 0.5, 0.25, 0.125, 1]);
    const f = parseFrame(frame({ pass: 3, samples: 4, width: 2, height: 1, flags: FLAG_DONE | FLAG_DATA, sums }));
    expect(f).toMatchObject({ pass: 3, samples: 4, width: 2, height: 1, flags: FLAG_DONE | FLAG_DATA, maxSamples: 64, threads: 8, rays: 12345 });
    expect(f.seconds).toBeCloseTo(0.5);
    expect(Array.from(f.sums!)).toEqual(Array.from(sums));
    expect(parseFrame(frame({ pass: 1, samples: 1, width: 2, height: 1, flags: 0 })).sums).toBeNull();
    expect(() => parseFrame(new ArrayBuffer(10))).toThrow();
    const bad = frame({ pass: 1, samples: 1, width: 2, height: 1, flags: 0 });
    new DataView(bad).setUint8(0, 0);
    expect(() => parseFrame(bad)).toThrow();
    const short = frame({ pass: 1, samples: 1, width: 2, height: 1, flags: 0 });
    new DataView(short).setUint32(28, FLAG_DATA, true);
    expect(() => parseFrame(short)).toThrow();
  });

  it('mesh keys hash stably', () => {
    expect(meshKeyHash('a;b')).toBe(meshKeyHash('a;b'));
    expect(meshKeyHash('a;b')).not.toBe(meshKeyHash('b;a'));
    expect(meshKeyHash('')).toMatch(/^[0-9a-f]+$/);
  });

  it('converts in slices exactly like the whole conversion', async () => {
    const w = 7;
    const h = 150;
    const sum = new Float32Array(w * h * 4).map((_, i) => ((i * 37) % 101) / 25);
    const whole = exactBytes(sum, 4, 0.5, 1);
    expect(Array.from(await exactBytesSliced(sum, w, h, 4, 0.5, 1, 64))).toEqual(Array.from(whole));
  });
});

describe('NativeEngine render', () => {
  it('posts a final job, follows its progress and converts the sums exactly', async () => {
    const width = 4;
    const height = 3;
    const sums = new Float32Array(width * height * 4).map((_, i) => (i % 4 === 3 ? 2 : (i % 7) / 3));
    const posted: string[] = [];
    let polls = 0;
    const transport = {
      async request(path: string, init: RequestInit = {}) {
        if (init.method === 'POST') {
          posted.push(path);
          return new Response(JSON.stringify({ id: 7 }));
        }
        if (init.method === 'DELETE') return new Response(null, { status: 204 });
        if (path.includes('data=0')) {
          polls++;
          return new Response(frame({ pass: polls, samples: polls, width, height, flags: polls >= 2 ? FLAG_DONE : 0 }));
        }
        return new Response(frame({ pass: 2, samples: 2, width, height, flags: FLAG_DONE | FLAG_DATA, sums }));
      },
    };
    const source = {
      build: () => ({ meshKey: 'm', bytes: () => new Uint8Array([1, 2, 3]) }),
      tone: () => ({ exposureEv: 0, tonemap: 1 }),
    };
    const engine = new NativeEngine(transport, source, { threads: 8, isa: 'avx2' });
    engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
    const progress: number[] = [];
    const px = await engine.renderPixels({ width, height, maxSamples: 2, maxSeconds: 0, transparent: false, onProgress: (p) => progress.push(p.progress) });
    expect(posted[0]).toMatch(/^\/api\/render\?kind=final&finish=samples&mesh=[0-9a-f]+&client=[0-9a-f]+&full=1$/);
    expect(px.samples).toBe(2);
    expect(Array.from(px.data)).toEqual(Array.from(exactBytes(sums, 2, 0, 1)));
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    const st = engine.status();
    expect(st).toMatchObject({ native: true, threads: 8, isa: 'avx2', workers: 8, simd: true });
    expect(st.device).toBe('native · 8 threads · avx2');
  });

  it('with passes: asks the launcher for them, reads them back by the render’s id, then forgets the job (X2)', async () => {
    const fixture = readFileSync('tests/fixtures/passes-3x2.rpp');
    const rpp = () => fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);
    const sums = new Float32Array(3 * 2 * 4).fill(1);
    const calls: string[] = [];
    let id = 42;
    const transport = {
      async request(path: string, init: RequestInit = {}) {
        calls.push(`${init.method ?? 'GET'} ${path}`);
        if (init.method === 'POST') return new Response(JSON.stringify({ id }));
        if (init.method === 'DELETE') return new Response(null, { status: 204 });
        if (path.endsWith('/passes')) return new Response(rpp());
        if (path.includes('data=0')) return new Response(frame({ pass: 1, samples: 7, width: 3, height: 2, flags: FLAG_DONE }));
        return new Response(frame({ pass: 1, samples: 7, width: 3, height: 2, flags: FLAG_DONE | FLAG_DATA, sums }));
      },
    };
    const views: { passes?: readonly string[] }[] = [];
    const source = { build: (_s: unknown, v: { passes?: readonly string[] }) => (views.push(v), { meshKey: 'm', bytes: () => new Uint8Array([1]) }), tone: () => ({ exposureEv: 0, tonemap: 1 }) };
    const engine = new NativeEngine(transport, source, { threads: 4, isa: 'avx2' });
    engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
    const px = await engine.renderPixels({ width: 3, height: 2, maxSamples: 7, maxSeconds: 0, transparent: false, passes: ['albedo', 'depth', 'partId'] });
    expect(calls[0]).toMatch(/^POST \/api\/render\?kind=final&finish=samples&passes=albedo,depth,partId&mesh=/);
    expect(views[0].passes).toEqual(['albedo', 'depth', 'partId']);
    // The passes are read before the job is forgotten.
    expect(calls.indexOf('GET /api/render/42/passes')).toBeLessThan(calls.indexOf('DELETE /api/render/42'));
    expect(px.renderId).toBe(42);
    expect([px.passes!.width, px.passes!.height, px.passes!.partId![4], px.passes!.depth![5]]).toEqual([3, 2, FLOOR_ID, Infinity]);
    // A render without passes asks for none; passes of another render are not taken.
    calls.length = 0;
    const plain = await engine.renderPixels({ width: 3, height: 2, maxSamples: 7, maxSeconds: 0, transparent: false });
    expect(plain.passes).toBeUndefined();
    expect(calls.some((c) => c.includes('passes'))).toBe(false);
    id = 43;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const other = await engine.renderPixels({ width: 3, height: 2, maxSamples: 7, maxSeconds: 0, transparent: false, passes: ['depth'] });
    expect(other.passes).toBeUndefined();
    expect(other.renderId).toBe(43);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('render 43: no passes'));
    warn.mockRestore();
  });

  it('finishes by time natively, keeps the linear sums and cancels through the signal', async () => {
    const width = 2;
    const height = 2;
    const sums = new Float32Array(width * height * 4).fill(3);
    const calls: string[] = [];
    let polls = 0;
    const abort = new AbortController();
    const transport = {
      async request(path: string, init: RequestInit = {}) {
        calls.push(`${init.method ?? 'GET'} ${path}`);
        if (init.method === 'POST') return new Response(JSON.stringify({ id: 9 }));
        if (init.method === 'DELETE') return new Response(null, { status: 204 });
        if (path.includes('data=0') && polls < 0) {
          // A long-poll with nothing new yet: the page aborts meanwhile.
          await new Promise((r) => setTimeout(r, 20));
          return new Response(frame({ pass: 0, samples: 0, width, height, flags: 0 }));
        }
        if (path.includes('data=0')) {
          polls++;
          // 1.5 s of a 3 s budget: half way by time, whatever the samples.
          return new Response(frame({ pass: polls, samples: polls * 2, width, height, seconds: 1.5 * polls, flags: polls >= 2 ? FLAG_DONE : 0 }));
        }
        return new Response(frame({ pass: 2, samples: 4, width, height, seconds: 3, flags: FLAG_DONE | FLAG_DATA, sums }));
      },
    };
    const source = { build: () => ({ meshKey: 'm', bytes: () => new Uint8Array([1]) }), tone: () => ({ exposureEv: 0.5, tonemap: 2 }) };
    const engine = new NativeEngine(transport, source, { threads: 4, isa: 'sse2' });
    engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
    const progress: number[] = [];
    const px = await engine.renderPixels({ width, height, maxSamples: 1000, maxSeconds: 3, finishBy: 'TIME', transparent: false, keepLinear: true, onProgress: (p) => progress.push(p.progress) });
    expect(calls[0]).toMatch(/^POST \/api\/render\?kind=final&finish=time&mesh=/);
    expect(progress[1]).toBeCloseTo(0.5);
    expect(px).toMatchObject({ samples: 4, exposureEv: 0.5, tonemap: 2 });
    expect(Array.from(px.sum!)).toEqual(Array.from(sums));
    expect(Array.from(px.data)).toEqual(Array.from(exactBytes(sums, 4, 0.5, 2)));
    // Abort while it runs: the launcher is told to stop the job.
    polls = -100;
    const pending = engine.renderPixels({ width, height, maxSamples: 8, maxSeconds: 0, transparent: false, signal: abort.signal });
    await new Promise((r) => setTimeout(r, 0));
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toContain('DELETE /api/render/9');
  });

  it('follows the Settings: the viewport limit by samples or by time, and a render of another project', async () => {
    const g = globalThis as { document?: unknown };
    const hadDocument = 'document' in g;
    const saved = g.document;
    g.document = { createElement: () => ({ getContext: () => null }) };
    try {
      const posted: string[] = [];
      const views: { maxSamples: number; maxSeconds: number }[] = [];
      const states: unknown[] = [];
      const transport = {
        async request(path: string, init: RequestInit = {}) {
          if (init.method === 'POST') {
            posted.push(path);
            return new Response(JSON.stringify({ id: posted.length }));
          }
          // Viewport polls: the job is done at once (no data), so the loop ends.
          return new Response(frame({ pass: 1, samples: 1, width: 4, height: 3, flags: FLAG_DONE }));
        },
      };
      const source = {
        build: (state: unknown, view: { maxSamples: number; maxSeconds: number }) => {
          states.push(state);
          views.push({ maxSamples: view.maxSamples, maxSeconds: view.maxSeconds });
          return { meshKey: 'm', bytes: () => new Uint8Array([views.length]) };
        },
        tone: () => ({ exposureEv: 0, tonemap: 1 }),
      };
      const engine = new NativeEngine(transport, source, { threads: 8, isa: 'avx2', engineVersion: '0.3.0' });
      expect(engine.version).toBe('0.3.0');
      const open = createInitialState({ lang: 'en', theme: 'dark' });
      engine.mount({ getContext: () => null, width: 0, height: 0 } as unknown as HTMLCanvasElement);
      engine.sync(open, null);
      engine.resize(4, 3, 1);
      engine.setActive(true);
      engine.setViewportLimit({ by: 'SAMPLES', samples: 16, seconds: 120 });
      engine.frame();
      await vi.waitFor(() => expect(posted).toHaveLength(1));
      expect(views[0]).toEqual({ maxSamples: 16, maxSeconds: 0 });
      expect(posted[0]).not.toContain('finish=');
      // A new limit starts the image over, even with the same scene.
      engine.setViewportLimit({ by: 'TIME', samples: 16, seconds: 5 });
      await new Promise((r) => setTimeout(r, 0));
      engine.frame();
      await vi.waitFor(() => expect(posted).toHaveLength(2));
      expect(views.at(-1)).toEqual({ maxSamples: Math.max(1, open.render.maxSamples), maxSeconds: 5 });
      expect(posted[1]).toContain('kind=viewport&finish=first&');
      // Measure performance renders a project of its own, not the open one.
      const other = createInitialState({ lang: 'en', theme: 'light' });
      await engine.renderPixels({ state: other, width: 4, height: 3, maxSamples: 1, maxSeconds: 0, transparent: false }).catch(() => undefined);
      expect(states.at(-1)).toBe(other);
    } finally {
      if (hadDocument) g.document = saved;
      else delete g.document;
    }
  });

  it('marks every whole scene full=1, so a project without meshes is not taken for an update', async () => {
    const g = globalThis as { document?: unknown };
    const hadDocument = 'document' in g;
    const saved = g.document;
    g.document = { createElement: () => ({ getContext: () => null }) };
    try {
      const posted: { path: string; bytes: number }[] = [];
      let refuseUpdates = false;
      const transport = {
        async request(path: string, init: RequestInit = {}) {
          if (init.method === 'POST') {
            const bytes = (init.body as Uint8Array).length;
            posted.push({ path, bytes });
            // The launcher: an update (no full=1) of a scene it did not load is refused.
            if (refuseUpdates && !path.includes('full=1')) return new Response(JSON.stringify({ error: 'need-meshes', message: 'send the whole scene' }), { status: 409 });
            return new Response(JSON.stringify({ id: posted.length }));
          }
          return new Response(frame({ pass: 1, samples: 1, width: 4, height: 3, flags: FLAG_DONE }));
        },
      };
      // An empty project: no meshes, so the key is empty and the whole scene has no MESH section.
      let camera = 1;
      const source = {
        build: () => ({ meshKey: '', bytes: (meshes: boolean) => new Uint8Array(meshes ? 10 : 5).fill(camera) }),
        tone: () => ({ exposureEv: 0, tonemap: 1 }),
      };
      const engine = new NativeEngine(transport, source, { threads: 8, isa: 'avx2' });
      engine.mount({ getContext: () => null, width: 0, height: 0 } as unknown as HTMLCanvasElement);
      engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
      engine.resize(4, 3, 1);
      engine.setActive(true);
      engine.frame();
      await vi.waitFor(() => expect(posted).toHaveLength(1));
      // The first viewport job is the whole scene, even though the key (the meshes) is empty.
      expect(posted[0].path).toMatch(/^\/api\/render\?kind=viewport&mesh=[0-9a-f]+&client=[0-9a-f]+&full=1$/);
      expect(posted[0].bytes).toBe(10);
      // The camera moves: an update, not marked.
      camera = 2;
      engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
      await new Promise((r) => setTimeout(r, 0));
      engine.frame();
      await vi.waitFor(() => expect(posted).toHaveLength(2));
      expect(posted[1].path).not.toContain('full=1');
      expect(posted[1].bytes).toBe(5);
      // A launcher that lost the scene refuses the update: it is sent again whole, marked.
      refuseUpdates = true;
      camera = 3;
      engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
      await new Promise((r) => setTimeout(r, 0));
      engine.frame();
      await vi.waitFor(() => expect(posted).toHaveLength(4));
      expect(posted[2].path).not.toContain('full=1');
      expect(posted[3].path).toContain('full=1');
      expect(posted[3].bytes).toBe(10);
      // Render of the empty project: a final job is always the whole scene.
      await engine.renderPixels({ width: 4, height: 3, maxSamples: 1, maxSeconds: 0, transparent: false }).catch(() => undefined);
      expect(posted.at(-1)?.path).toMatch(/kind=final&.*&full=1$/);
    } finally {
      if (hadDocument) g.document = saved;
      else delete g.document;
    }
  });

  it('turns a refused render into an error', async () => {
    const transport = { request: async () => new Response(JSON.stringify({ error: 'bad-scene', message: 'MESH section too short' }), { status: 400 }) };
    const source = { build: () => ({ meshKey: 'm', bytes: () => new Uint8Array(1) }), tone: () => ({ exposureEv: 0, tonemap: 1 }) };
    const engine = new NativeEngine(transport, source, { threads: 2, isa: 'scalar' });
    engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
    await expect(engine.renderPixels({ width: 2, height: 2, maxSamples: 1, maxSeconds: 0, transparent: false })).rejects.toThrow('MESH section too short');
    expect(engine.status().simd).toBe(false);
  });
});

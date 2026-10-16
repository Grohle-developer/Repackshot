// A launcher (`/api/render`, rt-app) behind the browser's HTTP/1.1 connection pool, for the tests of
// render/native.ts (phase P3a). It is stricter than the earlier mocks, the way Chromium is: there are six
// connections to the launcher, a response keeps its connection until its body has been read to the end or
// cancelled (or the request aborted), and a request finds a free connection or waits for one. A page that
// leaves responses unread runs out of connections and every later request waits for ever, which is what
// stopped Full mode, Render and Pause on the desktop (v0.1.0).

import { fitFactor } from '../src/core/live-frame';
import { FLAG_CANCELLED, FLAG_DATA, FLAG_DENOISED, FLAG_DONE, FLAG_PAUSED, FLAG_SCALED, FLAG_SHARED, FRAME_HEADER } from '../src/render/native';

export interface MockJob {
  id: number;
  kind: 'viewport' | 'final';
  client: string;
  seq: number | null;
  share: number;
  width: number;
  height: number;
  maxSamples: number;
  pass: number;
  samples: number;
  cancelled: boolean;
  /** Extra frame flags (paused, shared) and the threads it renders on. */
  flags: number;
  threads: number;
  /** U11: the live denoise switch of a viewport posted with `denoise=` (null: none), the number of its image, and whether that image is denoised. */
  live: boolean | null;
  version: number;
  denoised: boolean;
}

/** A frame as the launcher writes it (render.rs `Frame::header`). */
export function frameBytes(f: { pass: number; samples: number; width: number; height: number; seconds?: number; flags: number; threads?: number; sums?: Float32Array; version?: number }): Uint8Array {
  const data = f.sums && f.flags & FLAG_DATA ? f.sums.length * 4 : 0;
  const buf = new ArrayBuffer(FRAME_HEADER + data);
  const v = new DataView(buf);
  'RPX1'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  [FRAME_HEADER, f.pass, f.samples, f.width, f.height].forEach((x, i) => v.setUint32(4 + i * 4, x, true));
  v.setFloat32(24, f.seconds ?? 0.01 * f.samples, true);
  v.setUint32(28, f.flags, true);
  v.setUint32(32, 64, true);
  v.setUint32(36, f.threads ?? 8, true);
  v.setBigUint64(40, 1n, true);
  v.setUint32(48, f.version ?? 0, true);
  if (data) new Float32Array(buf, FRAME_HEADER).set(f.sums!);
  return new Uint8Array(buf);
}

/** What the fake scene source writes: the view's size in the first bytes, then a counter for "another scene". */
export function viewBytes(width: number, height: number, meshes: boolean, version: number): Uint8Array {
  return new Uint8Array([meshes ? 1 : 0, width & 255, width >> 8, height & 255, height >> 8, version & 255, (version >> 8) & 255]);
}

export class LauncherMock {
  /** Chromium's limit per host for HTTP/1.1. */
  readonly connections = 6;
  inUse = 0;
  maxInUse = 0;
  private waiting: (() => void)[] = [];
  readonly jobs = new Map<number, MockJob>();
  private nextId = 1;
  readonly log: string[] = [];
  /** How long a long-poll waits before it answers with a new pass. */
  pollMs = 15;
  /** Long-polls never answer (the launcher is stuck): they end only when aborted. */
  hangPolls = false;
  /** Answers to give to the next viewport POSTs, instead of creating a job. */
  refuse: { status: number; error: string; message: string }[] = [];
  /** Polls of these jobs answer 404 once (the launcher forgot them). */
  readonly forget = new Set<number>();
  /** Flags and threads every running viewport job reports (a final running elsewhere). */
  viewportFlags = 0;
  viewportThreads = 8;
  /** Samples of a viewport job (it ends there). */
  viewportSamples = 1 << 30;
  /**
   * The end comes apart from the last pass, as it can from the launcher (a pass is published a moment before the
   * job ends): the frame of the last pass has no DONE, the next one has DONE and no new data.
   */
  doneApart = false;
  /** The newest viewport job posted. */
  lastViewport = 0;
  /** U14: every frame sent scaled for a live view (`fit=`), with the picture's size. */
  readonly fitted: { id: number; width: number; height: number }[] = [];
  private lastSeq = new Map<string, number>();
  private polls = new Map<number, number>();

  /** Whether job `id` has a long-poll waiting for its next pass. */
  polling(id: number): boolean {
    return (this.polls.get(id) ?? 0) > 0;
  }

  /** The fetch of the page (io/native.ts NativeClient.request). */
  readonly request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const signal = init.signal ?? undefined;
    await this.acquire(signal);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.inUse--;
      const next = this.waiting.shift();
      if (next) next();
    };
    signal?.addEventListener('abort', release);
    try {
      const { status, body } = await this.handle(path, init, signal);
      if (body === null) {
        release();
        return new Response(null, { status });
      }
      // The connection is free again only when the body has been read to the end or cancelled.
      const stream = new ReadableStream<Uint8Array>({
        start: (c) => c.enqueue(body),
        pull: (c) => {
          c.close();
          release();
        },
        cancel: () => release(),
      });
      return new Response(stream, { status });
    } catch (err) {
      release();
      throw err;
    }
  };

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
    if (this.inUse < this.connections) {
      this.inUse++;
      this.maxInUse = Math.max(this.maxInUse, this.inUse);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const go = () => {
        this.inUse++;
        this.maxInUse = Math.max(this.maxInUse, this.inUse);
        resolve();
      };
      this.waiting.push(go);
      signal?.addEventListener('abort', () => {
        const i = this.waiting.indexOf(go);
        if (i >= 0) this.waiting.splice(i, 1);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  }

  /** Requests waiting for a free connection. */
  get queued(): number {
    return this.waiting.length;
  }

  private json(status: number, value: unknown): { status: number; body: Uint8Array } {
    return { status, body: new TextEncoder().encode(JSON.stringify(value)) };
  }

  private async handle(path: string, init: RequestInit, signal?: AbortSignal): Promise<{ status: number; body: Uint8Array | null }> {
    const url = new URL(path, 'http://127.0.0.1');
    const method = init.method ?? 'GET';
    this.log.push(`${method} ${url.pathname}${url.search}`);
    const m = /^\/api\/render\/(\d+)$/.exec(url.pathname);
    if (method === 'POST' && url.pathname === '/api/render') {
      const kind = url.searchParams.get('kind') as 'viewport' | 'final';
      const client = url.searchParams.get('client') ?? '';
      const seq = url.searchParams.has('seq') ? Number(url.searchParams.get('seq')) : null;
      if (kind === 'viewport') {
        const refused = this.refuse.shift();
        if (refused) return this.json(refused.status, { error: refused.error, message: refused.message });
        if (seq !== null && seq <= (this.lastSeq.get(client) ?? 0)) return this.json(409, { error: 'stale', message: 'a newer view of this window came first' });
        if (seq !== null) this.lastSeq.set(client, seq);
        // A new view of a window replaces its previous one.
        for (const j of this.jobs.values()) if (j.kind === 'viewport' && j.client === client) this.jobs.delete(j.id);
      }
      const body = new Uint8Array(init.body as ArrayBuffer);
      const job: MockJob = {
        id: this.nextId++,
        kind,
        client,
        seq,
        share: Number(url.searchParams.get('share') ?? 0),
        width: body[1] | (body[2] << 8) || 4,
        height: body[3] | (body[4] << 8) || 3,
        maxSamples: kind === 'final' ? 4 : this.viewportSamples,
        pass: 0,
        samples: 0,
        cancelled: false,
        flags: 0,
        threads: 8,
        live: kind === 'viewport' && url.searchParams.has('denoise') ? url.searchParams.get('denoise') === '1' : null,
        version: 0,
        denoised: false,
      };
      this.jobs.set(job.id, job);
      if (kind === 'viewport') this.lastViewport = job.id;
      return this.json(200, { id: job.id });
    }
    if (method === 'DELETE' && m) {
      const job = this.jobs.get(Number(m[1]));
      if (!job) return this.json(404, { error: 'not-found', message: 'no such job' });
      job.cancelled = true;
      this.jobs.delete(job.id);
      return { status: 204, body: null };
    }
    if (method === 'GET' && url.pathname === '/api/render/state') return this.json(200, { engine: { jobs: [...this.jobs.values()] } });
    // U11: a viewport's live denoise switch. This launcher denoises at once: the next image is denoised (or not).
    const d = /^\/api\/render\/(\d+)\/denoise$/.exec(url.pathname);
    if (method === 'POST' && d) {
      const job = this.jobs.get(Number(d[1]));
      if (!job) return this.json(404, { error: 'not-found', message: 'no such job' });
      if (job.live === null) return this.json(409, { error: 'not-live', message: 'this job has no live denoise' });
      const on = url.searchParams.get('on') === '1';
      if (on !== job.live) {
        job.live = on;
        if (job.pass > 0) {
          job.version++;
          job.denoised = on;
        }
      }
      return this.json(200, { id: job.id, on, version: job.version });
    }
    if (method === 'GET' && m) {
      // U14: a live view's box (server.rs `get_render`): refused when it is not `<w>x<h>`, 1..16384 each.
      const fitText = url.searchParams.get('fit');
      const fit = fitText === null ? null : /^(\d+)x(\d+)$/.exec(fitText);
      if (fitText !== null && (!fit || [fit[1], fit[2]].some((v) => Number(v) < 1 || Number(v) > 16384))) return this.json(400, { error: 'bad-query', message: 'fit=<w>x<h>, 1 to 16384 each' });
      const id = Number(m[1]);
      if (this.forget.delete(id)) this.jobs.delete(id);
      const job = this.jobs.get(id);
      if (!job) return this.json(404, { error: 'not-found', message: 'no such job' });
      const after = url.searchParams.has('after') ? Number(url.searchParams.get('after')) : null;
      const seen = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : null;
      // A follower of a job that is over, with an image it has not seen (the switch turned): answered at once.
      const newer = seen !== null && job.version > seen && job.samples >= job.maxSamples;
      if (after !== null && !newer) {
        this.polls.set(id, (this.polls.get(id) ?? 0) + 1);
        try {
          if (this.hangPolls) await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
          await new Promise((r) => setTimeout(r, this.pollMs));
        } finally {
          this.polls.set(id, this.polls.get(id)! - 1);
        }
        if (job.cancelled) return { status: 200, body: frameBytes({ ...job, flags: FLAG_CANCELLED }) };
        if (job.samples < job.maxSamples) {
          job.pass++;
          job.samples = Math.min(job.maxSamples, job.samples + job.pass);
          // A new image: the accumulation, or (with the switch on) its denoised image at once.
          job.version++;
          job.denoised = job.live === true;
          // The last pass, published before the job says it ended.
          if (this.doneApart && job.samples >= job.maxSamples) {
            const sums = new Float32Array(job.width * job.height * 4).fill(job.samples);
            return { status: 200, body: frameBytes({ pass: job.pass, samples: job.samples, width: job.width, height: job.height, flags: FLAG_DATA | (job.denoised ? FLAG_DENOISED : 0), sums, version: job.version }) };
          }
        } else if (this.doneApart) {
          // Ended, nothing newer: the end alone.
          return { status: 200, body: frameBytes({ pass: job.pass, samples: job.samples, width: job.width, height: job.height, flags: FLAG_DONE | (job.denoised ? FLAG_DENOISED : 0), version: job.version }) };
        }
      }
      const done = job.samples >= job.maxSamples ? FLAG_DONE : 0;
      const extra = job.kind === 'viewport' ? this.viewportFlags & (FLAG_PAUSED | FLAG_SHARED) : 0;
      const threads = job.kind === 'viewport' && extra ? this.viewportThreads : 8;
      // With `version` the sums come only for a newer image (render.rs, server.rs `get_render`).
      const data = url.searchParams.get('data') !== '0' && (seen === null || job.version > seen) && job.pass > 0;
      // U14: with `fit=` and sums, the picture scaled down by a whole factor (render.rs `Frame::fitted`; these sums are
      // all the same value, so their mean is that value), its size in the header and FLAG_SCALED.
      const k = fit && data ? fitFactor(job.width, job.height, { width: Number(fit[1]), height: Number(fit[2]) }) : 1;
      const width = Math.ceil(job.width / k);
      const height = Math.ceil(job.height / k);
      if (fit && data) this.fitted.push({ id, width, height });
      const sums = data ? new Float32Array(width * height * 4).fill(job.samples) : undefined;
      const denoised = job.denoised ? FLAG_DENOISED : 0;
      return { status: 200, body: frameBytes({ pass: job.pass, samples: job.samples, width, height, flags: done | extra | denoised | (data ? FLAG_DATA : 0) | (k > 1 ? FLAG_SCALED : 0), threads, version: job.version, ...(sums ? { sums } : {}) }) };
    }
    return this.json(404, { error: 'not-found', message: 'no such endpoint' });
  }
}

/** What a browser page gives the engines and the mocks in Node: a 2D canvas that records drawing, ImageData, document. */
export function installDom(): { canvas: FakeCanvas; restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, ImageData: g.ImageData, had: 'document' in g, hadImage: 'ImageData' in g };
  g.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
      if (typeof a === 'number') {
        this.width = a;
        this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      } else {
        this.data = a;
        this.width = b;
        this.height = c ?? a.length / 4 / b;
      }
    }
  };
  g.document = { createElement: () => new FakeCanvas(), visibilityState: 'visible' };
  const canvas = new FakeCanvas();
  return {
    canvas,
    restore: () => {
      if (saved.had) g.document = saved.document;
      else delete g.document;
      if (saved.hadImage) g.ImageData = saved.ImageData;
      else delete g.ImageData;
    },
  };
}

export class FakeCanvas {
  width = 0;
  height = 0;
  /** putImageData and drawImage calls so far. */
  draws = 0;
  private readonly ctx = {
    clearRect: () => undefined,
    putImageData: () => void this.draws++,
    drawImage: () => void this.draws++,
    save: () => undefined,
    restore: () => undefined,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
  };
  getContext(): unknown {
    return this.ctx;
  }
}

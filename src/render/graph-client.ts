// The interface's side of the material graph workers (phase M3a): one worker for the material editor's previews and
// a few for the Fast preview's bakes, which split the rows of a bake between them (core/material-preview.ts
// `bakeRows`, then `finishBake` here). Requests come by channel (a material, the editor): a newer request on a
// channel supersedes the one waiting there (it resolves to null), and at most one runs per channel, so a drag of a
// slider never queues a bake per frame.

import { getImage } from '../core/images';
import { finishBake, NODE_PREVIEW_SIZE, type BakeBand, type BakePlan, type BakeResult } from '../core/material-preview';
import type { Program } from '../core/material-program';
import type { GraphImageMsg, GraphReply, GraphRequest } from './graph-protocol';

export interface GraphPreviewsResult {
  size: number;
  probes: Uint8ClampedArray[];
  material: Uint8ClampedArray;
  materialSize: number;
}

interface Lane {
  worker: Worker;
  /** Ids of the images this worker has. */
  sent: Set<string>;
  waiting: Map<number, (r: GraphReply) => void>;
}

interface Channel {
  running: boolean;
  next: (() => Promise<void>) | null;
  cancelNext: (() => void) | null;
}

let seq = 0;

/** The image messages a worker still needs for a program. */
function imagesFor(lane: Lane, p: Program): GraphImageMsg[] {
  const out: GraphImageMsg[] = [];
  for (const im of p.images) {
    const ref = im.image;
    if (!ref || lane.sent.has(ref.id)) continue;
    const data = getImage(ref.id);
    if (!data) continue;
    lane.sent.add(ref.id);
    if (data.rgba8) out.push({ id: ref.id, width: data.width, height: data.height, rgba: data.rgba8 });
    else if (data.format === 'PNG' || data.format === 'JPEG') out.push({ id: ref.id, width: data.width, height: data.height, bytes: data.bytes, format: data.format });
  }
  return out;
}

export class GraphWorkers {
  private readonly lanes: Lane[] = [];
  private readonly channels = new Map<string, Channel>();
  private disposed = false;

  /** `make` starts a worker; `bakeLanes` is how many share a bake (the previews have the first one). */
  constructor(
    private readonly make: () => Worker,
    private readonly bakeLanes = 2,
  ) {}

  private lane(i: number): Lane {
    while (this.lanes.length <= i) {
      const worker = this.make();
      const lane: Lane = { worker, sent: new Set(), waiting: new Map() };
      worker.onmessage = (e: MessageEvent<GraphReply>) => {
        const done = lane.waiting.get(e.data.seq);
        lane.waiting.delete(e.data.seq);
        done?.(e.data);
      };
      worker.onerror = () => {
        for (const done of lane.waiting.values()) done({ kind: 'error', seq: -1, message: 'worker failed' });
        lane.waiting.clear();
      };
      this.lanes.push(lane);
    }
    return this.lanes[i];
  }

  private send(i: number, make: (lane: Lane, seq: number) => GraphRequest): Promise<GraphReply> {
    const lane = this.lane(i);
    const s = ++seq;
    return new Promise((resolve) => {
      lane.waiting.set(s, resolve);
      lane.worker.postMessage(make(lane, s));
    });
  }

  /** Runs `job` on a channel when the one before has finished; a job still waiting there is dropped (null). */
  private queue<T>(name: string, job: () => Promise<T | null>): Promise<T | null> {
    let ch = this.channels.get(name);
    if (!ch) {
      ch = { running: false, next: null, cancelNext: null };
      this.channels.set(name, ch);
    }
    const c = ch;
    return new Promise((resolve) => {
      const run = async () => {
        c.running = true;
        try {
          resolve(this.disposed ? null : await job());
        } catch {
          resolve(null);
        } finally {
          c.running = false;
          const next = c.next;
          c.next = null;
          c.cancelNext = null;
          if (next) void next();
        }
      };
      if (!c.running) void run();
      else {
        c.cancelNext?.();
        c.next = run;
        c.cancelNext = () => resolve(null);
      }
    });
  }

  /** The node previews of a program compiled with probes (and the material's sphere at `materialSize`). */
  previews(program: Program, channel: string, materialSize = 128): Promise<GraphPreviewsResult | null> {
    return this.queue(channel, async () => {
      const r = await this.send(0, (lane, s) => ({ kind: 'previews', seq: s, program, images: imagesFor(lane, program), size: NODE_PREVIEW_SIZE, materialSize }));
      return r.kind === 'previews' ? { size: r.size, probes: r.probes, material: r.material, materialSize: r.materialSize } : null;
    });
  }

  /** A bake at `size`, its rows shared by the bake workers. */
  bake(program: Program, plan: BakePlan, size: number, channel: string): Promise<BakeResult | null> {
    return this.queue(channel, async () => {
      const n = Math.max(1, Math.min(this.bakeLanes, size >= 256 ? this.bakeLanes : 1));
      const rows = Math.ceil(size / n);
      const parts = await Promise.all(
        Array.from({ length: n }, (_x, i) =>
          this.send(1 + i, (lane, s) => ({ kind: 'bake', seq: s, program, images: imagesFor(lane, program), plan, size, r0: i * rows, r1: Math.min(size, (i + 1) * rows) })),
        ),
      );
      const bands: BakeBand[] = [];
      for (const p of parts) {
        if (p.kind !== 'bake') return null;
        bands.push(p.band);
      }
      return finishBake(program, bands, size);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const l of this.lanes) l.worker.terminate();
    this.lanes.length = 0;
  }
}

/** How many workers share a bake on this machine: one less than its cores, two to four. */
export function bakeLaneCount(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(2, Math.min(4, cores - 1));
}

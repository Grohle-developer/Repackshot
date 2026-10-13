// One worker of the path tracer's pool (ARCHITECTURE §5.3): its own instance
// of rt.wasm and its own copy of the scene. It renders the tiles it is given,
// one sample index after another, with `rt_render_tile_rgba`, and sends each
// tile's samples back as a Float32Array (linear, premultiplied RGBA); the
// main thread accumulates them. Between tiles it lets messages in, so a
// newer job (a higher generation) or a cancel stops the current one at once.
//
// It also converts accumulated sums to 8-bit pixels exactly, for Render:
// that is pure arithmetic, and the pool does it on slices in parallel.

import { exactBytes } from './tiles';
import type { WorkerReply, WorkerRequest } from './pool-protocol';

interface RtExports {
  memory: WebAssembly.Memory;
  rt_version(): number;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_scene_load(ptr: number, len: number): number;
  rt_scene_update(handle: number, ptr: number, len: number): number;
  rt_scene_error_len(): number;
  rt_scene_error_copy(ptr: number): void;
  rt_scene_free(handle: number): number;
  rt_render_tile_rgba(handle: number, x: number, y: number, w: number, h: number, sample: number, out: number): number;
}

/** The parts of a dedicated worker's global scope used here (the DOM lib has no worker types). */
interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
let rt: RtExports | null = null;
let handle = 0;
/** Output buffer in wasm memory for one sample of the largest tile. */
let outPtr = 0;
let outLen = 0;

interface Job {
  generation: number;
  /** x, y, w, h, index per tile. */
  tiles: Int32Array;
  first: number;
  count: number;
  next: number;
}
let job: Job | null = null;

const post = (msg: WorkerReply, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

function lastError(): string {
  if (!rt) return 'engine not loaded';
  const len = rt.rt_scene_error_len();
  if (len === 0) return 'unknown error';
  const ptr = rt.rt_alloc(len);
  rt.rt_scene_error_copy(ptr);
  const text = new TextDecoder().decode(new Uint8Array(rt.memory.buffer, ptr, len).slice());
  rt.rt_free(ptr, len);
  return text;
}

function loadScene(bytes: Uint8Array, full: boolean): string | null {
  if (!rt) return 'engine not loaded';
  const ptr = rt.rt_alloc(bytes.length);
  new Uint8Array(rt.memory.buffer, ptr, bytes.length).set(bytes);
  let error: string | null = null;
  if (full || handle === 0) {
    const next = rt.rt_scene_load(ptr, bytes.length);
    if (next === 0) error = lastError();
    else {
      if (handle !== 0) rt.rt_scene_free(handle);
      handle = next;
    }
  } else {
    const status = rt.rt_scene_update(handle, ptr, bytes.length);
    if (status !== 0) error = status === 4 ? lastError() : `rt_scene_update returned ${status}`;
  }
  rt.rt_free(ptr, bytes.length);
  return error;
}

// Continue the job in a new task, after any message that came in meanwhile.
const tick = new MessageChannel();
let scheduled = false;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  tick.port2.postMessage(0);
}
tick.port1.onmessage = () => {
  scheduled = false;
  step();
};

/** Renders the next tile of the job, all its samples, and sends them. */
function step(): void {
  const j = job;
  if (!j || !rt) return;
  if (j.next * 5 >= j.tiles.length) {
    job = null;
    post({ type: 'done', generation: j.generation });
    return;
  }
  const o = j.next * 5;
  const [x, y, w, h, index] = [j.tiles[o], j.tiles[o + 1], j.tiles[o + 2], j.tiles[o + 3], j.tiles[o + 4]];
  j.next++;
  const stride = w * h * 4;
  const need = stride * 4;
  if (need > outLen) {
    if (outPtr) rt.rt_free(outPtr, outLen);
    outPtr = rt.rt_alloc(need);
    outLen = need;
  }
  const data = new Float32Array(stride * j.count);
  for (let s = 0; s < j.count; s++) {
    const status = rt.rt_render_tile_rgba(handle, x, y, w, h, j.first + s, outPtr);
    if (status !== 0) {
      job = null;
      post({ type: 'error', generation: j.generation, reason: `rt_render_tile_rgba returned ${status}` });
      return;
    }
    // A fresh view every time: rendering may grow the memory and detach the old buffer.
    data.set(new Float32Array(rt.memory.buffer, outPtr, stride), s * stride);
  }
  post({ type: 'tile', generation: j.generation, index, first: j.first, count: j.count, data }, [data.buffer]);
  schedule();
}

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init': {
      try {
        const instance = await WebAssembly.instantiate(msg.module, {});
        const exports = instance.exports as unknown as RtExports;
        if (typeof exports.rt_scene_update !== 'function' || typeof exports.rt_render_tile_rgba !== 'function') {
          post({ type: 'failed', reason: 'outdated' });
          return;
        }
        rt = exports;
        post({ type: 'ready', version: rt.rt_version() });
      } catch (err) {
        post({ type: 'failed', reason: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    case 'scene': {
      job = null;
      const error = loadScene(new Uint8Array(msg.bytes), msg.full);
      post({ type: 'scene', id: msg.id, error });
      return;
    }
    case 'job':
      job = { generation: msg.generation, tiles: msg.tiles, first: msg.first, count: msg.count, next: 0 };
      schedule();
      return;
    case 'cancel':
      if (job && job.generation <= msg.generation) job = null;
      return;
    case 'tonemap': {
      const bytes = exactBytes(new Float32Array(msg.sum), msg.samples, msg.ev, msg.tonemap);
      post({ type: 'pixels', id: msg.id, bytes }, [bytes.buffer]);
      return;
    }
  }
};

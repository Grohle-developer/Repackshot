// One worker of the path tracer's pool (ARCHITECTURE §5.3): its own instance
// of rt.wasm and its own copy of the scene. It renders the tiles it is given,
// one sample index after another, with `rt_render_tile_rgba`, and sends each
// tile's samples back as a Float32Array (linear, premultiplied RGBA); the
// main thread accumulates them. Between tiles it lets messages in, so a
// newer job (a higher generation) or a cancel stops the current one at once.
//
// It also converts accumulated sums to 8-bit pixels exactly, for Render:
// that is pure arithmetic, and the pool does it on slices in parallel.
//
// A Render that asks for the exact passes (phase X2) gets, with every tile, the
// albedo of each sample and, in its first job, the tile's exact planes
// (render/pass-planes.ts); the main thread puts them together.

import { exactBytes } from './tiles';
import { denoiseBand, hasDenoiseExport } from './denoise';
import { ALBEDO_BIT, EXACT_BITS, hasPassExports, Scratch, tileAlbedo, tileExact, type RtPassExports } from './pass-planes';
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
  /** E5b-1 (absent in an older rt.wasm): caustic photons per sample of a loaded scene. */
  rt_scene_caustics?: (handle: number) => number;
  /** X2 (absent in an older rt.wasm). */
  rt_render_tile_passes?: RtPassExports['rt_render_tile_passes'];
  rt_render_tile_albedo?: RtPassExports['rt_render_tile_albedo'];
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
/** Wasm memory for the passes of one tile. */
let passScratch: Scratch | null = null;

interface Job {
  generation: number;
  /** x, y, w, h, index per tile. */
  tiles: Int32Array;
  first: number;
  count: number;
  next: number;
  passes: number;
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
  const passes = j.passes !== 0 && hasPassExports(rt) ? rt : null;
  if (j.passes !== 0 && !passes) {
    job = null;
    post({ type: 'error', generation: j.generation, reason: 'this rt.wasm renders no passes (npm run engine:build)' });
    return;
  }
  const albedo = passes && j.passes & ALBEDO_BIT ? new Float32Array(w * h * 3 * j.count) : undefined;
  let exact: Uint32Array | undefined;
  try {
    passScratch ??= passes ? new Scratch(passes) : null;
    if (passes && j.first === 0 && j.passes & EXACT_BITS) exact = tileExact(passes, handle, { x, y, w, h }, j.passes, passScratch!);
    for (let s = 0; s < j.count; s++) {
      const status = rt.rt_render_tile_rgba(handle, x, y, w, h, j.first + s, outPtr);
      if (status !== 0) throw new Error(`rt_render_tile_rgba returned ${status}`);
      // A fresh view every time: rendering may grow the memory and detach the old buffer.
      data.set(new Float32Array(rt.memory.buffer, outPtr, stride), s * stride);
      if (albedo) tileAlbedo(passes!, handle, { x, y, w, h }, j.first + s, passScratch!, albedo, s * w * h * 3);
    }
  } catch (err) {
    job = null;
    post({ type: 'error', generation: j.generation, reason: err instanceof Error ? err.message : String(err) });
    return;
  }
  const transfer: Transferable[] = [data.buffer];
  if (albedo) transfer.push(albedo.buffer);
  if (exact) transfer.push(exact.buffer);
  post({ type: 'tile', generation: j.generation, index, first: j.first, count: j.count, data, ...(albedo ? { albedo } : {}), ...(exact ? { exact } : {}) }, transfer);
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
      const caustics = !error && rt?.rt_scene_caustics ? rt.rt_scene_caustics(handle) >>> 0 : 0;
      post({ type: 'scene', id: msg.id, error, caustics: caustics === 0xffffffff ? 0 : caustics });
      return;
    }
    case 'denoise': {
      if (!rt || !hasDenoiseExport(rt)) {
        post({ type: 'denoised', id: msg.id, data: null, error: 'this rt.wasm has no denoiser (npm run engine:build)' });
        return;
      }
      try {
        const data = denoiseBand(rt, {
          width: msg.width,
          height: msg.height,
          samples: msg.samples,
          band: { y0: msg.y0, y1: msg.y1, lo: msg.lo, hi: msg.hi },
          input: new Uint32Array(msg.input),
          ...(msg.preset ? { preset: msg.preset } : {}),
        });
        post({ type: 'denoised', id: msg.id, data }, [data.buffer]);
      } catch (err) {
        post({ type: 'denoised', id: msg.id, data: null, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    case 'job':
      job = { generation: msg.generation, tiles: msg.tiles, first: msg.first, count: msg.count, next: 0, passes: msg.passes ?? 0 };
      schedule();
      return;
    case 'cancel':
      // Exactly that generation: a Render and the viewport may run side by side in the pool.
      if (job && job.generation === msg.generation) job = null;
      return;
    case 'tonemap': {
      const bytes = exactBytes(new Float32Array(msg.sum), msg.samples, msg.ev, msg.tonemap);
      post({ type: 'pixels', id: msg.id, bytes }, [bytes.buffer]);
      return;
    }
  }
};

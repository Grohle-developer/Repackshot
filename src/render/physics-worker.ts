// The physics worker (phase S2): its own instance of rt.wasm, one simulation at a time (render/phys-wasm.ts). A run
// keeps to real time (the steps simulated follow the clock, never ahead of it) and records the poses at every frame
// of the project's fps, which it reports as they come (the interface grows the run's PHYSICS clips with them). Pause
// freezes it where it is; between slices of steps it lets messages in, so Pause and Stop take effect at once. A run
// ends by itself when every body sleeps or when its simulated time is up.

import { frameStep, STEPS_PER_SECOND, type PhysicsResult, type PhysicsRunOptions } from '../core/physics';
import { hasPhysExports, PhysWorld, type PhysExports } from './phys-wasm';

export type PhysicsRequest =
  | { type: 'init'; module: WebAssembly.Module }
  | { type: 'run'; id: number; scene: ArrayBuffer; dynamic: number; options: PhysicsRunOptions }
  | { type: 'pause' | 'resume' | 'stop'; id: number };

export type PhysicsReply =
  | { type: 'ready' }
  | { type: 'started'; id: number; ids: Uint32Array; initial: Float32Array; bodies: number }
  | { type: 'progress'; id: number; steps: number; awake: number; bodies: number; settled: boolean; frames: Float32Array[] }
  | ({ type: 'done'; id: number } & PhysicsResult)
  | { type: 'error'; id: number | null; message: string };

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<PhysicsRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
let rt: PhysExports | null = null;

interface Run {
  id: number;
  world: PhysWorld;
  options: PhysicsRunOptions;
  /** The clock's time that corresponds to step 0 (moved on by every pause). */
  begun: number;
  pausedAt: number | null;
  stop: boolean;
  /** Frames recorded and not reported yet; the last frame recorded; its number. */
  fresh: Float32Array[];
  last: Float32Array;
  frame: number;
}
let run: Run | null = null;

const post = (msg: PhysicsReply) => scope.postMessage(msg);

/** At most this many steps in a slice: a slow machine falls behind the clock rather than freezing. */
const SLICE_STEPS = 24;

function finish(r: Run, reason: PhysicsResult['reason']): void {
  post({ type: 'done', id: r.id, reason, steps: r.world.steps, awake: r.world.awake, bodies: r.world.bodies, settled: r.world.settled, frames: r.fresh, poses: r.last });
  r.fresh = [];
  r.world.free();
  if (run === r) run = null;
}

function slice(r: Run): void {
  if (run !== r) return;
  if (r.stop) {
    finish(r, 'STOPPED');
    return;
  }
  if (r.pausedAt !== null) return;
  const max = Math.round(r.options.maxSeconds * STEPS_PER_SECOND);
  const due = Math.min(max, Math.floor(((performance.now() - r.begun) / 1000) * STEPS_PER_SECOND));
  let budget = SLICE_STEPS;
  // Step to every frame that is due, recording it; then to where the clock is.
  for (;;) {
    const next = frameStep(r.frame + 1, r.options.fps);
    const target = Math.min(due, next);
    const n = Math.min(budget, Math.max(0, target - r.world.steps));
    if (n > 0) r.world.step(n);
    budget -= n;
    if (r.world.steps >= next) {
      r.frame += 1;
      r.last = r.world.poses();
      r.fresh.push(r.last);
    }
    if (r.world.settled || budget <= 0 || r.world.steps >= due) break;
  }
  if (r.world.settled || r.world.steps >= max) {
    if (r.world.settled && r.world.steps > frameStep(r.frame, r.options.fps)) {
      // The rest pose on a frame of its own, so the clip ends where the bodies are.
      r.world.step(frameStep(r.frame + 1, r.options.fps) - r.world.steps);
      r.frame += 1;
      r.last = r.world.poses();
      r.fresh.push(r.last);
    }
    finish(r, r.world.settled ? 'SETTLED' : 'TIME');
    return;
  }
  if (r.fresh.length > 0) {
    post({ type: 'progress', id: r.id, steps: r.world.steps, awake: r.world.awake, bodies: r.world.bodies, settled: false, frames: r.fresh });
    r.fresh = [];
  }
  setTimeout(() => slice(r), 4);
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    void WebAssembly.instantiate(msg.module, {}).then(
      (instance) => {
        if (!hasPhysExports(instance.exports)) {
          post({ type: 'error', id: null, message: 'this rt.wasm has no simulator (npm run engine:build)' });
          return;
        }
        rt = instance.exports;
        post({ type: 'ready' });
      },
      (err: unknown) => post({ type: 'error', id: null, message: err instanceof Error ? err.message : String(err) }),
    );
    return;
  }
  if (msg.type !== 'run') {
    const r = run;
    if (!r || r.id !== msg.id) return;
    if (msg.type === 'stop') {
      r.stop = true;
      if (r.pausedAt !== null) finish(r, 'STOPPED');
    } else if (msg.type === 'pause') {
      r.pausedAt ??= performance.now();
    } else if (r.pausedAt !== null) {
      // The clock skips the pause: the simulation goes on from where it froze.
      r.begun += performance.now() - r.pausedAt;
      r.pausedAt = null;
      setTimeout(() => slice(r), 0);
    }
    return;
  }
  // A new run replaces the one in progress.
  if (run) finish(run, 'STOPPED');
  if (!rt) {
    post({ type: 'error', id: msg.id, message: 'engine not loaded' });
    return;
  }
  try {
    const world = new PhysWorld(rt, new Uint8Array(msg.scene), msg.dynamic);
    const initial = world.poses();
    const r: Run = { id: msg.id, world, options: msg.options, begun: performance.now(), pausedAt: null, stop: false, fresh: [], last: initial, frame: 0 };
    run = r;
    post({ type: 'started', id: msg.id, ids: world.ids, initial, bodies: world.bodies });
    setTimeout(() => slice(r), 0);
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};

// The physics worker (phase S2): its own instance of rt.wasm, one simulation at a time (render/phys-wasm.ts). A run
// keeps to real time (the steps simulated follow the clock, never ahead of it) and records the poses at every frame
// of the project's fps, which it reports as they come (the interface grows the run's PHYSICS clips with them). It
// never runs more than a few frames ahead of what the interface has taken in (each report is acknowledged), so on a
// busy page the simulation slows down with it instead of finishing unseen, and Pause freezes it about where the
// viewport shows it. Between slices of steps it lets messages in, so Pause and Stop take effect at once. A run ends
// by itself when every body sleeps or when its simulated time is up.
//
// S3b: a run may also carry the front glass of a camera fed by the scene (a WET1 spec): its pane steps with the bodies
// (the same steps of 1/240 s), each frame comes with the engine's record of the glass, and a run with a glass does not
// stop when its bodies sleep (it keeps raining): only Stop or its time does. A run may be the glass alone (no PHY1).
//
// S3c: and the parts under the scene's rain, dust and snow (a WPT1 spec): they step with the bodies too, the run starts
// with the engine's layout of their samples and their record at step 0, each frame comes with their record, and a run
// that wets them does not stop when its bodies sleep either.

import { frameStep, STEPS_PER_SECOND, type PhysicsResult, type PhysicsRunOptions } from '../core/physics';
import { hasPartsExports, hasPhysExports, hasWetExports, PartsSim, PhysWorld, WetSim, type PartsExports, type PhysExports, type WetExports } from './phys-wasm';

export type PhysicsRequest =
  | { type: 'init'; module: WebAssembly.Module }
  | { type: 'run'; id: number; scene: ArrayBuffer | null; dynamic: number; options: PhysicsRunOptions; wet?: ArrayBuffer | null; parts?: ArrayBuffer | null }
  | { type: 'pause' | 'resume' | 'stop'; id: number }
  /** The interface has taken in `frames` more frames of run `id`. */
  | { type: 'ack'; id: number; frames: number };

export type PhysicsReply =
  | { type: 'ready' }
  | { type: 'started'; id: number; ids: Uint32Array; initial: Float32Array; bodies: number; glass?: Uint8Array; parts?: { layout: Uint8Array; frame: Uint8Array } }
  | { type: 'progress'; id: number; steps: number; awake: number; bodies: number; settled: boolean; frames: Float32Array[]; glass?: Uint8Array[]; parts?: Uint8Array[] }
  | ({ type: 'done'; id: number } & PhysicsResult)
  | { type: 'error'; id: number | null; message: string };

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<PhysicsRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
let rt: PhysExports | null = null;
/** S3b: the same instance's front glass exports, when the module has them. */
let wetRt: WetExports | null = null;
/** S3c: and its exports of the wet parts. */
let partsRt: PartsExports | null = null;

interface Run {
  id: number;
  /** The bodies (null: a run of the glass alone). */
  world: PhysWorld | null;
  /** S3b: the front glass fed by the scene, stepped with the bodies. */
  pane: WetSim | null;
  /** S3c: the parts under the scene's rain, dust and snow, stepped with the bodies. */
  parts: PartsSim | null;
  /** Steps simulated (the world's and the pane's alike). */
  steps: number;
  options: PhysicsRunOptions;
  /** The clock's time that corresponds to step 0 (moved on by every pause). */
  begun: number;
  pausedAt: number | null;
  stop: boolean;
  /** Frames recorded and not reported yet; the last frame recorded; its number. */
  fresh: Float32Array[];
  /** S3b: the glass records of the fresh frames. */
  freshGlass: Uint8Array[];
  /** S3c: the parts' records of the fresh frames. */
  freshParts: Uint8Array[];
  last: Float32Array;
  frame: number;
  /** Frames the interface has acknowledged. */
  acked: number;
}
let run: Run | null = null;

const post = (msg: PhysicsReply) => scope.postMessage(msg);

/** At most this many steps in a slice: a slow machine falls behind the clock rather than freezing. */
const SLICE_STEPS = 24;
/** How far, in seconds, the simulation may run ahead of the frames the interface has acknowledged. */
const AHEAD_SECONDS = 0.125;

/** Frames a run may record beyond the acknowledged ones. */
export function framesAhead(fps: number): number {
  return Math.max(2, Math.ceil(fps * AHEAD_SECONDS));
}

const EMPTY = new Float32Array(0);

/** Every body asleep (a run of the glass or the parts alone has none: it never settles by itself). */
function settled(r: Run): boolean {
  return r.pane === null && r.parts === null && (r.world?.settled ?? true);
}

function stepBoth(r: Run, n: number): void {
  if (n <= 0) return;
  r.world?.step(n);
  r.pane?.step(n);
  r.parts?.step(n);
  r.steps += n;
}

/** Records frame `r.frame` (it has just been reached). */
function record(r: Run): void {
  r.last = r.world ? r.world.poses() : EMPTY;
  r.fresh.push(r.last);
  if (r.pane) r.freshGlass.push(r.pane.frame());
  if (r.parts) r.freshParts.push(r.parts.frame());
}

function counts(r: Run): { steps: number; awake: number; bodies: number; settled: boolean } {
  return { steps: r.steps, awake: r.world?.awake ?? 0, bodies: r.world?.bodies ?? 0, settled: settled(r) };
}

function finish(r: Run, reason: PhysicsResult['reason']): void {
  post({ type: 'done', id: r.id, reason, ...counts(r), frames: r.fresh, ...(r.pane ? { glass: r.freshGlass } : {}), ...(r.parts ? { parts: r.freshParts } : {}), poses: r.last });
  r.fresh = [];
  r.freshGlass = [];
  r.freshParts = [];
  r.world?.free();
  r.pane?.free();
  r.parts?.free();
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
  const clock = Math.floor(((performance.now() - r.begun) / 1000) * STEPS_PER_SECOND);
  const due = Math.min(max, clock, frameStep(r.acked + framesAhead(r.options.fps), r.options.fps));
  let budget = SLICE_STEPS;
  // Step to every frame that is due, recording it; then to where the clock is.
  for (;;) {
    const next = frameStep(r.frame + 1, r.options.fps);
    const target = Math.min(due, next);
    const n = Math.min(budget, Math.max(0, target - r.steps));
    stepBoth(r, n);
    budget -= n;
    if (r.steps >= next) {
      r.frame += 1;
      record(r);
    }
    if (settled(r) || budget <= 0 || r.steps >= due) break;
  }
  if (settled(r) || r.steps >= max) {
    if (settled(r) && r.steps > frameStep(r.frame, r.options.fps)) {
      // The rest pose on a frame of its own, so the clip ends where the bodies are.
      stepBoth(r, frameStep(r.frame + 1, r.options.fps) - r.steps);
      r.frame += 1;
      record(r);
    }
    finish(r, settled(r) ? 'SETTLED' : 'TIME');
    return;
  }
  if (r.fresh.length > 0) {
    post({ type: 'progress', id: r.id, ...counts(r), settled: false, frames: r.fresh, ...(r.pane ? { glass: r.freshGlass } : {}), ...(r.parts ? { parts: r.freshParts } : {}) });
    r.fresh = [];
    r.freshGlass = [];
    r.freshParts = [];
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
        wetRt = hasWetExports(instance.exports) ? instance.exports : null;
        partsRt = hasPartsExports(instance.exports) ? instance.exports : null;
        post({ type: 'ready' });
      },
      (err: unknown) => post({ type: 'error', id: null, message: err instanceof Error ? err.message : String(err) }),
    );
    return;
  }
  if (msg.type !== 'run') {
    const r = run;
    if (!r || r.id !== msg.id) return;
    if (msg.type === 'ack') {
      r.acked += msg.frames;
    } else if (msg.type === 'stop') {
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
  if (msg.wet && !wetRt) {
    post({ type: 'error', id: msg.id, message: 'this rt.wasm does not simulate the front glass (npm run engine:build)' });
    return;
  }
  if (msg.parts && !partsRt) {
    post({ type: 'error', id: msg.id, message: 'this rt.wasm does not simulate the parts under rain (npm run engine:build)' });
    return;
  }
  let world: PhysWorld | null = null;
  let pane: WetSim | null = null;
  try {
    world = msg.scene ? new PhysWorld(rt, new Uint8Array(msg.scene), msg.dynamic) : null;
    pane = msg.wet ? new WetSim(wetRt!, new Uint8Array(msg.wet)) : null;
    const parts = msg.parts ? new PartsSim(partsRt!, new Uint8Array(msg.parts)) : null;
    const initial = world ? world.poses() : EMPTY;
    const r: Run = { id: msg.id, world, pane, parts, steps: 0, options: msg.options, begun: performance.now(), pausedAt: null, stop: false, fresh: [], freshGlass: [], freshParts: [], last: initial, frame: 0, acked: 0 };
    run = r;
    post({
      type: 'started',
      id: msg.id,
      ids: world ? world.ids : new Uint32Array(0),
      initial,
      bodies: world?.bodies ?? 0,
      ...(pane ? { glass: pane.frame() } : {}),
      ...(parts ? { parts: { layout: parts.layout(), frame: parts.frame() } } : {}),
    });
    setTimeout(() => slice(r), 0);
  } catch (err) {
    world?.free();
    pane?.free();
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};

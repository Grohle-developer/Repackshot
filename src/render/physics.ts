// The physics worker's client (phase S2): starts the worker with the scalar rt.wasm the first time a simulation is
// asked for, hands it PHY1 scenes (io/phys.ts writes them) and turns its messages into a run: started (where each
// body is among the poses and the poses at step 0), the frames as they are recorded, done; pause, resume and stop.
// Every report is acknowledged once the page has taken it in (the worker keeps only a few frames ahead of that), and
// a pause or a stop asked for before the worker has the run reaches it right after the run. One run at a time; a new
// one replaces the old.

import type { PhysicsResult, PhysicsRunHandle, PhysicsRunOptions, PhysicsStarted, PhysicsUpdate } from '../core/physics';
import type { PhysicsReply, PhysicsRequest } from './physics-worker';

interface Pending {
  started: { resolve: (s: PhysicsStarted) => void; reject: (e: Error) => void };
  done: { resolve: (r: PhysicsResult) => void; reject: (e: Error) => void };
  onUpdate: (u: PhysicsUpdate) => void;
  /** The run has been posted to the worker; what was asked for before that. */
  sent: boolean;
  paused: boolean;
  stopped: boolean;
}

/** The simulator in a worker. */
export class PhysicsClient {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private next = 1;
  private readonly runs = new Map<number, Pending>();

  /**
   * `load` compiles rt.wasm (or rejects: the module is missing); `spawn` makes the worker. Neither runs before the
   * first simulation.
   */
  constructor(
    private readonly load: () => Promise<WebAssembly.Module>,
    private readonly spawn: () => Worker,
  ) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.load().then(
      (module) =>
        new Promise<void>((resolve, reject) => {
          const w = this.spawn();
          this.worker = w;
          w.onmessage = (e: MessageEvent<PhysicsReply>) => {
            const msg = e.data;
            if (msg.type === 'ready') resolve();
            else if (msg.type === 'error' && msg.id === null) reject(new Error(msg.message));
            else this.receive(msg);
          };
          w.onerror = (e) => reject(new Error(e.message || 'the physics worker failed'));
          w.postMessage({ type: 'init', module } satisfies PhysicsRequest);
        }),
    );
    // A failure is remembered once and tried again next time.
    this.ready.catch(() => {
      this.worker?.terminate();
      this.worker = null;
      this.ready = null;
    });
    return this.ready;
  }

  private receive(msg: PhysicsReply): void {
    if (msg.type === 'ready') return;
    const id = msg.id;
    if (id === null) return;
    const run = this.runs.get(id);
    if (!run) return;
    switch (msg.type) {
      case 'started':
        run.started.resolve({ ids: msg.ids, initial: msg.initial, bodies: msg.bodies });
        break;
      case 'progress':
        run.onUpdate({ steps: msg.steps, awake: msg.awake, bodies: msg.bodies, settled: msg.settled, frames: msg.frames });
        this.worker?.postMessage({ type: 'ack', id, frames: msg.frames.length } satisfies PhysicsRequest);
        break;
      case 'done': {
        this.runs.delete(id);
        const { type: _t, id: _i, ...result } = msg;
        run.done.resolve(result);
        break;
      }
      case 'error': {
        this.runs.delete(id);
        const err = new Error(msg.message);
        run.started.reject(err);
        run.done.reject(err);
        break;
      }
    }
  }

  /** Simulates a PHY1 scene with `dynamic` dynamic bodies. */
  run(scene: Uint8Array, dynamic: number, options: PhysicsRunOptions, onUpdate: (u: PhysicsUpdate) => void): PhysicsRunHandle {
    const id = this.next++;
    let started!: Pending['started'];
    let done!: Pending['done'];
    const post = (type: 'pause' | 'resume' | 'stop') => {
      if (pending.sent) this.worker?.postMessage({ type, id } satisfies PhysicsRequest);
    };
    const handle: PhysicsRunHandle = {
      started: new Promise<PhysicsStarted>((resolve, reject) => (started = { resolve, reject })),
      done: new Promise<PhysicsResult>((resolve, reject) => (done = { resolve, reject })),
      pause: () => {
        pending.paused = true;
        post('pause');
      },
      resume: () => {
        pending.paused = false;
        post('resume');
      },
      stop: () => {
        pending.stopped = true;
        post('stop');
      },
    };
    const pending: Pending = { started, done, onUpdate, sent: false, paused: false, stopped: false };
    this.runs.set(id, pending);
    // Unhandled rejections of the one nobody awaits are not errors.
    handle.started.catch(() => undefined);
    handle.done.catch(() => undefined);
    void this.start().then(
      () => {
        if (!this.runs.has(id)) return;
        const copy = scene.slice().buffer;
        this.worker!.postMessage({ type: 'run', id, scene: copy, dynamic, options } satisfies PhysicsRequest, [copy]);
        pending.sent = true;
        if (pending.paused) post('pause');
        if (pending.stopped) post('stop');
      },
      (err: unknown) => {
        this.runs.delete(id);
        const e = err instanceof Error ? err : new Error(String(err));
        pending.started.reject(e);
        pending.done.reject(e);
      },
    );
    return handle;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.runs.clear();
  }
}

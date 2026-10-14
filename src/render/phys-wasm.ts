// The rigid body simulator of rt.wasm (phase S2, engine/crates/rt-phys through rt-wasm's `phys_*`), typed: a world
// built from a PHY1 scene (io/phys.ts writes it), stepped and read back. No DOM and no workers here, so the physics
// worker (render/physics-worker.ts) and the tests in Node use the same code with the same module.

/** The exports of rt.wasm the simulator uses (absent in an rt.wasm older than S2). */
export interface PhysExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_scene_error_len(): number;
  rt_scene_error_copy(ptr: number): void;
  phys_new(ptr: number, len: number): number;
  phys_free(handle: number): number;
  phys_step(handle: number, n: number): number;
  phys_bodies(handle: number): number;
  phys_ids(handle: number, out: number): number;
  phys_poses(handle: number, out: number): number;
  phys_awake(handle: number): number;
  phys_settled(handle: number): number;
  phys_steps(handle: number): number;
  phys_hash(handle: number): number;
}

/** Floats per body in `poses()`: translation x, y, z, then the rotation quaternion x, y, z, w. */
export const POSE_FLOATS = 7;
/** Steps per second of simulated time (rt-phys `STEPS_PER_SECOND`: a fixed step of 1/240 s). */
export const STEPS_PER_SECOND = 240;
/** Index of a dynamic body of the scene that had no mass and stayed static. */
export const NO_BODY = 0xffffffff;

/** True when a compiled engine has the simulator. */
export function hasPhysExports(x: unknown): x is PhysExports {
  const e = x as Partial<PhysExports> | null;
  return !!e && typeof e.phys_new === 'function' && typeof e.phys_poses === 'function' && typeof e.phys_hash === 'function';
}

/** One world of the simulator inside an instance of rt.wasm. */
export class PhysWorld {
  private handle: number;
  /** Dynamic bodies in the world (the scene's, less those without mass). */
  readonly bodies: number;
  /** For each dynamic body of the scene, its index among the poses, or NO_BODY. */
  readonly ids: Uint32Array;

  /** Builds the world of a PHY1 scene; throws with the engine's message when the bytes are not one. */
  constructor(
    private readonly rt: PhysExports,
    scene: Uint8Array,
    dynamicBodies: number,
  ) {
    const ptr = rt.rt_alloc(scene.length);
    new Uint8Array(rt.memory.buffer, ptr, scene.length).set(scene);
    this.handle = rt.phys_new(ptr, scene.length);
    rt.rt_free(ptr, scene.length);
    if (this.handle === 0) {
      const len = rt.rt_scene_error_len();
      const at = rt.rt_alloc(len);
      rt.rt_scene_error_copy(at);
      const message = new TextDecoder().decode(new Uint8Array(rt.memory.buffer, at, len).slice());
      rt.rt_free(at, len);
      throw new Error(message || 'phys_new failed');
    }
    this.bodies = rt.phys_bodies(this.handle);
    const n = Math.max(0, dynamicBodies);
    const out = rt.rt_alloc(Math.max(4, n * 4));
    rt.phys_ids(this.handle, out);
    this.ids = new Uint32Array(new Uint8Array(rt.memory.buffer, out, n * 4).slice().buffer);
    rt.rt_free(out, Math.max(4, n * 4));
  }

  private live(): number {
    if (this.handle === 0) throw new Error('the physics world was freed');
    return this.handle;
  }

  /** Simulates `n` fixed steps. */
  step(n: number): void {
    this.rt.phys_step(this.live(), Math.max(0, Math.floor(n)));
  }

  /** Every pose, POSE_FLOATS per body (a copy). */
  poses(): Float32Array {
    const len = this.bodies * POSE_FLOATS * 4;
    const out = this.rt.rt_alloc(Math.max(4, len));
    this.rt.phys_poses(this.live(), out);
    const bytes = new Uint8Array(this.rt.memory.buffer, out, len).slice();
    this.rt.rt_free(out, Math.max(4, len));
    return new Float32Array(bytes.buffer);
  }

  get awake(): number {
    return this.rt.phys_awake(this.live());
  }

  /** Every body asleep: the simulation has stopped by itself. */
  get settled(): boolean {
    return this.rt.phys_settled(this.live()) === 1;
  }

  /** Steps simulated (the simulated time is this over STEPS_PER_SECOND). */
  get steps(): number {
    return this.rt.phys_steps(this.live());
  }

  /** FNV-1a of the poses: the native tests pin it. */
  get hash(): number {
    return this.rt.phys_hash(this.live()) >>> 0;
  }

  free(): void {
    if (this.handle !== 0) this.rt.phys_free(this.handle);
    this.handle = 0;
  }
}

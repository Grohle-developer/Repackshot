// The rigid body simulator of rt.wasm (phase S2, engine/crates/rt-phys through rt-wasm's `phys_*`), typed: a world
// built from a PHY1 scene (io/phys.ts writes it), stepped and read back. S9: and the cloth of a CLT1 spec (`cloth_*`),
// stepped with the world. S7: and the liquids of a LIQ1 scene (`liq_*`), their frame records and surfaces. S3b: and
// the pane of a front glass under the
// scene's rain and dust (`wet_*`, a WET1 spec from io/wet.ts), stepped with it and read a frame at a time. No DOM and no workers here, so the physics
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

  /** S3e: the engine's handle of this world (for the parts that step with it; S9: and a cloth, `ClothSim.step`). */
  get id(): number {
    return this.live();
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

/** S3b: the exports of rt.wasm that simulate rain and dust on a front glass (absent in an rt.wasm older than S3b). */
export interface WetExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_scene_error_len(): number;
  rt_scene_error_copy(ptr: number): void;
  wet_new(ptr: number, len: number): number;
  wet_free(handle: number): number;
  wet_step(handle: number, n: number): number;
  wet_steps(handle: number): number;
  wet_hash(handle: number): number;
  wet_frame(handle: number): number;
  wet_frame_copy(handle: number, out: number): number;
}

/** True when a compiled engine simulates the front glass (S3b). */
export function hasWetExports(x: unknown): x is WetExports {
  const e = x as Partial<WetExports> | null;
  return !!e && typeof e.wet_new === 'function' && typeof e.wet_frame === 'function' && typeof e.wet_hash === 'function';
}

/** One pane of the front glass under the scene's rain and dust inside an instance of rt.wasm (rt_phys::wet). */
export class WetSim {
  private handle: number;

  /** Builds the pane of a WET1 spec (io/wet.ts); throws with the engine's message when the bytes are not one. */
  constructor(
    private readonly rt: WetExports,
    spec: Uint8Array,
  ) {
    const ptr = rt.rt_alloc(spec.length);
    new Uint8Array(rt.memory.buffer, ptr, spec.length).set(spec);
    this.handle = rt.wet_new(ptr, spec.length);
    rt.rt_free(ptr, spec.length);
    if (this.handle === 0) {
      const len = rt.rt_scene_error_len();
      const at = rt.rt_alloc(Math.max(1, len));
      rt.rt_scene_error_copy(at);
      const message = new TextDecoder().decode(new Uint8Array(rt.memory.buffer, at, len).slice());
      rt.rt_free(at, Math.max(1, len));
      throw new Error(message || 'wet_new failed');
    }
  }

  private live(): number {
    if (this.handle === 0) throw new Error('the pane was freed');
    return this.handle;
  }

  step(n: number): void {
    this.rt.wet_step(this.live(), Math.max(0, Math.floor(n)));
  }

  get steps(): number {
    return this.rt.wet_steps(this.live());
  }

  /** FNV-1a of the pane: the native tests pin it. */
  get hash(): number {
    return this.rt.wet_hash(this.live()) >>> 0;
  }

  /** The record of a frame (the drops, the motes added and carried away since the last one); the next starts now. */
  frame(): Uint8Array {
    const h = this.live();
    const len = this.rt.wet_frame(h) >>> 0;
    const out = this.rt.rt_alloc(Math.max(4, len));
    this.rt.wet_frame_copy(h, out);
    const bytes = new Uint8Array(this.rt.memory.buffer, out, len).slice();
    this.rt.rt_free(out, Math.max(4, len));
    return bytes;
  }

  free(): void {
    if (this.handle !== 0) this.rt.wet_free(this.handle);
    this.handle = 0;
  }
}

/** S3c: the exports of rt.wasm that simulate rain, dust and snow on the parts (absent in an rt.wasm older than S3c). */
export interface PartsExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_scene_error_len(): number;
  rt_scene_error_copy(ptr: number): void;
  wpt_new(ptr: number, len: number): number;
  wpt_free(handle: number): number;
  wpt_step(handle: number, n: number): number;
  wpt_steps(handle: number): number;
  wpt_hash(handle: number): number;
  wpt_layout(handle: number): number;
  wpt_frame(handle: number): number;
  wpt_copy(handle: number, out: number): number;
  /** S3e: steps the parts with a world's bodies (absent in an rt.wasm older than S3e). */
  wpt_step_with?(handle: number, world: number, n: number): number;
  /** S3e: how many of the parts move with a body. */
  wpt_moving?(handle: number): number;
}

/** True when a compiled engine simulates the parts (S3c). */
export function hasPartsExports(x: unknown): x is PartsExports {
  const e = x as Partial<PartsExports> | null;
  return !!e && typeof e.wpt_new === 'function' && typeof e.wpt_frame === 'function' && typeof e.wpt_layout === 'function' && typeof e.wpt_hash === 'function';
}

/** The parts of a scene under its rain, dust and snow inside an instance of rt.wasm (rt_phys::wet_parts). */
export class PartsSim {
  private handle: number;

  /** Builds the parts of a WPT1 spec (core/wet-parts.ts); throws with the engine's message when the bytes are not one. */
  constructor(
    private readonly rt: PartsExports,
    spec: Uint8Array,
  ) {
    const ptr = rt.rt_alloc(spec.length);
    new Uint8Array(rt.memory.buffer, ptr, spec.length).set(spec);
    this.handle = rt.wpt_new(ptr, spec.length);
    rt.rt_free(ptr, spec.length);
    if (this.handle === 0) {
      const len = rt.rt_scene_error_len();
      const at = rt.rt_alloc(Math.max(1, len));
      rt.rt_scene_error_copy(at);
      const message = new TextDecoder().decode(new Uint8Array(rt.memory.buffer, at, len).slice());
      rt.rt_free(at, Math.max(1, len));
      throw new Error(message || 'wpt_new failed');
    }
  }

  private live(): number {
    if (this.handle === 0) throw new Error('the parts were freed');
    return this.handle;
  }

  step(n: number): void {
    this.rt.wpt_step(this.live(), Math.max(0, Math.floor(n)));
  }

  /** S3e: the parts that move with a body (0 for an rt.wasm older than S3e: it reads no body). */
  get moving(): number {
    return this.rt.wpt_moving ? this.rt.wpt_moving(this.live()) : 0;
  }

  /** S3e: `n` steps of these parts and of `world`'s bodies together, one after the other (the parts that move go with their bodies). */
  stepWith(world: PhysWorld, n: number): void {
    if (!this.rt.wpt_step_with) throw new Error('this rt.wasm does not step the parts with the bodies (npm run engine:build)');
    this.rt.wpt_step_with(this.live(), world.id, Math.max(0, Math.floor(n)));
  }

  get steps(): number {
    return this.rt.wpt_steps(this.live());
  }

  /** FNV-1a of the parts: the native tests pin it. */
  get hash(): number {
    return this.rt.wpt_hash(this.live()) >>> 0;
  }

  private take(len: number): Uint8Array {
    const out = this.rt.rt_alloc(Math.max(4, len));
    this.rt.wpt_copy(this.live(), out);
    const bytes = new Uint8Array(this.rt.memory.buffer, out, len).slice();
    this.rt.rt_free(out, Math.max(4, len));
    return bytes;
  }

  /** The layout of the samples (each triangle's resolution, the rates of dust and snow). */
  layout(): Uint8Array {
    return this.take(this.rt.wpt_layout(this.live()) >>> 0);
  }

  /** The record of a frame (the drops changed and gone, the samples wet and wiped, the drips); the next starts now. */
  frame(): Uint8Array {
    return this.take(this.rt.wpt_frame(this.live()) >>> 0);
  }

  free(): void {
    if (this.handle !== 0) this.rt.wpt_free(this.handle);
    this.handle = 0;
  }
}

/** S9: the exports of rt.wasm that simulate cloth (absent in an rt.wasm older than S9). */
export interface ClothExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_scene_error_len(): number;
  rt_scene_error_copy(ptr: number): void;
  cloth_new(ptr: number, len: number): number;
  cloth_free(handle: number): number;
  cloth_step(handle: number, world: number, n: number): number;
  cloth_vertices(handle: number): number;
  cloth_positions(handle: number, out: number): number;
  cloth_settled(handle: number): number;
  cloth_steps(handle: number): number;
  cloth_hash(handle: number): number;
}

/** True when a compiled engine simulates cloth (S9). */
export function hasClothExports(x: unknown): x is ClothExports {
  const e = x as Partial<ClothExports> | null;
  return !!e && typeof e.cloth_new === 'function' && typeof e.cloth_step === 'function' && typeof e.cloth_positions === 'function' && typeof e.cloth_hash === 'function';
}

/** The cloth of a scene inside an instance of rt.wasm (rt_phys::cloth). */
export class ClothSim {
  private handle: number;
  /** Vertices of all its pieces, in the CLT1's order. */
  readonly vertices: number;

  /** Builds the cloth of a CLT1 spec (core/cloth.ts `cltBytes`); throws with the engine's message when the bytes are not one. */
  constructor(
    private readonly rt: ClothExports,
    spec: Uint8Array,
  ) {
    const ptr = rt.rt_alloc(spec.length);
    new Uint8Array(rt.memory.buffer, ptr, spec.length).set(spec);
    this.handle = rt.cloth_new(ptr, spec.length);
    rt.rt_free(ptr, spec.length);
    if (this.handle === 0) {
      const len = rt.rt_scene_error_len();
      const at = rt.rt_alloc(Math.max(1, len));
      rt.rt_scene_error_copy(at);
      const message = new TextDecoder().decode(new Uint8Array(rt.memory.buffer, at, len).slice());
      rt.rt_free(at, Math.max(1, len));
      throw new Error(message || 'cloth_new failed');
    }
    this.vertices = rt.cloth_vertices(this.handle);
  }

  private live(): number {
    if (this.handle === 0) throw new Error('the cloth was freed');
    return this.handle;
  }

  /** Simulates `n` fixed steps; with `world` (of the same instance), its bodies step with the cloth and push it. */
  step(n: number, world: PhysWorld | null = null): void {
    if (this.rt.cloth_step(this.live(), world ? world.id : 0, Math.max(0, Math.floor(n))) !== 0) throw new Error('cloth_step: a handle that is not there');
  }

  /** Every vertex of every piece, world mm, x y z each (a copy). */
  positions(): Float32Array {
    const len = this.vertices * 12;
    const out = this.rt.rt_alloc(Math.max(4, len));
    this.rt.cloth_positions(this.live(), out);
    const bytes = new Uint8Array(this.rt.memory.buffer, out, len).slice();
    this.rt.rt_free(out, Math.max(4, len));
    return new Float32Array(bytes.buffer);
  }

  /** No particle has moved on for half a second. */
  get settled(): boolean {
    return this.rt.cloth_settled(this.live()) === 1;
  }

  get steps(): number {
    return this.rt.cloth_steps(this.live());
  }

  /** FNV-1a of the particles: the native tests pin it. */
  get hash(): number {
    return this.rt.cloth_hash(this.live()) >>> 0;
  }

  free(): void {
    if (this.handle !== 0) this.rt.cloth_free(this.handle);
    this.handle = 0;
  }
}

/** S7: the exports of rt.wasm that simulate liquids (absent in an rt.wasm older than S7). */
export interface LiquidExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_scene_error_len(): number;
  rt_scene_error_copy(ptr: number): void;
  liq_new(ptr: number, len: number): number;
  liq_free(handle: number): number;
  liq_step(handle: number, n: number): number;
  liq_steps(handle: number): number;
  liq_liquids(handle: number): number;
  liq_count(handle: number, i: number): number;
  liq_hash(handle: number): number;
  liq_frame(handle: number, i: number): number;
  liq_surface(handle: number, i: number): number;
  liq_copy(handle: number, out: number): number;
  liq_mesh(ptr: number, len: number): number;
  liq_mesh_copy(out: number): number;
}

/** True when a compiled engine simulates liquids (S7). */
export function hasLiquidExports(x: unknown): x is LiquidExports {
  const e = x as Partial<LiquidExports> | null;
  return !!e && typeof e.liq_new === 'function' && typeof e.liq_frame === 'function' && typeof e.liq_surface === 'function' && typeof e.liq_mesh === 'function';
}

function engineError(rt: LiquidExports, fallback: string): Error {
  const len = rt.rt_scene_error_len();
  const at = rt.rt_alloc(Math.max(1, len));
  rt.rt_scene_error_copy(at);
  const message = new TextDecoder().decode(new Uint8Array(rt.memory.buffer, at, len).slice());
  rt.rt_free(at, Math.max(1, len));
  return new Error(message || fallback);
}

/** The liquids of a scene inside an instance of rt.wasm (rt_phys::liquid). */
export class LiquidSim {
  private handle: number;
  /** The number of liquids (in the order of the LIQ1). */
  readonly liquids: number;

  /** Builds the liquids of a LIQ1 scene (core/liquid.ts); throws with the engine's message when the bytes are not one. */
  constructor(
    private readonly rt: LiquidExports,
    spec: Uint8Array,
  ) {
    const ptr = rt.rt_alloc(spec.length);
    new Uint8Array(rt.memory.buffer, ptr, spec.length).set(spec);
    this.handle = rt.liq_new(ptr, spec.length);
    rt.rt_free(ptr, spec.length);
    if (this.handle === 0) throw engineError(rt, 'liq_new failed');
    this.liquids = rt.liq_liquids(this.handle);
  }

  private live(): number {
    if (this.handle === 0) throw new Error('the liquids were freed');
    return this.handle;
  }

  step(n: number): void {
    this.rt.liq_step(this.live(), Math.max(0, Math.floor(n)));
  }

  get steps(): number {
    return this.rt.liq_steps(this.live());
  }

  /** The particles of liquid `i`. */
  count(i: number): number {
    return this.rt.liq_count(this.live(), i);
  }

  /** FNV-1a of the particles: the native tests pin it. */
  get hash(): number {
    return this.rt.liq_hash(this.live()) >>> 0;
  }

  private take(len: number): Uint8Array {
    const out = this.rt.rt_alloc(Math.max(4, len));
    this.rt.liq_copy(this.live(), out);
    const bytes = new Uint8Array(this.rt.memory.buffer, out, len).slice();
    this.rt.rt_free(out, Math.max(4, len));
    return bytes;
  }

  /** The frame record of liquid `i` now (LQF1). */
  frame(i: number): Uint8Array {
    return this.take(this.rt.liq_frame(this.live(), i) >>> 0);
  }

  /** The surface of liquid `i` now (rebuilt from its frame record: core/liquid.ts `surfaceMesh` reads it). */
  surface(i: number): Uint8Array {
    return this.take(this.rt.liq_surface(this.live(), i) >>> 0);
  }

  free(): void {
    if (this.handle !== 0) this.rt.liq_free(this.handle);
    this.handle = 0;
  }
}

/** S7: the surface of a frame record by an instance's `liq_mesh` (the bytes of core/liquid.ts `surfaceMesh`), or null. */
export function liquidSurface(rt: LiquidExports, record: Uint8Array): Uint8Array | null {
  const ptr = rt.rt_alloc(Math.max(4, record.length));
  new Uint8Array(rt.memory.buffer, ptr, record.length).set(record);
  const len = rt.liq_mesh(ptr, record.length) >>> 0;
  rt.rt_free(ptr, Math.max(4, record.length));
  if (len === 0xffffffff) return null;
  const out = rt.rt_alloc(Math.max(4, len));
  rt.liq_mesh_copy(out);
  const bytes = new Uint8Array(rt.memory.buffer, out, len).slice();
  rt.rt_free(out, Math.max(4, len));
  return bytes;
}

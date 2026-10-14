// The particles of an ambient effect for the Fast preview (phase S4a): `rt_particles_eval` of rt.wasm, the engine's
// own simulator (engine/crates/rt-sim), on the page's thread. There is no TypeScript port of the simulator (ROADMAP
// S0 §1): without the module the preview draws the region box only, and the meter says so.

/** Floats per particle (rt_wasm::PARTICLE_FLOATS): centre x y z, radius, axis x y z, tint seed bits. */
export const PARTICLE_FLOATS = 8;

/** The exports of rt.wasm the preview's particles need (S4a; absent in an older module). */
export interface RtParticleExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_particles_eval(params: number, len: number, max: number, out: number): number;
}

export function hasParticleExport(rt: object): rt is RtParticleExports {
  return typeof (rt as { rt_particles_eval?: unknown }).rt_particles_eval === 'function';
}

/**
 * The first `max` particles of the effect whose `FXAM` payload is `payload` (core/effects.ts `fxamPayload`):
 * `PARTICLE_FLOATS` floats each, the same the renderer evaluates. Null when the module refuses the payload.
 */
export function evalParticles(rt: RtParticleExports, payload: Uint8Array, max: number): Float32Array | null {
  const n = Math.max(0, Math.floor(max));
  const inPtr = rt.rt_alloc(payload.length);
  const outLen = Math.max(4, n * PARTICLE_FLOATS * 4);
  const outPtr = rt.rt_alloc(outLen);
  try {
    new Uint8Array(rt.memory.buffer, inPtr, payload.length).set(payload);
    // The u32 comes back as a signed i32: u32::MAX (refused) is -1.
    const got = rt.rt_particles_eval(inPtr, payload.length, n, outPtr) >>> 0;
    if (got === 0xffffffff || got > n) return null;
    // A fresh view: the call may have grown the memory.
    return new Float32Array(rt.memory.buffer, outPtr, got * PARTICLE_FLOATS).slice();
  } finally {
    rt.rt_free(inPtr, payload.length);
    rt.rt_free(outPtr, outLen);
  }
}

/** The tint seed of particle `i` (its `u32` bits). */
export function tintSeed(particles: Float32Array, i: number): number {
  return new Uint32Array(particles.buffer, particles.byteOffset + (i * PARTICLE_FLOATS + 7) * 4, 1)[0];
}

/**
 * The preview's colour of a particle: the palette's tint the engine picks (`tint % count`, rt_sim::tint_factor),
 * and a brightness from its seed within the effect's tint variation (the engine's per-channel shift is left out).
 */
export function previewTint(seed: number, palette: readonly (readonly number[])[], tintVar: number): [number, number, number] {
  const base = palette.length > 0 ? palette[seed % Math.min(4, palette.length)] : [1, 1, 1];
  // Any well spread number in [0, 1) from the seed is enough for a preview.
  const u = (Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0) / 4294967296;
  const b = 1 + Math.min(1, Math.max(0, tintVar)) * (u - 0.5);
  return [base[0] * b, base[1] * b, base[2] * b];
}

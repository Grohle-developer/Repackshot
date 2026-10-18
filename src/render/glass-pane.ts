// A camera's front glass as the engine lays it out (phase S3b): the page's rt.wasm reads a scene of only that camera
// and its pane (io/rsb.ts `glassPaneRsb`) and says where the pane is, how much of it the camera's rays cross, and the
// drops and motes it scatters by hand (`rt_scene_glass`): what the Fast viewport's approximation draws and the size of
// the square the simulation of the scene's rain wets. An rt.wasm older than S3b, or none, says nothing.

import { parseEnginePane, type EnginePane } from '../core/wet';

/** The exports of rt.wasm this needs. */
export interface RtGlassExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_scene_load(ptr: number, len: number): number;
  rt_scene_free(handle: number): number;
  rt_scene_glass_len(handle: number): number;
  rt_scene_glass_copy(handle: number, out: number): number;
}

/** True when this build of the module lays a front glass out for the page. */
export function hasGlassExports(rt: object): rt is RtGlassExports {
  const e = rt as Partial<RtGlassExports>;
  return typeof e.rt_scene_glass_len === 'function' && typeof e.rt_scene_glass_copy === 'function' && typeof e.rt_scene_load === 'function';
}

/** The pane of the scene `rsb` as the engine lays it out; null when the module refuses the scene or it has no pane. */
export function engineGlassPane(rt: RtGlassExports, rsb: Uint8Array): EnginePane | null {
  const ptr = rt.rt_alloc(rsb.length);
  new Uint8Array(rt.memory.buffer, ptr, rsb.length).set(rsb);
  const handle = rt.rt_scene_load(ptr, rsb.length);
  rt.rt_free(ptr, rsb.length);
  if (handle === 0) return null;
  try {
    const len = rt.rt_scene_glass_len(handle) >>> 0;
    if (len === 0 || len === 0xffffffff) return null;
    const out = rt.rt_alloc(len);
    try {
      if (rt.rt_scene_glass_copy(handle, out) !== 0) return null;
      return parseEnginePane(new Uint8Array(rt.memory.buffer, out, len).slice());
    } finally {
      rt.rt_free(out, len);
    }
  } finally {
    rt.rt_scene_free(handle);
  }
}

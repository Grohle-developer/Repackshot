// What the engine makes of a camera's traced lens (phase O2): the page's own rt.wasm reads a scene with only the
// camera in it and answers with its lens information (rt-core `Camera::lens_info_json`: focal length, back focus,
// f-number, T-stop, transmittance, distortion and relative illumination against image height). The interface shows
// these numbers and the Fast viewport draws its distortion and falloff from them (rule 10: never its own).

import { parseLensInfo, type EngineLensInfo } from '../core/traced-lens';

/** The exports of rt.wasm this needs. */
export interface RtLensInfoExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_scene_load(ptr: number, len: number): number;
  rt_scene_free(handle: number): number;
  rt_scene_lens_info_len(handle: number): number;
  rt_scene_lens_info_copy(handle: number, ptr: number): number;
}

/** True when this build of the module tells its lens information. */
export function hasLensInfoExport(rt: object): rt is RtLensInfoExports {
  const e = rt as Partial<RtLensInfoExports>;
  return typeof e.rt_scene_lens_info_len === 'function' && typeof e.rt_scene_lens_info_copy === 'function' && typeof e.rt_scene_load === 'function';
}

/**
 * The lens information of the scene `rsb` (lensInfoRsb of io/rsb.ts): the traced lens's numbers, null for the thin
 * lens, undefined when the module refuses the scene (a prescription that forms no image) or answers nothing it can read.
 */
export function readLensInfo(rt: RtLensInfoExports, rsb: Uint8Array): EngineLensInfo | null | undefined {
  const ptr = rt.rt_alloc(rsb.length);
  new Uint8Array(rt.memory.buffer, ptr, rsb.length).set(rsb);
  const handle = rt.rt_scene_load(ptr, rsb.length);
  rt.rt_free(ptr, rsb.length);
  if (handle === 0) return undefined;
  try {
    const len = rt.rt_scene_lens_info_len(handle) >>> 0;
    if (len === 0xffffffff || len > 1 << 20) return undefined;
    const out = rt.rt_alloc(Math.max(1, len));
    try {
      if (rt.rt_scene_lens_info_copy(handle, out) !== 0) return undefined;
      const text = new TextDecoder().decode(new Uint8Array(rt.memory.buffer, out, len).slice());
      return parseLensInfo(text);
    } finally {
      rt.rt_free(out, Math.max(1, len));
    }
  } finally {
    rt.rt_scene_free(handle);
  }
}

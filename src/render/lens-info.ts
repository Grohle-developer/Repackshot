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
  /** The reason of the last refused load (every build of the module that tells its lens information has them). */
  rt_scene_error_len?(): number;
  rt_scene_error_copy?(ptr: number): void;
}

/** O2c: what the engine says of a lens, with its reason when it refuses it. */
export type LensVerdict = { state: 'ready'; info: EngineLensInfo } | { state: 'thin' } | { state: 'refused'; reason: string };

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
  const v = readLensVerdict(rt, rsb);
  return v.state === 'ready' ? v.info : v.state === 'thin' ? null : undefined;
}

/** The engine's reason for the scene it last refused to load ('' when it has none to tell). */
function loadError(rt: RtLensInfoExports): string {
  if (typeof rt.rt_scene_error_len !== 'function' || typeof rt.rt_scene_error_copy !== 'function') return '';
  const len = rt.rt_scene_error_len() >>> 0;
  if (len === 0 || len > 4096) return '';
  const out = rt.rt_alloc(len);
  try {
    rt.rt_scene_error_copy(out);
    return new TextDecoder().decode(new Uint8Array(rt.memory.buffer, out, len).slice());
  } finally {
    rt.rt_free(out, len);
  }
}

/**
 * O2c: as `readLensInfo`, with the engine's own words when it refuses the lens (the lens editor says why a lens forms
 * no image or lets no light through).
 */
export function readLensVerdict(rt: RtLensInfoExports, rsb: Uint8Array): LensVerdict {
  const ptr = rt.rt_alloc(rsb.length);
  new Uint8Array(rt.memory.buffer, ptr, rsb.length).set(rsb);
  const handle = rt.rt_scene_load(ptr, rsb.length);
  rt.rt_free(ptr, rsb.length);
  if (handle === 0) return { state: 'refused', reason: loadError(rt) };
  try {
    const len = rt.rt_scene_lens_info_len(handle) >>> 0;
    if (len === 0xffffffff || len > 1 << 20) return { state: 'refused', reason: '' };
    const out = rt.rt_alloc(Math.max(1, len));
    try {
      if (rt.rt_scene_lens_info_copy(handle, out) !== 0) return { state: 'refused', reason: '' };
      const text = new TextDecoder().decode(new Uint8Array(rt.memory.buffer, out, len).slice());
      const info = parseLensInfo(text);
      return info ? { state: 'ready', info } : info === null ? { state: 'thin' } : { state: 'refused', reason: '' };
    } finally {
      rt.rt_free(out, Math.max(1, len));
    }
  } finally {
    rt.rt_scene_free(handle);
  }
}

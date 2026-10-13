// Exact per-pixel passes written next to the image (AI-POST.md §3.1, §7.4):
// what the AI guard leans on, and later the render passes of N2. This is the
// contract between X2 (the engine writes them), X3 (the pipeline reads them)
// and X4 (the Fast-mode preview draws the same passes with three.js). Phases
// add passes at the end; they do not change these.

/** Pass keys, in the order of their bits in the RNDR pass mask (bit i is PASS_KEYS[i]). Stable: add at the end. */
export const PASS_KEYS = ['albedo', 'normal', 'depth', 'partId', 'materialId', 'coc'] as const;
export type PassKey = (typeof PASS_KEYS)[number];

/** Floats (or u32 for the ids) per pixel of each pass. */
export const PASS_CHANNELS: Readonly<Record<PassKey, 1 | 3>> = { albedo: 3, normal: 3, depth: 1, partId: 1, materialId: 1, coc: 1 };

/** Bit of a pass in the RNDR pass mask. */
export function passBit(key: PassKey): number {
  return 1 << PASS_KEYS.indexOf(key);
}

/** Pass mask of a set of passes. */
export function passMask(keys: readonly PassKey[]): number {
  return keys.reduce((m, k) => m | passBit(k), 0);
}

/**
 * The passes of one image: `width × height`, row-major from the top-left pixel, like the image.
 *
 * Background (a ray that hits nothing) is albedo 0, normal 0, depth +Infinity, ids 0 and coc 0.
 * `normal`, `depth`, `partId` and `materialId` come from one ray through the pixel centre, without
 * jitter, so they are exact and never blended across an edge; `albedo` is averaged over the
 * pixel's samples, like the image. A pass that was not asked for is absent.
 */
export interface RenderPasses {
  width: number;
  height: number;
  /** Linear RGB, 3 floats a pixel: the base colour at the first non-specular hit (a diffuse material: its colour). */
  albedo?: Float32Array;
  /** World-space (Z up) unit shading normal at the first hit, 3 floats a pixel. */
  normal?: Float32Array;
  /** Distance along the camera's view axis to the first hit, in scene units. */
  depth?: Float32Array;
  /** RSB instance index + 1 of the first hit: io/rsb.ts maps it to the part, as `pick` does. 0 is background. */
  partId?: Uint32Array;
  /** RSB material index + 1 of the first hit. 0 is background. */
  materialId?: Uint32Array;
  /** Circle-of-confusion diameter in output pixels from the thin-lens camera: 0 on the focus plane and with depth of field off. */
  coc?: Float32Array;
}

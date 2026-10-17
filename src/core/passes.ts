// Exact per-pixel passes written next to the image (AI-POST.md §3.1, §7.4):
// what the AI guard leans on, and the render passes of N2 (the alpha matte,
// appended by that phase). This is the contract between X2 (the engine writes
// them), X3 (the pipeline reads them), X4 (the Fast-mode preview draws the same
// passes with three.js) and N2 (the files of the render window). Phases add
// passes at the end; they do not change these.

/** Pass keys, in the order of their bits in the RNDR pass mask (bit i is PASS_KEYS[i]). Stable: add at the end. */
export const PASS_KEYS = ['albedo', 'normal', 'depth', 'partId', 'materialId', 'coc', 'alpha'] as const;
export type PassKey = (typeof PASS_KEYS)[number];

/**
 * The six passes of the AI guard's contract (X2, AI-POST.md §7.4): `PASS_KEYS` before N2 appended the alpha. The
 * Fast-mode preview draws exactly these with three.js, and the pinned hashes of X2 are over these.
 */
export const AI_PASS_KEYS: readonly PassKey[] = ['albedo', 'normal', 'depth', 'partId', 'materialId', 'coc'];

/**
 * `partId` and `materialId` of the studio floor (the RSB floor, not an instance). The floor is a surface
 * the AI may relight (its contact shadows are what Light and Bounce improve), unlike the background (0:
 * environment, backplate, transparency, light panels), which never changes.
 */
export const FLOOR_ID = 0xffff_ffff;

/** Floats (or u32 for the ids) per pixel of each pass. */
export const PASS_CHANNELS: Readonly<Record<PassKey, 1 | 3>> = { albedo: 3, normal: 3, depth: 1, partId: 1, materialId: 1, coc: 1, alpha: 1 };

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
  /** Linear RGB, 3 floats a pixel: the base colour of the material at the first hit (no specular bounce is followed; glass gives its own tint). */
  albedo?: Float32Array;
  /** World-space (Z up) unit shading normal at the first hit, turned to face the camera (both sides of a triangle count), 3 floats a pixel. */
  normal?: Float32Array;
  /** Distance along the camera's view axis to the first hit, in scene units. */
  depth?: Float32Array;
  /** RSB instance index + 1 of the first hit: io/rsb.ts maps it to the part, as `pick` does. 0 is background; the studio floor is FLOOR_ID. */
  partId?: Uint32Array;
  /** RSB material index + 1 of the first hit. 0 is background; the studio floor is FLOOR_ID. */
  materialId?: Uint32Array;
  /** Circle-of-confusion diameter in output pixels from the thin-lens camera: 0 on the focus plane and with depth of field off. */
  coc?: Float32Array;
  /**
   * N2: coverage of the scene's objects, 0..1: the share of the pixel's samples whose camera ray meets a surface of an
   * instance (so the edges are anti-aliased, like the albedo). The studio floor, the environment, the background and the
   * light panels the camera sees are not coverage, whatever the render's background is. Cut-outs and glass count as
   * surfaces, as for every pass ray.
   */
  alpha?: Float32Array;
}

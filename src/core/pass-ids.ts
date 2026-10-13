// The ids of the passes (AI-POST.md §7.4): `partId` is the RSB instance index + 1 and `materialId` the RSB
// material index + 1. The engine's scene (io/rsb.ts `projectScene`) decides both orders, and hands them over
// as `PassIds`; the three.js passes of the Fast-mode preview (render/preview-passes.ts) draw the same numbers
// from it, and the guard maps them back to parts and materials. Pure: the render layer may not import io.

import type { NodeId } from './scene';

/** One RSB instance: a part (or a face-material group of a part), the material it carries. */
export interface PassInstance {
  /** The scene node (a part) the instance was made from. */
  node: NodeId;
  /** The material key the instance's triangles use: the project's material id, or null for the default material. */
  material: string | null;
  /** RSB material index + 1 of that material (what the `materialId` pass holds). */
  materialId: number;
}

/** The engine's camera as the RSB writes it (io/rsb.ts `RsbCamera`): what a ray through a pixel centre follows. */
export interface PassCamera {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  up: readonly [number, number, number];
  focalMm: number;
  /** Along the longer image side. */
  sensorMm: number;
  ortho: boolean;
  orthoWidth: number;
}

/**
 * The studio floor of the engine's scene (RSB `FLOR`, visible or a shadow catcher): the plane `z` (Z up), the
 * albedo the engine gives it in the passes (its colour, in the shadow catcher too) and the camera, so the floor's
 * pixels can be found by casting the engine's own centre rays (render/preview-passes.ts). Both ids are FLOOR_ID.
 */
export interface PassFloor {
  z: number;
  albedo: readonly [number, number, number];
  camera: PassCamera;
}

/** The instances in RSB order: instance `i` has `partId` `i + 1`. */
export interface PassIds {
  instances: PassInstance[];
  /** The studio floor when the scene has one (X3c: it is a surface the AI relights, not background). */
  floor?: PassFloor | null;
}

/** Lookups over `PassIds`. */
export interface PassIndex {
  /** `partId` of the instance made from `node` with this material key; 0 when there is none (hidden or empty parts). */
  partId(node: NodeId, material: string | null): number;
  /** `materialId` of an instance by its `partId`; 0 for the background. */
  materialId(partId: number): number;
  /** The node an id stands for (as `pick` finds it); null for the background. */
  nodeOf(partId: number): NodeId | null;
}

export function indexPassIds(ids: PassIds): PassIndex {
  const byKey = new Map<string, number>();
  ids.instances.forEach((inst, i) => {
    const key = `${inst.node}\u0000${inst.material ?? ''}\u0000${inst.material === null ? 'n' : 's'}`;
    if (!byKey.has(key)) byKey.set(key, i + 1);
  });
  return {
    partId: (node, material) => byKey.get(`${node}\u0000${material ?? ''}\u0000${material === null ? 'n' : 's'}`) ?? 0,
    materialId: (partId) => ids.instances[partId - 1]?.materialId ?? 0,
    nodeOf: (partId) => ids.instances[partId - 1]?.node ?? null,
  };
}

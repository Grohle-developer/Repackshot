// Parametric primitives (phase U9), see README.md.
//
// The catalogue of the shapes Add ▸ Primitive offers, in primitives.json: a stable key per shape (added, never
// renamed: saved projects keep it), its role in a studio set and its parameters. Names and parameter labels are
// interface strings (src/ui/strings.ts, `prim.<KEY>` and `primParam.<key>`); the geometry is src/core/primitives.ts.
//
// Every length is in millimetres. A length's default is `scale` times the size of the scene (the product's
// largest dimension, or the declared part size without a product); a count has a fixed `default`.

import raw from './primitives.json';

/** The shapes, in the order of the menus. */
export type PrimitiveKind = 'BOX' | 'PLANE' | 'DISC' | 'CYLINDER' | 'PEDESTAL' | 'SPHERE' | 'CONE' | 'TORUS' | 'CAPSULE' | 'TUBE' | 'STEPS' | 'SWEEP';

/**
 * Where a new one goes with a product in the scene: BASE under the product (it is lifted to sit on top), FLOOR
 * flat on the floor under it, BACKDROP under it with its wall behind, OBJECT on the floor beside it.
 */
export type PrimitiveRole = 'BASE' | 'FLOOR' | 'BACKDROP' | 'OBJECT';

export interface PrimitiveParamSpec {
  key: string;
  /** LENGTH: millimetres; COUNT: a whole number (segments, steps). */
  kind: 'LENGTH' | 'COUNT';
  min: number;
  max?: number;
  /** Step of the arrow keys in the inspector (LENGTH). */
  step?: number;
  /** LENGTH: the default is this many times the size of the scene. */
  scale?: number;
  /** COUNT: the default. */
  default?: number;
}

export interface PrimitiveCatalogEntry {
  key: PrimitiveKind;
  role: PrimitiveRole;
  params: readonly PrimitiveParamSpec[];
}

interface RawCatalogue {
  version: number;
  material: string;
  primitives: PrimitiveCatalogEntry[];
}

const catalogue = (): RawCatalogue => raw as unknown as RawCatalogue;

export const PRIMITIVES: readonly PrimitiveCatalogEntry[] = /* @__PURE__ */ catalogue().primitives;

export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = /* @__PURE__ */ PRIMITIVES.map((p) => p.key);

/** The catalogue material every new primitive wears: a neutral one (Studio white). */
export const PRIMITIVE_MATERIAL: string = /* @__PURE__ */ catalogue().material;

export function primitiveEntry(key: string): PrimitiveCatalogEntry | undefined {
  return PRIMITIVES.find((p) => p.key === key);
}

export function isPrimitiveKind(key: unknown): key is PrimitiveKind {
  return typeof key === 'string' && PRIMITIVES.some((p) => p.key === key);
}

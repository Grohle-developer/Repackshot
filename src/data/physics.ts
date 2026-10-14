// Physics data (phase S2, not ported): the density a part falls with, by the category of its material, and the
// surface parameters a part has until the inspector's Physics section sets its own. Keys are the material
// categories of src/data/materials.ts (stable); values are typical densities of what each category holds, kg/m³.

import type { MaterialCategory } from './types';

/** Typical density of each material category, kg/m³: steel and brass for metals, ABS and acrylic for plastics,
 * a hardwood, a folded textile, soda-lime glass, a bulb's glass for emitters, water for everything else. */
export const DENSITY_BY_CATEGORY: Readonly<Record<MaterialCategory, number>> = {
  METAL: 7800,
  PLASTIC: 1100,
  WOOD: 700,
  FABRIC: 400,
  GLASS: 2500,
  EMISSIVE: 2500,
  OTHER: 1000,
};

/** The simulator's default density (rt-phys `DEFAULT_DENSITY`), kg/m³: a part without a material. */
export const DEFAULT_DENSITY = 1000;

/** What a part has until it is given its own: Coulomb friction (static and dynamic) and bounciness (restitution). */
export const PHYSICS_DEFAULTS = {
  friction: 0.5,
  bounciness: 0.2,
} as const;

/** The floor's surface (the studio floor at z = 0 is always there for the simulator). */
export const FLOOR_SURFACE = {
  friction: 0.6,
  bounciness: 0.2,
} as const;

/** Limits of the inspector's fields. */
export const PHYSICS_LIMITS = {
  density: { min: 1, max: 25000 },
  friction: { min: 0, max: 2 },
  bounciness: { min: 0, max: 1 },
} as const;

/** The roles of the inspector, in order; CLOTH (S9) and LIQUID (S7) are coming soon. */
export const PHYSICS_ROLES = ['STATIC', 'DYNAMIC', 'CLOTH', 'LIQUID'] as const;
export type PhysicsRoleKey = (typeof PHYSICS_ROLES)[number];

/** Roles that exist in this version. */
export const BUILT_ROLES: ReadonlySet<PhysicsRoleKey> = new Set<PhysicsRoleKey>(['STATIC', 'DYNAMIC']);

/** Longest a simulation runs before it stops by itself, settled or not: simulated seconds. */
export const MAX_SIMULATED_SECONDS = 30;

// The front glass of a camera (phase S3, UI.md §2.4 Camera ▸ Lens ▸ Filters ▸ Front glass): a pane in front of the lens,
// at the distance of its front element, that drops of water and motes of dust lie on (the engine's
// rt-core `optics::glass`, the RSB `GLAS` section). The interface has the photographer's knobs (drops, their size,
// dust, the seed, the distance); the rest of the pane is these values.
//
// Every value here is this phase's proposal for the lead's verdict (rule 11, ◆ in the ROADMAP's S3): the contact angle
// of water on the glass, the spread of the drops' sizes, the motes' size and opacity, the knobs' ranges and defaults.

/** The pane's values the interface does not show (rt-core `GlassParams`). */
export const FRONT_GLASS_FIXED = {
  /** Spread of the drops' diameters, ± share of the mean. */
  dropSizeVar: 0.6,
  /** Contact angle of water on the glass, degrees: a lens that is neither clean glass nor coated against water. */
  contactAngleDeg: 60,
  /** Index of refraction of the drops (water). */
  ior: 1.333,
  /** Mean diameter of a mote of dust, mm, and its spread. */
  dustSizeMm: 0.3,
  dustSizeVar: 0.6,
  /** What a mote stops of a ray. */
  dustOpacity: 0.9,
} as const;

/** The knobs' ranges: what the engine accepts (rt-core `GlassParams::decode`), narrowed to what reads as a photograph. */
export const FRONT_GLASS_LIMITS = {
  /** Share of the pane under drops before they merge. */
  drops: { min: 0, max: 0.9 },
  /** Mean diameter of a drop's footprint, mm. */
  dropSizeMm: { min: 0.2, max: 10 },
  /** Share of the pane under dust. */
  dust: { min: 0, max: 0.5 },
  /** Distance of the pane from the lens's centre, mm (0: where a front element sits). */
  distanceMm: { min: 0, max: 200 },
} as const;

/** What a pane switched on starts with. */
export const FRONT_GLASS_START = {
  drops: 0.3,
  dropSizeMm: 2,
  dust: 0.02,
  seed: 1,
  distanceMm: 0,
} as const;

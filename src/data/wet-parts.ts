// Rain, dust and snow on the parts (phase S3c, SPEC §3.1 "Physics", UI.md §2.5): what each ambient effect leaves on
// the parts when it falls on them (its `wetParts` switch, Scene ▸ Ambient), and the knobs of the simulation the page
// does not show (engine/crates/rt-phys `wet_parts`: the samples of the surfaces, how long a run goes on). Every value
// is this phase's proposal for the lead's verdict (rule 11, ◆ in the ROADMAP's S3c).

import type { EffectKind } from './effects';

/**
 * What each effect leaves on the parts: drops of water, a field of dust, a layer of snow, or nothing (rising bubbles,
 * confetti that does not stick, and the volumes of S5, which have no particles).
 */
export const PARTS_FEED: Readonly<Record<EffectKind, 'DROPS' | 'DUST' | 'SNOW' | null>> = {
  DUST_MOTES: 'DUST',
  POLLEN: 'DUST',
  RAIN: 'DROPS',
  SNOW: 'SNOW',
  DUST_CLOUD: 'DUST',
  ASH: 'DUST',
  BUBBLES: null,
  CONFETTI: null,
  HAZE: null,
  LIGHT_SHAFTS: null,
  GROUND_FOG: null,
  WATER_DROPS: 'DROPS',
};

/** The least side of a cell of the samples on the surfaces, mm (◆: a trail of a drop of 3 mm reads). */
export const PARTS_CELL_MM = 1;

/**
 * The most samples of all the parts together (◆): the cells grow until they keep under it. It bounds the cost of a run
 * and the size of its recording in the project (a byte of each layer per sample, and the rates of dust and snow).
 */
export const PARTS_MAX_SAMPLES = 150_000;

/** The longest a run that wets the parts goes on before it stops by itself, simulated seconds (◆, the glass's). */
export const MAX_PARTS_SECONDS = 120;

/** The pieces of a set (backdrop, floor, cards) take no drops one by one: they wet as a film (◆). */
export const SET_PIECES_AS_FILM = true;

/**
 * S3e: the least side of a cell of the studio floor, mm (◆): the floor under the product, a film of square cells that the
 * rain, the drips, the dust and the snow fall on.
 */
export const FLOOR_CELL_MM = 2;

/** S3e: the most cells of the studio floor (◆): its cells grow until they keep under it. */
export const FLOOR_MAX_CELLS = 250_000;

/** S3e: how much a wet film darkens the studio floor (◆: the WETG porosity; on a shadow catcher, a grey of 0.5 darkened). */
export const FLOOR_POROSITY = 0.5;

/**
 * S3e: the cell of the set's film triangles that a shadow edge crosses, mm (◆): those triangles take it, so the edge of a
 * snow or dust shadow on the set is no coarser than this.
 */
export const PARTS_EDGE_CELL_MM = 2;

/** S3e: the most samples the refined triangles take together, on top of the budget (◆; the cell grows to keep under it). */
export const PARTS_EDGE_BUDGET = 300_000;

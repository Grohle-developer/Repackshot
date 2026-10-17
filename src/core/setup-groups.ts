// The light catalogue in two groups (phase L7): Sets, the entries that put something in the scene besides lights (a
// backdrop, a floor, cards, a pool of light: the decoration of core/sets.ts), and Lights, the entries that only place
// lights (they may also choose a world, an exposure and the dome's strength, as the Interior recipes do, but they dress
// nothing). The grouping is a view: no catalogue key, style or order changes (rule 7).
//
// Each group has its filters, rows of chips that combine (AND) as the recipe filters of a plugin do (P6b,
// core/plugins.ts): a filter at All passes everything, a chosen value keeps the entries that have it. Sets filter by
// product type (the types whose own rig is that set, `StudioPreset.set`) and by subject (the object the set is designed
// for, `hero`); Lights by style. Pure: no DOM.

import { LIGHT_SETUPS, LIGHT_STYLES, lightSetup } from '../data/light-setups';
import { STUDIO_PRESETS } from '../data/studios';
import type { LightSetup, LightStyle, SetHero } from '../data/types';
import { resolvePreset, type PresetRef } from './rig';
import { hasDecoration, setOf } from './sets';

export type SetupGroup = 'SETS' | 'LIGHTS';
export const SETUP_GROUPS: readonly SetupGroup[] = ['SETS', 'LIGHTS'];

/** The filters of the two groups, by id: Sets' product type and subject, Lights' style. */
export type SetupFilterId = 'type' | 'hero' | 'style';

/** The subjects a set is designed for, in the order of their chips. */
export const SET_HEROES: readonly SetHero[] = ['BOTTLE', 'BOX', 'RING', 'CHROME', 'SHOE', 'SPHERES'];

/** A row of chips: its id and the values it offers (the interface names them). */
export interface SetupFilter {
  id: SetupFilterId;
  values: readonly string[];
}

/** The filters each group offers, in the order of their rows. */
export function groupFilters(group: SetupGroup): readonly SetupFilter[] {
  if (group === 'SETS') {
    return [
      { id: 'type', values: STUDIO_PRESETS.map((p) => p.key) },
      { id: 'hero', values: SET_HEROES },
    ];
  }
  return [{ id: 'style', values: LIGHT_STYLES.filter((s) => s.key !== 'SETS').map((s) => s.key) }];
}

/** The set the product type's own rig (setup PRESET) puts in force, when it is one that dresses the scene. */
function typeSet(preset: PresetRef): LightSetup | undefined {
  const own = resolvePreset(preset)?.set;
  const set = own ? setOf(own) : undefined;
  return set && hasDecoration(set) ? set : undefined;
}

/**
 * The group of a catalogue entry, from what applying it does (core/sets.ts): an entry that brings decoration (a
 * backdrop, a floor, a pool or cards: `hasDecoration`) is a Set; any other is Lights. The product type's own rig
 * (PRESET) is the set of the type in force when that type is one (15 of the 16), and Lights otherwise (Outdoor furniture
 * keeps its sun). An unknown key is Lights.
 */
export function setupGroup(key: string, preset: PresetRef): SetupGroup {
  if (key === 'PRESET') return typeSet(preset) ? 'SETS' : 'LIGHTS';
  const setup = lightSetup(key);
  return setup && hasDecoration(setup) ? 'SETS' : 'LIGHTS';
}

/** The entries of a group, in catalogue order. */
export function setupsInGroup(group: SetupGroup, preset: PresetRef): LightSetup[] {
  return LIGHT_SETUPS.filter((s) => setupGroup(s.key, preset) === group);
}

/** What an entry is for each filter (several values for a product type: two types can share a set). */
export function setupTags(setup: LightSetup, preset: PresetRef): Partial<Record<SetupFilterId, readonly string[]>> {
  if (setup.key === 'PRESET') {
    const set = typeSet(preset);
    const type = resolvePreset(preset)?.key;
    if (set) return { type: type ? [type] : [], hero: set.hero ? [set.hero] : [] };
    return { style: [setup.style] };
  }
  if (setupGroup(setup.key, preset) === 'SETS') {
    return { type: STUDIO_PRESETS.filter((p) => p.set === setup.key).map((p) => p.key), hero: setup.hero ? [setup.hero] : [] };
  }
  return { style: [setup.style] };
}

/** The filters that narrow a group: of `chosen`, only those the group offers, with a value they offer (anything else is All). */
export function activeSetupFilters(group: SetupGroup, chosen: Readonly<Record<string, string | undefined>>): Partial<Record<SetupFilterId, string>> {
  const out: Partial<Record<SetupFilterId, string>> = {};
  for (const f of groupFilters(group)) {
    const v = chosen[f.id];
    if (v !== undefined && f.values.includes(v)) out[f.id] = v;
  }
  return out;
}

/** An entry is one the filters ask for: every chosen filter is a value it has (they combine: AND). */
export function setupMatches(setup: LightSetup, filters: Partial<Record<SetupFilterId, string>>, preset: PresetRef): boolean {
  const tags = setupTags(setup, preset);
  for (const [id, v] of Object.entries(filters) as [SetupFilterId, string][]) if (!tags[id]?.includes(v)) return false;
  return true;
}

/**
 * The entries of a group the filters leave, in catalogue order, and how many of the group that is ("3 of 17"). The
 * entry in force stays in view when it is of the group but the filters leave it out: `kept` is it (drawn first and
 * marked outside them, as a plugin's chosen recipe is).
 */
export function filterSetups(
  group: SetupGroup,
  chosen: Readonly<Record<string, string | undefined>>,
  preset: PresetRef,
  active: string | null = null,
): { shown: LightSetup[]; kept: LightSetup | null; count: number; total: number } {
  const all = setupsInGroup(group, preset);
  const f = activeSetupFilters(group, chosen);
  const shown = all.filter((s) => setupMatches(s, f, preset));
  const a = active === null ? null : (all.find((s) => s.key === active) ?? null);
  return { shown, kept: a && !shown.includes(a) ? a : null, count: shown.length, total: all.length };
}

/** The style a Lights entry is filed under (for the URL and the scene type), or null for a Set. */
export function lightsStyleOf(key: string, preset: PresetRef): LightStyle | null {
  const s = lightSetup(key);
  return s && setupGroup(key, preset) === 'LIGHTS' ? s.style : null;
}

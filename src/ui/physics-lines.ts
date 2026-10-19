// The sentences of U16 (UI.md §2.4 Physics and §2.5 the physics bar), without the DOM so that they are tested in Node:
// what a role does, the size past which a part's drops run, the label of *From the material*, the note when no effect
// falls on the parts and the effect its button shows, the pointer of the Material section, and what ▶ Start simulates.
// Every number in them is the model's (core/part-weather.ts, core/start-plan.ts), never one of the page's (rule 10).

import { PARTS_FEED } from '../data/wet-parts';
import { effectPreset } from '../data/effects';
import { wettability, type WettabilityFamily } from '../data/wettability';
import type { AmbientEffect } from '../core/effects';
import { roleOf, type PhysicsRole } from '../core/physics';
import { partWeatherOf, runSizeMm, surfaceFamily, weatherView, type WeatherView } from '../core/part-weather';
import type { NodeId } from '../core/scene';
import type { StartPlan } from '../core/start-plan';
import type { ProjectState } from '../core/store';
import { dyn } from './names';
import { formatNumber, getLang, lbl, t, type StringKey } from './strings';

/** A family's name. */
export function familyName(family: WettabilityFamily): string {
  return lbl(wettability(family).label);
}

/** The role every node has, or null when they differ. */
export function selectionRole(s: ProjectState, ids: readonly NodeId[]): PhysicsRole | null {
  const roles = new Set(ids.map((id) => roleOf(s.scene.nodes[id])));
  return roles.size === 1 ? [...roles][0] : null;
}

/** What the role of the selection does, in one line (mixed: how to give one to all). */
export function roleLine(s: ProjectState, ids: readonly NodeId[]): string {
  return t(dyn(`phys.roleLine.${selectionRole(s, ids) ?? 'MIXED'}`));
}

/** The label of *From the material*: the family its material gives, or *each part's* when they differ. */
export function surfaceAutoLabel(v: WeatherView): string {
  return v.materialFamilies.length === 1 ? t('phys.surfaceAuto', { family: familyName(v.materialFamilies[0]) }) : t('phys.surfaceAutoMixed');
}

/** The size past which the drops of the parts that get wet run down a vertical face (or that they keep dry). */
export function runSizeLine(s: ProjectState, ids: readonly NodeId[]): string {
  const v = weatherView(s, ids);
  const wetting = v.parts.filter((p) => partWeatherOf(s.scene.nodes[p]).getsWet);
  const sizes = [...new Set(wetting.map((p) => surfaceFamily(s, p)))].map((f) => runSizeMm(f));
  if (sizes.length === 0) return t('phys.runSizeDry');
  const mm = (x: number) => formatNumber(x, getLang(), 1);
  const lo = mm(Math.min(...sizes));
  const hi = mm(Math.max(...sizes));
  return lo === hi ? t('phys.runSize', { mm: lo }) : t('phys.runSizeRange', { min: lo, max: hi });
}

/** The name an effect shows: its own, or its preset's. */
function effectLabel(e: AmbientEffect): string {
  return e.name || lbl(effectPreset(e.preset)?.label ?? { en: e.preset, es: e.preset });
}

/**
 * The note of Physics ▸ Weather when no effect of the scene has *On the parts* on: its text, its button and the effect
 * the button shows (the first that can leave something on the parts; none: the button opens Ambient). Null otherwise.
 */
export function noWeatherNote(s: ProjectState): { text: string; button: string; effect: string | null } | null {
  if (s.effects.some((e) => e.wetParts === true && PARTS_FEED[e.preset] !== null)) return null;
  const can = s.effects.find((e) => PARTS_FEED[e.preset] !== null);
  return can
    ? { text: t('phys.noWeather'), button: t('phys.editEffect', { name: effectLabel(can) }), effect: can.id }
    : { text: t('phys.noWeatherNone'), button: t('phys.openAmbient'), effect: null };
}

/** The pointer of the Material section: *Physics: Static · gets wet as Paint*. */
export function pointerLine(s: ProjectState, ids: readonly NodeId[]): string {
  const r = selectionRole(s, ids);
  const role = r ? t(dyn(`phys.role.${r}`)) : t('phys.pointerRoleMixed');
  const v = weatherView(s, ids);
  let weather: string;
  if (v.getsWet === false) weather = t('phys.pointerDry');
  else if (v.getsWet === null) weather = t('phys.pointerSomeDry');
  else {
    const families = [...new Set(v.parts.map((p) => surfaceFamily(s, p)))];
    weather = families.length === 1 ? t('phys.pointerWet', { family: familyName(families[0]) }) : t('phys.pointerWetMixed');
  }
  return t('phys.pointer', { role, weather });
}

function counted(base: string, n: number, zero = false): string {
  if (n === 0 && zero) return t(dyn(`${base}.none`));
  return n === 1 ? t(dyn(`${base}.one`)) : t(dyn(`${base}.many`), { n: formatNumber(n, getLang(), 0) });
}

/** What ▶ Start simulates, in one line: *Start simulates: 2 dynamic parts · rain on 5 parts (1 stays dry) · the front glass*. */
export function planLine(p: StartPlan): string {
  const items: string[] = [];
  if (p.dynamicParts > 0) items.push(counted('phys.plan.dynamic', p.dynamicParts));
  if (p.rain) items.push(counted('phys.plan.rain', p.rain.parts, true) + (p.rain.dry > 0 ? ` (${counted('phys.plan.dry', p.rain.dry)})` : ''));
  if (p.settle) {
    const what: StringKey = p.settle.dust && p.settle.snow ? 'phys.plan.dustSnow.many' : p.settle.dust ? 'phys.plan.dust.many' : 'phys.plan.snow.many';
    items.push(counted(what.replace(/\.many$/, ''), p.settle.parts, true) + (p.settle.bare > 0 ? ` (${counted('phys.plan.bare', p.settle.bare)})` : ''));
  }
  if (p.glass) items.push(t('phys.plan.glass'));
  return items.length === 0 ? t('phys.plan.nothing') : t('phys.plan', { items: items.join(' · ') });
}

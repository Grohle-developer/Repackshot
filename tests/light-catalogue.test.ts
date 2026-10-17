// Phase L7: the light catalogue in two groups, Sets and Lights, classified by what applying an entry does; the filters
// of each group (product type and subject for Sets, style for Lights), combined; what a setup does with the lights there
// are (Replace, Hide, Add: one undo step each, the hidden ones restorable); old projects open as they were; the
// remembered choice and the thumbnail size persist.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { typeLightsUntouched } from '../src/core/lighting';
import { previousLights, reducePrevious } from '../src/core/previous-lights';
import { activeSetupFilters, filterSetups, groupFilters, setupGroup, setupsInGroup, setupTags } from '../src/core/setup-groups';
import { defaultLayout, validateLayout, validateSettings } from '../src/core/settings';
import { setPieceIds } from '../src/core/sets';
import { createStore, reduce, type ProjectState } from '../src/core/store';
import { LIGHT_SETUPS } from '../src/data/light-setups';
import { STUDIO_PRESETS } from '../src/data/studios';
import { loadProject, serializeProject } from '../src/io/project';
import * as cmd from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { createUiStore } from '../src/ui/ui-state';
import { exampleState } from './helpers';

const SET_KEYS = [
  'STRIP_EDGE',
  'GLASS_DARK_FIELD',
  'BRIGHT_FIELD',
  'HIGH_KEY_WHITE',
  'JEWEL_BOX',
  'CHROME_FAMILY',
  'RAKING_TEXTURE',
  'BLACK_ON_BLACK',
  'WARM_WINDOW',
  'BACKLIT_LIQUID',
  'WARM_COOL_CINEMA',
  'POP_COLOR',
  'GRADIENT_POOL',
  'MIRROR_FLOOR',
  'FLAT_LAY',
  'SILHOUETTE_GLOW',
];
const INTERIOR = ['INT_WINDOW_MORNING', 'INT_WINDOW_NOON', 'INT_WINDOW_AFTERNOON', 'INT_OVERCAST', 'INT_NIGHT_LAMPS', 'INT_BLUE_HOUR', 'INT_WHITE_ROOM'];

const keys = (list: readonly { key: string }[]) => list.map((s) => s.key);
const setSetup = (state: ProjectState, key: string, previous?: 'REPLACE' | 'HIDE' | 'ADD') => reduce(state, { type: 'studio/setSetup', key, ...(previous ? { previous } : {}) });
/** The example with a setup that dresses nothing in force, so what an entry brings is what it adds. */
const bare = (): ProjectState => setSetup(exampleState(), 'KEY_ONLY');
const decoration = (s: ProjectState) => setPieceIds(s).length + s.studio.lights.filter((l) => l.setPiece).length;

describe('L7: Sets and Lights, classified by what an entry does', () => {
  it('pins the counts: 17 Sets (the 16 of L6 and the product type’s own rig) and 78 Lights with a type that is a set', () => {
    const sets = setupsInGroup('SETS', 'GENERIC');
    const lights = setupsInGroup('LIGHTS', 'GENERIC');
    expect(keys(sets)).toEqual([...SET_KEYS, 'PRESET']);
    expect(lights).toHaveLength(78);
    expect(sets.length + lights.length).toBe(LIGHT_SETUPS.length);
    // Every Interior recipe is Lights: it chooses a world and an exposure but dresses nothing.
    for (const k of INTERIOR) expect(setupGroup(k, 'GENERIC'), k).toBe('LIGHTS');
    // The sun setups of Cinematic change the world too, and are Lights.
    for (const k of ['SUN', 'GOLDEN_HOUR', 'DAWN']) expect(setupGroup(k, 'GENERIC'), k).toBe('LIGHTS');
  });

  it('the product type’s own rig is a Set for the 15 types that are one, and Lights for Outdoor furniture (its sun)', () => {
    for (const p of STUDIO_PRESETS) {
      const group = setupGroup('PRESET', p.key);
      expect(group, p.key).toBe(p.set ? 'SETS' : 'LIGHTS');
      expect(setupsInGroup('SETS', p.key), p.key).toHaveLength(p.set ? 17 : 16);
      expect(setupsInGroup('LIGHTS', p.key), p.key).toHaveLength(p.set ? 78 : 79);
    }
    expect(STUDIO_PRESETS.filter((p) => !p.set).map((p) => p.key)).toEqual(['FURNITURE_OUT']);
  });

  it('agrees with what applying each entry does: a Set puts decoration in the scene, Lights never do', () => {
    for (const type of ['GENERIC', 'FURNITURE_OUT']) {
      const base = reduce(bare(), { type: 'studio/setPreset', key: type });
      expect(decoration(base)).toBe(0);
      for (const st of LIGHT_SETUPS) {
        const next = setSetup(base, st.key);
        expect(decoration(next) > 0, `${type} ${st.key}`).toBe(setupGroup(st.key, type) === 'SETS');
      }
    }
  });
});

describe('L7: the filters of each group, combined', () => {
  it('Sets filter by product type and subject, Lights by style; anything else is All', () => {
    expect(groupFilters('SETS').map((f) => f.id)).toEqual(['type', 'hero']);
    expect(groupFilters('SETS')[0].values).toEqual(STUDIO_PRESETS.map((p) => p.key));
    expect(groupFilters('LIGHTS').map((f) => f.id)).toEqual(['style']);
    expect(groupFilters('LIGHTS')[0].values).not.toContain('SETS');
    expect(activeSetupFilters('SETS', { type: 'JEWELLERY', style: 'CINEMATIC', hero: 'NOPE' })).toEqual({ type: 'JEWELLERY' });
    expect(activeSetupFilters('LIGHTS', { style: 'SETS' })).toEqual({});
  });

  it('a product type shows the set its own rig is (and the own rig of the type in force)', () => {
    expect(keys(filterSetups('SETS', { type: 'JEWELLERY' }, 'GENERIC').shown)).toEqual(['JEWEL_BOX']);
    expect(keys(filterSetups('SETS', { type: 'JEWELLERY' }, 'JEWELLERY').shown)).toEqual(['JEWEL_BOX', 'PRESET']);
    expect(keys(filterSetups('SETS', { type: 'WATCH' }, 'GENERIC').shown)).toEqual(['CHROME_FAMILY']);
    expect(keys(filterSetups('SETS', { type: 'GENERIC' }, 'GENERIC').shown)).toEqual(['GRADIENT_POOL', 'PRESET']);
    // Outdoor furniture keeps its sun: no set, an empty result.
    const none = filterSetups('SETS', { type: 'FURNITURE_OUT' }, 'GENERIC');
    expect(none).toMatchObject({ count: 0, total: 17 });
    // Two types can share a set.
    expect(setupTags(LIGHT_SETUPS.find((s) => s.key === 'CHROME_FAMILY')!, 'GENERIC').type).toEqual(['WATCH', 'AUTOMOTIVE', 'TOOL']);
  });

  it('the filters combine (AND), and the entry in force stays in view, marked outside them', () => {
    const bottles = filterSetups('SETS', { hero: 'BOTTLE' }, 'GENERIC');
    expect(keys(bottles.shown)).toEqual(['STRIP_EDGE', 'GLASS_DARK_FIELD', 'BRIGHT_FIELD', 'BACKLIT_LIQUID', 'WARM_COOL_CINEMA', 'MIRROR_FLOOR', 'SILHOUETTE_GLOW']);
    expect(keys(filterSetups('SETS', { hero: 'BOTTLE', type: 'PERFUME' }, 'GENERIC').shown)).toEqual(['STRIP_EDGE']);
    expect(filterSetups('SETS', { hero: 'BOTTLE', type: 'JEWELLERY' }, 'GENERIC').count).toBe(0);
    const kept = filterSetups('SETS', { hero: 'BOTTLE' }, 'GENERIC', 'JEWEL_BOX');
    expect(kept.kept?.key).toBe('JEWEL_BOX');
    expect(kept.shown).not.toContain(kept.kept);
    // In force but of the other group: not kept in this one.
    expect(filterSetups('SETS', { hero: 'BOTTLE' }, 'GENERIC', 'REMBRANDT').kept).toBeNull();
    expect(keys(filterSetups('LIGHTS', { style: 'INTERIOR' }, 'GENERIC').shown)).toEqual(INTERIOR);
    expect(filterSetups('LIGHTS', { style: 'PRODUCT' }, 'GENERIC').count).toBe(11);
    expect(filterSetups('LIGHTS', { style: 'PRODUCT' }, 'FURNITURE_OUT').count).toBe(12);
  });
});

describe('L7: Replace, Hide or Add the lights there are', () => {
  it('Replace is what choosing a setup always did; without lights before, Hide and Add change nothing either', () => {
    const s0 = bare();
    expect(setSetup(s0, 'REMBRANDT', 'REPLACE')).toEqual(setSetup(s0, 'REMBRANDT'));
    const dark = { ...s0, studio: { ...s0.studio, lights: [] } };
    expect(reducePrevious(dark, { type: 'studio/setSetup', key: 'REMBRANDT', previous: 'ADD' })).toBeNull();
    expect(setSetup(dark, 'REMBRANDT', 'HIDE')).toEqual(setSetup(dark, 'REMBRANDT'));
  });

  it('Hide keeps the lights switched off and own, named where they came from; each one can be turned back on', () => {
    const s0 = bare();
    const before = previousLights(s0);
    const next = reduce(s0, { type: 'studio/setSetup', key: 'REMBRANDT', previous: 'HIDE', keptNames: { [before[0].id]: 'Key · Key only' } });
    const fresh = setSetup(s0, 'REMBRANDT').studio.lights;
    expect(next.studio.lightSetup).toBe('REMBRANDT');
    expect(next.studio.lights).toHaveLength(fresh.length + before.length);
    const kept = next.studio.lights.slice(fresh.length);
    expect(kept.map((l) => l.enabled)).toEqual(before.map(() => false));
    expect(kept.every((l) => l.own)).toBe(true);
    expect(kept[0].name).toBe('Key · Key only');
    expect(kept.map((l) => l.id)).toEqual(before.map((l) => l.id));
    expect(new Set(next.studio.lights.map((l) => l.id)).size).toBe(next.studio.lights.length);
    expect(next.studio.modified).toBe(true);
    // The new setup's lights are its own, as Replace puts them (other ids where the kept ones hold theirs).
    expect(next.studio.lights.slice(0, fresh.length).map(({ id: _id, ...l }) => l)).toEqual(fresh.map(({ id: _id, ...l }) => l));
    // A switch of the Lights list turns a hidden one back on.
    const on = reduce(next, { type: 'studio/setLight', id: kept[0].id, patch: { enabled: true } });
    expect(on.studio.lights.find((l) => l.id === kept[0].id)?.enabled).toBe(true);
  });

  it('Add keeps them as they were (on stays on, off stays off) and adds the new ones', () => {
    const s0 = bare();
    const off = reduce(s0, { type: 'studio/setLight', id: s0.studio.lights[0].id, patch: { enabled: false } });
    const two = reduce(off, { type: 'studio/addLight', kind: 'SPOT' });
    const before = previousLights(two);
    const next = setSetup(two, 'REMBRANDT', 'ADD');
    const kept = next.studio.lights.filter((l) => before.some((b) => b.id === l.id));
    expect(kept.map((l) => l.enabled)).toEqual(before.map((l) => l.enabled));
    expect(next.studio.lights.length).toBe(setSetup(two, 'REMBRANDT').studio.lights.length + before.length);
  });

  it('each choice is one undo step named after it, and undo gives back the lights as they were', () => {
    for (const mode of ['REPLACE', 'HIDE', 'ADD'] as const) {
      const store = createStore(bare());
      const start = store.get();
      store.dispatch({ type: 'studio/setSetup', key: 'REMBRANDT', previous: mode, label: { en: `Light setup: Rembrandt (${mode})`, es: '' } });
      expect(store.history().undo[0]).toBe(`Light setup: Rembrandt (${mode})`);
      expect(store.history().undo).toHaveLength(1);
      store.undo();
      expect(store.get().studio).toEqual(start.studio);
    }
  });

  it('a Set replaces the decoration in force whatever the choice; Lights with Hide or Add leave it, Replace takes it away', () => {
    const s0 = setSetup(bare(), 'JEWEL_BOX');
    const pieces = setPieceIds(s0).length;
    expect(pieces).toBeGreaterThan(0);
    for (const mode of ['HIDE', 'ADD'] as const) {
      const other = setSetup(s0, 'GLASS_DARK_FIELD', mode);
      expect(setPieceIds(other).map((id) => other.scene.nodes[id].name)).toEqual(setPieceIds(setSetup(s0, 'GLASS_DARK_FIELD')).map((id) => other.scene.nodes[id].name));
      // The jewel box's lights are kept (its pool is decoration: it went with it).
      expect(other.studio.lights.filter((l) => l.own)).toHaveLength(previousLights(s0).length);
      const lights = setSetup(s0, 'REMBRANDT', mode);
      expect(setPieceIds(lights)).toEqual(setPieceIds(s0));
      expect(lights.studio.lights.filter((l) => l.setPiece)).toEqual(s0.studio.lights.filter((l) => l.setPiece));
      expect(lights.image.exposureEv).toBe(s0.image.exposureEv);
      // An Interior recipe brings its look over the set's, and its decoration stays too.
      const interior = setSetup(s0, 'INT_OVERCAST', mode);
      expect(setPieceIds(interior)).toEqual(setPieceIds(s0));
      expect(interior.environment.strength).toBe(0.8);
      expect(new Set(interior.studio.lights.map((l) => l.id)).size).toBe(interior.studio.lights.length);
    }
    expect(setPieceIds(setSetup(s0, 'REMBRANDT', 'REPLACE'))).toEqual([]);
  });

  it('an own setup of the library takes the choice too', () => {
    const s0 = bare();
    const setup = { key: 'LIB:mine', name: 'Mine', world: 'STUDIO' as const, lights: [{ role: 'KEY' as const, size: 1, sizeY: 1, az: 0, el: 30, dist: 3, share: 1 }] };
    const next = reduce(s0, { type: 'studio/applySetup', setup, previous: 'HIDE' });
    expect(next.studio.lightSetup).toBe('LIB:mine');
    expect(next.studio.lights.filter((l) => !l.enabled)).toHaveLength(previousLights(s0).length);
  });
});

describe('L7: what the interface asks, and what it remembers', () => {
  const makeCtx = (state = bare()): Ctx => ({ store: createStore(state), ui: createUiStore(), services: {} as AppServices });

  it('asks Replace, Hide or Add over lights; Remember my choice keeps the answer in Settings', () => {
    const ctx = makeCtx();
    const spec = cmd.requestSetup(ctx, 'REMBRANDT');
    expect(spec?.options.map((o) => o.label)).toEqual(['Replace', 'Hide', 'Add']);
    expect(spec?.remember).toBe('Remember my choice');
    spec!.options[1].run(true);
    expect(ctx.ui.get().settings['light.previous']).toBe('HIDE');
    expect(ctx.store.history().undo[0]).toBe('Light setup: Rembrandt (hide the lights there were)');
    // Remembered: the next one does not ask.
    expect(cmd.requestSetup(ctx, 'LOOP')).toBeNull();
    expect(ctx.store.get().studio.lightSetup).toBe('LOOP');
    expect(ctx.store.history().undo[0]).toBe('Light setup: Loop (hide the lights there were)');
    // The kept lights are named after the setup they came from.
    expect(ctx.store.get().studio.lights.filter((l) => l.own).map((l) => l.name)).toContain('Key · Rembrandt');
  });

  it('does not ask without lights, nor for the setup in force', () => {
    const s = bare();
    const ctx = makeCtx({ ...s, studio: { ...s.studio, lights: [] } });
    expect(cmd.requestSetup(ctx, 'REMBRANDT')).toBeNull();
    expect(ctx.store.history().undo[0]).toBe('Light setup: Rembrandt');
    expect(cmd.requestSetup(ctx, 'REMBRANDT')).toBeNull();
  });

  it('C1: over the product type’s own lights, untouched, it does not ask: they are replaced, whatever was remembered', () => {
    for (const remembered of ['ASK', 'HIDE', 'ADD'] as const) {
      const ctx = makeCtx(exampleState());
      ctx.ui.set({ settings: { ...ctx.ui.get().settings, 'light.previous': remembered } });
      expect(typeLightsUntouched(ctx.store.get())).toBe(true);
      expect(cmd.requestSetup(ctx, 'REMBRANDT'), remembered).toBeNull();
      const s = ctx.store.get();
      expect(s.studio.lightSetup).toBe('REMBRANDT');
      // Replaced: none of the type's lights was kept.
      expect(s.studio.lights.some((l) => l.own)).toBe(false);
      expect(ctx.store.history().undo[0]).toBe('Light setup: Rembrandt');
    }
    // A Set too, and the type's own rig dressed as its set (the pool's spot is decoration, not a light of the person's).
    const dressed = makeCtx(reduce(exampleState(), { type: 'studio/fitSet' }));
    expect(dressed.store.get().studio.lights.some((l) => l.setPiece)).toBe(true);
    expect(cmd.requestSetup(dressed, 'JEWEL_BOX')).toBeNull();
    expect(dressed.store.get().studio.lightSetup).toBe('JEWEL_BOX');
  });

  it('C1: it asks again once a light is added, edited, placed or deleted, or another setup is in force', () => {
    const touched = [
      reduce(exampleState(), { type: 'studio/addLight', kind: 'POINT' }),
      reduce(exampleState(), { type: 'studio/setLight', id: 'l1', patch: { enabled: false } }),
      reduce(exampleState(), { type: 'studio/deleteLight', id: 'l2' }),
      reduce(exampleState(), { type: 'studio/duplicateLight', id: 'l1' }),
      setSetup(exampleState(), 'LOOP'),
      // A type chosen without making the studio again: the lights there are the previous type's.
      reduce(exampleState(), { type: 'studio/setPreset', key: 'JEWELLERY' }),
    ];
    for (const s of touched) {
      expect(typeLightsUntouched(s)).toBe(false);
      expect(cmd.requestSetup(makeCtx(s), 'REMBRANDT')?.options.map((o) => o.label)).toEqual(['Replace', 'Hide', 'Add']);
    }
    // Reset setup, or the type's own rig chosen again, makes them the type's untouched lights again.
    const reset = reduce(touched[0], { type: 'studio/resetLights' });
    expect(typeLightsUntouched(reset)).toBe(true);
    expect(typeLightsUntouched(setSetup(touched[4], 'PRESET'))).toBe(true);
    expect(cmd.requestSetup(makeCtx(reset), 'REMBRANDT')).toBeNull();
  });

  it('the setting is checked, and a document of before L7 opens the group its style was in', () => {
    expect(validateSettings({ 'light.previous': 'ADD' })['light.previous']).toBe('ADD');
    expect(validateSettings({ 'light.previous': 'DELETE' })['light.previous']).toBe('ASK');
    expect(defaultLayout()).toMatchObject({ lightGroup: 'SETS', lightFilters: {}, thumbSize: 'M' });
    expect(validateLayout({ lightStyle: 'SETS' })).toMatchObject({ lightGroup: 'SETS', lightStyle: 'ALL' });
    expect(validateLayout({ lightStyle: 'ALL' })).toMatchObject({ lightGroup: 'SETS', lightStyle: 'ALL' });
    expect(validateLayout({ lightStyle: 'CINEMATIC' })).toMatchObject({ lightGroup: 'LIGHTS', lightStyle: 'CINEMATIC' });
    expect(validateLayout({ lightStyle: 'MINE', lightGroup: 'SETS' })).toMatchObject({ lightGroup: 'SETS', lightStyle: 'MINE' });
    expect(validateLayout({ thumbSize: 'XL', lightFilters: { type: 'JEWELLERY', hero: 3 } })).toMatchObject({ thumbSize: 'M', lightFilters: { type: 'JEWELLERY' } });
  });

  it('the thumbnail size, the group and the filters persist per viewer (the remembered layout)', () => {
    const saved: Record<string, unknown>[] = [];
    const ui = createUiStore({}, { layout: validateLayout({ thumbSize: 'L', lightGroup: 'LIGHTS', lightStyle: 'SPICY' }), onLayout: (p) => saved.push(p) });
    expect(ui.get()).toMatchObject({ thumbSize: 'L', lightGroup: 'LIGHTS', lightStyle: 'SPICY' });
    ui.set({ thumbSize: 'S' });
    ui.set({ lightFilters: { hero: 'RING' } });
    // A style of Sets asked for (a URL of before) is the Sets group.
    ui.set({ lightStyle: 'SETS' });
    expect(ui.get()).toMatchObject({ lightGroup: 'SETS', lightStyle: 'ALL' });
    expect(saved).toEqual([{ thumbSize: 'S' }, { lightFilters: { hero: 'RING' } }, { lightStyle: 'ALL', lightGroup: 'SETS' }]);
  });

  it('shows a chosen setup in its group (the URL, the scene type)', () => {
    const ctx = makeCtx();
    ctx.ui.set({ lightFilters: { hero: 'RING' } });
    cmd.revealSetup(ctx, 'STRIP_EDGE');
    expect(ctx.ui.get()).toMatchObject({ lightGroup: 'SETS', lightFilters: {} });
    cmd.revealSetup(ctx, 'NEON_NOIR');
    expect(ctx.ui.get()).toMatchObject({ lightGroup: 'LIGHTS', lightStyle: 'CINEMATIC' });
    cmd.setSceneType(ctx, 'INTERIOR');
    expect(ctx.ui.get()).toMatchObject({ lightGroup: 'LIGHTS', lightStyle: 'INTERIOR' });
  });
});

describe('L7: old projects open unchanged', () => {
  it('a file of before keeps its lights as they were (no field added, switches as saved)', () => {
    for (const name of ['project-v1.json', 'project-v2.json']) {
      const text = readFileSync(`tests/fixtures/${name}`, 'utf8');
      const raw = JSON.parse(text).state.studio.lights;
      const state = loadProject(text).state;
      expect(state.studio.lights, name).toEqual(raw);
    }
  });

  it('a project with lights kept by Hide and Add saves and opens as it was', async () => {
    const s = setSetup(setSetup(bare(), 'REMBRANDT', 'HIDE'), 'LOOP', 'ADD');
    const back = loadProject(await serializeProject(s).text()).state;
    expect(back.studio.lights).toEqual(s.studio.lights);
    expect(back.studio.lights.filter((l) => !l.enabled).length).toBeGreaterThan(0);
  });
});

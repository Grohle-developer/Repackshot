// Phase U4: the user's library, as the model sees it. Items are made from what is on screen, applied back to a
// project through the store, and survive the deletion of their library entry. The JSON file and the browser
// storage are in io-library.test.ts; the interface (inline name fields, Mine tabs) is checked in the browser.

import { describe, expect, it } from 'vitest';
import { exportLibrary, importLibrary } from '../src/io/library';
import * as cmd from '../src/ui/commands';
import { paletteItems, rank } from '../src/ui/components/palette';
import type { AppServices, ViewportPort } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang, t } from '../src/ui/strings';
import { studioLabel, thumbKey } from '../src/ui/names';
import { createUiStore } from '../src/ui/ui-state';
import { CAMERA_AZIMUTH_DEG, LIGHT_SETUPS } from '../src/data/light-setups';
import { STUDIO_PRESETS, studioPreset } from '../src/data/studios';
import { activeCamera } from '../src/core/camera';
import {
  addItem,
  allItems,
  applyLibrarySetup,
  customSetupOf,
  emptyLibrary,
  findItem,
  fromCurrentProductType,
  fromCurrentRig,
  fromCurrentStudio,
  fromMaterialInstance,
  instanceFromItem,
  itemsOf,
  libraryIsEmpty,
  migrateSavedStudios,
  newItemId,
  presetOfItem,
  removeItem,
  renameItem,
  savedStudioOf,
  uniqueName,
  type Library,
} from '../src/core/library';
import { isLibraryKey, libraryKey, lightIrradiance, lightShares } from '../src/core/lighting';
import { assignAction, partMaterials } from '../src/core/materials';
import { presetIrradiance, rigIrradiance } from '../src/core/rig';
import { createInitialState, createStore } from '../src/core/store';
import { apply, exampleState, keyIds } from './helpers';

const NOW = 1_700_000_000_000;

/** Total irradiance of the lights of a state, in the unit of `presetIrradiance`. */
const total = (s: ReturnType<typeof exampleState>) => s.studio.lights.reduce((a, l) => a + lightIrradiance(l), 0);

describe('names, ids and the collections', () => {
  it('makes a name unique among the others, counting from 2 and replacing a trailing number', () => {
    expect(uniqueName('Gold', [])).toBe('Gold');
    expect(uniqueName('Gold', ['Gold'])).toBe('Gold 2');
    expect(uniqueName('gold', ['Gold', 'Gold 2'])).toBe('gold 3');
    expect(uniqueName('Gold 2', ['Gold', 'Gold 2'])).toBe('Gold 3');
    expect(uniqueName('  Gold  ', ['gold'])).toBe('Gold 2');
  });

  it('adds items in order, with unique names per kind and unique ids overall', () => {
    const s = exampleState();
    const inst = s.materials[s.scene.nodes[keyIds(s).cap].material!];
    let lib = emptyLibrary();
    const a = fromMaterialInstance(lib, inst, 'My gold', { now: NOW, id: 'mat-a' });
    lib = addItem(lib, a);
    // The same name again gets a suffix; the same id again gets a fresh one.
    lib = addItem(lib, { ...a, name: 'My gold' });
    expect(itemsOf(lib, 'material').map((m) => m.name)).toEqual(['My gold', 'My gold 2']);
    const ids = itemsOf(lib, 'material').map((m) => m.id);
    expect(ids[0]).toBe('mat-a');
    expect(new Set(ids).size).toBe(2);
    // A name with nothing usable adds nothing.
    expect(addItem(lib, { ...a, id: 'mat-z', name: '   ' })).toBe(lib);
    expect(libraryIsEmpty(lib)).toBe(false);
    expect(libraryIsEmpty(emptyLibrary())).toBe(true);
  });

  it('newItemId never repeats an id of the library', () => {
    const lib = addItem(emptyLibrary(), fromMaterialInstance(emptyLibrary(), exampleState().materials[Object.keys(exampleState().materials)[0]], 'A', { now: NOW, id: 'mat-1' }));
    const id = newItemId('material', lib, NOW, () => 0);
    expect(allItems(lib).some((i) => i.id === id)).toBe(false);
    const clash = newItemId('material', { ...emptyLibrary(), materials: [{ ...itemsOf(lib, 'material')[0], id: `mat-${NOW.toString(36)}0000` }] }, NOW, () => 0);
    expect(clash).not.toBe(`mat-${NOW.toString(36)}0000`);
  });
});

describe('saving a material', () => {
  it('captures the edited parameters of an instance, not the preset it started from', () => {
    let s = exampleState();
    const ids = keyIds(s);
    const capMat = s.scene.nodes[ids.cap].material!;
    s = apply(s, { type: 'material/setParam', id: capMat, key: 'roughness', value: 0.42 }, { type: 'material/setParam', id: capMat, key: 'baseColor', value: [0.9, 0.1, 0.2, 1] });
    const item = fromMaterialInstance(emptyLibrary(), s.materials[capMat], 'My gold', { now: NOW, id: 'mat-a', thumb: 'data:image/png;base64,AAAA' });
    expect(item.material.params.roughness).toBe(0.42);
    expect(item.material.params.baseColor).toEqual([0.9, 0.1, 0.2, 1]);
    // The factory key it came from stays as `source`.
    expect(item.source).toBe('GOLD');
    expect(item).toMatchObject({ kind: 'material', name: 'My gold', createdAt: NOW, thumb: 'data:image/png;base64,AAAA' });
    expect(item.material.family).toBe(s.materials[capMat].family);
    // The item shares nothing with the instance: editing the project does not edit the library.
    expect(item.material.params).not.toBe(s.materials[capMat].params);
    const later = apply(s, { type: 'material/setParam', id: capMat, key: 'roughness', value: 0.9 });
    expect(later.materials[capMat].params.roughness).toBe(0.9);
    expect(item.material.params.roughness).toBe(0.42);
  });

  it('a factory material saved unedited keeps its preset as source', () => {
    const s = exampleState();
    const capMat = s.scene.nodes[keyIds(s).cap].material!;
    expect(fromMaterialInstance(emptyLibrary(), s.materials[capMat], 'Gold', { id: 'x' }).source).toBe('GOLD');
  });

  it('assigns a library material to parts: one shared instance, named and linked to the item', () => {
    let s = exampleState();
    const ids = keyIds(s);
    const capMat = s.scene.nodes[ids.cap].material!;
    s = apply(s, { type: 'material/setParam', id: capMat, key: 'roughness', value: 0.42 });
    const item = fromMaterialInstance(emptyLibrary(), s.materials[capMat], 'My gold', { now: NOW, id: 'mat-a' });
    const src = { id: item.id, instance: instanceFromItem(item) };
    s = apply(s, assignAction(s, { library: src }, 'REPLACE', [ids.body]), assignAction(s, { library: src }, 'REPLACE', [ids.closure]));
    const bodyMat = s.scene.nodes[ids.body].material!;
    expect(s.scene.nodes[ids.collar].material).toBe(bodyMat);
    const inst = s.materials[bodyMat];
    expect(inst).toMatchObject({ name: 'My gold', library: 'mat-a', preset: null, origin: 'GOLD', edited: false });
    expect(inst.params.roughness).toBe(0.42);
    // Editing the instance unlinks it from "the item as saved": a later assignment gets a fresh one.
    const t = apply(s, { type: 'material/setParam', id: bodyMat, key: 'roughness', value: 0.1 });
    const u = apply(t, assignAction(t, { library: src }, 'REPLACE', [ids.cap]));
    expect(u.scene.nodes[ids.cap].material).not.toBe(bodyMat);
    expect(u.materials[u.scene.nodes[ids.cap].material!].params.roughness).toBe(0.42);
  });
});

describe('renaming and removing', () => {
  const lib3 = (): Library => {
    const s = exampleState();
    const inst = s.materials[s.scene.nodes[keyIds(s).cap].material!];
    let lib = emptyLibrary();
    for (const [id, name] of [['mat-a', 'Alpha'], ['mat-b', 'Beta']] as const) lib = addItem(lib, fromMaterialInstance(lib, inst, name, { now: NOW, id }));
    return lib;
  };

  it('renames an item, keeping the name unique and ignoring an empty one', () => {
    let lib = renameItem(lib3(), 'material', 'mat-a', '  Gamma  ');
    expect(findItem(lib, 'material', 'mat-a')!.name).toBe('Gamma');
    lib = renameItem(lib, 'material', 'mat-a', 'beta');
    expect(findItem(lib, 'material', 'mat-a')!.name).toBe('beta 2');
    expect(renameItem(lib, 'material', 'mat-a', '   ')).toBe(lib);
    expect(renameItem(lib, 'material', 'nope', 'X')).toBe(lib);
    // Renaming to its own name changes nothing.
    expect(renameItem(lib, 'material', 'mat-b', 'Beta')).toBe(lib);
  });

  it('removes an item and only that one', () => {
    const lib = removeItem(lib3(), 'material', 'mat-a');
    expect(itemsOf(lib, 'material').map((m) => m.id)).toEqual(['mat-b']);
    expect(removeItem(lib, 'material', 'mat-a')).toBe(lib);
    expect(removeItem(lib, 'lightSetup', 'mat-b')).toBe(lib);
  });

  it('removing a material that is in use leaves the instance intact, unlinked from the item', () => {
    let s = exampleState();
    const ids = keyIds(s);
    const capMat = s.scene.nodes[ids.cap].material!;
    const item = fromMaterialInstance(emptyLibrary(), s.materials[capMat], 'My gold', { now: NOW, id: 'mat-a' });
    let lib = addItem(emptyLibrary(), item);
    s = apply(s, assignAction(s, { library: { id: item.id, instance: instanceFromItem(item) } }, 'REPLACE', [ids.body]));
    const bodyMat = s.scene.nodes[ids.body].material!;
    const before = s.materials[bodyMat];
    expect(before.library).toBe('mat-a');

    lib = removeItem(lib, 'material', 'mat-a');
    s = apply(s, { type: 'material/unlinkLibrary', library: 'mat-a' });
    expect(itemsOf(lib, 'material')).toHaveLength(0);
    // Same instance, same part, same values: it only lost the link.
    expect(s.scene.nodes[ids.body].material).toBe(bodyMat);
    expect(s.materials[bodyMat]).toEqual({ ...before, library: null });
    expect(partMaterials(s.scene.nodes[ids.body])).toEqual([bodyMat]);
    // Nothing links to a deleted item any more, so a second removal is a no-op for the project.
    expect(apply(s, { type: 'material/unlinkLibrary', library: 'mat-a' })).toBe(s);
  });
});

describe('saving the current rig as a light setup', () => {
  it('lights keep their camera-relative place and the shares sum to 1', () => {
    const s = apply(exampleState(), { type: 'studio/setPreset', key: 'JEWELLERY' }, { type: 'studio/build' });
    const item = fromCurrentRig(s, emptyLibrary(), 'My light', { now: NOW, id: 'set-a' })!;
    expect(item.lights).toHaveLength(s.studio.lights.length);
    expect(item.lights.reduce((a, l) => a + (l.share ?? 0), 0)).toBeCloseTo(1, 12);
    item.lights.forEach((spec, i) => {
      const l = s.studio.lights[i];
      expect([spec.az, spec.el, spec.dist, spec.size, spec.sizeY, spec.role]).toEqual([l.az, l.el, l.dist, l.size, l.sizeY, l.role]);
      // Power is the weight of each light.
      expect(spec.share).toBeCloseTo(l.power / s.studio.lights.reduce((a, x) => a + x.power, 0), 12);
      expect(spec.energy).toBeUndefined();
    });
    expect(item.world).toBe('STUDIO');
    expect(item.kind).toBe('lightSetup');
  });

  it('shares follow a hand-edited power, and lights switched off are left out', () => {
    let s = exampleState();
    const [a, b, c] = s.studio.lights;
    s = apply(s, { type: 'studio/setLight', id: a.id, patch: { power: 10 } }, { type: 'studio/setLight', id: b.id, patch: { power: 30 } }, { type: 'studio/setLight', id: c.id, patch: { enabled: false } });
    const item = fromCurrentRig(s, emptyLibrary(), 'Two', { id: 'set-a', now: NOW })!;
    expect(item.lights).toHaveLength(2);
    expect(item.lights.map((l) => l.share)).toEqual([0.25, 0.75]);
    s = apply(s, ...s.studio.lights.map((l) => ({ type: 'studio/setLight' as const, id: l.id, patch: { enabled: false } })));
    expect(fromCurrentRig(s, emptyLibrary(), 'None')).toBeNull();
  });

  it('keeps the temperature of white lights and the colour of coloured ones', () => {
    const s = apply(exampleState(), { type: 'studio/setSetup', key: 'NEON_NOIR' });
    const item = fromCurrentRig(s, emptyLibrary(), 'Neon', { id: 'set-a', now: NOW })!;
    expect(item.source).toBe('NEON_NOIR');
    item.lights.forEach((spec, i) => {
      const l = s.studio.lights[i];
      if (l.kelvin === null) expect(spec.color).toEqual([...l.color]);
      else expect(spec.kelvin).toBe(l.kelvin);
    });
  });

  it('applied to another product type, the total irradiance is the one of that type', () => {
    const s0 = apply(exampleState(), { type: 'studio/setPreset', key: 'JEWELLERY' }, { type: 'studio/setSetup', key: 'REMBRANDT' });
    // Hand edits: a brighter key and a moved fill.
    const edited = apply(s0, { type: 'studio/setLight', id: s0.studio.lights[0].id, patch: { power: s0.studio.lights[0].power * 3 } }, { type: 'studio/setLight', id: s0.studio.lights[1].id, patch: { az: 70 } });
    const item = fromCurrentRig(edited, emptyLibrary(), 'Mine', { id: 'set-a', now: NOW })!;
    for (const p of STUDIO_PRESETS) {
      const rig = applyLibrarySetup(p.key, item);
      expect(Math.abs(rigIrradiance(rig) - presetIrradiance(p.key)) / presetIrradiance(p.key), p.key).toBeLessThan(1e-6);
      // It is the saved recipe that was scaled, not the product type's own rig.
      expect(rig.map((l) => l.azimuthWorld - CAMERA_AZIMUTH_DEG), p.key).toEqual(item.lights.map((l) => l.az));
      expect(rig.map((l) => l.dist), p.key).toEqual(item.lights.map((l) => l.dist));
    }
    // Through the store, on a different product type than the one it was saved on.
    const t = apply(exampleState(), { type: 'studio/setPreset', key: 'WATCH' }, { type: 'studio/applySetup', setup: customSetupOf(item) });
    expect(Math.abs(total(t) - presetIrradiance('WATCH'))).toBeLessThan(1e-6);
    expect(lightShares(t.studio.lights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(t.studio.lights.map((l) => l.az)).toEqual(item.lights.map((l) => l.az));
    expect(t.studio.lightSetup).toBe(libraryKey('set-a'));
    expect(t.studio.modified).toBe(false);
    // The proportions between the lights are the ones that were saved (power ratio, same distances).
    const ratio = (ls: { power: number }[]) => ls.map((l) => l.power / ls[0].power);
    ratio(t.studio.lights).forEach((r, i) => expect(r).toBeCloseTo(ratio(edited.studio.lights)[i], 9));
  });

  it('Create studio and Reset to setup keep an own setup; a catalogue one replaces it', () => {
    const item = fromCurrentRig(apply(exampleState(), { type: 'studio/setSetup', key: 'WRAP' }), emptyLibrary(), 'Wrap+', { id: 'set-a', now: NOW })!;
    let s = apply(exampleState(), { type: 'studio/setPreset', key: 'PERFUME' }, { type: 'studio/applySetup', setup: customSetupOf(item) });
    const lights = s.studio.lights;
    s = apply(s, { type: 'studio/build' });
    expect(s.studio.lightSetup).toBe('LIB:set-a');
    expect(s.studio.lights.map((l) => l.az)).toEqual(lights.map((l) => l.az));
    expect(Math.abs(total(s) - presetIrradiance('PERFUME'))).toBeLessThan(1e-6);
    s = apply(s, { type: 'studio/setLight', id: s.studio.lights[0].id, patch: { el: 5 } });
    expect(s.studio.modified).toBe(true);
    s = apply(s, { type: 'studio/resetLights' });
    expect(s.studio.lights[0].el).toBe(lights[0].el);
    expect(s.studio.modified).toBe(false);
    s = apply(s, { type: 'studio/setSetup', key: 'REMBRANDT' });
    expect(s.studio.customSetup).toBeNull();
    expect(s.studio.lightSetup).toBe('REMBRANDT');
  });

  it('removing the setup from the library leaves the rig in the project as it is', () => {
    const item = fromCurrentRig(exampleState(), emptyLibrary(), 'Mine', { id: 'set-a', now: NOW })!;
    let s = apply(exampleState(), { type: 'studio/applySetup', setup: customSetupOf(item) });
    const lib = removeItem(addItem(emptyLibrary(), item), 'lightSetup', 'set-a');
    expect(itemsOf(lib, 'lightSetup')).toHaveLength(0);
    const lights = s.studio.lights;
    s = apply(s, { type: 'studio/build' });
    expect(s.studio.lights.map((l) => l.az)).toEqual(lights.map((l) => l.az));
  });

  it('does not accept a setup that is not from the library, or that has no lights', () => {
    const s = exampleState();
    const item = fromCurrentRig(s, emptyLibrary(), 'Mine', { id: 'set-a', now: NOW })!;
    expect(apply(s, { type: 'studio/applySetup', setup: { ...customSetupOf(item), key: 'REMBRANDT' } })).toBe(s);
    expect(apply(s, { type: 'studio/applySetup', setup: { ...customSetupOf(item), lights: [] } })).toBe(s);
  });

  it('every catalogue setup can be saved and applied, on its own type, with the same irradiance', () => {
    for (const setup of LIGHT_SETUPS.filter((x) => x.lights)) {
      const s = apply(exampleState(), { type: 'studio/setSetup', key: setup.key });
      const item = fromCurrentRig(s, emptyLibrary(), setup.key, { id: 'set-a', now: NOW })!;
      const t = apply(exampleState(), { type: 'studio/applySetup', setup: customSetupOf(item) });
      expect(Math.abs(total(t) - presetIrradiance('GENERIC')), setup.key).toBeLessThan(1e-6);
      expect(t.studio.lights, setup.key).toHaveLength(s.studio.lights.length);
    }
  });
});

describe('saving the studio as a product type', () => {
  it('carries the size, optics, exposure, background, floor, shadow, quality and the rig with its energies', () => {
    let s = apply(exampleState(), { type: 'studio/setPreset', key: 'WATCH' }, { type: 'studio/build' });
    s = apply(s, { type: 'camera/set', id: activeCamera(s).id, patch: { focalMm: 135, fstop: 4 } }, { type: 'image/set', patch: { exposureEv: 0.7 } }, { type: 'studio/set', patch: { shadow: false } }, { type: 'scene/setPartSize', mm: 52 });
    const item = fromCurrentProductType(s, emptyLibrary(), 'My watch', { id: 'typ-a', now: NOW });
    expect(item.source).toBe('WATCH');
    expect(item.preset).toMatchObject({ sizeMm: 52, focalMm: 135, fstop: 4, exposure: 0.7, floor: s.studio.floor, shadow: false, quality: 'FINAL', caustics: studioPreset('WATCH')!.caustics, background: 'FLAT' });
    expect(item.preset.lights.map((l) => l.energy)).toEqual(s.studio.lights.map((l) => l.power));
    expect(item.preset.lights.every((l) => l.share === undefined)).toBe(true);
    expect(item.preset.backgroundColor).toEqual([...s.environment.color]);
  });

  it('a custom render quality falls back to the quality of the type it came from', () => {
    const s = apply(exampleState(), { type: 'studio/setPreset', key: 'WATCH' }, { type: 'studio/build' }, { type: 'render/set', patch: { maxSamples: 77 } });
    expect(s.render.quality).toBe('CUSTOM');
    expect(fromCurrentProductType(s, emptyLibrary(), 'W', { id: 'a' }).preset.quality).toBe('FINAL');
  });

  it('chosen from the library it becomes the product type: Create studio applies its values, and the type stays if the item is removed', () => {
    let s = apply(exampleState(), { type: 'studio/setPreset', key: 'WATCH' }, { type: 'studio/build' });
    s = apply(s, { type: 'camera/set', id: activeCamera(s).id, patch: { focalMm: 135, fstop: 4 } }, { type: 'image/set', patch: { exposureEv: 0.7 } });
    const item = fromCurrentProductType(s, emptyLibrary(), 'My watch', { id: 'typ-a', now: NOW });
    const lib = addItem(emptyLibrary(), item);

    let t = apply(exampleState(), { type: 'studio/setPreset', key: libraryKey(item.id), custom: presetOfItem(item) });
    expect(t.studio.preset).toBe('LIB:typ-a');
    expect(isLibraryKey(t.studio.preset)).toBe(true);
    const gone = removeItem(lib, 'productType', 'typ-a');
    expect(itemsOf(gone, 'productType')).toHaveLength(0);
    // Deleted from the library, still the project's product type.
    t = apply(t, { type: 'studio/build' });
    expect(activeCamera(t)).toMatchObject({ focalMm: 135, fstop: 4 });
    expect(t.image.exposureEv).toBe(0.7);
    expect(t.studio.lights).toHaveLength(s.studio.lights.length);
    expect(t.studio.lights.map((l) => l.power)).toEqual(s.studio.lights.map((l) => l.power));
    // Setups are normalised to the level of this product type.
    const setup = apply(t, { type: 'studio/setSetup', key: 'REMBRANDT' });
    expect(Math.abs(total(setup) - presetIrradiance(presetOfItem(item)))).toBeLessThan(1e-6);
    // Choosing a catalogue type again clears it.
    expect(apply(t, { type: 'studio/setPreset', key: 'GENERIC' }).studio.customPreset).toBeNull();
    // An unknown library key without its definition is ignored, like any unknown key.
    expect(apply(exampleState(), { type: 'studio/setPreset', key: 'LIB:nope' }).studio.preset).toBe('GENERIC');
  });
});

describe('how own items are named in the interface', () => {
  it('an own product type is called what the person called it; a missing definition shows the key', () => {
    const s = apply(exampleState(), { type: 'studio/setPreset', key: 'WATCH' }, { type: 'studio/build' });
    const item = fromCurrentProductType(s, emptyLibrary(), 'Mi reloj', { id: 'typ-a', now: NOW });
    const custom = presetOfItem(item);
    expect(studioLabel(custom.key, custom)).toEqual({ en: 'Mi reloj', es: 'Mi reloj' });
    expect(studioLabel('GENERIC', custom)).toEqual({ en: 'Standard', es: 'Estándar' });
    expect(studioLabel('LIB:typ-a')).toEqual({ en: 'LIB:typ-a', es: 'LIB:typ-a' });
    expect(studioLabel('WATCH').en).toBe('Watchmaking');
  });

  it('the sphere of a material is cached by content, so two edits of one preset get two spheres', () => {
    const s = exampleState();
    const gold = s.materials[s.scene.nodes[keyIds(s).cap].material!];
    expect(thumbKey(gold)).toBe('preset:GOLD');
    const edited = apply(s, { type: 'material/setParam', id: gold.id, key: 'roughness', value: 0.6 }).materials[gold.id];
    expect(thumbKey(edited)).toMatch(/^inst:/);
    expect(thumbKey(edited)).not.toBe(thumbKey({ ...edited, params: { ...edited.params, roughness: 0.7 } }));
    expect(thumbKey(instanceFromItem(fromMaterialInstance(emptyLibrary(), edited, 'x')))).toBe(thumbKey(edited));
  });
});

describe('saving a studio', () => {
  it('restoring a library studio brings back camera, light, materials and visibility in one action', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = apply(s, { type: 'studio/setSetup', key: 'WRAP' }, { type: 'scene/setVisible', ids: [ids.cap], visible: false });
    const item = fromCurrentStudio(s, emptyLibrary(), 'Hero', { id: 'std-a', now: NOW });
    expect(item).toMatchObject({ kind: 'studio', name: 'Hero', id: 'std-a' });
    expect('id' in item.studio).toBe(false);
    const saved = savedStudioOf(item);

    const store = createStore(s);
    store.dispatch({ type: 'studio/setSetup', key: 'NEON_NOIR' });
    store.dispatch(assignAction(store.get(), { preset: 'COPPER' }, 'REPLACE', [ids.body]));
    store.dispatch({ type: 'camera/view', view: 'TOP' });
    store.dispatch({ type: 'scene/setVisible', ids: [ids.cap], visible: true });
    store.dispatch({ type: 'studio/restore', id: saved.id, snapshot: saved, label: 'Restore' });
    const r = store.get();
    expect(r.studio.lightSetup).toBe('WRAP');
    expect(r.materials[r.scene.nodes[ids.body].material!].preset).toBe('PAINT_MET');
    expect(activeCamera(r).elevation).toBe(22);
    expect(r.scene.nodes[ids.cap].visible).toBe(false);
    // One action: one undo entry that brings the previous state back.
    expect(store.history().undo[0]).toBe('Restore');
    store.undo();
    expect(store.get().studio.lightSetup).toBe('NEON_NOIR');
  });

  it('the old project actions keep working on the studios saved inside a project', () => {
    const s = apply(exampleState(), { type: 'studio/setSetup', key: 'WRAP' }, { type: 'studio/save', name: 'A' });
    expect(s.studio.saved).toHaveLength(1);
    const t = apply(s, { type: 'studio/setSetup', key: 'NEON_NOIR' }, { type: 'studio/restore', id: s.studio.saved[0].id });
    expect(t.studio.lightSetup).toBe('WRAP');
    expect(apply(t, { type: 'studio/deleteSaved', id: s.studio.saved[0].id }).studio.saved).toHaveLength(0);
  });

  it('migrates the studios saved inside a project to the library', () => {
    const s = apply(exampleState(), { type: 'studio/save', name: 'A' }, { type: 'studio/setSetup', key: 'WRAP' }, { type: 'studio/save', name: 'A' });
    const lib = migrateSavedStudios(emptyLibrary(), s.studio.saved, { now: NOW });
    expect(itemsOf(lib, 'studio').map((x) => x.name)).toEqual(['A', 'A 2']);
    expect(new Set(itemsOf(lib, 'studio').map((x) => x.id)).size).toBe(2);
    expect(itemsOf(lib, 'studio')[1].studio.lightSetup).toBe('WRAP');
    // And what comes out of the library restores like the saved studio did.
    const back = apply(createInitialState(), { type: 'studio/restore', id: 'x', snapshot: savedStudioOf(itemsOf(lib, 'studio')[1]) });
    expect(back.studio.lightSetup).toBe('WRAP');
  });
});

// --- The commands the interface runs (no DOM: the viewport is a stub) --------------------------------------

describe('the commands behind Save… and the Mine tabs', () => {
  const SPHERE = 'data:image/png;base64,iVBORw0KGgo=';

  function makeCtx(opts: { viewport?: boolean; state?: ReturnType<typeof exampleState> } = {}): Ctx {
    const withViewport = opts.viewport ?? true;
    const services = {
      viewport: withViewport ? ({ materialThumbnail: async () => SPHERE } as unknown as ViewportPort) : null,
      renderImage: async () => new Blob([new Uint8Array([255, 216, 255, 224])], { type: 'image/jpeg' }),
      captureViewport: async () => null,
      importFile: async () => {
        throw new Error('not used');
      },
      serializeProject: () => new Blob(),
      library: { export: (lib: Library) => new Blob([exportLibrary(lib)]), import: importLibrary },
    } as unknown as AppServices;
    return { store: createStore(opts.state ?? exampleState()), ui: createUiStore(), services };
  }
  const lib = (ctx: Ctx) => ctx.ui.get().library;
  const capMaterial = (ctx: Ctx) => {
    const s = ctx.store.get();
    return s.scene.nodes[keyIds(s).cap].material!;
  };

  it('Save material as… stores the values with the sphere the viewport rendered, and does not touch the project', async () => {
    const ctx = makeCtx();
    await cmd.saveMaterialToLibrary(ctx, capMaterial(ctx), '  My   gold ');
    const [item] = itemsOf(lib(ctx), 'material');
    expect(item).toMatchObject({ name: 'My gold', source: 'GOLD', thumb: SPHERE });
    expect(ctx.ui.get().toasts.map((t) => t.text)).toEqual(['Saved “My gold” to Mine']);
    // User state like the theme: no undo entry, the project is not dirty, undo does not take it away.
    expect(ctx.store.history().undo).toEqual([]);
    expect(ctx.store.get().meta.dirty).toBe(false);
    ctx.store.undo();
    expect(itemsOf(lib(ctx), 'material')).toHaveLength(1);
    // A name with nothing in it saves nothing; an unknown material neither.
    await cmd.saveMaterialToLibrary(ctx, capMaterial(ctx), '   ');
    await cmd.saveMaterialToLibrary(ctx, 'm999', 'X');
    expect(itemsOf(lib(ctx), 'material')).toHaveLength(1);
  });

  it('Save light setup as… captures a 160 × 120 JPEG when the viewport can render, a generic icon (no picture) when it cannot', async () => {
    const ctx = makeCtx();
    await cmd.saveSetupToLibrary(ctx, 'My rig');
    const [item] = itemsOf(lib(ctx), 'lightSetup');
    expect(item.thumb).toMatch(/^data:image\/jpeg;base64,/);
    const plain = makeCtx({ viewport: false });
    await cmd.saveSetupToLibrary(plain, 'My rig');
    expect(itemsOf(lib(plain), 'lightSetup')[0].thumb).toBeUndefined();
    expect(itemsOf(lib(plain), 'lightSetup')[0].lights.length).toBeGreaterThan(0);
  });

  it('with every light off there is no rig to save: it says so and saves nothing', async () => {
    const ctx = makeCtx();
    for (const l of ctx.store.get().studio.lights) ctx.store.dispatch({ type: 'studio/setLight', id: l.id, patch: { enabled: false } });
    await cmd.saveSetupToLibrary(ctx, 'Nothing');
    expect(itemsOf(lib(ctx), 'lightSetup')).toHaveLength(0);
    expect(ctx.ui.get().toasts.map((t) => t.text)).toEqual(['Switch a light on first: there is no rig to save']);
  });

  it('own product types and studios are saved the same way, and a studio without a name is "Studio N"', async () => {
    const ctx = makeCtx();
    await cmd.saveProductTypeToLibrary(ctx, 'My type');
    await cmd.saveStudio(ctx);
    await cmd.saveStudio(ctx, 'Hero');
    expect(itemsOf(lib(ctx), 'productType').map((i) => i.name)).toEqual(['My type']);
    expect(itemsOf(lib(ctx), 'studio').map((i) => i.name)).toEqual(['Studio 1', 'Hero']);
    expect(itemsOf(lib(ctx), 'studio')[0].thumb).toBeDefined();
  });

  it('assigning a library material goes through the same overwrite inventory as a catalogue one', async () => {
    const ctx = makeCtx();
    const ids = keyIds(ctx.store.get());
    await cmd.saveMaterialToLibrary(ctx, capMaterial(ctx), 'My gold');
    const item = itemsOf(lib(ctx), 'material')[0];
    // One part with one material: straight in.
    expect(cmd.requestAssign(ctx, { library: item.id }, [ids.body])).toBeNull();
    const s = ctx.store.get();
    expect(s.materials[s.scene.nodes[ids.body].material!]).toMatchObject({ name: 'My gold', library: item.id });
    expect(ctx.store.history().undo[0]).toBe('Assign My gold to body');
    // Every part, which carry different materials: it asks first, and Replace does it.
    const spec = cmd.requestAssign(ctx, { library: item.id }, []);
    expect(spec).not.toBeNull();
    spec!.options[0].run();
    const t = ctx.store.get();
    const mats = new Set(Object.values(t.scene.nodes).filter((n) => n.kind === 'PART').map((n) => n.material));
    expect(mats.size).toBe(1);
    // An item that is gone assigns nothing.
    expect(cmd.requestAssign(ctx, { library: 'mat-nope' }, [ids.body])).toBeNull();
    expect(ctx.store.get()).toBe(t);
  });

  it('the inline name field starts with a sensible name', async () => {
    const ctx = makeCtx();
    const cap = capMaterial(ctx);
    expect(cmd.suggestMaterialName(ctx, cap)).toBe('Gold');
    ctx.store.dispatch({ type: 'material/set', id: cap, patch: { name: 'Brass cap' } });
    expect(cmd.suggestMaterialName(ctx, cap)).toBe('Brass cap');
    expect(cmd.suggestMaterialName(ctx, 'm999')).toBe('');
    expect(cmd.suggestSetupName(ctx)).toBe('Standard');
    ctx.store.dispatch({ type: 'studio/setSetup', key: 'REMBRANDT' });
    expect(cmd.suggestSetupName(ctx)).toBe('Rembrandt');
    expect(cmd.suggestTypeName(ctx)).toBe('Standard');
    expect(cmd.suggestStudioName(ctx)).toBe('Studio 1');
    await cmd.saveStudio(ctx, 'One');
    expect(cmd.suggestStudioName(ctx)).toBe('Studio 2');
  });

  it('a library material can be dragged: the payload names the item', async () => {
    expect(cmd.parseMaterialDrag('library:mat-a')).toEqual({ library: 'mat-a' });
    expect(cmd.parseMaterialDrag('preset:GOLD')).toEqual({ preset: 'GOLD' });
    expect(cmd.parseMaterialDrag('nonsense')).toBeNull();
  });

  it('applying an own setup asks first when the lights were edited, like a catalogue one', async () => {
    const ctx = makeCtx();
    await cmd.saveSetupToLibrary(ctx, 'My rig');
    const key = libraryKey(itemsOf(lib(ctx), 'lightSetup')[0].id);
    ctx.store.dispatch({ type: 'studio/setPreset', key: 'WATCH' });
    expect(cmd.requestSetup(ctx, key)).toBeNull();
    expect(ctx.store.get().studio.lightSetup).toBe(key);
    expect(ctx.store.history().undo[0]).toBe('Light setup: My rig');
    expect(Math.abs(total(ctx.store.get()) - presetIrradiance('WATCH'))).toBeLessThan(1e-6);
    // Edited by hand: Yes / No before it is replaced.
    ctx.store.dispatch({ type: 'studio/setLight', id: ctx.store.get().studio.lights[0].id, patch: { el: 10 } });
    ctx.store.dispatch({ type: 'studio/setSetup', key: 'REMBRANDT' });
    ctx.store.dispatch({ type: 'studio/setLight', id: ctx.store.get().studio.lights[0].id, patch: { el: 10 } });
    const spec = cmd.requestSetup(ctx, key);
    expect(spec?.message).toContain('My rig');
    expect(ctx.store.get().studio.lightSetup).toBe('REMBRANDT');
    spec!.options[0].run();
    expect(ctx.store.get().studio.lightSetup).toBe(key);
    // An id that is not in the library does nothing.
    cmd.chooseSetup(ctx, 'LIB:nope');
    expect(ctx.store.get().studio.lightSetup).toBe(key);
  });

  it('choosing an own product type, then deleting it from the library: the project keeps it', async () => {
    const ctx = makeCtx();
    await cmd.saveProductTypeToLibrary(ctx, 'My type');
    const key = libraryKey(itemsOf(lib(ctx), 'productType')[0].id);
    cmd.setProductType(ctx, key);
    expect(ctx.store.get().studio.preset).toBe(key);
    expect(ctx.store.history().undo[0]).toBe('Product type: My type');
    const before = ctx.store.get();
    cmd.deleteLibraryItem(ctx, 'productType', key.slice(4));
    expect(itemsOf(lib(ctx), 'productType')).toHaveLength(0);
    // Nothing in the project changed.
    expect(ctx.store.get()).toBe(before);
    // And it can still be picked again from the project's copy.
    cmd.setProductType(ctx, 'GENERIC');
    expect(ctx.store.get().studio.preset).toBe('GENERIC');
    cmd.setProductType(ctx, key);
    expect(ctx.store.get().studio.preset).toBe('GENERIC');
  });

  it('deleting a material in use unlinks the instance in one undoable entry and leaves the scene working', async () => {
    const ctx = makeCtx();
    const ids = keyIds(ctx.store.get());
    await cmd.saveMaterialToLibrary(ctx, capMaterial(ctx), 'My gold');
    const item = itemsOf(lib(ctx), 'material')[0];
    cmd.requestAssign(ctx, { library: item.id }, [ids.body]);
    const matId = ctx.store.get().scene.nodes[ids.body].material!;
    cmd.deleteLibraryItem(ctx, 'material', item.id);
    expect(itemsOf(lib(ctx), 'material')).toHaveLength(0);
    expect(ctx.store.get().scene.nodes[ids.body].material).toBe(matId);
    expect(ctx.store.get().materials[matId]).toMatchObject({ name: 'My gold', library: null, origin: 'GOLD' });
    expect(ctx.store.history().undo[0]).toBe('Remove My gold from the library');
    // Deleting an item nothing uses touches no project state at all, and an unknown one does nothing.
    await cmd.saveMaterialToLibrary(ctx, capMaterial(ctx), 'Other');
    const s = ctx.store.get();
    cmd.deleteLibraryItem(ctx, 'material', itemsOf(lib(ctx), 'material')[0].id);
    expect(ctx.store.get()).toBe(s);
    cmd.deleteLibraryItem(ctx, 'material', 'mat-nope');
  });

  it('renaming goes through the library and keeps names unique', async () => {
    const ctx = makeCtx();
    await cmd.saveMaterialToLibrary(ctx, capMaterial(ctx), 'A');
    await cmd.saveMaterialToLibrary(ctx, capMaterial(ctx), 'B');
    const [a, b] = itemsOf(lib(ctx), 'material');
    cmd.renameLibraryItem(ctx, 'material', a.id, 'B');
    expect(itemsOf(lib(ctx), 'material').map((i) => i.name)).toEqual(['B 2', 'B']);
    cmd.renameLibraryItem(ctx, 'material', b.id, '   ');
    expect(itemsOf(lib(ctx), 'material').map((i) => i.name)).toEqual(['B 2', 'B']);
  });

  it('restoring a library studio is one undoable step; a studio of an older project can be moved to the library', async () => {
    const ctx = makeCtx();
    await cmd.saveStudio(ctx, 'Hero');
    const id = itemsOf(lib(ctx), 'studio')[0].id;
    ctx.store.dispatch({ type: 'camera/view', view: 'TOP' });
    cmd.restoreStudio(ctx, id);
    expect(activeCamera(ctx.store.get()).elevation).toBe(22);
    expect(ctx.store.history().undo[0]).toBe('Restore studio Hero');
    // A studio saved inside the project (an older file).
    ctx.store.dispatch({ type: 'studio/save', name: 'Old' });
    const old = ctx.store.get().studio.saved[0];
    cmd.restoreStudio(ctx, old.id);
    expect(ctx.store.history().undo[0]).toBe('Restore studio Old');
    cmd.moveStudioToLibrary(ctx, old.id);
    expect(ctx.store.get().studio.saved).toHaveLength(0);
    expect(itemsOf(lib(ctx), 'studio').map((i) => i.name)).toEqual(['Hero', 'Old']);
  });

  it('importing says what happened, and a file that is not a library changes nothing', async () => {
    const ctx = makeCtx();
    await cmd.saveMaterialToLibrary(ctx, capMaterial(ctx), 'My gold');
    const json = exportLibrary(lib(ctx));
    const before = lib(ctx);
    const r = cmd.importLibraryText(ctx, json);
    expect(r.added).toBe(0);
    expect(lib(ctx)).toBe(before);
    cmd.importLibraryText(ctx, '{"nope":1}');
    expect(lib(ctx)).toBe(before);
    const texts = ctx.ui.get().toasts.map((t) => t.text);
    expect(texts).toContain('Imported: 0 · skipped: 1 (already in your library)');
    expect(texts).toContain('Library not imported: the file is not a repackshot-library file');
    // Into another session of the app: the item comes in.
    const other = makeCtx();
    expect(cmd.importLibraryText(other, json).added).toBe(1);
    expect(itemsOf(lib(other), 'material')[0].name).toBe('My gold');
    expect(other.ui.get().toasts.map((t) => t.text)).toEqual(['Imported: 1']);
  });
});

describe('the palette lists the user’s own items', () => {
  async function ctxWithLibrary() {
    const services = {
      viewport: { materialThumbnail: async () => null } as unknown as ViewportPort,
      renderImage: async () => new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' }),
      library: { export: () => new Blob(), import: importLibrary },
    } as unknown as AppServices;
    const ctx: Ctx = { store: createStore(exampleState()), ui: createUiStore(), services };
    const cap = ctx.store.get().scene.nodes[keyIds(ctx.store.get()).cap].material!;
    await cmd.saveMaterialToLibrary(ctx, cap, 'Mi oro');
    await cmd.saveSetupToLibrary(ctx, 'Mi luz');
    await cmd.saveProductTypeToLibrary(ctx, 'Mi tipo');
    await cmd.saveStudio(ctx, 'Mi estudio');
    return ctx;
  }

  it('materials, setups, product types and studios appear under the category Mine, in both languages', async () => {
    const ctx = await ctxWithLibrary();
    const mine = paletteItems(ctx).filter((i) => i.category === 'palette.cat.mine');
    expect(mine.map((i) => i.label.en)).toEqual(['Mi oro', 'Mi luz', 'Mi tipo', 'Mi estudio']);
    expect(mine.map((i) => i.id.split(':').slice(0, 2).join(':'))).toEqual(['mine:material', 'mine:setup', 'mine:product', 'mine:studio']);
    setLang('es');
    expect(t('palette.cat.mine')).toBe('Míos');
    setLang('en');
    expect(t('palette.cat.mine')).toBe('Mine');
    // Found by name, and all of them by the category.
    expect(rank(paletteItems(ctx), 'mi oro')[0].id).toBe(mine[0].id);
    expect(rank(paletteItems(ctx), 'mine').filter((i) => i.category === 'palette.cat.mine')).toHaveLength(4);
    expect(rank(paletteItems(ctx), 'mi luz')[0].id).toBe(mine[1].id);
  });

  it('an item removed from the library leaves the palette, and an empty library adds nothing', async () => {
    const ctx = await ctxWithLibrary();
    cmd.deleteLibraryItem(ctx, 'material', itemsOf(ctx.ui.get().library, 'material')[0].id);
    expect(paletteItems(ctx).filter((i) => i.category === 'palette.cat.mine').map((i) => i.label.en)).toEqual(['Mi luz', 'Mi tipo', 'Mi estudio']);
    const empty: Ctx = { store: createStore(exampleState()), ui: createUiStore(), services: {} as AppServices };
    expect(paletteItems(empty).some((i) => i.category === 'palette.cat.mine')).toBe(false);
  });

  it('running them does what clicking them in the tab does', async () => {
    const ctx = await ctxWithLibrary();
    const ids = keyIds(ctx.store.get());
    ctx.store.dispatch({ type: 'scene/select', ids: [ids.body], mode: 'set', level: 'PART' });
    const run = (n: string) => paletteItems(ctx).find((i) => i.category === 'palette.cat.mine' && i.label.en === n)!.run();
    run('Mi oro');
    const s = ctx.store.get();
    expect(s.materials[s.scene.nodes[ids.body].material!].name).toBe('Mi oro');
    run('Mi tipo');
    expect(ctx.store.get().studio.preset).toMatch(/^LIB:typ-/);
    run('Mi luz');
    expect(ctx.store.get().studio.lightSetup).toMatch(/^LIB:set-/);
    ctx.store.dispatch({ type: 'camera/view', view: 'TOP' });
    run('Mi estudio');
    expect(activeCamera(ctx.store.get()).elevation).toBe(22);
  });
});

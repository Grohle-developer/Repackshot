// Phase U4: the library as a file and in the browser's storage. Export then import gives the same items, a
// duplicate name gets a suffix, a duplicate id is skipped, an invalid item is skipped with its reason and
// never stops the rest, and what is saved survives a reload.

import { describe, expect, it } from 'vitest';
import {
  addItem,
  allItems,
  customSetupOf,
  emptyLibrary,
  fromCurrentProductType,
  fromCurrentRig,
  fromCurrentStudio,
  fromMaterialInstance,
  itemsOf,
  type Library,
  type LibraryItem,
} from '../src/core/library';
import {
  LIBRARY_FORMAT,
  LIBRARY_SCHEMA,
  LIBRARY_STORAGE_KEY,
  exportLibrary,
  importLibrary,
  loadLibrary,
  saveLibrary,
  validateItem,
  type KeyValueStorage,
} from '../src/io/library';
import { apply, exampleState, keyIds } from './helpers';

const NOW = 1_700_000_000_000;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

/** A library with one item of every kind, each made from the example project. */
function fullLibrary(): Library {
  let s = exampleState();
  const ids = keyIds(s);
  const capMat = s.scene.nodes[ids.cap].material!;
  s = apply(s, { type: 'material/setParam', id: capMat, key: 'roughness', value: 0.31 }, { type: 'studio/setSetup', key: 'NEON_NOIR' });
  let lib = emptyLibrary();
  lib = addItem(lib, fromMaterialInstance(lib, s.materials[capMat], 'My gold', { id: 'mat-a', now: NOW, thumb: PNG }));
  lib = addItem(lib, fromCurrentRig(s, lib, 'Neon+', { id: 'set-a', now: NOW + 1, thumb: JPG })!);
  lib = addItem(lib, fromCurrentProductType(s, lib, 'My product', { id: 'typ-a', now: NOW + 2, thumb: JPG }));
  lib = addItem(lib, fromCurrentStudio(s, lib, 'Hero shot', { id: 'std-a', now: NOW + 3 }));
  return lib;
}

/** A `localStorage` made of a plain object, with the failures a browser can have. */
function fakeStorage(opts: { quota?: number; blocked?: boolean } = {}): KeyValueStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem(k) {
      if (opts.blocked) throw new Error('SecurityError');
      return k in data ? data[k] : null;
    },
    setItem(k, v) {
      if (opts.blocked) throw new Error('SecurityError');
      if (opts.quota !== undefined && v.length > opts.quota) throw new Error('QuotaExceededError');
      data[k] = v;
    },
  };
}

const parse = (lib: Library) => JSON.parse(exportLibrary(lib)) as { format: string; schema: number; items: Record<string, unknown>[] };

describe('export and import', () => {
  it('the file is { format, schema, items } with the kind of each item', () => {
    const file = parse(fullLibrary());
    expect(file.format).toBe('repackshot-library');
    expect(LIBRARY_FORMAT).toBe('repackshot-library');
    expect(file.schema).toBe(1);
    expect(LIBRARY_SCHEMA).toBe(1);
    expect(file.items.map((i) => i.kind)).toEqual(['material', 'lightSetup', 'productType', 'studio']);
    expect(Object.keys(file).sort()).toEqual(['format', 'items', 'schema']);
  });

  it('export then import gives the same items', () => {
    const lib = fullLibrary();
    const r = importLibrary(exportLibrary(lib), emptyLibrary());
    expect(r.error).toBeUndefined();
    expect(r.skipped).toEqual([]);
    expect(r.added).toBe(4);
    expect(r.lib).toEqual(lib);
    // And again: once normalised, the text is a fixed point.
    expect(exportLibrary(importLibrary(exportLibrary(r.lib), emptyLibrary()).lib)).toBe(exportLibrary(r.lib));
    // Every field of each kind came back, not only the ones the test thought of.
    expect(allItems(r.lib).map((i) => [i.kind, i.id, i.name, i.createdAt, i.thumb ?? null, i.source ?? null])).toEqual(allItems(lib).map((i) => [i.kind, i.id, i.name, i.createdAt, i.thumb ?? null, i.source ?? null]));
  });

  it('merges into a library that already has items, and does not touch the one it was given', () => {
    const mine = fullLibrary();
    const other = addItem(emptyLibrary(), fromCurrentRig(exampleState(), emptyLibrary(), 'Another', { id: 'set-z', now: NOW })!);
    const frozen = exportLibrary(mine);
    const r = importLibrary(exportLibrary(other), mine);
    expect(r.added).toBe(1);
    expect(itemsOf(r.lib, 'lightSetup').map((i) => i.id)).toEqual(['set-a', 'set-z']);
    expect(exportLibrary(mine)).toBe(frozen);
  });

  it('importing the same file again skips every item as a duplicate', () => {
    const lib = fullLibrary();
    const r = importLibrary(exportLibrary(lib), lib);
    expect(r.added).toBe(0);
    expect(r.skipped).toHaveLength(4);
    expect(r.skipped.every((s) => s.code === 'duplicate')).toBe(true);
    expect(r.skipped.map((s) => s.name)).toEqual(['My gold', 'Neon+', 'My product', 'Hero shot']);
    expect(r.lib).toEqual(lib);
  });

  it('an item with another id but a name already taken is added with a suffix', () => {
    const lib = fullLibrary();
    const file = parse(lib);
    file.items = file.items.map((i, n) => ({ ...i, id: `copy-${n}` }));
    const r = importLibrary(JSON.stringify(file), lib);
    expect(r.added).toBe(4);
    expect(r.skipped).toEqual([]);
    expect(itemsOf(r.lib, 'material').map((i) => i.name)).toEqual(['My gold', 'My gold 2']);
    expect(itemsOf(r.lib, 'lightSetup').map((i) => i.name)).toEqual(['Neon+', 'Neon+ 2']);
    expect(itemsOf(r.lib, 'productType').map((i) => i.name)).toEqual(['My product', 'My product 2']);
    expect(itemsOf(r.lib, 'studio').map((i) => i.name)).toEqual(['Hero shot', 'Hero shot 2']);
    // A third time: 3.
    const again = importLibrary(JSON.stringify({ ...file, items: file.items.map((i, n) => ({ ...i, id: `copy-again-${n}` })) }), r.lib);
    expect(itemsOf(again.lib, 'material').map((i) => i.name)).toEqual(['My gold', 'My gold 2', 'My gold 3']);
  });

  it('two items of one file with the same name get different names', () => {
    const file = parse(fullLibrary());
    const m = file.items[0];
    const twice = { ...file, items: [m, { ...m, id: 'mat-b' }, { ...m, id: 'mat-c' }] };
    const r = importLibrary(JSON.stringify(twice), emptyLibrary());
    expect(itemsOf(r.lib, 'material').map((i) => i.name)).toEqual(['My gold', 'My gold 2', 'My gold 3']);
  });

  it('the same id twice in one file is added once', () => {
    const file = parse(fullLibrary());
    const r = importLibrary(JSON.stringify({ ...file, items: [file.items[0], file.items[0]] }), emptyLibrary());
    expect(r.added).toBe(1);
    expect(r.skipped).toMatchObject([{ index: 1, code: 'duplicate' }]);
  });
});

describe('invalid items are skipped with a reason and the rest are kept', () => {
  const good = () => parse(fullLibrary()).items;
  const run = (items: unknown[]) => importLibrary(JSON.stringify({ format: LIBRARY_FORMAT, schema: 1, items }), emptyLibrary());

  it('says what is wrong and where', () => {
    const [mat, setup, type, studio] = good();
    const broken = [
      { ...mat, id: 'm1', material: { ...(mat.material as object), family: 'PLASTICINE' } },
      { ...setup, id: 's1', lights: [] },
      { ...setup, id: 's2', lights: [{ role: 'KEY', size: 1, az: 'left', el: 10, dist: 2 }] },
      { ...type, id: 't1', preset: { ...(type.preset as object), focalMm: -3 } },
      { ...studio, id: 'st1', studio: { ...(studio.studio as object), camera: null } },
      { ...mat, id: '', name: 'No id' },
      { ...mat, id: 'm2', name: '   ' },
      { ...mat, id: 'm3', kind: 'sandwich' },
      'a string',
      null,
      mat,
    ];
    const r = run(broken);
    expect(r.added).toBe(1);
    expect(r.lib.materials.map((m) => m.id)).toEqual(['mat-a']);
    expect(r.skipped).toHaveLength(10);
    expect(r.skipped.every((s) => s.code === 'invalid')).toBe(true);
    const reason = (i: number) => r.skipped.find((s) => s.index === i)!.reason;
    expect(reason(0)).toMatch(/items\[0\]\.material\.family.*PLASTIC|family.*not one of/);
    expect(reason(1)).toMatch(/lights.*0 entries/);
    expect(reason(2)).toMatch(/items\[2\]\.lights\[0\]\.az: is not a number/);
    expect(reason(3)).toMatch(/preset\.focalMm/);
    expect(reason(4)).toMatch(/studio\.camera: is not an object/);
    expect(reason(5)).toMatch(/\.id: is empty/);
    expect(reason(6)).toMatch(/\.name: is empty/);
    expect(reason(7)).toMatch(/\.kind: is not one of/);
    expect(reason(8)).toMatch(/is not an object/);
    expect(r.skipped.find((s) => s.index === 0)!.name).toBe('My gold');
  });

  it('refuses nothing it can use: a bad picture is dropped, the item stays', () => {
    const [mat] = good();
    const r = run([{ ...mat, thumb: 'https://example.com/x.png' }, { ...mat, id: 'm2', name: 'B', thumb: 'javascript:alert(1)' }, { ...mat, id: 'm3', name: 'C', thumb: 'data:text/html;base64,AAAA' }, { ...mat, id: 'm4', name: 'D', thumb: `data:image/png;base64,${'A'.repeat(400_000)}` }]);
    expect(r.skipped).toEqual([]);
    expect(r.lib.materials).toHaveLength(4);
    expect(r.lib.materials.every((m) => m.thumb === undefined)).toBe(true);
  });

  it('rebuilds each item from the fields it knows: unknown fields and prototype keys do not get in', () => {
    const [mat] = good();
    const dirty = { ...mat, extra: 'x', material: { ...(mat.material as { params: object }), extra: 1, params: { ...(mat.material as { params: object }).params, hack: 1 } } };
    const json = JSON.stringify({ format: LIBRARY_FORMAT, schema: 1, items: [dirty] }).replace('"hack"', '"__proto__"');
    const r = importLibrary(json, emptyLibrary());
    expect(r.added).toBe(0);
    expect(r.skipped[0].reason).toMatch(/not a parameter name/);
    expect(({} as Record<string, unknown>).hack).toBeUndefined();
    const ok = run([dirty]);
    expect(ok.added).toBe(1);
    expect('extra' in ok.lib.materials[0]).toBe(false);
    expect('extra' in ok.lib.materials[0].material).toBe(false);
  });

  it('a missing wear block takes the defaults, and image maps never come in', () => {
    const [mat] = good();
    const m = mat.material as Record<string, unknown>;
    const { wear: _wear, ...noWear } = m;
    const r = run([{ ...mat, material: { ...noWear, textures: { color: 'data:image/png;base64,AAAA', roughness: 'tex1', projection: 'UV', scale: 2 } } }]);
    expect(r.skipped).toEqual([]);
    const item = r.lib.materials[0];
    expect(item.material.wear.amount).toBe(0);
    expect(item.material.wear.edgeColor).toEqual([0.75, 0.75, 0.75, 1]);
    expect(item.material.textures).toMatchObject({ color: null, roughness: null, projection: 'UV', scale: 2 });
  });

  it('validates a single item directly', () => {
    const [mat] = good();
    expect(validateItem(mat).kind).toBe('material');
    expect(() => validateItem({ ...mat, createdAt: 'yesterday' })).toThrow(/createdAt/);
    expect(validateItem({ ...mat, createdAt: undefined }).createdAt).toBeGreaterThan(0);
  });
});

describe('a file that is not a library is refused as a whole', () => {
  const lib = fullLibrary();
  const refuse = (text: string, why: RegExp) => {
    const r = importLibrary(text, lib);
    expect(r.error).toMatch(why);
    expect(r.added).toBe(0);
    expect(r.lib).toBe(lib);
    expect(r.skipped).toMatchObject([{ index: -1, code: 'file' }]);
  };

  it('not JSON, not a library, no schema, a newer schema, no items', () => {
    refuse('{ nope', /not JSON/);
    refuse('[]', /not a library/);
    refuse(JSON.stringify({ format: 'repackshot-project', schema: 1, state: {} }), /repackshot-library/);
    refuse(JSON.stringify({ format: LIBRARY_FORMAT, items: [] }), /schema version/);
    refuse(JSON.stringify({ format: LIBRARY_FORMAT, schema: 99, items: [] }), /schema 99/);
    refuse(JSON.stringify({ format: LIBRARY_FORMAT, schema: 1 }), /list of items/);
  });
});

describe('the library survives a reload', () => {
  it('what is saved comes back from the storage, item for item', () => {
    const storage = fakeStorage();
    const lib = fullLibrary();
    expect(saveLibrary(lib, storage)).toBe('ok');
    // One key, the same envelope as the exported file.
    expect(Object.keys(storage.data)).toEqual([LIBRARY_STORAGE_KEY]);
    expect(JSON.parse(storage.data[LIBRARY_STORAGE_KEY])).toMatchObject({ format: LIBRARY_FORMAT, schema: 1 });
    const loaded = loadLibrary(storage);
    expect(loaded.status).toBe('ok');
    expect(loaded.lib).toEqual(lib);
  });

  it('an empty storage gives an empty library', () => {
    expect(loadLibrary(fakeStorage())).toEqual({ lib: emptyLibrary(), status: 'empty', skipped: [] });
  });

  it('a blocked or missing storage never throws: the library is empty and saving says it failed', () => {
    const blocked = fakeStorage({ blocked: true });
    expect(loadLibrary(blocked).status).toBe('unavailable');
    expect(saveLibrary(fullLibrary(), blocked)).toBe('failed');
    expect(loadLibrary(null).status).toBe('unavailable');
    expect(saveLibrary(fullLibrary(), null)).toBe('failed');
    // Under test there is no window: the default is "no storage", not an exception.
    expect(loadLibrary().status).toBe('unavailable');
  });

  it('damaged text gives an empty library and the damaged text is kept apart before it is overwritten', () => {
    const storage = fakeStorage();
    storage.data[LIBRARY_STORAGE_KEY] = '{"format":"repackshot-library","schema":1,"items":[';
    const r = loadLibrary(storage);
    expect(r.status).toBe('corrupt');
    expect(r.lib).toEqual(emptyLibrary());
    expect(storage.data[`${LIBRARY_STORAGE_KEY}.corrupt`]).toBe('{"format":"repackshot-library","schema":1,"items":[');
  });

  it('one invalid item in the storage does not lose the others', () => {
    const storage = fakeStorage();
    const file = parse(fullLibrary());
    storage.data[LIBRARY_STORAGE_KEY] = JSON.stringify({ ...file, items: [{ ...file.items[0], family: 1, material: 5 }, ...file.items.slice(1)] });
    const r = loadLibrary(storage);
    expect(r.status).toBe('ok');
    expect(allItems(r.lib).map((i) => i.kind)).toEqual(['lightSetup', 'productType', 'studio']);
    expect(r.skipped).toHaveLength(1);
    expect(storage.data[`${LIBRARY_STORAGE_KEY}.corrupt`]).toBeDefined();
  });

  it('a full storage keeps the library without its pictures instead of losing it', () => {
    const lib = fullLibrary();
    const withPics = exportLibrary(lib).length;
    const storage = fakeStorage({ quota: withPics - 10 });
    expect(saveLibrary(lib, storage)).toBe('no-thumbs');
    const loaded = loadLibrary(storage).lib;
    expect(allItems(loaded).map((i) => i.id)).toEqual(allItems(lib).map((i) => i.id));
    expect(allItems(loaded).every((i) => i.thumb === undefined)).toBe(true);
    expect(loaded.materials[0].material).toEqual(lib.materials[0].material);
    // And when even that does not fit, it says so.
    expect(saveLibrary(lib, fakeStorage({ quota: 100 }))).toBe('failed');
  });

  it('an own setup in a saved library still applies to a project after the reload', () => {
    const storage = fakeStorage();
    const lib = fullLibrary();
    saveLibrary(lib, storage);
    const back = loadLibrary(storage).lib;
    const setup = itemsOf(back, 'lightSetup')[0];
    const s = apply(exampleState(), { type: 'studio/setPreset', key: 'WATCH' }, { type: 'studio/applySetup', setup: customSetupOf(setup) });
    expect(s.studio.lights).toHaveLength(setup.lights.length);
  });

  it('items keep the order they were added in', () => {
    const storage = fakeStorage();
    let lib = emptyLibrary();
    const s = exampleState();
    const inst = s.materials[s.scene.nodes[keyIds(s).cap].material!];
    for (const name of ['C', 'A', 'B']) lib = addItem(lib, fromMaterialInstance(lib, inst, name, { now: NOW }));
    saveLibrary(lib, storage);
    expect(itemsOf(loadLibrary(storage).lib, 'material').map((m) => m.name)).toEqual(['C', 'A', 'B']);
    const types: LibraryItem['kind'][] = allItems(lib).map((i) => i.kind);
    expect(types).toEqual(['material', 'material', 'material']);
  });
});

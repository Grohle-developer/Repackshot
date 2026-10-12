import { describe, expect, it } from 'vitest';
import { assignAction, inventoryFor, materialInventory } from '../src/core/materials';
import { createInitialState, createStore, reduce, type Action } from '../src/core/store';
import { partsUnder } from '../src/core/scene';
import { exampleState, exampleStore, keyIds } from './helpers';

const presetOf = (state: ReturnType<typeof exampleState>, partId: string): string | null => {
  const m = state.scene.nodes[partId].material;
  return m ? (state.materials[m].preset ?? state.materials[m].origin) : null;
};

describe('material assignment by level', () => {
  it('MODEL: reaches every part', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = reduce(s, { type: 'scene/select', ids: [ids.model], mode: 'set', level: 'MODEL' });
    s = reduce(s, assignAction(s, { preset: 'GOLD' }));
    for (const k of ['base', 'body', 'label', 'collar', 'cap']) expect(presetOf(s, ids[k])).toBe('GOLD');
  });

  it('GROUP: reaches the parts of the group only', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = reduce(s, { type: 'scene/select', ids: [ids.closure], mode: 'set', level: 'GROUP' });
    s = reduce(s, assignAction(s, { preset: 'GOLD' }));
    expect(presetOf(s, ids.collar)).toBe('GOLD');
    expect(presetOf(s, ids.cap)).toBe('GOLD');
    expect(presetOf(s, ids.body)).toBe('PAINT_MET');
  });

  it('PART: reaches one part', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = reduce(s, { type: 'scene/select', ids: [ids.body], mode: 'set', level: 'PART' });
    s = reduce(s, assignAction(s, { preset: 'COPPER' }));
    expect(presetOf(s, ids.body)).toBe('COPPER');
    expect(presetOf(s, ids.cap)).toBe('GOLD');
  });

  it('FACES: writes triangle ranges on the part', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = reduce(s, { type: 'scene/selectFaces', part: ids.body, indices: [4, 5, 6, 10], mode: 'set' });
    expect(s.selection.level).toBe('FACES');
    s = reduce(s, assignAction(s, { preset: 'RUBBER' }));
    const body = s.scene.nodes[ids.body];
    expect(presetOf(s, ids.body)).toBe('PAINT_MET');
    expect(body.faceMaterials?.map((f) => [f.start, f.count])).toEqual([[4, 3], [10, 1]]);
    expect(s.materials[body.faceMaterials![0].material].preset).toBe('RUBBER');
  });

  it('reuses the instance of an unedited preset', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = reduce(s, assignAction(s, { preset: 'GOLD' }, 'REPLACE', [ids.body]));
    expect(s.scene.nodes[ids.body].material).toBe(s.scene.nodes[ids.cap].material);
  });
});

describe('overwrite inventory', () => {
  it('asks when the target holds different materials', () => {
    const s = exampleState();
    const ids = keyIds(s);
    const inv = materialInventory(s, partsUnder(s, [ids.closure]));
    expect(inv.needsConfirm).toBe(true);
    expect(inv.entries).toHaveLength(2);
  });

  it('does not ask when they are equal', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = reduce(s, assignAction(s, { preset: 'CHROME' }, 'REPLACE', [ids.cap]));
    const action = assignAction(s, { preset: 'GOLD' }, 'REPLACE', [ids.closure]);
    expect(inventoryFor(s, action).needsConfirm).toBe(false);
    expect(inventoryFor(s, action).entries).toHaveLength(1);
  });

  it('KEEP only fills parts without a material', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = { ...s, scene: { ...s.scene, nodes: { ...s.scene.nodes, [ids.cap]: { ...s.scene.nodes[ids.cap], material: null } } } };
    s = reduce(s, assignAction(s, { preset: 'BRASS' }, 'KEEP', [ids.closure]));
    expect(presetOf(s, ids.cap)).toBe('BRASS');
    expect(presetOf(s, ids.collar)).toBe('CHROME');
  });
});

describe('store', () => {
  it('undoes and redoes a sequence of ten actions in order', () => {
    const { store, ids } = exampleStore();
    const states = [store.get()];
    const actions: Action[] = [
      { type: 'studio/setPreset', key: 'JEWELLERY', label: 'Product type' },
      { type: 'studio/build', label: 'Create studio' },
      { type: 'studio/setSetup', key: 'REMBRANDT', label: 'Setup' },
      { ...assignAction(store.get(), { preset: 'GOLD' }), label: 'Gold' },
      { type: 'scene/rename', id: ids.body, name: 'Flask', label: 'Rename' },
      { type: 'scene/setVisible', ids: [ids.label], visible: false, label: 'Hide' },
      { type: 'camera/view', view: 'FRONT', label: 'View' },
      { type: 'image/set', patch: { exposureEv: 0.5 }, label: 'Exposure' },
      { type: 'env/set', patch: { rotationDeg: 45 }, label: 'Rotate' },
      { type: 'render/quality', quality: 'FINAL', label: 'Quality' },
    ];
    for (const a of actions) {
      store.dispatch(a);
      states.push(store.get());
    }
    expect(store.history().undo).toHaveLength(10);
    expect(store.history().undo[0]).toBe('Quality');
    for (let i = 9; i >= 0; i--) {
      store.undo();
      expect(store.get().scene).toBe(states[i].scene);
      expect(store.get().materials).toBe(states[i].materials);
      expect(store.get().studio).toBe(states[i].studio);
      expect(store.get().camera).toBe(states[i].camera);
      expect(store.get().image).toBe(states[i].image);
    }
    expect(store.history().undo).toHaveLength(0);
    expect(store.history().redo).toHaveLength(10);
    for (let i = 1; i <= 10; i++) {
      store.redo();
      expect(store.get().scene).toBe(states[i].scene);
      expect(store.get().render.quality).toBe(states[i].render.quality);
      expect(store.get().environment).toBe(states[i].environment);
    }
  });

  it('keeps language, theme and selection out of the history', () => {
    const { store, ids } = exampleStore();
    store.dispatch({ type: 'meta/lang', lang: 'es' });
    store.dispatch({ type: 'scene/select', ids: [ids.body], mode: 'set' });
    expect(store.history().undo).toHaveLength(0);
    store.dispatch({ type: 'image/set', patch: { exposureEv: 1 }, label: { en: 'Exposure', es: 'Exposición' } });
    expect(store.history().undo).toEqual(['Exposición']);
    store.undo();
    expect(store.get().meta.lang).toBe('es');
    expect(store.get().selection.ids).toEqual([ids.body]);
  });

  it('transaction leaves a single entry', () => {
    const { store } = exampleStore();
    store.transaction('Studio', () => {
      store.dispatch({ type: 'studio/setPreset', key: 'WATCH' });
      store.dispatch({ type: 'studio/build' });
      store.dispatch({ type: 'studio/setSetup', key: 'WRAP' });
    });
    expect(store.history().undo).toEqual(['Studio']);
    store.undo();
    expect(store.get().studio.preset).toBe('GENERIC');
    expect(store.get().studio.lightSetup).toBe('PRESET');
  });

  it('collapses a gesture into one entry', () => {
    const { store } = exampleStore();
    for (let i = 1; i <= 20; i++) store.dispatch({ type: 'image/set', patch: { exposureEv: i / 10 }, gesture: 'drag-1', label: 'Exposure' });
    store.dispatch({ type: 'image/set', patch: { exposureEv: 3 }, gesture: 'drag-2', label: 'Exposure' });
    expect(store.history().undo).toHaveLength(2);
    store.undo();
    expect(store.get().image.exposureEv).toBe(2);
    store.undo();
    expect(store.get().image.exposureEv).toBe(0);
  });

  it('marks the project dirty on a change, not on volatile actions', () => {
    const store = createStore(createInitialState());
    store.dispatch({ type: 'meta/theme', theme: 'light' });
    expect(store.get().meta.dirty).toBe(false);
    store.dispatch({ type: 'meta/rename', name: 'Demo' });
    expect(store.get().meta.dirty).toBe(true);
    store.dispatch({ type: 'meta/saved' });
    expect(store.get().meta.dirty).toBe(false);
  });

  it('notifies subscribers with state, previous state and action', () => {
    const { store } = exampleStore();
    const seen: string[] = [];
    const off = store.subscribe((s, prev, a) => {
      expect(s).not.toBe(prev);
      seen.push(a.type);
    });
    store.dispatch({ type: 'image/set', patch: { exposureEv: 1 } });
    store.dispatch({ type: 'image/set', patch: { exposureEv: 1 } }); // no change, no notification
    store.undo();
    off();
    store.redo();
    expect(seen).toEqual(['image/set', 'history/undo']);
  });

  it('serialises round trip', () => {
    const { store, ids } = exampleStore();
    store.dispatch({ type: 'studio/setPreset', key: 'JEWELLERY' });
    store.dispatch({ type: 'studio/build' });
    store.dispatch({ type: 'studio/setSetup', key: 'REMBRANDT' });
    store.dispatch({ type: 'studio/save', name: 'Hero' });
    store.dispatch({ type: 'anim/preset', key: 'HERO' });
    store.dispatch({ type: 'scene/selectFaces', part: ids.body, indices: [1, 2], mode: 'set' });
    store.dispatch(assignAction(store.get(), { preset: 'GOLD' }));
    store.dispatch({ type: 'render/enqueue', name: 'Job' });
    const s = store.get();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

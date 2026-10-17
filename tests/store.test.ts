import { describe, expect, it } from 'vitest';
import { assignAction, inventoryFor, materialInventory } from '../src/core/materials';
import { createInitialState, createStore, reduce, type Action } from '../src/core/store';
import { partsUnder } from '../src/core/scene';
import { studioRig } from '../src/core/rig';
import { buildExample } from '../src/core/example';
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
    store.dispatch({ type: 'render/enqueue', at: 1, position: 'LAST' });
    const s = store.get();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('revision and the unsaved changes (phase U2)', () => {
  const edit = (store: ReturnType<typeof createStore>, ev: number) => store.dispatch({ type: 'image/set', patch: { exposureEv: ev }, label: 'Exposure' });

  it('a counter, not a comparison: a change moves it, volatile actions and no-ops do not', () => {
    const store = createStore(createInitialState());
    const r0 = store.revision();
    store.dispatch({ type: 'meta/theme', theme: 'light' });
    store.dispatch({ type: 'scene/select', ids: [], mode: 'set', level: 'PART' });
    edit(store, 0); // already 0: nothing changes
    expect(store.revision()).toBe(r0);
    edit(store, 1);
    const r1 = store.revision();
    expect(r1).not.toBe(r0);
    edit(store, 2);
    expect(store.revision()).not.toBe(r1);
  });

  it('undoing back to the saved state leaves no dot; going past it, or editing after it, does', () => {
    const store = createStore(createInitialState());
    edit(store, 1);
    edit(store, 2);
    store.dispatch({ type: 'meta/saved' });
    expect(store.get().meta.dirty).toBe(false);
    edit(store, 3);
    expect(store.get().meta.dirty).toBe(true);
    store.undo(); // back to what was saved
    expect(store.get().meta.dirty).toBe(false);
    store.undo(); // before it
    expect(store.get().meta.dirty).toBe(true);
    store.redo(); // the saved state again
    expect(store.get().meta.dirty).toBe(false);
    store.redo();
    expect(store.get().meta.dirty).toBe(true);
    // A different change after undoing is not the saved state, even though the history has the same length.
    store.undo();
    expect(store.get().meta.dirty).toBe(false);
    edit(store, 9);
    expect(store.get().meta.dirty).toBe(true);
    store.undo();
    expect(store.get().meta.dirty).toBe(false);
  });

  it('a project that was never changed is clean, also after undo and redo of nothing', () => {
    const store = createStore({ ...createInitialState(), meta: { ...createInitialState().meta, dirty: true } });
    expect(store.get().meta.dirty).toBe(false);
    edit(store, 1);
    store.undo();
    expect(store.get().meta.dirty).toBe(false);
  });

  it('a save names the revision it wrote: changes made while the file was being written stay unsaved', () => {
    const store = createStore(createInitialState());
    edit(store, 1);
    const written = store.revision();
    edit(store, 2); // the person kept working during the dialog
    store.dispatch({ type: 'meta/saved', revision: written });
    expect(store.get().meta.dirty).toBe(true);
    store.undo(); // back to what the file holds
    expect(store.get().meta.dirty).toBe(false);
    store.redo();
    expect(store.get().meta.dirty).toBe(true);
    store.dispatch({ type: 'meta/saved' });
    expect(store.get().meta.dirty).toBe(false);
  });

  it('a gesture and a transaction are one step for the revision too', () => {
    const store = createStore(createInitialState());
    store.dispatch({ type: 'meta/saved' });
    for (let i = 1; i <= 5; i++) store.dispatch({ type: 'image/set', patch: { exposureEv: i }, gesture: 'drag', label: 'Exposure' });
    expect(store.get().meta.dirty).toBe(true);
    store.undo();
    expect(store.get().meta.dirty).toBe(false);
    store.transaction('Two edits', () => {
      edit(store, 1);
      store.dispatch({ type: 'image/set', patch: { bloom: 0.3 } });
    });
    expect(store.get().meta.dirty).toBe(true);
    store.undo();
    expect(store.get().meta.dirty).toBe(false);
    expect(store.get().image.exposureEv).toBe(0);
  });

  it('a gesture that goes on after a save is a change after it, also when undone and redone', () => {
    const store = createStore(createInitialState());
    store.dispatch({ type: 'image/set', patch: { exposureEv: 1 }, gesture: 'drag', label: 'Exposure' });
    store.dispatch({ type: 'meta/saved' }); // saved in the middle of the drag
    expect(store.get().meta.dirty).toBe(false);
    store.dispatch({ type: 'image/set', patch: { exposureEv: 2 }, gesture: 'drag', label: 'Exposure' });
    expect(store.get().meta.dirty).toBe(true);
    store.undo();
    expect(store.get().image.exposureEv).toBe(0);
    expect(store.get().meta.dirty).toBe(true);
    store.redo();
    expect(store.get().image.exposureEv).toBe(2);
    expect(store.get().meta.dirty).toBe(true);
  });

  it('reset (New, Open) starts a clean baseline with a revision of its own and no history', () => {
    const store = createStore(createInitialState());
    edit(store, 1);
    const before = store.revision();
    store.reset({ ...createInitialState(), meta: { ...createInitialState().meta, dirty: true, name: 'Opened' } });
    expect(store.get().meta).toMatchObject({ name: 'Opened', dirty: false });
    expect(store.revision()).not.toBe(before);
    expect(store.history()).toEqual({ undo: [], redo: [] });
    edit(store, 2);
    expect(store.get().meta.dirty).toBe(true);
    store.undo();
    expect(store.get().meta.dirty).toBe(false);
  });

  it('volatile state moving with an undo does not lose the dot: language and theme stay, dirty follows the revision', () => {
    const store = createStore(createInitialState());
    edit(store, 1);
    store.dispatch({ type: 'meta/lang', lang: 'es' });
    store.dispatch({ type: 'meta/saved' });
    edit(store, 2);
    store.dispatch({ type: 'meta/theme', theme: 'light' });
    store.undo();
    expect([store.get().meta.lang, store.get().meta.theme, store.get().meta.dirty]).toEqual(['es', 'light', false]);
  });
});

describe('boot state (Standard mode)', () => {
  it('starts with the GENERIC studio already built', () => {
    const s = createInitialState();
    expect(s.studio.preset).toBe('GENERIC');
    expect(s.studio.built).toBe(true);
    expect(s.studio.lightSetup).toBe('PRESET');
    expect(s.studio.lights.map((l) => [l.role, l.power])).toEqual(studioRig('GENERIC').map((r) => [r.role, r.energy]));
    expect(s.environment.kind).toBe('STUDIO');
    expect(s.environment.strength).toBe(0.6);
    expect(s.render.quality).toBe('PREVIEW');
    expect([s.render.width, s.render.height]).toEqual([1920, 1080]);
    const cam = s.camera.cameras[s.camera.active];
    expect([cam.focalMm, cam.fstop, cam.azimuth, cam.elevation]).toEqual([85, 5.6, -35, 22]);
    expect(s.meta.dirty).toBe(false);
  });

  it('cannot be undone, and the example loads on top of it', () => {
    const store = createStore(createInitialState());
    store.undo();
    expect(store.get().studio.built).toBe(true);
    expect(store.history().undo).toEqual([]);
    store.transaction('Load example', () => {
      store.dispatch({ type: 'scene/addModel', payload: buildExample(), replace: true });
      store.dispatch({ type: 'camera/frame' });
    });
    expect(store.get().scene.partSizeMm).toBeCloseTo(121, 2);
    store.undo();
    store.undo();
    expect(store.get().scene.roots).toEqual([]);
    expect(store.get().studio.built).toBe(true);
  });
});

describe('history notifications', () => {
  it('a closed transaction notifies once its entry is in the history', () => {
    const { store } = exampleStore();
    const seen: string[][] = [];
    store.subscribe((_s, _p, a) => a.type === 'history/commit' && seen.push(store.history().undo));
    store.transaction('Two steps', () => {
      store.dispatch({ type: 'image/set', patch: { exposureEv: 1 } });
      store.dispatch({ type: 'image/set', patch: { exposureEv: 2 } });
    });
    expect(seen).toEqual([['Two steps']]);
  });
});

describe('what a listener dispatches while it is told of a history move', () => {
  // D1: the Doctor asks for its findings to be run again after an undo, from the store's own listener. The action
  // waits for the notification to end; it used to wait for the next dispatch, which could be much later.
  const listening = (which: 'history/undo' | 'history/redo' | 'history/reset' | 'history/commit') => {
    const { store } = exampleStore();
    store.dispatch({ type: 'image/set', patch: { exposureEv: 1 } });
    store.dispatch({ type: 'image/set', patch: { exposureEv: 2 } });
    store.subscribe((_s, _p, a) => {
      if (a.type === which) store.dispatch({ type: 'image/set', patch: { bloom: 0.5 } });
    });
    return store;
  };

  it('is applied at once after an undo', () => {
    const store = listening('history/undo');
    store.undo();
    expect(store.get().image).toMatchObject({ exposureEv: 1, bloom: 0.5 });
  });

  it('is applied at once after a redo', () => {
    const store = listening('history/redo');
    store.undo();
    store.redo();
    expect(store.get().image).toMatchObject({ exposureEv: 2, bloom: 0.5 });
  });

  it('is applied at once after a reset and after a closed transaction', () => {
    const reset = listening('history/reset');
    reset.reset(exampleState());
    expect(reset.get().image.bloom).toBe(0.5);
    const tx = listening('history/commit');
    tx.transaction('Two steps', () => {
      tx.dispatch({ type: 'image/set', patch: { exposureEv: 3 } });
      tx.dispatch({ type: 'image/set', patch: { exposureEv: 4 } });
    });
    expect(tx.get().image).toMatchObject({ exposureEv: 4, bloom: 0.5 });
  });
});

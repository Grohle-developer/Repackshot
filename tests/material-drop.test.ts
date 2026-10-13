// Dropping a material on a part of the viewport or a row of the tree (UI.md §2.2, §2.3; phase U7): where a drop
// lands at each selection level, what it assigns (a preset or a library item: the instance the scene has; an
// instance: that instance, linked; with Alt: a copy of its own), that it is one undo entry named "Assign Gold to
// Body", that it never makes an empty entry, and that it asks before overwriting different materials.
// The pointer itself (the ghost, the outline, Esc) is checked in the browser by tools/material-drag-check.mjs.

import { describe, expect, it } from 'vitest';
import { buildExample } from '../src/core/example';
import { fromMaterialInstance, addItem, emptyLibrary, instanceFromItem } from '../src/core/library';
import { dropAction, dropNodes, treeDropTarget, viewportDropTarget, type DropTarget } from '../src/core/material-drop';
import { instanceFromPreset, partMaterials } from '../src/core/materials';
import { createInitialState, createStore, reduce, type ProjectState } from '../src/core/store';
import { sharesMaterial } from '../src/core/transform';
import * as cmd from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { cadBox, sceneWith } from './cad-fixtures';
import { apply, keyIds } from './helpers';

const NAMES = { model: 'Bottle', closure: 'Closure', base: 'Base', body: 'Body', label: 'Label', collar: 'Collar', cap: 'Cap' };

function bottle(): ProjectState {
  return reduce(createInitialState(), { type: 'scene/addModel', payload: buildExample(NAMES), replace: true });
}

function makeCtx(state: ProjectState = bottle()): Ctx {
  const services = { viewport: null } as unknown as AppServices;
  return { store: createStore(state), ui: createUiStore(), services };
}

const part = (ctx: Ctx, key: string) => ctx.store.get().scene.nodes[keyIds(ctx.store.get())[key]];
const presetOf = (s: ProjectState, id: string | null | undefined) => (id ? s.materials[id]?.preset : undefined);

describe('where a drop lands in the viewport', () => {
  const s = bottle();
  const k = keyIds(s);

  it('at the Part level, on the part under the pointer', () => {
    expect(viewportDropTarget(s, { node: k.cap, face: 3 }, 'PART')).toEqual({ kind: 'nodes', ids: [k.cap] });
    expect(viewportDropTarget(s, { node: k.body, face: 0 }, 'PART')).toEqual({ kind: 'nodes', ids: [k.body] });
  });

  it('at the Group level, on the assembly (the part itself when it has none); at Model, on the model', () => {
    expect(viewportDropTarget(s, { node: k.cap, face: 3 }, 'GROUP')).toEqual({ kind: 'nodes', ids: [k.closure] });
    expect(viewportDropTarget(s, { node: k.body, face: 3 }, 'GROUP')).toEqual({ kind: 'nodes', ids: [k.body] });
    expect(viewportDropTarget(s, { node: k.cap, face: 3 }, 'MODEL')).toEqual({ kind: 'nodes', ids: [k.model] });
  });

  it('at the Faces level, on the whole face under the pointer: the CAD face of a STEP part', () => {
    const cad = sceneWith(cadBox());
    // The faces of the box are pairs of triangles: triangle 3 is in the second face, triangle 10 in the last.
    expect(viewportDropTarget(cad.state, { node: cad.part, face: 3 }, 'FACES')).toEqual({ kind: 'faces', part: cad.part, indices: [2, 3] });
    expect(viewportDropTarget(cad.state, { node: cad.part, face: 10 }, 'FACES')).toEqual({ kind: 'faces', part: cad.part, indices: [10, 11] });
  });

  it('at the Faces level, a mesh without CAD faces gives the surface that continues, containing the triangle', () => {
    const t = viewportDropTarget(s, { node: k.body, face: 40 }, 'FACES');
    expect(t?.kind).toBe('faces');
    if (t?.kind !== 'faces') return;
    expect(t.part).toBe(k.body);
    expect(t.indices).toContain(40);
    expect([...t.indices].sort((a, b) => a - b)).toEqual(t.indices);
    expect(t.indices.length).toBeGreaterThanOrEqual(1);
  });

  it('on nothing, a node that is not a part, or a part that is gone: nowhere', () => {
    expect(viewportDropTarget(s, null, 'PART')).toBeNull();
    expect(viewportDropTarget(s, { node: k.closure, face: 0 }, 'PART')).toBeNull();
    expect(viewportDropTarget(s, { node: 'ghost', face: 0 }, 'FACES')).toBeNull();
  });
});

describe('where a drop lands in the tree', () => {
  const s = bottle();
  const k = keyIds(s);

  it('a part, a group and the model take it; what is under them goes with them', () => {
    expect(treeDropTarget(s, k.cap)).toEqual({ kind: 'nodes', ids: [k.cap] });
    expect(treeDropTarget(s, k.closure)).toEqual({ kind: 'nodes', ids: [k.closure] });
    expect(treeDropTarget(s, k.model)).toEqual({ kind: 'nodes', ids: [k.model] });
  });

  it('a group with no part under it, and ids that are no node (a light, a camera), take nothing', () => {
    const empty = apply(s, { type: 'scene/delete', ids: [k.collar, k.cap] });
    expect(empty.scene.nodes[k.closure].children).toEqual([]);
    expect(treeDropTarget(empty, k.closure)).toBeNull();
    expect(treeDropTarget(s, 'cam1')).toBeNull();
    expect(treeDropTarget(s, s.studio.lights[0].id)).toBeNull();
  });
});

describe('what a drop assigns', () => {
  it('a preset on a part is "Assign Gold to Body": one action, one undo entry, and undo gives the project back', () => {
    setLang('en');
    const ctx = makeCtx();
    const before = ctx.store.get();
    const body = part(ctx, 'body');
    const target: DropTarget = { kind: 'nodes', ids: [body.id] };
    expect(cmd.requestDrop(ctx, { preset: 'GOLD' }, target)).toBeNull();
    expect(ctx.store.history().undo).toEqual(['Assign Gold to Body']);
    expect(presetOf(ctx.store.get(), part(ctx, 'body').material)).toBe('GOLD');
    ctx.store.undo();
    expect(ctx.store.get().scene).toBe(before.scene);
    expect(ctx.store.get().materials).toBe(before.materials);
    ctx.store.redo();
    expect(presetOf(ctx.store.get(), part(ctx, 'body').material)).toBe('GOLD');
  });

  it('a drop leaves the same project a click on the thumbnail leaves: the instance the scene has of the preset', () => {
    const viaDrop = makeCtx();
    const viaClick = makeCtx();
    const cap = part(viaDrop, 'cap').id;
    cmd.requestDrop(viaDrop, { preset: 'CHROME' }, { kind: 'nodes', ids: [cap] });
    cmd.requestAssign(viaClick, { preset: 'CHROME' }, [cap]);
    expect(viaDrop.store.get().scene.nodes).toEqual(viaClick.store.get().scene.nodes);
    expect(viaDrop.store.get().materials).toEqual(viaClick.store.get().materials);
    // The collar already carries chrome: the cap takes that instance, linked to it, and no third one is made.
    const s = viaDrop.store.get();
    expect(s.scene.nodes[cap].material).toBe(s.scene.nodes[keyIds(s).collar].material);
    expect(Object.values(s.materials).filter((m) => m.preset === 'CHROME')).toHaveLength(1);
  });

  it('an instance dropped on a part links it: the part takes that very instance', () => {
    const ctx = makeCtx();
    const k = keyIds(ctx.store.get());
    const gold = part(ctx, 'cap').material!;
    expect(cmd.requestDrop(ctx, { material: gold }, { kind: 'nodes', ids: [k.body] })).toBeNull();
    const s = ctx.store.get();
    expect(s.scene.nodes[k.body].material).toBe(gold);
    expect(sharesMaterial(s, [k.body])).toBe(true);
    expect(ctx.store.history().undo).toEqual(['Assign Gold to Body']);
    // Editing the shared instance changes both parts: that is what linked means.
    const edited = apply(s, { type: 'material/setParam', id: gold, key: 'roughness', value: 0.9 });
    expect(edited.materials[edited.scene.nodes[k.body].material!].params.roughness).toBe(0.9);
    expect(edited.materials[edited.scene.nodes[k.cap].material!].params.roughness).toBe(0.9);
  });

  it('with Alt, an instance is copied: the part gets a new one of its own, equal at first, linked to nothing', () => {
    const ctx = makeCtx();
    const k = keyIds(ctx.store.get());
    const gold = part(ctx, 'cap').material!;
    cmd.requestDrop(ctx, { material: gold }, { kind: 'nodes', ids: [k.body] }, true);
    const s = ctx.store.get();
    const own = s.scene.nodes[k.body].material!;
    expect(own).not.toBe(gold);
    expect(s.materials[own].params).toEqual(s.materials[gold].params);
    expect(s.materials[own].params).not.toBe(s.materials[gold].params);
    expect(sharesMaterial(s, [k.body])).toBe(false);
    expect(ctx.store.history().undo).toEqual(['Assign a copy of Gold to Body']);
    // Editing the copy leaves the original alone.
    const edited = apply(s, { type: 'material/setParam', id: own, key: 'roughness', value: 0.9 });
    expect(edited.materials[gold].params.roughness).toBe(s.materials[gold].params.roughness);
  });

  it('with Alt, a preset is a new instance each time, never the one the scene has', () => {
    const ctx = makeCtx();
    const k = keyIds(ctx.store.get());
    cmd.requestDrop(ctx, { preset: 'GOLD' }, { kind: 'nodes', ids: [k.body] }, true);
    cmd.requestDrop(ctx, { preset: 'GOLD' }, { kind: 'nodes', ids: [k.label] }, true);
    const s = ctx.store.get();
    const ids = [k.cap, k.body, k.label].map((id) => s.scene.nodes[id].material!);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(s.materials[id].preset).toBe('GOLD');
    expect(ctx.store.history().undo).toEqual(['Assign a copy of Gold to Label', 'Assign a copy of Gold to Body']);
  });

  it('with Alt, a library item is a new instance that remembers its item', () => {
    const ctx = makeCtx();
    const mat = instanceFromPreset('m_x', 'COPPER', 200)!;
    const item = fromMaterialInstance(emptyLibrary(), mat, 'My copper', { now: 1, id: 'lib1' });
    ctx.ui.set({ library: addItem(emptyLibrary(), item) });
    const k = keyIds(ctx.store.get());
    cmd.requestDrop(ctx, { library: 'lib1' }, { kind: 'nodes', ids: [k.body] });
    cmd.requestDrop(ctx, { library: 'lib1' }, { kind: 'nodes', ids: [k.label] });
    let s = ctx.store.get();
    expect(s.scene.nodes[k.body].material).toBe(s.scene.nodes[k.label].material);
    expect(s.materials[s.scene.nodes[k.body].material!].library).toBe('lib1');
    cmd.requestDrop(ctx, { library: 'lib1' }, { kind: 'nodes', ids: [k.cap] }, true);
    s = ctx.store.get();
    expect(s.scene.nodes[k.cap].material).not.toBe(s.scene.nodes[k.body].material);
    expect(s.materials[s.scene.nodes[k.cap].material!].library).toBe('lib1');
    expect(instanceFromItem(item).params).toEqual(s.materials[s.scene.nodes[k.cap].material!].params);
  });

  it('on a group it reaches every part in it, in one action', () => {
    const ctx = makeCtx();
    const k = keyIds(ctx.store.get());
    // The closure holds a chrome collar and a gold cap: different materials, so it asks first (UI.md §4.1).
    const spec = cmd.requestDrop(ctx, { preset: 'RUBBER' }, { kind: 'nodes', ids: [k.closure] });
    expect(spec).not.toBeNull();
    expect(ctx.store.history().undo).toEqual([]);
    expect(spec!.message).toContain('Closure contains 2 materials');
    spec!.options[0].run();
    const s = ctx.store.get();
    expect(presetOf(s, s.scene.nodes[k.collar].material)).toBe('RUBBER');
    expect(presetOf(s, s.scene.nodes[k.cap].material)).toBe('RUBBER');
    expect(s.scene.nodes[k.collar].material).toBe(s.scene.nodes[k.cap].material);
    expect(ctx.store.history().undo).toEqual(['Assign Rubber to Closure']);
    ctx.store.undo();
    expect(presetOf(ctx.store.get(), ctx.store.get().scene.nodes[k.cap].material)).toBe('GOLD');
    expect(presetOf(ctx.store.get(), ctx.store.get().scene.nodes[k.collar].material)).toBe('CHROME');
  });

  it('"keep the existing ones" fills only the parts that have none', () => {
    const base = bottle();
    const k = keyIds(base);
    const withNone = { ...base, scene: { ...base.scene, nodes: { ...base.scene.nodes, [k.cap]: { ...base.scene.nodes[k.cap], material: null } } } };
    const ctx = makeCtx(withNone);
    const spec = cmd.requestDrop(ctx, { preset: 'RUBBER' }, { kind: 'nodes', ids: [k.model] });
    expect(spec).not.toBeNull();
    spec!.options[1].run();
    const s = ctx.store.get();
    expect(presetOf(s, s.scene.nodes[k.cap].material)).toBe('RUBBER');
    expect(presetOf(s, s.scene.nodes[k.body].material)).toBe('PAINT_MET');
    expect(ctx.store.history().undo).toHaveLength(1);
  });

  it('on a model it reaches every part', () => {
    const ctx = makeCtx();
    const k = keyIds(ctx.store.get());
    const spec = cmd.requestDrop(ctx, { preset: 'CERAMIC' }, { kind: 'nodes', ids: [k.model] });
    spec!.options[0].run();
    const s = ctx.store.get();
    for (const key of ['base', 'body', 'label', 'collar', 'cap']) expect(presetOf(s, s.scene.nodes[k[key]].material)).toBe('CERAMIC');
    expect(Object.values(s.materials).filter((m) => m.preset === 'CERAMIC')).toHaveLength(1);
  });

  it('on the faces of a part it assigns to those triangles only, as "1 face of Box"', () => {
    const cad = sceneWith(cadBox());
    const ctx = makeCtx(cad.state);
    const before = ctx.store.get();
    const target = viewportDropTarget(before, { node: cad.part, face: 3 }, 'FACES')!;
    expect(cmd.requestDrop(ctx, { preset: 'CHROME' }, target)).toBeNull();
    const s = ctx.store.get();
    const node = s.scene.nodes[cad.part];
    expect(node.faceMaterials).toEqual([{ start: 2, count: 2, material: node.faceMaterials![0].material }]);
    expect(s.materials[node.faceMaterials![0].material].preset).toBe('CHROME');
    expect(partMaterials(node)).toHaveLength(2);
    expect(node.material).toBe(before.scene.nodes[cad.part].material);
    expect(ctx.store.history().undo).toEqual(['Assign Polished chrome to 1 face of Box']);
    ctx.store.undo();
    expect(ctx.store.get().scene).toBe(before.scene);
  });

  it('the same material on the same target changes nothing, and leaves no undo entry', () => {
    const ctx = makeCtx();
    const k = keyIds(ctx.store.get());
    const before = ctx.store.get();
    expect(cmd.requestDrop(ctx, { preset: 'GOLD' }, { kind: 'nodes', ids: [k.cap] })).toBeNull();
    expect(cmd.requestDrop(ctx, { material: part(ctx, 'cap').material! }, { kind: 'nodes', ids: [k.cap] })).toBeNull();
    expect(ctx.store.get()).toBe(before);
    expect(ctx.store.history().undo).toEqual([]);
    // On faces already carrying it, too.
    const cad = sceneWith(cadBox());
    const c2 = makeCtx(cad.state);
    const faces: DropTarget = { kind: 'faces', part: cad.part, indices: [2, 3] };
    cmd.requestDrop(c2, { preset: 'CHROME' }, faces);
    const once = c2.store.get();
    cmd.requestDrop(c2, { preset: 'CHROME' }, faces);
    expect(c2.store.get()).toBe(once);
    expect(c2.store.history().undo).toHaveLength(1);
  });

  it('what is gone is not dropped: a deleted library item, an unknown preset, an instance that no longer exists', () => {
    const ctx = makeCtx();
    const k = keyIds(ctx.store.get());
    const target: DropTarget = { kind: 'nodes', ids: [k.body] };
    expect(cmd.requestDrop(ctx, { library: 'nope' }, target)).toBeNull();
    expect(cmd.requestDrop(ctx, { preset: 'NOT_A_PRESET' }, target)).toBeNull();
    expect(cmd.requestDrop(ctx, { material: 'm999' }, target)).toBeNull();
    expect(cmd.requestDrop(ctx, {}, target)).toBeNull();
    expect(ctx.store.history().undo).toEqual([]);
  });

  it('the label is in both languages and follows the language switch', () => {
    const ctx = makeCtx();
    const k = keyIds(ctx.store.get());
    cmd.requestDrop(ctx, { preset: 'GOLD' }, { kind: 'nodes', ids: [k.body] });
    expect(ctx.store.history().undo).toEqual(['Assign Gold to Body']);
    ctx.store.dispatch({ type: 'meta/lang', lang: 'es' });
    expect(ctx.store.history().undo).toEqual(['Asignar Oro a Body']);
  });

  it('building the action: the targets, the faces, and the copy flag', () => {
    const faces: DropTarget = { kind: 'faces', part: 'p', indices: [4, 5] };
    expect(dropAction({ preset: 'GOLD' }, { kind: 'nodes', ids: ['a', 'b'] })).toEqual({ type: 'material/assign', preset: 'GOLD', targets: ['a', 'b'], mode: 'REPLACE' });
    expect(dropAction({ material: 'm1' }, faces, true)).toEqual({ type: 'material/assign', material: 'm1', targets: ['p'], faces: { part: 'p', indices: [4, 5] }, mode: 'REPLACE', copy: true });
    expect(dropNodes(faces)).toEqual(['p']);
    // The indices are copied: the action does not share the array of the target.
    expect(dropAction({ preset: 'GOLD' }, faces).faces!.indices).not.toBe(faces.indices);
  });

  it('parses the payload of a drag: preset, instance, library item; nothing else', () => {
    expect(cmd.parseMaterialDrag('preset:GOLD')).toEqual({ preset: 'GOLD' });
    expect(cmd.parseMaterialDrag('material:m3')).toEqual({ material: 'm3' });
    expect(cmd.parseMaterialDrag('library:abc')).toEqual({ library: 'abc' });
    expect(cmd.parseMaterialDrag('')).toBeNull();
    expect(cmd.parseMaterialDrag('file:x')).toBeNull();
  });
});

describe('the assignment itself', () => {
  it('assigning what a part already carries is the same state, so the store makes no entry', () => {
    const s = bottle();
    const k = keyIds(s);
    const cap = s.scene.nodes[k.cap].material!;
    expect(reduce(s, { type: 'material/assign', material: cap, targets: [k.cap], mode: 'REPLACE' })).toBe(s);
    expect(reduce(s, { type: 'material/assign', preset: 'GOLD', targets: [k.cap], mode: 'REPLACE' })).toBe(s);
    // Keeping the existing ones where every part has one is nothing to do either.
    expect(reduce(s, { type: 'material/assign', preset: 'CERAMIC', targets: [k.model], mode: 'KEEP' })).toBe(s);
    // A copy is never the same state: it is a new instance.
    expect(reduce(s, { type: 'material/assign', material: cap, targets: [k.cap], mode: 'REPLACE', copy: true })).not.toBe(s);
  });

  it('a copy names no instance the scene had, whatever the source, and an unknown source does nothing', () => {
    const s = bottle();
    const k = keyIds(s);
    const before = Object.keys(s.materials);
    for (const src of [{ preset: 'COPPER' }, { material: s.scene.nodes[k.collar].material! }]) {
      const t = reduce(s, { type: 'material/assign', ...src, targets: [k.body], mode: 'REPLACE', copy: true });
      const made = t.scene.nodes[k.body].material!;
      expect(before).not.toContain(made);
      expect(Object.keys(t.materials)).toHaveLength(Object.keys(s.materials).length);
    }
    expect(reduce(s, { type: 'material/assign', preset: 'NOT_A_PRESET', targets: [k.body], mode: 'REPLACE', copy: true })).toBe(s);
    expect(reduce(s, { type: 'material/assign', targets: [k.body], mode: 'REPLACE', copy: true })).toBe(s);
  });

  it('a copy on faces: the new instance is on those triangles only; the one the part had is pruned only when nothing uses it', () => {
    const cad = sceneWith(cadBox());
    const t = reduce(cad.state, { type: 'material/assign', preset: 'GOLD', targets: [cad.part], faces: { part: cad.part, indices: [0, 1] }, mode: 'REPLACE', copy: true });
    const node = t.scene.nodes[cad.part];
    expect(node.faceMaterials).toHaveLength(1);
    expect(node.faceMaterials![0].material).not.toBe(node.material);
    expect(t.materials[node.faceMaterials![0].material].preset).toBe('GOLD');
    expect(t.materials[node.material!].preset).toBe('GOLD');
  });
});

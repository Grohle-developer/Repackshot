import { describe, expect, it } from 'vitest';
import { buildExample } from '../src/core/example';
import { boxCenter } from '../src/core/math';
import {
  boundsOf,
  effectiveVisible,
  measuredSizeMm,
  partsUnder,
  resolvePick,
  sceneBounds,
  topMost,
  treeOrder,
} from '../src/core/scene';
import { apply, exampleState, keyIds } from './helpers';

describe('selection levels', () => {
  const s = exampleState();
  const ids = keyIds(s);

  it('a click on the cap selects the right ancestor per level', () => {
    expect(resolvePick(s, ids.cap, 'MODEL')).toBe(ids.model);
    expect(resolvePick(s, ids.cap, 'GROUP')).toBe(ids.closure);
    expect(resolvePick(s, ids.cap, 'PART')).toBe(ids.cap);
    expect(resolvePick(s, ids.cap, 'FACES')).toBe(ids.cap);
  });

  it('GROUP on a part without a group selects the part', () => {
    expect(resolvePick(s, ids.body, 'GROUP')).toBe(ids.body);
  });

  it('select modes set, add and toggle', () => {
    let t = apply(s, { type: 'scene/select', ids: [ids.body], mode: 'set' });
    t = apply(t, { type: 'scene/select', ids: [ids.cap], mode: 'add' });
    expect(t.selection.ids).toEqual([ids.body, ids.cap]);
    t = apply(t, { type: 'scene/select', ids: [ids.body], mode: 'toggle' });
    expect(t.selection.ids).toEqual([ids.cap]);
  });

  it('a light is selected alone', () => {
    let t = apply(s, { type: 'scene/select', ids: [ids.body, ids.cap], mode: 'set' });
    t = apply(t, { type: 'scene/select', ids: [t.studio.lights[0].id], mode: 'add' });
    expect(t.selection.ids).toEqual([t.studio.lights[0].id]);
  });

  it('tree order is depth first', () => {
    expect(treeOrder(s).map((id) => s.scene.nodes[id].key)).toEqual(['model', 'base', 'body', 'label', 'closure', 'collar', 'cap']);
  });

  it('topMost drops descendants of selected ancestors', () => {
    expect(topMost(s, [ids.cap, ids.closure, ids.body])).toEqual([ids.closure, ids.body]);
  });
});

describe('visibility', () => {
  it('hide, isolate and show all', () => {
    const s = exampleState();
    const ids = keyIds(s);
    let t = apply(s, { type: 'scene/setVisible', ids: [ids.closure], visible: false });
    expect(effectiveVisible(t, ids.cap)).toBe(false);
    expect(effectiveVisible(t, ids.body)).toBe(true);
    t = apply(t, { type: 'scene/isolate', ids: [ids.body] });
    expect(effectiveVisible(t, ids.body)).toBe(true);
    expect(effectiveVisible(t, ids.label)).toBe(false);
    expect(effectiveVisible(t, ids.collar)).toBe(false);
    t = apply(t, { type: 'scene/showAll' });
    expect(Object.keys(t.scene.nodes).every((id) => effectiveVisible(t, id))).toBe(true);
  });
});

describe('placement', () => {
  it('rest on the floor uses the lowest point of all the meshes of the target', () => {
    const s = exampleState();
    const ids = keyIds(s);
    let t = apply(s, { type: 'scene/setTransform', id: ids.model, transform: { position: [0, 0, 200] } });
    expect(sceneBounds(t).min[2]).toBeCloseTo(200 - 60.5, 6);
    t = apply(t, { type: 'scene/restOnFloor', ids: [ids.model] });
    expect(sceneBounds(t).min[2]).toBeCloseTo(0, 6);
    // On a group: its own lowest point (the collar) goes to the floor.
    t = apply(t, { type: 'scene/restOnFloor', ids: [ids.closure] });
    expect(boundsOf(t, [ids.closure]).min[2]).toBeCloseTo(0, 6);
  });

  it('centre moves the bounds centre to (0, 0) in XY', () => {
    const s = exampleState();
    const ids = keyIds(s);
    let t = apply(s, { type: 'scene/setTransform', id: ids.model, transform: { position: [40, -25, 60.5] } });
    t = apply(t, { type: 'scene/center', ids: [] });
    const c = boxCenter(sceneBounds(t));
    expect(c[0]).toBeCloseTo(0, 6);
    expect(c[1]).toBeCloseTo(0, 6);
    expect(sceneBounds(t).min[2]).toBeCloseTo(0, 6);
  });

  it('works through a rotated parent', () => {
    const s = exampleState();
    const ids = keyIds(s);
    let t = apply(s, { type: 'scene/setTransform', id: ids.model, transform: { rotation: [90, 0, 0], position: [0, 0, 300] } });
    t = apply(t, { type: 'scene/restOnFloor', ids: [ids.cap] });
    expect(boundsOf(t, [ids.cap]).min[2]).toBeCloseTo(0, 4);
  });

  it('part size rescales the model about the origin and keeps the view', () => {
    const s = exampleState();
    const cam = s.camera.cameras[s.camera.active];
    const t = apply(s, { type: 'scene/setPartSize', mm: 242 });
    expect(measuredSizeMm(t)).toBeCloseTo(242, 4);
    expect(t.scene.partSizeMm).toBe(242);
    expect(t.camera.cameras[t.camera.active].distance).toBeCloseTo(cam.distance * 2, 6);
  });

  it('delete removes the subtree and cleans the selection', () => {
    const s = exampleState();
    const ids = keyIds(s);
    let t = apply(s, { type: 'scene/select', ids: [ids.cap], mode: 'set' });
    t = apply(t, { type: 'scene/delete', ids: [ids.closure] });
    expect(t.scene.nodes[ids.cap]).toBeUndefined();
    expect(t.scene.nodes[ids.model].children).not.toContain(ids.closure);
    expect(t.selection.ids).toEqual([]);
    expect(partsUnder(t, t.scene.roots)).toHaveLength(3);
  });

  it('adding a second model keeps the first and uses fresh ids', () => {
    const s = exampleState();
    const t = apply(s, { type: 'scene/addModel', payload: buildExample(), replace: false });
    expect(t.scene.roots).toHaveLength(2);
    expect(Object.keys(t.scene.nodes)).toHaveLength(14);
    expect(Object.keys(t.materials).length).toBeGreaterThanOrEqual(5);
    expect(t.scene.partSizeMm).toBe(s.scene.partSizeMm);
  });
});

import { describe, expect, it } from 'vitest';
import { buildExample } from '../src/core/example';
import { boxCenter, mat4Compose, transformBox, transformPoint } from '../src/core/math';
import { getMesh } from '../src/core/meshes';
import {
  boundsOf,
  isAxisAligned,
  worldMatrix,
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

describe('bounds and transforms for the move tool (phase U3)', () => {
  it('a turned part measures its vertices, not the box of its turned box', () => {
    const s = exampleState();
    const ids = keyIds(s);
    const t = apply(s, { type: 'scene/setTransform', id: ids.body, transform: { rotation: [40, 0, 0] } });
    const data = getMesh(t.scene.nodes[ids.body].mesh!.id)!;
    const m = worldMatrix(t, ids.body);
    let minZ = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < data.positions.length; i += 3) {
      const p = transformPoint(m, [data.positions[i], data.positions[i + 1], data.positions[i + 2]]);
      minZ = Math.min(minZ, p[2]);
      maxY = Math.max(maxY, p[1]);
    }
    const b = boundsOf(t, [ids.body]);
    expect(b.min[2]).toBeCloseTo(minZ, 6);
    expect(b.max[1]).toBeCloseTo(maxY, 6);
    // The box of the turned box reaches lower: resting on it would leave the part floating.
    expect(transformBox(m, t.scene.nodes[ids.body].mesh!.bounds).min[2]).toBeLessThan(minZ - 1);
    expect(boundsOf(apply(t, { type: 'scene/restOnFloor', ids: [ids.body] }), [ids.body]).min[2]).toBeCloseTo(0, 6);
  });

  it('quarter turns keep the cheap box (it is exact)', () => {
    expect(isAxisAligned(mat4Compose([1, 2, 3], [90, 0, -90], [2, 1, 1]))).toBe(true);
    expect(isAxisAligned(mat4Compose([0, 0, 0], [0, 30, 0], [1, 1, 1]))).toBe(false);
  });

  it('a model entering the scene records the transform Reset returns to', () => {
    const s = exampleState();
    for (const n of Object.values(s.scene.nodes)) expect(n.initial).toEqual(n.transform);
  });
});

// Phase U9: primitives in the scene as pure actions with numbers (ROADMAP U9 criterion): where a new one goes (a base
// under the product, the product lifted onto it, in one undo step; the footprint factor), its measures edited live
// and undone, Convert to mesh, the project saved as measures and opened again byte for byte, and the Scale tool and
// Scale… (by axis, uniform and to size, about the pivot, at each level).

import { describe, expect, it } from 'vitest';
import { PRIMITIVE_KINDS, type PrimitiveKind } from '../src/data/primitives';
import { lightPosition, rigPivot } from '../src/core/lighting';
import { activeCamera, cameraBasis, cameraPosition, fieldOfView, type CameraState } from '../src/core/camera';
import { boxCenter, boxSize, mat4Compose, round, type Vec3 } from '../src/core/math';
import { getMesh, meshIds, retainMeshes } from '../src/core/meshes';
import { BASE_FOOTPRINT, fitSweep, footprintRadius, placePrimitive, roleOf, SWEEP_FIT, type PrimitiveAction } from '../src/core/primitive-ops';
import { generatePrimitive, primitiveOwner } from '../src/core/primitives';
import { boundsOf, measuredSizeMm, partsUnder, productBounds, productParts, type NodeId } from '../src/core/scene';
import { runDoctor } from '../src/core/doctor';
import { createInitialState, createStore, reduce, type Action, type ProjectState } from '../src/core/store';
import { gizmoTransforms, pivotPoint, selectionExtents, selectionFrame, type GizmoFrame } from '../src/core/transform';
import * as THREE from 'three';
import { Gizmo, GizmoDrag, SCALE_CUBE_AT, type Ray } from '../src/render/gizmo';
import { loadProject, serializeProject } from '../src/io/project';
import { lockedSizes, scaleFactors } from '../src/ui/panels/scale-panel';
import { apply, exampleState, keyIds } from './helpers';
import { buildExample } from '../src/core/example';

const NAMES: Record<PrimitiveKind, string> = { BOX: 'Box', PLANE: 'Plane', DISC: 'Disc', CYLINDER: 'Cylinder', PEDESTAL: 'Pedestal', SPHERE: 'Sphere', CONE: 'Cone', TORUS: 'Torus', CAPSULE: 'Capsule', TUBE: 'Tube', STEPS: 'Steps', SWEEP: 'Infinity sweep' };

/** What Add ▸ Primitive dispatches (ui/commands.ts `addPrimitive`), without the interface. */
function addAction(state: ProjectState, kind: PrimitiveKind): PrimitiveAction {
  const place = placePrimitive(state, kind);
  return { type: 'scene/addPrimitive', kind, params: place.params, position: place.position, ...(place.rotation ? { rotation: place.rotation } : {}), name: NAMES[kind], ...(place.lift ? { lift: place.lift } : {}), label: `Add ${kind}` };
}

function add(state: ProjectState, kind: PrimitiveKind): { state: ProjectState; id: NodeId } {
  const next = reduce(state, addAction(state, kind));
  return { state: next, id: next.selection.ids[0] };
}

const near = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(eps);
const bounds = (s: ProjectState, id: NodeId) => boundsOf(s, [id]);

describe('Add ▸ Primitive in an empty scene', () => {
  it('stands at the origin on the floor, is the product (part size, framed), wears a neutral catalogue material', () => {
    const s0 = createInitialState();
    const { state: s, id } = add(s0, 'BOX');
    const node = s.scene.nodes[id];
    expect(s.scene.roots).toEqual([id]);
    expect(node.kind).toBe('PART');
    expect(node.primitive).toEqual({ kind: 'BOX', params: { width: 100, depth: 100, height: 100, bevel: 3, bevelSegments: 4 } });
    const b = bounds(s, id);
    expect(b.min[2]).toBe(0);
    expect(boxCenter(b).slice(0, 2)).toEqual([0, 0]);
    expect(s.scene.partSizeMm).toBe(100);
    expect(s.camera).not.toEqual(s0.camera);
    const mat = s.materials[node.material!];
    expect([mat.preset, mat.role, mat.edited]).toEqual(['WHITE_STUDIO', undefined, false]);
    expect(s.selection.ids).toEqual([id]);
    // The mesh is the generated one, under an id that names its owner and its measures.
    expect(node.mesh!.id).toBe(`prim:${id}:BOX:100,100,100,3,4`);
    expect(node.faceRanges).toEqual(generatePrimitive(node.primitive!).faceRanges);
    // Centred on its bounds like any part: the Doctor's origin check has nothing to say.
    expect(runDoctor(s).find((r) => r.key === 'origin')?.status).toBe('OK');
  });

  it('a set built before the product: the product that comes in sets the part size', () => {
    const s = add(createInitialState(), 'SWEEP').state;
    expect(s.scene.partSizeMm).toBe(Math.round(measuredSizeMm(s) * 100) / 100);
    expect(s.scene.partSizeMm).toBeGreaterThan(300);
    const withProduct = reduce(s, { type: 'scene/addModel', payload: buildExample(), replace: false });
    expect(withProduct.scene.partSizeMm).toBe(Math.round(measuredSizeMm(exampleState()) * 100) / 100);
  });

  it('the next one stands beside it on the floor, and they share the neutral material instance', () => {
    let s = add(createInitialState(), 'BOX').state;
    const box = s.selection.ids[0];
    const next = add(s, 'SPHERE');
    s = next.state;
    const a = bounds(s, box);
    const b = bounds(s, next.id);
    expect(b.min[0]).toBeGreaterThan(a.max[0]);
    near(b.min[2], 0);
    expect(s.scene.nodes[next.id].material).toBe(s.scene.nodes[box].material);
    expect(s.scene.partSizeMm).toBe(100); // only the first sets it
  });

  it('every shape of the catalogue can be added and undone in one step', () => {
    const store = createStore(exampleState());
    for (const kind of PRIMITIVE_KINDS) {
      const before = store.get();
      const undo = store.history().undo.length;
      store.dispatch(addAction(before, kind));
      expect(store.history().undo.length, kind).toBe(undo + 1);
      expect(Object.keys(store.get().scene.nodes).length, kind).toBe(Object.keys(before.scene.nodes).length + 1);
    }
    for (let i = 0; i < PRIMITIVE_KINDS.length; i++) store.undo();
    expect(store.get().scene).toEqual(exampleState().scene);
  });
});

describe('a base under the product (Box and Pedestal)', () => {
  it('a box: 1.4 × the footprint, centred under the product, on the floor; the product sits on top; one undo for both', () => {
    const s0 = exampleState();
    const product = productBounds(s0);
    const store = createStore(s0);
    store.dispatch(addAction(s0, 'BOX'));
    const s = store.get();
    const id = s.selection.ids[0];
    const p = s.scene.nodes[id].primitive!.params;
    const fp = boxSize(product);
    near(p.width, 1.4 * fp[0], 0.051);
    near(p.depth, 1.4 * fp[1], 0.051);
    expect(BASE_FOOTPRINT).toBe(1.4);
    const base = bounds(s, id);
    near(base.min[2], 0);
    near(boxCenter(base)[0], boxCenter(product)[0], 1e-4);
    near(boxCenter(base)[1], boxCenter(product)[1], 1e-4);
    // The product, lifted: its bottom on the base's top, its footprint where it was.
    const lifted = productBounds(s);
    near(lifted.min[2], base.max[2]);
    near(boxCenter(lifted)[0], boxCenter(product)[0], 1e-6);
    expect(roleOf(s.scene.nodes[id])).toBe('BASE');
    expect(store.history().undo).toHaveLength(1);
    store.undo();
    expect(store.get().scene).toEqual(s0.scene);
  });

  it('a pedestal: its radius is 1.4 × the farthest point of the product from its centre', () => {
    const s0 = exampleState();
    const product = productBounds(s0);
    const r = footprintRadius(s0, productParts(s0), boxCenter(product));
    // The example is round: the farthest point is about half its width.
    expect(r).toBeGreaterThan(boxSize(product)[0] / 2 - 1);
    const { state: s, id } = add(s0, 'PEDESTAL');
    near(s.scene.nodes[id].primitive!.params.radius, 1.4 * r, 0.051);
    near(productBounds(s).min[2], bounds(s, id).max[2]);
  });

  it('a locked product is not lifted (the base still goes under it)', () => {
    const s0 = exampleState();
    const root = s0.scene.roots[0];
    const locked = apply(s0, { type: 'scene/setLocked', ids: [root], locked: true });
    const place = placePrimitive(locked, 'BOX');
    expect(place.lift).toBeUndefined();
    const s = reduce(locked, addAction(locked, 'BOX'));
    expect(productBounds(s)).toEqual(productBounds(s0));
  });

  it('without a product a box is a shape like any other (no lift, at the origin)', () => {
    const place = placePrimitive(createInitialState(), 'PEDESTAL');
    expect([place.role, place.lift, place.position[0], place.position[1]]).toEqual(['OBJECT', undefined, 0, 0]);
  });
});

describe('the rest of the catalogue with a product', () => {
  it('flats lie under the product, a hair above the studio floor', () => {
    const s0 = exampleState();
    const c = boxCenter(productBounds(s0));
    for (const kind of ['PLANE', 'DISC'] as const) {
      const { state: s, id } = add(s0, kind);
      const b = bounds(s, id);
      near(boxCenter(b)[0], c[0], 1e-4);
      near(boxCenter(b)[1], c[1], 1e-4);
      expect(b.min[2]).toBeGreaterThan(0);
      expect(b.min[2]).toBeLessThan(0.01 * measuredSizeMm(s0) + 0.05);
      expect(productBounds(s)).toEqual(productBounds(s0)); // nothing lifted
    }
  });

  it('the infinity sweep goes under the product with its wall behind, and moves neither the lights nor the scale', () => {
    const s0 = exampleState();
    const product = productBounds(s0);
    const { state: s, id } = add(s0, 'SWEEP');
    const b = bounds(s, id);
    expect(b.max[1]).toBeGreaterThan(product.max[1]); // the wall is behind (+Y, away from the camera)
    expect(b.min[1]).toBeLessThan(product.min[1]); // the floor comes forward
    expect(b.min[2]).toBeGreaterThan(0);
    expect(b.max[2]).toBeGreaterThan(product.max[2]);
    // The product is still the product: the rig pivot, the part size and the Doctor's scale do not see the sweep.
    expect(rigPivot(s)).toEqual(rigPivot(s0));
    expect(measuredSizeMm(s)).toBe(measuredSizeMm(s0));
    expect(runDoctor(s).find((r) => r.key === 'scale')).toEqual(runDoctor(s0).find((r) => r.key === 'scale'));
  });

  it('other shapes stand on the floor beside everything that stands (not beyond a backdrop)', () => {
    let s = add(exampleState(), 'SWEEP').state;
    const product = productBounds(s);
    // The first one a tenth of the product away from it, though the sweep reaches three products further.
    const first = add(s, 'CYLINDER');
    near(bounds(first.state, first.id).min[0], product.max[0] + 0.1 * measuredSizeMm(s), 0.01);
    for (const kind of ['CYLINDER', 'CONE', 'TORUS', 'CAPSULE', 'TUBE', 'STEPS', 'SPHERE'] as const) {
      const before = s;
      const r = add(s, kind);
      s = r.state;
      const b = bounds(s, r.id);
      near(b.min[2], 0, 1e-4);
      expect(b.min[0], kind).toBeGreaterThan(product.max[0]);
      // Beside the last one, not on top of it.
      for (const other of before.scene.roots) if (roleOf(before.scene.nodes[other]) === 'OBJECT' && before.scene.nodes[other].primitive) expect(b.min[0]).toBeGreaterThan(bounds(before, other).max[0]);
      expect(b.max[0]).toBeLessThan(product.max[0] + 20 * measuredSizeMm(s));
    }
  });
});

describe('editing the measures', () => {
  it('regenerates the mesh through one action; the base keeps its footing; a drag is one undo step', () => {
    const s0 = add(createInitialState(), 'BOX').state;
    const id = s0.selection.ids[0];
    const store = createStore(s0);
    const oldMesh = s0.scene.nodes[id].mesh!.id;
    for (const h of [120, 140, 160]) store.dispatch({ type: 'scene/setPrimitive', id, params: { height: h }, gesture: 'drag1', label: 'height' });
    const s = store.get();
    const node = s.scene.nodes[id];
    expect(node.primitive!.params.height).toBe(160);
    expect(node.mesh!.id).not.toBe(oldMesh);
    expect(primitiveOwner(node.mesh!.id)).toBe(id);
    const b = bounds(s, id);
    near(b.max[2] - b.min[2], 160);
    near(b.min[2], 0); // it grew upwards from the floor
    expect(node.faceRanges).toEqual(generatePrimitive(node.primitive!).faceRanges);
    expect(store.history().undo).toHaveLength(1);
    store.undo();
    expect(store.get().scene.nodes[id]).toEqual(s0.scene.nodes[id]);
    // The same measures again: no change, no entry.
    store.dispatch({ type: 'scene/setPrimitive', id, params: { height: 100 }, label: 'same' });
    expect(store.history().undo).toHaveLength(0);
  });

  it('keeps the measures valid (a bevel too big for the box is clamped)', () => {
    const s0 = add(createInitialState(), 'BOX').state;
    const id = s0.selection.ids[0];
    const s = apply(s0, { type: 'scene/setPrimitive', id, params: { height: 10, bevel: 50 } });
    expect(s.scene.nodes[id].primitive!.params).toMatchObject({ height: 10, bevel: 5 });
  });

  it('a turned part keeps its footing in its own axes', () => {
    let s = add(createInitialState(), 'CYLINDER').state;
    const id = s.selection.ids[0];
    s = apply(s, { type: 'scene/setTransform', id, transform: { rotation: [90, 0, 0] } });
    const foot = (st: ProjectState) => {
      const n = st.scene.nodes[id];
      const m = mat4Compose(n.transform.position, n.transform.rotation, n.transform.scale);
      const z = n.mesh!.bounds.min[2];
      return [m[8] * z + m[12], m[9] * z + m[13], m[10] * z + m[14]];
    };
    const before = foot(s);
    s = apply(s, { type: 'scene/setPrimitive', id, params: { height: 300 } });
    foot(s).forEach((v, k) => near(v, before[k], 1e-4));
  });

  it('linked copies change with it; an independent copy owns its own mesh and does not', () => {
    let s = add(createInitialState(), 'CYLINDER').state;
    const id = s.selection.ids[0];
    s = apply(s, { type: 'scene/duplicate', ids: [id], linked: true });
    const linked = s.selection.ids[0];
    s = apply(s, { type: 'scene/duplicate', ids: [id], linked: false });
    const own = s.selection.ids[0];
    expect(s.scene.nodes[linked].mesh!.id).toBe(s.scene.nodes[id].mesh!.id);
    expect(primitiveOwner(s.scene.nodes[own].mesh!.id)).toBe(own);
    s = apply(s, { type: 'scene/setPrimitive', id, params: { radius: 80 } });
    expect(s.scene.nodes[linked].primitive!.params.radius).toBe(80);
    expect(s.scene.nodes[linked].mesh!.id).toBe(s.scene.nodes[id].mesh!.id);
    expect(s.scene.nodes[own].primitive!.params.radius).toBe(50);
    // And the other way: editing the own copy back to the same measures does not link it again.
    s = apply(s, { type: 'scene/setPrimitive', id: own, params: { radius: 80 } });
    expect(s.scene.nodes[own].mesh!.id).not.toBe(s.scene.nodes[id].mesh!.id);
  });

  it('painted faces follow the logical faces by name (more segments, more steps)', () => {
    let s = add(createInitialState(), 'STEPS').state;
    const id = s.selection.ids[0];
    const node = s.scene.nodes[id];
    const g = generatePrimitive(node.primitive!);
    const range = (gg: typeof g, name: string) => gg.faceRanges[gg.faceNames.indexOf(name)];
    const all = (r: { start: number; count: number }) => Array.from({ length: r.count }, (_, k) => r.start + k);
    s = apply(s, { type: 'material/assign', targets: [], faces: { part: id, indices: all(range(g, 'tread2')) }, preset: 'GOLD', mode: 'REPLACE' });
    // The back comes after every tread and riser: it moves when the count changes.
    s = apply(s, { type: 'material/assign', targets: [], faces: { part: id, indices: all(range(g, 'back')) }, preset: 'WALNUT', mode: 'REPLACE' });
    const [gold, walnut] = s.scene.nodes[id].faceMaterials!.map((f) => f.material);
    s = apply(s, { type: 'scene/setPrimitive', id, params: { steps: 5 } });
    const g5 = generatePrimitive(s.scene.nodes[id].primitive!);
    const t5 = range(g5, 'tread2');
    const b5 = range(g5, 'back');
    expect(s.scene.nodes[id].faceMaterials).toEqual([
      { start: t5.start, count: t5.count, material: gold },
      { start: b5.start, count: b5.count, material: walnut },
    ]);
  });

  it('selected faces follow too', () => {
    let s = add(createInitialState(), 'CYLINDER').state;
    const id = s.selection.ids[0];
    const side = s.scene.nodes[id].faceRanges![1];
    s = apply(s, { type: 'scene/selectFaces', part: id, indices: [side.start], mode: 'set' });
    s = apply(s, { type: 'scene/setPrimitive', id, params: { segments: 12 } });
    const side12 = s.scene.nodes[id].faceRanges![1];
    expect(s.selection.faces).toEqual({ part: id, indices: Array.from({ length: side12.count }, (_, k) => side12.start + k) });
  });

  it('Convert to mesh freezes it (and is undone); flipping or smoothing it freezes it as well', () => {
    const s0 = add(createInitialState(), 'TORUS').state;
    const id = s0.selection.ids[0];
    const store = createStore(s0);
    store.dispatch({ type: 'scene/convertPrimitive', ids: [id], label: 'convert' });
    expect(store.get().scene.nodes[id].primitive).toBeUndefined();
    expect(store.get().scene.nodes[id].mesh).toEqual(s0.scene.nodes[id].mesh);
    expect(store.get().scene.nodes[id].faceRanges).toEqual(s0.scene.nodes[id].faceRanges);
    store.undo();
    expect(store.get().scene.nodes[id].primitive).toBeDefined();
    expect(apply(s0, { type: 'scene/flipNormals', ids: [id] }).scene.nodes[id].primitive).toBeUndefined();
    expect(apply(s0, { type: 'scene/setSmoothAngle', ids: [id], deg: 10 }).scene.nodes[id].primitive).toBeUndefined();
    // A change that keeps the mesh keeps the measures.
    expect(apply(s0, { type: 'scene/setSmooth', ids: [id], smooth: false }).scene.nodes[id].primitive).toBeDefined();
  });
});

describe('a project with primitives', () => {
  it('keeps the measures, not the meshes, and opens again byte for byte (meshes made anew)', async () => {
    let s = exampleState();
    for (const kind of ['BOX', 'SWEEP', 'TORUS', 'STEPS'] as const) s = add(s, kind).state;
    s = apply(s, { type: 'scene/duplicate', ids: [s.selection.ids[0]], linked: false });
    const file = await serializeProject(s).text();
    const body = JSON.parse(file);
    const saved = (body.meshes as { id: string }[]).map((m) => m.id);
    expect(saved.some((m) => m.startsWith('prim:'))).toBe(false);
    expect(saved.length).toBe(new Set(partsUnder(exampleState(), exampleState().scene.roots).map((p) => exampleState().scene.nodes[p].mesh!.id)).size);
    // A fresh session: nothing of the primitives is registered.
    retainMeshes(new Set(meshIds().filter((m) => !m.startsWith('prim:'))));
    const loaded = loadProject(file);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.state).toEqual({ ...s, meta: { ...s.meta, dirty: false } });
    for (const n of Object.values(loaded.state.scene.nodes)) if (n.primitive) expect(getMesh(n.mesh!.id)!.positions).toEqual(generatePrimitive(n.primitive).data.positions);
    expect(await serializeProject(loaded.state).text()).toBe(file);
  });

  it('a shape this version does not know leaves its part without geometry (reported), a broken field is damage', async () => {
    const s = add(createInitialState(), 'BOX').state;
    const id = s.selection.ids[0];
    const body = JSON.parse(await serializeProject(s).text());
    body.state.scene.nodes[id].primitive.kind = 'HYPERCUBE';
    // Another session (or a newer version's file): no mesh of it anywhere.
    retainMeshes(new Set(meshIds().filter((m) => !m.startsWith('prim:'))));
    const loaded = loadProject(JSON.stringify(body));
    expect(loaded.state.scene.nodes[id].primitive).toBeUndefined();
    expect(loaded.warnings).toEqual([{ code: 'MISSING_MESHES', count: 1 }]);
    body.state.scene.nodes[id].primitive = 'BOX';
    expect(() => loadProject(JSON.stringify(body))).toThrow(/primitive is damaged/);
  });

  it('measures out of range in a file are brought back into it', async () => {
    const s = add(createInitialState(), 'CAPSULE').state;
    const id = s.selection.ids[0];
    const body = JSON.parse(await serializeProject(s).text());
    body.state.scene.nodes[id].primitive.params = { radius: 40, height: 10, segments: 'many' };
    const n = loadProject(JSON.stringify(body)).state.scene.nodes[id];
    expect(n.primitive!.params).toEqual({ radius: 40, height: 80, segments: 64 });
    expect(n.mesh!.triangles).toBe(generatePrimitive(n.primitive!).data.indices.length / 3);
  });
});

describe('scaling about the pivot (Scale tool, Scale…)', () => {
  /** The selection's pivot stays where it was and its size is multiplied. */
  function check(s0: ProjectState, ids: NodeId[], factors: Vec3, space: 'GLOBAL' | 'LOCAL' = 'GLOBAL') {
    const frame = selectionFrame(s0, ids, space)!;
    const before = selectionExtents(s0, ids, frame.axes);
    const pivot = pivotPoint(s0, ids);
    const s = apply(s0, { type: 'scene/scale', ids, factors, space } as Action);
    pivotPoint(s, ids).forEach((v, k) => near(v, pivot[k], 1e-3));
    const after = selectionExtents(s, ids, frame.axes);
    after.forEach((v, k) => near(v, before[k] * factors[k], 1e-3));
    return s;
  }

  it('uniform and per axis, at the Model, Group and Part levels', () => {
    const s0 = exampleState();
    const k = keyIds(s0);
    check(s0, [k.model], [1.5, 1.5, 1.5]);
    check(s0, [k.closure], [2, 2, 2]);
    check(s0, [k.body], [1, 0.5, 1]);
    check(s0, [k.model], [0.8, 1.2, 1.1]);
  });

  it('per axis in local axes of a turned part', () => {
    let s = add(createInitialState(), 'BOX').state;
    const id = s.selection.ids[0];
    s = apply(s, { type: 'scene/setTransform', id, transform: { rotation: [0, 0, 30] } });
    const out = check(s, [id], [2, 1, 1], 'LOCAL');
    expect(out.scene.nodes[id].transform.scale).toEqual([2, 1, 1]);
  });

  it('to size: millimetres become factors, the proportions follow when locked, the result is the size asked', () => {
    const s0 = exampleState();
    const k = keyIds(s0);
    const frame = selectionFrame(s0, [k.model], 'GLOBAL')!;
    const ext = selectionExtents(s0, [k.model], frame.axes);
    const sizes = lockedSizes(ext, ext, 2, 300, true);
    near(sizes[0] / ext[0], 300 / ext[2], 1e-6);
    const f = scaleFactors('SIZE', { uniform: 100, axes: [100, 100, 100], size: sizes }, ext);
    const s = apply(s0, { type: 'scene/scale', ids: [k.model], factors: f, space: 'GLOBAL' });
    near(selectionExtents(s, [k.model], frame.axes)[2], 300, 1e-3);
    // Unlocked, only the one changes; an axis without extent (a plane's height) never changes.
    expect(lockedSizes(ext, ext, 0, 10, false)).toEqual([10, ext[1], ext[2]]);
    expect(lockedSizes([100, 100, 0], [100, 100, 0], 0, 50, true)).toEqual([50, 50, 0]);
    expect(scaleFactors('UNIFORM', { uniform: 150, axes: [100, 100, 100], size: [0, 0, 0] }, ext)).toEqual([1.5, 1.5, 1.5]);
    expect(scaleFactors('AXES', { uniform: 100, axes: [50, 100, 200], size: [0, 0, 0] }, ext)).toEqual([0.5, 1, 2]);
  });

  it('Reset scale takes each node back to the scale it came with, about its own pivot', () => {
    const s0 = exampleState();
    const k = keyIds(s0);
    const pivot = pivotPoint(s0, [k.body]);
    let s = apply(s0, { type: 'scene/scale', ids: [k.body], factors: [2, 3, 0.5], space: 'GLOBAL' });
    s = apply(s, { type: 'scene/resetScale', ids: [k.body] });
    expect(s.scene.nodes[k.body].transform.scale).toEqual(s0.scene.nodes[k.body].transform.scale);
    pivotPoint(s, [k.body]).forEach((v, i) => near(v, pivot[i], 1e-3));
    // Nothing to reset: the same state.
    expect(apply(s0, { type: 'scene/resetScale', ids: [k.body] })).toBe(s0);
  });
});

describe('the Scale tool’s handles', () => {
  const frame: GizmoFrame = { origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };

  it('a cube at the end of the axis doubles the scale when dragged one more cube-length out, wherever the shaft was grabbed', () => {
    const size = 10;
    const at = SCALE_CUBE_AT * size;
    const cube = new GizmoDrag('sx', frame, size, { origin: [at, -50, 0], dir: [0, 1, 0] }, { x: 0, y: 0 }, [0, 1, 0], null, SCALE_CUBE_AT);
    const ray = (x: number): Ray => ({ origin: [x, -50, 0], dir: [0, 1, 0] });
    const d1 = cube.update(ray(2 * at), { x: 0, y: 0 });
    expect(d1.kind === 'scale' && d1.factors[0]).toBeCloseTo(2, 6);
    const shaft = new GizmoDrag('sx', frame, size, ray(3), { x: 0, y: 0 }, [0, 1, 0], null, SCALE_CUBE_AT);
    const d2 = shaft.update(ray(3 + at), { x: 0, y: 0 });
    expect(d2.kind === 'scale' && d2.factors).toEqual([expect.closeTo(2, 6), 1, 1]);
    // The move tool's cube keeps its ratio: grabbed at 3, dragged to 6, it doubles.
    const ratio = new GizmoDrag('sx', frame, size, ray(3), { x: 0, y: 0 }, [0, 1, 0]);
    const d3 = ratio.update(ray(6), { x: 0, y: 0 });
    expect(d3.kind === 'scale' && d3.factors[0]).toBeCloseTo(2, 6);
  });

  it('the scale tool shows and picks only the scale handles: the cubes at the ends of the axes and the dot', () => {
    const g = new Gizmo();
    g.place(frame, null);
    g.setPixelSize(10 / 92, 10 / 92); // an arrow 10 units long
    const rc = new THREE.Raycaster();
    const pick = (x: number, y: number) => {
      rc.set(new THREE.Vector3(x, y, 100), new THREE.Vector3(0, 0, -1));
      return g.pick(rc);
    };
    // The move tool: the scale cube sits at 0.62 of the arrow, the arrow's tip translates, the ring rotates.
    expect(pick(6.2, 0)).toBe('sx');
    expect(pick(9.5, 0)).toBe('tx');
    expect(pick(13 * Math.SQRT1_2, 13 * Math.SQRT1_2)).toBe('rz');
    g.setMode('SCALE');
    expect(g.handleMode).toBe('SCALE');
    expect(pick(SCALE_CUBE_AT * 10, 0)).toBe('sx');
    expect(pick(0, SCALE_CUBE_AT * 10)).toBe('sy');
    expect(pick(4, 0)).toBe('sx'); // the shaft grabs too
    expect(pick(0, 0)).toBe('su');
    expect(pick(13 * Math.SQRT1_2, 13 * Math.SQRT1_2)).toBeNull(); // no rotation ring
    expect(pick(3, 3)).toBeNull(); // no plane square
    g.setMode('ALL');
    expect(pick(3, 3)).toBe('pxy');
    g.dispose();
  });

  it('the drag applies about the pivot, snaps to tenths with Shift, and is one undo step', () => {
    const s0 = add(createInitialState(), 'CYLINDER').state;
    const id = s0.selection.ids[0];
    const store = createStore(s0);
    const f = selectionFrame(s0, [id], 'GLOBAL')!;
    for (const k of [1.13, 1.27, 1.42]) store.dispatch({ type: 'scene/setTransforms', transforms: gizmoTransforms(s0, [id], f, { kind: 'scale', factors: [k, 1, 1] }, true), gesture: 'gizmo7', label: 'Scale' });
    expect(store.get().scene.nodes[id].transform.scale).toEqual([1.4, 1, 1]);
    pivotPoint(store.get(), [id]).forEach((v, k) => near(v, f.origin[k], 1e-6));
    expect(store.history().undo).toHaveLength(1);
  });
});

describe('the interface knows every primitive and the Scale tool', () => {
  it('S is the Scale tool (in the edit group), Esc leaves it, the URL can ask for it, it boxes like Move', async () => {
    const { ACTIONS, shortcutGroup } = await import('../src/ui/shortcuts');
    const { readUrlParams } = await import('../src/ui/url-params');
    const { boxArmed } = await import('../src/core/box-select');
    const scale = ACTIONS.find((a) => a.id === 'tool.scale')!;
    expect(scale.keys).toBe('s');
    expect(ACTIONS.filter((a) => a.keys === 's')).toHaveLength(1);
    expect(shortcutGroup('tool.scale')).toBe('edit');
    expect(readUrlParams('?tool=scale').tool).toBe('scale');
    expect(boxArmed('LEFT', 'scale', { ctrl: true, shift: false, alt: false, meta: false })).toBe(true);
    expect(boxArmed('LEFT', 'scale', { ctrl: false, shift: false, alt: false, meta: false })).toBe(false);
  });

  it('every shape has a name, a palette entry and a tooltip, and every measure a label, in English and Spanish', async () => {
    const { STRINGS } = await import('../src/ui/strings');
    const { ACTIONS } = await import('../src/ui/shortcuts');
    const { primitiveParamKey } = await import('../src/ui/names');
    const { PRIMITIVES } = await import('../src/data/primitives');
    for (const p of PRIMITIVES) {
      for (const key of [`prim.${p.key}`, `prim.add.${p.key}`, `prim.tip.${p.role}`]) for (const lang of ['en', 'es'] as const) expect(key in STRINGS[lang], `${lang} ${key}`).toBe(true);
      expect(ACTIONS.some((a) => a.id === `add.${p.key}` && a.label === `prim.add.${p.key}`), p.key).toBe(true);
      for (const q of p.params) expect(primitiveParamKey(p.key, q.key) in STRINGS.en, `${p.key}.${q.key}`).toBe(true);
    }
    expect(primitiveParamKey('SWEEP', 'radius')).toBe('primParam.SWEEP.radius');
    expect(primitiveParamKey('BOX', 'radius')).toBe('primParam.radius');
  });
});

describe('Scale… without a change', () => {
  it('to size with the sizes the selection has, or a locked change, gives factors exactly 1 or exactly alike', () => {
    const ext: Vec3 = [63.2, 63.20001, 121.3];
    expect(scaleFactors('SIZE', { uniform: 100, axes: [100, 100, 100], size: [...ext] as Vec3 }, ext)).toEqual([1, 1, 1]);
    const f = scaleFactors('SIZE', { uniform: 100, axes: [100, 100, 100], size: lockedSizes(ext, ext, 2, 242.6, true) }, ext);
    expect(f[0]).toBeCloseTo(2, 12);
    expect(f[1]).toBeCloseTo(2, 12);
    expect(f[2]).toBe(2);
  });
});

describe('the infinity sweep fills the camera’s frame', () => {
  /** World triangles of a part (its mesh under its world matrix). */
  function worldTriangles(s: ProjectState, id: NodeId): number[][] {
    const node = s.scene.nodes[id];
    const d = getMesh(node.mesh!.id)!;
    const m = mat4Compose(node.transform.position, node.transform.rotation, node.transform.scale);
    const p = (i: number) => [0, 1, 2].map((k) => m[k] * d.positions[3 * i] + m[4 + k] * d.positions[3 * i + 1] + m[8 + k] * d.positions[3 * i + 2] + m[12 + k]);
    const out: number[][] = [];
    for (let t = 0; t < d.indices.length / 3; t++) out.push([...p(d.indices[3 * t]), ...p(d.indices[3 * t + 1]), ...p(d.indices[3 * t + 2])]);
    return out;
  }
  /** Möller–Trumbore: the ray meets the triangle in front of its origin. */
  function hits(o: Vec3, dir: Vec3, tri: number[]): boolean {
    const e1 = [tri[3] - tri[0], tri[4] - tri[1], tri[5] - tri[2]];
    const e2 = [tri[6] - tri[0], tri[7] - tri[1], tri[8] - tri[2]];
    const p = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) return false;
    const tv = [o[0] - tri[0], o[1] - tri[1], o[2] - tri[2]];
    const u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) / det;
    if (u < -1e-9 || u > 1 + 1e-9) return false;
    const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
    const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
    if (v < -1e-9 || u + v > 1 + 1e-9) return false;
    return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 0;
  }
  /** Rays through a 7 x 7 grid of the output frame, its corners included (perspective or orthographic). */
  function gridRays(s: ProjectState): { o: Vec3; d: Vec3 }[] {
    const cam = activeCamera(s);
    const aspect = s.render.width / s.render.height;
    const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
    const fov = fieldOfView(cam.focalMm, aspect);
    const pos = cameraPosition(cam);
    const out: { o: Vec3; d: Vec3 }[] = [];
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        const sx = -1 + i / 3;
        const sy = -1 + j / 3;
        if (cam.projection === 'ORTHOGRAPHIC') {
          const w = cam.orthoWidth / 2;
          out.push({ o: [0, 1, 2].map((k) => pos[k] + right[k] * sx * w + (up[k] * sy * w) / aspect) as Vec3, d: forward });
        } else out.push({ o: pos, d: [0, 1, 2].map((k) => forward[k] + right[k] * sx * Math.tan(fov.h / 2) + up[k] * sy * Math.tan(fov.v / 2)) as Vec3 });
      }
    }
    return out;
  }
  const setups: [string, (s: ProjectState) => ProjectState][] = [
    ['the reference three-quarter view, 16:9', (s) => s],
    ['a front view, low', (s) => withCamera(s, { azimuth: 0, elevation: 4 })],
    ['from above at 45 degrees with a 35 mm lens, behind and to the side', (s) => withCamera(s, { azimuth: 120, elevation: 45, focalMm: 35 })],
    // The frame is the camera's ratio: the size typed in the render window gives it (U13).
    ['a 135 mm tele from the left, a portrait frame', (s) => apply(withCamera(s, { azimuth: -60, elevation: 10, focalMm: 135 }), { type: 'render/set', patch: { width: 1080, height: 1350 } })],
    ['a 24 mm wide view, square', (s) => apply(withCamera(s, { azimuth: 20, elevation: 15, focalMm: 24 }), { type: 'render/set', patch: { width: 1000, height: 1000 } })],
    ['orthographic at 30 degrees', (s) => withCamera(s, { projection: 'ORTHOGRAPHIC', elevation: 30 })],
    ['straight down', (s) => withCamera(s, { elevation: 89 })],
    // A thin, tall product (a panel): the curve would reach under it at 1.75 depths; the wall goes further back.
    ['a thin, tall product', (s) => withCamera(apply(s, { type: 'scene/scale', ids: [s.scene.roots[0]], factors: [1, 0.08, 1.4], space: 'GLOBAL' }), { azimuth: 0, elevation: 10 })],
  ];
  function withCamera(s: ProjectState, patch: Partial<CameraState>): ProjectState {
    const framed = apply(s, { type: 'camera/set', id: s.camera.active, patch });
    return apply(framed, { type: 'camera/frame' });
  }

  it.each(setups)('%s: every ray through the frame meets the sweep, which faces the camera', (_name, setup) => {
    const s0 = setup(exampleState());
    const { state: s, id } = add(s0, 'SWEEP');
    const tris = worldTriangles(s, id);
    const missed = gridRays(s).filter((r) => !tris.some((t) => hits(r.o, r.d, t)));
    expect(missed.length).toBe(0);
    // It faces the camera: turned about Z to its azimuth, its wall on the far side of the subject.
    const cam = activeCamera(s);
    expect(s.scene.nodes[id].transform.rotation).toEqual([0, 0, round(cam.azimuth, 6)]);
    // The subject stands on the flat floor: the curve starts behind it.
    const n = s.scene.nodes[id];
    const p = n.primitive!.params;
    const a = (cam.azimuth * Math.PI) / 180;
    const ey: Vec3 = [-Math.sin(a), Math.cos(a), 0];
    const product = productBounds(s);
    const c = boxCenter(product);
    const along = (v: readonly number[]) => (v[0] - c[0]) * ey[0] + (v[1] - c[1]) * ey[1];
    const wall = along(n.transform.position) + p.depth / 2;
    let back = -Infinity;
    for (let i = 0; i < 8; i++) back = Math.max(back, along([i & 1 ? product.max[0] : product.min[0], i & 2 ? product.max[1] : product.min[1]]));
    expect(wall - p.radius).toBeGreaterThanOrEqual(back);
    near(p.radius, 0.3 * p.height, 1);
  });

  /** Along the camera's ground direction, from the subject's centre: its near and far extent, and where the wall stands. */
  function depthsOf(s: ProjectState, id: NodeId) {
    const n = s.scene.nodes[id];
    const cam = activeCamera(s);
    const a = (cam.azimuth * Math.PI) / 180;
    const ey: Vec3 = [-Math.sin(a), Math.cos(a), 0];
    const product = productBounds(s);
    const c = boxCenter(product);
    const along = (v: readonly number[]) => (v[0] - c[0]) * ey[0] + (v[1] - c[1]) * ey[1];
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4; i++) {
      const v = along([i & 1 ? product.max[0] : product.min[0], i & 2 ? product.max[1] : product.min[1]]);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return { along, depth: hi - lo, wall: along(n.transform.position) + n.primitive!.params.depth / 2 };
  }

  it('with no light behind the subject, the wall stands 1.75 subject depths behind it in the reference view', () => {
    const s0 = exampleState();
    const off = s0.studio.lights.reduce((s, l) => apply(s, { type: 'studio/setLight', id: l.id, patch: { enabled: false } }), s0);
    const { state: s, id } = add(off, 'SWEEP');
    const { depth, wall } = depthsOf(s, id);
    near(wall / depth, 1.75, 0.01);
  });

  it('with a rim behind the subject and the reference camera, every light of the rig stays in front of the wall', () => {
    // L6 raised the Standard type's rim (its reflection in a glossy floor): a setup with a low rim behind (WRAP).
    const s0 = apply(exampleState(), { type: 'studio/setSetup', key: 'WRAP' });
    const { state: s, id } = add(s0, 'SWEEP');
    const { along, depth, wall } = depthsOf(s, id);
    const lights = s.studio.lights.filter((l) => l.enabled);
    expect(lights.length).toBe(5);
    // The rim light stands behind the subject, further back than 1.75 subject depths: the paper goes back for it.
    const rim = lights.find((l) => l.role === 'RIM')!;
    expect(along(lightPosition(s, rim))).toBeGreaterThan(SWEEP_FIT.wall * depth);
    for (const l of lights) {
      const half = (Math.max(l.size, l.sizeY) * s.scene.partSizeMm) / 2;
      expect(along(lightPosition(s, l)) + half, l.role).toBeLessThan(wall);
    }
    near(wall, SWEEP_FIT.lights * along(lightPosition(s, rim)) + (Math.max(rim.size, rim.sizeY) * s.scene.partSizeMm) / 2, 1);
  });

  it('Fit to camera turns and sizes it for the camera in force, in one undo step', () => {
    let s = add(exampleState(), 'SWEEP').state;
    const id = s.selection.ids[0];
    s = withCamera(s, { azimuth: 70, elevation: 12, focalMm: 50 });
    // The old fit no longer covers the new view.
    const before = worldTriangles(s, id);
    expect(gridRays(s).some((r) => !before.some((t) => hits(r.o, r.d, t)))).toBe(true);
    const store = createStore(s);
    const fit = fitSweep(store.get());
    store.dispatch({ type: 'scene/fitPrimitive', id, params: fit.params, position: fit.position, rotation: fit.rotation, label: 'fit' });
    const after = worldTriangles(store.get(), id);
    expect(gridRays(store.get()).filter((r) => !after.some((t) => hits(r.o, r.d, t)))).toHaveLength(0);
    expect(store.get().scene.nodes[id].transform.rotation[2]).toBe(70);
    expect(store.history().undo).toHaveLength(1);
    store.undo();
    expect(store.get().scene.nodes[id]).toEqual(s.scene.nodes[id]);
    // Fitting again for the same camera changes nothing.
    const again = reduce(apply(s, { type: 'scene/fitPrimitive', id, params: fit.params, position: fit.position, rotation: fit.rotation }), { type: 'scene/fitPrimitive', id, params: fit.params, position: fit.position, rotation: fit.rotation });
    expect(apply(again, { type: 'scene/fitPrimitive', id, params: fit.params, position: fit.position, rotation: fit.rotation })).toBe(again);
  });
});

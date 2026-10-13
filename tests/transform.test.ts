// Phase U3: the transform core and the operations on parts, as pure actions
// with numbers (ROADMAP U3 criterion), and one undo for each of them.

import { describe, expect, it } from 'vitest';
import { instanceFromPreset, type MaterialInstance } from '../src/core/materials';
import { boxCenter, boxSize, cross, dot, length, mat4Compose, sub, transformDirection, transformPoint, type Vec3 } from '../src/core/math';
import { getMesh, registerMesh, type MeshData, type MeshRef } from '../src/core/meshes';
import { boundsOf, partsUnder, worldMatrix, type ModelPayload, type NodeId, type SceneNode } from '../src/core/scene';
import { activeCamera, cameraPosition } from '../src/core/camera';
import { createInitialState, createStore, reduce, type Action, type ProjectState } from '../src/core/store';
import {
  cameraLookAt,
  closestEuler,
  composeTransform,
  decomposeMatrix,
  defaultPatternParams,
  gizmoTransforms,
  pivotPoint,
  selectionFrame,
  snapDelta,
  type TransformAction,
} from '../src/core/transform';
import { GizmoDrag, type Ray } from '../src/render/gizmo';
import { apply } from './helpers';

// --- Fixtures -----------------------------------------------------------------------------

/** A box mesh centred on its origin, with outward triangles. */
function boxMesh(size: Vec3): MeshData {
  const [hx, hy, hz] = size.map((v) => v / 2);
  const positions = new Float32Array(24);
  const normals = new Float32Array(24);
  for (let i = 0; i < 8; i++) {
    const c = [i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz];
    positions.set(c, 3 * i);
    const l = Math.hypot(c[0], c[1], c[2]);
    normals.set([c[0] / l, c[1] / l, c[2] / l], 3 * i);
  }
  const indices = Uint32Array.from([0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]);
  return { positions, normals, indices };
}

let meshCounter = 0;
function boxRef(size: Vec3): MeshRef {
  return registerMesh(`test:box${++meshCounter}`, boxMesh(size));
}

interface PartSpec {
  key: string;
  position: Vec3;
  size?: Vec3;
  rotation?: Vec3;
  /** Material key of another part to share, or a preset (default GOLD). */
  material?: string;
}

/** A model with one group holding the parts. Keys: 'model', 'group', and each part's. */
function scene(parts: PartSpec[], groupRotation: Vec3 = [0, 0, 0]): ProjectState {
  const nodes: Record<NodeId, SceneNode> = {};
  const materials: Record<string, MaterialInstance> = {};
  const base = (id: string, kind: SceneNode['kind'], parent: string | null, children: string[]): SceneNode => ({
    id,
    key: id,
    name: id,
    kind,
    parent,
    children,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
  });
  nodes.model = base('model', 'MODEL', null, ['group']);
  nodes.group = { ...base('group', 'GROUP', 'model', parts.map((p) => p.key)), transform: { position: [0, 0, 0], rotation: groupRotation, scale: [1, 1, 1] } };
  for (const p of parts) {
    const shared = p.material && nodes[p.material]?.material;
    const mat = shared ?? `mat_${p.key}`;
    if (!shared) materials[mat] = instanceFromPreset(mat, p.material ?? 'GOLD', 100)!;
    nodes[p.key] = {
      ...base(p.key, 'PART', 'group', []),
      transform: { position: p.position, rotation: p.rotation ?? [0, 0, 0], scale: [1, 1, 1] },
      mesh: boxRef(p.size ?? [20, 20, 40]),
      material: mat,
      smooth: true,
    };
  }
  const payload: ModelPayload = { nodes, roots: ['model'], materials };
  return reduce(createInitialState(), { type: 'scene/addModel', payload, replace: true });
}

function ids(state: ProjectState): Record<string, NodeId> {
  const out: Record<string, NodeId> = {};
  for (const n of Object.values(state.scene.nodes)) if (n.key) out[n.key] = n.id;
  return out;
}

/** World positions of every vertex of a part. */
function worldVertices(state: ProjectState, id: NodeId): Vec3[] {
  const node = state.scene.nodes[id];
  const data = getMesh(node.mesh!.id)!;
  const m = worldMatrix(state, id);
  const out: Vec3[] = [];
  for (let i = 0; i < data.positions.length; i += 3) out.push(transformPoint(m, [data.positions[i], data.positions[i + 1], data.positions[i + 2]]));
  return out;
}

function lowestZ(state: ProjectState, partIds: readonly NodeId[]): number {
  return Math.min(...partIds.flatMap((p) => worldVertices(state, p).map((v) => v[2])));
}

const near = (a: readonly number[], b: readonly number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

function threeParts(): ProjectState {
  return scene([
    { key: 'a', position: [-60, 0, 35] },
    { key: 'b', position: [0, 0, 80] },
    { key: 'c', position: [60, 10, 52], rotation: [30, 0, 0] },
  ]);
}

// --- Compose and decompose -------------------------------------------------------------------

describe('compose and decompose', () => {
  it('round-trips position, rotation and scale', () => {
    for (const t of [
      { position: [10, -20, 30] as Vec3, rotation: [12, -34, 56] as Vec3, scale: [1, 2, 0.5] as Vec3 },
      { position: [0, 0, 0] as Vec3, rotation: [0, 0, 170] as Vec3, scale: [1, 1, 1] as Vec3 },
      { position: [1, 2, 3] as Vec3, rotation: [-90, 45, 0] as Vec3, scale: [-1, 1, 1] as Vec3 },
    ]) {
      const d = decomposeMatrix(composeTransform(t));
      expect(near(composeTransform(d), composeTransform(t), 1e-6)).toBe(true);
      expect(near(d.position, t.position)).toBe(true);
    }
  });

  it('keeps Euler angles near the previous ones (no jump past 180 degrees)', () => {
    expect(closestEuler([0, 0, -170], [0, 0, 175])).toEqual([0, 0, 190]);
    const d = decomposeMatrix(mat4Compose([0, 0, 0], [0, 0, 200], [1, 1, 1]), { position: [0, 0, 0], rotation: [0, 0, 179], scale: [1, 1, 1] });
    expect(d.rotation[2]).toBeCloseTo(200, 6);
  });
});

// --- Rest, centre, pivot ----------------------------------------------------------------------

describe('rest, centre and pivot', () => {
  it('rest on the floor leaves minZ = 0 for a group of three parts (one of them turned)', () => {
    const s = threeParts();
    const k = ids(s);
    expect(lowestZ(s, [k.a, k.b, k.c])).toBeGreaterThan(1);
    const t = apply(s, { type: 'scene/restOnFloor', ids: [k.group] });
    // The lowest point of all the meshes, measured on the vertices, not on a turned box.
    expect(lowestZ(t, [k.a, k.b, k.c])).toBeCloseTo(0, 6);
    expect(boundsOf(t, [k.group]).min[2]).toBeCloseTo(0, 6);
    // The parts keep their places relative to each other.
    expect(t.scene.nodes[k.b].transform.position[2] - t.scene.nodes[k.a].transform.position[2]).toBeCloseTo(45, 6);
  });

  it('centre puts the XY centre of the bounds at 0, 0; centre and rest does both at once', () => {
    const s = threeParts();
    const k = ids(s);
    const t = apply(s, { type: 'scene/centerAndRest', ids: [k.group] });
    const b = boundsOf(t, [k.group]);
    expect(boxCenter(b)[0]).toBeCloseTo(0, 6);
    expect(boxCenter(b)[1]).toBeCloseTo(0, 6);
    expect(b.min[2]).toBeCloseTo(0, 6);
  });

  it('pivot BASE and CENTER differ by half the height', () => {
    const s = scene([{ key: 'a', position: [5, 5, 100], size: [20, 20, 40] }]);
    const k = ids(s);
    const center = pivotPoint(s, [k.a]);
    const base = pivotPoint(apply(s, { type: 'scene/setPivot', ids: [k.a], mode: 'BASE' }), [k.a]);
    expect(center).toEqual([5, 5, 100]);
    expect(center[2] - base[2]).toBeCloseTo(20, 9);
    expect(base[0]).toBe(5);
  });

  it('ORIGIN is the origin of the node; a CUSTOM point moves with the node', () => {
    const s = scene([{ key: 'a', position: [10, 0, 50] }]);
    const k = ids(s);
    expect(pivotPoint(apply(s, { type: 'scene/setPivot', ids: [k.group], mode: 'ORIGIN' }), [k.group])).toEqual([0, 0, 0]);
    let t = apply(s, { type: 'scene/setPivot', ids: [k.a], mode: 'CUSTOM', point: [10, 0, 30] });
    expect(near(pivotPoint(t, [k.a]), [10, 0, 30])).toBe(true);
    t = apply(t, { type: 'scene/move', ids: [k.a], delta: [5, 0, 0], space: 'GLOBAL' });
    expect(near(pivotPoint(t, [k.a]), [15, 0, 30])).toBe(true);
  });

  it('reset after a move restores the original transform', () => {
    const s = threeParts();
    const k = ids(s);
    const original = s.scene.nodes[k.c].transform;
    let t = apply(s, { type: 'scene/move', ids: [k.c], delta: [12, -3, 40], space: 'GLOBAL' });
    t = apply(t, { type: 'scene/rotate', ids: [k.c], axis: 2, deg: 33, space: 'LOCAL' });
    t = apply(t, { type: 'scene/scale', ids: [k.c], factors: [2, 2, 2], space: 'LOCAL' });
    expect(t.scene.nodes[k.c].transform).not.toEqual(original);
    t = apply(t, { type: 'scene/resetTransform', ids: [k.c] });
    expect(t.scene.nodes[k.c].transform).toEqual(original);
  });

  it('the import placement is what Reset returns to', () => {
    const s = threeParts();
    const k = ids(s);
    let t = apply(s, { type: 'scene/centerAndRest', ids: [k.model] }, { type: 'scene/setInitial', ids: [k.model] });
    const placed = t.scene.nodes[k.model].transform;
    t = apply(t, { type: 'scene/move', ids: [k.model], delta: [100, 0, 0], space: 'GLOBAL' }, { type: 'scene/resetTransform', ids: [k.model] });
    expect(t.scene.nodes[k.model].transform).toEqual(placed);
  });
});

// --- Local and global axes, multi-selection, snapping -------------------------------------------

describe('moves of the move tool', () => {
  it('local and global rotation of a turned group differ', () => {
    const s = scene([{ key: 'a', position: [30, 0, 0] }], [0, 0, 90]);
    const k = ids(s);
    const global = apply(s, { type: 'scene/rotate', ids: [k.group], axis: 0, deg: 90, space: 'GLOBAL' });
    const local = apply(s, { type: 'scene/rotate', ids: [k.group], axis: 0, deg: 90, space: 'LOCAL' });
    const zOf = (st: ProjectState) => transformDirection(worldMatrix(st, k.group), [0, 0, 1]);
    // Global X: the group's Z turns to -Y. Its own X is the world's Y, which takes Z to +X.
    expect(near(zOf(global), [0, -1, 0])).toBe(true);
    expect(near(zOf(local), [1, 0, 0])).toBe(true);
    // Local: the rotation is about its own X, which stays where it was.
    expect(near(transformDirection(worldMatrix(local, k.group), [1, 0, 0]), transformDirection(worldMatrix(s, k.group), [1, 0, 0]))).toBe(true);
  });

  it('the LOCAL gizmo frame follows the first node; GLOBAL is the world', () => {
    const s = scene([{ key: 'a', position: [0, 0, 0], rotation: [0, 0, 90] }]);
    const k = ids(s);
    expect(selectionFrame(s, [k.a], 'GLOBAL')!.axes).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(near(selectionFrame(s, [k.a], 'LOCAL')!.axes[0], [0, 1, 0])).toBe(true);
    const t = apply(s, { type: 'scene/move', ids: [k.a], delta: [10, 0, 0], space: 'LOCAL' });
    expect(near(t.scene.nodes[k.a].transform.position, [0, 10, 0])).toBe(true);
  });

  it('a multi-selection turns and scales about its common pivot', () => {
    const s = scene([
      { key: 'a', position: [-50, 0, 20] },
      { key: 'b', position: [50, 0, 20] },
    ]);
    const k = ids(s);
    // Common pivot: the centre of both, (0, 0, 20).
    expect(near(pivotPoint(s, [k.a, k.b]), [0, 0, 20])).toBe(true);
    const turned = apply(s, { type: 'scene/rotate', ids: [k.a, k.b], axis: 2, deg: 90, space: 'GLOBAL' });
    expect(near(turned.scene.nodes[k.a].transform.position, [0, -50, 20])).toBe(true);
    expect(near(turned.scene.nodes[k.b].transform.position, [0, 50, 20])).toBe(true);
    expect(turned.scene.nodes[k.a].transform.rotation[2]).toBeCloseTo(90, 6);
    const scaled = apply(s, { type: 'scene/scale', ids: [k.a, k.b], factors: [2, 2, 2], space: 'GLOBAL' });
    expect(near(scaled.scene.nodes[k.b].transform.position, [100, 0, 20])).toBe(true);
    expect(scaled.scene.nodes[k.b].transform.scale).toEqual([2, 2, 2]);
  });

  it('Shift snaps: 10 mm, 15 degrees, 0.1 of scale', () => {
    expect(snapDelta({ kind: 'move', amounts: [23, -4.9, 5.1] })).toEqual({ kind: 'move', amounts: [20, 0, 10] });
    expect(snapDelta({ kind: 'rotate', axis: 2, deg: 22 })).toEqual({ kind: 'rotate', axis: 2, deg: 15 });
    expect(snapDelta({ kind: 'rotate', axis: 2, deg: 23 })).toEqual({ kind: 'rotate', axis: 2, deg: 30 });
    expect(snapDelta({ kind: 'scale', factors: [1.26, 1, 0.02] })).toEqual({ kind: 'scale', factors: [1.3, 1, 0.1] });
    const s = scene([{ key: 'a', position: [0, 0, 0] }]);
    const k = ids(s);
    const frame = selectionFrame(s, [k.a], 'GLOBAL')!;
    const out = gizmoTransforms(s, [k.a], frame, { kind: 'move', amounts: [23, 0, 0] }, true);
    expect(out[k.a].position).toEqual([20, 0, 0]);
    expect(gizmoTransforms(s, [k.a], frame, { kind: 'move', amounts: [23, 0, 0] }, false)[k.a].position).toEqual([23, 0, 0]);
  });

  it('the drag of a handle follows the pointer ray (translate, rotate past half a turn, scale)', () => {
    const frame = { origin: [0, 0, 0] as Vec3, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [Vec3, Vec3, Vec3] };
    const from = (o: Vec3, through: Vec3): Ray => {
      const d = sub(through, o);
      const l = length(d);
      return { origin: o, dir: [d[0] / l, d[1] / l, d[2] / l] };
    };
    const front: Vec3 = [0, -500, 0];
    const tx = new GizmoDrag('tx', frame, 100, from(front, [0, 0, 0]), { x: 0, y: 0 }, [0, 1, 0]);
    const move = tx.update(from(front, [30, 0, 0]), { x: 10, y: 0 });
    expect(move.kind === 'move' && move.amounts[0]).toBeCloseTo(30, 6);
    const above: Vec3 = [0, 0, 500];
    const rz = new GizmoDrag('rz', frame, 100, from(above, [50, 0, 0]), { x: 0, y: 0 }, [0, 0, -1]);
    const degs = ([[0, 50, 0], [-50, 0, 0], [0, -50, 0]] as Vec3[]).map((p) => {
      const d = rz.update(from(above, p), { x: 0, y: 0 });
      return d.kind === 'rotate' ? d.deg : NaN;
    });
    expect(degs[0]).toBeCloseTo(90, 6);
    expect(degs[1]).toBeCloseTo(180, 6);
    expect(degs[2]).toBeCloseTo(270, 6);
    const sx = new GizmoDrag('sx', frame, 100, from(front, [62, 0, 0]), { x: 0, y: 0 }, [0, 1, 0]);
    const sc = sx.update(from(front, [124, 0, 0]), { x: 0, y: 0 });
    expect(sc.kind === 'scale' && sc.factors[0]).toBeCloseTo(2, 6);
    expect(sc.kind === 'scale' && sc.factors[1]).toBe(1);
  });

  it('a locked node does not move', () => {
    const s = scene([{ key: 'a', position: [0, 0, 0] }]);
    const k = ids(s);
    const t = apply(s, { type: 'scene/setLocked', ids: [k.a], locked: true }, { type: 'scene/move', ids: [k.a], delta: [5, 0, 0], space: 'GLOBAL' });
    expect(t.scene.nodes[k.a].transform.position).toEqual([0, 0, 0]);
  });

  it('a drag is one undo entry, measured from its start', () => {
    const s = scene([{ key: 'a', position: [0, 0, 0] }]);
    const k = ids(s);
    const store = createStore(s);
    const start = store.get();
    const frame = selectionFrame(start, [k.a], 'GLOBAL')!;
    // A press on a handle that does not move yet changes nothing and leaves no entry.
    store.dispatch({ type: 'scene/setTransforms', transforms: gizmoTransforms(start, [k.a], frame, { kind: 'move', amounts: [0, 0, 0] }, false), gesture: 'gizmo0' });
    expect(store.get()).toBe(start);
    expect(store.history().undo).toHaveLength(0);
    for (const x of [1, 4, 9, 16, 25]) {
      store.dispatch({ type: 'scene/setTransforms', transforms: gizmoTransforms(start, [k.a], frame, { kind: 'move', amounts: [x, 0, 0] }, false), gesture: 'gizmo1' });
    }
    expect(store.get().scene.nodes[k.a].transform.position).toEqual([25, 0, 0]);
    expect(store.history().undo).toHaveLength(1);
    store.undo();
    expect(store.get().scene).toBe(start.scene);
  });

  it('set as camera target keeps the camera where it is and looks at the selection', () => {
    const s = threeParts();
    const k = ids(s);
    const cam = activeCamera(s);
    const patch = cameraLookAt(s, [k.a])!;
    const moved = { ...cam, ...patch };
    expect(near(cameraPosition(moved), cameraPosition(cam), 1e-6)).toBe(true);
    expect(near(moved.target, boxCenter(boundsOf(s, [k.a])))).toBe(true);
  });
});

// --- Duplicate, group, patterns -------------------------------------------------------------------

describe('duplicate and group', () => {
  it('duplicate linked shares meshId and materialId; unlink separates them', () => {
    const s = threeParts();
    const k = ids(s);
    const t = apply(s, { type: 'scene/duplicate', ids: [k.a], linked: true });
    const copy = t.selection.ids[0];
    expect(copy).not.toBe(k.a);
    expect(t.scene.nodes[copy].mesh!.id).toBe(t.scene.nodes[k.a].mesh!.id);
    expect(t.scene.nodes[copy].material).toBe(t.scene.nodes[k.a].material);
    expect(t.scene.nodes[k.group].children).toEqual([k.a, copy, k.b, k.c]);
    expect(t.scene.nodes[copy].name).toBe('a 2');
    const u = apply(t, { type: 'material/unlink', parts: [copy] });
    expect(u.scene.nodes[copy].material).not.toBe(u.scene.nodes[k.a].material);
    expect(u.materials[u.scene.nodes[copy].material!].params).toEqual(u.materials[u.scene.nodes[k.a].material!].params);
  });

  it('duplicate makes an independent copy of nodes, materials and meshes', () => {
    const s = threeParts();
    const k = ids(s);
    const t = apply(s, { type: 'scene/duplicate', ids: [k.group], linked: false });
    const copy = t.selection.ids[0];
    const parts = partsUnder(t, [copy]);
    expect(parts).toHaveLength(3);
    for (const [i, p] of parts.entries()) {
      const orig = t.scene.nodes[[k.a, k.b, k.c][i]];
      expect(t.scene.nodes[p].material).not.toBe(orig.material);
      expect(t.scene.nodes[p].mesh!.id).not.toBe(orig.mesh!.id);
      expect(getMesh(t.scene.nodes[p].mesh!.id)).toBe(getMesh(orig.mesh!.id));
    }
    // Editing the copy's material leaves the original alone.
    const m = t.scene.nodes[parts[0]].material!;
    const e = apply(t, { type: 'material/setParam', id: m, key: 'roughness', value: 0.9 });
    expect(e.materials[t.scene.nodes[k.a].material!].params.roughness).not.toBe(0.9);
  });

  it('group, ungroup and move to group keep every part where it is in the world', () => {
    const s = scene(
      [
        { key: 'a', position: [10, 0, 0], rotation: [0, 0, 30] },
        { key: 'b', position: [0, 20, 5] },
      ],
      [0, 0, 45],
    );
    const k = ids(s);
    const before = [worldMatrix(s, k.a), worldMatrix(s, k.b)];
    const g = apply(s, { type: 'scene/group', ids: [k.a, k.b], name: 'Group 1' });
    const gid = g.selection.ids[0];
    expect(g.scene.nodes[gid].kind).toBe('GROUP');
    expect(g.scene.nodes[gid].children).toEqual([k.a, k.b]);
    expect(g.scene.nodes[k.group].children).toEqual([gid]);
    const u = apply(s, { type: 'scene/ungroup', ids: [k.group] });
    expect(u.scene.nodes[k.group]).toBeUndefined();
    expect(u.scene.nodes[k.model].children).toEqual([k.a, k.b]);
    expect(near(worldMatrix(u, k.a), before[0], 1e-5)).toBe(true);
    expect(near(worldMatrix(u, k.b), before[1], 1e-5)).toBe(true);
    const r = apply(s, { type: 'scene/reparent', ids: [k.a], parent: k.model });
    expect(r.scene.nodes[k.a].parent).toBe(k.model);
    expect(near(worldMatrix(r, k.a), before[0], 1e-5)).toBe(true);
    // Not into itself.
    expect(apply(s, { type: 'scene/reparent', ids: [k.group], parent: k.group })).toBe(s);
  });
});

describe('patterns', () => {
  const centres = (st: ProjectState, group: NodeId) => st.scene.nodes[group].children.map((c) => boxCenter(boundsOf(st, [c])));

  it('a circular pattern of 6 leaves 60 degree steps and equal radii, as linked copies', () => {
    const s = scene([{ key: 'a', position: [50, 0, 20] }]);
    const k = ids(s);
    const t = apply(s, { type: 'scene/pattern', ids: [k.a], params: { kind: 'CIRCULAR', count: 6, offset: [0, 0, 0], space: 'GLOBAL', axis: 2, angleDeg: 360, center: [0, 0, 0] }, name: 'Pattern' });
    const g = t.selection.ids[0];
    expect(t.scene.nodes[g].pattern?.sources).toEqual([k.a]);
    const cs = centres(t, g);
    expect(cs).toHaveLength(6);
    const angles = cs.map((c) => (Math.atan2(c[1], c[0]) * 180) / Math.PI);
    angles.forEach((a, i) => expect(((a - 60 * i + 540) % 360) - 180).toBeCloseTo(0, 6));
    for (const c of cs) {
      expect(Math.hypot(c[0], c[1])).toBeCloseTo(50, 6);
      expect(c[2]).toBeCloseTo(20, 6);
    }
    for (const c of t.scene.nodes[g].children) {
      expect(t.scene.nodes[c].mesh!.id).toBe(t.scene.nodes[k.a].mesh!.id);
      expect(t.scene.nodes[c].material).toBe(t.scene.nodes[k.a].material);
    }
  });

  it('editing the pattern regenerates it', () => {
    const s = scene([{ key: 'a', position: [50, 0, 20] }]);
    const k = ids(s);
    let t = apply(s, { type: 'scene/pattern', ids: [k.a], params: { kind: 'CIRCULAR', count: 6, offset: [0, 0, 0], space: 'GLOBAL', axis: 2, angleDeg: 360, center: [0, 0, 0] }, name: 'Pattern' });
    const g = t.selection.ids[0];
    t = apply(t, { type: 'scene/editPattern', id: g, patch: { count: 4 } });
    const cs = centres(t, g);
    expect(cs).toHaveLength(4);
    expect(t.scene.nodes[g].children[0]).toBe(k.a);
    expect(near(cs[1], [0, 50, 20])).toBe(true);
    // A half turn with four copies spaces them 60 degrees apart, the last one at 180.
    t = apply(t, { type: 'scene/editPattern', id: g, patch: { angleDeg: 180 } });
    expect(near(centres(t, g)[3], [-50, 0, 20])).toBe(true);
    // Switched to linear: three steps of 30 mm along Y.
    t = apply(t, { type: 'scene/editPattern', id: g, patch: { kind: 'LINEAR', offset: [0, 30, 0], count: 3 } });
    expect(centres(t, g).map((c) => c[1])).toEqual([0, 30, 60]);
    // Moving the original and editing again carries the copies along.
    t = apply(t, { type: 'scene/move', ids: [k.a], delta: [0, 0, 10], space: 'GLOBAL' }, { type: 'scene/editPattern', id: g, patch: { count: 2 } });
    expect(centres(t, g).map((c) => c[2])).toEqual([30, 30]);
  });

  it('a linear pattern in LOCAL space follows the original\'s own axes', () => {
    const s = scene([{ key: 'a', position: [0, 0, 0], rotation: [0, 0, 90] }]);
    const k = ids(s);
    const t = apply(s, { type: 'scene/pattern', ids: [k.a], params: { kind: 'LINEAR', count: 2, offset: [25, 0, 0], space: 'LOCAL', axis: 2, angleDeg: 360 }, name: 'Pattern' });
    expect(near(centres(t, t.selection.ids[0])[1], [0, 25, 0])).toBe(true);
  });

  it('the default circular pattern turns about the pivot', () => {
    const s = scene([{ key: 'a', position: [50, 0, 20] }]);
    const k = ids(s);
    const piv = apply(s, { type: 'scene/setPivot', ids: [k.a], mode: 'CUSTOM', point: [0, 0, 20] });
    const t = apply(piv, { type: 'scene/pattern', ids: [k.a], params: defaultPatternParams(piv, [k.a], 'CIRCULAR'), name: 'Pattern' });
    const cs = centres(t, t.selection.ids[0]);
    expect(cs).toHaveLength(6);
    for (const c of cs) expect(Math.hypot(c[0], c[1])).toBeCloseTo(50, 6);
  });
});

// --- Geometry --------------------------------------------------------------------------------

describe('geometry', () => {
  it('flip normals makes a mesh with reversed winding and normals; twice gives the original back', () => {
    const s = threeParts();
    const k = ids(s);
    const before = s.scene.nodes[k.a].mesh!;
    const t = apply(s, { type: 'scene/flipNormals', ids: [k.a] });
    const after = t.scene.nodes[k.a].mesh!;
    expect(after.id).not.toBe(before.id);
    const a = getMesh(before.id)!;
    const b = getMesh(after.id)!;
    expect(Array.from(b.normals)).toEqual(Array.from(a.normals).map((v) => -v + 0));
    expect([b.indices[0], b.indices[1], b.indices[2]]).toEqual([a.indices[0], a.indices[2], a.indices[1]]);
    // The face normal from the winding now points inwards.
    const p = (i: number): Vec3 => [b.positions[3 * i], b.positions[3 * i + 1], b.positions[3 * i + 2]];
    const n = cross(sub(p(b.indices[1]), p(b.indices[0])), sub(p(b.indices[2]), p(b.indices[0])));
    expect(dot(n, p(b.indices[0]))).toBeLessThan(0);
    expect(apply(t, { type: 'scene/flipNormals', ids: [k.a] }).scene.nodes[k.a].mesh!.id).toBe(before.id);
    // The other parts keep their meshes.
    expect(t.scene.nodes[k.b].mesh).toBe(s.scene.nodes[k.b].mesh);
  });

  it('linked copies flip together; an independent copy does not', () => {
    const s = threeParts();
    const k = ids(s);
    const linked = apply(s, { type: 'scene/duplicate', ids: [k.a], linked: true });
    const l = linked.selection.ids[0];
    const both = apply(linked, { type: 'scene/flipNormals', ids: [k.a] });
    expect(both.scene.nodes[l].mesh!.id).toBe(both.scene.nodes[k.a].mesh!.id);
    expect(both.scene.nodes[l].mesh!.id).toMatch(/~flip$/);
    const own = apply(s, { type: 'scene/duplicate', ids: [k.a], linked: false });
    const o = own.selection.ids[0];
    const one = apply(own, { type: 'scene/flipNormals', ids: [k.a] });
    expect(one.scene.nodes[o].mesh).toBe(own.scene.nodes[o].mesh);
  });

  it('the smoothing angle recomputes the normals: hard box edges split its corners', () => {
    const s = threeParts();
    const k = ids(s);
    const hard = apply(s, { type: 'scene/setSmoothAngle', ids: [k.a], deg: 30 });
    const soft = apply(s, { type: 'scene/setSmoothAngle', ids: [k.a], deg: 180 });
    expect(hard.scene.nodes[k.a].mesh!.vertices).toBe(24);
    expect(soft.scene.nodes[k.a].mesh!.vertices).toBe(8);
    expect(hard.scene.nodes[k.a].mesh!.triangles).toBe(12);
    expect(hard.scene.nodes[k.a].smoothAngle).toBe(30);
    // Flat faces: each normal of the hard box is an axis.
    const n = getMesh(hard.scene.nodes[k.a].mesh!.id)!.normals;
    for (let i = 0; i < n.length; i += 3) expect(Math.max(Math.abs(n[i]), Math.abs(n[i + 1]), Math.abs(n[i + 2]))).toBeCloseTo(1, 6);
  });

  it('separate by material turns each face range into a part, in place', () => {
    const s0 = threeParts();
    const k = ids(s0);
    // The bottom face (two triangles) in chrome: its slice is centred 20 mm below the part's origin.
    const s = apply(s0, { type: 'material/assign', preset: 'CHROME', targets: [k.a], faces: { part: k.a, indices: [0, 1] }, mode: 'REPLACE' }, { type: 'scene/select', ids: [k.a], mode: 'set' });
    const verticesBefore = worldVertices(s, k.a);
    const t = apply(s, { type: 'scene/separateByMaterial', ids: [k.a], names: {} });
    expect(t.scene.nodes[k.a]).toBeUndefined();
    const made = t.scene.nodes[k.group].children.slice(0, 2);
    expect(t.scene.nodes[k.group].children.slice(2)).toEqual([k.b, k.c]);
    expect(t.selection.ids).toEqual(made);
    const [chrome, gold] = [t.scene.nodes[made[0]], t.scene.nodes[made[1]]];
    expect(chrome.material).not.toBe(gold.material);
    expect(t.materials[chrome.material!].preset).toBe('CHROME');
    expect(chrome.mesh!.triangles + gold.mesh!.triangles).toBe(12);
    expect(chrome.transform.position[2] - s.scene.nodes[k.a].transform.position[2]).toBeCloseTo(-20, 6);
    expect(chrome.faceMaterials).toBeUndefined();
    // The geometry stays where it was.
    const after = [...worldVertices(t, made[0]), ...worldVertices(t, made[1])];
    for (const v of after) expect(verticesBefore.some((w) => length(sub(v, w)) < 1e-4)).toBe(true);
  });

  it('a light aims at a point', () => {
    const s = threeParts();
    const k = ids(s);
    const light: SceneNode = { id: 'lightA', name: 'Light', kind: 'LIGHT', parent: null, children: [], transform: { position: [0, -200, 200], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false, target: [0, 0, 0] };
    const withLight: ProjectState = { ...s, scene: { ...s.scene, nodes: { ...s.scene.nodes, lightA: light }, roots: [...s.scene.roots, 'lightA'] } };
    const t = apply(withLight, { type: 'scene/aim', id: 'lightA', target: [10, 0, 5] });
    expect(t.scene.nodes.lightA.target).toEqual([10, 0, 5]);
    expect(apply(withLight, { type: 'scene/aim', id: k.a, target: [1, 1, 1] })).toBe(withLight);
    // It moves with the move tool, about its origin.
    expect(pivotPoint(t, ['lightA'])).toEqual([0, -200, 200]);
  });
});

// --- One undo each ----------------------------------------------------------------------------

describe('undo', () => {
  it('every operation is undone by one undo', () => {
    const s0 = threeParts();
    const k = ids(s0);
    const s = apply(s0, { type: 'material/assign', preset: 'CHROME', targets: [k.b], faces: { part: k.b, indices: [0, 1] }, mode: 'REPLACE' });
    const actions: Action[] = [
      { type: 'scene/move', ids: [k.a, k.b], delta: [10, 0, 0], space: 'GLOBAL' },
      { type: 'scene/rotate', ids: [k.group], axis: 1, deg: 20, space: 'LOCAL' },
      { type: 'scene/scale', ids: [k.c], factors: [1.5, 1, 1], space: 'LOCAL' },
      { type: 'scene/setTransforms', transforms: { [k.a]: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } } },
      { type: 'scene/restOnFloor', ids: [k.group] },
      { type: 'scene/center', ids: [k.group] },
      { type: 'scene/centerAndRest', ids: [k.a] },
      { type: 'scene/setPivot', ids: [k.a], mode: 'BASE' },
      { type: 'scene/duplicate', ids: [k.a], linked: false },
      { type: 'scene/duplicate', ids: [k.a], linked: true },
      { type: 'scene/group', ids: [k.a, k.b], name: 'Group' },
      { type: 'scene/ungroup', ids: [k.group] },
      { type: 'scene/reparent', ids: [k.c], parent: k.model },
      { type: 'scene/pattern', ids: [k.a], params: { kind: 'LINEAR', count: 3, offset: [30, 0, 0], space: 'GLOBAL', axis: 2, angleDeg: 360 }, name: 'Pattern' },
      { type: 'scene/flipNormals', ids: [k.a] },
      { type: 'scene/setSmoothAngle', ids: [k.a], deg: 60 },
      { type: 'scene/separateByMaterial', ids: [k.b] },
      { type: 'scene/setVisible', ids: [k.a, k.b], visible: false },
      { type: 'scene/isolate', ids: [k.a, k.c] },
      { type: 'scene/setLocked', ids: [k.a, k.b], locked: true },
      { type: 'scene/rename', id: k.a, name: 'Renamed' },
      { type: 'scene/delete', ids: [k.a, k.b] },
      { type: 'material/unlink', parts: [k.a] },
      { type: 'material/paste', instance: s.materials[s.scene.nodes[k.c].material!], targets: [k.a, k.b] },
      { type: 'material/assign', material: s.scene.nodes[k.c].material!, targets: [k.a], mode: 'REPLACE' },
    ];
    // Unlink needs a shared instance: link a with c first.
    const linked = apply(s, { type: 'material/assign', material: s.scene.nodes[k.c].material!, targets: [k.a], mode: 'REPLACE' });
    for (const action of actions) {
      const base = action.type === 'material/unlink' ? linked : s;
      const store = createStore(base);
      const before = store.get();
      store.dispatch(action);
      expect(store.get().scene !== before.scene || store.get().materials !== before.materials, action.type).toBe(true);
      expect(store.history().undo, action.type).toHaveLength(1);
      store.undo();
      expect(store.get().scene, action.type).toBe(before.scene);
      expect(store.get().materials, action.type).toBe(before.materials);
    }
    // The pattern edit too.
    const store = createStore(s);
    store.dispatch({ type: 'scene/pattern', ids: [k.a], params: { kind: 'LINEAR', count: 3, offset: [30, 0, 0], space: 'GLOBAL', axis: 2, angleDeg: 360 }, name: 'Pattern' });
    const g = store.get().selection.ids[0];
    const before = store.get();
    store.dispatch({ type: 'scene/editPattern', id: g, patch: { count: 5 } } satisfies TransformAction);
    expect(store.get().scene.nodes[g].children).toHaveLength(5);
    store.undo();
    expect(store.get().scene).toBe(before.scene);
  });

  it('fixtures: the boxes are 20 x 20 x 40', () => {
    const s = threeParts();
    expect(boxSize(boundsOf(s, [ids(s).b]))).toEqual([20, 20, 40]);
  });
});

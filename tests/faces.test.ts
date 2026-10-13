// Phase M1: whole CAD faces. What a click at the Faces level selects (ROADMAP M1 criterion): a flat plate, a
// plate with duplicated vertices, a cylinder with caps (the whole wall, stopping at the caps), a flat-fillet-wall
// profile, and a marked edge; the CAD faces of a STEP part win; and "Separate by CAD faces" as a store action.
// Each case is written so that it fails when the condition it checks is taken out of core/faces.ts (the mutations
// are listed in the ROADMAP paragraph of the phase).

import { describe, expect, it } from 'vitest';
import { cadFaceRegion, canSeparateByFaces, coveringRanges, crossingLimitDeg, facePieces, FACE_FLAT_DEG, LIVE_EDGE_DEG } from '../src/core/faces';
import { buildMesh, getMesh, type MeshData } from '../src/core/meshes';
import { createStore } from '../src/core/store';
import { hasCadFaces } from '../src/core/transform';
import { cross, length, sub, type Vec3 } from '../src/core/math';
import * as cmd from '../src/ui/commands';
import { contextKey } from '../src/ui/panels/inspector';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { createUiStore } from '../src/ui/ui-state';
import { cadBox, sceneWith } from './cad-fixtures';
import { apply } from './helpers';

// --- Fixtures -------------------------------------------------------------------------------------

type P = [number, number, number];
type Tri = [P, P, P];

/** The integers from `from` to `to`, both included. */
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Two triangles for a quad a, b, c, d (counter-clockwise seen from the side the normal points to). */
const quad = (a: P, b: P, c: P, d: P): Tri[] => [
  [a, b, c],
  [a, c, d],
];

/** The soup as a welded, indexed mesh, the way an importer builds it (`buildMesh`: hard edges beyond 30 degrees). */
function welded(tris: Tri[]): MeshData {
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => t.forEach((p, k) => positions.set(p, 9 * i + 3 * k)));
  const built = buildMesh({ positions });
  if (!built) throw new Error('empty mesh');
  expect(Array.from(built.source)).toEqual(tris.map((_, i) => i));
  return built.data;
}

/** The soup with three vertices of its own per triangle (a tessellator that splits every seam), no hard edges. */
function split(tris: Tri[], jitter = 0): MeshData {
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => t.forEach((p, k) => positions.set(p.map((v, axis) => v + jitter * ((i * 7 + k * 3 + axis) % 5 - 2)), 9 * i + 3 * k)));
  return { positions, normals: new Float32Array(positions.length), indices: Uint32Array.from({ length: tris.length * 3 }, (_, i) => i) };
}

/** A plate `nx` by `ny` by 1: the top and the bottom in a grid of quads, each side one quad. Triangles: top, bottom, sides. */
function plate(nx: number, ny: number): { tris: Tri[]; top: number[]; bottom: number[]; sides: number[] } {
  const tris: Tri[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) tris.push(...quad([i, j, 1], [i + 1, j, 1], [i + 1, j + 1, 1], [i, j + 1, 1]));
  const top = range(0, tris.length - 1);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) tris.push(...quad([i, j, 0], [i, j + 1, 0], [i + 1, j + 1, 0], [i + 1, j, 0]));
  const bottom = range(top.length, tris.length - 1);
  tris.push(...quad([0, 0, 0], [nx, 0, 0], [nx, 0, 1], [0, 0, 1]));
  tris.push(...quad([nx, 0, 0], [nx, ny, 0], [nx, ny, 1], [nx, 0, 1]));
  tris.push(...quad([nx, ny, 0], [0, ny, 0], [0, ny, 1], [nx, ny, 1]));
  tris.push(...quad([0, ny, 0], [0, 0, 0], [0, 0, 1], [0, ny, 1]));
  const sides = range(top.length + bottom.length, tris.length - 1);
  return { tris, top, bottom, sides };
}

/** A cylinder of radius 1 and height 2 with `n` segments and caps: the wall (two triangles a segment), the top fan, the bottom fan. */
function cylinder(n: number): { tris: Tri[]; wall: number[]; topCap: number[]; bottomCap: number[] } {
  const tris: Tri[] = [];
  const at = (k: number, z: number): P => [Math.cos((2 * Math.PI * k) / n), Math.sin((2 * Math.PI * k) / n), z];
  for (let k = 0; k < n; k++) tris.push(...quad(at(k, 0), at(k + 1, 0), at(k + 1, 2), at(k, 2)));
  const wall = tris.map((_, i) => i);
  for (let k = 0; k < n; k++) tris.push([[0, 0, 2], at(k, 2), at(k + 1, 2)].reverse() as unknown as Tri);
  const topCap = Array.from({ length: n }, (_, k) => wall.length + k);
  for (let k = 0; k < n; k++) tris.push([[0, 0, 0], at(k + 1, 0), at(k, 0)] as Tri);
  const bottomCap = Array.from({ length: n }, (_, k) => wall.length + n + k);
  return { tris, wall, topCap, bottomCap };
}

/**
 * A strip, one unit wide in y, extruded from a profile in the x-z plane: one quad (two triangles) a segment, in the
 * order of the profile. The normals point up and to the right for a profile that runs right and down.
 */
function strip(profile: [number, number][]): Tri[] {
  const tris: Tri[] = [];
  for (let i = 0; i + 1 < profile.length; i++) {
    const [x0, z0] = profile[i];
    const [x1, z1] = profile[i + 1];
    tris.push(...quad([x0, 0, z0], [x1, 0, z1], [x1, 1, z1], [x0, 1, z0]));
  }
  return tris;
}

// --- Faces by continuity of the surface ---------------------------------------------------------------

describe('a click takes the whole face', () => {
  it('a flat plate: the top, the bottom and each side are one face each', () => {
    const p = plate(4, 3);
    const mesh = welded(p.tris);
    expect(p.top).toHaveLength(24);
    expect(cadFaceRegion(mesh, 5)).toEqual(p.top);
    expect(cadFaceRegion(mesh, p.top[23])).toEqual(p.top);
    expect(cadFaceRegion(mesh, p.bottom[7])).toEqual(p.bottom);
    expect(cadFaceRegion(mesh, p.sides[0])).toEqual(p.sides.slice(0, 2));
    expect(cadFaceRegion(mesh, p.sides[5])).toEqual(p.sides.slice(4, 6));
  });

  it('a plate with duplicated vertices (a tessellator that splits every seam) is the same face', () => {
    const p = plate(4, 3);
    // Every triangle has vertices of its own, nothing marks an edge: only the positions say who touches whom.
    const mesh = split(p.tris);
    expect(cadFaceRegion(mesh, 9)).toEqual(p.top);
    expect(cadFaceRegion(mesh, p.bottom[0])).toEqual(p.bottom);
    expect(cadFaceRegion(mesh, p.sides[2])).toEqual(p.sides.slice(2, 4));
    // Positions a hair apart (well inside 1e-5 of the size of the plate) are the same vertex too...
    expect(cadFaceRegion(split(p.tris, 1e-7), 9)).toEqual(p.top);
    // ...and a crack of 1e-3 of the size is not: the triangles no longer touch.
    expect(cadFaceRegion(split(p.tris, 1e-3), 9)).not.toEqual(p.top);
  });

  it('a cylinder with caps: the whole wall, stopping at the caps; each cap on its own', () => {
    // 16 segments: the wall turns 22.5 degrees at each seam, less than the 30 of a live edge.
    const c = cylinder(16);
    const mesh = welded(c.tris);
    expect(cadFaceRegion(mesh, 0)).toEqual(c.wall);
    expect(cadFaceRegion(mesh, 17)).toEqual(c.wall);
    expect(cadFaceRegion(mesh, c.wall[31])).toEqual(c.wall);
    expect(cadFaceRegion(mesh, c.topCap[3])).toEqual(c.topCap);
    expect(cadFaceRegion(mesh, c.bottomCap[9])).toEqual(c.bottomCap);
    // The same with vertices split along every seam.
    expect(cadFaceRegion(split(c.tris), 5)).toEqual(c.wall);
    // A coarse cylinder (8 segments, 45 degrees a seam) has no wall: every facet is a face of its own.
    const coarse = cylinder(8);
    expect(cadFaceRegion(welded(coarse.tris), 0)).toEqual([0, 1]);
  });

  it('a flat-fillet-wall profile: the flat stops where the fillet begins, the wall too, the fillet is taken whole', () => {
    // A flat of two segments, a fillet of radius 5 in six steps of 15 degrees, a wall of two segments.
    const profile: [number, number][] = [[0, 0], [5, 0], [10, 0]];
    for (let k = 1; k <= 6; k++) profile.push([10 + 5 * Math.sin((k * 15 * Math.PI) / 180), -5 + 5 * Math.cos((k * 15 * Math.PI) / 180)]);
    profile.push([15, -12.5], [15, -20]);
    const mesh = welded(strip(profile));
    const flat = range(0, 3);
    const fillet = range(4, 15);
    const wall = range(16, 19);
    // The triangles that are not beside the fillet (0, 1, 3 and 16, 18, 19): all their edges are flat. A triangle beside
    // it measures the fillet as its own curvature (see the header of core/faces.ts).
    for (const t of [0, 1, 3]) expect(cadFaceRegion(mesh, t)).toEqual(flat);
    for (const t of [16, 18, 19]) expect(cadFaceRegion(mesh, t)).toEqual(wall);
    // A click on the fillet takes all of it (it may also follow the tangent surface it blends into).
    for (const t of fillet) expect(cadFaceRegion(mesh, t)).toEqual(expect.arrayContaining(fillet));
  });

  it('the angle between faces is held to 30 degrees whatever the curvature: curved faces do not leak over a sharp edge', () => {
    // Two arcs of 15 degrees a step (curvature 15, so 2.5 times is 37.5), joined by a 35 degree corner.
    const profile: [number, number][] = [[0, 0]];
    let angle = 0;
    const step = (turn: number, len = 1) => {
      angle += (turn * Math.PI) / 180;
      const [x, z] = profile[profile.length - 1];
      profile.push([x + len * Math.cos(angle), z - len * Math.sin(angle)]);
    };
    step(7.5);
    for (let k = 0; k < 3; k++) step(15);
    step(35 + 7.5);
    for (let k = 0; k < 3; k++) step(15);
    const mesh = welded(strip(profile));
    // The segments 0..3 are the first arc (8 triangles), 4..7 the second; the corner lies between segments 3 and 4.
    const first = range(0, 7);
    const second = range(8, 15);
    expect(cadFaceRegion(mesh, 2)).toEqual(first);
    expect(cadFaceRegion(mesh, 12)).toEqual(second);
    expect(crossingLimitDeg(15)).toBe(LIVE_EDGE_DEG);
  });

  it('a flat face is flat to its rim: the triangles next to a wall do not leak over a chamfer', () => {
    // Chamfer of 20 degrees, a flat of one segment, then a wall: the triangle beside the wall measures no curvature.
    const profile: [number, number][] = [[0, 2], [2 * Math.cos(Math.PI / 9), 2 - 2 * Math.sin(Math.PI / 9)]];
    const [cx, cz] = profile[1];
    profile.push([cx + 4, cz], [cx + 4, cz - 5]);
    const mesh = welded(strip(profile));
    const flat = range(2, 3);
    const wall = range(4, 5);
    // The triangle of the flat beside the wall: its only edge that is not flat is the 90 degree corner.
    expect(cadFaceRegion(mesh, 2)).toEqual(flat);
    expect(cadFaceRegion(mesh, 4)).toEqual(wall);
  });

  it('an edge the mesh marks is never crossed, flat or not; marked by one side, it cuts by position', () => {
    // A top of 4 by 2 quads with the edges along x = 2 marked.
    const p = plate(4, 2);
    const mesh = welded(p.tris);
    const left = p.top.filter((t) => p.tris[t].every((v) => v[0] <= 2));
    const right = p.top.filter((t) => p.tris[t].every((v) => v[0] >= 2));
    expect(cadFaceRegion(mesh, left[0])).toEqual(p.top);
    const onLine: number[] = [];
    for (let v = 0; v < mesh.positions.length / 3; v++) if (mesh.positions[3 * v] === 2 && mesh.positions[3 * v + 2] === 1) onLine.push(v);
    expect(onLine).toHaveLength(3);
    const marked = onLine.sort((a, b) => mesh.positions[3 * a + 1] - mesh.positions[3 * b + 1]);
    // (A mesh is not changed once it is made: the marked copy is another one.)
    const cut: MeshData = { ...mesh, sharpEdges: Uint32Array.from([marked[0], marked[1], marked[1], marked[2]]) };
    expect(cadFaceRegion(cut, left[0])).toEqual(left);
    expect(cadFaceRegion(cut, right[0])).toEqual(right);
    // The same cut in a mesh that has a vertex for every corner: the marked pair names vertices of the left side
    // only, and the triangles on the right still stop at it because they touch it by position.
    const loose = split(p.tris);
    const ends: number[] = [];
    p.top.forEach((t) => {
      if (!left.includes(t)) return;
      p.tris[t].forEach((v, k) => {
        if (v[0] === 2) ends.push(3 * t + k);
      });
    });
    const pairs: number[] = [];
    for (let a = 0; a < ends.length; a++) {
      for (let b = a + 1; b < ends.length; b++) {
        const pa = [0, 1, 2].map((axis) => loose.positions[3 * loose.indices[ends[a]] + axis]);
        const pb = [0, 1, 2].map((axis) => loose.positions[3 * loose.indices[ends[b]] + axis]);
        if (length(sub(pa as Vec3, pb as Vec3)) === 1) pairs.push(loose.indices[ends[a]], loose.indices[ends[b]]);
      }
    }
    expect(pairs.length).toBeGreaterThanOrEqual(4);
    loose.sharpEdges = Uint32Array.from(pairs);
    expect(cadFaceRegion(loose, left[0])).toEqual(left);
    expect(cadFaceRegion(loose, right[0])).toEqual(right);
  });

  it('the live-edge angle is a parameter: at 10 degrees the 22.5 degree seams of the wall cut', () => {
    const c = cylinder(16);
    const mesh = welded(c.tris);
    expect(cadFaceRegion(mesh, 0, { liveEdgeDeg: 10 })).toEqual([0, 1]);
    expect(cadFaceRegion(mesh, 0, { liveEdgeDeg: 40 })).toEqual(c.wall);
  });

  it('a triangle without area has no face but itself, and joins nothing', () => {
    const p = plate(2, 1);
    const sliver: Tri = [[0.5, 0.5, 1], [0.5, 0.5, 1], [1, 0.5, 1]];
    const tris = [...p.tris, sliver];
    const mesh = split(tris);
    expect(cadFaceRegion(mesh, tris.length - 1)).toEqual([tris.length - 1]);
    expect(cadFaceRegion(mesh, 0)).toEqual(p.top);
  });

  it('an index outside the mesh gives nothing', () => {
    const mesh = welded(plate(1, 1).tris);
    expect(cadFaceRegion(mesh, -1)).toEqual([]);
    expect(cadFaceRegion(mesh, 1000)).toEqual([]);
    expect(cadFaceRegion(mesh, 1.5)).toEqual([]);
  });

  it('a big flat face is found whole, whichever triangle is clicked (and the second click reuses the first one\'s work)', () => {
    const p = plate(100, 100);
    const mesh = welded(p.tris);
    expect(cadFaceRegion(mesh, 100)).toHaveLength(100 * 100 * 2);
    expect(cadFaceRegion(mesh, 4000)).toHaveLength(100 * 100 * 2);
    // The bottom is the other big face, and the sides are the thin ones.
    expect(cadFaceRegion(mesh, p.bottom[17])).toHaveLength(100 * 100 * 2);
    // (No clock here: the machine that runs the tests is shared. The growth is one pass over the triangles.)
  }, 60000);

  it('the limits: flat is one degree, the live edge thirty, a face may turn two and a half times its own curvature', () => {
    expect(FACE_FLAT_DEG).toBe(1);
    expect(LIVE_EDGE_DEG).toBe(30);
    expect(crossingLimitDeg(0)).toBe(1);
    expect(crossingLimitDeg(4)).toBe(10);
    expect(crossingLimitDeg(11.25)).toBeCloseTo(28.125, 9);
    expect(crossingLimitDeg(40)).toBe(30);
    expect(crossingLimitDeg(10, 5)).toBe(5);
  });
});

describe('the CAD faces of a STEP or IGES part win', () => {
  it('the click takes the run of triangles that holds the triangle, whatever the surface does', () => {
    // A plate whose top the CAD file cut in two faces: coplanar and touching, but two faces.
    const p = plate(4, 2);
    const mesh = welded(p.tris);
    const a = p.top.slice(0, 8);
    const b = p.top.slice(8);
    const faceRanges = [{ start: 0, count: 8 }, { start: 8, count: 8 }, { start: 16, count: p.tris.length - 16 }];
    expect(cadFaceRegion(mesh, 3)).toEqual(p.top);
    expect(cadFaceRegion(mesh, 3, { faceRanges })).toEqual(a);
    expect(cadFaceRegion(mesh, 12, { faceRanges })).toEqual(b);
    // A face that continues smoothly into another one (a cylinder as one CAD face with its cap) stays its own run.
    const c = cylinder(16);
    const cyl = welded(c.tris);
    const wallOnly = [{ start: 0, count: 8 }, { start: 8, count: 24 }, { start: 32, count: 16 }, { start: 48, count: 16 }];
    expect(cadFaceRegion(cyl, 3, { faceRanges: wallOnly })).toEqual(range(0, 7));
  });

  it('ranges that do not hold the triangle (or lie outside the mesh) fall back to the surface', () => {
    const p = plate(2, 2);
    const mesh = welded(p.tris);
    expect(cadFaceRegion(mesh, 3, { faceRanges: [{ start: 40, count: 4 }] })).toEqual(p.top);
    expect(cadFaceRegion(mesh, 3, { faceRanges: [{ start: 0, count: 500 }] })).toEqual(p.top);
    expect(cadFaceRegion(mesh, 3, { faceRanges: [] })).toEqual(p.top);
  });
});

// --- The click at the Faces level -----------------------------------------------------------------

describe('a click at the Faces level', () => {
  function faceCtx() {
    const { state, part } = sceneWith(cadBox());
    const ctx: Ctx = { store: createStore(state), ui: createUiStore(), services: { viewport: null } as unknown as AppServices };
    ctx.store.dispatch({ type: 'scene/setLevel', level: 'FACES' });
    return { ctx, part };
  }
  const faces = (ctx: Ctx) => ctx.store.get().selection.faces;

  it('takes the whole CAD face, and the next click replaces it', () => {
    const { ctx, part } = faceCtx();
    cmd.selectFaceAt(ctx, part, 5);
    expect(faces(ctx)).toEqual({ part, indices: [4, 5] });
    cmd.selectFaceAt(ctx, part, 8);
    expect(faces(ctx)).toEqual({ part, indices: [8, 9] });
    expect(ctx.store.get().selection.level).toBe('FACES');
  });

  it('Shift takes the triangle alone, and adds it', () => {
    const { ctx, part } = faceCtx();
    cmd.selectFaceAt(ctx, part, 5, { loose: true, mode: 'set' });
    expect(faces(ctx)).toEqual({ part, indices: [5] });
    cmd.selectFaceAt(ctx, part, 8, { loose: true, mode: 'add' });
    cmd.selectFaceAt(ctx, part, 8, { loose: true, mode: 'add' });
    expect(faces(ctx)).toEqual({ part, indices: [5, 8] });
  });

  it('Ctrl takes a face in or out: out when the triangle that was hit is already selected', () => {
    const { ctx, part } = faceCtx();
    cmd.selectFaceAt(ctx, part, 0);
    cmd.selectFaceAt(ctx, part, 5, { mode: 'toggle' });
    expect(faces(ctx)).toEqual({ part, indices: [0, 1, 4, 5] });
    cmd.selectFaceAt(ctx, part, 4, { mode: 'toggle' });
    expect(faces(ctx)).toEqual({ part, indices: [0, 1] });
    // Ctrl and Shift together: one triangle in or out.
    cmd.selectFaceAt(ctx, part, 7, { mode: 'toggle', loose: true });
    expect(faces(ctx)).toEqual({ part, indices: [0, 1, 7] });
    cmd.selectFaceAt(ctx, part, 1, { mode: 'toggle', loose: true });
    expect(faces(ctx)).toEqual({ part, indices: [0, 7] });
  });

  it('Alt takes the face out, and does nothing where it is not selected', () => {
    const { ctx, part } = faceCtx();
    cmd.selectFaceAt(ctx, part, 0);
    cmd.selectFaceAt(ctx, part, 5, { mode: 'add' });
    cmd.selectFaceAt(ctx, part, 4, { mode: 'remove' });
    expect(faces(ctx)).toEqual({ part, indices: [0, 1] });
    cmd.selectFaceAt(ctx, part, 9, { mode: 'remove' });
    expect(faces(ctx)).toEqual({ part, indices: [0, 1] });
  });

  it('does nothing for a triangle outside the mesh or a node that is not a part', () => {
    const { ctx, part } = faceCtx();
    cmd.selectFaceAt(ctx, part, 99);
    cmd.selectFaceAt(ctx, 'model', 0);
    cmd.selectFaceAt(ctx, 'ghost', 0);
    expect(faces(ctx)).toBeUndefined();
  });

  it('brings the material section in: the inspector is rebuilt for the first face, not for the next ones', () => {
    // A part that is selected first and the Faces level chosen after (the usual way): the inspector shows a note to
    // click a face. It has to change when a face is selected, or the click would do nothing the person can see.
    const { ctx, part } = faceCtx();
    ctx.store.dispatch({ type: 'scene/select', ids: [part], mode: 'set', level: 'FACES' });
    const none = contextKey(ctx.store.get());
    cmd.selectFaceAt(ctx, part, 5);
    const some = contextKey(ctx.store.get());
    expect(some).not.toBe(none);
    cmd.selectFaceAt(ctx, part, 8);
    cmd.selectFaceAt(ctx, part, 0, { mode: 'add', loose: true });
    expect(contextKey(ctx.store.get())).toBe(some);
    ctx.store.dispatch({ type: 'scene/selectFaces', part, indices: [0, 1, 4, 5, 8, 9], mode: 'remove' });
    expect(contextKey(ctx.store.get())).toBe(none);
    // The levels above Faces do not care.
    ctx.store.dispatch({ type: 'scene/select', ids: [part], mode: 'set', level: 'PART' });
    expect(contextKey(ctx.store.get())).toBe(`parts:${part}`);
  });

  it('the selection of faces is not an undo entry', () => {
    const { ctx, part } = faceCtx();
    cmd.selectFaceAt(ctx, part, 5);
    expect(ctx.store.history().undo).toEqual([]);
  });
});

// --- Separate by CAD faces ----------------------------------------------------------------------------

describe('Separate by CAD faces', () => {
  it('turns a part with CAD faces into one part per face, in place, keeping the geometry where it was', () => {
    const { state: s0, part } = sceneWith(cadBox());
    expect(canSeparateByFaces(s0.scene.nodes[part])).toBe(true);
    const s = apply(s0, { type: 'scene/select', ids: [part], mode: 'set', level: 'PART' });
    const world = (st: typeof s, id: string): Vec3[] => {
      const node = st.scene.nodes[id];
      const data = getMesh(node.mesh!.id)!;
      const out: Vec3[] = [];
      for (let v = 0; v < data.positions.length / 3; v++) out.push([0, 1, 2].map((k) => data.positions[3 * v + k] + node.transform.position[k]) as Vec3);
      return out;
    };
    const before = world(s, part);
    const t = apply(s, { type: 'scene/separateByCadFaces', ids: [part] });
    expect(t.scene.nodes[part]).toBeUndefined();
    const made = t.scene.nodes[t.scene.nodes[Object.keys(t.scene.nodes).find((id) => t.scene.nodes[id].kind === 'MODEL')!].children[0] as string] ? t.selection.ids : [];
    expect(made).toHaveLength(6);
    expect(made.map((id) => t.scene.nodes[id].name)).toEqual(['Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5', 'Box 6']);
    for (const id of made) {
      expect(t.scene.nodes[id].mesh!.triangles).toBe(2);
      expect(t.scene.nodes[id].faceRanges).toEqual([{ start: 0, count: 2 }]);
      expect(t.scene.nodes[id].material).toBe(s.scene.nodes[part].material);
      expect(t.scene.nodes[id].parent).toBe(s.scene.nodes[part].parent);
    }
    // The model lists the pieces where the part was.
    const parent = t.scene.nodes[s.scene.nodes[part].parent!];
    expect(parent.children).toEqual(made);
    // Every vertex of every piece is a vertex the part had.
    const after = made.flatMap((id) => world(t, id));
    for (const v of after) expect(before.some((w) => length(sub(v, w)) < 1e-4)).toBe(true);
    expect(after).toHaveLength(24);
    expect(t.selection.level).toBe('PART');
  });

  it('keeps the colour of each face, whole or by faces, and the level out of Faces', () => {
    const { state: s0, part } = sceneWith(cadBox());
    // The third face (triangles 4 and 5) in chrome.
    const s = apply(
      s0,
      { type: 'material/assign', preset: 'CHROME', targets: [part], faces: { part, indices: [4, 5] }, mode: 'REPLACE' },
      { type: 'scene/select', ids: [part], mode: 'set', level: 'PART' },
      { type: 'scene/selectFaces', part, indices: [4, 5], mode: 'set' },
    );
    expect(s.selection.level).toBe('FACES');
    const t = apply(s, { type: 'scene/separateByCadFaces', ids: [part] });
    expect(t.selection.level).toBe('PART');
    const pieces = Object.values(t.scene.nodes).filter((n) => n.kind === 'PART');
    expect(pieces).toHaveLength(6);
    const chrome = pieces.filter((n) => t.materials[n.material!].preset === 'CHROME');
    expect(chrome.map((n) => n.name)).toEqual(['Box 3']);
    expect(pieces.filter((n) => t.materials[n.material!].preset === 'GOLD')).toHaveLength(5);
    expect(pieces.every((n) => n.faceMaterials === undefined)).toBe(true);
  });

  it('a face with two materials keeps the second as a face material of its piece', () => {
    const { state: s0, part } = sceneWith(cadBox());
    const s = apply(s0, { type: 'material/assign', preset: 'CHROME', targets: [part], faces: { part, indices: [1] }, mode: 'REPLACE' });
    const t = apply(s, { type: 'scene/separateByCadFaces', ids: [part] });
    const first = Object.values(t.scene.nodes).find((n) => n.name === 'Box 1')!;
    // The first triangle is gold, so the piece is gold and the second triangle stays chrome.
    expect(t.materials[first.material!].preset).toBe('GOLD');
    expect(first.faceMaterials).toEqual([{ start: 1, count: 1, material: t.materials[first.faceMaterials![0].material].id }]);
    expect(t.materials[first.faceMaterials![0].material].preset).toBe('CHROME');
  });

  it('is one undo, and does nothing to a part without CAD faces or to a model with none', () => {
    const { state: s0, part } = sceneWith(cadBox());
    const store = createStore(s0);
    const before = store.get();
    store.dispatch({ type: 'scene/separateByCadFaces', ids: [part], label: 'Separate' });
    expect(store.history().undo).toEqual(['Separate']);
    expect(Object.values(store.get().scene.nodes).filter((n) => n.kind === 'PART')).toHaveLength(6);
    store.undo();
    expect(store.get().scene).toBe(before.scene);
    expect(store.get().materials).toBe(before.materials);
    // The same part without its faces, or with faces that do not cover it: untouched, no history entry.
    for (const ranges of [undefined, [{ start: 0, count: 12 }], cadBox().faces.slice(1)]) {
      const n = { ...s0.scene.nodes[part], faceRanges: ranges };
      if (!ranges) delete n.faceRanges;
      const s = { ...s0, scene: { ...s0.scene, nodes: { ...s0.scene.nodes, [part]: n } } };
      expect(canSeparateByFaces(n)).toBe(false);
      expect(apply(s, { type: 'scene/separateByCadFaces', ids: [part] })).toBe(s);
    }
    expect(apply(s0, { type: 'scene/separateByCadFaces', ids: [] })).toBe(s0);
  });

  it('the command names it "Separate Box by CAD faces", and is not offered where there is nothing to cut', () => {
    const { state, part } = sceneWith(cadBox());
    const ctx: Ctx = { store: createStore(state), ui: createUiStore(), services: { viewport: null } as unknown as AppServices };
    expect(hasCadFaces(state, [part])).toBe(true);
    expect(hasCadFaces(state, [])).toBe(false);
    cmd.separateByCadFaces(ctx, [part]);
    expect(ctx.store.history().undo).toEqual(['Separate Box by CAD faces']);
    // Nothing left to cut: the command does nothing.
    cmd.separateByCadFaces(ctx, ctx.store.get().selection.ids);
    cmd.separateByCadFaces(ctx, [part]);
    expect(ctx.store.history().undo).toHaveLength(1);
    expect(hasCadFaces(ctx.store.get(), Object.keys(ctx.store.get().scene.nodes))).toBe(false);
  });

  it('cuts only the parts that carry faces, and a linked copy keeps the whole mesh', () => {
    const { state: s0, part } = sceneWith(cadBox());
    const withCopy = apply(s0, { type: 'scene/duplicate', ids: [part], linked: true });
    const copy = withCopy.selection.ids[0];
    const t = apply(withCopy, { type: 'scene/separateByCadFaces', ids: [part] });
    expect(t.scene.nodes[copy].mesh!.triangles).toBe(12);
    expect(t.scene.nodes[copy].faceRanges).toHaveLength(6);
    expect(t.scene.nodes[part]).toBeUndefined();
    expect(Object.values(t.scene.nodes).filter((n) => n.kind === 'PART')).toHaveLength(7);
  });

  it('the pieces of a part and the ranges that cover it', () => {
    const { state, part } = sceneWith(cadBox());
    const node = state.scene.nodes[part];
    const pieces = facePieces(node);
    expect(pieces.map((p) => p.tris)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11]]);
    expect(pieces.map((p) => p.name)).toEqual(['Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5', 'Box 6']);
    expect(coveringRanges(node.faceRanges, 12)).toHaveLength(6);
    expect(coveringRanges(node.faceRanges, 13)).toBeNull();
    expect(coveringRanges(undefined, 12)).toBeNull();
    expect(coveringRanges([], 0)).toBeNull();
    expect(facePieces({ ...node, faceRanges: undefined })).toEqual([]);
  });
});

// A reminder to the next reader: the dihedral angle of two triangles is the angle between their normals.
describe('fixtures', () => {
  it('the cylinder wall turns 22.5 degrees at each seam', () => {
    const c = cylinder(16);
    const n = (t: Tri) => {
      const v = cross(sub(t[1], t[0]), sub(t[2], t[0]));
      const l = length(v);
      return v.map((x) => x / l) as Vec3;
    };
    const a = n(c.tris[0]);
    const b = n(c.tris[2]);
    expect((Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * 180) / Math.PI).toBeCloseTo(22.5, 6);
  });
});

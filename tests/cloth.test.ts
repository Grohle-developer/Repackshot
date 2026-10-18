// Phase S9 on the interface's side (ROADMAP S9): the fabric catalogue and its agreement with the engine's tests, the
// simulated sheet (the splits, a face's rim held, closed shells), the anchors, what the cloth simulator is given (and
// that the rigid one no longer is: a cloth part is neither a body nor static), the wind, the CLT1 bytes, the recording
// (the cache) and the part as the pose shows it, in Fast's terms and in the engine's scene; the store's actions (one undo
// step); a project with a cloth clip saved and opened again; and the physics bar with a simulator that answers like the
// worker, with and without cloth in the engine, and Drape over the part.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate, playheadPose } from '../src/core/animation';
import {
  anchoredVertices,
  clothFrame,
  clothFrameIndex,
  clothLevels,
  clothMesh,
  clothParams,
  clothParts,
  clothSpec,
  ClothTrackWriter,
  clothWind,
  cltBytes,
  drapePlacement,
  isClothTrack,
  posedCloth,
  type ClothTrack,
} from '../src/core/cloth';
import { mat4Compose, mat4Identity, mat4Invert, transformPoint, type Vec3 } from '../src/core/math';
import { getMesh, registerMesh, type MeshData } from '../src/core/meshes';
import { clothClip, physicsSpec, type PhysicsResult, type PhysicsRunHandle, type PhysicsStarted, type PhysicsUpdate } from '../src/core/physics';
import { defaultParams } from '../src/core/primitives';
import { worldMatrix, type NodeId } from '../src/core/scene';
import { createInitialState, createStore, reduce, type ProjectState } from '../src/core/store';
import { AUTO_DIVISIONS, CLOTH_DEFAULTS, DEFAULT_FABRIC, FABRIC_PRESETS, fabricPreset, MAX_CLOTH_TRIANGLES } from '../src/data/fabrics';
import { BUILT_ROLES } from '../src/data/physics';
import type { PrimitiveKind } from '../src/data/primitives';
import { loadProject, migrateProject, serializeProject } from '../src/io/project';
import { projectScene } from '../src/io/rsb';
import { PhysicsClient } from '../src/render/physics';
import type { PhysicsReply, PhysicsRequest } from '../src/render/physics-worker';
import * as phys from '../src/ui/physics';
import type { AppServices, PhysicsPort } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { createUiStore } from '../src/ui/ui-state';

function addPrimitive(state: ProjectState, kind: PrimitiveKind, position: Vec3, name: string, params = defaultParams(kind, 200)): { state: ProjectState; id: NodeId } {
  const next = reduce(state, { type: 'scene/addPrimitive', kind, params, position, name });
  return { state: next, id: next.selection.ids[0] };
}

/** A box on the floor and, above it, a 300 mm plane of cloth. */
function sheetOverBox(): { state: ProjectState; box: NodeId; sheet: NodeId } {
  const a = addPrimitive(createInitialState(), 'BOX', [0, 0, 50], 'Box', { ...defaultParams('BOX', 200), width: 100, depth: 100, height: 100 });
  const b = addPrimitive(a.state, 'PLANE', [0, 0, 150], 'Sheet', { width: 300, depth: 300 });
  const s = reduce(b.state, { type: 'physics/set', ids: [b.id], patch: { role: 'CLOTH' } });
  return { state: s, box: a.id, sheet: b.id };
}

/** A flat mesh of `n × n` squares of side 1, in z = 0, with UVs. */
function grid(n: number): MeshData {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions.push(i, j, 0);
      uvs.push(i / n, j / n);
    }
  }
  const indices: number[] = [];
  const at = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  const normals = new Float32Array(positions.length);
  for (let v = 0; v < normals.length / 3; v++) normals[3 * v + 2] = 1;
  return { positions: Float32Array.from(positions), normals, indices: Uint32Array.from(indices), uvs: Float32Array.from(uvs) };
}

function triangleNormalsZ(positions: ArrayLike<number>, indices: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const ux = positions[3 * b] - positions[3 * a];
    const uy = positions[3 * b + 1] - positions[3 * a + 1];
    const vx = positions[3 * c] - positions[3 * a];
    const vy = positions[3 * c + 1] - positions[3 * a + 1];
    out.push(ux * vy - uy * vx);
  }
  return out;
}

describe('the fabric catalogue', () => {
  it('has stable keys, sensible values, and the engine tests’ fabrics are the catalogue’s', () => {
    expect(FABRIC_PRESETS.map((f) => f.key)).toEqual(['SILK', 'COTTON_FINE', 'POPLIN', 'LINEN', 'WOOL', 'DENIM', 'CANVAS', 'FELT', 'LEATHER_THIN', 'LEATHER_THICK', 'NEOPRENE']);
    expect(FABRIC_PRESETS.map((f) => f.weightGsm)).toEqual([60, 120, 150, 200, 300, 400, 600, 800, 900, 1200, 1500]);
    for (const f of FABRIC_PRESETS) {
      for (const v of [f.weightGsm, f.stretch, f.bend, f.damping, f.thicknessMm, f.friction]) expect(v).toBeGreaterThan(0);
      expect(f.label.en && f.label.es).toBeTruthy();
    }
    expect(fabricPreset('NOT_A_FABRIC').key).toBe(DEFAULT_FABRIC);
    // rt_phys::example::{SILK, LEATHER_THICK}, written by the engine's tests.
    const engine = JSON.parse(readFileSync('tests/fixtures/cloth-fabrics.json', 'utf8')) as Record<string, Record<string, number>>;
    for (const [key, values] of Object.entries(engine)) {
      const f = fabricPreset(key);
      expect(f.key).toBe(key);
      for (const [k, v] of Object.entries(values)) expect(f[k as keyof typeof f], `${key}.${k}`).toBeCloseTo(v, 9);
    }
    expect(BUILT_ROLES.has('CLOTH')).toBe(true);
  });

  it('Weight and Stiffness go on top of the preset; Thickness is the collision distance', () => {
    const silk = fabricPreset('SILK');
    const p = clothParams({ fabric: 'SILK', weightGsm: 90, stiffness: 2, thicknessMm: 4, keepArea: true, selfCollision: false });
    expect(p.massPerArea).toBeCloseTo(0.09, 9);
    expect(p.stretch).toBe(silk.stretch * 2);
    expect(p.bend).toBe(silk.bend * 2);
    expect(p.thickness).toBe(4);
    expect(p.area).toBe(silk.stretch * 2);
    expect(p.selfCollision).toBe(false);
    const d = clothParams({});
    expect(d.massPerArea).toBeCloseTo(fabricPreset(DEFAULT_FABRIC).weightGsm / 1000, 9);
    expect([d.area, d.pressure, d.selfCollision]).toEqual([0, CLOTH_DEFAULTS.pressure, true]);
  });
});

describe('the simulated sheet', () => {
  it('splits every triangle in four, keeping the winding, the order of the faces and the UVs halfway', () => {
    const m = grid(1);
    const sheet = clothMesh(m, undefined, 2);
    expect(sheet.indices.length / 3).toBe(2 * 16);
    // (2 × 4 + 1)² distinct positions once welded.
    expect(new Set(sheet.weld).size).toBe(25);
    for (const z of triangleNormalsZ(sheet.positions, sheet.indices)) expect(z).toBeGreaterThan(0);
    // The children of triangle 0 come first, all inside it (x ≥ y).
    for (let t = 0; t < 16; t++) for (let c = 0; c < 3; c++) {
      const v = sheet.indices[3 * t + c];
      expect(sheet.positions[3 * v]).toBeGreaterThanOrEqual(sheet.positions[3 * v + 1]);
    }
    for (let v = 0; v < sheet.positions.length / 3; v++) {
      expect(sheet.uvs![2 * v]).toBeCloseTo(sheet.positions[3 * v], 6);
      expect(sheet.uvs![2 * v + 1]).toBeCloseTo(sheet.positions[3 * v + 1], 6);
    }
    expect(sheet.closed).toBe(false);
    // The same sheet every time (the recording names the mesh, the face and the levels).
    expect(clothMesh(m, undefined, 2)).toBe(sheet);
  });

  it('a face of a part is held along the rim it shares with the rest, midpoints included', () => {
    // Two squares side by side; the left one is cloth.
    const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0]);
    const indices = Uint32Array.from([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
    const m: MeshData = { positions, normals: new Float32Array(positions.length), indices };
    const sheet = clothMesh(m, [0, 1], 2);
    expect(sheet.indices.length / 3).toBe(32);
    for (let v = 0; v < sheet.positions.length / 3; v++) {
      const onRim = Math.abs(sheet.positions[3 * v] - 1) < 1e-6;
      expect(sheet.held[v], `vertex at ${sheet.positions[3 * v]}, ${sheet.positions[3 * v + 1]}`).toBe(onRim ? 1 : 0);
    }
  });

  it('knows a closed shell', () => {
    const { state } = addPrimitive(createInitialState(), 'BOX', [0, 0, 50], 'Box');
    const box = state.selection.ids[0];
    expect(clothMesh(getMesh(state.scene.nodes[box].mesh!.id)!, undefined, 1).closed).toBe(true);
  });

  it('splits as often as the resolution asks and no more than the cap allows', () => {
    const m = grid(1);
    const I = mat4Identity();
    expect(clothLevels(m, undefined, I, 0.3)).toBe(3); // the diagonal √2 / 2³ < 0.3
    expect(clothLevels(m, undefined, mat4Compose([0, 0, 0], [0, 0, 0], [10, 10, 10]), 3)).toBe(3); // in the world
    const auto = clothLevels(m, undefined, mat4Compose([0, 0, 0], [0, 0, 0], [300, 300, 300]), 0);
    expect(2 * 4 ** auto).toBeLessThanOrEqual(MAX_CLOTH_TRIANGLES);
    expect(2 * 4 ** (auto + 1)).toBeGreaterThan(MAX_CLOTH_TRIANGLES);
    expect(Math.SQRT2 / 2 ** auto).toBeLessThan((1 / AUTO_DIVISIONS) * 4);
  });
});

describe('anchors', () => {
  it('Top edge holds the open edge’s highest vertices, not a peak inside the cloth', () => {
    // A tent: 3 × 3 vertices, the middle one raised to z = 1, the rim at z = 0 (all of it open).
    const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 1, 2, 1, 0, 0, 2, 0, 1, 2, 0, 2, 2, 0]);
    const indices: number[] = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const a = j * 3 + i;
      indices.push(a, a + 1, a + 4, a, a + 4, a + 3);
    }
    const weld = Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...anchoredVertices(positions, Uint32Array.from(indices), weld, { anchor: 'TOP_EDGE' })]).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    // A curtain: its top row.
    const curtain = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]);
    expect([...anchoredVertices(curtain, Uint32Array.from([0, 1, 3, 0, 3, 2]), Uint32Array.from([0, 1, 2, 3]), { anchor: 'TOP_EDGE' })]).toEqual([0, 0, 1, 1]);
    expect([...anchoredVertices(curtain, Uint32Array.from([0, 1, 3, 0, 3, 2]), Uint32Array.from([0, 1, 2, 3]), {})]).toEqual([0, 0, 0, 0]);
  });

  it('Box holds what is inside its shares of the cloth’s extent (a flat axis counts as its middle)', () => {
    const curtain = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]);
    const tris = Uint32Array.from([0, 1, 3, 0, 3, 2]);
    const weld = Uint32Array.from([0, 1, 2, 3]);
    // The default: the top tenth.
    expect([...anchoredVertices(curtain, tris, weld, { anchor: 'BOX' })]).toEqual([0, 0, 1, 1]);
    expect([...anchoredVertices(curtain, tris, weld, { anchor: 'BOX', box: { min: [0, 0, 0], max: [0.5, 1, 1] } })]).toEqual([1, 0, 1, 0]);
    // A flat sheet is not held by a box of its top tenth.
    const flat = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    expect([...anchoredVertices(flat, tris, weld, { anchor: 'BOX' })]).toEqual([0, 0, 0, 0]);
  });
});

describe('what the simulators are given', () => {
  it('a cloth part is neither a rigid body nor static; it meets the other parts as triangles, the floor and the wind', () => {
    const { state, box, sheet } = sheetOverBox();
    expect(clothParts(state)).toEqual([sheet]);
    // The rigid world: the sheet is not in it, not even when it is marked to fall with the box.
    const dropped = physicsSpec(state, [box])!;
    expect(dropped.statics.map((s) => s.piece.part)).toEqual([]);
    expect(physicsSpec(state, [sheet])).toBeNull();
    // The cloth: the sheet over the box (static here), split to its resolution.
    const spec = clothSpec(state)!;
    expect(spec.pieces.map((p) => p.part)).toEqual([sheet]);
    const piece = spec.pieces[0];
    expect(piece.indices.length / 3).toBe(2 * 4 ** piece.levels);
    expect(piece.indices.length / 3).toBeLessThanOrEqual(MAX_CLOTH_TRIANGLES);
    // In the world: the sheet at z = 150.
    for (let v = 0; v < piece.positions.length / 3; v++) expect(piece.positions[3 * v + 2]).toBeCloseTo(150, 3);
    expect(spec.statics).toHaveLength(1);
    expect(Math.max(...spec.statics[0].positions.filter((_, i) => i % 3 === 2))).toBeCloseTo(100, 3);
    expect(spec.floor).toEqual({ z: 0, friction: 0.6 });
    // A moving body is not static for the cloth (the world pushes it instead).
    expect(clothSpec(state, new Set([box]))!.statics).toHaveLength(0);
    // Hidden or locked: not cloth.
    expect(clothParts(reduce(state, { type: 'scene/setVisible', ids: [sheet], visible: false }))).toEqual([]);
    expect(clothParts(reduce(state, { type: 'scene/setLocked', ids: [sheet], locked: true }))).toEqual([]);
  });

  it('the wind is the switched-on effects’, with gusts from the windiest', () => {
    let s = createInitialState();
    expect(clothWind(s)).toEqual({ velocity: [0, 0, 0], gust: 0, scale: 0, speed: 0, seed: 0 });
    s = reduce(s, { type: 'effect/add', preset: 'RAIN' });
    const id = s.effects[0].id;
    s = reduce(s, { type: 'effect/set', id, patch: { wind: [3, 1, 0], chaos: 0.8, turbulenceScaleMm: 200, turbulenceSpeed: 0.5, seed: 7 } });
    s = reduce(s, { type: 'effect/add', preset: 'DUST_MOTES' });
    s = reduce(s, { type: 'effect/set', id: s.effects[1].id, patch: { wind: [1, 0, 0] } });
    const w = clothWind(s);
    expect(w.velocity).toEqual([4000, 1000, 0]);
    expect(w.gust).toBeCloseTo(0.4, 9);
    expect([w.scale, w.speed, w.seed]).toEqual([200, 500, 7]);
    // Switched off, it does not blow.
    expect(clothWind(reduce(s, { type: 'effect/set', id, patch: { enabled: false } })).velocity).toEqual([1000, 0, 0]);
  });

  it('writes CLT1 as the engine reads it', () => {
    const { state } = sheetOverBox();
    const spec = clothSpec(reduce(state, { type: 'physics/cloth', ids: [state.selection.ids[0]], patch: { anchor: 'BOX', box: { min: [0, 0, 0], max: [0.1, 1, 1] }, selfCollision: false } }))!;
    const bytes = cltBytes(spec);
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('CLT1');
    expect(view.getUint32(4, true)).toBe(1);
    expect(view.getUint32(8, true)).toBe(1);
    const p = spec.pieces[0];
    const nv = p.positions.length / 3;
    expect(view.getUint32(12, true)).toBe(nv);
    expect(view.getUint32(16, true)).toBe(p.indices.length);
    let at = 20 + nv * 12 + p.indices.length * 4;
    // The anchored vertices as bits.
    let pinned = 0;
    for (let w = 0; w < Math.ceil(nv / 32); w++) {
      let bits = view.getUint32(at, true);
      for (; bits; bits &= bits - 1) pinned++;
      at += 4;
    }
    expect(pinned).toBe([...p.pinned].filter(Boolean).length);
    expect(pinned).toBeGreaterThan(0);
    expect(view.getFloat32(at, true)).toBeCloseTo(p.params.massPerArea, 6);
    expect(view.getUint32(at + 32, true)).toBe(0); // no self-collision
    // Statics, floor and wind fill the rest exactly.
    at += 36;
    const statics = view.getUint32(at, true);
    expect(statics).toBe(spec.statics.length);
    at += 4;
    for (const s of spec.statics) at += 8 + s.positions.length * 4 + s.indices.length * 4;
    expect(view.getUint32(at, true)).toBe(1);
    expect(at + 12 + 28).toBe(bytes.length);
  });

  it('Drape over the part lays a sheet over the selection’s footprint, above its top', () => {
    const a = addPrimitive(createInitialState(), 'BOX', [0, 0, 50], 'Box', { ...defaultParams('BOX', 200), width: 100, depth: 60, height: 100 });
    const place = drapePlacement(a.state, [a.id])!;
    // 1.2 × the footprint's longer side (100) + 1.2 × the height (100).
    expect(place.params.width).toBeCloseTo(240, 6);
    expect(place.params.depth).toBeCloseTo(240, 6);
    expect(place.position[0]).toBeCloseTo(0, 6);
    expect(place.position[2]).toBeGreaterThan(100);
    expect(drapePlacement(createInitialState(), [])).toBeNull();
  });
});

describe('the recording', () => {
  it('a track brings the world frames back into the part’s space and survives itself', () => {
    const world = mat4Compose([10, 20, 30], [0, 0, 90], [2, 2, 2]);
    const inv = mat4Invert(world);
    const w = new ClothTrackWriter(24, { mesh: 'm', levels: 1, worldInv: inv, vertices: 2 });
    const local: Vec3[] = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    for (let k = 0; k < 5; k++) {
      // Two pieces' worth: this one starts at vertex 1.
      const frame = [99, 99, 99, ...local.flatMap((p) => transformPoint(world, [p[0], p[1], p[2] - k]))];
      w.push(frame, 1);
    }
    const track = w.track();
    expect(track.frames).toBe(5);
    expect(isClothTrack(track)).toBe(true);
    const f4 = clothFrame(track, 4)!;
    expect(Array.from(f4).map((v) => Math.round(v * 1e4) / 1e4)).toEqual([1, 2, -1, 4, 5, 2]);
    // Decoded from its text alone (a project opened again) it is the same.
    const copy = JSON.parse(JSON.stringify(track)) as ClothTrack;
    expect(Array.from(clothFrame(copy, 2)!)).toEqual(Array.from(clothFrame(track, 2)!));
    // Growing a frame at a time encodes what a single encoding would.
    const again = new ClothTrackWriter(24, { mesh: 'm', levels: 1, worldInv: inv, vertices: 2 });
    for (let k = 0; k < 5; k++) again.push([99, 99, 99, ...local.flatMap((p) => transformPoint(world, [p[0], p[1], p[2] - k]))], 1);
    const parts = new ClothTrackWriter(24, { mesh: 'm', levels: 1, worldInv: inv, vertices: 2 });
    for (let k = 0; k < 5; k++) {
      parts.push([99, 99, 99, ...local.flatMap((p) => transformPoint(world, [p[0], p[1], p[2] - k]))], 1);
      parts.track();
    }
    expect(parts.track().data).toBe(again.track().data);
    expect(clothFrameIndex(track, 0.5)).toBe(2);
    expect(isClothTrack({ ...track, data: track.data.slice(0, -8) })).toBe(false);
    expect(isClothTrack({ ...track, levels: -1 })).toBe(false);
  });
});

/** The sheet over the box with a recorded run whose frame k has every vertex k mm lower, from the playhead at 0. */
function recorded(frames = 4): { state: ProjectState; sheet: NodeId; track: ClothTrack } {
  const { state, sheet } = sheetOverBox();
  const spec = clothSpec(state)!;
  const p = spec.pieces[0];
  const w = new ClothTrackWriter(state.animation.fps, { mesh: p.mesh, levels: p.levels, worldInv: p.worldInv, vertices: p.positions.length / 3 });
  for (let k = 0; k < frames; k++) w.push(p.positions.map((v, i) => (i % 3 === 2 ? v - k : v)));
  const track = w.track();
  const s = reduce(state, { type: 'physics/begin', clips: [clothClip('c1', sheet, 0, track)] });
  return { state: s, sheet, track };
}

describe('the part as the pose shows it', () => {
  it('the pose names each cloth part’s frame, at 0 too', () => {
    const { state, sheet } = recorded();
    const fps = state.animation.fps;
    expect(evaluate(state, 2 / fps).cloth).toEqual({ [sheet]: { clip: 'c1', frame: 2 } });
    // At 0, not playing: the recorded frame still shows (as S2's nodes held by a simulation).
    expect(playheadPose(state)?.cloth).toEqual({ [sheet]: { clip: 'c1', frame: 0 } });
    // A pose without cloth carries none.
    expect('cloth' in (evaluate(createInitialState(), 0) as object)).toBe(false);
  });

  it('draws the frame’s sheet in place of the part’s mesh, with its normals and its face materials moved', () => {
    const { state, sheet, track } = recorded();
    const fps = state.animation.fps;
    const posed = posedCloth(state, sheet, evaluate(state, 3 / fps))!;
    const data = getMesh(state.scene.nodes[sheet].mesh!.id)!;
    const base = data.positions.length / 3;
    expect(posed.data.positions.length / 3).toBe(base + track.vertices);
    expect(posed.data.indices.length / 3).toBe(2 * 4 ** track.levels);
    // Every triangle drawn is the sheet's, 3 mm lower than the plane (local z 0).
    for (const v of posed.data.indices) {
      expect(v).toBeGreaterThanOrEqual(base);
      expect(posed.data.positions[3 * v + 2]).toBeCloseTo(-3, 4);
    }
    // Facing up, as the plane.
    for (let v = base; v < posed.data.positions.length / 3; v++) expect(posed.data.normals[3 * v + 2]).toBeCloseTo(1, 5);
    expect(posed.node.mesh!.id).not.toBe(state.scene.nodes[sheet].mesh!.id);
    expect(posed.node.mesh!.triangles).toBe(posed.data.indices.length / 3);
    // No frame shown: drawn as it is.
    expect(posedCloth(state, sheet, null)).toBeNull();
    // A frame tilted as z = x / 2: its normals tilt with it, made from the frame.
    const p = clothSpec(state)!.pieces[0];
    const w = new ClothTrackWriter(fps, { mesh: p.mesh, levels: p.levels, worldInv: p.worldInv, vertices: p.positions.length / 3 });
    w.push(p.positions.map((v, i) => (i % 3 === 2 ? v + 0.5 * p.positions[i - 2] : v)));
    const tilted = reduce(state, { type: 'physics/grow', tracks: {}, cloth: { c1: w.track() } });
    const t = posedCloth(tilted, sheet, evaluate(tilted, 0))!;
    const k = 1 / Math.hypot(0.5, 1);
    for (let v = base; v < t.data.positions.length / 3; v += 7) {
      expect(t.data.normals[3 * v]).toBeCloseTo(-0.5 * k, 4);
      expect(t.data.normals[3 * v + 2]).toBeCloseTo(k, 4);
    }
  });

  it('the engine’s scene carries the frame (the MESH holds the sheet), and the part as it is without the clip', () => {
    const { state, sheet, track } = recorded();
    const fps = state.animation.fps;
    const view = { width: 64, height: 48, maxSamples: 1, maxSeconds: 0 };
    const at = projectScene(state, { ...view, pose: evaluate(state, 3 / fps) });
    const plain = projectScene(state, { ...view, pose: null });
    const idx = (s: typeof at) => s.ids.instances.findIndex((i) => i.node === sheet);
    const meshOf = (s: typeof at) => s.scene.meshes[s.scene.instances![idx(s)].mesh];
    expect(meshOf(plain).positions.length / 3).toBe(4);
    const m = meshOf(at);
    expect(m.indices.length / 3).toBe(2 * 4 ** track.levels);
    for (const v of Array.from(m.indices)) expect(m.positions[3 * v + 2]).toBeCloseTo(-3, 4);
    expect(at.meshKey).not.toBe(plain.meshKey);
  });

  it('a part whose mesh is no longer the one recorded is drawn as it is', () => {
    const { state, sheet } = recorded();
    const node = state.scene.nodes[sheet];
    const other = registerMesh('other-mesh', grid(1));
    const changed = { ...state, scene: { ...state.scene, nodes: { ...state.scene.nodes, [sheet]: { ...node, mesh: other } } } };
    expect(posedCloth(changed, sheet, evaluate(changed, 0))).toBeNull();
  });
});

describe('the store and the project', () => {
  it('physics/cloth merges the cloth fields and clears one with null, one undo step each', () => {
    const { state, sheet } = sheetOverBox();
    const store = createStore(state);
    store.dispatch({ type: 'physics/cloth', ids: [sheet], patch: { fabric: 'DENIM', weightGsm: 450 } });
    store.dispatch({ type: 'physics/cloth', ids: [sheet], patch: { weightGsm: null, anchor: 'TOP_EDGE' } });
    expect(store.get().scene.nodes[sheet].physics).toEqual({ role: 'CLOTH', cloth: { fabric: 'DENIM', anchor: 'TOP_EDGE' } });
    store.undo();
    expect(store.get().scene.nodes[sheet].physics?.cloth).toEqual({ fabric: 'DENIM', weightGsm: 450 });
    store.undo();
    expect(store.get().scene.nodes[sheet].physics).toEqual({ role: 'CLOTH' });
  });

  it('a grown cloth track lengthens its clip; Reset takes it away', () => {
    const { state, sheet } = recorded(2);
    const more = recorded(6).track;
    const grown = reduce(state, { type: 'physics/grow', tracks: {}, cloth: { c1: more } });
    const clip = grown.animation.clips.find((c) => c.id === 'c1')!;
    expect(clip.cloth).toBe(more);
    expect(clip.duration).toBeCloseTo(5 / state.animation.fps, 9);
    const reset = reduce(grown, { type: 'physics/reset', transforms: {}, clips: ['c1'] });
    expect(reset.animation.clips).toHaveLength(0);
    expect(posedCloth(reset, sheet, evaluate(reset, 0))).toBeNull();
  });

  it('a project with a cloth clip opens with it and its cloth fields; a damaged one is left out, not the project', async () => {
    const { state: s0, sheet } = recorded();
    const state = reduce(s0, { type: 'physics/cloth', ids: [sheet], patch: { fabric: 'LINEN', anchor: 'BOX', box: { min: [0, 0, 0.5], max: [1, 1, 1] }, triangles: [1, 0] } });
    const text = await serializeProject(state).text();
    const opened = loadProject(text).state;
    const clip = opened.animation.clips.find((c) => c.id === 'c1')!;
    expect(isClothTrack(clip.cloth)).toBe(true);
    expect(clip.cloth).toEqual(state.animation.clips.find((c) => c.id === 'c1')!.cloth);
    expect(opened.scene.nodes[sheet].physics).toEqual({ role: 'CLOTH', cloth: { fabric: 'LINEN', anchor: 'BOX', box: { min: [0, 0, 0.5], max: [1, 1, 1] }, triangles: [0, 1] } });
    expect(posedCloth(opened, sheet, evaluate(opened, 1 / opened.animation.fps))).not.toBeNull();
    const damaged = JSON.parse(text);
    damaged.state.animation.clips[0].cloth.data = 'AAAA';
    damaged.state.scene.nodes[sheet].physics.cloth = { fabric: 'MOON_SILK', weightGsm: -4, anchor: 'TOP_EDGE' };
    const fixed = migrateProject(damaged);
    expect(fixed.animation.clips).toHaveLength(0);
    expect(fixed.scene.nodes[sheet].physics).toEqual({ role: 'CLOTH', cloth: { anchor: 'TOP_EDGE' } });
  });
});

/** The vertices of every piece of a CLT1 (its first words: positions of each piece, in order). */
function cltVertices(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pieces = view.getUint32(8, true);
  let at = 12;
  const out: number[] = [];
  for (let p = 0; p < pieces; p++) {
    const nv = view.getUint32(at, true);
    const ni = view.getUint32(at + 4, true);
    at += 8;
    for (let i = 0; i < nv * 3; i++) out.push(view.getFloat32(at + 4 * i, true));
    at += nv * 12 + ni * 4 + Math.ceil(nv / 32) * 4 + 36;
  }
  return Float32Array.from(out);
}

/** A simulator that answers like the worker: the cloth's frame k is k × 5 mm lower; `cloth: false` is an engine before S9. */
function fakePort(opts: { cloth: boolean } = { cloth: true }) {
  let onUpdate: ((u: PhysicsUpdate) => void) | null = null;
  let resolveDone: ((r: PhysicsResult) => void) | null = null;
  let start: Float32Array = new Float32Array(0);
  let frame = 0;
  let withCloth = false;
  const at = (k: number) => start.map((v, i) => (i % 3 === 2 ? v - 5 * k : v));
  const api = {
    runs: [] as { bodies: number; cloth: Uint8Array | null }[],
    port: {
      run(spec, _options, update, _wet, _parts, cloth): PhysicsRunHandle {
        api.runs.push({ bodies: spec.bodies.length, cloth: cloth ?? null });
        frame = 0;
        onUpdate = update;
        start = cloth ? cltVertices(cloth) : new Float32Array(0);
        withCloth = !!cloth && opts.cloth;
        const started: PhysicsStarted = { ids: Uint32Array.from(spec.bodies.map((_, i) => i)), initial: new Float32Array(spec.bodies.length * 7), bodies: spec.bodies.length, ...(withCloth ? { cloth: at(0) } : {}), ...(cloth && !opts.cloth ? { noCloth: true } : {}) };
        return {
          started: Promise.resolve(started),
          done: new Promise<PhysicsResult>((r) => (resolveDone = r)),
          pause() {},
          resume() {},
          stop() {
            api.end('STOPPED');
          },
        };
      },
    } satisfies PhysicsPort,
    emit(n: number) {
      const ks = Array.from({ length: n }, () => ++frame);
      onUpdate?.({ steps: frame * 10, awake: 0, bodies: 0, settled: false, frames: ks.map(() => new Float32Array(0)), ...(withCloth ? { cloth: ks.map(at) } : {}) });
    },
    end(reason: PhysicsResult['reason'] = 'SETTLED') {
      resolveDone?.({ steps: frame * 10, awake: 0, bodies: 0, settled: reason === 'SETTLED', frames: [], poses: new Float32Array(0), reason, ...(withCloth ? { cloth: [] } : {}) });
      resolveDone = null;
    },
  };
  return api;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the physics bar with cloth', () => {
  function app(opts?: { cloth: boolean }) {
    const { state, box, sheet } = sheetOverBox();
    const store = createStore(state);
    const ui = createUiStore();
    const sim = fakePort(opts);
    const toasts: string[] = [];
    ui.toast = (m: string) => void toasts.push(m);
    const ctx = { store, ui, services: { physics: sim.port } as unknown as AppServices } as Ctx;
    return { ctx, store, ui, sim, box, sheet, toasts };
  }

  it('Start runs the cloth and records it into the part’s clip, one undo step; Reset takes it away', async () => {
    const { ctx, store, ui, sim, sheet } = app();
    phys.start(ctx);
    await tick();
    expect(sim.runs).toHaveLength(1);
    expect(sim.runs[0].cloth).not.toBeNull();
    expect(ui.get().physics.cloth).toMatchObject({ pieces: 1 });
    sim.emit(3);
    const clip = store.get().animation.clips.find((c) => c.cloth)!;
    expect(clip.target).toEqual({ kind: 'NODE', id: sheet });
    expect(clip.cloth!.frames).toBe(4);
    // Back in the sheet's own space: frame 3 is 15 mm lower than the plane.
    expect(clothFrame(clip.cloth!, 3)![2]).toBeCloseTo(-15, 3);
    // The sheet itself does not move: its cloth moves inside it.
    const before = store.get().scene.nodes[sheet].transform;
    sim.end('SETTLED');
    await tick();
    expect(ui.get().physics).toMatchObject({ state: 'STOPPED', ended: 'SETTLED' });
    expect(store.get().scene.nodes[sheet].transform).toEqual(before);
    expect(store.history().undo).toHaveLength(1);
    phys.reset(ctx);
    expect(store.get().animation.clips.filter((c) => c.cloth)).toHaveLength(0);
    store.undo();
    expect(store.get().animation.clips.filter((c) => c.cloth)).toHaveLength(1);
  });

  it('with an engine before S9, the rest runs without the cloth and the bar says so', async () => {
    const { ctx, store, ui, sim, box, toasts } = app({ cloth: false });
    store.dispatch({ type: 'physics/set', ids: [box], patch: { role: 'DYNAMIC' } });
    phys.start(ctx);
    await tick();
    expect(sim.runs[0].bodies).toBe(1);
    expect(ui.get().physics.noCloth).toBe(true);
    expect(ui.get().physics.cloth).toBeNull();
    expect(toasts.some((m) => /cloth/i.test(m))).toBe(true);
    sim.emit(2);
    expect(store.get().animation.clips.filter((c) => c.cloth)).toHaveLength(0);
    expect(store.get().animation.clips.filter((c) => c.track)).toHaveLength(1);
  });

  it('Drape over the part adds a sheet of cloth and runs it alone, all one undo step', async () => {
    const a = addPrimitive(createInitialState(), 'BOX', [0, 0, 50], 'Box');
    const store = createStore(a.state);
    const ui = createUiStore();
    ui.toast = () => undefined;
    const sim = fakePort();
    const ctx = { store, ui, services: { physics: sim.port } as unknown as AppServices } as Ctx;
    const undoBefore = store.history().undo.length;
    phys.drape(ctx, [a.id]);
    await tick();
    const sheet = Object.values(store.get().scene.nodes).find((n) => n.physics?.role === 'CLOTH')!;
    expect(sheet.primitive?.kind).toBe('PLANE');
    expect(sheet.physics?.cloth?.fabric).toBe(DEFAULT_FABRIC);
    expect(sim.runs).toHaveLength(1);
    expect(sim.runs[0].bodies).toBe(0);
    sim.emit(2);
    sim.end('SETTLED');
    await tick();
    expect(store.history().undo.length).toBe(undoBefore + 1);
    store.undo();
    expect(Object.values(store.get().scene.nodes).some((n) => n.physics?.role === 'CLOTH')).toBe(false);
    expect(store.get().animation.clips).toHaveLength(0);
    // The sheet sat over the box.
    const w = worldMatrix(store.get(), a.id);
    expect(w).toBeDefined();
  });
});

describe('the worker’s client with cloth', () => {
  it('posts the CLT1 with the run and passes on the cloth the worker reports, and an engine without it', async () => {
    const posted: PhysicsRequest[] = [];
    const worker = {
      onmessage: null as ((e: { data: PhysicsReply }) => void) | null,
      onerror: null,
      postMessage: (m: PhysicsRequest) => posted.push(m),
      terminate() {},
    };
    const client = new PhysicsClient(async () => ({}) as WebAssembly.Module, () => worker as unknown as Worker);
    const updates: PhysicsUpdate[] = [];
    const handle = client.run(null, 0, { fps: 24, maxSeconds: 30 }, (u) => updates.push(u), null, null, new Uint8Array([9, 8, 7, 6]));
    await tick();
    worker.onmessage!({ data: { type: 'ready' } });
    await tick();
    const run = posted.find((m) => m.type === 'run') as Extract<PhysicsRequest, { type: 'run' }>;
    expect([...new Uint8Array(run.cloth!)]).toEqual([9, 8, 7, 6]);
    const at0 = new Float32Array([1, 2, 3]);
    worker.onmessage!({ data: { type: 'started', id: run.id, ids: new Uint32Array(0), initial: new Float32Array(0), bodies: 0, cloth: at0 } });
    const started = await handle.started;
    expect(started.cloth).toBe(at0);
    const frame = new Float32Array([1, 2, 2]);
    worker.onmessage!({ data: { type: 'progress', id: run.id, steps: 10, awake: 0, bodies: 0, settled: false, frames: [new Float32Array(0)], cloth: [frame] } });
    expect(updates[0].cloth).toEqual([frame]);
    // An engine before S9: the worker says so with the start.
    const second = client.run(null, 0, { fps: 24, maxSeconds: 30 }, () => undefined, null, null, new Uint8Array([1]));
    await tick();
    const run2 = posted.filter((m) => m.type === 'run').at(-1) as Extract<PhysicsRequest, { type: 'run' }>;
    worker.onmessage!({ data: { type: 'started', id: run2.id, ids: new Uint32Array(0), initial: new Float32Array(0), bodies: 0, noCloth: true } });
    expect((await second.started).noCloth).toBe(true);
    client.dispose();
  });
});

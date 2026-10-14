// Exploded views (phase N6, SPEC §3.7): every geometry moves the parts where it says, the exceptions stay, the orders
// and the curve hold, reversing assembles, and a clip saved before N6 reads exactly as it did then.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canSplit, clipEnd, clipPhase, evaluate, poseActive, smoothEase, splitClip, type MotionClip } from '../src/core/animation';
import { explodeMovers, newExplode, resolveExplode, type ExplodeParams } from '../src/core/explode';
import { ease } from '../src/core/light-math';
import { boxCenter, boxMaxDim, cross, dot, length, normalize, sub, transformPoint, type Vec3 } from '../src/core/math';
import { partWorldBounds, sceneBounds, worldMatrix, type NodeId } from '../src/core/scene';
import type { ProjectState } from '../src/core/store';
import { apply, exampleState, keyIds } from './helpers';

type Clip = Omit<MotionClip, 'id'>;
const PARTS = ['base', 'body', 'label', 'collar', 'cap'] as const;

function withClip(s: ProjectState, clip: Partial<Clip>): ProjectState {
  const full: Clip = { target: { kind: 'SUBJECT' }, move: 'EXPLODE', shot: null, start: 0, duration: 1, amount: 1, easing: 'LINEAR', ...clip };
  return apply(s, { type: 'anim/addClip', clip: full });
}

function explode(p: Partial<ExplodeParams>): ExplodeParams {
  return { ...newExplode(), ...p };
}

/** World centre of a part in the pose at t: its rest bounds centre moved by the pose's translation of its parent space. */
function centreAt(s: ProjectState, id: NodeId, t: number): Vec3 {
  const pose = evaluate(s, t);
  const node = s.scene.nodes[id];
  const np = pose.nodes[id];
  const rest = boxCenter(partWorldBounds(s, id));
  if (!np) return rest;
  const parent = node.parent ? worldMatrix(s, node.parent) : null;
  const from = parent ? transformPoint(parent, node.transform.position) : node.transform.position;
  const to = parent ? transformPoint(parent, np.position) : np.position;
  return [rest[0] + to[0] - from[0], rest[1] + to[1] - from[1], rest[2] + to[2] - from[2]];
}

function unionOf(s: ProjectState, ids: NodeId[]) {
  return ids.map((id) => partWorldBounds(s, id)).reduce((a, b) => ({ min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])] as Vec3, max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])] as Vec3 }));
}

function expectVec(a: Vec3, b: Vec3, what = ''): void {
  for (let k = 0; k < 3; k++) expect(a[k], what).toBeCloseTo(b[k], 9);
}

function moved(s: ProjectState, id: NodeId, t: number): Vec3 {
  return sub(centreAt(s, id, t), boxCenter(partWorldBounds(s, id)));
}

describe('a clip saved before N6', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/explode-legacy.json', 'utf8')) as {
    partSizeMm: number;
    movedTransforms: Record<string, { position: Vec3; rotation: Vec3; scale: Vec3 }>;
    cases: { name: string; moved: boolean; clips: Clip[]; poses: { t: number; nodes: Record<string, { position: Vec3; rotation: Vec3; scale: Vec3; visible: boolean }> }[] }[];
  };

  it('the example is the one the fixture was taken with', () => {
    expect(exampleState().scene.partSizeMm).toBe(fixture.partSizeMm);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(5);
  });

  for (const c of fixture.cases) {
    it(`reads the same: ${c.name}`, () => {
      let s = exampleState();
      const ids = keyIds(s);
      if (c.moved) for (const [key, tr] of Object.entries(fixture.movedTransforms)) s = apply(s, { type: 'scene/setTransform', id: ids[key], transform: tr });
      for (const clip of c.clips) s = apply(s, { type: 'anim/addClip', clip });
      for (const pose of c.poses) {
        const got = evaluate(s, pose.t).nodes;
        expect(Object.keys(got).length, `${c.name} at ${pose.t}`).toBe(Object.keys(pose.nodes).length);
        for (const [key, want] of Object.entries(pose.nodes)) {
          const n = got[ids[key]];
          for (let k = 0; k < 3; k++) {
            expect(n.position[k], `${c.name} ${key} at ${pose.t}`).toBeCloseTo(want.position[k], 9);
            expect(n.rotation[k]).toBeCloseTo(want.rotation[k], 9);
            expect(n.scale[k]).toBeCloseTo(want.scale[k], 9);
          }
          expect(n.visible).toBe(want.visible);
        }
      }
    });
  }

  it('RADIAL is the spherical explode, every part the same distance (EVEN)', () => {
    const r = resolveExplode({ mode: 'RADIAL' });
    expect(r.geometry).toBe('SPHERICAL');
    expect(r.spacing).toBe('EVEN');
    expect(resolveExplode(undefined)).toEqual(r);
    expect(resolveExplode({ mode: 'AXIS_X' })).toMatchObject({ geometry: 'LINEAR', linear: 'SEPARATE', direction: [1, 0, 0] });
    expect(resolveExplode({ mode: 'AXIS_Y', linear: 'STACK' })).toMatchObject({ geometry: 'LINEAR', linear: 'SEPARATE', direction: [0, 1, 0] });
    expect(resolveExplode({ mode: 'AXIS_Z' }).direction).toEqual([0, 0, 1]);
  });
});

describe('the geometries', () => {
  const size = exampleState().scene.partSizeMm;

  it('linear, separate: along the axis only, each part away from the middle on its own side', () => {
    for (const spacing of ['EVEN', 'SPREAD'] as const) {
      let s = exampleState();
      const ids = keyIds(s);
      s = withClip(s, { explode: explode({ mode: 'LINEAR', linear: 'SEPARATE', axis: 'Z', spacing }) });
      const mid = boxCenter(sceneBounds(s))[2];
      const travel: number[] = [];
      for (const k of PARTS) {
        const d = moved(s, ids[k], 1);
        expect(Math.hypot(d[0], d[1]), `${spacing} ${k} leaves the axis`).toBeLessThan(1e-9);
        const side = boxCenter(partWorldBounds(s, ids[k]))[2] - mid;
        expect(Math.sign(d[2]), `${spacing} ${k} on its side`).toBe(Math.sign(side));
        travel.push(Math.abs(d[2]));
      }
      if (spacing === 'EVEN') for (const v of travel) expect(v).toBeCloseTo(size, 9);
      else expect(Math.max(...travel)).toBeCloseTo(size, 9);
      // The base is below the middle and goes down, the cap above and goes up.
      expect(moved(s, ids.base, 1)[2]).toBeLessThan(0);
      expect(moved(s, ids.cap, 1)[2]).toBeGreaterThan(0);
    }
  });

  it('linear along X, Y or a direction of its own moves along that direction', () => {
    for (const [axis, dir] of [['X', [1, 0, 0]], ['Y', [0, 1, 0]], ['CUSTOM', normalize([1, 1, 2])]] as const) {
      let s = exampleState();
      const ids = keyIds(s);
      s = withClip(s, { explode: explode({ mode: 'LINEAR', axis, direction: axis === 'CUSTOM' ? [1, 1, 2] : undefined, spacing: 'EVEN' }) });
      // The label is off the vertical axis: it moves, along the direction.
      const d = moved(s, ids.label, 1);
      expect(length(d), axis).toBeCloseTo(size, 6);
      expect(length(cross(d, dir as Vec3)), axis).toBeLessThan(1e-6);
    }
  });

  it('linear, stack: every part the same way, spread in its order along the axis; the first stays', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = withClip(s, { explode: explode({ mode: 'LINEAR', linear: 'STACK', axis: 'Z' }) });
    const byHeight = [...PARTS].sort((a, b) => boxCenter(partWorldBounds(s, ids[a]))[2] - boxCenter(partWorldBounds(s, ids[b]))[2]);
    const dz = byHeight.map((k) => moved(s, ids[k], 1));
    for (const d of dz) expect(Math.hypot(d[0], d[1])).toBeLessThan(1e-9);
    expect(dz[0][2]).toBeCloseTo(0, 9);
    expect(dz[dz.length - 1][2]).toBeCloseTo(size, 9);
    for (let i = 1; i < dz.length; i++) {
      expect(dz[i][2]).toBeGreaterThan(dz[i - 1][2]);
      expect(dz[i][2] - dz[i - 1][2]).toBeCloseTo(size / (dz.length - 1), 9);
    }
  });

  it('radial: perpendicular to the axis, away from it; what is on the axis stays', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = withClip(s, { explode: explode({ mode: 'CYLINDRICAL', axis: 'Z' }) });
    for (const k of ['base', 'body', 'collar', 'cap'] as const) expect(length(moved(s, ids[k], 1)), k).toBeLessThan(1e-9);
    const d = moved(s, ids.label, 1);
    expect(d[2]).toBeCloseTo(0, 9);
    const c = boxCenter(partWorldBounds(s, ids.label));
    // Away from the axis: along the label's own offset from it.
    expect(dot(normalize(d), normalize([c[0], c[1], 0]))).toBeCloseTo(1, 9);
    // About X: nothing moves along X, and every part leaves the X axis through the centre.
    let sx = exampleState();
    sx = withClip(sx, { explode: explode({ mode: 'CYLINDRICAL', axis: 'X', spacing: 'EVEN' }) });
    const centre = boxCenter(sceneBounds(sx));
    for (const k of PARTS) {
      const m = moved(sx, ids[k], 1);
      expect(m[0], k).toBeCloseTo(0, 9);
      const off = sub(boxCenter(partWorldBounds(sx, ids[k])), centre);
      expect(dot(m, [0, off[1], off[2]]), k).toBeGreaterThan(0);
    }
  });

  it('spherical: away from the point, along the line from it', () => {
    const point: Vec3 = [0, 0, -200];
    let s = exampleState();
    const ids = keyIds(s);
    s = withClip(s, { explode: explode({ mode: 'SPHERICAL', centre: { kind: 'POINT', point }, spacing: 'EVEN' }) });
    for (const k of PARTS) {
      const d = moved(s, ids[k], 1);
      const away = normalize(sub(boxCenter(partWorldBounds(s, ids[k])), point));
      expect(dot(normalize(d), away), k).toBeCloseTo(1, 9);
      expect(length(d), k).toBeCloseTo(size, 9);
    }
    // From a chosen part: that part is the centre and stays; the others leave it.
    let sp = exampleState();
    sp = withClip(sp, { explode: explode({ mode: 'SPHERICAL', centre: { kind: 'PART', id: ids.cap } }) });
    expect(length(moved(sp, ids.cap, 1))).toBeLessThan(1e-9);
    expect(moved(sp, ids.base, 1)[2]).toBeLessThan(0);
  });

  it('millimetres and proportional to the part size', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = withClip(s, { amount: 40, explode: explode({ mode: 'LINEAR', spacing: 'EVEN', unit: 'MM', proportional: true }) });
    const sizes = Object.fromEntries(PARTS.map((k) => [k, boxMaxDim(partWorldBounds(s, ids[k]))]));
    const largest = Math.max(...Object.values(sizes));
    for (const k of PARTS) expect(Math.abs(moved(s, ids[k], 1)[2]), k).toBeCloseTo((40 * sizes[k]) / largest, 9);
  });

  it('by levels: the closure goes as a block, and then (ALL, by stages) opens itself', () => {
    let one = exampleState();
    const ids = keyIds(one);
    one = withClip(one, { explode: explode({ mode: 'SPHERICAL', levels: 'ONE' }) });
    for (const t of [0.3, 1]) expectVec(moved(one, ids.collar, t), moved(one, ids.cap, t), `block at ${t}`);
    expect(moved(one, ids.cap, 1)[2]).toBeGreaterThan(0);

    let all = exampleState();
    all = withClip(all, { explode: explode({ mode: 'SPHERICAL', levels: 'ALL', overlap: 0 }) });
    const movers = explodeMovers(all, { node: null, amount: 1, explode: all.animation.clips[0].explode });
    expect(new Set(movers.map((m) => m.stage))).toEqual(new Set([0, 1]));
    // Inside the closure the parts travel in proportion to it: the farthest one its share of the distance.
    const whole = boxMaxDim(sceneBounds(all));
    const closure = boxMaxDim(unionOf(all, [ids.collar, ids.cap]));
    const inner = Math.max(...movers.filter((m) => m.stage === 1).map((m) => length(m.delta)));
    expect(inner).toBeCloseTo((all.scene.partSizeMm * closure) / whole, 9);
    expect(Math.max(...movers.filter((m) => m.stage === 0).map((m) => length(m.delta)))).toBeCloseTo(all.scene.partSizeMm, 9);
    // Two stages, one after the other: the first half moves the blocks, the second opens the closure.
    for (const m of movers) expect([m.from, m.to]).toEqual(m.stage === 0 ? [0, 0.5] : [0.5, 1]);
    for (const t of [0.25, 0.5]) expectVec(moved(all, ids.collar, t), moved(all, ids.cap, t), `stage 1 has not started at ${t}`);
    expect(length(sub(moved(all, ids.collar, 1), moved(all, ids.cap, 1)))).toBeGreaterThan(1);
    // The parts of the first stage are where they end at the half way.
    expectVec(moved(all, ids.base, 0.5), moved(all, ids.base, 1));
  });

  it('a group as the target: only its parts move', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = withClip(s, { target: { kind: 'NODE', id: ids.closure }, explode: explode({ mode: 'LINEAR', linear: 'STACK' }) });
    for (const k of ['base', 'body', 'label'] as const) expect(length(moved(s, ids[k], 1)), k).toBe(0);
    expect(moved(s, ids.cap, 1)[2]).toBeCloseTo(size, 9);
  });
});

describe('exceptions, order, curve and direction', () => {
  it('an exception stays still while the others move; a pinned group pins its parts', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = withClip(s, { explode: explode({ mode: 'SPHERICAL', pinned: [ids.label] }) });
    for (const t of [0, 0.3, 0.7, 1]) expect(length(moved(s, ids.label, t))).toBe(0);
    expect(length(moved(s, ids.base, 1))).toBeGreaterThan(1);
    s = apply(s, { type: 'anim/pinExplode', parts: [ids.closure], pinned: true });
    expect([...(s.animation.clips[0].explode?.pinned ?? [])].sort()).toEqual([ids.label, ids.collar, ids.cap].sort());
    for (const k of ['collar', 'cap', 'label'] as const) expect(length(moved(s, ids[k], 1)), k).toBe(0);
    s = apply(s, { type: 'anim/pinExplode', parts: [ids.cap], pinned: false });
    expect(length(moved(s, ids.cap, 1))).toBeGreaterThan(1);
    expect(length(moved(s, ids.collar, 1))).toBe(0);
  });

  it('pinning works on a clip saved before N6, which keeps reading as it did', () => {
    let s = withClip(exampleState(), { amount: 1.5, easing: 'EASE_OUT' });
    const ids = keyIds(s);
    const before = moved(s, ids.base, 0.6);
    s = apply(s, { type: 'anim/pinExplode', parts: [ids.cap], pinned: true });
    expect(s.animation.clips[0].explode).toEqual({ mode: 'RADIAL', pinned: [ids.cap] });
    expectVec(moved(s, ids.base, 0.6), before);
    expect(length(moved(s, ids.cap, 0.6))).toBe(0);
  });

  it('staggered by distance: the farthest goes first, and the overlap sets how the steps chain', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const windows = (overlap: number) => {
      const s = withClip(s0, { explode: explode({ mode: 'LINEAR', order: 'BY_DISTANCE', overlap }) });
      const ms = explodeMovers(s, { node: null, amount: 1, explode: s.animation.clips[0].explode });
      return ms.map((m) => ({ k: Object.entries(ids).find(([, v]) => v === m.parts[0])![0], d: Math.abs(m.delta[2]), from: m.from, to: m.to })).sort((a, b) => a.from - b.from);
    };
    for (const overlap of [0, 0.25, 0.5, 0.9]) {
      const w = windows(overlap);
      const width = w[0].to - w[0].from;
      expect(w[0].from).toBe(0);
      expect(w[w.length - 1].to).toBeCloseTo(1, 12);
      for (let i = 1; i < w.length; i++) {
        expect(w[i].d, 'farthest first').toBeLessThanOrEqual(w[i - 1].d + 1e-9);
        expect(w[i].to - w[i].from).toBeCloseTo(width, 12);
        // Each step starts when the previous one is (1 - overlap) of the way through.
        expect(w[i].from - w[i - 1].from).toBeCloseTo(width * (1 - overlap), 12);
      }
    }
    for (const w of windows(1)) expect([w.from, w.to]).toEqual([0, 1]);
    // In the pose: early on the farthest (the base) has moved and the nearest (the body) has not.
    const s = withClip(s0, { explode: explode({ mode: 'LINEAR', order: 'BY_DISTANCE', overlap: 0 }) });
    expect(Math.abs(moved(s, ids.base, 0.1)[2])).toBeGreaterThan(1);
    expect(length(moved(s, ids.body, 0.1))).toBe(0);
    expect(Math.abs(moved(s, ids.body, 1)[2])).toBeGreaterThan(1);
  });

  it('by depth: the parts under the model before the ones inside the closure', () => {
    const s = withClip(exampleState(), { explode: explode({ mode: 'SPHERICAL', order: 'BY_DEPTH', overlap: 0 }) });
    const ids = keyIds(s);
    expect(length(moved(s, ids.cap, 0.4))).toBe(0);
    expect(length(moved(s, ids.base, 0.4))).toBeGreaterThan(1);
    expect(length(moved(s, ids.cap, 0.9))).toBeGreaterThan(1);
  });

  it('smoothness: one knob from linear to very smooth changes the curve', () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
      expect(smoothEase(x, 0)).toBeCloseTo(x, 12);
      expect(smoothEase(x, 0.5)).toBeCloseTo(ease(x, 'EASE'), 12);
      expect(smoothEase(x, 1)).toBeCloseTo(ease(x, 'EASE_STRONG'), 12);
    }
    expect(smoothEase(0.25, 0.25)).toBeCloseTo((0.25 + ease(0.25, 'EASE')) / 2, 12);
    const at = (smoothness: number) => {
      const s = withClip(exampleState(), { smoothness, explode: explode({ mode: 'LINEAR', linear: 'STACK' }) });
      return moved(s, keyIds(s).cap, 0.25)[2] / exampleState().scene.partSizeMm;
    };
    expect(at(0)).toBeCloseTo(0.25, 9);
    expect(at(1)).toBeCloseTo(ease(0.25, 'EASE_STRONG'), 9);
    expect(at(1)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(0));
  });

  it('reversed, an explode assembles: apart at its start (and before), together at its end', () => {
    const s = withClip(exampleState(), { start: 1, duration: 2, reverse: true, explode: explode({ mode: 'LINEAR', linear: 'STACK' }) });
    const cap = keyIds(s).cap;
    const size = s.scene.partSizeMm;
    expect(moved(s, cap, 0)[2]).toBeCloseTo(size, 9);
    expect(moved(s, cap, 1)[2]).toBeCloseTo(size, 9);
    expect(moved(s, cap, 2)[2]).toBeCloseTo(size / 2, 9);
    expect(moved(s, cap, 3)[2]).toBeCloseTo(0, 9);
    expect(moved(s, cap, 9)[2]).toBeCloseTo(0, 9);
    // The viewport shows it apart from the first frame, before anything plays.
    expect(poseActive(s)).toBe(true);
    expect(poseActive(withClip(exampleState(), {}))).toBe(false);
  });

  it('repeats play one after another and the bar lasts them all', () => {
    const clip = { start: 1, duration: 2, repeat: 3 } as const;
    expect(clipEnd(clip)).toBe(7);
    expect(clipPhase(clip, 2)).toBeCloseTo(0.5, 12);
    expect(clipPhase(clip, 4)).toBeCloseTo(0.5, 12);
    expect(clipPhase(clip, 6.5)).toBeCloseTo(0.75, 12);
    expect(clipPhase(clip, 8)).toBe(1);
    expect(clipPhase({ ...clip, reverse: true }, 6.5)).toBeCloseTo(0.25, 12);
  });

  it('without keeping the orientation each part tilts as it goes; keeping it, none turns', () => {
    for (const keepOrientation of [true, false]) {
      const s = withClip(exampleState(), { explode: explode({ mode: 'SPHERICAL', keepOrientation }) });
      const label = keyIds(s).label;
      const r = evaluate(s, 1).nodes[label].rotation;
      const turned = Math.hypot(r[0], r[1], r[2]);
      if (keepOrientation) expect(turned).toBe(0);
      else expect(turned).toBeGreaterThan(5);
      // The tilt is about the part's own centre: it still ends where the explode sends it.
      const d = moved(s, label, 1);
      expect(length(d)).toBeGreaterThan(1);
    }
  });
});

describe('cutting a clip at the playhead', () => {
  it('the halves go on from each other and end where the clip ended', () => {
    for (const p of [{ mode: 'LINEAR', linear: 'STACK' }, { mode: 'SPHERICAL', spacing: 'SPREAD' }] as const) {
      const s = withClip(exampleState(), { start: 1, duration: 4, easing: 'EASE', amount: 1.5, explode: explode(p) });
      const clip = s.animation.clips[0];
      const cap = keyIds(s).cap;
      expect(canSplit(clip, 2.5)).toBe(true);
      const cut = apply(s, { type: 'anim/splitClip', id: clip.id, t: 2.5 });
      expect(cut.animation.clips).toHaveLength(2);
      const [a, b] = cut.animation.clips;
      expect(a.id).toBe(clip.id);
      expect([a.start, a.duration, b.start, b.duration]).toEqual([1, 1.5, 2.5, 2.5]);
      for (const t of [1, 2.5, 5, 6]) expectVec(moved(cut, cap, t), moved(s, cap, t), `${p.mode} at ${t}`);
    }
  });

  it('scale and dolly halves multiply back to the whole', () => {
    const scaleClip: MotionClip = { id: 'c1', target: { kind: 'SUBJECT' }, move: 'SCALE', shot: null, start: 0, duration: 2, amount: 1.6, easing: 'LINEAR' };
    const [a, b] = splitClip(scaleClip, 0.5)!;
    expect(a.amount * b.amount).toBeCloseTo(1.6, 12);
    const dolly: MotionClip = { ...scaleClip, target: { kind: 'CAMERA' }, move: 'DOLLY', amount: 40 };
    const [d1, d2] = splitClip(dolly, 1)!;
    expect((1 - d1.amount / 100) * (1 - d2.amount / 100)).toBeCloseTo(0.6, 12);
  });

  it('cannot cut outside the clip, a reversed or repeated one, a staggered explode or a move to a value', () => {
    const base: MotionClip = { id: 'c1', target: { kind: 'SUBJECT' }, move: 'SPIN', shot: null, start: 1, duration: 2, amount: 360, easing: 'LINEAR' };
    expect(canSplit(base, 2)).toBe(true);
    expect(canSplit(base, 1)).toBe(false);
    expect(canSplit(base, 3.5)).toBe(false);
    expect(canSplit({ ...base, reverse: true }, 2)).toBe(false);
    expect(canSplit({ ...base, repeat: 2 }, 2)).toBe(false);
    expect(canSplit({ ...base, move: 'ZOOM' }, 2)).toBe(false);
    expect(canSplit({ ...base, move: 'EXPLODE', explode: explode({ order: 'BY_DISTANCE' }) }, 2)).toBe(false);
    expect(canSplit({ ...base, move: 'EXPLODE', explode: explode({ levels: 'ALL' }) }, 2)).toBe(false);
  });
});

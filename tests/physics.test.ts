// Phase S2 on the interface's side (ROADMAP S2 criterion): what the simulator is given (Drop, the stored roles, a
// group as one body or as parts, locked and hidden parts), what its poses do to the scene, the store's physics
// actions (a simulation and its clips are ONE undo step, Reset another, undoable), the PHYSICS clip saved and opened
// again and played by the timeline between its frames, the Doctor's check, the bar's commands with a simulator that
// answers like the worker, and, with the real rt.wasm, three primitives dropped onto the floor through the page's
// own code.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate, playheadPose } from '../src/core/animation';
import { runDoctor } from '../src/core/doctor';
import { mat4Invert, mat4Multiply, transformPoint, type Vec3 } from '../src/core/math';
import {
  bodyWorld,
  dynamicBelowFloor,
  makeTrack,
  matrixQuat,
  moverSample,
  moverTransforms,
  physicsClip,
  physicsSpec,
  poseTransforms,
  POSE_FLOATS,
  quatMatrix,
  trackFloats,
  TrackWriter,
  type PhysicsResult,
  type PhysicsRunHandle,
  type PhysicsStarted,
  type PhysicsUpdate,
} from '../src/core/physics';
import { defaultParams } from '../src/core/primitives';
import { boundsOf, worldMatrix, type NodeId } from '../src/core/scene';
import { createInitialState, createStore, reduce, type ProjectState, type Store } from '../src/core/store';
import type { PrimitiveKind } from '../src/data/primitives';
import { writePhysicsScene } from '../src/io/phys';
import { currentPose } from '../src/io/rsb';
import { loadProject, migrateProject, serializeProject } from '../src/io/project';
import { hasPhysExports, NO_BODY, PhysWorld } from '../src/render/phys-wasm';
import { PhysicsClient } from '../src/render/physics';
import type { PhysicsReply, PhysicsRequest } from '../src/render/physics-worker';
import * as phys from '../src/ui/physics';
import type { AppServices, PhysicsPort } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { createUiStore } from '../src/ui/ui-state';
import { RT_WASM } from './wasm-engine';

function addPrimitive(state: ProjectState, kind: PrimitiveKind, position: Vec3, name: string): { state: ProjectState; id: NodeId } {
  const next = reduce(state, { type: 'scene/addPrimitive', kind, params: defaultParams(kind, 200), position, name });
  return { state: next, id: next.selection.ids[0] };
}

/** A box, a ball and a cylinder in the air over the floor. */
function threePrimitives(): { state: ProjectState; box: NodeId; ball: NodeId; can: NodeId } {
  let s = createInitialState();
  const a = addPrimitive(s, 'BOX', [0, 0, 150], 'Box');
  const b = addPrimitive(a.state, 'SPHERE', [180, 0, 220], 'Ball');
  const c = addPrimitive(b.state, 'CYLINDER', [-180, 0, 120], 'Can');
  s = c.state;
  return { state: s, box: a.id, ball: b.id, can: c.id };
}

const close = (a: readonly number[], b: readonly number[], eps: number) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('what the simulator is given', () => {
  it('Drop makes movers of the selection; the rest and the floor are static', () => {
    const { state, box, ball, can } = threePrimitives();
    const spec = physicsSpec(state, [box])!;
    expect(spec.bodies.map((b) => b.mover)).toEqual([box]);
    expect(spec.statics.map((s) => s.piece.part).sort()).toEqual([ball, can].sort());
    expect(spec.floor.z).toBe(0);
    // Without Drop: the stored roles, none yet.
    expect(physicsSpec(state)).toBeNull();
    const marked = reduce(state, { type: 'physics/set', ids: [ball, can], patch: { role: 'DYNAMIC' } });
    expect(physicsSpec(marked)!.bodies.map((b) => b.mover)).toEqual([ball, can]);
    // A locked node does not move; a hidden one is not there.
    expect(physicsSpec(reduce(state, { type: 'scene/setLocked', ids: [box], locked: true }), [box])).toBeNull();
    const hidden = reduce(state, { type: 'scene/setVisible', ids: [can], visible: false });
    expect(physicsSpec(hidden, [box])!.statics.map((s) => s.piece.part)).toEqual([ball]);
    expect(physicsSpec(hidden, [can])).toBeNull();
  });

  it('a group falls as one body unless it falls as parts', () => {
    const { state, box, ball } = threePrimitives();
    const grouped = reduce(state, { type: 'scene/group', ids: [box, ball], name: 'Pair' });
    const group = grouped.scene.nodes[box].parent!;
    const one = physicsSpec(grouped, [group])!;
    expect(one.bodies).toHaveLength(1);
    expect(one.bodies[0].mover).toBe(group);
    expect(one.bodies[0].pieces.map((p) => p.part).sort()).toEqual([box, ball].sort());
    const parts = physicsSpec(reduce(grouped, { type: 'physics/set', ids: [group], patch: { asParts: true } }), [group])!;
    expect(parts.bodies.map((b) => b.mover).sort()).toEqual([box, ball].sort());
  });

  it('density comes from the material category unless the node has its own', () => {
    const { state, box } = threePrimitives();
    const own = reduce(state, { type: 'physics/set', ids: [box], patch: { density: 7800, friction: 0.3, bounciness: 0.7 } });
    const b = physicsSpec(own, [box])!.bodies[0];
    expect([b.density, b.friction, b.bounciness]).toEqual([7800, 0.3, 0.7]);
    const cleared = reduce(own, { type: 'physics/set', ids: [box], patch: { density: null } });
    expect(cleared.scene.nodes[box].physics).toEqual({ friction: 0.3, bounciness: 0.7 });
    // The primitives' neutral material is a chosen one of the catalogue: its category's density.
    expect(physicsSpec(cleared, [box])!.bodies[0].density).toBeGreaterThan(0);
  });
});

describe('what the poses do to the scene', () => {
  it('a mover becomes Δ · W₀, also inside a turned group, and keeps its scale', () => {
    const { state: s0, box, ball } = threePrimitives();
    // The box inside a turned and moved group, scaled.
    let s = reduce(s0, { type: 'scene/group', ids: [box, ball], name: 'Pair' });
    const group = s.scene.nodes[box].parent!;
    s = reduce(s, { type: 'scene/setTransform', id: group, transform: { position: [10, -20, 5], rotation: [0, 0, 30] } });
    s = reduce(s, { type: 'scene/setTransform', id: box, transform: { scale: [1.5, 1.5, 1.5] } });
    const spec = physicsSpec(s, [box])!;
    const initial = new Float32Array([1, 2, 140, 0, 0, 0, 1]);
    const q = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)]; // 45° about z
    const poses = new Float32Array([1, 2, 30, ...q]);
    const t = poseTransforms(s, spec, [0], initial, poses)[box];
    expect(t.scale).toEqual(s.scene.nodes[box].transform.scale);
    const moved = reduce(s, { type: 'physics/commit', transforms: { [box]: t } });
    const want = bodyWorld(spec, 0, initial, poses);
    const got = worldMatrix(moved, box);
    expect(close(got, want, 1e-3)).toBe(true);
    // The centre went where the simulator said, turned about it.
    expect(close(transformPoint(got, [0, 0, 0]), transformPoint(want, [0, 0, 0]), 1e-3)).toBe(true);
    // Δ alone: the centre of mass is a fixed point of the turn plus the move.
    const delta = mat4Multiply(want, mat4Invert(spec.bodies[0].start));
    expect(close(transformPoint(delta, [1, 2, 140]), [1, 2, 30], 1e-3)).toBe(true);
  });

  it('a body the simulator kept out (no mass) moves nothing', () => {
    const { state, box } = threePrimitives();
    const spec = physicsSpec(state, [box])!;
    expect(poseTransforms(state, spec, [NO_BODY], new Float32Array(7), new Float32Array(7))).toEqual({});
  });

  it('quaternions and matrices agree', () => {
    for (const q of [[0, 0, 0, 1], [0.5, 0.5, 0.5, 0.5], [0, Math.SQRT1_2, 0, Math.SQRT1_2]]) {
      const back = matrixQuat(quatMatrix(q));
      const same = close(back, q, 1e-9) || close(back, q.map((v) => -v), 1e-9);
      expect(same, `${q} -> ${back}`).toBe(true);
    }
  });
});

/** A store with one simulation of the box recorded: begin, `frames` grows, commit, under one gesture. */
function recorded(frames: number): { store: Store; box: NodeId; clip: string; pre: Vec3 } {
  const { state, box } = threePrimitives();
  const store = createStore(state);
  const spec = physicsSpec(state, [box])!;
  const initial = new Float32Array([0, 0, 150, 0, 0, 0, 1]);
  const writer = new TrackWriter(24);
  writer.push(moverSample(spec, 0, initial, initial, 0));
  const gesture = 'physics-test';
  store.dispatch({ type: 'physics/begin', clips: [physicsClip('c9', box, 0, writer.track())], roles: { [box]: 'DYNAMIC' }, gesture, label: 'Drop Box' });
  let last = initial;
  for (let k = 1; k < frames; k++) {
    last = new Float32Array([0, 0, 150 - 10 * k, 0, 0, 0, 1]);
    writer.push(moverSample(spec, 0, initial, last, 0));
    store.dispatch({ type: 'physics/grow', tracks: { c9: writer.track() }, gesture, label: 'Drop Box' });
  }
  store.dispatch({ type: 'physics/commit', transforms: poseTransforms(store.get(), spec, [0], initial, last), gesture, label: 'Drop Box' });
  return { store, box, clip: 'c9', pre: [...state.scene.nodes[box].transform.position] as Vec3 };
}

describe('the store: a simulation is one undo step, Reset another', () => {
  it('begin, every frame and the final poses are one entry; undo takes it all back', () => {
    const { store, box, clip, pre } = recorded(5);
    const s = store.get();
    expect(store.history().undo).toEqual(['Drop Box']);
    const c = s.animation.clips.find((x) => x.id === clip)!;
    expect(c.move).toBe('PHYSICS');
    expect(c.track!.frames).toBe(5);
    expect(c.duration).toBeCloseTo(4 / 24, 9);
    expect(s.scene.nodes[box].physics?.role).toBe('DYNAMIC');
    expect(s.scene.nodes[box].transform.position[2]).toBeCloseTo(pre[2] - 40, 3);
    store.undo();
    expect(store.get().animation.clips).toHaveLength(0);
    expect(store.get().scene.nodes[box].transform.position).toEqual(pre);
    expect(store.get().scene.nodes[box].physics).toBeUndefined();
    store.redo();
    expect(store.get().animation.clips).toHaveLength(1);
  });

  it('Reset takes the clips away and puts the movers back, and can be undone', () => {
    const { store, box, clip, pre } = recorded(4);
    const after = store.get().scene.nodes[box].transform;
    store.dispatch({ type: 'physics/reset', transforms: { [box]: { position: pre, rotation: [0, 0, 0], scale: after.scale } }, clips: [clip], label: 'Reset' });
    expect(store.history().undo).toEqual(['Reset', 'Drop Box']);
    expect(store.get().animation.clips).toHaveLength(0);
    expect(store.get().scene.nodes[box].transform.position).toEqual(pre);
    store.undo();
    expect(store.get().animation.clips.map((c) => c.id)).toEqual([clip]);
    expect(store.get().scene.nodes[box].transform).toEqual(after);
  });
});

describe('the PHYSICS clip', () => {
  /** Three frames at 2 fps from t = 1 s: (0,0,0) → (10,0,0) turning 90° about z → (10,10,0). */
  function clipState(): { state: ProjectState; box: NodeId } {
    const { state, box } = threePrimitives();
    const w = new TrackWriter(2);
    const qz = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    w.push([0, 0, 0, 0, 0, 0, 1]);
    w.push([10, 0, 0, ...qz]);
    // The same turn with the other sign, as a simulator may give it: the frames in between must not unwind it.
    w.push([10, 10, 0, ...qz.map((v) => -v)]);
    return { state: reduce(state, { type: 'physics/begin', clips: [physicsClip('c1', box, 1, w.track())] }), box };
  }

  it('the timeline plays it, interpolating between frames', () => {
    const { state, box } = clipState();
    const at = (t: number) => evaluate(state, t).nodes[box];
    expect(at(0.5).position).toEqual([0, 0, 0]); // before its start: the first frame
    expect(close(at(1.25).position, [5, 0, 0], 1e-6)).toBe(true);
    expect(close(at(1.25).rotation, [0, 0, 45], 1e-4)).toBe(true); // half way through the turn
    expect(close(at(1.5).position, [10, 0, 0], 1e-6)).toBe(true);
    expect(close(at(1.75).position, [10, 5, 0], 1e-6)).toBe(true);
    expect(close(at(1.75).rotation, [0, 0, 90], 1e-4)).toBe(true);
    expect(close(at(9).position, [10, 10, 0], 1e-6)).toBe(true); // after its end: the last frame
    // Stretched to twice its length it plays at half the speed.
    const slow = reduce(state, { type: 'anim/setClip', id: 'c1', patch: { duration: 2 } });
    expect(close(evaluate(slow, 1.5).nodes[box].position, [5, 0, 0], 1e-6)).toBe(true);
    // Another move adds to it (a spin on top of the recorded turn).
    const spun = reduce(state, { type: 'anim/addClip', clip: { target: { kind: 'NODE', id: box }, move: 'SPIN', shot: null, start: 0, duration: 1, amount: 30, easing: 'LINEAR' } });
    expect(close(evaluate(spun, 2).nodes[box].rotation, [0, 0, 120], 1e-4)).toBe(true);
  });

  it('is anchored where the run left its node: moved afterwards, the node takes its whole fall with it', () => {
    const { state, box } = clipState();
    const t0 = state.scene.nodes[box].transform;
    // As a run leaves it: the node at the last frame and the clip anchored there.
    const end = { position: [10, 10, 0] as Vec3, rotation: [0, 0, 90] as Vec3 };
    const s = reduce(state, { type: 'physics/commit', transforms: { [box]: { ...t0, ...end } }, clips: ['c1'] });
    expect(s.animation.clips[0].anchor).toEqual(end);
    const at = (st: ProjectState, t: number) => evaluate(st, t).nodes[box];
    expect(at(s, 1.25).position).toEqual(at(state, 1.25).position); // the frames as recorded, exactly
    // Moved 100 mm along x: the fall moves with it.
    const slid = reduce(s, { type: 'scene/setTransform', id: box, transform: { position: [110, 10, 0] } });
    expect(close(at(slid, 1.25).position, [105, 0, 0], 1e-4)).toBe(true);
    expect(close(at(slid, 0.5).position, [100, 0, 0], 1e-4)).toBe(true);
    expect(close(at(slid, 1.25).rotation, [0, 0, 45], 1e-3)).toBe(true);
    // Turned a further 90° about z where it rests: the fall turns about that point.
    const turned = reduce(s, { type: 'scene/setTransform', id: box, transform: { rotation: [0, 0, 180] } });
    expect(close(at(turned, 1.25).position, [20, 5, 0], 1e-4)).toBe(true);
    expect(close(at(turned, 1.25).rotation, [0, 0, 135], 1e-3)).toBe(true);
    // The node keeps its scale.
    const big = reduce(s, { type: 'scene/setTransform', id: box, transform: { scale: [2, 2, 2] } });
    expect(at(big, 1.25).scale).toEqual([2, 2, 2]);
    expect(close(at(big, 1.25).position, [5, 0, 0], 1e-4)).toBe(true);
  });

  it('at 0 the nodes a recorded simulation holds show its frame, the rest of the scene as edited', () => {
    const { state, box } = clipState();
    const at0: ProjectState = { ...state, animation: { ...state.animation, playhead: 0, playing: false } };
    const pose = playheadPose(at0)!;
    expect(Object.keys(pose.nodes)).toEqual([box]);
    expect(pose.nodes[box].position).toEqual([0, 0, 0]); // before its start: the first frame
    expect(pose.camera).toBeNull();
    expect(currentPose(at0)).toEqual(pose); // a still render at 0 shows the same
    // Without a recorded simulation, 0 is the scene as edited (N1); past 0, the playhead's pose.
    const spin = reduce(threePrimitives().state, { type: 'anim/addClip', clip: { target: { kind: 'NODE', id: box }, move: 'SPIN', shot: null, start: 0, duration: 1, amount: 30, easing: 'LINEAR' } });
    expect(playheadPose({ ...spin, animation: { ...spin.animation, playhead: 0 } })).toBeNull();
    expect(playheadPose({ ...at0, animation: { ...at0.animation, playhead: 1.25 } })).toEqual(evaluate(at0, 1.25));
  });

  it('saves with the project and opens again, bit for bit; a damaged track is left out', async () => {
    const { state: s0, box } = clipState();
    const state = reduce(s0, { type: 'physics/commit', transforms: { [box]: s0.scene.nodes[box].transform }, clips: ['c1'] });
    const text = await serializeProject(state).text();
    const loaded = loadProject(text);
    const c = loaded.state.animation.clips.find((x) => x.id === 'c1')!;
    expect(c.track).toEqual(state.animation.clips.find((x) => x.id === 'c1')!.track);
    expect(c.anchor).toEqual(state.animation.clips[0].anchor);
    // A damaged anchor is left out; the clip stays.
    const bent = JSON.parse(text);
    bent.state.animation.clips[0].anchor = { position: [0, 'x', 0], rotation: [0, 0, 0] };
    const kept = migrateProject(bent).animation.clips;
    expect(kept).toHaveLength(1);
    expect('anchor' in kept[0]).toBe(false);
    expect([...trackFloats(c.track!)!]).toEqual([...trackFloats(state.animation.clips[0].track!)!]);
    const body = JSON.parse(text);
    body.state.animation.clips[0].track.data = 'not base64!';
    body.state.scene.nodes[Object.keys(body.state.scene.nodes)[0]].physics = { role: 'CLOTH', density: -3, friction: 0.4 };
    const opened = migrateProject(body);
    expect(opened.animation.clips).toHaveLength(0);
    expect(opened.scene.nodes[Object.keys(body.state.scene.nodes)[0]].physics).toEqual({ friction: 0.4 });
  });

  it('a project from before S2 opens unchanged', () => {
    const text = readFileSync('tests/fixtures/project-v2.json', 'utf8');
    const s = loadProject(text).state;
    expect(Object.values(s.scene.nodes).some((n) => n.physics !== undefined)).toBe(false);
    expect(s.animation.clips.some((c) => c.move === 'PHYSICS')).toBe(false);
  });

  it('a track grows without encoding it all again, and reads back the same', () => {
    const w = new TrackWriter(24);
    const all: number[] = [];
    for (let k = 0; k < 37; k++) {
      const f = [k * 1.5, -k, k / 3, 0, 0, Math.sin(k / 10), Math.cos(k / 10)];
      all.push(...f);
      w.push(f);
      const grown = w.track();
      const whole = makeTrack(24, all);
      expect(grown.data).toBe(whole.data);
      expect(grown.frames).toBe(k + 1);
    }
    expect([...trackFloats(makeTrack(24, all))!]).toEqual([...Float32Array.from(all)]);
  });
});

describe('the Doctor', () => {
  it('warns when a dynamic part starts below the floor, and lifts it', () => {
    const { state, box } = threePrimitives();
    let s = reduce(state, { type: 'physics/set', ids: [box], patch: { role: 'DYNAMIC' } });
    expect(runDoctor(s).find((r) => r.key === 'physics')!.status).toBe('OK');
    s = reduce(s, { type: 'scene/setTransform', id: box, transform: { position: [0, 0, 5] } });
    expect(dynamicBelowFloor(s, 0.4)).toEqual([box]);
    const r = runDoctor(s).find((x) => x.key === 'physics')!;
    expect(r.status).toBe('WARN');
    expect(r.detail).toMatchObject({ count: 1, name: 'Box' });
    const fixed = reduce(s, { type: 'doctor/fix', key: 'physics' });
    expect(boundsOf(fixed, [box]).min[2]).toBeCloseTo(0, 6);
    // A static part below the floor is none of its business.
    const still = reduce(state, { type: 'scene/setTransform', id: box, transform: { position: [0, 0, 5] } });
    expect(runDoctor(still).find((x) => x.key === 'physics')!.status).toBe('OK');
  });
});

/** A simulator that answers like the worker: frame k of every body is k × 10 mm lower, no turn. */
function fakePort(): { port: PhysicsPort; emit(frames: number): void; end(reason?: PhysicsResult['reason']): void; runs: number; calls: string[] } {
  let onUpdate: ((u: PhysicsUpdate) => void) | null = null;
  let resolveDone: ((r: PhysicsResult) => void) | null = null;
  let bodies = 0;
  let frame = 0;
  const pose = (k: number) => {
    const out = new Float32Array(bodies * POSE_FLOATS);
    for (let b = 0; b < bodies; b++) out.set([0, 0, 100 - 10 * k, 0, 0, 0, 1], b * POSE_FLOATS);
    return out;
  };
  const api = {
    runs: 0,
    calls: [] as string[],
    port: {
      run(spec, _options, update): PhysicsRunHandle {
        api.runs++;
        bodies = spec.bodies.length;
        frame = 0;
        onUpdate = update;
        const started: PhysicsStarted = { ids: Uint32Array.from(spec.bodies.map((_, i) => i)), initial: pose(0), bodies };
        return {
          started: Promise.resolve(started),
          done: new Promise<PhysicsResult>((r) => (resolveDone = r)),
          pause() {
            api.calls.push('pause');
          },
          resume() {
            api.calls.push('resume');
          },
          stop() {
            api.calls.push('stop');
            api.end('STOPPED');
          },
        };
      },
    } satisfies PhysicsPort,
    emit(n: number) {
      const frames = Array.from({ length: n }, () => pose(++frame));
      onUpdate?.({ steps: frame * 10, awake: bodies, bodies, settled: false, frames });
    },
    end(reason: PhysicsResult['reason'] = 'SETTLED') {
      resolveDone?.({ steps: frame * 10, awake: 0, bodies, settled: reason === 'SETTLED', frames: [], poses: pose(frame), reason });
      resolveDone = null;
    },
  };
  return api;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the physics bar with a simulator', () => {
  function app() {
    const { state, box, ball } = threePrimitives();
    const store = createStore(state);
    const ui = createUiStore();
    const sim = fakePort();
    const ctx = { store, ui, services: { physics: sim.port } as unknown as AppServices } as Ctx;
    return { ctx, store, ui, sim, box, ball };
  }

  it('Drop is one undo step: the clip grows with the playhead and Stop keeps the pose', async () => {
    const { ctx, store, ui, sim, box } = app();
    const before = store.get().scene.nodes[box].transform;
    phys.drop(ctx, [box]);
    expect(ui.get().physics.state).toBe('STARTING');
    expect(ui.get().drawer).toBe('physics');
    await tick();
    expect(ui.get().physics.state).toBe('RUNNING');
    expect(store.get().animation.clips).toHaveLength(1);
    // Anchored where the node is while it runs, then where the run leaves it.
    expect(store.get().animation.clips[0].anchor).toEqual({ position: before.position, rotation: before.rotation });
    sim.emit(3);
    const clip = store.get().animation.clips[0];
    expect(clip.track!.frames).toBe(4);
    expect(store.get().animation.playhead).toBeCloseTo(3 / store.get().animation.fps, 9);
    // While it runs the movers are where they were: the clip shows the fall.
    expect(store.get().scene.nodes[box].transform).toEqual(before);
    phys.pause(ctx);
    expect(ui.get().physics.state).toBe('PAUSED');
    phys.resume(ctx);
    phys.stop(ctx);
    await tick();
    expect(ui.get().physics).toMatchObject({ state: 'STOPPED', ended: 'STOPPED', canReset: true });
    expect(store.get().scene.nodes[box].transform.position[2]).toBeCloseTo(before.position[2] - 30, 3);
    const after = store.get().scene.nodes[box].transform;
    expect(store.get().animation.clips[0].anchor).toEqual({ position: after.position, rotation: after.rotation });
    expect(store.history().undo).toHaveLength(1);
    store.undo();
    expect(store.get().animation.clips).toHaveLength(0);
    expect(store.get().scene.nodes[box].transform).toEqual(before);
  });

  it('Pause freezes what the viewport shows; Stop keeps the pose shown, not what the simulator did after it', async () => {
    const { ctx, store, ui, sim, box } = app();
    const before = store.get().scene.nodes[box].transform;
    const fps = store.get().animation.fps;
    const frames = () => store.get().animation.clips[0].track!.frames;
    phys.drop(ctx, [box]);
    await tick();
    sim.emit(2);
    phys.pause(ctx);
    expect(sim.calls).toEqual(['pause']);
    const shown = { playhead: store.get().animation.playhead, time: ui.get().physics.time };
    // What was on its way when the person paused waits.
    sim.emit(2);
    expect(frames()).toBe(3);
    expect(store.get().animation.playhead).toBe(shown.playhead);
    expect(ui.get().physics.time).toBe(shown.time);
    phys.resume(ctx);
    expect(frames()).toBe(5);
    expect(store.get().animation.playhead).toBeCloseTo(4 / fps, 9);
    expect(ui.get().physics).toMatchObject({ state: 'RUNNING', time: 40 / 240 });
    phys.pause(ctx);
    sim.emit(1);
    phys.stop(ctx);
    await tick();
    // The simulator had a fifth frame; the person stopped at the fourth.
    expect(ui.get().physics).toMatchObject({ state: 'STOPPED', ended: 'STOPPED', time: 40 / 240 });
    expect(frames()).toBe(5);
    expect(store.get().scene.nodes[box].transform.position[2]).toBeCloseTo(before.position[2] - 40, 3);
    expect(store.history().undo).toHaveLength(1);
  });

  it('an end that comes while paused waits for Resume', async () => {
    const { ctx, store, ui, sim, box } = app();
    const before = store.get().scene.nodes[box].transform;
    phys.drop(ctx, [box]);
    await tick();
    sim.emit(1);
    phys.pause(ctx);
    sim.emit(1);
    sim.end('SETTLED');
    await tick();
    expect(ui.get().physics.state).toBe('PAUSED');
    expect(store.get().scene.nodes[box].transform).toEqual(before);
    expect(store.get().animation.clips[0].track!.frames).toBe(2);
    phys.resume(ctx);
    expect(ui.get().physics).toMatchObject({ state: 'STOPPED', ended: 'SETTLED' });
    expect(store.get().animation.clips[0].track!.frames).toBe(3);
    expect(store.get().scene.nodes[box].transform.position[2]).toBeCloseTo(before.position[2] - 20, 3);
  });

  it('it stops by itself when everything sleeps; Reset undoes it as a step of its own', async () => {
    const { ctx, store, ui, sim, box } = app();
    const before = store.get().scene.nodes[box].transform;
    phys.drop(ctx, [box]);
    await tick();
    sim.emit(2);
    sim.end('SETTLED');
    await tick();
    expect(ui.get().physics.ended).toBe('SETTLED');
    phys.reset(ctx);
    expect(store.get().animation.clips).toHaveLength(0);
    expect(store.get().scene.nodes[box].transform).toEqual(before);
    expect(store.history().undo).toHaveLength(2);
    expect(ui.get().physics.canReset).toBe(false);
    store.undo();
    expect(store.get().animation.clips).toHaveLength(1);
  });

  it('an undo while it runs ends it without committing anything', async () => {
    const { ctx, store, ui, sim, box } = app();
    const before = store.get().scene.nodes[box].transform;
    phys.drop(ctx, [box]);
    await tick();
    sim.emit(2);
    store.undo();
    expect(ui.get().physics.state).toBe('STOPPED');
    sim.end('SETTLED');
    await tick();
    expect(store.get().animation.clips).toHaveLength(0);
    expect(store.get().scene.nodes[box].transform).toEqual(before);
    expect(store.history().undo).toHaveLength(0);
  });

  it('Start needs a Dynamic part; without a simulator it says so', async () => {
    const { ctx, ui, sim, store, ball } = app();
    phys.start(ctx);
    expect(sim.runs).toBe(0);
    expect(ui.get().physics.ended).toBe('NOTHING');
    store.dispatch({ type: 'physics/set', ids: [ball], patch: { role: 'DYNAMIC' } });
    phys.start(ctx);
    expect(sim.runs).toBe(1);
    const none = { ...ctx, services: {} as AppServices };
    phys.drop(none, [ball]);
    expect(ui.get().physics.ended).toBe('NO_ENGINE');
  });
});

describe('the worker\'s client', () => {
  it('a pause asked for before the worker has the run reaches it right after the run; every report is acknowledged', async () => {
    const posted: PhysicsRequest[] = [];
    const worker = {
      onmessage: null as ((e: { data: PhysicsReply }) => void) | null,
      onerror: null,
      postMessage: (m: PhysicsRequest) => posted.push(m),
      terminate() {},
    };
    const client = new PhysicsClient(async () => ({}) as WebAssembly.Module, () => worker as unknown as Worker);
    const updates: PhysicsUpdate[] = [];
    const handle = client.run(new Uint8Array([1, 2, 3]), 1, { fps: 24, maxSeconds: 30 }, (u) => updates.push(u));
    handle.pause();
    await tick();
    expect(posted.map((m) => m.type)).toEqual(['init']);
    worker.onmessage!({ data: { type: 'ready' } });
    await tick();
    expect(posted.map((m) => m.type)).toEqual(['init', 'run', 'pause']);
    const id = (posted[1] as { id: number }).id;
    worker.onmessage!({ data: { type: 'progress', id, steps: 20, awake: 1, bodies: 1, settled: false, frames: [new Float32Array(7), new Float32Array(7)] } });
    expect(updates).toHaveLength(1);
    expect(posted.at(-1)).toEqual({ type: 'ack', id, frames: 2 });
    handle.resume();
    handle.stop();
    expect(posted.slice(-2).map((m) => m.type)).toEqual(['resume', 'stop']);
    client.dispose();
  });
});

const until = async (what: () => boolean, ms = 20000) => {
  const end = performance.now() + ms;
  while (!what()) {
    if (performance.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe.skipIf(!RT_WASM)('the physics worker (the real rt.wasm)', () => {
  it('keeps a few frames ahead of what the page has taken in, never ahead of the clock, and Pause holds it', async () => {
    const replies: PhysicsReply[] = [];
    const scope = { postMessage: (m: PhysicsReply) => replies.push(m), onmessage: null as ((e: { data: PhysicsRequest }) => void) | null };
    (globalThis as { self?: unknown }).self = scope;
    const { framesAhead } = await import('../src/render/physics-worker');
    const send = (data: PhysicsRequest) => scope.onmessage!({ data });
    send({ type: 'init', module: await WebAssembly.compile(readFileSync(RT_WASM!)) });
    await until(() => replies.some((r) => r.type === 'ready'));
    const { state, box, ball, can } = threePrimitives();
    const spec = physicsSpec(state, [box, ball, can])!;
    const t0 = performance.now();
    send({ type: 'run', id: 7, scene: writePhysicsScene(spec).slice().buffer, dynamic: 3, options: { fps: 24, maxSeconds: 30 } });
    const reported = () => replies.reduce((n, r) => n + (r.type === 'progress' ? r.frames.length : 0), 0);
    const ahead = framesAhead(24);
    // Nothing acknowledged: it records `ahead` frames and waits.
    await until(() => reported() >= ahead);
    await new Promise((r) => setTimeout(r, 400));
    expect(reported()).toBe(ahead);
    // Paused, an acknowledgement lets nothing more through.
    send({ type: 'pause', id: 7 });
    send({ type: 'ack', id: 7, frames: ahead });
    await new Promise((r) => setTimeout(r, 400));
    expect(reported()).toBe(ahead);
    // Resumed and acknowledged as it goes, it runs to rest.
    send({ type: 'resume', id: 7 });
    let acked = ahead;
    await until(() => {
      const n = reported();
      if (n > acked) {
        send({ type: 'ack', id: 7, frames: n - acked });
        acked = n;
      }
      return replies.some((r) => r.type === 'done');
    });
    const done = replies.find((r) => r.type === 'done') as Extract<PhysicsReply, { type: 'done' }>;
    expect(done.reason).toBe('SETTLED');
    // Real time at most: the simulated seconds fit in the wall clock's, less the 0.4 s paused.
    expect(done.steps / 240).toBeLessThanOrEqual((performance.now() - t0) / 1000 - 0.4 + 0.05);
  });
});

describe.skipIf(!RT_WASM)('three primitives dropped onto the floor (the real rt.wasm)', () => {
  it('the page writes PHY1, the simulator settles it, and the poses rest the parts on the floor', async () => {
    const { state, box, ball, can } = threePrimitives();
    const spec = physicsSpec(state, [box, ball, can])!;
    const bytes = writePhysicsScene(spec);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('PHY1');
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    expect(hasPhysExports(instance.exports)).toBe(true);
    const world = new PhysWorld(instance.exports as never, bytes, spec.bodies.length);
    try {
      expect([...world.ids]).toEqual([0, 1, 2]);
      const initial = world.poses();
      for (let i = 0; i < 240 * 10 && !world.settled; i++) world.step(1);
      expect(world.settled).toBe(true);
      const moved = reduce(state, { type: 'physics/commit', transforms: poseTransforms(state, spec, world.ids, initial, world.poses()) });
      for (const id of [box, ball, can]) expect(Math.abs(boundsOf(moved, [id]).min[2]), id).toBeLessThan(0.5);
      // The ball, a sphere for the simulator, rests at its radius.
      const r = defaultParams('SPHERE', 200).radius;
      expect(boundsOf(moved, [ball]).max[2]).toBeCloseTo(2 * r, 0);
      // The pre-simulation transforms are what Reset gives back.
      expect(moverTransforms(state, spec)[box]).toEqual(state.scene.nodes[box].transform);
    } finally {
      world.free();
    }
  });
});

// Phase S3b on the page: the front glass fed by the scene's rain and dust. What the simulation is given (core/wet.ts
// `wetSpec`: the pane's axes and square from the engine, gravity and each effect's velocity in them, its density, the
// wettability of glass), the WET1 bytes as the engine reads them (tests/fixtures/s3b-wet.wet1, `rt --write-s3b-wet-spec`),
// the record of a run (the glass track: the cache) rebuilt frame by frame and the same from a second run, the PHYSICS
// clip of the camera (the pose's frame, saved and opened, a damaged one left out), the GLAS laid out drop by drop for an
// engine with bit 7 (tests/fixtures/s3b-wet.rsb), the physics bar running the glass alone (one undo step; Reset takes
// it away, undoably), and the Fast viewport's approximation (render/glass-overlay.ts). With the real rt.wasm: the pane
// against the native pin, the image through it, and the engine's layout of a pane by hand.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate, playheadPose } from '../src/core/animation';
import { activeCamera } from '../src/core/camera';
import { glassClip, type PhysicsResult, type PhysicsRunHandle, type PhysicsStarted, type PhysicsUpdate } from '../src/core/physics';
import { newFrontGlass, normalizeFrontGlass, opticsOf } from '../src/core/optics';
import { createStore, type ProjectState } from '../src/core/store';
import {
  capAngleDeg,
  feedingEffects,
  glassFrame,
  glassFrameIndex,
  GlassTrackWriter,
  isGlassTrack,
  NEVER,
  paneAxes,
  parseEnginePane,
  toPane,
  wetBytes,
  wetKey,
  wetSpec,
  type EnginePane,
  type WetPaneSpec,
} from '../src/core/wet';
import { GLASS_FEED, MAX_GLASS_SECONDS } from '../src/data/front-glass';
import { DUST_REPOSE_DEG, FRONT_GLASS_FAMILY, wettability, WETTABILITY } from '../src/data/wettability';
import { loadProject, serializeProject } from '../src/io/project';
import { glassFrameRsb, glassPaneRsb, projectScene, writeRsb } from '../src/io/rsb';
import { readsGlassLayout } from '../src/render/engine';
import { engineGlassPane, hasGlassExports } from '../src/render/glass-pane';
import { dropTransmittance, footprintRadiusMm, gridMean, paneGrid, paneMapping, rimStart, seenRect } from '../src/render/glass-overlay';
import { hasWetExports, WetSim } from '../src/render/phys-wasm';
import * as phys from '../src/ui/physics';
import type { AppServices, GlassPort, PhysicsPort } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { createUiStore } from '../src/ui/ui-state';
import { apply, exampleState } from './helpers';
import { sections } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const WET_TESTS = 'engine/crates/rt-phys/tests/wet.rs';
const EXAMPLE = 'engine/crates/rt-phys/src/example.rs';
const spec1 = new Uint8Array(readFileSync('tests/fixtures/s3b-wet.wet1'));
const wetRsb = new Uint8Array(readFileSync('tests/fixtures/s3b-wet.rsb'));

/** A frame record as the engine writes it (rt_phys::wet `WetPane::frame`). */
function record(drops: number[][], first: number, added: number[][], removed: number[]): Uint8Array {
  const words: number[] = [drops.length];
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  const bits = (v: number) => ((f[0] = v), u[0]);
  for (const d of drops) words.push(...d.map(bits));
  words.push(first, added.length);
  for (const m of added) words.push(...m.map(bits));
  words.push(removed.length, ...removed);
  const out = new Uint8Array(4 * words.length);
  const view = new DataView(out.buffer);
  words.forEach((w, i) => view.setUint32(4 * i, w >>> 0, true));
  return out;
}

/** The example with a rain effect and its camera's front glass fed by the scene. */
function rainyScene(preset: 'RAIN' | 'DUST_MOTES' = 'RAIN'): ProjectState {
  let s = apply(exampleState(), { type: 'effect/add', preset });
  const cam = activeCamera(s);
  s = apply(s, { type: 'camera/set', id: cam.id, patch: { optics: { ...opticsOf(cam), frontGlass: { ...newFrontGlass(), source: 'SCENE' } } } });
  return s;
}

/** The pane the engine would give, but made up for the store's tests (no rt.wasm needed). */
function fakePane(halfExtentMm = 30): EnginePane {
  return { distanceMm: 25, halfExtentMm, contactAngleDeg: 60, ior: 1.333, dustOpacity: 0.9, drops: new Float32Array(0), motes: new Float32Array(0) };
}

describe('S3b: the data', () => {
  it('the wettability table has its stable families, and glass and the repose are the engine’s parity values', () => {
    expect(WETTABILITY.map((w) => w.key)).toEqual(['GLASS', 'PLASTIC', 'METAL', 'PAPER', 'PAINT']);
    for (const w of WETTABILITY) expect(w.recedingDeg).toBeLessThanOrEqual(w.advancingDeg);
    const rust = readFileSync(EXAMPLE, 'utf8');
    const value = (name: string) => Number(new RegExp(`pub const ${name}: f32 = ([0-9.]+);`).exec(rust)![1]);
    const glass = wettability(FRONT_GLASS_FAMILY);
    expect([glass.advancingDeg, glass.recedingDeg]).toEqual([value('GLASS_ADVANCING_DEG'), value('GLASS_RECEDING_DEG')]);
    expect(DUST_REPOSE_DEG).toBe(value('DUST_REPOSE_DEG'));
    // Its cap, the mean, is the contact angle the front glass has drawn its drops with since S3.
    expect(capAngleDeg(glass)).toBe(60);
  });

  it('rain and drops of water wet the glass, dust, pollen, ash and the dust cloud dust it, the rest leaves nothing', () => {
    expect(Object.entries(GLASS_FEED).filter(([, v]) => v === 'DROPS').map(([k]) => k).sort()).toEqual(['RAIN', 'WATER_DROPS']);
    expect(Object.entries(GLASS_FEED).filter(([, v]) => v === 'DUST').map(([k]) => k).sort()).toEqual(['ASH', 'DUST_CLOUD', 'DUST_MOTES', 'POLLEN']);
    expect(MAX_GLASS_SECONDS).toBeGreaterThan(30);
  });
});

describe('S3b: what the simulation is given', () => {
  it('the pane’s axes are the engine’s camera basis, and a camera looking down keeps a dry lens under vertical rain', () => {
    // Looking down 30° towards +Y.
    const a = paneAxes([0, -1000, 600], [0, 0, 0], [0, 0, 1]);
    expect(Math.hypot(...a.forward)).toBeCloseTo(1, 6);
    expect(a.right[0]).toBeCloseTo(1, 6);
    const rain = toPane(a, [0, 0, -6500]);
    expect(rain[2]).toBeGreaterThan(0); // moving away from the outer face: nothing lands
    const windy = toPane(a, [0, -5000, -6500]);
    expect(windy[2]).toBeLessThan(0); // a wind blowing at the lens brings it
    expect(toPane(a, [0, 0, -1])[1]).toBeLessThan(0); // gravity pulls drops down the picture
  });

  it('every enabled effect that feeds the glass is a source: its density, its wind and fall in the pane’s axes, its size', () => {
    let s = rainyScene();
    s = apply(s, { type: 'effect/add', preset: 'SNOW' }, { type: 'effect/add', preset: 'POLLEN' });
    const [rain, snow, pollen] = s.effects;
    expect(feedingEffects(s).map((e) => e.id)).toEqual([rain.id, pollen.id]);
    const axes = paneAxes([0, -1000, 0], [0, 0, 0], [0, 0, 1]);
    const spec = wetSpec(s, axes, 30, 7)!;
    expect(spec.sources.map((x) => [x.effect, x.kind])).toEqual([
      [rain.id, 'DROPS'],
      [pollen.id, 'DUST'],
    ]);
    expect(spec.sources[0].density / (rain.density * 1e-9)).toBeCloseTo(1, 3);
    // Level camera looking along +Y: right is +X, up +Z; the rain's wind (1 m/s towards +X) and its fall.
    expect(spec.sources[0].velocity[0]).toBeCloseTo(rain.wind[0] * 1000, 3);
    expect(spec.sources[0].velocity[1]).toBeCloseTo(-rain.fallSpeed * 1000, 3);
    expect(spec.gravity).toEqual([0, -1, 0]);
    expect([spec.seed, spec.halfExtent, spec.advancingDeg, spec.recedingDeg, spec.reposeDeg]).toEqual([7, 30, 70, 50, DUST_REPOSE_DEG]);
    expect(snow.enabled).toBe(true);
    // Switched off, an effect feeds nothing; with none, there is nothing to simulate.
    const off = apply(s, { type: 'effect/set', id: rain.id, patch: { enabled: false } }, { type: 'effect/set', id: pollen.id, patch: { enabled: false } });
    expect(wetSpec(off, axes, 30, 7)).toBeNull();
  });

  it('writes the WET1 bytes the engine reads, byte for byte (the parity pane’s spec)', () => {
    const v = new DataView(spec1.buffer, spec1.byteOffset, spec1.byteLength);
    const f = (i: number) => v.getFloat32(4 * i, true);
    const n = v.getUint32(40, true);
    const spec: WetPaneSpec = {
      seed: v.getUint32(8, true),
      halfExtent: f(3),
      gravity: [f(4), f(5), f(6)],
      advancingDeg: f(7),
      recedingDeg: f(8),
      reposeDeg: f(9),
      sources: Array.from({ length: n }, (_, k) => {
        const at = 11 + 7 * k;
        return { kind: v.getUint32(4 * at, true) === 0 ? ('DROPS' as const) : ('DUST' as const), density: f(at + 1), velocity: [f(at + 2), f(at + 3), f(at + 4)] as [number, number, number], sizeMm: f(at + 5), sizeVar: f(at + 6), effect: '' };
      }),
    };
    expect(String.fromCharCode(...spec1.subarray(0, 4))).toBe('WET1');
    expect(Array.from(wetBytes(spec))).toEqual(Array.from(spec1));
    // The key is the bytes' (and the format's version): another seed is another simulation.
    expect(wetKey(wetBytes(spec))).toBe(wetKey(spec1));
    expect(wetKey(wetBytes({ ...spec, seed: spec.seed + 1 }))).not.toBe(wetKey(spec1));
  });
});

describe('S3b: the record of a run (the cache)', () => {
  it('rebuilds every frame: the drops of each, the motes with the frames they were on the pane', () => {
    const w = new GlassTrackWriter('cam1', 24, 'wet1:00000000', 60);
    w.push(record([], 0, [], []));
    w.push(record([[1, 2, 0.5]], 0, [[3, 4, 0.1], [5, 6, 0.2]], []));
    w.push(record([[1, 1.5, 0.6], [-2, 0, 1]], 2, [[7, 8, 0.3]], [0]));
    const t = w.track();
    expect(isGlassTrack(t)).toBe(true);
    expect([t.frames, w.lastDrops, w.motesAlive]).toEqual([3, 2, 2]);
    const at = (k: number) => {
      const fr = glassFrame(t, k)!;
      return { drops: Array.from(fr.drops), motes: Array.from(fr.motes) };
    };
    expect(at(0)).toEqual({ drops: [], motes: [] });
    expect(at(1)).toEqual({ drops: [1, 2, 0.5], motes: [3, 4, Math.fround(0.1), 5, 6, Math.fround(0.2)] });
    expect(at(2)).toEqual({ drops: [1, 1.5, Math.fround(0.6), -2, 0, 1], motes: [5, 6, Math.fround(0.2), 7, 8, Math.fround(0.3)] });
    // Past the last frame, the last one; the clip's phase picks the nearest frame.
    expect(at(9)).toEqual(at(2));
    expect(glassFrameIndex(t, 0.74)).toBe(1);
    expect(glassFrameIndex(t, 0.76)).toBe(2);
    // A record that does not follow, or names a mote that never landed, is refused.
    expect(() => w.push(record([], 5, [], []))).toThrow();
    expect(() => w.push(record([], 3, [], [9]))).toThrow();
    // A damaged track is not one.
    expect(isGlassTrack({ ...t, drops: t.drops.slice(0, -8) })).toBe(false);
    expect(isGlassTrack({ ...t, frames: 4 })).toBe(false);
    expect(NEVER).toBe(0xffffffff);
  });

  it.skipIf(!RT_WASM)('the real engine: the parity pane gives the native pin, and two runs of one key record the same track', async () => {
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    expect(hasWetExports(rt)).toBe(true);
    if (!hasWetExports(rt)) return;
    const run = () => {
      const sim = new WetSim(rt, spec1);
      const w = new GlassTrackWriter('cam1', 24, wetKey(spec1), 60);
      w.push(sim.frame());
      for (let k = 1; k <= 120; k++) {
        sim.step(10);
        w.push(sim.frame());
      }
      const out = { hash: sim.hash, steps: sim.steps, track: w.track() };
      sim.free();
      return out;
    };
    const a = run();
    const b = run();
    expect(a.steps).toBe(1200);
    expect(a.hash).toBe(pinned(WET_TESTS, 'PINNED_WET_PANE'));
    expect(b.track).toEqual(a.track);
    const last = glassFrame(a.track, 120)!;
    expect(last.drops.length / 3).toBeGreaterThan(20);
    expect(() => new WetSim(rt, new Uint8Array([1, 2, 3]))).toThrow(/WET1/);
  });
});

describe('S3b: the PHYSICS clip of the camera', () => {
  function recorded(): ProjectState {
    const s = rainyScene();
    const w = new GlassTrackWriter(s.camera.active, s.animation.fps, 'wet1:abc', 60);
    w.push(record([], 0, [], []));
    w.push(record([[0, 0, 2]], 0, [[4, 4, 0.2]], []));
    w.push(record([[0, -1, 2.1]], 1, [], []));
    return apply(s, { type: 'physics/begin', clips: [glassClip('c9', 0, w.track())] });
  }

  it('says which frame the camera shows at an instant, moves no camera, and shows at 0 too', () => {
    const s = recorded();
    const fps = s.animation.fps;
    const clip = s.animation.clips[0];
    expect(clip).toMatchObject({ target: { kind: 'CAMERA' }, move: 'PHYSICS', start: 0, duration: 2 / fps });
    expect(evaluate(s, 1 / fps).glass).toEqual({ [s.camera.active]: { clip: 'c9', frame: 1 } });
    expect(evaluate(s, 10).glass?.[s.camera.active].frame).toBe(2);
    // The camera itself does not move for it.
    expect(evaluate(s, 1 / fps).camera).toBeNull();
    // At 0, not playing: the pose still says the frame (a still render of the glass).
    expect(playheadPose(s)?.glass?.[s.camera.active]).toEqual({ clip: 'c9', frame: 0 });
  });

  it('saves with the project and opens again, bit for bit; a damaged one is left out', async () => {
    const s = recorded();
    const text = await serializeProject(s).text();
    const back = loadProject(text).state;
    expect(back.animation.clips[0].glass).toEqual(s.animation.clips[0].glass);
    const damaged = loadProject(text.replace(/"drops": ?"[^"]*"/, '"drops": "AAAA"')).state;
    expect(damaged.animation.clips).toHaveLength(0);
    // The source of the glass travels with the camera.
    expect(normalizeFrontGlass({ ...newFrontGlass(), source: 'SCENE' })?.source).toBe('SCENE');
    expect(normalizeFrontGlass({ ...newFrontGlass(), source: 'WHAT' })?.source).toBeUndefined();
  });

  it('goes to an engine with bit 7 drop by drop, the frame of the pose, and to no other engine', () => {
    let s = recorded();
    const view = { width: 64, height: 48, maxSamples: 1, maxSeconds: 0, drops: true, glassLayout: true };
    s = apply(s, { type: 'anim/playhead', t: 1 / s.animation.fps });
    const glas = (st: ProjectState, v: object) => sections(writeRsb(projectScene(st, { ...view, ...v }).scene)).find((x) => x.tag === 'GLAS');
    const g = glas(s, {})!;
    const p = g.payload;
    expect(p.byteLength).toBe(48 + 4 * (3 + 3 + 3));
    expect([p.getFloat32(12, true), p.getFloat32(32, true)]).toEqual([0, 0]); // no coverage
    expect(p.getFloat32(24, true)).toBe(60); // the cap angle it was recorded with
    expect([p.getUint32(48, true), p.getUint32(52, true), p.getUint32(56, true)]).toEqual([1, 1, 1]);
    expect([p.getFloat32(60, true), p.getFloat32(64, true), p.getFloat32(68, true)]).toEqual([0, 0, 2]);
    // An engine without bit 7 would draw it clean: none is written. Nor without a recording.
    expect(glas(s, { glassLayout: false })).toBeUndefined();
    expect(glas(rainyScene(), {})).toBeUndefined();
    expect(readsGlassLayout(255)).toBe(true);
    expect(readsGlassLayout(127)).toBe(false);
  });
});

describe('S3b: the physics bar runs the glass', () => {
  function app() {
    const store = createStore(rainyScene());
    const ui = createUiStore();
    let onUpdate: ((u: PhysicsUpdate) => void) | null = null;
    let resolveDone: ((r: PhysicsResult) => void) | null = null;
    let frame = 0;
    const runs: { bodies: number; wet: WetPaneSpec | null; maxSeconds: number }[] = [];
    const physics: PhysicsPort = {
      run(spec, options, update, wet): PhysicsRunHandle {
        runs.push({ bodies: spec.bodies.length, wet: wet ?? null, maxSeconds: options.maxSeconds });
        onUpdate = update;
        frame = 0;
        const started: PhysicsStarted = { ids: new Uint32Array(0), initial: new Float32Array(0), bodies: 0, glass: record([], 0, [], []) };
        return {
          started: Promise.resolve(started),
          done: new Promise<PhysicsResult>((r) => (resolveDone = r)),
          pause() {},
          resume() {},
          stop() {
            resolveDone?.({ steps: frame * 10, awake: 0, bodies: 0, settled: false, frames: [], glass: [], poses: new Float32Array(0), reason: 'STOPPED' });
          },
        };
      },
    };
    const glass: GlassPort = {
      pane: (state, id) => {
        const f = glassFrameRsb(state, id);
        return f ? { pane: fakePane(), axes: f.axes } : null;
      },
    };
    const ctx = { store, ui, services: { physics, glass } as unknown as AppServices } as Ctx;
    const emit = (n: number) => {
      const frames = Array.from({ length: n }, () => new Float32Array(0));
      const records = Array.from({ length: n }, () => {
        frame++;
        return record([[0, 10 - frame, 2]], frame - 1, [[1, 1, 0.1]], []);
      });
      onUpdate?.({ steps: frame * 10, awake: 0, bodies: 0, settled: false, frames, glass: records });
    };
    return { ctx, store, ui, runs, emit };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('Start with no Dynamic part runs the glass alone, for its own time, and records it into a clip of the camera', async () => {
    const { ctx, store, ui, runs, emit } = app();
    phys.start(ctx);
    await tick();
    expect(runs).toHaveLength(1);
    expect(runs[0].bodies).toBe(0);
    expect(runs[0].wet?.sources).toHaveLength(1);
    expect(runs[0].maxSeconds).toBe(MAX_GLASS_SECONDS);
    expect(ui.get().physics.state).toBe('RUNNING');
    const clip = () => store.get().animation.clips.find((c) => c.move === 'PHYSICS' && c.glass)!;
    expect(clip().target).toEqual({ kind: 'CAMERA' });
    expect(clip().glass!.key).toBe(wetKey(wetBytes(runs[0].wet!)));
    emit(3);
    expect(clip().glass!.frames).toBe(4);
    expect(ui.get().physics.glass).toEqual({ drops: 1, motes: 3 });
    expect(store.get().animation.playhead).toBeCloseTo(3 / store.get().animation.fps, 9);
    phys.stop(ctx);
    await tick();
    expect(ui.get().physics).toMatchObject({ state: 'STOPPED', ended: 'STOPPED', canReset: true });
    // One undo step for the whole run.
    expect(store.history().undo).toHaveLength(1);
    // Reset takes the clip away, as a step of its own that can be undone.
    phys.reset(ctx);
    expect(store.get().animation.clips.some((c) => c.glass)).toBe(false);
    expect(store.history().undo).toHaveLength(2);
    store.undo();
    expect(clip().glass!.frames).toBe(4);
    store.undo();
    expect(store.get().animation.clips).toHaveLength(0);
  });

  it('Reset while it runs takes the glass’s clip away too', async () => {
    const { ctx, store, emit } = app();
    phys.start(ctx);
    await tick();
    emit(2);
    expect(store.get().animation.clips.some((c) => c.glass)).toBe(true);
    phys.pause(ctx);
    phys.reset(ctx);
    expect(store.get().animation.clips.some((c) => c.glass)).toBe(false);
    expect(phys.simulating(ctx)).toBe(false);
  });

  it('Drop runs the bodies alone; Start without an effect that feeds the glass, or by hand, has nothing to do', async () => {
    const { ctx, store, runs } = app();
    const rain = store.get().effects[0].id;
    store.dispatch({ type: 'effect/set', id: rain, patch: { enabled: false } });
    phys.start(ctx);
    await tick();
    expect(runs).toHaveLength(0);
    expect(ctx.ui.get().physics.ended).toBe('NOTHING');
    store.dispatch({ type: 'effect/set', id: rain, patch: { enabled: true } });
    const cam = activeCamera(store.get());
    store.dispatch({ type: 'camera/set', id: cam.id, patch: { optics: { ...opticsOf(cam), frontGlass: { ...cam.optics!.frontGlass!, source: 'MANUAL' } } } });
    phys.start(ctx);
    await tick();
    expect(runs).toHaveLength(0);
  });
});

describe('S3b: the Fast viewport’s approximation', () => {
  it('the footprint of a pixel on the pane, the drops’ two faces', () => {
    // 28 mm f/8 focused at 1 m, the pane at 25 mm: (A / 2)(1 − d / s).
    expect(footprintRadiusMm(28, 8, 1000, 25, false)).toBeCloseTo(1.75 * (1 - 0.025), 9);
    expect(footprintRadiusMm(28, 0, 1000, 25, false)).toBe(0);
    expect(footprintRadiusMm(28, 8, 1000, 25, true)).toBe(0);
    expect(dropTransmittance(1.333)).toBeCloseTo((1 - (0.333 / 2.333) ** 2) ** 2, 9);
  });

  it('a sharp drop covers its disc and nothing else; a blurred one its share of the footprint; dust dims by its share', () => {
    const layout = { distanceMm: 25, drops: new Float32Array([0, 0, 2]), motes: new Float32Array(0), dustOpacity: 0.9, ior: 1.333, contactAngleDeg: 60 };
    const rect = { x0: -10, y0: -10, x1: 10, y1: 10 };
    const sharp = paneGrid(layout, rect, 0);
    expect(gridMean(sharp, [0, 0], 1.5, 0)).toBe(1);
    expect(gridMean(sharp, [6, 6], 1, 0)).toBe(0);
    // Its rim: the outer ring from 1 / (n sin θ) of its radius (0.866 a for water at 60°), dark, and none in its middle.
    expect(rimStart(60, 1.333)).toBeCloseTo(1 / (1.333 * Math.sin(Math.PI / 3)), 9);
    expect(rimStart(30, 1.333)).toBe(1);
    expect(gridMean(sharp, [0, 0], 1.5, 2)).toBe(0);
    let rimArea = 0;
    for (let i = 2; i < sharp.data.length; i += 3) rimArea += sharp.data[i] * sharp.cell * sharp.cell;
    const ring = Math.PI * 4 * (1 - rimStart(60, 1.333) ** 2);
    expect(Math.abs(rimArea - ring)).toBeLessThan(0.15 * ring);
    // A footprint of 4 mm over a drop of 2 mm: at its centre a quarter of the footprint is under it (± 15 %).
    const soft = paneGrid(layout, rect, 4);
    expect(gridMean(soft, [0, 0], 0.3, 0)).toBeGreaterThan(0.25 * 0.85);
    expect(gridMean(soft, [0, 0], 0.3, 0)).toBeLessThan(0.25 * 1.15);
    // Motes covering 2 % of the pane, 90 % opaque: 1.8 % dimmer, blurred or not.
    const motes: number[] = [];
    for (let y = -9.5; y < 10; y += 1) for (let x = -9.5; x < 10; x += 1) motes.push(x, y, Math.sqrt(0.02 / Math.PI));
    const dusty = paneGrid({ ...layout, drops: new Float32Array(0), motes: new Float32Array(motes) }, rect, 3);
    expect(gridMean(dusty, [0, 0], 4, 1)).toBeCloseTo(0.018, 3);
  });

  it('a pixel’s chief ray finds its point of the pane through the projection', () => {
    // A three.js perspective projection of 40° vertical, 4:3, and a pane at 25 mm.
    const f = 1 / Math.tan((20 * Math.PI) / 180);
    const e = new Float32Array(16);
    e[0] = f / (4 / 3);
    e[5] = f;
    const m = paneMapping(e, 25, false);
    // The point (3, 2) mm of the pane, seen from the lens: ndc = (P00 · 3 / 25, P11 · 2 / 25).
    const ndc = [(e[0] * 3) / 25, (e[5] * 2) / 25];
    expect((ndc[0] - m.offset[0]) * m.scale[0]).toBeCloseTo(3, 9);
    expect((ndc[1] - m.offset[1]) * m.scale[1]).toBeCloseTo(2, 9);
    const r = seenRect(m);
    expect(r.y1).toBeCloseTo(25 * Math.tan((20 * Math.PI) / 180), 6);
  });

  it.skipIf(!RT_WASM)('the real engine lays out a pane by hand for a camera, the drops the render traces', async () => {
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    expect(hasGlassExports(rt)).toBe(true);
    if (!hasGlassExports(rt)) return;
    let s = exampleState();
    const cam = activeCamera(s);
    s = apply(s, { type: 'camera/set', id: cam.id, patch: { optics: { ...opticsOf(cam), frontGlass: { ...newFrontGlass(), drops: 0.4, dropSizeMm: 3 } } } });
    const pane = engineGlassPane(rt, glassPaneRsb(s, { width: 64, height: 48, camera: cam.id, pose: null })!)!;
    expect(pane.distanceMm).toBe(25);
    expect(pane.contactAngleDeg).toBe(60);
    expect(pane.drops.length).toBeGreaterThan(30);
    expect(pane.halfExtentMm).toBeGreaterThan(25);
    // A pane fed by the scene: no drops by hand, but where it is and how much the rays cross.
    s = apply(s, { type: 'camera/set', id: cam.id, patch: { optics: { ...opticsOf(activeCamera(s)), frontGlass: { ...activeCamera(s).optics!.frontGlass!, source: 'SCENE' } } } });
    const fed = engineGlassPane(rt, glassFrameRsb(s, cam.id)!.rsb)!;
    expect([fed.drops.length, fed.motes.length]).toEqual([0, 0]);
    expect(fed.distanceMm).toBe(25);
    expect(parseEnginePane(new Uint8Array(3))).toBeNull();
  });
});

describe('S3b: through the real engine', () => {
  it.skipIf(!RT_WASM)('the pane the simulation left renders to the native hash through the page code', async () => {
    const rt = await loadRt();
    const { image } = renderWithPasses(rt, wetRsb, 160, 120, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned(WET_TESTS, 'PINNED_S3B_WET_4SPP'));
    // Its GLAS is the 48 bytes and the layout.
    const g = sections(wetRsb).find((x) => x.tag === 'GLAS')!;
    expect(g.payload.getUint32(48, true)).toBe(1);
    expect(g.payload.byteLength).toBe(48 + 4 * (3 + 3 * (g.payload.getUint32(52, true) + g.payload.getUint32(56, true))));
  }, 240_000);
});

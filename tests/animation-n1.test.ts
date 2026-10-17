// Phase N1: the kinds of animation that were missing (FADE, PAN, MATERIAL_COLOR, SUN_ARC, PATH reserved), rotations
// about a pivot, the custom curve with two handles, the camera track's fades to a colour, and how they reach the
// engine's scene and the pixels of a frame. Numbers, not pictures.

import { describe, expect, it } from 'vitest';
import { MOVE_KINDS, SEQUENCE_PRESETS } from '../src/data/animation';
import {
  canSplit,
  clipCurve,
  evaluate,
  partsWearing,
  poseActive,
  shotFadeAt,
  splitClip,
  SUN_LATITUDE,
  SUN_POLE_AZ,
  sunArc,
  totalDuration,
  type MotionClip,
} from '../src/core/animation';
import { activeCamera, cameraPosition } from '../src/core/camera';
import { bezierEase, DEFAULT_CURVE, normaliseCurve } from '../src/core/curve';
import { fadeDisplay, fadeLinear } from '../src/core/fade';
import { polar } from '../src/core/light-math';
import { boxCenter, mat4Compose, mat4Multiply, transformPoint, type Mat4 } from '../src/core/math';
import { partWorldBounds, worldMatrix, type NodeId } from '../src/core/scene';
import type { ProjectState } from '../src/core/store';
import { createStore } from '../src/core/store';
import { projectScene } from '../src/io/rsb';
import { clipSentence } from '../src/ui/sentence';
import * as anim from '../src/ui/anim-commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { createUiStore } from '../src/ui/ui-state';
import { apply, exampleState, keyIds } from './helpers';

type NewClip = Omit<MotionClip, 'id'>;
const add = (s: ProjectState, ...clips: NewClip[]): ProjectState => apply(s, ...clips.map((clip) => ({ type: 'anim/addClip' as const, clip })));
const clip = (c: Partial<NewClip> & Pick<NewClip, 'target' | 'move'>): NewClip => ({ shot: null, start: 0, duration: 4, amount: 0, easing: 'LINEAR', ...c });
const angleBetween = (a: readonly number[], b: readonly number[]) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

/** The world matrix of a node under a pose (the pose's local transforms on the way up, the scene's where it has none). */
function posedWorld(s: ProjectState, pose: ReturnType<typeof evaluate>, id: NodeId): Mat4 {
  const n = s.scene.nodes[id];
  const p = pose.nodes[id];
  const local = p ? mat4Compose(p.position, p.rotation, p.scale) : mat4Compose(n.transform.position, n.transform.rotation, n.transform.scale);
  return n.parent ? mat4Multiply(posedWorld(s, pose, n.parent), local) : local;
}

describe('rotation about a pivot (N1)', () => {
  it('a part turning about another part keeps its distance to that part’s centre, and does move', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const s = add(s0, clip({ target: { kind: 'NODE', id: ids.cap }, move: 'SPIN', amount: 90, pivot: { kind: 'NODE', id: ids.body } }));
    const pivot = boxCenter(partWorldBounds(s, ids.body));
    // The cap's own centre, in its local frame, followed through the pose.
    const capLocal = (() => {
      const w = worldMatrix(s, ids.cap);
      const c = boxCenter(partWorldBounds(s, ids.cap));
      // Invert the rest world matrix for that one point: the cap has no rotation or scale at rest.
      return [c[0] - w[12], c[1] - w[13], c[2] - w[14]];
    })();
    const centreAt = (t: number) => transformPoint(posedWorld(s, evaluate(s, t), ids.cap), capLocal);
    const dist = (p: readonly number[]) => Math.hypot(p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]);
    const d0 = dist(centreAt(0));
    for (const t of [0.5, 1, 2, 3, 4]) expect(dist(centreAt(t)), `t=${t}`).toBeCloseTo(d0, 5);
    // Turned about the body's vertical axis by 90°: the cap is off the axis, so its centre moved in X/Y.
    const capOffAxis = Math.hypot(centreAt(0)[0] - pivot[0], centreAt(0)[1] - pivot[1]);
    if (capOffAxis > 1e-6) expect(Math.hypot(centreAt(4)[0] - centreAt(0)[0], centreAt(4)[1] - centreAt(0)[1])).toBeGreaterThan(1e-3);
    // And it turned: its Z rotation is the clip's.
    expect(evaluate(s, 4).nodes[ids.cap].rotation[2]).toBeCloseTo(90, 6);
  });

  it('a part turning about a point off its axis travels round it at a constant distance; no pivot is its own origin', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const point: [number, number, number] = [80, 0, 30];
    const s = add(s0, clip({ target: { kind: 'NODE', id: ids.cap }, move: 'SPIN', amount: 180, pivot: { kind: 'POINT', point } }));
    const origin = (t: number) => transformPoint(posedWorld(s, evaluate(s, t), ids.cap), [0, 0, 0]);
    const d = (p: readonly number[]) => Math.hypot(p[0] - point[0], p[1] - point[1]);
    const d0 = d(origin(0));
    expect(d0).toBeGreaterThan(10);
    // To a hundredth of a micron (the turn goes through Euler angles and back).
    for (const t of [1, 2, 3, 4]) expect(d(origin(t)), `t=${t}`).toBeCloseTo(d0, 5);
    // Half a turn: on the other side of the point.
    expect(origin(4)[0]).toBeCloseTo(2 * point[0] - origin(0)[0], 5);
    expect(origin(4)[2]).toBeCloseTo(origin(0)[2], 5);
    // Without a pivot, the same clip turns the cap where it is (as before N1).
    const own = add(s0, clip({ target: { kind: 'NODE', id: ids.cap }, move: 'SPIN', amount: 180 }));
    expect(evaluate(own, 4).nodes[ids.cap].position).toEqual(own.scene.nodes[ids.cap].transform.position);
    // A pivot on a part that is gone is the node's own origin too.
    const gone = add(s0, clip({ target: { kind: 'NODE', id: ids.cap }, move: 'SPIN', amount: 180, pivot: { kind: 'NODE', id: 'nope' } }));
    expect(evaluate(gone, 4).nodes[ids.cap].position).toEqual(gone.scene.nodes[ids.cap].transform.position);
  });
});

describe('FADE (N1)', () => {
  it('reversed and repeated twice gives the expected opacity at five instants', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    // To 20 % over 2 s from 1 s, twice (the bar runs 1–5 s), reversed: it fades in from 20 %, twice.
    const s = add(s0, clip({ target: { kind: 'NODE', id: ids.cap }, move: 'FADE', start: 1, duration: 2, amount: 20, repeat: 2, reverse: true }));
    const opacity = (t: number) => evaluate(s, t).nodes[ids.cap].opacity;
    // Reversed: before it starts it holds its end, 20 %; each repeat goes from 20 % back to whole.
    expect(opacity(0.5)).toBeCloseTo(0.2, 12);
    expect(opacity(1.5)).toBeCloseTo(1 - 0.8 * 0.75, 12); // phase 0.25, mirrored 0.75
    expect(opacity(2.5)).toBeCloseTo(1 - 0.8 * 0.25, 12); // phase 0.75, mirrored 0.25
    expect(opacity(3.5)).toBeCloseTo(1 - 0.8 * 0.75, 12); // the second repeat, phase 0.25 again
    expect(opacity(6)).toBeCloseTo(1, 12); // after the end: whole
    // Forwards it goes the other way.
    const fwd = add(s0, clip({ target: { kind: 'NODE', id: ids.cap }, move: 'FADE', start: 1, duration: 2, amount: 20, repeat: 2 }));
    expect(evaluate(fwd, 1.5).nodes[ids.cap].opacity).toBeCloseTo(1 - 0.8 * 0.25, 12);
    expect(evaluate(fwd, 6).nodes[ids.cap].opacity).toBeCloseTo(0.2, 12);
  });

  it('fades on a node and its group multiply on the way to the engine; a part faded out is not there', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const s = add(
      s0,
      clip({ target: { kind: 'NODE', id: ids.closure }, move: 'FADE', amount: 50 }),
      clip({ target: { kind: 'NODE', id: ids.cap }, move: 'FADE', amount: 50 }),
      clip({ target: { kind: 'NODE', id: ids.label }, move: 'FADE', amount: 0 }),
    );
    const at = (t: number) => projectScene(s, { width: 64, height: 64, maxSamples: 1, maxSeconds: 0, pose: evaluate(s, t) }).scene;
    const before = projectScene(s0, { width: 64, height: 64, maxSamples: 1, maxSeconds: 0, pose: evaluate(s0, 0) }).scene;
    const end = at(4);
    // The label is gone; the others stay, the cap at a quarter (its own half and its group's), the collar at a half.
    expect(end.instances!.length).toBe(before.instances!.length - 1);
    const opacities = end.instances!.map((i) => end.materials[i.materialId].opacity).sort((a, b) => a - b);
    expect(opacities[0]).toBeCloseTo(0.25, 6);
    expect(opacities[1]).toBeCloseTo(0.5, 6);
    expect(opacities.slice(2).every((o) => o === 1)).toBe(true);
    // At 0 nothing has faded: the same materials as without the clips.
    expect(at(0).materials).toEqual(before.materials);
  });

  it('on a material fades every part that wears it; split, it multiplies back to the whole', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const mat = s0.scene.nodes[ids.body].material!;
    const s = add(s0, clip({ target: { kind: 'MATERIAL', id: mat }, move: 'FADE', amount: 40, easing: 'EASE' }));
    expect(partsWearing(s, mat)).toEqual([ids.body]);
    expect(evaluate(s, 2).materials[mat].opacity).toBeCloseTo(1 - 0.6 * 0.5, 12);
    const scene = projectScene(s, { width: 64, height: 64, maxSamples: 1, maxSeconds: 0, pose: evaluate(s, 4) }).scene;
    expect(scene.materials.some((m) => Math.abs(m.opacity - 0.4) < 1e-6)).toBe(true);
    // Split at 1 s: the first half ends where the clip was, the second goes on from there to 40 %.
    const c = s.animation.clips[0];
    expect(canSplit(c, 1)).toBe(true);
    const [a, b] = splitClip(c, 1)!;
    const k = 1 - 0.6 * clipCurve(c, 0.25);
    expect(a.amount).toBeCloseTo(100 * k, 9);
    expect((a.amount / 100) * (b.amount / 100)).toBeCloseTo(0.4, 12);
  });
});

describe('PAN (N1)', () => {
  it('the camera turns where it stands: its position stays, its view turns right by the amount', () => {
    const s = add(exampleState(), clip({ target: { kind: 'CAMERA' }, move: 'PAN', amount: 30 }));
    const cam = activeCamera(s);
    const p0 = cameraPosition(cam);
    for (const t of [1, 2, 4]) {
      const c = evaluate(s, t).camera!;
      const p = cameraPosition(c);
      for (let k = 0; k < 3; k++) expect(p[k], `t=${t}`).toBeCloseTo(p0[k], 6);
    }
    const c = evaluate(s, 4).camera!;
    expect(c.azimuth).toBeCloseTo(cam.azimuth - 30, 9);
    expect(c.elevation).toBeCloseTo(cam.elevation, 9);
    expect(c.distance).toBeCloseTo(cam.distance, 9);
    // The view turned 30° to the right: towards the camera's right vector, seen from above (Z up).
    const before = [cam.target[0] - p0[0], cam.target[1] - p0[1]];
    const after = [c.target[0] - p0[0], c.target[1] - p0[1]];
    const turned = (Math.atan2(before[0] * after[1] - before[1] * after[0], before[0] * after[0] + before[1] * after[1]) * 180) / Math.PI;
    expect(turned).toBeCloseTo(-30, 6); // clockwise from above: to the right
    expect(clipSentence(s, s.animation.clips[0], 'en')).toBe('The camera pans 30° to the right over 4 s, linear');
  });
});

describe('MATERIAL_COLOR (N1)', () => {
  it('goes from the material’s own colour to the clip’s, reaches the engine, and leaves the material as it was', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const mat = s0.scene.nodes[ids.cap].material!;
    const own = s0.materials[mat].params.baseColor!;
    const s = add(s0, clip({ target: { kind: 'MATERIAL', id: mat }, move: 'MATERIAL_COLOR', color: [0.9, 0.1, 0.1] }));
    const mid = evaluate(s, 2).materials[mat].color!;
    for (let k = 0; k < 3; k++) expect(mid[k]).toBeCloseTo((own[k] + [0.9, 0.1, 0.1][k]) / 2, 12);
    evaluate(s, 4).materials[mat].color!.forEach((v, k) => expect(v).toBeCloseTo([0.9, 0.1, 0.1][k], 12));
    // The engine's scene draws the cap in the colour of the instant; the project's material is untouched.
    const scene = projectScene(s, { width: 64, height: 64, maxSamples: 1, maxSeconds: 0, pose: evaluate(s, 4) }).scene;
    expect(scene.materials.some((m) => m.baseColor.every((v, k) => Math.abs(v - [0.9, 0.1, 0.1][k]) < 1e-6))).toBe(true);
    expect(s.materials[mat].params.baseColor).toEqual(own);
    expect(clipSentence(s, s.animation.clips[0], 'es')).toMatch(/^El material .+ cambia de color durante 4 s, lineal$/);
  });
});

describe('SUN_ARC (N1)', () => {
  const pole = polar(SUN_POLE_AZ, SUN_LATITUDE, 1);
  it('turns the sun about the celestial pole: its angle to the pole stays, a day brings it back, the arcs add up', () => {
    const start = { az: -55, el: 55 };
    const d0 = angleBetween(polar(start.az, start.el, 1), pole);
    for (const deg of [15, 45, 90, 180, 270]) {
      const p = sunArc(start.az, start.el, deg);
      expect(angleBetween(polar(p.az, p.el, 1), pole), String(deg)).toBeCloseTo(d0, 6);
    }
    const day = sunArc(start.az, start.el, 360);
    expect(angleBetween(polar(day.az, day.el, 1), polar(start.az, start.el, 1))).toBeCloseTo(0, 5);
    const twice = sunArc(sunArc(start.az, start.el, 30).az, sunArc(start.az, start.el, 30).el, 30);
    const once = sunArc(start.az, start.el, 60);
    expect(angleBetween(polar(twice.az, twice.el, 1), polar(once.az, once.el, 1))).toBeCloseTo(0, 6);
    // It moves: 90° of arc is a long way across the sky.
    const q = sunArc(start.az, start.el, 90);
    expect(angleBetween(polar(q.az, q.el, 1), polar(start.az, start.el, 1))).toBeGreaterThan(30);
  });

  it('moves the sky’s own sun without a sun light (and the engine’s sky with it), the rig’s sun light with one', () => {
    const s0 = exampleState();
    const noSun = { ...s0, studio: { ...s0.studio, lights: s0.studio.lights.filter((l) => l.type !== 'SUN') }, environment: { ...s0.environment, kind: 'SKY' as const } };
    const s = add(noSun, clip({ target: { kind: 'SCENE' }, move: 'SUN_ARC', amount: 90 }));
    const p = evaluate(s, 4);
    expect(p.skySun).toEqual(sunArc(noSun.environment.skySun.az, noSun.environment.skySun.el, 90));
    const sky = (st: ProjectState, t: number) => projectScene(st, { width: 64, height: 64, maxSamples: 1, maxSeconds: 0, pose: evaluate(st, t) }).scene.environment;
    expect(sky(s, 4).sunElevationDeg).not.toBeCloseTo(sky(s, 0).sunElevationDeg, 3);
    expect(sky(s, 0)).toEqual(sky(noSun, 0));
    const withSun = { ...s0, studio: { ...s0.studio, lights: [{ ...s0.studio.lights[0], type: 'SUN' as const, enabled: true, power: 1 }, ...s0.studio.lights.slice(1)] } };
    const t = add(withSun, clip({ target: { kind: 'SCENE' }, move: 'SUN_ARC', amount: 90 }));
    const l0 = withSun.studio.lights[0];
    expect(evaluate(t, 4).lights[l0.id]).toMatchObject(sunArc(l0.az, l0.el, 90));
    expect(evaluate(t, 4).skySun).toBeNull();
  });
});

describe('the custom curve with two handles (N1)', () => {
  /** The reference: the curve's x solved by bisection to the last bit, independently of the code under test. */
  function reference(x: number, [x1, y1, x2, y2]: readonly number[]): number {
    const b = (s: number, a: number, c: number) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * c + s * s * s;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 200; i++) {
      const m = (lo + hi) / 2;
      if (b(m, x1, x2) < x) lo = m;
      else hi = m;
    }
    return b((lo + hi) / 2, y1, y2);
  }

  it('handles at (0.42, 0) and (0.58, 1) match the reference within ±1e-3 (it is well inside 1e-6)', () => {
    const h = [0.42, 0, 0.58, 1] as const;
    let worst = 0;
    for (let i = 0; i <= 1000; i++) {
      const x = i / 1000;
      worst = Math.max(worst, Math.abs(bezierEase(x, h) - reference(x, h)));
    }
    expect(worst).toBeLessThan(1e-3);
    expect(worst).toBeLessThan(1e-6);
    // Symmetric handles: half way at half time, and the classic values of this curve.
    expect(bezierEase(0.5, h)).toBeCloseTo(0.5, 9);
    expect(bezierEase(0.25, h)).toBeCloseTo(reference(0.25, h), 9);
    expect(bezierEase(0, h)).toBe(0);
    expect(bezierEase(1, h)).toBe(1);
  });

  it('holds where Newton’s method alone would not (flat handles), and keeps the handles where they can be', () => {
    for (const h of [
      [0, 0, 1, 1],
      [1, 0, 0, 1],
      [0.9, 0.1, 0.1, 0.9],
      [0, 1, 1, 0],
      [0.25, -0.25, 0.75, 1.25],
    ] as const) {
      // Where a handle sits at the far end the curve stands vertical at a point, and no solver in doubles does better
      // than a few millionths there (the reference neither): 1e-5.
      for (let i = 0; i <= 100; i++) expect(bezierEase(i / 100, h), `${h} at ${i}`).toBeCloseTo(reference(i / 100, h), 4);
    }
    expect(normaliseCurve([-1, -3, 2, 9])).toEqual([0, -0.25, 1, 1.25]);
    expect(normaliseCurve('nonsense')).toEqual([...DEFAULT_CURVE]);
  });

  it('a clip with the CUSTOM easing plays its handles; a dragged handle is one undo entry', () => {
    const s0 = exampleState();
    const store = createStore(add(s0, clip({ target: { kind: 'CAMERA' }, move: 'ORBIT', amount: 100, easing: 'CUSTOM', curve: [0.1, 0.9, 0.2, 1] })));
    const base = activeCamera(store.get()).azimuth;
    const id = store.get().animation.clips[0].id;
    expect(evaluate(store.get(), 1).camera!.azimuth - base).toBeCloseTo(100 * reference(0.25, [0.1, 0.9, 0.2, 1]), 6);
    const before = store.history().undo.length;
    for (const x of [0.2, 0.3, 0.4, 0.5]) store.dispatch({ type: 'anim/setClip', id, patch: { curve: [x, 0.9, 0.2, 1] }, gesture: 'curve-drag', label: 'Curve' });
    expect(store.history().undo.length).toBe(before + 1);
    expect(store.get().animation.clips[0].curve).toEqual([0.5, 0.9, 0.2, 1]);
    // A handle typed out of bounds lands within them.
    store.dispatch({ type: 'anim/setClip', id, patch: { curve: [3, 2, -1, 1] }, label: 'Curve' });
    expect(store.get().animation.clips[0].curve).toEqual([1, 1.25, 0, 1]);
    store.undo();
    store.undo();
    expect(store.get().animation.clips[0].curve).toEqual([0.1, 0.9, 0.2, 1]);
  });
});

describe('the camera track’s changes of shot (N1)', () => {
  const withShots = (s0: ProjectState) =>
    apply(s0, { type: 'anim/addShot', duration: 2 }, { type: 'anim/addShot', duration: 2 }, { type: 'anim/addShot', duration: 2 });

  it('a cut has no fade; a fade to black goes down to the cut and up after it, half on each side', () => {
    let s = withShots(exampleState());
    const [, second, third] = s.animation.shots;
    expect(shotFadeAt(s, 2)).toBeNull();
    s = apply(s, { type: 'anim/setShot', id: second.id, patch: { transition: { kind: 'FADE', color: 'BLACK', duration: 1 } } });
    expect(shotFadeAt(s, 1.4)).toBeNull();
    expect(shotFadeAt(s, 2)).toEqual({ color: [0, 0, 0], amount: 1 });
    expect(shotFadeAt(s, 1.75)!.amount).toBeCloseTo(0.5, 12); // the smooth curve at half way
    expect(shotFadeAt(s, 2.25)!.amount).toBeCloseTo(0.5, 12);
    expect(shotFadeAt(s, 2.6)).toBeNull();
    // White, and never longer than half of either shot: a 10 s fade into a 2 s shot is 2 s long.
    s = apply(s, { type: 'anim/setShot', id: third.id, patch: { transition: { kind: 'FADE', color: 'WHITE', duration: 10 } } });
    expect(shotFadeAt(s, 4)).toEqual({ color: [1, 1, 1], amount: 1 });
    expect(shotFadeAt(s, 3)).toBeNull();
    expect(shotFadeAt(s, 3.5)!.amount).toBeCloseTo(0.5, 12);
    expect(shotFadeAt(s, 5)).toBeNull();
    // Back to a cut: the field goes.
    s = apply(s, { type: 'anim/setShot', id: third.id, patch: { transition: undefined } });
    expect(s.animation.shots[2].transition).toBeUndefined();
    expect(shotFadeAt(s, 4)).toBeNull();
    // The pose carries the fade of its instant.
    expect(evaluate(s, 2).fade).toEqual({ color: [0, 0, 0], amount: 1 });
  });

  it('into the first shot, a fade from the colour at the start; a damaged change is a cut', () => {
    let s = withShots(exampleState());
    const first = s.animation.shots[0];
    s = apply(s, { type: 'anim/setShot', id: first.id, patch: { transition: { kind: 'FADE', color: 'BLACK', duration: 0.5 } } });
    expect(shotFadeAt(s, 0)).toEqual({ color: [0, 0, 0], amount: 1 });
    expect(shotFadeAt(s, 0.25)!.amount).toBeCloseTo(0.5, 12);
    expect(shotFadeAt(s, 0.5)).toBeNull();
    const damaged = { ...s, animation: { ...s.animation, shots: s.animation.shots.map((x, i) => (i === 1 ? { ...x, transition: { kind: 'WIPE', color: 'RED', duration: 'long' } as never } : x)) } };
    expect(shotFadeAt(damaged, 2)).toBeNull();
    // A fade's length within its limits.
    s = apply(s, { type: 'anim/setShot', id: first.id, patch: { transition: { kind: 'FADE', color: 'WHITE', duration: 0 } } });
    expect(s.animation.shots[0].transition).toEqual({ kind: 'FADE', color: 'WHITE', duration: 0.04 });
  });

  it('the pixels of a frame are mixed with the colour: display values as they are, linear light in linear light', () => {
    const px = Uint8ClampedArray.from([200, 100, 0, 255, 10, 20, 30, 0]);
    expect([...fadeDisplay(px, { color: [0, 0, 0], amount: 0.5 }, 255)]).toEqual([100, 50, 0, 255, 5, 10, 15, 128]);
    expect([...fadeDisplay(px, { color: [1, 1, 1], amount: 1 }, 255)]).toEqual([255, 255, 255, 255, 255, 255, 255, 255]);
    expect(fadeDisplay(px, null, 255)).toBe(px);
    const words = Uint16Array.from([65535, 0, 32768, 65535]);
    expect([...fadeDisplay(words, { color: [1, 1, 1], amount: 0.25 }, 65535)]).toEqual([65535, 16384, 40960, 65535]);
    const lin = Float32Array.from([4, 0.5, 0, 0.5]);
    expect([...fadeLinear(lin, { color: [1, 1, 1], amount: 0.5 })]).toEqual([2.5, 0.75, 0.5, 0.75]);
    expect(fadeLinear(lin, { color: [0, 0, 0], amount: 0 })).toBe(lin);
  });
});

describe('every preset, every frame (N1: the new fields of the pose too)', () => {
  it('the 16 presets give finite poses with no fade, no material changed and opacities within 0..1', () => {
    expect(SEQUENCE_PRESETS).toHaveLength(16);
    for (const preset of SEQUENCE_PRESETS) {
      const s = apply(exampleState(), { type: 'anim/preset', key: preset.key });
      const total = totalDuration(s);
      for (let f = 0; f <= Math.ceil(total * 12); f++) {
        const p = evaluate(s, f / 12);
        expect(p.fade, preset.key).toBeNull();
        expect(p.materials).toEqual({});
        expect(p.skySun).toBeNull();
        for (const n of Object.values(p.nodes)) expect(n.opacity ?? 1).toBe(1);
      }
    }
  });

  it('a clip of every kind the wizard offers gives a finite pose on every frame (PATH is reserved: it does nothing)', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const mat = s0.scene.nodes[ids.body].material!;
    const clips: NewClip[] = [
      clip({ target: { kind: 'CAMERA' }, move: 'PAN', amount: 40, easing: 'CUSTOM', curve: [0.2, 0, 0.3, 1] }),
      clip({ target: { kind: 'SUBJECT' }, move: 'FADE', amount: 10 }),
      clip({ target: { kind: 'NODE', id: ids.cap }, move: 'TUMBLE', amount: 45, pivot: { kind: 'NODE', id: ids.collar } }),
      clip({ target: { kind: 'MATERIAL', id: mat }, move: 'MATERIAL_COLOR', color: [0.2, 0.4, 0.6] }),
      clip({ target: { kind: 'MATERIAL', id: mat }, move: 'FADE', amount: 50, reverse: true }),
      clip({ target: { kind: 'SCENE' }, move: 'SUN_ARC', amount: 120 }),
      clip({ target: { kind: 'CAMERA' }, move: 'PATH', amount: 1 }),
    ];
    const s = add(s0, ...clips);
    expect(MOVE_KINDS.some((m) => m.key === 'PATH')).toBe(true);
    for (let f = 0; f <= 48; f++) {
      const p = evaluate(s, f / 12);
      const numbers = [
        ...(p.camera ? [p.camera.azimuth, p.camera.elevation, p.camera.distance, ...p.camera.target] : []),
        ...Object.values(p.nodes).flatMap((n) => [...n.position, ...n.rotation, ...n.scale, n.opacity ?? 1]),
        ...Object.values(p.materials).flatMap((m) => [m.opacity, ...(m.color ?? [])]),
        ...(p.skySun ? [p.skySun.az, p.skySun.el] : []),
      ];
      for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
      for (const n of Object.values(p.nodes)) expect(n.opacity ?? 1).toBeGreaterThanOrEqual(0);
    }
    // PATH moves nothing: the pose of the camera with it alone is the camera at rest.
    const path = add(s0, clip({ target: { kind: 'CAMERA' }, move: 'PATH', amount: 1 }));
    expect(evaluate(path, 2).camera).toMatchObject({ azimuth: activeCamera(s0).azimuth, distance: activeCamera(s0).distance });
    expect(poseActive({ ...path, animation: { ...path.animation, playhead: 1 } })).toBe(true);
  });
});

describe('the wizard in three steps, the shots and the materials in the timeline (N1)', () => {
  const ctxOf = (state: ProjectState): Ctx => ({ store: createStore(state), ui: createUiStore(), services: {} as AppServices });

  it('opens at step 1 with the target set; a material is a target with its own kinds; PATH is never offered', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const ctx = ctxOf(s0);
    anim.openWizard(ctx, { kind: 'NODE', id: ids.cap });
    expect(ctx.ui.get().wizard).toMatchObject({ step: 1, target: { kind: 'NODE', id: ids.cap }, move: 'SPIN' });
    const mat = s0.scene.nodes[ids.body].material!;
    expect(anim.wizardMoves(s0, { kind: 'MATERIAL', id: mat })).toEqual(['MATERIAL_COLOR', 'FADE']);
    expect(anim.wizardMoves(s0, { kind: 'CAMERA' })).toContain('PAN');
    expect(anim.wizardMoves(s0, { kind: 'CAMERA' })).not.toContain('PATH');
    expect(anim.wizardMoves(s0, { kind: 'SCENE' })).toEqual(['HDRI', 'SECTION', 'SUN_ARC']);
    expect(anim.wizardMoves(s0, { kind: 'NODE', id: ids.cap })).not.toContain('EXPLODE');
    // Step 3 and Add: a material's colour goes to the one picked; a custom curve starts from the classic one.
    ctx.ui.set({ wizard: { ...ctx.ui.get().wizard!, target: { kind: 'MATERIAL', id: mat }, move: 'MATERIAL_COLOR', color: [0.1, 0.2, 0.3], easing: 'CUSTOM', step: 3 } });
    const id = anim.finishWizard(ctx)!;
    const c = ctx.store.get().animation.clips.find((x) => x.id === id)!;
    expect(c).toMatchObject({ target: { kind: 'MATERIAL', id: mat }, move: 'MATERIAL_COLOR', color: [0.1, 0.2, 0.3], easing: 'CUSTOM', curve: [...DEFAULT_CURVE] });
    expect(ctx.store.history().undo.length).toBe(1);
    // Without a colour picked, a warmer one of the material's own.
    anim.openWizard(ctx, { kind: 'MATERIAL', id: mat });
    const id2 = anim.finishWizard(ctx)!;
    expect(ctx.store.get().animation.clips.find((x) => x.id === id2)!.color).toEqual(anim.wizardColor(s0, { kind: 'MATERIAL', id: mat }));
  });

  it('a material’s row selects the parts that wear it; a shot to the properties clears the clips, and back', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const mat = s0.scene.nodes[ids.cap].material!;
    const ctx = ctxOf(apply(add(s0, clip({ target: { kind: 'MATERIAL', id: mat }, move: 'FADE', amount: 0 })), { type: 'anim/addShot', duration: 2 }));
    anim.selectTargetRow(ctx, { kind: 'MATERIAL', id: mat });
    expect(ctx.store.get().selection.ids).toEqual(partsWearing(ctx.store.get(), mat));
    expect(anim.selectedClipIds(ctx)).toHaveLength(1);
    const shot = ctx.store.get().animation.shots[0].id;
    anim.selectShot(ctx, shot);
    expect(ctx.ui.get().selectedShot).toBe(shot);
    expect(anim.selectedClipIds(ctx)).toEqual([]);
    anim.selectClips(ctx, [ctx.store.get().animation.clips[0].id]);
    expect(ctx.ui.get().selectedShot).toBeNull();
  });

  it('a change of camera is one undo entry, and so is a drag of the fade’s length', () => {
    const ctx = ctxOf(apply(exampleState(), { type: 'anim/addShot', duration: 2 }, { type: 'anim/addShot', duration: 2 }));
    const { store } = ctx;
    const id = store.get().animation.shots[1].id;
    const n = store.history().undo.length;
    store.dispatch({ type: 'anim/setShot', id, patch: { transition: { kind: 'FADE', color: 'WHITE', duration: 0.5 } }, label: 'Shot' });
    for (const d of [0.6, 0.7, 0.8]) store.dispatch({ type: 'anim/setShot', id, patch: { transition: { kind: 'FADE', color: 'WHITE', duration: d } }, gesture: 'fade-len', label: 'Shot' });
    expect(store.history().undo.length).toBe(n + 2);
    expect(store.get().animation.shots[1].transition).toEqual({ kind: 'FADE', color: 'WHITE', duration: 0.8 });
    store.undo();
    expect(store.get().animation.shots[1].transition).toEqual({ kind: 'FADE', color: 'WHITE', duration: 0.5 });
    store.undo();
    expect(store.get().animation.shots[1].transition).toBeUndefined();
  });
});

// The section view as project data (phase Q1, core/section.ts): the plane from a click and an axis, from two points
// and from numbers; the actions through the store (undo, gestures, no entry for no change); the SECTION move of a
// clip (interpolation with the timeline's easing, clips that add up, split, repeat, reverse); the plane in a project
// file (an old one opens without one); and the sentence and strings of the move in both languages.

import { describe, expect, it } from 'vitest';
import { amountUnit, canSplit, clipProgress, defaultAmount, evaluate, playheadPose, splitClip, TARGET_MOVES, type MotionClip } from '../src/core/animation';
import { cameraPosition } from '../src/core/camera';
import { allParts, isSetPiece, productBounds } from '../src/core/scene';
import { boxCenter } from '../src/core/math';
import {
  cleanSection,
  defaultSection,
  flippedSection,
  normalizeSection,
  openPartsCut,
  partIsCapped,
  partIsExempt,
  partsCutBy,
  resolveSection,
  sectionAt,
  sectionFromClick,
  sectionFromTwoPoints,
  sectionOf,
  type SectionPlane,
} from '../src/core/section';
import { createInitialState, createStore, reduce, type ProjectState } from '../src/core/store';
import { MOVE_KINDS, SCENE_MOVES } from '../src/data/animation';
import { loadProject, serializeProject } from '../src/io/project';
import { clipSentence, clipShort } from '../src/ui/sentence';
import { STRINGS } from '../src/ui/strings';
import v2Text from './fixtures/project-v2.json?raw';
import { apply, exampleState } from './helpers';

const close3 = (a: readonly number[], b: readonly number[], digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

const plane = (over: Partial<SectionPlane> = {}): SectionPlane => ({ enabled: true, point: [10, 20, 30], normal: [0, 0, 1], cap: true, ...over });

describe('a plane from a click and an axis', () => {
  const surface = [0, 0, 1] as const;

  it('goes through the clicked point, across the axis, removing the side that faces the viewer', () => {
    const point = [10, -5, 40] as const;
    for (const [axis, want] of [['X', [1, 0, 0]], ['Y', [0, 1, 0]], ['Z', [0, 0, 1]]] as const) {
      // The viewer on the positive side: the normal is the axis; on the negative side, its opposite.
      const plus = sectionFromClick(point, axis, surface, [500 * want[0] + 10, 500 * want[1] - 5, 500 * want[2] + 40])!;
      expect(plus.point).toEqual([10, -5, 40]);
      expect(plus.normal).toEqual(want);
      const minus = sectionFromClick(point, axis, surface, [-500 * want[0] + 10, -500 * want[1] - 5, -500 * want[2] + 40])!;
      expect(minus.normal).toEqual(want.map((v) => (v === 0 ? 0 : -v)));
      // (no negative zero is left in the project: the plane is saved and compared as it is)
      expect(minus.normal.some((v) => Object.is(v, -0))).toBe(false);
    }
  });

  it('across the surface takes the surface normal, unit, as the pick gave it', () => {
    const f = sectionFromClick([0, 0, 0], 'SURFACE', [0, 3, 4], [0, 100, 100])!;
    close3(f.normal, [0, 0.6, 0.8]);
    // Seen from behind, the normal turns to the viewer's side.
    const back = sectionFromClick([0, 0, 0], 'SURFACE', [0, 3, 4], [0, -100, -100])!;
    close3(back.normal, [0, -0.6, -0.8]);
  });

  it('is none for a surface without a normal or a point that is not a number', () => {
    expect(sectionFromClick([0, 0, 0], 'SURFACE', [0, 0, 0], [0, 0, 9])).toBeNull();
    expect(sectionFromClick([NaN, 0, 0], 'Z', surface, [0, 0, 9])).toBeNull();
    // An axis does not need the surface's normal.
    expect(sectionFromClick([0, 0, 0], 'Z', [0, 0, 0], [0, 0, 9])).not.toBeNull();
  });
});

describe('a plane from two points', () => {
  const forward = [0, 1, 0] as const; // looking along +Y: right is +X, up is +Z

  it('contains both points and the view direction, removing the left of the line from the first to the second', () => {
    // Drawn from left to right: what is above the line goes.
    const lr = sectionFromTwoPoints([-1, 0, 5], [1, 0, 5], forward)!;
    close3(lr.normal, [0, 0, 1]);
    expect(lr.point).toEqual([-1, 0, 5]);
    // Drawn from right to left: what is below goes.
    close3(sectionFromTwoPoints([1, 0, 5], [-1, 0, 5], forward)!.normal, [0, 0, -1]);
    // Drawn upwards: the left goes (the viewer's left is -X).
    close3(sectionFromTwoPoints([0, 0, -1], [0, 0, 1], forward)!.normal, [-1, 0, 0]);
    // Both points and the view direction lie in the plane.
    const f = sectionFromTwoPoints([3, 7, -2], [20, -4, 13], [0.3, 0.8, -0.2])!;
    const d = (p: readonly number[]) => f.normal[0] * (p[0] - f.point[0]) + f.normal[1] * (p[1] - f.point[1]) + f.normal[2] * (p[2] - f.point[2]);
    expect(d([20, -4, 13])).toBeCloseTo(0, 9);
    expect(f.normal[0] * 0.3 + f.normal[1] * 0.8 + f.normal[2] * -0.2).toBeCloseTo(0, 9);
    expect(Math.hypot(...f.normal)).toBeCloseTo(1, 12);
  });

  it('is none for the same point twice, or two points one behind the other along the view direction', () => {
    expect(sectionFromTwoPoints([1, 2, 3], [1, 2, 3], forward)).toBeNull();
    expect(sectionFromTwoPoints([0, 0, 0], [0, 40, 0], forward)).toBeNull();
    expect(sectionFromTwoPoints([0, 0, 0], [1, 0, 0], [0, 0, 0])).toBeNull();
  });
});

describe('the plane through the store', () => {
  it('a project has none; setting one is undoable and marks the project changed', () => {
    const store = createStore(exampleState());
    expect(store.get().section).toBeNull();
    store.dispatch({ type: 'section/set', plane: plane(), label: 'Section' });
    expect(store.get().section).toEqual(plane());
    expect(store.get().meta.dirty).toBe(true);
    expect(store.history().undo[0]).toBe('Section');
    store.undo();
    expect(store.get().section).toBeNull();
    store.redo();
    expect(store.get().section).toEqual(plane());
  });

  it('keeps the normal a unit vector and refuses a plane without one', () => {
    const s = apply(exampleState(), { type: 'section/set', plane: plane({ normal: [0, 0, 5] }) });
    expect(s.section!.normal).toEqual([0, 0, 1]);
    expect(reduce(s, { type: 'section/set', plane: plane({ normal: [0, 0, 0] }) })).toBe(s);
    expect(reduce(s, { type: 'section/patch', patch: { normal: [0, 0, 0] } })).toBe(s);
    expect(reduce(s, { type: 'section/patch', patch: { point: [NaN, 0, 0] } })).toBe(s);
    expect(reduce(s, { type: 'section/set', plane: plane({ point: [Infinity, 0, 0] }) })).toBe(s);
  });

  it('patches the numbers, flips the side, switches on and off, and clears', () => {
    let s = apply(exampleState(), { type: 'section/set', plane: plane() });
    s = apply(s, { type: 'section/patch', patch: { point: [1, 2, 3], normal: [1, 0, 0] } });
    expect(s.section).toEqual(plane({ point: [1, 2, 3], normal: [1, 0, 0] }));
    s = apply(s, { type: 'section/flip' });
    expect(s.section!.normal).toEqual([-1, 0, 0]);
    expect(s.section!.point).toEqual([1, 2, 3]);
    s = apply(s, { type: 'section/enable', enabled: false });
    expect(s.section!.enabled).toBe(false);
    expect(sectionAt(s)).toBeNull();
    s = apply(s, { type: 'section/patch', patch: { cap: false, enabled: true } });
    expect(sectionAt(s)).toEqual({ normal: [-1, 0, 0], distance: -1, cap: false });
    s = apply(s, { type: 'section/clear' });
    expect(s.section).toBeNull();
  });

  it('records nothing for what changes nothing, and one entry for a drag of a number', () => {
    const base = apply(exampleState(), { type: 'section/set', plane: plane() });
    expect(reduce(base, { type: 'section/set', plane: plane() })).toBe(base);
    expect(reduce(base, { type: 'section/patch', patch: { point: [10, 20, 30] } })).toBe(base);
    expect(reduce(base, { type: 'section/enable', enabled: true })).toBe(base);
    expect(reduce(exampleState(), { type: 'section/flip' }).section).toBeNull();
    expect(reduce(exampleState(), { type: 'section/clear' }).section).toBeNull();
    const store = createStore(base);
    for (const z of [31, 32, 33, 34]) store.dispatch({ type: 'section/patch', patch: { point: [10, 20, z] }, gesture: 'section-z' });
    expect(store.get().section!.point[2]).toBe(34);
    expect(store.history().undo).toHaveLength(1);
    store.undo();
    expect(store.get().section!.point[2]).toBe(30);
  });

  it('switching on with no plane makes one through the middle of the product, across the camera, capped', () => {
    const s0 = exampleState();
    const s = apply(s0, { type: 'section/enable', enabled: true });
    const p = s.section!;
    expect(p).toEqual(defaultSection(s0));
    expect(p.enabled && p.cap).toBe(true);
    close3(p.point, boxCenter(productBounds(s0, true)), 6);
    expect(p.normal[2]).toBe(0);
    expect(Math.hypot(...p.normal)).toBeCloseTo(1, 12);
    // The removed half is the one nearer the camera.
    const cam = s0.camera.cameras[s0.camera.active];
    const toCamera = cameraPosition(cam).map((v, i) => v - p.point[i]);
    expect(toCamera[0] * p.normal[0] + toCamera[1] * p.normal[1]).toBeGreaterThan(0);
    // Off without a plane stays none.
    expect(reduce(s0, { type: 'section/enable', enabled: false }).section).toBeNull();
    // An empty project still has a plane to start from.
    const empty = apply(createInitialState(), { type: 'section/enable', enabled: true });
    expect(empty.section).not.toBeNull();
    expect(Math.hypot(...empty.section!.normal)).toBeCloseTo(1, 12);
  });

  it('flipping twice is the same plane, and a flip keeps what is cut away the other half', () => {
    const p = plane({ normal: [0.6, 0, 0.8] });
    expect(flippedSection(flippedSection(p))).toEqual(p);
    // The same plane in the engine's terms: opposite normal, opposite distance.
    const a = resolveSection(p)!;
    const b = resolveSection(flippedSection(p))!;
    close3(b.normal, a.normal.map((v) => -v));
    expect(b.distance).toBeCloseTo(-a.distance, 9);
  });
});

describe('the plane in a project file', () => {
  it('is saved and opened again, switched off and flipped as it was', async () => {
    let s = exampleState();
    s = apply(s, { type: 'section/set', plane: sectionOf({ point: [1.5, -2.25, 33], normal: [0.6, 0, 0.8] }, false) }, { type: 'section/enable', enabled: false });
    const loaded = loadProject(await serializeProject(s).text()).state;
    expect(loaded.section).toEqual(s.section);
    expect(loaded.section).toEqual({ enabled: false, point: [1.5, -2.25, 33], normal: [0.6, 0, 0.8], cap: false });
  });

  it('opens a file saved before Q1 without a plane, and a file with a broken one without it', async () => {
    expect(loadProject(v2Text).state.section).toBeNull();
    const text = await serializeProject(apply(exampleState(), { type: 'section/set', plane: plane() })).text();
    const body = JSON.parse(text);
    body.state.section = { enabled: true, point: [0, 0, 0], normal: [0, 0, 0], cap: true };
    expect(loadProject(JSON.stringify(body)).state.section).toBeNull();
    body.state.section = 'cut';
    expect(loadProject(JSON.stringify(body)).state.section).toBeNull();
    delete body.state.section;
    expect(loadProject(JSON.stringify(body)).state.section).toBeNull();
  });

  it('reads a plane with the missing flags as on and capped, and normalises its normal', () => {
    expect(normalizeSection({ point: [1, 2, 3], normal: [0, 2, 0] })).toEqual({ enabled: true, point: [1, 2, 3], normal: [0, 1, 0], cap: true });
    expect(normalizeSection({ point: [1, 2], normal: [0, 1, 0] })).toBeNull();
    expect(normalizeSection(null)).toBeNull();
    expect(cleanSection({ ...plane(), normal: [NaN, 0, 1] })).toBeNull();
  });
});

describe('the plane the animation puts it in', () => {
  const clip = (over: Partial<Omit<MotionClip, 'id'>> = {}): Omit<MotionClip, 'id'> => ({ target: { kind: 'SCENE' }, move: 'SECTION', shot: null, start: 0, duration: 4, amount: -0.5, easing: 'LINEAR', ...over });
  const withPlane = (...clips: Omit<MotionClip, 'id'>[]): ProjectState => apply(exampleState(), { type: 'section/set', plane: plane() }, ...clips.map((c) => ({ type: 'anim/addClip' as const, clip: c })));

  it('is a scene move, offered for the scene, in part sizes, starting by cutting more', () => {
    // Q1 appended it after PHYSICS; N1's kinds come after it.
    expect(MOVE_KINDS.map((m) => m.key).indexOf('SECTION')).toBe(MOVE_KINDS.map((m) => m.key).indexOf('PHYSICS') + 1);
    expect(SCENE_MOVES.has('SECTION')).toBe(true);
    expect(TARGET_MOVES.SCENE.slice(0, 2)).toEqual(['HDRI', 'SECTION']);
    expect(amountUnit('SECTION')).toBe('parts');
    expect(defaultAmount('SECTION')).toBeLessThan(0);
  });

  it('moves the plane along its normal by the amount in part sizes, with the clip curve, from the start to the end', () => {
    const s = withPlane(clip());
    const size = s.scene.partSizeMm;
    expect(evaluate(s, 0).sectionOffsetMm).toBe(0);
    expect(evaluate(s, 2).sectionOffsetMm).toBeCloseTo(-0.25 * size, 9);
    expect(evaluate(s, 4).sectionOffsetMm).toBeCloseTo(-0.5 * size, 9);
    // After its end it holds, before its start it waits.
    expect(evaluate(s, 9).sectionOffsetMm).toBeCloseTo(-0.5 * size, 9);
    expect(evaluate(withPlane(clip({ start: 2 })), 1).sectionOffsetMm).toBe(0);
    // The engine's plane at that instant: the same normal, the distance moved along it.
    const at = sectionAt(s, evaluate(s, 2).sectionOffsetMm)!;
    expect(at.normal).toEqual([0, 0, 1]);
    expect(at.distance).toBeCloseTo(30 - 0.25 * size, 9);
  });

  it('follows the easing of the clip', () => {
    for (const easing of ['LINEAR', 'EASE', 'EASE_IN', 'EASE_OUT', 'EASE_STRONG'] as const) {
      const s = withPlane(clip({ easing, amount: 1, duration: 2 }));
      const c = s.animation.clips[0];
      for (const t of [0.3, 1, 1.7]) expect(evaluate(s, t).sectionOffsetMm).toBeCloseTo(s.scene.partSizeMm * clipProgress(c, t), 9);
    }
    // An ease is slower than a line at the start.
    const lin = evaluate(withPlane(clip({ amount: 1, easing: 'LINEAR' })), 1).sectionOffsetMm;
    const ease = evaluate(withPlane(clip({ amount: 1, easing: 'EASE_IN' })), 1).sectionOffsetMm;
    expect(ease).toBeLessThan(lin);
  });

  it('adds up the clips of the same plane, repeats, and plays reversed', () => {
    const s = withPlane(clip({ amount: -0.5, duration: 2 }), clip({ amount: 0.2, start: 1, duration: 2 }));
    const size = s.scene.partSizeMm;
    expect(evaluate(s, 3).sectionOffsetMm).toBeCloseTo((-0.5 + 0.2) * size, 9);
    expect(evaluate(s, 1.5).sectionOffsetMm).toBeCloseTo((-0.375 + 0.05) * size, 9);
    const rep = withPlane(clip({ amount: 1, duration: 2, repeat: 2 }));
    expect(evaluate(rep, 1).sectionOffsetMm).toBeCloseTo(0.5 * size, 9);
    expect(evaluate(rep, 3).sectionOffsetMm).toBeCloseTo(0.5 * size, 9);
    const rev = withPlane(clip({ amount: 1, duration: 2, reverse: true }));
    expect(evaluate(rev, 0).sectionOffsetMm).toBeCloseTo(size, 9);
    expect(evaluate(rev, 2).sectionOffsetMm).toBeCloseTo(0, 9);
  });

  it('is shown at the playhead (and the plane at rest when nothing plays)', () => {
    let s = withPlane(clip({ amount: 1, duration: 2 }));
    expect(playheadPose(s)).toBeNull();
    s = apply(s, { type: 'anim/playhead', t: 1 });
    expect(playheadPose(s)!.sectionOffsetMm).toBeCloseTo(0.5 * s.scene.partSizeMm, 9);
    // A clip for another thing leaves the plane where it is.
    const other = apply(withPlane(clip({ move: 'HDRI', amount: 90 })), { type: 'anim/playhead', t: 1 });
    expect(evaluate(other, 1).sectionOffsetMm).toBe(0);
  });

  it('can be cut in two without a jump, like the other moves that add up', () => {
    const s = withPlane(clip({ amount: -0.8, duration: 4, easing: 'EASE' }));
    const c = s.animation.clips[0];
    expect(canSplit(c, 2)).toBe(true);
    const [a, b] = splitClip(c, 1.5)!;
    const both = apply(s, { type: 'anim/splitClip', id: c.id, t: 1.5 });
    expect(both.animation.clips).toHaveLength(2);
    expect(a.amount + b.amount).toBeCloseTo(-0.8, 9);
    // The halves meet where the clip was, and end where it ended (each half keeps the curve in its own span).
    for (const t of [0, 1.5, 4, 9]) expect(evaluate(both, t).sectionOffsetMm).toBeCloseTo(evaluate(s, t).sectionOffsetMm, 9);
    expect(evaluate(both, 0.7).sectionOffsetMm).toBeLessThan(0);
    expect(evaluate(both, 0.7).sectionOffsetMm).toBeGreaterThan(evaluate(both, 1.5).sectionOffsetMm);
  });

  it('is nothing to the engines without a plane or with it off', () => {
    const none = apply(exampleState(), { type: 'anim/addClip', clip: clip() });
    expect(sectionAt(none, evaluate(none, 2).sectionOffsetMm)).toBeNull();
    const off = apply(withPlane(clip()), { type: 'section/enable', enabled: false });
    expect(sectionAt(off, evaluate(off, 2).sectionOffsetMm)).toBeNull();
  });
});

describe('the move in words', () => {
  const s = apply(exampleState(), { type: 'section/set', plane: plane() }, { type: 'anim/addClip', clip: { target: { kind: 'SCENE' }, move: 'SECTION', shot: null, start: 0, duration: 4, amount: -0.5, easing: 'EASE' } });
  const c = s.animation.clips[0];

  it('says what the plane does, in both languages, not "the environment"', () => {
    const en = clipSentence(s, c, 'en');
    const es = clipSentence(s, c, 'es');
    expect(en).toMatch(/section/i);
    expect(en).not.toMatch(/environment/i);
    expect(es).toMatch(/secci[oó]n/i);
    expect(es).not.toMatch(/entorno/i);
    expect(clipShort(c, 'en')).toMatch(/section|cuts|cut/i);
  });

  it('has its catalogue words and every string of the move in es and en', () => {
    const move = MOVE_KINDS.find((m) => m.key === 'SECTION')!;
    for (const l of ['es', 'en'] as const) {
      expect(move.label[l].length).toBeGreaterThan(0);
      expect(move.description[l].length).toBeGreaterThan(0);
      expect(move.amountLabel![l].length).toBeGreaterThan(0);
    }
    for (const key of Object.keys(STRINGS.en).filter((k) => k.startsWith('say.SECTION'))) expect(STRINGS.es[key as keyof typeof STRINGS.es], key).toBeTruthy();
  });
});

describe('the studio around the product', () => {
  const studio = (state: ProjectState) => allParts(state).filter((id) => isSetPiece(state.scene.nodes[id]));
  const model = (state: ProjectState) => allParts(state).filter((id) => !isSetPiece(state.scene.nodes[id]));
  const withSet = () => reduce(exampleState(), { type: 'studio/setSetup', key: 'HIGH_KEY_WHITE' });

  it('is the pieces of a set: the backdrop and the floor are exempt, the parts of the model are not', () => {
    const s = withSet();
    expect(studio(s).length).toBeGreaterThanOrEqual(2);
    for (const id of studio(s)) expect(partIsExempt(s, id), s.scene.nodes[id].name).toBe(true);
    for (const id of model(s)) expect(partIsExempt(s, id), s.scene.nodes[id].name).toBe(false);
    // No cap for the studio, whatever its mesh is.
    for (const id of studio(s)) expect(partIsCapped(s, id)).toBe(false);
  });

  it('is never among the parts a plane cuts, nor among the open meshes the inspector warns about', () => {
    const s = withSet();
    // A plane through the middle of everything: the model is cut, the backdrop and the floor are not.
    const p = defaultSection(s);
    const cut = partsCutBy(s, p);
    expect(cut.length).toBeGreaterThan(0);
    for (const id of studio(s)) expect(cut).not.toContain(id);
    for (const id of openPartsCut(s, p)) expect(partIsExempt(s, id)).toBe(false);
    // The same plane on a project without a set cuts the same parts of the model.
    expect(partsCutBy(exampleState(), p).length).toBe(cut.length);
  });
});

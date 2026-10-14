// The animation timeline (phase N6, UI.md §2.5): the magnet's arithmetic, the rows of the tree, and the tree, the
// scene's selection and the viewport in step (at the level of the stores: the commands the drawer calls).

import { describe, expect, it } from 'vitest';
import type { MotionClip } from '../src/core/animation';
import { motionHint } from '../src/core/motion-hint';
import { newExplode } from '../src/core/explode';
import { createStore, type ProjectState } from '../src/core/store';
import { dragBars, resizeBar, rulerTicks, snapTargets, snapTime, timelineRows, toFrame, type SnapOptions } from '../src/core/timeline';
import * as anim from '../src/ui/anim-commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { clipHeader, clipShort } from '../src/ui/sentence';
import { createUiStore } from '../src/ui/ui-state';
import { apply, exampleState, keyIds } from './helpers';

type Clip = Omit<MotionClip, 'id'>;
const spin: Clip = { target: { kind: 'SUBJECT' }, move: 'SPIN', shot: null, start: 0, duration: 2, amount: 360, easing: 'LINEAR' };

function withClips(s: ProjectState, ...clips: Clip[]): ProjectState {
  return clips.reduce((st, clip) => apply(st, { type: 'anim/addClip', clip }), s);
}

function ctxOf(state: ProjectState): Ctx {
  return { store: createStore(state), ui: createUiStore(), services: {} as AppServices };
}

const opts = (targets: number[], over: Partial<SnapOptions> = {}): SnapOptions => ({ targets, threshold: 0.1, fps: 24, ...over });

describe('the magnet', () => {
  it('a time near a target goes to it, the nearest of two; otherwise to its frame', () => {
    expect(snapTime(2.04, opts([2, 3]))).toEqual({ t: 2, hit: 2 });
    expect(snapTime(2.96, opts([2, 3]))).toEqual({ t: 3, hit: 3 });
    expect(snapTime(2.06, opts([2, 2.1]))).toEqual({ t: 2.1, hit: 2.1 });
    const free = snapTime(2.03, opts([2], { free: true }));
    expect(free.hit).toBeNull();
    expect(free.t).toBeCloseTo(toFrame(2.03, 24), 12);
    expect(snapTime(2.5, opts([2, 3])).t).toBeCloseTo(Math.round(2.5 * 24) / 24, 12);
    expect(toFrame(1.01, 25)).toBeCloseTo(1, 12);
  });

  it('draws to the edges of the other bars, the playhead and the whole seconds, never to the bars that move', () => {
    const s = withClips(exampleState(), { ...spin, start: 0.5, duration: 1.2 }, { ...spin, start: 3.3, duration: 0.4, repeat: 2 });
    const [a, b] = s.animation.clips;
    const all = snapTargets(s, new Set(), 1.7);
    for (const x of [0.5, 1.7, 3.3, 4.1, 0, 1, 2, 3, 4]) expect(all.map((v) => Math.round(v * 1e9) / 1e9)).toContain(x);
    const moving = snapTargets(s, new Set([a.id]), 1.7);
    expect(moving).not.toContain(0.5);
    expect(moving).toContain(b.start);
  });

  it('a dragged bar takes the edge nearest to a target: its start or its end', () => {
    const bar = { id: 'c1', start: 1, duration: 2 };
    // Start 1 + 0.97 = 1.97: within the threshold of 2.
    expect(dragBars([bar], 0.97, opts([2, 10])).starts.c1).toBeCloseTo(2, 12);
    // End 3 + 1.04 = 4.04: its end goes to 4, so its start to 2.
    const r = dragBars([bar], 1.04, opts([4, 10]));
    expect(r.hit).toBe(4);
    expect(r.starts.c1).toBeCloseTo(2, 12);
    // Exactly on the target, whatever the pointer's fraction of a pixel (the browser check reads the start back).
    for (const dt of [0.99, 0.993, 0.9871, 0.97 + 0.0291, 1.017]) expect(dragBars([{ id: 'c1', start: 0, duration: 3 }], dt, opts([1])).starts.c1).toBe(1);
    // Nothing near: the start lands on a frame.
    const f = dragBars([bar], 0.513, opts([10]));
    expect(f.hit).toBeNull();
    expect(f.starts.c1 * 24).toBeCloseTo(Math.round(f.starts.c1 * 24), 9);
  });

  it('bars dragged together keep their spacing, and none goes before 0', () => {
    const bars = [
      { id: 'a', start: 1, duration: 1 },
      { id: 'b', start: 2.5, duration: 0.5 },
    ];
    const r = dragBars(bars, 0.49, opts([1.5]));
    expect(r.starts.a).toBeCloseTo(1.5, 12);
    expect(r.starts.b - r.starts.a).toBeCloseTo(1.5, 12);
    const back = dragBars(bars, -5, opts([]));
    expect(back.starts.a).toBe(0);
    expect(back.starts.b).toBeCloseTo(1.5, 12);
  });

  it('stretching an end keeps the other end; repeats share the length; never shorter than the minimum', () => {
    const bar = { id: 'c1', start: 1, duration: 2 };
    expect(resizeBar(bar, 'end', 4.05, opts([4]))).toEqual({ start: 1, duration: 3, hit: 4 });
    const st = resizeBar(bar, 'start', 0.47, opts([0.5]));
    expect(st.start).toBe(0.5);
    expect(st.duration).toBeCloseTo(2.5, 12);
    const rep = resizeBar({ ...bar, repeat: 2 }, 'end', 7, opts([7]));
    expect(rep.duration).toBeCloseTo(3, 12);
    expect(resizeBar(bar, 'end', 0, opts([])).duration).toBeCloseTo(0.05, 12);
    expect(resizeBar(bar, 'start', 9, opts([])).start).toBeCloseTo(2.95, 12);
  });

  it('a drag of a bar is one undo entry', () => {
    const ctx = ctxOf(withClips(exampleState(), spin));
    const id = ctx.store.get().animation.clips[0].id;
    for (const start of [0.2, 0.6, 1.1]) ctx.store.dispatch({ type: 'anim/setClipTimes', times: { [id]: { start } }, gesture: 'drag1', label: 'Move' });
    expect(ctx.store.get().animation.clips[0].start).toBe(1.1);
    ctx.store.undo();
    expect(ctx.store.get().animation.clips[0].start).toBe(0);
  });

  it('the ruler labels round seconds far enough apart', () => {
    for (const px of [8, 40, 120, 400]) {
      const { major, step } = rulerTicks(12, px);
      expect(step * px).toBeGreaterThanOrEqual(56);
      for (const m of major) expect(Math.abs(m / step - Math.round(m / step))).toBeLessThan(1e-9);
      expect(major[0]).toBe(0);
    }
  });
});

describe('the rows of the tree', () => {
  it('the camera track first, then the model, its nodes in tree order, the lights and the environment; folded hides clips', () => {
    let s = exampleState();
    const ids = keyIds(s);
    const light = s.studio.lights[0].id;
    s = withClips(
      s,
      { ...spin, target: { kind: 'SCENE' }, move: 'HDRI' },
      { ...spin, target: { kind: 'LIGHT', id: light }, move: 'INTENSITY', amount: 10 },
      { ...spin, target: { kind: 'NODE', id: ids.cap } },
      { ...spin, target: { kind: 'NODE', id: ids.base } },
      spin,
    );
    const rows = timelineRows(s);
    expect(rows.filter((r) => r.kind === 'TARGET').map((r) => r.key)).toEqual(['CAMERA', 'SUBJECT', `NODE:${ids.base}`, `NODE:${ids.cap}`, `LIGHT:${light}`, 'SCENE']);
    expect(rows).toHaveLength(6 + 5);
    const folded = timelineRows(s, { SUBJECT: true });
    expect(folded).toHaveLength(6 + 4);
    expect(folded.find((r) => r.kind === 'TARGET' && r.key === 'SUBJECT')).toMatchObject({ folded: true, clips: [s.animation.clips[4].id] });
  });

  it('a kind the tree does not know is drawn like any other: its sentence and its target', () => {
    const s = withClips(exampleState(), { ...spin, move: 'PHYSICS' as MotionClip['move'] });
    const rows = timelineRows(s);
    expect(rows.map((r) => r.kind)).toEqual(['TARGET', 'TARGET', 'CLIP']);
    expect(clipShort(s.animation.clips[0], 'en')).toContain('2 s');
  });

  it('the header says what, how, how far and when', () => {
    let s = exampleState();
    const ids = keyIds(s);
    s = withClips(s, { ...spin, target: { kind: 'NODE', id: ids.closure }, move: 'EXPLODE', amount: 1.5, duration: 3, explode: newExplode() });
    expect(clipHeader(s, s.animation.clips[0], 'en')).toBe('closure · Spherical exploded view · 1.5 × size · 0–3 s');
    expect(clipHeader(s, s.animation.clips[0], 'es')).toBe('closure · Despiece esférico · 1,5 × tamaño · 0–3 s');
    expect(clipShort(s.animation.clips[0], 'es')).toBe('se despieza desde su centro 1,5 × tamaño · 3 s · lineal');
  });
});

describe('tree, scene and viewport in step', () => {
  function closureScene() {
    let s = exampleState();
    const ids = keyIds(s);
    s = withClips(
      s,
      { ...spin, target: { kind: 'NODE', id: ids.closure }, move: 'EXPLODE', amount: 0.5, explode: { ...newExplode(), pinned: [ids.collar] } },
      spin,
      { ...spin, target: { kind: 'LIGHT', id: s.studio.lights[0].id }, move: 'INTENSITY', amount: 10 },
    );
    return { ctx: ctxOf(s), ids, clips: s.animation.clips.map((c) => c.id) };
  }

  it('selecting a clip outlines its target in the viewport (an explode without its exceptions) and draws its track', () => {
    const { ctx, ids, clips } = closureScene();
    anim.selectClips(ctx, [clips[0]]);
    expect(ctx.ui.get().selectedClip).toBe(clips[0]);
    const hint = anim.hintFor(ctx)!;
    expect(hint.highlight).toEqual([ids.cap]);
    // One mover (the cap): its vector and the two strokes of its arrowhead, two points each.
    expect(hint.lines).toHaveLength(6);
    expect(hint.dots).toHaveLength(1);
    // Two clips: both targets outlined, the primary's track drawn.
    anim.selectClips(ctx, [clips[0], clips[1]], clips[1]);
    const both = anim.hintFor(ctx)!;
    expect(new Set(both.highlight)).toEqual(new Set(Object.values(ids).filter((id) => ctx.store.get().scene.nodes[id].kind === 'PART')));
    anim.clearClips(ctx);
    expect(anim.hintFor(ctx)).toBeNull();
  });

  it('selecting a part in the scene marks the rows of what moves it', () => {
    const { ctx, ids, clips } = closureScene();
    ctx.store.dispatch({ type: 'scene/select', ids: [ids.cap], mode: 'set' });
    expect(anim.relatedClips(ctx.store.get())).toEqual(new Set([clips[0], clips[1]]));
    // The collar is an exception of the explode: only the spin moves it.
    ctx.store.dispatch({ type: 'scene/select', ids: [ids.collar], mode: 'set' });
    expect(anim.relatedClips(ctx.store.get())).toEqual(new Set([clips[1]]));
    ctx.store.dispatch({ type: 'scene/select', ids: [ctx.store.get().studio.lights[0].id], mode: 'set' });
    expect(anim.relatedClips(ctx.store.get())).toEqual(new Set([clips[2]]));
  });

  it("a target's row selects the target in the scene and its clips", () => {
    const { ctx, ids, clips } = closureScene();
    anim.selectTargetRow(ctx, { kind: 'NODE', id: ids.closure });
    expect(ctx.store.get().selection.ids).toEqual([ids.closure]);
    expect(ctx.store.get().selection.level).toBe('GROUP');
    expect(anim.selectedClipIds(ctx)).toEqual([clips[0]]);
    anim.selectTargetRow(ctx, { kind: 'SUBJECT' });
    expect(ctx.store.get().selection.ids).toEqual(ctx.store.get().scene.roots);
    expect(anim.selectedClipIds(ctx)).toEqual([clips[1]]);
  });

  it('"+ Animate…" takes the selection as its target; an explode starts with its parameters and is selected', () => {
    const { ctx, ids } = closureScene();
    expect(anim.animateTarget(ctx.store.get())).toEqual({ kind: 'SUBJECT' });
    ctx.store.dispatch({ type: 'scene/select', ids: [ids.cap], mode: 'set' });
    expect(anim.animateTarget(ctx.store.get())).toEqual({ kind: 'NODE', id: ids.cap });
    expect(anim.animateTargetName(ctx.store.get())).toBe('cap');
    ctx.store.dispatch({ type: 'scene/select', ids: [ids.model], mode: 'set', level: 'MODEL' });
    expect(anim.animateTarget(ctx.store.get())).toEqual({ kind: 'SUBJECT' });
    anim.openWizard(ctx, { kind: 'NODE', id: ids.closure });
    ctx.ui.set({ wizard: { ...ctx.ui.get().wizard!, move: 'EXPLODE', amount: 0.8 } });
    const id = anim.finishWizard(ctx)!;
    const clip = ctx.store.get().animation.clips.find((c) => c.id === id)!;
    expect(clip.explode).toEqual(newExplode());
    expect(ctx.ui.get().selectedClip).toBe(id);
    expect(ctx.ui.get().wizard).toBeNull();
    // A part cannot be exploded on its own; a group or the model can.
    expect(anim.canExplode(ctx.store.get(), { kind: 'NODE', id: ids.cap })).toBe(false);
    expect(anim.canExplode(ctx.store.get(), { kind: 'NODE', id: ids.closure })).toBe(true);
  });

  it('duplicate, delete, reverse and split act on the selected clips, each one undo entry', () => {
    const { ctx, clips } = closureScene();
    anim.selectClips(ctx, [clips[1]]);
    const copies = anim.duplicateClips(ctx);
    expect(copies).toHaveLength(1);
    const copy = ctx.store.get().animation.clips.find((c) => c.id === copies[0])!;
    expect(copy.start).toBe(2);
    expect(anim.selectedClipIds(ctx)).toEqual(copies);
    anim.reverseClips(ctx);
    expect(ctx.store.get().animation.clips.find((c) => c.id === copies[0])!.reverse).toBe(true);
    ctx.store.dispatch({ type: 'anim/playhead', t: 3 });
    expect(anim.canSplitAtPlayhead(ctx, copies[0])).toBe(false);
    expect(anim.canSplitAtPlayhead(ctx, clips[1])).toBe(false);
    ctx.store.dispatch({ type: 'anim/playhead', t: 1 });
    anim.splitAtPlayhead(ctx, clips[1]);
    expect(ctx.store.get().animation.clips).toHaveLength(5);
    anim.deleteClips(ctx);
    expect(ctx.store.get().animation.clips).toHaveLength(4);
    for (let i = 0; i < 4; i++) ctx.store.undo();
    expect(ctx.store.get().animation.clips.map((c) => c.id)).toEqual(clips);
  });

  it('the context menu pins the selection in the explodes that hold it, and frees it the second time', () => {
    const { ctx, ids, clips } = closureScene();
    expect(anim.pinState(ctx.store.get(), [ids.base])).toBeNull();
    expect(anim.pinState(ctx.store.get(), [ids.cap])).toMatchObject({ pinned: false });
    anim.togglePin(ctx, [ids.cap]);
    expect(ctx.store.get().animation.clips[0].explode!.pinned!.sort()).toEqual([ids.collar, ids.cap].sort());
    expect(anim.pinState(ctx.store.get(), [ids.cap])).toMatchObject({ pinned: true });
    anim.togglePin(ctx, [ids.cap]);
    expect(ctx.store.get().animation.clips[0].explode!.pinned).toEqual([ids.collar]);
    void clips;
  });

  it('the keys: Space, Home, End, the arrows (Shift: ten frames), Delete, Ctrl D', () => {
    const { ctx, clips } = closureScene();
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) => anim.animKey(ctx, { key: k, code: k === 'd' ? 'KeyD' : k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, ...mods } as unknown as KeyboardEvent);
    expect(key('ArrowRight')).toBe(true);
    expect(ctx.store.get().animation.playhead).toBeCloseTo(1 / 24, 12);
    key('ArrowRight', { shiftKey: true });
    expect(ctx.store.get().animation.playhead).toBeCloseTo(11 / 24, 12);
    key('End');
    expect(ctx.store.get().animation.playhead).toBe(2);
    key('Home');
    expect(ctx.store.get().animation.playhead).toBe(0);
    key(' ');
    expect(ctx.store.get().animation.playing).toBe(true);
    key(' ');
    expect(ctx.store.get().animation.playing).toBe(false);
    expect(key('Delete')).toBe(false);
    anim.selectClips(ctx, [clips[2]]);
    expect(key('d', { ctrlKey: true })).toBe(true);
    expect(ctx.store.get().animation.clips).toHaveLength(4);
    expect(key('Delete')).toBe(true);
    expect(ctx.store.get().animation.clips).toHaveLength(3);
  });
});

describe('the track in the viewport', () => {
  it('an orbit draws an arc and the spot of the camera; a spin its axis; an unknown kind only its target', () => {
    let s = exampleState();
    s = withClips(s, { ...spin, target: { kind: 'CAMERA' }, move: 'ORBIT', amount: 90 }, spin, { ...spin, move: 'PHYSICS' as MotionClip['move'] });
    const [orbit, turn, other] = s.animation.clips;
    const o = motionHint(s, [orbit.id], orbit.id, 1)!;
    expect(o.highlight).toEqual([]);
    expect(o.lines.length).toBeGreaterThan(20);
    expect(o.dots).toHaveLength(1);
    expect(motionHint(s, [turn.id], turn.id, 1)!.lines.length).toBeGreaterThan(20);
    const u = motionHint(s, [other.id], other.id, 1)!;
    expect(u.highlight.length).toBeGreaterThan(0);
    expect(u.lines).toEqual([]);
  });
});

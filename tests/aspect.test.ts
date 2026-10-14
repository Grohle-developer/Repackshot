// U13: the aspect ratio of the image lives in the camera. Its data and helpers, the camera that carries it, the
// render window's size that follows the active camera (and rewrites it when a size breaks it), the viewport's frame,
// the animation's own size and the Doctor, the camera that saves, opens and copies it. Every test of behaviour here was
// checked by putting back the fault it guards (the lines are in the phase's report).

import { describe, expect, it } from 'vitest';
import { ASPECT_CUSTOM_LABEL, ASPECT_KEYS, ASPECT_PRESETS, aspectLabel } from '../src/data/aspects';
import { RESOLUTION_PRESETS } from '../src/data/quality';
import { aspectNearPixels, aspectText, customAspect, DEFAULT_ASPECT, MAX_ASPECT_RATIO, normaliseAspect, presetAspect } from '../src/core/aspect';
import { activeCamera, aspectRatio, cameraFrameRect, outputAspect } from '../src/core/camera';
import { runDoctor } from '../src/core/doctor';
import { emptyLibrary, fromCurrentStudio } from '../src/core/library';
import { snapshotStudio } from '../src/core/lighting';
import { aspectForSize, settingsOf, sizeForHeight, sizeForWidth } from '../src/core/render';
import { createInitialState, createStore, type ProjectState } from '../src/core/store';
import { glyphsOf, viewedCamera } from '../src/core/view-objects';
import { validateItem } from '../src/io/library';
import { parseProject, serializeProject } from '../src/io/project';
import { cameraMenuEntries } from '../src/ui/camera-menu';
import { doctorSentence } from '../src/ui/panels/status';
import * as cmd from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang, STRINGS } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { apply, exampleState, withoutCameraAspects } from './helpers';

const size = (s: ProjectState) => [s.render.width, s.render.height];
const setAspect = (s: ProjectState, key: string, id = s.camera.active) => apply(s, { type: 'camera/set', id, patch: { aspect: presetAspect(key)! } });
/** A project with a second camera that looks the same, 4:3, with the first active (Camera 1 is 16:9). */
function twoCameras(): ProjectState {
  let s = apply(exampleState(), { type: 'camera/add', name: 'Second' });
  const second = s.camera.active;
  s = setAspect(s, '4:3', second);
  return apply(s, { type: 'camera/activate', id: 'cam1' });
}

describe('the aspect ratios of the camera (data)', () => {
  it('keys are stable: the ten presets and CUSTOM, each key is its own w:h, with a label in both languages', () => {
    expect(ASPECT_KEYS).toEqual(['3:2', '4:3', '16:9', '1:1', '5:4', '4:5', '9:16', '21:9', '2:1', '65:24', 'CUSTOM']);
    expect(ASPECT_PRESETS).toHaveLength(10);
    for (const p of ASPECT_PRESETS) {
      expect(`${p.w}:${p.h}`).toBe(p.key);
      expect(p.label.es.startsWith(p.key)).toBe(true);
      expect(p.label.en.startsWith(p.key)).toBe(true);
      expect(aspectLabel(p.key)).toBe(p.label);
    }
    expect(aspectLabel('CUSTOM')).toBe(ASPECT_CUSTOM_LABEL);
    expect(ASPECT_CUSTOM_LABEL).toEqual({ es: 'Propia', en: 'Custom' });
  });

  it('a new camera is 16:9, as the project always rendered (1920 × 1080)', () => {
    const s = createInitialState();
    expect(activeCamera(s).aspect).toEqual({ preset: '16:9', w: 16, h: 9 });
    expect(DEFAULT_ASPECT).toEqual({ preset: '16:9', w: 16, h: 9 });
    expect(size(s)).toEqual([1920, 1080]);
    expect(outputAspect(s)).toBe(16 / 9);
  });
});

describe('helpers of the aspect', () => {
  it('reads anything that looks like an aspect and falls back on the rest', () => {
    expect(normaliseAspect({ preset: '4:3', w: 999, h: 1 })).toEqual({ preset: '4:3', w: 4, h: 3 });
    expect(normaliseAspect({ preset: 'CUSTOM', w: 2.39, h: 1 })).toEqual({ preset: 'CUSTOM', w: 2.39, h: 1 });
    // A key nobody knows, with terms: a custom ratio. Without usable terms: the fallback.
    expect(normaliseAspect({ preset: 'WIDE', w: 7, h: 3 })).toEqual({ preset: 'CUSTOM', w: 7, h: 3 });
    expect(normaliseAspect({ preset: 'CUSTOM', w: 0, h: 3 }, presetAspect('1:1')!)).toEqual({ preset: '1:1', w: 1, h: 1 });
    expect(normaliseAspect({ preset: 'CUSTOM', w: -2, h: 3 })).toEqual(DEFAULT_ASPECT);
    expect(normaliseAspect({ preset: 'CUSTOM', w: Number.NaN, h: 3 })).toEqual(DEFAULT_ASPECT);
    expect(normaliseAspect(null)).toEqual(DEFAULT_ASPECT);
    expect(normaliseAspect('16:9')).toEqual(DEFAULT_ASPECT);
    expect(normaliseAspect([1, 2])).toEqual(DEFAULT_ASPECT);
  });

  it('keeps a custom ratio within what the render window can size (8192 × 16 and 16 × 8192)', () => {
    const wide = customAspect(100000, 1)!;
    expect(wide.w / wide.h).toBeLessThanOrEqual(MAX_ASPECT_RATIO + 1e-9);
    expect(sizeForWidth(8192, wide.w / wide.h).height).toBe(16);
    const tall = customAspect(1, 100000)!;
    expect(sizeForHeight(8192, tall.w / tall.h).width).toBe(16);
    expect(customAspect(0, 3)).toBeNull();
    expect(customAspect(3, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('writes the ratio short: 4:3, 2.39:1, 1:1.25', () => {
    expect(aspectText({ w: 4, h: 3 })).toBe('4:3');
    expect(aspectText({ w: 65, h: 24 })).toBe('65:24');
    expect(aspectText({ w: 2.39, h: 1 })).toBe('2.39:1');
    expect(aspectText({ w: 3508, h: 2480 })).toBe('1.41:1');
    expect(aspectText({ w: 4, h: 5 })).toBe('4:5');
    expect(aspectText({ w: 1, h: 1.25 })).toBe('1:1.25');
  });

  it('sizes keep the width and take the height from the ratio, within the limits', () => {
    expect(sizeForWidth(1000, 4 / 3)).toEqual({ width: 1000, height: 750 });
    expect(sizeForWidth(1001, 4 / 3)).toEqual({ width: 1001, height: 751 });
    expect(sizeForHeight(900, 4 / 3)).toEqual({ width: 1200, height: 900 });
    // A height that would leave the limits stops at the limit: the width is the one thing that is kept.
    expect(sizeForWidth(16, 2)).toEqual({ width: 16, height: 16 });
    expect(sizeForWidth(8192, 0.5)).toEqual({ width: 8192, height: 8192 });
    expect(sizeForHeight(8192, 2)).toEqual({ width: 8192, height: 8192 });
    expect(sizeForWidth(99999, 1)).toEqual({ width: 8192, height: 8192 });
  });

  it('a ratio on its way through an extreme does not cost the width (typing the terms of a custom ratio one by one)', () => {
    let s = apply(exampleState(), { type: 'render/set', patch: { width: 1000 } });
    s = apply(s, { type: 'camera/set', id: 'cam1', patch: { aspect: { preset: 'CUSTOM', w: 1000, h: 700 } } });
    expect(size(s)).toEqual([1000, 700]);
    // Typing the width term first: 3 : 700 is a sliver, as tall as the window allows, and the width stays.
    s = apply(s, { type: 'camera/set', id: 'cam1', patch: { aspect: { preset: 'CUSTOM', w: 3, h: 700 } } });
    expect(size(s)).toEqual([1000, 8192]);
    s = apply(s, { type: 'camera/set', id: 'cam1', patch: { aspect: { preset: 'CUSTOM', w: 3, h: 2 } } });
    expect(size(s)).toEqual([1000, 667]);
  });

  it('a size at the limits is not taken for the preset it clamps to (16 × 16 is square, not 3:2)', () => {
    expect(aspectForSize(16, 16).preset).toBe('1:1');
    expect(aspectForSize(16, 8192).preset).toBe('CUSTOM');
    expect(aspectForSize(8192, 16)).toEqual({ preset: 'CUSTOM', w: 8192, h: 16 });
  });
});

describe('the aspect of a camera sets the size of the image', () => {
  it('a camera with another ratio changes the render height (the width stays) and the frame of the viewport; one undo gives both back', () => {
    const store = createStore(exampleState());
    expect(size(store.get())).toEqual([1920, 1080]);
    const frame16 = cameraFrameRect(activeCamera(store.get()), 1000, 800);
    expect(frame16.width / frame16.height).toBeCloseTo(16 / 9, 9);
    store.dispatch({ type: 'camera/set', id: 'cam1', patch: { aspect: presetAspect('4:3')! } });
    const s = store.get();
    expect(size(s)).toEqual([1920, 1440]);
    expect(s.render.aspect).toBe(4 / 3);
    expect(outputAspect(s)).toBe(4 / 3);
    const frame43 = cameraFrameRect(activeCamera(s), 1000, 800);
    expect(frame43.width / frame43.height).toBeCloseTo(4 / 3, 9);
    expect(frame43.height).toBeGreaterThan(frame16.height);
    // One action, one undo entry: the camera and the size come back together.
    store.undo();
    expect(activeCamera(store.get()).aspect).toEqual(DEFAULT_ASPECT);
    expect(size(store.get())).toEqual([1920, 1080]);
    store.redo();
    expect(size(store.get())).toEqual([1920, 1440]);
  });

  it('portrait and panoramic ratios, with the width kept', () => {
    let s = exampleState();
    s = apply(s, { type: 'render/set', patch: { width: 1080 } });
    expect(size(s)).toEqual([1080, 608]);
    s = setAspect(s, '4:5');
    expect(size(s)).toEqual([1080, 1350]);
    s = setAspect(s, '9:16');
    expect(size(s)).toEqual([1080, 1920]);
    s = setAspect(s, '65:24');
    expect(size(s)).toEqual([1080, 399]);
  });

  it('a custom ratio typed in the camera: CUSTOM with its w:h, a number that cannot be one is kept out', () => {
    let s = apply(exampleState(), { type: 'camera/set', id: 'cam1', patch: { aspect: { preset: 'CUSTOM', w: 2.39, h: 1 } } });
    expect(activeCamera(s).aspect).toEqual({ preset: 'CUSTOM', w: 2.39, h: 1 });
    expect(size(s)).toEqual([1920, 803]);
    s = apply(s, { type: 'camera/set', id: 'cam1', patch: { aspect: { preset: 'CUSTOM', w: 0, h: 1 } } });
    expect(activeCamera(s).aspect).toEqual({ preset: 'CUSTOM', w: 2.39, h: 1 });
    // A preset key brings its own terms, whatever came with it.
    s = apply(s, { type: 'camera/set', id: 'cam1', patch: { aspect: { preset: '1:1', w: 5, h: 9 } } });
    expect(activeCamera(s).aspect).toEqual({ preset: '1:1', w: 1, h: 1 });
    expect(size(s)).toEqual([1920, 1920]);
  });

  it('with the lock closed (the default) one side typed keeps the camera ratio: the other follows, the camera is not touched', () => {
    let s = exampleState();
    expect(s.render.aspectLock).toBe(true);
    s = apply(s, { type: 'render/set', patch: { width: 1000 } });
    expect(size(s)).toEqual([1000, 563]);
    s = apply(s, { type: 'render/set', patch: { height: 900 } });
    expect(size(s)).toEqual([1600, 900]);
    expect(activeCamera(s).aspect).toEqual(DEFAULT_ASPECT);
    s = setAspect(s, '1:1');
    s = apply(s, { type: 'render/set', patch: { width: 640 } });
    expect(size(s)).toEqual([640, 640]);
  });

  it('typing both sides with the lock open leaves CUSTOM on the camera with that w:h, in one undo entry', () => {
    const store = createStore(exampleState());
    store.dispatch({ type: 'render/set', patch: { aspectLock: false } });
    store.dispatch({ type: 'render/set', patch: { width: 1000, height: 700 } });
    const s = store.get();
    expect(activeCamera(s).aspect).toEqual({ preset: 'CUSTOM', w: 1000, h: 700 });
    expect(size(s)).toEqual([1000, 700]);
    expect(s.render.aspect).toBe(1000 / 700);
    store.undo();
    expect(activeCamera(store.get()).aspect).toEqual(DEFAULT_ASPECT);
    expect(size(store.get())).toEqual([1920, 1080]);
  });

  it('with the lock open one side typed breaks the ratio: the other side stays and the camera takes the new ratio', () => {
    let s = apply(exampleState(), { type: 'render/set', patch: { aspectLock: false } });
    s = apply(s, { type: 'render/set', patch: { height: 1000 } });
    expect(size(s)).toEqual([1920, 1000]);
    expect(activeCamera(s).aspect).toEqual({ preset: 'CUSTOM', w: 1920, h: 1000 });
    // Typed back to a size that is a preset exactly, the camera is that preset again.
    s = apply(s, { type: 'render/set', patch: { height: 1440 } });
    expect(activeCamera(s).aspect).toEqual({ preset: '4:3', w: 4, h: 3 });
    // A size that already is the camera's ratio leaves the camera as it is (a custom 4:3 stays custom).
    s = apply(s, { type: 'camera/set', id: 'cam1', patch: { aspect: { preset: 'CUSTOM', w: 4, h: 3 } } });
    s = apply(s, { type: 'render/set', patch: { width: 1200, height: 900 } });
    expect(activeCamera(s).aspect).toEqual({ preset: 'CUSTOM', w: 4, h: 3 });
  });

  it('both sides at once (a size preset) are the ratio, whatever the lock says', () => {
    let s = exampleState();
    expect(s.render.aspectLock).toBe(true);
    for (const [key, aspect] of [['PORTRAIT', '4:5'], ['SQUARE', '1:1'], ['UHD', '16:9'], ['HD', '16:9']] as const) {
      const r = RESOLUTION_PRESETS.find((x) => x.key === key)!;
      s = apply(s, { type: 'render/set', patch: { width: r.width, height: r.height } });
      expect(size(s)).toEqual([r.width, r.height]);
      expect(activeCamera(s).aspect.preset).toBe(aspect);
    }
    // A4 at 300 dpi is not one of the list: a custom ratio with those pixels.
    const a4 = RESOLUTION_PRESETS.find((x) => x.key === 'PRINT')!;
    s = apply(s, { type: 'render/set', patch: { width: a4.width, height: a4.height } });
    expect(activeCamera(s).aspect).toEqual({ preset: 'CUSTOM', w: a4.width, h: a4.height });
    expect(size(s)).toEqual([a4.width, a4.height]);
  });

  it('a size that is almost a preset is kept as typed, with a custom ratio (never changed behind the back)', () => {
    const s = apply(exampleState(), { type: 'render/set', patch: { width: 1920, height: 1081 } });
    expect(size(s)).toEqual([1920, 1081]);
    expect(activeCamera(s).aspect).toEqual({ preset: 'CUSTOM', w: 1920, h: 1081 });
    expect(aspectForSize(1920, 1080)).toEqual({ preset: '16:9', w: 16, h: 9 });
    expect(aspectForSize(1080, 1350).preset).toBe('4:5');
    expect(aspectForSize(1500, 1000).preset).toBe('3:2');
    expect(aspectForSize(16, 16).preset).toBe('1:1');
  });

  it('the extremes the window allows are ratios a camera holds (8192 × 16)', () => {
    const s = apply(exampleState(), { type: 'render/set', patch: { width: 99999, height: 3 } });
    expect(size(s)).toEqual([8192, 16]);
    expect(aspectRatio(activeCamera(s))).toBe(512);
  });
});

describe('each camera has its ratio', () => {
  it('the size follows the active camera and each camera keeps its own', () => {
    let s = twoCameras();
    const [first, second] = Object.keys(s.camera.cameras);
    expect(s.camera.active).toBe(first);
    expect(size(s)).toEqual([1920, 1080]);
    s = apply(s, { type: 'camera/activate', id: second });
    expect(size(s)).toEqual([1920, 1440]);
    expect(s.camera.cameras[first].aspect.preset).toBe('16:9');
    expect(s.camera.cameras[second].aspect.preset).toBe('4:3');
    s = apply(s, { type: 'camera/activate', id: first });
    expect(size(s)).toEqual([1920, 1080]);
    expect(s.camera.cameras[second].aspect.preset).toBe('4:3');
    // Changing the ratio of the one that is not active does not touch the size.
    s = setAspect(s, '1:1', second);
    expect(size(s)).toEqual([1920, 1080]);
    // Deleting the active camera makes another the active one, and the size follows it.
    s = apply(s, { type: 'camera/activate', id: second }, { type: 'camera/delete', id: second });
    expect(s.camera.active).toBe(first);
    expect(size(s)).toEqual([1920, 1080]);
  });

  it('New from current view copies the ratio of the active camera', () => {
    const ctx: Ctx = { store: createStore(exampleState()), ui: createUiStore(), services: {} as AppServices };
    ctx.store.dispatch({ type: 'camera/set', id: 'cam1', patch: { aspect: presetAspect('4:5')! } });
    cmd.newCamera(ctx);
    const s = ctx.store.get();
    expect(Object.keys(s.camera.cameras)).toHaveLength(2);
    expect(activeCamera(s).id).not.toBe('cam1');
    expect(activeCamera(s).aspect).toEqual({ preset: '4:5', w: 4, h: 5 });
    expect(size(s)).toEqual([1920, 2400]);
  });

  it('the camera list says the ratio after the lens', () => {
    setLang('en');
    const ctx: Ctx = { store: createStore(twoCameras()), ui: createUiStore(), services: {} as AppServices };
    expect(cameraMenuEntries(ctx).map((r) => r.aux)).toEqual(['85 mm · f/5.6 · 16:9', '85 mm · f/5.6 · 4:3']);
  });

  it('the frustum of a camera is drawn with its own ratio', () => {
    const s = twoCameras();
    const second = Object.keys(s.camera.cameras)[1];
    const glyph = glyphsOf(s, { all: true }).find((g) => g.obj.kind === 'CAMERA' && g.obj.id === second)!;
    // The far rectangle: lines[0] and lines[1] are its bottom edge, lines[5] the corner above.
    const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const w = dist(glyph.lines[0], glyph.lines[1]);
    const h = dist(glyph.lines[1], glyph.lines[5]);
    expect(w / h).toBeCloseTo(4 / 3, 6);
  });

  it('the viewport frames the camera on screen: the active one, or the one looked through', () => {
    const s = twoCameras();
    const second = Object.keys(s.camera.cameras)[1];
    expect(aspectRatio(viewedCamera(s, null))).toBe(16 / 9);
    expect(aspectRatio(viewedCamera(s, { kind: 'CAMERA', id: second }))).toBe(4 / 3);
    // Looking through the active camera, or a light, is the active camera's view and frame.
    expect(aspectRatio(viewedCamera(s, { kind: 'CAMERA', id: s.camera.active }))).toBe(16 / 9);
    expect(aspectRatio(viewedCamera(s, { kind: 'LIGHT', id: s.studio.lights[0].id }))).toBe(16 / 9);
  });

  it('a studio that is restored keeps the ratio of the camera it lands on', () => {
    let s = exampleState();
    const saved = snapshotStudio(s, 'st1', 'Saved');
    s = setAspect(s, '1:1');
    s = apply(s, { type: 'studio/restore', id: 'st1', snapshot: saved });
    expect(activeCamera(s).aspect.preset).toBe('1:1');
    expect(size(s)).toEqual([1920, 1920]);
  });

  it('a library studio saved before the ratio opens as 16:9, and one with a ratio keeps it', () => {
    const state = setAspect(exampleState(), '3:2');
    const item = JSON.parse(JSON.stringify(fromCurrentStudio(state, emptyLibrary(), 'Three two')));
    expect(validateItem(item).kind).toBe('studio');
    const kept = validateItem(item) as unknown as { studio: { camera: { aspect: unknown } } };
    expect(kept.studio.camera.aspect).toEqual({ preset: '3:2', w: 3, h: 2 });
    delete item.studio.camera.aspect;
    const old = validateItem(item) as unknown as { studio: { camera: { aspect: unknown } } };
    expect(old.studio.camera.aspect).toEqual(DEFAULT_ASPECT);
  });
});

describe('projects', () => {
  /** The text of a project as a version before the ratio wrote it: cameras without an aspect, a render of `width × height`. */
  async function oldFile(width: number, height: number): Promise<string> {
    const state = withoutCameraAspects(apply(exampleState(), { type: 'render/set', patch: { width, height } }));
    const body = JSON.parse(await serializeProject(state).text());
    // The size the file saved, as the old version wrote it (the ratio it kept is the size's).
    body.state.render = { ...body.state.render, width, height, aspect: width / height };
    for (const c of Object.values(body.state.camera.cameras) as Record<string, unknown>[]) delete c.aspect;
    return JSON.stringify(body);
  }

  it('a project saved before the ratio takes the ratio of the saved size, rounded to a preset within 0.5 %, else custom with the pixels', async () => {
    const cases: [number, number, string, number, number][] = [
      [1920, 1080, '16:9', 16, 9],
      [1000, 700, 'CUSTOM', 1000, 700],
      [1080, 1350, '4:5', 4, 5],
      [1500, 1000, '3:2', 3, 2],
      // 0.45 % from 16:9: the preset. 0.6 % from it: not.
      [1920, 1085, '16:9', 16, 9],
      [1920, 1091, 'CUSTOM', 1920, 1091],
    ];
    for (const [w, h, preset, aw, ah] of cases) {
      const s = parseProject(await oldFile(w, h));
      for (const cam of Object.values(s.camera.cameras)) expect(cam.aspect, `${w} × ${h}`).toEqual({ preset, w: aw, h: ah });
      // Opening a project never changes what it renders.
      expect(size(s), `${w} × ${h}`).toEqual([w, h]);
    }
    expect(aspectNearPixels(1920, 1085).preset).toBe('16:9');
    expect(aspectNearPixels(1920, 1091).preset).toBe('CUSTOM');
  });

  it('every camera of an old project takes the one size they all shared', async () => {
    const withTwo = withoutCameraAspects(apply(exampleState(), { type: 'camera/add', name: 'Second' }));
    const body = JSON.parse(await serializeProject(withTwo).text());
    body.state.render = { ...body.state.render, width: 1080, height: 1350, aspect: 0.8 };
    for (const c of Object.values(body.state.camera.cameras) as Record<string, unknown>[]) delete c.aspect;
    const s = parseProject(JSON.stringify(body));
    expect(Object.values(s.camera.cameras).map((c) => c.aspect.preset)).toEqual(['4:5', '4:5']);
  });

  it('a project with ratios saves and opens as it is, and a size follows the camera from then on', async () => {
    let s = twoCameras();
    s = apply(s, { type: 'camera/activate', id: Object.keys(s.camera.cameras)[1] });
    const back = parseProject(await serializeProject(s).text());
    expect(Object.values(back.camera.cameras).map((c) => c.aspect.preset)).toEqual(['16:9', '4:3']);
    expect(size(back)).toEqual([1920, 1440]);
    expect(back.render.aspect).toBe(4 / 3);
  });

  it('a hand-edited ratio that cannot be one is read as the size says', async () => {
    const body = JSON.parse(await serializeProject(exampleState()).text());
    body.state.camera.cameras.cam1.aspect = { preset: 'CUSTOM', w: 'wide', h: 0 };
    const s = parseProject(JSON.stringify(body));
    expect(activeCamera(s).aspect).toEqual({ preset: '16:9', w: 16, h: 9 });
  });
});

describe('queue', () => {
  it('a job for a camera with another ratio has the window\'s width and that camera\'s height', () => {
    const s0 = twoCameras();
    const [first, second] = Object.keys(s0.camera.cameras);
    const all = apply(s0, { type: 'render/set', patch: { camera: { kind: 'ALL' } } });
    const jobs = apply(all, { type: 'render/enqueue', at: 0, position: 'LAST' }).render.queue;
    expect(jobs.map((j) => [j.settings.camera.kind === 'ONE' ? j.settings.camera.id : '-', j.settings.width, j.settings.height])).toEqual([
      [first, 1920, 1080],
      [second, 1920, 1440],
    ]);
    // One other camera by name, the same.
    const one = apply(s0, { type: 'render/set', patch: { camera: { kind: 'ONE', id: second } } });
    const job = apply(one, { type: 'render/enqueue', at: 0, position: 'LAST' }).render.queue[0];
    expect([job.settings.width, job.settings.height, job.settings.aspect]).toEqual([1920, 1440, 4 / 3]);
    // The active camera: the window's own settings, untouched.
    const act = apply(s0, { type: 'render/enqueue', at: 0, position: 'LAST', settings: { ...settingsOf(s0.render), width: 1000, height: 500 } }).render.queue[0];
    expect([act.settings.width, act.settings.height]).toEqual([1000, 500]);
  });
});

describe('animation', () => {
  const withShot = (s: ProjectState, camera: string | null): ProjectState => {
    const added = apply(s, { type: 'anim/addShot', duration: 2 });
    return apply(added, { type: 'anim/setShot', id: added.animation.shots[added.animation.shots.length - 1].id, patch: { camera } });
  };

  it('keeps its own size: the camera\'s ratio and the camera that is active do not move it, and it follows the camera again as an image', () => {
    let s = apply(exampleState(), { type: 'render/set', patch: { mode: 'ANIMATION' } });
    s = apply(s, { type: 'render/set', patch: { width: 1280, height: 720 } });
    expect(size(s)).toEqual([1280, 720]);
    // Typing the animation's size does not touch the camera.
    s = apply(s, { type: 'render/set', patch: { width: 1000, height: 1000 } });
    expect(activeCamera(s).aspect).toEqual(DEFAULT_ASPECT);
    expect(size(s)).toEqual([1000, 1000]);
    // Nor does the camera's ratio move the animation's size.
    s = setAspect(s, '4:3');
    expect(size(s)).toEqual([1000, 1000]);
    // What frames the camera (Frame, the sweep) is the camera's ratio, not the video's.
    expect(outputAspect(s)).toBe(4 / 3);
    // The animation's lock is its own: one side typed, the other follows the ratio of the size.
    s = apply(s, { type: 'render/set', patch: { width: 500 } });
    expect(size(s)).toEqual([500, 500]);
    // Back to an image: the width stays and the camera's ratio gives the height.
    s = apply(s, { type: 'render/set', patch: { mode: 'IMAGE' } });
    expect(size(s)).toEqual([500, 375]);
    expect(activeCamera(s).aspect.preset).toBe('4:3');
  });

  it('the Doctor warns when the camera of a shot has another ratio than the size of the output, and can give it that of the output', () => {
    const base = twoCameras();
    const [first, second] = Object.keys(base.camera.cameras);
    const check = (s: ProjectState) => runDoctor(s).find((r) => r.key === 'aspect')!;
    expect(check(base).status).toBe('OK');
    // A shot through the 4:3 camera while the output is 16:9 (Camera 1 is active).
    const s = withShot(base, second);
    const r = check(s);
    expect(r.status).toBe('WARN');
    expect(r.fixable).toBe(true);
    expect(r.detail).toEqual({ count: 1, shot: 1, camera: second, aspect: '4:3', output: '1920 × 1080' });
    expect(s.doctor.results.find((x) => x.key === 'aspect')!.status).toBe('WARN');
    // A shot with no camera uses the active one: the same ratio as the output, no warning.
    expect(check(withShot(base, null)).status).toBe('OK');
    expect(check(withShot(base, first)).status).toBe('OK');
    // The fix: the cameras of those shots take the output's ratio.
    const fixed = apply(s, { type: 'doctor/fix', key: 'aspect' });
    expect(fixed.camera.cameras[second].aspect).toEqual({ preset: '16:9', w: 16, h: 9 });
    expect(check(fixed).status).toBe('OK');
    expect(size(fixed)).toEqual([1920, 1080]);
  });

  it('in an animation the output keeps its size and the active camera\'s shots warn when the camera says another ratio', () => {
    let s = apply(exampleState(), { type: 'render/set', patch: { mode: 'ANIMATION' } });
    s = withShot(s, null);
    s = setAspect(s, '1:1');
    expect(size(s)).toEqual([1920, 1080]);
    const r = runDoctor(s).find((x) => x.key === 'aspect')!;
    expect(r.status).toBe('WARN');
    expect(r.detail).toMatchObject({ aspect: '1:1', output: '1920 × 1080' });
    // Fixing it gives the camera the output's ratio, and the output stays.
    const fixed = apply(s, { type: 'doctor/fix', key: 'aspect' });
    expect(activeCamera(fixed).aspect.preset).toBe('16:9');
    expect(size(fixed)).toEqual([1920, 1080]);
  });

  it('says in both languages which shot, which camera and which ratios', () => {
    const base = twoCameras();
    const second = Object.keys(base.camera.cameras)[1];
    const s = apply(base, { type: 'anim/addShot', duration: 2 });
    const shot = s.animation.shots[0].id;
    const warned = apply(s, { type: 'anim/setShot', id: shot, patch: { camera: second } });
    const r = warned.doctor.results.find((x) => x.key === 'aspect')!;
    setLang('en');
    expect(doctorSentence(r, warned)).toBe('Shots with another aspect ratio than the animation (1920 × 1080): 1. The first uses Second (4:3).');
    setLang('es');
    expect(doctorSentence(r, warned)).toBe('Planos con otra proporción que la animación (1920 × 1080): 1. El primero usa Second (4:3).');
    setLang('en');
    for (const lang of ['en', 'es'] as const) {
      const text = STRINGS[lang]['doctor.aspect'];
      for (const hole of ['{count}', '{camera}', '{aspect}', '{output}']) expect(text).toContain(hole);
    }
  });
});

// The viewport's camera list and the scene's camera section (owner's report: the list had no way to edit a camera, and
// the section did not say it was editing "Camera 1"): every row carries its lens and a pencil that opens that
// camera's own inspector, and the section is titled with the active camera's name.

import { describe, expect, it } from 'vitest';
import { cameraLensSummary, cameraMenuEntries, cameraSummary } from '../src/ui/camera-menu';
import * as cmd from '../src/ui/commands';
import type { Ctx } from '../src/ui/reactive';
import { setLang, t } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { createStore } from '../src/core/store';
import type { AppServices } from '../src/ui/ports';
import { exampleState } from './helpers';

function ctxOf(): Ctx {
  return { store: createStore(exampleState()), ui: createUiStore(), services: {} as AppServices };
}

describe('the camera list of the viewport', () => {
  it('has one row per camera, the active one checked, with its lens and a pencil', () => {
    setLang('en');
    const ctx = ctxOf();
    cmd.newCamera(ctx);
    const s = ctx.store.get();
    const ids = Object.keys(s.camera.cameras);
    expect(ids).toHaveLength(2);
    const rows = cameraMenuEntries(ctx);
    expect(rows.map((r) => r.label)).toEqual(['Camera 1', 'Camera 2']);
    expect(rows.map((r) => r.checked)).toEqual([ids[0] === s.camera.active, ids[1] === s.camera.active]);
    expect(rows.filter((r) => r.checked)).toHaveLength(1);
    for (const r of rows) {
      expect(r.aux).toBe(cameraSummary(s.camera.cameras[ids[rows.indexOf(r)]]));
      expect(r.action?.icon).toBe('edit');
      expect(r.action?.label).toContain(r.label);
    }
  });

  it('writes the lens as "85 mm · f/5.6" and, in the list, the ratio after it', () => {
    setLang('en');
    expect(cameraLensSummary({ focalMm: 85, fstop: 5.6 })).toBe('85 mm · f/5.6');
    expect(cameraLensSummary({ focalMm: 100.4, fstop: 11 })).toBe('100 mm · f/11');
    expect(cameraSummary({ focalMm: 85, fstop: 5.6, aspect: { preset: '4:3', w: 4, h: 3 } })).toBe('85 mm · f/5.6 · 4:3');
    expect(cameraSummary({ focalMm: 85, fstop: 5.6, aspect: { preset: 'CUSTOM', w: 2.39, h: 1 } })).toBe('85 mm · f/5.6 · 2.39:1');
  });

  it('a row activates the camera; its pencil selects it and shows the Cameras tab, without activating it', () => {
    const ctx = ctxOf();
    cmd.newCamera(ctx);
    const [first, second] = Object.keys(ctx.store.get().camera.cameras);
    cmd.activateCamera(ctx, first);
    ctx.ui.set({ sceneTab: 'parts', rightCollapsed: true });
    cameraMenuEntries(ctx)[1].action!.run();
    const s = ctx.store.get();
    expect(s.selection.ids).toEqual([second]);
    expect(s.camera.active).toBe(first);
    expect(ctx.ui.get().sceneTab).toBe('cameras');
    expect(ctx.ui.get().rightCollapsed).toBe(false);
    cameraMenuEntries(ctx)[1].run!();
    expect(ctx.store.get().camera.active).toBe(second);
  });

  it('editing a camera that no longer exists does nothing', () => {
    const ctx = ctxOf();
    const before = ctx.store.get();
    cmd.editCamera(ctx, 'nope');
    expect(ctx.store.get()).toBe(before);
  });

  it('every camera keeps its own lens and placement', () => {
    const ctx = ctxOf();
    cmd.newCamera(ctx);
    const [first, second] = Object.keys(ctx.store.get().camera.cameras);
    ctx.store.dispatch({ type: 'camera/set', id: second, patch: { focalMm: 135, fstop: 2.8 } });
    const s = ctx.store.get();
    expect(s.camera.cameras[first].focalMm).not.toBe(135);
    expect(cameraLensSummary(s.camera.cameras[second])).toBe(t('cameras.lens', { focal: '135', fstop: '2.8' }));
  });
});

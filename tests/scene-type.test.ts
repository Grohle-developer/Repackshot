// Phase K1: the scene type (INTERIORS.md §3.1). It rewrites a handful of defaults and leaves every control where it is; changing
// type and changing back leaves the project as it was, except for what the person touched in between; the type is saved in the
// project and a project from before it opens as Product.

import { afterEach, describe, expect, it } from 'vitest';
import { SCENE_TYPES, sceneTypeEntry } from '../src/data/scene-types';
import { applySceneType, normalizeSceneType, normalizeTypeBase, qualityForSamples } from '../src/core/scene-type';
import { createStore, reduce, type ProjectState } from '../src/core/store';
import { loadProject, parseProject, serializeProject } from '../src/io/project';
import * as cmd from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang, STRINGS } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import v2Text from './fixtures/project-v2.json?raw';
import { apply, exampleState } from './helpers';

afterEach(() => setLang('en'));

/** The state without what changes whenever anything does: the Doctor's counter and the dirty mark. */
const same = (s: ProjectState): unknown => ({ ...s, doctor: { ...s.doctor, stamp: 0 }, meta: { ...s.meta, dirty: false } });
const switchTo = (s: ProjectState, sceneType: 'PRODUCT' | 'INTERIOR' | 'CATALOGUE'): ProjectState => reduce(s, { type: 'scene/setType', sceneType });
const cam = (s: ProjectState) => s.camera.cameras[s.camera.active];

/** A project whose settings the person had changed, every one of the slots away from what the types write. */
function handmade(kind: 'STUDIO' | 'FLAT' = 'STUDIO'): ProjectState {
  return apply(
    exampleState(),
    { type: 'env/set', patch: { kind, background: 'GRADIENT', color: [0.2, 0.3, 0.4, 1], groundShadow: 0.8 } },
    { type: 'studio/set', patch: { shadow: true } },
    { type: 'image/set', patch: { viewTransform: 'FILMIC' } },
    { type: 'render/quality', quality: 'FINAL' },
    { type: 'render/set', patch: { finishBy: 'SAMPLES', advanced: { maxBounces: null, caustics: 'ON', denoise: 'RENDER' } as never } },
    { type: 'camera/lens', key: 'PORTRAIT_85' },
  );
}

describe('the scene type', () => {
  it('starts as Product, with nothing remembered', () => {
    const s = exampleState();
    expect(s.scene.type).toBe('PRODUCT');
    expect(s.scene.typeBase).toBeUndefined();
  });

  it('has three types with stable keys, labels in both languages and no defaults for Product', () => {
    expect(SCENE_TYPES.map((t) => t.key)).toEqual(['PRODUCT', 'INTERIOR', 'CATALOGUE']);
    for (const t of SCENE_TYPES) {
      expect(t.label.es && t.label.en && t.intent.es && t.intent.en, t.key).toBeTruthy();
      expect(`${t.intent.en}${t.intent.es}`, `${t.key}: no number in the tooltip that could go stale`).not.toMatch(/\d/);
    }
    expect(sceneTypeEntry('PRODUCT').defaults).toEqual({});
  });

  it('Interior writes the interior column of the table of INTERIORS.md §3.1 that exists today', () => {
    const s = switchTo(handmade(), 'INTERIOR');
    expect(s.scene.type).toBe('INTERIOR');
    expect(s.environment.kind).toBe('SKY');
    expect(s.render.advanced.maxBounces).toBe(16);
    expect(s.render.advanced.caustics).toBe('OFF');
    expect(s.studio.shadow).toBe(false);
    expect(s.image.viewTransform).toBe('AGX');
    expect(s.render).toMatchObject({ maxSamples: 512, quality: 'CUSTOM', finishBy: 'NOISE' });
    expect(s.render.advanced.denoise).toBe('BOTH');
    expect(cam(s)).toMatchObject({ focalMm: 28, lens: null });
    // What the column does not name is where it was.
    expect(s.environment.background).toBe('GRADIENT');
    expect(s.environment.groundShadow).toBe(0.8);
    expect(s.studio.floor).toBe(true);
  });

  it('Catalogue writes the catalogue column: a white dome, a soft contact shadow, 8 bounces, Standard, 256 samples, 50 mm', () => {
    const s = switchTo(handmade(), 'CATALOGUE');
    expect(s.scene.type).toBe('CATALOGUE');
    expect(s.environment).toMatchObject({ kind: 'STUDIO', background: 'COLOR', color: [1, 1, 1, 1], groundShadow: 0.35 });
    expect(s.studio.shadow).toBe(true);
    expect(s.render.advanced).toMatchObject({ maxBounces: 8, caustics: 'OFF' });
    expect(s.image.viewTransform).toBe('STANDARD');
    expect(s.render).toMatchObject({ maxSamples: 256, quality: 'PREVIEW' });
    expect(cam(s)).toMatchObject({ focalMm: 50, lens: null });
    // 256 is the Preview tier, so the window says Preview; 512 is no tier.
    expect(qualityForSamples(256)).toBe('PREVIEW');
    expect(qualityForSamples(512)).toBe('CUSTOM');
  });

  it('a type that sets the value a scene already has changes nothing and remembers nothing', () => {
    const s = switchTo(exampleState(), 'CATALOGUE');
    // The example is on the studio dome and PREVIEW already: those slots wrote nothing.
    expect(Object.keys(s.scene.typeBase ?? {})).not.toContain('environment.kind');
    expect(Object.keys(s.scene.typeBase ?? {})).not.toContain('render.samples');
  });

  for (const path of [['INTERIOR'], ['CATALOGUE'], ['INTERIOR', 'CATALOGUE'], ['CATALOGUE', 'INTERIOR'], ['INTERIOR', 'CATALOGUE', 'INTERIOR']] as const) {
    it(`changing to ${path.join(' then ')} and back to Product leaves the project identical (a new project)`, () => {
      const start = exampleState();
      let s = start;
      for (const t of path) s = switchTo(s, t);
      s = switchTo(s, 'PRODUCT');
      expect(same(s)).toEqual(same(start));
      expect(s.scene.typeBase).toBeUndefined();
    });

    it(`changing to ${path.join(' then ')} and back to Product leaves the project identical (every slot set by hand)`, () => {
      const start = handmade();
      let s = start;
      for (const t of path) s = switchTo(s, t);
      s = switchTo(s, 'PRODUCT');
      expect(same(s)).toEqual(same(start));
      expect(s.scene.typeBase).toBeUndefined();
    });
  }

  it('an environment that is neither type’s (flat colour) goes back too, from either type', () => {
    const start = handmade('FLAT');
    for (const path of [['INTERIOR'], ['CATALOGUE'], ['INTERIOR', 'CATALOGUE']] as const) {
      let s = start;
      for (const t of path) {
        s = switchTo(s, t);
        expect(s.environment.kind).toBe(t === 'INTERIOR' ? 'SKY' : 'STUDIO');
      }
      expect(same(switchTo(s, 'PRODUCT')), path.join('>')).toEqual(same(start));
    }
  });

  it('what the person touched in between is theirs: it stays, and what they did not touch goes back', () => {
    const start = handmade();
    let s = switchTo(start, 'INTERIOR');
    // They change the lens and the view transform, and leave the bounces, the sky and the rest.
    s = apply(s, { type: 'camera/set', id: s.camera.active, patch: { focalMm: 35 } }, { type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    s = switchTo(s, 'PRODUCT');
    expect(cam(s).focalMm).toBe(35);
    expect(cam(s).lens).toBeNull();
    expect(s.image.viewTransform).toBe('STANDARD');
    expect(s.render.advanced.maxBounces).toBe(start.render.advanced.maxBounces);
    expect(s.render.advanced.caustics).toBe('ON');
    expect(s.environment.kind).toBe('STUDIO');
    expect(s.render).toMatchObject({ quality: 'FINAL', maxSamples: start.render.maxSamples, finishBy: 'SAMPLES' });
    expect(s.scene.typeBase).toBeUndefined();
  });

  it('a value the person touched becomes the one the next type goes back to', () => {
    let s = switchTo(handmade(), 'INTERIOR');
    s = apply(s, { type: 'camera/set', id: s.camera.active, patch: { focalMm: 35 } });
    s = switchTo(s, 'CATALOGUE');
    expect(cam(s).focalMm).toBe(50);
    s = switchTo(s, 'PRODUCT');
    expect(cam(s).focalMm).toBe(35);
  });

  it('a loaded HDRI is the person’s: no type replaces it', () => {
    const base = apply(exampleState(), { type: 'env/set', patch: { kind: 'HDRI' } });
    for (const t of ['INTERIOR', 'CATALOGUE'] as const) {
      const s = switchTo(base, t);
      expect(s.environment.kind, t).toBe('HDRI');
      expect(switchTo(s, 'PRODUCT').environment.kind, t).toBe('HDRI');
    }
  });

  it('a locked camera keeps its lens; the others take the type’s', () => {
    const base = apply(exampleState(), { type: 'camera/add', name: 'Second' }, { type: 'camera/set', id: 'cam1', patch: { locked: true, focalMm: 120 } });
    const s = switchTo(base, 'INTERIOR');
    expect(s.camera.cameras.cam1.focalMm).toBe(120);
    expect(s.camera.cameras.cam2.focalMm).toBe(28);
    // Back: each camera as it was.
    const back = switchTo(s, 'PRODUCT');
    expect(same(back)).toEqual(same(base));
  });

  it('every camera takes the lens, and each goes back to its own', () => {
    const base = apply(exampleState(), { type: 'camera/add', name: 'Second' }, { type: 'camera/set', id: 'cam2', patch: { focalMm: 100 } });
    const s = switchTo(base, 'CATALOGUE');
    expect(Object.values(s.camera.cameras).map((c) => c.focalMm)).toEqual([50, 50]);
    expect(Object.values(switchTo(s, 'PRODUCT').camera.cameras).map((c) => c.focalMm)).toEqual([85, 100]);
  });

  it('switching to the type already in force is not a change', () => {
    const s = exampleState();
    expect(switchTo(s, 'PRODUCT')).toBe(s);
    const i = switchTo(s, 'INTERIOR');
    expect(switchTo(i, 'INTERIOR')).toBe(i);
    expect(applySceneType(s, 'NOPE' as never)).toBe(s);
  });

  it('is one undo step, and undo and redo bring everything back and forth', () => {
    const store = createStore(handmade());
    const before = store.get();
    store.dispatch({ type: 'scene/setType', sceneType: 'INTERIOR', label: 'Scene type' });
    const after = store.get();
    expect(store.history().undo).toEqual(['Scene type']);
    store.undo();
    expect(same(store.get())).toEqual(same(before));
    expect(store.get().scene.type).toBe('PRODUCT');
    store.redo();
    expect(same(store.get())).toEqual(same(after));
    expect(store.get().meta.dirty).toBe(true);
  });

  it('removes nothing from the project: the lights, the materials, the parts and the studio are as they were', () => {
    const start = handmade();
    for (const t of ['INTERIOR', 'CATALOGUE'] as const) {
      const s = switchTo(start, t);
      expect(s.studio.lights).toBe(start.studio.lights);
      expect(s.studio.lightSetup).toBe(start.studio.lightSetup);
      expect(s.scene.nodes).toBe(start.scene.nodes);
      expect(s.materials).toBe(start.materials);
      expect(s.animation).toBe(start.animation);
      expect(Object.keys(s.render.advanced).sort()).toEqual(Object.keys(start.render.advanced).sort());
    }
  });
});

describe('the scene type in the project file', () => {
  const roundTrip = (s: ProjectState): Promise<ProjectState> => serializeProject(s).text().then(parseProject);

  it('is saved and opens as it was, with what it replaced, so going back still leaves the project as it was', async () => {
    const start = handmade();
    const interior = switchTo(start, 'INTERIOR');
    const loaded = await roundTrip(interior);
    expect(loaded.scene.type).toBe('INTERIOR');
    expect(loaded.scene.typeBase).toEqual(interior.scene.typeBase);
    expect(same(loaded)).toEqual(same(interior));
    expect(same(switchTo(loaded, 'PRODUCT'))).toEqual(same(start));
  });

  it('a Product project is saved without a memory', async () => {
    const loaded = await roundTrip(exampleState());
    expect(loaded.scene.type).toBe('PRODUCT');
    expect('typeBase' in loaded.scene).toBe(false);
  });

  it('a project from before K1 has no type and opens as Product', () => {
    const body = JSON.parse(v2Text) as { state: { scene: Record<string, unknown> } };
    expect('type' in body.state.scene).toBe(false);
    const loaded = parseProject(v2Text);
    expect(loaded.scene.type).toBe('PRODUCT');
    expect('typeBase' in loaded.scene).toBe(false);
    expect(loadProject(v2Text).state.scene.type).toBe('PRODUCT');
  });

  it('a type this version does not know opens as Product, and a memory of Product is dropped', async () => {
    const text = await serializeProject(switchTo(handmade(), 'INTERIOR')).text();
    const body = JSON.parse(text) as { state: { scene: { type: string } } };
    body.state.scene.type = 'WAREHOUSE';
    const loaded = parseProject(JSON.stringify(body));
    expect(loaded.scene.type).toBe('PRODUCT');
    expect('typeBase' in loaded.scene).toBe(false);
  });

  it('keeps only the writes of the settings it knows, each with values that settings can hold', () => {
    const state = exampleState();
    const raw = {
      'render.maxBounces': { base: null, applied: 16 },
      'studio.shadow': { base: true, applied: 'no' },
      'image.viewTransform': { base: 'FILMIC', applied: 'SEPIA' },
      'camera.focal:cam1': { base: { focalMm: 85, lens: 'PORTRAIT_85' }, applied: { focalMm: 28, lens: null } },
      'camera.focal:cam9': { base: { focalMm: 'wide', lens: null }, applied: { focalMm: 28, lens: null } },
      'render.future': { base: 1, applied: 2 },
      'render.caustics': 'OFF',
    };
    expect(normalizeTypeBase(raw, state)).toEqual({
      'render.maxBounces': { base: null, applied: 16 },
      'camera.focal:cam1': { base: { focalMm: 85, lens: 'PORTRAIT_85' }, applied: { focalMm: 28, lens: null } },
    });
    expect(normalizeTypeBase({}, state)).toBeUndefined();
    expect(normalizeTypeBase(null, state)).toBeUndefined();
    expect(normalizeTypeBase([], state)).toBeUndefined();
    expect(normalizeSceneType('INTERIOR')).toBe('INTERIOR');
    expect(normalizeSceneType('interior')).toBe('PRODUCT');
    expect(normalizeSceneType(3)).toBe('PRODUCT');
    expect(normalizeSceneType(undefined)).toBe('PRODUCT');
  });
});

describe('the command and its strings', () => {
  function makeCtx(state: ProjectState = exampleState()): Ctx {
    return { store: createStore(state), ui: createUiStore(), services: { viewport: null } as unknown as AppServices };
  }

  it('is one undo entry named in the language of the interface, and Interior brings the Interior setups into view', () => {
    const ctx = makeCtx();
    cmd.setSceneType(ctx, 'INTERIOR');
    expect(ctx.store.get().scene.type).toBe('INTERIOR');
    expect(ctx.store.history().undo).toEqual(['Scene type: Interior']);
    expect(ctx.ui.get().lightStyle).toBe('INTERIOR');
    cmd.setSceneType(ctx, 'CATALOGUE');
    // Leaving Interior takes the Light section back to All; another style the person chose is left alone.
    expect(ctx.ui.get().lightStyle).toBe('ALL');
    ctx.ui.set({ lightStyle: 'CINEMATIC' });
    cmd.setSceneType(ctx, 'PRODUCT');
    expect(ctx.ui.get().lightStyle).toBe('CINEMATIC');
    ctx.store.dispatch({ type: 'meta/lang', lang: 'es' });
    expect(ctx.store.history().undo[0]).toBe('Tipo de escena: Producto');
  });

  it('does nothing for the type already in force', () => {
    const ctx = makeCtx();
    cmd.setSceneType(ctx, 'PRODUCT');
    expect(ctx.store.history().undo).toHaveLength(0);
  });

  it('has its strings in English and Spanish', () => {
    for (const k of ['product.sceneType', 'product.sceneTypeAux', 'undo.sceneType'] as const) {
      expect(STRINGS.en[k], k).toBeTruthy();
      expect(STRINGS.es[k], k).toBeTruthy();
    }
  });
});

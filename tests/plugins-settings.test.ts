// The interface side of phase P6 without a DOM: the manifest and the controls it declares (what the render window
// draws, and the values it gives the plugin), the plugin settings of a project (undoable, one entry per drag, saved
// with it; a project of before has none and loads unchanged), the result an Apply keeps (with its provenance), and the
// pixels a plugin is given.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { downscaleRgba8, linearPlanes, pluginSource, unpremultiply, withAlpha } from '../src/core/plugin-pixels';
import { controlGroups, controlsFor, defaultControls, derivedFileName, normalisePlugins, NO_PLUGINS, parseManifest, previewSize, sliderText, withPlugin, type PluginManifest } from '../src/core/plugins';
import { defaultRenderSettings, migrateRender, patchSettings } from '../src/core/render';
import type { ResultMeta } from '../src/core/results';
import { createInitialState, createStore } from '../src/core/store';
import { parseProject, serializeProject } from '../src/io/project';
import * as cmd from '../src/ui/commands';
import { recordPluginResult } from '../src/ui/plugin-results';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { createUiStore } from '../src/ui/ui-state';
import v2Text from './fixtures/project-v2.json?raw';

const invertManifest = (): PluginManifest => {
  const r = parseManifest(JSON.parse(readFileSync('tests/fixtures/plugins/invert/manifest.json', 'utf8')));
  if (!r.ok) throw new Error(r.problems.join(', '));
  return r.manifest;
};

describe('the manifest and its controls', () => {
  it('the invert fixture and the film template parse; groups keep their order and every control its group', () => {
    const m = invertManifest();
    expect(m.controls.map((c) => [c.key, c.kind, c.group])).toEqual([
      ['amount', 'slider', 'invert'],
      ['channel', 'select', 'invert'],
      ['mono', 'toggle', 'output'],
    ]);
    const film = parseManifest({ ...JSON.parse(readFileSync('tools/plugins/film/manifest.json', 'utf8')), version: '0.1.0', files: ['recipes.json'] });
    expect(film.ok, film.ok ? '' : film.problems.join(', ')).toBe(true);
    if (film.ok) expect(film.manifest.groups.map((g) => g.id)).toEqual(['film', 'colour', 'grain', 'halation', 'diffusion', 'lens', 'rendering']);
  });

  it('a manifest with a bad control, a missing licence or another ABI is refused, each problem named', () => {
    const base = JSON.parse(readFileSync('tests/fixtures/plugins/invert/manifest.json', 'utf8'));
    const problems = (patch: Record<string, unknown>) => {
      const r = parseManifest({ ...base, ...patch });
      return r.ok ? [] : r.problems;
    };
    expect(problems({ abi: 2 })).toEqual(['abi 2 (this host speaks 1)']);
    expect(problems({ licence: { kind: 'open', label: base.licence.label } })).toEqual(['licence']);
    expect(problems({ homepage: 'http://x' })).toEqual(['homepage']);
    expect(problems({ controls: [{ ...base.controls[0], default: 2 }] })).toEqual(['controls[0].default']);
    expect(problems({ controls: [base.controls[0], base.controls[0]] })).toEqual(['controls[1].key (twice)']);
    expect(problems({ controls: [{ ...base.controls[1], default: 'cyan' }] })).toEqual(['controls[0].default']);
    expect(problems({ controls: [{ ...base.controls[2], group: 'elsewhere' }] })).toEqual(['controls[0].group']);
    expect(problems({ controls: [{ ...base.controls[0], kind: 'knob' }] })).toEqual(['controls[0].kind']);
    expect(problems({ entry: '../plugin.js' })).toEqual(['entry']);
  });

  it('draws what the manifest declares, by group, with the values kept or the defaults', () => {
    const m = invertManifest();
    const groups = controlGroups(m, { amount: 0.25, channel: 'nope' });
    expect(groups.map((g) => [g.group.id, g.controls.map((c) => [c.control.key, c.value])])).toEqual([
      ['invert', [['amount', 0.25], ['channel', 'all']]],
      ['output', [['mono', false]]],
    ]);
  });

  it('values are clamped to the range and the step, refused for the wrong type, and a slider at its left stop reads its label', () => {
    const m = invertManifest();
    expect(controlsFor(m, { amount: 7, channel: 'g', mono: 'yes' })).toEqual({ amount: 1, channel: 'g', mono: false });
    expect(controlsFor(m, { amount: 0.3333 })).toMatchObject({ amount: 0.33 });
    expect(defaultControls(m)).toEqual({ amount: 1, channel: 'all', mono: false });
    const halation = { key: 'h', label: { en: 'Amount', es: 'Cantidad' }, group: 'g', kind: 'slider' as const, min: 0, max: 1, step: 0.01, default: 0, minLabel: { en: 'Recipe', es: 'Receta' } };
    const fmt = (n: number, d: number) => n.toFixed(d);
    expect(sliderText(halation, 0, 'es', fmt)).toBe('Receta');
    expect(sliderText(halation, 0.5, 'en', fmt)).toBe('0.50');
    expect(sliderText({ ...halation, minLabel: undefined, unit: 'µm', step: 10, min: 40, max: 1200 }, 380, 'en', fmt)).toBe('380 µm');
  });
});

describe('the plugin settings of a project (RenderSettings.plugins)', () => {
  it('a new project and an old one have none; garbage is cleaned; an unchanged entry keeps its identity', () => {
    expect(defaultRenderSettings().plugins).toBe(NO_PLUGINS);
    const v2 = parseProject(v2Text);
    expect(v2.render.plugins).toEqual({});
    const raw = { 'test-invert': { recipe: 'half', controls: { amount: 0.5, channel: 'r', 'bad key': 1, mono: true, big: Number.NaN } }, 'Bad Id!': { recipe: 'x' } };
    const clean = normalisePlugins(raw);
    expect(clean).toEqual({ 'test-invert': { recipe: 'half', controls: { amount: 0.5, channel: 'r', mono: true } } });
    expect(normalisePlugins(JSON.parse(JSON.stringify(clean)), clean)).toBe(clean);
    const more = withPlugin(clean, 'other', { recipe: 'r1' });
    const again = normalisePlugins(more, clean);
    expect(again['test-invert']).toBe(clean['test-invert']);
    // A plugin that is not installed keeps what the project says of it.
    expect(migrateRender({ plugins: { 'aintfilm-film': { recipe: 'cn-01', controls: { seed: 7 } } } }).plugins).toEqual({ 'aintfilm-film': { recipe: 'cn-01', controls: { seed: 7 } } });
    // Another patch of the settings leaves them as they are.
    const s = patchSettings({ ...defaultRenderSettings(), plugins: clean }, { width: 800 });
    expect(s.plugins).toBe(clean);
  });

  it('every change is undoable, a drag is one entry, and the project file keeps them', () => {
    const ctx: Ctx = { store: createStore(createInitialState()), ui: createUiStore(), services: {} as AppServices };
    const set = (patch: Parameters<typeof withPlugin>[2], gesture?: string) => cmd.setRenderSettings(ctx, { plugins: withPlugin(cmd.windowSettings(ctx).plugins, 'test-invert', patch) }, gesture, { en: 'Invert: amount', es: 'Invertir: cantidad' });
    set({ recipe: 'half' });
    for (const v of [0.9, 0.7, 0.5]) set({ controls: { amount: v } }, 'drag1');
    expect(ctx.store.get().render.plugins['test-invert']).toEqual({ recipe: 'half', controls: { amount: 0.5 } });
    expect(ctx.store.history().undo.length).toBe(2);
    ctx.store.undo();
    expect(ctx.store.get().render.plugins['test-invert']).toEqual({ recipe: 'half', controls: {} });
    ctx.store.undo();
    expect(ctx.store.get().render.plugins).toEqual({});
    ctx.store.redo();
    ctx.store.redo();
    expect(ctx.store.get().render.plugins['test-invert'].controls).toEqual({ amount: 0.5 });
    return serializeProject(ctx.store.get())
      .text()
      .then((text) => {
        const back = parseProject(text);
        expect(back.render.plugins).toEqual({ 'test-invert': { recipe: 'half', controls: { amount: 0.5 } } });
      });
  });
});

describe('Apply: a new result with its provenance', () => {
  const source: ResultMeta = { id: 'r1', jobId: 'j1', name: 'Bottle_Camera 1_0001.jpg', createdAt: 1, width: 4, height: 2, dpi: 300, samples: 64, seconds: 3, cameraId: 'c1', camera: 'Camera 1', format: 'JPEG', bitDepth: 8, savedTo: { kind: 'FOLDER', id: 'f1', name: 'Renders' }, thumb: '', bytes: 10, ai: { name: 'x_AI.png', thumb: '', bytes: 3, report: {} as never } };

  it('is saved next to its source, named after it and the plugin, kept in the history with what made it', async () => {
    const saved: { dest: unknown; name: string }[] = [];
    const added: ResultMeta[] = [];
    const encoded: { format: string; dpi: number; w: number }[] = [];
    const services = {
      files: { save: async (dest: unknown, name: string) => (saved.push({ dest, name }), 'FOLDER') },
      results: { add: async (meta: ResultMeta) => (added.push(meta), []) },
      plugins: { encode: async (img: { width: number }, format: string, dpi: number) => (encoded.push({ format, dpi, w: img.width }), new Blob([new Uint8Array(20)], { type: 'image/jpeg' })) },
    } as unknown as AppServices;
    const ctx: Ctx = { store: createStore(createInitialState()), ui: createUiStore(), services };
    ctx.ui.set({ results: [source] });
    const m = invertManifest();
    const run = { width: 4, height: 2, before: new Uint8ClampedArray(32), after: new Uint8ClampedArray(32), info: { items: [] }, seconds: 0.1, input: 'rgba8' as const };
    const meta = await recordPluginResult(ctx, { source, run, manifest: m, recipe: 'half', recipeName: { en: 'Half inversion', es: 'Media inversión' }, controls: { amount: 1, channel: 'all', mono: false } }, () => 1000);
    expect(meta.name).toBe('Bottle_Camera 1_0001_test-invert.jpg');
    expect(meta.provenance).toEqual({ plugin: 'test-invert', version: '1.0.0', recipe: 'half', controls: { amount: 1, channel: 'all', mono: false }, from: 'r1', label: { plugin: m.name, recipe: { en: 'Half inversion', es: 'Media inversión' } } });
    expect(meta).toMatchObject({ width: 4, height: 2, dpi: 300, format: 'JPEG', bitDepth: 8, cameraId: 'c1', savedTo: { kind: 'FOLDER', id: 'f1', name: 'Renders' }, bytes: 20 });
    // A result a plugin made is not an AI result of its own.
    expect(meta.ai).toBeUndefined();
    expect(encoded).toEqual([{ format: 'JPEG', dpi: 300, w: 4 }]);
    expect(saved).toEqual([{ dest: source.savedTo, name: meta.name }]);
    expect(added).toEqual([meta]);
    expect(ctx.ui.get().results.map((r) => r.id)).toEqual([meta.id, 'r1']);
  });

  it('works on the viewer\'s result, else the newest; a result a plugin made gives the one it came from', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const derived = { id: 'd', provenance: { plugin: 'p', version: '1', recipe: null, controls: {}, from: 'b' } };
    expect(pluginSource([], null)).toBeNull();
    expect(pluginSource([a, b], null)).toBe('a');
    expect(pluginSource([a, b], 'b')).toBe('b');
    expect(pluginSource([derived, a, b], null)).toBe('b');
    expect(pluginSource([derived, a], 'd')).toBe('d');
  });
});

describe('the pixels a plugin is given', () => {
  it('a preview is the result at the preview\'s width (never enlarged); names and sizes', () => {
    expect(previewSize(1920, 1080, 480)).toEqual({ width: 480, height: 270 });
    expect(previewSize(300, 200, 480)).toEqual({ width: 300, height: 200 });
    expect(derivedFileName('Render_0001.png', 'aintfilm-film', 'png')).toBe('Render_0001_aintfilm-film.png');
    expect(derivedFileName('a.b/Render', 'x', 'jpg')).toBe('a.b/Render_x.jpg');
  });

  it('scaling down keeps a flat colour, averages in linear light, and the planes are red, green, blue', () => {
    const flat = new Uint8ClampedArray(8 * 4 * 4).fill(200);
    expect([...downscaleRgba8(flat, 8, 4, 2, 1)]).toEqual([200, 200, 200, 200, 200, 200, 200, 200]);
    // Black and white side by side average to linear 0.5: display 188, not 128.
    const bw = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    expect([...downscaleRgba8(bw, 2, 1, 1, 1)]).toEqual([188, 188, 188, 255]);
    const rgb = new Float32Array([1, 2, 3, 4, 5, 6]);
    expect([...linearPlanes(rgb, 2, 1, 2, 1)]).toEqual([1, 4, 2, 5, 3, 6]);
    expect([...linearPlanes(rgb, 2, 1, 1, 1)]).toEqual([2.5, 3.5, 4.5]);
  });

  it('the source\'s alpha goes back on the answer; an opaque source leaves it as the plugin gave it', () => {
    const answer = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    expect(withAlpha(answer, new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]))).toBe(answer);
    expect([...withAlpha(answer, new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 128]))]).toEqual([10, 20, 30, 0, 40, 50, 60, 128]);
    // An EXR's premultiplied light is made straight with the display image's alpha.
    expect([...unpremultiply(new Float32Array([0.5, 0.25, 0, 1, 1, 1]), new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]))]).toEqual([0.5, 0.25, 0, 1, 1, 1]);
    expect(unpremultiply(new Float32Array([0.25, 0.25, 0.25]), new Uint8ClampedArray([0, 0, 0, 51]))[0]).toBeCloseTo(1.25, 5);
  });
});

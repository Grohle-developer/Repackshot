// The AI post-processing settings in the store (phase X4, AI-POST.md §7.5): clamped to 0..100, unknown styles
// become Natural, old projects load with the defaults, every control is undoable (a slider drag is one step),
// "Another variation" changes the seed, jobs copy their settings, and a new project starts from Settings'
// default intervention.

import { describe, expect, it } from 'vitest';
import { AI_STYLES, DEFAULT_AI_PIPELINE } from '../src/core/ai';
import { nextSeed } from '../src/core/ai-post';
import { AI_PERCENT_KEYS, DEFAULT_AI, defaultRenderSettings, migrateRender, normaliseAi, patchSettings, type AiSettings } from '../src/core/render';
import { defaultSettings, migrateDoc, OLD_AI_FACTORY, SETTINGS_SCHEMA, withProjectDefaults, withSetting } from '../src/core/settings';
import { SYNTHETIC_LIMITS } from '../src/ai/synthetic';
import { createInitialState, createStore } from '../src/core/store';
import { migrateProject, parseProject, serializeProject } from '../src/io/project';
import * as cmd from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { createUiStore } from '../src/ui/ui-state';
import { L, setLang, t } from '../src/ui/strings';
import { exampleState } from './helpers';

function makeCtx(): Ctx {
  return { store: createStore(exampleState()), ui: createUiStore(), services: { projectFiles: { adopt: () => undefined } } as unknown as AppServices };
}

describe('the AI settings of a project', () => {
  it('start off, with the configurator’s defaults and the preview from Fast mode', () => {
    const ai = defaultRenderSettings().ai;
    expect(ai).toEqual({ enabled: false, previewFullEngine: false, ...DEFAULT_AI_PIPELINE });
    expect(ai).toMatchObject({ intervention: 50, light: 50, bounce: 40, wear: 20, style: 'NATURAL', styleStrength: 30, seed: 0 });
  });

  it('C1: the factory values are Intervention 50 and the guard’s tolerances doubled (ΔE₀₀ 4 and 6, edges 4 px)', () => {
    // Decided in docs/ROADMAP.md (Decisiones de criterio, 2.1): the AI pass changed next to nothing at 30 and 2/3/2.
    expect(DEFAULT_AI_PIPELINE.intervention).toBe(50);
    const d = defaultSettings();
    expect(d['ai.intervention']).toBe(50);
    expect([d['ai.guardDeltaE'], d['ai.guardDeltaE95'], d['ai.guardEdgePx']]).toEqual([4, 6, 4]);
    // The synthetic guard checks against those same factory values.
    expect(SYNTHETIC_LIMITS).toMatchObject({ deltaEMean: d['ai.guardDeltaE'], deltaEP95: d['ai.guardDeltaE95'], edgePx: d['ai.guardEdgePx'] });
    // A new project starts at the new default.
    expect(withProjectDefaults(createInitialState(), d).render.ai.intervention).toBe(50);
  });

  it('C1: a stored document of before takes the new values where it held the old factory ones, and keeps a choice', () => {
    const keys = ['ai.intervention', 'ai.guardDeltaE', 'ai.guardDeltaE95', 'ai.guardEdgePx'] as const;
    const read = (doc: ReturnType<typeof migrateDoc>) => keys.map((k) => doc.settings[k]);
    // Schema 1, the old factory values (what a document written before C1 holds untouched): the new ones.
    expect(read(migrateDoc({ schema: 1, settings: { ...OLD_AI_FACTORY, 'general.lang': 'es' }, layout: {} }))).toEqual([50, 4, 6, 4]);
    expect(migrateDoc({ schema: 1, settings: { ...OLD_AI_FACTORY, 'general.lang': 'es' }, layout: {} }).settings['general.lang']).toBe('es');
    // Values the person chose stay, each on its own.
    expect(read(migrateDoc({ schema: 1, settings: { 'ai.intervention': 35, 'ai.guardDeltaE': 2, 'ai.guardDeltaE95': 5, 'ai.guardEdgePx': 1 }, layout: {} }))).toEqual([35, 4, 5, 1]);
    // A document written since C1 (schema 2) is read as it is: a 30 there is a choice.
    expect(SETTINGS_SCHEMA).toBe(2);
    expect(read(migrateDoc({ schema: SETTINGS_SCHEMA, settings: { ...OLD_AI_FACTORY }, layout: {} }))).toEqual([30, 2, 3, 2]);
    // And a document without the keys takes the factory values.
    expect(read(migrateDoc({ schema: 1, settings: {}, layout: {} }))).toEqual([50, 4, 6, 4]);
  });

  it('are integers 0..100, and an unknown style is Natural', () => {
    const s = patchSettings(defaultRenderSettings(), { ai: { ...DEFAULT_AI, intervention: 140, light: -5, bounce: 33.6, wear: Number.NaN, styleStrength: 1e9, style: 'GOLDEN' as never, seed: -4 } });
    expect(s.ai).toMatchObject({ intervention: 100, light: 0, bounce: 34, wear: DEFAULT_AI.wear, styleStrength: 100, style: 'NATURAL', seed: 0 });
    for (const key of AI_PERCENT_KEYS) expect(Number.isInteger(s.ai[key])).toBe(true);
    // Every style the list offers is kept as it is.
    for (const style of AI_STYLES) expect(patchSettings(defaultRenderSettings(), { ai: { ...DEFAULT_AI, style } }).ai.style).toBe(style);
    // The seed is an unsigned 32-bit integer.
    expect(patchSettings(defaultRenderSettings(), { ai: { ...DEFAULT_AI, seed: 2 ** 40 } }).ai.seed).toBe(0xffffffff);
  });

  it('keep the very same object when nothing changed (watchers compare by reference)', () => {
    const s = defaultRenderSettings();
    expect(patchSettings(s, { name: 'x' }).ai).toBe(s.ai);
    expect(normaliseAi({ ...s.ai }, s.ai)).toBe(s.ai);
    expect(normaliseAi('garbage', s.ai)).toBe(s.ai);
    const changed = patchSettings(s, { ai: { ...s.ai, light: 51 } }).ai;
    expect(changed).not.toBe(s.ai);
    expect(normaliseAi(changed, changed)).toBe(changed);
  });

  it('an old project’s block of `{ enabled }` loads with the defaults', () => {
    const r = migrateRender({ ai: { enabled: true } });
    expect(r.ai).toEqual({ ...DEFAULT_AI, enabled: true });
    const garbage = migrateRender({ ai: { enabled: 'yes', intervention: 'a lot', style: 7, seed: 'x' } });
    expect(garbage.ai).toEqual(DEFAULT_AI);
    expect(migrateRender({}).ai).toEqual(DEFAULT_AI);
    // A job of the queue carries its own, with the same rules.
    const withJob = migrateRender({ queue: [{ id: 'j1', settings: { ai: { light: 80 } } }] });
    expect(withJob.queue[0].settings.ai).toEqual({ ...DEFAULT_AI, light: 80 });
  });

  it('survive saving and opening a project file', async () => {
    const store = createStore(createInitialState());
    store.dispatch({ type: 'render/set', patch: { ai: { ...store.get().render.ai, enabled: true, intervention: 77, style: 'CINEMATIC', seed: 123456 } } });
    const file = await serializeProject(store.get()).text();
    expect(parseProject(file).render.ai).toEqual({ ...DEFAULT_AI, enabled: true, intervention: 77, style: 'CINEMATIC', seed: 123456 });
    // A project saved before X4 (`ai: { enabled: false }` only) opens with the defaults.
    const old = JSON.parse(file) as { state: { render: { ai: unknown } } };
    old.state.render.ai = { enabled: false };
    const opened = migrateProject(old);
    expect(opened.render.ai).toEqual(DEFAULT_AI);
  });
});

describe('changing a control', () => {
  const controls: [keyof AiSettings, AiSettings[keyof AiSettings]][] = [
    ['enabled', true],
    ['intervention', 80],
    ['light', 10],
    ['bounce', 90],
    ['wear', 0],
    ['style', 'COOL'],
    ['styleStrength', 65],
    ['previewFullEngine', true],
    ['seed', 987],
  ];

  it.each(controls)('%s is a store action: undoable and redoable, with its own label', (key, value) => {
    const ctx = makeCtx();
    const before = ctx.store.get().render.ai;
    cmd.setRenderSettings(ctx, { ai: { ...before, [key]: value } }, undefined, L('undo.ai', { what: L('rw.ai.light') }));
    expect(ctx.store.get().render.ai[key]).toBe(value);
    expect(ctx.store.history().undo[0]).toBe(L('undo.ai', { what: L('rw.ai.light') }).en);
    ctx.store.undo();
    expect(ctx.store.get().render.ai).toEqual(before);
    ctx.store.redo();
    expect(ctx.store.get().render.ai[key]).toBe(value);
  });

  it('a slider drag, many changes under one gesture, is one undo step', () => {
    const ctx = makeCtx();
    const before = ctx.store.get().render.ai;
    for (let v = 51; v <= 90; v++) cmd.setRenderSettings(ctx, { ai: { ...ctx.store.get().render.ai, light: v } }, 'slide1', L('undo.ai', { what: L('rw.ai.light') }));
    expect(ctx.store.get().render.ai.light).toBe(90);
    expect(ctx.store.history().undo).toHaveLength(1);
    ctx.store.undo();
    expect(ctx.store.get().render.ai).toBe(before);
    // A second drag is a second step.
    cmd.setRenderSettings(ctx, { ai: { ...before, light: 12 } }, 'slide2');
    cmd.setRenderSettings(ctx, { ai: { ...ctx.store.get().render.ai, bounce: 3 } }, 'slide3');
    expect(ctx.store.history().undo).toHaveLength(2);
  });

  it('editing a queued job changes its draft, not the project', () => {
    const ctx = makeCtx();
    ctx.store.dispatch({ type: 'render/enqueue', at: 1, position: 'LAST' });
    const job = ctx.store.get().render.queue[0];
    cmd.editJob(ctx, job.id);
    cmd.setRenderSettings(ctx, { ai: { ...cmd.windowSettings(ctx).ai, light: 99 } });
    expect(ctx.store.get().render.ai.light).toBe(50);
    expect(cmd.windowSettings(ctx).ai.light).toBe(99);
    cmd.saveJobEdit(ctx);
    expect(ctx.store.get().render.queue[0].settings.ai.light).toBe(99);
    expect(ctx.store.get().render.ai.light).toBe(50);
  });
});

describe('Another variation', () => {
  it('gives a new seed every time and never repeats one soon', () => {
    const seen = new Set<number>();
    let seed = 0;
    for (let i = 0; i < 5000; i++) {
      const next = nextSeed(seed);
      expect(next).not.toBe(seed);
      expect(Number.isInteger(next) && next >= 0 && next <= 0xffffffff).toBe(true);
      expect(seen.has(next)).toBe(false);
      seen.add(next);
      seed = next;
    }
  });

  it('is an undoable change of the seed alone', () => {
    const ctx = makeCtx();
    const before = ctx.store.get().render.ai;
    cmd.setRenderSettings(ctx, { ai: { ...before, seed: nextSeed(before.seed) } });
    expect(ctx.store.get().render.ai).toEqual({ ...before, seed: nextSeed(0) });
    ctx.store.undo();
    expect(ctx.store.get().render.ai.seed).toBe(0);
  });
});

describe('jobs and new projects', () => {
  it('a job copies the AI settings it was made with', () => {
    const ctx = makeCtx();
    cmd.setRenderSettings(ctx, { ai: { ...ctx.store.get().render.ai, enabled: true, style: 'WARM', seed: 5 } });
    ctx.store.dispatch({ type: 'render/enqueue', at: 1, position: 'LAST' });
    // Later changes of the window do not reach the job.
    cmd.setRenderSettings(ctx, { ai: { ...ctx.store.get().render.ai, style: 'COOL', seed: 6 } });
    const job = ctx.store.get().render.queue[0];
    expect(job.settings.ai).toMatchObject({ enabled: true, style: 'WARM', seed: 5 });
    expect(ctx.store.get().render.ai).toMatchObject({ style: 'COOL', seed: 6 });
  });

  it('a new project starts from Settings’ default intervention; the open one never changes', () => {
    const settings = withSetting(defaultSettings(), 'ai.intervention', 55);
    const fresh = withProjectDefaults(createInitialState(), settings);
    expect(fresh.render.ai).toEqual({ ...DEFAULT_AI, intervention: 55 });
    const ctx = makeCtx();
    cmd.setSetting(ctx, 'ai.intervention', 10);
    expect(ctx.store.get().render.ai.intervention).toBe(50);
    cmd.newProject(ctx);
    expect(ctx.store.get().render.ai.intervention).toBe(10);
  });
});

describe('the strings of the section', () => {
  it('exist in both languages with the same placeholders', () => {
    setLang('es');
    const es = [t('rw.ai.light'), t('rw.aiVariation'), t('rw.aiProt.text'), t('rv.aiChecked', { items: 'x' }), t('rv.aiLimited', { pct: 23 })];
    setLang('en');
    const en = [t('rw.ai.light'), t('rw.aiVariation'), t('rw.aiProt.text'), t('rv.aiChecked', { items: 'x' }), t('rv.aiLimited', { pct: 23 })];
    expect(en).toEqual(['Light', 'Another variation', 'Text and logos', 'Checked: x', 'The AI was limited to 23 % to respect the protections']);
    expect(es).toEqual(['Luz', 'Otra variación', 'Texto y logotipos', 'Comprobado: x', 'La IA se limitó al 23 % para respetar las protecciones']);
  });
});

// Phase X4b, the words of the AI post-processing: Settings' system prompt, the scene's prompt and the job's own, in
// that order, the fixed negative apart and intact; the job's own only for a model that takes a text prompt
// (`textPrompt` in ai-models.json or an imported model's manifest); for a model that reads a limited number of tokens
// (SD 1.5's CLIP: 77) the default's short form and the cuts, the job's prompt first, then the scene's, then the
// system's, by a conservative estimate. And the job's prompt and its number of variants in the store: normalised,
// saved with the project, undoable (a visit to the field is one entry), copied by each queued job.

import { describe, expect, it } from 'vitest';
import { buildPrompt, NEGATIVE_PROMPT, scenePromptText } from '../src/ai/prompt';
import { DEFAULT_AI_PIPELINE, MAX_USER_PROMPT, MAX_VARIANTS, type AiPipelineSettings } from '../src/core/ai';
import { aiFileName, promptCaps, variantSeed, variantSettings } from '../src/core/ai-post';
import { composePrompt, DEFAULT_SYSTEM_PROMPT, estimatePromptTokens, isDefaultSystemPrompt, MAX_SYSTEM_PROMPT, normaliseSystemPrompt, normaliseUserPrompt, OPEN_PROMPT_CAPS, SHORT_SYSTEM_PROMPT, systemPromptFor } from '../src/core/ai-prompt';
import { allModels, emptySnapshot, validateManifest, type ModelView } from '../src/core/models';
import { DEFAULT_AI, defaultRenderSettings, migrateRender, patchSettings } from '../src/core/render';
import { defaultSettings, migrateDoc, resetSetting, validateSettings, withSetting } from '../src/core/settings';
import { createInitialState, createStore } from '../src/core/store';
import { AI_MODELS } from '../src/data/ai-models';
import { migrateProject, parseProject, serializeProject } from '../src/io/project';
import { promptContext } from '../src/ui/ai-query';
import * as cmd from '../src/ui/commands';
import { cutText, promptLine } from '../src/ui/panels/ai-post';
import { systemPromptLine } from '../src/ui/panels/settings-ai';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { L, setLang, STRINGS, t } from '../src/ui/strings';
import { createUiStore, defaultUiState } from '../src/ui/ui-state';
import { exampleState } from './helpers';

const settings = (patch: Partial<AiPipelineSettings> = {}): AiPipelineSettings => ({ ...DEFAULT_AI_PIPELINE, ...patch });
const CLIP = { textPrompt: true, maxPromptTokens: 77 } as const;
const OPEN = OPEN_PROMPT_CAPS;

describe('the prompt that goes to the model', () => {
  it('is the system prompt, then the scene’s, then the job’s own; the negative stays the fixed one', () => {
    const state = exampleState();
    const scene = scenePromptText(state, settings());
    const p = buildPrompt(state, settings({ userPrompt: 'Late afternoon light, a calm mood' }), { system: DEFAULT_SYSTEM_PROMPT, caps: OPEN });
    expect(p.negative).toBe(NEGATIVE_PROMPT);
    const at = [p.prompt.indexOf(DEFAULT_SYSTEM_PROMPT), p.prompt.indexOf(scene), p.prompt.indexOf('Late afternoon light, a calm mood')];
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(p.prompt).toBe(`${DEFAULT_SYSTEM_PROMPT} ${scene} Late afternoon light, a calm mood`);
    // The job's words never take the scene's place, and the negative does not take them in.
    expect(p.negative).not.toContain('afternoon');
    expect(p.composed).toMatchObject({ limit: null, shortSystem: false, userNotSent: false, cut: { system: 'NONE', scene: 'NONE', user: 'NONE' } });
  });

  it('without a context it is the scene’s alone, as before X4b', () => {
    const state = exampleState();
    const p = buildPrompt(state, settings({ userPrompt: 'golden hour' }));
    expect(p.prompt).toBe(scenePromptText(state, settings()));
    expect(p.composed).toBeUndefined();
  });

  it('an empty system prompt or job prompt adds nothing; a part without a full stop gets one before the next', () => {
    expect(composePrompt({ system: '', scene: 'A bottle.', user: '' }, OPEN).prompt).toBe('A bottle.');
    expect(composePrompt({ system: 'photoreal', scene: 'A bottle.', user: 'soft light' }, OPEN).prompt).toBe('photoreal. A bottle. soft light');
    expect(composePrompt({ system: '  \n', scene: 'A bottle.', user: '  ' }, OPEN).prompt).toBe('A bottle.');
  });

  it('a model without `textPrompt` gets nothing of the job’s own, and says it was not sent', () => {
    const c = composePrompt({ system: 'photoreal.', scene: 'A bottle.', user: 'warm light' }, { textPrompt: false, maxPromptTokens: null });
    expect(c.prompt).toBe('photoreal. A bottle.');
    expect(c.userNotSent).toBe(true);
    expect(composePrompt({ system: '', scene: 'A bottle.', user: '' }, { textPrompt: false, maxPromptTokens: null }).userNotSent).toBe(false);
    // The line under the field says why, with the model's name when it is known.
    expect(promptLine(c, false, 'My model')).toBe('My model does not take a text prompt: what is written here is not sent.');
    expect(promptLine(c, false, null)).toBe('The model in use does not take a text prompt: what is written here is not sent.');
  });
});

describe('a model that reads 77 tokens (SD 1.5’s CLIP)', () => {
  it('gets the default’s short form while the default is unedited, and the person’s own text when it is not', () => {
    expect(systemPromptFor(DEFAULT_SYSTEM_PROMPT, CLIP)).toEqual({ text: SHORT_SYSTEM_PROMPT, short: true });
    // The same words with other spaces and line breaks are still the default.
    expect(systemPromptFor(DEFAULT_SYSTEM_PROMPT.replace(/\. /g, '.\n\n'), CLIP).short).toBe(true);
    expect(isDefaultSystemPrompt(`  ${DEFAULT_SYSTEM_PROMPT}  `)).toBe(true);
    expect(systemPromptFor('Clean studio photo.', CLIP)).toEqual({ text: 'Clean studio photo.', short: false });
    // Without a limit, the default as it is.
    expect(systemPromptFor(DEFAULT_SYSTEM_PROMPT, OPEN)).toEqual({ text: DEFAULT_SYSTEM_PROMPT, short: false });
  });

  it('the short form fits on its own, the long one does not', () => {
    expect(estimatePromptTokens(SHORT_SYSTEM_PROMPT) + 2).toBeLessThanOrEqual(77);
    expect(estimatePromptTokens(DEFAULT_SYSTEM_PROMPT) + 2).toBeGreaterThan(77);
  });

  it('cuts the job’s prompt first, then the scene’s, then the system’s, and says what it left out', () => {
    const scene = 'Professional product photograph of an object made of Gold (metal) and Glass. Lit with rembrandt lighting.';
    const user = 'warm evening light, a soft glow';
    // Everything fits: nothing is cut.
    const small = composePrompt({ system: 'photo.', scene: 'A bottle.', user: 'warm light' }, CLIP);
    expect(small.cut).toEqual({ system: 'NONE', scene: 'NONE', user: 'NONE' });
    expect(small.prompt).toBe('photo. A bottle. warm light');
    // The short form and the scene leave no room for the job's prompt: it goes first, all of it, then the end of the scene.
    const c = composePrompt({ system: DEFAULT_SYSTEM_PROMPT, scene, user }, CLIP);
    expect(c.shortSystem).toBe(true);
    expect(c.cut).toEqual({ system: 'NONE', scene: 'PART', user: 'ALL' });
    expect(c.prompt.startsWith(SHORT_SYSTEM_PROMPT)).toBe(true);
    expect(c.prompt).toContain('Professional product photograph');
    expect(c.prompt).not.toContain('warm evening');
    expect(c.tokens + 2).toBeLessThanOrEqual(77);
    // A short scene leaves room for part of the job's prompt: its end is cut, the scene is whole.
    const d = composePrompt({ system: DEFAULT_SYSTEM_PROMPT, scene: 'A bottle.', user: 'warm evening light with a soft glow on the left and a cool rim on the right side of the bottle' }, CLIP);
    expect(d.cut).toEqual({ system: 'NONE', scene: 'NONE', user: 'PART' });
    expect(d.prompt).toContain(`${SHORT_SYSTEM_PROMPT}. A bottle. warm`);
    expect(d.tokens + 2).toBeLessThanOrEqual(77);
    // An edited system prompt too long for the model alone: the job's and the scene's go first, then its end.
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const e = composePrompt({ system: long, scene: 'A bottle.', user: 'warm' }, CLIP);
    expect(e.cut).toEqual({ system: 'PART', scene: 'ALL', user: 'ALL' });
    expect(e.prompt.startsWith('word0 word1')).toBe(true);
    expect(e.tokens + 2).toBeLessThanOrEqual(77);
    // The line under the job's field names what was left out, in order.
    expect(cutText(c.cut)).toBe('your prompt, the end of the scene’s description');
    expect(promptLine(c, true, null)).toBe('Too long for this model (77 tokens); left out: your prompt, the end of the scene’s description');
    expect(promptLine(small, true, null)).toBe(`≈ ${small.tokens + 2} of the 77 tokens this model reads`);
    setLang('es');
    try {
      expect(promptLine(c, true, null)).toBe('Demasiado largo para este modelo (77 tokens); no entra: tu prompt, el final de la descripción de la escena');
    } finally {
      setLang('en');
    }
  });

  it('the estimate is conservative: every word one token at least, signs and digits one each, long words more', () => {
    expect(estimatePromptTokens('')).toBe(0);
    expect(estimatePromptTokens('a bottle')).toBe(3);
    expect(estimatePromptTokens('photorealistic')).toBe(3);
    expect(estimatePromptTokens('true-to-life')).toBe(5);
    expect(estimatePromptTokens('1024 px')).toBe(5);
    expect(estimatePromptTokens('camión')).toBe(2);
    expect(estimatePromptTokens('...')).toBe(3);
    // Never fewer than the words and signs (what CLIP splits before its merges).
    const text = 'photorealistic product photo, same composition, geometry, materials and labels';
    expect(estimatePromptTokens(text)).toBeGreaterThanOrEqual(text.split(/\s+/).length + (text.match(/,/g) ?? []).length);
  });

  it('the Settings line says which form the model in use gets, or that it does not fit', () => {
    const sd15 = { label: { en: 'SD 1.5 light', es: 'SD 1.5 ligero' }, maxPromptTokens: 77 };
    expect(systemPromptLine(DEFAULT_SYSTEM_PROMPT, sd15)).toBe('SD 1.5 light reads at most 77 tokens: it gets the short form of this prompt');
    expect(systemPromptLine('Clean studio photo.', sd15)).toMatch(/^≈ \d+ of the 77 tokens SD 1\.5 light reads; /);
    expect(systemPromptLine(Array.from({ length: 80 }, () => 'word').join(' '), sd15)).toBe('Too long for SD 1.5 light (77 tokens): the end of this prompt is left out, after the scene’s description and the job’s prompt');
    // A model without a limit, or none known: no line.
    expect(systemPromptLine(DEFAULT_SYSTEM_PROMPT, { ...sd15, maxPromptTokens: null })).toBe('');
    expect(systemPromptLine(DEFAULT_SYSTEM_PROMPT, null)).toBe('');
  });
});

describe('what the models do with words (ai-models.json `capabilities`)', () => {
  const models = allModels({ catalogue: AI_MODELS, imported: [] });
  it('every model of the catalogue takes a text prompt; SD 1.5 reads 77 tokens, the others have no limit to fit to', () => {
    for (const m of models) expect(m.textPrompt, m.key).toBe(true);
    expect(models.find((m) => m.key === 'SD15_LIGHT')!.maxPromptTokens).toBe(77);
    for (const m of models.filter((x) => x.key !== 'SD15_LIGHT')) expect(m.maxPromptTokens, m.key).toBeNull();
  });

  it('an imported model declares them in its manifest; without them it takes no text prompt, and CLIP families read 77', () => {
    const base = { format: 'repackshot-model', schema: 1, name: 'Mine', family: 'z-image', role: 'img2img', quantization: 'Q4_0', licence: { spdx: 'Apache-2.0', url: 'https://example.com/l', commercialUse: true }, files: [{ name: 'a.gguf', role: 'transformer', bytes: 10 }], source: 'https://example.com' };
    const parse = (raw: unknown) => {
      const r = validateManifest(raw, {});
      if (!r.ok) throw new Error(JSON.stringify(r.problems));
      return allModels({ catalogue: { ...AI_MODELS, models: [] }, imported: [r.model] })[0];
    };
    expect(parse(base)).toMatchObject({ textPrompt: false, maxPromptTokens: null });
    expect(parse({ ...base, capabilities: { textPrompt: true } })).toMatchObject({ textPrompt: true, maxPromptTokens: null });
    expect(parse({ ...base, capabilities: { textPrompt: true, maxPromptTokens: 256 } })).toMatchObject({ textPrompt: true, maxPromptTokens: 256 });
    expect(parse({ ...base, family: 'sdxl', capabilities: { textPrompt: true } })).toMatchObject({ textPrompt: true, maxPromptTokens: 77 });
    const bad = validateManifest({ ...base, capabilities: { textPrompt: 'yes', maxPromptTokens: 3 } }, {});
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.map((p) => p.field)).toEqual(['capabilities.textPrompt', 'capabilities.maxPromptTokens']);
  });

  it('the model that will run decides: the service’s active one, its capabilities; the synthetic one takes any; an unknown one none', () => {
    const view = (k: string) => models.find((m) => m.key === k) as ModelView;
    expect(promptCaps({ backend: 'CPU' }, view('SD15_LIGHT'))).toEqual({ textPrompt: true, maxPromptTokens: 77 });
    expect(promptCaps({ backend: 'VULKAN' }, view('ZIMAGE_Q4'))).toEqual({ textPrompt: true, maxPromptTokens: null });
    expect(promptCaps({ backend: 'SYNTHETIC' }, null)).toEqual({ textPrompt: true, maxPromptTokens: null });
    expect(promptCaps({ backend: 'CPU' }, null)).toEqual({ textPrompt: false, maxPromptTokens: null });
    // From the interface's state: the system prompt of Settings and the active model of the service.
    const u = { ...defaultUiState(), models: { ...emptySnapshot(AI_MODELS), ready: true, installed: ['SD15_LIGHT'] } };
    u.settings = withSetting(u.settings, 'ai.systemPrompt', 'Clean studio photo.');
    const pc = promptContext(u, { activeModel: 'SD15_LIGHT', backend: 'CPU' });
    expect(pc.system).toBe('Clean studio photo.');
    expect(pc.caps).toEqual({ textPrompt: true, maxPromptTokens: 77 });
    expect(pc.model?.key).toBe('SD15_LIGHT');
  });
});

describe('the system prompt in Settings', () => {
  it('starts as the lead’s default, exactly, and Restore default brings it back', () => {
    expect(defaultSettings()['ai.systemPrompt']).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(DEFAULT_SYSTEM_PROMPT.startsWith('Photorealistic product photograph. Keep the image exactly as rendered:')).toBe(true);
    expect(DEFAULT_SYSTEM_PROMPT.endsWith('No stylisation, no added objects or props, no change of background.')).toBe(true);
    expect(SHORT_SYSTEM_PROMPT).toBe('photorealistic product photo, same composition, geometry, materials and labels, same lighting and depth of field, natural soft shadows, subtle bounce light, realistic highlights, fine micro-detail, true-to-life colours, nothing added');
    const edited = withSetting(defaultSettings(), 'ai.systemPrompt', '  Clean studio photo.\r\n ');
    expect(edited['ai.systemPrompt']).toBe('Clean studio photo.');
    expect(resetSetting(edited, 'ai.systemPrompt')['ai.systemPrompt']).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('may be empty (no system prompt), is at most MAX_SYSTEM_PROMPT characters and is read back from the stored document', () => {
    expect(withSetting(defaultSettings(), 'ai.systemPrompt', '')['ai.systemPrompt']).toBe('');
    expect(withSetting(defaultSettings(), 'ai.systemPrompt', 'x'.repeat(5000))['ai.systemPrompt']).toHaveLength(MAX_SYSTEM_PROMPT);
    expect(normaliseSystemPrompt(7)).toBeNull();
    expect(validateSettings({ 'ai.systemPrompt': 42 })['ai.systemPrompt']).toBe(DEFAULT_SYSTEM_PROMPT);
    const doc = migrateDoc({ schema: 1, settings: { 'ai.systemPrompt': 'Clean studio photo.' }, layout: {} });
    expect(doc.settings['ai.systemPrompt']).toBe('Clean studio photo.');
    // A document of before X4b has none: the default.
    expect(migrateDoc({ schema: 1, settings: {}, layout: {} }).settings['ai.systemPrompt']).toBe(DEFAULT_SYSTEM_PROMPT);
  });
});

describe('the job’s own prompt and its variants in the store', () => {
  function makeCtx(): Ctx {
    return { store: createStore(exampleState()), ui: createUiStore(), services: { projectFiles: { adopt: () => undefined } } as unknown as AppServices };
  }

  it('start empty and at one; the prompt is trimmed to 400 characters, the variants are an integer 1..8', () => {
    expect(defaultRenderSettings().ai).toMatchObject({ userPrompt: '', variants: 1 });
    const s = patchSettings(defaultRenderSettings(), { ai: { ...DEFAULT_AI, userPrompt: `  ${'a'.repeat(500)}  `, variants: 12.4 } });
    expect(s.ai.userPrompt).toHaveLength(MAX_USER_PROMPT);
    expect(s.ai.variants).toBe(MAX_VARIANTS);
    expect(patchSettings(defaultRenderSettings(), { ai: { ...DEFAULT_AI, variants: 0 } }).ai.variants).toBe(1);
    expect(patchSettings(defaultRenderSettings(), { ai: { ...DEFAULT_AI, variants: 3.6 } }).ai.variants).toBe(4);
    expect(patchSettings(defaultRenderSettings(), { ai: { ...DEFAULT_AI, userPrompt: ' soft\r\nlight ' } }).ai.userPrompt).toBe('soft\nlight');
    expect(normaliseUserPrompt(12)).toBe('');
    // Garbage keeps what there was.
    expect(migrateRender({ ai: { userPrompt: 9, variants: 'many' } }).ai).toMatchObject({ userPrompt: '', variants: 1 });
  });

  it('a project of before X4b opens with no prompt and one variant; both survive saving and opening', async () => {
    const store = createStore(createInitialState());
    store.dispatch({ type: 'render/set', patch: { ai: { ...store.get().render.ai, enabled: true, userPrompt: 'Late afternoon light', variants: 4 } } });
    const file = await serializeProject(store.get()).text();
    expect(parseProject(file).render.ai).toEqual({ ...DEFAULT_AI, enabled: true, userPrompt: 'Late afternoon light', variants: 4 });
    const old = JSON.parse(file) as { state: { render: { ai: Record<string, unknown> } } };
    delete old.state.render.ai.userPrompt;
    delete old.state.render.ai.variants;
    expect(migrateProject(old).render.ai).toMatchObject({ enabled: true, userPrompt: '', variants: 1 });
  });

  it('a visit to the field is one undo entry, however many times it committed; the next visit another', () => {
    const ctx = makeCtx();
    const label = L('undo.ai', { what: L('rw.aiPrompt') });
    const type = (text: string, gesture: string) => cmd.setRenderSettings(ctx, { ai: { ...ctx.store.get().render.ai, userPrompt: text } }, gesture, label);
    // Typing stops twice, then the field is left: three commits of one visit.
    type('Late', 'text1');
    type('Late afternoon', 'text1');
    type('Late afternoon light', 'text1');
    expect(ctx.store.history().undo).toEqual([label.en]);
    // Another visit.
    type('Late afternoon light, calm', 'text2');
    expect(ctx.store.history().undo).toHaveLength(2);
    ctx.store.undo();
    expect(ctx.store.get().render.ai.userPrompt).toBe('Late afternoon light');
    ctx.store.undo();
    expect(ctx.store.get().render.ai.userPrompt).toBe('');
    ctx.store.redo();
    expect(ctx.store.get().render.ai.userPrompt).toBe('Late afternoon light');
  });

  it('the number of variants is undoable, and a drag of the field one entry', () => {
    const ctx = makeCtx();
    const label = L('undo.ai', { what: L('rw.aiVariants') });
    for (const n of [2, 3, 4]) cmd.setRenderSettings(ctx, { ai: { ...ctx.store.get().render.ai, variants: n } }, 'drag1', label);
    expect(ctx.store.history().undo).toEqual([label.en]);
    expect(label.es).toBe('Post-procesado IA: Variantes');
    ctx.store.undo();
    expect(ctx.store.get().render.ai.variants).toBe(1);
  });

  it('each queued job keeps its own prompt and number of variants', () => {
    const ctx = makeCtx();
    cmd.setRenderSettings(ctx, { ai: { ...ctx.store.get().render.ai, enabled: true, userPrompt: 'first', variants: 3 } });
    cmd.enqueue(ctx);
    cmd.setRenderSettings(ctx, { ai: { ...ctx.store.get().render.ai, userPrompt: 'second', variants: 1 } });
    cmd.enqueue(ctx);
    const [a, b] = ctx.store.get().render.queue;
    expect([a.settings.ai.userPrompt, a.settings.ai.variants]).toEqual(['first', 3]);
    expect([b.settings.ai.userPrompt, b.settings.ai.variants]).toEqual(['second', 1]);
  });
});

describe('variants: seeds and names', () => {
  it('variant n takes the seed plus n − 1, on 32 bits', () => {
    expect([1, 2, 3, 4].map((n) => variantSeed(7, n))).toEqual([7, 8, 9, 10]);
    expect(variantSeed(0xffffffff, 2)).toBe(0);
    expect(variantSettings({ ...DEFAULT_AI_PIPELINE, seed: 40 }, 3).seed).toBe(42);
  });

  it('the files are named `_AI`, `_AI_2`, `_AI_3`…', () => {
    expect(aiFileName('Bottle_0001.png')).toBe('Bottle_0001_AI.png');
    expect(aiFileName('Bottle_0001.png', 1)).toBe('Bottle_0001_AI.png');
    expect(aiFileName('Bottle_0001.png', 2)).toBe('Bottle_0001_AI_2.png');
    expect(aiFileName('a.b.exr', 8)).toBe('a.b_AI_8.exr');
    expect(aiFileName('noext', 3)).toBe('noext_AI_3');
  });
});

describe('the strings of X4b', () => {
  it('exist in English and in Spanish', () => {
    const keys = Object.keys(STRINGS.en).filter((k) => /^(rw\.aiPrompt|rw\.aiCut|rw\.aiVariants|rv\.variant|rv\.saveVariant|rv\.saveAll|rv\.savedAll|queue\.aiVariant|queue\.aiStep|queue\.aiImages|render\.aiVariant|render\.aiStoppedVariants|set\.ai\.sp\.|set\.ai\.systemPrompt|set\.block\.prompt|set\.ai\.form\.textPrompt)/.test(k));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(STRINGS.es[k as keyof typeof STRINGS.es], k).toBeTruthy();
      expect(STRINGS.es[k as keyof typeof STRINGS.es], k).not.toBe('');
    }
    // The note the lead wrote, in both languages.
    expect(t('rw.aiPromptNote')).toBe('Describe the light or the mood; the geometry, the materials and the focus stay protected');
    expect(STRINGS.es['rw.aiPromptNote']).toBe('Describe la luz o el ambiente; la geometría, los materiales y el enfoque siguen protegidos');
  });
});

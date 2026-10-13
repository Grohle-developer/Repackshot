// The scene's prompt for the AI post-processing (phase X3a, src/ai/prompt.ts): pure, deterministic, built from
// the materials, the lights and the style; the fixed negative protects shapes, text and logos. And the guard's
// material table from the RSB material order.

import { describe, expect, it } from 'vitest';
import { allowsWear, buildPrompt, guardMaterials, lockedForGuard, materialName, NEGATIVE_PROMPT, sceneMaterials, STYLE_PROMPTS } from '../src/ai/prompt';
import { AI_STYLES, DEFAULT_AI_PIPELINE, type AiPipelineSettings } from '../src/core/ai';
import { instanceFromPreset } from '../src/core/materials';
import { reduce, type ProjectState } from '../src/core/store';
import { apply, exampleState, keyIds } from './helpers';

const settings = (patch: Partial<AiPipelineSettings> = {}): AiPipelineSettings => ({ ...DEFAULT_AI_PIPELINE, ...patch });

/** The example with an LED on the label (an emitter: no wear, locked), the cap and the base renamed. */
function scene(): ProjectState {
  const state = exampleState();
  const ids = keyIds(state);
  const label = state.scene.nodes[ids.label].material!;
  const cap = state.scene.nodes[ids.cap].material!;
  const base = state.scene.nodes[ids.base].material!;
  const led = instanceFromPreset(label, 'LED_WARM', state.scene.partSizeMm)!;
  return apply(
    { ...state, materials: { ...state.materials, [label]: led } },
    { type: 'material/set', id: cap, patch: { name: 'Brushed brass' } },
    { type: 'material/set', id: base, patch: { name: 'Matte black plastic' } },
  );
}

describe('the scene prompt', () => {
  it('is deterministic: the same state gives the same words, a copy of it too', () => {
    const state = scene();
    const a = buildPrompt(state, settings());
    expect(buildPrompt(state, settings())).toEqual(a);
    expect(buildPrompt(structuredClone(state), settings())).toEqual(a);
    expect(a.prompt.length).toBeGreaterThan(80);
  });

  it('names every visible material with its kind, in the order of the scene', () => {
    const state = scene();
    const { prompt } = buildPrompt(state, settings());
    expect(prompt).toContain('Metallic paint (material)');
    expect(prompt).toContain('Polished chrome (metal)');
    expect(prompt).toContain('Brushed brass (metal)');
    expect(prompt).toContain('Warm LED (light-emitting)');
    // A name that already says its kind does not repeat it.
    expect(prompt).toContain('Matte black plastic');
    expect(prompt).not.toContain('Matte black plastic (plastic)');
    const names = sceneMaterials(state).map(materialName);
    const at = names.map((n) => prompt.indexOf(n));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    // A hidden part's material is not in the picture, so not in the prompt.
    const ids = keyIds(state);
    const hidden = reduce(state, { type: 'scene/setVisible', ids: [ids.cap], visible: false });
    expect(buildPrompt(hidden, settings()).prompt).not.toContain('Brushed brass');
  });

  it('asks for wear only when Wear is on, and only on materials that take it', () => {
    const state = scene();
    const on = buildPrompt(state, settings({ wear: 40 })).prompt;
    const wear = on.slice(on.indexOf('wear and micro-detail on'));
    expect(wear).toContain('Brushed brass');
    expect(wear).not.toContain('LED');
    expect(buildPrompt(state, settings({ wear: 0 })).prompt).not.toMatch(/wear/);
  });

  it('asks for light, bounce and the style only when their controls are on', () => {
    const state = scene();
    const off = buildPrompt(state, settings({ light: 0, bounce: 0, wear: 0, styleStrength: 0, style: 'WARM' })).prompt;
    expect(off).not.toMatch(/penumbra|bounced|warm light mood/);
    const on = buildPrompt(state, settings({ style: 'CINEMATIC', styleStrength: 60 })).prompt;
    expect(on).toContain('penumbras');
    expect(on).toContain('bounced light');
    expect(on).toContain('Cinematic light mood');
    for (const style of AI_STYLES) expect(STYLE_PROMPTS[style].length).toBeGreaterThan(5);
  });

  it('says how the scene is lit', () => {
    const state = scene();
    const { prompt } = buildPrompt(state, settings());
    expect(prompt).toMatch(/Lit with .*lighting/);
    expect(prompt).toContain('studio environment');
    const rembrandt = apply(state, { type: 'studio/setSetup', key: 'REMBRANDT' });
    expect(buildPrompt(rembrandt, settings()).prompt).toContain('rembrandt lighting');
  });

  it('has a fixed negative that protects shapes, text and logos', () => {
    const a = buildPrompt(scene(), settings()).negative;
    const b = buildPrompt(exampleState(), settings({ intervention: 100, style: 'COOL' })).negative;
    expect(a).toBe(NEGATIVE_PROMPT);
    expect(b).toBe(NEGATIVE_PROMPT);
    for (const word of ['shape', 'text', 'logo']) expect(NEGATIVE_PROMPT).toContain(word);
  });
});

describe('the guard material table', () => {
  it('follows the RSB order: index i is materialId i + 1, null is the neutral default', () => {
    const state = scene();
    const ids = keyIds(state);
    const cap = state.scene.nodes[ids.cap].material!;
    const label = state.scene.nodes[ids.label].material!;
    expect(guardMaterials(state, [cap, null, label])).toEqual([
      { materialId: 1, name: 'Brushed brass', allowsWear: true, locked: false },
      { materialId: 2, name: 'Default', allowsWear: false, locked: false },
      { materialId: 3, name: 'Warm LED', allowsWear: false, locked: true },
    ]);
    expect(allowsWear(state.materials[label])).toBe(false);
    expect(lockedForGuard(state.materials[label])).toBe(true);
    expect(lockedForGuard(state.materials[cap])).toBe(false);
  });
});

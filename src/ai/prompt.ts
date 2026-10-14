// The scene's words for the model (AI-POST.md §3.2 step 2, §7.3): a pure, deterministic function of the project
// state and the pipeline settings. The prompt names what the picture shows (the materials, by name and family,
// and which may show wear), how it is lit (the light setup, the environment) and the chosen style; the negative
// is fixed and says not to change shapes, text or logos. The guard enforces all of that anyway (AI-POST.md §1.3):
// the words only make the model's job easier. In English: the models are trained on it.
//
// Also here, for the guard: the material regions as the passes number them (`guardMaterials`).
//
// X4b: the words that go to the model are the system prompt of Settings, then the scene's, then the job's own
// (`AiPipelineSettings.userPrompt`, only for a model that takes a text prompt), fitted to a model that reads a limited
// number of tokens (core/ai-prompt.ts, `composePrompt`). The scene's part never gives way to the job's: it comes first.

import type { AiGuardMaterial, AiPipelineSettings, AiStyle } from '../core/ai';
import { composePrompt, type ComposedPrompt, type PromptCaps } from '../core/ai-prompt';
import type { MaterialId, MaterialInstance } from '../core/materials';
import { allParts, effectiveVisible } from '../core/scene';
import type { ProjectState } from '../core/store';
import { lightSetup } from '../data/light-setups';
import { materialPreset } from '../data/materials';
import { studioPreset } from '../data/studios';
import type { MaterialCategory } from '../data/types';
import { WEAR_FAMILY_TYPES } from '../data/wear';

/** The fixed negative prompt: nothing about the object, its text or its framing may change. */
export const NEGATIVE_PROMPT = [
  'changed shape',
  'deformed geometry',
  'different object',
  'moved or added edges',
  'changed, misspelled or new text',
  'altered or distorted logo',
  'changed materials',
  'changed colours',
  'extra objects',
  'different framing',
  'cropped',
  'blurry',
  'oversharpened',
  'noise',
  'artifacts',
  'watermark',
  'low quality',
].join(', ');

/** What each style asks for: colour and light mood only (AI-POST.md §4). Stable keys of AI_STYLES. */
export const STYLE_PROMPTS: Readonly<Record<AiStyle, string>> = {
  NATURAL: 'natural photographic look',
  CATALOGUE: 'clean catalogue look, even neutral light',
  EDITORIAL: 'editorial look, refined contrast',
  WARM: 'warm light mood',
  COOL: 'cool light mood',
  CINEMATIC: 'cinematic light mood, deeper contrast',
};

/** How a material's category is named in the prompt (the family says less: most are SIMPLE). */
const CATEGORY_WORDS: Readonly<Record<MaterialCategory, string>> = {
  METAL: 'metal',
  PLASTIC: 'plastic',
  WOOD: 'wood',
  FABRIC: 'fabric',
  GLASS: 'glass',
  EMISSIVE: 'light-emitting',
  OTHER: 'material',
};

const ENVIRONMENT_WORDS: Readonly<Record<ProjectState['environment']['kind'], string>> = {
  STUDIO: 'studio environment',
  SKY: 'sky light',
  FLAT: 'flat even environment light',
  HDRI: 'image-based environment light',
};

const BACKGROUND_WORDS: Readonly<Record<ProjectState['environment']['background'], string>> = {
  ENVIRONMENT: 'the environment as background',
  COLOR: 'a plain background',
  TRANSPARENT: 'a plain background',
  BACKPLATE: 'a photographic backplate',
};

export interface ScenePrompt {
  prompt: string;
  negative: string;
  /** How the prompt was composed (X4b), when it was composed with the system prompt and the model's capabilities. */
  composed?: ComposedPrompt;
}

/** What the prompt is composed with besides the scene (X4b): Settings' system prompt and what the model does with words. */
export interface PromptContext {
  system: string;
  caps: PromptCaps;
}

/** A material's name as the user sees it: its own name, else its catalogue label (in English). */
export function materialName(m: MaterialInstance): string {
  if (m.name && m.name.trim()) return m.name.trim();
  const preset = m.origin ? materialPreset(m.origin) : undefined;
  return preset?.label.en ?? 'material';
}

/**
 * Whether the model's mid band (wear, micro-detail) may enter a material: its family takes wear (every family but
 * the emissive one, as the wear catalogue says). Provisional rule: X1b may narrow it (glass, for instance).
 */
export function allowsWear(m: MaterialInstance): boolean {
  return WEAR_FAMILY_TYPES[m.family].size > 0;
}

/** Emitters keep their own light: nothing may change them (provisional, with `allowsWear`). */
export function lockedForGuard(m: MaterialInstance): boolean {
  return m.family === 'EMISSIVE';
}

/** The materials on visible parts, in the order of the scene tree, each once. */
export function sceneMaterials(state: ProjectState): MaterialInstance[] {
  const out: MaterialInstance[] = [];
  const seen = new Set<MaterialId>();
  for (const id of allParts(state)) {
    if (!effectiveVisible(state, id)) continue;
    const node = state.scene.nodes[id];
    const ids = [node.material, ...(node.faceMaterials ?? []).map((f) => f.material)];
    for (const m of ids) {
      if (!m || seen.has(m) || !state.materials[m]) continue;
      seen.add(m);
      out.push(state.materials[m]);
    }
  }
  return out;
}

/** The light setup in force, in words. */
function lightWords(state: ProjectState): string {
  const studio = state.studio;
  const lights = studio.lights.filter((l) => l.enabled);
  const sun = lights.some((l) => l.type === 'SUN');
  const areas = lights.filter((l) => l.type === 'AREA').length;
  const custom = studio.customSetup && studio.customSetup.key === studio.lightSetup ? studio.customSetup : null;
  const setup = custom ? null : lightSetup(studio.lightSetup);
  let name: string;
  if (custom) name = `"${custom.name}" lighting`;
  else if (!setup || setup.key === 'PRESET') {
    const preset = studio.customPreset && studio.customPreset.key === studio.preset ? studio.customPreset : studioPreset(studio.preset);
    name = preset ? `${preset.label.en.toLowerCase()} studio lighting` : 'studio lighting';
  } else name = `${setup.label.en.toLowerCase()} lighting (${setup.intent.en.charAt(0).toLowerCase()}${setup.intent.en.slice(1)})`;
  const parts = [name];
  if (areas > 0) parts.push(`${areas} soft area light${areas === 1 ? '' : 's'}`);
  if (sun) parts.push('sunlight');
  const kelvins = lights.map((l) => l.kelvin).filter((k): k is number => k !== null);
  if (kelvins.length > 0) {
    const mean = kelvins.reduce((a, b) => a + b, 0) / kelvins.length;
    if (mean < 4500) parts.push('warm light');
    else if (mean > 6500) parts.push('cool light');
  }
  return parts.join(', ');
}

/**
 * The prompt and the fixed negative for the project and the pipeline's settings. With a `context` (X4b) the prompt is
 * the system prompt, the scene's and the job's own, in that order and fitted to the model; without one, the scene's
 * alone (as before X4b).
 */
export function buildPrompt(state: ProjectState, settings: AiPipelineSettings, context?: PromptContext): ScenePrompt {
  const scene = scenePromptText(state, settings);
  if (!context) return { prompt: scene, negative: NEGATIVE_PROMPT };
  const composed = composePrompt({ system: context.system, scene, user: settings.userPrompt ?? '' }, context.caps);
  return { prompt: composed.prompt, negative: NEGATIVE_PROMPT, composed };
}

/** The scene's own words: what the picture shows, how it is lit, what the controls ask for and the style. */
export function scenePromptText(state: ProjectState, settings: AiPipelineSettings): string {
  const materials = sceneMaterials(state);
  const named = materials.map((m) => {
    const kind = CATEGORY_WORDS[m.category];
    const name = materialName(m);
    return name.toLowerCase().includes(kind) ? name : `${name} (${kind})`;
  });
  const worn = settings.wear > 0 ? materials.filter(allowsWear).map(materialName) : [];
  const env = state.environment;
  const sentences = [
    'Professional product photograph',
    named.length > 0 ? `of an object made of ${list(named)}` : 'of an object',
  ];
  const out: string[] = [sentences.join(' ') + '.'];
  out.push(`Lit with ${lightWords(state)}; ${ENVIRONMENT_WORDS[env.kind]}, ${BACKGROUND_WORDS[env.background]}.`);
  const asks: string[] = [];
  if (settings.light > 0) asks.push('natural light with soft penumbras and gentle highlight roll-off');
  if (settings.bounce > 0) asks.push('believable bounced light and ambient colour between surfaces');
  if (worn.length > 0) asks.push(`subtle believable wear and micro-detail on ${list(worn)}`);
  if (asks.length > 0) out.push(`${capitalise(list(asks))}.`);
  if (settings.styleStrength > 0) out.push(`${capitalise(STYLE_PROMPTS[settings.style])}.`);
  out.push('Same object, same shapes, same text and logos, same framing.');
  return out.join(' ');
}

/**
 * The guard's material table: `order[i]` is the project material of RSB material index `i` (null for the
 * neutral material of a part without one), as the RSB writer numbers them; the passes call it `i + 1`.
 */
export function guardMaterials(state: ProjectState, order: readonly (MaterialId | null)[]): AiGuardMaterial[] {
  return order.map((id, i) => {
    const m = id ? state.materials[id] : undefined;
    if (!m) return { materialId: i + 1, name: 'Default', allowsWear: false, locked: false };
    return { materialId: i + 1, name: materialName(m), allowsWear: allowsWear(m), locked: lockedForGuard(m) };
  });
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

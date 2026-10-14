// Plugins (ROADMAP P6, ARCHITECTURE.md §9): what the interface and the host agree on, pure. The manifest a plugin
// carries (`manifest.json` in its package) and its check; the controls it declares, which the render window draws
// generically, and their values; the plugin settings a project keeps in its render settings
// (`RenderSettings.plugins`, undoable and saved); and the provenance of a result a plugin made.
//
// No runtime imports: tools/plugin-pack.mjs and tools/plugins/build-film.mjs read this file with Node's type
// stripping to check a manifest before packing it.

/** The host ABI this build speaks (the messages of src/plugins/abi.ts). */
export const PLUGIN_ABI = 1;

/** Where a plugin can appear. One today: a block of the render window's Plugins section. */
export const PLUGIN_SLOTS = ['render.plugins'] as const;
export type PluginSlot = (typeof PLUGIN_SLOTS)[number];

/** Words a plugin brings in both languages (its own content, like a catalogue's label). */
export interface PluginLabel {
  en: string;
  es: string;
}

export type PluginControlValue = number | boolean | string;

interface ControlBase {
  key: string;
  label: PluginLabel;
  /** The group it is drawn under (one of the manifest's `groups` when it lists them). */
  group: string;
  /** A line under the control. */
  aux?: PluginLabel;
}

export interface PluginSliderControl extends ControlBase {
  kind: 'slider';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  /** What the value reads at `min` instead of the number: the plugin sends its own value there (the recipe's). */
  minLabel?: PluginLabel;
  /**
   * `seed`: the seed of what the plugin draws at random (its grain). An animation's frames are given their own,
   * `seed0 + frame` (decision 9: SEED_RULE); a whole-number slider, one in a manifest.
   */
  role?: 'seed';
}

export interface PluginSelectControl extends ControlBase {
  kind: 'select';
  options: { value: string; label: PluginLabel }[];
  default: string;
}

export interface PluginToggleControl extends ControlBase {
  kind: 'toggle';
  default: boolean;
}

export type PluginControl = PluginSliderControl | PluginSelectControl | PluginToggleControl;

/** The licence of a plugin: closed, said plainly, with its full text in the package. */
export interface PluginLicence {
  kind: 'closed';
  label: PluginLabel;
  /** The file of the package with the full text. */
  file?: string;
}

export interface PluginManifest {
  abi: number;
  id: string;
  name: PluginLabel;
  version: string;
  publisher: string;
  licence: PluginLicence;
  homepage: string;
  summary: PluginLabel;
  /** The line the block shows under the name (a preview of an app in development…). */
  notice: PluginLabel;
  /** The logo, a file of the package (an SVG). */
  logo: string;
  slots: PluginSlot[];
  /** The plugin's code: an ES module run in a worker without DOM. */
  entry: string;
  /** Its WebAssembly module, when it has one; `noImports`: the host refuses a module that imports anything. */
  wasm: { file: string; noImports: boolean } | null;
  /** The third-party notices of what the plugin carries, a file of the package. */
  notices?: string;
  /**
   * The picture its recipes are shown on (decision 8): a PNG of the package, through the plugin once per recipe for
   * the recipe cards, and what the preview shows before there is a result.
   */
  base?: string;
  groups: { id: string; label: PluginLabel }[];
  controls: PluginControl[];
  /** Every file of the package the plugin reads (sent to it at start), besides the entry. */
  files: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const PLUGIN_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const CONTROL_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const FILE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const MAX_CONTROLS = 128;

function label(v: unknown): PluginLabel | null {
  return isRecord(v) && typeof v.en === 'string' && typeof v.es === 'string' && v.en.trim() !== '' && v.es.trim() !== '' && v.en.length <= 400 && v.es.length <= 400 ? { en: v.en, es: v.es } : null;
}

const fileName = (v: unknown): v is string => typeof v === 'string' && v.length <= 255 && FILE.test(v) && !v.split('/').includes('..');
const httpsUrl = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) && v.length <= 2048;

function control(raw: unknown, groups: Set<string> | null, problems: string[], at: string): PluginControl | null {
  if (!isRecord(raw)) {
    problems.push(`${at}: not an object`);
    return null;
  }
  const n = problems.length;
  const key = raw.key;
  const lab = label(raw.label);
  const group = raw.group;
  if (typeof key !== 'string' || !CONTROL_KEY.test(key)) problems.push(`${at}.key`);
  if (!lab) problems.push(`${at}.label`);
  if (typeof group !== 'string' || group === '' || (groups && !groups.has(group))) problems.push(`${at}.group`);
  const aux = raw.aux === undefined ? undefined : label(raw.aux);
  if (aux === null) problems.push(`${at}.aux`);
  const base = { key: key as string, label: lab as PluginLabel, group: group as string, ...(aux ? { aux } : {}) };
  if (raw.kind === 'slider') {
    const { min, max, step } = raw;
    const def = raw.default;
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    if (!finite(min) || !finite(max) || !(max > min)) problems.push(`${at}.min/max`);
    if (!finite(step) || !(step > 0)) problems.push(`${at}.step`);
    if (!finite(def) || (finite(min) && def < min) || (finite(max) && def > max)) problems.push(`${at}.default`);
    if (raw.unit !== undefined && (typeof raw.unit !== 'string' || raw.unit.length > 12)) problems.push(`${at}.unit`);
    const minLabel = raw.minLabel === undefined ? undefined : label(raw.minLabel);
    if (minLabel === null) problems.push(`${at}.minLabel`);
    // A seed is a whole number: it goes up by one a frame.
    const whole = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
    if (raw.role !== undefined && (raw.role !== 'seed' || !whole(min) || !whole(max) || step !== 1 || !whole(def))) problems.push(`${at}.role`);
    if (problems.length > n) return null;
    return { ...base, kind: 'slider', min: min as number, max: max as number, step: step as number, default: def as number, ...(typeof raw.unit === 'string' ? { unit: raw.unit } : {}), ...(minLabel ? { minLabel } : {}), ...(raw.role === 'seed' ? { role: 'seed' as const } : {}) };
  }
  if (raw.kind === 'select') {
    const opts = Array.isArray(raw.options) ? raw.options : null;
    const options: { value: string; label: PluginLabel }[] = [];
    if (!opts || opts.length === 0 || opts.length > 256) problems.push(`${at}.options`);
    else {
      const seen = new Set<string>();
      opts.forEach((o, i) => {
        const l = isRecord(o) ? label(o.label) : null;
        if (!isRecord(o) || typeof o.value !== 'string' || o.value === '' || o.value.length > 64 || seen.has(o.value) || !l) problems.push(`${at}.options[${i}]`);
        else {
          seen.add(o.value);
          options.push({ value: o.value, label: l });
        }
      });
    }
    if (typeof raw.default !== 'string' || !options.some((o) => o.value === raw.default)) problems.push(`${at}.default`);
    if (problems.length > n) return null;
    return { ...base, kind: 'select', options, default: raw.default as string };
  }
  if (raw.kind === 'toggle') {
    if (typeof raw.default !== 'boolean') problems.push(`${at}.default`);
    if (problems.length > n) return null;
    return { ...base, kind: 'toggle', default: raw.default as boolean };
  }
  problems.push(`${at}.kind`);
  return null;
}

/** A manifest from its JSON, every field checked: the problems are named in the program's own English. */
export function parseManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!isRecord(raw)) return { ok: false, problems: ['not an object'] };
  const name = label(raw.name);
  const summary = label(raw.summary);
  const notice = label(raw.notice);
  if (raw.abi !== PLUGIN_ABI) problems.push(`abi ${String(raw.abi)} (this host speaks ${PLUGIN_ABI})`);
  if (typeof raw.id !== 'string' || !PLUGIN_ID.test(raw.id)) problems.push('id');
  if (!name) problems.push('name');
  if (typeof raw.version !== 'string' || !/^[0-9A-Za-z.+-]{1,32}$/.test(raw.version)) problems.push('version');
  if (typeof raw.publisher !== 'string' || raw.publisher.trim() === '' || raw.publisher.length > 120) problems.push('publisher');
  const lic = isRecord(raw.licence) ? raw.licence : null;
  const licLabel = lic ? label(lic.label) : null;
  if (!lic || lic.kind !== 'closed' || !licLabel || (lic.file !== undefined && !fileName(lic.file))) problems.push('licence');
  if (!httpsUrl(raw.homepage)) problems.push('homepage');
  if (!summary) problems.push('summary');
  if (!notice) problems.push('notice');
  if (!fileName(raw.logo)) problems.push('logo');
  const slots = Array.isArray(raw.slots) ? raw.slots : null;
  if (!slots || slots.length === 0 || !slots.every((s) => (PLUGIN_SLOTS as readonly unknown[]).includes(s))) problems.push('slots');
  if (!fileName(raw.entry) || !(raw.entry as string).endsWith('.js')) problems.push('entry');
  let wasm: PluginManifest['wasm'] = null;
  if (raw.wasm !== undefined && raw.wasm !== null) {
    if (!isRecord(raw.wasm) || !fileName(raw.wasm.file) || typeof raw.wasm.noImports !== 'boolean') problems.push('wasm');
    else wasm = { file: raw.wasm.file, noImports: raw.wasm.noImports };
  }
  if (raw.notices !== undefined && !fileName(raw.notices)) problems.push('notices');
  if (raw.base !== undefined && (!fileName(raw.base) || !raw.base.toLowerCase().endsWith('.png'))) problems.push('base');
  const files = Array.isArray(raw.files) ? raw.files : null;
  if (!files || files.length > 4096 || !files.every(fileName) || new Set(files).size !== files.length) problems.push('files');
  const groups: { id: string; label: PluginLabel }[] = [];
  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups)) problems.push('groups');
    else
      raw.groups.forEach((g, i) => {
        const l = isRecord(g) ? label(g.label) : null;
        if (!isRecord(g) || typeof g.id !== 'string' || g.id === '' || g.id.length > 32 || groups.some((x) => x.id === g.id) || !l) problems.push(`groups[${i}]`);
        else groups.push({ id: g.id, label: l });
      });
  }
  const controls: PluginControl[] = [];
  const rawControls = raw.controls === undefined ? [] : raw.controls;
  if (!Array.isArray(rawControls) || rawControls.length > MAX_CONTROLS) problems.push('controls');
  else {
    const groupIds = raw.groups === undefined ? null : new Set(groups.map((g) => g.id));
    rawControls.forEach((c, i) => {
      const ctl = control(c, groupIds, problems, `controls[${i}]`);
      if (ctl && controls.some((x) => x.key === ctl.key)) problems.push(`controls[${i}].key (twice)`);
      else if (ctl && ctl.kind === 'slider' && ctl.role === 'seed' && controls.some((x) => x.kind === 'slider' && x.role === 'seed')) problems.push(`controls[${i}].role (a second seed)`);
      else if (ctl) controls.push(ctl);
    });
  }
  if (problems.length > 0) return { ok: false, problems };
  // The groups a manifest does not list are drawn under their id, in the order they first appear.
  for (const c of controls) if (!groups.some((g) => g.id === c.group)) groups.push({ id: c.group, label: { en: c.group, es: c.group } });
  return {
    ok: true,
    manifest: {
      abi: PLUGIN_ABI,
      id: raw.id as string,
      name: name!,
      version: raw.version as string,
      publisher: raw.publisher as string,
      licence: { kind: 'closed', label: licLabel!, ...(lic!.file !== undefined ? { file: lic!.file as string } : {}) },
      homepage: raw.homepage as string,
      summary: summary!,
      notice: notice!,
      logo: raw.logo as string,
      slots: [...new Set(slots as PluginSlot[])],
      entry: raw.entry as string,
      wasm,
      ...(raw.notices !== undefined ? { notices: raw.notices as string } : {}),
      ...(raw.base !== undefined ? { base: raw.base as string } : {}),
      groups,
      controls,
      files: [...(files as string[])],
    },
  };
}

// ------------------------------------------------------------------ control values

/** A slider's value on its step from `min`, inside its range. */
export function clampSlider(c: PluginSliderControl, v: number): number {
  const x = Math.max(c.min, Math.min(c.max, v));
  const steps = Math.round((x - c.min) / c.step);
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(c.step)) + 1));
  const k = 10 ** decimals;
  return Math.max(c.min, Math.min(c.max, Math.round((c.min + steps * c.step) * k) / k));
}

/** One control's value from anything: a valid one as it is (a slider's on its range and step), else the default. */
export function controlValue(c: PluginControl, raw: unknown): PluginControlValue {
  if (c.kind === 'slider') return typeof raw === 'number' && Number.isFinite(raw) ? clampSlider(c, raw) : c.default;
  if (c.kind === 'select') return typeof raw === 'string' && c.options.some((o) => o.value === raw) ? raw : c.default;
  return typeof raw === 'boolean' ? raw : c.default;
}

/** Every control of a manifest at its default. */
export function defaultControls(m: Pick<PluginManifest, 'controls'>): Record<string, PluginControlValue> {
  const out: Record<string, PluginControlValue> = {};
  for (const c of m.controls) out[c.key] = c.default;
  return out;
}

/** The values a plugin is given: every control of its manifest, each from what is kept when valid, else its default. */
export function controlsFor(m: Pick<PluginManifest, 'controls'>, kept: Readonly<Record<string, unknown>> | undefined): Record<string, PluginControlValue> {
  const out: Record<string, PluginControlValue> = {};
  for (const c of m.controls) out[c.key] = controlValue(c, kept?.[c.key]);
  return out;
}

/** The controls as the render window draws them: the manifest's groups in order, each with its controls and values. */
export function controlGroups(m: Pick<PluginManifest, 'groups' | 'controls'>, kept: Readonly<Record<string, unknown>> | undefined): { group: { id: string; label: PluginLabel }; controls: { control: PluginControl; value: PluginControlValue }[] }[] {
  const values = controlsFor(m, kept);
  return m.groups.map((group) => ({ group, controls: m.controls.filter((c) => c.group === group.id).map((control) => ({ control, value: values[control.key] })) })).filter((g) => g.controls.length > 0);
}

/** A slider's value as it reads: its `minLabel` at its left stop, else the number (with its unit). */
export function sliderText(c: PluginSliderControl, v: number, lang: 'en' | 'es', number: (n: number, digits: number) => string): string {
  if (c.minLabel && v <= c.min) return c.minLabel[lang];
  return `${number(v, sliderDigits(c))}${c.unit ? ` ${c.unit}` : ''}`;
}

/** Decimals a slider shows, from its step. */
export function sliderDigits(c: Pick<PluginSliderControl, 'step'>): number {
  return c.step >= 1 ? 0 : c.step >= 0.1 ? 1 : 2;
}

// ------------------------------------------------------------------ a seed a frame (decision 9)

/** The rule an animation's frames take their seed by: the frame's index in the animation added to the seed set. */
export const SEED_RULE = 'seed0+frame';

/** The manifest's seed: the slider with `role: 'seed'`, or null. */
export function seedControl(m: Pick<PluginManifest, 'controls'>): PluginSliderControl | null {
  return m.controls.find((c): c is PluginSliderControl => c.kind === 'slider' && c.role === 'seed') ?? null;
}

/** `seed0 + frame`, wrapped round the slider's range (a seed past its top starts again at its bottom). */
export function frameSeed(c: Pick<PluginSliderControl, 'min' | 'max'>, seed0: number, frame: number): number {
  const span = c.max - c.min + 1;
  const k = (((Math.round(seed0) - c.min + Math.max(0, Math.round(frame))) % span) + span) % span;
  return c.min + k;
}

/**
 * The controls of frame `frame` (0: the first frame of the animation, and a still): the seed advanced by the rule,
 * every other control as it is. A plugin without a seed gets the same controls on every frame.
 */
export function frameControls(m: Pick<PluginManifest, 'controls'>, controls: Readonly<Record<string, PluginControlValue>>, frame: number): Record<string, PluginControlValue> {
  const c = seedControl(m);
  const out = { ...controls };
  if (!c) return out;
  const seed0 = typeof controls[c.key] === 'number' ? (controls[c.key] as number) : c.default;
  out[c.key] = frameSeed(c, seed0, frame);
  return out;
}

/** What the provenance of frame `frame` says of its seed, or nothing for a plugin without one. */
export function seedProvenance(m: Pick<PluginManifest, 'controls'>, controls: Readonly<Record<string, PluginControlValue>>, frame: number): ResultProvenance['seed'] | undefined {
  const c = seedControl(m);
  if (!c) return undefined;
  const seed0 = typeof controls[c.key] === 'number' ? (controls[c.key] as number) : c.default;
  return { control: c.key, seed0, frame: Math.max(0, Math.round(frame)), rule: SEED_RULE };
}

// ------------------------------------------------------------------ the render settings of plugins

/** What a project keeps of one plugin, in its render settings: the recipe chosen and the controls' values. */
export interface PluginRenderSettings {
  /** The recipe's id, or null for the plugin's own default. */
  recipe: string | null;
  controls: Readonly<Record<string, PluginControlValue>>;
  /**
   * The render jobs go through it too (decision 9): every image the queue renders, and every frame of an animation
   * with its own seed (`frameControls`), saved next to the engine's. Off unless it is switched on.
   */
  jobs?: boolean;
  /**
   * The recipe filters chosen (P6b): a value for each filter that narrows the carousel, none for one at All. Kept
   * as they are (a filter the plugin no longer has is All where it runs: `activeFilters`).
   */
  filters?: RecipeFilters;
}

/** The chosen value of each recipe filter (P6b), by the filter's id; a filter that is not here is at All. */
export type RecipeFilters = Readonly<Record<string, string>>;

export type PluginsSettings = Readonly<Record<string, PluginRenderSettings>>;

export const NO_PLUGINS: PluginsSettings = Object.freeze({});

const MAX_PLUGINS = 32;

const FILTER_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const MAX_FILTERS = 8;
const MAX_FILTER_OPTIONS = 32;

function sameRecord(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k]));
}

function sameEntry(a: PluginRenderSettings, b: PluginRenderSettings): boolean {
  return a.recipe === b.recipe && (a.jobs === true) === (b.jobs === true) && sameRecord(a.controls, b.controls) && sameRecord(a.filters ?? {}, b.filters ?? {});
}

/** Recipe filters from anything (a project's): filter ids to short words, at most eight. */
function shapeFilters(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, MAX_FILTERS)) if (FILTER_ID.test(k) && typeof v === 'string' && v !== '' && v.length <= 64) out[k] = v;
  return out;
}

/**
 * The plugin settings from anything that looks like them (an old project has none: `{}`). The shape is checked
 * here; the values against each plugin's manifest where the plugin is (controlsFor), since a project opens on a
 * computer that may not have it installed and must keep what it says. Pure, idempotent, and it returns `base` itself
 * when nothing differs, and an entry of `base` itself when that entry does not.
 */
export function normalisePlugins(raw: unknown, base: PluginsSettings = NO_PLUGINS): PluginsSettings {
  if (!isRecord(raw)) return base;
  const out: Record<string, PluginRenderSettings> = {};
  for (const [id, v] of Object.entries(raw).slice(0, MAX_PLUGINS)) {
    if (!PLUGIN_ID.test(id) || !isRecord(v)) continue;
    const recipe = typeof v.recipe === 'string' && v.recipe.length > 0 && v.recipe.length <= 128 ? v.recipe : null;
    const controls: Record<string, PluginControlValue> = {};
    if (isRecord(v.controls)) {
      for (const [k, x] of Object.entries(v.controls).slice(0, MAX_CONTROLS)) {
        if (!CONTROL_KEY.test(k)) continue;
        if ((typeof x === 'number' && Number.isFinite(x)) || typeof x === 'boolean' || (typeof x === 'string' && x.length <= 128)) controls[k] = x;
      }
    }
    const filters = shapeFilters(v.filters);
    const entry: PluginRenderSettings = { recipe, controls, ...(v.jobs === true ? { jobs: true } : {}), ...(Object.keys(filters).length ? { filters } : {}) };
    const was = base[id];
    out[id] = was && sameEntry(was, entry) ? was : entry;
  }
  const ids = Object.keys(out);
  return ids.length === Object.keys(base).length && ids.every((id) => out[id] === base[id]) ? base : out;
}

/**
 * The settings with one plugin's entry changed: its recipe, some of its controls merged in, its render jobs, or one
 * recipe filter (`filter`: its id and its value, null for All).
 */
export function withPlugin(s: PluginsSettings, id: string, patch: { recipe?: string | null; controls?: Readonly<Record<string, PluginControlValue>>; jobs?: boolean; filter?: { id: string; value: string | null } }): PluginsSettings {
  const was: PluginRenderSettings = s[id] ?? { recipe: null, controls: {} };
  const jobs = patch.jobs !== undefined ? patch.jobs : was.jobs === true;
  let filters: Record<string, string> = { ...(was.filters ?? {}) };
  if (patch.filter) {
    if (patch.filter.value === null) delete filters[patch.filter.id];
    else filters[patch.filter.id] = patch.filter.value;
    filters = shapeFilters(filters);
  }
  return {
    ...s,
    [id]: {
      recipe: patch.recipe !== undefined ? patch.recipe : was.recipe,
      controls: patch.controls ? { ...was.controls, ...patch.controls } : was.controls,
      ...(jobs ? { jobs: true } : {}),
      ...(Object.keys(filters).length ? { filters } : {}),
    },
  };
}

// ------------------------------------------------------------------ recipe filters (P6b)

/**
 * The filters that narrow what is chosen: of `chosen`, only the filters the plugin offers with a value it offers
 * (anything else is All), in the plugin's order.
 */
export function activeFilters(offered: readonly PluginFilter[], chosen: RecipeFilters | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of offered) {
    const v = chosen?.[f.id];
    if (v !== undefined && f.options.some((o) => o.value === v)) out[f.id] = v;
  }
  return out;
}

/**
 * Whether a recipe is one the filters ask for: every filter chosen (they combine: AND) is a tag the recipe has, with
 * that value. A recipe with no tag for a filter (a grain has no ISO) is under that filter's All and nowhere else.
 */
export function presetMatches(p: Pick<PluginPreset, 'tags'>, filters: RecipeFilters): boolean {
  for (const [id, v] of Object.entries(filters)) if (p.tags?.[id] !== v) return false;
  return true;
}

/**
 * The recipes the carousel shows, in the plugin's order, and how many of all of them that is ("23 of 127"). The
 * recipe chosen stays chosen when the filters leave it out: `kept` is it, drawn first and marked as outside them.
 */
export function filterPresets<P extends Pick<PluginPreset, 'id' | 'tags'>>(presets: readonly P[], filters: RecipeFilters, chosen: string | null = null): { shown: P[]; kept: P | null; count: number; total: number } {
  const shown = presets.filter((p) => presetMatches(p, filters));
  const c = chosen === null ? null : (presets.find((p) => p.id === chosen) ?? null);
  return { shown, kept: c && !shown.includes(c) ? c : null, count: shown.length, total: presets.length };
}

// ------------------------------------------------------------------ results

/** Where a result a plugin made comes from (ResultMeta.provenance). */
export interface ResultProvenance {
  plugin: string;
  version: string;
  recipe: string | null;
  controls: Record<string, PluginControlValue>;
  /** The result it was made from. */
  from?: string;
  /** What the results viewer says of it: the plugin's and the recipe's public names when it was made. */
  label?: { plugin: PluginLabel; recipe: PluginLabel | null };
  /**
   * Its seed (decision 9), when the plugin has one: the seed set (`seed0`), the frame's index in the animation (0 for
   * a still and for an animation's first frame) and the rule the seed it was given follows (`seed0 + frame`).
   */
  seed?: { control: string; seed0: number; frame: number; rule: typeof SEED_RULE };
}

/** The file name of a result made by a plugin from `source`: `<name>_<plugin>.<ext>` ("Render_0001_aintfilm-film.png"). */
export function derivedFileName(source: string, pluginId: string, ext: 'png' | 'jpg'): string {
  const slash = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\'));
  const dot = source.lastIndexOf('.');
  const stem = dot > slash && dot > 0 ? source.slice(0, dot) : source;
  return `${stem}_${pluginId}.${ext}`;
}

/**
 * The size a recipe card's picture is made at (decision 8): the base picture, halved, through the plugin. Half of the
 * base's 320×200, since a full-size one takes the film engine about a second a recipe (ROADMAP P6); the card shows
 * it enlarged.
 */
export const THUMB_SIZE = { width: 160, height: 100 } as const;

/** Where a recipe card's picture is kept (IndexedDB): by plugin, version and recipe (`""` for no recipe). */
export function thumbKey(plugin: string, version: string, recipe: string | null): string {
  return `${plugin}@${version}:${recipe ?? ''}`;
}

/** The size an image is drawn at for a preview: its own when it fits `maxWidth`, else scaled to that width (≥ 1 px). */
export function previewSize(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  const k = maxWidth / width;
  return { width: maxWidth, height: Math.max(1, Math.round(height * k)) };
}

// ------------------------------------------------------------------ the host's state, for the interface

/** Why an install or a start did not happen; the interface words each code. */
export type PluginFault =
  /** The package could not be downloaded (the network, or the server's answer: `detail`). */
  | 'DOWNLOAD'
  /** The download is not the size the registry pins. */
  | 'SIZE'
  /** The download's SHA-256 is not the one the registry pins. */
  | 'SHA256'
  /** The file is not a Repackshot plugin. */
  | 'NOT_RPK'
  /** The package's header or its ciphertext is damaged. */
  | 'DAMAGED'
  /** The package is not the plugin or the version the registry names. */
  | 'MISMATCH'
  /** The activation key does not open the package. */
  | 'KEY'
  /** What was typed is not an activation key (32 bytes of base64). */
  | 'BAD_KEY'
  /** The package opened, but its manifest is not valid or names files it does not have. */
  | 'MANIFEST'
  /** The plugin speaks another version of the host's ABI. */
  | 'ABI'
  /** Its WebAssembly module imports something although the manifest says it imports nothing. */
  | 'IMPORTS'
  /** It could not be kept on this computer. */
  | 'STORE'
  /** Its worker did not start or stopped. */
  | 'START';

/** What an install is doing, by plugin id. */
export type PluginTask =
  | { stage: 'DOWNLOADING'; done: number; total: number }
  | { stage: 'VERIFYING' }
  /** Waiting for the person to type the activation key: there is no `keyUrl` (NONE), it did not answer or its key did not open the package (FAILED), or the key typed did not (WRONG). */
  | { stage: 'NEEDS_KEY'; reason: 'NONE' | 'FAILED' | 'WRONG' | 'BAD' }
  | { stage: 'INSTALLING' }
  | { stage: 'FAILED'; fault: PluginFault; detail: string };

/** An installed plugin, as Settings and the render window show it. */
export interface InstalledPlugin {
  id: string;
  version: string;
  /** Bytes of the package kept on this computer. */
  size: number;
  sha256: string;
  source: 'registry' | 'file';
  installedAt: number;
  /** Null when the package no longer opens with its key (`problem` says why). */
  manifest: PluginManifest | null;
  /** The logo of the package, as a `data:` URL, or null. */
  logo: string | null;
  problem: PluginFault | null;
}

export interface PluginsSnapshot {
  /** The installed list has been read. */
  ready: boolean;
  /** Installed plugins survive the session (IndexedDB), or live in memory. */
  persistent: boolean;
  installed: InstalledPlugin[];
  tasks: Readonly<Record<string, PluginTask>>;
}

export type InstallOutcome = { kind: 'DONE'; id: string; version: string } | { kind: 'NEEDS_KEY'; id: string; reason: 'NONE' | 'FAILED' | 'WRONG' | 'BAD' } | { kind: 'FAILED'; fault: PluginFault; detail: string };

// ------------------------------------------------------------------ what a plugin answers (the ABI's, src/plugins/abi.ts)

export type PluginPixels = { kind: 'linear-f32-planes'; data: Float32Array } | { kind: 'rgba8'; data: Uint8ClampedArray };

export interface PluginInfo {
  name: PluginLabel;
  version: string;
  /** What runs, in the plugin's words (the engine's version, wasm…). */
  engine?: string;
}

export interface PluginPreset {
  id: string;
  name: PluginLabel;
  category: string;
  /** A second line (the family, the speed…). */
  aux?: PluginLabel;
  /** Its value for each of the plugin's recipe filters (P6b) that says something of it. */
  tags?: Readonly<Record<string, string>>;
}

/** A recipe filter a plugin offers (P6b): a row of chips over the carousel, All and its options. */
export interface PluginFilter {
  id: string;
  label: PluginLabel;
  options: { value: string; label: PluginLabel }[];
}

export interface PluginPresets {
  categories: { id: string; label: PluginLabel }[];
  presets: PluginPreset[];
  /** The recipe filters, in the order they are drawn; none when the plugin offers none. */
  filters: PluginFilter[];
}

/** One number or word of a render, as the plugin says it (the host draws `label value unit`). */
export interface PluginInfoItem {
  key: string;
  label: PluginLabel;
  value: number | string;
  unit?: string;
}

export interface PluginRenderInfo {
  items: PluginInfoItem[];
}

const isLabelLike = (v: unknown): v is PluginLabel => isRecord(v) && typeof v.en === 'string' && typeof v.es === 'string';

/** The plugin's presets as the host keeps them: well-formed entries only, unique ids, a category for each. */
export function cleanPresets(raw: unknown): PluginPresets {
  const r = isRecord(raw) ? raw : {};
  const categories: PluginPresets['categories'] = [];
  for (const c of Array.isArray(r.categories) ? r.categories : []) {
    if (isRecord(c) && typeof c.id === 'string' && c.id !== '' && isLabelLike(c.label) && !categories.some((x) => x.id === c.id)) categories.push({ id: c.id, label: { en: c.label.en, es: c.label.es } });
  }
  // The filters: well-formed ones, unique ids and values, each with at least one option.
  const filters: PluginFilter[] = [];
  for (const f of (Array.isArray(r.filters) ? r.filters : []).slice(0, MAX_FILTERS)) {
    if (!isRecord(f) || typeof f.id !== 'string' || !FILTER_ID.test(f.id) || !isLabelLike(f.label) || !Array.isArray(f.options) || filters.some((x) => x.id === f.id)) continue;
    const options: PluginFilter['options'] = [];
    for (const o of f.options.slice(0, MAX_FILTER_OPTIONS)) if (isRecord(o) && typeof o.value === 'string' && o.value !== '' && o.value.length <= 64 && isLabelLike(o.label) && !options.some((x) => x.value === o.value)) options.push({ value: o.value, label: { en: o.label.en, es: o.label.es } });
    if (options.length) filters.push({ id: f.id, label: { en: f.label.en, es: f.label.es }, options });
  }
  const presets: PluginPreset[] = [];
  for (const p of Array.isArray(r.presets) ? r.presets : []) {
    if (!isRecord(p) || typeof p.id !== 'string' || p.id === '' || p.id.length > 128 || !isLabelLike(p.name) || typeof p.category !== 'string' || presets.some((x) => x.id === p.id)) continue;
    if (!categories.some((c) => c.id === p.category)) categories.push({ id: p.category as string, label: { en: p.category as string, es: p.category as string } });
    // A tag counts only for a filter the plugin offers, with one of its values.
    const tags: Record<string, string> = {};
    if (isRecord(p.tags)) for (const f of filters) if (typeof p.tags[f.id] === 'string' && f.options.some((o) => o.value === (p.tags as Record<string, unknown>)[f.id])) tags[f.id] = p.tags[f.id] as string;
    presets.push({ id: p.id, name: { en: p.name.en, es: p.name.es }, category: p.category as string, ...(isLabelLike(p.aux) ? { aux: { en: p.aux.en, es: p.aux.es } } : {}), ...(Object.keys(tags).length ? { tags } : {}) });
  }
  return { categories, presets, filters };
}

/** The render's info as the host draws it: well-formed items only (finite numbers, short words). */
export function cleanInfo(raw: unknown): PluginRenderInfo {
  const items: PluginInfoItem[] = [];
  const list = isRecord(raw) && Array.isArray(raw.items) ? raw.items : [];
  for (const it of list.slice(0, 16)) {
    if (!isRecord(it) || typeof it.key !== 'string' || !isLabelLike(it.label)) continue;
    const v = it.value;
    if (!((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 64))) continue;
    items.push({ key: it.key, label: { en: it.label.en, es: it.label.es }, value: v, ...(typeof it.unit === 'string' && it.unit.length <= 12 ? { unit: it.unit } : {}) });
  }
  return { items };
}

/** A run of a plugin over a result (the interface's request; src/plugins/service.ts does it). */
export interface PluginRunRequest {
  plugin: string;
  /** The result's id; null: the plugin's base picture (decision 8: what the preview shows before there is a result). */
  result: string | null;
  /** The preview's width; null: the result's own size (Apply). */
  maxWidth: number | null;
  recipe: string | null;
  controls: Record<string, PluginControlValue>;
}

/** An image a render job made, through a plugin (decision 9): its file and, for an EXR, the picture shown of it. */
export interface PluginImageRequest {
  plugin: string;
  file: Blob;
  display: Blob | null;
  recipe: string | null;
  controls: Record<string, PluginControlValue>;
}

/** How the recipe cards' pictures went: kept ones, made ones and the seconds each of those took (measured). */
export interface ThumbsOutcome {
  cached: number;
  made: number;
  seconds: number[];
}

export interface PluginRunResult {
  width: number;
  height: number;
  /** The result as it was, at this size (8-bit RGBA): the divider's left side. */
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
  info: PluginRenderInfo;
  /** Seconds the plugin's render took, measured around it. */
  seconds: number;
  /** What the plugin was given. */
  input: PluginPixels['kind'];
}

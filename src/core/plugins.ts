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
    if (problems.length > n) return null;
    return { ...base, kind: 'slider', min: min as number, max: max as number, step: step as number, default: def as number, ...(typeof raw.unit === 'string' ? { unit: raw.unit } : {}), ...(minLabel ? { minLabel } : {}) };
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

// ------------------------------------------------------------------ the render settings of plugins

/** What a project keeps of one plugin, in its render settings: the recipe chosen and the controls' values. */
export interface PluginRenderSettings {
  /** The recipe's id, or null for the plugin's own default. */
  recipe: string | null;
  controls: Readonly<Record<string, PluginControlValue>>;
}

export type PluginsSettings = Readonly<Record<string, PluginRenderSettings>>;

export const NO_PLUGINS: PluginsSettings = Object.freeze({});

const MAX_PLUGINS = 32;

function sameEntry(a: PluginRenderSettings, b: PluginRenderSettings): boolean {
  const ka = Object.keys(a.controls);
  const kb = Object.keys(b.controls);
  return a.recipe === b.recipe && ka.length === kb.length && ka.every((k) => Object.is(a.controls[k], b.controls[k]));
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
    const entry = { recipe, controls };
    const was = base[id];
    out[id] = was && sameEntry(was, entry) ? was : entry;
  }
  const ids = Object.keys(out);
  return ids.length === Object.keys(base).length && ids.every((id) => out[id] === base[id]) ? base : out;
}

/** The settings with one plugin's entry changed: its recipe, or some of its controls merged in. */
export function withPlugin(s: PluginsSettings, id: string, patch: { recipe?: string | null; controls?: Readonly<Record<string, PluginControlValue>> }): PluginsSettings {
  const was = s[id] ?? { recipe: null, controls: {} };
  return { ...s, [id]: { recipe: patch.recipe !== undefined ? patch.recipe : was.recipe, controls: patch.controls ? { ...was.controls, ...patch.controls } : was.controls } };
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
}

/** The file name of a result made by a plugin from `source`: `<name>_<plugin>.<ext>` ("Render_0001_aintfilm-film.png"). */
export function derivedFileName(source: string, pluginId: string, ext: 'png' | 'jpg'): string {
  const slash = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\'));
  const dot = source.lastIndexOf('.');
  const stem = dot > slash && dot > 0 ? source.slice(0, dot) : source;
  return `${stem}_${pluginId}.${ext}`;
}

/** The size an image is drawn at for a preview: its own when it fits `maxWidth`, else scaled to that width (≥ 1 px). */
export function previewSize(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  const k = maxWidth / width;
  return { width: maxWidth, height: Math.max(1, Math.round(height * k)) };
}

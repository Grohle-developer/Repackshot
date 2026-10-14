// Application settings (UI.md §2.9): what the Settings window changes. They
// belong to the application on this computer, not to a project: they are not
// undone and are not saved in .repack.json. The defaults for new projects set
// here (render, import) apply only to projects created afterwards.
//
// One persisted document holds them, `{ schema, settings, layout }`:
// `settings` is a flat, typed record (one key per row of the window, grouped
// by prefix), `layout` the interface state worth remembering between sessions
// that is not a setting (panel widths, folded sections, the last section of
// the window). `migrateDoc` reads any stored version (and the loose
// preferences of before, version 0) and always returns a valid document:
// every value is checked against its metadata and clamped, or replaced by its
// factory value.
//
// The metadata table (`SETTING_ROWS`) drives the window and its search: each
// setting's section, block, control, range, keywords in both languages, and a
// `comingSoon` flag for what is visible but not built yet. Labels are interface
// strings (`set.<key>` in src/ui/strings.ts). Pure: no DOM, no storage.

import type { Lang } from '../data/types';
import { DEFAULT_FAST_AA, DEFAULT_PIXEL_FILTER, FAST_AA, PIXEL_FILTERS, type FastAa, type PixelFilterSetting } from './antialias';
import { QUALITY_KEYS, QUALITY_PRESETS } from '../data/quality';
import { DEFAULT_SYSTEM_PROMPT, normaliseSystemPrompt } from './ai-prompt';
import { IMPORT_UNITS, LARGE_MODEL_MM, SMALL_MODEL_MM, TESSELLATION_PRESETS, UNIT_TO_MM, type ImportDetected, type ImportMessage, type ImportOptions, type ImportUnit } from './import-options';
import { DEFAULT_NAME_TEMPLATE } from './name-template';
import { DEFAULT_DPI } from './print-size';
import { patchSettings, type Destination, type OutputFormat } from './render';
import type { SelectionLevel } from './scene';
import type { ProjectState, ThemeSetting } from './store';
import { validRelease, type ReleaseInfo } from './updates';

/** Version of the stored document. 0 is the loose preferences of before (one localStorage entry each). */
export const SETTINGS_SCHEMA = 1;

export type LengthUnit = ImportUnit;
export const LENGTH_UNITS: readonly LengthUnit[] = IMPORT_UNITS;

export type SectionId = 'general' | 'preferences' | 'accessibility' | 'shortcuts' | 'engine' | 'ai' | 'plugins' | 'storage' | 'desktop' | 'updates' | 'about';
export type SectionGroup = 'app' | 'render' | 'system';

export interface SectionSpec {
  id: SectionId;
  group: SectionGroup;
  /** Shown only in the desktop application (the launcher answers). */
  desktopOnly?: boolean;
}

/** The left column of the window, in order (UI.md §2.9). */
export const SECTIONS: readonly SectionSpec[] = [
  { id: 'general', group: 'app' },
  { id: 'preferences', group: 'app' },
  { id: 'accessibility', group: 'app' },
  { id: 'shortcuts', group: 'app' },
  { id: 'engine', group: 'render' },
  { id: 'ai', group: 'render' },
  { id: 'plugins', group: 'system' },
  { id: 'storage', group: 'system' },
  { id: 'desktop', group: 'system', desktopOnly: true },
  { id: 'updates', group: 'system' },
  { id: 'about', group: 'system' },
];
export const SECTION_GROUPS: readonly SectionGroup[] = ['app', 'render', 'system'];

export function isSection(id: unknown): id is SectionId {
  return typeof id === 'string' && SECTIONS.some((s) => s.id === id);
}

/** Every setting, flat: the key is `<area>.<name>`. */
export interface Settings {
  'general.lang': Lang;
  'general.theme': ThemeSetting;
  'general.onStart': 'EXAMPLE' | 'EMPTY' | 'LAST';
  'general.units': LengthUnit;
  'general.autosave': boolean;
  'general.autosaveMinutes': number;
  'general.confirmClose': boolean;

  'viewport.startMode': 'FAST' | 'FULL' | 'LAST';
  'viewport.mouse': 'LEFT' | 'ALT_LEFT' | 'MIDDLE';
  'viewport.invertZoom': boolean;
  /** Percent of the factory speed. */
  'viewport.orbitSpeed': number;
  'viewport.zoomSpeed': number;
  'viewport.gestureResolution': 'AUTO' | 'HALF' | 'QUARTER';
  'viewport.floorGrid': boolean;
  /** Percent of the factory size. */
  'viewport.gizmoSize': number;
  'selection.defaultLevel': SelectionLevel;
  'selection.hoverOutline': boolean;
  'import.units': 'AUTO' | ImportUnit;
  'import.upAxis': 'FILE' | 'Y' | 'Z';
  'import.tessellation': 'LOW' | 'MEDIUM' | 'HIGH';
  'import.sheet': 'ALWAYS' | 'UNSURE';
  'render.nameTemplate': string;
  'render.destination': Destination;
  'render.format': OutputFormat;
  'render.dpi': number;
  'render.finishBy': 'SAMPLES' | 'TIME';
  'render.samples': number;
  'render.seconds': number;

  /** Interface size, percent. */
  'a11y.uiScale': number;
  /** Text size, percent. */
  'a11y.textScale': number;
  'a11y.highContrast': boolean;
  'a11y.reduceMotion': 'SYSTEM' | 'ON' | 'OFF';
  'a11y.focusAlways': boolean;
  /** Milliseconds before a tooltip shows. */
  'a11y.tooltipDelay': number;
  'a11y.announceRender': boolean;
  'a11y.accessKeys': boolean;

  'engine.backend': 'AUTO' | 'NATIVE' | 'WASM';
  /** 0 is automatic: one worker per logical core but one in the browser, every thread natively. */
  'engine.threads': number;
  'engine.simd': 'AUTO' | 'OFF';
  /** Full mode stops at the output's samples (the render window's), at a number of samples, or after a time. */
  'engine.viewportLimit': 'OUTPUT' | 'SAMPLES' | 'TIME';
  'engine.viewportSamples': number;
  'engine.viewportSeconds': number;
  /** While a render runs, the viewport keeps a quarter of the engine (live) or waits for it (fastest render). */
  'engine.whileRender': 'SHARE' | 'PAUSE';
  /** E11: Fast mode's multisampling, cheapest first (core/antialias.ts); the device caps it. */
  'engine.fastAa': FastAa;
  /** E11: Full mode's and the render's pixel filter and edge samples, cheapest first (core/antialias.ts). */
  'engine.pixelFilter': PixelFilterSetting;
  /** S4a: the most particles of one ambient effect; 0 is automatic: 100 000 in the browser, 1 000 000 natively. */
  'engine.particleCap': number;

  /** Key of the model in use, '' for none. */
  'ai.active': string;
  'ai.device': 'GPU' | 'CPU';
  /** Desktop: which GPU (index in the launcher's list). */
  'ai.gpu': number;
  /** Long side the model works at (tiles above it). */
  'ai.resolution': number;
  'ai.steps': number;
  /** Default intervention, 0..100 (also the render window's). */
  'ai.intervention': number;
  'ai.seed': 'FIXED' | 'NEW';
  'ai.offloadTextEncoder': boolean;
  /**
   * The system prompt (X4b): general words for every image, sent before the scene's and the job's own (AI-POST.md §4).
   * Empty is allowed (none); a model with a prompt-length limit gets the default's short form while it is unedited.
   */
  'ai.systemPrompt': string;
  /** Guard tolerances (AI-POST.md §3.2): mean and 95th percentile ΔE00 per material, edge match in pixels. */
  'ai.guardDeltaE': number;
  'ai.guardDeltaE95': number;
  'ai.guardEdgePx': number;
  /** Desktop: the inference runtime build, Automatic (Vulkan with a GPU, the CPU without one) or forced (AI-POST.md §7.1). */
  'ai.backend': 'AUTO' | 'VULKAN' | 'CPU';

  'storage.historyCount': number;
  'storage.historyMB': number;

  /** Look for a newer version once, in the background, when the application starts. */
  'updates.atStartup': boolean;
}

export type SettingKey = keyof Settings;

/** Interface state remembered between sessions that is not a setting (no row in the window). */
export interface Layout {
  sceneTab: string;
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** Folded sections of the inspector and the windows, by id. */
  sections: Record<string, boolean>;
  lightStyle: string;
  materialCategory: string;
  tuneOpen: boolean;
  space: string;
  scaleLock: boolean;
  /** The viewport draws the glyphs of every light and saved camera (L4's Lights and cameras button). */
  showGlyphs: boolean;
  /** The viewport mode last chosen (`viewport.startMode` LAST starts in it). */
  viewportMode: 'FAST' | 'FULL';
  /** The section of the Settings window last opened. */
  settingsSection: SectionId;
  /** The desktop portable's model chooser was shown (it is shown once). */
  chooserShown: boolean;
  /** The guided tour (phase U10) was finished or skipped: it starts by itself only until then. */
  tourSeen: boolean;
  /** When the update feed last answered (ms since 1970), null: never. */
  updateCheckedAt: number | null;
  /** The latest release that answer named, so an offline start can still show it. */
  updateLatest: ReleaseInfo | null;
  /** Where the material editor (M3a) was moved to and how large it was made (CSS pixels); null: centred, its own size. */
  materialEditorRect: EditorRect | null;
}

/** A window's place and size, CSS pixels. */
export interface EditorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SettingsDoc {
  schema: number;
  settings: Settings;
  layout: Layout;
}

// ------------------------------------------------------------------ factory values

export function defaultSettings(): Settings {
  return {
    'general.lang': 'en',
    'general.theme': 'system',
    'general.onStart': 'EMPTY',
    'general.units': 'mm',
    'general.autosave': false,
    'general.autosaveMinutes': 5,
    'general.confirmClose': true,

    'viewport.startMode': 'LAST',
    'viewport.mouse': 'LEFT',
    'viewport.invertZoom': false,
    'viewport.orbitSpeed': 100,
    'viewport.zoomSpeed': 100,
    'viewport.gestureResolution': 'AUTO',
    'viewport.floorGrid': false,
    'viewport.gizmoSize': 100,
    'selection.defaultLevel': 'PART',
    'selection.hoverOutline': true,
    'import.units': 'AUTO',
    'import.upAxis': 'FILE',
    'import.tessellation': 'MEDIUM',
    'import.sheet': 'ALWAYS',
    'render.nameTemplate': DEFAULT_NAME_TEMPLATE,
    'render.destination': { kind: 'DOWNLOADS' },
    'render.format': 'PNG',
    'render.dpi': DEFAULT_DPI,
    'render.finishBy': 'SAMPLES',
    'render.samples': QUALITY_PRESETS.PREVIEW.samples,
    'render.seconds': 120,

    'a11y.uiScale': 100,
    'a11y.textScale': 100,
    'a11y.highContrast': false,
    'a11y.reduceMotion': 'SYSTEM',
    'a11y.focusAlways': false,
    'a11y.tooltipDelay': 450,
    'a11y.announceRender': true,
    'a11y.accessKeys': false,

    'engine.backend': 'AUTO',
    'engine.threads': 0,
    'engine.simd': 'AUTO',
    'engine.viewportLimit': 'OUTPUT',
    'engine.viewportSamples': 1024,
    'engine.viewportSeconds': 120,
    'engine.whileRender': 'SHARE',
    'engine.fastAa': DEFAULT_FAST_AA,
    'engine.pixelFilter': DEFAULT_PIXEL_FILTER,
    'engine.particleCap': 0,

    'ai.active': '',
    'ai.device': 'GPU',
    'ai.gpu': 0,
    'ai.resolution': 1024,
    // Provisional until X1 part B measures them (AI-POST.md §2.1, §3.2): the distilled model's step count and
    // the starting points of the guard.
    'ai.steps': 8,
    'ai.intervention': 30,
    'ai.seed': 'FIXED',
    'ai.offloadTextEncoder': false,
    'ai.systemPrompt': DEFAULT_SYSTEM_PROMPT,
    'ai.guardDeltaE': 2,
    'ai.guardDeltaE95': 3,
    'ai.guardEdgePx': 2,
    'ai.backend': 'AUTO',

    'storage.historyCount': 50,
    'storage.historyMB': 500,

    'updates.atStartup': true,
  };
}

export function defaultLayout(): Layout {
  return {
    sceneTab: 'parts',
    leftWidth: 260,
    rightWidth: 340,
    leftCollapsed: false,
    rightCollapsed: false,
    sections: {},
    lightStyle: 'ALL',
    materialCategory: 'METAL',
    tuneOpen: false,
    space: 'GLOBAL',
    scaleLock: true,
    showGlyphs: true,
    viewportMode: 'FULL',
    settingsSection: 'general',
    chooserShown: false,
    tourSeen: false,
    updateCheckedAt: null,
    updateLatest: null,
    materialEditorRect: null,
  };
}

export function defaultDoc(): SettingsDoc {
  return { schema: SETTINGS_SCHEMA, settings: defaultSettings(), layout: defaultLayout() };
}

// ------------------------------------------------------------------ metadata

export type ControlSpec =
  /** One of a few values: a segment, or a dropdown when `select`; `soon` are visible, disabled, coming soon. */
  | { kind: 'choice'; options: readonly (string | number)[]; select?: boolean; soon?: readonly (string | number)[] }
  | { kind: 'toggle' }
  /** `zero`: 0 is a word (Automatic), not a number. */
  | { kind: 'number'; min: number; max: number; step: number; unit?: string; zero?: boolean }
  | { kind: 'text'; maxLength: number }
  /** Drawn by its own code in the window (a folder picker...). */
  | { kind: 'custom' };

export interface Keywords {
  en: readonly string[];
  es: readonly string[];
}

/** A row of the window. Its label is the interface string `set.<id>`, its auxiliary line `set.<id>.aux`. */
interface RowBase {
  id: string;
  section: SectionId;
  /** Block of the section; its title is the string `set.block.<block>`. */
  block: string;
  keywords: Keywords;
  /** Has an auxiliary line under the label. */
  aux?: boolean;
  /** Visible, disabled, marked coming soon. */
  comingSoon?: boolean;
  /** Only in the desktop application. */
  desktopOnly?: boolean;
  /** Only in the web version: about what the browser keeps or allows (hidden in the desktop application, P3e). */
  webOnly?: boolean;
}

/** Whether a row exists where the interface runs (`desktop`: the launcher's window). */
export function rowShownHere(row: Pick<RowBase, 'desktopOnly' | 'webOnly'>, desktop: boolean): boolean {
  return desktop ? !row.webOnly : !row.desktopOnly;
}

export interface SettingMeta extends RowBase {
  kind: 'setting';
  id: SettingKey;
  control: ControlSpec;
  /** A default for new projects: never changes the open one. */
  newProjects?: boolean;
}

/** A row that is not a setting (an action, information): it is searchable and drawn by its own code. */
export interface ExtraRow extends RowBase {
  kind: 'extra';
}

export type RowMeta = SettingMeta | ExtraRow;

const kw = (en: string, es: string): Keywords => ({ en: en.split(/\s*,\s*/).filter(Boolean), es: es.split(/\s*,\s*/).filter(Boolean) });

const choice = (options: readonly (string | number)[], select = false, soon?: readonly (string | number)[]): ControlSpec => ({ kind: 'choice', options, ...(select ? { select } : {}), ...(soon ? { soon } : {}) });
const toggle: ControlSpec = { kind: 'toggle' };
const num = (min: number, max: number, step: number, unit?: string, zero?: boolean): ControlSpec => ({ kind: 'number', min, max, step, ...(unit ? { unit } : {}), ...(zero ? { zero } : {}) });

function setting(id: SettingKey, section: SectionId, block: string, control: ControlSpec, keywords: Keywords, extra: Partial<Pick<SettingMeta, 'aux' | 'comingSoon' | 'desktopOnly' | 'newProjects'>> = {}): SettingMeta {
  return { kind: 'setting', id, section, block, control, keywords, ...extra };
}
function row(id: string, section: SectionId, block: string, keywords: Keywords, extra: Partial<Pick<ExtraRow, 'aux' | 'comingSoon' | 'desktopOnly' | 'webOnly'>> = {}): ExtraRow {
  return { kind: 'extra', id, section, block, keywords, ...extra };
}

/** Every row of the window, in display order. */
export const SETTING_ROWS: readonly RowMeta[] = [
  // General
  setting('general.lang', 'general', 'language', choice(['en', 'es']), kw('language, english, spanish, idioma', 'idioma, inglés, español, language')),
  setting('general.theme', 'general', 'language', choice(['dark', 'light', 'system']), kw('theme, dark, light, system, appearance, colour', 'tema, oscuro, claro, sistema, apariencia')),
  setting('general.onStart', 'general', 'start', choice(['EXAMPLE', 'EMPTY', 'LAST']), kw('start, startup, open, example, empty, last project', 'arranque, inicio, abrir, ejemplo, vacío, último proyecto'), { aux: true }),
  setting('general.units', 'general', 'start', choice(LENGTH_UNITS), kw('units, millimetres, centimetres, metres, inches, length', 'unidades, milímetros, centímetros, metros, pulgadas, longitud'), { aux: true }),
  setting('general.autosave', 'general', 'safety', toggle, kw('autosave, recovery, backup, crash', 'autoguardado, recuperación, copia, cierre'), { aux: true, comingSoon: true }),
  setting('general.autosaveMinutes', 'general', 'safety', num(1, 60, 1, 'min'), kw('autosave, minutes, interval', 'autoguardado, minutos, intervalo'), { comingSoon: true }),
  setting('general.confirmClose', 'general', 'safety', toggle, kw('confirm, close, unsaved, quit, leave', 'confirmar, cerrar, sin guardar, salir'), { aux: true }),

  // Preferences ▸ Viewport and navigation
  setting('viewport.startMode', 'preferences', 'viewport', choice(['FAST', 'FULL', 'LAST']), kw('viewport, mode, fast, full, start', 'visor, modo, rápido, completo, arranque')),
  setting('viewport.mouse', 'preferences', 'viewport', choice(['LEFT', 'ALT_LEFT', 'MIDDLE'], true), kw('mouse, orbit, button, alt, middle, navigation', 'ratón, orbitar, botón, alt, central, navegación'), { aux: true }),
  setting('viewport.invertZoom', 'preferences', 'viewport', toggle, kw('invert, zoom, wheel, scroll', 'invertir, zoom, rueda')),
  setting('viewport.orbitSpeed', 'preferences', 'viewport', num(25, 300, 5, '%'), kw('orbit, speed, rotate, sensitivity', 'órbita, velocidad, girar, sensibilidad')),
  setting('viewport.zoomSpeed', 'preferences', 'viewport', num(25, 300, 5, '%'), kw('zoom, speed, wheel, sensitivity', 'zoom, velocidad, rueda, sensibilidad')),
  setting('viewport.gestureResolution', 'preferences', 'viewport', choice(['AUTO', 'HALF', 'QUARTER']), kw('gesture, resolution, full, half, quarter, path tracer', 'gesto, resolución, completo, mitad, cuarto'), { aux: true }),
  setting('viewport.floorGrid', 'preferences', 'viewport', toggle, kw('grid, floor, ground', 'rejilla, suelo, cuadrícula'), { aux: true }),
  setting('viewport.gizmoSize', 'preferences', 'viewport', num(50, 200, 10, '%'), kw('gizmo, handles, move tool, size', 'gizmo, asas, mover, tamaño')),
  // Preferences ▸ Selection
  setting('selection.defaultLevel', 'preferences', 'selection', choice(['MODEL', 'GROUP', 'PART', 'FACES']), kw('selection, level, model, group, part, faces', 'selección, nivel, modelo, grupo, pieza, caras'), { aux: true }),
  setting('selection.hoverOutline', 'preferences', 'selection', toggle, kw('hover, outline, highlight', 'pasar, contorno, resaltar')),
  // Preferences ▸ Import defaults
  setting('import.units', 'preferences', 'import', choice(['AUTO', ...IMPORT_UNITS], true), kw('import, units, file, scale', 'importar, unidades, archivo, escala'), { aux: true }),
  setting('import.upAxis', 'preferences', 'import', choice(['FILE', 'Y', 'Z']), kw('import, up axis, y up, z up', 'importar, eje arriba, y arriba, z arriba'), { aux: true }),
  setting('import.tessellation', 'preferences', 'import', choice(['LOW', 'MEDIUM', 'HIGH']), kw('tessellation, cad, step, iges, quality, triangles', 'teselado, cad, step, iges, calidad, triángulos')),
  setting('import.sheet', 'preferences', 'import', choice(['ALWAYS', 'UNSURE']), kw('import sheet, ask, options', 'hoja de importación, preguntar, opciones'), { aux: true }),
  // Preferences ▸ Render defaults for new projects
  setting('render.nameTemplate', 'preferences', 'render', { kind: 'text', maxLength: 200 }, kw('name, template, file name, output', 'nombre, plantilla, archivo, salida'), { newProjects: true }),
  setting('render.destination', 'preferences', 'render', { kind: 'custom' }, kw('folder, downloads, output, destination', 'carpeta, descargas, salida, destino'), { newProjects: true }),
  setting('render.format', 'preferences', 'render', choice(['PNG', 'JPEG', 'EXR', 'TIFF', 'DNG']), kw('format, png, jpeg, exr, tiff, tif, raw, dng', 'formato, png, jpeg, exr, tiff, tif, raw, dng'), { newProjects: true }),
  setting('render.dpi', 'preferences', 'render', num(1, 9600, 1, 'DPI'), kw('dpi, print, resolution', 'ppp, dpi, impresión, resolución'), { newProjects: true }),
  setting('render.finishBy', 'preferences', 'render', choice(['SAMPLES', 'TIME']), kw('finish by, samples, time, quality', 'terminar por, muestras, tiempo, calidad'), { newProjects: true }),
  setting('render.samples', 'preferences', 'render', num(1, 100000, 16), kw('samples, quality', 'muestras, calidad'), { newProjects: true }),
  setting('render.seconds', 'preferences', 'render', num(1, 7 * 24 * 3600, 10, 's'), kw('time, seconds, budget', 'tiempo, segundos, presupuesto'), { newProjects: true }),

  // Accessibility
  setting('a11y.uiScale', 'accessibility', 'display', num(90, 150, 5, '%'), kw('interface size, zoom, scale, bigger, smaller', 'tamaño de la interfaz, zoom, escala, más grande'), { aux: true }),
  setting('a11y.textScale', 'accessibility', 'display', num(90, 130, 5, '%'), kw('text size, font, bigger, smaller', 'tamaño del texto, letra, fuente, más grande')),
  setting('a11y.highContrast', 'accessibility', 'display', toggle, kw('high contrast, borders, visibility', 'contraste alto, bordes, visibilidad'), { aux: true }),
  setting('a11y.reduceMotion', 'accessibility', 'display', choice(['SYSTEM', 'ON', 'OFF']), kw('reduce motion, animation, transitions', 'reducir movimiento, animación, transiciones')),
  setting('a11y.focusAlways', 'accessibility', 'keyboard', toggle, kw('focus, outline, keyboard, visible', 'foco, contorno, teclado, visible'), { aux: true }),
  setting('a11y.tooltipDelay', 'accessibility', 'keyboard', num(0, 2000, 50, 'ms'), kw('tooltip, delay, hint', 'tooltip, retardo, ayuda, sugerencia')),
  setting('a11y.announceRender', 'accessibility', 'screenReader', toggle, kw('screen reader, announce, progress, aria', 'lector de pantalla, anunciar, progreso, aria'), { aux: true }),
  setting('a11y.accessKeys', 'accessibility', 'screenReader', toggle, kw('access keys, underline, menus, mnemonics', 'letra de acceso, subrayar, menús'), { comingSoon: true }),

  // Keyboard shortcuts
  row('shortcuts.list', 'shortcuts', 'list', kw('shortcuts, keys, keyboard, hotkeys', 'atajos, teclas, teclado')),
  row('shortcuts.remap', 'shortcuts', 'list', kw('remap, change shortcut, customise', 'cambiar atajo, personalizar'), { comingSoon: true }),

  // Render engine
  setting('engine.backend', 'engine', 'engine', choice(['AUTO', 'NATIVE', 'WASM'], true), kw('engine, backend, native, webassembly, wasm, browser', 'motor, nativo, webassembly, wasm, navegador'), { aux: true }),
  setting('engine.threads', 'engine', 'engine', num(0, 256, 1, undefined, true), kw('threads, workers, cores, cpu', 'hilos, workers, núcleos, cpu'), { aux: true }),
  setting('engine.simd', 'engine', 'engine', choice(['AUTO', 'OFF']), kw('simd, vector, simd128, avx', 'simd, vectorial, simd128, avx'), { aux: true }),
  setting('engine.particleCap', 'engine', 'engine', num(0, 16_777_216, 1000, undefined, true), kw('particles, cap, limit, ambient, effects, dust, rain, snow', 'partículas, tope, límite, ambiente, efectos, polvo, lluvia, nieve'), { aux: true }),
  setting('engine.viewportLimit', 'engine', 'fullViewport', choice(['OUTPUT', 'SAMPLES', 'TIME']), kw('viewport limit, battery, stop, samples, seconds', 'límite del visor, batería, parar, muestras, segundos'), { aux: true }),
  setting('engine.viewportSamples', 'engine', 'fullViewport', num(16, 100000, 16), kw('viewport, samples, limit', 'visor, muestras, límite')),
  setting('engine.viewportSeconds', 'engine', 'fullViewport', num(5, 3600, 5, 's'), kw('viewport, seconds, limit', 'visor, segundos, límite')),
  setting('engine.whileRender', 'engine', 'fullViewport', choice(['SHARE', 'PAUSE']), kw('while rendering, render, queue, share, pause, live viewport, threads', 'mientras se renderiza, render, cola, compartir, pausar, visor vivo, hilos'), { aux: true }),
  setting('engine.fastAa', 'engine', 'antialias', choice(FAST_AA), kw('antialiasing, smoothing, jagged edges, msaa, multisampling, fast mode', 'suavizado, bordes, dientes de sierra, msaa, multimuestreo, modo rápido'), { aux: true }),
  setting('engine.pixelFilter', 'engine', 'antialias', choice(PIXEL_FILTERS), kw('antialiasing, smoothing, jagged edges, pixel filter, box, tent, blackman-harris, edges, supersampling', 'suavizado, bordes, dientes de sierra, filtro de píxel, caja, tienda, blackman-harris, supermuestreo'), { aux: true }),
  row('engine.measure', 'engine', 'measure', kw('measure performance, benchmark, speed, samples per second', 'medir rendimiento, prueba, velocidad, muestras por segundo'), { aux: true }),
  row('engine.info', 'engine', 'info', kw('engine version, build, cpu features, simd, threads', 'versión del motor, compilación, cpu, simd, hilos')),

  // AI post-processing ▸ Active model
  setting('ai.active', 'ai', 'active', { kind: 'custom' }, kw('active model, model in use, ai', 'modelo activo, modelo en uso, ia')),
  setting('ai.device', 'ai', 'active', choice(['GPU', 'CPU']), kw('device, gpu, cpu, graphics card', 'dispositivo, gpu, cpu, tarjeta gráfica'), { aux: true }),
  setting('ai.gpu', 'ai', 'active', { kind: 'custom' }, kw('which gpu, graphics card', 'qué gpu, tarjeta gráfica'), { desktopOnly: true }),
  setting('ai.resolution', 'ai', 'active', choice([1024, 1536, 2048]), kw('working resolution, long side, tiles', 'resolución de trabajo, lado largo, mosaicos'), { aux: true }),
  setting('ai.steps', 'ai', 'active', num(1, 50, 1), kw('steps, denoising', 'pasos, eliminación de ruido'), { aux: true }),
  setting('ai.intervention', 'ai', 'active', num(0, 100, 1), kw('intervention, strength, default, ai', 'intervención, fuerza, por defecto, ia'), { aux: true }),
  setting('ai.seed', 'ai', 'active', choice(['FIXED', 'NEW']), kw('seed, random, variation', 'semilla, aleatoria, variación')),
  setting('ai.offloadTextEncoder', 'ai', 'active', toggle, kw('text encoder, ram, offload, memory', 'codificador de texto, ram, memoria'), { aux: true }),
  // AI post-processing ▸ System prompt (X4b): drawn by its own code (a multi-line field, Restore default, the fit line).
  setting('ai.systemPrompt', 'ai', 'prompt', { kind: 'custom' }, kw('system prompt, prompt, words, text, instructions, default', 'prompt del sistema, prompt, texto, instrucciones, predeterminado'), { aux: true }),
  setting('ai.guardDeltaE', 'ai', 'guard', num(0.5, 10, 0.5), kw('guard, tolerance, delta e, colour', 'guarda, tolerancia, delta e, color'), { aux: true }),
  setting('ai.guardDeltaE95', 'ai', 'guard', num(0.5, 20, 0.5), kw('guard, tolerance, percentile, delta e', 'guarda, tolerancia, percentil, delta e')),
  setting('ai.guardEdgePx', 'ai', 'guard', num(0.5, 8, 0.5, 'px'), kw('guard, edges, pixels', 'guarda, bordes, píxeles')),
  // AI post-processing ▸ Models and Hardware
  row('ai.models', 'ai', 'models', kw('models, download, z-image, flux, qwen, stable diffusion, licence', 'modelos, descargar, z-image, flux, qwen, stable diffusion, licencia')),
  row('ai.import', 'ai', 'models', kw('import model, safetensors, gguf, onnx, manifest', 'importar modelo, safetensors, gguf, onnx, manifiesto')),
  // AI post-processing ▸ Runtime (desktop: stable-diffusion.cpp, X3b)
  row('ai.runtime', 'ai', 'runtime', kw('runtime, stable-diffusion.cpp, sd.cpp, vulkan, cpu, download, inference', 'motor de ejecución, stable-diffusion.cpp, sd.cpp, vulkan, cpu, descargar, inferencia'), { desktopOnly: true }),
  setting('ai.backend', 'ai', 'runtime', choice(['AUTO', 'VULKAN', 'CPU']), kw('run on, backend, vulkan, cpu, graphics card, force', 'ejecutar con, vulkan, cpu, tarjeta gráfica, forzar'), { aux: true, desktopOnly: true }),
  row('ai.hardware', 'ai', 'hardware', kw('hardware, gpu, vram, ram, webgpu, recommendation', 'equipo, gpu, vram, ram, webgpu, recomendación')),

  // Plugins (P6): the registry with Install, Update and Remove, and Install from file… (drawn by settings-plugins.ts)
  row('plugins.list', 'plugins', 'plugins', kw('plugins, plugin, install, update, remove, film, film simulation, grain, aintfilm, closed licence, activation key', 'plugins, plugin, instalar, actualizar, quitar, película, simulación de película, grano, aintfilm, licencia cerrada, clave de activación')),
  row('plugins.file', 'plugins', 'pluginFile', kw('install from file, rpk, plugin package, activation key, key', 'instalar desde archivo, rpk, paquete de plugin, clave de activación, clave')),

  // Storage
  row('storage.usage', 'storage', 'usage', kw('storage, space, disk, free up, delete, cache', 'almacenamiento, espacio, disco, liberar, borrar, caché')),
  setting('storage.historyCount', 'storage', 'history', num(1, 1000, 1), kw('history, results, limit, count', 'historial, resultados, límite, número')),
  setting('storage.historyMB', 'storage', 'history', num(50, 20000, 50, 'MB'), kw('history, results, limit, size, megabytes', 'historial, resultados, límite, tamaño, megas')),
  row('storage.persist', 'storage', 'browser', kw('persistent storage, keep data, evict', 'almacenamiento persistente, conservar datos'), { aux: true, webOnly: true }),
  row('storage.folder', 'storage', 'browser', kw('data folder, open folder', 'carpeta de datos, abrir carpeta'), { desktopOnly: true }),

  // Desktop
  row('desktop.portable', 'desktop', 'desktop', kw('portable, data folder, installed', 'portable, carpeta de datos, instalado'), { desktopOnly: true }),
  row('desktop.browser', 'desktop', 'desktop', kw('browser, window, edge, chromium', 'navegador, ventana, edge, chromium'), { desktopOnly: true }),
  row('desktop.logs', 'desktop', 'desktop', kw('logs, log folder, diagnostics', 'registros, carpeta de registros, diagnóstico'), { desktopOnly: true }),

  // Updates
  row('updates.current', 'updates', 'updates', kw('installed version, current version, version, release', 'versión instalada, versión actual, versión, publicación')),
  row('updates.check', 'updates', 'updates', kw('check for updates, updates, update, upgrade, new version, latest version, release, github', 'buscar actualizaciones, actualizaciones, actualizar, nueva versión, última versión, publicación, github')),
  setting('updates.atStartup', 'updates', 'updates', toggle, kw('check at startup, updates, update, startup, automatic, background, new version', 'comprobar al iniciar, actualizaciones, actualizar, arranque, automático, segundo plano, nueva versión'), { aux: true }),
  row('updates.last', 'updates', 'updates', kw('last checked, last check, updates, when', 'última comprobación, actualizaciones, cuándo')),

  // About
  row('about.version', 'about', 'version', kw('version, about', 'versión, acerca de')),
  row('about.licence', 'about', 'licence', kw('licence, license, polyform, noncommercial', 'licencia, polyform, no comercial')),
  row('about.thirdParty', 'about', 'thirdParty', kw('third party, licences, three.js, rhino3dm, occt, opencascade, lgpl, mit, apache', 'terceros, licencias, three.js, rhino3dm, occt, opencascade, lgpl, mit, apache')),
  row('about.credits', 'about', 'credits', kw('credits, ez packshot, thanks', 'créditos, ez packshot, agradecimientos')),
];

const SETTING_META = new Map<SettingKey, SettingMeta>();
for (const r of SETTING_ROWS) if (r.kind === 'setting') SETTING_META.set(r.id, r);

export function settingMeta(key: SettingKey): SettingMeta {
  const m = SETTING_META.get(key);
  if (!m) throw new Error(`no metadata for ${key}`);
  return m;
}

export const SETTING_KEYS: readonly SettingKey[] = Object.keys(defaultSettings()) as SettingKey[];

export function rowsOf(section: SectionId): RowMeta[] {
  return SETTING_ROWS.filter((r) => r.section === section);
}

export function settingsOfSection(section: SectionId): SettingKey[] {
  return SETTING_ROWS.filter((r): r is SettingMeta => r.kind === 'setting' && r.section === section).map((r) => r.id);
}

// ------------------------------------------------------------------ values, validation

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whole numbers for whole steps, else the decimals of the step: a typed value is kept, not snapped to the grid. */
function roundToStep(v: number, step: number): number {
  if (Number.isInteger(step)) return Math.round(v);
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
  return Number(v.toFixed(decimals));
}

function validDestination(v: unknown): Destination | null {
  if (!isRecord(v)) return null;
  if (v.kind === 'DOWNLOADS') return { kind: 'DOWNLOADS' };
  if (v.kind === 'FOLDER' && typeof v.id === 'string' && v.id && typeof v.name === 'string') return { kind: 'FOLDER', id: v.id, name: v.name.slice(0, 200) };
  return null;
}

const MODEL_KEY_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

/** A valid value for one setting, or null when `raw` cannot be one (the caller keeps or restores the factory value). */
export function validateValue<K extends SettingKey>(key: K, raw: unknown): Settings[K] | null {
  const meta = settingMeta(key);
  const c = meta.control;
  if (key === 'render.destination') return validDestination(raw) as Settings[K] | null;
  if (key === 'ai.active') return (typeof raw === 'string' && (raw === '' || (MODEL_KEY_RE.test(raw) && !raw.includes('..'))) ? raw : null) as Settings[K] | null;
  if (key === 'ai.systemPrompt') return normaliseSystemPrompt(raw) as Settings[K] | null;
  if (key === 'ai.gpu') return (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < 16 ? raw : null) as Settings[K] | null;
  switch (c.kind) {
    case 'choice':
      return (c.options as readonly unknown[]).includes(raw) ? (raw as Settings[K]) : null;
    case 'toggle':
      return typeof raw === 'boolean' ? (raw as Settings[K]) : null;
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
      const clamped = Math.min(c.max, Math.max(c.min, raw));
      return roundToStep(clamped, c.step) as Settings[K];
    }
    case 'text': {
      if (typeof raw !== 'string') return null;
      const v = raw.trim().slice(0, c.maxLength);
      return (v === '' ? null : v) as Settings[K] | null;
    }
    default:
      return null;
  }
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (isRecord(a) && isRecord(b)) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/** Every setting checked: what is invalid or missing takes its factory value. */
export function validateSettings(raw: unknown): Settings {
  const out = defaultSettings();
  if (!isRecord(raw)) return out;
  for (const key of SETTING_KEYS) {
    if (!(key in raw)) continue;
    const v = validateValue(key, raw[key]);
    if (v !== null) (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}

const PANEL_MIN = 220;
const PANEL_MAX = 480;

export function validateLayout(raw: unknown): Layout {
  const out = defaultLayout();
  if (!isRecord(raw)) return out;
  const str = (k: keyof Layout) => typeof raw[k] === 'string' && (raw[k] as string).length <= 64;
  const bool = (k: keyof Layout) => typeof raw[k] === 'boolean';
  if (str('sceneTab')) out.sceneTab = raw.sceneTab as string;
  for (const k of ['leftWidth', 'rightWidth'] as const) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, v)));
  }
  for (const k of ['leftCollapsed', 'rightCollapsed', 'tuneOpen', 'scaleLock', 'showGlyphs', 'chooserShown', 'tourSeen'] as const) if (bool(k)) out[k] = raw[k] as boolean;
  if (isRecord(raw.sections)) {
    const sections: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw.sections)) if (typeof v === 'boolean' && k.length <= 64) sections[k] = v;
    out.sections = sections;
  }
  if (str('lightStyle')) out.lightStyle = raw.lightStyle as string;
  if (str('materialCategory')) out.materialCategory = raw.materialCategory as string;
  if (raw.space === 'GLOBAL' || raw.space === 'LOCAL') out.space = raw.space;
  if (raw.viewportMode === 'FAST' || raw.viewportMode === 'FULL') out.viewportMode = raw.viewportMode;
  if (isSection(raw.settingsSection)) out.settingsSection = raw.settingsSection;
  if (typeof raw.updateCheckedAt === 'number' && Number.isFinite(raw.updateCheckedAt) && raw.updateCheckedAt > 0 && raw.updateCheckedAt < 8.64e15) out.updateCheckedAt = Math.round(raw.updateCheckedAt);
  out.updateLatest = validRelease(raw.updateLatest);
  const r = raw.materialEditorRect;
  if (isRecord(r) && [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    const n = (v: unknown, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v as number)));
    out.materialEditorRect = { x: n(r.x, -4000, 8000), y: n(r.y, -4000, 8000), w: n(r.w, 480, 8000), h: n(r.h, 320, 8000) };
  }
  return out;
}

// ------------------------------------------------------------------ migration

/**
 * The loose preferences of before this document (version 0), one localStorage entry each, by their key without
 * the `repackshot.` prefix: `lang`, `theme`, and `ui.<field>` for the remembered interface state.
 */
export type LegacyPrefs = Record<string, unknown>;

/** The keys of version 0, to read them once and remove them after a successful migration. */
export const LEGACY_PREF_KEYS: readonly string[] = [
  'lang',
  'theme',
  'ui.sceneTab',
  'ui.leftWidth',
  'ui.rightWidth',
  'ui.leftCollapsed',
  'ui.rightCollapsed',
  'ui.sections',
  'ui.lightStyle',
  'ui.materialCategory',
  'ui.tuneOpen',
  'ui.space',
  'ui.scaleLock',
  'ui.viewportMode',
];

/** Version 0 to the current document. */
export function migrateLegacy(prefs: LegacyPrefs): SettingsDoc {
  const settings: Record<string, unknown> = {};
  if ('lang' in prefs) settings['general.lang'] = prefs.lang;
  if ('theme' in prefs) settings['general.theme'] = prefs.theme;
  const layout: Record<string, unknown> = {};
  for (const k of LEGACY_PREF_KEYS) if (k.startsWith('ui.') && k in prefs) layout[k.slice(3)] = prefs[k];
  return { schema: SETTINGS_SCHEMA, settings: validateSettings(settings), layout: validateLayout(layout) };
}

/**
 * Steps from each stored version to the next, applied in order. Version 1 is the first document; a later
 * schema adds its step here (rename a key, change a unit) and bumps SETTINGS_SCHEMA.
 */
const STEPS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * Any stored document to a valid current one. A newer document (written by a later version of the
 * application) is read as far as this version understands it; unknown keys are dropped, never guessed.
 */
export function migrateDoc(raw: unknown): SettingsDoc {
  if (!isRecord(raw)) return defaultDoc();
  let doc: Record<string, unknown> = raw;
  let schema = typeof doc.schema === 'number' && Number.isInteger(doc.schema) ? doc.schema : 0;
  if (schema === 0) return migrateLegacy(isRecord(doc.prefs) ? doc.prefs : {});
  while (schema < SETTINGS_SCHEMA && STEPS[schema]) {
    doc = STEPS[schema](doc);
    schema++;
  }
  return { schema: SETTINGS_SCHEMA, settings: validateSettings(doc.settings), layout: validateLayout(doc.layout) };
}

// ------------------------------------------------------------------ changes

export function getSetting<K extends SettingKey>(s: Settings, key: K): Settings[K] {
  return s[key];
}

/** A copy with one setting changed (validated); the same object when nothing changes. */
export function withSetting<K extends SettingKey>(s: Settings, key: K, value: Settings[K]): Settings {
  const v = validateValue(key, value);
  if (v === null || sameValue(s[key], v)) return s;
  return { ...s, [key]: v };
}

export function isFactory(s: Settings, key: SettingKey): boolean {
  return sameValue(s[key], defaultSettings()[key]);
}

export function resetSetting(s: Settings, key: SettingKey): Settings {
  const d = defaultSettings();
  return sameValue(s[key], d[key]) ? s : { ...s, [key]: d[key] };
}

/** Every setting of a section back to its factory value. */
export function resetSection(s: Settings, section: SectionId): Settings {
  let out = s;
  for (const key of settingsOfSection(section)) out = resetSetting(out, key);
  return out;
}

/** The settings of a section that differ from the factory. */
export function changedIn(s: Settings, section: SectionId): SettingKey[] {
  return settingsOfSection(section).filter((k) => !isFactory(s, k));
}

// ------------------------------------------------------------------ search

/** Lower case, without accents, for matching in both languages. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export interface SearchHit {
  row: RowMeta;
  /** Higher is better: the label itself matched, in the language shown. */
  score: number;
}

/**
 * Rows whose label (in either language, through `label`) or keywords (either language) contain every word of
 * the query. `desktop` says whether desktop-only rows exist here (and web-only ones do not). Ranked: label in the current language, then
 * the other language, then keywords; ties keep the window's order.
 */
export function searchSettings(query: string, opts: { lang: Lang; label: (row: RowMeta, lang: Lang) => string; desktop: boolean; rows?: readonly RowMeta[] }): SearchHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const other: Lang = opts.lang === 'en' ? 'es' : 'en';
  const hits: SearchHit[] = [];
  for (const row of opts.rows ?? SETTING_ROWS) {
    if (!rowShownHere(row, opts.desktop)) continue;
    const mine = fold(opts.label(row, opts.lang));
    const theirs = fold(opts.label(row, other));
    const keys = [...row.keywords.en, ...row.keywords.es].map(fold).join(' | ');
    let score = 0;
    let ok = true;
    for (const w of words) {
      if (mine.includes(w)) score += 3;
      else if (theirs.includes(w)) score += 2;
      else if (keys.includes(w)) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok) hits.push({ row, score });
  }
  return hits.map((h, i) => ({ h, i })).sort((a, b) => b.h.score - a.h.score || a.i - b.i).map((x) => x.h);
}

// ------------------------------------------------------------------ what settings mean elsewhere

/** The viewport mode to start in. */
export function startViewportMode(s: Settings, last: 'FAST' | 'FULL'): 'FAST' | 'FULL' {
  const m = s['viewport.startMode'];
  return m === 'LAST' ? last : m;
}

/** The interface size and text size as CSS factors, and the attributes the stylesheets key on (UI.md §2.9). */
export interface DisplayTokens {
  vars: { '--ui-zoom': string; '--text-scale': string };
  attrs: { 'data-contrast': 'high' | 'normal'; 'data-motion': 'reduce' | 'full' | 'system'; 'data-focus': 'always' | 'auto' };
}

export function displayTokens(s: Settings): DisplayTokens {
  const motion = s['a11y.reduceMotion'];
  return {
    vars: { '--ui-zoom': String(s['a11y.uiScale'] / 100), '--text-scale': String(s['a11y.textScale'] / 100) },
    attrs: {
      'data-contrast': s['a11y.highContrast'] ? 'high' : 'normal',
      'data-motion': motion === 'ON' ? 'reduce' : motion === 'OFF' ? 'full' : 'system',
      'data-focus': s['a11y.focusAlways'] ? 'always' : 'auto',
    },
  };
}

/** How the mouse moves the camera (Preferences ▸ Viewport and navigation), as the preview applies it. */
export interface NavigationPrefs {
  mouse: Settings['viewport.mouse'];
  invertZoom: boolean;
  /** Factors of the factory speeds (1 is 100 %). */
  orbitSpeed: number;
  zoomSpeed: number;
}

/** What the preview draws besides the model (Preferences). */
export interface DisplayPrefs {
  floorGrid: boolean;
  /** Factor of the factory size of the move tool's gizmo. */
  gizmoScale: number;
}

/** When Full mode stops converging in the viewport (Render engine ▸ Full mode stops). */
export interface ViewportLimit {
  by: Settings['engine.viewportLimit'];
  samples: number;
  seconds: number;
}

/** The results history's limits (core/results.ts) from the Storage section. */
export function historyLimits(s: Settings): { count: number; bytes: number } {
  return { count: s['storage.historyCount'], bytes: s['storage.historyMB'] * 1024 * 1024 };
}

/**
 * A new project (New, or the start of the application) with the defaults chosen in Preferences: the render
 * window's output and budget, and the selection level. Never applied to a project that is already open.
 */
export function withProjectDefaults(state: ProjectState, s: Settings): ProjectState {
  const samples = s['render.samples'];
  const tier = QUALITY_KEYS.find((k) => QUALITY_PRESETS[k].samples === samples);
  const render = patchSettings(state.render, {
    name: s['render.nameTemplate'],
    destination: s['render.destination'],
    format: s['render.format'],
    dpi: s['render.dpi'],
    finishBy: s['render.finishBy'],
    maxSamples: samples,
    maxSeconds: s['render.seconds'],
    quality: tier ?? 'CUSTOM',
    // Settings ▸ AI post-processing ▸ Default intervention is also where a new project's window starts (UI.md §2.9).
    ai: { ...state.render.ai, intervention: s['ai.intervention'] },
  });
  return {
    ...state,
    render: { ...state.render, ...render },
    selection: { ...state.selection, level: s['selection.defaultLevel'] },
  };
}

/**
 * The import sheet's values with the Import defaults of Preferences: the units when the file says none, the up
 * axis when it does not declare one, and the CAD tessellation quality. What the file says always wins.
 */
export function withImportDefaults(options: ImportOptions, detected: ImportDetected, s: Settings): ImportOptions {
  const out = { ...options };
  const units = s['import.units'];
  if (detected.units === null && units !== 'AUTO') out.units = units;
  const up = s['import.upAxis'];
  if (!detected.upAxisDeclared && up !== 'FILE') out.upAxis = up;
  const q = s['import.tessellation'];
  out.tessellation = q;
  Object.assign(out, TESSELLATION_PRESETS[q]);
  return out;
}

/**
 * Whether an import needs no question ("Open the import sheet: Only when unsure"): the file declares its units,
 * the reader reported nothing, no part is hidden in the file, and the size in those units is ordinary.
 */
export function importIsSure(detected: ImportDetected, warnings: readonly ImportMessage[]): boolean {
  if (detected.units === null || detected.unsupportedUnit || warnings.length > 0 || detected.hiddenParts > 0) return false;
  const mm = detected.size * UNIT_TO_MM[detected.units];
  return mm >= SMALL_MODEL_MM && mm <= LARGE_MODEL_MM;
}

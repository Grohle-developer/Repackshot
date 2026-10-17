// Application settings of phase U6 (core/settings.ts): factory values, validation, migration from
// the loose preferences of before and from stored documents, the metadata every row of the window
// is generated from (and its strings in both languages), Reset, the search in English and Spanish,
// the display tokens of Accessibility, and the defaults for new projects.

import { describe, expect, it } from 'vitest';
import {
  changedIn,
  defaultLayout,
  defaultSettings,
  displayTokens,
  isFactory,
  migrateDoc,
  migrateLegacy,
  resetSection,
  resetSetting,
  rowsOf,
  searchSettings,
  SECTIONS,
  SETTING_KEYS,
  SETTING_ROWS,
  settingMeta,
  SETTINGS_SCHEMA,
  startViewportMode,
  validateSettings,
  validateValue,
  withProjectDefaults,
  withSetting,
  type RowMeta,
  type SettingKey,
  type Settings,
} from '../src/core/settings';
import { createInitialState } from '../src/core/store';
import type { Lang } from '../src/data/types';
import { STRINGS, type StringKey } from '../src/ui/strings';

const has = (key: string) => key in STRINGS.en && key in STRINGS.es;
const label = (row: RowMeta, lang: Lang) => STRINGS[lang][`set.${row.id}` as StringKey] ?? '';

/** A valid value different from the factory one, for every kind of control. */
function another(key: SettingKey): unknown {
  const meta = settingMeta(key);
  const d = defaultSettings()[key];
  const c = meta.control;
  if (key === 'render.destination') return { kind: 'FOLDER', id: 'f1', name: 'Renders' };
  if (key === 'ai.active') return 'ZIMAGE_Q4';
  if (key === 'ai.gpu') return 1;
  if (key === 'ai.systemPrompt') return 'Clean studio product photograph.';
  if (c.kind === 'choice') return c.options.find((o) => o !== d);
  if (c.kind === 'toggle') return !d;
  if (c.kind === 'number') return d === c.max ? c.min : c.max;
  if (c.kind === 'text') return `${String(d)}_x`;
  throw new Error(`no other value for ${key}`);
}

describe('settings: factory values and metadata', () => {
  it('every setting has metadata and every metadata row a factory value', () => {
    const metaKeys = SETTING_ROWS.filter((r) => r.kind === 'setting').map((r) => r.id).sort();
    expect(metaKeys).toEqual([...SETTING_KEYS].sort());
    expect(new Set(SETTING_ROWS.map((r) => r.id)).size).toBe(SETTING_ROWS.length);
  });

  it('the factory values are valid values of their own controls', () => {
    expect(validateSettings(defaultSettings())).toEqual(defaultSettings());
    for (const key of SETTING_KEYS) expect(validateValue(key, defaultSettings()[key]), key).toEqual(defaultSettings()[key]);
  });

  it('every row, block, section and option has its label in English and Spanish', () => {
    for (const s of SECTIONS) {
      expect(has(`set.sec.${s.id}`), s.id).toBe(true);
      expect(has(`set.sec.${s.id}.desc`), s.id).toBe(true);
      expect(has(`set.group.${s.group}`), s.group).toBe(true);
    }
    for (const r of SETTING_ROWS) {
      expect(has(`set.${r.id}`), r.id).toBe(true);
      expect(has(`set.block.${r.block}`), r.block).toBe(true);
      if (r.aux) expect(has(`set.${r.id}.aux`), `${r.id}.aux`).toBe(true);
      if (r.kind === 'setting' && r.control.kind === 'choice') for (const o of r.control.options) expect(has(`set.${r.id}.${o}`), `${r.id}.${o}`).toBe(true);
      expect(r.keywords.en.length, r.id).toBeGreaterThan(0);
      expect(r.keywords.es.length, r.id).toBeGreaterThan(0);
    }
  });

  it('every section of the window has rows, and blocks are not split', () => {
    for (const s of SECTIONS) {
      const rows = rowsOf(s.id);
      expect(rows.length, s.id).toBeGreaterThan(0);
      const order = rows.map((r) => r.block).filter((b, i, all) => i === 0 || all[i - 1] !== b);
      expect(new Set(order).size, `${s.id}: ${order.join(',')}`).toBe(order.length);
    }
  });

  it('Reset returns each setting to its factory value, and Reset this section all of them', () => {
    let s: Settings = defaultSettings();
    for (const key of SETTING_KEYS) {
      const next = withSetting(s, key, another(key) as never);
      expect(next, key).not.toBe(s);
      expect(isFactory(next, key), key).toBe(false);
      expect(resetSetting(next, key)[key], key).toEqual(defaultSettings()[key]);
      s = next;
    }
    for (const section of SECTIONS) {
      expect(changedIn(s, section.id).length > 0 || rowsOf(section.id).every((r) => r.kind === 'extra'), section.id).toBe(true);
      s = resetSection(s, section.id);
      expect(changedIn(s, section.id), section.id).toEqual([]);
    }
    expect(s).toEqual(defaultSettings());
  });
});

describe('settings: validation', () => {
  it('clamps numbers to their range and step, refuses other types', () => {
    expect(validateValue('a11y.uiScale', 400)).toBe(150);
    expect(validateValue('a11y.uiScale', 10)).toBe(90);
    expect(validateValue('a11y.uiScale', 112.4)).toBe(112);
    expect(validateValue('ai.guardDeltaE', 2.26)).toBe(2.3);
    expect(validateValue('a11y.uiScale', '120')).toBeNull();
    expect(validateValue('a11y.uiScale', Number.NaN)).toBeNull();
    expect(validateValue('general.theme', 'blue')).toBeNull();
    expect(validateValue('general.confirmClose', 'yes')).toBeNull();
    expect(validateValue('render.nameTemplate', '   ')).toBeNull();
    expect(validateValue('render.destination', { kind: 'FOLDER', id: '', name: 'x' })).toBeNull();
    expect(validateValue('ai.active', '../etc')).toBeNull();
  });

  it('a stored document with bad or missing values keeps the good ones and the factory values for the rest', () => {
    const doc = migrateDoc({ schema: 1, settings: { 'general.lang': 'es', 'a11y.uiScale': 999, 'engine.threads': 'many', 'no.such': 1 }, layout: { leftWidth: 10, sections: { a: true, b: 'x' } } });
    expect(doc.settings['general.lang']).toBe('es');
    expect(doc.settings['a11y.uiScale']).toBe(150);
    expect(doc.settings['engine.threads']).toBe(0);
    expect('no.such' in doc.settings).toBe(false);
    expect(doc.layout.leftWidth).toBe(220);
    expect(doc.layout.sections).toEqual({ a: true });
    expect(migrateDoc('garbage')).toEqual({ schema: SETTINGS_SCHEMA, settings: defaultSettings(), layout: defaultLayout() });
  });

  it('a document of a later version is read as far as it is understood', () => {
    const doc = migrateDoc({ schema: SETTINGS_SCHEMA + 5, settings: { 'general.theme': 'light', 'future.thing': true } });
    expect(doc.schema).toBe(SETTINGS_SCHEMA);
    expect(doc.settings['general.theme']).toBe('light');
  });
});

describe('settings: migration from the loose preferences of before (version 0)', () => {
  it('theme, language, panel widths, viewport mode and the remembered interface state move into the document', () => {
    const doc = migrateLegacy({
      lang: 'es',
      theme: 'light',
      'ui.leftWidth': 300,
      'ui.rightWidth': 400,
      'ui.leftCollapsed': true,
      'ui.viewportMode': 'FAST',
      'ui.sections': { 'rw.advanced': false, material: true },
      'ui.sceneTab': 'lights',
      'ui.lightStyle': 'CINEMATIC',
      'ui.materialCategory': 'WOOD',
      'ui.tuneOpen': true,
      'ui.space': 'LOCAL',
      'ui.scaleLock': false,
    });
    expect(doc.schema).toBe(SETTINGS_SCHEMA);
    expect(doc.settings['general.lang']).toBe('es');
    expect(doc.settings['general.theme']).toBe('light');
    expect(doc.layout).toMatchObject({ leftWidth: 300, rightWidth: 400, leftCollapsed: true, viewportMode: 'FAST', sections: { 'rw.advanced': false, material: true }, sceneTab: 'lights', lightStyle: 'CINEMATIC', materialCategory: 'WOOD', tuneOpen: true, space: 'LOCAL', scaleLock: false });
    // The viewport always starts in Fast, whatever was remembered (Full rendered at once, with or without a model).
    expect(startViewportMode()).toBe('FAST');
  });

  it('values the old code would not have written are left at their factory value', () => {
    const doc = migrateLegacy({ lang: 'fr', theme: 42, 'ui.leftWidth': 9999, 'ui.viewportMode': 'TURBO' });
    expect(doc.settings['general.lang']).toBe('en');
    expect(doc.settings['general.theme']).toBe('system');
    expect(doc.layout.leftWidth).toBe(480);
    expect(doc.layout.viewportMode).toBe('FULL');
  });

  it('a document without a schema is version 0', () => {
    expect(migrateDoc({ prefs: { lang: 'es' } }).settings['general.lang']).toBe('es');
    expect(migrateDoc({}).settings).toEqual(defaultSettings());
  });
});

describe('settings: search', () => {
  const find = (q: string, lang: Lang, desktop = false) => searchSettings(q, { lang, label, desktop }).map((h) => h.row.id);

  it('finds a setting by a keyword in English and in Spanish, whatever the interface language', () => {
    expect(find('threads', 'en')).toContain('engine.threads');
    expect(find('hilos', 'en')).toContain('engine.threads');
    expect(find('hilos', 'es')[0]).toBe('engine.threads');
    expect(find('battery', 'es')).toContain('engine.viewportLimit');
    expect(find('batería', 'en')).toContain('engine.viewportLimit');
    // Without accents too.
    expect(find('bateria', 'en')).toContain('engine.viewportLimit');
    expect(find('contraste', 'en')).toContain('a11y.highContrast');
  });

  it('ranks the label in the language shown first, and needs every word', () => {
    expect(find('text size', 'en')[0]).toBe('a11y.textScale');
    expect(find('zoom speed', 'en')[0]).toBe('viewport.zoomSpeed');
    expect(find('zoom nothing-like-this', 'en')).toEqual([]);
    expect(find('', 'en')).toEqual([]);
  });

  it('desktop-only rows are found only in the desktop application', () => {
    expect(find('portable', 'en')).toEqual([]);
    expect(find('portable', 'en', true)).toContain('desktop.portable');
  });
});

describe('settings: what they drive', () => {
  it('interface size, text size, high contrast, motion and focus become tokens and attributes', () => {
    const d = displayTokens(defaultSettings());
    expect(d).toEqual({ vars: { '--ui-zoom': '1', '--text-scale': '1' }, attrs: { 'data-contrast': 'normal', 'data-motion': 'system', 'data-focus': 'auto' } });
    let s = withSetting(defaultSettings(), 'a11y.uiScale', 150);
    s = withSetting(s, 'a11y.textScale', 120);
    s = withSetting(s, 'a11y.highContrast', true);
    s = withSetting(s, 'a11y.reduceMotion', 'OFF');
    s = withSetting(s, 'a11y.focusAlways', true);
    expect(displayTokens(s)).toEqual({ vars: { '--ui-zoom': '1.5', '--text-scale': '1.2' }, attrs: { 'data-contrast': 'high', 'data-motion': 'full', 'data-focus': 'always' } });
  });

  it('render and selection defaults apply to a new project, through the render window rules', () => {
    let s = withSetting(defaultSettings(), 'render.format', 'JPEG');
    s = withSetting(s, 'render.dpi', 150);
    s = withSetting(s, 'render.samples', 1024);
    s = withSetting(s, 'render.finishBy', 'TIME');
    s = withSetting(s, 'render.seconds', 300);
    s = withSetting(s, 'render.nameTemplate', '{project}_{n}');
    s = withSetting(s, 'selection.defaultLevel', 'GROUP');
    const state = withProjectDefaults(createInitialState(), s);
    expect(state.render).toMatchObject({ format: 'JPEG', dpi: 150, maxSamples: 1024, quality: 'FINAL', finishBy: 'TIME', maxSeconds: 300, name: '{project}_{n}' });
    expect(state.selection.level).toBe('GROUP');
    expect(withProjectDefaults(createInitialState(), withSetting(defaultSettings(), 'render.samples', 100)).render.quality).toBe('CUSTOM');
    // The factory values give the project of before.
    expect(withProjectDefaults(createInitialState(), defaultSettings()).render).toEqual(createInitialState().render);
  });
});

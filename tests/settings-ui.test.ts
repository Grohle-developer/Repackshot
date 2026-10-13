// The interface side of phase U6 without a DOM: every row the metadata says is drawn by its own code has a
// renderer, the loose preferences of before move into the settings document and leave localStorage, the
// remembered interface state is saved through the document, the settings commands keep the project's
// language and theme in step, deep links open the right section, the render progress announcer speaks at
// the start, every quarter and the end, and the import defaults reach the import sheet.

import { describe, expect, it } from 'vitest';
import { defaultImportOptions } from '../src/core/import-options';
import { defaultSettings, importIsSure, SETTING_ROWS, withImportDefaults, withSetting, type SettingsDoc } from '../src/core/settings';
import { createInitialState, createStore } from '../src/core/store';
import { showFirstRunChooser } from '../src/core/models';
import type { RenderJob } from '../src/core/render';
import * as cmd from '../src/ui/commands';
import { CUSTOM_BLOCK_IDS, CUSTOM_ROW_IDS } from '../src/ui/panels/settings-window';
import { loadSettingsDoc, saveSettingsDoc, SETTINGS_STORAGE_KEY, type KeyValue } from '../src/ui/prefs';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { announcement } from '../src/ui/settings-effects';
import { createUiStore } from '../src/ui/ui-state';

function kv(initial: Record<string, string> = {}): KeyValue & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function makeCtx(): Ctx {
  return { store: createStore(createInitialState()), ui: createUiStore(), services: { projectFiles: { adopt: () => undefined } } as unknown as AppServices };
}

describe('settings window: every row has what draws it', () => {
  it('rows without a generated control have a renderer, or sit in a block drawn whole', () => {
    for (const r of SETTING_ROWS) {
      const generated = r.kind === 'setting' && r.control.kind !== 'custom';
      if (generated) continue;
      expect(CUSTOM_ROW_IDS.includes(r.id) || CUSTOM_BLOCK_IDS.includes(r.block), r.id).toBe(true);
    }
  });
});

describe('settings persistence (prefs.ts)', () => {
  it('migrates the loose entries of before into one document and removes them', () => {
    const store = kv({ 'repackshot.lang': '"es"', 'repackshot.theme': '"light"', 'repackshot.ui.leftWidth': '300', 'repackshot.ui.viewportMode': '"FAST"', 'repackshot.library': '{"keep":1}' });
    const { doc, migrated } = loadSettingsDoc(store);
    expect(migrated).toBe(true);
    expect(doc.settings['general.lang']).toBe('es');
    expect(doc.settings['general.theme']).toBe('light');
    expect(doc.layout.leftWidth).toBe(300);
    expect(doc.layout.viewportMode).toBe('FAST');
    expect(JSON.parse(store.data.get(SETTINGS_STORAGE_KEY)!).settings['general.lang']).toBe('es');
    expect([...store.data.keys()].sort()).toEqual(['repackshot.library', SETTINGS_STORAGE_KEY].sort());
    // Read again: the document, not the old entries.
    expect(loadSettingsDoc(store)).toEqual({ doc, migrated: false });
  });

  it('keeps the old entries when the new document cannot be written', () => {
    const store = kv({ 'repackshot.lang': '"es"' });
    store.setItem = () => {
      throw new Error('quota');
    };
    expect(loadSettingsDoc(store).doc.settings['general.lang']).toBe('es');
    expect(store.data.has('repackshot.lang')).toBe(true);
  });

  it('a broken document gives the factory values and is kept aside', () => {
    const store = kv({ [SETTINGS_STORAGE_KEY]: '{not json' });
    expect(loadSettingsDoc(store).doc.settings).toEqual(defaultSettings());
    expect(store.data.get(`${SETTINGS_STORAGE_KEY}.corrupt`)).toBe('{not json');
  });

  it('without storage (a private window) the application starts with the factory values', () => {
    expect(loadSettingsDoc(null).doc.settings).toEqual(defaultSettings());
    expect(saveSettingsDoc({ schema: 1, settings: defaultSettings(), layout: loadSettingsDoc(null).doc.layout } as SettingsDoc, null)).toBe(false);
  });
});

describe('remembered interface state', () => {
  it('comes from the document and goes back to it on change, and only what changed', () => {
    const saved: object[] = [];
    const layout = { ...loadSettingsDoc(null).doc.layout, leftWidth: 333, sceneTab: 'lights' };
    const ui = createUiStore({}, { layout, onLayout: (p) => saved.push(p) });
    expect(ui.get().leftWidth).toBe(333);
    expect(ui.get().sceneTab).toBe('lights');
    ui.set({ leftWidth: 400, toasts: [] });
    ui.set({ paletteOpen: true });
    ui.set({ settingsSection: 'engine' });
    expect(saved).toEqual([{ leftWidth: 400 }, { settingsSection: 'engine' }]);
  });
});

describe('settings commands', () => {
  it('the theme and the language reach the project meta the interface follows; neither is undoable', () => {
    const ctx = makeCtx();
    cmd.setSetting(ctx, 'general.theme', 'light');
    cmd.setLanguage(ctx, 'es');
    expect(ctx.ui.get().settings['general.theme']).toBe('light');
    expect(ctx.store.get().meta).toMatchObject({ theme: 'light', lang: 'es' });
    expect(ctx.store.history().undo).toEqual([]);
    cmd.resetSettingsSection(ctx, 'general');
    expect(ctx.store.get().meta).toMatchObject({ theme: 'system', lang: 'en' });
  });

  it('deep links open the section of a row, a part or a section, and remember it', () => {
    const ctx = makeCtx();
    cmd.openSettings(ctx, 'engine.threads');
    expect(ctx.ui.get().settingsWindow).toMatchObject({ section: 'engine', focus: 'engine.threads' });
    cmd.openSettings(ctx, 'ai.models');
    expect(ctx.ui.get().settingsWindow).toMatchObject({ section: 'ai', focus: 'ai.models' });
    cmd.openSettings(ctx, 'storage');
    expect(ctx.ui.get().settingsWindow).toMatchObject({ section: 'storage', focus: null });
    cmd.closeSettings(ctx);
    cmd.openSettings(ctx);
    expect(ctx.ui.get().settingsWindow?.section).toBe('storage');
    // Desktop exists only in the desktop application.
    cmd.openSettings(ctx, 'desktop');
    expect(ctx.ui.get().settingsWindow?.section).toBe('general');
  });

  it('a new project takes the render defaults; the open one never does', () => {
    const ctx = makeCtx();
    cmd.setSetting(ctx, 'render.format', 'JPEG');
    expect(ctx.store.get().render.format).toBe('PNG');
    cmd.newProject(ctx);
    expect(ctx.store.get().render.format).toBe('JPEG');
  });

  it('confirm on close is asked only with the setting on and unsaved changes', () => {
    const ctx = makeCtx();
    expect(cmd.shouldConfirmClose(ctx)).toBe(false);
    ctx.store.dispatch({ type: 'meta/rename', name: 'x' });
    expect(cmd.shouldConfirmClose(ctx)).toBe(true);
    cmd.setSetting(ctx, 'general.confirmClose', false);
    expect(cmd.shouldConfirmClose(ctx)).toBe(false);
  });

  it('the model chooser opens once, only in the desktop portable without an installer choice', () => {
    expect(showFirstRunChooser({ desktop: true, portable: true, pending: false, shown: false })).toBe(true);
    expect(showFirstRunChooser({ desktop: true, portable: false, pending: false, shown: false })).toBe(false);
    expect(showFirstRunChooser({ desktop: true, portable: true, pending: true, shown: false })).toBe(false);
    expect(showFirstRunChooser({ desktop: true, portable: true, pending: false, shown: true })).toBe(false);
    expect(showFirstRunChooser({ desktop: false, portable: true, pending: false, shown: false })).toBe(false);
    const ctx = makeCtx();
    expect(cmd.maybeShowModelChooser(ctx, { portable: true, pending: false })).toBe(false);
    ctx.ui.set({ desktop: { portable: true, dataDir: 'd', modelsDir: 'm', logsDir: 'l', browser: null, version: '0.1.0' } });
    expect(cmd.maybeShowModelChooser(ctx, { portable: true, pending: false })).toBe(true);
    expect(ctx.ui.get().settingsWindow).toMatchObject({ section: 'ai', focus: 'ai.models', chooser: true });
    expect(cmd.maybeShowModelChooser(ctx, { portable: true, pending: false })).toBe(false);
  });
});

describe('import defaults', () => {
  const detected = { units: null, upAxis: 'Y' as const, upAxisDeclared: false, size: 120, hasLayers: false, hiddenParts: 0 };

  it('apply where the file says nothing, and never over what it says', () => {
    let s = withSetting(defaultSettings(), 'import.units', 'cm');
    s = withSetting(s, 'import.upAxis', 'Z');
    s = withSetting(s, 'import.tessellation', 'HIGH');
    const o = withImportDefaults(defaultImportOptions(detected, false), detected, s);
    expect(o).toMatchObject({ units: 'cm', upAxis: 'Z', tessellation: 'HIGH' });
    const declared = { ...detected, units: 'in' as const, upAxisDeclared: true };
    expect(withImportDefaults(defaultImportOptions(declared, false), declared, s)).toMatchObject({ units: 'in', upAxis: 'Y' });
    // The factory values change nothing.
    expect(withImportDefaults(defaultImportOptions(detected, false), detected, defaultSettings())).toEqual(defaultImportOptions(detected, false));
  });

  it('"Only when unsure" skips the sheet only for a file that leaves no doubt', () => {
    expect(importIsSure({ ...detected, units: 'mm' }, [])).toBe(true);
    expect(importIsSure(detected, [])).toBe(false);
    expect(importIsSure({ ...detected, units: 'mm', hiddenParts: 2 }, [])).toBe(false);
    expect(importIsSure({ ...detected, units: 'm', size: 50 }, [])).toBe(false);
    expect(importIsSure({ ...detected, units: 'mm' }, [{ code: 'droppedTriangles', params: {} } as never])).toBe(false);
  });
});

describe('render progress for screen readers', () => {
  const job = (status: RenderJob['status'], progress: number): RenderJob => ({ id: 'j', seq: 1, settings: {} as never, status, progress, createdAt: 0, startedAt: 0, finishedAt: null, resultIds: [], error: null, frame: 0, frames: 1 });
  it('speaks at the start, every quarter and the end, once each', () => {
    const said: string[] = [];
    let q = -1;
    for (const [s, p] of [['RUNNING', 0], ['RUNNING', 0.1], ['RUNNING', 0.26], ['RUNNING', 0.3], ['RUNNING', 0.51], ['RUNNING', 0.99], ['DONE', 1], ['DONE', 1]] as const) {
      const a = announcement(job(s, p), 'Bottle_0001.png', q);
      if (a) {
        said.push(a.text);
        q = a.quarter;
      }
    }
    expect(said).toEqual(['Render started: Bottle_0001.png', 'Bottle_0001.png: 25 %', 'Bottle_0001.png: 50 %', 'Bottle_0001.png: 75 %', 'Render finished: Bottle_0001.png']);
  });
});

describe('licences shown before a download', () => {
  it('a RAIL licence shows its use restrictions (Attachment A) in full', async () => {
    const { readFileSync } = await import('node:fs');
    const { useRestrictionsOf } = await import('../src/ui/panels/settings-ai');
    const text = readFileSync('tools/third-party/CreativeML-OpenRAIL-M.txt', 'utf8');
    const r = useRestrictionsOf(text);
    expect(r.startsWith('Attachment A')).toBe(true);
    expect(r).toContain('To provide medical advice and medical results interpretation');
    expect(r).toContain('In any way that violates any applicable national, federal, state, local or international law or regulation');
    expect(useRestrictionsOf('no attachment here')).toBe('no attachment here');
  });
});

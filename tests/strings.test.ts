import { describe, expect, it } from 'vitest';
import { defaultInstance } from '../src/core/materials';
import { materialName, studioLabel } from '../src/ui/names';
import { rowShownHere, searchSettings, SETTING_ROWS } from '../src/core/settings';
import { folderLabel } from '../src/ui/panels/settings-sections';
import { browserName, desktopWindowText } from '../src/ui/window-host';
import { DESKTOP_BROWSER_FACTS, DESKTOP_STRINGS, L, STRINGS, setLang, setStringsPlatform, t, tIn, WEB_ONLY_STRINGS, type StringKey } from '../src/ui/strings';

describe('interface strings', () => {
  const en = STRINGS.en;
  const es = STRINGS.es;

  it('have the same keys in English and Spanish', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it('are never empty', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), `en ${k}`).not.toBe('');
    for (const [k, v] of Object.entries(es)) expect(v.trim(), `es ${k}`).not.toBe('');
  });

  it('use the same {placeholders} in both languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ph(es[k]), k).toEqual(ph(en[k]));
  });

  it('switch language live and interpolate', () => {
    setLang('es');
    expect(t('status.warnings', { n: 2 })).toBe('2 avisos');
    setLang('en');
    expect(t('status.warnings', { n: 2 })).toBe('2 warnings');
    expect(L('undo.assign', { material: { en: 'Gold', es: 'Oro' }, target: 'Body' })).toEqual({
      en: 'Assign Gold to Body',
      es: 'Asignar Oro a Body',
    });
  });

  it('English is the default', () => {
    expect(t('app.untitled')).toBe('Untitled');
  });
});

describe('names shown for model objects', () => {
  it('the Default material and the Standard product type', () => {
    const d = defaultInstance('m1', 100);
    expect(materialName(d, 'en')).toBe('Default');
    expect(materialName(d, 'es')).toBe('Predeterminado');
    expect(studioLabel('GENERIC')).toEqual({ en: 'Standard', es: 'Estándar' });
    expect(studioLabel('JEWELLERY').en).toBe('Jewellery');
  });
});

describe('the desktop never speaks of a browser (P3e)', () => {
  const BROWSER = /browser|navegador/i;
  const mentions = (k: StringKey) => BROWSER.test(STRINGS.en[k]) || BROWSER.test(STRINGS.es[k]);

  it('every string that mentions the browser has the desktop wording, or never shows in the desktop', () => {
    const keys = Object.keys(STRINGS.en) as StringKey[];
    const browserKeys = keys.filter(mentions);
    // The count the phase started from (34 lines of strings.ts mentioned it, keys included); the list only shrinks.
    expect(browserKeys.length).toBeGreaterThan(20);
    for (const k of browserKeys) {
      const handled = k in DESKTOP_STRINGS || WEB_ONLY_STRINGS.includes(k) || DESKTOP_BROWSER_FACTS.includes(k);
      expect(handled, `${k}: give it a desktop wording (DESKTOP_TABLE) or list it in WEB_ONLY_STRINGS`).toBe(true);
    }
    // Every entry of the lists still mentions it (a list that no longer applies is cleaned up).
    for (const k of [...WEB_ONLY_STRINGS, ...DESKTOP_BROWSER_FACTS]) expect(mentions(k), k).toBe(true);
  });

  it('the desktop wording never mentions the browser, keeps the placeholders and exists in both languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [k, pair] of Object.entries(DESKTOP_STRINGS) as [StringKey, readonly [string, string]][]) {
      expect(k in STRINGS.en, k).toBe(true);
      expect(BROWSER.test(pair[0]) || BROWSER.test(pair[1]), k).toBe(false);
      expect(pair[0].trim() && pair[1].trim(), k).toBeTruthy();
      expect(ph(pair[0]), k).toEqual(ph(STRINGS.en[k]));
      expect(ph(pair[1]), k).toEqual(ph(STRINGS.es[k]));
    }
  });

  it('switches with the platform, in t, tIn and L, and leaves the web wording alone', () => {
    expect(t('set.hw.notReported')).toBe('Not reported by the browser');
    setStringsPlatform('desktop');
    try {
      expect(t('set.hw.notReported')).toBe('Not detected');
      expect(tIn('es', 'set.engine.backend.WASM')).toBe('WebAssembly');
      expect(L('library.saveFailed').es).toContain('carpeta de datos');
      expect(t('app.untitled')).toBe('Untitled');
    } finally {
      setStringsPlatform('web');
    }
    expect(t('set.engine.backend.WASM')).toBe('Browser, WebAssembly');
  });

  it('what draws the window has a name, never an executable', () => {
    const name = (browser: string | null, window?: { kind: string; detail: string | null; reason?: string | null } | null) => desktopWindowText(window ? { reason: null, ...window } : window, browser);
    expect(name('msedge')).toBe('Microsoft Edge app window');
    expect(name('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')).toBe('Microsoft Edge app window');
    expect(name('microsoft-edge-stable')).toBe('Microsoft Edge app window');
    expect(name('chromium-browser')).toBe('Chromium app window');
    expect(name('/snap/bin/chromium')).toBe('Chromium app window');
    expect(name('google-chrome-stable')).toBe('Google Chrome app window');
    expect(name('brave-browser')).toBe('Brave app window');
    expect(name('vivaldi')).toBe('App window');
    expect(browserName('vivaldi')).toBeNull();
    // --serve-only: the launcher opened no window, and does not pretend one.
    expect(name(null)).toBe('A window the application did not open');
    // P3c's report of its own window.
    expect(name('msedge', { kind: 'webview2', detail: '131.0.2903.70' })).toBe('Repackshot’s own window (WebView2 131.0.2903.70)');
    expect(name(null, { kind: 'webview2', detail: null })).toBe('Repackshot’s own window (WebView2)');
    expect(name(null, { kind: 'browser', detail: 'chromium' })).toBe('Chromium app window');
    expect(name(null, { kind: 'browser', detail: 'msedge', reason: 'runtime-missing' })).toBe('Microsoft Edge app window (WebView2 runtime not found)');
    expect(name('default')).toBe('The default browser');
    setLang('es');
    expect(name('msedge')).toBe('Ventana de aplicación de Microsoft Edge');
    setLang('en');
    for (const raw of ['msedge', 'chromium-browser', 'google-chrome', 'brave-browser', 'C:\\x\\chrome.exe']) expect(name(raw)).not.toMatch(/msedge|chromium-browser|google-chrome|brave-browser|\.exe/);
  });

  it('an output folder of the desktop is named by its last part (its path goes on the line below)', () => {
    expect(folderLabel('/home/a/Renders')).toBe('Renders');
    expect(folderLabel('C:\\Users\\a\\Downloads\\Repackshot renders\\')).toBe('Repackshot renders');
    expect(folderLabel('Renders')).toBe('Renders');
  });

  it('rows about what the browser keeps do not exist in the desktop, nor can they be found', () => {
    const persist = SETTING_ROWS.find((r) => r.id === 'storage.persist')!;
    expect(rowShownHere(persist, false)).toBe(true);
    expect(rowShownHere(persist, true)).toBe(false);
    const label = (r: { id: string }, lang: 'en' | 'es') => STRINGS[lang][`set.${r.id}` as StringKey] ?? '';
    expect(searchSettings('persistent', { lang: 'en', label, desktop: false }).map((h) => h.row.id)).toContain('storage.persist');
    expect(searchSettings('persistent', { lang: 'en', label, desktop: true }).map((h) => h.row.id)).not.toContain('storage.persist');
    // Desktop-only rows the other way round.
    expect(searchSettings('portable', { lang: 'en', label, desktop: false }).map((h) => h.row.id)).not.toContain('desktop.portable');
    expect(searchSettings('portable', { lang: 'en', label, desktop: true }).map((h) => h.row.id)).toContain('desktop.portable');
  });
});

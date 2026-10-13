// Repackshot's own window on the desktop, seen from the interface (P3c). The window has the system's title
// bar; the page names it (`Repackshot — <project>`) and gives its colours (a dark title bar with the dark
// theme). Closing it (its close button, Alt F4, the taskbar, the system menu) reaches the page as
// `close-requested`, and the page asks about unsaved changes with its own question (U2's Save · Don't save
// · Cancel, under the project name), then answers `close-ok` or nothing: the same flow as Ctrl/⌘ W
// (`commands.requestCloseWindow`). In that window the page never
// registers `beforeunload`: no web dialog may ever appear. In a browser (and in the browser's app window
// the launcher falls back to) the browser's own "leave site?" stays, as before.

import * as cmd from './commands';
import type { WindowHostPort } from './ports';
import type { Ctx } from './reactive';
import { dyn } from './names';
import { t } from './strings';
import type { DesktopWindow } from './ui-state';

/** The part of `window` the close guard uses. */
export interface UnloadTarget {
  addEventListener(type: 'beforeunload', listener: (e: BeforeUnloadEvent) => void): void;
}

/**
 * Closing with unsaved changes. In a browser: the browser asks (its own words), unless General ▸ Confirm
 * before closing is off. In our own window: nothing here; the window asks the page (`requestCloseWindow`).
 * This is the only place the interface listens to `beforeunload` (tests/host.test.ts checks it).
 */
export function installCloseGuard(ctx: Ctx, win: UnloadTarget, host: WindowHostPort | null | undefined): void {
  if (host) return;
  win.addEventListener('beforeunload', (e) => {
    if (!cmd.shouldConfirmClose(ctx)) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

/** The colours the window paints behind the page: its background and whether the theme is dark. */
export function themeColours(doc: Document): { dark: boolean; background: string } {
  const root = doc.documentElement;
  const raw = getComputedStyle(root).getPropertyValue('--bg-0').trim();
  // A 2D context normalises any CSS colour to #rrggbb.
  let background = '#0e0e0e';
  try {
    const probe = doc.createElement('canvas').getContext('2d');
    if (probe) {
      probe.fillStyle = '#0e0e0e';
      probe.fillStyle = raw || '#0e0e0e';
      if (/^#[0-9a-f]{6}$/i.test(String(probe.fillStyle))) background = String(probe.fillStyle);
    }
  } catch {
    // Keep the dark default.
  }
  return { dark: root.dataset.theme !== 'light', background };
}

/**
 * Connects the interface to its own window: the close question, the title, the colours, and `ready` (after
 * which the window sends its info). Returns the function that disconnects, or null when the page is not in
 * that window.
 */
export function installWindowHost(ctx: Ctx, doc: Document | null = typeof document === 'undefined' ? null : document): (() => void) | null {
  const host = ctx.services.windowHost;
  if (!host) return null;
  const off = host.on((e) => {
    // The same flow as Ctrl/⌘ W (commands.requestCloseWindow): our question, then close-ok.
    if (e.kind === 'close-requested') cmd.requestCloseWindow(ctx);
  });
  host.ready();
  // The title follows the project's name (and the word for Untitled follows the language).
  let title: string | null = null;
  const sendTitle = () => {
    const name = ctx.store.get().meta.name || t('app.untitled');
    if (name === title) return;
    title = name;
    host.setTitle(name);
  };
  sendTitle();
  const offStore = ctx.store.subscribe(sendTitle);
  let observer: MutationObserver | null = null;
  if (doc) {
    let last = '';
    const sendTheme = () => {
      const c = themeColours(doc);
      const key = `${c.dark}|${c.background}`;
      if (key === last) return;
      last = key;
      host.setTheme(c.dark, c.background);
    };
    sendTheme();
    observer = new MutationObserver(sendTheme);
    observer.observe(doc.documentElement, { attributes: true });
  }
  return () => {
    off();
    offStore();
    observer?.disconnect();
  };
}

/** Product names of the browsers the launcher may open (`browser.rs`), by executable. */
const BROWSER_NAMES: Record<string, string> = {
  msedge: 'Microsoft Edge',
  'microsoft-edge': 'Microsoft Edge',
  'microsoft-edge-stable': 'Microsoft Edge',
  chrome: 'Google Chrome',
  'google-chrome': 'Google Chrome',
  'google-chrome-stable': 'Google Chrome',
  chromium: 'Chromium',
  'chromium-browser': 'Chromium',
  'brave-browser': 'Brave',
};

/**
 * Settings ▸ Desktop ▸ Window drawn by: "Repackshot's own window (WebView2 129.0.2792.65)", or the browser's
 * window and why it is not ours ("Microsoft Edge app window (WebView2 runtime not found)").
 */
export function desktopWindowText(w: DesktopWindow | null | undefined, browser: string | null): string {
  if (!w) return browser && browser !== 'default' ? t('set.dk.window.app', { browser: BROWSER_NAMES[browser] ?? browser }) : t('set.dk.defaultBrowser');
  const what =
    w.kind === 'webview2'
      ? t('set.dk.window.webview2', { version: w.detail ?? '?' })
      : w.kind === 'browser'
        ? t('set.dk.window.app', { browser: BROWSER_NAMES[w.detail ?? ''] ?? w.detail ?? '?' })
        : w.kind === 'default'
          ? t('set.dk.defaultBrowser')
          : t('set.dk.window.none');
  // On Linux the browser's window is the window (an own window there is phase P3d): no reason to give.
  const known = ['forced', 'loader-missing', 'runtime-missing', 'failed'];
  if (!w.reason || !known.includes(w.reason)) return what;
  return t('set.dk.window.because', { window: what, reason: t(dyn(`set.dk.reason.${w.reason}`)) });
}

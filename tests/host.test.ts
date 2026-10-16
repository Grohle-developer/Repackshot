// Phase P3c: Repackshot's own desktop window, from the page's side, without the window. A mock of what
// WebView2 puts in the page (`window.chrome.webview`) plays the window: it records what the page posts and
// sends the window's events. Checked here: the message protocol both ways against the contract the Rust side
// also passes (tests/fixtures/host-protocol.json); the bridge; the close flow (close-requested → our own
// Save · Don't save · Cancel question → close-ok, or nothing); the title that follows the project; that in
// the native window no `beforeunload` is ever registered (the web dialog of Edge the user saw) while the
// browser keeps its own; and what Settings ▸ Desktop says draws the window.

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { encodeCommand, parseEvent, HOST_PROTOCOL, type HostCommand } from '../src/core/host-protocol';
import { createInitialState, createStore } from '../src/core/store';
import { connectHost, downloadsFor, type WebViewLike } from '../src/io/host';
import { readProjectFile, serializeProject } from '../src/io/project';
import * as cmd from '../src/ui/commands';
import type { AppServices, DialogsPort, ProjectFilesPort, SaveResult } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { desktopWindowText, installCloseGuard, installWindowHost } from '../src/ui/window-host';

// A download in the native window is a bug (WebView2 cancels it and the file is lost): any attempt fails the test.
const downloads: string[] = [];
vi.mock('../src/ui/dom', async (original) => ({
  ...(await original<typeof import('../src/ui/dom')>()),
  downloadBlob: (_blob: Blob, name: string) => {
    downloads.push(name);
  },
}));

interface Fixture {
  pageToHost: { command: string; args?: Record<string, unknown>; message: Record<string, unknown> }[];
  hostToPage: { event: string; message: Record<string, unknown> }[];
}
const FIXTURE = JSON.parse(readFileSync('tests/fixtures/host-protocol.json', 'utf8')) as Fixture;

/** What WebView2 gives the page, played by the test: the page's posts, and the window's events. */
class MockWebView implements WebViewLike {
  readonly posted: Record<string, unknown>[] = [];
  private listeners: ((e: { data: unknown }) => void)[] = [];
  postMessage(message: unknown): void {
    // WebView2 serialises the object to JSON for the window: a round trip catches what JSON cannot carry.
    this.posted.push(JSON.parse(JSON.stringify(message)) as Record<string, unknown>);
  }
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void {
    if (type === 'message') this.listeners.push(listener);
  }
  /** The window posts a message (PostWebMessageAsJson): the page gets the parsed object in `data`. */
  emit(message: unknown): void {
    for (const l of this.listeners) l({ data: JSON.parse(JSON.stringify(message)) });
  }
  types(): string[] {
    return this.posted.map((m) => String(m.type));
  }
  titles(): string[] {
    return this.posted.filter((m) => m.type === 'title').map((m) => String(m.project));
  }
}

function commandOf(c: Fixture['pageToHost'][number]): HostCommand {
  switch (c.command) {
    case 'title':
      return { kind: 'title', project: c.args?.project as string };
    case 'theme':
      return { kind: 'theme', dark: c.args?.dark as boolean, background: c.args?.background as string };
    default:
      return { kind: c.command } as HostCommand;
  }
}

describe('the protocol with the native window (the contract both sides pass)', () => {
  it('builds every message the window reads', () => {
    expect(FIXTURE.pageToHost.length).toBeGreaterThanOrEqual(6);
    for (const c of FIXTURE.pageToHost) expect(encodeCommand(commandOf(c)), c.command).toEqual(c.message);
    expect(encodeCommand({ kind: 'ready' })).toEqual({ type: 'ready', protocol: HOST_PROTOCOL });
  });

  it('reads every message the window sends, and nothing else', () => {
    for (const c of FIXTURE.hostToPage) expect(parseEvent(c.message)?.kind, JSON.stringify(c.message)).toBe(c.event);
    expect(parseEvent(FIXTURE.hostToPage[0].message)).toEqual({ kind: 'host', protocol: 1, runtime: '129.0.2792.65' });
    for (const bad of [null, 5, 'close-requested', {}, { type: 'explode' }, { type: 'host', runtime: 1 }, { type: 'state', maximized: true }]) {
      expect(parseEvent(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('the bridge (src/io/host.ts)', () => {
  it('exists only where WebView2 put window.chrome.webview', () => {
    expect(connectHost({})).toBeNull();
    expect(connectHost({ chrome: {} })).toBeNull();
    expect(connectHost({ chrome: { webview: { postMessage: 1 } } })).toBeNull();
    expect(connectHost(null)).toBeNull();
    expect(connectHost({ chrome: { webview: new MockWebView() } })?.kind).toBe('webview2');
  });

  it('posts the commands, keeps the window’s info and hands its events on', () => {
    const wv = new MockWebView();
    const host = connectHost({ chrome: { webview: wv } })!;
    host.ready();
    host.setTitle('Bottle');
    host.setTheme(true, '#0e0e0e');
    host.close();
    host.closeOk();
    expect(wv.types()).toEqual(['ready', 'title', 'theme', 'close', 'close-ok']);
    const seen: string[] = [];
    const off = host.on((e) => seen.push(e.kind));
    // A listener that throws does not stop the others.
    host.on(() => {
      throw new Error('boom');
    });
    expect(host.info()).toBeNull();
    wv.emit({ type: 'host', protocol: 1, runtime: '130.0.2849.56' });
    wv.emit({ type: 'nonsense' });
    expect(host.info()?.runtime).toBe('130.0.2849.56');
    off();
    wv.emit({ type: 'close-requested' });
    expect(seen).toEqual(['host']);
  });
});

// --- The close flow --------------------------------------------------------------------------------------------

function makeCtx(opts: { saveResult?: SaveResult; confirmClose?: boolean } = {}) {
  const wv = new MockWebView();
  const host = connectHost({ chrome: { webview: wv } })!;
  const saves: string[] = [];
  const projectFiles: ProjectFilesPort = {
    canSaveInPlace: true,
    async save(make, name) {
      await make().text();
      saves.push(name);
      return opts.saveResult ?? { kind: 'SAVED', name, inPlace: true };
    },
    pick: async () => null,
    adopt: () => undefined,
  };
  const services = { windowHost: host, project: { serialize: serializeProject, open: readProjectFile }, projectFiles } as unknown as AppServices;
  const ui = createUiStore();
  if (opts.confirmClose === false) ui.set({ settings: { ...ui.get().settings, 'general.confirmClose': false } });
  const ctx: Ctx = { store: createStore(createInitialState()), ui, services };
  return { ctx, wv, host, saves };
}

const rename = (ctx: Ctx, name = 'Bottle') => ctx.store.dispatch({ type: 'meta/rename', name, label: { en: 'Rename', es: 'Renombrar' } });
const flush = () => new Promise((r) => setTimeout(r, 0));
const closes = (wv: MockWebView) => wv.types().filter((t) => t === 'close-ok').length;

describe('closing the native window asks in our own interface', () => {
  it('says ready when it connects, and closes at once with nothing to lose', () => {
    const { ctx, wv } = makeCtx();
    installWindowHost(ctx, null);
    expect(wv.types()).toEqual(['ready', 'title']);
    wv.emit({ type: 'close-requested' });
    expect(closes(wv)).toBe(1);
    expect(ctx.ui.get().prompt).toBeNull();
  });

  it('with unsaved changes: Save · Save as… · Don’t save, Cancel, and nothing closes until one is chosen', async () => {
    setLang('en');
    const { ctx, wv, saves } = makeCtx();
    installWindowHost(ctx, null);
    rename(ctx);
    expect(ctx.store.get().meta.dirty).toBe(true);
    wv.emit({ type: 'close-requested' });
    const spec = ctx.ui.get().prompt!;
    expect(spec.message).toBe('Save changes to “Bottle” before closing?');
    expect(spec.options.map((o) => o.label)).toEqual(['Save', 'Save as…', 'Don’t save']);
    expect(spec.cancelLabel).toBeUndefined(); // the default: Cancel
    expect(closes(wv)).toBe(0);
    // Closing again (Alt F4 twice) does not stack a second question.
    wv.emit({ type: 'close-requested' });
    expect(ctx.ui.get().prompt).toBe(spec);
    // Save: the file is written first, then the window closes.
    spec.options[0].run();
    await flush();
    expect(saves).toEqual(['bottle.repack']);
    expect(closes(wv)).toBe(1);
    expect(ctx.store.get().meta.dirty).toBe(false);
  });

  it('Don’t save closes; Cancel keeps the window; a save that is cancelled keeps it too', async () => {
    const dont = makeCtx();
    installWindowHost(dont.ctx, null);
    rename(dont.ctx);
    dont.wv.emit({ type: 'close-requested' });
    dont.ctx.ui.get().prompt!.options[2].run();
    expect(closes(dont.wv)).toBe(1);

    const cancel = makeCtx();
    installWindowHost(cancel.ctx, null);
    rename(cancel.ctx);
    cancel.wv.emit({ type: 'close-requested' });
    cancel.ctx.ui.set({ prompt: null }); // Cancel or Esc
    await flush();
    expect(closes(cancel.wv)).toBe(0);
    // The next close asks again.
    cancel.wv.emit({ type: 'close-requested' });
    expect(cancel.ctx.ui.get().prompt).not.toBeNull();

    const dialogCancelled = makeCtx({ saveResult: { kind: 'CANCELLED' } });
    installWindowHost(dialogCancelled.ctx, null);
    rename(dialogCancelled.ctx);
    dialogCancelled.wv.emit({ type: 'close-requested' });
    dialogCancelled.ctx.ui.get().prompt!.options[0].run();
    await flush();
    expect(closes(dialogCancelled.wv)).toBe(0);
    expect(dialogCancelled.ctx.store.get().meta.dirty).toBe(true);
  });

  it('General ▸ Confirm before closing off: closes without asking', () => {
    const { ctx, wv } = makeCtx({ confirmClose: false });
    rename(ctx);
    cmd.requestCloseWindow(ctx);
    expect(wv.types()).toEqual(['close-ok']);
  });

  it('the question makes the modal Settings window give way', () => {
    const { ctx } = makeCtx();
    rename(ctx);
    ctx.ui.set({ settingsWindow: { section: 'general' } as never });
    cmd.requestCloseWindow(ctx);
    expect(ctx.ui.get().settingsWindow).toBeNull();
    expect(ctx.ui.get().prompt).not.toBeNull();
  });
});

describe('one close flow for every way to close', () => {
  it('Ctrl W (guards.ts) and the window’s close (close-requested) ask the same one question', () => {
    const { ctx, wv } = makeCtx();
    installWindowHost(ctx, null);
    rename(ctx);
    cmd.requestCloseWindow(ctx); // Ctrl/⌘ W, Ctrl/⌘ Q
    const spec = ctx.ui.get().prompt!;
    wv.emit({ type: 'close-requested' }); // the close button, Alt F4, the taskbar
    cmd.requestCloseWindow(ctx);
    expect(ctx.ui.get().prompt).toBe(spec);
    spec.options[2].run();
    expect(closes(wv)).toBe(1);
  });

  it('in our own window it answers close-ok, never window.close()', () => {
    const { ctx, wv } = makeCtx();
    let closed = 0;
    (ctx.services as { desktop: unknown }).desktop = { closeWindow: () => closed++ };
    cmd.requestCloseWindow(ctx);
    expect([closes(wv), closed]).toEqual([1, 0]);
  });
});

describe('no download in the native window (files go through the launcher’s dialogs)', () => {
  it('the page’s downloader is a refusal there, the browser’s download elsewhere', () => {
    const wv = new MockWebView();
    const host = connectHost({ chrome: { webview: wv } })!;
    const got: string[] = [];
    const refused: string[] = [];
    downloadsFor(host, (_b: Blob, n: string) => got.push(n), (n) => refused.push(n))(new Blob(['x']), 'a.png');
    downloadsFor(null, (_b: Blob, n: string) => got.push(n), (n) => refused.push(n))(new Blob(['x']), 'b.png');
    expect({ got, refused }).toEqual({ got: ['b.png'], refused: ['a.png'] });
  });

  it('every export uses the save dialog, and none downloads while the dialogs are not ready', async () => {
    setLang('en');
    const { ctx } = makeCtx();
    const lib = { ...ctx.ui.get().library };
    (ctx.services as { exportScene: unknown }).exportScene = () => new Blob(['RSB']);
    (ctx.services as { captureViewport: unknown }).captureViewport = async () => new Blob(['PNG']);
    (ctx.services as { library: unknown }).library = { export: () => new Blob(['{}']) };
    ctx.ui.set({ library: { ...lib, materials: [{ id: 'm', name: 'M' }] } as never });
    downloads.length = 0;
    await cmd.exportScene(ctx);
    await cmd.exportViewport(ctx);
    await cmd.exportLibraryFile(ctx);
    expect(downloads).toEqual([]);
    expect(ctx.ui.get().toasts.map((x) => x.text)).toEqual(Array(3).fill('The save dialog is not ready yet: try again in a moment'));

    const saved: string[] = [];
    const dialogs: DialogsPort = {
      openFiles: async () => null,
      openFolderFiles: async () => null,
      saveFile: async (_blob, name) => (saved.push(name), { kind: 'SAVED', name, path: `C:\\out\\${name}` }),
      openExternal: async () => undefined,
    };
    (ctx.services as { dialogs: unknown }).dialogs = dialogs;
    await cmd.exportScene(ctx);
    await cmd.exportViewport(ctx);
    await cmd.exportLibraryFile(ctx);
    expect(downloads).toEqual([]);
    expect(saved).toEqual(['untitled.rsb', 'untitled-viewport.png', 'repackshot-library.json']);
  });

  it('the same commands in a browser still download (the test would see it)', async () => {
    const { ctx } = makeCtx();
    (ctx.services as { windowHost: unknown }).windowHost = null;
    (ctx.services as { exportScene: unknown }).exportScene = () => new Blob(['RSB']);
    downloads.length = 0;
    await cmd.exportScene(ctx);
    expect(downloads).toEqual(['untitled.rsb']);
  });
});

describe('the window’s title follows the project', () => {
  it('names the project, Untitled in the person’s language, and only when it changes', () => {
    setLang('en');
    const { ctx, wv } = makeCtx();
    const stop = installWindowHost(ctx, null)!;
    expect(wv.titles()).toEqual(['Untitled']);
    rename(ctx, 'Perfume bottle');
    ctx.store.dispatch({ type: 'image/set', patch: { exposureEv: 1 }, label: 'Exposure' });
    rename(ctx, '');
    setLang('es');
    rename(ctx, 'Frasco');
    expect(wv.titles()).toEqual(['Untitled', 'Perfume bottle', 'Untitled', 'Frasco']);
    stop();
    rename(ctx, 'After');
    expect(wv.titles()).toHaveLength(4);
    setLang('en');
  });
});

describe('no web dialog in the native window', () => {
  const fakeWindow = () => {
    const listeners: { type: string; fn: (e: BeforeUnloadEvent) => void }[] = [];
    return { listeners, addEventListener: (type: 'beforeunload', fn: (e: BeforeUnloadEvent) => void) => void listeners.push({ type, fn }) };
  };

  it('registers no beforeunload in the native window; the browser keeps its own question', () => {
    const native = makeCtx();
    const win = fakeWindow();
    installCloseGuard(native.ctx, win, native.host);
    expect(win.listeners).toEqual([]);

    const web = makeCtx();
    const browser = fakeWindow();
    installCloseGuard(web.ctx, browser, null);
    expect(browser.listeners.map((l) => l.type)).toEqual(['beforeunload']);
    let prevented = 0;
    const event = { preventDefault: () => prevented++, returnValue: undefined as unknown } as unknown as BeforeUnloadEvent;
    browser.listeners[0].fn(event);
    expect(prevented).toBe(0); // nothing unsaved
    rename(web.ctx);
    browser.listeners[0].fn(event);
    expect(prevented).toBe(1);
  });

  it('nothing else in the page listens to beforeunload (the guard is the only place)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = `${dir}/${name}`;
        try {
          return walk(path);
        } catch {
          return path.endsWith('.ts') ? [path] : [];
        }
      });
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    const users = walk('src').filter((f) => /beforeunload/.test(code(readFileSync(f, 'utf8'))));
    expect(users).toEqual(['src/ui/window-host.ts']);
    expect(/beforeunload/.test(readFileSync('index.html', 'utf8'))).toBe(false);
  });
});

describe('Settings ▸ Desktop ▸ Window drawn by', () => {
  it('says which window and, when it is not ours, why', () => {
    setLang('en');
    expect(desktopWindowText({ kind: 'webview2', detail: '129.0.2792.65', reason: null }, 'webview2')).toBe('Repackshot’s own window (WebView2 129.0.2792.65)');
    expect(desktopWindowText({ kind: 'browser', detail: 'msedge', reason: 'runtime-missing' }, 'msedge')).toBe('Microsoft Edge app window (WebView2 runtime not found)');
    expect(desktopWindowText({ kind: 'browser', detail: 'msedge', reason: 'forced' }, 'msedge')).toBe('Microsoft Edge app window (chosen with --window=browser)');
    expect(desktopWindowText({ kind: 'browser', detail: 'chromium', reason: 'not-windows' }, 'chromium')).toBe('Chromium app window');
    expect(desktopWindowText({ kind: 'default', detail: null, reason: 'loader-missing' }, 'default')).toBe('The default browser (WebView2Loader.dll is missing next to the program)');
    expect(desktopWindowText({ kind: 'none', detail: null, reason: 'failed' }, null)).toBe('No window could be opened (WebView2 failed: see the logs)');
    // A launcher before P3c: the browser it reported.
    expect(desktopWindowText(null, 'msedge')).toBe('Microsoft Edge app window');
    // No window opened by the launcher (--serve-only): said so, not "the default browser" (P3e).
    expect(desktopWindowText(undefined, null)).toBe('A window the application did not open');
    expect(desktopWindowText(undefined, 'default')).toBe('The default browser');
    setLang('es');
    expect(desktopWindowText({ kind: 'browser', detail: 'msedge', reason: 'runtime-missing' }, 'msedge')).toBe('Ventana de aplicación de Microsoft Edge (no se encontró el runtime de WebView2)');
    expect(desktopWindowText({ kind: 'webview2', detail: '129.0.2792.65', reason: null }, null)).toBe('La ventana propia de Repackshot (WebView2 129.0.2792.65)');
    setLang('en');
  });
});

// The bridge to Repackshot's own window on the desktop (phase P3c, ARCHITECTURE §5.5): when the page
// runs in the launcher's WebView2 window, `window.chrome.webview` is there and carries the messages of
// src/core/host-protocol.ts both ways. In a browser, and in the Edge/Chromium app window the launcher
// falls back to, there is no such object and `connectHost` gives null: the page keeps its `beforeunload`.

import { encodeCommand, parseEvent, type HostCommand, type HostEvent, type HostInfo } from '../core/host-protocol';

/** What WebView2 puts in the page as `window.chrome.webview` (the part used here). */
export interface WebViewLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/** The page's end of the native window: commands out, events in, and the window's info. */
export class WindowHostBridge {
  readonly kind = 'webview2' as const;
  private readonly listeners = new Set<(event: HostEvent) => void>();
  private hostInfo: HostInfo | null = null;

  constructor(private readonly webview: WebViewLike) {
    webview.addEventListener('message', (e) => {
      const event = parseEvent(e?.data);
      if (!event) return;
      if (event.kind === 'host') this.hostInfo = event;
      for (const l of [...this.listeners]) {
        try {
          l(event);
        } catch (err) {
          console.warn(`window host: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
  }

  /** The window's answer to `ready`, or null before it. */
  info(): HostInfo | null {
    return this.hostInfo;
  }

  /** Listens to the window's events; returns the function that stops. */
  on(listener: (event: HostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  send(command: HostCommand): void {
    try {
      this.webview.postMessage(encodeCommand(command));
    } catch (err) {
      console.warn(`window host: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ready(): void {
    this.send({ kind: 'ready' });
  }
  setTitle(project: string): void {
    this.send({ kind: 'title', project });
  }
  setTheme(dark: boolean, background: string): void {
    this.send({ kind: 'theme', dark, background });
  }
  /** Close as the system would: the window asks back with `close-requested`. */
  close(): void {
    this.send({ kind: 'close' });
  }
  /** The page agreed: the window closes. */
  closeOk(): void {
    this.send({ kind: 'close-ok' });
  }
}

/** The native window's bridge when the page runs in it; null in a browser or the browser's app window. */
export function connectHost(g: unknown = globalThis): WindowHostBridge | null {
  let webview: Partial<WebViewLike> | undefined;
  try {
    webview = (g as { chrome?: { webview?: Partial<WebViewLike> } } | null)?.chrome?.webview;
  } catch {
    return null;
  }
  if (!webview || typeof webview.postMessage !== 'function' || typeof webview.addEventListener !== 'function') return null;
  return new WindowHostBridge(webview as WebViewLike);
}

/**
 * The page's download function: in the native window none at all (WebView2 cancels every browser download, and
 * the launcher's dialogs write files there); `refused` hears of a download that was tried anyway. In a browser and
 * in the browser's app window, `download` itself.
 */
export function downloadsFor<B, N>(host: WindowHostBridge | { kind: 'webview2' } | null, download: (blob: B, name: N) => void, refused: (name: N) => void): (blob: B, name: N) => void {
  if (!host) return download;
  return (_blob, name) => {
    console.warn(`window host: a download of ${String(name)} was refused (files go through the launcher's dialogs)`);
    refused(name);
  };
}

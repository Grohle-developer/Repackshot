// The messages between the page and Repackshot's own window on the desktop (phase P3c): a Win32
// window with the system's title bar and WebView2 in it, whose title the page names and whose close the
// page answers. The page posts commands with `window.chrome.webview.postMessage(object)`; the window posts
// events that arrive as `message` events of `window.chrome.webview` with the object in `data`.
//
// Plain data and functions, no DOM: the bridge is src/io/host.ts, the window's side
// engine/crates/rt-app/src/platform/protocol.rs. Both pass tests/fixtures/host-protocol.json.

export const HOST_PROTOCOL = 1;

/** What the page asks of the window. */
export type HostCommand =
  /** The page listens: the window answers `host`. */
  | { kind: 'ready' }
  /** The project's name: the title becomes `Repackshot — <project>` (taskbar, Alt Tab). */
  | { kind: 'title'; project: string }
  /** A dark or light title bar, and the colour behind the page while it paints. */
  | { kind: 'theme'; dark: boolean; background: string }
  /** What the system's close does: the window answers `close-requested`. */
  | { kind: 'close' }
  /** The page agreed to close (saved, or chose not to): the window closes. */
  | { kind: 'close-ok' };

/** What the window tells the page. */
export type HostEvent =
  | { kind: 'host'; protocol: number; runtime: string }
  /** Someone wants the window closed (its close button, Alt F4, the taskbar, the system menu): ask, then `close-ok` or nothing. */
  | { kind: 'close-requested' };

export type HostInfo = Extract<HostEvent, { kind: 'host' }>;

/** The JSON object the window reads for a command. */
export function encodeCommand(c: HostCommand): Record<string, unknown> {
  switch (c.kind) {
    case 'ready':
      return { type: 'ready', protocol: HOST_PROTOCOL };
    case 'title':
      return { type: 'title', project: c.project };
    case 'theme':
      return { type: 'theme', dark: c.dark, background: c.background };
    default:
      return { type: c.kind };
  }
}

/** Reads an event of the window; null for anything else (unknown types are ignored, so the window can grow). */
export function parseEvent(data: unknown): HostEvent | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'host':
      return typeof d.runtime === 'string' ? { kind: 'host', protocol: typeof d.protocol === 'number' ? d.protocol : 0, runtime: d.runtime } : null;
    case 'close-requested':
      return { kind: 'close-requested' };
    default:
      return null;
  }
}

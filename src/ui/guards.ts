// The page behaves like an application, not like a web page (phase P3b): on
// the desktop nothing of the browser may show (ROADMAP, "Tras probar
// v0.1.0"), and in the browser version these guards keep the browser's own
// menus and shortcuts out of the way without taking anything the person needs.
//
// * No browser context menu, except in text fields (cut, copy, paste); our own
//   menus (the tree, the viewport's part menu) open as before: the guard only
//   prevents the default, it never stops the event.
// * No text selection of the chrome (guards.css, and `selectstart` here), only
//   in text fields; no dragging of images and links.
// * The browser's shortcuts that make no sense here do nothing: print, reload,
//   zoom (keys and Ctrl + wheel), find, view source, downloads, history,
//   bookmarks, new tab or window, caret browsing, back and forward (Alt + arrows,
//   the mouse's side buttons), full screen, the developer tools in a
//   production build. Every shortcut of shortcuts.ts still runs: a key the
//   guard prevented is marked (`preventedByGuard`) so app.ts handles it anyway.
// * Desktop only: Ctrl/⌘ W and Ctrl/⌘ Q go through the unsaved-changes
//   question, links open in the system's browser, and whatever is dropped
//   outside a drop target never navigates.

/** The fields of a KeyboardEvent the decision reads (a plain object in the tests). */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface GuardContext {
  /** The page runs in the desktop launcher's window. */
  desktop: boolean;
  /** A production build: the developer tools' shortcuts are blocked too. */
  production: boolean;
  /** macOS: the browser's shortcuts use ⌘, and Ctrl + letter is text editing (Ctrl A, E, K…), left alone. */
  mac: boolean;
}

/** What to do with a key: let it be (null), block the browser's action, or block it and do ours. */
export type KeyVerdict = null | 'block' | 'close' | 'find';

const letter = (e: KeyLike, l: string) => e.code === `Key${l.toUpperCase()}` || e.key.toLowerCase() === l;

/** Ctrl/⌘ + one of these letters (no Shift, no Alt) is the browser's: print, reload, find, view source, downloads, history, bookmark, search, address bar, new window, new tab, open, save page. */
const MOD_LETTERS = ['p', 'r', 'f', 'g', 'u', 'j', 'h', 'd', 'e', 'l', 'n', 't', 'o', 's', 'k'];
/** Ctrl/⌘ + Shift + one of these: print dialog, hard reload, find previous, bookmark all, new private window, reopen tab, bookmarks bar, bookmarks manager, tab search, profiles, Edge's collections, read aloud and web capture, save as. */
const MOD_SHIFT_LETTERS = ['p', 'r', 'g', 'd', 'n', 't', 'b', 'o', 'a', 'm', 'y', 'u', 's', 'e', 'x'];
/** Keys that are the browser's whatever the modifiers: reload, help, find next, address bar, caret browsing, menu, full screen. */
const BROWSER_KEYS = ['F1', 'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'BrowserBack', 'BrowserForward', 'BrowserRefresh', 'BrowserHome', 'BrowserSearch', 'BrowserFavorites', 'BrowserStop'];

/**
 * What the guard does with a key press (`typing`: the focus is in a text field). Pure: the tests call it with plain
 * objects.
 */
export function browserShortcut(e: KeyLike, c: GuardContext, typing = false): KeyVerdict {
  const mod = c.mac ? e.metaKey : e.ctrlKey;
  const other = c.mac ? e.ctrlKey : e.metaKey;
  // AltGr is Ctrl + Alt on Windows: it types characters (@, {, }), never a browser shortcut of these.
  const plainMod = mod && !e.altKey && !other;
  if (BROWSER_KEYS.includes(e.key) || BROWSER_KEYS.includes(e.code)) return 'block';
  if (c.production && (e.key === 'F12' || e.code === 'F12')) return 'block';
  // Back and forward, home page; the bare Alt that focuses the browser's menu (not in a field: Alt codes type there).
  if (e.altKey && !mod && !other && ['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return 'block';
  if (e.key === 'Alt' && !mod && !other && !e.shiftKey && !typing) return 'block';
  if (e.altKey && !mod && !other && !c.mac && (letter(e, 'f') || letter(e, 'e'))) return 'block';
  if (!plainMod) {
    // ⌘ ⌥ I / J / C: the developer tools on macOS.
    if (c.production && e.metaKey && e.altKey && !e.ctrlKey && (letter(e, 'i') || letter(e, 'j') || letter(e, 'c'))) return 'block';
    return null;
  }
  // Zoom: Ctrl/⌘ + / = / - / 0 and the keypad's.
  if (['+', '=', '-', '_', '0'].includes(e.key) || ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(e.code)) return 'block';
  if (c.desktop && !e.shiftKey && (letter(e, 'w') || letter(e, 'q'))) return 'close';
  if (c.desktop && e.shiftKey && letter(e, 'w')) return 'close';
  if (e.shiftKey) {
    if (c.production && (letter(e, 'i') || letter(e, 'j') || letter(e, 'c'))) return 'block';
    if (e.key === 'Delete') return 'block';
    // Ctrl ⇧ U types a Unicode character in a Linux field (IBus); elsewhere it is Edge's read aloud.
    if (typing && letter(e, 'u')) return null;
    return MOD_SHIFT_LETTERS.some((l) => letter(e, l)) ? 'block' : null;
  }
  if (letter(e, 'f')) return 'find';
  if (MOD_LETTERS.some((l) => letter(e, l))) return 'block';
  // ⌘ , is the browser's settings on macOS (the application's own Settings shortcut still runs).
  if (e.key === ',') return 'block';
  return null;
}

/** The parts of an element the decisions read. */
interface ElementLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  readOnly?: boolean;
  closest?(selector: string): unknown;
}

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

/** A field where text is typed and selected: the browser's own editing menu and selection stay there. */
export function isTextField(target: unknown): boolean {
  const el = target as ElementLike | null;
  if (!el || typeof el !== 'object') return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return TEXT_INPUTS.has((el.type ?? '').toLowerCase());
  return false;
}

/** Elements marked by a component as selectable text (`data-selectable`), e.g. a path the person may copy. */
function isSelectable(target: unknown): boolean {
  const el = target as ElementLike | null;
  return !!el && typeof el.closest === 'function' && !!el.closest('[data-selectable]');
}

/** Events the guard prevented that the application still handles (its own shortcuts). */
const prevented = new WeakSet<Event>();

/** True when only the guard prevented this event: app.ts runs its shortcut for it anyway. */
export function preventedByGuard(e: Event): boolean {
  return prevented.has(e);
}

export interface GuardHooks {
  /** Ctrl/⌘ W, Ctrl/⌘ Q on the desktop: the unsaved-changes question, then the window closes. */
  onClose?: () => void;
  /** A link to another site, on the desktop: the system's browser opens it. */
  openExternal?: (url: string) => void;
}

export interface Guards {
  /** The page is (or is not) in the desktop launcher's window; known once the launcher answered. */
  setDesktop(desktop: boolean, hooks?: GuardHooks): void;
  readonly context: GuardContext;
  dispose(): void;
}

/** Our own search field near the focus (a panel's filter, the palette), for Ctrl/⌘ F. */
function searchFieldNear(doc: Document): HTMLInputElement | null {
  const active = doc.activeElement as HTMLElement | null;
  const scope = (active?.closest?.('.panel, .sw, .rw, aside, section') as HTMLElement | null) ?? doc;
  const fields = [...scope.querySelectorAll<HTMLInputElement>('input[type="search"]')].filter((f) => f.offsetParent !== null && !f.disabled);
  return fields[0] ?? null;
}

/** Installs the guards on a window. In the browser version `setDesktop` is never called with true. */
export function installGuards(win: Window, production: boolean): Guards {
  const doc = win.document;
  const nav = win.navigator as Navigator | undefined;
  const mac = /Mac|iPhone|iPad/.test(nav?.platform || nav?.userAgent || '');
  const context: GuardContext = { desktop: false, production, mac };
  let hooks: GuardHooks = {};
  const off: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts: AddEventListenerOptions) => {
    win.addEventListener(type, fn as EventListener, opts);
    off.push(() => win.removeEventListener(type, fn as EventListener, opts));
  };

  // Keys: first of all (capture on the window), so no field that stops the event lets the browser act.
  on(
    'keydown',
    (e) => {
      const verdict = browserShortcut(e, context, isTextField(e.target));
      if (!verdict) return;
      e.preventDefault();
      prevented.add(e);
      if (verdict === 'close') {
        if (!e.repeat) hooks.onClose?.();
      } else if (verdict === 'find' && !isTextField(e.target)) {
        searchFieldNear(doc)?.focus();
      }
    },
    { capture: true },
  );
  // Ctrl + wheel and trackpad pinch (a wheel with ctrlKey) zoom the page: never (the viewport still gets the event).
  on(
    'wheel',
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { capture: true, passive: false },
  );
  // The browser's context menu: only in text fields.
  on(
    'contextmenu',
    (e) => {
      if (!isTextField(e.target)) e.preventDefault();
    },
    { capture: true },
  );
  // Selection starts only in text fields and marked text.
  on(
    'selectstart',
    (e) => {
      if (!isTextField(e.target) && !isSelectable(e.target)) e.preventDefault();
    },
    { capture: true },
  );
  // Images and links are not dragged out of the window (our draggable elements set draggable="true").
  on(
    'dragstart',
    (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || typeof t.closest !== 'function') return;
      const dragged = t.closest('img, a');
      if (dragged && !dragged.closest('[draggable="true"]')) e.preventDefault();
    },
    { capture: true },
  );
  // The mouse's back and forward buttons.
  const sideButton = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  };
  on('mousedown', sideButton, { capture: true });
  on('mouseup', sideButton, { capture: true });
  on('auxclick', sideButton, { capture: true });
  // Whatever is dropped where nothing takes it (a link, text, a file outside the viewport that app.ts did not
  // take) never navigates the window away from the project.
  on(
    'dragover',
    (e) => {
      if (e.defaultPrevented || isTextField(e.target)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    },
    { capture: false },
  );
  on(
    'drop',
    (e) => {
      if (!e.defaultPrevented && !isTextField(e.target)) e.preventDefault();
    },
    { capture: false },
  );
  // Links: on the desktop, to the system's browser; never a new window of the app's browser.
  on(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented) return;
      const external = /^https?:/i.test(a.href) && new URL(a.href, win.location.href).origin !== win.location.origin;
      if (!context.desktop || !external) {
        // Shift/Ctrl/⌘ + click on a link opens a browser window or tab: not from the app (a plain click still works).
        if (context.desktop && (e.shiftKey || e.ctrlKey || e.metaKey)) e.preventDefault();
        return;
      }
      e.preventDefault();
      hooks.openExternal?.(a.href);
    },
    { capture: true },
  );
  // A middle click on a link opens a tab.
  on(
    'auxclick',
    (e) => {
      if (e.button === 1 && (e.target as HTMLElement | null)?.closest?.('a[href]')) e.preventDefault();
    },
    { capture: true },
  );

  // Fields: no autofill suggestions, no spelling underline (inherited from <html>); images and links not draggable
  // (unless a component made them so) — whatever builds them.
  const fieldDefaults = (root: ParentNode) => {
    for (const el of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([autocomplete]), textarea:not([autocomplete])')) el.setAttribute('autocomplete', 'off');
    for (const el of root.querySelectorAll('img:not([draggable]), a:not([draggable])')) el.setAttribute('draggable', 'false');
  };
  doc.documentElement.setAttribute('spellcheck', 'false');
  if (doc.body) fieldDefaults(doc.body);
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver === 'function' && doc.body) {
    observer = new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          const el = n as Element;
          if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.hasAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
          if ((el.tagName === 'IMG' || el.tagName === 'A') && !el.hasAttribute('draggable')) el.setAttribute('draggable', 'false');
          if (el.firstElementChild) fieldDefaults(el);
        }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  // The window's title bar (an app window, a WebView2 frame) takes the header's grey of the theme in force.
  const themeColor = () => {
    let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = doc.createElement('meta');
      meta.name = 'theme-color';
      doc.head?.appendChild(meta);
    }
    const grey = win.getComputedStyle?.(doc.documentElement).getPropertyValue('--bg-1').trim();
    if (grey) meta.content = grey;
  };
  themeColor();
  let themeObserver: MutationObserver | null = null;
  if (typeof MutationObserver === 'function') {
    themeObserver = new MutationObserver(themeColor);
    themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-contrast'] });
  }

  return {
    context,
    setDesktop(desktop, h = {}) {
      context.desktop = desktop;
      hooks = h;
    },
    dispose() {
      for (const f of off) f();
      observer?.disconnect();
      themeObserver?.disconnect();
    },
  };
}

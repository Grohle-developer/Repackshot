// The page's guards against the browser's own interface (phase P3b, ui/guards.ts): which keys are the browser's,
// what happens to them in a window without a DOM library (Node's EventTarget stands in for the window), and that
// every shortcut of the application still reaches it. The real browser is checked by tools/desktop-window-check.mjs.

import { describe, expect, it } from 'vitest';
import { browserShortcut, installGuards, isTextField, preventedByGuard, type GuardContext, type KeyLike } from '../src/ui/guards';
import { ACTIONS } from '../src/ui/shortcuts';

const WIN: GuardContext = { desktop: false, production: true, mac: false };
const DESK: GuardContext = { desktop: true, production: true, mac: false };
const MAC: GuardContext = { desktop: false, production: true, mac: true };

/** `ctrl+shift+p`, `alt+ArrowLeft`, `F5`… as a key event. */
function key(spec: string, extra: Partial<KeyLike> = {}): KeyLike {
  const parts = spec.endsWith('++') ? [...spec.slice(0, -2).split('+'), '+'] : spec.split('+');
  const k = parts[parts.length - 1];
  const has = (m: string) => parts.slice(0, -1).includes(m);
  const code = /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : k === '+' || k === '=' ? 'Equal' : k === '-' ? 'Minus' : k;
  return { key: k.length === 1 ? k : k, code, ctrlKey: has('ctrl'), metaKey: has('meta'), shiftKey: has('shift'), altKey: has('alt'), ...extra };
}

describe('the browser shortcuts the guard blocks', () => {
  it('print, reload, zoom, find, source, downloads, history, bookmarks, windows and tabs', () => {
    for (const spec of ['ctrl+p', 'ctrl+shift+p', 'ctrl+r', 'ctrl+shift+r', 'F5', 'ctrl+F5', 'shift+F5', 'ctrl++', 'ctrl+=', 'ctrl+-', 'ctrl+0', 'ctrl+u', 'ctrl+j', 'ctrl+h', 'ctrl+d', 'ctrl+shift+d', 'ctrl+g', 'ctrl+shift+g', 'F3', 'ctrl+n', 'ctrl+shift+n', 'ctrl+t', 'ctrl+shift+t', 'ctrl+e', 'ctrl+l', 'ctrl+s', 'ctrl+shift+s', 'ctrl+o', 'ctrl+shift+b', 'ctrl+shift+o', 'ctrl+shift+a', 'ctrl+shift+y', 'F1', 'F6', 'F7', 'F10', 'F11', 'alt+ArrowLeft', 'alt+ArrowRight', 'alt+Home', 'alt+f', 'Alt']) {
      expect(browserShortcut(key(spec), WIN), spec).toBe('block');
    }
    // The keypad's zoom keys, and a layout where + is its own key (Spanish).
    expect(browserShortcut({ ...key('ctrl+x'), key: '+', code: 'NumpadAdd' }, WIN)).toBe('block');
    expect(browserShortcut({ ...key('ctrl+x'), key: '+', code: 'BracketRight' }, WIN)).toBe('block');
    expect(browserShortcut({ ...key('ctrl+x'), key: 'BrowserBack', code: 'BrowserBack' }, WIN)).toBe('block');
    expect(browserShortcut(key('ctrl+shift+Delete'), WIN)).toBe('block');
  });

  it('Ctrl/⌘ F never opens the find bar: it looks for our own search field', () => {
    expect(browserShortcut(key('ctrl+f'), WIN)).toBe('find');
    expect(browserShortcut(key('meta+f'), MAC)).toBe('find');
  });

  it('the developer tools only in a production build', () => {
    for (const spec of ['F12', 'ctrl+shift+i', 'ctrl+shift+j', 'ctrl+shift+c']) {
      expect(browserShortcut(key(spec), WIN), spec).toBe('block');
      expect(browserShortcut(key(spec), { ...WIN, production: false }), spec).toBe(spec === 'ctrl+shift+c' ? null : null);
    }
    expect(browserShortcut(key('meta+alt+i'), MAC)).toBe('block');
    expect(browserShortcut(key('meta+alt+i'), { ...MAC, production: false })).toBeNull();
  });

  it('Ctrl/⌘ W and Q close through our question on the desktop, and are the browser’s in a web page', () => {
    for (const spec of ['ctrl+w', 'ctrl+shift+w', 'ctrl+q']) {
      expect(browserShortcut(key(spec), DESK), spec).toBe('close');
      expect(browserShortcut(key(spec), WIN), spec).toBeNull();
    }
  });

  it('leaves typing alone: editing keys, AltGr characters, Alt codes, Ctrl ⇧ U, the Mac’s Ctrl letters', () => {
    for (const spec of ['ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z', 'ctrl+y', 'ctrl+shift+z', 'ctrl+shift+v', 'ctrl+ArrowLeft', 'ctrl+Backspace', 'shift+ArrowLeft', 'a', 'Enter', 'Escape', 'Tab', 'ctrl+1']) {
      expect(browserShortcut(key(spec), WIN), spec).toBeNull();
    }
    // AltGr + 0 is "}" on a German keyboard (Ctrl + Alt + Digit0): typed, not zoom.
    expect(browserShortcut({ ...key('ctrl+alt+0'), key: '}' }, WIN)).toBeNull();
    expect(browserShortcut({ ...key('ctrl+alt+2'), key: '@' }, WIN)).toBeNull();
    // Alt alone in a field starts an Alt code (Windows).
    expect(browserShortcut(key('Alt'), WIN, true)).toBeNull();
    expect(browserShortcut(key('ctrl+shift+u'), WIN, true)).toBeNull();
    expect(browserShortcut(key('ctrl+shift+u'), WIN, false)).toBe('block');
    // On a Mac the browser's shortcuts are ⌘; Ctrl + E, K, A… edit the text.
    for (const spec of ['ctrl+e', 'ctrl+k', 'ctrl+a', 'ctrl+d', 'ctrl+h', 'ctrl+f', 'ctrl+p']) expect(browserShortcut(key(spec), MAC), spec).toBeNull();
    for (const spec of ['meta+p', 'meta+r', 'meta+=', 'meta+0', 'meta+,', 'meta+shift+n']) expect(browserShortcut(key(spec), MAC), spec).toBe('block');
  });

  it('every shortcut of the application still runs: blocked ones are marked for app.ts, none closes or finds', () => {
    for (const a of ACTIONS) {
      for (const spec of [a.keys, ...(a.altKeys ?? [])].filter((s): s is string => !!s)) {
        const e = key(spec.replace(/^mod\+/, 'ctrl+').replace('+mod+', '+ctrl+').replace('escape', 'Escape').replace('enter', 'Enter').replace('delete', 'Delete').replace('backspace', 'Backspace').replace('tab', 'Tab'));
        const v = browserShortcut(e, DESK);
        expect([null, 'block'], `${a.id} ${spec}`).toContain(v);
      }
    }
  });
});

describe('text fields', () => {
  it('are inputs that take text, text areas and editable elements', () => {
    expect(isTextField({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextField({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTextField({ tagName: 'INPUT', type: '' })).toBe(true);
    expect(isTextField({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextField({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    for (const t of ['checkbox', 'range', 'color', 'button', 'file']) expect(isTextField({ tagName: 'INPUT', type: t }), t).toBe(false);
    expect(isTextField({ tagName: 'DIV' })).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

// ------------------------------------------------------------------ the guards on a window without a DOM library

class FakeElement extends EventTarget {
  readonly attrs = new Map<string, string>();
  isContentEditable = false;
  parent: FakeElement | null = null;
  constructor(
    readonly tagName: string,
    readonly type = '',
  ) {
    super();
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  closest(sel: string): FakeElement | null {
    for (let el: FakeElement | null = this; el; el = el.parent) {
      for (const s of sel.split(',').map((x) => x.trim())) {
        if (s === el.tagName.toLowerCase()) return el;
        if (s === 'a[href]' && el.tagName === 'A' && el.attrs.has('href')) return el;
        if (s === '[draggable="true"]' && el.attrs.get('draggable') === 'true') return el;
      }
    }
    return null;
  }
  get href() {
    return this.attrs.get('href') ?? '';
  }
}

function fakeWindow() {
  const html = new FakeElement('HTML');
  const doc = {
    documentElement: html,
    body: null,
    head: null,
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (t: string) => new FakeElement(t.toUpperCase()),
  };
  const win = Object.assign(new EventTarget(), { document: doc, navigator: { platform: 'Win32', userAgent: '' }, location: { href: 'http://127.0.0.1:5/', origin: 'http://127.0.0.1:5' } });
  return { win: win as unknown as Window, html };
}

function fire(win: Window, type: string, props: Record<string, unknown>, target: unknown): Event {
  const e = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(e, 'target', { value: target });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
  (win as unknown as EventTarget).dispatchEvent(e);
  return e;
}

describe('installGuards', () => {
  it('prevents the browser’s menu, selection, zoom and keys, and marks the keys the application still handles', () => {
    const { win, html } = fakeWindow();
    const g = installGuards(win, true);
    expect(html.getAttribute('spellcheck')).toBe('false');
    const div = new FakeElement('DIV');
    const input = new FakeElement('INPUT', 'text');
    expect(fire(win, 'contextmenu', {}, div).defaultPrevented).toBe(true);
    expect(fire(win, 'contextmenu', {}, input).defaultPrevented).toBe(false);
    expect(fire(win, 'selectstart', {}, div).defaultPrevented).toBe(true);
    expect(fire(win, 'selectstart', {}, input).defaultPrevented).toBe(false);
    expect(fire(win, 'wheel', { ctrlKey: true }, div).defaultPrevented).toBe(true);
    expect(fire(win, 'wheel', { ctrlKey: false }, div).defaultPrevented).toBe(false);
    for (const spec of ['ctrl+p', 'F5', 'ctrl+=', 'ctrl+s']) {
      const e = fire(win, 'keydown', { ...key(spec), repeat: false }, div);
      expect(e.defaultPrevented, spec).toBe(true);
      expect(preventedByGuard(e), spec).toBe(true);
    }
    const typed = fire(win, 'keydown', { ...key('ctrl+c'), repeat: false }, input);
    expect(typed.defaultPrevented).toBe(false);
    expect(preventedByGuard(typed)).toBe(false);
    // The mouse's back button, an image dragged out of the window, a link dropped in.
    expect(fire(win, 'mouseup', { button: 3 }, div).defaultPrevented).toBe(true);
    expect(fire(win, 'mouseup', { button: 0 }, div).defaultPrevented).toBe(false);
    const img = new FakeElement('IMG');
    expect(fire(win, 'dragstart', {}, img).defaultPrevented).toBe(true);
    const card = new FakeElement('DIV');
    card.setAttribute('draggable', 'true');
    const thumb = new FakeElement('IMG');
    thumb.parent = card;
    // A material's thumbnail inside a draggable card is dragged with it (U7).
    expect(fire(win, 'dragstart', {}, thumb).defaultPrevented).toBe(false);
    expect(fire(win, 'drop', {}, div).defaultPrevented).toBe(true);
    expect(fire(win, 'drop', {}, input).defaultPrevented).toBe(false);
    g.dispose();
    expect(fire(win, 'contextmenu', {}, div).defaultPrevented).toBe(false);
  });

  it('on the desktop: Ctrl/⌘ W asks our question once per press, links open in the system’s browser', () => {
    const { win } = fakeWindow();
    const g = installGuards(win, true);
    const closes: number[] = [];
    const opened: string[] = [];
    const div = new FakeElement('DIV');
    // Not yet known to be the desktop: the browser keeps Ctrl+W.
    expect(fire(win, 'keydown', { ...key('ctrl+w'), repeat: false }, div).defaultPrevented).toBe(false);
    g.setDesktop(true, { onClose: () => closes.push(1), openExternal: (u) => opened.push(u) });
    expect(fire(win, 'keydown', { ...key('ctrl+w'), repeat: false }, div).defaultPrevented).toBe(true);
    fire(win, 'keydown', { ...key('ctrl+w'), repeat: true }, div);
    expect(closes).toEqual([1]);
    const a = new FakeElement('A');
    a.setAttribute('href', 'https://polyformproject.org/licenses/noncommercial/1.0.0/');
    const click = fire(win, 'click', { shiftKey: false, ctrlKey: false, metaKey: false }, a);
    expect(click.defaultPrevented).toBe(true);
    expect(opened).toEqual(['https://polyformproject.org/licenses/noncommercial/1.0.0/']);
    g.dispose();
  });
});

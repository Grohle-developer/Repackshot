// Tiny DOM helpers: `h` builds elements, `icon` builds an inline SVG icon.

import { ICONS, type IconName } from './icons';

export type Child = Node | string | number | null | undefined | false | Child[];

export type Attrs = Record<string, unknown> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | string;
};

function append(el: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(el, c);
    return;
  }
  el.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
}

/** Creates an element: on* attributes become listeners, data-* and aria-* stay attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k in el && !k.includes('-') && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) append(el, c);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Replaces the children of `el`. */
export function setChildren(el: Element, ...children: Child[]): void {
  clear(el);
  for (const c of children) append(el, c);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Monochrome inline icon: 1.5 px stroke in currentColor, 16 px box by default. */
export function icon(name: IconName, size = 16, label?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String((1.5 * 24) / size));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'icon');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    if (d.startsWith('c:')) {
      const [cx, cy, r, fill] = d.slice(2).split(',');
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', cx);
      c.setAttribute('cy', cy);
      c.setAttribute('r', r);
      if (fill === 'f') c.setAttribute('fill', 'currentColor');
      svg.appendChild(c);
    } else {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
  }
  return svg;
}

/** Whether the event target is a text field (shortcuts must not fire there). */
export function isTyping(e: Event): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.getAttribute?.('role') === 'spinbutton') return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'range', 'color'].includes(el.type);
  return false;
}

/** Downloads a blob under a file name. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Linear 0..1 colour channel to an sRGB hex string (for colour inputs). */
export function linearToHex(rgb: readonly number[]): string {
  const enc = (c: number) => {
    const v = Math.max(0, Math.min(1, c));
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${enc(rgb[0])}${enc(rgb[1])}${enc(rgb[2])}`;
}

/** sRGB hex string to linear 0..1 channels. */
export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  const dec = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = dec((n >> 16) & 255);
  const g = dec((n >> 8) & 255);
  const b = dec(n & 255);
  const round = (x: number) => Math.round(x * 10000) / 10000;
  return [round(r), round(g), round(b)];
}

/**
 * The effective CSS zoom of an element (Settings ▸ Accessibility ▸ Interface size zooms the chrome). A
 * position written in `left` / `top` is multiplied by it, while pointer events and getBoundingClientRect are in
 * screen pixels: positions computed from those are divided by it (`placeAt`).
 */
export function cssZoom(el: Element): number {
  const z = (el as Element & { currentCSSZoom?: number }).currentCSSZoom;
  return typeof z === 'number' && z > 0 ? z : 1;
}

/** Puts a fixed element at a point of the screen (CSS pixels of the window), whatever the interface size. */
export function placeAt(el: HTMLElement, x: number, y: number): void {
  const z = cssZoom(el);
  el.style.left = `${x / z}px`;
  el.style.top = `${y / z}px`;
}

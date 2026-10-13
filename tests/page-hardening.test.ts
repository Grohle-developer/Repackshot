// The page as an application (phase P3b): not offered for translation, with its own icon (favicon, app manifest,
// achromatic like the chrome) and the guards installed. The served files are checked in the browser by
// tools/desktop-window-check.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';

/** A PNG's size and RGBA pixels (8-bit RGBA, not interlaced: what Chromium's canvas writes). */
function decodePng(buf: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (pos < buf.length) {
    const len = v.getUint32(pos);
    const type = String.fromCharCode(...buf.subarray(pos + 4, pos + 8));
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = v.getUint32(pos + 8);
      height = v.getUint32(pos + 12);
      expect([data[8], data[9], data[12]], 'bit depth, colour type, interlace').toEqual([8, 6, 0]);
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const joined = new Uint8Array(idat.reduce((a, d) => a + d.length, 0));
  idat.reduce((at, d) => (joined.set(d, at), at + d.length), 0);
  const raw = inflateSync(joined);
  const stride = width * 4;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const val = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * stride + x] = (val + [0, a, b, (a + b) >> 1, paeth][f]) & 255;
    }
  }
  return { width, height, rgba: out };
}

const grey = (rgba: Uint8Array) => {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    if (Math.abs(rgba[i] - rgba[i + 1]) > 1 || Math.abs(rgba[i + 1] - rgba[i + 2]) > 1) return false;
  }
  return true;
};

const publicFile = (href: string) => `public/${href.replace(/^\//, '')}`;

describe('index.html', () => {
  it('is an application the browser does not offer to translate', () => {
    expect(indexHtml).toMatch(/<html[^>]*\btranslate="no"/);
    expect(indexHtml).toMatch(/<html[^>]*\bclass="notranslate"/);
    expect(indexHtml).toContain('<meta name="google" content="notranslate" />');
    expect(indexHtml).toContain('<title>Repackshot</title>');
    // The old empty icon is gone.
    expect(indexHtml).not.toContain('href="data:,"');
  });

  it('links a real favicon, the app icons and the manifest, all in public/', () => {
    const links = [...indexHtml.matchAll(/<link rel="(icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)].map((m) => [m[1], m[2]] as const);
    const rels = links.map(([r]) => r);
    expect(rels).toContain('icon');
    expect(rels).toContain('manifest');
    expect(rels).toContain('apple-touch-icon');
    for (const [, href] of links) expect(existsSync(publicFile(href)), href).toBe(true);
    expect(links.map(([, h]) => h)).toContain('/favicon.ico');
  });

  it('has an achromatic theme colour for the window’s title bar', () => {
    const m = /<meta name="theme-color" content="#([0-9a-f]{6})"/i.exec(indexHtml);
    expect(m).not.toBeNull();
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16));
    expect(r === g && g === b).toBe(true);
  });
});

describe('the icons', () => {
  it('the manifest names the application and icons that exist at their sizes', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { name: string; icons: { src: string; sizes: string; type: string }[]; theme_color: string; background_color: string };
    expect(manifest.name).toBe('Repackshot');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      const path = `public/${icon.src}`;
      expect(existsSync(path), icon.src).toBe(true);
      if (icon.type !== 'image/png') continue;
      const png = decodePng(readFileSync(path));
      expect(`${png.width}x${png.height}`).toBe(icon.sizes);
    }
    for (const c of [manifest.theme_color, manifest.background_color]) expect(c.slice(1, 3) === c.slice(3, 5) && c.slice(3, 5) === c.slice(5, 7), c).toBe(true);
  });

  it('every PNG is black and white, like the chrome (tools/icons.mjs renders them from docs/media/logo.svg)', () => {
    for (const size of [16, 32, 48, 180, 192, 512]) {
      const png = decodePng(readFileSync(`public/icon-${size}.png`));
      expect(png.width, `${size}`).toBe(size);
      expect(grey(png.rgba), `icon-${size}.png`).toBe(true);
    }
    expect(readFileSync('public/icon.svg', 'utf8')).toBe(readFileSync('docs/media/logo.svg', 'utf8'));
  });

  it('favicon.ico holds the small sizes', () => {
    const ico = readFileSync('public/favicon.ico');
    const v = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect(v.getUint16(0, true)).toBe(0);
    expect(v.getUint16(2, true)).toBe(1);
    const n = v.getUint16(4, true);
    const sizes = Array.from({ length: n }, (_, i) => ico[6 + i * 16] || 256);
    expect(sizes).toEqual([16, 24, 32, 48, 64]);
  });
});

describe('the guards are part of the application', () => {
  it('main.ts installs them first and loads their stylesheet', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toContain("import './ui/guards.css';");
    expect(main.indexOf('installGuards(window')).toBeGreaterThan(0);
    // Before the page connects to the launcher (the platform seam does it, io/platform.ts, P3e).
    expect(main.indexOf('choosePlatform()')).toBeGreaterThan(0);
    expect(main.indexOf('installGuards(window')).toBeLessThan(main.indexOf('choosePlatform()'));
    const css = readFileSync('src/ui/guards.css', 'utf8');
    expect(css).toMatch(/html \{[^}]*user-select: none/);
    expect(css).toMatch(/-webkit-user-drag: none/);
  });

  it('the page never calls the browser’s own dialogs', () => {
    // alert, confirm, prompt and print show the browser's interface; the application has its own (UI.md §4.3).
    const files = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThan(50);
    for (const [name, text] of Object.entries(files)) {
      const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(/\b(window\.)?(alert|confirm|prompt)\s*\(/.test(code.replace(/\.(confirm|prompt)\b/g, '')), name).toBe(false);
      expect(/\bwindow\.print\s*\(|\bprint\(\)/.test(code), name).toBe(false);
      expect(/\bwindow\.open\s*\(/.test(code), name).toBe(false);
    }
  });
});

// The application icon, from docs/media/logo.svg (black and white): rendered
// by the local Chromium (playwright-core) at every size an .ico wants, written
// as PNGs and as one multi-size .ico (32-bit BMP images up to 48 px, PNG
// above, as Windows Vista and later read them).

import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** A Chromium executable: REPACKSHOT_CHROMIUM, the Playwright browsers, or one on PATH. */
export function findChromium() {
  if (process.env.REPACKSHOT_CHROMIUM) return process.env.REPACKSHOT_CHROMIUM;
  for (const base of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean)) {
    if (isFile(join(base, 'chromium'))) return join(base, 'chromium');
    let dirs = [];
    try {
      dirs = readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    } catch {
      // not there
    }
    for (const d of dirs) if (isFile(join(base, d, 'chrome-linux', 'chrome'))) return join(base, d, 'chrome-linux', 'chrome');
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      const p = join(dir, name);
      try {
        if (existsSync(p)) {
          accessSync(p, constants.X_OK);
          return p;
        }
      } catch {
        // not executable
      }
    }
  }
  return null;
}

/** Renders `svg` at each size: `{ size, png: Buffer, rgba: Uint8Array }`. */
export async function renderIcon(svg, sizes = ICON_SIZES) {
  const executablePath = findChromium();
  if (!executablePath) throw new Error('no Chromium for the icon (set REPACKSHOT_CHROMIUM)');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    const images = await page.evaluate(
      async ({ svg, sizes }) => {
        const img = new Image();
        img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
        await img.decode();
        return sizes.map((size) => {
          const c = document.createElement('canvas');
          c.width = c.height = size;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0, size, size);
          return { size, png: c.toDataURL('image/png').split(',')[1], rgba: Array.from(g.getImageData(0, 0, size, size).data) };
        });
      },
      { svg, sizes },
    );
    return images.map((i) => ({ size: i.size, png: Buffer.from(i.png, 'base64'), rgba: Uint8Array.from(i.rgba) }));
  } finally {
    await browser.close();
  }
}

/** True when every pixel is grey (the chrome of the interface, and its icon, is achromatic). */
export function isAchromatic(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    if (Math.abs(rgba[i] - rgba[i + 1]) > 1 || Math.abs(rgba[i + 1] - rgba[i + 2]) > 1) return false;
  }
  return true;
}

/** A 32-bit BMP image for an .ico entry: header, bottom-up BGRA rows, then the AND mask. */
function dib(size, rgba) {
  const maskRow = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = (row * size + x) * 4;
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
      if (rgba[s + 3] === 0) mask[row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

/** A multi-size .ico. */
export function ico(images) {
  const sorted = [...images].sort((a, b) => a.size - b.size);
  const bodies = sorted.map((i) => (i.size > 48 ? i.png : dib(i.size, i.rgba)));
  const dir = Buffer.alloc(6 + 16 * sorted.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(sorted.length, 4);
  let offset = dir.length;
  sorted.forEach((img, k) => {
    const e = 6 + k * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1);
    dir.writeUInt8(0, e + 2);
    dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(bodies[k].length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += bodies[k].length;
  });
  return Buffer.concat([dir, ...bodies]);
}

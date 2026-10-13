#!/usr/bin/env node
// The page's icons (phase P3b), from docs/media/logo.svg (black and white):
// public/favicon.ico (16, 24, 32, 48 and 64 px), public/icon-<n>.png for
// the favicon links, Apple's touch icon and the web app manifest, and
// public/icon.svg (the logo itself). Rendered by the local Chromium
// (packaging/lib/icon.mjs, the same as the desktop icon); every pixel is checked
// to be grey. The outputs are committed: the build needs no browser.
//
//   node tools/icons.mjs

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ico, isAchromatic, renderIcon } from '../packaging/lib/icon.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOGO = join(ROOT, 'docs', 'media', 'logo.svg');
const OUT = join(ROOT, 'public');
export const PNG_SIZES = [16, 32, 48, 180, 192, 512];
export const ICO_SIZES = [16, 24, 32, 48, 64];

const images = await renderIcon(readFileSync(LOGO, 'utf8'), [...new Set([...PNG_SIZES, ...ICO_SIZES])].sort((a, b) => a - b));
for (const img of images) if (!isAchromatic(img.rgba)) throw new Error(`the ${img.size} px icon is not black and white`);
for (const img of images.filter((i) => PNG_SIZES.includes(i.size))) writeFileSync(join(OUT, `icon-${img.size}.png`), img.png);
writeFileSync(join(ROOT, 'public', 'favicon.ico'), ico(images.filter((i) => ICO_SIZES.includes(i.size))));
copyFileSync(LOGO, join(OUT, 'icon.svg'));
console.log(`icons: public/favicon.ico (${ICO_SIZES.join(', ')} px), public/icon-{${PNG_SIZES.join(',')}}.png, public/icon.svg`);

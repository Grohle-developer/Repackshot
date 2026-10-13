// UI.md §1: the chrome is achromatic. Every colour written in the interface
// stylesheets (and in index.html) must have zero saturation. Thumbnails and
// the viewport are content and live outside these files.

import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';

// Every stylesheet of the interface, read as text through Vite.
const CSS = import.meta.glob('../src/ui/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// Named colours with hue. Achromatic names (black, white, gray, silver...) are allowed.
const CHROMATIC_NAMES = [
  'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'brown', 'cyan', 'magenta', 'lime', 'navy', 'teal',
  'olive', 'maroon', 'aqua', 'fuchsia', 'gold', 'indigo', 'violet', 'coral', 'salmon', 'tomato', 'crimson', 'khaki',
  'beige', 'tan', 'turquoise', 'orchid', 'plum', 'lavender', 'ivory', 'azure', 'chartreuse', 'firebrick',
  'skyblue', 'steelblue', 'royalblue', 'dodgerblue', 'seagreen', 'forestgreen', 'darkred', 'darkblue', 'darkgreen',
  'lightblue', 'lightgreen', 'hotpink', 'deeppink', 'goldenrod', 'sienna', 'peru', 'wheat', 'linen', 'honeydew',
  'mintcream', 'aliceblue', 'ghostwhite', 'seashell', 'snow', 'oldlace', 'cornsilk', 'bisque', 'moccasin',
];

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function chromaticColours(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad: string[] = [];
  for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    if (![4, 5, 7, 9].includes(m[0].length)) continue;
    const [r, g, b] = hexToRgb(m[0]);
    if (r !== g || g !== b) bad.push(m[0]);
  }
  for (const m of text.matchAll(/rgba?\(([^)]*)\)/gi)) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    const nums = parts.map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)));
    if (nums.some((n) => Number.isNaN(n))) {
      bad.push(m[0]);
      continue;
    }
    if (Math.abs(nums[0] - nums[1]) > 1e-9 || Math.abs(nums[1] - nums[2]) > 1e-9) bad.push(m[0]);
  }
  for (const m of text.matchAll(/hsla?\(([^)]*)\)/gi)) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parseFloat(parts[1] ?? '1') !== 0) bad.push(m[0]);
  }
  for (const m of text.matchAll(/(?:oklch|oklab|lch|lab|hwb|color)\(([^)]*)\)/gi)) bad.push(m[0]);
  for (const name of CHROMATIC_NAMES) {
    const re = new RegExp(`:[^;{}]*\\b${name}\\b`, 'i');
    const hit = text.match(re);
    if (hit) bad.push(name);
  }
  return bad;
}

describe('achromatic chrome', () => {
  const files: Record<string, string> = { ...CSS, '../index.html': indexHtml };

  it('there are stylesheets to check', () => {
    expect(Object.keys(CSS).length).toBeGreaterThanOrEqual(3);
  });

  for (const [file, text] of Object.entries(files)) {
    it(`${file.replace('../', '')} has no saturated colour`, () => {
      expect(chromaticColours(text)).toEqual([]);
    });
  }

  it('the checker catches saturated colours', () => {
    expect(chromaticColours('a { color: #f00; background: rgb(10, 20, 30); fill: hsl(200 50% 50%); }')).toHaveLength(3);
    expect(chromaticColours('a { color: #ffffff; background: rgba(0, 0, 0, 0.4); border-color: hsl(0 0% 40%); }')).toEqual([]);
    expect(chromaticColours('a { color: tomato }')).toEqual(['tomato']);
  });
});

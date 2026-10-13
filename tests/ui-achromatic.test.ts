// UI.md §1: the chrome is achromatic. Every colour written in the interface
// stylesheets (and in index.html) must have zero saturation. Thumbnails and
// the viewport are content and live outside these files.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';

// Every stylesheet of the interface, read from disk. (Through Vite, `import.meta.glob('…/*.css', { query: '?raw' })`
// gives empty strings under vitest, which does not process CSS: this test checked nothing until phase U6.)
const CSS_DIRS = ['src/ui', 'src/ui/components', 'src/ui/panels'];
const CSS: Record<string, string> = {};
for (const dir of CSS_DIRS) for (const f of readdirSync(dir)) if (f.endsWith('.css')) CSS[`../${dir}/${f}`] = readFileSync(`${dir}/${f}`, 'utf8');

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

  it('there are stylesheets to check, with their text', () => {
    expect(Object.keys(CSS).length).toBeGreaterThanOrEqual(3);
    for (const [file, text] of Object.entries(CSS)) expect(text.length, file).toBeGreaterThan(200);
    expect(indexHtml.length).toBeGreaterThan(100);
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

// Settings ▸ Accessibility (phase U6): the high-contrast tokens are achromatic too (the checker above reads
// theme.css whole), and each of them is further from the background than the normal one, in both themes.
describe('high contrast tokens', () => {
  const theme = CSS['../src/ui/theme.css'];
  const block = (selector: string): Record<string, string> => {
    const i = theme.indexOf(selector);
    if (i < 0) return {};
    const body = theme.slice(theme.indexOf('{', i) + 1, theme.indexOf('}', i));
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
    return out;
  };
  const luminance = (hex: string) => {
    const [r, g, b] = hexToRgb(hex).map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const light = block(':root {');
  const dark = block(":root[data-theme='dark'] {");
  const cases: [string, Record<string, string>, Record<string, string>][] = [
    ['light', light, block(":root[data-theme='light'][data-contrast='high']")],
    ['dark', dark, block(":root[data-theme='dark'][data-contrast='high']")],
  ];

  for (const [name, normal, high] of cases) {
    it(`${name}: the high-contrast greys exist, are greys, and stand further from the background`, () => {
      for (const token of ['--ink-1', '--ink-2', '--ink-3', '--line']) {
        expect(high[token], `${name} ${token}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(chromaticColours(`a { color: ${high[token]} }`), `${name} ${token}`).toEqual([]);
        expect(contrast(high[token], normal['--bg-0']), `${name} ${token}`).toBeGreaterThan(contrast(normal[token], normal['--bg-0']));
      }
      // Auxiliary text reaches 7:1 on the panels in high contrast (WCAG AAA for normal text).
      expect(contrast(high['--ink-2'], normal['--bg-1'])).toBeGreaterThanOrEqual(7);
    });
  }

  it('the interface size and the text size are tokens the stylesheets use', () => {
    expect(theme).toMatch(/--ui-zoom:\s*1;/);
    expect(theme).toMatch(/--fs-body:\s*calc\(13px \* var\(--text-scale\)\)/);
    expect(theme).toMatch(/zoom:\s*var\(--ui-zoom\)/);
    const all = Object.values(CSS).join('\n');
    // No font size escapes the text size.
    expect(all.match(/font-size:\s*\d+(\.\d+)?px/g) ?? []).toEqual([]);
  });
});

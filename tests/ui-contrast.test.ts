// H1, contrast of the text tokens (UI.md §1, theme.css). Every text token is measured against every surface the
// chrome paints text on, in both themes and in their high-contrast variants, with the WCAG 2.x ratio computed from the
// token values. Two tiers, decided in docs/ROADMAP.md (Decisiones de criterio, H1; applied in C1): the primary text
// (`ink-0`, `ink-1` and the inverted pair) reaches 7:1 (WCAG AAA) on every surface, and the secondary text (`ink-2`, the
// auxiliary grey) 4.5:1 (WCAG AA). The hierarchy of the greys is not flattened: on every surface each ink stands out
// less than the one above it.
//
// `ink-3` is the grey of what is off: disabled controls, hidden rows, separators, grips, the empty picture of a
// thumbnail. WCAG 1.4.3 does not ask a contrast of inactive controls or of decoration, and raising it to 4.5:1 would put
// it on top of `ink-2` (both #5f5f5f in the light theme): it is measured and kept under `ink-2`, with no floor of its
// own in the plain themes; in high contrast it reaches 4.5:1 too.
//
// Surfaces: the solid greys (bg-0…bg-3 and the hover grey), the translucent `soft` composited over bg-0 (what it sits
// on), and the translucent `overlay` composited over the viewport grey (the chrome over the viewport: the render behind
// it is content, so the viewport grey is the backdrop the design assumes). The inverted pair is inv-ink on inv-bg.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composite, contrast, parseColour, ruleTokens, type Rgb } from './ui-tokens';

const css = readFileSync('src/ui/theme.css', 'utf8');
/** The primary text (AAA) and the secondary text (AA). */
const PRIMARY_RATIO = 7;
const SECONDARY_RATIO = 4.5;
const PRIMARY = ['ink-0', 'ink-1'];
const SECONDARY = ['ink-2'];
const INKS = ['ink-0', 'ink-1', 'ink-2', 'ink-3'];

type Tokens = Record<string, string>;

/** A theme as the browser resolves it: the base rule with the variant's overrides on top. */
function theme(base: string, variant?: string): Tokens {
  return { ...ruleTokens(css, base), ...(variant ? ruleTokens(css, variant) : {}) };
}

/** The solid colour of every surface a text token can sit on, for one theme. */
function surfaces(t: Tokens): Record<string, Rgb> {
  const solid = (name: string) => parseColour(t[`--${name}`]).rgb;
  const bg0 = solid('bg-0');
  const soft = parseColour(t['--soft']);
  const overlay = parseColour(t['--overlay']);
  return {
    'bg-0': bg0,
    'bg-1': solid('bg-1'),
    'bg-2': solid('bg-2'),
    'bg-3': solid('bg-3'),
    hover: solid('hover'),
    soft: composite(soft.rgb, soft.alpha, bg0),
    overlay: composite(overlay.rgb, overlay.alpha, solid('viewport-bg')),
  };
}

const THEMES: Record<string, Tokens> = {
  light: theme(':root {'),
  dark: theme(":root[data-theme='dark'] {"),
  'light-high': theme(':root {', ":root[data-theme='light'][data-contrast='high'] {"),
  'dark-high': theme(":root[data-theme='dark'] {", ":root[data-theme='dark'][data-contrast='high'] {"),
};

/** The pairs the test measures: (text token, surface) per theme. Inverted surfaces take only the inverted text. */
function pairsOf(t: Tokens): { text: string; surface: string; ratio: number }[] {
  const s = surfaces(t);
  const out: { text: string; surface: string; ratio: number }[] = [];
  for (const text of INKS) {
    const ink = parseColour(t[`--${text}`]).rgb;
    for (const [surface, rgb] of Object.entries(s)) out.push({ text, surface, ratio: contrast(ink, rgb) });
  }
  out.push({ text: 'inv-ink', surface: 'inv-bg', ratio: contrast(parseColour(t['--inv-ink']).rgb, parseColour(t['--inv-bg']).rgb) });
  return out;
}

const minimum = (text: string): number => (PRIMARY.includes(text) || text === 'inv-ink' ? PRIMARY_RATIO : SECONDARY.includes(text) ? SECONDARY_RATIO : 0);

describe('text tokens reach their tier on the surfaces they sit on (7:1 primary, 4.5:1 secondary)', () => {
  it('the themes are read: every token of the matrix exists', () => {
    for (const [name, t] of Object.entries(THEMES)) {
      for (const token of ['--ink-0', '--ink-1', '--ink-2', '--ink-3', '--inv-ink', '--inv-bg', '--soft', '--overlay', '--viewport-bg', '--hover']) {
        expect(t[token], `${name} ${token}`).toBeTruthy();
      }
    }
  });

  for (const [name, t] of Object.entries(THEMES)) {
    it(`${name}: the primary text is at least 7:1 and the secondary at least 4.5:1 on every surface`, () => {
      const below = pairsOf(t).filter((p) => p.ratio < minimum(p.text));
      expect(below.map((p) => `${p.text} on ${p.surface} ${p.ratio.toFixed(2)}:1 (needs ${minimum(p.text)}:1)`)).toEqual([]);
    });

    it(`${name}: the hierarchy of the greys is kept: each ink stands out less than the one above it, on every surface`, () => {
      const ratio = new Map(pairsOf(t).map((p) => [`${p.text} on ${p.surface}`, p.ratio]));
      const flat: string[] = [];
      for (const surface of Object.keys(surfaces(t))) {
        for (let i = 1; i < INKS.length; i++) {
          const up = ratio.get(`${INKS[i - 1]} on ${surface}`)!;
          const down = ratio.get(`${INKS[i]} on ${surface}`)!;
          // A step of at least a tenth of the one above: two inks that read the same are one.
          if (!(down < up * 0.9)) flat.push(`${INKS[i]} ${down.toFixed(2)} vs ${INKS[i - 1]} ${up.toFixed(2)} on ${surface}`);
        }
      }
      expect(flat).toEqual([]);
    });
  }

  it('in high contrast, the grey of what is off reaches 4.5:1 too', () => {
    for (const name of ['light-high', 'dark-high']) {
      const low = pairsOf(THEMES[name]).filter((p) => p.text === 'ink-3' && p.ratio < SECONDARY_RATIO);
      expect(low.map((p) => `${name} ${p.surface} ${p.ratio.toFixed(2)}`)).toEqual([]);
    }
  });

  it('pins the secondary greys C1 left: the light theme’s raised from #6b6b6b (3.78:1 on bg-3) to #5f5f5f', () => {
    expect(THEMES.light['--ink-2']).toBe('#5f5f5f');
    expect(THEMES.dark['--ink-2']).toBe('#9a9a9a');
    const light = pairsOf(THEMES.light).filter((p) => p.text === 'ink-2');
    expect(Math.min(...light.map((p) => p.ratio))).toBeGreaterThanOrEqual(SECONDARY_RATIO);
    // The grey before C1 does not reach 4.5:1 on the darkest panel: the checker is measuring, not assuming.
    expect(contrast(parseColour('#6b6b6b').rgb, parseColour(THEMES.light['--bg-3']).rgb)).toBeLessThan(SECONDARY_RATIO);
  });

  it('the checker catches a pair below its tier (ink-3 of the light theme is measured, not assumed)', () => {
    const light = pairsOf(THEMES.light);
    const ink3 = light.filter((p) => p.text === 'ink-3').map((p) => p.ratio);
    expect(Math.min(...ink3)).toBeLessThan(SECONDARY_RATIO);
    expect(Math.max(...light.filter((p) => p.text === 'ink-0').map((p) => p.ratio))).toBeGreaterThan(20);
  });
});

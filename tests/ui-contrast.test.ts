// H1, contrast of the text tokens (UI.md §1, theme.css). Every text token is measured against every surface the
// chrome paints text on, in both themes and in their high-contrast variants, with the WCAG 2.x ratio computed from the
// token values. UI.md has one table of greys and does not separate large text from body text, so every pair must
// reach 7:1 (WCAG AAA for normal text).
//
// Surfaces: the solid greys (bg-0…bg-3 and the hover grey), the translucent `soft` composited over bg-0 (what it sits
// on), and the translucent `overlay` composited over the viewport grey (the chrome over the viewport: the render behind
// it is content, so the viewport grey is the backdrop the design assumes). The inverted pair is inv-ink on inv-bg.
//
// PENDING lists the pairs that do not reach 7:1 today. Changing a visible token is a visual decision (UI.md §1), so it is
// proposed in docs/ROADMAP.md (H1, «Qué no encajó») and not changed here. The test fails when a pair falls below 7:1 and
// is not listed, and when a listed pair reaches 7:1 (then it is removed from the list).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composite, contrast, parseColour, ruleTokens, type Rgb } from './ui-tokens';

const css = readFileSync('src/ui/theme.css', 'utf8');
const MIN_RATIO = 7;

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
  for (const text of ['ink-0', 'ink-1', 'ink-2', 'ink-3']) {
    const ink = parseColour(t[`--${text}`]).rgb;
    for (const [surface, rgb] of Object.entries(s)) out.push({ text, surface, ratio: contrast(ink, rgb) });
  }
  out.push({ text: 'inv-ink', surface: 'inv-bg', ratio: contrast(parseColour(t['--inv-ink']).rgb, parseColour(t['--inv-bg']).rgb) });
  return out;
}

/**
 * The pairs under 7:1 today, per theme, as the surfaces each text token fails on. Every entry is a visual decision
 * pending in docs/ROADMAP.md (H1, «Qué no encajó»). Remove an entry when its token changes and the pair reaches 7:1.
 */
const AUX_ALL = ['bg-0', 'bg-1', 'bg-2', 'bg-3', 'hover', 'soft', 'overlay'];
const PENDING: Record<string, Record<string, string[]>> = {
  // ink-2 (5.3 to 4.4 on the panels) and ink-3 (2.8 to 2.0) are the auxiliary greys; ink-0 and ink-1 and the inverted
  // pair reach 7:1 everywhere.
  light: { 'ink-2': AUX_ALL, 'ink-3': AUX_ALL },
  // ink-2 is 6.9 on bg-0 and 5.1 on bg-3; ink-3 is 3.6 to 2.7.
  dark: { 'ink-2': AUX_ALL, 'ink-3': AUX_ALL },
  // The high-contrast auxiliary grey: ink-3 (#575757 light, #ababab dark) on the panels and the hover grey.
  'light-high': { 'ink-3': ['bg-1', 'bg-2', 'bg-3', 'hover', 'soft', 'overlay'] },
  'dark-high': { 'ink-3': ['bg-3', 'hover'] },
};

describe('text tokens reach 7:1 on the surfaces they sit on', () => {
  it('the themes are read: every token of the matrix exists', () => {
    for (const [name, t] of Object.entries(THEMES)) {
      for (const token of ['--ink-0', '--ink-1', '--ink-2', '--ink-3', '--inv-ink', '--inv-bg', '--soft', '--overlay', '--viewport-bg', '--hover']) {
        expect(t[token], `${name} ${token}`).toBeTruthy();
      }
    }
  });

  for (const [name, t] of Object.entries(THEMES)) {
    it(`${name}: each pair is at least 7:1, or is listed as pending`, () => {
      const failing = pairsOf(t).filter((p) => p.ratio < MIN_RATIO);
      const listed = PENDING[name] ?? {};
      const unlisted = failing.filter((p) => !(listed[p.text] ?? []).includes(p.surface));
      expect(
        unlisted.map((p) => `${p.text} on ${p.surface} ${p.ratio.toFixed(2)}:1`),
        `${name}: a text pair below 7:1 that is not pending (propose the token in ROADMAP H1 first)`,
      ).toEqual([]);
    });

    it(`${name}: the pending pairs are still below 7:1 (a fixed one leaves the list)`, () => {
      const ratios = new Map(pairsOf(t).map((p) => [`${p.text} on ${p.surface}`, p.ratio]));
      const stale: string[] = [];
      for (const [text, surfaces] of Object.entries(PENDING[name] ?? {})) {
        for (const surface of surfaces) {
          const r = ratios.get(`${text} on ${surface}`);
          if (r === undefined || r >= MIN_RATIO) stale.push(`${text} on ${surface}${r === undefined ? ' (no such pair)' : ` ${r.toFixed(2)}:1`}`);
        }
      }
      expect(stale).toEqual([]);
    });
  }

  it('the checker catches a pair below 7:1 (ink-3 of the light theme is measured, not assumed)', () => {
    const light = pairsOf(THEMES.light);
    const ink3 = light.filter((p) => p.text === 'ink-3').map((p) => p.ratio);
    expect(Math.min(...ink3)).toBeLessThan(MIN_RATIO);
    expect(Math.max(...light.filter((p) => p.text === 'ink-0').map((p) => p.ratio))).toBeGreaterThan(20);
  });
});

// H1, the accessibility rules of the interface that can be read from its sources (the browser checks are in
// tests/a11y-browser.test.ts): the reduced-motion rule resets every motion property for every element, and no element
// of the interface has a positive tabindex (the Tab order is then the order of the page, which the layout follows).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const theme = readFileSync('src/ui/theme.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector text starts with `selector`. */
function bodyOf(selector: string): string {
  const i = theme.indexOf(selector);
  if (i < 0) return '';
  return theme.slice(theme.indexOf('{', i) + 1, theme.indexOf('}', i));
}

function filesUnder(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(path);
  }
  return out;
}

const POSITIVE_TABINDEX = /tabindex\s*[:=]\s*['"]?\s*[1-9]\d*\b|tabIndex\s*=\s*[1-9]\d*\b|tabindex="[1-9]\d*"/gi;

describe('reduced motion resets the motion of every element', () => {
  // The rule for the system preference, and the forced setting (Settings ▸ Accessibility ▸ Reduce motion: On).
  const system = bodyOf(":root:not([data-motion='full']) *,");
  const forced = bodyOf(":root[data-motion='reduce'] *,");

  for (const [name, body] of [
    ['the system preference', system],
    ['the forced setting', forced],
  ] as const) {
    it(`${name}: transitions, animations and smooth scrolling are off, with !important`, () => {
      expect(body, name).toMatch(/transition:\s*none !important;/);
      expect(body, name).toMatch(/animation:\s*none !important;/);
      expect(body, name).toMatch(/scroll-behavior:\s*auto !important;/);
    });
  }

  it('the rule reaches every element and its pseudo-elements', () => {
    expect(theme).toMatch(/:root:not\(\[data-motion='full'\]\) \*::before,\s*:root:not\(\[data-motion='full'\]\) \*::after/);
    expect(theme).toMatch(/:root\[data-motion='reduce'\] \*::before,\s*:root\[data-motion='reduce'\] \*::after/);
  });

  it('the duration of the chrome’s own transitions is zero under both rules', () => {
    expect(theme).toMatch(/:root:not\(\[data-motion='full'\]\) \{\s*--ease: 0ms linear;/);
    expect(theme).toMatch(/:root\[data-motion='reduce'\] \{\s*--ease: 0ms linear;/);
  });
});

describe('the Tab order is the order of the page', () => {
  it('no element of the interface has a positive tabindex', () => {
    const found: string[] = [];
    for (const file of filesUnder('src/ui', ['.ts', '.html'])) {
      for (const m of readFileSync(file, 'utf8').matchAll(POSITIVE_TABINDEX)) found.push(`${file}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });

  it('the checker catches a positive tabindex and lets 0 and -1 through', () => {
    expect('h("div", { tabindex: 1 })'.match(POSITIVE_TABINDEX)).not.toBeNull();
    expect('el.tabIndex = 2;'.match(POSITIVE_TABINDEX)).not.toBeNull();
    expect('<div tabindex="3">'.match(POSITIVE_TABINDEX)).not.toBeNull();
    expect("h('div', { tabindex: '0' }) h('div', { tabindex: -1 }) el.tabIndex = i === 0 ? 0 : -1;".match(POSITIVE_TABINDEX)).toBeNull();
  });
});

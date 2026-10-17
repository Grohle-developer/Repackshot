// Helpers for the colour tokens of the interface (src/ui/theme.css): read the declarations of a rule, merge the
// overrides of a variant, composite a translucent token over the colour it sits on, and compute the WCAG ratio.
// Shared by tests/ui-achromatic.test.ts and tests/ui-contrast.test.ts.

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG 2.x relative luminance of an sRGB colour. */
export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, from 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** A translucent colour over an opaque one, the way the browser paints it (sRGB, straight alpha). */
export function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round(fg[i] * alpha + bg[i] * (1 - alpha))) as Rgb;
}

/** The declarations of the first flat rule whose selector text is `selector` (e.g. `:root {`). */
export function ruleTokens(css: string, selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  if (i < 0) return {};
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** A colour value of a token: `#rrggbb` or `rgba(r, g, b, a)` (alpha 1 when there is none). */
export function parseColour(value: string): { rgb: Rgb; alpha: number } {
  if (value.startsWith('#')) return { rgb: hexToRgb(value), alpha: 1 };
  const m = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) throw new Error(`not a colour the test reads: ${value}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] === undefined ? 1 : Number(m[4]) };
}

// X6: the styles' grades of the interface and the synthetic service are the guard's (engine/crates/rt-post/src/style.rs),
// number for number, with the same band gain and the same split of shadows and highlights.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_STYLES } from '../src/core/ai';
import { BAND_GAIN_AT_100, HIGHLIGHT_START, SHADOW_END, STYLE_GRADES, highlightShare, styleAmount, styleGainAt } from '../src/core/ai-style';

const ROOT = '.';
const rust = readFileSync(join(ROOT, 'engine/crates/rt-post/src/style.rs'), 'utf8');
const job = readFileSync(join(ROOT, 'engine/crates/rt-post/src/job.rs'), 'utf8');

const num = (s: string) => Number(s.trim());

describe('the styles’ grades (X6)', () => {
  it('are the guard’s table, style by style', () => {
    const rows = [...rust.matchAll(/Grade \{\s*shadow: \[([^\]]+)\],\s*highlight: \[([^\]]+)\],\s*contrast: ([-\d.]+),?\s*\}/g)];
    expect(rows.length).toBe(AI_STYLES.length);
    AI_STYLES.forEach((key, i) => {
      const [, shadow, highlight, contrast] = rows[i];
      expect(STYLE_GRADES[key].shadow).toEqual(shadow.split(',').map(num));
      expect(STYLE_GRADES[key].highlight).toEqual(highlight.split(',').map(num));
      expect(STYLE_GRADES[key].contrast).toBe(num(contrast));
    });
    expect(Number(/pub const BAND_GAIN_AT_100: f32 = ([\d.]+);/.exec(job)![1])).toBe(BAND_GAIN_AT_100);
    expect(Number(/pub const SHADOW_END: f32 = ([\d.]+);/.exec(rust)![1])).toBe(SHADOW_END);
    expect(Number(/pub const HIGHLIGHT_START: f32 = ([\d.]+);/.exec(rust)![1])).toBe(HIGHLIGHT_START);
  });

  it('give nothing at 0 and more with more, warm warmer and cool cooler', () => {
    expect(styleAmount(0, 1)).toBe(0);
    expect(styleAmount(50, 1)).toBe(1);
    expect(styleAmount(100, 0.5)).toBe(1);
    expect(highlightShare(0)).toBe(0);
    expect(highlightShare(1)).toBe(1);
    for (const key of AI_STYLES) expect(styleGainAt(STYLE_GRADES[key], 0.3, 0)).toEqual([0, 0, 0]);
    const w = styleGainAt(STYLE_GRADES.WARM, 0.5, 1);
    const c = styleGainAt(STYLE_GRADES.COOL, 0.5, 1);
    expect(w[0]).toBeGreaterThan(w[2]);
    expect(c[2]).toBeGreaterThan(c[0]);
  });
});

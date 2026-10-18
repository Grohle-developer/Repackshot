// X6: the stored example of the AI section's preview. The grid holds every step of every control; the lookup follows
// each control the moment it moves (a different example for every step of every control and every style), says where
// the example's values are not the person's, and the store in public/ai-preview/ is the grid, complete and small. Plus
// the guard's report in plain words.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_STYLES, DEFAULT_AI_PIPELINE } from '../src/core/ai';
import { parseSheet, pickExample, SHEET_BASE, SHEET_CONTROLS, SHEET_SEEDS, SHEET_STEPS, sheetGrid, sheetKey, snap, type PreviewSheet, type SheetSettings } from '../src/core/ai-preview-sheet';
import { guardWords, sentBackGroups } from '../src/ui/ai-report';
import { setLang } from '../src/ui/strings';

const grid = sheetGrid(SHEET_BASE);
const sheet: Pick<PreviewSheet, 'entries'> = {
  entries: grid.map((settings) => ({ key: sheetKey(settings), settings, file: `${sheetKey(settings)}.webp`, report: { verdict: 'ACCEPTED', usedFraction: 1 } })),
};
const defaults: SheetSettings = { intervention: 50, light: 50, bounce: 40, wear: 20, style: 'NATURAL', styleStrength: 30, seed: 0 };

describe('the stored example (X6)', () => {
  it('snaps to the steps and stores the defaults snapped', () => {
    expect(SHEET_STEPS).toEqual([0, 25, 50, 75, 100]);
    expect([snap(0), snap(12), snap(13), snap(40), snap(20), snap(30), snap(100)]).toEqual([0, 0, 25, 50, 25, 25, 100]);
    expect(SHEET_BASE).toEqual({ light: snap(DEFAULT_AI_PIPELINE.light), bounce: 50, wear: 25, style: 'NATURAL', styleStrength: 25 });
    // One engine image at Intervention 0, then 40 a step: the seeds, the band controls, every style, no style.
    expect(grid.length).toBe(1 + 4 * (SHEET_SEEDS + 3 * 4 + AI_STYLES.length * 4 - 1 + 1));
    expect(new Set(grid.map(sheetKey)).size).toBe(grid.length);
  });

  it('follows every control step by step, each step its own example', () => {
    for (const control of ['intervention', 'light', 'bounce', 'wear', 'styleStrength'] as const) {
      const keys = SHEET_STEPS.map((v) => pickExample(sheet, { ...defaults, [control]: v }, control)!.entry.key);
      // Intervention 0 is the engine's image; every other step shows a different example.
      expect(new Set(keys).size, `${control}: ${keys}`).toBe(control === 'styleStrength' || control === 'intervention' ? 5 : 5);
      for (const v of SHEET_STEPS) {
        const pick = pickExample(sheet, { ...defaults, [control]: v }, control)!;
        if (control !== 'intervention' || v > 0) expect(pick.entry.settings[control], `${control} ${v}`).toBe(v);
      }
    }
    const styles = AI_STYLES.map((style) => pickExample(sheet, { ...defaults, style, styleStrength: 100 }, 'style')!.entry);
    expect(new Set(styles.map((e) => e.key)).size).toBe(AI_STYLES.length);
    styles.forEach((e, i) => expect(e.settings.style).toBe(AI_STYLES[i]));
    // Another variation: the defaults have SHEET_SEEDS examples.
    const seeds = [0, 1, 2, 3].map((seed) => pickExample(sheet, { ...defaults, seed }, null)!.entry.settings.seed);
    expect(seeds).toEqual([0, 1, 2, 3]);
  });

  it('says where the example is not the person’s, and prefers the control moved last', () => {
    // The defaults themselves: Bounces 40, Wear 20 and Style strength 30 are shown at 50, 25 and 25.
    const at = pickExample(sheet, defaults, null)!;
    expect(at.differs.map((d) => [d.control, d.shown, d.yours])).toEqual([
      ['bounce', 50, 40],
      ['wear', 25, 20],
      ['styleStrength', 25, 30],
    ]);
    // Two controls off their stored defaults: the one moved last is the one shown at its value.
    const both = { ...defaults, light: 100, bounce: 0 };
    expect(pickExample(sheet, both, 'light')!.entry.settings.light).toBe(100);
    expect(pickExample(sheet, both, 'bounce')!.entry.settings.bounce).toBe(0);
    const lit = pickExample(sheet, both, 'light')!;
    expect(lit.differs.some((d) => d.control === 'bounce' && d.shown === 50 && d.yours === 0)).toBe(true);
    // Intervention 0: the engine's image, nothing else said.
    const off = pickExample(sheet, { ...defaults, intervention: 0, light: 100 }, 'light')!;
    expect(off.entry.settings.intervention).toBe(0);
    expect(off.differs).toEqual([]);
    expect(SHEET_CONTROLS).toContain('style');
    expect(pickExample({ entries: [] }, defaults)).toBeNull();
  });

  it('is in public/ai-preview/: the whole grid, every file there, under 4 MB, made by the Full engine and the test model', () => {
    const dir = 'public/ai-preview';
    const index = parseSheet(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')));
    expect(index).not.toBeNull();
    expect(index!.model).toBe('TEST_MODEL');
    expect(index!.scene.engine).toBe('FULL');
    expect(index!.entries.map((e) => e.key).sort()).toEqual(grid.map(sheetKey).sort());
    let bytes = statSync(join(dir, index!.before)).size;
    for (const e of index!.entries) {
      expect(existsSync(join(dir, e.file)), e.file).toBe(true);
      bytes += statSync(join(dir, e.file)).size;
      expect(['ACCEPTED', 'LIMITED', 'REJECTED']).toContain(e.report.verdict);
    }
    expect(bytes).toBe(index!.bytes);
    expect(bytes).toBeLessThan(4 * 1024 * 1024);
    // The engine's image is the example at Intervention 0.
    expect(readFileSync(join(dir, index!.before))).toEqual(readFileSync(join(dir, index!.entries.find((e) => e.settings.intervention === 0)!.file)));
  });
});

describe('the guard in plain words (X6)', () => {
  it('says it let everything through, where a cap held a band back, what colour it kept and why it lowered the strength', () => {
    setLang('en');
    expect(guardWords({ verdict: 'ACCEPTED', usedFraction: 1 })).toEqual(['The guard let all of the AI’s change through']);
    const words = guardWords({ verdict: 'LIMITED', usedFraction: 0.6, capped: { light: 0.34, bounce: 0.01, wear: 0, style: 1 }, materials: [{ name: 'Paper', kept: 0.71 }, { name: 'Gold', kept: 1 }], sentBack: ['focus changed 0.17 (limit 0.15)'] });
    expect(words).toEqual([
      'The AI was limited to 60 % to respect the protections: the stronger attempts changed the focus',
      'Light: the guard held the change of light at its limit over 34 % of the picture',
      'Style: the AI’s overall change of colour was held at the guard’s limit (the style’s own grade is not)',
      'To keep the colour of “Paper”, the guard let 71 % of its colour change through',
    ]);
    expect(guardWords({ verdict: 'REJECTED', usedFraction: 0 })).toEqual([]);
    expect(sentBackGroups(['edges moved 5.00 px (limit 4)', 'colour of Cap changed ΔE mean 5', 'detail SSIM 0.9 below 0.98'])).toEqual(['geometry', 'materials']);
    setLang('es');
    expect(guardWords({ verdict: 'ACCEPTED', usedFraction: 1, capped: { light: 0, bounce: 0.5, wear: 0, style: 0 } })).toEqual(['Rebotes: la guarda dejó el color rebotado en su tope en el 50 % de la imagen']);
    setLang('en');
  });
});

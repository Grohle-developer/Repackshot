import { describe, expect, it } from 'vitest';
import { recommend, type RecommendInput } from '../src/core/ai-recommend';
import { AI_MODELS, aiModel } from '../src/data/ai-models';
import CASES_JSON from './fixtures/ai-recommend-cases.json';

interface Case {
  note?: string;
  input: RecommendInput;
  unavailable?: string[];
  expect: { rowId: string | null; recommended: string | null; offered: string[]; skipped?: string[] } | null;
}

// The same file is read by the Rust test of the desktop launcher (rt-app, recommend.rs).
const CASES = CASES_JSON as unknown as Case[];

describe('AI model recommendation (AI-POST §2.4)', () => {
  it('has cases on both sides of every boundary of the table', () => {
    const values = new Set(CASES.map((c) => (c.input && 'vramGiB' in c.input ? `gpu:${c.input.vramGiB}` : c.input && 'ramGiB' in c.input ? `cpu:${c.input.ramGiB}` : '')));
    for (const b of [24, 12, 6, 4]) expect(values.has(`gpu:${b}`) && values.has(`gpu:${b - 0.01}`)).toBe(true);
    for (const b of [32, 16, 8]) expect(values.has(`cpu:${b}`) && values.has(`cpu:${b - 0.01}`)).toBe(true);
    expect(CASES.some((c) => c.input === null && c.expect === null)).toBe(true);
  });

  for (const c of CASES) {
    it(`${JSON.stringify(c.input)}${c.unavailable ? ` without ${c.unavailable.join(', ')}` : ''}`, () => {
      const got = recommend(c.input, AI_MODELS, c.unavailable ?? []);
      if (c.expect === null) expect(got).toBeNull();
      else expect(got).toEqual({ skipped: [], ...c.expect });
    });
  }

  it('evaluates the rows in order: the first match wins', () => {
    const catalogue = { ...AI_MODELS, recommendation: [{ id: 'all', device: 'gpu' as const, minGiB: 0, maxGiB: null, recommended: 'SD15_LIGHT', offered: [] }, ...AI_MODELS.recommendation] };
    expect(recommend({ device: 'gpu', vramGiB: 48 }, catalogue)?.rowId).toBe('all');
  });

  it('skips a model the catalogue marks unavailable', () => {
    const catalogue = { ...AI_MODELS, models: AI_MODELS.models.map((m) => (m.key === 'ZIMAGE_Q4' ? { ...m, available: false } : m)) };
    expect(recommend({ device: 'cpu', ramGiB: 20 }, catalogue)).toEqual({ rowId: 'cpu-16', recommended: 'SD15_LIGHT', offered: [], skipped: ['ZIMAGE_Q4'] });
  });
});

describe('the model catalogue (src/data/ai-models.json)', () => {
  it('has unique keys, labels in both languages and one commercial default', () => {
    const keys = AI_MODELS.models.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of AI_MODELS.models) {
      expect(m.key).toMatch(/^[A-Z0-9_]+$/);
      expect(m.label.en && m.label.es && m.summary.en && m.summary.es).toBeTruthy();
      expect(m.runtimes.length).toBeGreaterThan(0);
      for (const r of m.runtimes) expect(['desktop', 'web']).toContain(r);
      if (!m.available) expect(m.unavailableReason?.en && m.unavailableReason?.es).toBeTruthy();
      if (m.files.length > 0) expect(m.totalBytes).toBe(m.files.reduce((s, f) => s + f.bytes, 0));
      for (const f of m.files) {
        // Flat basenames (the launcher and the web store refuse anything else) and blob names.
        expect(f.name).toMatch(/^[A-Za-z0-9._-]+$/);
        expect(f.name.includes('..') || f.name.startsWith('.')).toBe(false);
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.bytes).toBeGreaterThan(0);
        expect(f.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
      }
    }
    const defaults = AI_MODELS.models.filter((m) => m.default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].licence.commercialUse).toBe(true);
  });

  it('keeps the keys of AI-POST §2.4', () => {
    for (const key of ['ZIMAGE_Q8', 'ZIMAGE_Q4', 'ZIMAGE_Q2', 'ZIMAGE_WEB', 'KLEIN4B_Q4', 'QWENEDIT_Q4', 'SD15_LIGHT']) expect(aiModel(key)).toBeDefined();
  });

  it('refers only to models it lists, on runtimes that fit the row', () => {
    for (const row of AI_MODELS.recommendation) {
      for (const key of [row.recommended, ...row.offered]) {
        if (key === null) continue;
        const m = aiModel(key);
        expect(m, `${row.id} -> ${key}`).toBeDefined();
        expect(m!.runtimes).toContain(row.device === 'web' ? 'web' : 'desktop');
      }
    }
  });
});

// Phase P6b: the recipe carousel's slider and its filters, without a DOM. The slider steps through the strip's snap
// positions (a card a step, the strip's end the last one): a scroll position gives the nearest step, a step gives its
// card's start, the two agree both ways, and the chosen card is marked where the slider would bring it to the start.
// The filters are the plugin's (the film plugin's: the app's TYPE and ISO rows and the recipes' groups): they combine
// (AND), a recipe with no tag for a filter is under its All only, the count says how many of all of them are left, the
// chosen recipe stays (drawn first) when they leave it out, and the chips are the project's like any plugin setting.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeFilters, cleanPresets, filterPresets, normalisePlugins, presetMatches, withPlugin, type PluginPreset } from '../src/core/plugins';
import { createInitialState, createStore } from '../src/core/store';
import { parseProject, serializeProject } from '../src/io/project';
import * as cmd from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { scrollFromScrub, scrubFromScroll, scrubMark, scrubMax } from '../src/ui/strip-math';
import { createUiStore } from '../src/ui/ui-state';
import { PluginHost } from '../src/plugins/host';
import { memoryPluginStore } from '../src/plugins/store';
import { ModuleWorkerShim } from './module-worker-shim';
import { packInvert } from './plugin-fixtures';

describe('the slider under the carousel (P6b)', () => {
  // 128 cards of 152 px with a gap of 8 (a step of 160) in a strip 700 px wide.
  const step = 160;
  const maxScroll = 128 * 152 + 127 * 8 + 6 - 700;

  it('a step a card, the strip\'s end the last one; nothing to move when the cards fit', () => {
    expect(scrubMax(maxScroll, step)).toBe(Math.ceil(maxScroll / step));
    expect(scrubMax(1600, 160)).toBe(10);
    expect(scrubMax(1601, 160)).toBe(11);
    expect([scrubMax(0, 160), scrubMax(-20, 160), scrubMax(500, 0)]).toEqual([0, 0, 0]);
    expect([scrubFromScroll(300, 0, 160), scrollFromScrub(4, 0, 160)]).toEqual([0, 0]);
  });

  it('scroll and slider agree both ways: a scroll gives the nearest card, a value its card\'s start, the end the end', () => {
    const max = scrubMax(maxScroll, step);
    for (let v = 0; v <= max; v++) expect(scrubFromScroll(scrollFromScrub(v, maxScroll, step), maxScroll, step)).toBe(v);
    expect(scrollFromScrub(0, maxScroll, step)).toBe(0);
    expect(scrollFromScrub(3, maxScroll, step)).toBe(480);
    expect(scrollFromScrub(max, maxScroll, step)).toBe(maxScroll);
    expect(scrollFromScrub(max + 5, maxScroll, step)).toBe(maxScroll);
    expect(scrollFromScrub(-2, maxScroll, step)).toBe(0);
    // A scroll between cards goes to the nearer one; the very end is the last value, short of it the card before.
    expect(scrubFromScroll(479, maxScroll, step)).toBe(3);
    expect(scrubFromScroll(560, maxScroll, step)).toBe(4);
    expect(scrubFromScroll(559, maxScroll, step)).toBe(3);
    expect(scrubFromScroll(maxScroll, maxScroll, step)).toBe(max);
    expect(scrubFromScroll(maxScroll - 0.2, maxScroll, step)).toBe(max);
    expect(scrubFromScroll(-40, maxScroll, step)).toBe(0);
    // An end just past a card's start (a step and a pixel): the end is the last value, not that card.
    expect([scrubFromScroll(1601, 1601, 160), scrubFromScroll(1600, 1601, 160), scrollFromScrub(11, 1601, 160)]).toEqual([11, 10, 1601]);
    // Every scroll position lands on a value whose start is within half a card of it (or on the end).
    for (let x = 0; x <= maxScroll; x += 37) {
      const back = scrollFromScrub(scrubFromScroll(x, maxScroll, step), maxScroll, step);
      expect(Math.abs(back - x) <= step / 2 || back === maxScroll).toBe(true);
    }
  });

  it('the chosen card is marked where the slider brings it to the start; past the last start, at the end', () => {
    const max = scrubMax(maxScroll, step);
    expect(scrubMark(0, maxScroll, step)).toBe(0);
    expect(scrubMark(10, maxScroll, step)).toBeCloseTo(10 / max, 10);
    expect(scrubMark(127, maxScroll, step)).toBe(1);
    expect(scrubMark(max, maxScroll, step)).toBe(1);
    expect(scrubMark(null, maxScroll, step)).toBeNull();
    expect(scrubMark(-1, maxScroll, step)).toBeNull();
    expect(scrubMark(5, 0, step)).toBe(0);
  });
});

/** A small catalogue of the film plugin's shape: films with TYPE and ISO, a film's colour, grain and a lens without. */
const P = (id: string, tags: Record<string, string> = {}): PluginPreset => ({ id, name: { en: id, es: id }, category: 'c', ...(Object.keys(tags).length ? { tags } : {}) });
const CATALOGUE = [
  P('cn-01', { type: 'colour', iso: 'medium', group: 'films' }),
  P('cn-02', { type: 'colour', iso: 'slow', group: 'films' }),
  P('bw-01', { type: 'bw', iso: 'fast', group: 'films' }),
  P('bw-02', { type: 'bw', iso: 'medium', group: 'films' }),
  P('sl-01', { type: 'slide', iso: 'slow', group: 'films' }),
  P('cn-01-colour', { type: 'colour', iso: 'medium', group: 'colour' }),
  P('grain-fine', { group: 'grain' }),
  P('lens-clean', { group: 'lens' }),
];
const FILTERS = [
  { id: 'type', label: { en: 'Type', es: 'Tipo' }, options: ['colour', 'bw', 'slide', 'cine'].map((v) => ({ value: v, label: { en: v, es: v } })) },
  { id: 'iso', label: { en: 'ISO', es: 'ISO' }, options: ['slow', 'medium', 'fast'].map((v) => ({ value: v, label: { en: v, es: v } })) },
  { id: 'group', label: { en: 'Group', es: 'Grupo' }, options: ['films', 'colour', 'grain', 'diffusion', 'lens'].map((v) => ({ value: v, label: { en: v, es: v } })) },
];
const ids = (ps: readonly PluginPreset[]) => ps.map((p) => p.id);

describe('the recipe filters (P6b)', () => {
  it('they combine: every filter chosen is a tag the recipe has; a recipe without the tag is under All only', () => {
    expect(ids(filterPresets(CATALOGUE, {}).shown)).toEqual(ids(CATALOGUE));
    expect(ids(filterPresets(CATALOGUE, { type: 'bw' }).shown)).toEqual(['bw-01', 'bw-02']);
    expect(ids(filterPresets(CATALOGUE, { iso: 'medium' }).shown)).toEqual(['cn-01', 'bw-02', 'cn-01-colour']);
    expect(ids(filterPresets(CATALOGUE, { type: 'colour', iso: 'medium' }).shown)).toEqual(['cn-01', 'cn-01-colour']);
    expect(ids(filterPresets(CATALOGUE, { type: 'colour', iso: 'medium', group: 'films' }).shown)).toEqual(['cn-01']);
    expect(ids(filterPresets(CATALOGUE, { type: 'cine' }).shown)).toEqual([]);
    // A grain has no ISO: under the ISO filter's All, and under no ISO band.
    expect(presetMatches(CATALOGUE[6], { group: 'grain' })).toBe(true);
    for (const band of ['slow', 'medium', 'fast']) expect(presetMatches(CATALOGUE[6], { iso: band })).toBe(false);
    // The bands of one filter split what has the tag: their counts add up to it.
    const counts = ['slow', 'medium', 'fast'].map((b) => filterPresets(CATALOGUE, { iso: b }).count);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(CATALOGUE.filter((p) => p.tags?.iso).length);
  });

  it('the count says how many of all of them; the chosen recipe stays, drawn first, when the filters leave it out', () => {
    expect(filterPresets(CATALOGUE, { type: 'bw' })).toMatchObject({ count: 2, total: 8, kept: null });
    const out = filterPresets(CATALOGUE, { type: 'bw' }, 'cn-02');
    expect(out.kept?.id).toBe('cn-02');
    expect(ids(out.shown)).toEqual(['bw-01', 'bw-02']);
    expect(out.count).toBe(2);
    expect(filterPresets(CATALOGUE, { type: 'bw' }, 'bw-02').kept).toBeNull();
    expect(filterPresets(CATALOGUE, { type: 'bw' }, null).kept).toBeNull();
    expect(filterPresets(CATALOGUE, { type: 'bw' }, 'gone').kept).toBeNull();
  });

  it('only the filters the plugin offers, with values it offers, narrow; the plugin\'s answer is cleaned', () => {
    expect(activeFilters(FILTERS, { type: 'bw', iso: 'warp', maker: 'x' })).toEqual({ type: 'bw' });
    expect(activeFilters(FILTERS, undefined)).toEqual({});
    expect(activeFilters([], { type: 'bw' })).toEqual({});
    const clean = cleanPresets({
      categories: [{ id: 'c', label: { en: 'C', es: 'C' } }],
      filters: [FILTERS[0], { id: 'bad id!', label: { en: 'x', es: 'x' }, options: [{ value: 'a', label: { en: 'a', es: 'a' } }] }, { id: 'empty', label: { en: 'x', es: 'x' }, options: [] }, FILTERS[0]],
      presets: [
        { id: 'a', name: { en: 'A', es: 'A' }, category: 'c', tags: { type: 'bw', iso: 'fast' } },
        { id: 'b', name: { en: 'B', es: 'B' }, category: 'c', tags: { type: 'tintype' } },
      ],
    });
    expect(clean.filters.map((f) => f.id)).toEqual(['type']);
    // A tag for a filter the plugin does not offer, or with a value it does not offer, is dropped.
    expect(clean.presets.map((p) => p.tags)).toEqual([{ type: 'bw' }, undefined]);
    expect(cleanPresets({ presets: [] }).filters).toEqual([]);
  });

  it('the chips are the project\'s: undoable, saved with it, and an old project has none', async () => {
    const one = withPlugin({}, 'aintfilm-film', { filter: { id: 'type', value: 'bw' } });
    expect(one['aintfilm-film']).toEqual({ recipe: null, controls: {}, filters: { type: 'bw' } });
    const two = withPlugin(one, 'aintfilm-film', { filter: { id: 'iso', value: 'fast' }, recipe: 'bw-01' });
    expect(two['aintfilm-film'].filters).toEqual({ type: 'bw', iso: 'fast' });
    expect(withPlugin(two, 'aintfilm-film', { filter: { id: 'type', value: null } })['aintfilm-film'].filters).toEqual({ iso: 'fast' });
    expect(withPlugin(one, 'aintfilm-film', { filter: { id: 'type', value: null } })['aintfilm-film']).toEqual({ recipe: null, controls: {} });
    // Other changes keep the filters; normalise keeps them and the entry's identity.
    expect(withPlugin(two, 'aintfilm-film', { jobs: true })['aintfilm-film'].filters).toEqual({ type: 'bw', iso: 'fast' });
    expect(normalisePlugins(JSON.parse(JSON.stringify(two)), two)).toBe(two);
    expect(normalisePlugins(JSON.parse(JSON.stringify(two)), one)['aintfilm-film']).toEqual(two['aintfilm-film']);
    expect(normalisePlugins({ x: { recipe: null, controls: {}, filters: { 'bad id': 'a', type: 3, iso: 'fast' } } }).x).toEqual({ recipe: null, controls: {}, filters: { iso: 'fast' } });
    const ctx: Ctx = { store: createStore(createInitialState()), ui: createUiStore(), services: {} as AppServices };
    const set = (id: string, value: string | null) => cmd.setRenderSettings(ctx, { plugins: withPlugin(cmd.windowSettings(ctx).plugins, 'aintfilm-film', { filter: { id, value } }) }, undefined, { en: 'film: filter', es: 'película: filtro' });
    set('type', 'bw');
    set('iso', 'fast');
    expect(ctx.store.get().render.plugins['aintfilm-film'].filters).toEqual({ type: 'bw', iso: 'fast' });
    ctx.store.undo();
    expect(ctx.store.get().render.plugins['aintfilm-film'].filters).toEqual({ type: 'bw' });
    ctx.store.redo();
    const back = parseProject(await serializeProject(ctx.store.get()).text());
    expect(back.render.plugins['aintfilm-film'].filters).toEqual({ type: 'bw', iso: 'fast' });
  });

  it('a plugin\'s filters and tags reach the host through its worker (the invert test plugin)', async () => {
    const pkg = await packInvert();
    const host = new PluginHost({ store: memoryPluginStore(), registry: [], fetch: () => Promise.reject(new Error('offline')), spawn: (url) => new ModuleWorkerShim(url), createObjectURL: (b) => URL.createObjectURL(b), revokeObjectURL: (u) => URL.revokeObjectURL(u), now: () => 0 });
    expect(await host.installFile(new Blob([pkg.bytes.slice().buffer as ArrayBuffer]), pkg.keyText)).toMatchObject({ kind: 'DONE' });
    const s = await host.session('test-invert');
    try {
      const p = await s.presets();
      expect(p.filters).toEqual(JSON.parse(readFileSync('tests/fixtures/plugins/invert/recipes.json', 'utf8')).filters);
      expect(p.presets.map((x) => [x.id, x.tags])).toEqual([
        ['full', { strength: 'strong' }],
        ['half', { strength: 'mild' }],
      ]);
      expect(filterPresets(p.presets, { strength: 'mild' }, 'full')).toMatchObject({ count: 1, total: 2, kept: { id: 'full' } });
    } finally {
      s.close();
    }
  }, 30_000);
});

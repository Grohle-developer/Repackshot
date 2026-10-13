// The 20 bokeh types of src/data/bokeh.json (STUDIO-TOOLS §1 and §6, research/optics.md §1).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOKEH_NEUTRAL, BOKEH_TYPES, PUPIL_PROFILES, bokehParams, bokehType, type BokehThin } from '../src/data/bokeh';
import { LENS_PRESCRIPTIONS } from '../src/data/lenses';

const KEYS = [
  'disc',
  'polygon',
  'cats_eye',
  'swirl',
  'bubble',
  'creamy',
  'onion_rings',
  'donut',
  'anamorphic_oval',
  'apodized',
  'coma_comet',
  'double_line',
  'chromatic_fringes',
  'custom_density',
  'textured',
  'custom_shape',
  'multi_hole',
  'diffraction_ring',
  'focus_breathing',
  'variable_sa',
];

const masks = new Set((JSON.parse(readFileSync('public/assets/aperture/index.json', 'utf8')) as { masks: { id: string }[] }).masks.map((m) => m.id));
const lenses = new Set(LENS_PRESCRIPTIONS.map((l) => l.key));
const text = readFileSync('src/data/bokeh.json', 'utf8');

/** Trademarks and makers that must never appear (STUDIO-TOOLS §0). Whole words, any case. */
const FORBIDDEN = ['tessar', 'sonnar', 'planar', 'biotar', 'heliar', 'cooke', 'imagon', 'zeiss', 'leica', 'nikon', 'canon', 'minolta', 'kodak', 'olympus', 'schneider', 'sigma', 'keyshot', 'cinepack', 'retrofocus'];

const thinParams = (): { where: string; thin: Partial<BokehThin> }[] =>
  BOKEH_TYPES.flatMap((t) => [
    ...(t.thin ? [{ where: t.key, thin: t.thin }] : []),
    ...t.variants.map((v) => ({ where: `${t.key}/${v.key}`, thin: { ...t.thin, ...v.thin } })),
  ]);

describe('bokeh types', () => {
  it('has the 20 types of the research, in order, with stable unique keys', () => {
    expect(BOKEH_TYPES.map((t) => t.key)).toEqual(KEYS);
    expect(BOKEH_TYPES.map((t) => t.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const t of BOKEH_TYPES) expect(bokehType(t.key)).toBe(t);
    expect(bokehType('nope')).toBeUndefined();
  });

  it('names and describes every type in both languages, in one line', () => {
    for (const t of BOKEH_TYPES) {
      for (const label of [t.name, t.description, ...t.variants.map((v) => v.name)]) {
        expect(label.en.trim().length, t.key).toBeGreaterThan(0);
        expect(label.es.trim().length, t.key).toBeGreaterThan(0);
      }
      expect(t.description.en, t.key).not.toMatch(/\n/);
      expect(t.description.es, t.key).not.toMatch(/\n/);
      expect(t.description.en.length, t.key).toBeLessThanOrEqual(130);
      expect(t.description.es.length, t.key).toBeLessThanOrEqual(150);
    }
  });

  it('uses no trademark or maker name', () => {
    for (const word of FORBIDDEN) expect(new RegExp(`(^|[^\\p{L}\\p{N}])${word}([^\\p{L}\\p{N}]|$)`, 'iu').test(text), word).toBe(false);
  });

  it('resolves every mask, texture and lens to one that exists', () => {
    for (const { where, thin } of thinParams()) {
      if (thin.mask) expect(masks.has(thin.mask), `${where} mask ${thin.mask}`).toBe(true);
      if (thin.texture) expect(masks.has(thin.texture), `${where} texture ${thin.texture}`).toBe(true);
    }
    for (const t of BOKEH_TYPES) if (t.lens !== null) expect(lenses.has(t.lens), `${t.key} lens ${t.lens}`).toBe(true);
  });

  it('uses every mask that is not a polygon (the polygons are drawn from the blade count)', () => {
    const used = new Set(thinParams().flatMap(({ thin }) => [thin.mask, thin.texture]).filter((m): m is string => !!m));
    for (const id of masks) if (!id.startsWith('polygon_')) expect(used.has(id), id).toBe(true);
  });

  it('marks what needs the traced lens or wave optics, and only that', () => {
    const wave = BOKEH_TYPES.filter((t) => t.requires === 'wave');
    expect(wave.map((t) => t.key)).toEqual(['diffraction_ring']);
    expect(wave[0].thin).toBeNull();
    expect(wave[0].lens).toBeNull();
    expect(BOKEH_TYPES.filter((t) => t.requires === 'traced').map((t) => t.key)).toEqual(['coma_comet', 'focus_breathing', 'variable_sa']);
    for (const t of BOKEH_TYPES.filter((x) => x.requires === 'traced')) expect(t.lens, t.key).not.toBeNull();
    // Everything else is a thin-lens combination and renders without the traced lens.
    for (const t of BOKEH_TYPES.filter((x) => x.requires === null)) expect(t.thin, t.key).not.toBeNull();
    for (const t of BOKEH_TYPES) expect(['traced', 'wave', null], t.key).toContain(t.requires);
  });

  it('keeps every thin-lens parameter in range', () => {
    const profiles = PUPIL_PROFILES.map((p) => p.key);
    expect(profiles).toEqual(['uniform', 'centreBright', 'ringBright', 'apodized']);
    expect(Object.keys(BOKEH_NEUTRAL).sort()).toEqual(
      ['blades', 'roundness', 'rotationDeg', 'mask', 'profile', 'profileParam', 'obstruction', 'catsEye', 'squeeze', 'streaks', 'caAmount', 'swirl', 'onionAmplitude', 'texture'].sort(),
    );
    for (const { where, thin } of thinParams()) {
      const t = thin as BokehThin;
      expect(Object.keys(t).sort(), where).toEqual(Object.keys(BOKEH_NEUTRAL).sort());
      expect(t.blades === 0 || (Number.isInteger(t.blades) && t.blades >= 3 && t.blades <= 18), `${where} blades`).toBe(true);
      for (const [k, lo, hi] of [
        ['roundness', 0, 1],
        ['profileParam', 0, 1],
        ['obstruction', 0, 0.9],
        ['catsEye', 0, 1],
        ['streaks', 0, 1],
        ['caAmount', 0, 1],
        ['swirl', 0, 1],
        ['onionAmplitude', 0, 1],
        ['squeeze', 1, 4],
      ] as const) {
        expect(t[k], `${where} ${k}`).toBeGreaterThanOrEqual(lo);
        expect(t[k], `${where} ${k}`).toBeLessThanOrEqual(hi);
      }
      expect(Number.isFinite(t.rotationDeg), `${where} rotation`).toBe(true);
      expect(profiles, `${where} profile`).toContain(t.profile);
      if (t.profile === 'uniform') expect(t.profileParam, `${where} profileParam`).toBe(0);
    }
  });

  it('makes each type what its name says', () => {
    const p = (key: string): BokehThin => bokehType(key)!.thin!;
    expect(p('disc')).toEqual(BOKEH_NEUTRAL);
    expect(p('polygon').blades).toBeGreaterThanOrEqual(3);
    expect(p('polygon').roundness).toBe(0);
    expect(p('cats_eye').catsEye).toBeGreaterThan(0);
    expect(p('swirl').swirl).toBeGreaterThan(0);
    expect(p('bubble').profile).toBe('ringBright');
    expect(p('creamy').profile).toBe('centreBright');
    expect(p('onion_rings').onionAmplitude).toBeGreaterThan(0);
    expect(p('onion_rings').texture).toBe('onion_rings');
    // The mirror lens of the research (secondary 49 % of the aperture).
    expect(p('donut').obstruction).toBe(0.49);
    expect(LENS_PRESCRIPTIONS.find((l) => l.key === bokehType('donut')!.lens)!.obstructionRatio).toBe(p('donut').obstruction);
    expect(p('anamorphic_oval').squeeze).toBe(2);
    expect(p('anamorphic_oval').streaks).toBeGreaterThan(0);
    expect(p('apodized').profile).toBe('apodized');
    expect(p('double_line').profile).toBe('ringBright');
    expect(p('double_line').profileParam).toBeGreaterThan(p('bubble').profileParam);
    expect(p('chromatic_fringes').caAmount).toBeGreaterThan(0);
    expect(p('textured').texture).not.toBeNull();
    expect(p('custom_shape').mask).not.toBeNull();
    expect(p('multi_hole').mask).toMatch(/^holes_/);
  });

  it('applies a variant on top of the type, and nothing for an unknown one', () => {
    const polygon = bokehType('polygon')!;
    expect(bokehParams(polygon, 'curved')!.roundness).toBe(0.5);
    expect(bokehParams(polygon, 'curved')!.blades).toBe(polygon.thin!.blades);
    expect(bokehParams(polygon)).toBe(polygon.thin);
    expect(bokehParams(polygon, 'nope')).toBe(polygon.thin);
    expect(bokehParams(bokehType('custom_shape')!, 'heart')!.mask).toBe('heart');
    expect(bokehParams(bokehType('diffraction_ring')!)).toBeNull();
    // The curved variant is the roundness the curved masks are drawn with.
    const recipe = (JSON.parse(readFileSync('public/assets/aperture/index.json', 'utf8')) as { masks: { id: string; recipe: { roundness?: number } }[] }).masks.find((m) => m.id === 'polygon_07_curved')!.recipe;
    expect(recipe.roundness).toBe(bokehParams(polygon, 'curved')!.roundness);
  });
});

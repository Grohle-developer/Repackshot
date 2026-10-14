import { describe, expect, it } from 'vitest';
import { createInitialState, createStore } from '../src/core/store';
import { normalize, paletteItems, rank } from '../src/ui/components/palette';
import type { Ctx } from '../src/ui/reactive';
import { setLang } from '../src/ui/strings';
import { defaultUiState, type UiStore } from '../src/ui/ui-state';
import { readUrlParams } from '../src/ui/url-params';

function ctx(): Ctx {
  const ui: UiStore = { get: () => defaultUiState(), set: () => {}, subscribe: () => () => {}, toast: () => {} };
  return { store: createStore(createInitialState()), ui, services: {} as Ctx['services'] };
}

describe('command palette search', () => {
  const items = paletteItems(ctx());
  const top = (q: string) => rank(items, q)[0]?.id;

  it('finds the acceptance flow words in Spanish (accents ignored)', () => {
    setLang('es');
    expect(top('ejemplo')).toBe('action:example');
    expect(top('joyería')).toBe('product:JEWELLERY');
    expect(top('crear estudio')).toBe('action:createStudio');
    expect(top('oro')).toBe('material:GOLD');
    expect(top('rembrandt')).toBe('setup:REMBRANDT');
  });

  it('finds them in English, and Spanish words from an English interface', () => {
    setLang('en');
    expect(top('example')).toBe('action:example');
    expect(top('jewellery')).toBe('product:JEWELLERY');
    expect(top('create studio')).toBe('action:createStudio');
    expect(top('gold')).toBe('material:GOLD');
    expect(top('oro')).toBe('material:GOLD');
    expect(top('joyeria')).toBe('product:JEWELLERY');
  });

  it('lists every catalogue entry', () => {
    // L6: the five set materials and the 16 sets.
    expect(items.filter((i) => i.category === 'palette.cat.material')).toHaveLength(82);
    expect(items.filter((i) => i.category === 'palette.cat.setup')).toHaveLength(88);
    expect(items.filter((i) => i.category === 'palette.cat.product')).toHaveLength(16);
  });

  it('normalises accents and case', () => {
    expect(normalize('  Joyería ')).toBe('joyeria');
  });
});

describe('URL parameters', () => {
  it('reads the documented parameters and drops unknown values', () => {
    const p = readUrlParams('?example=1&preset=jewellery&setup=REMBRANDT&theme=light&lang=es&drawer=animation&panels=collapsed&select=Cap&catalog=1&sequence=hero&t=2.5&guide=3');
    expect(p).toEqual({
      example: true,
      preset: 'JEWELLERY',
      setup: 'REMBRANDT',
      theme: 'light',
      lang: 'es',
      drawer: 'animation',
      panels: 'collapsed',
      select: 'cap',
      catalog: true,
      sequence: 'HERO',
      t: 2.5,
      guide: 2,
    });
    expect(readUrlParams('?preset=NOPE&theme=blue&lang=fr&setup=x')).toEqual({ example: false });
    expect(readUrlParams('?tool=move').tool).toBe('move');
    expect(readUrlParams('?tool=MOVE').tool).toBe('move');
    expect(readUrlParams('?tool=lasso').tool).toBeUndefined();
  });
});

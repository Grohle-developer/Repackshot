import { describe, expect, it } from 'vitest';
import { defaultInstance } from '../src/core/materials';
import { materialName, studioLabel } from '../src/ui/names';
import { L, STRINGS, setLang, t } from '../src/ui/strings';

describe('interface strings', () => {
  const en = STRINGS.en;
  const es = STRINGS.es;

  it('have the same keys in English and Spanish', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it('are never empty', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), `en ${k}`).not.toBe('');
    for (const [k, v] of Object.entries(es)) expect(v.trim(), `es ${k}`).not.toBe('');
  });

  it('use the same {placeholders} in both languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ph(es[k]), k).toEqual(ph(en[k]));
  });

  it('switch language live and interpolate', () => {
    setLang('es');
    expect(t('status.warnings', { n: 2 })).toBe('2 avisos');
    setLang('en');
    expect(t('status.warnings', { n: 2 })).toBe('2 warnings');
    expect(L('undo.assign', { material: { en: 'Gold', es: 'Oro' }, target: 'Body' })).toEqual({
      en: 'Assign Gold to Body',
      es: 'Asignar Oro a Body',
    });
  });

  it('English is the default', () => {
    expect(t('app.untitled')).toBe('Untitled');
  });
});

describe('names shown for model objects', () => {
  it('the Default material and the Standard product type', () => {
    const d = defaultInstance('m1', 100);
    expect(materialName(d, 'en')).toBe('Default');
    expect(materialName(d, 'es')).toBe('Predeterminado');
    expect(studioLabel('GENERIC')).toEqual({ en: 'Standard', es: 'Estándar' });
    expect(studioLabel('JEWELLERY').en).toBe('Jewellery');
  });
});

// Output names from a template with tokens (phase U5, UI.md §2.7).

import { describe, expect, it } from 'vitest';
import { DEFAULT_NAME_TEMPLATE, expandTemplate, isoDate, NAME_TOKENS, outputFileName, safeFileName, type NameValues } from '../src/core/name-template';

const values: NameValues = { project: 'Bottle', camera: 'Camera 1', studio: 'Jewellery', date: new Date(2026, 9, 3, 14, 5), n: 7 };

describe('name template', () => {
  it('has stable token keys and a default that numbers the renders', () => {
    expect(NAME_TOKENS).toEqual(['project', 'camera', 'studio', 'date', 'n']);
    expect(outputFileName(DEFAULT_NAME_TEMPLATE, { ...values, n: 1 }, 'png')).toBe('Bottle_Camera 1_0001.png');
  });

  it('expands every token', () => {
    expect(expandTemplate('{project}|{camera}|{studio}|{date}|{n}', values)).toBe('Bottle|Camera 1|Jewellery|2026-10-03|0007');
    expect(isoDate(new Date(2027, 0, 9))).toBe('2027-01-09');
    expect(expandTemplate('{n}', { ...values, n: 12345 })).toBe('12345');
    // Unknown words in braces stay as typed.
    expect(expandTemplate('{project}-{nope}', values)).toBe('Bottle-{nope}');
  });

  it('strips what a file system does not take', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(safeFileName('tab\there\u0000 and\nnewline')).toBe('tabhere andnewline');
    expect(safeFileName('  ..hidden. ')).toBe('hidden');
    expect(safeFileName('many    spaces')).toBe('many spaces');
    expect(safeFileName('CON')).toBe('_CON');
    expect(safeFileName('lpt1.render')).toBe('_lpt1.render');
    expect(safeFileName('???')).toBe('render');
    expect(safeFileName('x'.repeat(400))).toHaveLength(150);
    expect(safeFileName('Joyería · Cámara 1')).toBe('Joyería · Cámara 1');
    expect(outputFileName('{project}/{camera}', { ...values, project: 'My: "project"' }, 'jpg')).toBe('My projectCamera 1.jpg');
  });

  it('frames of an animation are numbered: through {n}, or _0001 appended', () => {
    expect(outputFileName('{project}_{camera}', { ...values, n: 1 }, 'png', true)).toBe('Bottle_Camera 1_0001.png');
    expect(outputFileName('{project}_{n}_{camera}', { ...values, n: 24 }, 'png', true)).toBe('Bottle_0024_Camera 1.png');
    expect(outputFileName('', { ...values, n: 3 }, 'exr', true)).toBe('render_0003.exr');
  });
});

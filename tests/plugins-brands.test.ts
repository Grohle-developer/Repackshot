// No maker's or product's name where the public sees it (aintfilm's rule D112, phase P6): the check of
// tools/plugins/brand-scan.mjs fires on a planted word, by invented words (the mechanism needs no real mark), and,
// where an aintfilm checkout is at hand (AINTFILM, or /home/user/aintfilm), Repackshot's own strings, the registry and
// the film plugin's manifest and glue pass it with that checkout's list of hashes (which is not in this repository).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listsFromWords, readBrandLists, scanBinary, scanText } from '../tools/plugins/brand-scan.mjs';

const CHECKOUT = process.env.AINTFILM ?? '/home/user/aintfilm';
const HASHES = join(CHECKOUT, 'scripts', 'brand-hashes.json');

describe('the brand check (tools/plugins/brand-scan.mjs)', () => {
  const lists = listsFromWords({ tokens: ['zorbexium', 'quilt'], phrases: ['mellow 9000', 'pan quill plus'], ids: ['zorbexium-9000'] });

  it('a mark fires alone, whatever its case and accents; a product name only as the whole phrase', () => {
    expect(scanText('a ZÓRBEXIUM film', lists).map((f) => f.what)).toEqual(['a listed mark']);
    expect(scanText('Mellow 9000, the stock', lists).map((f) => f.what)).toEqual(['a listed product name']);
    expect(scanText('mellow and 9000', lists)).toEqual([]);
    expect(scanText('Pan Quill Plus 50', lists)).toHaveLength(1);
    expect(scanText('pan, quill and plus', lists)).toEqual([]);
    // The line is said, never the word.
    const [f] = scanText('one\ntwo zorbexium', lists);
    expect(f).toMatchObject({ line: 2 });
    expect(JSON.stringify(f)).not.toContain('zorbexium');
  });

  it('an id-shaped run is checked against the retired ids', () => {
    expect(scanText('"id": "zorbexium-9000"', lists).map((f) => f.what)).toContain('a retired id');
  });

  it('a module is read as its printable runs, glued names found inside them', () => {
    const bytes = new TextEncoder().encode('\u0000\u0001xx_mellow-9000_yy\u0000abc zorbexiumfilm\u0002');
    const found = scanBinary(bytes, lists).map((f) => f.what);
    expect(found).toContain('a listed product name');
    expect(found).toContain('a listed mark');
    // A short mark inside a longer word is not one (five letters inside a word are anybody's).
    expect(scanBinary(new TextEncoder().encode('\u0000quilted cover\u0000'), lists)).toEqual([]);
    expect(scanBinary(new TextEncoder().encode('\u0000a quilt here\u0000'), lists)).toHaveLength(1);
  });
});

describe.skipIf(!existsSync(HASHES))("Repackshot's own words, by the aintfilm checkout's list", () => {
  it('the interface strings, the registry and the film plugin carry no listed mark, product name or retired id', () => {
    const list = readBrandLists(HASHES);
    for (const f of ['src/ui/strings.ts', 'src/data/plugins.json', 'tools/plugins/film/manifest.json', 'tools/plugins/film/plugin.js', 'tools/plugins/build-film.mjs', 'tests/fixtures/plugins/invert/manifest.json']) {
      expect(scanText(readFileSync(f, 'utf8'), list), f).toEqual([]);
    }
  });
});

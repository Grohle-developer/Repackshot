// The check that no maker's or product's name reaches what the public sees (aintfilm's rule D112), for the film
// plugin's package and for Repackshot's own strings. The list it compares against is aintfilm's: sha256 hashes of
// words, never the words (`scripts/brand-hashes.json` of an aintfilm checkout, read where it is, never copied here).
// The mechanism, as that list's own description states it, written again for Repackshot:
//
//   - text is normalised (decomposed, diacritics off, lower case) and cut into runs of letters and digits;
//   - a token whose hash is a listed mark fires alone; one to three tokens joined by one space whose hash is a listed
//     product name fire; an id-shaped run (`word-word`) whose hash is a retired id fires;
//   - a binary (a WebAssembly module) is read as its printable runs of four or more, hyphens and underscores taken
//     out, searched by substring for every listed mark and glued product name of six characters or more, and by whole
//     segment for the shorter ones.
//
// A finding names the file, the line or the byte, the kind and the first eight characters of the hash; never the
// word. Comments are not stripped here: a mark in a comment is found too, which is stricter than the original.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
export const normalise = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The list from its JSON (aintfilm's file, or one a test makes from invented words). */
export function brandLists(json) {
  return {
    tokens: new Set(json.tokens ?? []),
    phrases: new Set(json.phrases ?? []),
    glued: new Set(json.glued ?? []),
    ids: new Set(json.ids ?? []),
    lengths: [...new Set(json.lengths ?? [])].sort((a, b) => a - b),
  };
}

export function readBrandLists(path) {
  return brandLists(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * A list made from words (for the tests: invented words prove the mechanism without spelling a mark).
 * @param {{ tokens?: string[]; phrases?: string[]; ids?: string[] }} words
 */
export function listsFromWords({ tokens = [], phrases = [], ids = [] }) {
  const t = [...new Set(tokens.map(normalise))];
  const p = [...new Set(phrases.map((s) => (normalise(s).match(/[a-z0-9]+/g) ?? []).join(' ')))];
  const glued = p.map((s) => s.replace(/ /g, ''));
  return brandLists({ tokens: t.map(sha), phrases: p.map(sha), glued: glued.map(sha), ids: ids.map((i) => sha(normalise(i))), lengths: [...t, ...glued].map((s) => s.length) });
}

/** The findings of a text, line by line. */
export function scanText(text, lists) {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    const line = normalise(raw);
    for (const m of line.matchAll(/[a-z0-9]+(?:-[a-z0-9]+)+/g)) {
      const h = sha(m[0]);
      if (lists.ids.has(h)) out.push({ line: i + 1, what: 'a retired id', hash: h.slice(0, 8) });
    }
    const toks = line.match(/[a-z0-9]+/g) ?? [];
    for (let j = 0; j < toks.length; j++) {
      const h = sha(toks[j]);
      if (lists.tokens.has(h)) out.push({ line: i + 1, what: 'a listed mark', hash: h.slice(0, 8) });
      for (let n = 1; n <= 3 && j + n <= toks.length; n++) {
        const ph = sha(toks.slice(j, j + n).join(' '));
        if (lists.phrases.has(ph)) out.push({ line: i + 1, what: 'a listed product name', hash: ph.slice(0, 8) });
      }
    }
  });
  return out;
}

/** The findings of a binary's printable runs. */
export function scanBinary(bytes, lists) {
  const out = [];
  const seen = new Set();
  const runs = [];
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const b = i < bytes.length ? bytes[i] : 0;
    const printable = b >= 0x20 && b <= 0x7e;
    if (printable && start < 0) start = i;
    if (!printable && start >= 0) {
      if (i - start >= 4) runs.push({ at: start, text: String.fromCharCode(...bytes.subarray(start, i)) });
      start = -1;
    }
  }
  const hit = (at, h, token) => {
    const key = `${at}:${h}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ at, what: token ? 'a listed mark' : 'a listed product name', hash: h.slice(0, 8) });
  };
  for (const run of runs) {
    const lower = normalise(run.text);
    const g = lower.replace(/[-_]/g, '');
    for (const len of lists.lengths) {
      if (len < 6 || len > g.length) continue;
      for (let i = 0; i + len <= g.length; i++) {
        const h = sha(g.slice(i, i + len));
        if (lists.tokens.has(h)) hit(run.at, h, true);
        else if (lists.glued.has(h)) hit(run.at, h, false);
      }
    }
    for (const m of lower.matchAll(/[a-z0-9]+/g)) {
      if (m[0].length >= 6) continue;
      const h = sha(m[0]);
      if (lists.tokens.has(h)) hit(run.at, h, true);
      else if (lists.glued.has(h)) hit(run.at, h, false);
    }
  }
  return out;
}

/** A file through the right scan: binaries by their runs, text by its lines. */
export function scanFileBytes(name, bytes, lists) {
  return /\.wasm$/i.test(name) ? scanBinary(bytes, lists) : scanText(new TextDecoder().decode(bytes), lists);
}

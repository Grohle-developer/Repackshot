#!/usr/bin/env node
// The contact sheet of the sets (L6, for the verdict on their look): the 16 sets on BOTTLE, BOX and CHROME, and the own
// rig of every product type that is a set, before L6 and after, on BOTTLE (Standard and Electronics also on BOX),
// rendered with the native `rt` (512 px, 96 samples, denoised, seed 1).
//
//   node tools/sets-sheet.mjs [--out out] [--spp 96] [--size 512x512] [--keys STRIP_EDGE,GLASS_DARK_FIELD]
//
// Writes <out>/sets-sheet/*.rsb and *.png (one per scene, with its render time) and <out>/sets-sheet.html.
// The scenes are written by tests/setup-thumbs-dump.test.ts (mode SHEET) with the application's own code.

import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dumpScenes, findRt, render } from './rt-batch.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(ROOT, opt('out', 'out'));
const DIR = join(OUT, 'sets-sheet');
const SPP = opt('spp', '96');
const SIZE = opt('size', '512x512');
const KEYS = opt('keys', '');

const rt = findRt(ROOT);
if (!KEYS && existsSync(DIR)) rmSync(DIR, { recursive: true });
mkdirSync(DIR, { recursive: true });
const plan = dumpScenes(ROOT, DIR, 'SHEET', { REPACKSHOT_THUMBS_SPP: SPP, REPACKSHOT_THUMBS_SIZE: SIZE, ...(KEYS ? { REPACKSHOT_THUMBS_KEYS: KEYS } : {}) });
const times = existsSync(join(DIR, 'times.json')) ? JSON.parse(readFileSync(join(DIR, 'times.json'), 'utf8')) : {};
for (const s of plan.scenes) {
  const png = s.file.replace(/\.rsb$/, '.png');
  times[png] = render(rt, join(DIR, s.file), join(DIR, png));
  console.log(`${png}: ${times[png].toFixed(1)} s`);
  writeFileSync(join(DIR, 'times.json'), JSON.stringify(times, null, 1));
}

// The page: names from the catalogue (English and Spanish), the hero and the time of each picture.
const all = JSON.parse(readFileSync(join(DIR, 'scenes.json'), 'utf8'));
const meta = all.meta ?? {};
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cell = (png, caption) =>
  `<figure><img src="sets-sheet/${png}" width="256" height="256" loading="lazy"><figcaption>${caption}${times[png] !== undefined ? ` · ${times[png].toFixed(1)} s` : ''}</figcaption></figure>`;
const setKeys = [...new Set(all.scenes.filter((s) => s.setup !== 'PRESET').map((s) => s.setup))];
const rows = setKeys.map((k) => {
  const m = meta.sets?.[k] ?? {};
  const pics = ['bottle', 'box', 'chrome'].map((h) => cell(`${k.toLowerCase()}-${h}.png`, h.toUpperCase() + (m.hero === h.toUpperCase() ? ' (hero)' : '')));
  return `<section><h2>${esc(k)} · ${esc(m.en ?? '')} <small>${esc(m.es ?? '')}</small></h2><p>${esc(m.why ?? '')}</p><div class="row">${pics.join('')}</div></section>`;
});
const pairList = [...new Map(all.scenes.filter((s) => s.setup === 'PRESET').map((s) => [`${s.preset}|${s.hero}`, s])).values()];
const pairs = pairList.map((s) => {
  const tag = `preset-${s.preset.toLowerCase()}-${s.hero.toLowerCase()}`;
  return `<div class="pair"><h3>${esc(s.preset)} ← ${esc(meta.presets?.[s.preset] ?? '')} · ${esc(s.hero)}</h3>${cell(`${tag}-before.png`, 'before L6')}${cell(`${tag}-after.png`, 'after L6')}</div>`;
});
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sets contact sheet</title>
<style>:root{color-scheme:dark}body{background:#111;color:#ddd;font:13px/1.4 system-ui,sans-serif;margin:16px}h1{font-size:18px}h2{font-size:15px;margin:18px 0 2px}h2 small{color:#888;font-weight:normal}h3{font-size:13px;margin:4px 0}p{margin:0 0 6px;color:#aaa;max-width:900px}.row,.pairs{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0}figure img{display:block;width:256px;height:256px;background:#000}figcaption{color:#999;font-size:12px}.pair{display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid #333}.pair figure{display:inline-block;margin-right:6px}.pair{flex-direction:row;flex-wrap:wrap;width:540px}.pair h3{width:100%}</style></head><body>
<h1>L6 · sets contact sheet</h1><p>${esc(plan.width)} × ${esc(plan.height)} px, ${esc(plan.spp)} spp, denoised, seed ${esc(plan.seed)}, product type GENERIC (its exposure and focal length; a set with a camera uses it). Times are rt's sampling plus denoise on this machine, shared with other jobs.</p>
${rows.join('\n')}
<h2>Product types: their own rig before L6 and after (BOTTLE; Standard and Electronics also on BOX)</h2><div class="pairs">${pairs.join('\n')}</div>
</body></html>
`;
writeFileSync(join(OUT, 'sets-sheet.html'), html);
console.log(`wrote ${join(OUT, 'sets-sheet.html')}`);

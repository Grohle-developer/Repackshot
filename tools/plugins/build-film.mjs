#!/usr/bin/env node
// Builds the film simulation plugin (ROADMAP P6 decision 5) from an aintfilm checkout, and packs it.
//
//   node tools/plugins/build-film.mjs --aintfilm <checkout> [--out <folder>] [--rpk <file.rpk>]
//                                    [--key-out <file> | --key-file <file>] [--version <v>]
//
// The bundle folder (`--out`, default out/plugins/film) gets, from the checkout, read where it is and never copied
// into this repository: the engine's WebAssembly module (`public/engine/itsnotfilm-engine.wasm`, checked to import
// nothing) as module.wasm, its presets (`src/engine/presets/`) made complete with the checkout's own reader of them
// (`settingsFromValue`, so each is the engine's settings with every field) and renamed to neutral ids, the logo
// (`assets/exported/marks/LOGO.svg`), the licence (`LICENSE` as LICENCE.txt) and the third-party notices
// (`public/THIRD-PARTY-NOTICES.txt` as NOTICES.txt); and, from here, the manifest (tools/plugins/film/manifest.json,
// its version and file list filled in) and the glue (tools/plugins/film/plugin.js). recipes.json names every recipe
// with its public name only (aintfilm's D112: no maker's or product's name anywhere the public sees): a film is its
// neutral id in capitals (the catalogue's rule until the owner picks the names, D113), a diffusion filter or a format
// one of D112's own words. engine.json is the engine data plugin.js reads: the formats, filters and lenses by index.
//
// Then the brand check over the folder and over Repackshot's own strings (tools/plugins/brand-scan.mjs with the
// checkout's hash list): what the public sees must be clean, or the build fails. The engine's own tags inside the
// module and inside the presets' settings (a filter's kind, a paper's key) are the checkout's to rename (its M38-07
// and M38-08); they are counted and printed by hash, and allowed.
//
// With --rpk it packs the folder (tools/plugin-pack.mjs) under a new activation key, written only to --key-out
// (which must be outside this repository), or under the key of --key-file (an update keeps its key). It prints the
// package's version, size and SHA-256: what the registry entry (src/data/plugins.json) pins.

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listFiles, packFolder, sha256File } from '../plugin-pack.mjs';
import { encodeKeyText, newKeyBytes, parseKey } from '../plugin-rpk.mjs';
import { readBrandLists, scanFileBytes } from './brand-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = join(ROOT, 'tools', 'plugins', 'film');

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const fail = (msg) => {
  console.error(`build-film: ${msg}`);
  process.exit(1);
};

/** The recipes' families, by the catalogue's class of each film. */
const FAMILIES = {
  'C-NEG': { id: 'films-cn', label: { en: 'Films · colour negative', es: 'Películas · negativo en color' } },
  SLIDE: { id: 'films-sl', label: { en: 'Films · slide', es: 'Películas · diapositiva' } },
  CINE: { id: 'films-ci', label: { en: 'Films · cine', es: 'Películas · cine' } },
  'B&W': { id: 'films-bw', label: { en: 'Films · black and white', es: 'Películas · blanco y negro' } },
};
const COLOUR = { id: 'colour', label: { en: 'The colour of a film, alone', es: 'El color de una película, solo' } };
const GRAIN = { id: 'grain', label: { en: 'Grain', es: 'Grano' } };
const DIFFUSION = { id: 'diffusion', label: { en: 'Diffusion filters', es: 'Filtros de difusión' } };
const LENS = { id: 'lens', label: { en: 'Lens characters', es: 'Caracteres de objetivo' } };

/** The grain presets' names (generic words) in both languages, in the order they are offered. */
const GRAIN_NAMES = {
  'grain-ultrafine': { en: 'Ultra fine', es: 'Ultrafino' },
  'grain-fine': { en: 'Fine', es: 'Fino' },
  'grain-medium': { en: 'Medium', es: 'Medio' },
  'grain-coarse': { en: 'Coarse', es: 'Grueso' },
  'grain-very-coarse': { en: 'Very coarse', es: 'Muy grueso' },
  'grain-dye-cloud': { en: 'Dye cloud', es: 'Nube de colorante' },
  'grain-silver-classic': { en: 'Silver, classic', es: 'Plata, clásico' },
  'grain-silver-tabular': { en: 'Silver, tabular', es: 'Plata, tabular' },
};

/** D112's words for the diffusion filters, by the index of the checkout's list of them. */
const DIFFUSION_WORDS = ['BLACK DIFFUSION 1/8', 'BLACK DIFFUSION 1/4', 'BLACK DIFFUSION 1/2', 'BLACK DIFFUSION 1', 'BLACK DIFFUSION 2', 'WHITE DIFFUSION 1/2', 'WHITE DIFFUSION 1', 'WARM DIFFUSION 1/4', 'WARM DIFFUSION 1/2', 'WARM DIFFUSION 1', 'SPARKLE 1', 'SPARKLE 2', 'PEARL 1/2'];
/** The lens characters' words of the checkout's dictionaries, by the index of its list of them. */
const LENS_WORDS = [
  { en: 'CLEAN', es: 'LIMPIO' },
  { en: 'VINTAGE', es: 'VINTAGE' },
  { en: 'UNCOATED', es: 'SIN TRATAMIENTO' },
  { en: 'FAST PORTRAIT', es: 'RETRATO LUMINOSO' },
];

/** A string array literal of a source file, `const NAME = [ "a", "b" ]`, without running the file. */
function arrayLiteral(text, name) {
  const m = new RegExp(`const ${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(text);
  if (!m) fail(`${name} not found`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function inside(path, dir) {
  const rel = relative(dir, resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function main() {
  const checkout = opt('aintfilm');
  if (!checkout) fail('usage: node tools/plugins/build-film.mjs --aintfilm <checkout> [--out <folder>] [--rpk <file.rpk> (--key-out <file> | --key-file <file>)] [--version <v>]');
  const src = (p) => join(resolve(checkout), p);
  const need = ['package.json', 'public/engine/itsnotfilm-engine.wasm', 'src/engine/presets/index.json', 'src/engine/settings.ts', 'src/engine/format.ts', 'src/engine/index.ts', 'src/lib/filmSettings.ts', 'docs/research/data/stocks-map.json', 'assets/exported/marks/LOGO.svg', 'LICENSE', 'public/THIRD-PARTY-NOTICES.txt', 'scripts/brand-hashes.json'];
  for (const p of need) if (!existsSync(src(p))) fail(`${p} is not in ${checkout}`);
  const out = resolve(opt('out', join(ROOT, 'out', 'plugins', 'film')));
  if (inside(out, resolve(checkout))) fail('the bundle folder may not be inside the aintfilm checkout (it is read only)');
  const version = opt('version', JSON.parse(readFileSync(src('package.json'), 'utf8')).version);
  const engineVersion = /export const ENGINE_VERSION = "([^"]+)"/.exec(readFileSync(src('src/engine/index.ts'), 'utf8'))?.[1] ?? version;

  // The module: compiled here, and it must import nothing and export what plugin.js calls.
  const wasm = readFileSync(src('public/engine/itsnotfilm-engine.wasm'));
  const mod = new WebAssembly.Module(wasm);
  const imports = WebAssembly.Module.imports(mod);
  if (imports.length) fail(`the engine module imports ${imports.map((i) => `${i.module}.${i.name}`).join(', ')}`);
  const exported = new Set(WebAssembly.Module.exports(mod).map((e) => e.name));
  const calls = ['memory', 'inf_alloc', 'inf_free', 'inf_info_ptr', 'inf_info_len', 'inf_error_ptr', 'inf_error_len', 'inf_render_rgba', 'inf_render_linear_rgba'];
  const missing = calls.filter((c) => !exported.has(c));
  if (missing.length) fail(`the engine module does not export ${missing.join(', ')}`);

  // The presets, read with the checkout's own reader (the engine's defaults filled in, as its serde does).
  const engine = await import(pathToFileURL(src('src/engine/settings.ts')).href);
  const { FILM_FORMATS } = await import(pathToFileURL(src('src/engine/format.ts')).href);
  const filmSettings = readFileSync(src('src/lib/filmSettings.ts'), 'utf8');
  const diffusionIds = arrayLiteral(filmSettings, 'DIFFUSION_IDS');
  const lensIds = arrayLiteral(filmSettings, 'LENS_IDS');
  const scanBlurUm = Number(/export const SCAN_BLUR_UM = ([0-9.]+);/.exec(filmSettings)?.[1] ?? 13);
  if (diffusionIds.length !== DIFFUSION_WORDS.length) fail(`the checkout has ${diffusionIds.length} diffusion filters; this build names ${DIFFUSION_WORDS.length}`);
  if (lensIds.length !== LENS_WORDS.length) fail(`the checkout has ${lensIds.length} lens characters; this build names ${LENS_WORDS.length}`);
  const template = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
  const formatOptions = template.controls.find((c) => c.key === 'format').options.filter((o) => /^\d+$/.test(o.value));
  if (FILM_FORMATS.length !== formatOptions.length) fail(`the checkout has ${FILM_FORMATS.length} formats; the manifest names ${formatOptions.length}`);
  const map = JSON.parse(readFileSync(src('docs/research/data/stocks-map.json'), 'utf8'));
  const neutralOf = new Map(map.rows.map((r) => [r.key, r]));
  const index = JSON.parse(readFileSync(src('src/engine/presets/index.json'), 'utf8'));

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'presets'), { recursive: true });
  const write = (name, value) => {
    const path = join(out, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === 'string' || value instanceof Uint8Array ? value : `${JSON.stringify(value)}\n`);
  };
  /** A preset as the engine reads it, every field, its words of display taken out. */
  const complete = (raw, id) => ({ ...engine.settingsFromValue(raw), id, name: '', manufacturer: '', description: '' });

  const recipes = [];
  const skipped = [];
  const famOrder = Object.keys(FAMILIES);
  const stockEntries = [];
  for (const p of index.presets) {
    const raw = JSON.parse(readFileSync(src(`src/engine/presets/${p.file}`), 'utf8'));
    if (p.category === 'stock' || p.category === 'color') {
      const key = p.category === 'color' ? p.id.replace(/-color$/, '') : p.id;
      const row = neutralOf.get(key);
      if (!row || !FAMILIES[row.klass]) {
        skipped.push(p.file);
        continue;
      }
      const nid = p.category === 'color' ? `${row.id}-colour` : row.id;
      const file = `presets/${p.category === 'color' ? 'colour' : 'film'}/${row.id}.json`;
      const settings = complete(raw, nid);
      write(file, settings);
      const box = Math.round(settings.iso_rated || settings.iso);
      stockEntries.push({ fam: famOrder.indexOf(row.klass), serial: row.id, colour: p.category === 'color', recipe: { id: nid, name: { en: row.id.toUpperCase(), es: row.id.toUpperCase() }, category: p.category === 'color' ? COLOUR.id : FAMILIES[row.klass].id, aux: { en: `ISO ${box}`, es: `ISO ${box}` }, file } });
    } else if (p.category === 'grain') {
      const name = GRAIN_NAMES[p.id];
      if (!name) {
        skipped.push(p.file);
        continue;
      }
      const file = `presets/grain/${p.id.replace(/^grain-/, '')}.json`;
      write(file, complete(raw, p.id));
      recipes.push({ order: [6, Object.keys(GRAIN_NAMES).indexOf(p.id)], recipe: { id: p.id, name, category: GRAIN.id, file } });
    } else if (p.category === 'look') {
      const d = diffusionIds.indexOf(p.id);
      const l = lensIds.indexOf(p.id);
      if (d >= 0) {
        const id = `dif-${String(d + 1).padStart(2, '0')}`;
        const file = `presets/diffusion/${id}.json`;
        write(file, complete(raw, id));
        recipes.push({ order: [7, d], recipe: { id, name: { en: DIFFUSION_WORDS[d], es: DIFFUSION_WORDS[d] }, category: DIFFUSION.id, file } });
      } else if (l >= 0) {
        const file = `presets/lens/${p.id.replace(/^lens-/, '')}.json`;
        write(file, complete(raw, p.id));
        recipes.push({ order: [8, l], recipe: { id: p.id, name: LENS_WORDS[l], category: LENS.id, file } });
      } else skipped.push(p.file);
    } else skipped.push(p.file);
  }
  stockEntries.sort((a, b) => Number(a.colour) - Number(b.colour) || a.fam - b.fam || (a.serial < b.serial ? -1 : 1));
  const ordered = [...stockEntries.map((s) => s.recipe), ...recipes.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]).map((r) => r.recipe)];
  const usedFamilies = famOrder.filter((k) => stockEntries.some((s) => !s.colour && FAMILIES[k] && s.recipe.category === FAMILIES[k].id)).map((k) => FAMILIES[k]);
  write('recipes.json', { categories: [...usedFamilies, COLOUR, GRAIN, DIFFUSION, LENS], recipes: ordered });
  write('presets/neutral.json', { ...engine.defaultSettings(), id: 'neutral', name: '', manufacturer: '', description: '' });
  const recipeFile = (id) => ordered.find((r) => r.id === id)?.file;
  write('engine.json', {
    version: engineVersion,
    neutral: 'presets/neutral.json',
    formats: [...FILM_FORMATS],
    diffusion: diffusionIds.map((_, d) => recipeFile(`dif-${String(d + 1).padStart(2, '0')}`)),
    lens: lensIds.map((id) => recipeFile(id)),
    scanBlurUm,
  });

  // What the checkout gives as it is, and what this repository writes.
  write('module.wasm', new Uint8Array(wasm));
  cpSync(src('assets/exported/marks/LOGO.svg'), join(out, 'logo.svg'));
  cpSync(src('LICENSE'), join(out, 'LICENCE.txt'));
  cpSync(src('public/THIRD-PARTY-NOTICES.txt'), join(out, 'NOTICES.txt'));
  cpSync(join(HERE, 'plugin.js'), join(out, 'plugin.js'));
  const fixed = new Set(['manifest.json', 'plugin.js', 'module.wasm', 'logo.svg', 'LICENCE.txt', 'NOTICES.txt']);
  const files = listFiles(out).filter((f) => !fixed.has(f));
  write('manifest.json', `${JSON.stringify({ ...template, version, files }, null, 2)}\n`);
  console.log(`build-film: ${ordered.length} recipes (${stockEntries.filter((s) => !s.colour).length} films, ${stockEntries.filter((s) => s.colour).length} colour, ${recipes.filter((r) => r.recipe.category === GRAIN.id).length} grain, ${recipes.filter((r) => r.recipe.category === DIFFUSION.id).length} filters, ${recipes.filter((r) => r.recipe.category === LENS.id).length} lenses), ${files.length + fixed.size} files → ${out}`);
  if (skipped.length) console.log(`  left out (no public name for them): ${skipped.length}`);

  // The brand check: what the public sees is clean; the engine's own tags are counted.
  const lists = readBrandLists(src('scripts/brand-hashes.json'));
  const PUBLIC = (f) => ['manifest.json', 'recipes.json', 'plugin.js', 'logo.svg', 'LICENCE.txt'].includes(f);
  const publicFindings = [];
  const engineFindings = new Map();
  for (const f of listFiles(out)) {
    const found = scanFileBytes(f, new Uint8Array(readFileSync(join(out, f))), lists);
    if (!found.length) continue;
    if (PUBLIC(f)) publicFindings.push(...found.map((x) => `${f} (${x.line ? `line ${x.line}` : `byte ${x.at}`}): ${x.what} [${x.hash}]`));
    else {
      const kind = f === 'module.wasm' ? 'the module' : f === 'NOTICES.txt' ? 'the notices (what a licence requires)' : f === 'engine.json' ? 'engine.json (format ids)' : "the presets' engine settings (a filter's kind, a paper's key)";
      const e = engineFindings.get(kind) ?? { files: new Set(), hashes: new Set(), n: 0 };
      e.files.add(f);
      for (const x of found) e.hashes.add(x.hash);
      e.n += found.length;
      engineFindings.set(kind, e);
    }
  }
  for (const f of ['src/ui/strings.ts', 'src/data/plugins.json', 'tools/plugins/film/manifest.json', 'tools/plugins/film/plugin.js', 'tools/plugins/build-film.mjs']) {
    for (const x of scanFileBytes(f, new Uint8Array(readFileSync(join(ROOT, f))), lists)) publicFindings.push(`${f} (line ${x.line}): ${x.what} [${x.hash}]`);
  }
  for (const [kind, e] of engineFindings) console.log(`  brand check: ${e.n} hit(s) in ${kind}, ${e.files.size} file(s), hashes ${[...e.hashes].join(' ')} — the checkout's own tags (its M38-07, M38-08), allowed`);
  if (publicFindings.length) {
    for (const f of publicFindings) console.error(`  ! ${f}`);
    fail(`the brand check found ${publicFindings.length} mark(s) in what the public sees`);
  }
  console.log('  brand check: no listed mark, product name or retired id in the manifest, the recipes, the glue, the logo, the licence or Repackshot\'s strings');

  const rpk = opt('rpk');
  if (!rpk) return;
  const keyOut = opt('key-out');
  const keyFile = opt('key-file');
  if (!!keyOut === !!keyFile) fail('--rpk needs exactly one of --key-out (a new key) and --key-file (a kept key)');
  if (keyOut && inside(keyOut, ROOT)) fail('--key-out may not be inside this repository: the activation key is never part of it');
  const key = keyFile ? parseKey(readFileSync(keyFile, 'utf8')) : newKeyBytes();
  const { bytes } = await packFolder(out, key);
  mkdirSync(dirname(resolve(rpk)), { recursive: true });
  writeFileSync(rpk, bytes);
  if (keyOut) {
    mkdirSync(dirname(resolve(keyOut)), { recursive: true });
    writeFileSync(keyOut, `${encodeKeyText(key)}\n`);
    chmodSync(keyOut, 0o600);
  }
  console.log(`build-film: aintfilm-film ${version} → ${rpk}`);
  console.log(`  bytes   ${bytes.length}`);
  console.log(`  sha256  ${sha256File(bytes)}`);
  if (keyOut) console.log(`  key     written to ${keyOut} (only there)`);
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));

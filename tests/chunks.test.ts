// Bundle hygiene (ARCHITECTURE §1, phase I3): the format libraries are loaded on
// demand, so none of them may end up in the chunk the page loads first. This
// reads dist/ after `npm run build` (skipped, with a message, when there is
// none) and looks for strings that only each importer carries.
//
// occt-import-js (LGPL-2.1, phase I2) has stricter conditions: it is never
// bundled at all, in no chunk, and ships unmodified next to the page with its
// licence texts and a README that links to its source.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIST = 'dist';
const hasDist = existsSync(`${DIST}/index.html`);
if (!hasDist) console.warn('chunks.test: dist/ is missing, so the bundle checks are skipped. Run `npm run build` first.');

/** What each library leaves in a minified chunk: its error messages and format keywords survive, class names do not. */
const FINGERPRINTS: Record<string, string[]> = {
  FBX: ['FBXLoader'],
  // The library's file name as the loader fetches it (the bare name is in the entry chunk since U6: Settings ▸
  // About names rhino3dm and links its licence).
  '3DM': ['rhino3dm.js', 'Rhino3dmLoader'],
  DAE: ['ColladaLoader'],
  PLY: ['binary_little_endian'],
  '3MF': ['3MFLoader'],
  USD: ['USDLoader'],
};
/** Names the task lists even when a minifier removes them: they must not be in the first chunk either. */
const NAMES = ['FBXLoader', 'rhino3dm.js', 'ColladaLoader', 'PLYLoader', '3MFLoader', 'USDZLoader', 'USDLoader', 'Rhino3dmLoader', 'PXR-USDC', 'binary_little_endian', 'ISO-10303-21', 'step-worker'];
/**
 * Strings of occt-import-js.js (the emscripten glue) that survive minification (property names and messages)
 * and that our own code never writes: if the glue were bundled, they would be in a chunk.
 */
const OCCT_GLUE = ['dynCall_iiiiiijj', 'both async and sync fetching of the wasm failed', 'occtimportjs'];
const OCCT_FILES = ['occt-import-js.js', 'occt-import-js.wasm', 'license.occt-import-js.txt', 'license.occt.txt', 'README.txt'];

/** Every file of dist/assets (JavaScript, CSS, anything) as text. */
function allAssets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(`${DIST}/assets`)) out[f] = new TextDecoder('latin1').decode(readFileSync(`${DIST}/assets/${f}`));
  return out;
}

function chunks(): { entry: string; lazy: Record<string, string> } {
  const html = readFileSync(`${DIST}/index.html`, 'utf8');
  const src = /<script[^>]*\ssrc="([^"]+\.js)"/.exec(html)?.[1];
  if (!src) throw new Error('dist/index.html has no module script');
  const entryFile = src.split('/').pop()!;
  const lazy: Record<string, string> = {};
  let entry = '';
  for (const f of readdirSync(`${DIST}/assets`)) {
    if (!f.endsWith('.js')) continue;
    const text = readFileSync(`${DIST}/assets/${f}`, 'utf8');
    if (f === entryFile) entry = text;
    else lazy[f] = text;
  }
  if (!entry) throw new Error(`entry chunk ${entryFile} not found in dist/assets`);
  return { entry, lazy };
}

describe.skipIf(!hasDist)('bundle: importers load on demand', () => {
  it('the first chunk carries no importer', () => {
    const { entry } = chunks();
    for (const name of NAMES) expect(entry.includes(name), `${name} is in the entry chunk`).toBe(false);
  });

  it('each importer is in a chunk of its own that the page can fetch later', () => {
    const { entry, lazy } = chunks();
    for (const [format, prints] of Object.entries(FINGERPRINTS)) {
      for (const print of prints) {
        const where = Object.entries(lazy).filter(([, text]) => text.includes(print)).map(([f]) => f);
        expect(where.length, `${format}: "${print}" is in no lazy chunk, so the check above proves nothing`).toBeGreaterThan(0);
        // The page may name the import module (it loads it with import()), never a reader.
        for (const f of where) if (!/^import-/.test(f)) expect(entry.includes(f), `${format}: the entry chunk names ${f}`).toBe(false);
      }
    }
  });

  it('the entry reaches the importers through the import module only', () => {
    const { entry, lazy } = chunks();
    const importer = Object.keys(lazy).find((f) => /^import-/.test(f));
    expect(importer, 'chunk of src/io/import.ts').toBeTruthy();
    expect(entry.includes(importer!)).toBe(true);
    // The import module in turn lists the readers as dynamic imports: their file names appear in it.
    const text = lazy[importer!];
    for (const reader of ['fbx', 'rhino', 'threemf', 'ply', 'collada', 'usd', 'gltf', 'obj', 'stl', 'step']) {
      expect(new RegExp(`${reader}-[\\w-]+\\.js`).test(text), `import chunk does not load ${reader}`).toBe(true);
    }
  });

  it('rhino3dm ships as files next to the page, not inside the bundle', () => {
    for (const f of ['rhino3dm.js', 'rhino3dm.wasm']) expect(existsSync(`${DIST}/vendor/rhino3dm/${f}`), f).toBe(true);
    const { lazy } = chunks();
    const reader = Object.entries(lazy).find(([f]) => /^rhino-/.test(f));
    expect(reader, 'chunk of src/io/rhino.ts').toBeTruthy();
    // The library alone is 127 kB of JavaScript: the reader chunk is the loader and ours, not the library.
    expect(reader![1].length).toBeLessThan(100_000);
  });

  it('occt-import-js ships unmodified next to the page, with its licence and a link to its source', () => {
    for (const f of OCCT_FILES) expect(existsSync(`${DIST}/vendor/occt-import-js/${f}`), f).toBe(true);
    // Byte for byte the package's files: nothing edits the library (LGPL-2.1 §6, a module that can be replaced).
    for (const f of ['occt-import-js.js', 'occt-import-js.wasm', 'license.occt-import-js.txt', 'license.occt.txt']) {
      const shipped = readFileSync(`${DIST}/vendor/occt-import-js/${f}`);
      const original = readFileSync(`node_modules/occt-import-js/dist/${f}`);
      expect(shipped.length === original.length && shipped.every((b, i) => b === original[i]), `${f} differs from the package`).toBe(true);
    }
    const licence = readFileSync(`${DIST}/vendor/occt-import-js/license.occt-import-js.txt`, 'utf8');
    expect(licence).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
    expect(licence).toContain('Version 2.1, February 1999');
    // The full text, not a notice: it ends with "How to Apply These Terms to Your New Libraries".
    expect(licence).toContain('How to Apply These Terms to Your New Libraries');
    expect(readFileSync(`${DIST}/vendor/occt-import-js/license.occt.txt`, 'utf8')).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
    const readme = readFileSync(`${DIST}/vendor/occt-import-js/README.txt`, 'utf8');
    const version = JSON.parse(readFileSync('node_modules/occt-import-js/package.json', 'utf8')).version as string;
    expect(version).toBe('0.0.23');
    for (const text of [`occt-import-js ${version}`, 'LGPL-2.1', 'https://github.com/kovacsv/occt-import-js', 'https://git.dev.opencascade.org/repos/occt.git']) expect(readme).toContain(text);
  });

  it('occt-import-js is in no chunk: the worker fetches it by URL', () => {
    // The fingerprints are really in the glue, so not finding them below means something.
    const glue = readFileSync(`${DIST}/vendor/occt-import-js/occt-import-js.js`, 'utf8');
    for (const print of OCCT_GLUE) expect(glue.includes(print), `"${print}" is not in occt-import-js.js`).toBe(true);
    const assets = allAssets();
    for (const [f, text] of Object.entries(assets)) for (const print of OCCT_GLUE) expect(text.includes(print), `${f} carries "${print}" of occt-import-js.js`).toBe(false);
    // Neither is the wasm: no asset is anywhere near its size, and none starts with the wasm magic.
    const wasmSize = readFileSync(`${DIST}/vendor/occt-import-js/occt-import-js.wasm`).length;
    for (const f of readdirSync(`${DIST}/assets`)) {
      const bytes = readFileSync(`${DIST}/assets/${f}`);
      expect(bytes.length < wasmSize / 4, `${f} is ${bytes.length} bytes`).toBe(true);
      expect(bytes[0] === 0 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d, `${f} is wasm`).toBe(false);
    }
    // The worker is a small chunk of its own that names the library's files to fetch them.
    const worker = Object.entries(assets).find(([f]) => /^step-worker-[\w-]+\.js$/.test(f));
    expect(worker, 'chunk of src/io/step-worker.ts').toBeTruthy();
    expect(worker![1]).toContain('occt-import-js.wasm');
    expect(worker![1]).toContain('occt-import-js.js');
    expect(worker![1].length).toBeLessThan(10_000);
  });

  it('the STEP reader and its worker are reached only through the import module', () => {
    const { entry, lazy } = chunks();
    const reader = Object.keys(lazy).find((f) => /^step-(?!worker)[\w-]+\.js$/.test(f));
    expect(reader, 'chunk of src/io/step.ts').toBeTruthy();
    expect(entry.includes(reader!)).toBe(false);
    expect(entry).not.toMatch(/step-worker-[\w-]+\.js/);
    // The reader names its worker; the import module names the reader.
    expect(lazy[reader!]).toMatch(/step-worker-[\w-]+\.js/);
    expect(lazy[Object.keys(lazy).find((f) => /^import-/.test(f))!]).toContain(reader!);
  });
});

// Bundle hygiene (ARCHITECTURE §1, phase I3): the format libraries are loaded on
// demand, so none of them may end up in the chunk the page loads first. This
// reads dist/ after `npm run build` (skipped, with a message, when there is
// none) and looks for strings that only each importer carries.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIST = 'dist';
const hasDist = existsSync(`${DIST}/index.html`);
if (!hasDist) console.warn('chunks.test: dist/ is missing, so the bundle checks are skipped. Run `npm run build` first.');

/** What each library leaves in a minified chunk: its error messages and format keywords survive, class names do not. */
const FINGERPRINTS: Record<string, string[]> = {
  FBX: ['FBXLoader'],
  '3DM': ['rhino3dm', 'Rhino3dmLoader'],
  DAE: ['ColladaLoader'],
  PLY: ['binary_little_endian'],
  '3MF': ['3MFLoader'],
  USD: ['USDLoader'],
};
/** Names the task lists even when a minifier removes them: they must not be in the first chunk either. */
const NAMES = ['FBXLoader', 'rhino3dm', 'ColladaLoader', 'PLYLoader', '3MFLoader', 'USDZLoader', 'USDLoader', 'Rhino3dmLoader', 'PXR-USDC', 'binary_little_endian'];

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
    for (const reader of ['fbx', 'rhino', 'threemf', 'ply', 'collada', 'usd', 'gltf', 'obj', 'stl']) {
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
});

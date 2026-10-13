#!/usr/bin/env node
// Copies the files of third-party libraries that are fetched at run time
// (not bundled) from node_modules to public/vendor/, so `vite dev` serves them
// and `vite build` ships them in dist/. Run by the `predev` and `prebuild`
// scripts; the output is generated and git-ignored.
//
// rhino3dm (openNURBS compiled to WebAssembly, MIT): three's Rhino3dmLoader
// fetches rhino3dm.js and rhino3dm.wasm from its library path and runs them in
// a worker, only when a .3dm file is imported (src/io/rhino.ts).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARIES = [{ name: 'rhino3dm', files: ['rhino3dm.js', 'rhino3dm.wasm'] }];

for (const lib of LIBRARIES) {
  const from = join(ROOT, 'node_modules', lib.name);
  if (!existsSync(join(from, 'package.json'))) {
    console.error(`vendor: ${lib.name} is not installed (run npm ci)`);
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'));
  const to = join(ROOT, 'public', 'vendor', lib.name);
  mkdirSync(to, { recursive: true });
  for (const file of lib.files) copyFileSync(join(from, file), join(to, file));
  writeFileSync(
    join(to, 'README.txt'),
    `${meta.name} ${meta.version}, ${meta.license} licence, ${meta.author}.\n${meta.homepage ?? ''}\nCopied from node_modules by tools/vendor.mjs; loaded on demand by src/io/rhino.ts.\n`,
  );
  console.log(`vendor: ${lib.name} ${meta.version} -> public/vendor/${lib.name}`);
}

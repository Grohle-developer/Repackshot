#!/usr/bin/env node
// Copies the files of third-party libraries that are fetched at run time
// (not bundled) from node_modules to public/vendor/, so `vite dev` serves them
// and `vite build` ships them in dist/. Run by the `predev` and `prebuild`
// scripts; the output is generated and git-ignored. Files are copied byte for
// byte: nothing here edits a library.
//
// rhino3dm (openNURBS compiled to WebAssembly, MIT): three's Rhino3dmLoader
// fetches rhino3dm.js and rhino3dm.wasm from its library path and runs them in
// a worker, only when a .3dm file is imported (src/io/rhino.ts).
//
// occt-import-js (OpenCascade compiled to WebAssembly, LGPL-2.1; the one LGPL
// exception of ARCHITECTURE §1): src/io/step-worker.ts fetches
// occt-import-js.js and occt-import-js.wasm from public/vendor/occt-import-js/,
// only when a STEP or IGES file is imported. The LGPL-2.1 texts the package
// ships (its own and OpenCascade's) and a README with the versions and the
// links to the source code go next to them, so the library stays a separate
// module anyone can replace with their own build of the same files.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const OCCT_README = (meta) => `occt-import-js ${meta.version}
${'='.repeat(`occt-import-js ${meta.version}`.length)}

What: the STEP and IGES reader of Repackshot. OpenCascade (Open CASCADE
Technology) compiled to WebAssembly with an emscripten interface, by Viktor
Kovacs. Repackshot loads it from this folder in a web worker, only when a
STEP (.step, .stp) or IGES (.iges, .igs) file is imported.

Licence: GNU Lesser General Public License, version 2.1 (LGPL-2.1), for the
whole package. The full texts are next to this file:
  license.occt-import-js.txt  occt-import-js (LGPL-2.1)
  license.occt.txt            Open CASCADE Technology (LGPL-2.1)

Source code:
  occt-import-js   https://github.com/kovacsv/occt-import-js
                   (npm: occt-import-js@${meta.version})
  OpenCascade      https://git.dev.opencascade.org/repos/occt.git
                   (the submodule the package is built from; mirror:
                   https://github.com/Open-Cascade-SAS/OCCT)

These files are the package's dist/ files, copied unmodified from
node_modules by tools/vendor.mjs. Repackshot does not bundle or change them:
it fetches occt-import-js.js and occt-import-js.wasm from this folder at run
time, so they can be replaced with another build of the same library
(LGPL-2.1, section 6). Repackshot itself is under the PolyForm Noncommercial
1.0.0 licence; the LGPL applies to these files only.
`;

const LIBRARIES = [
  {
    name: 'rhino3dm',
    files: ['rhino3dm.js', 'rhino3dm.wasm'],
    readme: (meta) => `${meta.name} ${meta.version}, ${meta.license} licence, ${meta.author}.\n${meta.homepage ?? ''}\nCopied from node_modules by tools/vendor.mjs; loaded on demand by src/io/rhino.ts.\n`,
  },
  {
    name: 'occt-import-js',
    from: 'dist',
    files: ['occt-import-js.js', 'occt-import-js.wasm', 'license.occt-import-js.txt', 'license.occt.txt'],
    readme: OCCT_README,
  },
];

for (const lib of LIBRARIES) {
  const pkg = join(ROOT, 'node_modules', lib.name);
  if (!existsSync(join(pkg, 'package.json'))) {
    console.error(`vendor: ${lib.name} is not installed (run npm ci)`);
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  const from = lib.from ? join(pkg, lib.from) : pkg;
  const to = join(ROOT, 'public', 'vendor', lib.name);
  mkdirSync(to, { recursive: true });
  for (const file of lib.files) {
    if (!existsSync(join(from, file))) {
      console.error(`vendor: ${lib.name} ${meta.version} has no ${file}`);
      process.exit(1);
    }
    copyFileSync(join(from, file), join(to, file));
  }
  writeFileSync(join(to, 'README.txt'), lib.readme(meta));
  console.log(`vendor: ${lib.name} ${meta.version} -> public/vendor/${lib.name}`);
}

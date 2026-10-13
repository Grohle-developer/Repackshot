#!/usr/bin/env node
// Copies the licence texts Settings ▸ About and the AI model licences show
// (phase U6) to public/licences/, so `vite dev` serves them and `vite build`
// ships them in dist/. Run with tools/vendor.mjs by the `vendor` script; the
// output is generated and git-ignored. Every text is copied byte for byte from
// a file: none is written by hand.
//
//   LICENSE.txt                 Repackshot (PolyForm Noncommercial 1.0.0), ../LICENSE
//   three.LICENSE.txt           three.js (MIT), node_modules/three/LICENSE
//   rhino3dm.LICENSE.txt        rhino3dm (MIT). The npm package ships no licence file: the text is the
//                               repository's LICENSE at the tag of the installed version, kept in
//                               tools/third-party/ (fetched 2026-10-13 from
//                               https://raw.githubusercontent.com/mcneel/rhino3dm/8.35.0/LICENSE)
//   Apache-2.0.txt              Apache License 2.0, the licence of Z-Image-Turbo, FLUX.2 [klein] 4B and
//                               Qwen-Image-Edit (src/data/ai-models.json); tools/third-party/, fetched
//                               2026-10-13 from https://raw.githubusercontent.com/Tongyi-MAI/Z-Image/main/LICENSE
//   CreativeML-OpenRAIL-M.txt   CreativeML Open RAIL-M (Stable Diffusion 1.5), with its use restrictions
//                               (Attachment A, shown in full before the download); tools/third-party/,
//                               fetched 2026-10-13 from
//                               https://huggingface.co/spaces/CompVis/stable-diffusion-license/raw/main/license.txt
//   stable-diffusion.cpp.LICENSE.txt  stable-diffusion.cpp (MIT), the desktop's AI runtime (src/data/ai-runtimes.json):
//                               tools/third-party/, fetched 2026-10-13 from https://raw.githubusercontent.com/
//                               leejet/stable-diffusion.cpp/d637cfb935feb2254898a8f1524046c958f3df80/LICENSE (the
//                               pinned release's commit; the same text as stable-diffusion.cpp.txt in its zips)
//   ggml.LICENSE.txt            ggml (MIT), built into it: tools/third-party/, fetched 2026-10-13 from
//                               https://raw.githubusercontent.com/leejet/ggml/d25b121ce1d6ae0c7e62ad080460d9fc1e46dd93/LICENSE
//                               (the submodule's commit; the same text as ggml.txt in the zips)
//
// occt-import-js's two LGPL-2.1 texts are copied by tools/vendor.mjs to public/vendor/occt-import-js/.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'licences');
const RHINO_TAG = '8.35.0';

const rhino = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'rhino3dm', 'package.json'), 'utf8'));
if (rhino.version !== RHINO_TAG) {
  console.error(`licences: rhino3dm is ${rhino.version}, the kept licence is of ${RHINO_TAG}: fetch the LICENSE of the new tag into tools/third-party/`);
  process.exit(1);
}

const FILES = [
  ['LICENSE', 'LICENSE.txt'],
  ['node_modules/three/LICENSE', 'three.LICENSE.txt'],
  [`tools/third-party/rhino3dm-${RHINO_TAG}.LICENSE`, 'rhino3dm.LICENSE.txt'],
  ['tools/third-party/Apache-2.0.txt', 'Apache-2.0.txt'],
  ['tools/third-party/CreativeML-OpenRAIL-M.txt', 'CreativeML-OpenRAIL-M.txt'],
  ['tools/third-party/stable-diffusion.cpp-d637cfb.LICENSE', 'stable-diffusion.cpp.LICENSE.txt'],
  ['tools/third-party/ggml-d25b121.LICENSE', 'ggml.LICENSE.txt'],
];

mkdirSync(OUT, { recursive: true });
for (const [from, to] of FILES) {
  const src = join(ROOT, from);
  if (!existsSync(src)) {
    console.error(`licences: ${from} is missing`);
    process.exit(1);
  }
  copyFileSync(src, join(OUT, to));
}
console.log(`licences: ${FILES.length} texts -> public/licences`);

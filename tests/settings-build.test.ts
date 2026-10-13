// The build of phase U6 (read after `npm run build`; skipped without dist/): the licence texts ship next to the
// page (tools/licences.mjs), the model store runs in its own worker on OPFS, and the test-only catalogue
// override of the browser check (`?testModels=`, read only by `vite build --mode model-test`) is not in a
// production build at all.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIST = 'dist';
const hasDist = existsSync(`${DIST}/index.html`);

describe.skipIf(!hasDist)('build: settings and models', () => {
  const assets = hasDist ? readdirSync(`${DIST}/assets`) : [];
  const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(`${DIST}/assets/${f}`, 'utf8'));

  it('the test-only model catalogue override is not in a production build', () => {
    for (const text of js) expect(text.includes('testModels')).toBe(false);
  });

  it('the licence texts are shipped, whole', () => {
    for (const [file, marker] of [
      ['LICENSE.txt', 'PolyForm Noncommercial'],
      ['three.LICENSE.txt', 'three.js authors'],
      ['rhino3dm.LICENSE.txt', 'Robert McNeel'],
      ['Apache-2.0.txt', 'Apache License'],
      ['CreativeML-OpenRAIL-M.txt', 'Attachment A'],
      // X3c: the desktop's AI runtime and its tensor library, as their pinned commits have them.
      ['stable-diffusion.cpp.LICENSE.txt', 'Copyright (c) 2023 leejet'],
      ['ggml.LICENSE.txt', 'Copyright (c) 2023-2026 The ggml authors'],
    ]) {
      expect(existsSync(`${DIST}/licences/${file}`), file).toBe(true);
      expect(readFileSync(`${DIST}/licences/${file}`, 'utf8')).toContain(marker);
    }
    expect(existsSync(`${DIST}/vendor/occt-import-js/license.occt.txt`)).toBe(true);
  });

  it('the model store is a worker of its own, with sync access handles', () => {
    const worker = assets.find((f) => f.startsWith('model-worker') && f.endsWith('.js'));
    expect(worker).toBeTruthy();
    expect(readFileSync(`${DIST}/assets/${worker}`, 'utf8')).toContain('createSyncAccessHandle');
  });
});

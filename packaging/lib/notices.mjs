// THIRD-PARTY-NOTICES.txt: the licences of what the packages contain besides
// Repackshot's own code: the runtime npm dependencies bundled into app/ (from
// package-lock.json and their licence files), the libraries copied to
// public/vendor/ (their README.txt and licence files), and the third-party
// data compiled into the engine (the Sobol direction numbers, whose notice
// engine/README.md reproduces).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LICENCE_FILES = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i;

/** The MIT terms, for a package that declares MIT but ships no licence file. */
const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`;

function licenceTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LICENCE_FILES.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8').trim());
}

const rule = (title) => `${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n`;

export function thirdPartyNotices(root, version) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const runtime = Object.entries(lock.packages)
    .filter(([path, p]) => path.startsWith('node_modules/') && !p.dev)
    .map(([path]) => path)
    .sort();
  const out = [
    `Repackshot ${version}: third-party notices\n`,
    'Repackshot itself is under the PolyForm Noncommercial License 1.0.0 (LICENSE).',
    'The packages also contain the following, under their own licences.\n',
  ];
  for (const path of runtime) {
    const meta = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8'));
    const author = typeof meta.author === 'string' ? meta.author : (meta.author?.name ?? '');
    const home = meta.homepage ?? meta.repository?.url ?? '';
    out.push(rule(`${meta.name} ${meta.version} (${meta.license}), in app/`));
    out.push(`${home}\n`);
    const texts = licenceTexts(join(root, path));
    if (texts.length) out.push(...texts.map((t) => `${t}\n`));
    else if (meta.license === 'MIT') out.push(`The npm package declares the MIT licence and ships no licence file.\nCopyright (c) ${author}\n\n${MIT_TERMS}\n`);
    else throw new Error(`${meta.name}: no licence text found for ${meta.license}`);
  }
  const vendor = join(root, 'public', 'vendor');
  if (existsSync(vendor)) {
    for (const lib of readdirSync(vendor).sort()) {
      const dir = join(vendor, lib);
      const readme = join(dir, 'README.txt');
      out.push(rule(`app/vendor/${lib}/ (loaded on demand)`));
      if (existsSync(readme)) out.push(`${readFileSync(readme, 'utf8').trim()}\n`);
      for (const t of licenceTexts(dir)) out.push(`${t}\n`);
    }
  }
  const engine = readFileSync(join(root, 'engine', 'README.md'), 'utf8');
  const sobol = /```text\n(Copyright \(c\) 2008, Frances Y\. Kuo and Stephen Joe[\s\S]*?)```/.exec(engine);
  if (!sobol) throw new Error('engine/README.md: the Sobol notice is missing');
  out.push(rule('Sobol direction numbers new-joe-kuo-6.21201 (compiled into the render engine)'));
  out.push('S. Joe and F. Y. Kuo, https://web.maths.unsw.edu.au/~fkuo/sobol/\n');
  out.push(`${sobol[1].trim()}\n`);
  return `${out.join('\n')}`.replace(/\r?\n/g, '\r\n');
}

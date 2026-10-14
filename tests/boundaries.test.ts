// The dependency rule (ARCHITECTURE §2, CLAUDE.md rule 6): ui → core, render → core, io → core, core → data,
// and nothing the other way. Walks the imports of every file under src/ and fails on a layer that reaches
// into one it may not know. src/main.ts, the one file at the root, is the composition root: it wires
// io and render into the interface through `ui/ports.ts`, so it may import from everywhere.

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = 'src';

/** What each layer may import (besides itself). A layer that is not here is a new layer: decide its place first. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  data: [],
  core: ['data'],
  io: ['core', 'data'],
  render: ['core', 'data'],
  ai: ['core', 'data'],
  // P6: the plugin host (install, store, workers) is wired into the interface through ui/ports.ts, like io.
  plugins: ['core', 'data'],
  ui: ['core', 'data'],
};

/** Layers whose code is plain TypeScript: no package may be imported (no three.js, no DOM-bound libraries). */
const NO_PACKAGES: readonly string[] = ['data', 'core'];

/**
 * Violations that exist today and are accepted on purpose, one entry each with the reason. The test fails
 * when an entry no longer applies, so the list only ever shrinks. (There are none: the rule held when this
 * test was written.)
 */
const ACCEPTED: readonly { file: string; to: string; why: string }[] = [];

interface Edge {
  /** Path of the importing file, relative to src/ ('ui/commands.ts'). */
  file: string;
  /** What it imports, as written. */
  spec: string;
  /** The layer of the importing file: its first folder, or '' for a file at the root. */
  from: string;
  /** The layer of the imported file, or null for a package. */
  to: string | null;
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    // A folder has no extension and no way to tell it from a file without `stat`: listing it either works or throws.
    try {
      return walk(path);
    } catch {
      return path.endsWith('.ts') ? [path] : [];
    }
  });

/** Comments out of the way, so an import in a comment is not an import. */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** The specifiers a source file imports or loads: `import … from`, `export … from`, `import 'x'`, `import('x')`, `new URL('x', import.meta.url)`. */
function specifiers(source: string): string[] {
  const text = withoutComments(source);
  const out: string[] = [];
  for (const re of [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    // Not the word in a string ('import' is also a Settings section): a side-effect import is not quoted itself.
    /(?<!['"`\w.$])import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g,
  ]) {
    for (const m of text.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/** The layer a path under src/ belongs to. */
const layerOf = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '');

/** Resolves a relative specifier against the importing file (both relative to src/); null for a package. */
function resolveTarget(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const parts = file.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function edges(files: Record<string, string>): Edge[] {
  return Object.entries(files).flatMap(([file, source]) =>
    specifiers(source).map((spec) => {
      const target = resolveTarget(file, spec);
      return { file, spec, from: layerOf(file), to: target === null ? null : layerOf(target) };
    }),
  );
}

interface Violation {
  file: string;
  /** The layer reached ('package' for a package). */
  to: string;
  message: string;
}

/** The rule: every edge that is not allowed. */
function violations(all: readonly Edge[]): Violation[] {
  const out: Violation[] = [];
  for (const e of all) {
    // The composition root wires everything.
    if (e.from === '') continue;
    if (!(e.from in ALLOWED)) {
      out.push({ file: e.file, to: e.from, message: `${e.file}: src/${e.from}/ is a layer the rule does not know; add it to ALLOWED in tests/boundaries.test.ts` });
    } else if (e.to === null) {
      if (NO_PACKAGES.includes(e.from)) out.push({ file: e.file, to: 'package', message: `${e.file} imports the package "${e.spec}", but ${e.from} is plain TypeScript` });
    } else if (e.to === '') {
      out.push({ file: e.file, to: '', message: `${e.file} imports "${e.spec}" from the root of src/: nothing imports main.ts` });
    } else if (e.to !== e.from && !(ALLOWED[e.from] ?? []).includes(e.to)) {
      out.push({ file: e.file, to: e.to, message: `${e.file} (${e.from}) imports ${e.to} through "${e.spec}"; ${e.from} may import only ${ALLOWED[e.from].join(', ') || 'itself'}` });
    }
  }
  return out;
}

function sources(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of walk(SRC)) out[path.slice(SRC.length + 1)] = readFileSync(path, 'utf8');
  return out;
}

describe('the dependency rule', () => {
  const files = sources();
  const all = edges(files);

  it('sees the whole tree (the scan itself is not empty or blind)', () => {
    expect(Object.keys(files).length).toBeGreaterThan(80);
    expect(Object.keys(files)).toContain('main.ts');
    const pairs = new Set(all.filter((e) => e.to !== null).map((e) => `${e.from || 'main'}->${e.to}`));
    // The edges that must exist: if one of these is not found, the scan is not reading imports.
    for (const p of ['ui->core', 'ui->data', 'io->core', 'render->core', 'core->data', 'main->ui', 'main->io', 'main->render', 'main->core']) expect(pairs, p).toContain(p);
    // Every layer on disk is known to the rule.
    for (const layer of new Set(Object.keys(files).map(layerOf))) if (layer !== '') expect(Object.keys(ALLOWED), `src/${layer}/`).toContain(layer);
  });

  it('holds: core, data, io, render and ui import only what they may', () => {
    const found = violations(all);
    const accepted = (v: Violation) => ACCEPTED.some((a) => a.file === v.file && a.to === v.to);
    const unexpected = found.filter((v) => !accepted(v)).map((v) => v.message);
    expect(unexpected, unexpected.join('\n')).toEqual([]);
    // An accepted violation that is gone must leave the list.
    for (const a of ACCEPTED) expect(found.some((v) => v.file === a.file && v.to === a.to), `${a.file} -> ${a.to} no longer happens: remove it from ACCEPTED`).toBe(true);
  });

  it('core never imports ui, render or io; ui never imports render or io; data imports nothing', () => {
    const bad = (from: string, to: string[]) => all.filter((e) => e.from === from && e.to !== null && to.includes(e.to)).map((e) => `${e.file} -> ${e.spec}`);
    expect(bad('core', ['ui', 'render', 'io', 'ai']), 'core').toEqual([]);
    expect(bad('ui', ['render', 'io']), 'ui').toEqual([]);
    expect(bad('render', ['ui', 'io']), 'render').toEqual([]);
    expect(bad('io', ['ui', 'render']), 'io').toEqual([]);
    const fromData = all.filter((e) => e.from === 'data' && (e.to === null || e.to !== 'data')).map((e) => `${e.file} -> ${e.spec}`);
    expect(fromData, 'data').toEqual([]);
  });

  it('main.ts is the one composition root: nothing else at the root of src/', () => {
    expect(Object.keys(files).filter((f) => !f.includes('/'))).toEqual(['main.ts']);
  });
});

describe('the rule itself catches what it is for', () => {
  const bad = (file: string, source: string): Violation[] => violations(edges({ [file]: source }));

  it('reads every way of importing', () => {
    const src = [
      "import { a } from '../io/x';",
      "import type { B } from '../render/y';",
      "export { c } from '../ui/z';",
      "export * from '../io/w';",
      "import '../render/side';",
      "const m = await import('../io/lazy');",
      "const w = new Worker(new URL('../render/worker.ts', import.meta.url));",
      'import {\n  one,\n  two,\n} from "../io/multi";',
    ].join('\n');
    expect(specifiers(src)).toEqual(['../io/x', '../render/y', '../ui/z', '../io/w', '../io/multi', '../render/side', '../io/lazy', '../render/worker.ts']);
    expect(bad('core/a.ts', src)).toHaveLength(8);
  });

  it('ignores imports that are only text', () => {
    expect(specifiers("// import { a } from '../io/x';\n/* import b from '../ui/y' */\nconst s = 1; // from '../render/z'")).toEqual([]);
    expect(bad('core/a.ts', "/* import b from '../ui/y'; */\nimport { c } from './d';")).toEqual([]);
    // The word in strings: a Settings row in section 'import', block 'import'.
    expect(specifiers("setting('import.units', 'import', 'import', choice(['MM']));")).toEqual([]);
  });

  it('core may not import ui, render or io', () => {
    for (const layer of ['ui', 'render', 'io']) expect(bad('core/a.ts', `import { x } from '../${layer}/x';`), layer).toHaveLength(1);
    expect(bad('core/sub/a.ts', "import { x } from '../../io/x';")).toHaveLength(1);
    expect(bad('core/a.ts', "import { x } from '../data/x'; import { y } from './y';")).toEqual([]);
  });

  it('ui may not import render or io, and reaches them only through main.ts', () => {
    expect(bad('ui/a.ts', "import { x } from '../render/x';")).toHaveLength(1);
    expect(bad('ui/panels/a.ts', "import { x } from '../../io/x';")).toHaveLength(1);
    expect(bad('ui/a.ts', "import { x } from '../core/x'; import { y } from '../data/y'; import { z } from './panels/z';")).toEqual([]);
    expect(bad('main.ts', "import { x } from './io/x'; import { y } from './render/y'; import { z } from './ui/z';")).toEqual([]);
  });

  it('data imports nothing from the rest', () => {
    expect(bad('data/a.ts', "import { x } from '../core/x';")).toHaveLength(1);
    expect(bad('data/a.ts', "import { x } from './types';")).toEqual([]);
  });

  it('io and render are siblings that do not know each other, and neither knows ui', () => {
    expect(bad('io/a.ts', "import { x } from '../render/x';")).toHaveLength(1);
    expect(bad('render/a.ts', "import { x } from '../io/x';")).toHaveLength(1);
    expect(bad('io/a.ts', "import { x } from '../ui/x';")).toHaveLength(1);
    expect(bad('render/a.ts', "import { x } from '../ui/x'; import * as THREE from 'three';")).toHaveLength(1);
  });

  it('core and data are plain TypeScript: no packages', () => {
    expect(bad('core/a.ts', "import * as THREE from 'three';")).toHaveLength(1);
    expect(bad('data/a.ts', "import x from 'rhino3dm';")).toHaveLength(1);
    expect(bad('io/a.ts', "import * as THREE from 'three';")).toEqual([]);
  });

  it('a folder the rule does not know is an error until someone decides what it may import', () => {
    expect(bad('newlayer/a.ts', "import { x } from '../core/x';")).toHaveLength(1);
  });
});

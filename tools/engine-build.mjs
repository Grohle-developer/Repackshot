#!/usr/bin/env node
// `npm run engine:build`: the engine for the browser, twice (phase E4).
//
//   public/engine/rt.wasm       scalar build, runs everywhere
//   public/engine/rt-simd.wasm  built with -C target-feature=+simd128, for browsers that
//                               validate simd128 (src/render/pathtracer.ts picks it)
//
// The simd128 build goes to its own target directory (engine/target/simd128), so the two never
// overwrite each other's artefacts or invalidate each other's cache. public/engine/ is ignored by
// git: the interface starts without it and says so in the header.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'engine', 'Cargo.toml');
const OUT = join(ROOT, 'public', 'engine');
const TARGET = 'wasm32-unknown-unknown';

function build(targetDir, extraRustflags) {
  const env = { ...process.env };
  if (extraRustflags) env.RUSTFLAGS = [process.env.RUSTFLAGS, extraRustflags].filter(Boolean).join(' ');
  const args = ['build', '--manifest-path', MANIFEST, '-p', 'rt-wasm', '--target', TARGET, '--release'];
  if (targetDir) args.push('--target-dir', targetDir);
  const run = spawnSync('cargo', args, { stdio: 'inherit', env });
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);
  return join(targetDir ?? join(ROOT, 'engine', 'target'), TARGET, 'release', 'rt_wasm.wasm');
}

mkdirSync(OUT, { recursive: true });
const scalar = build(null, null);
copyFileSync(scalar, join(OUT, 'rt.wasm'));
const simd = build(join(ROOT, 'engine', 'target', 'simd128'), '-C target-feature=+simd128');
copyFileSync(simd, join(OUT, 'rt-simd.wasm'));
for (const name of ['rt.wasm', 'rt-simd.wasm']) {
  console.log(`public/engine/${name}  ${(statSync(join(OUT, name)).size / 1024).toFixed(0)} KB`);
}

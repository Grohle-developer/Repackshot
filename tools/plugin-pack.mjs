#!/usr/bin/env node
// Packs a plugin folder into an encrypted Repackshot plugin, `.rpk` (ARCHITECTURE.md §9, ROADMAP P6).
//
//   node tools/plugin-pack.mjs <folder> <out.rpk> --new-key         a new activation key, printed to stdout only
//   node tools/plugin-pack.mjs <folder> <out.rpk> --key <base64>    an existing key (an update keeps its key)
//   node tools/plugin-pack.mjs <folder> <out.rpk> --key-file <path> the key read from a file
//
// The folder holds `manifest.json` (checked by core/plugins.ts: abi, id, version, controls…) and every file it
// names; every file under the folder goes in, sorted by name, hidden ones (a leading dot) left out. The key is never
// written by this tool: with --new-key it is printed once, and whoever runs it keeps it (it goes to the person who
// installs the plugin, or behind the registry's `keyUrl`). Prints the package's size and SHA-256 (what the registry
// entry pins) and the header's SHA-256 of the ciphertext.
//
// Needs Node 22.18 or later (it reads src/plugins/rpk.ts and src/core/plugins.ts with Node's type stripping).

import { createHash, webcrypto } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeKeyText, packRpk, parseKey, newKeyBytes, readRpk } from './plugin-rpk.mjs';
import { parseManifest } from '../src/core/plugins.ts';

/** Every file under `dir`, relative, `/`-separated, sorted; hidden files and folders left out. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith('.')) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The folder as a package under `key` (bytes): the manifest is checked first, and every file it names (its entry,
 * its module, its logo, its licence, `files`) must be in the folder.
 */
export async function packFolder(folder, key) {
  const names = listFiles(folder);
  if (!names.includes('manifest.json')) throw new Error(`${folder}: no manifest.json`);
  const raw = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  const parsed = parseManifest(raw);
  if (!parsed.ok) throw new Error(`manifest.json is not valid: ${parsed.problems.join(', ')}`);
  const m = parsed.manifest;
  const needed = [m.entry, m.logo, ...(m.wasm ? [m.wasm.file] : []), ...(m.licence.file ? [m.licence.file] : []), ...(m.notices ? [m.notices] : []), ...m.files];
  const missing = needed.filter((n) => !names.includes(n));
  if (missing.length) throw new Error(`the manifest names files the folder does not have: ${missing.join(', ')}`);
  const files = names.map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(folder, name))) }));
  const bytes = await packRpk({ id: m.id, version: m.version, abi: m.abi }, files, key, { subtle: webcrypto.subtle });
  return { bytes, manifest: m, files: names };
}

export const sha256File = (bytes) => createHash('sha256').update(bytes).digest('hex');

function arg(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : null;
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--key', '--key-file'].includes(args[i - 1])));
  const [folder, out] = positional;
  const keyText = arg(args, 'key');
  const keyFile = arg(args, 'key-file');
  const fresh = args.includes('--new-key');
  if (!folder || !out || [keyText !== null, keyFile !== null, fresh].filter(Boolean).length !== 1) {
    console.error('usage: node tools/plugin-pack.mjs <folder> <out.rpk> (--new-key | --key <base64> | --key-file <path>)');
    process.exit(2);
  }
  const key = fresh ? newKeyBytes() : parseKey(keyText ?? readFileSync(keyFile, 'utf8'));
  const { bytes, manifest, files } = await packFolder(resolve(folder), key);
  writeFileSync(out, bytes);
  const { header } = readRpk(bytes);
  console.log(`plugin-pack: ${manifest.id} ${manifest.version} (abi ${manifest.abi}), ${files.length} files → ${out}`);
  console.log(`  bytes   ${bytes.length}`);
  console.log(`  sha256  ${sha256File(bytes)}  (the file: the registry entry's sha256)`);
  console.log(`  cipher  ${header.sha256}  (the header's sha256 of the ciphertext)`);
  if (fresh) console.log(`  key     ${encodeKeyText(key)}  (the activation key: it is not written anywhere; keep it)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`plugin-pack: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

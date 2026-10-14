#!/usr/bin/env node
// Opens a Repackshot plugin, `.rpk`, into a folder, for tests and for checking a package before it is published:
//
//   node tools/plugin-unpack.mjs <in.rpk> <out-folder> (--key <base64> | --key-file <path>)
//   node tools/plugin-unpack.mjs <in.rpk> --header        the clear header only, verified (length and SHA-256)
//
// The header and the SHA-256 of the ciphertext are checked before anything is decrypted; a wrong key or an altered
// package fails with the cipher's tag and writes nothing.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKey, unpackRpk, verifyRpk } from './plugin-rpk.mjs';

/** The files of a package, decrypted in memory. */
export async function unpackFile(path, keyText) {
  return unpackRpk(new Uint8Array(readFileSync(path)), parseKey(keyText));
}

async function main() {
  const args = process.argv.slice(2);
  const at = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? (args[i + 1] ?? '') : null;
  };
  const input = args[0];
  if (!input) {
    console.error('usage: node tools/plugin-unpack.mjs <in.rpk> <out-folder> (--key <base64> | --key-file <path>) | --header');
    process.exit(2);
  }
  if (args.includes('--header')) {
    console.log(JSON.stringify(await verifyRpk(new Uint8Array(readFileSync(input))), null, 2));
    return;
  }
  const out = args[1];
  const keyText = at('key') ?? (at('key-file') !== null ? readFileSync(at('key-file'), 'utf8') : null);
  if (!out || out.startsWith('--') || keyText === null) {
    console.error('usage: node tools/plugin-unpack.mjs <in.rpk> <out-folder> (--key <base64> | --key-file <path>)');
    process.exit(2);
  }
  const { header, files } = await unpackFile(input, keyText);
  for (const f of files) {
    const path = join(out, ...f.name.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.bytes);
  }
  console.log(`plugin-unpack: ${header.id} ${header.version}, ${files.length} files → ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`plugin-unpack: ${err?.code ? `${err.code}: ` : ''}${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

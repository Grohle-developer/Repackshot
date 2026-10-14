// Plugin packages for the tests (phase P6): the invert fixture packed under a key, with its manifest changed when a
// test needs another one, and a fetch that answers from a table.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { newKeyBytes, packRpk, toBase64, type RpkFile } from '../src/plugins/rpk';
import type { PluginRegistryEntry } from '../src/data/plugins';

export const INVERT_DIR = 'tests/fixtures/plugins/invert';

/** The files of a fixture folder (one level: the fixtures have no sub-folders). */
export function fixtureFiles(dir = INVERT_DIR): RpkFile[] {
  return readdirSync(dir)
    .sort()
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
}

/** The invert plugin as a package: its manifest patched, files added or replaced. */
export async function packInvert(opts: { key?: Uint8Array; manifest?: Record<string, unknown>; files?: RpkFile[]; header?: { id?: string; version?: string } } = {}): Promise<{ bytes: Uint8Array; key: Uint8Array; keyText: string; manifest: Record<string, unknown> }> {
  const key = opts.key ?? newKeyBytes();
  const base = JSON.parse(readFileSync(join(INVERT_DIR, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const manifest = { ...base, ...(opts.manifest ?? {}) };
  const files = fixtureFiles().filter((f) => f.name !== 'manifest.json' && !(opts.files ?? []).some((x) => x.name === f.name));
  const all = [{ name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest)) }, ...files, ...(opts.files ?? [])];
  const bytes = await packRpk({ id: opts.header?.id ?? (manifest.id as string), version: opts.header?.version ?? (manifest.version as string), abi: 1 }, all, key);
  return { bytes, key, keyText: toBase64(key), manifest };
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A registry entry for a package served at `url`. */
export function entryFor(bytes: Uint8Array, patch: Partial<PluginRegistryEntry> = {}): PluginRegistryEntry {
  return {
    id: 'test-invert',
    name: { en: 'Invert (test plugin)', es: 'Invertir (plugin de prueba)' },
    publisher: 'Repackshot tests',
    version: '1.0.0',
    summary: { en: 'Inverts the colours.', es: 'Invierte los colores.' },
    licence: { kind: 'closed', label: { en: 'Closed licence', es: 'Licencia cerrada' } },
    homepage: 'https://example.test/invert',
    url: 'https://plugins.test/invert-1.0.0.rpk',
    sha256: sha256(bytes),
    bytes: bytes.length,
    keyUrl: '',
    logo: 'logo.svg',
    ...patch,
  };
}

/** A fetch that answers from a table: bytes, text, or an HTTP status; anything else is a network error. */
export function tableFetch(table: Record<string, Uint8Array | string | number>): { fetch: (url: string) => Promise<Response>; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    fetch: async (url: string) => {
      asked.push(url);
      const v = table[url];
      if (v === undefined) throw new TypeError('Failed to fetch');
      if (typeof v === 'number') return new Response('no', { status: v });
      return new Response(typeof v === 'string' ? v : (v.slice().buffer as ArrayBuffer), { status: 200 });
    },
  };
}

/** The smallest WebAssembly modules: one that imports nothing, and one that imports a function `m.f`. */
export const WASM_NO_IMPORTS = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
export const WASM_ONE_IMPORT = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x02, 0x07, 0x01, 0x01, 0x6d, 0x01, 0x66, 0x00, 0x00]);

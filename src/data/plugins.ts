// The registry of plugins (ROADMAP P6, ARCHITECTURE.md §9): what Settings ▸ Plugins offers to install. Each entry
// pins its package (`url`, `sha256` and `bytes` of the `.rpk` file) like the AI models pin theirs (ai-models.json);
// `keyUrl` is where the activation key is asked for, empty while the developer does not host one (the person types
// it at install). `logo` is a file of the package (shown once it is installed) or an inline `data:image/svg+xml`
// URL. A plugin is not a dependency of Repackshot: the person installs it, under its own licence, which is closed
// and says so. Ids are stable: they are added, never renamed.

import raw from './plugins.json';
import type { Label } from './types';

export interface PluginRegistryEntry {
  id: string;
  name: Label;
  publisher: string;
  version: string;
  summary: Label;
  licence: { kind: 'closed'; label: Label };
  homepage: string;
  /** The package, an https:// address. */
  url: string;
  /** Hex SHA-256 of the package file. */
  sha256: string;
  bytes: number;
  /** Where the activation key is fetched from (its text is the key); '' when the person types it. */
  keyUrl: string;
  /** A file of the package (`logo.svg`) or an inline SVG `data:` URL. */
  logo: string;
}

export interface PluginRegistry {
  schema: number;
  plugins: PluginRegistryEntry[];
}

export const PLUGIN_REGISTRY: PluginRegistry = raw as PluginRegistry;

const isLabel = (v: unknown): v is Label => typeof v === 'object' && v !== null && typeof (v as Label).en === 'string' && typeof (v as Label).es === 'string' && (v as Label).en.trim() !== '' && (v as Label).es.trim() !== '';

/** What is wrong with an entry, in the program's words; [] for a valid one. */
export function registryEntryProblems(e: unknown): string[] {
  const p: string[] = [];
  if (typeof e !== 'object' || e === null) return ['not an object'];
  const x = e as Record<string, unknown>;
  if (typeof x.id !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(x.id)) p.push('id');
  if (!isLabel(x.name)) p.push('name');
  if (typeof x.publisher !== 'string' || x.publisher.trim() === '') p.push('publisher');
  if (typeof x.version !== 'string' || !/^[0-9A-Za-z.+-]{1,32}$/.test(x.version)) p.push('version');
  if (!isLabel(x.summary)) p.push('summary');
  const lic = x.licence as Record<string, unknown> | undefined;
  if (!lic || lic.kind !== 'closed' || !isLabel(lic.label)) p.push('licence');
  if (typeof x.homepage !== 'string' || !/^https:\/\/\S+$/.test(x.homepage)) p.push('homepage');
  if (typeof x.url !== 'string' || !/^https?:\/\/\S+$/.test(x.url)) p.push('url');
  if (typeof x.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(x.sha256)) p.push('sha256');
  if (typeof x.bytes !== 'number' || !Number.isInteger(x.bytes) || x.bytes <= 0) p.push('bytes');
  if (typeof x.keyUrl !== 'string' || (x.keyUrl !== '' && !/^https?:\/\/\S+$/.test(x.keyUrl))) p.push('keyUrl');
  if (typeof x.logo !== 'string' || !(/^data:image\/svg\+xml[,;]/.test(x.logo) || /^[A-Za-z0-9_][A-Za-z0-9._/-]*\.svg$/.test(x.logo))) p.push('logo');
  return p;
}

/** The entries a registry can offer: the valid ones, the first of each id. */
export function validEntries(reg: PluginRegistry): PluginRegistryEntry[] {
  const seen = new Set<string>();
  return reg.plugins.filter((e) => {
    if (registryEntryProblems(e).length > 0 || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

export function registryEntry(id: string, reg: PluginRegistry = PLUGIN_REGISTRY): PluginRegistryEntry | undefined {
  return validEntries(reg).find((e) => e.id === id);
}

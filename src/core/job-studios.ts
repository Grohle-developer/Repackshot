// The studios a project's jobs render in travel with the project (N2b, SPEC §3.8). A batch job over saved studios
// (cameras × studios, N2) used to keep only the studio's id and name, so a project opened on another machine, or in
// another browser profile, failed those jobs when its library lacked the studio. Now the project keeps a copy of every
// studio its jobs use: the saved studio as `restoreStudio` (core/lighting.ts) applies it, once per studio id and
// content, in `render.studios`, and each job names its copy by the content hash (`RenderJob.studioCopy`).
//
// What a job renders in, in order: its own copy (when the project has it: the copy wins over a library studio of the
// same id, whatever that one holds now), else the library's studio of that id, else a studio an older project kept
// inside itself (`studio.saved`); none of them is the failure with its reason, as before.
//
// The big data of a studio is not stored twice: its lights carry their IES profiles in the JSON, as the project's own
// lights do (L5), and its environment images and texture images are refs into the image registry, which the project
// file writes once per image in its `images` block (io/project.ts), whoever names them. Pure functions on plain data.

import type { ImageRef } from './images';
import type { SavedStudio } from './lighting';
import { findItem, savedStudioOf, type Library } from './library';
import { sha256Hex } from './sha256';
import { textureImages } from './textures';

/** A studio a job of the project renders in: the saved studio and the hash of its content. */
export interface EmbeddedStudio {
  /** SHA-256 (hex) of the studio's content without its id and name (`studioHash`). */
  hash: string;
  studio: SavedStudio;
}

/** JSON with the keys of every object in order, so the same content is the same text whoever wrote it. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/** The hash of a saved studio's content: everything `restoreStudio` puts on, not its id or its name. */
export function studioHash(studio: SavedStudio): string {
  const { id: _id, name: _name, ...content } = studio;
  return sha256Hex(new TextEncoder().encode(canonicalJson(content)));
}

/** The project's copy of a studio, by its id and the hash of its content. */
export function findEmbedded(list: readonly EmbeddedStudio[] | undefined, id: string, hash: string | undefined): EmbeddedStudio | undefined {
  if (!list || !hash) return undefined;
  return list.find((e) => e.hash === hash && e.studio.id === id);
}

/** `list` with `studio` in it (once per id and content); the same list when it is there already. */
export function embedStudio(list: readonly EmbeddedStudio[], studio: SavedStudio, hash: string = studioHash(studio)): EmbeddedStudio[] {
  if (findEmbedded(list, studio.id, hash)) return list as EmbeddedStudio[];
  return [...list, { hash, studio }];
}

/** The copies some job of `queue` names; the same list when every one is named. */
export function pruneEmbedded(list: readonly EmbeddedStudio[], queue: readonly { settings: { studio?: { kind: string; id?: string } }; studioCopy?: string }[]): EmbeddedStudio[] {
  if (list.length === 0) return list as EmbeddedStudio[];
  const named = new Set<string>();
  for (const j of queue) if (j.studioCopy && j.settings.studio?.kind === 'ONE') named.add(`${j.settings.studio.id}\u0000${j.studioCopy}`);
  const kept = list.filter((e) => named.has(`${e.studio.id}\u0000${e.hash}`));
  return kept.length === list.length ? (list as EmbeddedStudio[]) : kept;
}

/** The environment images (HDRI, background image) and the texture images the copies name, each once. */
export function embeddedImageRefs(list: readonly EmbeddedStudio[] | undefined): { environment: ImageRef[]; textures: Map<string, ImageRef> } {
  const environment: ImageRef[] = [];
  const textures = new Map<string, ImageRef>();
  for (const e of list ?? []) {
    const env = e.studio.environment;
    for (const ref of [env?.hdri, env?.backplate]) if (ref && !environment.some((r) => r.id === ref.id)) environment.push(ref);
    for (const [id, ref] of textureImages({ materials: e.studio.instances ?? {} })) if (!textures.has(id)) textures.set(id, ref);
  }
  return { environment, textures };
}

/** The ids of every image the copies name. */
export function embeddedImageIds(list: readonly EmbeddedStudio[] | undefined): string[] {
  const { environment, textures } = embeddedImageRefs(list);
  return [...environment.map((r) => r.id), ...textures.keys()];
}

/** Where the studio of a job came from: the project's copy, the library, or an older project's own saved studios. */
export type JobStudioSource = 'PROJECT' | 'LIBRARY' | 'SAVED';

/** What a job's studio resolves to. */
export interface ResolvedJobStudio {
  studio: SavedStudio;
  from: JobStudioSource;
}

/** The parts of a project the resolution reads. */
interface ResolveState {
  render: { studios?: readonly EmbeddedStudio[] };
  studio: { saved: readonly SavedStudio[] };
}

/**
 * The saved studio a job with studio `id` (and copy `hash`, when it has one) renders in: the project's copy first, then
 * the library's studio of that id, then one an older project kept inside itself; null when none of them has it.
 */
export function resolveStudio(state: ResolveState, library: Library, id: string, hash?: string): ResolvedJobStudio | null {
  const copy = findEmbedded(state.render.studios, id, hash);
  if (copy) return { studio: copy.studio, from: 'PROJECT' };
  const item = findItem(library, 'studio', id);
  if (item) return { studio: savedStudioOf(item), from: 'LIBRARY' };
  const own = state.studio.saved.find((x) => x.id === id);
  return own ? { studio: own, from: 'SAVED' } : null;
}

/**
 * The studios that came in the project and are not in the library (nor saved inside the project): what *Add to my
 * library* offers. One per id, the copy embedded last when a studio has several (it changed between two batches).
 */
export function studiosToAdopt(state: ResolveState, library: Library): SavedStudio[] {
  const out = new Map<string, SavedStudio>();
  for (const e of state.render.studios ?? []) {
    const id = e.studio.id;
    if (findItem(library, 'studio', id) || state.studio.saved.some((x) => x.id === id)) continue;
    out.delete(id);
    out.set(id, e.studio);
  }
  return [...out.values()];
}

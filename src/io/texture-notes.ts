// What the import sheet and the toasts say about a file's texture images (M2a): how many were kept, and each one
// dropped or unused with why. Shared by every reader; no three.js here, so the OBJ path does not need it.

import type { ImportMessage, ImportTexture } from '../core/import-options';

/** The note that says what became of a file's textures (none when it had none). */
export function textureNotes(textures: readonly ImportTexture[]): ImportMessage[] {
  const kept = textures.filter((t) => !t.dropped && !t.unused);
  const notes: ImportMessage[] = [];
  const bytes = kept.reduce((a, t) => a + (t.bytes?.length ?? 0), 0);
  if (kept.length > 0) notes.push({ code: 'texturesKept', params: { count: kept.length, size: Math.max(0.1, Math.round(bytes / 1e5) / 10) } });
  for (const t of textures) {
    if (t.unused) notes.push({ code: 'textureUnused', params: { image: t.name, kind: t.unused } });
    else if (t.dropped) notes.push({ code: 'textureDropped', params: { image: t.name, reason: t.dropped } });
  }
  return notes;
}

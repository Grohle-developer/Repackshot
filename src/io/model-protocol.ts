// Messages between the main thread and the model worker (io/model-worker.ts).

import type { ImportedModel } from '../core/models';

export type ModelWorkerRequest = { id: number } & (
  | { op: 'probe' }
  | { op: 'status'; sha: string }
  | { op: 'blobs' }
  | { op: 'write'; sha: string; offset: number; total: number; bytes: ArrayBuffer }
  | { op: 'finish'; sha: string; total: number }
  | { op: 'deleteBlob'; sha: string }
  | { op: 'release'; sha: string }
  | { op: 'installed' }
  | { op: 'install'; key: string; shas: string[] }
  | { op: 'uninstall'; key: string; shas: string[] }
  | { op: 'imported' }
  | { op: 'putImported'; model: ImportedModel }
  | { op: 'usage' }
  | { op: 'hash'; blob: Blob }
);

export type ModelWorkerReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; code: string; message: string } | { id: number; progress: number };

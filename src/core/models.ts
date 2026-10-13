// The AI model manager's model (AI-POST.md §5, UI.md §2.9): what the
// Settings window shows for every model, from the catalogue (src/data/
// ai-models.json through ./ai-deps), the models the user imported, and what
// the model store holds. Pure: the store and the download manager live in
// src/io (model-store.ts, downloads.ts) and report into a `ModelsSnapshot`;
// everything here derives from it.
//
// Storage is by content, the same layout in the browser (OPFS) and on the
// desktop (the launcher's data folder): a file is a blob named by its
// sha256, so a file several models share (the Qwen3-4B text encoder of four
// keys) is downloaded and stored once, and deleting a model deletes only the
// blobs no other installed model uses. A model is Ready when it is in
// `installed`, which the store only allows once every blob is complete and
// verified.

import type { Label, Lang } from '../data/types';
import type { AiModelEntry, AiModelsCatalogue, Recommendation, RecommendInput } from './ai-deps';
import { SHA256_RE } from './sha256';

// ------------------------------------------------------------------ the store's view

export type BlobState = 'missing' | 'partial' | 'complete';

/** One file of the store (the launcher's `GET …/status` has the same fields). */
export interface BlobInfo {
  sha256: string;
  state: BlobState;
  /** Bytes written from 0 without a gap: where a download resumes. */
  contiguous: number;
  /** Expected size when known. */
  total: number | null;
  /** The bytes are all there but their sha256 is another one: deleted before downloading again. */
  damaged: boolean;
  actual?: string | null;
}

export type DownloadPhase = 'QUEUED' | 'DOWNLOADING' | 'VERIFYING' | 'PAUSED' | 'ERROR';

/** A model the user asked to download, as the download manager sees it now. */
export interface DownloadProgress {
  key: string;
  phase: DownloadPhase;
  /** Bytes of the model's files present (complete files count whole). */
  done: number;
  total: number;
  /** Measured over the last seconds of transfer; null until there is enough to measure. */
  bytesPerSecond: number | null;
  /** From the measured speed; null without one. */
  etaSeconds: number | null;
  /** Why it stopped (ERROR, or PAUSED after failures). */
  error?: string;
}

export interface ModelsSnapshot {
  /** The store answered (false while loading or when there is none). */
  ready: boolean;
  /** Where models are kept: the browser's private storage, the launcher's data folder, or memory only. */
  kind: 'opfs' | 'native' | 'memory' | 'none';
  /** The launcher's models folder (desktop). */
  location: string | null;
  /** Why there is no store (OPFS missing...), when `kind` is none. */
  error: string | null;
  catalogue: AiModelsCatalogue;
  blobs: Record<string, BlobInfo>;
  installed: string[];
  imported: ImportedModel[];
  downloads: Record<string, DownloadProgress>;
  /** Models whose licence the user accepted (once, before the first download). */
  accepted: string[];
  /** An import being hashed or copied into the store. */
  importing: { name: string; phase: 'HASHING' | 'COPYING'; done: number; total: number } | null;
}

export function emptySnapshot(catalogue: AiModelsCatalogue): ModelsSnapshot {
  return { ready: false, kind: 'none', location: null, error: null, catalogue, blobs: {}, installed: [], imported: [], downloads: {}, accepted: [], importing: null };
}

// ------------------------------------------------------------------ imported models (AI-POST.md §5)

export type ImportFamily = 'z-image' | 'flux2-klein' | 'qwen-image-edit' | 'sdxl' | 'sd15';
export type ImportRole = 'img2img' | 'edit' | 'controlnet' | 'lora' | 'vae' | 'text-encoder';
export const IMPORT_FAMILIES: readonly ImportFamily[] = ['z-image', 'flux2-klein', 'qwen-image-edit', 'sdxl', 'sd15'];
export const IMPORT_ROLES: readonly ImportRole[] = ['img2img', 'edit', 'controlnet', 'lora', 'vae', 'text-encoder'];
export const FILE_ROLES = ['transformer', 'text-encoder', 'vae', 'controlnet', 'mmproj', 'lora', 'config', 'other'] as const;
export type ImportFileRole = (typeof FILE_ROLES)[number];
export const MANIFEST_NAME = 'model.repackshot.json';
export const MANIFEST_FORMAT = 'repackshot-model';

export interface ImportedFile {
  name: string;
  role: ImportFileRole;
  bytes: number;
  sha256: string;
}

/** A model the user brought, as its `model.repackshot.json` describes it (validated). */
export interface ImportedModel {
  format: typeof MANIFEST_FORMAT;
  schema: 1;
  key: string;
  name: string;
  family: ImportFamily;
  role: ImportRole;
  quantization: string;
  licence: { spdx: string; url: string; commercialUse: boolean };
  files: ImportedFile[];
  capabilities: { strength: boolean; referenceEdit: boolean; control: string[] };
  source: string;
}

/** Pickle formats run code when loaded: refused, always (AI-POST.md §5). */
export const PICKLE_EXTENSIONS = ['ckpt', 'pt', 'pth', 'bin', 'pkl', 'pickle'];
const ACCEPTED_RE = /\.(safetensors|gguf|onnx|onnx_data(_\d+)?|json|txt)$/i;

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function isPickleFile(name: string): boolean {
  return PICKLE_EXTENSIONS.includes(extensionOf(name));
}

export function isAcceptedFile(name: string): boolean {
  return !isPickleFile(name) && ACCEPTED_RE.test(name);
}

/** Licences the application recognises: whether they allow commercial use, and whether they carry use restrictions. */
export const KNOWN_LICENCES: Readonly<Record<string, { commercial: boolean; restrictions: boolean }>> = {
  'Apache-2.0': { commercial: true, restrictions: false },
  MIT: { commercial: true, restrictions: false },
  'BSD-2-Clause': { commercial: true, restrictions: false },
  'BSD-3-Clause': { commercial: true, restrictions: false },
  'CC0-1.0': { commercial: true, restrictions: false },
  'CC-BY-4.0': { commercial: true, restrictions: false },
  'CC-BY-SA-4.0': { commercial: true, restrictions: false },
  'LicenseRef-CreativeML-OpenRAIL-M': { commercial: true, restrictions: true },
  'CreativeML-OpenRAIL-M': { commercial: true, restrictions: true },
  'OpenRAIL-M': { commercial: true, restrictions: true },
  'OpenRAIL++-M': { commercial: true, restrictions: true },
  'CC-BY-NC-4.0': { commercial: false, restrictions: false },
  'CC-BY-NC-SA-4.0': { commercial: false, restrictions: false },
  'CC-BY-NC-ND-4.0': { commercial: false, restrictions: false },
};

export function licenceKnown(spdx: string): boolean {
  return Object.prototype.hasOwnProperty.call(KNOWN_LICENCES, spdx);
}

/**
 * Whether a licence allows commercial use: only a known licence that does and that the model does not restrict
 * further. Unknown licences count as noncommercial (the person decides; the application never assumes).
 */
export function commercialOk(licence: { spdx: string; commercialUse: boolean }): boolean {
  return licenceKnown(licence.spdx) && KNOWN_LICENCES[licence.spdx].commercial && licence.commercialUse === true;
}

export type ManifestProblem =
  | { field: string; code: 'missing' | 'invalid' }
  | { field: 'files'; code: 'pickle' | 'unsupported'; file: string }
  | { field: 'files'; code: 'notSelected' | 'duplicate'; file: string }
  | { field: 'format'; code: 'notManifest' };

export type ManifestResult = { ok: true; model: ImportedModel; problems: [] } | { ok: false; problems: ManifestProblem[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const KEY_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
const FILE_NAME_RE = /^[^\\/:*?"<>|\0]{1,200}$/;

/** A key for an imported model from its name: `user-<slug>`, made unique against `taken`. */
export function importedKey(name: string, taken: readonly string[]): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'model';
  let key = `user-${slug}`;
  for (let n = 2; taken.includes(key); n++) key = `user-${slug}-${n}`;
  return key;
}

/**
 * Checks a `model.repackshot.json` (or what the inline form produced). `selected` are the names of the files the
 * person picked: every file of the manifest must be among them, no pickle file may be, and each file's sha256
 * may be left empty (it is computed while the file is copied). `taken` are the keys in use; a manifest without
 * a usable key gets one from its name.
 */
export function validateManifest(raw: unknown, opts: { selected?: readonly string[]; taken?: readonly string[]; requireSha?: boolean } = {}): ManifestResult {
  const problems: ManifestProblem[] = [];
  if (!isRecord(raw)) return { ok: false, problems: [{ field: 'format', code: 'notManifest' }] };
  if (raw.format !== undefined && raw.format !== MANIFEST_FORMAT) problems.push({ field: 'format', code: 'notManifest' });
  const str = (field: string, v: unknown, max = 200): string | null => {
    if (v === undefined || v === null || v === '') {
      problems.push({ field, code: 'missing' });
      return null;
    }
    if (typeof v !== 'string' || v.trim() === '' || v.length > max) {
      problems.push({ field, code: 'invalid' });
      return null;
    }
    return v.trim();
  };
  const oneOf = <T extends string>(field: string, v: unknown, list: readonly T[]): T | null => {
    if (v === undefined || v === null || v === '') {
      problems.push({ field, code: 'missing' });
      return null;
    }
    if (!list.includes(v as T)) {
      problems.push({ field, code: 'invalid' });
      return null;
    }
    return v as T;
  };
  const name = str('name', raw.name);
  const family = oneOf('family', raw.family, IMPORT_FAMILIES);
  const role = oneOf('role', raw.role, IMPORT_ROLES);
  const quantization = str('quantization', raw.quantization, 40);
  const source = str('source', raw.source, 500);
  // Licence: SPDX id, its URL, and whether it allows commercial use.
  let licence: ImportedModel['licence'] | null = null;
  if (!isRecord(raw.licence)) problems.push({ field: 'licence', code: raw.licence === undefined ? 'missing' : 'invalid' });
  else {
    const spdx = str('licence.spdx', raw.licence.spdx, 100);
    const url = str('licence.url', raw.licence.url, 500);
    if (url && !/^https?:\/\//i.test(url)) problems.push({ field: 'licence.url', code: 'invalid' });
    let commercial: boolean | null = null;
    if (raw.licence.commercialUse === undefined) problems.push({ field: 'licence.commercialUse', code: 'missing' });
    else if (typeof raw.licence.commercialUse !== 'boolean') problems.push({ field: 'licence.commercialUse', code: 'invalid' });
    else commercial = raw.licence.commercialUse;
    if (spdx && url && commercial !== null) licence = { spdx, url, commercialUse: commercial };
  }
  // Files.
  const files: ImportedFile[] = [];
  if (!Array.isArray(raw.files) || raw.files.length === 0) problems.push({ field: 'files', code: raw.files === undefined ? 'missing' : 'invalid' });
  else {
    const seen = new Set<string>();
    raw.files.forEach((f, i) => {
      if (!isRecord(f)) {
        problems.push({ field: `files.${i}`, code: 'invalid' });
        return;
      }
      const fname = typeof f.name === 'string' && FILE_NAME_RE.test(f.name) && !f.name.includes('..') ? f.name : null;
      if (!fname) {
        problems.push({ field: `files.${i}.name`, code: f.name === undefined ? 'missing' : 'invalid' });
        return;
      }
      if (isPickleFile(fname)) {
        problems.push({ field: 'files', code: 'pickle', file: fname });
        return;
      }
      if (!isAcceptedFile(fname)) {
        problems.push({ field: 'files', code: 'unsupported', file: fname });
        return;
      }
      if (seen.has(fname)) {
        problems.push({ field: 'files', code: 'duplicate', file: fname });
        return;
      }
      seen.add(fname);
      if (opts.selected && !opts.selected.includes(fname)) problems.push({ field: 'files', code: 'notSelected', file: fname });
      const frole = FILE_ROLES.includes(f.role as ImportFileRole) ? (f.role as ImportFileRole) : null;
      if (!frole) problems.push({ field: `files.${i}.role`, code: f.role === undefined ? 'missing' : 'invalid' });
      const bytes = typeof f.bytes === 'number' && Number.isInteger(f.bytes) && f.bytes > 0 ? f.bytes : null;
      if (bytes === null) problems.push({ field: `files.${i}.bytes`, code: f.bytes === undefined ? 'missing' : 'invalid' });
      const sha = typeof f.sha256 === 'string' ? f.sha256.toLowerCase() : '';
      if (sha !== '' && !SHA256_RE.test(sha)) problems.push({ field: `files.${i}.sha256`, code: 'invalid' });
      else if (sha === '' && opts.requireSha) problems.push({ field: `files.${i}.sha256`, code: 'missing' });
      if (frole && bytes !== null) files.push({ name: fname, role: frole, bytes, sha256: sha });
    });
  }
  // Capabilities (optional pieces default to "not supported").
  let capabilities: ImportedModel['capabilities'] = { strength: false, referenceEdit: false, control: [] };
  if (raw.capabilities !== undefined) {
    if (!isRecord(raw.capabilities)) problems.push({ field: 'capabilities', code: 'invalid' });
    else {
      const c = raw.capabilities;
      const control = Array.isArray(c.control) ? c.control.filter((x): x is string => typeof x === 'string' && x.length <= 40).slice(0, 16) : [];
      capabilities = { strength: c.strength === true, referenceEdit: c.referenceEdit === true, control };
    }
  }
  if (problems.length > 0 || !name || !family || !role || !quantization || !source || !licence) return { ok: false, problems: problems.length ? problems : [{ field: 'format', code: 'notManifest' }] };
  const taken = opts.taken ?? [];
  const key = typeof raw.key === 'string' && KEY_RE.test(raw.key) && !raw.key.includes('..') && !taken.includes(raw.key) ? raw.key : importedKey(name, taken);
  return { ok: true, model: { format: MANIFEST_FORMAT, schema: 1, key, name, family, role, quantization, licence, files, capabilities, source }, problems: [] };
}

/** How an import ended. */
export type ImportOutcome =
  | { kind: 'done'; key: string }
  /** No model.repackshot.json among the files: the inline form fills one. */
  | { kind: 'needsManifest'; files: { name: string; bytes: number }[] }
  | { kind: 'rejected'; problems: ManifestProblem[] }
  | { kind: 'failed'; reason: 'mismatch' | 'size' | 'store' | 'busy'; file?: string; message?: string };

/** What the Settings window asks of the model manager (io/downloads.ts implements it). */
export interface ModelsService {
  snapshot(): ModelsSnapshot;
  subscribe(fn: (snap: ModelsSnapshot) => void): () => void;
  /** Reads the store again. */
  refresh(): Promise<void>;
  /** The licence of a model was shown and accepted (before its first download). */
  acceptLicence(key: string): void;
  /** Starts (or restarts) a download; a licence not yet accepted is asked for first. */
  download(key: string): Promise<'started' | 'needsLicence' | 'unavailable' | 'noStore'>;
  pause(key: string): void;
  resume(key: string): void;
  /** Stops a download and deletes what only it had downloaded. */
  cancel(key: string): Promise<void>;
  /** Deletes an installed model (only the blobs no other model uses). */
  remove(key: string): Promise<void>;
  /** Imports files the user picked, with their manifest (or the one the inline form filled). */
  importFiles(files: readonly File[], manifest: unknown | null): Promise<ImportOutcome>;
}

// ------------------------------------------------------------------ one view of every model

/** A catalogue model or an imported one, as the list shows it. */
export interface ModelView {
  key: string;
  source: 'catalogue' | 'imported';
  label: Label;
  summary: Label | null;
  family: string;
  quantization: string;
  licence: { spdx: string; url: string; commercialUse: boolean; useRestrictions: boolean };
  /** The licence allows commercial use (known, and the model does not restrict it). */
  commercial: boolean;
  /** Files with where to get them (imported files have no URL: they came from disk). */
  files: { name: string; role: string; bytes: number; sha256: string; url: string | null }[];
  totalBytes: number;
  available: boolean;
  unavailableReason: Label | null;
  /** Catalogue: the built-in default. */
  isDefault: boolean;
  runtimes: readonly string[];
  requirements: { minVramGiB: number | null; minRamGiB: number | null };
}

function catalogueView(m: AiModelEntry): ModelView {
  return {
    key: m.key,
    source: 'catalogue',
    label: m.label,
    summary: m.summary,
    family: m.family,
    quantization: m.quantization,
    licence: { ...m.licence },
    commercial: commercialOk(m.licence),
    files: m.files.map((f) => ({ name: f.name, role: f.role, bytes: f.bytes, sha256: f.sha256, url: f.url })),
    totalBytes: m.totalBytes,
    available: m.available,
    unavailableReason: m.unavailableReason ?? null,
    isDefault: m.default,
    runtimes: m.runtimes,
    requirements: m.requirements,
  };
}

function importedView(m: ImportedModel): ModelView {
  const known = KNOWN_LICENCES[m.licence.spdx];
  return {
    key: m.key,
    source: 'imported',
    label: { en: m.name, es: m.name },
    summary: null,
    family: m.family,
    quantization: m.quantization,
    licence: { ...m.licence, useRestrictions: known?.restrictions ?? false },
    commercial: commercialOk(m.licence),
    files: m.files.map((f) => ({ ...f, url: null })),
    totalBytes: m.files.reduce((a, f) => a + f.bytes, 0),
    available: true,
    unavailableReason: null,
    isDefault: false,
    runtimes: ['desktop', 'web'],
    requirements: { minVramGiB: null, minRamGiB: null },
  };
}

/** Every model the list shows: the catalogue's, then the imported ones. */
export function allModels(snap: Pick<ModelsSnapshot, 'catalogue' | 'imported'>): ModelView[] {
  return [...snap.catalogue.models.map(catalogueView), ...snap.imported.map(importedView)];
}

export function findModel(snap: Pick<ModelsSnapshot, 'catalogue' | 'imported'>, key: string): ModelView | undefined {
  return allModels(snap).find((m) => m.key === key);
}

// ------------------------------------------------------------------ states

export type ModelState =
  | { kind: 'UNAVAILABLE'; reason: Label | null }
  | { kind: 'NOT_DOWNLOADED'; done: number; total: number }
  | { kind: 'QUEUED'; done: number; total: number }
  | { kind: 'DOWNLOADING'; done: number; total: number; bytesPerSecond: number | null; etaSeconds: number | null }
  | { kind: 'PAUSED'; done: number; total: number; error: string | null }
  | { kind: 'VERIFYING'; done: number; total: number }
  | { kind: 'READY' }
  | { kind: 'IN_USE' }
  | { kind: 'DAMAGED'; files: string[] };

/** Bytes of a model present in the store (complete blobs whole, partial ones up to their contiguous bytes). */
export function presentBytes(model: Pick<ModelView, 'files'>, blobs: Record<string, BlobInfo>): number {
  let n = 0;
  for (const f of model.files) {
    const b = blobs[f.sha256];
    if (!b) continue;
    n += b.state === 'complete' ? f.bytes : Math.min(f.bytes, b.contiguous);
  }
  return n;
}

/** The state the list shows for a model (UI.md §2.9). */
export function modelState(model: ModelView, snap: Pick<ModelsSnapshot, 'blobs' | 'installed' | 'downloads'>, active: string): ModelState {
  if (snap.installed.includes(model.key)) return model.key === active ? { kind: 'IN_USE' } : { kind: 'READY' };
  if (!model.available) return { kind: 'UNAVAILABLE', reason: model.unavailableReason };
  const damaged = model.files.filter((f) => snap.blobs[f.sha256]?.damaged).map((f) => f.name);
  const d = snap.downloads[model.key];
  if (damaged.length > 0 && (!d || d.phase === 'PAUSED' || d.phase === 'ERROR')) return { kind: 'DAMAGED', files: damaged };
  const total = model.totalBytes;
  if (d) {
    switch (d.phase) {
      case 'DOWNLOADING':
        return { kind: 'DOWNLOADING', done: d.done, total, bytesPerSecond: d.bytesPerSecond, etaSeconds: d.etaSeconds };
      case 'VERIFYING':
        return { kind: 'VERIFYING', done: d.done, total };
      case 'QUEUED':
        return { kind: 'QUEUED', done: d.done, total };
      default:
        return { kind: 'PAUSED', done: d.done, total, error: d.error ?? null };
    }
  }
  return { kind: 'NOT_DOWNLOADED', done: presentBytes(model, snap.blobs), total };
}

// ------------------------------------------------------------------ deleting, and the model in use

/**
 * The blobs to delete when `removing` stops being kept: the ones no other installed model, nor a model in
 * `keep` (being downloaded), uses. A blob shared by two models survives deleting one of them.
 */
export function blobsToDelete(models: readonly Pick<ModelView, 'key' | 'files'>[], installed: readonly string[], removing: string, keep: readonly string[] = []): string[] {
  const target = models.find((m) => m.key === removing);
  if (!target) return [];
  const used = new Set<string>();
  for (const m of models) {
    if (m.key === removing) continue;
    if (!installed.includes(m.key) && !keep.includes(m.key)) continue;
    for (const f of m.files) used.add(f.sha256);
  }
  return [...new Set(target.files.map((f) => f.sha256))].filter((sha) => !used.has(sha));
}

/**
 * The model in use after `removed` is deleted (or when none is chosen): the recommendation for this computer
 * when it is installed, else the catalogue's default when installed, else none. A model whose licence does not
 * allow commercial use (or is unknown) is never chosen on the person's behalf.
 */
export function fallbackActive(models: readonly ModelView[], installed: readonly string[], rec: Recommendation | null, removed?: string): string {
  const usable = (key: string | null | undefined): key is string => {
    if (!key || key === removed || !installed.includes(key)) return false;
    const m = models.find((x) => x.key === key);
    return !!m && m.commercial;
  };
  if (usable(rec?.recommended)) return rec!.recommended!;
  const def = models.find((m) => m.isDefault && usable(m.key));
  return def ? def.key : '';
}

/** The model in use: the chosen one when it is installed, else the fallback. */
export function activeModel(chosen: string, models: readonly ModelView[], installed: readonly string[], rec: Recommendation | null): string {
  if (chosen && installed.includes(chosen) && models.some((m) => m.key === chosen)) return chosen;
  return fallbackActive(models, installed, rec);
}

// ------------------------------------------------------------------ hardware and recommendation

/** What the Hardware part shows (UI.md §2.9): measured or reported, never estimated. */
export interface HardwareInfo {
  /** Detection worked (a failure says so and recommends nothing). */
  detected: boolean;
  where: 'web' | 'desktop';
  error?: string;
  /** Logical cores the system reports. */
  cores: number | null;
  /** Desktop: installed RAM. Web: the browser's rounded figure (`navigator.deviceMemory`, capped at 8). */
  ramGiB: number | null;
  ramCapped?: boolean;
  gpus: { name: string; vramGiB: number | null }[];
  webgpu: boolean | null;
  /** WebGPU adapter's maxBufferSize, bytes. */
  maxBufferBytes: number | null;
  cpu?: string;
  /** Desktop: the launcher's choice of device (a GPU with ≥ 4 GiB of VRAM, else CPU). */
  device?: 'gpu' | 'cpu';
}

/** The input of the recommendation rule for what was detected, or null when detection failed. */
export function recommendInput(hw: HardwareInfo | null, device: 'GPU' | 'CPU', gpu = 0): RecommendInput {
  if (!hw || !hw.detected) return null;
  if (hw.where === 'web') {
    if (hw.webgpu === null) return null;
    return { device: 'web', webgpu: hw.webgpu, maxBufferGiB: hw.maxBufferBytes === null ? null : hw.maxBufferBytes / 2 ** 30 };
  }
  if (device === 'GPU' && hw.gpus.length > 0) return { device: 'gpu', vramGiB: hw.gpus[Math.min(gpu, hw.gpus.length - 1)].vramGiB };
  return { device: 'cpu', ramGiB: hw.ramGiB };
}

export type RecommendationView =
  | { kind: 'FAILED' }
  | { kind: 'NO_ROW' }
  | { kind: 'NONE'; rowId: string; skipped: string[] }
  | { kind: 'MODEL'; rowId: string; key: string; offered: string[]; skipped: string[] };

/** What the Hardware part and the list say about the recommendation (the rule's output, not re-evaluated). */
export function recommendationView(rec: Recommendation | null): RecommendationView {
  if (!rec) return { kind: 'FAILED' };
  if (!rec.rowId) return { kind: 'NO_ROW' };
  if (!rec.recommended) return { kind: 'NONE', rowId: rec.rowId, skipped: rec.skipped };
  return { kind: 'MODEL', rowId: rec.rowId, key: rec.recommended, offered: rec.offered, skipped: rec.skipped };
}

/** The badges of one row of the list. */
export function rowBadges(model: ModelView, rec: Recommendation | null): { recommended: boolean; offered: boolean; noncommercial: boolean; restrictions: boolean } {
  return {
    recommended: !!rec && rec.recommended === model.key,
    offered: !!rec && rec.offered.includes(model.key),
    noncommercial: !model.commercial,
    restrictions: model.licence.useRestrictions,
  };
}

/** Whether the model fits the memory detected for the chosen device; null when it cannot be told. */
export function fitsMemory(model: ModelView, hw: HardwareInfo | null, device: 'GPU' | 'CPU', gpu = 0): { fits: boolean; needGiB: number; haveGiB: number } | null {
  if (!hw || !hw.detected) return null;
  if (device === 'GPU') {
    const need = model.requirements.minVramGiB;
    const have = hw.gpus[Math.min(gpu, hw.gpus.length - 1)]?.vramGiB ?? null;
    if (need === null || have === null) return null;
    return { fits: have >= need, needGiB: need, haveGiB: have };
  }
  const need = model.requirements.minRamGiB;
  if (need === null || hw.ramGiB === null || hw.ramCapped) return null;
  return { fits: hw.ramGiB >= need, needGiB: need, haveGiB: hw.ramGiB };
}

/** Whether a model can run where the application runs (the catalogue's runtimes). */
export function runsHere(model: ModelView, where: 'web' | 'desktop'): boolean {
  return model.runtimes.includes(where);
}

// ------------------------------------------------------------------ speed and time left, measured

/**
 * Bytes per second over a sliding window of what actually arrived. Nothing is reported until the window holds
 * at least `minSeconds` of transfer; a stall (no bytes for `windowSeconds`) reports nothing again.
 */
export class SpeedMeter {
  private readonly samples: { t: number; total: number }[] = [];
  private total = 0;

  constructor(
    private readonly windowSeconds = 8,
    private readonly minSeconds = 1.5,
  ) {}

  /** `bytes` more arrived at time `t` (seconds). */
  add(t: number, bytes: number): void {
    this.total += bytes;
    this.samples.push({ t, total: this.total });
    const from = t - this.windowSeconds;
    while (this.samples.length > 2 && this.samples[1].t <= from) this.samples.shift();
  }

  /** Bytes per second, or null when there is not enough measured. */
  rate(now: number): number | null {
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (now - last.t > this.windowSeconds) return null;
    const span = Math.max(last.t, now) - first.t;
    if (span < this.minSeconds) return null;
    return (last.total - first.total) / span;
  }

  reset(): void {
    this.samples.length = 0;
    this.total = 0;
  }
}

/** Seconds left at a measured speed; null without one. */
export function etaSeconds(remaining: number, bytesPerSecond: number | null): number | null {
  if (bytesPerSecond === null || !(bytesPerSecond > 0)) return null;
  return Math.max(0, remaining / bytesPerSecond);
}

// ------------------------------------------------------------------ sizes

/** Bytes as the list shows them: "6.4 GB", "820 MB" (decimal units, like the download pages). */
export function formatBytes(bytes: number, lang: Lang): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, bytes);
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  const digits = u === 0 ? 0 : v < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)} ${units[u]}`;
}

// ------------------------------------------------------------------ the first start of a desktop portable

/**
 * Whether the model chooser opens at this start (AI-POST.md §2.2): only in the desktop application's portable
 * version (no installer asked), when nothing is pending from an installer, and only once. Never on the web
 * (no model runs in a browser today) nor after an installer chose.
 */
export function showFirstRunChooser(o: { desktop: boolean; portable: boolean; pending: boolean; shown: boolean }): boolean {
  return o.desktop && o.portable && !o.pending && !o.shown;
}

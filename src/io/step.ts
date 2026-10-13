// STEP (AP203, AP214, AP242) and IGES through occt-import-js 0.0.23
// (OpenCascade compiled to wasm, LGPL-2.1; ARCHITECTURE §1, the one LGPL
// exception, isolated): this module is loaded on demand with the first CAD
// file, and the library itself only in a worker (step-worker.ts), fetched from
// `public/vendor/occt-import-js/` where tools/vendor.mjs copies it unmodified.
//
// Reading a file:
//   1. the length unit the file declares is read from its text (the STEP unit
//      entities, the IGES global section), and the library is asked for its
//      numbers in that unit, so the model arrives "as the file has it" and the
//      sheet's unit applies as for every other format. A unit the sheet does
//      not offer (feet, micrometres...) is converted to millimetres instead;
//   2. the sheet's tessellation becomes the library's deflections: the chord
//      tolerance relative to the model's size (`bounding_box_ratio`, the mean
//      of the three sides of its box) and the angle in radians;
//   3. the worker reads and tessellates; this side waits with a timeout, and
//      terminates the worker on a timeout, on cancel and after it has been
//      idle for a while (the wasm holds hundreds of MB once it has read);
//   4. occt-convert.ts turns the result into parts with their CAD faces.

import { ImportError, TESSELLATION_PRESETS, type ImportMessage, type ImportReadOptions, type ImportUnit, type TessellationParams } from '../core/import-options';
import type { ReadResult } from './gltf';
import { occtToPayload } from './occt-convert';
import type { OcctFormat, OcctParams, OcctResult, OcctUnit, WorkerReply, WorkerRequest } from './occt-protocol';

export type CadFormat = 'STEP' | 'IGES';

export type CadReadOptions = ImportReadOptions;

// --- Units declared by the file ----------------------------------------------------------------

/** A length unit a file declares: one the sheet offers (`unit`), or the name of another one (`other`). */
export interface DeclaredUnit {
  unit: ImportUnit | null;
  other?: string;
}

const NONE: DeclaredUnit = { unit: null };

/** Common names of length units, as STEP conversion-based units and IGES unit names write them. */
const NAMED: Record<string, DeclaredUnit> = {
  MM: { unit: 'mm' },
  MILLIMETRE: { unit: 'mm' },
  MILLIMETER: { unit: 'mm' },
  CM: { unit: 'cm' },
  CENTIMETRE: { unit: 'cm' },
  CENTIMETER: { unit: 'cm' },
  M: { unit: 'm' },
  METRE: { unit: 'm' },
  METER: { unit: 'm' },
  IN: { unit: 'in' },
  INCH: { unit: 'in' },
  INCHES: { unit: 'in' },
  FT: { unit: null, other: 'foot' },
  FOOT: { unit: null, other: 'foot' },
  FEET: { unit: null, other: 'foot' },
  MI: { unit: null, other: 'mile' },
  MILE: { unit: null, other: 'mile' },
  KM: { unit: null, other: 'kilometre' },
  MIL: { unit: null, other: 'mil' },
  UM: { unit: null, other: 'micrometre' },
  MICRON: { unit: null, other: 'micrometre' },
  UIN: { unit: null, other: 'microinch' },
};

/** SI prefixes of the metre in STEP (`SI_UNIT(.MILLI.,.METRE.)`; `$` is no prefix). */
const SI_PREFIX: Record<string, DeclaredUnit> = {
  $: { unit: 'm' },
  '.MILLI.': { unit: 'mm' },
  '.CENTI.': { unit: 'cm' },
  '.DECI.': { unit: null, other: 'decimetre' },
  '.MICRO.': { unit: null, other: 'micrometre' },
  '.NANO.': { unit: null, other: 'nanometre' },
  '.KILO.': { unit: null, other: 'kilometre' },
};

/** The text of every entity of a STEP file that contains `word` (from the `;` before it to the `;` after it). */
function entitiesWith(text: string, word: string): string[] {
  const out: string[] = [];
  let at = text.indexOf(word);
  while (at >= 0) {
    const from = text.lastIndexOf(';', at) + 1;
    let to = text.indexOf(';', at);
    if (to < 0) to = text.length;
    out.push(text.slice(from, to));
    at = text.indexOf(word, to);
  }
  return out;
}

/** The length unit of a STEP length-unit entity's text, or null when it is none. */
function stepUnitOf(entity: string): DeclaredUnit | null {
  if (!/\bLENGTH_UNIT\s*\(/.test(entity)) return null;
  const si = /\bSI_UNIT\s*\(\s*(\$|\.[A-Z]+\.)\s*,\s*\.METRE\.\s*\)/.exec(entity);
  if (si) return SI_PREFIX[si[1]] ?? { unit: null, other: si[1].replace(/\./g, '').toLowerCase() + 'metre' };
  const conv = /\bCONVERSION_BASED_UNIT\s*\(\s*'([^']*)'/.exec(entity);
  if (conv) {
    const name = conv[1].trim().toUpperCase();
    return NAMED[name] ?? { unit: null, other: conv[1].trim().toLowerCase() || 'unknown' };
  }
  return null;
}

/**
 * The length unit a STEP file declares: the one its geometric contexts assign (GLOBAL_UNIT_ASSIGNED_CONTEXT),
 * the first of them when there are several; else its only length unit; else none.
 */
export function stepLengthUnit(bytes: Uint8Array): DeclaredUnit {
  const text = new TextDecoder('latin1').decode(bytes);
  const units = new Map<string, DeclaredUnit>();
  for (const e of entitiesWith(text, 'LENGTH_UNIT')) {
    const id = /^\s*(#\d+)\s*=/.exec(e)?.[1];
    const u = stepUnitOf(e);
    if (id && u) units.set(id, u);
  }
  for (const e of entitiesWith(text, 'GLOBAL_UNIT_ASSIGNED_CONTEXT')) {
    const list = /GLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\s*\(([^)]*)\)/.exec(e)?.[1] ?? '';
    for (const ref of list.split(',').map((r) => r.trim())) {
      const u = units.get(ref);
      if (u) return u;
    }
  }
  const distinct = new Set([...units.values()].map((u) => u.unit ?? u.other));
  return distinct.size === 1 ? [...units.values()][0] : NONE;
}

/** IGES unit flags (global parameter 14); 3 means "see the unit name" (parameter 15). */
const IGES_FLAGS: Record<number, DeclaredUnit> = {
  1: { unit: 'in' },
  2: { unit: 'mm' },
  4: { unit: null, other: 'foot' },
  5: { unit: null, other: 'mile' },
  6: { unit: 'm' },
  7: { unit: null, other: 'kilometre' },
  8: { unit: null, other: 'mil' },
  9: { unit: null, other: 'micrometre' },
  10: { unit: 'cm' },
  11: { unit: null, other: 'microinch' },
};

/** The parameters of the IGES global section (columns 1-72 of the `G` lines), Hollerith strings decoded. */
export function igesGlobal(bytes: Uint8Array): string[] {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.byteLength, 1 << 16)));
  let g = '';
  for (const line of text.split(/\r?\n/)) if (line.length >= 73 && line[72] === 'G') g += line.slice(0, 72);
  let i = 0;
  const spaces = () => {
    while (g[i] === ' ') i++;
  };
  // Parameters 1 and 2 name the delimiters (`1H,` and `1H;`); an empty one keeps the default.
  let pd = ',';
  let rd = ';';
  spaces();
  if (/^1H./.test(g.slice(i, i + 3))) {
    pd = g[i + 2];
    i += 3;
  }
  spaces();
  if (g[i] === pd) i++;
  spaces();
  if (/^1H./.test(g.slice(i, i + 3))) {
    rd = g[i + 2];
    i += 3;
  }
  spaces();
  if (g[i] === pd) i++;
  const params = [pd, rd];
  while (i < g.length) {
    spaces();
    const h = /^(\d+)H/.exec(g.slice(i, i + 12));
    let value: string;
    if (h) {
      const n = Number(h[1]);
      value = g.slice(i + h[0].length, i + h[0].length + n);
      i += h[0].length + n;
      while (i < g.length && g[i] !== pd && g[i] !== rd) i++;
    } else {
      const from = i;
      while (i < g.length && g[i] !== pd && g[i] !== rd) i++;
      value = g.slice(from, i).trim();
    }
    params.push(value);
    if (i >= g.length || g[i] === rd) break;
    i++;
  }
  return params;
}

/** The length unit an IGES file declares (global parameters 14 and 15; inches when it says nothing). */
export function igesLengthUnit(bytes: Uint8Array): DeclaredUnit {
  const g = igesGlobal(bytes);
  if (g.length < 3) return NONE;
  const flag = Number(g[13] || '1');
  const name = (g[14] ?? '').trim().toUpperCase();
  if (flag === 3) return NAMED[name] ?? (name ? { unit: null, other: name.toLowerCase() } : NONE);
  return IGES_FLAGS[flag] ?? NONE;
}

// --- What the library is asked for --------------------------------------------------------------------

const LIBRARY_UNIT: Record<ImportUnit, OcctUnit> = { mm: 'millimeter', cm: 'centimeter', m: 'meter', in: 'inch' };

/** The library's parameters for a unit and a tessellation (chord as a fraction of the model's mean size, angle in radians). */
export function occtParams(unit: ImportUnit, t: TessellationParams = TESSELLATION_PRESETS.MEDIUM): OcctParams {
  return { linearUnit: LIBRARY_UNIT[unit], linearDeflectionType: 'bounding_box_ratio', linearDeflection: t.chordPercent / 100, angularDeflection: (t.angleDeg * Math.PI) / 180 };
}

/**
 * The unit the numbers will be in and the library's parameters, for a file: its own unit when the sheet offers
 * it, millimetres (with a note) when it declares another one, millimetres when it says nothing.
 */
export function readPlan(format: CadFormat, bytes: Uint8Array, t?: TessellationParams): { units: ImportUnit; params: OcctParams; notes: ImportMessage[] } {
  const declared = format === 'STEP' ? stepLengthUnit(bytes) : igesLengthUnit(bytes);
  const units = declared.unit ?? 'mm';
  const notes: ImportMessage[] = declared.unit === null && declared.other ? [{ code: 'unitsConverted', params: { unit: declared.other } }] : [];
  return { units, params: occtParams(units, t), notes };
}

// --- The worker ---------------------------------------------------------------------------------------------

/** What this module needs of a Worker (tests hand in a fake). */
export interface CadWorker {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

let libraryPath = `${import.meta.env.BASE_URL}vendor/occt-import-js/`;
let makeWorker = (): CadWorker => new Worker(new URL('./step-worker.ts', import.meta.url), { type: 'module' }) as unknown as CadWorker;

/** Where the worker fetches occt-import-js.js and .wasm from. */
export function setOcctLibraryPath(path: string): void {
  libraryPath = path.endsWith('/') ? path : `${path}/`;
}

/** Tests: the worker to use instead of the real one. */
export function setCadWorkerFactory(make: () => CadWorker): void {
  makeWorker = make;
}

/**
 * How long each step may take before the worker is terminated: the download may stall (no byte) for
 * `stallMs`; starting the wasm may take `startMs`; reading a file `readBaseMs` plus `readPerMbMs` per MB, up to
 * `readMaxMs`. An idle worker is terminated after `idleMs`.
 */
export const CAD_TIMEOUTS = { stallMs: 30_000, startMs: 60_000, readBaseMs: 60_000, readPerMbMs: 30_000, readMaxMs: 600_000, idleMs: 30_000 };

/** The time a read of `bytes` may take. */
export function readTimeoutMs(bytes: number): number {
  return Math.min(CAD_TIMEOUTS.readMaxMs, CAD_TIMEOUTS.readBaseMs + (CAD_TIMEOUTS.readPerMbMs * bytes) / 1e6);
}

let worker: CadWorker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let requestCounter = 0;
/** The read in flight, so a new one (another quality) stops it. */
let current: { id: number; stop(err: ImportError): void } | null = null;

function dropWorker(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  worker?.terminate();
  worker = null;
}

/** Terminates the worker now (tests, and the app when nothing CAD is left to read). */
export function releaseCadWorker(): void {
  current?.stop(new ImportError('aborted'));
  dropWorker();
}

/** Whether a worker is alive (tests). */
export function cadWorkerAlive(): boolean {
  return worker !== null;
}

/** Runs one read in the worker. Rejects with an ImportError; never waits longer than the timeouts. */
export function runCadWorker(format: OcctFormat, bytes: Uint8Array, params: OcctParams, opts: CadReadOptions = {}): Promise<OcctResult> {
  current?.stop(new ImportError('aborted'));
  if (opts.signal?.aborted) return Promise.reject(new ImportError('aborted'));
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const w = (worker ??= makeWorker());
  const id = ++requestCounter;
  const absolute = new URL(libraryPath, typeof location !== 'undefined' ? location.href : 'http://localhost/').href;

  return new Promise<OcctResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fail(new ImportError('timeout', `${Math.round(ms / 1000)} s`), true), ms);
    };
    const finish = () => {
      done = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (current?.id === id) current = null;
      w.onmessage = null;
      w.onerror = null;
    };
    const fail = (err: ImportError, kill: boolean) => {
      if (done) return;
      finish();
      // A worker that timed out, crashed or was stopped may be stuck in the wasm: only terminating frees it.
      if (kill && worker === w) dropWorker();
      reject(err);
    };
    const onAbort = () => fail(new ImportError('aborted'), true);
    opts.signal?.addEventListener('abort', onAbort);
    current = { id, stop: (err) => fail(err, true) };

    w.onmessage = (e: MessageEvent) => {
      const reply = e.data as WorkerReply;
      if (done || reply?.id !== id) return;
      if (reply.type === 'progress') {
        if (reply.stage === 'download') arm(CAD_TIMEOUTS.stallMs);
        else if (reply.stage === 'start') arm(CAD_TIMEOUTS.startMs);
        else arm(readTimeoutMs(bytes.byteLength));
        opts.onProgress?.({ stage: reply.stage, ...(reply.loaded !== undefined ? { loaded: reply.loaded, total: reply.total ?? 0 } : {}) });
      } else if (reply.type === 'error') {
        // An unreadable file leaves the library as it was; anything else may not have.
        fail(new ImportError(reply.code, reply.detail), reply.code !== 'unreadable');
        if (reply.code === 'unreadable' && worker === w) scheduleIdle();
      } else {
        finish();
        scheduleIdle();
        resolve(reply.result);
      }
    };
    w.onerror = (e: Event) => fail(new ImportError('loadFailed', (e as ErrorEvent).message ?? 'worker error'), true);
    // Until the worker says where it is, the first step (fetching the library) has the stall timeout.
    arm(CAD_TIMEOUTS.stallMs);
    const request: WorkerRequest = { type: 'read', id, libraryUrl: absolute, format, bytes, params };
    // A copy, not a transfer: the caller keeps its bytes.
    w.postMessage(request);
  });
}

function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(dropWorker, CAD_TIMEOUTS.idleMs);
}

// --- Reading -----------------------------------------------------------------------------------------------

/** Reads a STEP or IGES file into a payload in the units the file declares. Throws ImportError. */
export async function readStep(name: string, bytes: Uint8Array, format: CadFormat, opts: CadReadOptions = {}): Promise<ReadResult> {
  const plan = readPlan(format, bytes, opts.tessellation);
  const result = await runCadWorker(format === 'STEP' ? 'step' : 'iges', bytes, plan.params, opts);
  opts.onProgress?.({ stage: 'convert' });
  // The conversion runs here, on the main thread: let the sheet paint "building the parts" first.
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (opts.signal?.aborted) throw new ImportError('aborted');
  return occtToPayload(result, { fileName: name, format, units: plan.units, notes: plan.notes });
}

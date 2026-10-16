// What the window of a lens in the list says (phase O2b, the triage's 1.4): resting the pointer, or the keyboard
// focus, on a lens of Camera ▸ Lens opens a small window with its elements. The window is drawn by
// components/lens-peek.ts; this file is everything it decides, without a DOM, so that it can be tested as it is:
//
//   - which camera the engine is asked about (`peekCamera`: the lens on that camera, nothing else changed) and the
//     answers kept per lens and per what the numbers depend on (`lensPeekCache`: the lens, its settings, the focal
//     length, the focus distance, the frame; one question per lens, however many times the pointer comes back);
//   - when a window opens and closes (`createPeekController`: after a short rest, never while the pointer only
//     crosses the list; Escape and choosing close it);
//   - what a card of the window shows (`peekCard`), from the engine's answer and nothing else (rule 10): a lens that
//     is still being asked says so, and without an engine the card has its name and source and no numbers.

import type { CameraState } from '../core/camera';
import { opticsOf, tracedOf } from '../core/optics';
import { newTracedLens, type EngineLensInfo } from '../core/traced-lens';
import { lensPrescription, type LensPrescription } from '../data/lenses';
import { lensSectionSvg } from './components/lens-section';
import { dyn } from './names';
import type { LensPort } from './ports';
import { formatNumber, lbl, t, type StringKey } from './strings';

/** How long the pointer (or the focus) rests on an entry before its window opens, ms. */
export const PEEK_DELAY_MS = 300;

/** The size the cross-section is drawn at in a card, px (the card is as wide as the drawing: components.css `--peek-w`). */
export const PEEK_FIGURE = { width: 232, height: 84 } as const;

/** The half diagonal of the reference frame (36 mm along the longer side) of a camera's aspect, mm: the sensor in the section. */
export function sensorHalf(cam: CameraState): number {
  const a = cam.aspect.w > 0 && cam.aspect.h > 0 ? cam.aspect.w / cam.aspect.h : 3 / 2;
  const [w, h2] = a >= 1 ? [36, 36 / a] : [36 * a, 36];
  return Math.hypot(w, h2) / 2;
}

/** The source of a lens as one line: the patent or the book, the year, and what has been checked of it. */
export function lensSourceLine(p: LensPrescription): string {
  const year = p.source.year && !p.source.doc.includes(String(p.source.year)) ? ` (${p.source.year})` : '';
  return t('camera.lensSource', { source: `${p.source.doc}${year}`, status: t(dyn(`camera.lensStatus.${p.status}`)) });
}

// --- the engine's answers ----------------------------------------------------------------------------------------

/** What the engine said of a lens: its numbers, that it forms no image, or nothing (there is no engine here). */
export type PeekAnswer = { state: 'ready'; info: EngineLensInfo } | { state: 'refused' } | { state: 'none' };

/**
 * The camera the engine is asked about for lens `key`: the camera as it is (its focal length, f-number, focus and
 * frame) with that lens on it, as choosing it would leave it (its own settings, none of the person's). The lens on the
 * camera is asked with the settings it has, which is what the section below the list draws.
 */
export function peekCamera(cam: CameraState, key: string): CameraState {
  const o = opticsOf(cam);
  if (tracedOf(o)?.key === key) return cam;
  return { ...cam, optics: { ...o, traced: newTracedLens(key), bokeh: null, variant: null } };
}

/** What the lens information of a camera depends on: the optics (the lens and its settings), the focal length, the focus and the frame. */
function askKey(c: CameraState): string {
  return JSON.stringify([c.optics, c.focalMm, c.fstop, c.focusDistance, c.aspect, c.projection]);
}

export interface LensPeekCache {
  /** The answer if it is already known, else undefined. */
  known(cam: CameraState, key: string): PeekAnswer | undefined;
  /** The answer for lens `key` on `cam`: from the cache, from a question already on its way, or by asking the engine. */
  load(cam: CameraState, key: string): Promise<PeekAnswer>;
}

const caches = new WeakMap<LensPort, LensPeekCache>();
/** How many answers a port's cache keeps. */
export const PEEK_CACHE_SIZE = 48;

/**
 * The cache of the answers of `port` (one per port, so a rebuilt inspector asks nothing it was already told). An answer
 * that the engine gave is kept, the refusal too; "no engine" and a failed question are not, so a lens asked again
 * after the engine arrives is asked.
 */
export function lensPeekCache(port: LensPort): LensPeekCache {
  const hit = caches.get(port);
  if (hit) return hit;
  const done = new Map<string, PeekAnswer>();
  const flying = new Map<string, Promise<PeekAnswer>>();
  const cache: LensPeekCache = {
    known: (cam, key) => done.get(askKey(peekCamera(cam, key))),
    load(cam, key) {
      const asked = peekCamera(cam, key);
      const k = askKey(asked);
      const kept = done.get(k);
      if (kept) return Promise.resolve(kept);
      let p = flying.get(k);
      if (!p) {
        p = new Promise<EngineLensInfo | null | undefined>((resolve) => resolve(port.info(asked))).then(
          (i): PeekAnswer => (i === undefined ? { state: 'refused' } : i === null ? { state: 'none' } : { state: 'ready', info: i }),
          (): PeekAnswer => ({ state: 'none' }),
        );
        flying.set(k, p);
        void p.then((a) => {
          flying.delete(k);
          if (a.state === 'none') return;
          done.set(k, a);
          if (done.size > PEEK_CACHE_SIZE) done.delete(done.keys().next().value!);
        });
      }
      return p;
    },
  };
  caches.set(port, cache);
  return cache;
}

// --- when the window opens and closes ----------------------------------------------------------------------------

export interface PeekTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: PeekTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export interface PeekController<T> {
  /** The pointer came to rest on `target`, or keyboard focus moved to it: its window opens after the delay. */
  enter(target: T): void;
  /** The pointer or the focus left `target`: its window closes, or its opening is cancelled. */
  leave(target: T): void;
  /** Escape, choosing the lens, the list drawn again: whatever is open or about to open is closed. */
  dismiss(): void;
  /** The target whose window is open. */
  readonly open: T | null;
}

/**
 * The timing of the window. Entering a target starts the wait (a target already waiting keeps its wait: a click's focus
 * after the pointer's rest does not start it again); leaving it, or entering another one, ends it, so a pointer that
 * crosses the list opens nothing. Once a window is dismissed it stays shut until the pointer or the focus comes back.
 */
export function createPeekController<T>(o: { delayMs?: number; timers?: PeekTimers; onOpen(target: T): void; onClose(target: T): void }): PeekController<T> {
  const delay = o.delayMs ?? PEEK_DELAY_MS;
  const timers = o.timers ?? realTimers;
  let pending: { target: T; handle: unknown } | null = null;
  let open: T | null = null;
  const cancel = () => {
    if (pending) timers.clear(pending.handle);
    pending = null;
  };
  const close = () => {
    if (open === null) return;
    const was = open;
    open = null;
    o.onClose(was);
  };
  return {
    get open() {
      return open;
    },
    enter(target) {
      if (open === target || pending?.target === target) return;
      cancel();
      close();
      const wait = { target, handle: undefined as unknown };
      wait.handle = timers.set(() => {
        if (pending !== wait) return;
        pending = null;
        open = target;
        o.onOpen(target);
      }, delay);
      pending = wait;
    },
    leave(target) {
      if (pending?.target === target) cancel();
      if (open === target) close();
    },
    dismiss() {
      cancel();
      close();
    },
  };
}

// --- what a card says --------------------------------------------------------------------------------------------

/** The state of a card: asking the engine, its numbers, no image formed, or no engine to ask. */
export type PeekCardState = 'loading' | 'ready' | 'refused' | 'none';

export interface PeekNumber {
  /** The label's string key (the section's own labels). */
  id: StringKey;
  label: string;
  value: string;
}

/** One lens in the window. */
export interface PeekCard {
  key: string;
  name: string;
  source: string;
  state: PeekCardState;
  /** The engine's key numbers; none unless `ready` (rule 10: nothing is made up while it is asked or when it is not there). */
  numbers: PeekNumber[];
  /** The cross-section as the engine prepared this lens, drawn by components/lens-section.ts; null unless `ready`. */
  figure: string | null;
  /** What stands where the figure would be: the wait, the refusal, the missing engine. */
  note: string | null;
}

const n = (v: number, digits = 1) => formatNumber(v, undefined, digits);

/**
 * The card of lens `key` for what the engine has said so far (undefined: the question is still on its way); null for a
 * key that is not in the catalogue.
 */
export function peekCard(cam: CameraState, key: string, answer: PeekAnswer | undefined): PeekCard | null {
  const p = lensPrescription(key);
  if (!p) return null;
  const card: PeekCard = { key, name: lbl(p.name), source: lensSourceLine(p), state: 'loading', numbers: [], figure: null, note: null };
  if (!answer) return { ...card, note: t('camera.lensInfoWait') };
  if (answer.state === 'none') return { ...card, state: 'none', note: t('camera.lensPeekNoEngine') };
  if (answer.state === 'refused') return { ...card, state: 'refused', note: t('camera.lensInfoRefused') };
  const i = answer.info;
  const row = (id: StringKey, value: string): PeekNumber => ({ id, label: t(id), value });
  const numbers = [
    row('camera.lensInfoFocal', `${n(i.eflMm, 1)} mm`),
    row('camera.lensInfoStop', t('camera.lensInfoStopValue', { f: n(i.fNumber, 2), t: n(i.tStop, 2) })),
    row('camera.lensInfoElements', `${i.elements} · ${i.groups}`),
    row('camera.lensInfoLength', `${n(i.lengthMm, 1)} mm`),
  ];
  if (Math.abs(i.squeeze - 1) > 1e-3) numbers.push(row('camera.lensInfoSqueeze', `${n(i.squeeze, 2)}×`));
  return { ...card, state: 'ready', numbers, figure: i.section ? lensSectionSvg(i.section, { ...PEEK_FIGURE, sensorHalfMm: sensorHalf(cam), title: card.name }) : null };
}

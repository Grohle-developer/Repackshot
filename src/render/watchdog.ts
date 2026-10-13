// The viewport's watchdog (phase P3a): Full mode must never stay stuck in
// silence. Both path tracers (render/native.ts and render/pathtracer.ts)
// check, on every frame, that the view they are rendering keeps answering,
// keeps getting new passes and that what arrives is drawn; when one of those
// stops for longer than it should, they start the view again and say so in
// the console (and, natively, in the launcher's log). The limits double each
// time it fires without progress in between, so a scene that is just slow is
// not restarted over and over; any progress brings them back.

/** Limits of the watchdog, in milliseconds (before doubling). */
export const WATCHDOG = {
  /** Native: no answer to the long-poll (the launcher answers within 1 s even without a pass). */
  silentMs: 6000,
  /** No new pass (natively, at least 4 times the expected pass). */
  idleMs: 30000,
  /** A new view the engine does not take (no answer to the POST, the scene not loaded). */
  startMs: 20000,
  /** A pass that arrived is not on the canvas yet. */
  displayMs: 5000,
  /** The pool: no tile of the view in flight. */
  tileMs: 15000,
  /** Frames are not being drawn at all (the page's animation loop stopped) while the page is visible. */
  frameMs: 3000,
} as const;

/** How long the meter tells that the view was started again. */
export const WATCHDOG_NOTE_MS = 10000;

/** Retries after an engine that refused a view: at once, then 1, 2, 4, 8 and 15 s. */
export const RETRY_MS = [0, 1000, 2000, 4000, 8000, 15000] as const;

export function retryDelay(attempt: number): number {
  return RETRY_MS[Math.min(Math.max(0, attempt), RETRY_MS.length - 1)];
}

/** What the meter says when the view is not simply converging. */
export interface ViewportIssue {
  /** WAITING: the engine has not answered for a while; FAILED: it refused the view (retrying); RESTARTED: the watchdog started it again. */
  kind: 'WAITING' | 'FAILED' | 'RESTARTED';
  /** The engine's reason, or what the watchdog saw (English, from the engine or the code). */
  detail: string;
  /** WAITING: for how long, in seconds. FAILED: seconds to the next try. */
  seconds?: number;
}

export class Watchdog {
  /** Times it fired since the engine started (for checks and the log). */
  fires = 0;
  private factor = 1;
  private lastReason = '';
  private lastAt = -Infinity;

  constructor(private readonly label: string) {}

  /** A limit, doubled for every firing without progress since (at most 8 times). */
  limit(ms: number): number {
    return ms * this.factor;
  }

  /** The view made progress: back to the normal limits. */
  progressed(): void {
    this.factor = 1;
  }

  /** It fires: the console says why (the caller starts the view again). */
  fire(reason: string, now: number): void {
    this.fires++;
    this.factor = Math.min(8, this.factor * 2);
    this.lastReason = reason;
    this.lastAt = now;
    console.warn(`[viewport] watchdog (${this.label}): ${reason}; starting the view again`);
  }

  /** The reason of a firing in the last few seconds, for the meter. */
  recent(now: number): string | null {
    return now - this.lastAt < WATCHDOG_NOTE_MS ? this.lastReason : null;
  }
}

/** FNV-1a of bytes: which scene a view is (two views with equal keys render the same image). */
export function bytesKey(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  return `${h.toString(16).padStart(8, '0')}:${bytes.length}`;
}

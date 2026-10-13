// When a render stops (UI.md §2.7 "Finish by"): the pass schedule of a
// progressive render with a budget in samples, in time, or whichever comes
// first. Pure apart from the callbacks, so tests drive it with a fake clock
// and a fake engine (tests/render-window.test.ts).
//
// Passes are 1, 2, 4, 8, then 16 samples (tiles.ts `nextPass`) and every
// pixel gets every pass, so a render can only stop between passes. With a
// time budget the schedule measures how long a sample takes and stops at the
// pass boundary nearest the limit: it starts another pass only when that pass
// would end closer to the limit than stopping now (half of it fits). With an
// accurate measurement the end lands within half a pass of the limit, never
// further than one pass.

import type { FinishBy } from '../core/render';
import { nextPass } from './tiles';

export interface PassBudget {
  finishBy: FinishBy;
  maxSamples: number;
  /** Seconds; used by TIME and FIRST. */
  maxSeconds: number;
}

export interface PassHooks {
  /** Milliseconds, monotonic. */
  now(): number;
  /** Renders samples first .. first + count - 1 of every pixel; false when it was interrupted. */
  pass(first: number, count: number): Promise<boolean>;
  /** Asked between passes: true stops with an AbortError. */
  aborted?(): boolean;
  /** After every pass: samples so far, milliseconds so far. */
  progress?(samples: number, elapsedMs: number): void;
}

export interface PassResult {
  samples: number;
  /** Milliseconds from the first pass to the end of the last. */
  elapsedMs: number;
  /** Why it stopped. */
  reason: 'SAMPLES' | 'TIME';
}

export function abortError(): Error {
  return typeof DOMException === 'function' ? new DOMException('aborted', 'AbortError') : Object.assign(new Error('aborted'), { name: 'AbortError' });
}

/** Whether the budget has a time limit, and a sample limit. */
export function budgetLimits(b: PassBudget): { samples: number; ms: number } {
  const samples = b.finishBy === 'TIME' ? 0 : Math.max(1, Math.round(b.maxSamples));
  const ms = b.finishBy === 'SAMPLES' ? Infinity : Math.max(0, b.maxSeconds) * 1000;
  return { samples, ms };
}

/** Runs passes until the budget says stop. Always renders at least one sample. */
export async function runPasses(budget: PassBudget, hooks: PassHooks): Promise<PassResult> {
  const limit = budgetLimits(budget);
  const t0 = hooks.now();
  let done = 0;
  let previous = 0;
  let msPerSample: number | null = null;
  for (;;) {
    const p = nextPass(done, previous, limit.samples);
    if (!p) return { samples: done, elapsedMs: hooks.now() - t0, reason: 'SAMPLES' };
    if (done > 0 && Number.isFinite(limit.ms)) {
      const elapsed = hooks.now() - t0;
      if (elapsed >= limit.ms) return { samples: done, elapsedMs: elapsed, reason: 'TIME' };
      // Another pass only if it would end nearer the limit than stopping here.
      if (msPerSample !== null && elapsed + (msPerSample * p.count) / 2 > limit.ms) return { samples: done, elapsedMs: elapsed, reason: 'TIME' };
    }
    if (hooks.aborted?.()) throw abortError();
    const start = hooks.now();
    const ok = await hooks.pass(p.first, p.count);
    if (hooks.aborted?.()) throw abortError();
    if (!ok) throw new Error('the render was interrupted');
    const took = hooks.now() - start;
    // The first pass also loads caches and warms up: the later, larger passes measure better.
    msPerSample = took / p.count;
    done += p.count;
    previous = p.count;
    hooks.progress?.(done, hooks.now() - t0);
  }
}

/** Progress 0..1 of a budget after `samples` samples and `elapsedMs`. */
export function budgetProgress(b: PassBudget, samples: number, elapsedMs: number): number {
  const limit = budgetLimits(b);
  const bySamples = limit.samples > 0 ? samples / limit.samples : 0;
  const byTime = Number.isFinite(limit.ms) && limit.ms > 0 ? elapsedMs / limit.ms : 0;
  return Math.max(0, Math.min(0.99, Math.max(bySamples, byTime)));
}

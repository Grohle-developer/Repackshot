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
import type { AdaptiveState, Decision } from './adaptive';
import { MAX_PASS_SAMPLES, nextPass } from './tiles';

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

/** Whether the budget has a time limit, and a sample limit (E10: by noise, its samples are the cap of a pixel). */
export function budgetLimits(b: PassBudget): { samples: number; ms: number } {
  const samples = b.finishBy === 'TIME' ? 0 : Math.max(1, Math.round(b.maxSamples));
  const ms = b.finishBy === 'SAMPLES' || b.finishBy === 'NOISE' ? Infinity : Math.max(0, b.maxSeconds) * 1000;
  return { samples, ms };
}

/** The budget of a render's options: without a finish-by (older callers), the samples or the time, whichever first; 0 s is no limit. */
export function budgetOf(o: { finishBy?: FinishBy; maxSamples: number; maxSeconds: number }): PassBudget {
  return { finishBy: o.finishBy ?? (o.maxSeconds > 0 ? 'FIRST' : 'SAMPLES'), maxSamples: o.maxSamples, maxSeconds: o.maxSeconds };
}

/** E10: what an adaptive render's passes need besides a plain one's: the decision at the end of every round. */
export interface AdaptiveHooks extends Omit<PassHooks, 'progress'> {
  /** The round is over: the image decides the next one (AdaptiveState.decide with the accumulation). */
  decide(): Decision;
  /** After every pass: the most samples of a pixel, milliseconds so far, and the seconds to the noise target (-1: unknown). */
  progress?(samples: number, elapsedMs: number, etaSeconds: number): void;
}

/**
 * E10: the passes of an adaptive render (render/adaptive.ts), as the launcher runs them (rt-app `render`): rounds
 * decided by the image at their ends, cut into passes of 1, 2, 4, 8, then 16 samples; it stops when no block needs
 * more (under the noise target, at the cap), or between passes near the time limit (a pass's cost is its blocks').
 * Where a round is cut changes no pixel. Always renders at least one pass.
 */
export async function runAdaptive(budget: PassBudget, state: AdaptiveState, hooks: AdaptiveHooks): Promise<PassResult> {
  const limit = budgetLimits(budget);
  const t0 = hooks.now();
  let previous = 0;
  let msPerUnit: number | null = null;
  let left: { work: number; since: number } | null = null;
  const samples = () => state.minMax().max;
  for (;;) {
    if (state.left === 0) {
      const d = hooks.decide();
      left = d.remaining > 0 ? { work: d.remaining, since: 0 } : null;
      if (state.converged) return { samples: samples(), elapsedMs: hooks.now() - t0, reason: 'SAMPLES' };
    }
    const size = previous <= 0 ? 1 : Math.min(previous * 2, MAX_PASS_SAMPLES);
    const count = Math.min(size, state.left);
    const cost = state.passCost(count);
    if (samples() > 0 && Number.isFinite(limit.ms)) {
      const elapsed = hooks.now() - t0;
      if (elapsed >= limit.ms) return { samples: samples(), elapsedMs: elapsed, reason: 'TIME' };
      if (msPerUnit !== null && elapsed + (msPerUnit * cost) / 2 > limit.ms) return { samples: samples(), elapsedMs: elapsed, reason: 'TIME' };
    }
    if (hooks.aborted?.()) throw abortError();
    const start = hooks.now();
    const ok = await hooks.pass(state.iteration, count);
    if (hooks.aborted?.()) throw abortError();
    if (!ok) throw new Error('the render was interrupted');
    const took = hooks.now() - start;
    if (cost > 0) msPerUnit = took / cost;
    if (left) left.since += cost;
    state.advance(count);
    previous = count;
    const eta = left && msPerUnit !== null && Number.isFinite(left.work) ? (Math.max(0, left.work - left.since) * msPerUnit) / 1000 : -1;
    hooks.progress?.(samples(), hooks.now() - t0, eta);
  }
}

/**
 * E10: the progress 0..1 of an adaptive render after `samples` (its most) and `elapsedMs`, with the engine's estimate
 * of the seconds to the noise target (`eta`, -1 unknown): the elapsed part of elapsed + eta when there is one, else as
 * `budgetProgress` does.
 */
export function adaptiveProgress(b: PassBudget, samples: number, elapsedMs: number, eta: number): number {
  const plain = budgetProgress(b, samples, elapsedMs);
  if (!(eta >= 0) || !Number.isFinite(eta)) return plain;
  const byNoise = elapsedMs / (elapsedMs + eta * 1000);
  return Math.max(0, Math.min(0.99, Math.max(plain, byNoise)));
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

// When a render stops (phase U5, UI.md §2.7 "Finish by"): the pass schedule with a fake clock and a
// fake engine, whose passes take a known time per sample.

import { describe, expect, it } from 'vitest';
import { budgetProgress, runPasses, type PassBudget } from '../src/render/schedule';

/** A fake engine: every sample of a pass costs `msPerSample` (plus a fixed cost per pass) on a fake clock. */
function fakeEngine(msPerSample: number, perPass = 0, warmup = 0) {
  let clock = 0;
  const passes: { first: number; count: number; start: number; end: number }[] = [];
  return {
    passes,
    get clock() {
      return clock;
    },
    hooks: {
      now: () => clock,
      pass: async (first: number, count: number) => {
        const start = clock;
        clock += count * msPerSample + perPass + (passes.length === 0 ? warmup : 0);
        passes.push({ first, count, start, end: clock });
        return true;
      },
    },
  };
}

const budget = (b: Partial<PassBudget>): PassBudget => ({ finishBy: 'SAMPLES', maxSamples: 64, maxSeconds: 10, ...b });

describe('finish by', () => {
  it('samples: exactly the samples, whatever the time', async () => {
    const e = fakeEngine(1000);
    const r = await runPasses(budget({ finishBy: 'SAMPLES', maxSamples: 40, maxSeconds: 1 }), e.hooks);
    expect([r.samples, r.reason]).toEqual([40, 'SAMPLES']);
    // Passes of 1, 2, 4, 8, 16, then the rest; samples in order, none twice.
    expect(e.passes.map((p) => p.count)).toEqual([1, 2, 4, 8, 16, 9]);
    expect(e.passes.map((p) => p.first)).toEqual([0, 1, 3, 7, 15, 31]);
  });

  it('time: stops within one pass of the limit, for any speed and any limit', async () => {
    for (const ms of [0.7, 3, 25, 130, 900]) {
      for (const seconds of [1, 2.5, 7, 30]) {
        const e = fakeEngine(ms, ms * 0.3);
        const r = await runPasses(budget({ finishBy: 'TIME', maxSeconds: seconds }), e.hooks);
        const limit = seconds * 1000;
        const last = e.passes[e.passes.length - 1];
        const longest = Math.max(...e.passes.map((p) => p.end - p.start));
        expect(r.reason).toBe('TIME');
        expect(Math.abs(e.clock - limit), `${ms} ms/sample, ${seconds} s`).toBeLessThanOrEqual(longest);
        // And no sample limit applies.
        expect(r.samples).toBe(last.first + last.count);
      }
    }
  });

  it('time: with a steady engine it ends within half a pass of the limit', async () => {
    const e = fakeEngine(10);
    await runPasses(budget({ finishBy: 'TIME', maxSeconds: 5 }), e.hooks);
    // 16-sample passes of 160 ms: the end is the pass boundary nearest 5000 ms.
    expect(Math.abs(e.clock - 5000)).toBeLessThanOrEqual(80);
  });

  it('time: a slow first pass still gives at least one sample, and the limit is respected after it', async () => {
    const e = fakeEngine(5, 0, 4000);
    const r = await runPasses(budget({ finishBy: 'TIME', maxSeconds: 1 }), e.hooks);
    expect(r.samples).toBe(1);
    expect(e.passes).toHaveLength(1);
  });

  it('time: time spent between passes counts too, and the render stops at the limit itself', async () => {
    // Passes that cost nothing measured, with a quarter of a second around each one (conversion, reports).
    let clock = 0;
    let passes = 0;
    const r = await runPasses(budget({ finishBy: 'TIME', maxSeconds: 1 }), {
      now: () => clock,
      pass: async () => (passes++, true),
      progress: () => (clock += 250),
    });
    expect([r.samples, passes, clock]).toEqual([15, 4, 1000]);
  });

  it('whichever comes first: the samples when they are reached before the time, the time otherwise', async () => {
    const fast = fakeEngine(1);
    expect(await runPasses(budget({ finishBy: 'FIRST', maxSamples: 64, maxSeconds: 10 }), fast.hooks)).toMatchObject({ samples: 64, reason: 'SAMPLES' });
    const slow = fakeEngine(200);
    const r = await runPasses(budget({ finishBy: 'FIRST', maxSamples: 64, maxSeconds: 2 }), slow.hooks);
    expect(r.reason).toBe('TIME');
    expect(r.samples).toBeLessThan(64);
    expect(Math.abs(slow.clock - 2000)).toBeLessThanOrEqual(16 * 200);
  });

  it('stops with an AbortError between passes, and fails when a pass is interrupted', async () => {
    const e = fakeEngine(1);
    let n = 0;
    await expect(runPasses(budget({ maxSamples: 64 }), { ...e.hooks, aborted: () => ++n > 3 })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(runPasses(budget({}), { now: () => 0, pass: async () => false })).rejects.toThrow(/interrupted/);
  });

  it('progress grows with the samples or the time', () => {
    expect(budgetProgress(budget({ maxSamples: 100 }), 50, 99999)).toBe(0.5);
    expect(budgetProgress(budget({ finishBy: 'TIME', maxSeconds: 10 }), 50, 2500)).toBe(0.25);
    expect(budgetProgress(budget({ finishBy: 'FIRST', maxSamples: 100, maxSeconds: 10 }), 10, 5000)).toBe(0.5);
    expect(budgetProgress(budget({ maxSamples: 10 }), 10, 0)).toBe(0.99);
  });
});

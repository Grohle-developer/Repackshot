// The AI guard in WebAssembly (phase X3a) against the native one: the scenarios of tests/fixtures/ai-guard.json
// (written and pinned by `cargo test -p rt-post`) run through src/ai/post-wasm.ts and the real post.wasm must give
// the same image bits, the same model inputs and the same report JSON. The report's shape is checked against
// GuardReport (src/core/ai.ts) without the module too.
//
// post.wasm comes from `npm run engine:build` (public/engine/post.wasm, not in git). Without it the parity tests are
// skipped, unless REPACK_REQUIRE_POST_WASM is set (CI's engine job sets it).

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, MAX_STRENGTH, RETRY_FACTOR, type GuardCheck, type GuardReport } from '../src/core/ai';
import { encodeJob, GUARD_TOLERANCE_KEYS, PostError, PostGuard, runGuarded, type PostSession, type TileRequest } from '../src/ai/post-wasm';
import * as fx from './ai-fixture';

interface FixtureScenario {
  name: string;
  tiles: number;
  imageHash: string;
  givenHash: string;
  report: unknown;
}

const FIXTURE_TEXT = readFileSync('tests/fixtures/ai-guard.json', 'utf8');
const FIXTURE = JSON.parse(FIXTURE_TEXT) as { scenarios: FixtureScenario[] };

const WASM_PATHS = [process.env.REPACK_POST_WASM, 'public/engine/post.wasm', 'engine/target/wasm32-unknown-unknown/release/rt_post_wasm.wasm'].filter(
  (p): p is string => !!p,
);
const WASM = WASM_PATHS.find((p) => existsSync(p)) ?? null;
if (!WASM && process.env.REPACK_REQUIRE_POST_WASM) throw new Error('post.wasm is required: npm run engine:build');

const GUARD_REPORT_KEYS = ['verdict', 'usedFraction', 'attempts', 'size', 'outside', 'edges', 'detail', 'focus', 'materials', 'reason', 'modelKey', 'runtime', 'seed', 'seconds'];
const CHECK_KEYS = ['ok', 'value', 'limit'];
const MATERIAL_KEYS = ['materialId', 'name', 'deltaEMean', 'deltaEP95', 'limit', 'ok'];

/** Every field of GuardReport with its type, nothing else; `reason` optional. Returns what is wrong. */
function reportProblems(r: unknown): string[] {
  const out: string[] = [];
  if (typeof r !== 'object' || r === null) return ['not an object'];
  const o = r as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!GUARD_REPORT_KEYS.includes(k)) out.push(`extra key ${k}`);
  for (const k of GUARD_REPORT_KEYS) if (k !== 'reason' && !(k in o)) out.push(`missing ${k}`);
  if (!['ACCEPTED', 'LIMITED', 'REJECTED'].includes(o.verdict as string)) out.push(`verdict ${String(o.verdict)}`);
  for (const k of ['usedFraction', 'attempts', 'seed', 'seconds']) if (typeof o[k] !== 'number') out.push(`${k} is not a number`);
  for (const k of ['modelKey', 'runtime']) if (typeof o[k] !== 'string') out.push(`${k} is not a string`);
  if ('reason' in o && typeof o.reason !== 'string') out.push('reason is not a string');
  for (const k of ['size', 'outside', 'edges', 'detail', 'focus']) {
    const c = o[k] as Record<string, unknown>;
    if (typeof c !== 'object' || c === null) {
      out.push(`${k} is not a check`);
      continue;
    }
    if (Object.keys(c).sort().join() !== [...CHECK_KEYS].sort().join()) out.push(`${k} keys ${Object.keys(c)}`);
    if (typeof c.ok !== 'boolean' || typeof c.value !== 'number' || typeof c.limit !== 'number') out.push(`${k} types`);
  }
  if (!Array.isArray(o.materials)) out.push('materials is not an array');
  else
    for (const m of o.materials as Record<string, unknown>[]) {
      if (Object.keys(m).sort().join() !== [...MATERIAL_KEYS].sort().join()) out.push(`material keys ${Object.keys(m)}`);
      if (typeof m.materialId !== 'number' || typeof m.name !== 'string' || typeof m.ok !== 'boolean') out.push('material types');
      for (const k of ['deltaEMean', 'deltaEP95', 'limit']) if (typeof m[k] !== 'number') out.push(`material ${k}`);
    }
  return out;
}

describe('the guard report as rt-post writes it', () => {
  it('has exactly the shape of GuardReport, in every verdict', () => {
    expect(FIXTURE.scenarios.map((s) => s.name)).toEqual(['untouched', 'forbidden', 'strong', 'limited', 'rejected']);
    const verdicts = new Set<string>();
    for (const s of FIXTURE.scenarios) {
      expect(reportProblems(s.report), s.name).toEqual([]);
      const r = s.report as GuardReport;
      verdicts.add(r.verdict);
      // The typed view reads like any GuardReport.
      const checks: GuardCheck[] = [r.size, r.outside, r.edges, r.detail, r.focus];
      expect(checks.every((c) => typeof c.ok === 'boolean')).toBe(true);
      if (r.verdict === 'REJECTED') expect(r.usedFraction).toBe(0);
      if (r.verdict === 'ACCEPTED') expect(r.usedFraction).toBe(1);
      if (r.verdict !== 'ACCEPTED') expect(typeof r.reason).toBe('string');
    }
    expect([...verdicts].sort()).toEqual(['ACCEPTED', 'LIMITED', 'REJECTED']);
    // A shape check that would accept anything would be no check.
    expect(reportProblems({ ...(FIXTURE.scenarios[0].report as object), extra: 1 })).toEqual(['extra key extra']);
    const { size: _size, ...noSize } = FIXTURE.scenarios[0].report as Record<string, unknown>;
    expect(reportProblems(noSize)).toContain('missing size');
  });

  it('the fixture describes what each scenario is for', () => {
    const by = Object.fromEntries(FIXTURE.scenarios.map((s) => [s.name, s.report as GuardReport]));
    expect(by.untouched.attempts).toBe(0);
    expect(by.limited.verdict).toBe('LIMITED');
    expect(by.limited.usedFraction).toBeCloseTo(RETRY_FACTOR, 6);
    expect(by.rejected.size.ok).toBe(false);
    expect(by.forbidden.outside.value).toBe(0);
    // The LED is locked: it never changes.
    expect(by.strong.materials.find((m) => m.name === 'LED')).toMatchObject({ deltaEMean: 0, deltaEP95: 0 });
  });
});

describe('the binary job', () => {
  it('is RPJ1 with the controls clamped and the overrides named', () => {
    const job = { ...fx.job({ ...fx.FULL, light: 250, bounce: -3 }), tolerances: { edgesPx: 0.5 } };
    const bytes = encodeJob(job);
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RPJ1');
    expect([view.getUint32(4, true), view.getUint32(8, true), view.getUint32(12, true)]).toEqual([fx.W, fx.H, 1]);
    // intervention, light (clamped to 100), bounce (clamped to 0).
    expect([view.getUint32(20, true), view.getUint32(24, true), view.getUint32(28, true)]).toEqual([100, 100, 0]);
    expect(new TextDecoder().decode(bytes)).toContain('edgesPx');
    expect(GUARD_TOLERANCE_KEYS).toContain('edgesPx');
  });
});

// The guard runs on a 1160 x 340 image, several attempts per scenario: give it time on a loaded machine.
describe.skipIf(!WASM)('post.wasm against the native guard', { timeout: 300_000 }, () => {
  const load = () => PostGuard.fromBytes(readFileSync(WASM!));

  /** Runs a scenario through the wrapper and the driver: the fixture's line, and what the model was called with. */
  async function scenario(guard: PostGuard, s: ReturnType<typeof fx.scenarios>[number], world: fx.Scene) {
    const session = guard.open(s.job, world.image, world.passes);
    try {
      let given = 0x811c9dc5;
      const controls = session.plan.tiles.map((_, i) => session.control(i));
      for (const c of controls) given = fx.fnvBytes(given, c.input);
      for (const c of controls) given = fx.fnvBytes(fx.fnvBytes(given, c.edges), c.depth);
      const calls: TileRequest[] = [];
      const result = await runGuarded(session, (r) => {
        calls.push(r);
        return s.model(r, session.plan.tiles[r.tile]);
      });
      const line = `{"name":"${s.name}","tiles":${session.plan.tiles.length},"imageHash":"${fx.hex(fx.fnvF32(result.image.rgba))}","givenHash":"${fx.hex(given)}","report":${result.reportJson}}`;
      return { line, result, calls, plan: session.plan, session };
    } finally {
      session.close();
    }
  }

  it('gives the native image bits, model inputs and report JSON in every scenario', async () => {
    const guard = await load();
    const world = fx.scene();
    const lines: string[] = [];
    for (const s of fx.scenarios()) lines.push((await scenario(guard, s, world)).line);
    expect(`{"scenarios":[\n${lines.join(',\n')}\n]}\n`).toBe(FIXTURE_TEXT);
  });

  it('plans with the contract constants and calls the model at each attempt strength', async () => {
    const guard = await load();
    const world = fx.scene();
    const [, , , limited] = fx.scenarios();
    const { plan, calls, result } = await scenario(guard, limited, world);
    expect(plan.maxStrength).toBe(MAX_STRENGTH);
    expect(plan.maxAttempts).toBe(MAX_ATTEMPTS);
    expect(plan.retryFactor).toBe(RETRY_FACTOR);
    expect(plan.tiles).toHaveLength(2);
    for (const t of plan.tiles) expect([t.paddedWidth % 16, t.paddedHeight % 16]).toEqual([0, 0]);
    expect(plan.tolerances.edgesPx).toBe(fx.LIMITED_EDGES_PX);
    expect(plan.tolerances.deltaEMean).toBe(2);
    // Two attempts, two tiles each, at the plan's strengths.
    expect(calls.map((c) => [c.tile, c.attempt])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(calls[2].strength).toBeCloseTo(MAX_STRENGTH * RETRY_FACTOR, 6);
    expect(result.report.verdict).toBe('LIMITED');
    expect(result.image.width * result.image.height * 4).toBe(result.image.rgba.length);
  });

  it('intervention 0: the model is never called and the image is the input, bit for bit', async () => {
    const guard = await load();
    const world = fx.scene();
    const session: PostSession = guard.open(fx.job({ ...fx.FULL, intervention: 0 }), world.image, world.passes);
    expect(session.plan.tiles).toEqual([]);
    const result = await runGuarded(session, () => {
      throw new Error('the model ran');
    });
    session.close();
    expect(result.report.verdict).toBe('ACCEPTED');
    expect(result.report.attempts).toBe(0);
    expect(new Uint32Array(result.image.rgba.buffer)).toEqual(new Uint32Array(world.image.rgba.buffer));
  });

  it('a wrong-sized tile rejects at once and delivers the engine image at the job size', async () => {
    const guard = await load();
    const world = fx.scene();
    const [, , , , rejected] = fx.scenarios();
    const { result, calls } = await scenario(guard, rejected, world);
    expect(calls).toHaveLength(2);
    expect(result.report.verdict).toBe('REJECTED');
    expect(result.report.size).toEqual({ ok: false, value: 0, limit: 1 });
    expect([result.image.width, result.image.height]).toEqual([fx.W, fx.H]);
    expect(result.image.rgba).toEqual(world.image.rgba);
  });

  it('refuses bad input with a reason', async () => {
    const guard = await load();
    const world = fx.scene();
    expect(guard.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(() => guard.open({ ...fx.job(fx.FULL), width: 0 }, world.image, world.passes)).toThrow(/no pixels/);
    expect(() => guard.open(fx.job(fx.FULL), world.image, { ...world.passes, partId: undefined })).toThrow(PostError);
    const short = { ...world.passes, materialId: new Uint32Array(10) };
    expect(() => guard.open(fx.job(fx.FULL), world.image, short)).toThrow(/wrong size/);
    expect(() => guard.open(fx.job(fx.FULL), { ...world.image, width: 3 }, world.passes)).toThrow(/the image is 3x340/);
    const session = guard.open(fx.job(fx.FULL), world.image, world.passes);
    expect(() => session.accept(0)).toThrow(/missing input/);
    expect(() => session.control(9)).toThrow(/no tile 9/);
    session.close();
    session.close();
  });

  it('stops when aborted', async () => {
    const guard = await load();
    const world = fx.scene();
    const session = guard.open(fx.job(fx.FULL), world.image, world.passes);
    const stop = new AbortController();
    const stages: string[] = [];
    const run = runGuarded(
      session,
      (r) => {
        stop.abort();
        return fx.forbidden(r, session.plan.tiles[r.tile]);
      },
      (p) => stages.push(p.stage),
      stop.signal,
    );
    await expect(run).rejects.toThrow();
    expect(stages).toEqual(['INFERENCE']);
    session.close();
  });
});

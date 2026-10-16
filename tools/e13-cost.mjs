#!/usr/bin/env node
// The cost of manifold next-event estimation (phase E13; not part of `npm run qa`): the engine of before the phase
// against this one, on the same scenes, in alternating rounds so that the load of a shared machine weighs on both
// alike.
//
//   node tools/e13-cost.mjs --rt-before <old rt> [--scenes out/e13-sheet/e13] [--samples 32] [--threads 2]
//        [--rounds 5] [--only e5-bottle,milk-bottle]
//
// 1. builds the native engine if `engine/target/release/rt` is missing;
// 2. needs the scenes as RSB files: `rt --e13-sheet <dir>` writes them into `<dir>/e13/` (the E5 bottle, the milk
//    bottle, the water glass and the glass ball); `--scenes` points there;
// 3. renders each `--rounds` times with the old binary and then the new one, one after the other, and keeps what
//    `rt` says (`rendered N spp, R rays in S s`): the ratio of each pair's render times is the cost of that round;
// 4. prints, per scene, the times of each round, the median ratio and the rays per camera sample of both, and writes
//    `<scenes>/cost.json`.

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SCENES = resolve(ROOT, opt('scenes', 'out/e13-sheet/e13'));
const SAMPLES = opt('samples', '32');
const THREADS = opt('threads', '2');
const ROUNDS = Math.max(1, Number(opt('rounds', '5')));
const ONLY = opt('only', 'e5-bottle,milk-bottle,water-glass,glass-ball').split(',').filter(Boolean);
const RT = join(ROOT, 'engine', 'target', 'release', 'rt');
const RT_BEFORE = opt('rt-before', '') ? resolve(ROOT, opt('rt-before', '')) : '';
/** The cost criterion (ROADMAP E13: at most 1.3 times on E5's bottle). */
const COST_LIMIT = 1.3;

if (!RT_BEFORE || !existsSync(RT_BEFORE)) {
  console.error('--rt-before <the rt binary of before E13> is required');
  process.exit(2);
}

function run(cmd, cmdArgs, cwd = ROOT) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    console.error(`${cmd} ${cmdArgs.join(' ')} exited with ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

if (!existsSync(RT)) run('cargo', ['build', '--release', '-p', 'rt-cli'], join(ROOT, 'engine'));

/** Renders `<SCENES>/<key>.rsb` with the engine `rt`: seconds and rays, as `rt` reports them. */
function render(rt, key) {
  const said = run(rt, [join(SCENES, `${key}.rsb`), '-o', join(SCENES, `cost-${key}.png`), '--samples', SAMPLES,
    '--threads', THREADS]);
  const m = /rendered (\d+) spp, (\d+) rays in ([\d.]+) s/.exec(said);
  const size = /image (\d+)x(\d+)/.exec(said);
  if (!m || !size) throw new Error(`unexpected output of ${rt}:\n${said}`);
  return { seconds: Number(m[3]), rays: Number(m[2]), camera: Number(size[1]) * Number(size[2]) * Number(m[1]) };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const out = { samples: Number(SAMPLES), threads: Number(THREADS), rounds: ROUNDS, scenes: [] };
for (const key of ONLY) {
  if (!existsSync(join(SCENES, `${key}.rsb`))) {
    console.error(`no ${key}.rsb in ${SCENES}: run rt --e13-sheet first`);
    process.exit(2);
  }
  const rounds = [];
  for (let i = 0; i < ROUNDS; i++) {
    const before = render(RT_BEFORE, key);
    const after = render(RT, key);
    rounds.push({ before, after, ratio: after.seconds / before.seconds });
    console.log(`${key} round ${i + 1}: ${before.seconds.toFixed(2)} s -> ${after.seconds.toFixed(2)} s (` +
      `${(after.seconds / before.seconds).toFixed(3)} x)`);
  }
  const ratio = median(rounds.map((r) => r.ratio));
  const raysBefore = rounds[0].before.rays / rounds[0].before.camera;
  const raysAfter = rounds[0].after.rays / rounds[0].after.camera;
  out.scenes.push({ key, rounds, median: ratio, raysPerSampleBefore: raysBefore, raysPerSampleAfter: raysAfter });
  const verdict = key === 'e5-bottle' ? (ratio <= COST_LIMIT ? ' (within the 1.3 x bound)' : ' (OVER the bound)') : '';
  console.log(`${key}: median ${ratio.toFixed(3)} x${verdict}; rays per camera sample ${raysBefore.toFixed(2)} -> ` +
    `${raysAfter.toFixed(2)}`);
}
writeFileSync(join(SCENES, 'cost.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${join(SCENES, 'cost.json')}`);

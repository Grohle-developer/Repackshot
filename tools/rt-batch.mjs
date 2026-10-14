// Shared by tools/setup-thumbs.mjs and tools/sets-sheet.mjs (L6): writes the scenes with the application's own code
// (tests/setup-thumbs-dump.test.ts, run by vitest, which reads the TypeScript) and renders them with the native `rt`.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The native renderer: REPACK_RT, else the engine's release build, else /home/user/bin/rt (this environment). */
export function findRt(root) {
  const candidates = [process.env.REPACK_RT, join(root, 'engine', 'target', 'release', 'rt'), '/home/user/bin/rt'].filter(Boolean);
  const rt = candidates.find((p) => existsSync(p));
  if (!rt) throw new Error('no rt: build it with `cargo build --release -p rt-cli` in engine/ or set REPACK_RT');
  return resolve(rt);
}

export function run(cmd, args, { cwd, env = {}, quiet = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    process.stderr.write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
    throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
  }
  if (!quiet) process.stdout.write(r.stdout ?? '');
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

/** Writes the scenes of `mode` into `dir` and returns its scenes.json. */
export function dumpScenes(root, dir, mode, extra = {}) {
  run('npx', ['vitest', 'run', 'tests/setup-thumbs-dump.test.ts'], { cwd: root, quiet: true, env: { REPACKSHOT_THUMBS_DIR: dir, REPACKSHOT_THUMBS_MODE: mode, ...extra } });
  return JSON.parse(readFileSync(join(dir, 'scenes.json'), 'utf8'));
}

/** Renders one RSB to a PNG with denoise; returns the seconds `rt` reports for the samples. */
export function render(rt, rsb, png, extra = []) {
  const out = run(rt, [rsb, '-o', png, '--denoise', ...extra], { quiet: true });
  const m = /rendered .* in ([0-9.]+) s/.exec(out);
  const d = /denoised in ([0-9.]+) s/.exec(out);
  return (m ? Number(m[1]) : 0) + (d ? Number(d[1]) : 0);
}

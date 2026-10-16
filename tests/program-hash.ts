// The hash of the cross test of the material programs (M3b): tests/material-program-cross.test.ts pins the
// reference's values with it, tests/programs-engine.test.ts runs the engine's programs to rt-core's pins with it, and
// rt-core's program/tests.rs `outputs_hash` is the same.

import type { ProgramRunner, ShadingPoint } from '../src/core/material-interp';

/**
 * `outputsHash` of core/material-interp.ts with every NaN as the one quiet NaN 0x7FC00000: IEEE 754 leaves the sign and
 * the payload of a NaN result to the machine, and WebAssembly to the engine that runs it (under Node's WASI one case gave
 * a NaN of the other sign run among all of rt-core's tests, and the reference's run alone), while nothing the engine does
 * with a value reads them (a NaN output keeps the file's value, comparisons and `is_nan` do not see the sign). Every other bit counts. rt-core's `outputs_hash` is the
 * same; the examples' values have no NaN, so they are M3a's pins.
 */
export function crossHash(run: ProgramRunner, points: readonly ShadingPoint[]): string {
  const buf = new Float32Array(3);
  const bits = new Uint32Array(buf.buffer);
  let h = 0x811c9dc5;
  const mix = (u: number) => {
    for (let k = 0; k < 4; k++) {
      h ^= (u >>> (k * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  };
  const types = run.program.outputs.map((o) => (o.kind === 'F' || o.kind === 'FC' ? 1 : 3));
  for (const pt of points) {
    run.setPoint(pt);
    run.run();
    run.program.outputs.forEach((o, j) => {
      run.read(o, buf);
      for (let c = 0; c < types[j]; c++) mix(Number.isNaN(buf[c]) ? 0x7fc00000 : bits[c]);
    });
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

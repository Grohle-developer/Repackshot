// The rigid body simulator through the page's own code (phase S2): the drop scene of rt-phys, as the native tests
// write it (tests/fixtures/phys-drop.json: its PHY1 bytes and the pose hashes they pin), stepped by the real rt.wasm
// through render/phys-wasm.ts, must give the native hashes at every checkpoint: native = wasm. Skipped without
// rt.wasm (npm run engine:build) unless REPACK_REQUIRE_RT_WASM is set.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasPhysExports, PhysWorld, POSE_FLOATS, type PhysExports } from '../src/render/phys-wasm';
import { RT_WASM } from './wasm-engine';

interface Fixture {
  steps: number[];
  hashes: string[];
  bodies: number;
  scene: string;
}

const fixture = JSON.parse(readFileSync('tests/fixtures/phys-drop.json', 'utf8')) as Fixture;

async function physics(): Promise<PhysExports> {
  const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
  if (!hasPhysExports(instance.exports)) throw new Error(`${RT_WASM} has no simulator: npm run engine:build`);
  return instance.exports;
}

describe.skipIf(!RT_WASM)('the simulator in rt.wasm', () => {
  it('steps the drop scene to the native pose hashes', async () => {
    const rt = await physics();
    const world = new PhysWorld(rt, new Uint8Array(Buffer.from(fixture.scene, 'base64')), fixture.bodies);
    try {
      expect(world.bodies).toBe(fixture.bodies);
      expect([...world.ids]).toEqual([0, 1, 2]);
      let at = 0;
      fixture.steps.forEach((steps, i) => {
        world.step(steps - at);
        at = steps;
        expect(world.steps).toBe(steps);
        expect(`0x${world.hash.toString(16).padStart(8, '0')}`, `after ${steps} steps`).toBe(fixture.hashes[i]);
      });
      // Two seconds in, the three bodies are at rest on the floor and the block.
      expect(world.settled).toBe(true);
      expect(world.awake).toBe(0);
      const poses = world.poses();
      expect(poses.length).toBe(3 * POSE_FLOATS);
      // Every rotation is a unit quaternion; every body is above the floor.
      for (let b = 0; b < 3; b++) {
        const [, , z, x, y, qz, w] = poses.subarray(b * POSE_FLOATS, (b + 1) * POSE_FLOATS);
        expect(Math.hypot(x, y, qz, w)).toBeCloseTo(1, 5);
        expect(z).toBeGreaterThan(10);
      }
    } finally {
      world.free();
    }
  });

  it('says why a scene does not load', async () => {
    const rt = await physics();
    expect(() => new PhysWorld(rt, new TextEncoder().encode('RSB1 not physics'), 0)).toThrow(/PHY1/);
  });
});

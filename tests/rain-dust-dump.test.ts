// Writes the RSB files of the rain and dust contact sheet (phase S3b) that tools/rain-dust-sheet.mjs renders with the
// native `rt`, through the page's own code and the real rt.wasm: the front glass of the example's camera fed by the
// scene, its simulation run in the engine (`wet_*`, as the physics worker runs it), recorded into the camera's PHYSICS
// clip (core/wet.ts, the cache), and the scene written at each instant with the frame of the recording the pose shows
// (the GLAS section drop by drop). Skipped unless REPACKSHOT_RAIN_DUST_DIR is set, so `npm run qa` writes nothing; the
// tool sets the variable itself.
//
//   REPACKSHOT_RAIN_DUST_DIR=out/rain-dust-sheet npx vitest run tests/rain-dust-dump.test.ts
//
// The rows (ROADMAP S3, the sheet of its criterion, the part about the lens; the bottle under the rain is S3c):
//   rain   the example through a 28 mm lens at f/8 (the S3 parity framing), rain blown at the camera by a 6 m/s wind, at
//          0, 2, 5 and 15 s; the camera looks a little down, so without the wind its glass would stay dry;
//   dust   the camera looking 60° up (the glass faces up 30°, below the angle of repose) under dust motes and under a
//          dust cloud's density, at 0, 30 and 120 s;
//   clean  the same two photos without the glass.
// Each shot also writes the pane's drops and motes (JSON) for the sheet's drawing of the glass.
//
// Optional: REPACKSHOT_RAIN_DUST_SIZE (WxH, default 512x288), REPACKSHOT_RAIN_DUST_SPP (default 64).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/animation';
import { activeCamera } from '../src/core/camera';
import { windVector, type EffectPatch } from '../src/core/effects';
import { newFrontGlass, opticsOf } from '../src/core/optics';
import { glassClip } from '../src/core/physics';
import type { ProjectState } from '../src/core/store';
import { capAngleDeg, glassFrame, GlassTrackWriter, wetBytes, wetKey, wetSpec } from '../src/core/wet';
import type { EffectKind } from '../src/data/effects';
import { glassFrameRsb, projectScene, writeRsb } from '../src/io/rsb';
import { engineGlassPane, hasGlassExports } from '../src/render/glass-pane';
import { hasWetExports, WetSim } from '../src/render/phys-wasm';
import { apply, exampleState } from './helpers';
import { RT_WASM } from './wasm-engine';

const dir = process.env.REPACKSHOT_RAIN_DUST_DIR;
const [width, height] = (process.env.REPACKSHOT_RAIN_DUST_SIZE ?? '512x288').split('x').map(Number);
const spp = Number(process.env.REPACKSHOT_RAIN_DUST_SPP ?? 64);

/** The example through a 28 mm lens at f/8, as close as the S3 parity scene (the product fills the frame). */
function framed(lookUp = false): ProjectState {
  let s = exampleState();
  const cam = activeCamera(s);
  const k = 28 / cam.focalMm;
  const patch = lookUp
    ? { focalMm: 28, fstop: 8, lens: null, elevation: -60, distance: 600, target: [cam.target[0], cam.target[1], 900] as [number, number, number], focusDistance: 600 }
    : { focalMm: 28, fstop: 8, lens: null, distance: cam.distance * k, focusDistance: cam.distance * k };
  s = apply(s, { type: 'camera/set', id: cam.id, patch });
  return s;
}

function withGlass(s: ProjectState): ProjectState {
  const cam = activeCamera(s);
  return apply(s, { type: 'camera/set', id: cam.id, patch: { optics: { ...opticsOf(cam), frontGlass: { ...newFrontGlass(), source: 'SCENE', seed: 3 } } } });
}

function withEffect(s: ProjectState, preset: EffectKind, patch: EffectPatch = {}): ProjectState {
  s = apply(s, { type: 'effect/add', preset });
  const id = s.effects[s.effects.length - 1].id;
  return Object.keys(patch).length > 0 ? apply(s, { type: 'effect/set', id, patch }) : s;
}

interface Shot {
  file: string;
  row: string;
  label: string;
  t: number;
  drops: number;
  motes: number;
  dropCover: number;
  dustCover: number;
  samples: number;
}

describe.skipIf(!dir)('the rain and dust sheet: its scenes', () => {
  it('writes them', async () => {
    expect(RT_WASM).not.toBeNull();
    mkdirSync(dir!, { recursive: true });
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    if (!hasWetExports(rt) || !hasGlassExports(rt)) throw new Error('this rt.wasm has no front glass (npm run engine:build)');
    const shots: Shot[] = [];
    const view = { width, height, maxSamples: spp, maxSeconds: 0, drops: true, glassLayout: true };

    /** Simulates the glass of `s` for `seconds` at `fps`, records it into its clip, writes a shot at each of `times`. */
    const run = (row: string, label: string, s0: ProjectState, seconds: number, fps: number, times: number[]) => {
      const cam = activeCamera(s0);
      const frame = glassFrameRsb(s0, cam.id)!;
      const pane = engineGlassPane(rt, frame.rsb)!;
      const spec = wetSpec(s0, frame.axes, pane.halfExtentMm, cam.optics!.frontGlass!.seed)!;
      const bytes = wetBytes(spec);
      const sim = new WetSim(rt, bytes);
      const w = new GlassTrackWriter(cam.id, fps, wetKey(bytes), capAngleDeg(spec));
      w.push(sim.frame());
      const steps = 240 / fps;
      for (let k = 1; k <= seconds * fps; k++) {
        sim.step(steps);
        w.push(sim.frame());
      }
      sim.free();
      const track = w.track();
      const s = apply(s0, { type: 'physics/begin', clips: [glassClip('rain-dust', 0, track)] });
      for (const t of times) {
        const file = `${row}-${String(t).padStart(3, '0')}s`;
        writeFileSync(join(dir!, `${file}.rsb`), writeRsb(projectScene(s, { ...view, pose: evaluate(s, t) }).scene));
        const g = glassFrame(track, t * fps)!;
        const area = 4 * pane.halfExtentMm * pane.halfExtentMm;
        let dropArea = 0;
        for (let i = 2; i < g.drops.length; i += 3) dropArea += Math.PI * g.drops[i] ** 2;
        let dustArea = 0;
        for (let i = 2; i < g.motes.length; i += 3) dustArea += Math.PI * g.motes[i] ** 2;
        writeFileSync(join(dir!, `${file}.json`), JSON.stringify({ halfExtentMm: pane.halfExtentMm, distanceMm: pane.distanceMm, drops: Array.from(g.drops), motes: Array.from(g.motes) }));
        shots.push({ file, row, label: `${label}, ${t} s`, t, drops: g.drops.length / 3, motes: g.motes.length / 3, dropCover: dropArea / area, dustCover: dustArea / area, samples: spp });
      }
    };

    // Rain blown at the camera: the wind blows from the product towards the lens.
    const looking = framed();
    const cam = activeCamera(looking);
    const towards = (((cam.azimuth - 90) % 360) + 360) % 360;
    run('rain', 'Rain blown at the lens (6 m/s)', withGlass(withEffect(looking, 'RAIN', { wind: windVector(6, towards) })), 15, 24, [0, 2, 5, 15]);
    // Dust on a glass facing up 30°.
    const up = framed(true);
    run('dust', 'Dust motes, the lens looking 60° up', withGlass(withEffect(up, 'DUST_MOTES')), 120, 2, [0, 30, 120]);
    // Without its wind (the preset's breeze blows away from this lens).
    run('cloud', 'A dust cloud’s density without wind, the lens looking 60° up', withGlass(withEffect(up, 'DUST_CLOUD', { wind: [0, 0, 0] })), 120, 2, [0, 30, 120]);
    // The clean photos.
    for (const [file, label, s] of [
      ['clean-rain', 'No glass (the rain row’s photo)', withEffect(looking, 'RAIN', { wind: windVector(6, towards) })],
      ['clean-up', 'No glass (the dust rows’ photo)', withEffect(up, 'DUST_MOTES')],
    ] as const) {
      writeFileSync(join(dir!, `${file}.rsb`), writeRsb(projectScene(s, view).scene));
      shots.push({ file, row: 'clean', label, t: 0, drops: 0, motes: 0, dropCover: 0, dustCover: 0, samples: spp });
    }
    writeFileSync(join(dir!, 'shots.json'), JSON.stringify({ width, height, shots }, null, 2));
    expect(existsSync(join(dir!, 'shots.json'))).toBe(true);
    expect(shots.find((x) => x.file === 'rain-015s')!.drops).toBeGreaterThan(0);
  }, 600_000);
});

// S3g: writes the scenes of the water sheet that tools/water-sheet.mjs renders with the native `rt`, through the page's
// own code and the real rt.wasm: the example bottle under the default Rain with On the parts (the falling rain hidden
// from the camera, so the parts read), its parts simulated in the engine (`wpt_*`, as the physics worker runs them) for
// 20 s, recorded into the scene's PHYSICS clip, and the scene written at 2, 5, 10 and 20 s from five cameras: the bottle
// whole, and close on four places, each square-on to its surface and 30 mm across: the body where it stands vertical,
// the shoulder, the paper label, the top of the cap. Each close-up says how many millimetres a pixel spans at its
// surface (the sheet's scale bar). It also writes the water table's input (`rt --water-table`): the families of
// src/data/wettability.ts and the rain the page gives the engine. Skipped unless REPACKSHOT_WATER_DIR is set, so
// `npm run qa` writes nothing; the tool sets the variable itself.
//
//   REPACKSHOT_WATER_DIR=out/water-sheet npx vitest run tests/water-dump.test.ts
//
// Optional: REPACKSHOT_WATER_SIZE (WxH of the close-ups, default 512x384), REPACKSHOT_WATER_SPP (default 64).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/animation';
import { activeCamera, cameraPosition } from '../src/core/camera';
import type { EffectPatch } from '../src/core/effects';
import { partsClip } from '../src/core/physics';
import type { ProjectState } from '../src/core/store';
import { parseLayout, partsFrame, PartsTrackWriter, wetPartsKey, wetPartsSpec, wptBytes, writtenParts } from '../src/core/wet-parts';
import type { EffectKind } from '../src/data/effects';
import { WETTABILITY } from '../src/data/wettability';
import { projectScene, writeRsb } from '../src/io/rsb';
import { hasPartsExports, PartsSim } from '../src/render/phys-wasm';
import { apply, exampleState } from './helpers';
import { RT_WASM } from './wasm-engine';

const dir = process.env.REPACKSHOT_WATER_DIR;
const [width, height] = (process.env.REPACKSHOT_WATER_SIZE ?? '512x384').split('x').map(Number);
const spp = Number(process.env.REPACKSHOT_WATER_SPP ?? 64);

/** The seconds the shots are at, and how long the run is. */
const TIMES = [2, 5, 10, 20];
const SECONDS = 20;
const FPS = 24;
/** The width of a close-up at its surface, mm, and its lens. */
const FIELD_MM = 30;
const FOCAL_MM = 100;

/**
 * The places of the close-ups (the example's geometry, src/core/example.ts): a point on the surface, its outward
 * normal's angle about Z from +X and its elevation, and what the sheet calls it. The default rain blows along +X, so
 * the faces turned towards −X take it; the label spans 165° to 305° about Z, the body's close-up stands beside it.
 */
const PLACES = [
  { key: 'body', label: 'The body (vertical, painted metal)', phi: 140, elevation: 0, r: 31, z: 40 },
  // The shoulder's ellipse r = 11 + 20 cos t, z = 74 + 16 sin t at t = 30°: its normal (16 cos t, 20 sin t) is 35.8° up.
  { key: 'shoulder', label: 'The shoulder (painted metal)', phi: 180, elevation: 35.8, r: 11 + 20 * Math.cos(Math.PI / 6), z: 82 },
  { key: 'label', label: 'The paper label (vertical)', phi: 200, elevation: 0, r: 31.35, z: 40 },
  { key: 'cap', label: 'The top of the cap (level, gold)', phi: 180, elevation: 89.9, r: 0, z: 121 },
] as const;

function withEffect(s: ProjectState, preset: EffectKind, patch: EffectPatch = {}): ProjectState {
  s = apply(s, { type: 'effect/add', preset });
  const id = s.effects[s.effects.length - 1].id;
  return apply(s, { type: 'effect/set', id, patch });
}

interface Shot {
  file: string;
  place: string;
  label: string;
  t: number;
  /** Millimetres a pixel spans at the surface (close-ups; null for the whole bottle). */
  mmPerPx: number | null;
  width: number;
  height: number;
  samples: number;
  drops: number;
  falling: number;
  /** The drops on each part at that instant: how many, and the median and largest contact diameter, mm. */
  parts: { part: string; drops: number; medianMm: number; largestMm: number }[];
}

describe.skipIf(!dir)('the water sheet: its scenes', () => {
  it('writes them', async () => {
    expect(RT_WASM).not.toBeNull();
    mkdirSync(dir!, { recursive: true });
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    if (!hasPartsExports(rt)) throw new Error('this rt.wasm does not wet the parts (npm run engine:build)');
    const s0 = withEffect(exampleState(), 'RAIN', { wetParts: true, camera: false });
    const spec = wetPartsSpec(s0)!;
    const bytes = wptBytes(spec);
    // The water table's input: the page's own rain (its density per mm³ and speed as the engine takes them).
    const rain = spec.sources.find((x) => x.kind === 'DROPS')!;
    const speed = Math.hypot(...rain.velocity);
    const table = [`seconds 10`, `rain ${rain.density} ${speed} ${rain.sizeMm} ${rain.sizeVar}`, ...WETTABILITY.map((w) => `family ${w.key} ${w.advancingDeg} ${w.recedingDeg}`)];
    writeFileSync(join(dir!, 'water.txt'), `${table.join('\n')}\n`);
    // The run, recorded as the page records it.
    const sim = new PartsSim(rt, bytes);
    const lay = sim.layout();
    const parsed = parseLayout(lay)!;
    const written = writtenParts(spec);
    const meta = written.map((p, k) => ({ node: p.node, mesh: p.mesh, triangles: parsed.parts[k].triangles, samples: parsed.parts[k].samples, capAngleDeg: parsed.parts[k].capAngleDeg, porosity: p.porosity }));
    const w = new PartsTrackWriter(FPS, wetPartsKey(bytes), meta, lay);
    w.push(sim.frame());
    for (let k = 1; k <= SECONDS * FPS; k++) {
      sim.step(240 / FPS);
      w.push(sim.frame());
    }
    sim.free();
    const track = w.track();
    const s = apply(s0, { type: 'physics/begin', clips: [partsClip('water', 0, track)] });
    const view = { width, height, maxSamples: spp, maxSeconds: 0, drops: true, wetParts: true, wetFlight: true };
    const cam = activeCamera(s);
    const shots: Shot[] = [];
    for (const t of TIMES) {
      const fr = partsFrame(track, t * FPS)!;
      const parts = fr.parts.map((p, k) => {
        const d = p.drops.map((x) => 2 * x.radius).sort((a, b) => a - b);
        return { part: s0.scene.nodes[written[k].node]?.key ?? written[k].node, drops: d.length, medianMm: d.length ? d[d.length >> 1] : 0, largestMm: d.length ? d[d.length - 1] : 0 };
      });
      const base = { t, samples: spp, drops: fr.drops, falling: fr.falling.length, parts };
      // The bottle whole, from the example's camera.
      const whole = `whole-${String(t).padStart(2, '0')}s`;
      writeFileSync(join(dir!, `${whole}.rsb`), writeRsb(projectScene(s, { ...view, pose: evaluate(s, t) }).scene));
      shots.push({ file: whole, place: 'whole', label: 'The bottle', mmPerPx: null, width, height, ...base });
      for (const p of PLACES) {
        const a = (p.phi * Math.PI) / 180;
        const target: [number, number, number] = [p.r * Math.cos(a), p.r * Math.sin(a), p.z];
        const distance = (FIELD_MM * FOCAL_MM) / 36;
        // polar(): the camera stands at angle azimuth − 90° about Z from its target.
        const patch = { focalMm: FOCAL_MM, fstop: 0, lens: null, azimuth: p.phi + 90, elevation: p.elevation, distance, target, focusDistance: distance };
        const close = apply(s, { type: 'camera/set', id: cam.id, patch });
        const c = activeCamera(close);
        const at = cameraPosition(c);
        const n = [Math.cos(a) * Math.cos((p.elevation * Math.PI) / 180), Math.sin(a) * Math.cos((p.elevation * Math.PI) / 180), Math.sin((p.elevation * Math.PI) / 180)];
        // Square-on: the camera stands on the surface's normal, outside it.
        const out = [at[0] - target[0], at[1] - target[1], at[2] - target[2]];
        expect((out[0] * n[0] + out[1] * n[1] + out[2] * n[2]) / distance).toBeGreaterThan(0.999);
        const scene = projectScene(close, { ...view, pose: evaluate(close, t) }).scene;
        const rc = scene.camera;
        const d = Math.hypot(rc.position[0] - rc.target[0], rc.position[1] - rc.target[1], rc.position[2] - rc.target[2]);
        // The pinhole's field across the longer side at the surface.
        const fieldMm = (rc.sensorMm * d) / rc.focalMm;
        const file = `${p.key}-${String(t).padStart(2, '0')}s`;
        writeFileSync(join(dir!, `${file}.rsb`), writeRsb(scene));
        shots.push({ file, place: p.key, label: p.label, mmPerPx: fieldMm / Math.max(width, height), width, height, ...base });
      }
    }
    writeFileSync(join(dir!, 'shots.json'), JSON.stringify({ width, height, fps: FPS, seconds: SECONDS, rain: { ...rain, speed }, shots }, null, 2));
    expect(shots.length).toBe(TIMES.length * (PLACES.length + 1));
  }, 900_000);
});

// Writes the RSB files of the cloth contact sheet (phase S9) that tools/cloth-sheet.mjs renders with the native `rt`,
// through the page's own code and the real rt.wasm: the example bottle with a sheet laid over it by Drape over the part
// (core/cloth.ts `drapePlacement`), one shot per fabric preset of data/fabrics.ts, its simulation run in the engine
// (`cloth_*`, as the physics worker runs it), recorded into the sheet's PHYSICS clip (the cache) and the scene written at
// the last frame with the frame the pose shows (the sheet as the MESH). And one shot of the sheet before it falls.
// Skipped unless REPACKSHOT_CLOTH_DIR is set, so `npm run qa` writes nothing; the tool sets the variable itself.
//
//   REPACKSHOT_CLOTH_DIR=out/cloth-sheet npx vitest run tests/cloth-dump.test.ts
//
// Optional: REPACKSHOT_CLOTH_SIZE (WxH, default 480x360), REPACKSHOT_CLOTH_SPP (default 48), REPACKSHOT_CLOTH_SECONDS
// (the most simulated time per fabric, default 5).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/animation';
import { clothFrame, clothMesh, clothSpec, ClothTrackWriter, cltBytes, drapePlacement } from '../src/core/cloth';
import { getMesh } from '../src/core/meshes';
import { clothClip } from '../src/core/physics';
import type { NodeId } from '../src/core/scene';
import type { ProjectState } from '../src/core/store';
import { FABRIC_PRESETS, type FabricKey } from '../src/data/fabrics';
import { projectScene, writeRsb } from '../src/io/rsb';
import { ClothSim, hasClothExports } from '../src/render/phys-wasm';
import { apply, exampleState } from './helpers';
import { RT_WASM } from './wasm-engine';

const dir = process.env.REPACKSHOT_CLOTH_DIR;
const [width, height] = (process.env.REPACKSHOT_CLOTH_SIZE ?? '480x360').split('x').map(Number);
const spp = Number(process.env.REPACKSHOT_CLOTH_SPP ?? 48);
const seconds = Number(process.env.REPACKSHOT_CLOTH_SECONDS ?? 5);

/** The integrated mean curvature per area of a sheet, 1/mm (rt_phys::cloth::mean_curvature, on the welded sheet). */
function meanCurvature(p: Float32Array, indices: Uint32Array, weld: Uint32Array): number {
  const edges = new Map<string, { a: number; b: number; wings: number[]; first: number[] }>();
  let area = 0;
  const v = (i: number) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const sub = (x: number[], y: number[]) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const cross = (x: number[], y: number[]) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const dot = (x: number[], y: number[]) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const len = (x: number[]) => Math.hypot(x[0], x[1], x[2]);
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [weld[indices[t]], weld[indices[t + 1]], weld[indices[t + 2]]];
    area += 0.5 * len(cross(sub(v(tri[1]), v(tri[0])), sub(v(tri[2]), v(tri[0]))));
    for (let c = 0; c < 3; c++) {
      const a = tri[c];
      const b = tri[(c + 1) % 3];
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      const e = edges.get(k) ?? { a, b, wings: [], first: [] };
      e.wings.push(tri[(c + 2) % 3]);
      if (e.first.length === 0) e.first.push(a, b);
      edges.set(k, e);
    }
  }
  let sum = 0;
  for (const e of edges.values()) {
    if (e.wings.length !== 2) continue;
    const [x0, x1] = [v(e.first[0]), v(e.first[1])];
    const ed = sub(x1, x0);
    const n1 = cross(ed, sub(v(e.wings[0]), x0));
    const n2 = cross(sub(x0, x1), sub(v(e.wings[1]), x1));
    const l1 = len(n1);
    const l2 = len(n2);
    if (!(l1 > 0 && l2 > 0)) continue;
    const u1 = n1.map((x) => x / l1);
    const u2 = n2.map((x) => x / l2);
    const theta = Math.atan2(dot(cross(u1, u2), ed) / len(ed), dot(u1, u2));
    sum += Math.abs(theta) * len(ed);
  }
  return area > 0 ? sum / (2 * area) : 0;
}

interface Shot {
  file: string;
  fabric: FabricKey | null;
  label: string;
  weightGsm: number;
  vertices: number;
  simulated: number;
  settled: boolean;
  curvature: number;
  lowestMm: number;
  wallSeconds: number;
  samples: number;
}

describe.skipIf(!dir)('the cloth sheet: its scenes', () => {
  it('writes them', async () => {
    expect(RT_WASM).not.toBeNull();
    mkdirSync(dir!, { recursive: true });
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    if (!hasClothExports(rt)) throw new Error('this rt.wasm does not simulate cloth (npm run engine:build)');
    const view = { width, height, maxSamples: spp, maxSeconds: 0 };
    const base = exampleState();
    const product = base.scene.roots;
    const place = drapePlacement(base, product)!;
    /** The example with the sheet over it, of `fabric`. */
    const draped = (fabric: FabricKey): { state: ProjectState; sheet: NodeId } => {
      let s = apply(base, { type: 'scene/addPrimitive', kind: 'PLANE', params: place.params, position: place.position, name: 'Cloth', material: place.material });
      const sheet = s.selection.ids[0];
      s = apply(s, { type: 'physics/set', ids: [sheet], patch: { role: 'CLOTH', cloth: { fabric } } });
      return { state: s, sheet };
    };
    const shots: Shot[] = [];
    // Before it falls.
    {
      const { state } = draped('COTTON_FINE');
      writeFileSync(join(dir!, 'before.rsb'), writeRsb(projectScene(state, view).scene));
      shots.push({ file: 'before', fabric: null, label: 'The sheet laid by Drape over the part, before it falls', weightGsm: 0, vertices: 0, simulated: 0, settled: false, curvature: 0, lowestMm: place.position[2], wallSeconds: 0, samples: spp });
    }
    for (const f of FABRIC_PRESETS) {
      const { state, sheet } = draped(f.key);
      const spec = clothSpec(state)!;
      const piece = spec.pieces[0];
      const fps = state.animation.fps;
      const begun = performance.now();
      const sim = new ClothSim(rt, cltBytes(spec));
      const w = new ClothTrackWriter(fps, { mesh: piece.mesh, levels: piece.levels, worldInv: piece.worldInv, vertices: piece.positions.length / 3 });
      w.push(sim.positions());
      const per = Math.round(240 / fps);
      let settled = false;
      for (let k = 1; k <= seconds * fps && !settled; k++) {
        sim.step(per);
        w.push(sim.positions());
        settled = sim.settled;
      }
      const steps = sim.steps;
      const last = sim.positions();
      sim.free();
      const wall = (performance.now() - begun) / 1000;
      const track = w.track();
      const s = apply(state, { type: 'physics/begin', clips: [clothClip('cloth-sheet', sheet, 0, track)] });
      const end = (track.frames - 1) / fps;
      const file = f.key.toLowerCase();
      writeFileSync(join(dir!, `${file}.rsb`), writeRsb(projectScene(s, { ...view, pose: evaluate(s, end) }).scene));
      const sheetMesh = clothMesh(getMesh(s.scene.nodes[sheet].mesh!.id)!, undefined, piece.levels);
      let lowest = Infinity;
      for (let i = 2; i < last.length; i += 3) lowest = Math.min(lowest, last[i]);
      const frame = clothFrame(track, track.frames - 1)!;
      shots.push({
        file,
        fabric: f.key,
        label: `${f.label.en} (${f.weightGsm} g/m²)`,
        weightGsm: f.weightGsm,
        vertices: track.vertices,
        simulated: steps / 240,
        settled,
        curvature: meanCurvature(frame, sheetMesh.indices, sheetMesh.weld),
        lowestMm: lowest,
        wallSeconds: wall,
        samples: spp,
      });
    }
    writeFileSync(join(dir!, 'shots.json'), JSON.stringify({ width, height, place, shots }, null, 2));
    expect(shots).toHaveLength(FABRIC_PRESETS.length + 1);
    // The cloth fell onto the bottle, below where it was laid.
    for (const s of shots.slice(1)) expect(s.lowestMm).toBeLessThan(place.position[2]);
  }, 1_800_000);
});

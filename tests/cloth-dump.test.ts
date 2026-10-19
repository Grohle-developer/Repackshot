// Writes the RSB files of the cloth contact sheet (phase S9) that tools/cloth-sheet.mjs renders with the native `rt`,
// through the page's own code and the real rt.wasm: the example bottle with a sheet laid over it by Drape over the part
// (core/cloth.ts `drapePlacement`), one shot per fabric preset of data/fabrics.ts, its simulation run in the engine
// (`cloth_*`, as the physics worker runs it), recorded into the sheet's PHYSICS clip (the cache) and the scene written at
// the last frame with the frame the pose shows (the sheet as the MESH). And one shot of the sheet before it falls, one
// close up on the cap under silk, and a row of every preset on Cusick's drape tester seen from above (tests/cusick.ts:
// the engine test's very CLT1, run in rt.wasm, its drape coefficient and nodes checked against the engine test's,
// tests/fixtures/cloth-cusick.json).
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
import { DRAPE_MATERIAL, FABRIC_PRESETS, type FabricKey } from '../src/data/fabrics';
import { activeCamera } from '../src/core/camera';
import { instanceFromPreset } from '../src/core/materials';
import { registerMesh, type MeshData } from '../src/core/meshes';
import { boundsOf, type ModelPayload, type SceneNode } from '../src/core/scene';
import { createInitialState } from '../src/core/store';
import { projectScene, writeRsb } from '../src/io/rsb';
import { ClothSim, hasClothExports } from '../src/render/phys-wasm';
import { cusickBytes, CUSICK_SECONDS, drapeCoefficient, nodes, shadow } from './cusick';
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

/** Smooth normals of a triangle mesh (area-weighted). */
function normalsOf(p: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(p.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const u = [p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]];
    const v = [p[3 * c] - p[3 * a], p[3 * c + 1] - p[3 * a + 1], p[3 * c + 2] - p[3 * a + 2]];
    const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const i of [a, b, c]) for (let k = 0; k < 3; k++) n[3 * i + k] += w[k];
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    for (let k = 0; k < 3; k++) n[i + k] /= l;
  }
  return n;
}

/** A scene of static meshes (world mm), each with a catalogue material. */
function meshesScene(parts: { key: string; mesh: { positions: Float32Array; indices: Uint32Array }; material: string }[]): ProjectState {
  const nodes: Record<string, SceneNode> = {};
  const materials: ModelPayload['materials'] = {};
  nodes.model = { id: 'model', name: 'Cusick', kind: 'MODEL', key: 'model', parent: null, children: parts.map((p) => p.key), transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false } as SceneNode;
  for (const p of parts) {
    const data: MeshData = { positions: p.mesh.positions, normals: normalsOf(p.mesh.positions, p.mesh.indices), indices: p.mesh.indices, uvs: new Float32Array((p.mesh.positions.length / 3) * 2) };
    const ref = registerMesh(`cusick:${p.key}`, data);
    const inst = instanceFromPreset(`m_${p.key}`, p.material, 300);
    if (inst) materials[`m_${p.key}`] = inst;
    nodes[p.key] = { id: p.key, name: p.key, kind: 'PART', key: p.key, parent: 'model', children: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false, mesh: ref, material: inst ? `m_${p.key}` : null, smooth: true } as SceneNode;
  }
  return apply(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['model'], materials }, replace: true });
}

interface Shot {
  file: string;
  /** The row of the sheet it goes in. */
  kind: 'before' | 'drape' | 'cap' | 'cusick';
  /** Cusick: its drape coefficient and nodes. */
  dc?: number;
  nodes?: number;
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
    let capShot: Shot | null = null;
    // Before it falls.
    {
      const { state } = draped('COTTON_FINE');
      writeFileSync(join(dir!, 'before.rsb'), writeRsb(projectScene(state, view).scene));
      shots.push({ file: 'before', kind: 'before', fabric: null, label: 'The sheet laid by Drape over the part, before it falls', weightGsm: 0, vertices: 0, simulated: 0, settled: false, curvature: 0, lowestMm: place.position[2], wallSeconds: 0, samples: spp });
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
      if (f.key === 'SILK') {
        // Close up on the cap: the rim the cloth used to show through.
        const cap = boundsOf(s, ['cap']);
        const target: [number, number, number] = [0, 1, 2].map((k) => (cap.min[k] + cap.max[k]) / 2) as [number, number, number];
        const cam = activeCamera(s);
        const close = apply(s, { type: 'camera/set', id: cam.id, patch: { target, distance: 170, elevation: 20, focalMm: 85, focusDistance: 170 } });
        writeFileSync(join(dir!, 'silk_cap.rsb'), writeRsb(projectScene(close, { ...view, pose: evaluate(close, end) }).scene));
        capShot = { file: 'silk_cap', kind: 'cap', fabric: f.key, label: 'Silk over the cap, close up', weightGsm: f.weightGsm, vertices: track.vertices, simulated: steps / 240, settled, curvature: 0, lowestMm: 0, wallSeconds: 0, samples: spp };
      }
      const sheetMesh = clothMesh(getMesh(s.scene.nodes[sheet].mesh!.id)!, undefined, piece.levels);
      let lowest = Infinity;
      for (let i = 2; i < last.length; i += 3) lowest = Math.min(lowest, last[i]);
      const frame = clothFrame(track, track.frames - 1)!;
      shots.push({
        file,
        kind: 'drape',
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
    if (capShot) shots.push(capShot);
    // Cusick's drape tester: the engine test's CLT1 for each preset, draped as it drapes it.
    const measured = JSON.parse(readFileSync('tests/fixtures/cloth-cusick.json', 'utf8')) as Record<string, { dc: number; nodes: number; steps: number }>;
    for (const f of FABRIC_PRESETS) {
      const { bytes, disc, support } = cusickBytes(f);
      const begun = performance.now();
      const sim = new ClothSim(rt, bytes);
      const flat = shadow(disc.positions, disc.indices).area;
      let n = 0;
      while (!sim.settled && n < CUSICK_SECONDS * 240) {
        sim.step(1);
        n++;
      }
      const p = sim.positions();
      sim.free();
      const out = shadow(p, disc.indices);
      const dc = drapeCoefficient(flat, out.area);
      const k = nodes(out.radius);
      // The same drape as the engine's test, to the step.
      expect(n, `${f.key} steps`).toBe(measured[f.key].steps);
      expect(Math.abs(dc - measured[f.key].dc), `${f.key} DC ${dc}`).toBeLessThan(5e-4);
      expect(k, `${f.key} nodes`).toBe(measured[f.key].nodes);
      let state = meshesScene([
        { key: 'support', mesh: support, material: 'CERAMIC' },
        { key: 'sample', mesh: { positions: p, indices: disc.indices }, material: DRAPE_MATERIAL },
      ]);
      const cam = activeCamera(state);
      state = apply(state, { type: 'camera/set', id: cam.id, patch: { projection: 'ORTHOGRAPHIC', orthoWidth: 420, azimuth: 0, elevation: 89.9, target: [0, 0, 300], distance: 900, focusDistance: 900, fstop: 22 } });
      const file = `cusick_${f.key.toLowerCase()}`;
      writeFileSync(join(dir!, `${file}.rsb`), writeRsb(projectScene(state, view).scene));
      shots.push({ file, kind: 'cusick', dc, nodes: k, fabric: f.key, label: f.label.en, weightGsm: f.weightGsm, vertices: p.length / 3, simulated: n / 240, settled: n < CUSICK_SECONDS * 240, curvature: 0, lowestMm: 0, wallSeconds: (performance.now() - begun) / 1000, samples: spp });
    }
    writeFileSync(join(dir!, 'shots.json'), JSON.stringify({ width, height, place, shots }, null, 2));
    expect(shots).toHaveLength(2 * FABRIC_PRESETS.length + 2);
    // The cloth fell onto the bottle, below where it was laid.
    for (const s of shots.filter((x) => x.kind === 'drape')) expect(s.lowestMm).toBeLessThan(place.position[2]);
  }, 1_800_000);
});

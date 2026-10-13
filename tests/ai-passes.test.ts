// The arithmetic around the AI passes (phase X4), in Node: how ids travel through an 8-bit target, how the raw
// planes become the contract’s (rows from the top, +∞ background, normals in model space), the thin lens’s circle
// of confusion, the instance and material ids against the engine’s own scene, and the small pure rules of the
// section (preview size, what the switch does, how the report is worded). The three.js drawing itself is
// checked in a browser by tests/ai-passes-browser.test.ts.

import { describe, expect, it } from 'vitest';
import { PREVIEW_MAX_SIDE, type GuardReport } from '../src/core/ai';
import { aiFileName, failedItems, limitedPercent, previewSize, reportItems, switchAction, AI_PROTECTIONS, PREVIEW_MIN_SIDE } from '../src/core/ai-post';
import { cameraPosition, SENSOR_MM } from '../src/core/camera';
import { cocDiameter, cocPass, hasDepthOfField, lensOf } from '../src/core/lens-coc';
import { indexPassIds } from '../src/core/pass-ids';
import { FLOOR_ID, PASS_KEYS, passMask } from '../src/core/passes';
import { cameraToRsb, FLOOR_SHADOW_CATCHER, projectScene, writeRsb } from '../src/io/rsb';
import { assemblePasses, floorHits, packId, unpackIds } from '../src/render/preview-passes';
import { loadRt, renderWithPasses, RT_WASM } from './wasm-engine';
import { reportText } from '../src/ui/ai-report';
import { setLang } from '../src/ui/strings';
import { passScene } from './browser/pass-scene';

describe('ids through an 8-bit target', () => {
  it('pack to four bytes and come back exactly, whatever the number', () => {
    const ids = [0, 1, 2, 255, 256, 257, 65535, 65536, 1_000_000, 16_777_215, 16_777_216, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff];
    const bytes = new Uint8Array(ids.length * 4);
    ids.forEach((id, i) => bytes.set(packId(id), i * 4));
    // One row, so the flip changes nothing.
    expect([...unpackIds(bytes, ids.length, 1)]).toEqual(ids);
    expect(packId(0x01020304)).toEqual([4, 3, 2, 1]);
    // Random ids too.
    let seed = 99;
    const rnd = Array.from({ length: 500 }, () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0));
    const raw = new Uint8Array(rnd.length * 4);
    rnd.forEach((id, i) => raw.set(packId(id), i * 4));
    expect([...unpackIds(raw, rnd.length, 1)]).toEqual(rnd);
  });

  it('read rows from the top: OpenGL hands the bottom row first', () => {
    // 2 × 3 pixels; raw row 0 is the bottom of the picture.
    const bottomUp = [[10, 11], [20, 21], [30, 31]];
    const bytes = new Uint8Array(6 * 4);
    bottomUp.flat().forEach((id, i) => bytes.set(packId(id), i * 4));
    expect([...unpackIds(bytes, 2, 3)]).toEqual([30, 31, 20, 21, 10, 11]);
  });
});

describe('assembling the planes', () => {
  // 2 × 2: top row [background, part 1], bottom row [part 2, part 2]. Raw rows run bottom first.
  const part = new Uint8Array(16);
  const material = new Uint8Array(16);
  [2, 2, 0, 1].forEach((id, i) => part.set(packId(id), i * 4));
  [5, 5, 0, 7].forEach((id, i) => material.set(packId(id), i * 4));
  // three.js space: +Y is up. A part facing up (0,1,0), one facing the camera (0,0,1), one facing +X.
  const nd = new Float32Array([0, 0, 1, 100, 0, 0, 1, 110, 0, 0, 0, 0, 0, 1, 0, 50]);
  const albedo = new Float32Array([0.1, 0.2, 0.3, 1, 0.1, 0.2, 0.3, 1, 0, 0, 0, 0, 0.9, 0.8, 0.7, 1]);
  // The model-space images of three's axes (toThree maps (x, y, z) to (x, z, -y)): +X, +Y → model +Z, +Z → model -Y.
  const axes = [[1, 0, 0], [0, 0, 1], [0, -1, 0]] as const;
  const lens = { focalMm: 85, fstop: 0, focusDist: 400, sensorMm: 36, ortho: false };
  const out = assemblePasses({ part, material, nd, albedo }, 2, 2, axes, lens, PASS_KEYS);

  it('flips the rows, unpacks the ids and keeps the background 0', () => {
    expect([...out.partId!]).toEqual([0, 1, 2, 2]);
    expect([...out.materialId!]).toEqual([0, 7, 5, 5]);
  });

  it('gives +∞ depth on the background and the distance along the axis elsewhere', () => {
    expect([...out.depth!]).toEqual([Infinity, 50, 100, 110]);
  });

  it('gives the normals in model space, Z up, and zero on the background', () => {
    // The part facing up (three +Y) faces model +Z; the ones facing the camera (three +Z) face model -Y.
    expect([...out.normal!]).toEqual([0, 0, 0, 0, 0, 1, 0, -1, 0, 0, -1, 0]);
  });

  it('copies the albedo of the pixels that hit something, 0 elsewhere', () => {
    expect([...out.albedo!].map((v) => Number(v.toFixed(2)))).toEqual([0, 0, 0, 0.9, 0.8, 0.7, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3]);
  });

  it('has the coc of a pinhole at 0, and only the passes asked for', () => {
    expect([...out.coc!]).toEqual([0, 0, 0, 0]);
    const only = assemblePasses({ part, material: null, nd: null, albedo: null }, 2, 2, axes, lens, ['partId']);
    expect(Object.keys(only).sort()).toEqual(['height', 'partId', 'width']);
    expect(passMask(['partId'])).toBe(1 << PASS_KEYS.indexOf('partId'));
  });
});

describe('the studio floor in the three.js passes (X3c)', () => {
  // The pass scene from low down (the horizon in view), as the engine's scene has it.
  const W = 96;
  const H = 64;
  const low = (projection: 'PERSPECTIVE' | 'ORTHOGRAPHIC', elevation = 6) => {
    const s = passScene(W, H);
    const cam = s.camera.cameras[s.camera.active];
    return { ...s, camera: { ...s.camera, cameras: { ...s.camera.cameras, [cam.id]: { ...cam, elevation, projection, orthoWidth: 400 } } } };
  };
  const axes = [[1, 0, 0], [0, 0, 1], [0, -1, 0]] as const;

  it('is in the engine’s scene as the ids say, and nowhere when the floor is off', () => {
    const s = passScene(W, H);
    const { scene, ids } = projectScene(s, { width: W, height: H, maxSamples: 1, maxSeconds: 0 });
    expect(scene.floor.mode).toBe(FLOOR_SHADOW_CATCHER);
    expect(ids.floor).toEqual({ z: scene.floor.z, albedo: scene.floor.color, camera: { position: scene.camera.position, target: scene.camera.target, up: scene.camera.up, focalMm: scene.camera.focalMm, sensorMm: scene.camera.sensorMm, ortho: false, orthoWidth: scene.camera.orthoWidth } });
    const off = projectScene({ ...s, studio: { ...s.studio, floor: false } }, { width: W, height: H, maxSamples: 1, maxSeconds: 0 });
    expect(off.ids.floor).toBeNull();
  });

  it('is nearer than a part behind it and farther than one in front, with its normal up and its colour', () => {
    const { ids } = projectScene(low('PERSPECTIVE'), { width: W, height: H, maxSamples: 1, maxSeconds: 0 });
    const hits = floorHits(ids.floor!, W, H);
    const bottom = (H - 1) * W + W / 2;
    const top = W / 2;
    expect(Number.isFinite(hits.depth[bottom])).toBe(true);
    expect(hits.depth[top]).toBe(Infinity);
    expect(hits.normalZ[bottom]).toBe(1);
    // 2 × 1 raw planes of the bottom row's middle pixels: a part farther than the floor, and one nearer.
    const d = hits.depth[bottom];
    const one = { ...ids.floor!, camera: ids.floor!.camera };
    const part = new Uint8Array(W * H * 4);
    const nd = new Float32Array(W * H * 4);
    // Raw rows start at the bottom: raw pixel x of row 0 is the picture's bottom row.
    part.set(packId(1), (W / 2) * 4);
    nd.set([0, 0, 1, d * 2], (W / 2) * 4);
    part.set(packId(2), (W / 2 + 1) * 4);
    nd.set([0, 0, 1, d / 2], (W / 2 + 1) * 4);
    const out = assemblePasses({ part, material: part, nd, albedo: null }, W, H, axes, { focalMm: 85, fstop: 0, focusDist: 1, sensorMm: 36, ortho: false }, PASS_KEYS, one);
    expect(out.partId![bottom]).toBe(FLOOR_ID);
    expect(out.materialId![bottom]).toBe(FLOOR_ID);
    expect(out.depth![bottom]).toBe(Math.fround(d));
    expect([...out.normal!.subarray(bottom * 3, bottom * 3 + 3)]).toEqual([0, 0, 1]);
    expect([...out.albedo!.subarray(bottom * 3, bottom * 3 + 3)]).toEqual([...ids.floor!.albedo].map(Math.fround));
    expect(out.partId![bottom + 1]).toBe(2);
    expect(out.partId![top]).toBe(0);
    // Without a depth target the part is kept (the floor only fills what is background).
    const flat = assemblePasses({ part, material: part, nd: null, albedo: null }, W, H, axes, { focalMm: 85, fstop: 0, focusDist: 1, sensorMm: 36, ortho: false }, ['partId'], one);
    expect(flat.partId![bottom]).toBe(1);
  });

  it.skipIf(!RT_WASM)('agrees with the engine’s own passes on every floor pixel, the horizon included', async () => {
    const rt = await loadRt();
    let albedoChecked = 0;
    // From just above the floor (perspective and orthographic), and from below it (its normal then faces down).
    for (const [projection, elevation] of [['PERSPECTIVE', 6], ['ORTHOGRAPHIC', 6], ['PERSPECTIVE', -3]] as const) {
      // The floor alone: the parts hidden, so the raw planes hold nothing but background.
      const s = low(projection, elevation);
      const nodes = Object.fromEntries(Object.entries(s.scene.nodes).map(([k, n]) => [k, n.kind === 'PART' ? { ...n, visible: false } : n]));
      const floorOnly = { ...s, scene: { ...s.scene, nodes } };
      const { scene, ids } = projectScene(floorOnly, { width: W, height: H, maxSamples: 1, maxSeconds: 0, passes: [...PASS_KEYS] });
      expect(scene.instances).toEqual([]);
      const engine = renderWithPasses(rt, writeRsb(scene), W, H, 1, passMask([...PASS_KEYS])).passes;
      const empty = new Uint8Array(W * H * 4);
      const out = assemblePasses({ part: empty, material: empty, nd: new Float32Array(W * H * 4), albedo: new Float32Array(W * H * 4) }, W, H, axes, { focalMm: 85, fstop: 0, focusDist: 1, sensorMm: 36, ortho: false }, PASS_KEYS, ids.floor!);
      let floor = 0;
      let background = 0;
      let down = 0;
      for (let i = 0; i < W * H; i++) {
        expect(out.partId![i], `${projection} ${elevation}° pixel ${i}`).toBe(engine.partId![i]);
        if (engine.partId![i] === FLOOR_ID && engine.normal![i * 3 + 2] === -1) down++;
        expect(out.materialId![i]).toBe(engine.materialId![i]);
        if (engine.partId![i] === FLOOR_ID) {
          floor++;
          expect(Math.abs(out.depth![i] - engine.depth![i])).toBeLessThan(1e-4 * engine.depth![i] + 1e-3);
          // The albedo is the engine's average over its samples' own rays (jittered, through the lens): the
          // floor's colour exactly wherever those rays all meet the floor (in focus, away from the horizon).
          const settled = engine.coc![i] < 0.25 && i >= 2 * W && engine.partId![i - W] === FLOOR_ID && engine.partId![i - 2 * W] === FLOOR_ID;
          if (settled) albedoChecked++;
          for (let c = 0; c < 3; c++) {
            expect(out.normal![i * 3 + c]).toBe(engine.normal![i * 3 + c]);
            if (settled) expect(out.albedo![i * 3 + c]).toBe(engine.albedo![i * 3 + c]);
          }
        } else background++;
      }
      // The horizon is in view: floor on one side of it, background on the other.
      expect(floor).toBeGreaterThan(W * 4);
      expect(background).toBeGreaterThan(W * 4);
      expect(down === floor, `${elevation}°: the floor seen from ${elevation < 0 ? 'below' : 'above'}`).toBe(elevation < 0);
    }
    expect(albedoChecked).toBeGreaterThan(W * 4);
  });
});

describe('the circle of confusion', () => {
  const lens = { focalMm: 85, fstop: 2.8, focusDist: 500, sensorMm: SENSOR_MM, ortho: false };

  it('is zero on the focus plane, grows away from it on both sides, and shrinks as the lens closes', () => {
    expect(cocDiameter(lens, 500, 1000)).toBe(0);
    expect(cocDiameter(lens, 450, 1000)).toBeGreaterThan(0);
    expect(cocDiameter(lens, 600, 1000)).toBeGreaterThan(0);
    expect(cocDiameter(lens, 400, 1000)).toBeGreaterThan(cocDiameter(lens, 450, 1000));
    expect(cocDiameter(lens, 800, 1000)).toBeGreaterThan(cocDiameter(lens, 600, 1000));
    expect(cocDiameter({ ...lens, fstop: 8 }, 600, 1000)).toBeLessThan(cocDiameter(lens, 600, 1000));
    expect(cocDiameter({ ...lens, fstop: 8 }, 600, 1000)).toBeCloseTo((cocDiameter(lens, 600, 1000) * 2.8) / 8, 9);
    // More pixels across the same sensor: a bigger disc in pixels.
    expect(cocDiameter(lens, 600, 2000)).toBeCloseTo(cocDiameter(lens, 600, 1000) * 2, 9);
  });

  it('is the engine’s model: the aperture over the depth, as the pixels see it on the focus plane', () => {
    // Aperture 85 / 2.8 mm; a point at 600 spreads over A·|600 − 500| / 600 on the focus plane; a pixel there is
    // sensor / longSide × (focusDist / focal) wide.
    const aperture = 85 / 2.8;
    const onPlane = (aperture * 100) / 600;
    const pixel = (SENSOR_MM / 1000) * (500 / 85);
    expect(cocDiameter(lens, 600, 1000)).toBeCloseTo(onPlane / pixel, 9);
  });

  it('is zero without depth of field: a pinhole, no focus distance, an orthographic camera, the background', () => {
    for (const l of [{ ...lens, fstop: 0 }, { ...lens, focusDist: 0 }, { ...lens, ortho: true }]) {
      expect(hasDepthOfField(l)).toBe(false);
      expect(cocDiameter(l, 800, 1000)).toBe(0);
    }
    expect(cocDiameter(lens, Infinity, 1000)).toBe(0);
    expect(cocDiameter(lens, 0, 1000)).toBe(0);
    expect([...cocPass(lens, new Float32Array([Infinity, 500, 700]), 3, 1)]).toEqual([0, 0, expect.any(Number)]);
  });

  it('is taken from the camera as the engine’s scene file has it', () => {
    const state = passScene(192, 108);
    const cam = state.camera.cameras[state.camera.active];
    const rsb = cameraToRsb(cam, 192, 108, 192, 108);
    const l = lensOf(cam);
    expect(l).toEqual({ focalMm: rsb.focalMm, fstop: rsb.fstop, focusDist: rsb.focusDist, sensorMm: rsb.sensorMm, ortho: rsb.ortho });
    expect(l.fstop).toBe(2.8);
    // The camera really looks along the axis: a point on it is at the focus distance when the target is.
    const toTarget = Math.hypot(...cameraPosition(cam).map((v, i) => v - cam.target[i]));
    expect(toTarget).toBeCloseTo(cam.distance, 6);
  });
});

describe('the ids of the passes against the engine’s scene', () => {
  const state = passScene();
  const { scene, ids } = projectScene(state, { width: 192, height: 108, maxSamples: 1, maxSeconds: 0 });

  it('are the engine’s instance order: one entry per instance, in the same order, with its material', () => {
    expect(ids.instances).toHaveLength(scene.instances!.length);
    ids.instances.forEach((inst, i) => expect(inst.materialId).toBe(scene.instances![i].materialId + 1));
    // The hidden part is not an instance; the part with two materials on its faces is two.
    expect(ids.instances.map((i) => state.scene.nodes[i.node].name)).toEqual(['turned', 'faces', 'faces', 'twin']);
    // The first group of the part with face materials is the one with the face material (it holds the first triangles).
    const node = (name: string) => Object.values(state.scene.nodes).find((n) => n.name === name)!;
    expect(ids.instances.map((i) => i.material)).toEqual([node('turned').material, node('faces').faceMaterials![0].material, node('faces').material, node('twin').material]);
    // The twin is another instance of the first's material: part ids and material ids are two different numberings.
    expect(ids.instances.map((i) => i.materialId)).toEqual([1, 2, 3, 1]);
  });

  it('are found by part and material key, 0 for what the engine does not draw', () => {
    const index = indexPassIds(ids);
    const byName = (name: string) => Object.values(state.scene.nodes).find((n) => n.name === name)!.id;
    const red = state.scene.nodes[byName('turned')].material!;
    const green = state.scene.nodes[byName('faces')].material!;
    const blue = state.scene.nodes[byName('faces')].faceMaterials![0].material;
    expect(index.partId(byName('turned'), red)).toBe(1);
    expect(index.partId(byName('faces'), blue)).toBe(2);
    expect(index.partId(byName('faces'), green)).toBe(3);
    expect(index.partId(byName('twin'), red)).toBe(4);
    expect(index.materialId(4)).toBe(1);
    expect(index.partId(byName('hidden'), red)).toBe(0);
    expect(index.partId(byName('turned'), green)).toBe(0);
    expect(index.materialId(3)).toBe(scene.instances![2].materialId + 1);
    expect(index.materialId(0)).toBe(0);
    expect(index.nodeOf(2)).toBe(byName('faces'));
    expect(index.nodeOf(0)).toBeNull();
    expect(index.nodeOf(99)).toBeNull();
  });

  it('follow the engine when a part is hidden: the instance and every id after it move', () => {
    const turned = Object.values(state.scene.nodes).find((n) => n.name === 'turned')!.id;
    const hidden = { ...state, scene: { ...state.scene, nodes: { ...state.scene.nodes, [turned]: { ...state.scene.nodes[turned], visible: false } } } };
    const after = projectScene(hidden, { width: 192, height: 108, maxSamples: 1, maxSeconds: 0 });
    expect(after.ids.instances.map((i) => state.scene.nodes[i.node].name)).toEqual(['faces', 'faces', 'twin']);
    expect(after.ids.instances).toHaveLength(after.scene.instances!.length);
  });
});

describe('the section’s small rules', () => {
  it('sizes the preview at 384–512 px, the shape of the job, never larger than the job', () => {
    expect(previewSize(1920, 1080)).toEqual({ width: 512, height: 288 });
    expect(previewSize(1080, 1350)).toEqual({ width: 410, height: 512 });
    expect(previewSize(1920, 1080, 384)).toEqual({ width: 384, height: 216 });
    expect(previewSize(4000, 4000, 9999)).toEqual({ width: PREVIEW_MAX_SIDE, height: PREVIEW_MAX_SIDE });
    expect(previewSize(4000, 4000, 100)).toEqual({ width: PREVIEW_MIN_SIDE, height: PREVIEW_MIN_SIDE });
    expect(previewSize(200, 100)).toEqual({ width: 200, height: 100 });
    expect(previewSize(8192, 16)).toEqual({ width: 512, height: 16 });
  });

  it('the switch turns on, leads to Settings, or says why not', () => {
    expect(switchAction({ available: true }, true, true)).toEqual({ kind: 'SWITCH' });
    expect(switchAction({ available: true }, false, false)).toEqual({ kind: 'SWITCH' }); // the synthetic service needs no model
    expect(switchAction({ available: true }, false, true)).toEqual({ kind: 'OPEN_SETTINGS' });
    expect(switchAction({ available: false, reason: 'NO_MODEL' }, false, true)).toEqual({ kind: 'OPEN_SETTINGS' });
    expect(switchAction({ available: false, reason: 'NO_RUNTIME' }, true, true)).toEqual({ kind: 'OPEN_SETTINGS' });
    for (const reason of ['NO_WEBGPU', 'TOO_LITTLE_MEMORY', 'MODEL_UNSUPPORTED', 'NOT_BUILT'] as const) expect(switchAction({ available: false, reason }, true, true)).toEqual({ kind: 'DISABLED', reason });
    expect(switchAction({ available: false }, true, true)).toEqual({ kind: 'DISABLED', reason: 'NOT_BUILT' });
  });

  it('lists the six protections, in the order of the document', () => {
    expect(AI_PROTECTIONS).toEqual(['geometry', 'materials', 'resolution', 'dof', 'framing', 'text']);
  });

  it('names the AI image next to the engine’s', () => {
    expect(aiFileName('Bottle_Camera 1_0001.png')).toBe('Bottle_Camera 1_0001_AI.png');
    expect(aiFileName('a.b.c.exr')).toBe('a.b.c_AI.exr');
    expect(aiFileName('noext')).toBe('noext_AI');
    expect(aiFileName('dir.v2/name')).toBe('dir.v2/name_AI');
  });
});

describe('the report, worded', () => {
  const ok = { ok: true, value: 0, limit: 1 };
  const base: GuardReport = {
    verdict: 'ACCEPTED',
    usedFraction: 1,
    attempts: 1,
    size: { ok: true, value: 1, limit: 1 },
    outside: { ok: true, value: 0, limit: 0 },
    edges: { ok: true, value: 0.4, limit: 2 },
    detail: { ok: true, value: 0.99, limit: 0.9 },
    focus: { ok: true, value: 0.05, limit: 0.25 },
    materials: [
      { materialId: 1, name: 'Body', deltaEMean: 1.8, deltaEP95: 2.4, limit: 2, ok: true },
      { materialId: 2, name: 'Cap', deltaEMean: 0.6, deltaEP95: 1, limit: 2, ok: true },
    ],
    modelKey: 'ZIMAGE_Q4',
    runtime: 'vulkan',
    seed: 3,
    seconds: 8.2,
  };

  it('is one line of what was checked, with the largest ΔE, in English and in Spanish', () => {
    expect(reportItems(base)).toEqual([
      { key: 'geometry', ok: true },
      { key: 'materials', ok: true, deltaE: 1.8 },
      { key: 'resolution', ok: true },
      { key: 'focus', ok: true },
    ]);
    setLang('en');
    expect(reportText(base)).toEqual({ checked: 'Checked: geometry ✓ · materials ✓ (ΔE max 1.8) · resolution ✓ · focus ✓', note: null });
    setLang('es');
    expect(reportText(base).checked).toBe('Comprobado: geometría ✓ · materiales ✓ (ΔE máx 1,8) · resolución ✓ · enfoque ✓');
    setLang('en');
  });

  it('says how far the AI was limited, and what broke when it was rejected', () => {
    const limited: GuardReport = { ...base, verdict: 'LIMITED', usedFraction: 0.216, attempts: 4 };
    expect(limitedPercent(limited)).toBe(22);
    expect(limitedPercent({ ...limited, usedFraction: 0.23 })).toBe(23);
    expect(limitedPercent(base)).toBeNull();
    setLang('en');
    expect(reportText({ ...limited, usedFraction: 0.23 }).note).toBe('The AI was limited to 23 % to respect the protections');
    setLang('es');
    expect(reportText({ ...limited, usedFraction: 0.23 }).note).toBe('La IA se limitó al 23 % para respetar las protecciones');
    setLang('en');
    const rejected: GuardReport = { ...base, verdict: 'REJECTED', usedFraction: 0, attempts: 4, edges: { ok: false, value: 5, limit: 2 }, materials: [{ ...base.materials[0], ok: false, deltaEMean: 4 }] };
    expect(failedItems(rejected)).toEqual(['geometry', 'materials']);
    expect(reportText(rejected)).toEqual({ checked: null, note: 'The AI result broke a protection (geometry, materials): the engine image was kept unchanged' });
    expect(reportText({ ...rejected, edges: ok, materials: [] }).note).toBe('The AI result did not pass the checks: the engine image was kept unchanged');
  });

  it('puts every check that failed under geometry, materials, resolution or focus', () => {
    const x = (patch: Partial<GuardReport>) => failedItems({ ...base, ...patch });
    expect(x({ outside: { ok: false, value: 9, limit: 0 } })).toEqual(['geometry']);
    expect(x({ detail: { ok: false, value: 0.5, limit: 0.9 } })).toEqual(['geometry']);
    expect(x({ size: { ok: false, value: 0, limit: 1 } })).toEqual(['resolution']);
    expect(x({ focus: { ok: false, value: 1, limit: 0.25 } })).toEqual(['focus']);
  });
});

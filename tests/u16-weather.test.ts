// Phase U16, the physics of each part in one place (ROADMAP U16): the store's weather fields of a part (Gets wet, Gets
// dust and snow, Surface), one undo step for every part concerned and the defaults stored as nothing; the project round
// trip and an older project opening with the defaults; the spec writer (the WPT1 flags PART_DRY and PART_NO_DUST, the
// family chosen); the page's port of the engine's critical radius against the engine's own fixture, bit for bit, for
// every family at several tilts; the sentences of the inspector, the Material pointer and the drawer (physics-lines.ts)
// and what Start would simulate (start-plan.ts); and, with the real rt.wasm, a dry roof through the page's own writer.
//
// Each test names in a comment the mutation it was checked to fail on (rule 3).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeCamera } from '../src/core/camera';
import { newFrontGlass, opticsOf } from '../src/core/optics';
import { defaultParams } from '../src/core/primitives';
import { criticalRadiusMm, materialFamily, partWeatherOf, runSizeMm, sinOfTilt, surfaceFamily, weatherParts, weatherView } from '../src/core/part-weather';
import { planIsEmpty, startPlan } from '../src/core/start-plan';
import { createStore, reduce, type ProjectState } from '../src/core/store';
import { parseLayout, PART_DRY, PART_NO_DUST, PartsTrackWriter, partsFrame, wetPartsKey, wetPartsSpec, wptBytes, type PartsTrackPart } from '../src/core/wet-parts';
import { wettability, WETTABILITY, wettabilityFamilyOf, type WettabilityFamily } from '../src/data/wettability';
import { loadProject, serializeProject } from '../src/io/project';
import { hasPartsExports, PartsSim } from '../src/render/phys-wasm';
import { noWeatherNote, planLine, pointerLine, roleLine, runSizeLine, surfaceAutoLabel } from '../src/ui/physics-lines';
import { formatNumber, setLang, STRINGS } from '../src/ui/strings';
import { apply, exampleState, keyIds } from './helpers';
import { RT_WASM } from './wasm-engine';

setLang('en');

const fixture = JSON.parse(readFileSync('tests/fixtures/u16-critical.json', 'utf8')) as {
  families: { key: string; advancing: number; receding: number }[];
  cases: { family: WettabilityFamily; tilt: number; sin: number; radius: number; mm: number | null }[];
};

const bits = (x: number) => {
  const v = new DataView(new ArrayBuffer(4));
  v.setFloat32(0, x, true);
  return v.getUint32(0, true);
};

/** The example bottle, with a rain effect on the parts (and its ids). */
function rainyBottle(preset: 'RAIN' | 'DUST_CLOUD' | 'SNOW' = 'RAIN'): { s: ProjectState; ids: Record<string, string> } {
  const s0 = apply(exampleState(), { type: 'effect/add', preset });
  const e = s0.effects[s0.effects.length - 1];
  const s = apply(s0, { type: 'effect/set', id: e.id, patch: { wetParts: true } });
  return { s, ids: keyIds(s) };
}

/** The WPT1 part flags of a spec's parts, in order (after the meshes). */
function partFlags(bytes: Uint8Array): number[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = v.getUint32(4, true);
  let at = 4 + 4 * 6;
  const meshes = v.getUint32(at, true);
  at += 4;
  for (let m = 0; m < meshes; m++) {
    const nv = v.getUint32(at, true);
    const ni = v.getUint32(at + 4, true);
    at += 8 + 4 * (3 * nv + ni);
  }
  const parts = v.getUint32(at, true);
  at += 4;
  const out: number[] = [];
  for (let p = 0; p < parts; p++) {
    at += 4 + 4 * 12 + 4 * 3;
    out.push(v.getUint32(at, true));
    at += 4 + (version === 2 ? 4 : 0);
  }
  return out;
}

describe('U16: the data', () => {
  it('WATER_REPELLENT is added after the families (rule 7), runs off first, and no material wets as it', () => {
    // Mutation checked: WATER_REPELLENT inserted before FABRIC (a key moved) fails the order; its receding angle above
    // its advancing one fails the hysteresis.
    expect(WETTABILITY.map((w) => w.key)).toEqual(['GLASS', 'PLASTIC', 'METAL', 'PAPER', 'PAINT', 'WOOD', 'FABRIC', 'WATER_REPELLENT']);
    const w = wettability('WATER_REPELLENT');
    expect(w.recedingDeg).toBeLessThan(w.advancingDeg);
    expect([w.soakMmPerS, w.porosity]).toEqual([0, 0]);
    for (const other of WETTABILITY.filter((x) => x.key !== 'WATER_REPELLENT')) expect(runSizeMm('WATER_REPELLENT')).toBeLessThan(runSizeMm(other.key));
    const categories = ['METAL', 'PLASTIC', 'GLASS', 'EMISSIVE', 'WOOD', 'FABRIC', 'OTHER'];
    for (const category of categories) for (const family of ['SIMPLE', 'GLASS', 'FABRIC', 'WOOD']) expect(wettabilityFamilyOf({ category, family })).not.toBe('WATER_REPELLENT');
    for (const k of Object.keys(STRINGS.en).filter((k) => k.startsWith('phys.') || k === 'undo.weather')) expect(STRINGS.es[k as keyof typeof STRINGS.es], k).toBeTruthy();
  });
});

describe('U16: the critical size is the engine’s, bit for bit', () => {
  it('the fixture was written from this table', () => {
    // Mutation checked: a family's angle changed in data/wettability.ts (without regenerating the fixture) fails.
    expect(fixture.families).toEqual(WETTABILITY.map((w) => ({ key: w.key, advancing: w.advancingDeg, receding: w.recedingDeg })));
  });

  it('every family at every tilt: the same sine and the same radius as rt_phys::wet::critical_radius', () => {
    // Mutations checked: Math.cos for the hysteresis instead of the engine's fmath (bits differ), the cap at the
    // advancing angle instead of the mean, and the `2 ×` of the Furmidge balance dropped: each fails.
    expect(fixture.cases).toHaveLength(WETTABILITY.length * 7);
    for (const c of fixture.cases) {
      const w = wettability(c.family);
      const sin = sinOfTilt(c.tilt);
      expect(bits(sin), `${c.family} ${c.tilt}°`).toBe(c.sin);
      const r = criticalRadiusMm(w.advancingDeg, w.recedingDeg, sin);
      expect(bits(r), `${c.family} ${c.tilt}°: ${r} vs ${c.mm}`).toBe(c.radius);
    }
    // Twice the radius across, on a vertical face: paint's drops run past about 4.2 mm.
    expect(runSizeMm('PAINT')).toBeCloseTo(2 * fixture.cases.find((c) => c.family === 'PAINT' && c.tilt === 90)!.mm!, 6);
    expect(criticalRadiusMm(85, 60, 0)).toBe(Infinity);
    expect(criticalRadiusMm(60, 60, 1)).toBe(0);
  });
});

describe('U16: the store', () => {
  it('Weather edits every part concerned in one undo step, and stores only what differs from the default', () => {
    // Mutation checked: `clears` not dropping `getsWet: true` leaves `{ getsWet: true }` on the parts and fails the
    // last expectations; one `physics/set` per part (several undo steps) fails the single undo.
    const { store, ids } = (() => {
      const s = exampleState();
      return { store: createStore(s), ids: keyIds(s) };
    })();
    const parts = weatherParts(store.get(), [ids.model]);
    expect(parts.sort()).toEqual([ids.base, ids.body, ids.label, ids.collar, ids.cap].sort());
    store.dispatch({ type: 'physics/set', ids: parts, patch: { getsWet: false }, label: 'Weather of Bottle' });
    expect(parts.every((p) => store.get().scene.nodes[p].physics?.getsWet === false)).toBe(true);
    expect(weatherView(store.get(), [ids.model]).getsWet).toBe(false);
    store.undo();
    expect(parts.every((p) => store.get().scene.nodes[p].physics === undefined)).toBe(true);
    store.redo();
    expect(weatherView(store.get(), [ids.model]).getsWet).toBe(false);
    // Mixed: one part back on.
    store.dispatch({ type: 'physics/set', ids: [ids.cap], patch: { getsWet: true } });
    const v = weatherView(store.get(), [ids.model]);
    expect([v.getsWet, v.getsDust, v.surface]).toEqual([null, true, 'AUTO']);
    expect(store.get().scene.nodes[ids.cap].physics).toBeUndefined();
    // The surface: a family, or the material's again; a key this version does not know is not taken.
    store.dispatch({ type: 'physics/set', ids: [ids.body], patch: { surface: 'WATER_REPELLENT', getsDust: false } });
    expect(store.get().scene.nodes[ids.body].physics).toEqual({ getsWet: false, surface: 'WATER_REPELLENT', getsDust: false });
    expect(surfaceFamily(store.get(), ids.body)).toBe('WATER_REPELLENT');
    expect(weatherView(store.get(), [ids.model]).surface).toBeNull();
    store.dispatch({ type: 'physics/set', ids: [ids.body], patch: { surface: 'TEFLON' as WettabilityFamily } });
    expect(store.get().scene.nodes[ids.body].physics?.surface).toBeUndefined();
    store.dispatch({ type: 'physics/set', ids: [ids.body], patch: { getsWet: true, getsDust: true } });
    expect(store.get().scene.nodes[ids.body].physics).toBeUndefined();
    expect(surfaceFamily(store.get(), ids.body)).toBe(materialFamily(store.get(), ids.body));
    // A value it already has changes nothing and leaves no step.
    const before = store.get();
    store.dispatch({ type: 'physics/set', ids: [ids.body], patch: { getsWet: true } });
    expect(store.get()).toBe(before);
  });

  it('the project keeps the weather, and an older project opens wet, dusty and of its materials’ families', async () => {
    // Mutation checked: the loader not reading `getsWet` (or `surface`) fails the round trip; reading any string as a
    // surface fails the unknown family.
    const { s, ids } = rainyBottle();
    const edited = apply(
      s,
      { type: 'physics/set', ids: [ids.cap], patch: { getsWet: false } },
      { type: 'physics/set', ids: [ids.body], patch: { getsDust: false, surface: 'WATER_REPELLENT' } },
    );
    const text = await serializeProject(edited).text();
    const opened = loadProject(text).state;
    expect(opened.scene.nodes[ids.cap].physics).toEqual({ getsWet: false });
    expect(opened.scene.nodes[ids.body].physics).toEqual({ getsDust: false, surface: 'WATER_REPELLENT' });
    const body = JSON.parse(text);
    body.state.scene.nodes[ids.body].physics = { surface: 'TEFLON', getsWet: 'no', getsDust: true };
    expect(loadProject(JSON.stringify(body)).state.scene.nodes[ids.body].physics).toBeUndefined();
    // A project of before U16 (and of before S2) opens with every part's weather at its default.
    const old = loadProject(readFileSync('tests/fixtures/project-v2.json', 'utf8')).state;
    for (const n of Object.values(old.scene.nodes).filter((n) => n.kind === 'PART')) expect(partWeatherOf(n)).toEqual({ getsWet: true, getsDust: true, surface: null });
  });
});

describe('U16: the spec writer', () => {
  it('a dry part is flagged 2, one without dust 4, both 6; the others write the bytes they wrote before', () => {
    // Mutation checked: `wptBytes` writing only the film flag fails the flags; `dry: true` on every part fails the
    // parts that keep the default.
    const { s, ids } = rainyBottle();
    const plain = wetPartsSpec(s)!;
    const plainBytes = wptBytes(plain);
    expect(partFlags(plainBytes).every((f) => f === 0)).toBe(true);
    const edited = apply(
      s,
      { type: 'physics/set', ids: [ids.cap], patch: { getsWet: false } },
      { type: 'physics/set', ids: [ids.body], patch: { getsDust: false } },
      { type: 'physics/set', ids: [ids.label], patch: { getsWet: false, getsDust: false } },
    );
    const spec = wetPartsSpec(edited)!;
    expect(spec.parts.map((p) => p.node)).toEqual(plain.parts.map((p) => p.node));
    const want = (id: string) => (id === ids.cap ? PART_DRY : id === ids.body ? PART_NO_DUST : id === ids.label ? PART_DRY | PART_NO_DUST : 0);
    expect(partFlags(wptBytes(spec))).toEqual(spec.parts.map((p) => want(p.node)));
    expect([PART_DRY, PART_NO_DUST]).toEqual([2, 4]);
    // Back to the defaults: the same bytes, the same key (the recordings of before stay valid).
    const back = apply(edited, { type: 'physics/set', ids: [ids.cap, ids.body, ids.label], patch: { getsWet: true, getsDust: true } });
    expect(wetPartsKey(wptBytes(wetPartsSpec(back)!))).toBe(wetPartsKey(plainBytes));
  });

  it('Surface gives the part the chosen family’s angles, soak and darkening', () => {
    // Mutation checked: `wetPartsSpec` keeping the material's family (ignoring `surface`) fails.
    const { s, ids } = rainyBottle();
    const spec = wetPartsSpec(apply(s, { type: 'physics/set', ids: [ids.label], patch: { surface: 'WATER_REPELLENT' } }))!;
    const label = spec.parts.find((p) => p.node === ids.label)!;
    const w = wettability('WATER_REPELLENT');
    expect([label.family, label.advancingDeg, label.recedingDeg, label.soakMmPerS, label.porosity]).toEqual(['WATER_REPELLENT', w.advancingDeg, w.recedingDeg, w.soakMmPerS, w.porosity]);
    // Without it, the family of its material (the example's label, Paper, wets as Paper since S3g; S3c gave it
    // Paint); given Paper, it soaks and darkens.
    const own = wetPartsSpec(s)!.parts.find((p) => p.node === ids.label)!;
    expect(own.family).toBe(materialFamily(s, ids.label));
    const paper = wetPartsSpec(apply(s, { type: 'physics/set', ids: [ids.label], patch: { surface: 'PAPER' } }))!.parts.find((p) => p.node === ids.label)!;
    expect([paper.family, paper.soakMmPerS, paper.porosity]).toEqual(['PAPER', wettability('PAPER').soakMmPerS, 1]);
  });
});

describe('U16: the sentences', () => {
  it('the role line, the size its drops run at, and the label of From the material', () => {
    // Mutations checked: the run size from the material's family instead of the chosen one, and a range shown for one
    // size, fail.
    const { s, ids } = rainyBottle();
    expect(roleLine(s, [ids.body])).toBe('Stays where it is: things fall onto it and the weather settles on it');
    const dyn = apply(s, { type: 'physics/set', ids: [ids.cap], patch: { role: 'DYNAMIC' } });
    expect(roleLine(dyn, [ids.cap])).toBe('Falls and collides with the rest');
    expect(roleLine(dyn, [ids.cap, ids.body])).toBe('The selection has more than one role: choose one to give it to all');
    const one = (f: WettabilityFamily) => formatNumber(runSizeMm(f), 'en', 1);
    expect(materialFamily(s, ids.base)).toBe('PLASTIC');
    expect(runSizeLine(s, [ids.base])).toBe('Drops start to run at about 4 mm across on a vertical face');
    const repellent = apply(s, { type: 'physics/set', ids: [ids.base], patch: { surface: 'WATER_REPELLENT' } }, { type: 'physics/set', ids: [ids.label], patch: { surface: 'PAPER' } });
    expect(runSizeLine(repellent, [ids.base])).toBe('Drops start to run at about 1.9 mm across on a vertical face');
    expect(one('WATER_REPELLENT')).toBe('1.9');
    expect(runSizeLine(repellent, [ids.base, ids.label])).toBe(`Drops start to run at about 1.9 to ${one('PAPER')} mm across on a vertical face, by part`);
    const dry = apply(s, { type: 'physics/set', ids: [ids.base], patch: { getsWet: false } });
    expect(runSizeLine(dry, [ids.base])).toBe('It keeps dry: no drop stays on it, and it still shelters what is below it');
    expect(surfaceAutoLabel(weatherView(s, [ids.base]))).toBe('From the material (Plastic)');
    expect(surfaceAutoLabel(weatherView(repellent, [ids.base]))).toBe('From the material (Plastic)');
    expect(surfaceAutoLabel(weatherView(s, [ids.model]))).toBe('From each part’s material');
  });

  it('the note when no effect falls on the parts, and the effect its button shows', () => {
    // Mutation checked: the note shown while an effect has On the parts on fails; the button pointing at the first
    // effect even when it leaves nothing on the parts (bubbles) fails.
    const bare = exampleState();
    expect(noWeatherNote(bare)).toEqual({ text: expect.stringContaining('add Rain, Snow or Dust motes'), button: 'Open Ambient', effect: null });
    const b = apply(bare, { type: 'effect/add', preset: 'BUBBLES' }, { type: 'effect/add', preset: 'SNOW' });
    expect(noWeatherNote(b)).toEqual({ text: 'Nothing in the scene leaves rain, dust or snow on the parts: switch “On the parts” on in an effect', button: 'Edit Snow', effect: b.effects[1].id });
    expect(noWeatherNote(rainyBottle().s)).toBeNull();
  });

  it('the pointer of the Material section', () => {
    // Mutation checked: the pointer naming the material's family when the part was given another fails.
    const { s, ids } = rainyBottle();
    expect(pointerLine(s, [ids.base])).toBe('Physics: Static · gets wet as Plastic');
    const edited = apply(s, { type: 'physics/set', ids: [ids.label], patch: { surface: 'WATER_REPELLENT', role: 'DYNAMIC' } });
    expect(pointerLine(edited, [ids.label])).toBe('Physics: Dynamic · gets wet as Water-repellent');
    expect(pointerLine(apply(s, { type: 'physics/set', ids: [ids.label], patch: { getsWet: false } }), [ids.label])).toBe('Physics: Static · keeps dry');
    expect(pointerLine(apply(s, { type: 'physics/set', ids: [ids.label], patch: { getsWet: false } }), [ids.model])).toBe('Physics: Static · some keep dry');
    expect(pointerLine(s, [ids.model])).toBe('Physics: Static · gets wet as several surfaces');
    expect(pointerLine(edited, [ids.label, ids.base])).toMatch(/^Physics: mixed roles · /);
    setLang('es');
    expect(pointerLine(s, [ids.base])).toBe('Físicas: Estático · se moja como Plástico');
    setLang('en');
  });
});

describe('U16: what Start simulates', () => {
  it('the dynamic parts, the rain and the parts that keep dry, the dust and snow on the parts that stay, the glass', () => {
    // Mutations checked: the dry parts counted among the rain's fails "(1 stays dry)"; the moving parts counted for
    // the dust fails the settle count; the plan ignoring the front glass fails the last line.
    const bare = exampleState();
    const ids = keyIds(bare);
    expect(planIsEmpty(startPlan(bare))).toBe(true);
    expect(planLine(startPlan(bare))).toBe('Nothing to simulate: make a part Dynamic, or switch “On the parts” on in an effect');
    const one = apply(bare, { type: 'physics/set', ids: [ids.cap], patch: { role: 'DYNAMIC' } });
    expect(planLine(startPlan(one))).toBe('Start simulates: 1 dynamic part');
    // A group that falls as one body moves each of its parts.
    const closure = apply(bare, { type: 'physics/set', ids: [ids.closure], patch: { role: 'DYNAMIC' } });
    expect(planLine(startPlan(closure))).toBe('Start simulates: 2 dynamic parts');
    const { s } = rainyBottle();
    expect(planLine(startPlan(s))).toBe('Start simulates: rain on 5 parts');
    const dry = apply(s, { type: 'physics/set', ids: [ids.cap], patch: { getsWet: false } }, { type: 'physics/set', ids: [ids.closure], patch: { role: 'DYNAMIC' } });
    expect(startPlan(dry)).toEqual({ dynamicParts: 2, rain: { parts: 4, dry: 1 }, settle: null, glass: false, liquids: 0 });
    expect(planLine(startPlan(dry))).toBe('Start simulates: 2 dynamic parts · rain on 4 parts (1 stays dry)');
    const snow = rainyBottle('SNOW');
    const bareSnow = apply(snow.s, { type: 'physics/set', ids: [ids.label], patch: { getsDust: false } }, { type: 'physics/set', ids: [ids.cap], patch: { role: 'DYNAMIC' } });
    expect(startPlan(bareSnow).settle).toEqual({ dust: false, snow: true, parts: 3, bare: 1 });
    expect(planLine(startPlan(bareSnow))).toBe('Start simulates: 1 dynamic part · snow on 3 parts (1 stays clean)');
    expect(planLine({ dynamicParts: 0, rain: { parts: 0, dry: 5 }, settle: { dust: true, snow: true, parts: 1, bare: 0 }, glass: true, liquids: 0 })).toBe('Start simulates: rain on no part (5 stay dry) · dust and snow on 1 part · the front glass');
    // The front glass of the active camera, fed by the scene.
    const cam = activeCamera(s);
    const glassy = reduce(s, { type: 'camera/set', id: cam.id, patch: { optics: { ...opticsOf(cam), frontGlass: { ...newFrontGlass(), source: 'SCENE' } } } });
    expect(startPlan(glassy).glass).toBe(true);
    expect(planLine(startPlan(glassy))).toBe('Start simulates: rain on 5 parts · the front glass');
    setLang('es');
    expect(planLine(startPlan(dry))).toBe('Iniciar simula: 2 piezas dinámicas · lluvia en 4 piezas (1 queda seca)');
    setLang('en');
  });
});

describe('U16: the real engine, through the page’s writer', () => {
  /** A plate 300 mm square on the floor and a roof of 150 × 300 mm, 120 mm above its half x > 0, under rain and dust. */
  function roofScene(roof: { getsWet?: boolean; getsDust?: boolean; surface?: WettabilityFamily }): { s: ProjectState; floor: string; roof: string } {
    let s = exampleState();
    s = apply(s, { type: 'scene/setVisible', ids: [...s.scene.roots], visible: false });
    s = reduce(s, { type: 'scene/addPrimitive', kind: 'PLANE', params: { ...defaultParams('PLANE', 300), width: 300, depth: 300 }, position: [0, 0, 1], name: 'Floor' });
    const floor = s.selection.ids[0];
    s = reduce(s, { type: 'scene/addPrimitive', kind: 'PLANE', params: { ...defaultParams('PLANE', 300), width: 150, depth: 300 }, position: [75, 0, 120], name: 'Roof' });
    const roofId = s.selection.ids[0];
    s = apply(s, { type: 'effect/add', preset: 'RAIN' }, { type: 'effect/add', preset: 'DUST_CLOUD' });
    for (const e of s.effects) s = reduce(s, { type: 'effect/set', id: e.id, patch: { wetParts: true } });
    s = reduce(s, { type: 'physics/set', ids: [roofId], patch: roof });
    return { s, floor, roof: roofId };
  }

  it.skipIf(!RT_WASM)('a dry roof takes no water and still shelters; one without dust takes none; Surface reaches the engine', async () => {
    // Mutation checked: `wptBytes` not writing PART_DRY fails the dry roof (the engine wets it); not writing
    // PART_NO_DUST fails its dust rates; the material's family instead of the chosen one fails the cap angle.
    const { instance } = await WebAssembly.instantiate(readFileSync(RT_WASM!), {});
    const rt = instance.exports;
    expect(hasPartsExports(rt)).toBe(true);
    if (!hasPartsExports(rt)) return;
    const run = (roof: Parameters<typeof roofScene>[0], roofed = true) => {
      const scene = roofScene(roof);
      const { floor, roof: roofId } = scene;
      const s = roofed ? scene.s : apply(scene.s, { type: 'scene/setVisible', ids: [roofId], visible: false });
      const spec = wetPartsSpec(s)!;
      const bytes = wptBytes(spec);
      const sim = new PartsSim(rt, bytes);
      const layout = parseLayout(sim.layout())!;
      const meta: PartsTrackPart[] = spec.parts.map((p, k) => ({ node: p.node, mesh: p.mesh, triangles: layout.parts[k].triangles, samples: layout.parts[k].samples, capAngleDeg: layout.parts[k].capAngleDeg, porosity: p.porosity }));
      const w = new PartsTrackWriter(24, wetPartsKey(bytes), meta, sim.layout());
      w.push(sim.frame());
      for (let k = 0; k < 24; k++) {
        sim.step(10);
        w.push(sim.frame());
      }
      sim.free();
      const last = partsFrame(w.track(), 24)!;
      const at = (id: string) => spec.parts.findIndex((p) => p.node === id);
      expect(at(floor)).toBeGreaterThanOrEqual(0);
      const wet = (k: number) => last.parts[k].values.filter((_, i) => i % 3 === 0 && last.parts[k].values[i] > 0).length;
      return { roof: at(roofId), floor: at(floor), layout, last, wet };
    };
    const plain = run({});
    expect(plain.wet(plain.roof)).toBeGreaterThan(0);
    expect(plain.layout.parts[plain.roof].dust).not.toBeNull();
    const dry = run({ getsWet: false });
    expect(dry.wet(dry.roof)).toBe(0);
    expect(dry.last.parts[dry.roof].drops).toHaveLength(0);
    expect(dry.wet(dry.floor)).toBeGreaterThan(0);
    // It still takes the dust (the flags are independent).
    expect(dry.layout.parts[dry.roof].dust).not.toBeNull();
    // Sheltering: the dry roof keeps the rain off the half of the floor under it (the floor alone gets more of it).
    const open = run({}, false);
    expect(dry.wet(dry.floor)).toBeLessThan(0.75 * open.wet(open.floor));
    const bare = run({ getsDust: false });
    expect(bare.layout.parts[bare.roof].dust).toBeNull();
    expect(bare.layout.parts[bare.floor].dust).not.toBeNull();
    expect(bare.wet(bare.roof)).toBeGreaterThan(0);
    const repellent = run({ surface: 'WATER_REPELLENT' });
    const w = wettability('WATER_REPELLENT');
    expect(repellent.layout.parts[repellent.roof].capAngleDeg).toBeCloseTo((w.advancingDeg + w.recedingDeg) / 2, 4);
  }, 120_000);
});

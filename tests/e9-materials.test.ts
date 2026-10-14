// E9: the scattering medium inside clear solids, on the interface's side: the catalogue recipes
// (and the engine's copy of them), the material parameters and their strings, the RSB fields
// (with the Abbe number that dispersion will read), older projects, Fast mode's approximation, and
// the real rt.wasm rendering a medium.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FAMILY_PARAMS, instanceFromPreset, type MaterialInstance } from '../src/core/materials';
import { MATERIAL_PRESETS, materialPreset } from '../src/data/materials';
import { wearDefaults } from '../src/core/wear';
import { loadProject, serializeProject } from '../src/io/project';
import { defaultCamera, defaultEnvironment, defaultFloor, defaultMaterial, defaultRender, MATERIAL_GLASS, materialToRsb, SCATTER_G_MAX, writeRsb, type RsbScene } from '../src/io/rsb';
import { applyMaterial, clarityOfMedium, diffuseOfMedium } from '../src/render/materials';
import { STRINGS } from '../src/ui/strings';
import { readRsb, sections } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';
import v1Text from './fixtures/project-v1.json?raw';
import sheetText from '../engine/crates/rt-cli/src/sss_sheet.rs?raw';

/** The translucent recipes of E9 (keys are stable: added, never renamed). */
const MEDIA = ['HDPE_WHITE', 'PP_NATURAL', 'PMMA_FROST', 'WAX', 'SOAP_GLYCERIN', 'MILK', 'JUICE_ORANGE', 'JUICE_APPLE', 'CREAM'];

describe('E9 recipes', () => {
  it('add the translucent plastics, wax, soap, milk, juices and cream as glass with a medium', () => {
    for (const key of MEDIA) {
      const p = materialPreset(key);
      expect(p, key).toBeDefined();
      expect(p!.family, key).toBe('GLASS');
      const mfp = p!.params.scatterMm as number;
      expect(mfp, key).toBeGreaterThan(0);
      const albedo = p!.params.scatterColor as number[];
      for (const a of albedo.slice(0, 3)) expect(a >= 0 && a <= 1, key).toBe(true);
      expect(Math.abs(p!.params.scatterG as number), key).toBeLessThanOrEqual(SCATTER_G_MAX);
      const rsb = materialToRsb(instanceFromPreset('m', key, 100));
      expect(rsb.kind).toBe(MATERIAL_GLASS);
      expect(rsb.scatterMm).toBeCloseTo(mfp, 6);
      expect(rsb.scatterColor).toEqual(albedo.slice(0, 3));
      expect(wearDefaults(key), key).not.toBeNull();
    }
    // The plastics sit with the plastics, the rest with the others; the liquids do not wear.
    expect(['HDPE_WHITE', 'PP_NATURAL', 'PMMA_FROST'].map((k) => materialPreset(k)!.category)).toEqual(['PLASTIC', 'PLASTIC', 'PLASTIC']);
    for (const k of ['MILK', 'JUICE_ORANGE', 'JUICE_APPLE', 'CREAM']) expect(wearDefaults(k)!.amount, k).toBe(0);
    // Milk is Jensen et al.'s whole milk: one mean free path of about 0.31 mm, almost white.
    const milk = materialPreset('MILK')!.params;
    expect(milk.scatterMm).toBeCloseTo(0.31, 6);
    expect((milk.scatterColor as number[])[2]).toBeLessThan((milk.scatterColor as number[])[0]);
  });

  it('keep every older key and are not linked to anything they are not', () => {
    const keys = MATERIAL_PRESETS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const old of ['PP', 'PMMA', 'GLASS_FROST', 'SILICONE', 'WHITE_STUDIO']) expect(keys).toContain(old);
    // The older glass recipes have no medium.
    for (const m of MATERIAL_PRESETS.filter((x) => x.family === 'GLASS' && !MEDIA.includes(x.key))) {
      expect(materialToRsb(instanceFromPreset('m', m.key, 100)).scatterMm, m.key).toBe(0);
    }
  });
});

describe('E9 recipes in the engine', () => {
  it('the contact sheet of the media renders the catalogue numbers (rt --sss-sheet)', () => {
    // engine/crates/rt-cli/src/sss_sheet.rs repeats the nine recipes as the engine receives them:
    // medium(base, roughness, ior, absorption_mm, scatter_mm, albedo, g).
    const found = [...sheetText.matchAll(/r\(\s*"([A-Z_]+)",\s*"[^"]*",\s*medium\(([^)]*)\)/g)];
    expect(found.map((m) => m[1])).toEqual(MEDIA);
    for (const [, key, args] of found) {
      const json = args.replace(/\[([-\d.]+);\s*3\]/g, '[$1, $1, $1]');
      const [base, roughness, ior, absorptionMm, scatterMm, albedo, g] = JSON.parse(`[${json.replace(/,\s*$/, '')}]`) as [number[], number, number, number, number, number[], number];
      const rsb = materialToRsb(instanceFromPreset('m', key, 100));
      const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
      const pairs: [number, number][] = [
        [roughness, rsb.roughness],
        [ior, rsb.ior],
        [absorptionMm, rsb.absorptionMm],
        [scatterMm, rsb.scatterMm],
        [g, rsb.scatterG],
        ...base.map((v, i): [number, number] => [v, rsb.baseColor[i]]),
        ...albedo.map((v, i): [number, number] => [v, rsb.scatterColor[i]]),
      ];
      for (const [a, b] of pairs) expect(near(a, b), `${key}: ${a} vs ${b}`).toBe(true);
    }
  });
});

describe('E9 material parameters', () => {
  it('the glass family shows the medium after its transmission, with strings in both languages', () => {
    const keys = FAMILY_PARAMS.GLASS.map((p) => p.key);
    const at = keys.indexOf('transmission');
    expect(keys.slice(at)).toEqual(['transmission', 'absorptionMm', 'walls', 'scatterMm', 'scatterColor', 'scatterG']);
    const g = FAMILY_PARAMS.GLASS.find((p) => p.key === 'scatterG')!;
    expect([g.min, g.max, g.fallback]).toEqual([-0.9, 0.9, 0]);
    for (const key of ['scatterMm', 'scatterColor', 'scatterG']) {
      const spec = FAMILY_PARAMS.GLASS.find((p) => p.key === key)!;
      for (const s of [`param.${key}`, spec.tip!]) {
        const [en, es] = [text('en', s), text('es', s)];
        expect(en && es && en !== es, s).toBeTruthy();
      }
    }
    // The direction's help says forwards / backwards, in Spanish too.
    expect(text('en', 'param.scatterG.tip')).toMatch(/forwards.*backwards/);
    expect(text('es', 'param.scatterG.tip')).toMatch(/hacia delante.*hacia atrás/);
    // And the medium's help says that Fast only approximates it.
    expect(text('en', 'param.scatterMm.tip')).toMatch(/Fast approximates/);
    expect(text('es', 'param.scatterMm.tip')).toMatch(/Rápido la aproxima/);
  });

  it('an edit is an undoable mutation of the params like any other', () => {
    const inst = instanceFromPreset('m', 'GLASS_CLEAR', 100)!;
    const edited: MaterialInstance = { ...inst, params: { ...inst.params, scatterMm: 2, scatterColor: [0.9, 0.8, 0.7, 1], scatterG: 2, abbe: 40 } };
    const rsb = materialToRsb(edited);
    expect([rsb.scatterMm, rsb.scatterG, rsb.abbe]).toEqual([2, SCATTER_G_MAX, 40]);
    expect(rsb.scatterColor).toEqual([0.9, 0.8, 0.7]);
  });
});

describe('E9 RSB fields', () => {
  it('MATL is 100 bytes: the E5 record, the bevel reserved for E6, then the medium and the Abbe number', () => {
    const scene: RsbScene = {
      camera: defaultCamera(),
      materials: [{ ...defaultMaterial(), bevelMm: 0, scatterMm: 0.31, scatterColor: [0.25, 0.5, 0.75], scatterG: -0.5, abbe: 40 }],
      meshes: [],
      instances: null,
      lights: [],
      environment: defaultEnvironment(),
      floor: defaultFloor(),
      render: defaultRender(),
      bitmaps: [],
    };
    const bytes = writeRsb(scene);
    const back = readRsb(bytes);
    const v = sections(bytes).find((x) => x.tag === 'MATL')!.payload;
    expect(v.byteLength).toBe(100);
    // Byte 72: the bevel (0), 76: scatter_mm, 80..92: scatter_color, 92: scatter_g, 96: abbe.
    expect([v.getFloat32(72, true), v.getFloat32(76, true), v.getFloat32(80, true), v.getFloat32(84, true), v.getFloat32(88, true), v.getFloat32(92, true), v.getFloat32(96, true)]).toEqual([
      0,
      Math.fround(0.31),
      0.25,
      0.5,
      0.75,
      -0.5,
      40,
    ]);
    expect(back.materials[0]).toMatchObject({ bevelMm: 0, scatterG: -0.5, abbe: 40 });
  });
});

describe('E9 and older projects', () => {
  it('a project saved before E9 opens unchanged and renders without a medium or dispersion', async () => {
    // project-v1.json with its paper turned into clear glass as an older version saved it: no E9 keys.
    const raw = JSON.parse(v1Text);
    const id = Object.keys(raw.state.materials)[0];
    const glass = instanceFromPreset(id, 'GLASS_TINT', 100)!;
    raw.state.materials[id] = { ...raw.state.materials[id], family: 'GLASS', category: 'GLASS', preset: 'GLASS_TINT', params: { ...glass.params } };
    const { state } = loadProject(JSON.stringify(raw));
    const loaded = state.materials[id];
    expect(Object.keys(loaded.params).sort()).toEqual(Object.keys(glass.params).sort());
    const rsb = materialToRsb(loaded);
    expect([rsb.bevelMm, rsb.scatterMm, rsb.scatterG, rsb.abbe]).toEqual([0, 0, 0, 0]);
    expect(rsb.scatterColor).toEqual([1, 1, 1]);
    // Saved again, it keeps exactly the params it had (nothing added behind the user's back).
    const again = JSON.parse(await (await serializeProject(state)).text());
    expect(again.state.materials[id].params).toEqual(loaded.params);
  });
});

describe('E9 in Fast mode', () => {
  it('a medium becomes a translucent diffuse: opaque when dense for the part, see-through when sparse', () => {
    expect(diffuseOfMedium(1)).toBe(1);
    expect(diffuseOfMedium(0)).toBe(0);
    expect(diffuseOfMedium(0.99)).toBeLessThan(0.99);
    // van de Hulst's similarity relation: s = √(1 - a), (1 - s)(1 - 0.139 s) / (1 + 1.17 s).
    expect(diffuseOfMedium(0.99)).toBeCloseTo((0.9 * (1 - 0.0139)) / 1.117, 6);
    expect(clarityOfMedium(0.3, 100)).toBeLessThan(0.05);
    expect(clarityOfMedium(100, 100)).toBe(1);
    const milk = new THREE.MeshPhysicalMaterial();
    applyMaterial(milk, instanceFromPreset('m', 'MILK', 100)!, 100);
    expect(milk.transmission).toBeLessThan(0.05);
    expect(milk.color.r).toBeGreaterThan(0.9);
    const clear = new THREE.MeshPhysicalMaterial();
    applyMaterial(clear, instanceFromPreset('m', 'GLASS_CLEAR', 100)!, 100);
    expect(clear.transmission).toBe(1);
  });
});

const live = RT_WASM ? describe : describe.skip;

live('E9 through the page’s code (the real rt.wasm)', () => {
  it('renders the scattering medium of the E9 scene to rt-core’s pinned image', async () => {
    // tests/fixtures/e9.rsb is `rt --write-e9-example`: the E5 scene with a medium in its glass.
    const rt = await loadRt();
    const rsb = new Uint8Array(readFileSync('tests/fixtures/e9.rsb'));
    const { image } = renderWithPasses(rt, rsb, 160, 120, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_E9_MEDIA_4SPP'));
  }, 120_000);
});

/** A string of the interface by its key, in one language. */
function text(lang: 'en' | 'es', key: string): string | undefined {
  return (STRINGS[lang] as Record<string, string>)[key];
}

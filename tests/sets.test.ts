// Phase L6: sets of studio with a photographer's criteria. The schema (optional fields, the 72 setups before L6
// untouched), the product types' new rigs, the cards out of every frame, applying, replacing and resetting a set's
// decoration (one undo step each), Use the set's camera, the pool, the gradient background, the thumbnails.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeCamera, cameraPosition, outputAspect } from '../src/core/camera';
import { gradientPixels } from '../src/core/images';
import { specIrradiance } from '../src/core/light-math';
import { lightFrame, lightsFromRig, rigPivot } from '../src/core/lighting';
import { baseExposure, POOL_THROW, poolWeight, presetIrradiance, recipeScale, setupExposure, setupRig } from '../src/core/rig';
import { applySet, cardCorners, cardFrame, eulerOf, isSet, POOL_GRAZE, poolLanding, poolTarget, poolTop, setOf, setPieceIds } from '../src/core/sets';
import { sha256Hex } from '../src/core/sha256';
import { isSetPiece, measuredSizeMm, productBounds } from '../src/core/scene';
import { createStore, reduce, type ProjectState } from '../src/core/store';
import { mat4Compose, sub, length, normalize, dot, transformDirection } from '../src/core/math';
import { LIGHT_SETUPS, lightSetup } from '../src/data/light-setups';
import { materialPreset } from '../src/data/materials';
import { PRESET_SETS, STUDIO_PRESETS, studioPreset } from '../src/data/studios';
import type { LightSetup, LightSpec } from '../src/data/types';
import { BACKGROUND_BACKPLATE, BACKPLATE_STRETCH, projectScene } from '../src/io/rsb';
import { setupTip } from '../src/ui/names';
import { loadProject, serializeProject } from '../src/io/project';
import { STRINGS } from '../src/ui/strings';
import { apply, exampleState } from './helpers';
import { buildExample } from '../src/core/example';
import { framedCamera, inFrame, reflectionSeen } from './frame-check';
import { backdropMask, maskedMean, partPeak, poolContrast, poolPixel, rowProfile, thumbnail } from './thumb-metrics';
import { PRESET_KEYS, rigHash } from './old-rigs';
import { thumbRsb } from './set-heroes';
import type { Box } from '../src/core/math';

const SETS = LIGHT_SETUPS.filter((s) => s.style === 'SETS');
const OLD = LIGHT_SETUPS.filter((s) => s.style !== 'SETS');
const L6_FIELDS = ['backdrop', 'pool', 'floor', 'cards', 'exposureEv', 'envStrength', 'camera', 'hero', 'why', 'caustics'] as const;

const set = (key: string): LightSetup => setOf(key)!;
const withSet = (key: string, state = exampleState()): ProjectState => reduce(state, { type: 'studio/setSetup', key });

describe('the schema of a set', () => {
  it('leaves the 72 setups before L6 without any of the new fields: none of them is a set', () => {
    expect(OLD).toHaveLength(72);
    for (const s of OLD) {
      for (const f of L6_FIELDS) expect(s[f], `${s.key}.${f}`).toBeUndefined();
      expect(isSet(s), s.key).toBe(false);
    }
  });

  it('gives each of the 16 sets a hero, a backdrop and its reason in two sentences in both languages', () => {
    expect(SETS.map((s) => s.key)).toEqual([
      'STRIP_EDGE', 'GLASS_DARK_FIELD', 'BRIGHT_FIELD', 'HIGH_KEY_WHITE', 'JEWEL_BOX', 'CHROME_FAMILY', 'RAKING_TEXTURE', 'BLACK_ON_BLACK',
      'WARM_WINDOW', 'BACKLIT_LIQUID', 'WARM_COOL_CINEMA', 'POP_COLOR', 'GRADIENT_POOL', 'MIRROR_FLOOR', 'FLAT_LAY', 'SILHOUETTE_GLOW',
    ]);
    const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    for (const s of SETS) {
      expect(isSet(s), s.key).toBe(true);
      expect(['BOTTLE', 'BOX', 'RING', 'CHROME', 'SHOE', 'SPHERES'], s.key).toContain(s.hero);
      expect(s.backdrop, s.key).toBeDefined();
      expect(sentences(s.why!.es), `${s.key} es`).toBe(2);
      expect(sentences(s.why!.en), `${s.key} en`).toBe(2);
      expect(s.lights!.length, s.key).toBeGreaterThan(0);
    }
  });

  it('only names catalogue materials, and gives every light and pool a share (they are normalised to the level)', () => {
    for (const s of SETS) {
      for (const c of s.cards ?? []) expect(materialPreset(c.material), `${s.key} card ${c.material}`).toBeDefined();
      if (s.floor?.material) expect(materialPreset(s.floor.material), s.key).toBeDefined();
      const total = s.lights!.reduce((a, l) => a + (l.share ?? 0), 0) + (s.pool?.share ?? 0);
      expect(total, s.key).toBeGreaterThan(0.8);
      expect(total, s.key).toBeLessThan(2.6);
      for (const l of s.lights!) expect(l.share, s.key).toBeGreaterThan(0);
      if (s.pool) expect(s.pool.share, s.key).toBeGreaterThan(0);
    }
  });

  it('adds the five set materials (the silver card is brushed aluminium) without touching the others', () => {
    for (const k of ['CARD_WHITE', 'CARD_BLACK', 'ACRYLIC_BLACK', 'ACRYLIC_WHITE', 'MIRROR_BLACK']) expect(materialPreset(k), k).toBeDefined();
    expect(materialPreset('CARD_WHITE')!.params.baseColor).toEqual([0.92, 0.92, 0.92, 1]);
    expect(materialPreset('CARD_BLACK')!.params.baseColor).toEqual([0.02, 0.02, 0.02, 1]);
    expect(SETS.flatMap((s) => s.cards ?? []).filter((c) => c.material === 'ALU_BRUSH')).toHaveLength(1);
  });
});

describe('the rigs before L6', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/old-setup-rigs.json', 'utf8')) as { levels: Record<string, number>; setups: Record<string, string> };

  it('every product type keeps its level (its total irradiance), so no exposure moves', () => {
    for (const p of PRESET_KEYS) expect(Math.abs(presetIrradiance(p) / fixture.levels[p] - 1), p).toBeLessThan(1e-6);
  });

  it('each of the 71 setups resolves to the same rig as before L6, against every product type', () => {
    const keys = OLD.filter((s) => s.key !== 'PRESET').map((s) => s.key);
    expect(Object.keys(fixture.setups).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      for (const p of PRESET_KEYS) expect(rigHash(setupRig(p, key), presetIrradiance(p)), `${key} on ${p}`).toBe(fixture.setups[key]);
    }
  });
});

describe('the product types take the lights of a set', () => {
  const before = JSON.parse(readFileSync('tests/fixtures/studio-rigs-before-l6.json', 'utf8')) as { lights: Record<string, LightSpec[]> };

  it('maps 15 types to a set and keeps the sun of outdoor furniture', () => {
    expect(Object.keys(PRESET_SETS).sort()).toEqual(STUDIO_PRESETS.map((p) => p.key).filter((k) => k !== 'FURNITURE_OUT').sort());
    expect(studioPreset('FURNITURE_OUT')!.lights).toEqual(before.lights.FURNITURE_OUT);
    expect(PRESET_SETS).toMatchObject({ JEWELLERY: 'JEWEL_BOX', WATCH: 'CHROME_FAMILY', PERFUME: 'STRIP_EDGE', COSMETICS: 'STRIP_EDGE', ELECTRONICS: 'BLACK_ON_BLACK', FOOTWEAR: 'RAKING_TEXTURE', TEXTILE: 'RAKING_TEXTURE', FURNITURE_IN: 'WARM_WINDOW', PACKAGING: 'GRADIENT_POOL', GENERIC: 'GRADIENT_POOL' });
  });

  it('each type has its set’s lights where the set has them, their energies in the proportion of the shares', () => {
    for (const [p, k] of Object.entries(PRESET_SETS)) {
      const mine = studioPreset(p)!.lights;
      const theirs = lightSetup(k)!.lights!;
      expect(mine.length, p).toBe(theirs.length);
      const k0 = mine[0].energy! / theirs[0].share!;
      mine.forEach((l, i) => {
        const { share, ...shape } = theirs[i];
        const { energy, ...own } = l;
        expect(own, `${p} light ${i}`).toEqual(shape);
        expect(Math.abs(energy! / (k0 * share!) - 1), `${p} light ${i}`).toBeLessThan(1e-6);
      });
      expect(studioPreset(p)!.lights).not.toEqual(before.lights[p]);
    }
  });
});

describe('a product type that is a set', () => {
  const before = JSON.parse(readFileSync('tests/fixtures/studio-rigs-before-l6.json', 'utf8')) as { exposure: Record<string, number> };

  it('has its set’s exposure offset folded into its exposure; any other setup starts from the exposure it had', () => {
    for (const p of STUDIO_PRESETS) {
      const offset = p.set ? (lightSetup(p.set)!.exposureEv ?? 0) : 0;
      expect(p.exposure, p.key).toBeCloseTo(before.exposure[p.key] + offset, 9);
      expect(baseExposure(p), p.key).toBeCloseTo(before.exposure[p.key], 9);
      expect(setupExposure(p, 'PRESET'), p.key).toBe(p.exposure);
      expect(setupExposure(p, 'REMBRANDT'), p.key).toBeCloseTo(before.exposure[p.key], 9);
      // A set on it: the type's base and the set's offset, never the type's own offset as well.
      expect(setupExposure(p, 'STRIP_EDGE'), p.key).toBeCloseTo(before.exposure[p.key] - 0.3, 9);
    }
  });

  it('Create studio with its own rig dresses the product with its set: the type’s lights, the set’s decoration', () => {
    const s = apply(exampleState(), { type: 'studio/setPreset', key: 'PERFUME' }, { type: 'studio/build' });
    expect(s.studio.lightSetup).toBe('PRESET');
    expect(s.studio.lights.filter((l) => !l.setPiece)).toEqual(lightsFromRig('PERFUME', 'PRESET'));
    expect(setPieceIds(s).map((id) => s.scene.nodes[id].setPiece!.kind).sort()).toEqual(['BACKDROP', 'CARD', 'CARD', 'FLOOR']);
    expect(s.studio.lights.filter((l) => l.setPiece === 'POOL')).toHaveLength(1);
    expect(s.image.exposureEv).toBe(studioPreset('PERFUME')!.exposure);
    // The pool stands to the type's lights as it stands to the set's.
    const k = presetIrradiance('PERFUME') / set('STRIP_EDGE').lights!.reduce((a, l) => a + specIrradiance(l), 0);
    const pool = s.studio.lights.find((l) => l.setPiece === 'POOL')!;
    const f = lightFrame(s, pool);
    const sweep = s.scene.nodes[setPieceIds(s).find((id) => s.scene.nodes[id].setPiece!.kind === 'BACKDROP')!];
    const { normal } = poolLanding(s, sweep);
    const facing = Math.max(POOL_GRAZE, Math.abs(dot(normal!, normalize(sub(f.position, f.target)))));
    expect(pool.power).toBeCloseTo((k * set('STRIP_EDGE').pool!.share * (length(sub(f.target, f.position)) / s.scene.partSizeMm / POOL_THROW) ** 2) / facing, 4);
    // Choosing the type's own rig in the catalogue does the same; another setup takes it away.
    const again = reduce(reduce(s, { type: 'studio/setSetup', key: 'REMBRANDT' }), { type: 'studio/setSetup', key: 'PRESET' });
    expect(setPieceIds(again).length).toBe(4);
    const away = reduce(s, { type: 'studio/setSetup', key: 'REMBRANDT' });
    expect(setPieceIds(away)).toEqual([]);
    expect(away.image.exposureEv).toBeCloseTo(before.exposure.PERFUME, 9);
  });

  it('a new project has the type’s look but nothing around nothing; the decoration comes with the product', () => {
    const fresh = createStore();
    expect(setPieceIds(fresh.get())).toEqual([]);
    fresh.transaction('Example', () => {
      fresh.dispatch({ type: 'scene/addModel', payload: buildExample(), replace: true });
      fresh.dispatch({ type: 'camera/frame' });
      fresh.dispatch({ type: 'studio/fitSet' });
    });
    expect(setPieceIds(fresh.get()).length).toBeGreaterThan(0);
    expect(fresh.history().undo).toHaveLength(1);
    // Fitting again keeps each piece as it was (here: a card the person switched off stays off).
    const s = fresh.get();
    const piece = setPieceIds(s)[0];
    const off = reduce(s, { type: 'scene/setVisible', ids: [piece], visible: false });
    const refit = reduce(off, { type: 'studio/fitSet' });
    const same = setPieceIds(refit).find((id) => refit.scene.nodes[id].setPiece!.kind === s.scene.nodes[piece].setPiece!.kind && refit.scene.nodes[id].setPiece!.index === s.scene.nodes[piece].setPiece!.index)!;
    expect(refit.scene.nodes[same].visible).toBe(false);
    // Outdoor furniture is no set: nothing to fit.
    const out = apply(exampleState(), { type: 'studio/setPreset', key: 'FURNITURE_OUT' }, { type: 'studio/build' });
    expect(setPieceIds(out)).toEqual([]);
    expect(reduce(out, { type: 'studio/fitSet' })).toBe(out);
  });

  it('Reset setup takes its decoration away too', () => {
    const s = apply(exampleState(), { type: 'studio/build' });
    expect(setPieceIds(s).length).toBeGreaterThan(0);
    const reset = reduce(s, { type: 'studio/resetLights' });
    expect(setPieceIds(reset)).toEqual([]);
    expect(reset.studio.lights).toEqual(lightsFromRig('GENERIC', 'PRESET'));
  });
});

describe('the cards never enter the frame', () => {
  const S = 100;
  const boxes: Record<string, Box> = {
    cube: { min: [-50, -50, 0], max: [50, 50, 100] },
    tall: { min: [-25, -25, 0], max: [25, 25, 100] },
    wide: { min: [-50, -25, 0], max: [50, 25, 40] },
  };
  const focals = [...new Set(STUDIO_PRESETS.map((p) => p.focalMm))];
  const aspects = [16 / 9, 1, 4 / 5];
  const seen = (s: LightSetup, card: NonNullable<LightSetup['cards']>[number]): string[] => {
    const out: string[] = [];
    for (const [name, box] of Object.entries(boxes)) {
      const pivot: [number, number, number] = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
      const views: [number, number | undefined][] = focals.map((f) => [f, undefined]);
      if (s.camera) views.push([s.camera.focalMm ?? 85, s.camera.el]);
      for (const [focal, el] of views) {
        for (const aspect of aspects) {
          const cam = framedCamera(box, focal, aspect, el);
          if (inFrame(cam, aspect, cardCorners(cardFrame(card, pivot, S, 0.2))).length > 0) out.push(`${name} ${focal} mm ${aspect.toFixed(2)}${el !== undefined ? ` el ${el}` : ''}`);
        }
      }
    }
    return out;
  };

  it('with the focal length of every product type, three product shapes, three aspects and the set’s own camera', () => {
    for (const s of SETS) (s.cards ?? []).forEach((c, i) => expect(seen(s, c), `${s.key} card ${i}`).toEqual([]));
  });

  it('follows the rule of the plan: |az| >= 55 or el >= 60', () => {
    for (const s of SETS) for (const c of s.cards ?? []) expect(Math.abs(c.az) >= 55 || c.el >= 60, `${s.key} ${c.material}`).toBe(true);
  });

  it('is not a test that passes on its own: a card in front of the product is seen', () => {
    const front = { material: 'CARD_WHITE', az: 0, el: 10, dist: 1.6, size: 1, sizeY: 1 };
    expect(seen(SETS[0], front).length).toBeGreaterThan(0);
    // And a card off to the side, but large enough to reach across, is seen too.
    expect(seen(SETS[0], { ...front, az: 60, size: 6 }).length).toBeGreaterThan(0);
  });

  it('a card faces the product, stands on the floor and keeps its size', () => {
    const f = cardFrame({ material: 'CARD_BLACK', az: 60, el: 15, dist: 1.6, size: 2, sizeY: 5 }, [0, 0, 50], 100, 0.2);
    const lowest = Math.min(...cardCorners(f).map((p) => p[2]));
    expect(lowest).toBeCloseTo(0.2, 6);
    // It faces the product (from where it was before it was raised onto the floor).
    expect(dot(f.normal, normalize(sub([0, 0, 50], f.centre)))).toBeGreaterThan(0.6);
    expect(f.width).toBe(200);
    expect(f.height).toBe(500);
    // The plane's rotation turns its +Z to the normal, +X to its width.
    const m = mat4Compose(f.centre, eulerOf(f.right, f.up, f.normal), [1, 1, 1]);
    const z = transformDirection(m, [0, 0, 1]);
    const x = transformDirection(m, [1, 0, 0]);
    for (let k = 0; k < 3; k++) {
      expect(z[k]).toBeCloseTo(f.normal[k], 9);
      expect(x[k]).toBeCloseTo(f.right[k], 9);
    }
  });
});

describe('the strips’ reflections in a glossy floor', () => {
  const S = 100;
  const boxes: Record<string, Box> = {
    cube: { min: [-50, -50, 0], max: [50, 50, 100] },
    tall: { min: [-25, -25, 0], max: [25, 25, 100] },
    wide: { min: [-50, -25, 0], max: [50, 25, 40] },
  };
  /** A strip: a panel that reflects, four times as long as it is wide. */
  const isStrip = (l: LightSpec) => (l.type ?? 'AREA') === 'AREA' && l.glossy !== false && Math.max(l.size, l.sizeY ?? l.size) >= 4 * Math.min(l.size, l.sizeY ?? l.size);
  const shown = (s: LightSetup, l: LightSpec): string[] => {
    const out: string[] = [];
    for (const [name, box] of Object.entries(boxes)) {
      const pivot: [number, number, number] = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
      for (const aspect of [16 / 9, 1]) {
        const cam = framedCamera(box, s.camera?.focalMm ?? 85, aspect, s.camera?.el);
        const strip = cardCorners(cardFrame({ material: '', az: l.az, el: l.el, dist: l.dist, size: l.size, sizeY: l.sizeY }, pivot, S, -Infinity));
        if (reflectionSeen(cam, aspect, strip, box).length > 0) out.push(`${name} ${aspect.toFixed(2)}`);
      }
    }
    return out;
  };

  it('of every set with a glossy or mirror floor fall behind the product or out of the frame of the set’s camera', () => {
    const glossy = SETS.filter((s) => s.floor?.kind === 'GLOSSY' || s.floor?.kind === 'MIRROR');
    expect(glossy.length).toBeGreaterThan(8);
    let strips = 0;
    for (const s of glossy) {
      s.lights!.forEach((l, i) => {
        if (!isStrip(l)) return;
        strips++;
        expect(shown(s, l), `${s.key} light ${i}`).toEqual([]);
      });
    }
    expect(strips).toBe(15);
  });

  it('is not a test that passes on its own: a rim strip behind the product, low, shows in front of it', () => {
    expect(shown(set('CHROME_FAMILY'), { role: 'RIM', size: 0.3, sizeY: 3, az: 170, el: 20, dist: 3 }).length).toBeGreaterThan(0);
  });

  it('BACKLIT_LIQUID keeps its backlight’s glow on the floor, softened: the sheet is hazier there', () => {
    expect(set('BACKLIT_LIQUID').floor).toMatchObject({ kind: 'GLOSSY', roughness: 0.2 });
    const s = withSet('BACKLIT_LIQUID');
    const floor = s.scene.nodes[setPieceIds(s).find((id) => s.scene.nodes[id].setPiece!.kind === 'FLOOR')!];
    expect(s.materials[floor.material!].params.roughness).toBe(0.2);
    // Elsewhere a glossy floor is the catalogue's acrylic, with its slight haze.
    expect(materialPreset('ACRYLIC_BLACK')!.params.roughness).toBe(0.12);
    expect(materialPreset('ACRYLIC_WHITE')!.params.roughness).toBe(0.12);
  });
});

describe('applying a set', () => {
  it('puts its lights, its decoration and its look in force, marked as the set’s', () => {
    const base = exampleState();
    const s = withSet('STRIP_EDGE', base);
    expect(s.studio.lightSetup).toBe('STRIP_EDGE');
    const pieces = setPieceIds(s).map((id) => s.scene.nodes[id].setPiece!);
    expect(pieces.map((p) => p.kind).sort()).toEqual(['BACKDROP', 'CARD', 'CARD', 'FLOOR']);
    // Its lights and the pool.
    const pool = s.studio.lights.filter((l) => l.setPiece === 'POOL');
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ type: 'SPOT', glossy: false, camera: false });
    expect(s.studio.lights.filter((l) => !l.setPiece).map((l) => [l.role, l.size, l.sizeY])).toEqual([['KEY', 0.35, 4.5], ['FILL', 3, 3], ['RIM', 0.3, 3]]);
    // The look: the exposure offset over the product type's and the sweep's paper colour.
    expect(s.image.exposureEv).toBeCloseTo(studioPreset('GENERIC')!.exposure - 0.3, 9);
    expect(s.environment.strength).toBe(studioPreset('GENERIC')!.envStrength);
  });

  it('does not change the product: part size, the rig pivot, the product bounds, framing and the Doctor', () => {
    const base = exampleState();
    const s = withSet('STRIP_EDGE', base);
    expect(s.scene.partSizeMm).toBe(base.scene.partSizeMm);
    expect(measuredSizeMm(s)).toBe(measuredSizeMm(base));
    expect(productBounds(s, true)).toEqual(productBounds(base, true));
    expect(rigPivot(s)).toEqual(rigPivot(base));
    // Frame (with nothing selected) frames the product, not the sweep.
    expect(activeCamera(reduce(s, { type: 'camera/frame' }))).toEqual(activeCamera(reduce(base, { type: 'camera/frame' })));
    // The Doctor looks at the user's scene only: the same warnings as without the set.
    const warn = (st: ProjectState) => st.doctor.results.filter((r) => r.status === 'WARN').map((r) => r.key);
    expect(warn(s)).toEqual(warn(reduce(base, { type: 'studio/setSetup', key: 'PRESET' })));
  });

  it('is one undo step, and undo brings the scene back as it was', () => {
    const store = createStore(exampleState());
    const before = store.get();
    store.dispatch({ type: 'studio/setSetup', key: 'CHROME_FAMILY' });
    expect(setPieceIds(store.get()).length).toBeGreaterThan(0);
    expect(store.history().undo).toHaveLength(1);
    store.undo();
    expect(store.get().scene).toEqual(before.scene);
    expect(store.get().studio).toEqual(before.studio);
    expect(store.get().materials).toEqual(before.materials);
    expect(store.get().environment).toEqual(before.environment);
  });

  it('another set replaces the decoration and leaves the user’s parts, primitives included, alone', () => {
    const own = apply(exampleState(), { type: 'scene/addPrimitive', kind: 'SPHERE', params: { radius: 10, segments: 16 }, position: [100, 0, 10], name: 'Ball' });
    const ball = own.scene.roots.find((r) => own.scene.nodes[r].name === 'Ball')!;
    const a = withSet('STRIP_EDGE', own);
    const b = reduce(a, { type: 'studio/setSetup', key: 'WARM_WINDOW' });
    expect(setPieceIds(b).map((id) => b.scene.nodes[id].setPiece!.kind).sort()).toEqual(['BACKDROP', 'CARD']);
    expect(b.studio.lights.filter((l) => l.setPiece)).toHaveLength(0);
    expect(b.scene.nodes[ball]).toEqual(own.scene.nodes[ball]);
    // No material of the old set is left behind.
    const used = new Set(Object.values(b.scene.nodes).flatMap((n) => [n.material, ...(n.faceMaterials ?? []).map((f) => f.material)]).filter(Boolean));
    expect(Object.keys(b.materials).every((m) => used.has(m))).toBe(true);
  });

  it('a setup that is not a set takes the decoration away and brings the product type’s look back', () => {
    const base = exampleState();
    const s = reduce(withSet('GLASS_DARK_FIELD', base), { type: 'studio/setSetup', key: 'REMBRANDT' });
    expect(setPieceIds(s)).toEqual([]);
    expect(s.studio.lights.some((l) => l.setPiece)).toBe(false);
    expect(s.environment.strength).toBe(base.environment.strength);
    expect(s.environment.background).toBe(base.environment.background);
    expect(s.environment.color).toEqual(base.environment.color);
    expect(s.image.exposureEv).toBe(base.image.exposureEv);
    expect(s.studio.lights).toEqual(reduce(base, { type: 'studio/setSetup', key: 'REMBRANDT' }).studio.lights);
  });

  it('Reset setup takes the decoration away and gives the set’s lights back as they were', () => {
    const s = withSet('STRIP_EDGE');
    const edited = reduce(s, { type: 'studio/setLight', id: s.studio.lights[0].id, patch: { az: 10 } });
    const reset = reduce(edited, { type: 'studio/resetLights' });
    expect(setPieceIds(reset)).toEqual([]);
    expect(reset.studio.lights.some((l) => l.setPiece)).toBe(false);
    expect(reset.studio.lights).toEqual(lightsFromRig('GENERIC', 'STRIP_EDGE'));
    expect(reset.studio.modified).toBe(false);
    // Choosing it again brings everything back.
    expect(setPieceIds(reduce(reset, { type: 'studio/setSetup', key: 'STRIP_EDGE' })).length).toBe(4);
  });

  it('Create studio with a set in force keeps the set (its decoration fitted again) on the new product type', () => {
    const s = apply(withSet('STRIP_EDGE'), { type: 'studio/setPreset', key: 'JEWELLERY' }, { type: 'studio/build' });
    expect(s.studio.lightSetup).toBe('STRIP_EDGE');
    expect(setPieceIds(s).length).toBe(4);
    expect(s.image.exposureEv).toBeCloseTo(studioPreset('JEWELLERY')!.exposure - 0.3, 9);
    expect(activeCamera(s).focalMm).toBe(studioPreset('JEWELLERY')!.focalMm);
  });

  it('a matte floor on a sweep is the sweep, a glossy one is its floor or a sheet that stops before the pool', () => {
    const raking = withSet('RAKING_TEXTURE');
    expect(setPieceIds(raking).map((id) => raking.scene.nodes[id].setPiece!.kind)).toEqual(['BACKDROP']);
    // A sweep with a glossy floor and no pool: the sweep's floor face in the floor's material, no seam.
    const plain: LightSetup = { ...set('HIGH_KEY_WHITE'), key: 'TEST_GLOSSY_SWEEP', pool: undefined };
    const white = applySet(exampleState(), plain);
    const sweep = white.scene.nodes[setPieceIds(white)[0]];
    expect(setPieceIds(white)).toHaveLength(1);
    expect(sweep.primitive?.kind).toBe('SWEEP');
    expect(sweep.faceMaterials).toHaveLength(1);
    expect(white.materials[sweep.faceMaterials![0].material].preset).toBe('ACRYLIC_WHITE');
    const glow = withSet('SILHOUETTE_GLOW');
    const kinds = setPieceIds(glow).map((id) => glow.scene.nodes[id]);
    expect(kinds.map((n) => n.setPiece!.kind)).toEqual(['BACKDROP', 'FLOOR']);
    expect(kinds[0].faceMaterials).toBeUndefined();
    expect(glow.materials[kinds[1].material!].preset).toBe('ACRYLIC_BLACK');
  });

  it('a gradient backdrop without a pool is the background, the floor a plane of the floor’s material', () => {
    const s = withSet('MIRROR_FLOOR');
    expect(s.environment.background).toBe('GRADIENT');
    expect(s.environment.gradient).toEqual({ top: [0.05, 0.05, 0.05], bottom: [0.01, 0.01, 0.01] });
    const pieces = setPieceIds(s).map((id) => s.scene.nodes[id]);
    expect(pieces.map((n) => [n.setPiece!.kind, n.primitive!.kind])).toEqual([['FLOOR', 'PLANE']]);
    expect(s.materials[pieces[0].material!].preset).toBe('MIRROR_BLACK');
  });
});

describe('the pool of light', () => {
  it('takes its share of the level: the lights share the rest', () => {
    const s = set('SILHOUETTE_GLOW');
    const rig = setupRig('GENERIC', 'SILHOUETTE_GLOW');
    const lights = rig.reduce((a, l) => a + specIrradiance({ type: l.type, energy: l.energy, dist: l.dist }), 0);
    const k = recipeScale('GENERIC', s.lights!, poolWeight(s.pool));
    expect(lights + k * poolWeight(s.pool)).toBeCloseTo(presetIrradiance('GENERIC'), 9);
    expect(lights / presetIrradiance('GENERIC')).toBeLessThan(0.5);
  });

  it('lands right behind the top of the product as the camera sees it, on the backdrop, with its share where it lands', () => {
    const s = withSet('SILHOUETTE_GLOW');
    const pool = s.studio.lights.find((l) => l.setPiece === 'POOL')!;
    const sweep = s.scene.nodes[setPieceIds(s).find((id) => s.scene.nodes[id].setPiece!.kind === 'BACKDROP')!];
    const target = poolTarget(s, sweep);
    const f = lightFrame(s, pool);
    expect(length(sub(f.target, target))).toBeLessThan(1e-3);
    // On the camera's line over the top of the product, beyond the product.
    const eye = cameraPosition(activeCamera(s));
    const top = poolTop(s);
    expect(top[2]).toBe(productBounds(s, true).max[2]);
    expect(dot(normalize(sub(target, eye)), normalize(sub(top, eye)))).toBeCloseTo(1, 6);
    expect(length(sub(target, eye))).toBeGreaterThan(length(sub(top, eye)));
    // The power: its share of the level at POOL_THROW, wherever the backdrop is.
    const k = recipeScale('GENERIC', set('SILHOUETTE_GLOW').lights!, poolWeight(set('SILHOUETTE_GLOW').pool));
    const throwSizes = length(sub(target, f.position)) / s.scene.partSizeMm;
    const { normal } = poolLanding(s, sweep);
    const facing = Math.max(POOL_GRAZE, Math.abs(dot(normal!, normalize(sub(f.position, target)))));
    expect(pool.power).toBeCloseTo((k * set('SILHOUETTE_GLOW').pool!.share * (throwSizes / POOL_THROW) ** 2) / facing, 4);
    expect(facing).toBeLessThan(1);
  });
});

describe('Use the set’s camera', () => {
  it('puts the set’s elevation and focal length on the active camera, the product framed: one undo step', () => {
    const store = createStore(withSet('STRIP_EDGE'));
    const before = activeCamera(store.get());
    store.dispatch({ type: 'studio/useSetCamera' });
    const after = activeCamera(store.get());
    expect(after.elevation).toBe(8);
    expect(after.focalMm).toBe(85);
    expect(after.azimuth).toBe(before.azimuth);
    expect(after.distance).not.toBe(before.distance);
    // The decoration follows the new view; the cards stay where they were.
    expect(setPieceIds(store.get()).length).toBe(4);
    expect(store.history().undo).toHaveLength(1);
    store.undo();
    expect(activeCamera(store.get())).toEqual(before);
  });

  it('is not applied when a set is chosen, does nothing without a camera to suggest or with the camera locked', () => {
    const base = exampleState();
    expect(activeCamera(withSet('FLAT_LAY', base))).toEqual(activeCamera(base));
    const chrome = withSet('CHROME_FAMILY', base);
    expect(reduce(chrome, { type: 'studio/useSetCamera' })).toBe(chrome);
    const flat = withSet('FLAT_LAY', base);
    const locked = reduce(flat, { type: 'camera/set', id: flat.camera.active, patch: { locked: true } });
    expect(reduce(locked, { type: 'studio/useSetCamera' })).toBe(locked);
    expect(reduce(base, { type: 'studio/useSetCamera' })).toBe(base);
  });
});

describe('the gradient background', () => {
  it('is an image of its two colours, top to bottom, mixed in linear light', () => {
    const px = gradientPixels([1, 0, 0], [0, 0, 1], 2, 3);
    expect([...px.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...px.slice(px.length - 4)]).toEqual([0, 0, 255, 255]);
    // The middle row is half of each in linear light: 0.5 is 188 in sRGB.
    expect([...px.slice(8, 11)]).toEqual([188, 0, 188]);
  });

  it('goes to the engine as a background image stretched over the frame', () => {
    const s = withSet('MIRROR_FLOOR');
    const { scene } = projectScene(s, { width: 64, height: 64, maxSamples: 1, maxSeconds: 0 });
    expect(scene.environment.backgroundMode).toBe(BACKGROUND_BACKPLATE);
    expect(scene.environment.backplateFit).toBe(BACKPLATE_STRETCH);
    const map = scene.bitmaps[scene.environment.backplateMap];
    expect([...map.data.slice(0, 3)]).toEqual([...gradientPixels([0.05, 0.05, 0.05], [0.01, 0.01, 0.01]).slice(0, 3)]);
    // A transparent picture has no background image.
    const t = projectScene(s, { width: 64, height: 64, maxSamples: 1, maxSeconds: 0, transparent: true });
    expect(t.scene.bitmaps).toHaveLength(0);
  });
});

describe('the interface', () => {
  it('shows a set’s reason in the tooltip of its thumbnail, in both languages', () => {
    const s = set('STRIP_EDGE');
    expect(setupTip(s, 'en')).toBe(`${s.intent.en}. ${s.why!.en}`);
    expect(setupTip(s, 'es')).toBe(`${s.intent.es}. ${s.why!.es}`);
    expect(setupTip(lightSetup('REMBRANDT')!, 'en')).toBe(lightSetup('REMBRANDT')!.intent.en);
  });

  it('has every string of the sets in English and Spanish', () => {
    const keys = Object.keys(STRINGS.en).filter((k) => k.startsWith('set.') || k === 'undo.setCamera' || k === 'env.bg.GRADIENT');
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) expect((STRINGS.es as Record<string, string>)[k], k).toBeTruthy();
  });
});

describe('the thumbnails', () => {
  const manifest = 'public/thumbs/setups/manifest.json';

  it('are the engine’s render of the scene the code builds now, for every setup', () => {
    const m = JSON.parse(readFileSync(manifest, 'utf8')) as { scenes: Record<string, { rsb: string; png: string }> };
    expect(Object.keys(m.scenes).sort()).toEqual(LIGHT_SETUPS.map((s) => s.key).sort());
    for (const s of LIGHT_SETUPS) {
      expect(sha256Hex(thumbRsb(s.key)), `${s.key}: the setup changed, run node tools/setup-thumbs.mjs`).toBe(m.scenes[s.key].rsb);
      expect(sha256Hex(readFileSync(`public/thumbs/setups/thumb_${s.key.toLowerCase()}.png`)), s.key).toBe(m.scenes[s.key].png);
    }
  });

  it('pins one thumbnail’s bytes', () => {
    // The PNG `rt` wrote for STRIP_EDGE on its bottle (256 x 256, 96 spp, denoised, seed 1). It changes only when the
    // set, the bottle or the engine changes: then run `node tools/setup-thumbs.mjs` and put the new hash here.
    expect(sha256Hex(readFileSync('public/thumbs/setups/thumb_strip_edge.png'))).toBe('TODO');
  });
});

describe('what the sets look like once rendered (their thumbnails)', () => {
  it('BRIGHT_FIELD and HIGH_KEY_WHITE burn the background to white without clipping the product', () => {
    for (const [key, part] of [['BRIGHT_FIELD', 'label'], ['HIGH_KEY_WHITE', 'band']] as const) {
      const t = thumbnail(key);
      expect(maskedMean(t.img, backdropMask(t)), key).toBeGreaterThanOrEqual(0.92);
      expect(partPeak(t, part), key).toBeLessThan(1);
    }
  });

  it('BLACK_ON_BLACK and GRADIENT_POOL: the pool is at least twice as bright as the backdrop at the frame’s edges', () => {
    for (const key of ['BLACK_ON_BLACK', 'GRADIENT_POOL']) expect(poolContrast(thumbnail(key)), key).toBeGreaterThanOrEqual(2);
  });

  it('SILHOUETTE_GLOW: the halo falls off from its centre over 30 % of the frame on each side, without a plateau', () => {
    const t = thumbnail('SILHOUETTE_GLOW');
    const [px, py] = poolPixel(t);
    const span = Math.round(0.3 * t.img.width);
    for (const end of [0, t.img.width - 1]) {
      const p = rowProfile(t.img, py, px, end, 7).slice(0, span + 1).filter((_, i) => i % 8 === 0);
      expect(p.length).toBeGreaterThan(9);
      // Every step outwards is darker.
      for (let i = 1; i < p.length; i++) expect(p[i], `${end ? 'right' : 'left'} ${i * 8} px`).toBeLessThan(p[i - 1]);
      // Past the top of the peak, every 24 pixels at least half a percent darker: no plateau.
      for (let i = 2; i + 3 < p.length; i++) expect(p[i] - p[i + 3], `${end ? 'right' : 'left'} from ${i * 8} px`).toBeGreaterThan(0.005);
      // And the halo is there: the centre clearly brighter than 30 % away.
      expect(p[0] - p[p.length - 1]).toBeGreaterThan(0.05);
    }
  });
});

describe('a set in a project file', () => {
  it('comes back with its pieces, its pool and its gradient', async () => {
    const s = withSet('STRIP_EDGE');
    const g = { ...s, environment: { ...s.environment, background: 'GRADIENT' as const, gradient: { top: [0.2, 0.1, 0.05] as const, bottom: [0.01, 0.02, 0.03] as const } } };
    const back = loadProject(await serializeProject(g).text()).state;
    expect(setPieceIds(back).map((id) => back.scene.nodes[id].setPiece)).toEqual(setPieceIds(g).map((id) => g.scene.nodes[id].setPiece));
    expect(back.studio.lights.filter((l) => l.setPiece)).toEqual(g.studio.lights.filter((l) => l.setPiece));
    expect(back.environment.gradient).toEqual(g.environment.gradient);
    // A project from before L6 has no gradient: it opens with the default one.
    const old = JSON.parse(await serializeProject(exampleState()).text());
    delete old.state.environment.gradient;
    expect(loadProject(JSON.stringify(old)).state.environment.gradient).toEqual(exampleState().environment.gradient);
  });
});

describe('set pieces in the scene model', () => {
  it('are never the product, even in a scene of primitives', () => {
    const s = withSet('STRIP_EDGE', reduce(exampleState(), { type: 'scene/delete', ids: [...exampleState().scene.roots] }));
    for (const id of setPieceIds(s)) expect(isSetPiece(s.scene.nodes[id])).toBe(true);
    expect(measuredSizeMm(s)).toBe(0);
    expect(outputAspect(s)).toBeGreaterThan(0);
  });
});

// Writes the RSB files of the ambient contact sheet (phases S4a and S4b) that tools/ambient-sheet.mjs renders with the
// native `rt`: the example bottle in a dark flat studio with each of the eight presets under two lights (a side key,
// and a spot behind the product aimed at the camera), the dust motes with three other shares of their forward lobe
// (S4b, for the lead to choose), rain with three streak lengths, the dust cloud with two
// softnesses, and the scenes of the cost measurement (no effect; each preset at its own count on the bottle, S4b; and
// 200 000 dust motes). Skipped unless REPACKSHOT_AMBIENT_RSB_DIR is set, so `npm run qa` writes nothing; the tool
// sets the variable itself.
//
//   REPACKSHOT_AMBIENT_RSB_DIR=out/ambient-sheet npx vitest run tests/ambient-rsb-dump.test.ts
//
// Optional: REPACKSHOT_AMBIENT_SIZE (WxH, default 512x288, the camera's 16:9), REPACKSHOT_AMBIENT_SPP (default 128)
// and REPACKSHOT_AMBIENT_COST_SPP (default 16).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVAILABLE_EFFECTS, type EffectKind } from '../src/data/effects';
import { effectParticles, type EffectPatch } from '../src/core/effects';
import type { ProjectState } from '../src/core/store';
import { projectScene, writeRsb } from '../src/io/rsb';
import { apply, exampleState } from './helpers';

const dir = process.env.REPACKSHOT_AMBIENT_RSB_DIR;
const [width, height] = (process.env.REPACKSHOT_AMBIENT_SIZE ?? '512x288').split('x').map(Number);
const spp = Number(process.env.REPACKSHOT_AMBIENT_SPP ?? 128);
const costSpp = Number(process.env.REPACKSHOT_AMBIENT_COST_SPP ?? 16);

/** The two lights of the sheet. Both from Key only, in a dark flat studio, so the light is the only one. */
const LIGHTS = {
  side: { label: 'Side key (area, 90° to the camera, 15° up)', patch: { az: -90, el: 15 } },
  back: { label: 'Spot backlight (behind the product, 15° up, 35° cone)', patch: { type: 'SPOT' as const, az: 180, el: 15, spread: 35, blend: 0.3, camera: false } },
};
type LightKey = keyof typeof LIGHTS;
const ZOOM = 1.5;

function base(light: LightKey): ProjectState {
  let s = apply(
    exampleState(),
    { type: 'studio/setSetup', key: 'KEY_ONLY' },
    { type: 'env/set', patch: { kind: 'FLAT', color: [0.012, 0.012, 0.012, 1], strength: 1, background: 'ENVIRONMENT' } },
  );
  const key = s.studio.lights[0];
  s = apply(s, { type: 'studio/setLight', id: key.id, patch: LIGHTS[light].patch });
  // A closer framing than the example's (the bottle about two thirds of the frame's height), so the particles read.
  const cam = s.camera.cameras[s.camera.active];
  s = apply(s, { type: 'camera/set', id: cam.id, patch: { focalMm: cam.focalMm * ZOOM, lens: null } });
  return s;
}

function withEffect(light: LightKey, preset: EffectKind, patch: EffectPatch = {}): ProjectState {
  let s = apply(base(light), { type: 'effect/add', preset });
  if (Object.keys(patch).length > 0) s = apply(s, { type: 'effect/set', id: s.effects[0].id, patch });
  return s;
}

interface Shot {
  file: string;
  row: string;
  label: string;
  particles: number;
  samples: number;
}

describe.skipIf(!dir)('ambient contact sheet: RSB dump', () => {
  it(`writes the sheet's scenes at ${width}x${height}, ${spp} spp`, () => {
    mkdirSync(dir!, { recursive: true });
    const shots: Shot[] = [];
    const write = (file: string, row: string, label: string, s: ProjectState, samples = spp) => {
      const { scene } = projectScene(s, { width, height, maxSamples: samples, maxSeconds: 0, seed: 0, particleCap: 1_000_000 });
      writeFileSync(join(dir!, `${file}.rsb`), writeRsb(scene));
      shots.push({ file, row, label, particles: s.effects.reduce((n, e) => n + effectParticles(s, e, 1_000_000), 0), samples });
    };
    for (const p of AVAILABLE_EFFECTS) {
      for (const light of Object.keys(LIGHTS) as LightKey[]) write(`${p.key}-${light}`, `preset-${light}`, p.label.en, withEffect(light, p.key));
    }
    // S4b: the share of the dust's forward lobe, around the proposed 0.5 (the preset's, in the grid above).
    for (const forward of [0.25, 0.75, 1]) {
      for (const light of Object.keys(LIGHTS) as LightKey[]) {
        const s = withEffect(light, 'DUST_MOTES');
        const patch = { ownMaterial: { ...s.effects[0].ownMaterial, forward } };
        write(`DUST_MOTES-forward-${forward}-${light}`, 'forward-share', `Dust motes, forward share ${forward} (${light})`, apply(s, { type: 'effect/set', id: s.effects[0].id, patch }));
      }
    }
    for (const streak of [0.004, 0.012, 0.03]) write(`RAIN-streak-${streak}`, 'rain-streak', `Rain, streak ${streak * 1000} ms (backlight)`, withEffect('back', 'RAIN', { streak }));
    for (const softness of [0.2, 0.9]) {
      const s = withEffect('side', 'DUST_CLOUD');
      write(`DUST_CLOUD-soft-${softness}`, 'cloud-softness', `Dust cloud, softness ${softness} (side key)`, apply(s, { type: 'effect/set', id: s.effects[0].id, patch: { cloud: { ...s.effects[0].cloud, softness } } }));
    }
    // The cost: the same bottle and light, without an effect, with each preset at its own count (S4b: the criterion
    // of 1.3x applies at the presets' densities) and with 200 000 dust motes.
    write('cost-none', 'cost', 'No effect', base('side'), costSpp);
    for (const p of AVAILABLE_EFFECTS) write(`cost-${p.key}`, 'cost', p.label.en, withEffect('side', p.key), costSpp);
    write('cost-dust200k', 'cost', '200 000 dust motes', withEffect('side', 'DUST_MOTES', { amountMode: 'COUNT', count: 200_000 }), costSpp);
    const rows = { 'forward-share': 'Dust motes: other shares of the forward lobe (S4b; the presets above have 0.5, the proposal)' };
    writeFileSync(join(dir!, 'shots.json'), JSON.stringify({ width, height, spp, costSpp, lights: Object.fromEntries(Object.entries(LIGHTS).map(([k, v]) => [k, v.label])), rows, shots }, null, 2));
    expect(shots).toHaveLength(8 * 2 + 3 * 2 + 3 + 2 + 1 + 8 + 1);
    expect(shots.find((x) => x.file === 'cost-dust200k')!.particles).toBe(200_000);
  });
});

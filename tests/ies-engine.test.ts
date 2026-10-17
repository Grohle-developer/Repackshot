// Phase L5 with the real rt.wasm (`npm run engine:build`; skipped without it unless REPACK_REQUIRE_RT_WASM is set): the module
// says it renders IES lights, renders the engine's scene of two profiles (tests/fixtures/l5.rsb, `rt --write-l5-example`) to
// rt-core's pinned image, and a scene the page writes (LGHT kind 5, IESP) renders: on its axis an IES light of the downlight
// profile lights a part as the point light of the same power does, and off its axis the profile's candela take it down.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iesTextOf } from '../src/core/ies';
import { projectScene, writeRsb } from '../src/io/rsb';
import { readsIes } from '../src/render/engine';
import { apply, exampleState } from './helpers';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const FIXTURE = new Uint8Array(readFileSync('tests/fixtures/l5.rsb'));
const DOWNLIGHT = iesTextOf(new Uint8Array(readFileSync('tests/fixtures/ies/downlight-symmetric.ies')));
const live = RT_WASM ? describe : describe.skip;

/** The example with every light off but the one added by `add`, in a black world: the picture is that light alone. */
function aloneState(add: Parameters<typeof apply>[1]): ReturnType<typeof exampleState> {
  let s = apply(exampleState(), add);
  const own = s.studio.lights[s.studio.lights.length - 1].id;
  for (const l of s.studio.lights) if (l.id !== own) s = apply(s, { type: 'studio/setLight', id: l.id, patch: { enabled: false } });
  return apply(s, { type: 'env/set', patch: { strength: 0 } });
}

live('the real rt.wasm renders IES lights', () => {
  it('says so, and renders the engine’s scene of two profiles to rt-core’s pinned image', async () => {
    const rt = await loadRt();
    const features = (rt as unknown as { rt_features?: () => number }).rt_features;
    expect(readsIes(features!())).toBe(true);
    const { image } = renderWithPasses(rt, FIXTURE, 160, 120, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_L5_IES_4SPP'));
  });

  it('renders a scene the page writes, and the profile is what lights it: the same as the point light on its axis, less off it', async () => {
    const rt = await loadRt();
    const [w, h, spp] = [96, 72, 16];
    const render = (state: ReturnType<typeof exampleState>, ies: boolean) => {
      const rsb = writeRsb(projectScene(state, { width: w, height: h, maxSamples: spp, maxSeconds: 0, ies }).scene);
      return resolveRgb(renderWithPasses(rt, rsb, w, h, spp, 0).image, spp);
    };
    const lum = (rgb: Float32Array, x0: number, y0: number, size: number): number => {
      let sum = 0;
      for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) sum += 0.2126 * rgb[(y * w + x) * 3] + 0.7152 * rgb[(y * w + x) * 3 + 1] + 0.0722 * rgb[(y * w + x) * 3 + 2];
      return sum / (size * size);
    };
    const point = render(aloneState({ type: 'studio/addLight', kind: 'POINT' }), true);
    const profile = render(aloneState({ type: 'studio/addIesLight', ies: { name: 'Test downlight', text: DOWNLIGHT } }), true);
    // Both lights aim at the centre of the product and have the same power. At the middle of the picture the surface is a few
    // degrees off the axis of the profile (970 cd of 1000 at 10 degrees: under 3 % less); the point light has no axis.
    const mid = lum(point, w / 2 - 3, h / 2 - 3, 6);
    expect(mid).toBeGreaterThan(0);
    expect(Math.abs(lum(profile, w / 2 - 3, h / 2 - 3, 6) / mid - 1)).toBeLessThan(0.06);
    // Elsewhere the profile is not the point light: its candela fall away from the axis, so the part, which the background
    // (a flat colour in the black world) does not change, is dimmer as a whole.
    const lit = (rgb: Float32Array, reference: Float32Array): number => {
      let sum = 0;
      for (let i = 0; i < rgb.length; i += 3) if (Math.abs(reference[i + 1] - reference[1]) > 1e-3) sum += rgb[i + 1];
      return sum;
    };
    expect(lit(point, point)).toBeGreaterThan(1);
    expect(lit(profile, point)).toBeLessThan(lit(point, point) * 0.99);
    expect(lit(profile, point)).toBeGreaterThan(lit(point, point) * 0.5);
    // An engine that is told no IES lights gets the spot light that stands for it: another picture, still lit.
    const spot = render(aloneState({ type: 'studio/addIesLight', ies: { name: 'Test downlight', text: DOWNLIGHT } }), false);
    expect(fnv1a(spot)).not.toBe(fnv1a(profile));
    expect(lit(spot, point)).toBeGreaterThan(lit(point, point) * 0.5);
  });
});

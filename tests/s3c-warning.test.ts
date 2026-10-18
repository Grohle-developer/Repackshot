// Phase S3c, the warning first: a front glass fed by the scene renders clean on an engine that does not read a pane
// laid out drop by drop (bit 7 of its features, rt_core::FEATURE_GLASS_LAYOUT; an engine of S3, such as an older
// desktop launcher). core/wet.ts `glassRendersClean` says when; the inspector shows its note then
// (ui/panels/insp-filters.ts, `[data-glass="old-engine"]`; tools/s3c-check.mjs checks it in the built app against an
// rt.wasm whose features are patched without the bit), and main.ts hands the engine's bit to the interface
// (`EngineInfo.glassLayout`).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeCamera } from '../src/core/camera';
import { newFrontGlass, opticsOf } from '../src/core/optics';
import type { ProjectState } from '../src/core/store';
import { glassRendersClean } from '../src/core/wet';
import { readsGlassLayout } from '../src/render/engine';
import { STRINGS } from '../src/ui/strings';
import { apply, exampleState } from './helpers';

/** The example with `preset` and its camera's front glass fed by the scene. */
function fedScene(preset: 'RAIN' | 'DUST_MOTES' | 'SNOW' = 'RAIN', glass: Partial<ReturnType<typeof newFrontGlass>> = {}): ProjectState {
  let s = apply(exampleState(), { type: 'effect/add', preset });
  const cam = activeCamera(s);
  s = apply(s, { type: 'camera/set', id: cam.id, patch: { optics: { ...opticsOf(cam), frontGlass: { ...newFrontGlass(), source: 'SCENE', ...glass } } } });
  return s;
}

describe('S3c: the warning of an engine without bit 7', () => {
  it('warns when the scene feeds the glass and the engine does not read it drop by drop', () => {
    const s = fedScene();
    const cam = activeCamera(s).id;
    expect(glassRendersClean(s, cam, false)).toBe(true);
    // An engine that reads it, or one not known yet (no engine), is no reason to warn.
    expect(glassRendersClean(s, cam, true)).toBe(false);
    expect(glassRendersClean(s, cam, undefined)).toBe(false);
    // The bit the interface hands on is bit 7.
    expect(readsGlassLayout(255)).toBe(true);
    expect(readsGlassLayout(127)).toBe(false);
    expect(readsGlassLayout(511 & ~128)).toBe(false);
  });

  it('says nothing when the render would not draw anything from the scene anyway', () => {
    // Dust feeds the glass too.
    const dust = fedScene('DUST_MOTES');
    expect(glassRendersClean(dust, activeCamera(dust).id, false)).toBe(true);
    // Snow feeds nothing (S3b ◆4): no effect feeds the glass.
    const snow = fedScene('SNOW');
    expect(glassRendersClean(snow, activeCamera(snow).id, false)).toBe(false);
    // The glass off, or set by hand (an engine of S3 draws that one).
    const off = fedScene('RAIN', { on: false });
    expect(glassRendersClean(off, activeCamera(off).id, false)).toBe(false);
    const manual = fedScene('RAIN', { source: 'MANUAL' });
    expect(glassRendersClean(manual, activeCamera(manual).id, false)).toBe(false);
    // The rain switched off.
    const s = fedScene();
    const dry = apply(s, { type: 'effect/set', id: s.effects[0].id, patch: { enabled: false } });
    expect(glassRendersClean(dry, activeCamera(dry).id, false)).toBe(false);
    // A panoramic camera has no front glass.
    const pano = apply(s, { type: 'camera/set', id: activeCamera(s).id, patch: { projection: 'EQUIRECTANGULAR' } });
    expect(glassRendersClean(pano, activeCamera(pano).id, false)).toBe(false);
    // An unknown camera.
    expect(glassRendersClean(s, 'nope', false)).toBe(false);
  });

  it('the note exists in both languages, the inspector shows it from the engine’s bit, and main.ts hands the bit on', () => {
    expect(STRINGS.en['camera.glassOldEngine']).toMatch(/clean/);
    expect(STRINGS.es['camera.glassOldEngine']).toMatch(/limpio/);
    const panel = readFileSync('src/ui/panels/insp-filters.ts', 'utf8');
    expect(panel).toMatch(/data-glass': 'old-engine'/);
    expect(panel).toMatch(/glassRendersClean\(st, camId\(\), ctx\.ui\.get\(\)\.engineInfo\?\.glassLayout\)/);
    // The watch sees the engine changing (a launcher replaced by the pool, a restart).
    expect(panel).toMatch(/u\.engineInfo\?\.glassLayout\] as const/);
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main.match(/glassLayout: readsGlassLayout\((i|t)\.features\)/g)).toHaveLength(2);
  });
});

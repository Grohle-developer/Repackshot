// Caustics and denoise settings (phase E5b-1, ROADMAP E5b-1, ARCHITECTURE §5).
//
// Caustics come from the engine's photon map (rt_core::caustics): every sample traces a number
// of photons from the lights through glass and polished metal, and the light they bring to a
// matte surface (the floor, the shadow catcher, a label) replaces the noisy paths of the tracer.
// The render window has the switch (Automatic · On · Off); Advanced has its quality, which is
// the photons per sample and the first gather radius. Automatic turns them on when the scene has
// something that focuses light (glass or polished metal: the engine's own test, `isCaster`) and a
// small light to focus (a glossy panel or disc no wider than SMALL_LIGHT_DEG seen from the
// casters, a sun, a lit emitter; the point lights and spots of L4 send no photons yet).
//
// Denoise is the engine's own (rt_post::denoise): Off · Viewport · Render · Both (default Both),
// and a render can save the image without denoise as well.
//
// Pure: no DOM, no engine. io/rsb.ts writes the RNDR fields from these.

/** The render window's caustics switch. */
export type CausticsMode = 'AUTO' | 'ON' | 'OFF';
export const CAUSTICS_MODES: readonly CausticsMode[] = ['AUTO', 'ON', 'OFF'];

/** Advanced ▸ Caustic quality. */
export type CausticsQuality = 'LOW' | 'MEDIUM' | 'HIGH';
export const CAUSTICS_QUALITIES: readonly CausticsQuality[] = ['LOW', 'MEDIUM', 'HIGH'];

/** Photons per sample (`RNDR.caustic_photons`) and first gather radius in pixels (`RNDR.caustic_radius`). */
export const CAUSTICS_PRESETS: Readonly<Record<CausticsQuality, { photons: number; radiusPx: number }>> = Object.freeze({
  LOW: { photons: 4096, radiusPx: 4 },
  MEDIUM: { photons: 16384, radiusPx: 3 },
  HIGH: { photons: 65536, radiusPx: 2 },
});

/** Advanced ▸ Denoise: where the engine's denoiser runs. */
export type DenoiseMode = 'OFF' | 'VIEWPORT' | 'RENDER' | 'BOTH';
export const DENOISE_MODES: readonly DenoiseMode[] = ['OFF', 'VIEWPORT', 'RENDER', 'BOTH'];

/** `RNDR.denoise` bit 0: the host hands out the denoised image. */
export const DENOISE_IMAGE = 1;
/** `RNDR.denoise` bit 1: also the one without denoise. */
export const DENOISE_KEEP_NOISY = 2;

/** True when `mode` denoises `where`. */
export function denoiseIn(mode: DenoiseMode, where: 'VIEWPORT' | 'RENDER'): boolean {
  return mode === 'BOTH' || mode === where;
}

/** The mode with the viewport's part switched (the Full viewport's toggle): Both ↔ Render, Viewport ↔ Off. */
export function toggledViewportDenoise(mode: DenoiseMode): DenoiseMode {
  switch (mode) {
    case 'BOTH':
      return 'RENDER';
    case 'RENDER':
      return 'BOTH';
    case 'VIEWPORT':
      return 'OFF';
    default:
      return 'VIEWPORT';
  }
}

/** `RNDR.denoise` of a view: the image denoised where the mode says, and the noisy one too when asked. */
export function denoiseBits(mode: DenoiseMode, where: 'VIEWPORT' | 'RENDER', keepNoisy: boolean): number {
  if (!denoiseIn(mode, where)) return 0;
  return DENOISE_IMAGE | (keepNoisy && where === 'RENDER' ? DENOISE_KEEP_NOISY : 0);
}

// ------------------------------------------------------------------ Automatic

/** Roughest glass or metal that focuses light (rt_core::caustics::MAX_ROUGHNESS). */
export const CAUSTIC_MAX_ROUGHNESS = 0.25;
/** A light no wider than this, seen from the casters, is small enough to throw a caustic. */
export const SMALL_LIGHT_DEG = 20;

/** `MATL.kind`: glass and emitter (src/io/rsb.ts). */
const KIND_GLASS = 1;
const KIND_EMISSIVE = 2;

/** The engine's material fields the test reads. */
export interface CasterMaterial {
  kind: number;
  roughness: number;
  transmission: number;
  metallic: number;
  /** 0..1 (absent: 0). */
  anisotropy?: number;
}

/** rt_core::caustics::sharpest_roughness: brushed metal is as sharp as `r ⁴√(1 - 0.9 a)` across its tangent. */
export function sharpestRoughness(m: CasterMaterial): number {
  const a = Math.max(0, Math.min(1, m.anisotropy ?? 0));
  return a > 0 ? m.roughness * Math.sqrt(Math.sqrt(1 - 0.9 * a)) : m.roughness;
}

/** rt_core::caustics::is_caster: glass or metal whose sharper lobe is at most CAUSTIC_MAX_ROUGHNESS rough, not an emitter. */
export function isCaster(m: CasterMaterial): boolean {
  if (m.kind === KIND_EMISSIVE || !(sharpestRoughness(m) <= CAUSTIC_MAX_ROUGHNESS)) return false;
  const glass = m.kind === KIND_GLASS || (m.transmission >= 0.5 && m.metallic < 0.5);
  const metal = m.kind !== KIND_GLASS && m.metallic >= 0.5;
  return glass || metal;
}

/**
 * A light as the test sees it: its kind (`LGHT.kind`: 0 rect, 1 disc, 2 sun, 3 point or sphere, 4 spot), position,
 * size and angle, and whether it is glossy. Points, spheres and spots (L4) send no photons (rt_core::light), so
 * they never turn the caustics on.
 */
export interface CausticLight {
  kind: number;
  position: readonly [number, number, number];
  sizeX: number;
  sizeY: number;
  angleDeg: number;
  glossy: boolean;
}

/** Angular diameter (degrees) of a light seen from `from` (a sun: its own). */
export function lightAngleDeg(l: CausticLight, from: readonly [number, number, number]): number {
  if (l.kind === 2) return l.angleDeg;
  const d = Math.hypot(l.position[0] - from[0], l.position[1] - from[1], l.position[2] - from[2]);
  const size = l.kind === 1 ? Math.abs(l.sizeX) : Math.max(Math.abs(l.sizeX), Math.abs(l.sizeY));
  return d > 0 ? (2 * Math.atan(size / 2 / d) * 180) / Math.PI : 180;
}

/**
 * Automatic: caustics on when something in the scene focuses light and a light is small enough to be
 * focused. `casters` is the centre of the casters' bounds (null: there are none); `emitters` says whether a lit
 * emissive part (a filament, an LED) is among the lights.
 */
export function autoCaustics(casters: readonly [number, number, number] | null, lights: readonly CausticLight[], emitters: boolean): boolean {
  if (!casters) return false;
  if (emitters) return true;
  return lights.some((l) => l.glossy && l.kind <= 2 && lightAngleDeg(l, casters) <= SMALL_LIGHT_DEG);
}

/** `RNDR.caustic_photons` and `caustic_radius` for a switch and a quality, once Automatic has been decided (`auto`). */
export function causticsFields(mode: CausticsMode, quality: CausticsQuality, auto: boolean): { photons: number; radiusPx: number } {
  const on = mode === 'ON' || (mode === 'AUTO' && auto);
  const preset = CAUSTICS_PRESETS[quality] ?? CAUSTICS_PRESETS.MEDIUM;
  return on ? { photons: preset.photons, radiusPx: preset.radiusPx } : { photons: 0, radiusPx: 0 };
}

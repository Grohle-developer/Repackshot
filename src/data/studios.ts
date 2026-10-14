// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (PolyForm Noncommercial 1.0.0); values are data, the implementation is new.

import type { StudioPreset } from './types';

// Studio presets, one per product type (upstream STUDIO_PRESETS, 16 entries,
// in upstream order). Each category has its conventions: the typical size
// drives focal length and distance, the reflectance of the material decides
// whether the light wraps or is directional, and transparency forces
// caustics on.
//
// Lights (L6: redesigned, each type takes the lights of a set, `PRESET_SETS`, at the level it had): `dist`, `size`
// and `sizeY` are in multiples of the part size, so the same preset suits a ring and a sofa. `az` is already relative
// to the camera axis (0 behind the camera, negative camera-left, 180 behind the part); `energy` is watts at part size 1.
export const STUDIO_PRESETS: readonly StudioPreset[] = [
  {
    key: 'GENERIC', set: 'GRADIENT_POOL',
    label: { es: 'Estandar tres puntos', en: 'Standard three-point' },
    sizeMm: 200, focalMm: 85, fstop: 5.6,
    envStrength: 0.6, exposure: 0,
    background: 'FLAT', backgroundColor: [0.05, 0.05, 0.05, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // L6: the lights of the set GRADIENT_POOL (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 3, sizeY: 2.5, az: -40, el: 40, dist: 2.2, energy: 74.19995737689 },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 20, dist: 3.5, energy: 29.67998295076, glossy: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 165, el: 70, dist: 3, energy: 22.25998721307 },
    ],
  },
  {
    key: 'JEWELLERY', set: 'JEWEL_BOX',
    label: { es: 'Joyeria', en: 'Jewellery' },
    sizeMm: 30, focalMm: 100, fstop: 11,
    envStrength: 0.9, exposure: 0,
    background: 'FLAT', backgroundColor: [0.02, 0.02, 0.025, 1],
    floor: true, shadow: false, caustics: true, quality: 'FINAL',
    // L6: the lights of the set JEWEL_BOX (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 3, sizeY: 3, az: -60, el: 30, dist: 2.5, energy: 20.15928973249 },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 30, dist: 2.5, energy: 20.15928973249 },
      { role: 'RIM', size: 3, sizeY: 3, az: -120, el: 30, dist: 2.5, energy: 20.15928973249 },
      { role: 'RIM', size: 3, sizeY: 3, az: 120, el: 30, dist: 2.5, energy: 20.15928973249 },
      { role: 'TOP', size: 3, sizeY: 3, az: 0, el: 80, dist: 2.5, energy: 26.87905297666 },
      { role: 'KEY', type: 'SPOT', size: 0.05, az: -40, el: 55, dist: 3, energy: 13.43952648833, spread: 12, blend: 0.2 },
    ],
  },
  {
    key: 'WATCH', set: 'CHROME_FAMILY',
    label: { es: 'Relojeria', en: 'Watchmaking' },
    sizeMm: 45, focalMm: 100, fstop: 8,
    envStrength: 0.7, exposure: -0.2,
    background: 'FLAT', backgroundColor: [0.03, 0.03, 0.035, 1],
    floor: true, shadow: true, caustics: true, quality: 'FINAL',
    // L6: the lights of the set CHROME_FAMILY (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 4, sizeY: 4, az: -35, el: 45, dist: 2.2, energy: 58.67218494926 },
      { role: 'TOP', size: 2, sizeY: 4, az: -25, el: 50, dist: 2, energy: 23.4688739797 },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 170, el: 70, dist: 3, energy: 17.60165548478 },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 20, dist: 3.5, energy: 17.60165548478, glossy: false },
    ],
  },
  {
    key: 'PERFUME', set: 'STRIP_EDGE',
    label: { es: 'Perfumeria', en: 'Fragrance' },
    sizeMm: 110, focalMm: 100, fstop: 8,
    envStrength: 0.35, exposure: -0.3,
    background: 'FLAT', backgroundColor: [0.015, 0.015, 0.02, 1],
    floor: true, shadow: false, caustics: true, quality: 'FINAL',
    // L6: the lights of the set STRIP_EDGE (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 0.35, sizeY: 4.5, az: -115, el: 25, dist: 3, energy: 119.5400017077, kelvin: 5300 },
      { role: 'FILL', size: 3, sizeY: 3, az: 70, el: 20, dist: 3.5, energy: 54.33636441257, glossy: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 160, el: 50, dist: 3, energy: 43.46909153005 },
    ],
  },
  {
    key: 'COSMETICS', set: 'STRIP_EDGE',
    label: { es: 'Cosmetica', en: 'Cosmetics' },
    sizeMm: 90, focalMm: 100, fstop: 8,
    envStrength: 0.8, exposure: -0.15,
    background: 'FLAT', backgroundColor: [0.78, 0.78, 0.78, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // L6: the lights of the set STRIP_EDGE (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 0.35, sizeY: 4.5, az: -115, el: 25, dist: 3, energy: 102.1094817281, kelvin: 5300 },
      { role: 'FILL', size: 3, sizeY: 3, az: 70, el: 20, dist: 3.5, energy: 46.41340078552, glossy: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 160, el: 50, dist: 3, energy: 37.13072062842 },
    ],
  },
  {
    key: 'ELECTRONICS', set: 'BLACK_ON_BLACK',
    label: { es: 'Electronica', en: 'Electronics' },
    sizeMm: 150, focalMm: 85, fstop: 8,
    envStrength: 0.5, exposure: -0.75,
    background: 'FLAT', backgroundColor: [0.035, 0.035, 0.04, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // L6: the lights of the set BLACK_ON_BLACK (light-setups.ts), at this type's level.
    lights: [
      { role: 'RIM', size: 0.3, sizeY: 4, az: -150, el: 70, dist: 3, energy: 94.14903130723 },
      { role: 'RIM', size: 0.3, sizeY: 4, az: 150, el: 70, dist: 3, energy: 94.14903130723 },
      { role: 'FILL', size: 2, sizeY: 2, az: 0, el: 20, dist: 3, energy: 21.51977858451, glossy: false },
    ],
  },
  {
    key: 'APPLIANCE', set: 'HIGH_KEY_WHITE',
    label: { es: 'Electrodomestico', en: 'Appliance' },
    sizeMm: 600, focalMm: 50, fstop: 8,
    envStrength: 0.7, exposure: 1.5,
    background: 'FLAT', backgroundColor: [0.72, 0.72, 0.73, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // L6: the lights of the set HIGH_KEY_WHITE (light-setups.ts), at this type's level.
    lights: [
      { role: 'TOP', size: 5, sizeY: 4, az: 0, el: 75, dist: 2.6, energy: 65.48967387145 },
      { role: 'KEY', size: 2, sizeY: 4, az: -95, el: 20, dist: 3, energy: 29.10652172064 },
      { role: 'FILL', size: 2, sizeY: 4, az: 95, el: 20, dist: 3, energy: 29.10652172064 },
      { role: 'FILL', size: 3, sizeY: 3, az: 0, el: 25, dist: 3.5, energy: 21.82989129048, glossy: false },
    ],
  },
  {
    key: 'FURNITURE_IN', set: 'WARM_WINDOW',
    label: { es: 'Mobiliario interior', en: 'Indoor furniture' },
    sizeMm: 900, focalMm: 50, fstop: 5.6,
    envStrength: 0.9, exposure: 0,
    background: 'FLAT', backgroundColor: [0.16, 0.15, 0.14, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // L6: the lights of the set WARM_WINDOW (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 5, sizeY: 4, az: -65, el: 40, dist: 2.4, energy: 87.62792668715, kelvin: 4300 },
      { role: 'FILL', size: 3, sizeY: 3, az: 40, el: 15, dist: 3.5, energy: 18.77741286153, kelvin: 6500, glossy: false },
    ],
  },
  {
    key: 'FURNITURE_OUT',
    label: { es: 'Mobiliario exterior', en: 'Outdoor furniture' },
    sizeMm: 900, focalMm: 50, fstop: 8,
    envStrength: 1.1, exposure: 0,
    background: 'HDRI', backgroundColor: [0.35, 0.45, 0.6, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // Sun: a small distant source, which is what gives the hard shadow.
    lights: [
      { role: 'KEY', size: 0.4, sizeY: 0.4, az: -20, el: 55, dist: 5, energy: 260,
        color: [1, 0.95, 0.88], glossy: false },
      { role: 'FILL', size: 8, sizeY: 8, az: 95, el: 25, dist: 4, energy: 30,
        color: [0.8, 0.88, 1], glossy: false },
    ],
  },
  {
    key: 'FOOTWEAR', set: 'RAKING_TEXTURE',
    label: { es: 'Calzado', en: 'Footwear' },
    sizeMm: 280, focalMm: 85, fstop: 8,
    envStrength: 0.6, exposure: 0,
    background: 'FLAT', backgroundColor: [0.1, 0.1, 0.11, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // L6: the lights of the set RAKING_TEXTURE (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 4, sizeY: 0.8, az: -85, el: 10, dist: 3, energy: 142.7906691523, kelvin: 4800, spread: 60 },
      { role: 'FILL', size: 4, sizeY: 3, az: 55, el: 30, dist: 3.6, energy: 43.93559050839, kelvin: 6200, glossy: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 150, el: 35, dist: 3, energy: 32.95169288129 },
    ],
  },
  {
    key: 'TEXTILE', set: 'RAKING_TEXTURE',
    label: { es: 'Textil', en: 'Textile' },
    sizeMm: 400, focalMm: 100, fstop: 8,
    envStrength: 0.45, exposure: 0,
    background: 'FLAT', backgroundColor: [0.09, 0.09, 0.1, 1],
    floor: true, shadow: true, caustics: false, quality: 'FINAL',
    // L6: the lights of the set RAKING_TEXTURE (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 4, sizeY: 0.8, az: -85, el: 10, dist: 3, energy: 98.33594976452, kelvin: 4800, spread: 60 },
      { role: 'FILL', size: 4, sizeY: 3, az: 55, el: 30, dist: 3.6, energy: 30.25721531216, kelvin: 6200, glossy: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 150, el: 35, dist: 3, energy: 22.69291148412 },
    ],
  },
  {
    key: 'PACKAGING', set: 'GRADIENT_POOL',
    label: { es: 'Packaging', en: 'Packaging' },
    sizeMm: 250, focalMm: 85, fstop: 11,
    envStrength: 0.7, exposure: 0.05,
    background: 'FLAT', backgroundColor: [0.85, 0.85, 0.85, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // L6: the lights of the set GRADIENT_POOL (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 3, sizeY: 2.5, az: -40, el: 40, dist: 2.2, energy: 66.45801430452 },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 20, dist: 3.5, energy: 26.58320572181, glossy: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 165, el: 70, dist: 3, energy: 19.93740429136 },
    ],
  },
  {
    key: 'AUTOMOTIVE', set: 'CHROME_FAMILY',
    label: { es: 'Componente de automocion', en: 'Automotive part' },
    sizeMm: 350, focalMm: 85, fstop: 8,
    envStrength: 0.5, exposure: -0.3,
    background: 'FLAT', backgroundColor: [0.04, 0.04, 0.045, 1],
    floor: true, shadow: true, caustics: false, quality: 'FINAL',
    // L6: the lights of the set CHROME_FAMILY (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 4, sizeY: 4, az: -35, el: 45, dist: 2.2, energy: 64.58037336272 },
      { role: 'TOP', size: 2, sizeY: 4, az: -25, el: 50, dist: 2, energy: 25.83214934509 },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 170, el: 70, dist: 3, energy: 19.37411200881 },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 20, dist: 3.5, energy: 19.37411200881, glossy: false },
    ],
  },
  {
    key: 'TOOL', set: 'CHROME_FAMILY',
    label: { es: 'Herramienta industrial', en: 'Industrial tool' },
    sizeMm: 300, focalMm: 85, fstop: 8,
    envStrength: 0.4, exposure: -0.3,
    background: 'FLAT', backgroundColor: [0.06, 0.06, 0.06, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // L6: the lights of the set CHROME_FAMILY (light-setups.ts), at this type's level.
    lights: [
      { role: 'KEY', size: 4, sizeY: 4, az: -35, el: 45, dist: 2.2, energy: 68.89470516376 },
      { role: 'TOP', size: 2, sizeY: 4, az: -25, el: 50, dist: 2, energy: 27.5578820655 },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 170, el: 70, dist: 3, energy: 20.66841154913 },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 20, dist: 3.5, energy: 20.66841154913, glossy: false },
    ],
  },
  {
    key: 'EYEWEAR', set: 'BRIGHT_FIELD',
    label: { es: 'Optica y gafas', en: 'Eyewear' },
    sizeMm: 140, focalMm: 100, fstop: 8,
    envStrength: 0.6, exposure: 1.2,
    background: 'FLAT', backgroundColor: [0.2, 0.2, 0.22, 1],
    floor: true, shadow: true, caustics: true, quality: 'FINAL',
    // L6: the lights of the set BRIGHT_FIELD (light-setups.ts), at this type's level.
    lights: [
      { role: 'RIM', size: 4.5, sizeY: 4.5, az: 180, el: 10, dist: 4, energy: 288.7628655469, camera: true },
      { role: 'TOP', size: 3, sizeY: 3, az: 0, el: 80, dist: 2.6, energy: 19.25085770313 },
      { role: 'FILL', size: 2, sizeY: 2, az: 0, el: 20, dist: 3, energy: 12.83390513542, glossy: false },
    ],
  },
  {
    key: 'MEDICAL', set: 'HIGH_KEY_WHITE',
    label: { es: 'Instrumental medico', en: 'Medical device' },
    sizeMm: 220, focalMm: 85, fstop: 11,
    envStrength: 0.85, exposure: 1.5,
    background: 'FLAT', backgroundColor: [0.88, 0.88, 0.89, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // L6: the lights of the set HIGH_KEY_WHITE (light-setups.ts), at this type's level.
    lights: [
      { role: 'TOP', size: 5, sizeY: 4, az: 0, el: 75, dist: 2.6, energy: 68.66031028881 },
      { role: 'KEY', size: 2, sizeY: 4, az: -95, el: 20, dist: 3, energy: 30.5156934617 },
      { role: 'FILL', size: 2, sizeY: 4, az: 95, el: 20, dist: 3, energy: 30.5156934617 },
      { role: 'FILL', size: 3, sizeY: 3, az: 0, el: 25, dist: 3.5, energy: 22.88677009627, glossy: false },
    ],
  },
];

/**
 * L6: the set each product type's own rig is (`StudioPreset.set`): its lights, at the type's level (the total
 * irradiance the type had before L6, so the setups normalised to it do not change), and with the type's own rig
 * (setup PRESET) its decoration and look too: cards, backdrop, floor, pool; the set's exposure offset is folded into
 * the type's `exposure`. Outdoor furniture keeps its sun: no studio set is outdoor light.
 */
export const PRESET_SETS: Readonly<Record<string, string>> = /* @__PURE__ */ Object.fromEntries(
  STUDIO_PRESETS.filter((p) => p.set !== undefined).map((p) => [p.key, p.set!]),
);

export function studioPreset(key: string): StudioPreset | undefined {
  return STUDIO_PRESETS.find((p) => p.key === key);
}

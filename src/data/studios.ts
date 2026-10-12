// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (MIT); values are data, the implementation is new.

import type { StudioPreset } from './types';

// Studio presets, one per product type (upstream STUDIO_PRESETS, 16 entries,
// in upstream order). Each category has its conventions: the typical size
// drives focal length and distance, the reflectance of the material decides
// whether the light wraps or is directional, and transparency forces
// caustics on.
//
// Lights: `dist`, `size` and `sizeY` are in multiples of the part size, so the
// same preset suits a ring and a sofa. `az` is already relative to the camera
// axis (0 behind the camera, negative camera-left, 180 behind the part);
// `energy` is watts at part size 1.
export const STUDIO_PRESETS: readonly StudioPreset[] = [
  {
    key: 'GENERIC',
    label: { es: 'Estandar tres puntos', en: 'Standard three-point' },
    sizeMm: 200, focalMm: 85, fstop: 5.6,
    envStrength: 0.6, exposure: 0,
    background: 'FLAT', backgroundColor: [0.05, 0.05, 0.05, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    lights: [
      { role: 'KEY', size: 2.5, sizeY: 1.8, az: -5, el: 40, dist: 3, energy: 90,
        color: [1, 0.98, 0.95], glossy: true },
      { role: 'FILL', size: 3.5, sizeY: 3.5, az: 90, el: 15, dist: 3.5, energy: 30,
        color: [0.95, 0.97, 1], glossy: false },
      { role: 'RIM', size: 2, sizeY: 0.4, az: -165, el: 35, dist: 3, energy: 70,
        color: [1, 1, 1], glossy: true },
    ],
  },
  {
    key: 'JEWELLERY',
    label: { es: 'Joyeria', en: 'Jewellery' },
    sizeMm: 30, focalMm: 100, fstop: 11,
    envStrength: 0.9, exposure: 0,
    background: 'FLAT', backgroundColor: [0.02, 0.02, 0.025, 1],
    floor: true, shadow: false, caustics: true, quality: 'FINAL',
    // Light tent: wrapping from four sides and from above, which avoids dirty
    // reflections on gold and stones.
    lights: [
      { role: 'TOP', size: 4, sizeY: 4, az: 35, el: 80, dist: 2.6, energy: 36, color: [1, 1, 1],
        glossy: true },
      { role: 'KEY', size: 3.5, sizeY: 3.5, az: -10, el: 30, dist: 2.8, energy: 29,
        color: [1, 0.99, 0.97], glossy: true },
      { role: 'FILL', size: 3.5, sizeY: 3.5, az: 80, el: 25, dist: 2.8, energy: 23,
        color: [0.97, 0.98, 1], glossy: true },
      { role: 'RIM', size: 2, sizeY: 0.3, az: -155, el: 20, dist: 2.5, energy: 31,
        color: [1, 1, 1], glossy: true },
      { role: 'FILL', size: 3, sizeY: 3, az: -75, el: 10, dist: 3, energy: 16, color: [1, 1, 1],
        glossy: true },
    ],
  },
  {
    key: 'WATCH',
    label: { es: 'Relojeria', en: 'Watchmaking' },
    sizeMm: 45, focalMm: 100, fstop: 8,
    envStrength: 0.7, exposure: 0,
    background: 'FLAT', backgroundColor: [0.03, 0.03, 0.035, 1],
    floor: true, shadow: true, caustics: true, quality: 'FINAL',
    // Long strips: they give the continuous sweep that draws a polished case.
    lights: [
      { role: 'KEY', size: 5, sizeY: 0.35, az: 0, el: 45, dist: 2.8, energy: 58,
        color: [1, 0.99, 0.97], glossy: true },
      { role: 'FILL', size: 4, sizeY: 0.35, az: 85, el: 30, dist: 3, energy: 30,
        color: [0.97, 0.98, 1], glossy: true },
      { role: 'TOP', size: 3, sizeY: 3, az: 35, el: 80, dist: 2.6, energy: 26, color: [1, 1, 1],
        glossy: true },
      { role: 'RIM', size: 2.5, sizeY: 0.25, az: -160, el: 25, dist: 2.6, energy: 46,
        color: [1, 1, 1], glossy: true },
    ],
  },
  {
    key: 'PERFUME',
    label: { es: 'Perfumeria', en: 'Fragrance' },
    sizeMm: 110, focalMm: 100, fstop: 8,
    envStrength: 0.35, exposure: 0,
    background: 'FLAT', backgroundColor: [0.015, 0.015, 0.02, 1],
    floor: true, shadow: false, caustics: true, quality: 'FINAL',
    // Dark field: the glass is drawn backlit, with two strips marking the
    // edges. Front light is almost nil on purpose.
    lights: [
      { role: 'RIM', size: 6, sizeY: 6, az: -145, el: 15, dist: 3.2, energy: 110,
        color: [1, 1, 1], glossy: true },
      { role: 'KEY', size: 4.5, sizeY: 0.3, az: -45, el: 20, dist: 2.4, energy: 34,
        color: [1, 0.99, 0.98], glossy: true },
      { role: 'FILL', size: 4.5, sizeY: 0.3, az: 115, el: 20, dist: 2.4, energy: 34,
        color: [0.98, 0.99, 1], glossy: true },
    ],
  },
  {
    key: 'COSMETICS',
    label: { es: 'Cosmetica', en: 'Cosmetics' },
    sizeMm: 90, focalMm: 100, fstop: 8,
    envStrength: 0.8, exposure: 0.15,
    background: 'FLAT', backgroundColor: [0.78, 0.78, 0.78, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // High key: light background and very open shadows.
    lights: [
      { role: 'KEY', size: 4, sizeY: 3, az: 5, el: 40, dist: 3, energy: 80,
        color: [1, 0.99, 0.98], glossy: true },
      { role: 'FILL', size: 5, sizeY: 4, az: 80, el: 20, dist: 3.2, energy: 55, color: [1, 1, 1],
        glossy: false },
      { role: 'TOP', size: 4, sizeY: 4, az: 35, el: 75, dist: 3, energy: 45, color: [1, 1, 1],
        glossy: true },
    ],
  },
  {
    key: 'ELECTRONICS',
    label: { es: 'Electronica', en: 'Electronics' },
    sizeMm: 150, focalMm: 85, fstop: 8,
    envStrength: 0.5, exposure: -0.15,
    background: 'FLAT', backgroundColor: [0.035, 0.035, 0.04, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // Big soft sources so screens do not burn out, and a strong rim that
    // separates the black product from the black background.
    lights: [
      { role: 'KEY', size: 4, sizeY: 3, az: -5, el: 35, dist: 3, energy: 70, color: [1, 1, 1],
        glossy: true },
      { role: 'FILL', size: 4.5, sizeY: 3.5, az: 85, el: 20, dist: 3.2, energy: 35,
        color: [0.96, 0.98, 1], glossy: false },
      { role: 'RIM', size: 3, sizeY: 0.3, az: -170, el: 40, dist: 2.8, energy: 95,
        color: [1, 1, 1], glossy: true },
    ],
  },
  {
    key: 'APPLIANCE',
    label: { es: 'Electrodomestico', en: 'Appliance' },
    sizeMm: 600, focalMm: 50, fstop: 8,
    envStrength: 0.7, exposure: 0.1,
    background: 'FLAT', backgroundColor: [0.72, 0.72, 0.73, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    lights: [
      { role: 'KEY', size: 4, sizeY: 4, az: 0, el: 35, dist: 3.2, energy: 85, color: [1, 1, 1],
        glossy: true },
      { role: 'FILL', size: 5, sizeY: 4, az: 85, el: 15, dist: 3.5, energy: 50, color: [1, 1, 1],
        glossy: false },
      { role: 'TOP', size: 4.5, sizeY: 4.5, az: 35, el: 78, dist: 3, energy: 50,
        color: [1, 1, 1], glossy: true },
    ],
  },
  {
    key: 'FURNITURE_IN',
    label: { es: 'Mobiliario interior', en: 'Indoor furniture' },
    sizeMm: 900, focalMm: 50, fstop: 5.6,
    envStrength: 0.9, exposure: 0,
    background: 'FLAT', backgroundColor: [0.16, 0.15, 0.14, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // Large warm window, which is what an interior calls for.
    lights: [
      { role: 'KEY', size: 5, sizeY: 4, az: -15, el: 30, dist: 3, energy: 80,
        color: [1, 0.96, 0.9], glossy: true },
      { role: 'FILL', size: 6, sizeY: 5, az: 90, el: 15, dist: 3.5, energy: 35,
        color: [0.94, 0.96, 1], glossy: false },
      { role: 'RIM', size: 3, sizeY: 1, az: -175, el: 30, dist: 3, energy: 45,
        color: [1, 0.98, 0.95], glossy: true },
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
    key: 'FOOTWEAR',
    label: { es: 'Calzado', en: 'Footwear' },
    sizeMm: 280, focalMm: 85, fstop: 8,
    envStrength: 0.6, exposure: 0,
    background: 'FLAT', backgroundColor: [0.1, 0.1, 0.11, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    lights: [
      { role: 'KEY', size: 3.5, sizeY: 2.5, az: -5, el: 35, dist: 3, energy: 85,
        color: [1, 0.99, 0.97], glossy: true },
      { role: 'FILL', size: 4, sizeY: 3, az: 90, el: 20, dist: 3.2, energy: 40,
        color: [0.97, 0.98, 1], glossy: false },
      { role: 'RIM', size: 2.5, sizeY: 0.5, az: -165, el: 30, dist: 2.8, energy: 75,
        color: [1, 1, 1], glossy: true },
    ],
  },
  {
    key: 'TEXTILE',
    label: { es: 'Textil', en: 'Textile' },
    sizeMm: 400, focalMm: 100, fstop: 8,
    envStrength: 0.45, exposure: 0,
    background: 'FLAT', backgroundColor: [0.09, 0.09, 0.1, 1],
    floor: true, shadow: true, caustics: false, quality: 'FINAL',
    // Raking light: the only way for the weave to read.
    lights: [
      { role: 'KEY', size: 4, sizeY: 0.8, az: -40, el: 12, dist: 3, energy: 95,
        color: [1, 0.99, 0.97], glossy: true },
      { role: 'FILL', size: 4.5, sizeY: 3.5, az: 95, el: 30, dist: 3.5, energy: 30,
        color: [0.98, 0.99, 1], glossy: false },
      { role: 'TOP', size: 3, sizeY: 3, az: 35, el: 70, dist: 3, energy: 25, color: [1, 1, 1],
        glossy: false },
    ],
  },
  {
    key: 'PACKAGING',
    label: { es: 'Packaging', en: 'Packaging' },
    sizeMm: 250, focalMm: 85, fstop: 11,
    envStrength: 0.7, exposure: 0.05,
    background: 'FLAT', backgroundColor: [0.85, 0.85, 0.85, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // Catalogue look: flat, even and undramatic, so the box artwork reads
    // without interference.
    lights: [
      { role: 'KEY', size: 5, sizeY: 4, az: 5, el: 35, dist: 3.2, energy: 75, color: [1, 1, 1],
        glossy: false },
      { role: 'FILL', size: 5, sizeY: 4, az: 75, el: 30, dist: 3.2, energy: 65, color: [1, 1, 1],
        glossy: false },
      { role: 'TOP', size: 5, sizeY: 5, az: 35, el: 80, dist: 3, energy: 40, color: [1, 1, 1],
        glossy: false },
    ],
  },
  {
    key: 'AUTOMOTIVE',
    label: { es: 'Componente de automocion', en: 'Automotive part' },
    sizeMm: 350, focalMm: 85, fstop: 8,
    envStrength: 0.5, exposure: -0.1,
    background: 'FLAT', backgroundColor: [0.04, 0.04, 0.045, 1],
    floor: true, shadow: true, caustics: false, quality: 'FINAL',
    // Very long strips: metal is drawn by the reflection of the source, not
    // by its brightness.
    lights: [
      { role: 'KEY', size: 8, sizeY: 0.5, az: -10, el: 50, dist: 3.2, energy: 100,
        color: [1, 1, 1], glossy: true },
      { role: 'FILL', size: 6, sizeY: 0.5, az: 90, el: 30, dist: 3.4, energy: 50,
        color: [0.96, 0.98, 1], glossy: true },
      { role: 'RIM', size: 5, sizeY: 0.3, az: -165, el: 25, dist: 3, energy: 85,
        color: [1, 1, 1], glossy: true },
    ],
  },
  {
    key: 'TOOL',
    label: { es: 'Herramienta industrial', en: 'Industrial tool' },
    sizeMm: 300, focalMm: 85, fstop: 8,
    envStrength: 0.4, exposure: -0.1,
    background: 'FLAT', backgroundColor: [0.06, 0.06, 0.06, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // More contrast and a harder shadow: character matters here.
    lights: [
      { role: 'KEY', size: 2, sizeY: 1.5, az: -15, el: 40, dist: 2.8, energy: 100,
        color: [1, 0.99, 0.96], glossy: true },
      { role: 'FILL', size: 3, sizeY: 2.5, az: 95, el: 15, dist: 3.2, energy: 22,
        color: [0.95, 0.97, 1], glossy: false },
      { role: 'RIM', size: 2.5, sizeY: 0.3, az: -170, el: 35, dist: 2.8, energy: 80,
        color: [1, 1, 1], glossy: true },
    ],
  },
  {
    key: 'EYEWEAR',
    label: { es: 'Optica y gafas', en: 'Eyewear' },
    sizeMm: 140, focalMm: 100, fstop: 8,
    envStrength: 0.6, exposure: 0,
    background: 'FLAT', backgroundColor: [0.2, 0.2, 0.22, 1],
    floor: true, shadow: true, caustics: true, quality: 'FINAL',
    lights: [
      { role: 'TOP', size: 5, sizeY: 3, az: 35, el: 70, dist: 2.8, energy: 65, color: [1, 1, 1],
        glossy: true },
      { role: 'KEY', size: 4, sizeY: 0.4, az: -25, el: 25, dist: 2.8, energy: 60,
        color: [1, 0.99, 0.98], glossy: true },
      { role: 'FILL', size: 4, sizeY: 0.4, az: 95, el: 25, dist: 2.8, energy: 50,
        color: [0.98, 0.99, 1], glossy: true },
    ],
  },
  {
    key: 'MEDICAL',
    label: { es: 'Instrumental medico', en: 'Medical device' },
    sizeMm: 220, focalMm: 85, fstop: 11,
    envStrength: 0.85, exposure: 0.1,
    background: 'FLAT', backgroundColor: [0.88, 0.88, 0.89, 1],
    floor: true, shadow: true, caustics: false, quality: 'PREVIEW',
    // Clinical high key: white on white, no dramatic shadow.
    lights: [
      { role: 'KEY', size: 5, sizeY: 4, az: 0, el: 40, dist: 3.2, energy: 70, color: [1, 1, 1],
        glossy: false },
      { role: 'FILL', size: 5, sizeY: 4, az: 80, el: 25, dist: 3.2, energy: 60, color: [1, 1, 1],
        glossy: false },
      { role: 'TOP', size: 5, sizeY: 5, az: 35, el: 80, dist: 3, energy: 55, color: [1, 1, 1],
        glossy: true },
    ],
  },
];

export function studioPreset(key: string): StudioPreset | undefined {
  return STUDIO_PRESETS.find((p) => p.key === key);
}

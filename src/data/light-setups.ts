// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (PolyForm Noncommercial 1.0.0); values are data, the implementation is new.

import type {
  LightRole,
  LightSetup,
  LightShape,
  LightStyle,
  LightStyleEntry,
  LightType,
  ResolvedLight,
  SpecDefaults,
} from './types';

// Light-setup catalogue: the 16 sets of L6 first (style SETS, designed for Repackshot), then upstream LIGHT_SETUPS
// (72 recipes, in upstream order, PRESET first). Each recipe defines the SHAPE and TONE of the light: how many
// sources, where, how big, what colour. The LEVEL still comes from the product
// preset (see core/rig.ts), so changing setup does not change the exposure.
//
// Reference system: `az` is relative to the camera axis, 0 behind the camera,
// negative camera-left, positive camera-right, 180 behind the part. `el` is
// the elevation above the horizon; `dist`, `size` and `sizeY` are in part
// sizes. `share` is the fraction of the total irradiance (the shares of a
// recipe sum to 1). `kelvin` gives the tone of a white source; `color` (RGB)
// wins over kelvin and is what the colour setups use. `spread` is the beam
// spread: 180 is a fabric diffuser, 60 a honeycomb grid. `camera` marks a
// luminous panel that the camera DOES see.

/** Styles used to filter the catalogue. "All" is a UI filter, not a style. */
export const LIGHT_STYLES: readonly LightStyleEntry[] = [
  // L6: the designed sets, first.
  { key: 'SETS', label: { es: 'Sets', en: 'Sets' } },
  { key: 'PRODUCT', label: { es: 'Producto', en: 'Product' } },
  { key: 'TRADITIONAL', label: { es: 'Tradicional', en: 'Traditional' } },
  { key: 'CINEMATIC', label: { es: 'Cinematografico', en: 'Cinematic' } },
  { key: 'CREATIVE', label: { es: 'Creativo', en: 'Creative' } },
  { key: 'EMOTIONAL', label: { es: 'Emocional', en: 'Emotional' } },
  { key: 'EXPERIMENTAL', label: { es: 'Experimental', en: 'Experimental' } },
  { key: 'SIGNATURE', label: { es: 'De autor', en: 'Signature' } },
  { key: 'SPICY', label: { es: 'Atrevido', en: 'Spicy' } },
];

/** Azimuth of the default camera in world space, degrees. */
export const CAMERA_AZIMUTH_DEG = -35;
/** Elevation of the default camera above the horizon, degrees. */
export const CAMERA_ELEVATION_DEG = 22;

// What a LightSpec falls back to when a field is absent. Spread is 180 on
// purpose: an area light with 120 degrees draws a straight-edged cut-out on
// the floor, which reads as running off the table.
export const SPEC_DEFAULTS: Readonly<SpecDefaults> = {
  type: 'AREA',
  shape: 'RECTANGLE',
  spread: 180,
  angle: 0.545,
  kelvin: 5600,
  glossy: true,
  camera: false,
};

// Light types and shapes the renderer understands. No recipe of the catalogue
// uses POINT, SPOT or SPHERE: they are the own lights of phase L4 (Add light),
// which a saved setup of the library can carry.
export const LIGHT_TYPES: readonly LightType[] = ['AREA', 'POINT', 'SPOT', 'SUN'];
export const LIGHT_SHAPES: readonly LightShape[] = ['SQUARE', 'RECTANGLE', 'DISK', 'ELLIPSE', 'SPHERE'];

// Generic fallback per role, used when the active rig does not cover a role.
// The real values always come from the rig. NOTE: `azimuthWorld` here is in
// WORLD space (already includes the camera offset), unlike LightSpec.az.
export const LIGHT_ROLES: Readonly<Record<LightRole, Omit<ResolvedLight, 'role'>>> = {
  KEY: {
    size: 2.5, sizeY: 1.8, azimuthWorld: -40, elevation: 40, dist: 3, energy: 90,
    color: [1, 0.98, 0.95], glossy: true, type: 'AREA', shape: 'RECTANGLE',
    spread: 180, angle: 0.545, camera: false,
  },
  FILL: {
    size: 3.5, sizeY: 3.5, azimuthWorld: 55, elevation: 15, dist: 3.5, energy: 30,
    color: [0.95, 0.97, 1], glossy: false, type: 'AREA', shape: 'RECTANGLE',
    spread: 180, angle: 0.545, camera: false,
  },
  RIM: {
    size: 2, sizeY: 0.4, azimuthWorld: 160, elevation: 35, dist: 3, energy: 70,
    color: [1, 1, 1], glossy: true, type: 'AREA', shape: 'RECTANGLE',
    spread: 180, angle: 0.545, camera: false,
  },
  TOP: {
    size: 3, sizeY: 3, azimuthWorld: 0, elevation: 80, dist: 2.8, energy: 40,
    color: [1, 1, 1], glossy: true, type: 'AREA', shape: 'RECTANGLE',
    spread: 180, angle: 0.545, camera: false,
  },
};

export const LIGHT_SETUPS: readonly LightSetup[] = [
  // --- Sets (L6, not ported from EZ Packshot: designed for Repackshot) -------------------------------------------
  // A set is a setup with what the product reflects and stands on: cards, backdrop, floor, a pool of light behind,
  // an exposure offset and the dome's strength (types.ts). Principles, not tables: the family of angles and the
  // bright and dark fields of Hunter, Biver and Fuqua, *Light: Science & Magic*; the usual key / fill ratios; the
  // common practice of the still-life studio. Two keys of the plan (ROADMAP L6) were taken by setups before L6 (keys stay):
  // the dark field of glass is GLASS_DARK_FIELD and the warm-cool cinema set WARM_COOL_CINEMA. Shares as everywhere:
  // the weight of each light, normalised to the product type's level (the pool's measured where it lands, core/rig.ts).
  {
    key: 'STRIP_EDGE', style: 'SETS', world: 'STUDIO', hero: 'BOTTLE',
    label: { es: 'Tira larga y canto negro', en: 'Long strip and black edge' },
    intent: {
      es: 'Una tira de arriba abajo y una tarjeta negra que dibuja el canto: botellas y cosmética',
      en: 'One strip top to bottom and a black card that draws the edge: bottles and cosmetics',
    },
    why: {
      es: 'Una sola tira limpia recorre la botella de arriba abajo y el canto negro la separa del fondo. El reflejo en el suelo la asienta.',
      en: 'One clean strip runs down the bottle from top to bottom, and the black edge sets it apart from the background. The reflection on the floor grounds it.',
    },
    lights: [
      { role: 'KEY', size: 0.35, sizeY: 4.5, az: -115, el: 25, dist: 3, share: 0.55, kelvin: 5300 },
      { role: 'FILL', size: 3, sizeY: 3, az: 70, el: 20, dist: 3.5, share: 0.25, glossy: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 160, el: 50, dist: 3, share: 0.2 },
    ],
    cards: [
      { material: 'CARD_BLACK', az: 70, el: 15, dist: 1.6, size: 2, sizeY: 5 },
      { material: 'CARD_WHITE', az: -60, el: 10, dist: 2, size: 2, sizeY: 4 },
    ],
    backdrop: { kind: 'GRADIENT', top: [0.1, 0.1, 0.1], bottom: [0.02, 0.02, 0.02] },
    pool: { az: 180, el: 10, cone: 25, share: 0.15 },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_BLACK' },
    exposureEv: -0.3,
    camera: { el: 8, focalMm: 85 },
  },
  {
    key: 'GLASS_DARK_FIELD', style: 'SETS', world: 'STUDIO', hero: 'BOTTLE',
    label: { es: 'Campo oscuro', en: 'Dark field' },
    intent: {
      es: 'Sin luz frontal: dos tiras por detrás dibujan en blanco los bordes del vidrio',
      en: 'No front light: two strips from behind draw the edges of the glass in white',
    },
    why: {
      es: 'El vidrio solo se ve por sus bordes. Sobre negro, dos tiras detrás de la pieza los dibujan en blanco (campo oscuro, Hunter et al.).',
      en: 'Glass shows only by its edges. On black, two strips behind the piece draw them in white (dark field, Hunter et al.).',
    },
    lights: [
      { role: 'RIM', size: 0.4, sizeY: 4, az: -135, el: 55, dist: 3, share: 0.4 },
      { role: 'RIM', size: 0.4, sizeY: 4, az: 135, el: 55, dist: 3, share: 0.4 },
      { role: 'TOP', size: 2, sizeY: 2, az: 0, el: 85, dist: 2.6, share: 0.2, glossy: false },
    ],
    cards: [
      { material: 'CARD_BLACK', az: -70, el: 10, dist: 1.8, size: 3, sizeY: 4 },
      { material: 'CARD_BLACK', az: 70, el: 10, dist: 1.8, size: 3, sizeY: 4 },
    ],
    backdrop: { kind: 'FLAT', color: [0.01, 0.01, 0.01] },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_BLACK' },
    envStrength: 0,
    exposureEv: -0.5,
  },
  {
    key: 'BRIGHT_FIELD', style: 'SETS', world: 'STUDIO', hero: 'BOTTLE',
    label: { es: 'Campo claro', en: 'Bright field' },
    intent: {
      es: 'Un fondo luminoso detrás y tarjetas negras que dibujan los bordes en negro',
      en: 'A luminous background behind and black cards that draw the edges in black',
    },
    why: {
      es: 'Sobre blanco, el vidrio se dibuja con bordes negros. Esos bordes los ponen las tarjetas, no la luz.',
      en: 'On white, glass is drawn with black edges. The cards put those edges there, not the light.',
    },
    lights: [
      { role: 'RIM', size: 4.5, sizeY: 4.5, az: 180, el: 10, dist: 4, share: 0.9, camera: true },
      { role: 'TOP', size: 3, sizeY: 3, az: 0, el: 80, dist: 2.6, share: 0.06 },
      { role: 'FILL', size: 2, sizeY: 2, az: 0, el: 20, dist: 3, share: 0.04, glossy: false },
    ],
    cards: [
      { material: 'CARD_BLACK', az: -70, el: 10, dist: 1.6, size: 2, sizeY: 5 },
      { material: 'CARD_BLACK', az: 70, el: 10, dist: 1.6, size: 2, sizeY: 5 },
    ],
    backdrop: { kind: 'FLAT', color: [0.9, 0.9, 0.9] },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_WHITE' },
    envStrength: 1.2,
    exposureEv: 1.2,
  },
  {
    key: 'HIGH_KEY_WHITE', style: 'SETS', world: 'STUDIO', hero: 'BOX',
    label: { es: 'Blanco infinito', en: 'Infinite white' },
    intent: {
      es: 'Fondo blanco quemado y sombra de contacto suave: la foto de tienda',
      en: 'A white background burnt out and a soft contact shadow: the shop photo',
    },
    why: {
      es: 'El fondo quemado a blanco y una sombra de contacto apenas visible son el estándar de la tienda en línea. Nada distrae del producto.',
      en: 'A background burnt out to white and a barely visible contact shadow are the standard of the online shop. Nothing distracts from the product.',
    },
    lights: [
      { role: 'TOP', size: 5, sizeY: 4, az: 0, el: 75, dist: 2.6, share: 0.45 },
      { role: 'KEY', size: 2, sizeY: 4, az: -95, el: 20, dist: 3, share: 0.2 },
      { role: 'FILL', size: 2, sizeY: 4, az: 95, el: 20, dist: 3, share: 0.2 },
      { role: 'FILL', size: 3, sizeY: 3, az: 0, el: 25, dist: 3.5, share: 0.15, glossy: false },
    ],
    backdrop: { kind: 'SWEEP', color: [0.9, 0.9, 0.9] },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_WHITE' },
    pool: { az: 180, el: 30, cone: 90, share: 1.5 },
    envStrength: 2,
    exposureEv: 1.4,
  },
  {
    key: 'JEWEL_BOX', style: 'SETS', world: 'STUDIO', hero: 'RING', caustics: true,
    label: { es: 'Caja de luz con negros', en: 'Light box with blacks' },
    intent: {
      es: 'Luz envolvente para la piedra y negros colocados para el metal: joyería',
      en: 'Wrapping light for the stone and placed blacks for the metal: jewellery',
    },
    why: {
      es: 'La luz envolvente hace brillar la piedra y una chispa dura le saca fuego. Los negros colocados dan forma al metal: el oro necesita reflejos oscuros para leerse como oro.',
      en: 'Wrapping light makes the stone shine, and one hard spark brings out its fire. Placed blacks give the metal its shape: gold needs dark reflections to read as gold.',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 3, az: -60, el: 30, dist: 2.5, share: 0.15 },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 30, dist: 2.5, share: 0.15 },
      { role: 'RIM', size: 3, sizeY: 3, az: -120, el: 30, dist: 2.5, share: 0.15 },
      { role: 'RIM', size: 3, sizeY: 3, az: 120, el: 30, dist: 2.5, share: 0.15 },
      { role: 'TOP', size: 3, sizeY: 3, az: 0, el: 80, dist: 2.5, share: 0.2 },
      { role: 'KEY', type: 'SPOT', size: 0.05, az: -40, el: 55, dist: 3, share: 0.1, spread: 12, blend: 0.2 },
    ],
    cards: [
      { material: 'CARD_BLACK', az: 0, el: 80, dist: 1.5, size: 2, sizeY: 2 },
      { material: 'CARD_BLACK', az: -70, el: 5, dist: 1.7, size: 2, sizeY: 3 },
    ],
    backdrop: { kind: 'GRADIENT', top: [0.06, 0.06, 0.06], bottom: [0.015, 0.015, 0.015] },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_BLACK' },
    exposureEv: 0,
    camera: { focalMm: 100 },
  },
  {
    key: 'CHROME_FAMILY', style: 'SETS', world: 'STUDIO', hero: 'CHROME',
    label: { es: 'Familia de ángulos', en: 'Family of angles' },
    intent: {
      es: 'Un degradado grande delante y un negro limpio: relojes y cromados',
      en: 'A big gradient in front and a clean black: watches and chrome',
    },
    why: {
      es: 'Un cromado solo enseña lo que refleja. Se le pone delante un degradado grande y un negro limpio, y el metal toma forma (la familia de ángulos de Hunter et al.).',
      en: 'Chrome shows only what it reflects. Put a big gradient and a clean black in front of it and the metal takes shape (the family of angles of Hunter et al.).',
    },
    lights: [
      { role: 'KEY', size: 4, sizeY: 4, az: -35, el: 45, dist: 2.2, share: 0.5 },
      { role: 'TOP', size: 2, sizeY: 4, az: -25, el: 50, dist: 2, share: 0.2 },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 170, el: 70, dist: 3, share: 0.15 },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 20, dist: 3.5, share: 0.15, glossy: false },
    ],
    cards: [
      { material: 'CARD_BLACK', az: 75, el: 20, dist: 1.8, size: 4, sizeY: 4 },
      { material: 'ALU_BRUSH', az: 90, el: 10, dist: 1.8, size: 2, sizeY: 3 },
    ],
    backdrop: { kind: 'GRADIENT', top: [0.12, 0.12, 0.12], bottom: [0.03, 0.03, 0.03] },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_BLACK' },
    exposureEv: -0.2,
  },
  {
    key: 'RAKING_TEXTURE', style: 'SETS', world: 'STUDIO', hero: 'SHOE',
    label: { es: 'Rasante con relleno', en: 'Raking with fill' },
    intent: {
      es: 'Clave cálida a ras y relleno frío: calzado, textil y piel',
      en: 'A warm key almost flat and a cool fill: footwear, textile and leather',
    },
    why: {
      es: 'La trama se lee con luz rasante. La clave cálida contra el relleno frío separa el volumen de la superficie.',
      en: 'Texture reads in raking light. A warm key against a cool fill separates the volume from the surface.',
    },
    lights: [
      { role: 'KEY', size: 4, sizeY: 0.8, az: -85, el: 10, dist: 3, share: 0.65, kelvin: 4800, spread: 60 },
      { role: 'FILL', size: 4, sizeY: 3, az: 55, el: 30, dist: 3.6, share: 0.2, kelvin: 6200, glossy: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 150, el: 35, dist: 3, share: 0.15 },
    ],
    backdrop: { kind: 'SWEEP', color: [0.25, 0.25, 0.25] },
    floor: { kind: 'MATTE', color: [0.3, 0.3, 0.3] },
    exposureEv: 0,
    camera: { el: 15, focalMm: 50 },
  },
  {
    key: 'BLACK_ON_BLACK', style: 'SETS', world: 'STUDIO', hero: 'BOX',
    label: { es: 'Negro sobre negro', en: 'Black on black' },
    intent: {
      es: 'Dos líneas de luz en los cantos y un halo tenue detrás: electrónica',
      en: 'Two lines of light on the edges and a faint halo behind: electronics',
    },
    why: {
      es: 'Un producto negro se dibuja con dos líneas de luz en sus cantos. Un halo tenue detrás lo despega del fondo.',
      en: 'A black product is drawn by two lines of light on its edges. A faint halo behind lifts it off the background.',
    },
    lights: [
      { role: 'RIM', size: 0.3, sizeY: 4, az: -150, el: 70, dist: 3, share: 0.35 },
      { role: 'RIM', size: 0.3, sizeY: 4, az: 150, el: 70, dist: 3, share: 0.35 },
      { role: 'FILL', size: 2, sizeY: 2, az: 0, el: 20, dist: 3, share: 0.08, glossy: false },
    ],
    backdrop: { kind: 'FLAT', color: [0.04, 0.04, 0.04] },
    pool: { az: 180, el: 5, cone: 18, share: 0.3, kelvin: 6500 },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_BLACK' },
    envStrength: 0.1,
    exposureEv: -0.6,
  },
  {
    key: 'WARM_WINDOW', style: 'SETS', world: 'STUDIO', hero: 'SPHERES',
    label: { es: 'Ventana cálida', en: 'Warm window' },
    intent: {
      es: 'Una ventana lateral grande y un lado en sombra: alimentación y hogar',
      en: 'A big side window and one side left in shadow: food and home',
    },
    why: {
      es: 'Una ventana lateral grande y un lado dejado en sombra es la luz de mesa de toda la vida. La tarjeta negra le quita el relleno y le da volumen.',
      en: 'A big side window with one side left in shadow is the table light of all time. The black card takes the fill away and gives it volume.',
    },
    lights: [
      { role: 'KEY', size: 5, sizeY: 4, az: -65, el: 40, dist: 2.4, share: 0.7, kelvin: 4300 },
      { role: 'FILL', size: 3, sizeY: 3, az: 40, el: 15, dist: 3.5, share: 0.15, kelvin: 6500, glossy: false },
    ],
    cards: [{ material: 'CARD_BLACK', az: 75, el: 10, dist: 1.8, size: 3, sizeY: 4 }],
    backdrop: { kind: 'SWEEP', color: [0.35, 0.315, 0.28] },
    floor: { kind: 'MATTE', color: [0.35, 0.35, 0.35] },
    exposureEv: 0,
  },
  {
    key: 'BACKLIT_LIQUID', style: 'SETS', world: 'STUDIO', hero: 'BOTTLE', caustics: true,
    label: { es: 'Contraluz líquido', en: 'Backlit liquid' },
    intent: {
      es: 'Un panel detrás que atraviesa el líquido hacia la cámara: bebidas',
      en: 'A panel behind whose light crosses the liquid towards the camera: drinks',
    },
    why: {
      es: 'El líquido se enciende cuando la luz lo atraviesa hacia la cámara. Dos tiras de canto y una tarjeta blanca arriba dibujan el vidrio.',
      en: 'Liquid lights up when the light crosses it towards the camera. Two edge strips and a white card above draw the glass.',
    },
    lights: [
      { role: 'RIM', size: 2, sizeY: 3, az: 180, el: 8, dist: 2.2, share: 0.55, camera: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: -130, el: 30, dist: 3, share: 0.15 },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 130, el: 30, dist: 3, share: 0.15 },
      { role: 'FILL', size: 2, sizeY: 2, az: 0, el: 20, dist: 3, share: 0.1, glossy: false },
    ],
    cards: [{ material: 'CARD_WHITE', az: 0, el: 80, dist: 1.5, size: 2, sizeY: 2 }],
    backdrop: { kind: 'GRADIENT', top: [0.08, 0.08, 0.08], bottom: [0.02, 0.02, 0.02] },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_BLACK', roughness: 0.2 },
    exposureEv: -0.2,
  },
  {
    key: 'WARM_COOL_CINEMA', style: 'SETS', world: 'STUDIO', hero: 'BOTTLE',
    label: { es: 'Cine cálido-frío', en: 'Warm-cool cinema' },
    intent: {
      es: 'Clave cálida y contra fría: el contraste de color del cine',
      en: 'A warm key and a cool rim: the colour contrast of cinema',
    },
    why: {
      es: 'Dos temperaturas opuestas en la clave y la contra son el contraste de color que más usa el cine. Un charco frío detrás remata la separación.',
      en: 'Two opposite temperatures in the key and the rim are the colour contrast cinema uses most. A cool pool behind finishes the separation.',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 3, az: -45, el: 35, dist: 2.8, share: 0.55, kelvin: 3800 },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 140, el: 55, dist: 3, share: 0.25, color: [0.55, 0.8, 1] },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 20, dist: 3.5, share: 0.1, kelvin: 5600, glossy: false },
    ],
    backdrop: { kind: 'GRADIENT', top: [0.03, 0.06, 0.08], bottom: [0.01, 0.01, 0.01] },
    pool: { az: 180, el: 10, cone: 25, share: 0.1, kelvin: 8000 },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_BLACK' },
    exposureEv: -0.3,
  },
  {
    key: 'POP_COLOR', style: 'SETS', world: 'STUDIO', hero: 'BOX',
    label: { es: 'Color pop', en: 'Pop colour' },
    intent: {
      es: 'Fondo saturado y dos contras de colores complementarios: tienda en redes',
      en: 'A saturated backdrop and two rims in complementary colours: the social-media shop',
    },
    why: {
      es: 'El color de fondo saturado y dos contras de color son el lenguaje de la tienda en redes. La luz cenital mantiene el producto limpio.',
      en: 'A saturated backdrop and two coloured rims are the language of the social-media shop. The top light keeps the product clean.',
    },
    lights: [
      { role: 'TOP', size: 4, sizeY: 4, az: 0, el: 70, dist: 2.6, share: 0.45 },
      { role: 'RIM', size: 0.4, sizeY: 4, az: -110, el: 20, dist: 3, share: 0.2, color: [0.4, 0.7, 1] },
      { role: 'RIM', size: 0.4, sizeY: 4, az: 110, el: 20, dist: 3, share: 0.2, color: [1, 0.85, 0.5] },
      { role: 'FILL', size: 3, sizeY: 3, az: 30, el: 20, dist: 3.5, share: 0.15, glossy: false },
    ],
    backdrop: { kind: 'SWEEP', color: [0.95, 0.55, 0.45] },
    floor: { kind: 'MATTE', color: [0.95, 0.55, 0.45] },
    exposureEv: 0.2,
  },
  {
    key: 'GRADIENT_POOL', style: 'SETS', world: 'STUDIO', hero: 'SPHERES',
    label: { es: 'Fondo degradado con foco', en: 'Gradient backdrop with a pool' },
    intent: {
      es: 'Un charco de luz detrás sobre un fondo neutro: catálogo',
      en: 'A pool of light behind on a neutral backdrop: catalogue',
    },
    why: {
      es: 'El charco de luz detrás separa el producto y da profundidad a un fondo neutro. Clave, relleno y contra hacen el resto sin llamar la atención.',
      en: 'The pool of light behind sets the product apart and gives a neutral backdrop depth. Key, fill and rim do the rest without drawing attention.',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 2.5, az: -40, el: 40, dist: 2.2, share: 0.5 },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 20, dist: 3.5, share: 0.2, glossy: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 165, el: 70, dist: 3, share: 0.15 },
    ],
    backdrop: { kind: 'SWEEP', color: [0.3, 0.3, 0.3] },
    pool: { az: 180, el: 15, cone: 22, share: 0.7 },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_WHITE', color: [0.6, 0.6, 0.6] },
    envStrength: 0,
    exposureEv: 0,
  },
  {
    key: 'MIRROR_FLOOR', style: 'SETS', world: 'STUDIO', hero: 'BOTTLE',
    label: { es: 'Suelo espejo', en: 'Mirror floor' },
    intent: {
      es: 'El reflejo completo bajo el producto: perfumería y cosmética',
      en: 'The whole reflection under the product: fragrance and cosmetics',
    },
    why: {
      es: 'El reflejo completo bajo el producto es el plano de perfumería por excelencia. Dos tiras bajas encienden ese reflejo.',
      en: 'The whole reflection under the product is the fragrance shot par excellence. Two low strips light that reflection up.',
    },
    lights: [
      { role: 'TOP', size: 3, sizeY: 3, az: 0, el: 80, dist: 2.6, share: 0.35 },
      { role: 'RIM', size: 0.4, sizeY: 3, az: -120, el: 5, dist: 2.5, share: 0.25 },
      { role: 'RIM', size: 0.4, sizeY: 3, az: 120, el: 5, dist: 2.5, share: 0.25 },
      { role: 'FILL', size: 3, sizeY: 3, az: 30, el: 20, dist: 3.5, share: 0.15, glossy: false },
    ],
    backdrop: { kind: 'GRADIENT', top: [0.05, 0.05, 0.05], bottom: [0.01, 0.01, 0.01] },
    floor: { kind: 'MIRROR', material: 'MIRROR_BLACK' },
    exposureEv: -0.3,
  },
  {
    key: 'FLAT_LAY', style: 'SETS', world: 'STUDIO', hero: 'BOX',
    label: { es: 'Cenital', en: 'Flat lay' },
    intent: {
      es: 'Desde arriba, luz de un lado alto y sombra suave hacia el otro: revista',
      en: 'From above, light from one high side and a soft shadow to the other: magazine',
    },
    why: {
      es: 'La luz desde un lado alto y una sombra suave hacia el otro es el plano cenital de revista. La tarjeta blanca abre la sombra sin borrarla.',
      en: 'Light from one high side and a soft shadow towards the other is the magazine flat lay. The white card opens the shadow without erasing it.',
    },
    lights: [
      { role: 'KEY', size: 5, sizeY: 5, az: -30, el: 60, dist: 2.5, share: 0.6 },
      { role: 'FILL', size: 3, sizeY: 3, az: 150, el: 40, dist: 3, share: 0.25, glossy: false },
    ],
    cards: [{ material: 'CARD_WHITE', az: 180, el: 45, dist: 2.8, size: 3, sizeY: 3 }],
    backdrop: { kind: 'SWEEP', color: [0.8, 0.8, 0.8] },
    floor: { kind: 'MATTE', color: [0.8, 0.8, 0.8] },
    exposureEv: 0.2,
    camera: { el: 85, focalMm: 50 },
  },
  {
    key: 'SILHOUETTE_GLOW', style: 'SETS', world: 'STUDIO', hero: 'BOTTLE',
    label: { es: 'Silueta con halo', en: 'Silhouette with a halo' },
    intent: {
      es: 'Un halo fuerte detrás recorta la silueta y dos filos la rematan: dramático',
      en: 'A strong halo behind cuts out the silhouette and two edges finish it: dramatic',
    },
    why: {
      es: 'El halo detrás recorta la silueta del producto. Dos tiras la rematan con dos filos de luz.',
      en: 'The halo behind cuts out the silhouette of the product. Two strips finish it with two edges of light.',
    },
    lights: [
      { role: 'FILL', size: 2, sizeY: 2, az: 0, el: 25, dist: 3, share: 0.12, glossy: false },
      { role: 'RIM', size: 0.3, sizeY: 3, az: -140, el: 55, dist: 3, share: 0.16 },
      { role: 'RIM', size: 0.3, sizeY: 3, az: 140, el: 55, dist: 3, share: 0.16 },
    ],
    backdrop: { kind: 'SWEEP', color: [0.2, 0.2, 0.2] },
    pool: { az: 180, el: 15, cone: 45, share: 0.45, kelvin: 5600 },
    floor: { kind: 'GLOSSY', material: 'ACRYLIC_BLACK' },
    envStrength: 0,
    exposureEv: -0.4,
  },

  // --- The 72 setups ported from EZ Packshot, in upstream order ---------------------------------------------------
  // Product
  {
    key: 'PRESET', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'El del tipo de producto', en: "The product type's" },
    intent: {
      es: 'El rig con el que viene tu tipo de producto',
      en: 'The rig your product type ships with',
    },
    lights: null,
  },
  {
    key: 'WRAP', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Carpa envolvente', en: 'Wrap-around tent' },
    intent: {
      es: 'Cinco fuentes grandes y ninguna sombra dura: joyeria y metal pulido',
      en: 'Five big sources and no hard shadow: jewellery and polished metal',
    },
    lights: [
      { role: 'TOP', size: 4, sizeY: 4, az: 0, el: 80, dist: 2.6, share: 0.28, spread: 180 },
      { role: 'KEY', size: 3.5, sizeY: 3.5, az: -45, el: 30, dist: 2.8, share: 0.24, spread: 180 },
      { role: 'FILL', size: 3.5, sizeY: 3.5, az: 45, el: 25, dist: 2.8, share: 0.2, spread: 180 },
      { role: 'RIM', size: 2, sizeY: 0.3, az: 180, el: 20, dist: 2.5, share: 0.16 },
      { role: 'FILL', size: 3, sizeY: 3, az: -100, el: 10, dist: 3, share: 0.12, spread: 180 },
    ],
  },
  {
    key: 'EDGE', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Tiras de canto', en: 'Edge strips' },
    intent: {
      es: 'Dos tiras largas por detras dibujan los cantos del metal',
      en: "Two long strips from behind draw the metal's edges",
    },
    lights: [
      { role: 'KEY', size: 6, sizeY: 0.35, az: -120, el: 35, dist: 3, share: 0.38, spread: 70 },
      { role: 'FILL', size: 6, sizeY: 0.35, az: 120, el: 35, dist: 3, share: 0.34, spread: 70 },
      { role: 'RIM', size: 4, sizeY: 2.5, az: 0, el: 10, dist: 3.4, share: 0.28, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'RAKING', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Rasante', en: 'Raking' },
    intent: {
      es: 'Una tira casi a ras: la trama y el grano se leen',
      en: 'One strip almost flat: weave and grain read',
    },
    lights: [
      { role: 'KEY', size: 4, sizeY: 0.8, az: -85, el: 8, dist: 3, share: 0.9, spread: 60 },
      { role: 'FILL', size: 4, sizeY: 3, az: 60, el: 30, dist: 3.6, share: 0.1, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'BACKLIT', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Campo claro', en: 'Bright field' },
    intent: {
      es: 'Un panel luminoso detras, visible a camara: vidrio y perfume',
      en: 'A luminous panel behind, seen by the camera: glass and fragrance',
    },
    lights: [
      { role: 'RIM', size: 6, sizeY: 6, az: 180, el: 12, dist: 3.2, share: 0.74, spread: 180,
        camera: true },
      { role: 'KEY', size: 4, sizeY: 0.3, az: -85, el: 20, dist: 2.4, share: 0.13, spread: 80 },
      { role: 'FILL', size: 4, sizeY: 0.3, az: 85, el: 20, dist: 2.4, share: 0.13, spread: 80 },
    ],
  },
  {
    key: 'DARK_FIELD', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Campo oscuro', en: 'Dark field' },
    intent: {
      es: 'Solo dos tiras por detras: el vidrio se dibuja en blanco sobre negro',
      en: 'Just two strips from behind: glass draws white on black',
    },
    lights: [
      { role: 'KEY', size: 5, sizeY: 0.3, az: -125, el: 15, dist: 2.6, share: 0.5, spread: 60 },
      { role: 'FILL', size: 5, sizeY: 0.3, az: 125, el: 15, dist: 2.6, share: 0.5, spread: 60 },
    ],
  },
  {
    key: 'GRADIENT_SWEEP', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Barrido degradado', en: 'Gradient sweep' },
    intent: {
      es: 'Una tira enorme arriba y atras: el reflejo degradado del catalogo',
      en: 'One huge strip above and behind: the catalogue gradient reflection',
    },
    lights: [
      { role: 'TOP', size: 7, sizeY: 3, az: 165, el: 65, dist: 3, share: 0.7, spread: 180 },
      { role: 'FILL', size: 4, sizeY: 3, az: 0, el: 15, dist: 3.4, share: 0.3, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'CATALOG_FLAT', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Catalogo plano', en: 'Flat catalogue' },
    intent: {
      es: 'Parejo y sin dramatismo: el arte de la caja se lee sin sombras',
      en: 'Even and undramatic: the artwork reads without shadows',
    },
    lights: [
      { role: 'KEY', size: 5, sizeY: 4, az: -40, el: 35, dist: 3.2, share: 0.4, spread: 180,
        glossy: false },
      { role: 'FILL', size: 5, sizeY: 4, az: 40, el: 35, dist: 3.2, share: 0.4, spread: 180,
        glossy: false },
      { role: 'TOP', size: 5, sizeY: 5, az: 0, el: 80, dist: 3, share: 0.2, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'TWIN_SOFTBOX', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Dos softbox', en: 'Twin softboxes' },
    intent: {
      es: 'El plato de producto de toda la vida: dos cajas a 45 grados',
      en: 'The everyday product table: two boxes at 45 degrees',
    },
    lights: [
      { role: 'KEY', size: 3.5, sizeY: 3.5, az: -45, el: 40, dist: 3, share: 0.55, spread: 150 },
      { role: 'FILL', size: 3.5, sizeY: 3.5, az: 45, el: 40, dist: 3, share: 0.45, spread: 150 },
    ],
  },
  {
    key: 'LONG_STRIP', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Tira larga superior', en: 'Long overhead strip' },
    intent: {
      es: 'Una tira larga arriba deja un solo reflejo limpio a lo largo de la pieza',
      en: 'One long strip above leaves a single clean highlight along the part',
    },
    lights: [
      { role: 'TOP', size: 8, sizeY: 0.6, az: 0, el: 75, dist: 2.8, share: 0.8, spread: 120 },
      { role: 'FILL', size: 4, sizeY: 3, az: 0, el: 10, dist: 3.4, share: 0.2, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'LOW_TENT', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Carpa baja', en: 'Low tent' },
    intent: {
      es: 'Envolvente a ras de mesa: piedras y engastes sin brillos sucios',
      en: 'Wrap-around at table height: stones and settings without dirty glints',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 3, az: -60, el: 15, dist: 2.6, share: 0.26, spread: 180 },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 15, dist: 2.6, share: 0.26, spread: 180 },
      { role: 'RIM', size: 3, sizeY: 3, az: 180, el: 15, dist: 2.6, share: 0.22, spread: 180 },
      { role: 'TOP', size: 3, sizeY: 3, az: 0, el: 75, dist: 2.6, share: 0.26, spread: 180 },
    ],
  },
  {
    key: 'FLOATING', style: 'PRODUCT', world: 'STUDIO',
    label: { es: 'Flotante', en: 'Floating' },
    intent: {
      es: 'Luz cenital y relleno desde abajo: la pieza parece sin apoyo',
      en: 'Top light and fill from below: the part looks unsupported',
    },
    lights: [
      { role: 'TOP', size: 5, sizeY: 5, az: 0, el: 85, dist: 2.8, share: 0.6, spread: 180 },
      { role: 'FILL', size: 6, sizeY: 2, az: 0, el: 5, dist: 3, share: 0.4, spread: 180,
        glossy: false },
    ],
  },

  // Traditional
  {
    key: 'KEY_ONLY', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Solo principal', en: 'Key only' },
    intent: {
      es: 'Una sola fuente grande: una sombra, un brillo',
      en: 'One large source: one shadow, one highlight',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 2.2, az: -45, el: 35, dist: 3, share: 1, spread: 120 },
    ],
  },
  {
    key: 'KEY_RIM', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Principal y contra', en: 'Key and rim' },
    intent: {
      es: 'La principal calida y un contra frio por detras separan la pieza del fondo',
      en: 'A warm key and a cool rim from behind lift the part off the background',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 2.2, az: -45, el: 35, dist: 3, share: 0.7, spread: 120,
        kelvin: 5200 },
      { role: 'RIM', size: 2, sizeY: 0.4, az: 140, el: 35, dist: 2.8, share: 0.3, spread: 60,
        kelvin: 7500 },
    ],
  },
  {
    key: 'THREE_POINT', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Tres puntos', en: 'Three-point' },
    intent: {
      es: 'Principal, relleno y contra: el esquema de manual',
      en: 'Key, fill and rim: the textbook scheme',
    },
    lights: [
      { role: 'KEY', size: 2.5, sizeY: 1.8, az: -45, el: 35, dist: 3, share: 0.6, spread: 120 },
      { role: 'FILL', size: 3.5, sizeY: 3.5, az: 50, el: 15, dist: 3.5, share: 0.2, spread: 180,
        glossy: false },
      { role: 'RIM', size: 2, sizeY: 0.4, az: -150, el: 40, dist: 3, share: 0.2, spread: 60 },
    ],
  },
  {
    key: 'SPLIT', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Dos laterales', en: 'Split lighting' },
    intent: {
      es: 'Dos tiras simetricas a 90 grados: la pieza partida en luz y sombra',
      en: 'Two symmetric strips at 90 degrees: the part split into light and shade',
    },
    lights: [
      { role: 'KEY', size: 1, sizeY: 3, az: -90, el: 20, dist: 3, share: 0.55, spread: 90 },
      { role: 'FILL', size: 1, sizeY: 3, az: 90, el: 20, dist: 3, share: 0.45, spread: 90 },
    ],
  },
  {
    key: 'REMBRANDT', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Rembrandt', en: 'Rembrandt' },
    intent: {
      es: 'Principal alta y lateral, relleno minimo: el triangulo de luz clasico',
      en: 'High side key, minimal fill: the classic triangle of light',
    },
    lights: [
      { role: 'KEY', size: 2, sizeY: 2, az: -55, el: 45, dist: 2.8, share: 0.85, spread: 110 },
      { role: 'FILL', size: 4, sizeY: 4, az: 60, el: 10, dist: 3.6, share: 0.15, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'LOOP', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Lazo', en: 'Loop' },
    intent: {
      es: 'Principal a 35 grados y algo alta: la sombra dibuja un lazo corto',
      en: 'Key at 35 degrees and slightly high: the shadow draws a short loop',
    },
    lights: [
      { role: 'KEY', size: 2.5, sizeY: 2.5, az: -35, el: 30, dist: 3, share: 0.75, spread: 120 },
      { role: 'FILL', size: 4, sizeY: 4, az: 45, el: 10, dist: 3.6, share: 0.25, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'BUTTERFLY', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Frontal alto', en: 'Butterfly' },
    intent: {
      es: 'Plato de belleza en el eje y un reflector bajo: simetrico y limpio',
      en: 'Beauty dish on axis and a low reflector: symmetric and clean',
    },
    lights: [
      { role: 'KEY', shape: 'DISK', size: 3, sizeY: 3, az: 0, el: 50, dist: 2.8, share: 0.7,
        spread: 90 },
      { role: 'FILL', size: 5, sizeY: 1, az: 0, el: 5, dist: 2.6, share: 0.3, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'CLAMSHELL', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Concha', en: 'Clamshell' },
    intent: {
      es: 'Dos cajas en el eje, una arriba y otra abajo, que se cierran sobre la pieza',
      en: 'Two boxes on axis, one above and one below, closing on the part',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 3, az: 0, el: 45, dist: 2.8, share: 0.6, spread: 150 },
      { role: 'FILL', size: 3, sizeY: 3, az: 0, el: 5, dist: 2.8, share: 0.4, spread: 150 },
    ],
  },
  {
    key: 'TOP', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Cenital', en: 'Overhead' },
    intent: {
      es: 'Un octabox justo encima y un relleno frontal bajo',
      en: 'One octabox right above and a low front fill',
    },
    lights: [
      { role: 'TOP', shape: 'DISK', size: 5, sizeY: 5, az: 0, el: 85, dist: 2.8, share: 0.78,
        spread: 180 },
      { role: 'FILL', size: 4, sizeY: 3, az: 0, el: 10, dist: 3.4, share: 0.22, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'RING', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Anillo', en: 'Ring' },
    intent: {
      es: 'Un disco en el eje de camara: sombra pegada al contorno, brillo circular',
      en: 'A disk on the camera axis: shadow hugging the outline, circular highlight',
    },
    lights: [
      { role: 'KEY', shape: 'DISK', size: 1.4, sizeY: 1.4, az: 0, el: 22, dist: 4.5, share: 1,
        spread: 180 },
    ],
  },
  {
    key: 'BROAD', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Lado ancho', en: 'Broad side' },
    intent: {
      es: 'La principal cae sobre la cara que mira a camara',
      en: 'The key falls on the face that looks at the camera',
    },
    lights: [
      { role: 'KEY', size: 2.5, sizeY: 2.5, az: 50, el: 30, dist: 3, share: 0.8, spread: 120 },
      { role: 'FILL', size: 4, sizeY: 4, az: -60, el: 10, dist: 3.6, share: 0.2, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'SHORT', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Lado corto', en: 'Short side' },
    intent: {
      es: 'La principal viene de detras de la pieza y deja lo que mira a camara en sombra',
      en: 'The key comes from behind the part and leaves the camera side in shade',
    },
    lights: [
      { role: 'KEY', size: 2.5, sizeY: 2.5, az: -110, el: 30, dist: 3, share: 0.8, spread: 120 },
      { role: 'FILL', size: 4, sizeY: 4, az: 40, el: 10, dist: 3.6, share: 0.2, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'WINDOW', style: 'TRADITIONAL', world: 'STUDIO',
    label: { es: 'Ventana', en: 'Window light' },
    intent: {
      es: 'Una ventana enorme a un lado y una cartulina blanca al otro',
      en: 'A huge window on one side and a white card on the other',
    },
    lights: [
      { role: 'KEY', size: 6, sizeY: 6, az: -70, el: 25, dist: 3.5, share: 0.88, spread: 180,
        kelvin: 5200 },
      { role: 'FILL', size: 4, sizeY: 4, az: 80, el: 10, dist: 3, share: 0.12, spread: 180,
        glossy: false },
    ],
  },

  // Cinematic
  {
    key: 'SUN', style: 'CINEMATIC', world: 'SKY',
    label: { es: 'Sol y cielo', en: 'Sun and sky' },
    intent: {
      es: 'Un sol de verdad y el relleno azul del cielo',
      en: "A real sun and the sky's blue fill",
    },
    lights: [
      { role: 'KEY', type: 'SUN', size: 0.4, sizeY: 0.4, az: -55, el: 55, dist: 5, share: 1,
        angle: 0.545, kelvin: 5200 },
    ],
  },
  {
    key: 'GOLDEN_HOUR', style: 'CINEMATIC', world: 'SKY',
    label: { es: 'Hora dorada', en: 'Golden hour' },
    intent: {
      es: 'Sol bajo y ambar por detras, cielo que rellena en azul',
      en: 'Low amber sun from behind, sky filling in blue',
    },
    lights: [
      { role: 'KEY', type: 'SUN', size: 0.4, sizeY: 0.4, az: -120, el: 12, dist: 5, share: 1,
        angle: 0.545, kelvin: 2900 },
    ],
  },
  {
    key: 'DAWN', style: 'CINEMATIC', world: 'SKY',
    label: { es: 'Amanecer', en: 'Dawn' },
    intent: {
      es: 'Sol recien salido, rasante y palido, con el cielo aun frio',
      en: 'Sun just up, grazing and pale, with the sky still cold',
    },
    lights: [
      { role: 'KEY', type: 'SUN', size: 0.4, sizeY: 0.4, az: 110, el: 8, dist: 5, share: 1,
        angle: 0.545, kelvin: 3600 },
    ],
  },
  {
    key: 'LOW_KEY', style: 'CINEMATIC', world: 'STUDIO',
    label: { es: 'Clave baja', en: 'Low key' },
    intent: {
      es: 'Principal estrecha con panal y un contra: casi todo en sombra',
      en: 'A narrow gridded key and a rim: almost everything in shadow',
    },
    lights: [
      { role: 'KEY', size: 1.5, sizeY: 1.5, az: -60, el: 30, dist: 3, share: 0.8, spread: 50 },
      { role: 'RIM', size: 2, sizeY: 0.4, az: 150, el: 35, dist: 2.8, share: 0.2, spread: 60 },
    ],
  },
  {
    key: 'CHIAROSCURO', style: 'CINEMATIC', world: 'STUDIO',
    label: { es: 'Claroscuro', en: 'Chiaroscuro' },
    intent: {
      es: 'Una sola fuente pequena y dura, alta y lateral: sombra negra',
      en: 'One small hard source, high and lateral: black shadow',
    },
    lights: [
      { role: 'KEY', size: 0.6, sizeY: 0.6, az: -70, el: 50, dist: 3.2, share: 1, spread: 40 },
    ],
  },
  {
    key: 'MOONLIGHT', style: 'CINEMATIC', world: 'STUDIO',
    label: { es: 'Luz de luna', en: 'Moonlight' },
    intent: {
      es: 'Una fuente dura y azulada desde arriba, relleno frio casi nulo',
      en: 'A hard bluish source from above, near-zero cold fill',
    },
    lights: [
      { role: 'KEY', size: 0.6, sizeY: 0.6, az: -40, el: 60, dist: 3.5, share: 0.85, spread: 60,
        kelvin: 8500 },
      { role: 'FILL', size: 5, sizeY: 5, az: 90, el: 10, dist: 3.6, share: 0.15, spread: 180,
        kelvin: 10000, glossy: false },
    ],
  },
  {
    key: 'SODIUM', style: 'CINEMATIC', world: 'STUDIO',
    label: { es: 'Farola de sodio', en: 'Sodium street lamp' },
    intent: {
      es: 'Naranja de farola desde arriba y un azul de noche por abajo',
      en: 'Street-lamp orange from above and a night blue from below',
    },
    lights: [
      { role: 'TOP', size: 1, sizeY: 1, az: 20, el: 70, dist: 3, share: 0.8, spread: 90,
        color: [1, 0.55, 0.15] },
      { role: 'FILL', size: 5, sizeY: 5, az: -90, el: 10, dist: 3.4, share: 0.2, spread: 180,
        color: [0.25, 0.35, 0.65], glossy: false },
    ],
  },
  {
    key: 'NEON_NOIR', style: 'CINEMATIC', world: 'STUDIO',
    label: { es: 'Neon nocturno', en: 'Neon noir' },
    intent: {
      es: 'Magenta a un lado, cian al otro, nada delante',
      en: 'Magenta on one side, cyan on the other, nothing in front',
    },
    lights: [
      { role: 'KEY', size: 6, sizeY: 0.4, az: -95, el: 20, dist: 2.8, share: 0.5, spread: 90,
        color: [1, 0.2, 0.6] },
      { role: 'FILL', size: 6, sizeY: 0.4, az: 95, el: 20, dist: 2.8, share: 0.5, spread: 90,
        color: [0.1, 0.8, 1] },
    ],
  },
  {
    key: 'SILHOUETTE', style: 'CINEMATIC', world: 'STUDIO',
    label: { es: 'Silueta', en: 'Silhouette' },
    intent: {
      es: 'Panel brillante detras y ninguna luz delante: solo el contorno',
      en: 'Bright panel behind and no light in front: outline only',
    },
    lights: [
      { role: 'RIM', size: 6, sizeY: 6, az: 180, el: 15, dist: 3, share: 0.96, spread: 180,
        camera: true },
      { role: 'FILL', size: 4, sizeY: 4, az: 0, el: 15, dist: 3.6, share: 0.04, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'TEAL_ORANGE', style: 'CINEMATIC', world: 'STUDIO',
    label: { es: 'Calido y frio', en: 'Teal and orange' },
    intent: {
      es: 'Principal calida y contra verdeazul: el contraste de color del cine',
      en: "Warm key and teal rim: cinema's colour contrast",
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 2.2, az: -45, el: 35, dist: 3, share: 0.62, spread: 120,
        kelvin: 3200 },
      { role: 'RIM', size: 2.5, sizeY: 0.5, az: 140, el: 40, dist: 2.8, share: 0.38, spread: 60,
        color: [0.2, 0.75, 0.8] },
    ],
  },
  {
    key: 'PROJECTOR', style: 'CINEMATIC', world: 'STUDIO',
    label: { es: 'Haz de proyector', en: 'Projector beam' },
    intent: {
      es: 'Un haz duro y estrecho desde la camara: la pieza contra la oscuridad',
      en: 'A hard narrow beam from the camera: the part against the dark',
    },
    lights: [
      { role: 'KEY', size: 0.5, sizeY: 0.5, az: 5, el: 15, dist: 4, share: 1, spread: 25 },
    ],
  },

  // Creative
  {
    key: 'COLOR_DUO', style: 'CREATIVE', world: 'STUDIO',
    label: { es: 'Duo de color', en: 'Colour duo' },
    intent: {
      es: 'Rosa a la izquierda, azul a la derecha',
      en: 'Pink on the left, blue on the right',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 3, az: -60, el: 25, dist: 3, share: 0.5, spread: 150,
        color: [1, 0.4, 0.6] },
      { role: 'FILL', size: 3, sizeY: 3, az: 60, el: 25, dist: 3, share: 0.5, spread: 150,
        color: [0.3, 0.5, 1] },
    ],
  },
  {
    key: 'ACID', style: 'CREATIVE', world: 'STUDIO',
    label: { es: 'Acido', en: 'Acid' },
    intent: {
      es: 'Verde lima de principal y magenta de contra',
      en: 'Lime green key and magenta rim',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 2.2, az: -35, el: 40, dist: 3, share: 0.65, spread: 120,
        color: [0.55, 1, 0.25] },
      { role: 'RIM', size: 2.5, sizeY: 0.5, az: 145, el: 35, dist: 2.8, share: 0.35, spread: 60,
        color: [1, 0.15, 0.7] },
    ],
  },
  {
    key: 'COPPER_GLOW', style: 'CREATIVE', world: 'STUDIO',
    label: { es: 'Brillo cobrizo', en: 'Copper glow' },
    intent: {
      es: 'Naranja profundo desde arriba y rebote calido desde la mesa',
      en: 'Deep orange from above and warm bounce from the table',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 3, az: 40, el: 40, dist: 3, share: 0.7, spread: 150,
        color: [1, 0.5, 0.2] },
      { role: 'FILL', size: 5, sizeY: 2, az: 0, el: 5, dist: 3, share: 0.3, spread: 180,
        color: [1, 0.7, 0.45], glossy: false },
    ],
  },
  {
    key: 'FROST', style: 'CREATIVE', world: 'STUDIO',
    label: { es: 'Escarcha', en: 'Frost' },
    intent: {
      es: 'Todo frio: cenital azulado y laterales palidos',
      en: 'All cold: bluish top light and pale sides',
    },
    lights: [
      { role: 'TOP', size: 5, sizeY: 5, az: 0, el: 80, dist: 2.8, share: 0.5, spread: 180,
        kelvin: 10000 },
      { role: 'KEY', size: 3, sizeY: 3, az: -70, el: 20, dist: 3, share: 0.25, spread: 150,
        color: [0.75, 0.85, 1] },
      { role: 'FILL', size: 3, sizeY: 3, az: 70, el: 20, dist: 3, share: 0.25, spread: 150,
        color: [0.75, 0.85, 1] },
    ],
  },
  {
    key: 'PURPLE_POINT', style: 'CREATIVE', world: 'STUDIO',
    label: { es: 'Punto purpura', en: 'Purple point' },
    intent: {
      es: 'Principal neutra y un contra purpura, duro y alto',
      en: 'Neutral key and a hard high purple rim',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 2.2, az: -45, el: 35, dist: 3, share: 0.7, spread: 120 },
      { role: 'RIM', size: 0.5, sizeY: 0.5, az: 160, el: 60, dist: 3, share: 0.3, spread: 60,
        color: [0.6, 0.2, 1] },
    ],
  },
  {
    key: 'WHITE_SLICE', style: 'CREATIVE', world: 'STUDIO',
    label: { es: 'Corte blanco', en: 'White slice' },
    intent: {
      es: 'Una tira finisima y vertical deja una linea de luz en el metal',
      en: 'A very thin vertical strip leaves a line of light on the metal',
    },
    lights: [
      { role: 'KEY', size: 0.15, sizeY: 6, az: -80, el: 20, dist: 2.8, share: 0.85, spread: 30 },
      { role: 'FILL', size: 4, sizeY: 4, az: 60, el: 15, dist: 3.6, share: 0.15, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'BLUE_TUNNEL', style: 'CREATIVE', world: 'STUDIO',
    label: { es: 'Tunel azul', en: 'Blue tunnel' },
    intent: {
      es: 'Dos tiras azules arriba, delante y detras, y un frontal tenue',
      en: 'Two blue strips above, front and back, and a faint front light',
    },
    lights: [
      { role: 'TOP', size: 6, sizeY: 0.6, az: 0, el: 78, dist: 2.8, share: 0.4, spread: 120,
        color: [0.3, 0.55, 1] },
      { role: 'RIM', size: 6, sizeY: 0.6, az: 180, el: 78, dist: 2.8, share: 0.4, spread: 120,
        color: [0.3, 0.55, 1] },
      { role: 'FILL', size: 3, sizeY: 3, az: 0, el: 15, dist: 3.6, share: 0.2, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'WARM_RIM', style: 'CREATIVE', world: 'STUDIO',
    label: { es: 'Contra calido', en: 'Warm rim' },
    intent: {
      es: 'Principal suave y neutra, y un contra grande de tungsteno por detras',
      en: 'Soft neutral key and a big tungsten rim from behind',
    },
    lights: [
      { role: 'KEY', size: 3.5, sizeY: 3.5, az: -40, el: 30, dist: 3, share: 0.55, spread: 150 },
      { role: 'RIM', size: 4, sizeY: 1.5, az: 160, el: 30, dist: 2.8, share: 0.45, spread: 90,
        kelvin: 2400 },
    ],
  },

  // Emotional
  {
    key: 'CALM', style: 'EMOTIONAL', world: 'STUDIO',
    label: { es: 'Calma', en: 'Calm' },
    intent: {
      es: 'Envolvente, tibia y sin contraste: nada llama la atencion',
      en: 'Wrap-around, mild and low-contrast: nothing shouts',
    },
    lights: [
      { role: 'KEY', size: 4, sizeY: 4, az: -40, el: 30, dist: 3, share: 0.35, spread: 180,
        kelvin: 5000, glossy: false },
      { role: 'FILL', size: 4, sizeY: 4, az: 40, el: 30, dist: 3, share: 0.35, spread: 180,
        kelvin: 5000, glossy: false },
      { role: 'TOP', size: 5, sizeY: 5, az: 0, el: 80, dist: 2.8, share: 0.3, spread: 180,
        kelvin: 5000, glossy: false },
    ],
  },
  {
    key: 'STRENGTH', style: 'EMOTIONAL', world: 'STUDIO',
    label: { es: 'Fuerza', en: 'Strength' },
    intent: {
      es: 'Luz dura y baja desde el lado, sombra profunda, contra afilado',
      en: 'Hard low light from the side, deep shadow, sharp rim',
    },
    lights: [
      { role: 'KEY', size: 1, sizeY: 1, az: -90, el: 15, dist: 3, share: 0.75, spread: 70 },
      { role: 'RIM', size: 1.5, sizeY: 0.3, az: 150, el: 40, dist: 2.8, share: 0.25, spread: 50 },
    ],
  },
  {
    key: 'INNOCENCE', style: 'EMOTIONAL', world: 'STUDIO',
    label: { es: 'Inocencia', en: 'Innocence' },
    intent: {
      es: 'Clave alta, blanco sobre blanco, con un relleno rosado',
      en: 'High key, white on white, with a pinkish fill',
    },
    lights: [
      { role: 'KEY', size: 5, sizeY: 4, az: -35, el: 40, dist: 3, share: 0.45, spread: 180,
        glossy: false },
      { role: 'FILL', size: 5, sizeY: 4, az: 45, el: 25, dist: 3, share: 0.35, spread: 180,
        color: [1, 0.85, 0.9], glossy: false },
      { role: 'TOP', size: 5, sizeY: 5, az: 0, el: 80, dist: 2.8, share: 0.2, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'WARMTH', style: 'EMOTIONAL', world: 'STUDIO',
    label: { es: 'Carino', en: 'Warmth' },
    intent: {
      es: 'Todo calido y envolvente, con un contra rosado',
      en: 'All warm and wrap-around, with a pinkish rim',
    },
    lights: [
      { role: 'KEY', size: 4, sizeY: 4, az: -45, el: 30, dist: 3, share: 0.45, spread: 180,
        kelvin: 3000 },
      { role: 'FILL', size: 4, sizeY: 4, az: 45, el: 25, dist: 3, share: 0.35, spread: 180,
        kelvin: 3200, glossy: false },
      { role: 'RIM', size: 2.5, sizeY: 0.5, az: 160, el: 35, dist: 2.8, share: 0.2, spread: 70,
        color: [1, 0.6, 0.7] },
    ],
  },
  {
    key: 'UNEASE', style: 'EMOTIONAL', world: 'STUDIO',
    label: { es: 'Inquietud', en: 'Unease' },
    intent: {
      es: 'Luz desde abajo, dura y algo verde: la que nadie espera',
      en: 'Light from below, hard and slightly green: the one nobody expects',
    },
    lights: [
      { role: 'KEY', size: 1, sizeY: 1, az: 0, el: 5, dist: 3, share: 0.85, spread: 80,
        color: [0.75, 1, 0.75] },
      { role: 'RIM', size: 2, sizeY: 0.4, az: 170, el: 60, dist: 3, share: 0.15, spread: 60 },
    ],
  },
  {
    key: 'MELANCHOLY', style: 'EMOTIONAL', world: 'STUDIO',
    label: { es: 'Melancolia', en: 'Melancholy' },
    intent: {
      es: 'Cenital fria y tenue, relleno minimo, sombras largas',
      en: 'Cold dim top light, minimal fill, long shadows',
    },
    lights: [
      { role: 'TOP', size: 2.5, sizeY: 2.5, az: 30, el: 75, dist: 3, share: 0.8, spread: 110,
        kelvin: 7500 },
      { role: 'FILL', size: 5, sizeY: 5, az: -80, el: 10, dist: 3.6, share: 0.2, spread: 180,
        kelvin: 7500, glossy: false },
    ],
  },
  {
    key: 'ANGER', style: 'EMOTIONAL', world: 'STUDIO',
    label: { es: 'Ira', en: 'Anger' },
    intent: {
      es: 'Rojo duro de principal y rojo de contra, nada mas',
      en: 'Hard red key and red rim, nothing else',
    },
    lights: [
      { role: 'KEY', size: 1, sizeY: 1, az: -50, el: 40, dist: 3, share: 0.7, spread: 70,
        color: [1, 0.15, 0.1] },
      { role: 'RIM', size: 2, sizeY: 0.4, az: 150, el: 35, dist: 2.8, share: 0.3, spread: 60,
        color: [1, 0.3, 0.2] },
    ],
  },
  {
    key: 'HOPE', style: 'EMOTIONAL', world: 'STUDIO',
    label: { es: 'Esperanza', en: 'Hope' },
    intent: {
      es: 'Un sol calido por detras y arriba, y un relleno frio y suave delante',
      en: 'A warm sun from behind and above, and a soft cool fill in front',
    },
    lights: [
      { role: 'RIM', size: 1.2, sizeY: 1.2, az: 165, el: 65, dist: 3.2, share: 0.65, spread: 90,
        kelvin: 3000 },
      { role: 'FILL', size: 5, sizeY: 5, az: 0, el: 20, dist: 3.6, share: 0.35, spread: 180,
        kelvin: 7000, glossy: false },
    ],
  },

  // Experimental
  {
    key: 'LIGHT_GRID', style: 'EXPERIMENTAL', world: 'STUDIO',
    label: { es: 'Rejilla de luz', en: 'Light grid' },
    intent: {
      es: 'Cuatro cuadrados pequenos arriba: una rejilla de reflejos',
      en: 'Four small squares above: a grid of reflections',
    },
    lights: [
      { role: 'TOP', shape: 'SQUARE', size: 0.8, sizeY: 0.8, az: -35, el: 70, dist: 2.8,
        share: 0.25 },
      { role: 'TOP', shape: 'SQUARE', size: 0.8, sizeY: 0.8, az: 35, el: 70, dist: 2.8,
        share: 0.25 },
      { role: 'FILL', shape: 'SQUARE', size: 0.8, sizeY: 0.8, az: -145, el: 70, dist: 2.8,
        share: 0.25 },
      { role: 'RIM', shape: 'SQUARE', size: 0.8, sizeY: 0.8, az: 145, el: 70, dist: 2.8,
        share: 0.25 },
    ],
  },
  {
    key: 'STRIPES', style: 'EXPERIMENTAL', world: 'STUDIO',
    label: { es: 'Rayas', en: 'Stripes' },
    intent: {
      es: 'Tres tiras finas y paralelas arriba: rayas de luz en lo brillante',
      en: 'Three thin parallel strips above: stripes of light on the glossy',
    },
    lights: [
      { role: 'TOP', size: 6, sizeY: 0.2, az: 0, el: 55, dist: 2.8, share: 0.34, spread: 120 },
      { role: 'TOP', size: 6, sizeY: 0.2, az: 0, el: 70, dist: 2.8, share: 0.33, spread: 120 },
      { role: 'RIM', size: 6, sizeY: 0.2, az: 0, el: 85, dist: 2.8, share: 0.33, spread: 120 },
    ],
  },
  {
    key: 'HIGH_RING', style: 'EXPERIMENTAL', world: 'STUDIO',
    label: { es: 'Corona', en: 'Crown' },
    intent: {
      es: 'Tres discos altos alrededor: brillos en corona',
      en: 'Three high disks around: a crown of highlights',
    },
    lights: [
      { role: 'KEY', shape: 'DISK', size: 1.5, sizeY: 1.5, az: 0, el: 65, dist: 3, share: 0.34 },
      { role: 'FILL', shape: 'DISK', size: 1.5, sizeY: 1.5, az: 120, el: 65, dist: 3, share: 0.33 },
      { role: 'RIM', shape: 'DISK', size: 1.5, sizeY: 1.5, az: -120, el: 65, dist: 3, share: 0.33 },
    ],
  },
  {
    key: 'SINGLE_POINT', style: 'EXPERIMENTAL', world: 'STUDIO',
    label: { es: 'Un solo punto duro', en: 'Single hard point' },
    intent: {
      es: 'Una fuente diminuta: sombras de cuchillo y brillos de alfiler',
      en: 'A tiny source: knife-edge shadows and pin highlights',
    },
    lights: [
      { role: 'KEY', size: 0.15, sizeY: 0.15, az: -40, el: 50, dist: 3, share: 1, spread: 180 },
    ],
  },
  {
    key: 'UPLIGHT', style: 'EXPERIMENTAL', world: 'STUDIO',
    label: { es: 'Contrapicado monumental', en: 'Monumental uplight' },
    intent: {
      es: 'Una caja grande y calida a ras de suelo, delante',
      en: 'A big warm box at floor level, in front',
    },
    lights: [
      { role: 'KEY', size: 5, sizeY: 2, az: 0, el: 6, dist: 3, share: 0.85, spread: 150,
        kelvin: 3400 },
      { role: 'RIM', size: 2, sizeY: 0.4, az: 180, el: 60, dist: 3, share: 0.15, spread: 60 },
    ],
  },
  {
    key: 'MIRROR_SIDES', style: 'EXPERIMENTAL', world: 'STUDIO',
    label: { es: 'Espejos laterales', en: 'Mirror sides' },
    intent: {
      es: 'Dos paneles enormes a los lados, solo para los reflejos',
      en: 'Two huge panels at the sides, for the reflections only',
    },
    lights: [
      { role: 'KEY', size: 8, sizeY: 8, az: -90, el: 10, dist: 3.2, share: 0.45, spread: 180 },
      { role: 'FILL', size: 8, sizeY: 8, az: 90, el: 10, dist: 3.2, share: 0.45, spread: 180 },
      { role: 'TOP', size: 3, sizeY: 3, az: 0, el: 80, dist: 3, share: 0.1, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'GRAZING_LINE', style: 'EXPERIMENTAL', world: 'STUDIO',
    label: { es: 'Linea rasante', en: 'Grazing line' },
    intent: {
      es: 'Una tira finisima casi tumbada en la mesa: cada grano, una sombra',
      en: 'A very thin strip almost lying on the table: every grain, a shadow',
    },
    lights: [
      { role: 'KEY', size: 8, sizeY: 0.1, az: -90, el: 5, dist: 3, share: 1, spread: 20 },
    ],
  },
  {
    key: 'SCANNER', style: 'EXPERIMENTAL', world: 'STUDIO',
    label: { es: 'Escaner', en: 'Scanner' },
    intent: {
      es: 'Una sola tira estrecha justo encima, y nada mas',
      en: 'A single narrow strip right above, and nothing else',
    },
    lights: [
      { role: 'TOP', size: 6, sizeY: 0.15, az: 0, el: 88, dist: 2.8, share: 1, spread: 90 },
    ],
  },

  // Signature
  {
    key: 'ATELIER', style: 'SIGNATURE', world: 'STUDIO',
    label: { es: 'Atelier', en: 'Atelier' },
    intent: {
      es: 'Ventana norte grande y una cartulina de rebote: luz de taller de pintor',
      en: "Big north window and a bounce card: painter's studio light",
    },
    lights: [
      { role: 'KEY', size: 6, sizeY: 6, az: -80, el: 45, dist: 3.5, share: 0.85, spread: 180,
        kelvin: 5000 },
      { role: 'FILL', size: 4, sizeY: 4, az: 70, el: 5, dist: 3, share: 0.15, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'GALLERY', style: 'SIGNATURE', world: 'STUDIO',
    label: { es: 'Galeria', en: 'Gallery' },
    intent: {
      es: 'Dos focos pequenos en el techo, como en una sala de exposiciones',
      en: 'Two small ceiling spots, like an exhibition room',
    },
    lights: [
      { role: 'KEY', size: 0.5, sizeY: 0.5, az: -30, el: 65, dist: 3.2, share: 0.42, spread: 60,
        kelvin: 3500 },
      { role: 'FILL', size: 0.5, sizeY: 0.5, az: 30, el: 65, dist: 3.2, share: 0.42, spread: 60,
        kelvin: 3500 },
      { role: 'TOP', size: 5, sizeY: 5, az: 0, el: 80, dist: 3, share: 0.16, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'VITRINE', style: 'SIGNATURE', world: 'STUDIO',
    label: { es: 'Vitrina', en: 'Vitrine' },
    intent: {
      es: 'Tira arriba y dos tiras delante, blanco neutro calido: luz de escaparate',
      en: 'Strip above and two strips in front, warm neutral white: shop-window light',
    },
    lights: [
      { role: 'TOP', size: 5, sizeY: 0.5, az: 0, el: 80, dist: 2.8, share: 0.4, spread: 120,
        kelvin: 4000 },
      { role: 'KEY', size: 0.4, sizeY: 4, az: -50, el: 25, dist: 3, share: 0.3, spread: 90,
        kelvin: 4000 },
      { role: 'FILL', size: 0.4, sizeY: 4, az: 50, el: 25, dist: 3, share: 0.3, spread: 90,
        kelvin: 4000 },
    ],
  },
  {
    key: 'LOFT', style: 'SIGNATURE', world: 'STUDIO',
    label: { es: 'Loft', en: 'Loft' },
    intent: {
      es: 'Luz de dia por la ventana y una bombilla calida en la otra punta',
      en: 'Daylight through the window and a warm bulb at the far end',
    },
    lights: [
      { role: 'KEY', size: 5, sizeY: 5, az: -60, el: 30, dist: 3.4, share: 0.7, spread: 180,
        kelvin: 5600 },
      { role: 'FILL', size: 1, sizeY: 1, az: 95, el: 25, dist: 3, share: 0.3, spread: 150,
        kelvin: 2800 },
    ],
  },
  {
    key: 'EDITORIAL', style: 'SIGNATURE', world: 'STUDIO',
    label: { es: 'Editorial', en: 'Editorial' },
    intent: {
      es: 'Plato de belleza en el eje y dos tiras por detras: portada de revista',
      en: 'Beauty dish on axis and two strips from behind: magazine cover',
    },
    lights: [
      { role: 'KEY', shape: 'DISK', size: 1.6, sizeY: 1.6, az: 0, el: 45, dist: 2.8, share: 0.6,
        spread: 100 },
      { role: 'RIM', size: 5, sizeY: 0.4, az: -135, el: 35, dist: 2.8, share: 0.2, spread: 60 },
      { role: 'FILL', size: 5, sizeY: 0.4, az: 135, el: 35, dist: 2.8, share: 0.2, spread: 60 },
    ],
  },
  {
    key: 'MUSEUM', style: 'SIGNATURE', world: 'STUDIO',
    label: { es: 'Museo', en: 'Museum' },
    intent: {
      es: 'Un unico foco pequeno desde arriba, calido, y penumbra alrededor',
      en: 'A single small warm spot from above, and dusk all around',
    },
    lights: [
      { role: 'TOP', size: 0.4, sizeY: 0.4, az: 10, el: 80, dist: 3, share: 0.88, spread: 50,
        kelvin: 3000 },
      { role: 'FILL', size: 5, sizeY: 5, az: 0, el: 15, dist: 3.6, share: 0.12, spread: 180,
        kelvin: 3000, glossy: false },
    ],
  },

  // Spicy
  {
    key: 'MAGENTA_BITE', style: 'SPICY', world: 'STUDIO',
    label: { es: 'Mordisco magenta', en: 'Magenta bite' },
    intent: {
      es: 'Principal neutra y una tira magenta dura, baja y a la derecha',
      en: 'Neutral key and a hard magenta strip, low and to the right',
    },
    lights: [
      { role: 'KEY', size: 3, sizeY: 2.2, az: -45, el: 35, dist: 3, share: 0.7, spread: 120 },
      { role: 'FILL', size: 4, sizeY: 0.3, az: 110, el: 8, dist: 2.8, share: 0.3, spread: 50,
        color: [1, 0.1, 0.6] },
    ],
  },
  {
    key: 'CYBER', style: 'SPICY', world: 'STUDIO',
    label: { es: 'Ciber', en: 'Cyber' },
    intent: {
      es: 'Cian y magenta partidos por la mitad, sin nada neutro',
      en: 'Cyan and magenta split down the middle, nothing neutral',
    },
    lights: [
      { role: 'KEY', size: 1, sizeY: 3, az: -90, el: 25, dist: 3, share: 0.5, spread: 90,
        color: [0, 0.9, 1] },
      { role: 'FILL', size: 1, sizeY: 3, az: 90, el: 25, dist: 3, share: 0.5, spread: 90,
        color: [1, 0.1, 0.7] },
    ],
  },
  {
    key: 'LAVA', style: 'SPICY', world: 'STUDIO',
    label: { es: 'Lava', en: 'Lava' },
    intent: {
      es: 'Rojo anaranjado desde abajo y un azul oscuro cenital',
      en: 'Orange-red from below and a dark blue from above',
    },
    lights: [
      { role: 'KEY', size: 5, sizeY: 2, az: 0, el: 5, dist: 3, share: 0.75, spread: 150,
        color: [1, 0.3, 0.05] },
      { role: 'TOP', size: 4, sizeY: 4, az: 0, el: 80, dist: 2.8, share: 0.25, spread: 180,
        color: [0.15, 0.2, 0.6], glossy: false },
    ],
  },
  {
    key: 'POISON', style: 'SPICY', world: 'STUDIO',
    label: { es: 'Veneno', en: 'Poison' },
    intent: { es: 'Principal purpura y contra verde toxico', en: 'Purple key and toxic green rim' },
    lights: [
      { role: 'KEY', size: 3, sizeY: 2.2, az: -45, el: 35, dist: 3, share: 0.6, spread: 120,
        color: [0.55, 0.25, 1] },
      { role: 'RIM', size: 2.5, sizeY: 0.5, az: 150, el: 35, dist: 2.8, share: 0.4, spread: 60,
        color: [0.3, 1, 0.3] },
    ],
  },
  {
    key: 'CANDY', style: 'SPICY', world: 'STUDIO',
    label: { es: 'Caramelo', en: 'Candy' },
    intent: {
      es: 'Rosa pastel de principal, menta de relleno, clave alta',
      en: 'Pastel pink key, mint fill, high key',
    },
    lights: [
      { role: 'KEY', size: 4, sizeY: 4, az: -40, el: 35, dist: 3, share: 0.5, spread: 180,
        color: [1, 0.7, 0.85] },
      { role: 'FILL', size: 4, sizeY: 4, az: 40, el: 25, dist: 3, share: 0.35, spread: 180,
        color: [0.7, 1, 0.85], glossy: false },
      { role: 'TOP', size: 5, sizeY: 5, az: 0, el: 80, dist: 2.8, share: 0.15, spread: 180,
        glossy: false },
    ],
  },
  {
    key: 'ECLIPSE', style: 'SPICY', world: 'STUDIO',
    label: { es: 'Eclipse', en: 'Eclipse' },
    intent: {
      es: 'Un disco brillante justo detras de la pieza, visible a camara, y nada mas',
      en: 'A bright disk right behind the part, seen by the camera, and nothing else',
    },
    lights: [
      { role: 'RIM', shape: 'DISK', size: 1.2, sizeY: 1.2, az: 180, el: 15, dist: 3, share: 0.92,
        spread: 180, camera: true },
      { role: 'FILL', size: 4, sizeY: 4, az: 0, el: 15, dist: 3.6, share: 0.08, spread: 180,
        glossy: false },
    ],
  },
];

export function lightSetup(key: string): LightSetup | undefined {
  return LIGHT_SETUPS.find((s) => s.key === key);
}

/** The setups of a style, in catalogue order. 'ALL' (or no style) returns everything. */
export function setupsInStyle(style?: LightStyle | 'ALL' | null): readonly LightSetup[] {
  if (style === undefined || style === null || style === 'ALL') return LIGHT_SETUPS;
  return LIGHT_SETUPS.filter((s) => s.style === style);
}

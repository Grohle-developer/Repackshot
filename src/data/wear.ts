// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (PolyForm Noncommercial 1.0.0); values are data, the implementation is new.

import type {
  MaterialCategory,
  MaterialFamily,
  RGBA,
  WearLevel,
  WearPatch,
  WearPreset,
  WearProps,
  WearType,
  WearTypeInfo,
} from './types';

// Procedural wear layer (upstream WEAR_*): eight wear types under one master
// amount, each material preset coming out with the physics of its own material.
// Scales are in part sizes (`refSize` is the reference part size), so the same
// scratch looks equally fine on a ring and on a sofa.
//
// Naming: upstream `wear_` prefixes are dropped (`wear_edge_color` is
// `edgeColor`) and `rough_var` is `roughVar`. The intensity of a wear type is
// the WearProps property with the same name as the type.

// The eight types and what each one does (descriptions follow the upstream
// roadmap table for item Q).
export const WEAR_TYPES: readonly WearTypeInfo[] = [
  {
    key: 'edges',
    label: { es: 'Aristas desgastadas', en: 'Worn edges' },
    description: {
      es: 'El sustrato asoma en las aristas convexas, roto por ruido. Toca color, rugosidad y metal',
      en: 'The substrate shows through on convex edges, broken up by noise. Touches colour, roughness and metal',
    },
  },
  {
    key: 'scratches',
    label: { es: 'Aranazos', en: 'Scratches' },
    description: {
      es: 'Curvas de nivel de tres ruidos estirados en tres direcciones, agrupadas por un ruido grande. Toca rugosidad y relieve (surco)',
      en: 'Contour lines of three noises stretched in three directions, clustered by a large noise. Touches roughness and relief (groove)',
    },
  },
  {
    key: 'smudges',
    label: { es: 'Huellas y manchas', en: 'Fingerprints and smudges' },
    description: {
      es: 'Manchas blandas grandes con textura fina dentro. Toca rugosidad y rugosidad del barniz',
      en: 'Large soft blotches with fine texture inside. Touches roughness and clearcoat roughness',
    },
  },
  {
    key: 'dust',
    label: { es: 'Polvo', en: 'Dust' },
    description: {
      es: 'Se posa en las superficies que miran hacia arriba, rota por ruido. Dielectrico: apaga el metal. Toca color, rugosidad, metal y barniz',
      en: 'Settles on upward-facing surfaces, broken up by noise. Dielectric: it turns metal off. Touches colour, roughness, metal and clearcoat',
    },
  },
  {
    key: 'dirt',
    label: { es: 'Suciedad en cavidades', en: 'Dirt in crevices' },
    description: {
      es: 'Oclusion ambiental invertida, rota por ruido: la suciedad se acumula en las cavidades. Toca color (multiplica) y rugosidad',
      en: 'Inverted ambient occlusion, broken up by noise: dirt collects in cavities. Touches colour (multiplies) and roughness',
    },
  },
  {
    key: 'patina',
    label: { es: 'Patina y oxido', en: 'Patina and rust' },
    description: {
      es: 'Mancha grande con borde roto; a mas cantidad, mas superficie. Toca color, rugosidad y metal',
      en: 'Large blotch with a broken edge; the higher the amount, the more surface it covers. Touches colour, roughness and metal',
    },
  },
  {
    key: 'roughVar',
    label: { es: 'Variacion de rugosidad', en: 'Roughness variation' },
    description: {
      es: 'Ruido fino centrado que se suma a la rugosidad. Toca rugosidad',
      en: 'Fine centred noise added to the roughness. Touches roughness',
    },
  },
  {
    key: 'dents',
    label: { es: 'Abolladuras', en: 'Dents' },
    description: {
      es: 'Relieve de baja frecuencia. Toca relieve',
      en: 'Low-frequency relief. Touches relief',
    },
  },
];

// Which wear types make sense for each family. Fabric has no edges to wear
// and no scratches; glass does not dent; emitters take no wear at all.
export const WEAR_FAMILY_TYPES: Readonly<Record<MaterialFamily, ReadonlySet<WearType>>> = {
  SIMPLE: new Set<WearType>(['edges', 'scratches', 'smudges', 'dust', 'dirt', 'patina', 'roughVar', 'dents']),
  GLASS: new Set<WearType>(['scratches', 'smudges', 'dust', 'dirt', 'patina', 'roughVar']),
  WOOD: new Set<WearType>(['edges', 'scratches', 'smudges', 'dust', 'dirt', 'patina', 'roughVar']),
  FABRIC: new Set<WearType>(['dust', 'dirt', 'patina', 'roughVar']),
  EMISSIVE: new Set<WearType>([]),
};

// Default of every property. A material goes back to this table when a preset
// is applied, so it never inherits the wear of the previous material.
export const WEAR_PROP_DEFAULTS: Readonly<WearProps> = {
  // Master control and placement
  amount: 0,
  scale: 1,
  seed: 0,
  perObject: true,
  refSize: 0.2,
  // Worn edges
  edges: 0,
  edgeWidth: 0.008,
  edgeColor: [0.75, 0.75, 0.75, 1],
  edgeRough: 0.3,
  edgeMetal: 0,
  // Scratches
  scratches: 0,
  scratchScale: 1,
  scratchDepth: 0.5,
  // Fingerprints and smudges
  smudges: 0,
  smudgeScale: 1,
  // Dust
  dust: 0,
  dustColor: [0.55, 0.52, 0.48, 1],
  // Dirt in crevices
  dirt: 0,
  dirtColor: [0.28, 0.23, 0.18, 1],
  dirtDistance: 0.06,
  // Patina and rust
  patina: 0,
  patinaColor: [0.3, 0.14, 0.07, 1],
  patinaScale: 1,
  // Roughness variation
  roughVar: 0,
  roughScale: 1,
  // Dents
  dents: 0,
  dentScale: 1,
  // Realism: what makes wear fall where it does on a real part, instead of
  // being spread like a halftone
  preset: '',
  accumInside: 0.5,
  accumOutside: 0.5,
  relief: 1,
  scratchColor: [0.8, 0.8, 0.8, 1],
  colorVar: 0.15,
  colorScale: 1,
};

// Mix of wear types per material category: what a material of that class
// shows in a product photo. Subtle on purpose: it is a new part, not scrap.
// The master amount raises or lowers the whole set.
export const WEAR_CATEGORY_DEFAULTS: Readonly<Record<MaterialCategory, WearPatch>> = {
  METAL: { amount: 0.45, edges: 0.35, scratches: 0.3, smudges: 0.25, dust: 0, dirt: 0.1, patina: 0,
    roughVar: 0.35, dents: 0 },
  PLASTIC: { amount: 0.45, edges: 0.25, scratches: 0.2, smudges: 0.3, dust: 0, dirt: 0.1, patina: 0.05,
    roughVar: 0.3, dents: 0 },
  WOOD: { amount: 0.45, edges: 0.3, scratches: 0.2, smudges: 0.1, dust: 0, dirt: 0.25, patina: 0.1,
    roughVar: 0.35, dents: 0 },
  FABRIC: { amount: 0.45, edges: 0, scratches: 0, smudges: 0, dust: 0.05, dirt: 0.2, patina: 0.08,
    roughVar: 0.25, dents: 0 },
  GLASS: { amount: 0.45, edges: 0, scratches: 0.1, smudges: 0.35, dust: 0.05, dirt: 0.05, patina: 0,
    roughVar: 0.1, dents: 0 },
  EMISSIVE: { amount: 0 },
  OTHER: { amount: 0.45, edges: 0.25, scratches: 0.15, smudges: 0.2, dust: 0, dirt: 0.2, patina: 0.08,
    roughVar: 0.3, dents: 0 },
};

// Patina colour per category: what happens to that material over time.
// Individual presets refine it in WEAR_PRESET_OVERRIDES.
export const WEAR_PATINA_BY_CATEGORY: Readonly<Record<MaterialCategory, RGBA>> = {
  METAL: [0.3, 0.14, 0.07, 1], // rust
  PLASTIC: [0.72, 0.62, 0.4, 1], // UV yellowing
  WOOD: [0.2, 0.12, 0.06, 1], // water stain
  FABRIC: [0.36, 0.29, 0.21, 1], // stain
  GLASS: [0.76, 0.76, 0.72, 1], // limescale
  EMISSIVE: [0.5, 0.5, 0.5, 1],
  OTHER: [0.25, 0.2, 0.15, 1],
};

// Per-preset adjustments on top of the category mix. This is the physics of
// each material: gold does not rust, copper gets verdigris, cast iron lives
// dirty, and studio white is a set piece.
export const WEAR_PRESET_OVERRIDES: Readonly<Record<string, WearPatch>> = {
  CHROME: { edges: 0.05, scratches: 0.12, smudges: 0.35, roughVar: 0.1, patina: 0,
    patinaColor: [0.55, 0.55, 0.57, 1] },
  MIRROR: { edges: 0, scratches: 0.08, smudges: 0.35, roughVar: 0.05, dirt: 0,
    patinaColor: [0.55, 0.55, 0.57, 1] },
  INOX: { patinaColor: [0.55, 0.55, 0.57, 1] },
  TITANIUM: { roughVar: 0.4, patinaColor: [0.55, 0.55, 0.57, 1] },
  ALU_POLISH: { smudges: 0.3, patinaColor: [0.72, 0.72, 0.7, 1] },
  ALU_ANOD: { edges: 0.4, scratches: 0.25, patinaColor: [0.72, 0.72, 0.7, 1] },
  ALU_BRUSH: { scratches: 0.45, patinaColor: [0.72, 0.72, 0.7, 1] },
  STEEL_BRUSH: { scratches: 0.45 },
  GOLD: { patina: 0, edges: 0.25, dirt: 0.05 },
  COPPER: { patina: 0.25, patinaColor: [0.2, 0.46, 0.38, 1] },
  BRASS: { patina: 0.2, patinaColor: [0.28, 0.24, 0.14, 1] },
  ZINC: { patina: 0.15, patinaColor: [0.78, 0.78, 0.76, 1] },
  CAST_IRON: { edges: 0.5, scratches: 0.1, dirt: 0.6, patina: 0.35, roughVar: 0.6, dents: 0.15,
    patinaColor: [0.32, 0.13, 0.06, 1] },
  NYLON_SLS: { roughVar: 0.5, dirt: 0.15, scratches: 0.05 },
  SILICONE: { dust: 0.15, smudges: 0.4, edges: 0 },
  BAKELITE: { edges: 0.35, scratches: 0.3, smudges: 0.3, patina: 0.1 },
  TPU: { edges: 0.1, dust: 0.05, smudges: 0.35 },
  GLASS_FROST: { smudges: 0.15 },
  CONCRETE: { edges: 0.3, dirt: 0.5, dust: 0.2, patina: 0.3, roughVar: 0.5, dents: 0.3,
    patinaColor: [0.14, 0.14, 0.13, 1] },
  LEATHER: { edges: 0.35, smudges: 0.35, dirt: 0.3, patina: 0.15, roughVar: 0.45,
    patinaColor: [0.05, 0.03, 0.02, 1] },
  RUBBER: { edges: 0.15, dust: 0.1, patina: 0.2, roughVar: 0.4, patinaColor: [0.38, 0.38, 0.38, 1] },
  CERAMIC: { edges: 0.1, smudges: 0.15, patina: 0.05, patinaColor: [0.45, 0.4, 0.32, 1] },
  PAPER: { edges: 0.3, dirt: 0.3, patina: 0.2, roughVar: 0.4, scratches: 0,
    patinaColor: [0.55, 0.42, 0.25, 1] },
  CARDBOARD: { edges: 0.35, dirt: 0.3, patina: 0.2, roughVar: 0.4, scratches: 0.05,
    patinaColor: [0.55, 0.42, 0.25, 1] },
  CAR_PAINT: { edges: 0.15, scratches: 0.15, smudges: 0.25, patina: 0 },
  PAINT_MET: { edges: 0.15, scratches: 0.15, smudges: 0.25, patina: 0 },
  WHITE_STUDIO: { amount: 0.1, edges: 0, scratches: 0, smudges: 0, dirt: 0, patina: 0, roughVar: 0.1 },
  CARBON: { smudges: 0.2, roughVar: 0.15, dirt: 0.05 },
  // E9: liquids do not wear (their container does).
  MILK: { amount: 0 },
  JUICE_ORANGE: { amount: 0 },
  JUICE_APPLE: { amount: 0 },
  CREAM: { amount: 0 },
  // L6: the set pieces are new card and clean acrylic: no wear unless asked for.
  CARD_WHITE: { amount: 0 },
  CARD_BLACK: { amount: 0 },
  ACRYLIC_BLACK: { amount: 0 },
  ACRYLIC_WHITE: { amount: 0 },
  MIRROR_BLACK: { amount: 0 },
};

// Painted presets: on the edge the paint chips off and bare metal shows.
export const WEAR_PAINTED: ReadonlySet<string> = new Set(['CAR_PAINT', 'PAINT_MET']);

// Quick buttons of the material editor: they set the master amount only.
export const WEAR_LEVELS: readonly WearLevel[] = [
  { key: 'new', label: { es: 'Nuevo', en: 'New' }, amount: 0 },
  { key: 'used', label: { es: 'Usado', en: 'Used' }, amount: 0.35 },
  { key: 'old', label: { es: 'Viejo', en: 'Old' }, amount: 1 },
];

// One-click basics, for any material. Each sets the master amount and the mix
// of the eight types; colours (substrate, patina, dust, dirt) and scales are
// left alone, because they are the physics of the material and its preset
// already sets them. Types a family does not support are ignored when built.
export const WEAR_PRESETS: readonly WearPreset[] = [
  {
    key: 'CLEAN',
    label: { es: 'Recien fabricado', en: 'Fresh from the factory' },
    props: { amount: 0 },
  },
  {
    key: 'SHOWROOM',
    label: { es: 'Expositor', en: 'Showroom' },
    props: { amount: 0.25, roughVar: 0.3, smudges: 0.2, scratches: 0.1, edges: 0.1, dust: 0, dirt: 0.05,
      patina: 0, dents: 0 },
  },
  {
    key: 'HANDLED',
    label: { es: 'Manoseado', en: 'Handled' },
    props: { amount: 0.6, smudges: 0.9, roughVar: 0.3, scratches: 0.1, edges: 0.05, dust: 0, dirt: 0.1,
      patina: 0, dents: 0 },
  },
  {
    key: 'SCRATCHED',
    label: { es: 'Aranado', en: 'Scratched' },
    props: { amount: 0.7, scratches: 0.9, roughVar: 0.4, edges: 0.3, smudges: 0.2, dust: 0, dirt: 0.1,
      patina: 0, dents: 0 },
  },
  {
    key: 'DUSTY',
    label: { es: 'Polvoriento', en: 'Dusty' },
    props: { amount: 0.7, dust: 0.9, dirt: 0.3, roughVar: 0.3, smudges: 0.1, scratches: 0.05,
      edges: 0.05, patina: 0, dents: 0 },
  },
  {
    key: 'WORKSHOP',
    label: { es: 'Taller', en: 'Workshop' },
    props: { amount: 0.8, dirt: 0.8, scratches: 0.6, edges: 0.6, smudges: 0.4, roughVar: 0.5,
      patina: 0.2, dents: 0.15, dust: 0.2 },
  },
  {
    key: 'OUTDOOR',
    label: { es: 'Intemperie', en: 'Weathered' },
    props: { amount: 0.8, patina: 0.8, dirt: 0.5, roughVar: 0.5, edges: 0.4, dust: 0.3, scratches: 0.2,
      smudges: 0.05, dents: 0.1 },
  },
  {
    key: 'ANTIQUE',
    label: { es: 'Envejecido', en: 'Aged' },
    props: { amount: 1, edges: 0.8, patina: 0.6, dirt: 0.7, scratches: 0.5, dents: 0.3, roughVar: 0.6,
      smudges: 0.3, dust: 0.3 },
  },
  {
    key: 'ALL',
    label: { es: 'Todo a la vez', en: 'Everything at once' },
    props: { amount: 1, edges: 0.7, scratches: 0.7, smudges: 0.7, dust: 0.7, dirt: 0.7, patina: 0.7,
      roughVar: 0.7, dents: 0.7 },
  },
];

export function wearPreset(key: string): WearPreset | undefined {
  return WEAR_PRESETS.find((p) => p.key === key);
}

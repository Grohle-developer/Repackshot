import type { MaterialCategoryEntry, MaterialPreset } from './types';

// Material library: the 77 base presets in their order, grouped by category;
// the five set pieces of L6 (cards, acrylic floors, a black mirror), each in its
// category; and the translucent materials and liquids of phase E9 and its
// dispersive crystal at the end of their category. The family decides which shader
// recipe is built; the params fill in its editable properties. Colours are
// linear RGBA.
//
// E9 recipes: GLASS family with a scattering medium inside (`scatterMm`, the
// mean free path; `scatterColor`, the single-scattering albedo; `scatterG`,
// the Henyey–Greenstein direction). Dense media use the reduced coefficients
// of the similarity relation (σs' = σs (1 - g), g = 0): the same look at a
// fraction of the cost. Milk and cream are the measured reduced scattering and
// absorption of H. W. Jensen et al., "A Practical Model for Subsurface Light
// Transport", SIGGRAPH 2001 (table 2), as one mean free path (their mean σt')
// and an albedo per channel; the others are set by eye on the E9 sheet. E9c's
// crystal has an Abbe number (`abbe`): chromatic dispersion.

export const MATERIAL_CATEGORIES: readonly MaterialCategoryEntry[] = [
  { key: 'METAL', label: { es: 'Metal', en: 'Metal' } },
  { key: 'PLASTIC', label: { es: 'Plastico', en: 'Plastic' } },
  { key: 'WOOD', label: { es: 'Madera', en: 'Wood' } },
  { key: 'FABRIC', label: { es: 'Tela', en: 'Fabric' } },
  { key: 'GLASS', label: { es: 'Vidrio', en: 'Glass' } },
  { key: 'EMISSIVE', label: { es: 'Emisor', en: 'Emissive' } },
  { key: 'OTHER', label: { es: 'Otros', en: 'Other' } },
];

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  // --- Metals ---
  {
    key: 'ALU_ANOD', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Aluminio anodizado', en: 'Anodised aluminium' },
    params: { baseColor: [0.52, 0.54, 0.57, 1], metallic: 1, roughness: 0.35 },
  },
  {
    key: 'ALU_BRUSH', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Aluminio cepillado', en: 'Brushed aluminium' },
    params: { baseColor: [0.56, 0.57, 0.58, 1], metallic: 1, roughness: 0.28, anisotropic: 0.7 },
  },
  {
    key: 'ALU_POLISH', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Aluminio pulido', en: 'Polished aluminium' },
    params: { baseColor: [0.6, 0.61, 0.63, 1], metallic: 1, roughness: 0.08 },
  },
  {
    key: 'INOX', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Acero inoxidable', en: 'Stainless steel' },
    params: { baseColor: [0.62, 0.63, 0.64, 1], metallic: 1, roughness: 0.3 },
  },
  {
    key: 'STEEL_BRUSH', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Acero cepillado', en: 'Brushed steel' },
    params: { baseColor: [0.55, 0.56, 0.57, 1], metallic: 1, roughness: 0.32, anisotropic: 0.8 },
  },
  {
    key: 'CHROME', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Cromo pulido', en: 'Polished chrome' },
    params: { baseColor: [0.85, 0.86, 0.88, 1], metallic: 1, roughness: 0.03 },
  },
  {
    key: 'BRASS', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Laton', en: 'Brass' },
    params: { baseColor: [0.8, 0.6, 0.25, 1], metallic: 1, roughness: 0.25 },
  },
  {
    key: 'COPPER', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Cobre', en: 'Copper' },
    params: { baseColor: [0.72, 0.32, 0.18, 1], metallic: 1, roughness: 0.22 },
  },
  {
    key: 'GOLD', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Oro', en: 'Gold' },
    params: { baseColor: [0.94, 0.72, 0.25, 1], metallic: 1, roughness: 0.15 },
  },
  {
    key: 'TITANIUM', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Titanio', en: 'Titanium' },
    params: { baseColor: [0.48, 0.47, 0.46, 1], metallic: 1, roughness: 0.38 },
  },
  {
    key: 'CAST_IRON', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Fundicion', en: 'Cast iron' },
    params: { baseColor: [0.16, 0.16, 0.17, 1], metallic: 1, roughness: 0.62 },
  },
  {
    key: 'ZINC', category: 'METAL', family: 'SIMPLE',
    label: { es: 'Zincado', en: 'Zinc plated' },
    params: { baseColor: [0.66, 0.67, 0.68, 1], metallic: 1, roughness: 0.42 },
  },

  // --- Plastics ---
  // PC_CLEAR, PMMA and PMMA_TINT belong to this category but use the GLASS family.
  {
    key: 'ABS_MATTE', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'ABS mate', en: 'Matte ABS' },
    params: { baseColor: [0.045, 0.045, 0.05, 1], roughness: 0.55 },
  },
  {
    key: 'ABS_GLOSS', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'ABS brillante', en: 'Gloss ABS' },
    params: { baseColor: [0.045, 0.045, 0.05, 1], roughness: 0.13, coat: 1, coatRoughness: 0.05 },
  },
  {
    key: 'ABS_SATIN', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'ABS satinado', en: 'Satin ABS' },
    params: { baseColor: [0.3, 0.31, 0.33, 1], roughness: 0.32, coat: 0.5, coatRoughness: 0.2 },
  },
  {
    key: 'PP', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'Polipropileno', en: 'Polypropylene' },
    params: { baseColor: [0.7, 0.71, 0.7, 1], roughness: 0.45 },
  },
  {
    key: 'NYLON_SLS', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'Nylon SLS', en: 'SLS nylon' },
    params: { baseColor: [0.78, 0.78, 0.76, 1], roughness: 0.72 },
  },
  {
    key: 'PLA', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'PLA impreso', en: 'Printed PLA' },
    params: { baseColor: [0.25, 0.45, 0.6, 1], roughness: 0.4, coat: 0.3, coatRoughness: 0.25 },
  },
  {
    key: 'PC_CLEAR', category: 'PLASTIC', family: 'GLASS',
    label: { es: 'Policarbonato', en: 'Polycarbonate' },
    params: { baseColor: [0.95, 0.97, 0.98, 1], roughness: 0.05, ior: 1.585, transmission: 1 },
  },
  {
    key: 'PMMA', category: 'PLASTIC', family: 'GLASS',
    label: { es: 'Acrilico', en: 'Acrylic' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0, ior: 1.49, transmission: 1 },
  },
  {
    key: 'PMMA_TINT', category: 'PLASTIC', family: 'GLASS',
    label: { es: 'Acrilico coloreado', en: 'Tinted acrylic' },
    params: { baseColor: [0.55, 0.1, 0.1, 1], roughness: 0.02, ior: 1.49, transmission: 1 },
  },
  {
    key: 'TPU', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'TPU flexible', en: 'Flexible TPU' },
    params: { baseColor: [0.1, 0.1, 0.11, 1], roughness: 0.62 },
  },
  {
    key: 'SILICONE', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'Silicona translucida', en: 'Translucent silicone' },
    params: { baseColor: [0.85, 0.85, 0.83, 1], roughness: 0.45, subsurface: 0.35 },
  },
  {
    key: 'BAKELITE', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'Baquelita', en: 'Bakelite' },
    params: { baseColor: [0.09, 0.05, 0.035, 1], roughness: 0.25, coat: 0.6, coatRoughness: 0.12 },
  },
  {
    key: 'HDPE_WHITE', category: 'PLASTIC', family: 'GLASS',
    label: { es: 'HDPE blanco', en: 'White HDPE' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0.35, ior: 1.54, transmission: 1, absorptionMm: 0,
      scatterMm: 0.08, scatterColor: [0.996, 0.995, 0.99, 1], scatterG: 0 },
  },
  {
    key: 'PP_NATURAL', category: 'PLASTIC', family: 'GLASS',
    label: { es: 'PP natural', en: 'Natural PP' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0.3, ior: 1.49, transmission: 1, absorptionMm: 0,
      scatterMm: 0.6, scatterColor: [0.995, 0.994, 0.988, 1], scatterG: 0 },
  },
  {
    key: 'PMMA_FROST', category: 'PLASTIC', family: 'GLASS',
    label: { es: 'Acrílico esmerilado', en: 'Frosted acrylic' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0.45, ior: 1.49, transmission: 1, absorptionMm: 0,
      scatterMm: 4, scatterColor: [0.999, 0.999, 0.999, 1], scatterG: 0.3 },
  },
  // L6: the floors of the sets: sheets of cast acrylic, black and white, with the
  // slight haze of a real sheet (roughness 0.12): they smear what they reflect a little, they are not mirrors.
  {
    key: 'ACRYLIC_BLACK', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'Acrílico negro brillante', en: 'Gloss black acrylic' },
    params: { baseColor: [0.01, 0.01, 0.012, 1], roughness: 0.12, ior: 1.49 },
  },
  {
    key: 'ACRYLIC_WHITE', category: 'PLASTIC', family: 'SIMPLE',
    label: { es: 'Acrílico blanco', en: 'White acrylic' },
    params: { baseColor: [0.85, 0.85, 0.85, 1], roughness: 0.12, ior: 1.49 },
  },

  // --- Woods ---
  // woodColor1 is the spring wood (light), woodColor2 the summer wood (dark). E6 (lead's ruling): ringDensity is
  // rings per 100 mm, physical (oak 3 mm, maple 2.5, pine 5...), and every wood carries its ring contrast,
  // pores (width in mm, depth, 1 ring-porous / 0 diffuse) and, for bamboo, MDF and ebony, its figure. Knots
  // (count per piece, diameter in mm, ± variation, darkness): knotty pine 4 of 10 to 25 mm, cherry and walnut
  // one; bamboo, MDF and ebony have none (their figure has no branches).
  {
    key: 'OAK', category: 'WOOD', family: 'WOOD',
    label: { es: 'Roble', en: 'Oak' },
    params: { woodColor1: [0.56, 0.38, 0.21, 1], woodColor2: [0.3, 0.18, 0.09, 1], ringDensity: 33,
      ringVariation: 0.45, ringNoise: 0.35, axialNoise: 0.25, colorNoise: 0.2, roughness: 0.4,
      ringContrast: 0.35, poreSize: 0.3, poreDepth: 0.5, poreBand: 1 },
  },
  {
    key: 'OAK_WHITE', category: 'WOOD', family: 'WOOD',
    label: { es: 'Roble blanco', en: 'White oak' },
    params: { woodColor1: [0.71, 0.57, 0.38, 1], woodColor2: [0.47, 0.33, 0.19, 1], ringDensity: 33,
      ringVariation: 0.35, ringNoise: 0.3, axialNoise: 0.2, colorNoise: 0.15, roughness: 0.42,
      ringContrast: 0.3, poreSize: 0.3, poreDepth: 0.5, poreBand: 1 },
  },
  {
    key: 'PINE', category: 'WOOD', family: 'WOOD',
    label: { es: 'Pino', en: 'Pine' },
    params: { woodColor1: [0.78, 0.6, 0.36, 1], woodColor2: [0.46, 0.27, 0.12, 1], ringDensity: 20,
      ringVariation: 0.6, ringNoise: 0.3, axialNoise: 0.25, colorNoise: 0.3, roughness: 0.48,
      ringContrast: 0.25, poreSize: 0, knotCount: 4, knotSize: 17.5, knotSizeVar: 0.43, knotDarkness: 0.9 },
  },
  {
    key: 'WALNUT', category: 'WOOD', family: 'WOOD',
    label: { es: 'Nogal', en: 'Walnut' },
    params: { woodColor1: [0.3, 0.18, 0.1, 1], woodColor2: [0.14, 0.075, 0.045, 1], ringDensity: 33,
      ringVariation: 0.4, ringNoise: 0.5, axialNoise: 0.35, colorNoise: 0.22, roughness: 0.36,
      ringContrast: 0.35, poreSize: 0.2, poreDepth: 0.175, poreBand: 0, knotCount: 1, knotSize: 15, knotDarkness: 0.6 },
  },
  {
    key: 'MAPLE', category: 'WOOD', family: 'WOOD',
    label: { es: 'Arce', en: 'Maple' },
    params: { woodColor1: [0.76, 0.63, 0.43, 1], woodColor2: [0.63, 0.49, 0.31, 1], ringDensity: 40,
      ringVariation: 0.35, ringNoise: 0.32, axialNoise: 0.22, colorNoise: 0.2,
      roughness: 0.34,
      ringContrast: 0.15, poreSize: 0.08, poreDepth: 0.15, poreBand: 0 },
  },
  {
    key: 'CHERRY', category: 'WOOD', family: 'WOOD',
    label: { es: 'Cerezo', en: 'Cherry' },
    params: { woodColor1: [0.55, 0.29, 0.16, 1], woodColor2: [0.36, 0.16, 0.085, 1], ringDensity: 40,
      ringVariation: 0.3, ringNoise: 0.3, axialNoise: 0.2, colorNoise: 0.15, roughness: 0.32,
      ringContrast: 0.25, poreSize: 0.08, poreDepth: 0.15, poreBand: 0, knotCount: 1, knotSize: 12, knotDarkness: 0.6 },
  },
  {
    key: 'TEAK', category: 'WOOD', family: 'WOOD',
    label: { es: 'Teca', en: 'Teak' },
    params: { woodColor1: [0.58, 0.41, 0.2, 1], woodColor2: [0.38, 0.25, 0.11, 1], ringDensity: 25,
      ringVariation: 0.35, ringNoise: 0.4, axialNoise: 0.28, colorNoise: 0.22,
      roughness: 0.45,
      ringContrast: 0.25, poreSize: 0.2, poreDepth: 0.35, poreBand: 0 },
  },
  {
    key: 'MAHOGANY', category: 'WOOD', family: 'WOOD',
    label: { es: 'Caoba', en: 'Mahogany' },
    params: { woodColor1: [0.42, 0.19, 0.11, 1], woodColor2: [0.24, 0.095, 0.055, 1], ringDensity: 25,
      ringVariation: 0.28, ringNoise: 0.35, axialNoise: 0.25, colorNoise: 0.18,
      roughness: 0.3,
      ringContrast: 0.35, poreSize: 0.2, poreDepth: 0.175, poreBand: 0 },
  },
  {
    key: 'ASH', category: 'WOOD', family: 'WOOD',
    label: { es: 'Fresno', en: 'Ash' },
    params: { woodColor1: [0.68, 0.55, 0.38, 1], woodColor2: [0.44, 0.32, 0.19, 1], ringDensity: 29,
      ringVariation: 0.55, ringNoise: 0.35, axialNoise: 0.22, colorNoise: 0.18,
      roughness: 0.44,
      ringContrast: 0.15, poreSize: 0.3, poreDepth: 0.5, poreBand: 1 },
  },
  {
    key: 'BIRCH', category: 'WOOD', family: 'WOOD',
    label: { es: 'Abedul', en: 'Birch' },
    params: { woodColor1: [0.8, 0.68, 0.5, 1], woodColor2: [0.62, 0.48, 0.31, 1], ringDensity: 40,
      ringVariation: 0.18, ringNoise: 0.22, axialNoise: 0.14, colorNoise: 0.1, roughness: 0.4,
      ringContrast: 0.15, poreSize: 0.08, poreDepth: 0.15, poreBand: 0 },
  },
  {
    key: 'EBONY', category: 'WOOD', family: 'WOOD',
    label: { es: 'Ebano', en: 'Ebony' },
    params: { woodColor1: [0.055, 0.048, 0.042, 1], woodColor2: [0.02, 0.017, 0.015, 1], ringDensity: 50,
      ringVariation: 0.25, ringNoise: 0.3, axialNoise: 0.18, colorNoise: 0.12,
      roughness: 0.22,
      ringContrast: 0.2, poreSize: 0.08, poreDepth: 0, poreBand: 0, woodFigure: 'STREAKED' },
  },
  {
    key: 'BAMBOO', category: 'WOOD', family: 'WOOD',
    label: { es: 'Bambu', en: 'Bamboo' },
    params: { woodColor1: [0.74, 0.6, 0.34, 1], woodColor2: [0.55, 0.4, 0.19, 1], ringDensity: 14,
      ringVariation: 0.1, ringNoise: 0.05, axialNoise: 0.05, colorNoise: 0.08, roughness: 0.3,
      ringContrast: 0.2, poreSize: 0, woodFigure: 'STRIPS' },
  },
  {
    key: 'MDF', category: 'WOOD', family: 'WOOD',
    label: { es: 'MDF', en: 'MDF' },
    params: { woodColor1: [0.52, 0.38, 0.24, 1], woodColor2: [0.46, 0.33, 0.2, 1], ringDensity: 2,
      ringVariation: 0.05, ringNoise: 0.05, axialNoise: 0.6, colorNoise: 0.35,
      roughness: 0.68,
      ringContrast: 0, poreSize: 0, woodFigure: 'SPECKLE' },
  },

  // --- Fabrics ---
  // E6: threadCount is threads per cm (physical, each fabric's own). Denim is
  // a 3/1 twill (TWILL31), warp-faced like the real one.
  {
    key: 'COTTON', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Algodon', en: 'Cotton' },
    params: { threadColor1: [0.72, 0.71, 0.68, 1], threadColor2: [0.62, 0.61, 0.58, 1], weave: 'PLAIN',
      threadCount: 40, weaveDepth: 0.35, fuzz: 0.35, fuzzRoughness: 0.35, roughness: 0.75 },
  },
  {
    key: 'LINEN', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Lino', en: 'Linen' },
    params: { threadColor1: [0.7, 0.66, 0.55, 1], threadColor2: [0.58, 0.54, 0.44, 1], weave: 'PLAIN',
      threadCount: 18, weaveDepth: 0.55, fuzz: 0.3, fuzzRoughness: 0.4, roughness: 0.8 },
  },
  {
    key: 'TWILL', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Sarga', en: 'Twill' },
    params: { threadColor1: [0.35, 0.34, 0.32, 1], threadColor2: [0.26, 0.25, 0.24, 1], weave: 'TWILL',
      threadCount: 36, weaveDepth: 0.45, fuzz: 0.28, fuzzRoughness: 0.35, roughness: 0.7 },
  },
  {
    key: 'DENIM', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Vaquero', en: 'Denim' },
    params: { threadColor1: [0.1, 0.16, 0.3, 1], threadColor2: [0.66, 0.66, 0.64, 1], weave: 'TWILL31',
      threadCount: 24, weaveDepth: 0.6, fuzz: 0.4, fuzzRoughness: 0.45, roughness: 0.78 },
  },
  {
    key: 'SATIN', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Raso', en: 'Satin' },
    params: { threadColor1: [0.55, 0.1, 0.16, 1], threadColor2: [0.42, 0.07, 0.12, 1], weave: 'SATIN',
      threadCount: 100, weaveDepth: 0.07, fuzz: 0.6, fuzzRoughness: 0.12, roughness: 0.28 },
  },
  {
    key: 'CANVAS', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Lona', en: 'Canvas' },
    params: { threadColor1: [0.55, 0.48, 0.34, 1], threadColor2: [0.44, 0.38, 0.26, 1], weave: 'CANVAS',
      threadCount: 14, weaveDepth: 0.7, fuzz: 0.25, fuzzRoughness: 0.45, roughness: 0.82 },
  },
  {
    key: 'VELVET', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Terciopelo', en: 'Velvet' },
    params: { threadColor1: [0.1, 0.045, 0.12, 1], threadColor2: [0.075, 0.03, 0.09, 1], weave: 'KNIT',
      threadCount: 30, weaveDepth: 0.1, fuzz: 1, fuzzRoughness: 0.28, roughness: 0.9 },
  },
  {
    key: 'FELT', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Fieltro', en: 'Felt' },
    params: { threadColor1: [0.3, 0.32, 0.34, 1], threadColor2: [0.26, 0.28, 0.3, 1], weave: 'FELT',
      threadCount: 20, weaveDepth: 0.25, fuzz: 0.75, fuzzRoughness: 0.55, roughness: 0.92 },
  },
  {
    key: 'KNIT', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Punto', en: 'Knit' },
    params: { threadColor1: [0.55, 0.42, 0.3, 1], threadColor2: [0.44, 0.33, 0.22, 1], weave: 'KNIT',
      threadCount: 4, weaveDepth: 0.8, fuzz: 0.5, fuzzRoughness: 0.45, roughness: 0.85 },
  },
  {
    key: 'MESH', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Malla tecnica', en: 'Technical mesh' },
    params: { threadColor1: [0.08, 0.08, 0.09, 1], threadColor2: [0.14, 0.14, 0.15, 1], weave: 'PLAIN',
      threadCount: 8, weaveDepth: 0.9, yarnTwist: 0, fuzz: 0.15, fuzzRoughness: 0.3, roughness: 0.55 },
  },
  {
    key: 'MICROFIB', category: 'FABRIC', family: 'FABRIC',
    label: { es: 'Microfibra', en: 'Microfibre' },
    params: { threadColor1: [0.16, 0.18, 0.2, 1], threadColor2: [0.13, 0.15, 0.17, 1], weave: 'SATIN',
      threadCount: 120, weaveDepth: 0.12, fuzz: 0.7, fuzzRoughness: 0.5, roughness: 0.88 },
  },

  // --- Glass and mirror ---
  // MIRROR lives in this category but is a SIMPLE (fully metallic) material.
  {
    key: 'GLASS_CLEAR', category: 'GLASS', family: 'GLASS',
    label: { es: 'Vidrio', en: 'Clear glass' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0, ior: 1.52, transmission: 1 },
  },
  {
    key: 'GLASS_FROST', category: 'GLASS', family: 'GLASS',
    label: { es: 'Vidrio esmerilado', en: 'Frosted glass' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0.3, ior: 1.52, transmission: 1 },
  },
  {
    key: 'GLASS_TINT', category: 'GLASS', family: 'GLASS',
    label: { es: 'Vidrio tintado', en: 'Tinted glass' },
    params: { baseColor: [0.35, 0.45, 0.42, 1], roughness: 0, ior: 1.52, transmission: 1 },
  },
  {
    key: 'GLASS_SMOKE', category: 'GLASS', family: 'GLASS',
    label: { es: 'Vidrio ahumado', en: 'Smoked glass' },
    params: { baseColor: [0.22, 0.21, 0.21, 1], roughness: 0.02, ior: 1.52, transmission: 1 },
  },
  {
    // E9c: perfume crystal, dispersive (Abbe number 40: the colours part in its facets).
    key: 'CRYSTAL', category: 'GLASS', family: 'GLASS',
    label: { es: 'Cristal de perfumería', en: 'Perfume crystal' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0, ior: 1.56, transmission: 1, absorptionMm: 0, abbe: 40 },
  },
  {
    key: 'MIRROR', category: 'GLASS', family: 'SIMPLE',
    label: { es: 'Espejo', en: 'Mirror' },
    params: { baseColor: [0.95, 0.96, 0.97, 1], metallic: 1, roughness: 0 },
  },
  // L6: the mirror floor of a set: a black glass mirror, a dark full reflection.
  {
    key: 'MIRROR_BLACK', category: 'GLASS', family: 'SIMPLE',
    label: { es: 'Espejo negro', en: 'Black mirror' },
    params: { baseColor: [0.2, 0.2, 0.21, 1], metallic: 1, roughness: 0 },
  },

  // --- Emitters ---
  // Real colour temperatures of each kind of source.
  {
    key: 'FILAMENT', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Filamento Edison', en: 'Edison filament' },
    params: { emitKind: 'BLACKBODY', temperature: 2400, emitPower: 45 },
  },
  {
    key: 'INCAND', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Incandescente', en: 'Incandescent' },
    params: { emitKind: 'BLACKBODY', temperature: 2700, emitPower: 60 },
  },
  {
    key: 'HALOGEN', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Halogena', en: 'Halogen' },
    params: { emitKind: 'BLACKBODY', temperature: 3000, emitPower: 90 },
  },
  {
    key: 'LED_WARM', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'LED calido', en: 'Warm LED' },
    params: { emitKind: 'BLACKBODY', temperature: 3000, emitPower: 70 },
  },
  {
    key: 'LED_NEUTRAL', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'LED neutro', en: 'Neutral LED' },
    params: { emitKind: 'BLACKBODY', temperature: 4000, emitPower: 70 },
  },
  {
    key: 'LED_COOL', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'LED frio', en: 'Cool LED' },
    params: { emitKind: 'BLACKBODY', temperature: 6500, emitPower: 70 },
  },
  {
    key: 'FLUOR', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Fluorescente', en: 'Fluorescent' },
    params: { emitKind: 'BLACKBODY', temperature: 4200, emitPower: 55 },
  },
  {
    key: 'XENON', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Xenon HID', en: 'Xenon HID' },
    params: { emitKind: 'BLACKBODY', temperature: 4300, emitPower: 220 },
  },
  {
    key: 'SODIUM', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Sodio (farola)', en: 'Sodium street lamp' },
    params: { emitKind: 'BLACKBODY', temperature: 2000, emitPower: 130 },
  },
  {
    key: 'NEON_RED', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Neon rojo', en: 'Red neon' },
    params: { emitKind: 'COLOR', emitColor: [1, 0.18, 0.06, 1], emitPower: 35 },
  },
  {
    key: 'NEON_BLUE', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Neon azul', en: 'Blue neon' },
    params: { emitKind: 'COLOR', emitColor: [0.1, 0.45, 1, 1], emitPower: 35 },
  },
  {
    key: 'NEON_GREEN', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Neon verde', en: 'Green neon' },
    params: { emitKind: 'COLOR', emitColor: [0.15, 1, 0.35, 1], emitPower: 35 },
  },
  {
    key: 'SCREEN', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Pantalla', en: 'Display screen' },
    params: { emitKind: 'BLACKBODY', temperature: 6500, emitPower: 6 },
  },
  {
    key: 'PANEL', category: 'EMISSIVE', family: 'EMISSIVE',
    label: { es: 'Panel LED', en: 'LED panel' },
    params: { emitKind: 'BLACKBODY', temperature: 5600, emitPower: 25 },
  },

  // --- Other ---
  // CARBON lives in this category but uses the FABRIC family (a twill weave).
  {
    key: 'RUBBER', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Goma', en: 'Rubber' },
    params: { baseColor: [0.02, 0.02, 0.02, 1], roughness: 0.88 },
  },
  {
    key: 'LEATHER', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Cuero', en: 'Leather' },
    params: { baseColor: [0.1, 0.055, 0.035, 1], roughness: 0.55, coat: 0.35, coatRoughness: 0.35 },
  },
  {
    key: 'CERAMIC', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Ceramica', en: 'Ceramic' },
    params: { baseColor: [0.88, 0.87, 0.85, 1], roughness: 0.12, coat: 1, coatRoughness: 0.04 },
  },
  {
    key: 'CONCRETE', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Hormigon', en: 'Concrete' },
    params: { baseColor: [0.32, 0.32, 0.31, 1], roughness: 0.85 },
  },
  {
    key: 'PAPER', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Papel', en: 'Paper' },
    params: { baseColor: [0.78, 0.77, 0.74, 1], roughness: 0.78 },
  },
  {
    key: 'CARDBOARD', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Carton', en: 'Cardboard' },
    params: { baseColor: [0.42, 0.3, 0.18, 1], roughness: 0.82 },
  },
  {
    key: 'CARBON', category: 'OTHER', family: 'FABRIC',
    label: { es: 'Carbono', en: 'Carbon fibre' },
    params: { threadColor1: [0.022, 0.022, 0.026, 1], threadColor2: [0.055, 0.055, 0.062, 1],
      weave: 'TWILL', threadCount: 5, weaveDepth: 0.05, yarnTwist: 0, fuzz: 0, fuzzRoughness: 0.2,
      roughness: 0.18, coat: 1, coatRoughness: 0.03 },
  },
  {
    key: 'CAR_PAINT', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Pintura de coche', en: 'Car paint' },
    params: { baseColor: [0.35, 0.02, 0.02, 1], roughness: 0.32, coat: 1, coatRoughness: 0.03 },
  },
  {
    key: 'PAINT_MET', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Pintura metalizada', en: 'Metallic paint' },
    params: { baseColor: [0.12, 0.14, 0.22, 1], metallic: 0.65, roughness: 0.3, coat: 1,
      coatRoughness: 0.03 },
  },
  {
    key: 'WHITE_STUDIO', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Blanco estudio', en: 'Studio white' },
    params: { baseColor: [0.82, 0.82, 0.82, 1], roughness: 0.45 },
  },
  {
    key: 'WAX', category: 'OTHER', family: 'GLASS',
    label: { es: 'Cera', en: 'Wax' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0.4, ior: 1.44, transmission: 1, absorptionMm: 0,
      scatterMm: 0.35, scatterColor: [0.997, 0.993, 0.975, 1], scatterG: 0 },
  },
  {
    key: 'SOAP_GLYCERIN', category: 'OTHER', family: 'GLASS',
    label: { es: 'Jabón de glicerina', en: 'Glycerine soap' },
    params: { baseColor: [0.93, 0.72, 0.42, 1], roughness: 0.12, ior: 1.47, transmission: 1, absorptionMm: 60,
      scatterMm: 12, scatterColor: [0.995, 0.99, 0.98, 1], scatterG: 0.4 },
  },
  {
    key: 'MILK', category: 'OTHER', family: 'GLASS',
    label: { es: 'Leche', en: 'Milk' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0, ior: 1.35, transmission: 1, absorptionMm: 0,
      scatterMm: 0.31, scatterColor: [0.9996, 0.9993, 0.9963, 1], scatterG: 0 },
  },
  {
    key: 'JUICE_ORANGE', category: 'OTHER', family: 'GLASS',
    label: { es: 'Zumo de naranja', en: 'Orange juice' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0, ior: 1.35, transmission: 1, absorptionMm: 0,
      scatterMm: 0.9, scatterColor: [0.997, 0.94, 0.55, 1], scatterG: 0 },
  },
  {
    key: 'JUICE_APPLE', category: 'OTHER', family: 'GLASS',
    label: { es: 'Zumo de manzana', en: 'Apple juice' },
    params: { baseColor: [0.86, 0.55, 0.16, 1], roughness: 0, ior: 1.35, transmission: 1, absorptionMm: 25,
      scatterMm: 40, scatterColor: [1, 1, 1, 1], scatterG: 0.5 },
  },
  {
    key: 'CREAM', category: 'OTHER', family: 'GLASS',
    label: { es: 'Crema', en: 'Cream' },
    params: { baseColor: [1, 1, 1, 1], roughness: 0.25, ior: 1.4, transmission: 1, absorptionMm: 0,
      scatterMm: 0.19, scatterColor: [0.99997, 0.9995, 0.9949, 1], scatterG: 0 },
  },
  // L6: the cards of the sets: matte card stock, white (0.92) and black (0.02). The silver card of a
  // set is brushed aluminium (ALU_BRUSH), which is what a silver card is.
  {
    key: 'CARD_WHITE', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Tarjeta blanca', en: 'White card' },
    params: { baseColor: [0.92, 0.92, 0.92, 1], roughness: 0.9 },
  },
  {
    key: 'CARD_BLACK', category: 'OTHER', family: 'SIMPLE',
    label: { es: 'Tarjeta negra', en: 'Black card' },
    params: { baseColor: [0.02, 0.02, 0.02, 1], roughness: 0.9 },
  },
];

const BY_KEY: ReadonlyMap<string, MaterialPreset> = new Map(MATERIAL_PRESETS.map((m) => [m.key, m]));

export function materialPreset(key: string): MaterialPreset | undefined {
  return BY_KEY.get(key);
}

export function materialsInCategory(category: MaterialPreset['category']): readonly MaterialPreset[] {
  return MATERIAL_PRESETS.filter((m) => m.category === category);
}

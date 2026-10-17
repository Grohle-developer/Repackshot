import { describe, it, expect } from 'vitest';
import {
  AIMING_MOVES,
  CAMERA_AZIMUTH_DEG,
  CAMERA_ELEVATION_DEG,
  CAMERA_MOVES,
  COLOR_MOVES,
  DEFAULT_AMOUNT_LABEL,
  DOCTOR_CHECKS,
  DOME_FLOOR,
  DOME_HORIZON,
  DOME_ZENITH,
  EASING_KINDS,
  EXPLODE_MODES,
  FIELD_MAX_STRENGTH,
  FIELD_SOFT,
  FUZZ_PRESETS,
  FUZZ_REF_AREA_M2,
  FUZZ_REF_SIZE_M,
  LENS_PRESETS,
  LIGHT_MOVES,
  LIGHT_ROLES,
  LIGHT_SETUPS,
  LIGHT_STYLES,
  MATERIAL_CATEGORIES,
  MATERIAL_MOVES,
  MATERIAL_PRESETS,
  MOVE_GROUPS,
  MOVE_KINDS,
  RESERVED_MOVES,
  QUALITY_PRESETS,
  RESOLUTION_PRESETS,
  SCENE_MOVES,
  SEQUENCE_PRESETS,
  SPEC_DEFAULTS,
  STUDIO_PRESETS,
  TARGET_KINDS,
  VECTOR_MOVES,
  WEAR_CATEGORY_DEFAULTS,
  WEAR_FAMILY_TYPES,
  WEAR_LEVELS,
  WEAR_PAINTED,
  WEAR_PATINA_BY_CATEGORY,
  WEAR_PRESETS,
  WEAR_PRESET_OVERRIDES,
  WEAR_PROP_DEFAULTS,
  WEAR_TYPES,
  lightSetup,
  materialPreset,
  materialsInCategory,
  setupsInStyle,
  studioPreset,
} from '../src/data';
import type {
  EasingKind,
  Label,
  LightStyle,
  MaterialCategory,
  MaterialFamily,
  MoveKind,
} from '../src/data';
import { darken, lighten, wearDefaults } from '../src/core/wear';

const CATEGORIES: readonly MaterialCategory[] = [
  'METAL',
  'PLASTIC',
  'WOOD',
  'FABRIC',
  'GLASS',
  'EMISSIVE',
  'OTHER',
];
const FAMILIES: readonly MaterialFamily[] = ['SIMPLE', 'GLASS', 'WOOD', 'FABRIC', 'EMISSIVE'];
const STYLES: readonly LightStyle[] = [
  'SETS',
  'PRODUCT',
  'TRADITIONAL',
  'CINEMATIC',
  'CREATIVE',
  'EMOTIONAL',
  'EXPERIMENTAL',
  'SIGNATURE',
  'SPICY',
  'INTERIOR',
];

function isLabel(v: unknown): v is Label {
  if (typeof v !== 'object' || v === null) return false;
  const keys = Object.keys(v);
  return keys.length === 2 && keys.includes('es') && keys.includes('en');
}

/** Finds every Label inside a catalogue, however deeply nested. */
function collectLabels(value: unknown, out: Label[] = []): Label[] {
  if (isLabel(value)) {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectLabels(item, out);
  } else if (typeof value === 'object' && value !== null && !(value instanceof Set)) {
    for (const item of Object.values(value)) collectLabels(item, out);
  }
  return out;
}

function unique(keys: readonly string[]): boolean {
  return new Set(keys).size === keys.length;
}

describe('quality and resolution presets', () => {
  it('has three quality tiers of increasing cost', () => {
    expect(Object.keys(QUALITY_PRESETS)).toEqual(['DRAFT', 'PREVIEW', 'FINAL']);
    expect(QUALITY_PRESETS.DRAFT).toMatchObject({ samples: 64, threshold: 0.05, resPct: 50, bounces: 6 });
    expect(QUALITY_PRESETS.PREVIEW).toMatchObject({ samples: 256, threshold: 0.02, resPct: 75, bounces: 8 });
    expect(QUALITY_PRESETS.FINAL).toMatchObject({ samples: 1024, threshold: 0.005, resPct: 100, bounces: 12 });
  });

  it('has five resolution presets with their sizes', () => {
    expect(RESOLUTION_PRESETS.map((r) => [r.key, r.width, r.height])).toEqual([
      ['HD', 1920, 1080],
      ['UHD', 3840, 2160],
      ['SQUARE', 2048, 2048],
      ['PORTRAIT', 1080, 1350],
      ['PRINT', 3508, 2480],
    ]);
  });
});

describe('studio presets', () => {
  it('has 16 presets with unique keys, GENERIC first', () => {
    expect(STUDIO_PRESETS).toHaveLength(16);
    expect(unique(STUDIO_PRESETS.map((p) => p.key))).toBe(true);
    expect(STUDIO_PRESETS[0].key).toBe('GENERIC');
    expect(STUDIO_PRESETS.map((p) => p.key)).toEqual([
      'GENERIC', 'JEWELLERY', 'WATCH', 'PERFUME', 'COSMETICS', 'ELECTRONICS', 'APPLIANCE',
      'FURNITURE_IN', 'FURNITURE_OUT', 'FOOTWEAR', 'TEXTILE', 'PACKAGING', 'AUTOMOTIVE',
      'TOOL', 'EYEWEAR', 'MEDICAL',
    ]);
  });

  it('pins the settings of GENERIC', () => {
    const p = studioPreset('GENERIC');
    expect(p).toMatchObject({
      sizeMm: 200,
      focalMm: 85,
      fstop: 5.6,
      envStrength: 0.6,
      exposure: 0,
      background: 'FLAT',
      backgroundColor: [0.05, 0.05, 0.05, 1],
      floor: true,
      shadow: true,
      caustics: false,
      quality: 'PREVIEW',
    });
    expect(p?.lights).toHaveLength(3);
    expect(studioPreset('NOPE')).toBeUndefined();
  });

  it('has 54 lights in total (L6: the lights of the sets), every one with energy, a tone and positive geometry', () => {
    const lights = STUDIO_PRESETS.flatMap((p) => p.lights);
    expect(lights).toHaveLength(54);
    for (const l of lights) {
      expect(l.energy).toBeGreaterThan(0);
      // A colour, or a colour temperature (the sets' lights, L6), or the default white.
      if (l.color !== undefined) expect(l.color).toHaveLength(3);
      if (l.kelvin !== undefined) expect(l.kelvin).toBeGreaterThan(1000);
      expect(l.size).toBeGreaterThan(0);
      expect(l.dist).toBeGreaterThan(0);
      expect(l.share).toBeUndefined();
    }
  });

  it('turns caustics on for exactly the four transparent-product presets', () => {
    expect(STUDIO_PRESETS.filter((p) => p.caustics).map((p) => p.key)).toEqual([
      'JEWELLERY', 'WATCH', 'PERFUME', 'EYEWEAR',
    ]);
  });

  it('uses an HDRI background only for outdoor furniture, and valid quality keys', () => {
    expect(STUDIO_PRESETS.filter((p) => p.background === 'HDRI').map((p) => p.key)).toEqual(['FURNITURE_OUT']);
    for (const p of STUDIO_PRESETS) expect(Object.keys(QUALITY_PRESETS)).toContain(p.quality);
  });
});

describe('light setups', () => {
  it('has 95 setups with unique keys: the 16 sets of L6 first, then the 72 of the base catalogue with PRESET first, then the 7 of Interior (K1)', () => {
    expect(LIGHT_SETUPS).toHaveLength(95);
    expect(unique(LIGHT_SETUPS.map((s) => s.key))).toBe(true);
    expect(LIGHT_SETUPS.slice(0, 16).every((s) => s.style === 'SETS')).toBe(true);
    expect(LIGHT_SETUPS[16].key).toBe('PRESET');
    expect(LIGHT_SETUPS.slice(88).map((s) => s.key)).toEqual([
      'INT_WINDOW_MORNING', 'INT_WINDOW_NOON', 'INT_WINDOW_AFTERNOON', 'INT_OVERCAST', 'INT_NIGHT_LAMPS', 'INT_BLUE_HOUR', 'INT_WHITE_ROOM',
    ]);
    expect(LIGHT_SETUPS.slice(16, 88).every((s) => s.style !== 'SETS' && s.style !== 'INTERIOR')).toBe(true);
  });

  it('has the 10 styles, SETS first and INTERIOR last, without the "all" filter entry', () => {
    expect(LIGHT_STYLES.map((s) => s.key)).toEqual(STYLES);
  });

  it('has the per-style counts', () => {
    const counts: Record<LightStyle, number> = {
      SETS: 16,
      PRODUCT: 12,
      TRADITIONAL: 13,
      CINEMATIC: 11,
      CREATIVE: 8,
      EMOTIONAL: 8,
      EXPERIMENTAL: 8,
      SIGNATURE: 6,
      SPICY: 6,
      INTERIOR: 7,
    };
    for (const style of STYLES) expect(setupsInStyle(style)).toHaveLength(counts[style]);
    expect(setupsInStyle('ALL')).toHaveLength(95);
    expect(setupsInStyle()).toHaveLength(95);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(95);
  });

  it('keeps each style in one contiguous block of the catalogue', () => {
    const order = LIGHT_SETUPS.map((s) => s.style).filter((s, i, a) => i === 0 || s !== a[i - 1]);
    expect(order).toEqual(STYLES);
  });

  it('has exactly three SKY worlds before K1, four more in Interior, and the rest STUDIO', () => {
    expect(LIGHT_SETUPS.filter((s) => s.world === 'SKY' && s.style !== 'INTERIOR').map((s) => s.key)).toEqual([
      'SUN', 'GOLDEN_HOUR', 'DAWN',
    ]);
    expect(LIGHT_SETUPS.filter((s) => s.world === 'SKY' && s.style === 'INTERIOR').map((s) => s.key)).toEqual([
      'INT_WINDOW_MORNING', 'INT_WINDOW_NOON', 'INT_WINDOW_AFTERNOON', 'INT_BLUE_HOUR',
    ]);
    expect(LIGHT_SETUPS.filter((s) => s.world === 'STUDIO')).toHaveLength(88);
    expect(LIGHT_SETUPS.filter((s) => s.world === 'FLAT')).toHaveLength(0);
  });

  it('gives the sky setups before K1 a single SUN light, and the sky setups of Interior exactly one SUN among their lights', () => {
    for (const s of LIGHT_SETUPS.filter((x) => x.world === 'SKY' && x.style !== 'INTERIOR')) {
      expect(s.lights).toHaveLength(1);
      expect(s.lights?.[0].type).toBe('SUN');
    }
    for (const s of LIGHT_SETUPS.filter((x) => x.world === 'SKY' && x.style === 'INTERIOR')) {
      expect(s.lights?.filter((l) => l.type === 'SUN'), s.key).toHaveLength(1);
    }
    // The studio worlds of Interior have no sun at all: their light comes from panels and lamps.
    for (const s of LIGHT_SETUPS.filter((x) => x.world === 'STUDIO' && x.style === 'INTERIOR')) {
      expect(s.lights?.some((l) => l.type === 'SUN'), s.key).toBe(false);
    }
    expect(LIGHT_SETUPS.flatMap((s) => s.lights ?? []).filter((l) => l.type === 'SUN')).toHaveLength(7);
  });

  it('has lights: null only for PRESET', () => {
    expect(LIGHT_SETUPS.filter((s) => s.lights === null).map((s) => s.key)).toEqual(['PRESET']);
  });

  it('has 155 recipe lights before L6, whose shares sum to 1 per setup', () => {
    const recipes = LIGHT_SETUPS.filter((s) => s.lights !== null && s.style !== 'SETS' && s.style !== 'INTERIOR');
    expect(recipes.flatMap((s) => s.lights ?? [])).toHaveLength(155);
    for (const s of recipes) {
      const total = (s.lights ?? []).reduce((a, l) => a + (l.share ?? 0), 0);
      expect(Math.abs(total - 1), s.key).toBeLessThan(1e-9);
      for (const l of s.lights ?? []) {
        expect(l.energy, s.key).toBeUndefined();
        expect(l.size).toBeGreaterThan(0);
        expect(l.dist).toBeGreaterThan(0);
      }
    }
  });

  it('marks exactly three recipe lights before L6 as seen by the camera, and the bright field of the sets; no light of Interior is', () => {
    expect(LIGHT_SETUPS.filter((s) => s.style !== 'SETS').flatMap((s) => s.lights ?? []).filter((l) => l.camera)).toHaveLength(3);
    expect(LIGHT_SETUPS.filter((s) => s.style === 'INTERIOR').flatMap((s) => s.lights ?? []).filter((l) => l.camera)).toHaveLength(0);
    expect(LIGHT_SETUPS.filter((s) => s.style === 'SETS' && s.lights?.some((l) => l.camera)).map((s) => s.key)).toEqual(['BRIGHT_FIELD']);
  });

  it('looks setups up by key', () => {
    expect(lightSetup('ECLIPSE')?.style).toBe('SPICY');
    expect(lightSetup('ECLIPSE')?.lights?.[0]).toMatchObject({ shape: 'DISK', camera: true, share: 0.92 });
    expect(lightSetup('NOPE')).toBeUndefined();
  });

  it('pins the defaults, camera angles and role fallbacks', () => {
    expect(SPEC_DEFAULTS).toEqual({
      type: 'AREA',
      shape: 'RECTANGLE',
      spread: 180,
      angle: 0.545,
      kelvin: 5600,
      glossy: true,
      camera: false,
    });
    expect(CAMERA_AZIMUTH_DEG).toBe(-35);
    expect(CAMERA_ELEVATION_DEG).toBe(22);
    expect(Object.keys(LIGHT_ROLES)).toEqual(['KEY', 'FILL', 'RIM', 'TOP']);
    expect(LIGHT_ROLES.KEY).toMatchObject({ azimuthWorld: -40, energy: 90, sizeY: 1.8 });
  });
});

describe('materials', () => {
  it('has 7 categories and 92 presets with unique keys (77 base presets, the 5 set pieces of L6, 9 translucent of E9b, the crystal of E9c)', () => {
    expect(MATERIAL_CATEGORIES.map((c) => c.key)).toEqual(CATEGORIES);
    expect(MATERIAL_PRESETS).toHaveLength(92);
    expect(unique(MATERIAL_PRESETS.map((m) => m.key))).toBe(true);
  });

  it('pins the per-category counts', () => {
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, materialsInCategory(c).length]));
    expect(counts).toEqual({
      METAL: 12,
      PLASTIC: 17,
      WOOD: 13,
      FABRIC: 11,
      GLASS: 7,
      EMISSIVE: 14,
      OTHER: 18,
    });
  });

  it('keeps every category and family inside the allowed unions', () => {
    for (const m of MATERIAL_PRESETS) {
      expect(CATEGORIES, m.key).toContain(m.category);
      expect(FAMILIES, m.key).toContain(m.family);
    }
  });

  it('gives every GLASS-family material a transmission and an ior', () => {
    const glass = MATERIAL_PRESETS.filter((m) => m.family === 'GLASS');
    expect(glass.map((m) => m.key)).toEqual([
      // E9's translucent recipes are clear solids with a medium inside, next to their kin, and
      // E9c's dispersive crystal follows the glass.
      'PC_CLEAR', 'PMMA', 'PMMA_TINT', 'HDPE_WHITE', 'PP_NATURAL', 'PMMA_FROST',
      'GLASS_CLEAR', 'GLASS_FROST', 'GLASS_TINT', 'GLASS_SMOKE', 'CRYSTAL',
      'WAX', 'SOAP_GLYCERIN', 'MILK', 'JUICE_ORANGE', 'JUICE_APPLE', 'CREAM',
    ]);
    for (const m of glass) {
      expect(m.params.transmission, m.key).toBeDefined();
      expect(m.params.ior, m.key).toBeGreaterThan(1);
    }
  });

  it('gives every EMISSIVE material the emission params its kind needs', () => {
    const emitters = materialsInCategory('EMISSIVE');
    for (const m of emitters) {
      expect(m.family).toBe('EMISSIVE');
      expect(m.params.emitPower, m.key).toBeGreaterThan(0);
      if (m.params.emitKind === 'BLACKBODY') expect(m.params.temperature, m.key).toBeGreaterThan(0);
      else {
        expect(m.params.emitKind, m.key).toBe('COLOR');
        expect(m.params.emitColor, m.key).toHaveLength(4);
      }
    }
    expect(emitters.filter((m) => m.params.emitKind === 'COLOR').map((m) => m.key)).toEqual([
      'NEON_RED', 'NEON_BLUE', 'NEON_GREEN',
    ]);
  });

  it('gives WOOD and FABRIC presets their own colour pairs', () => {
    for (const m of MATERIAL_PRESETS.filter((x) => x.family === 'WOOD')) {
      expect(m.params.woodColor1, m.key).toHaveLength(4);
      expect(m.params.woodColor2, m.key).toHaveLength(4);
      expect(m.params.ringDensity, m.key).toBeGreaterThan(0);
    }
    for (const m of MATERIAL_PRESETS.filter((x) => x.family === 'FABRIC')) {
      expect(m.params.threadColor1, m.key).toHaveLength(4);
      expect(m.params.threadColor2, m.key).toHaveLength(4);
      expect(['PLAIN', 'TWILL', 'SATIN', 'CANVAS', 'KNIT', 'FELT', 'TWILL31'], m.key).toContain(m.params.weave);
      // E6: threads per cm, physical, inside the inspector's range.
      expect(m.params.threadCount, m.key).toBeGreaterThanOrEqual(2);
      expect(m.params.threadCount, m.key).toBeLessThanOrEqual(200);
    }
  });

  it('keeps colours and scalar params inside 0..1 where they are fractions', () => {
    for (const m of MATERIAL_PRESETS) {
      for (const [name, v] of Object.entries(m.params)) {
        if (Array.isArray(v)) for (const c of v) expect(c, `${m.key}.${name}`).toBeGreaterThanOrEqual(0);
      }
      for (const name of ['metallic', 'roughness', 'coat', 'coatRoughness', 'subsurface', 'transmission'] as const) {
        const v = m.params[name];
        if (v !== undefined) {
          expect(v, `${m.key}.${name}`).toBeGreaterThanOrEqual(0);
          expect(v, `${m.key}.${name}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('looks presets up by key', () => {
    expect(materialPreset('GOLD')).toMatchObject({
      category: 'METAL',
      family: 'SIMPLE',
      params: { baseColor: [0.94, 0.72, 0.25, 1], metallic: 1, roughness: 0.15 },
    });
    expect(materialPreset('MIRROR')?.category).toBe('GLASS');
    expect(materialPreset('MIRROR')?.family).toBe('SIMPLE');
    expect(materialPreset('CARBON')?.family).toBe('FABRIC');
    expect(materialPreset('NOPE')).toBeUndefined();
  });
});

describe('wear catalogue', () => {
  it('has 8 wear types, each with a property of the same name', () => {
    expect(WEAR_TYPES).toHaveLength(8);
    expect(WEAR_TYPES.map((t) => t.key)).toEqual([
      'edges', 'scratches', 'smudges', 'dust', 'dirt', 'patina', 'roughVar', 'dents',
    ]);
    for (const t of WEAR_TYPES) expect(Object.keys(WEAR_PROP_DEFAULTS)).toContain(t.key);
  });

  it('has 34 properties with every default at zero wear', () => {
    expect(Object.keys(WEAR_PROP_DEFAULTS)).toHaveLength(34);
    expect(WEAR_PROP_DEFAULTS.amount).toBe(0);
    expect(WEAR_PROP_DEFAULTS.refSize).toBe(0.2);
    for (const t of WEAR_TYPES) expect(WEAR_PROP_DEFAULTS[t.key]).toBe(0);
  });

  it('limits wear types per family', () => {
    expect([...WEAR_FAMILY_TYPES.SIMPLE]).toHaveLength(8);
    expect(WEAR_FAMILY_TYPES.GLASS.has('dents')).toBe(false);
    expect(WEAR_FAMILY_TYPES.GLASS.has('edges')).toBe(false);
    expect(WEAR_FAMILY_TYPES.WOOD.has('dents')).toBe(false);
    expect([...WEAR_FAMILY_TYPES.FABRIC].sort()).toEqual(['dirt', 'dust', 'patina', 'roughVar']);
    expect(WEAR_FAMILY_TYPES.EMISSIVE.size).toBe(0);
  });

  it('covers every category and only uses known property names in patches', () => {
    expect(Object.keys(WEAR_CATEGORY_DEFAULTS)).toEqual(CATEGORIES);
    expect(Object.keys(WEAR_PATINA_BY_CATEGORY)).toEqual(CATEGORIES);
    const known = new Set(Object.keys(WEAR_PROP_DEFAULTS));
    const patches = [
      ...Object.values(WEAR_CATEGORY_DEFAULTS),
      ...Object.values(WEAR_PRESET_OVERRIDES),
      ...WEAR_PRESETS.map((p) => p.props),
    ];
    for (const patch of patches) for (const k of Object.keys(patch)) expect(known.has(k), k).toBe(true);
  });

  it('only overrides wear of existing material presets', () => {
    // 28, L6's five set pieces and E9's four liquids (none of them wears).
    expect(Object.keys(WEAR_PRESET_OVERRIDES)).toHaveLength(37);
    for (const k of Object.keys(WEAR_PRESET_OVERRIDES)) expect(materialPreset(k), k).toBeDefined();
    for (const k of WEAR_PAINTED) expect(materialPreset(k), k).toBeDefined();
    expect([...WEAR_PAINTED]).toEqual(['CAR_PAINT', 'PAINT_MET']);
  });

  it('has 9 one-click wear presets and 3 quick levels', () => {
    expect(WEAR_PRESETS).toHaveLength(9);
    expect(WEAR_PRESETS.map((p) => p.key)).toEqual([
      'CLEAN', 'SHOWROOM', 'HANDLED', 'SCRATCHED', 'DUSTY', 'WORKSHOP', 'OUTDOOR', 'ANTIQUE', 'ALL',
    ]);
    expect(WEAR_PRESETS[0].props).toEqual({ amount: 0 });
    expect(WEAR_PRESETS[8].props.amount).toBe(1);
    expect(WEAR_LEVELS.map((l) => [l.key, l.amount])).toEqual([['new', 0], ['used', 0.35], ['old', 1]]);
  });
});

describe('wear defaults', () => {
  it('lightens and darkens towards white and black', () => {
    expect(lighten([0.5, 0.5, 0.5, 0.2], 0.5)).toEqual([0.75, 0.75, 0.75, 1]);
    expect(darken([0.5, 0.5, 0.5, 0.2], 0.5)).toEqual([0.25, 0.25, 0.25, 1]);
    expect(lighten([0.2, 0.4, 0.6], 0)).toEqual([0.2, 0.4, 0.6, 1]);
    expect(darken([0.2, 0.4, 0.6], 1)).toEqual([0, 0, 0, 1]);
  });

  it('returns null for an unknown material', () => {
    expect(wearDefaults('NOPE')).toBeNull();
  });

  it('gives emitters a master amount of zero', () => {
    for (const m of materialsInCategory('EMISSIVE')) expect(wearDefaults(m.key)?.amount, m.key).toBe(0);
  });

  it('applies the category table, then the preset adjustments', () => {
    const copper = wearDefaults('COPPER');
    expect(copper).toMatchObject({
      amount: 0.45,
      edges: 0.35,
      patina: 0.25,
      patinaColor: [0.2, 0.46, 0.38, 1],
      edgeMetal: 1,
      edgeRough: 0.18,
    });
    expect(wearDefaults('GOLD')?.patina).toBe(0);
    expect(wearDefaults('WHITE_STUDIO')?.amount).toBe(0.1);
    expect(wearDefaults('CAST_IRON')?.dirt).toBe(0.6);
    // Untouched properties stay at their defaults.
    expect(copper?.dustColor).toEqual(WEAR_PROP_DEFAULTS.dustColor);
  });

  it('derives the edge substrate from the material colour', () => {
    const anod = wearDefaults('ALU_ANOD');
    // lighten([0.52, 0.54, 0.57], 0.3)
    expect(anod?.edgeColor[0]).toBeCloseTo(0.664, 12);
    expect(anod?.edgeColor[1]).toBeCloseTo(0.678, 12);
    expect(anod?.edgeColor[2]).toBeCloseTo(0.699, 12);
    expect(anod?.edgeMetal).toBe(1);
    // Plastic: lighter edge, darker scratch groove, not metallic.
    const abs = wearDefaults('ABS_MATTE');
    expect(abs?.edgeMetal).toBe(0);
    expect(abs?.edgeRough).toBe(0.5);
    expect(abs?.scratchColor[0]).toBeCloseTo(0.045 * 0.55, 12);
    // Wood reads its colour from woodColor1.
    const oak = wearDefaults('OAK');
    expect(oak?.edgeRough).toBe(0.55);
    expect(oak?.edgeColor[0]).toBeCloseTo(0.56 + 0.44 * 0.35, 12);
  });

  it('shows bare metal under painted presets', () => {
    for (const k of ['CAR_PAINT', 'PAINT_MET']) {
      const w = wearDefaults(k);
      expect(w?.edgeColor).toEqual([0.6, 0.6, 0.62, 1]);
      expect(w?.edgeMetal).toBe(1);
      expect(w?.edgeRough).toBe(0.3);
      expect(w?.scratchColor).toEqual([0.6, 0.6, 0.62, 1]);
    }
  });

  it('honours the reference size, with a floor of one millimetre', () => {
    expect(wearDefaults('OAK')?.refSize).toBe(0.2);
    expect(wearDefaults('OAK', 0.5)?.refSize).toBe(0.5);
    expect(wearDefaults('OAK', 1e-9)?.refSize).toBe(1e-3);
  });

  it('is defined for every material and never leaks wear into non-wear fields', () => {
    for (const m of MATERIAL_PRESETS) {
      const w = wearDefaults(m.key);
      expect(w, m.key).not.toBeNull();
      expect(Object.keys(w ?? {}).sort(), m.key).toEqual(Object.keys(WEAR_PROP_DEFAULTS).sort());
    }
  });
});

describe('fuzz and lenses', () => {
  it('has 10 fuzz presets with physical sizes', () => {
    expect(FUZZ_PRESETS).toHaveLength(10);
    expect(unique(FUZZ_PRESETS.map((p) => p.key))).toBe(true);
    expect(FUZZ_REF_SIZE_M).toBe(0.2);
    expect(FUZZ_REF_AREA_M2).toBe(0.01);
    for (const p of FUZZ_PRESETS) {
      expect(['NO', 'CURL', 'WAVE'], p.key).toContain(p.params.curl);
      expect(p.params.length, p.key).toBeLessThan(0.05);
      expect(p.params.rootRadius, p.key).toBeGreaterThanOrEqual(p.params.tipRadius);
      if (p.params.curl !== 'NO') expect(p.params.curlAmplitude, p.key).toBeGreaterThan(0);
    }
    expect(FUZZ_PRESETS.find((p) => p.key === 'CORDUROY')?.params.direction).toEqual([0, 0, 1]);
  });

  it('has 8 lens presets in ascending focal length', () => {
    expect(LENS_PRESETS).toHaveLength(8);
    const focal = LENS_PRESETS.map((l) => l.focalMm);
    expect(focal).toEqual([14, 24, 35, 50, 85, 100, 135, 200]);
    expect(focal).toEqual([...focal].sort((a, b) => a - b));
    expect(LENS_PRESETS.find((l) => l.key === 'MACRO')).toMatchObject({ focalMm: 100, fstop: 8 });
  });
});

describe('animation catalogues', () => {
  it('has 22 move kinds (PHYSICS of S2, SECTION of Q1, then the five of N1), 6 easings (N1 appended CUSTOM), 3 targets and 8 explode modes (N6 appended LINEAR and SPHERICAL)', () => {
    expect(MOVE_KINDS).toHaveLength(22);
    // The keys before N1 stay where they were (rule 7: add, never rename).
    expect(MOVE_KINDS.slice(0, 17).map((m) => m.key)).toEqual(['ORBIT', 'RISE', 'DOLLY', 'TRACK', 'MOVE', 'SPIN', 'TUMBLE', 'SCALE', 'ZOOM', 'FOCUS', 'INTENSITY', 'TINT', 'HDRI', 'EXPLODE', 'VISIBILITY', 'PHYSICS', 'SECTION']);
    expect(MOVE_KINDS.slice(-5).map((m) => m.key)).toEqual(['FADE', 'PAN', 'MATERIAL_COLOR', 'SUN_ARC', 'PATH']);
    expect(EASING_KINDS.map((e) => e.key)).toEqual(['LINEAR', 'EASE', 'EASE_IN', 'EASE_OUT', 'EASE_STRONG', 'CUSTOM']);
    expect(TARGET_KINDS.map((t) => t.key)).toEqual(['OBJECT', 'SUBJECT', 'SCENE']);
    expect(EXPLODE_MODES.map((m) => m.key)).toEqual([
      'RADIAL', 'AXIS_X', 'AXIS_Y', 'AXIS_Z', 'CYLINDRICAL', 'CUSTOM', 'LINEAR', 'SPHERICAL',
    ]);
    expect(unique(MOVE_KINDS.map((m) => m.key))).toBe(true);
    expect(DEFAULT_AMOUNT_LABEL.en).toBe('Amount');
  });

  it('has the move groups', () => {
    expect([...AIMING_MOVES].sort()).toEqual(['DOLLY', 'ORBIT', 'RISE']);
    expect([...CAMERA_MOVES].sort()).toEqual(['FOCUS', 'PAN', 'ZOOM']);
    expect([...LIGHT_MOVES].sort()).toEqual(['INTENSITY', 'TINT']);
    expect([...SCENE_MOVES]).toEqual(['HDRI', 'SECTION', 'SUN_ARC']);
    expect([...VECTOR_MOVES].sort()).toEqual(['MOVE', 'TRACK']);
    expect([...COLOR_MOVES]).toEqual(['TINT', 'MATERIAL_COLOR']);
    expect([...MATERIAL_MOVES]).toEqual(['MATERIAL_COLOR']);
    expect([...RESERVED_MOVES]).toEqual(['PATH']);
    const kinds = new Set<MoveKind>(MOVE_KINDS.map((m) => m.key));
    for (const group of [AIMING_MOVES, CAMERA_MOVES, LIGHT_MOVES, SCENE_MOVES, VECTOR_MOVES, COLOR_MOVES, MATERIAL_MOVES, RESERVED_MOVES]) {
      for (const m of group) expect(kinds.has(m)).toBe(true);
    }
    // N1: the wizard's groups (SPEC §3.7) hold every kind but the ones nobody makes by hand.
    const grouped = new Set(MOVE_GROUPS.flatMap((g) => g.moves));
    for (const m of MOVE_KINDS) expect(grouped.has(m.key), m.key).toBe(true);
    expect(MOVE_GROUPS.map((g) => g.key)).toEqual(['PARTS', 'CAMERA', 'LIGHT', 'MATERIAL']);
  });

  // CATALOG (four empty shots) is the sixteenth.
  it('has 16 sequence presets', () => {
    expect(SEQUENCE_PRESETS).toHaveLength(16);
    expect(unique(SEQUENCE_PRESETS.map((p) => p.key))).toBe(true);
    expect(SEQUENCE_PRESETS[0].key).toBe('TURNTABLE');
    expect(SEQUENCE_PRESETS.at(-1)).toMatchObject({ key: 'CATALOG', shots: [2, 2, 2, 2], clips: [] });
  });

  it('keeps every clip inside its sequence, with valid moves, easings and shot indices', () => {
    const moves = new Set<MoveKind>(MOVE_KINDS.map((m) => m.key));
    const easings = new Set<EasingKind>(EASING_KINDS.map((e) => e.key));
    for (const p of SEQUENCE_PRESETS) {
      const total = p.shots.reduce((a, b) => a + b, 0);
      expect(p.shots.length, p.key).toBeGreaterThan(0);
      for (const c of p.clips) {
        const id = `${p.key}/${c.move}`;
        expect(moves.has(c.move), id).toBe(true);
        expect(easings.has(c.easing), id).toBe(true);
        expect(c.duration, id).toBeGreaterThan(0);
        expect(c.start, id).toBeGreaterThanOrEqual(0);
        expect(c.start + c.duration, id).toBeLessThanOrEqual(total + 1e-9);
        if (c.target === 'CAM') {
          expect(c.shot, id).not.toBeNull();
          expect(c.shot as number, id).toBeGreaterThanOrEqual(0);
          expect(c.shot as number, id).toBeLessThan(p.shots.length);
          expect(CAMERA_MOVES.has(c.move) || AIMING_MOVES.has(c.move) || VECTOR_MOVES.has(c.move), id).toBe(true);
        } else {
          expect(c.shot, id).toBeNull();
        }
      }
    }
  });

  it('pins HERO and TURNTABLE', () => {
    const hero = SEQUENCE_PRESETS.find((p) => p.key === 'HERO');
    expect(hero?.shots).toEqual([4, 3, 4]);
    expect(hero?.clips).toHaveLength(4);
    expect(hero?.clips[2]).toEqual({
      move: 'DOLLY', target: 'CAM', shot: 1, start: 4, duration: 3, amount: 40, easing: 'EASE_OUT',
    });
    const turntable = SEQUENCE_PRESETS.find((p) => p.key === 'TURNTABLE');
    expect(turntable?.clips).toEqual([
      { move: 'SPIN', target: 'SUBJECT', shot: null, start: 0, duration: 4, amount: 360, easing: 'LINEAR' },
    ]);
  });
});

describe('doctor checks and environment', () => {
  it('has the 14 base checks in their order, with unique keys, and the new ones among them (D1: simd after engine, budget after output) and after them (U13: aspect, S2: physics, S4a: particles)', () => {
    expect(DOCTOR_CHECKS).toHaveLength(19);
    expect(DOCTOR_CHECKS.at(-1)?.key).toBe('particles');
    const keys = DOCTOR_CHECKS.map((c) => c.key);
    expect(keys).toEqual([
      'engine', 'simd', 'lighttree', 'denoise', 'color', 'scale', 'transform', 'origin',
      'shading', 'bevel', 'clip', 'lights', 'caustics', 'persist', 'output', 'budget', 'aspect', 'physics',
      'particles',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    // The 14 base checks are in their order once the D1 ones are taken out.
    expect(keys.filter((k) => k !== 'simd' && k !== 'budget').slice(0, 14)).toEqual([
      'engine', 'lighttree', 'denoise', 'color', 'scale', 'transform', 'origin',
      'shading', 'bevel', 'clip', 'lights', 'caustics', 'persist', 'output',
    ]);
  });

  it('has a gradient that brightens from floor to zenith', () => {
    expect(DOME_FLOOR).toBe(0.12);
    expect(DOME_HORIZON).toBe(0.45);
    expect(DOME_ZENITH).toBe(0.85);
    expect(DOME_FLOOR).toBeLessThan(DOME_HORIZON);
    expect(DOME_HORIZON).toBeLessThan(DOME_ZENITH);
    expect(FIELD_MAX_STRENGTH).toBe(4);
    expect(FIELD_SOFT).toBe(0.35);
  });
});

describe('labels', () => {
  it('has a non-empty es and en text in every Label of every catalogue', () => {
    const catalogues: Record<string, unknown> = {
      QUALITY_PRESETS,
      RESOLUTION_PRESETS,
      STUDIO_PRESETS,
      LIGHT_STYLES,
      LIGHT_SETUPS,
      MATERIAL_CATEGORIES,
      MATERIAL_PRESETS,
      WEAR_TYPES,
      WEAR_LEVELS,
      WEAR_PRESETS,
      FUZZ_PRESETS,
      LENS_PRESETS,
      MOVE_KINDS,
      EASING_KINDS,
      TARGET_KINDS,
      EXPLODE_MODES,
      SEQUENCE_PRESETS,
      DOCTOR_CHECKS,
      DEFAULT_AMOUNT_LABEL,
    };
    const minimum: Record<string, number> = {
      QUALITY_PRESETS: 3,
      RESOLUTION_PRESETS: 5,
      STUDIO_PRESETS: 16,
      LIGHT_STYLES: 8,
      LIGHT_SETUPS: 144,
      MATERIAL_CATEGORIES: 7,
      MATERIAL_PRESETS: 77,
      WEAR_TYPES: 16,
      WEAR_LEVELS: 3,
      WEAR_PRESETS: 9,
      FUZZ_PRESETS: 10,
      LENS_PRESETS: 8,
      MOVE_KINDS: 30,
      EASING_KINDS: 10,
      TARGET_KINDS: 6,
      EXPLODE_MODES: 16,
      SEQUENCE_PRESETS: 16,
      DOCTOR_CHECKS: 42,
      DEFAULT_AMOUNT_LABEL: 1,
    };
    for (const [name, catalogue] of Object.entries(catalogues)) {
      const labels = collectLabels(catalogue);
      expect(labels.length, name).toBeGreaterThanOrEqual(minimum[name]);
      for (const label of labels) {
        expect(typeof label.es === 'string' && label.es.trim().length > 0, `${name} es`).toBe(true);
        expect(typeof label.en === 'string' && label.en.trim().length > 0, `${name} en`).toBe(true);
      }
    }
  });
});

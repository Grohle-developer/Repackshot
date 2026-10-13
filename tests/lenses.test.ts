// The 16 lens prescriptions of src/data/lenses.json (STUDIO-TOOLS §6, research/optics.md §2.3).
//
// The test is the proof that the transcription is right: a paraxial (y-nu) trace written here, independent of
// the engine, reproduces each lens's effective focal length and back focal distance with the numbers the
// research report derived from the same prescription (tolerance 0.05 %, the digits of the report) and the
// back focus or focal length the patent itself states (tolerance 1 %, as the report states it). A wrong digit in
// a radius, a thickness or an index moves those numbers.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COATINGS, LENS_CHARACTERS, LENS_PRESCRIPTIONS, lensPrescription, type LensGlass, type LensPrescription, type LensSurface } from '../src/data/lenses';

// ---------------------------------------------------------------------------
// Paraxial trace in one global frame. A positive radius has its centre of curvature on the +z side, a mirror
// reverses the direction of travel and negates the index (the usual signed-index trick), so a folded system is
// one sequence. `meridian` picks the plane for cylinders: a cylinder has no power in the meridian of its axis.
// ---------------------------------------------------------------------------

interface TraceOptions {
  /** Index of a glass; default nd. */
  index?: (g: LensGlass) => number;
  /** Replacement distances after the surface with this index. */
  d?: Readonly<Record<number, number>>;
  meridian?: 'x' | 'y';
  /** Starting ray: height and slope in air. Default a marginal ray from infinity (1, 0). */
  y0?: number;
  u0?: number;
}

interface Trace {
  /** Effective focal length (from a ray parallel to the axis), mm; Infinity for an afocal system. */
  efl: number;
  /** Distance from the last vertex to the paraxial focus, mm. */
  bfl: number;
  /** Height and slope after the last surface. */
  y: number;
  u: number;
  /** Heights at which the ray meets each surface (before refraction). */
  heights: number[];
  /** Position of the last vertex, mm, taking the first vertex at 0. */
  zLast: number;
}

function paraxial(surfaces: readonly LensSurface[], opts: TraceOptions = {}): Trace {
  const index = opts.index ?? ((g: LensGlass) => g.nd);
  const meridian = opts.meridian ?? 'x';
  let dir = 1;
  let n = 1;
  let y = opts.y0 ?? 1;
  let u = opts.u0 ?? 0;
  let z = 0;
  const heights: number[] = [];
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i];
    heights.push(y);
    const powerless = s.r === null || (s.kind === 'cylinder' && s.axis === meridian);
    const c = powerless ? 0 : 1 / s.r!;
    let np: number;
    if (s.kind === 'mirror') {
      dir = -dir;
      np = -n;
    } else {
      np = dir * (s.glass ? index(s.glass) : 1);
    }
    u = (n * u - y * c * (np - n)) / np;
    n = np;
    if (i === surfaces.length - 1) break;
    const d = opts.d?.[i] ?? s.d;
    if (d === null) throw new Error(`surface ${i} has no distance`);
    y += d * u;
    z += d;
  }
  // The last medium is air with the light travelling +z: n = 1.
  return { efl: -1 / u, bfl: -y / u, y, u, heights, zLast: z };
}

const near = (value: number, reference: number, rel: number, what: string): void => {
  expect(Math.abs(value - reference) / Math.abs(reference), `${what}: ${value} against ${reference}`).toBeLessThanOrEqual(rel);
};

const nativeIndex = (g: LensGlass): number => g.native?.n ?? g.nd;

/** The surfaces with a modified distance, for the focus and variable-gap states. */
const nearDistances = (lens: LensPrescription): Record<number, number> =>
  Object.fromEntries((lens.focus.moving ?? []).map((m) => [m.surface, m.dNear]));

// ---------------------------------------------------------------------------

/** The 16 keys of the first release. Keys are stable: this list only ever grows. */
const KEYS = [
  'triplet',
  'split_rear_4',
  'petzval_portrait',
  'symmetric_5',
  'double_gauss_normal',
  'double_gauss_fast',
  'fast_asymmetric',
  'telephoto_internal_focus',
  'inverted_telephoto_wide',
  'fisheye_180',
  'catadioptric_mirror',
  'soft_focus_variable',
  'macro_floating',
  'achromat_doublet',
  'meniscus_single',
  'anamorphic_adapter_2x',
];

/**
 * Elements of each lens as the research lists them (§2.1): a glass-bearing surface starts one element,
 * counted once (the folded mirror lens is not counted: its secondary is traversed twice).
 */
const ELEMENTS: Readonly<Record<string, number>> = {
  triplet: 3,
  split_rear_4: 4,
  petzval_portrait: 4,
  symmetric_5: 5,
  double_gauss_normal: 6,
  double_gauss_fast: 7,
  fast_asymmetric: 7,
  telephoto_internal_focus: 7,
  inverted_telephoto_wide: 6,
  fisheye_180: 9, // 8 elements and the plane plate
  soft_focus_variable: 6,
  macro_floating: 5,
  achromat_doublet: 2,
  meniscus_single: 1,
  anamorphic_adapter_2x: 2,
};

/** Trademarks, makers and catalogue glass names that must never appear (STUDIO-TOOLS §0). Whole words, any case. */
const FORBIDDEN = [
  'tessar', 'sonnar', 'planar', 'biotar', 'heliar', 'cooke', 'imagon', 'xenotar', 'distagon', 'hologon', 'topogon', 'summicron', 'summilux', 'noctilux', 'nikkor', 'zuiko', 'takumar', 'helios', 'jupiter',
  'zeiss', 'leica', 'leitz', 'nikon', 'canon', 'minolta', 'kodak', 'olympus', 'pentax', 'angenieux', 'angénieux', 'schneider', 'rodenstock', 'voigtlander', 'voigtländer', 'hasselblad', 'sigma', 'tamron', 'tokina', 'fujifilm', 'fujinon', 'sony', 'panasonic', 'lomo', 'arri', 'panavision', 'keyshot', 'cinepack',
  'schott', 'ohara', 'hoya', 'bk7', 'sf11', 'lasf', 'nbk7',
  // The former trademark of the inverted telephoto layout (research §2.1, §2.6): the generic name is used instead.
  'retrofocus', 'retrofoco',
];

const text = readFileSync('src/data/lenses.json', 'utf8');
const lenses = LENS_PRESCRIPTIONS;

describe('lens prescriptions: the catalogue', () => {
  it('has the 16 lenses in the order of the research, with stable unique keys', () => {
    expect(lenses).toHaveLength(16);
    expect(lenses.map((l) => l.key)).toEqual(KEYS);
    expect(new Set(lenses.map((l) => l.key)).size).toBe(lenses.length);
    for (const l of lenses) expect(lensPrescription(l.key)).toBe(l);
    expect(lensPrescription('nope')).toBeUndefined();
  });

  it('has names in both languages, a known character and a source', () => {
    const characters = LENS_CHARACTERS.map((c) => c.key);
    expect(characters).toEqual(['clinical', 'soft', 'swirl', 'vintage', 'anamorphic', 'macro', 'wide', 'tele']);
    for (const c of LENS_CHARACTERS) {
      expect(c.label.en.trim().length).toBeGreaterThan(0);
      expect(c.label.es.trim().length).toBeGreaterThan(0);
    }
    for (const l of lenses) {
      expect(l.name.en.trim().length, l.key).toBeGreaterThan(0);
      expect(l.name.es.trim().length, l.key).toBeGreaterThan(0);
      expect(characters, l.key).toContain(l.character);
      expect(l.family.length, l.key).toBeGreaterThan(0);
      expect(l.source.doc.length, l.key).toBeGreaterThan(0);
      expect(['patent', 'book', 'computed'], l.key).toContain(l.source.kind);
      if (l.source.year !== null) expect(l.source.year).toBeGreaterThanOrEqual(1812);
      if (l.source.kind === 'patent') expect(l.source.doc, l.key).toMatch(/^US [\d,]+/);
    }
    // Every character is offered by at least one lens.
    for (const c of characters) expect(lenses.some((l) => l.character === c), c).toBe(true);
  });

  it('keeps the own designs apart from the patent ones', () => {
    for (const l of lenses) expect(l.status === 'own-design', l.key).toBe(l.source.kind === 'computed');
    expect(lenses.filter((l) => l.status === 'own-design').map((l) => l.key)).toEqual(['achromat_doublet', 'meniscus_single', 'anamorphic_adapter_2x']);
  });

  it('uses no trademark, maker or catalogue glass name anywhere in the file', () => {
    for (const word of FORBIDDEN) expect(new RegExp(`(^|[^\\p{L}\\p{N}])${word}([^\\p{L}\\p{N}]|$)`, 'iu').test(text), word).toBe(false);
  });

  it('has the nominal reflectance of each coating, from none to multi-layer', () => {
    expect(COATINGS.map((c) => c.key)).toEqual(['none', 'single', 'multi']);
    expect(COATINGS[0].reflectance).toBeGreaterThan(COATINGS[1].reflectance);
    expect(COATINGS[1].reflectance).toBeGreaterThan(COATINGS[2].reflectance);
  });
});

describe('lens prescriptions: surfaces', () => {
  it('has the stop exactly once in every lens', () => {
    for (const l of lenses) expect(l.surfaces.filter((s) => s.role === 'stop').length, l.key).toBe(1);
  });

  it('says where the position of the stop is the source\'s and where it is an assumption', () => {
    const assumed = lenses.filter((l) => l.stopBasis === 'assumed').map((l) => l.key);
    expect(assumed).toEqual([
      'petzval_portrait', 'double_gauss_fast', 'fast_asymmetric', 'telephoto_internal_focus', 'inverted_telephoto_wide', 'fisheye_180', 'soft_focus_variable', 'macro_floating', 'achromat_doublet',
    ]);
    expect(lenses.filter((l) => l.stopBasis === 'placeholder').map((l) => l.key)).toEqual(['anamorphic_adapter_2x']);
    for (const l of lenses) {
      expect(['stated', 'assumed', 'placeholder'], l.key).toContain(l.stopBasis);
      // An assumption is written down in the notes of the lens, not only in this field.
      if (l.stopBasis !== 'stated') expect(l.notes.join(' '), l.key).toMatch(/assumed|placed at the first vertex|has no stop of its own/);
    }
  });

  it('has well-formed surfaces', () => {
    const coatings: (string | null)[] = [null, ...COATINGS.map((c) => c.key)];
    for (const l of lenses) {
      expect(l.surfaces.length, l.key).toBeGreaterThanOrEqual(3);
      l.surfaces.forEach((s, i) => {
        const at = `${l.key}[${i}]`;
        expect(['sphere', 'plane', 'asphere', 'cylinder', 'mirror'], at).toContain(s.kind);
        expect(['normal', 'stop'], at).toContain(s.role);
        expect(coatings, at).toContain(s.coating);
        if (s.kind === 'plane') expect(s.r, at).toBeNull();
        else {
          expect(Number.isFinite(s.r), at).toBe(true);
          expect(s.r, at).not.toBe(0);
        }
        // The stop is a plane, or the primary mirror of the mirror lens (its clear aperture is the entrance pupil).
        if (s.role === 'stop') expect(['plane', 'mirror'], at).toContain(s.kind);
        if (s.kind === 'cylinder') expect(['x', 'y'], at).toContain(s.axis);
        else expect(s.axis, at).toBeUndefined();
        if (s.semiAperture !== null) expect(s.semiAperture, at).toBeGreaterThan(0);
        // Only the last surface may lack a distance (and then only because the source does not list a back focus).
        if (i < l.surfaces.length - 1) expect(Number.isFinite(s.d), at).toBe(true);
      });
      // A lens ends in air; the mirror lens is the only one whose distances turn negative.
      expect(l.surfaces[l.surfaces.length - 1].glass, l.key).toBeNull();
      const mirrors = l.surfaces.filter((s) => s.kind === 'mirror').length;
      expect(mirrors === 0 || l.key === 'catadioptric_mirror', l.key).toBe(true);
      if (mirrors === 0) l.surfaces.slice(0, -1).forEach((s, i) => expect(s.d!, `${l.key}[${i}]`).toBeGreaterThanOrEqual(0));
    }
  });

  it('stores glass as nd and vd only, within the range of real glass', () => {
    const allowed = new Set(['nd', 'vd', 'dPgF', 'vdEstimated', 'native']);
    let glasses = 0;
    for (const l of lenses) {
      l.surfaces.forEach((s, i) => {
        if (!s.glass) return;
        glasses++;
        const at = `${l.key}[${i}]`;
        for (const k of Object.keys(s.glass)) expect(allowed.has(k), `${at}.${k}`).toBe(true);
        expect(s.glass.nd, at).toBeGreaterThanOrEqual(1.4);
        expect(s.glass.nd, at).toBeLessThanOrEqual(2.1);
        expect(s.glass.vd, at).toBeGreaterThanOrEqual(15);
        expect(s.glass.vd, at).toBeLessThanOrEqual(100);
        if (s.glass.native) {
          expect(s.glass.native.n, at).toBeGreaterThanOrEqual(1.4);
          expect(s.glass.native.n, at).toBeLessThanOrEqual(2.1);
          // nd is the e-line index converted with nd = ne - 0.238 (nF - nC): a little below ne.
          expect(s.glass.nd, at).toBeLessThan(s.glass.native.n);
          expect(s.glass.native.n - s.glass.nd, at).toBeLessThan(0.02);
        }
        if (s.glass.dPgF !== undefined) expect(Math.abs(s.glass.dPgF), at).toBeLessThan(0.1);
      });
    }
    expect(glasses).toBeGreaterThan(70);
  });

  it('puts a coating on the air-glass surfaces and on nothing else', () => {
    for (const l of lenses) {
      l.surfaces.forEach((s, i) => {
        const before = i === 0 ? null : l.surfaces[i - 1].glass;
        const refractive = s.role === 'normal' && s.kind !== 'mirror' && (before === null) !== (s.glass === null);
        expect(s.coating !== null, `${l.key}[${i}]`).toBe(refractive);
      });
    }
  });

  it('counts the elements the research lists for each family', () => {
    for (const [key, count] of Object.entries(ELEMENTS)) {
      const l = lensPrescription(key)!;
      const elements = l.surfaces.filter((s) => s.glass !== null).length;
      expect(elements, key).toBe(count);
    }
  });

  it('lets a mirror keep the medium it reflects in', () => {
    const mirrorLens = lensPrescription('catadioptric_mirror')!;
    mirrorLens.surfaces.forEach((s, i) => {
      if (s.kind !== 'mirror') return;
      const before = i === 0 ? null : mirrorLens.surfaces[i - 1].glass;
      expect(s.glass, `mirror ${i}`).toEqual(before);
    });
    expect(mirrorLens.obstructionRatio).toBe(0.49);
  });
});

describe('lens prescriptions: paraxial focal length and back focus', () => {
  const afocal = lenses.filter((l) => l.reported.angularMagnification !== undefined).map((l) => l.key);

  for (const l of lenses.filter((x) => !afocal.includes(x.key))) {
    it(`${l.key}: EFL and BFL agree with the research trace`, () => {
      const tolReport = l.reported.toleranceRel ?? 5e-4;
      // With the source's own indices (the report's check) ...
      const native = paraxial(l.surfaces, { index: nativeIndex });
      // ... and with the d-line indices we store.
      const stored = paraxial(l.surfaces);
      for (const t of [native, stored]) {
        near(t.efl, l.reported.eflMm!, tolReport, 'EFL');
        if (l.reported.bflMm !== null) near(t.bfl, l.reported.bflMm, tolReport, 'BFL');
        if (l.reported.imageBehindFirstVertexMm !== undefined) expect(Math.abs(t.zLast + t.bfl - l.reported.imageBehindFirstVertexMm), 'image').toBeLessThan(0.05);
      }
      // Against what the patent itself states: the tolerance the report gives, 1 %.
      const tol = l.reported.patentToleranceRel ?? 0.01;
      if (l.reported.patent?.bflMm !== undefined) near(stored.bfl, l.reported.patent.bflMm, tol, 'patent BFL');
      if (l.reported.patent?.eflMm !== undefined) near(stored.efl, l.reported.patent.eflMm, tol, 'patent EFL');
      // A lens that is not scaled is the patent's own design; the scaled ones are normalised to f of about 100 mm.
      if (l.scaled) near(stored.efl, 100, 0.015, 'normalised EFL');
      else near(stored.efl, l.referenceFocalMm!, 0.0005, 'native EFL');
    });
  }

  it('the back focus listed as the last distance is the source\'s own', () => {
    // Only the Petzval type, the five-element and the Gauss list one; the others end at the paraxial focus.
    const listed = lenses.filter((l) => l.surfaces[l.surfaces.length - 1].d !== null).map((l) => l.key);
    expect(listed).toEqual(['petzval_portrait', 'symmetric_5', 'double_gauss_normal']);
    for (const key of listed) {
      const l = lensPrescription(key)!;
      near(paraxial(l.surfaces).bfl, l.surfaces[l.surfaces.length - 1].d!, 0.01, key);
    }
  });

  it('the telephoto is shorter than its focal length, as a telephoto must be', () => {
    const l = lensPrescription('telephoto_internal_focus')!;
    const t = paraxial(l.surfaces);
    const track = t.zLast + t.bfl;
    near(track, l.reported.trackMm!, 0.005, 'track');
    expect(track).toBeLessThan(t.efl);
  });

  it('the inverted telephoto has a back focus longer than its focal length', () => {
    const t = paraxial(lensPrescription('inverted_telephoto_wide')!.surfaces);
    expect(t.bfl).toBeGreaterThan(t.efl);
  });

  it('the mirror lens folds the path back and focuses behind its primary', () => {
    const l = lensPrescription('catadioptric_mirror')!;
    const t = paraxial(l.surfaces);
    expect(t.zLast).toBeLessThan(0);
    expect(t.zLast + t.bfl).toBeGreaterThan(0);
  });

  it('the angular magnification of the 2x adapter is 1/2 in the squeeze meridian and 1 in the other', () => {
    const l = lensPrescription('anamorphic_adapter_2x')!;
    const squeeze = paraxial(l.surfaces, { meridian: 'x', y0: 0, u0: 0.01 });
    near(squeeze.u / 0.01, l.reported.angularMagnification!, 1e-4, 'angular magnification');
    const flat = paraxial(l.surfaces, { meridian: 'y', y0: 0, u0: 0.01 });
    near(flat.u / 0.01, 1, 1e-12, 'other meridian');
    // Afocal: a parallel beam leaves parallel, and it is twice as wide as it came in.
    const beam = paraxial(l.surfaces, { meridian: 'x' });
    expect(Math.abs(beam.u)).toBeLessThan(1e-6);
    near(beam.y, l.reported.pupilMagnification!, 1e-4, 'pupil magnification');
  });
});

describe('lens prescriptions: focus and variable gaps', () => {
  const focusing = lenses.filter((l) => l.focus.moving);

  it('lists the moving gaps against the distances of the prescription', () => {
    expect(focusing.map((l) => l.key)).toEqual(['telephoto_internal_focus', 'macro_floating']);
    for (const l of focusing) {
      expect(['internal', 'floating']).toContain(l.focus.mode);
      for (const m of l.focus.moving!) {
        expect(l.surfaces[m.surface].d, `${l.key} surface ${m.surface}`).toBe(m.dBase);
        expect(m.dNear).toBeGreaterThan(0);
      }
    }
    for (const l of lenses.filter((x) => !x.focus.moving)) expect(['unit', 'none'], l.key).toContain(l.focus.mode);
  });

  it('the internal-focus telephoto loses focal length when it focuses close (breathing)', () => {
    const l = lensPrescription('telephoto_internal_focus')!;
    const far = paraxial(l.surfaces);
    const close = paraxial(l.surfaces, { d: nearDistances(l) });
    near(close.efl, l.reported.nearEflMm!, 0.001, 'EFL focused at 1/10');
    near(close.efl / far.efl, 0.8962, 0.001, 'breathing');
  });

  it('the floating macro changes its focal length by a hair when it floats', () => {
    const l = lensPrescription('macro_floating')!;
    const base = paraxial(l.surfaces);
    const floated = paraxial(l.surfaces, { d: nearDistances(l) });
    near(floated.efl, l.reported.nearEflMm!, 0.0001, 'floated EFL');
    near(floated.efl, l.reported.patent!.nearEflMm!, 0.0001, 'patent floated EFL');
    expect(floated.efl).toBeLessThan(base.efl);
  });

  it('the soft-focus gap dials the focus a little and the spherical aberration a lot', () => {
    const l = lensPrescription('soft_focus_variable')!;
    const v = l.variable![0];
    expect(l.surfaces[v.surface].d).toBe(v.normal);
    const normal = paraxial(l.surfaces);
    const soft = paraxial(l.surfaces, { d: { [v.surface]: v.soft } });
    expect(Math.abs(soft.efl - normal.efl) / normal.efl).toBeLessThan(0.01);
    expect(soft.bfl).toBeLessThan(normal.bfl);
    // The research table: over-corrected at the smallest gap, under-corrected and falling as it opens.
    const lsa = v.measuredLsaPctOfF;
    expect(lsa.map(([d]) => d)).toEqual([...lsa.map(([d]) => d)].sort((a, b) => a - b));
    expect(lsa[0][1]).toBeGreaterThan(0);
    for (let i = 1; i < lsa.length; i++) expect(lsa[i][1]).toBeLessThan(lsa[i - 1][1]);
    expect(v.min).toBe(lsa[0][0]);
    expect(v.max).toBe(lsa[lsa.length - 1][0]);
    expect(v.soft).toBeGreaterThan(v.normal);
  });
});

describe('lens prescriptions: aperture and field', () => {
  it('derives an f-number from the stop only where the source states none', () => {
    const derived = lenses.filter((l) => l.fNumberBasis === 'derived');
    expect(derived.map((l) => l.key)).toEqual(['symmetric_5', 'double_gauss_normal']);
    for (const l of derived) {
      const stop = l.surfaces.findIndex((s) => s.role === 'stop');
      const t = paraxial(l.surfaces);
      // The entrance pupil radius is the stop semi-aperture over the ratio of the marginal ray heights.
      const pupilRadius = l.surfaces[stop].semiAperture! / t.heights[stop];
      near(t.efl / (2 * pupilRadius), l.fNumber!, 0.005, `${l.key} f-number`);
    }
    // Lenses whose stop radius was derived from the stated f-number sit at the entrance pupil: the check closes.
    for (const key of ['achromat_doublet', 'catadioptric_mirror']) {
      const l = lensPrescription(key)!;
      const stop = l.surfaces.findIndex((s) => s.role === 'stop');
      expect(l.derived, key).toContain('surfaces[0].semiAperture');
      expect(stop, key).toBe(0);
      near(paraxial(l.surfaces).efl / (2 * l.surfaces[0].semiAperture!), l.fNumber!, 0.005, `${key} f-number`);
    }
    for (const l of lenses) expect(l.fNumberBasis === null, l.key).toBe(l.fNumber === null);
  });

  it('keeps the iris within the lens aperture and the image circle with the field angle', () => {
    for (const l of lenses) {
      expect(l.iris.blades, l.key).toBe(0);
      expect(l.iris.fNumberMin, l.key).toBe(l.fNumber);
      if (l.iris.fNumberMin !== null && l.iris.fNumberMax !== null) expect(l.iris.fNumberMax, l.key).toBeGreaterThanOrEqual(l.iris.fNumberMin);
      if (l.imageCircleMm !== null) {
        expect(l.derived, l.key).toContain('imageCircleMm');
        expect(l.fieldDeg, l.key).not.toBeNull();
        expect(Math.abs(l.imageCircleMm - 2 * l.referenceFocalMm! * Math.tan((l.fieldDeg! * Math.PI) / 360)), l.key).toBeLessThan(0.06);
      }
    }
    expect(lensPrescription('fisheye_180')!.imageCircleMm).toBeNull();
  });
});

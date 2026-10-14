// The effect filters of a lens (phase O3a): the data mirror rt-core `optics::filters`, the project's side
// (core/optics.ts), the LENS filter slots of the RSB writer byte for byte with rt, the image-space approximation
// of the Fast viewport (render/lens-filter-image.ts), and with the real rt.wasm the engine's pinned image of the
// O3a scene and the approximation against the engine in a white furnace.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeCamera, type CameraState } from '../src/core/camera';
import { filterActive, filtersOf, isNeutralOptics, newLensFilter, normalizeOptics, OPTICS_NEUTRAL, opticsForBokeh, type CameraOptics, type LensFilter } from '../src/core/optics';
import {
  FILTER_PSF,
  filterS,
  gradeS,
  LENS_FILTER_GRADES,
  LENS_FILTER_S,
  LENS_FILTER_STAR_S,
  LENS_FILTER_STREAK_S,
  LENS_FILTERS,
  lineLengthDeg,
  NET_LENGTH_DEG,
  STAR_LENGTH_DEG,
} from '../src/data/lens-filters';
import { applyLensFilters, filterKernel, pixelsPerRadian, TAIL_FIT, type LinearImage } from '../src/render/lens-filter-image';
import { cameraToRsb, filtersToRsb, lensToRsb, writeRsb, type RsbScene } from '../src/io/rsb';
import { readRsb } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const RUST = readFileSync('engine/crates/rt-core/src/optics/filters.rs', 'utf8');

/** A constant of the Rust module: a number, or an array of numbers. */
function rustConst(name: string): number | number[] {
  const m = RUST.match(new RegExp(`pub const ${name}: [^=]+= ([^;]+);`));
  if (!m) throw new Error(`no ${name} in filters.rs`);
  const v = m[1].trim();
  if (v.startsWith('[')) return v.slice(1, -1).split(',').map((x) => Number(x.trim().replace(/_/g, '')));
  return Number(v.replace(/_/g, ''));
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const camera = (patch: Partial<CameraState> = {}): CameraState => ({ ...makeCamera('cam1', '', 200), ...patch });
const withFilters = (...filters: LensFilter[]): CameraOptics => ({ ...OPTICS_NEUTRAL, filters });
const filter = (type: LensFilter['type'], grade = 1, patch: Partial<LensFilter> = {}): LensFilter => ({ ...newLensFilter(type), grade, ...patch });

describe('the filter data', () => {
  it('are the engine’s: kinds, grades, PSF widths and default tints', () => {
    const kinds: Record<string, string> = {
      DIFFUSION_WHITE: 'FILTER_DIFFUSION_WHITE',
      DIFFUSION_BLACK: 'FILTER_DIFFUSION_BLACK',
      DIFFUSION_GOLD: 'FILTER_DIFFUSION_GOLD',
      GLIMMER: 'FILTER_GLIMMER',
      SOFT: 'FILTER_SOFT',
      NET: 'FILTER_NET',
      STAR: 'FILTER_STAR',
      STREAK: 'FILTER_STREAK',
    };
    for (const t of LENS_FILTERS) expect(t.kind, t.key).toBe(rustConst(kinds[t.key]));
    expect(LENS_FILTERS.map((t) => t.key)).toEqual(Object.keys(kinds));
    expect(LENS_FILTER_GRADES).toEqual(rustConst('GRADES'));
    expect(LENS_FILTER_S).toEqual(rustConst('GRADE_S'));
    expect(LENS_FILTER_STAR_S).toEqual(rustConst('STAR_S'));
    expect(LENS_FILTER_STREAK_S).toEqual(rustConst('STREAK_S'));
    expect(STAR_LENGTH_DEG).toEqual(rustConst('STAR_LENGTH_DEG'));
    expect(NET_LENGTH_DEG).toEqual(rustConst('NET_LENGTH_DEG'));
    const P = FILTER_PSF;
    const pairs: [number, string][] = [
      [P.sigmaCoreDeg, 'SIGMA_CORE_DEG'],
      [P.sigmaTailDeg, 'SIGMA_TAIL_DEG'],
      [P.coreShare, 'CORE_SHARE'],
      [P.blackTransmission, 'BLACK_TRANSMISSION'],
      [P.softSScale, 'SOFT_S_SCALE'],
      [P.softMaxS, 'SOFT_MAX_S'],
      [P.glimmerSparkles, 'GLIMMER_SPARKLES'],
      [P.glimmerCloudDeg, 'GLIMMER_CLOUD_DEG'],
      [P.glimmerShare, 'GLIMMER_SHARE'],
      [P.glimmerHaloShare, 'GLIMMER_HALO_SHARE'],
      [P.glimmerSigmaDeg, 'GLIMMER_SIGMA_DEG'],
      [P.netAxisShare, 'NET_AXIS_SHARE'],
      [P.lineStartDeg, 'LINE_START_DEG'],
      [P.streakEndDeg, 'STREAK_END_DEG'],
      [P.lineWidthDeg, 'LINE_WIDTH_DEG'],
    ];
    for (const [v, name] of pairs) expect(v, name).toBe(rustConst(name));
    expect(LENS_FILTERS.find((t) => t.key === 'DIFFUSION_GOLD')!.tint).toEqual(rustConst('TINT_GOLD'));
    expect(LENS_FILTERS.find((t) => t.key === 'NET')!.tint).toEqual(rustConst('TINT_NET'));
    expect(LENS_FILTERS.find((t) => t.key === 'STREAK')!.tint).toEqual(rustConst('TINT_STREAK'));
    expect(RUST).toContain(`const TAIL_REACH: f32 = ${P.tailReach.toFixed(1)};`);
  });

  it('give every type a name and a sentence in both languages, and no brand', () => {
    for (const t of LENS_FILTERS) {
      for (const lang of ['es', 'en'] as const) {
        expect(t.name[lang].length).toBeGreaterThan(2);
        expect(t.help[lang]).toMatch(/\.$/);
      }
    }
    const all = JSON.stringify(LENS_FILTERS).toLowerCase();
    for (const brand of ['tiffen', 'pro-mist', 'promist', 'glimmerglass', 'black satin', 'schneider', 'hollywood', 'cokin', 'lee ']) expect(all).not.toContain(brand);
  });

  it('give the scattered fraction and the line lengths of the engine between and beyond the listed grades', () => {
    LENS_FILTER_GRADES.forEach((g, i) => expect(gradeS(g)).toBe(LENS_FILTER_S[i]));
    expect(gradeS(0)).toBe(0);
    expect(gradeS(0.75)).toBeCloseTo((LENS_FILTER_S[2] + LENS_FILTER_S[3]) / 2, 6);
    expect(gradeS(3)).toBe(LENS_FILTER_S[4]);
    // Each type its own table (rt-core `kind_s`): the star's and the streak's, the soft filter's twice the diffusions'.
    LENS_FILTER_GRADES.forEach((g, i) => {
      expect(filterS('STAR', g)).toBe(LENS_FILTER_STAR_S[i]);
      expect(filterS('STREAK', g)).toBe(LENS_FILTER_STREAK_S[i]);
      expect(filterS('DIFFUSION_GOLD', g)).toBe(LENS_FILTER_S[i]);
      expect(filterS('SOFT', g)).toBe(Math.min(2 * LENS_FILTER_S[i], 0.8));
      expect(lineLengthDeg('STAR', g)).toBe(STAR_LENGTH_DEG[i]);
      expect(lineLengthDeg('NET', g)).toBe(NET_LENGTH_DEG[i]);
    });
    expect(lineLengthDeg('STREAK', 1)).toBe(FILTER_PSF.streakEndDeg);
    expect(lineLengthDeg('SOFT', 1)).toBe(0);
  });
});

describe('the filters of a camera', () => {
  it('make the optics non-neutral, and a filter of grade 0 is no filter', () => {
    expect(isNeutralOptics(withFilters(filter('STAR')))).toBe(false);
    expect(isNeutralOptics(withFilters(filter('STAR', 0), filter('SOFT', 0)))).toBe(true);
    expect(filterActive(filter('NET', 0.125))).toBe(true);
  });

  it('stay when a bokeh type is chosen, and a project file is brought within the limits', () => {
    const o = withFilters(filter('DIFFUSION_GOLD', 0.5, { tint: [1, 0.5, 0.2] }));
    expect(opticsForBokeh(o, 'bubble')!.filters).toEqual(o.filters);
    const n = normalizeOptics({
      filters: [
        { type: 'STAR', grade: 9, points: 5, angleDeg: 400 },
        { type: 'NOT_A_FILTER', grade: 1 },
        { type: 'DIFFUSION_GOLD', grade: 1, tint: [-1, 1, 1] },
        { type: 'SOFT', grade: 0.25 },
        { type: 'NET', grade: 0.5 },
      ],
    });
    expect(n.filters).toEqual([
      { type: 'STAR', grade: 2, tint: null, angleDeg: 360, points: 6 },
      { type: 'DIFFUSION_GOLD', grade: 1, tint: null, angleDeg: 0, points: 6 },
      { type: 'SOFT', grade: 0.25, tint: null, angleDeg: 0, points: 6 },
    ]);
    // Optics saved before O3a keep having no filters field at all (their files do not change).
    expect('filters' in normalizeOptics({ blades: 6 })).toBe(false);
  });
});

describe('the LENS filter slots', () => {
  it('are written only when there are filters, 28 bytes each, as rt reads them', () => {
    const plain = lensToRsb({ ...OPTICS_NEUTRAL, blades: 6 }, 640, 480);
    expect(plain.filters).toBeUndefined();
    const stacked = lensToRsb(withFilters(filter('DIFFUSION_BLACK', 0.5), filter('STAR', 1, { angleDeg: 15, points: 8 }), filter('STREAK', 0.5, { tint: [0.2, 0.4, 1] })), 640, 480);
    expect(stacked.filters).toEqual([
      { kind: 2, grade: 0.5, tint: [0, 0, 0], angleDeg: 0, points: 0 },
      { kind: 7, grade: 1, tint: [0, 0, 0], angleDeg: 15, points: 8 },
      { kind: 8, grade: 0.5, tint: [0.2, 0.4, 1], angleDeg: 0, points: 0 },
    ]);
    const cam = cameraToRsb(camera({ optics: withFilters(filter('SOFT', 2)) }), 640, 480, 640, 480);
    expect(cam.lens?.filters?.[0]).toEqual({ kind: 5, grade: 2, tint: [0, 0, 0], angleDeg: 0, points: 0 });
    expect(filtersToRsb([filter('NET', 1, { angleDeg: 30, tint: null })])).toEqual([{ kind: 6, grade: 1, tint: [0, 0, 0], angleDeg: 30, points: 0 }]);
  });

  it('round-trip the O3a fixture byte for byte with rt (tests/fixtures/o3a.rsb)', () => {
    const bytes = new Uint8Array(readFileSync('tests/fixtures/o3a.rsb'));
    const scene = readRsb(bytes) as RsbScene;
    expect(scene.camera.lens?.filters?.map((f) => f.kind)).toEqual([2, 7, 8]);
    expect(sameBytes(writeRsb(scene), bytes)).toBe(true);
    // And the O1 fixture, without filters, stays the O1 bytes.
    const o1 = new Uint8Array(readFileSync('tests/fixtures/o1.rsb'));
    const o1Scene = readRsb(o1) as RsbScene;
    expect(o1Scene.camera.lens?.filters).toBeUndefined();
    expect(sameBytes(writeRsb(o1Scene), o1)).toBe(true);
  });
});

/** A picture of `w × h` that is 0 everywhere but a bright pixel at its centre. */
function dot(w: number, h: number, value = 1000): LinearImage {
  const rgb = new Float32Array(w * h * 3);
  const o = ((h >> 1) * w + (w >> 1)) * 3;
  rgb[o] = rgb[o + 1] = rgb[o + 2] = value;
  return { width: w, height: h, rgb };
}

const sum = (img: LinearImage, c = 1) => {
  let s = 0;
  for (let i = c; i < img.rgb.length; i += 3) s += img.rgb[i];
  return s;
};

describe('the image-space approximation', () => {
  it('keeps the energy of a point (white diffusion, star, glimmer) and the black diffusion takes s·(1 − a)', () => {
    const ppr = pixelsPerRadian(256, 85, 36);
    const img = dot(256, 256);
    for (const type of ['DIFFUSION_WHITE', 'STAR', 'GLIMMER', 'SOFT', 'NET'] as const) {
      const out = applyLensFilters(img, [filter(type, 1)], ppr);
      // Energy that leaves the picture is lost: nearly none here.
      expect(sum(out) / sum(img), type).toBeGreaterThan(0.97);
      expect(sum(out) / sum(img), type).toBeLessThan(1.0001);
    }
    // The black diffusion is the white one with a times the scattered light (what leaves the picture included).
    const s = gradeS(1);
    const white = sum(applyLensFilters(img, [filter('DIFFUSION_WHITE', 1)], ppr)) / sum(img);
    const black = sum(applyLensFilters(img, [filter('DIFFUSION_BLACK', 1)], ppr)) / sum(img);
    expect(black).toBeCloseTo(1 - s + FILTER_PSF.blackTransmission * (white - (1 - s)), 6);
    expect(black).toBeLessThan(1 - s * (1 - FILTER_PSF.blackTransmission) + 1e-6);
  }, 60000);

  it('draws a six-point star at its angle', () => {
    const ppr = pixelsPerRadian(256, 85, 36);
    const out = applyLensFilters(dot(256, 256), [filter('STAR', 2, { angleDeg: 15, points: 6 })], ppr);
    const bins = new Array(360).fill(0);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const dx = x - 128;
        const dy = 128 - y;
        if (Math.hypot(dx, dy) < 20) continue;
        const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        bins[Math.floor(a)] += out.rgb[(y * 256 + x) * 3 + 1];
      }
    }
    const total = bins.reduce((a, b) => a + b, 0);
    for (let k = 0; k < 6; k++) {
      const at = (15 + 60 * k) % 360;
      let near = 0;
      for (let d = -2; d <= 2; d++) near += bins[(at + d + 360) % 360];
      expect(near / total, `line ${k}`).toBeGreaterThan(0.12);
    }
  }, 60000);

  it('warms the gold diffusion’s halo and not its core, and fits the Cauchy tail with shares that add up to 1', () => {
    const ppr = pixelsPerRadian(128, 85, 36);
    const img = dot(128, 128);
    const out = applyLensFilters(img, [filter('DIFFUSION_GOLD', 2)], ppr);
    const ring = (from: number, to: number) => {
      let r = 0;
      let b = 0;
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const d = Math.hypot(x - 64, y - 64);
          if (d < from || d >= to) continue;
          r += out.rgb[(y * 128 + x) * 3];
          b += out.rgb[(y * 128 + x) * 3 + 2];
        }
      }
      return r / b;
    };
    expect(ring(8, 64)).toBeGreaterThan(1.15);
    expect(ring(0, 1)).toBeLessThan(1.02);
    expect(TAIL_FIT.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 6);
    // The tint is on the wide parts only: the core's colour weight is neutral, the tail's and the lines' the tint.
    const gold = filterKernel(filter('DIFFUSION_GOLD', 1), ppr)!;
    expect(gold.gaussians[0].weight).toEqual([1, 1, 1]);
    expect(gold.gaussians[1].weight[0]).toBeGreaterThan(gold.gaussians[1].weight[2]);
    const net = filterKernel(filter('NET', 1), ppr)!;
    expect(net.gaussians[0].weight).toEqual([1, 1, 1]);
    expect(net.lines!.weight[0]).toBeGreaterThan(net.lines!.weight[2]);
  }, 60000);

  it('makes the star’s rays as long as the grade says, and the net’s cross short', () => {
    const ppr = pixelsPerRadian(512, 85, 36);
    const reach = (type: LensFilter['type'], grade: number) => {
      const k = filterKernel(filter(type, grade, { points: 6 }), ppr)!;
      return Math.max(...k.lines!.taps.filter((t) => t.w > 0).map((t) => t.r)) / ppr;
    };
    for (const [g, i] of [[0.25, 1], [1, 3], [2, 4]] as const) {
      expect(reach('STAR', g) / ((STAR_LENGTH_DEG[i] * Math.PI) / 180)).toBeGreaterThan(0.9);
      expect(reach('STAR', g) / ((STAR_LENGTH_DEG[i] * Math.PI) / 180)).toBeLessThan(1);
    }
    expect(reach('NET', 2)).toBeLessThan((NET_LENGTH_DEG[4] * Math.PI) / 180);
    // The taps' weights add up to the whole line.
    const k = filterKernel(filter('STAR', 1), ppr)!;
    expect(k.lines!.taps.reduce((a, t) => a + t.w, 0)).toBeCloseTo(1, 6);
  }, 60000);

  it('gives no kernel for a filter of grade 0', () => {
    expect(filterKernel(filter('STAR', 0), 1000)).toBeNull();
    expect(filtersOf(undefined)).toEqual([]);
  }, 60000);
});

describe.skipIf(!RT_WASM)('the real rt.wasm', () => {
  it('renders the O3a fixture to the native engine’s pinned hash', async () => {
    const rt = await loadRt();
    const rsb = new Uint8Array(readFileSync('tests/fixtures/o3a.rsb'));
    const { image } = renderWithPasses(rt, rsb, 256, 192, 4, 0);
    expect(fnv1a(resolveRgb(image, 4)).toString(16)).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_O3A_FILTERS_4SPP').toString(16));
  }, 120000);

  it('the approximation of the black diffusion matches the engine in a white furnace within 2 % on average', async () => {
    const rt = await loadRt();
    // The example's parts in a white furnace: a uniform white world, no floor, no lights.
    const base = readRsb(new Uint8Array(readFileSync('tests/fixtures/example.rsb'))) as RsbScene;
    const [w, h, spp] = [96, 72, 128];
    const furnace: RsbScene = {
      ...base,
      lights: [],
      environment: { ...base.environment, kind: 1, floor: 1, horizon: 1, zenith: 1, strength: 1, backgroundMode: 0 },
      floor: { ...base.floor, mode: 0 },
      render: { ...base.render, width: w, height: h, maxSamples: spp },
    };
    const optics = withFilters(filter('DIFFUSION_BLACK', 1));
    const lens = lensToRsb(optics, w, h);
    const render = (scene: RsbScene) => resolveRgb(renderWithPasses(rt, writeRsb(scene), w, h, spp, 0).image, spp);
    const plain = render(furnace);
    const engine = render({ ...furnace, camera: { ...furnace.camera, lens } });
    const ppr = pixelsPerRadian(w, furnace.camera.focalMm, furnace.camera.sensorMm);
    const approx = applyLensFilters({ width: w, height: h, rgb: Float32Array.from(plain) }, filtersOf(optics), ppr);
    // Compared over 4 × 4 blocks, so the sampling noise of the two renders does not count as a difference.
    const blocks = (img: ArrayLike<number>) => {
      const out: number[] = [];
      for (let by = 0; by < h; by += 4) {
        for (let bx = 0; bx < w; bx += 4) {
          for (let c = 0; c < 3; c++) {
            let s = 0;
            for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) s += img[(y * w + x) * 3 + c];
            out.push(s / 16);
          }
        }
      }
      return out;
    };
    const [e, a, p] = [blocks(engine), blocks(approx.rgb), blocks(plain)];
    const mean = e.reduce((x, y) => x + y, 0);
    const diff = e.reduce((x, v, i) => x + Math.abs(a[i] - v), 0) / mean;
    expect(diff).toBeLessThan(0.02);
    // And the filter did something the comparison sees: without it the difference is larger.
    const without = e.reduce((x, v, i) => x + Math.abs(p[i] - v), 0) / mean;
    expect(without).toBeGreaterThan(1.5 * diff);
  }, 240000);
});

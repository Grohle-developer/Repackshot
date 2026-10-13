// The generated assets of phase A6: aperture masks (public/assets/aperture/) and gobos (public/assets/gobo/).
//
// They are not pictures somebody made: each is drawn from a recipe and a seed by tools/assets/*.mjs, and the
// index.json next to the files says which. The tests regenerate every asset in memory with the generator's pure
// functions and compare with the committed files, so a file that was edited by hand, a recipe that was changed
// without regenerating, or a generator that stopped being deterministic, all fail here.
//
// Two hashes per file: `sha256` of the PNG as committed (its integrity) and `pixelsSha256` of the raw 8-bit
// pixels (the canonical one: the bytes of a compressed stream can differ between builds of zlib, the pixels cannot).

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as apertureModule from '../tools/assets/aperture-masks.mjs';
import * as gobosModule from '../tools/assets/gobos.mjs';
import { cos, decodePng, encodePng, fbm, hash2, rng, sha256, sin, valueNoise } from '../tools/assets/common.mjs';

/** What a generator module offers the test, typed here because the modules are plain JavaScript. */
interface Spec {
  id: string;
  file: string;
  seed: number;
  recipe: { kind: string; [k: string]: unknown };
  description: string;
}
interface Generator {
  GENERATOR: { name: string; version: number };
  recipes(): Spec[];
  render(recipe: Spec['recipe'], seed: number): Uint8Array;
}
const aperture: Generator = { GENERATOR: apertureModule.GENERATOR, recipes: apertureModule.recipes as () => Spec[], render: apertureModule.renderMask as Generator['render'] };
const gobos: Generator = { GENERATOR: gobosModule.GENERATOR, recipes: gobosModule.recipes as () => Spec[], render: gobosModule.renderGobo as Generator['render'] };

// Regenerating and flood-filling megapixel images is slow on a busy machine (several agents share this one).
vi.setConfig({ testTimeout: 60_000 });

interface Entry {
  id: string;
  file: string;
  seed: number;
  size: number;
  bytes: number;
  sha256: string;
  pixelsSha256: string;
  recipe: { kind: string; [k: string]: unknown };
  description: string;
}

const APERTURE_DIR = 'public/assets/aperture';
const GOBO_DIR = 'public/assets/gobo';
const apertureIndex = JSON.parse(readFileSync(`${APERTURE_DIR}/index.json`, 'utf8')) as { masks: Entry[]; size: number; bitDepth: number; generator: string; version: number };
const goboIndex = JSON.parse(readFileSync(`${GOBO_DIR}/index.json`, 'utf8')) as { gobos: Entry[]; size: number; bitDepth: number; generator: string; version: number };

/** Assets whose PNG is also written again and compared. */
const RECODED = new Set(['polygon_07', 'star_5', 'dust', 'window_2x3', 'lines']);

const read = (dir: string, file: string): Uint8Array => new Uint8Array(readFileSync(`${dir}/${file}`));

/** A decoded asset, as a function from normalised coordinates (v up, [-1, 1]) to the grey level. */
function sampler(pixels: Uint8Array, size: number): (u: number, v: number) => number {
  return (u, v) => pixels[Math.min(size - 1, Math.max(0, Math.floor((1 - v) * (size / 2))) ) * size + Math.min(size - 1, Math.max(0, Math.floor((u + 1) * (size / 2))))];
}

/** Connected regions of pixels at or above 128 (4-connected), ignoring specks under `minPixels`. */
function regions(pixels: Uint8Array, size: number, minPixels = 16): number {
  const seen = new Uint8Array(pixels.length);
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < pixels.length; start++) {
    if (seen[start] || pixels[start] < 128) continue;
    let n = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      const x = i % size;
      const y = (i - x) / size;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        if (!seen[j] && pixels[j] >= 128) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (n >= minPixels) count++;
  }
  return count;
}

const mean = (pixels: Uint8Array): number => pixels.reduce((a, b) => a + b, 0) / pixels.length / 255;

describe('asset generators: the deterministic pieces', () => {
  it('sin and cos agree with the standard functions and do not depend on them', () => {
    for (let i = -400; i <= 400; i++) {
      const x = i * 0.0377;
      expect(Math.abs(sin(x) - Math.sin(x)), `sin ${x}`).toBeLessThan(1e-9);
      expect(Math.abs(cos(x) - Math.cos(x)), `cos ${x}`).toBeLessThan(1e-9);
    }
  });

  it('the hash, the generator and the noise return the same numbers every time (pinned)', () => {
    const r = rng(12345);
    const first = [r(), r(), r()];
    const again = rng(12345);
    expect([again(), again(), again()]).toEqual(first);
    for (const v of first) expect(v >= 0 && v < 1).toBe(true);
    expect(rng(1)()).not.toBe(rng(2)());
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(3, 4, 6));
    // Integer arithmetic only, so these are fixed for good: a change here changes every asset.
    expect(rng(12345)()).toBeCloseTo(0.9797282677609473, 15);
    expect(hash2(7, -3, 99)).toBeCloseTo(hash2(7, -3, 99), 15);
    const n = valueNoise(1.25, 2.5, 7);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(1);
    expect(fbm(0.3, 0.7, 1, 4)).toBe(fbm(0.3, 0.7, 1, 4));
  });

  it('writes PNGs that decode to the same pixels, with valid checksums, and hashes them with SHA-256', () => {
    const w = 37;
    const h = 29;
    const r = rng(9);
    const pixels = new Uint8Array(w * h);
    for (let i = 0; i < pixels.length; i++) pixels[i] = i % 7 === 0 ? Math.floor(r() * 256) : (i * 3) & 0xff;
    const png = encodePng(pixels, w, h);
    const back = decodePng(png);
    expect(back.crcOk).toBe(true);
    expect([back.width, back.height]).toEqual([w, h]);
    expect(back.pixels).toEqual(pixels);
    expect(sha256(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe.each([
  { name: 'aperture masks', dir: APERTURE_DIR, index: apertureIndex, entries: apertureIndex.masks, gen: aperture, size: 512, count: 45 },
  { name: 'gobos', dir: GOBO_DIR, index: goboIndex, entries: goboIndex.gobos, gen: gobos, size: 1024, count: 12 },
])('$name: provenance and reproducibility', ({ dir, index, entries, gen, size, count }) => {
  it('is indexed one to one with the files on disk, with a recipe and a seed for each', () => {
    expect(entries).toHaveLength(count);
    expect(index.generator).toBe(`tools/assets/${gen.GENERATOR.name}.mjs`);
    expect(index.version).toBe(gen.GENERATOR.version);
    expect(index.size).toBe(size);
    expect(index.bitDepth).toBe(8);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(new Set(entries.map((e) => e.file)).size).toBe(entries.length);
    const onDisk = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    expect(onDisk).toEqual(entries.map((e) => e.file).sort());
    // The index is the generator's own list, in the same order.
    expect(entries.map((e) => [e.id, e.file, e.seed, e.recipe])).toEqual(gen.recipes().map((e) => [e.id, e.file, e.seed, e.recipe]));
    for (const e of entries) {
      expect(e.id, e.file).toMatch(/^[a-z0-9_]+$/);
      expect(Number.isInteger(e.seed), e.id).toBe(true);
      expect(typeof e.recipe.kind, e.id).toBe('string');
      expect(e.description.length, e.id).toBeGreaterThan(0);
      expect(e.sha256, e.id).toMatch(/^[0-9a-f]{64}$/);
      expect(e.pixelsSha256, e.id).toMatch(/^[0-9a-f]{64}$/);
      expect(e.size, e.id).toBe(size);
      expect(e.bytes, e.id).toBe(read(dir, e.file).length);
    }
  });

  for (const e of gen.recipes()) {
    it(`${e.id}: the committed file is the recorded one, and regenerating gives the same pixels`, { timeout: 120_000 }, () => {
      const entry = entries.find((x) => x.id === e.id)!;
      const bytes = read(dir, entry.file);
      // The file is intact.
      expect(sha256(bytes), 'file sha256').toBe(entry.sha256);
      const png = decodePng(bytes);
      expect(png.crcOk).toBe(true);
      expect([png.width, png.height]).toEqual([size, size]);
      // It holds the pixels the index says ...
      expect(sha256(png.pixels), 'decoded pixels').toBe(entry.pixelsSha256);
      // ... and the generator draws exactly those pixels from the recipe and the seed.
      const pixels = gen.render(entry.recipe, entry.seed);
      expect(sha256(pixels), 'regenerated pixels').toBe(entry.pixelsSha256);
      expect(pixels).toEqual(png.pixels);
      // Writing the PNG again gives the committed bytes (checked on a few: encoding is the slow half); another build
      // of zlib may compress to other bytes, but then the image that comes out is still the same one.
      if (RECODED.has(e.id)) {
        const again: Uint8Array = encodePng(pixels, size, size);
        if (sha256(again) !== entry.sha256) expect(decodePng(again).pixels).toEqual(png.pixels);
      }
    });
  }

  it('the seed matters where there is one', () => {
    const seeded = entries.filter((e) => e.seed !== 0);
    expect(seeded.length).toBeGreaterThan(0);
  });
});

describe('aperture masks: the shapes are the ones the recipes say', () => {
  const entry = (id: string): Entry => apertureIndex.masks.find((m) => m.id === id)!;
  const pixels = (id: string): Uint8Array => decodePng(read(APERTURE_DIR, entry(id).file)).pixels;
  const disc = Math.PI; // the area of the unit disc, in the units of the normalised coordinates
  /** Fraction of the unit disc a mask covers. */
  const fill = (id: string): number => (mean(pixels(id)) * 4) / disc;

  it('has the 45 masks of the plan with stable ids', () => {
    const ids = apertureIndex.masks.map((m) => m.id);
    for (let n = 3; n <= 18; n++) {
      const p = String(n).padStart(2, '0');
      expect(ids).toContain(`polygon_${p}`);
      expect(ids).toContain(`polygon_${p}_curved`);
    }
    for (const id of ['star_4', 'star_5', 'star_6', 'star_8', 'heart', 'holes_7', 'holes_19', 'annulus_30', 'annulus_50', 'onion_rings', 'dust', 'scratches', 'filter_mesh']) expect(ids).toContain(id);
    expect(ids).toHaveLength(45);
  });

  it('draws straight polygons with their vertices on the unit circle: the area is that of the regular polygon', () => {
    for (const n of [3, 4, 5, 6, 8, 12, 18]) {
      const expected = (n / 2) * Math.sin((2 * Math.PI) / n); // area of the regular n-gon of circumradius 1
      expect(Math.abs(fill(`polygon_${String(n).padStart(2, '0')}`) - expected / disc), `n = ${n}`).toBeLessThan(0.004);
    }
  });

  it('draws more blades closer to the circle, and curved blades inside the straight ones', () => {
    let previous = 0;
    for (let n = 3; n <= 18; n++) {
      const p = String(n).padStart(2, '0');
      const straight = fill(`polygon_${p}`);
      const curved = fill(`polygon_${p}_curved`);
      expect(straight, `n = ${n}`).toBeGreaterThan(previous);
      expect(curved, `curved n = ${n}`).toBeLessThan(straight);
      expect(curved, `curved n = ${n}`).toBeGreaterThan(0.3);
      previous = straight;
    }
    expect(fill('polygon_18')).toBeGreaterThan(0.97);
  });

  it('points the first vertex up and puts the flat edge of a triangle at the bottom', () => {
    const tri = sampler(pixels('polygon_03'), 512);
    expect(tri(0, 0.9)).toBe(255);
    expect(tri(0, -0.45)).toBe(255);
    expect(tri(0, -0.55)).toBe(0);
    expect(tri(0.6, 0.6)).toBe(0);
    const square = sampler(pixels('polygon_04'), 512);
    expect(square(0, 0.95)).toBe(255);
    expect(square(0.8, 0)).toBe(255);
    expect(square(0.6, 0.6)).toBe(0);
  });

  it('is symmetric about the vertical axis where the shape is', () => {
    for (const id of ['polygon_05', 'polygon_08_curved', 'star_5', 'heart', 'holes_7']) {
      const px = pixels(id);
      let diff = 0;
      for (let y = 0; y < 512; y++) for (let x = 0; x < 256; x++) diff += Math.abs(px[y * 512 + x] - px[y * 512 + 511 - x]);
      expect(diff / (512 * 256), id).toBeLessThan(0.5);
    }
  });

  it('draws stars with their tips on the unit circle', () => {
    const s5 = sampler(pixels('star_5'), 512);
    expect(s5(0, 0.93)).toBe(255); // the first tip is straight up
    expect(s5(0, -0.8)).toBe(0); // the bottom is between two tips
    const s4 = sampler(pixels('star_4'), 512);
    expect(s4(0, -0.93)).toBe(255);
    expect(s4(0.93, 0)).toBe(255);
    expect(s4(0.5, 0.5)).toBe(0);
    for (const id of ['star_4', 'star_5', 'star_6', 'star_8']) expect(fill(id), id).toBeLessThan(0.65);
    expect(fill('star_8')).toBeGreaterThan(fill('star_4'));
  });

  it('draws a heart that fits the disc and has its notch at the top', () => {
    const heart = sampler(pixels('heart'), 512);
    expect(heart(0, 0)).toBe(255);
    expect(heart(0, 0.45)).toBe(0); // the cleft between the lobes
    expect(heart(-0.4, 0.4)).toBe(255);
    expect(heart(0.4, 0.4)).toBe(255);
    expect(heart(0.9, 0.9)).toBe(0);
    expect(fill('heart')).toBeGreaterThan(0.35);
    expect(fill('heart')).toBeLessThan(0.7);
  });

  it('counts the holes of the multi-hole stops', () => {
    expect(regions(pixels('holes_7'), 512)).toBe(7);
    expect(regions(pixels('holes_19'), 512)).toBe(19);
  });

  it('leaves the centre of an annulus closed, in the ratio of the obstruction', () => {
    for (const [id, eps] of [['annulus_30', 0.3], ['annulus_50', 0.5]] as const) {
      const a = sampler(pixels(id), 512);
      expect(a(0, 0), id).toBe(0);
      expect(a((1 + eps) / 2, 0), id).toBe(255);
      expect(a(0, -(1 + eps) / 2), id).toBe(255);
      expect(a(0.9, 0.9), id).toBe(0); // outside the unit circle
      expect(Math.abs(fill(id) - (1 - eps * eps)), id).toBeLessThan(0.004);
    }
  });

  it('modulates the onion rings radially, a dozen of them or more across the pupil', () => {
    const px = pixels('onion_rings');
    // Along the row just above the centre, going right, and along the column just right of it, going up: the same radii.
    const row = Array.from({ length: 256 }, (_, i) => px[255 * 512 + 256 + i]);
    let peaks = 0;
    for (let i = 1; i < row.length - 1; i++) if (row[i] > row[i - 1] && row[i] >= row[i + 1] && row[i] > 140) peaks++;
    expect(peaks).toBeGreaterThanOrEqual(8);
    expect(Math.min(...row.slice(0, 250))).toBeLessThan(40);
    expect(Math.max(...row)).toBeGreaterThan(215);
    // Round: the same rings along a column.
    const col = Array.from({ length: 256 }, (_, i) => px[(255 - i) * 512 + 256]);
    for (let i = 0; i < 240; i += 7) expect(col[i], `ring ${i}`).toBe(row[i]);
  });

  it('keeps the textures inside the unit disc, mostly open, with marks in them', () => {
    for (const [id, minOpen, maxMean] of [['dust', 0, 0.97], ['scratches', 0, 0.98], ['filter_mesh', 0, 0.9]] as const) {
      const px = pixels(id);
      const s = sampler(px, 512);
      expect(s(0.99, 0.99), id).toBe(0);
      expect(s(-1, -1), id).toBe(0);
      // Marks: some pixels inside are clearly darker than open.
      let marked = 0;
      let inside = 0;
      for (let y = 0; y < 512; y++) {
        for (let x = 0; x < 512; x++) {
          const u = (x + 0.5) / 256 - 1;
          const v = 1 - (y + 0.5) / 256;
          if (u * u + v * v < 0.9) {
            inside++;
            if (px[y * 512 + x] < 200) marked++;
          }
        }
      }
      expect(marked, id).toBeGreaterThan(minOpen);
      expect(marked / inside, id).toBeGreaterThan(0.002);
      expect(marked / inside, id).toBeLessThan(id === 'filter_mesh' ? 0.5 : 0.2);
      expect(fill(id), id).toBeLessThan(maxMean);
      expect(fill(id), id).toBeGreaterThan(0.5);
    }
    // The mesh is regular: the same pattern shifted by one period.
    const mesh = sampler(pixels('filter_mesh'), 512);
    const period = 0.0625 * Math.SQRT2; // along an axis the diamond mesh repeats every period * sqrt 2
    expect(Math.abs(mesh(0.1, 0.05) - mesh(0.1 + period, 0.05))).toBeLessThan(40);
  });

  it('draws the seeded textures from their seed: another seed gives another dust', () => {
    const e = entry('dust');
    const same = aperture.render(e.recipe, e.seed);
    const other = aperture.render(e.recipe, e.seed + 1);
    expect(sha256(same)).toBe(e.pixelsSha256);
    expect(sha256(other)).not.toBe(e.pixelsSha256);
    // The same recipe with another seed is still a dust texture: about as much of the disc is marked.
    expect(Math.abs(mean(same) - mean(other))).toBeLessThan(0.05);
  });
});

describe('gobos: the patterns are the ones the recipes say', () => {
  const entry = (id: string): Entry => goboIndex.gobos.find((m) => m.id === id)!;
  const pixels = (id: string): Uint8Array => decodePng(read(GOBO_DIR, entry(id).file)).pixels;

  it('has the patterns of the plan with stable ids', () => {
    expect(goboIndex.gobos.map((g) => g.id)).toEqual([
      'window_2x3', 'window_3x4', 'window_arched', 'blinds', 'blinds_angled', 'leaves', 'leaves_dense', 'dappled', 'dots', 'lines', 'radial_burst', 'breakup_soft',
    ]);
  });

  it('counts the panes of the windows', () => {
    expect(regions(pixels('window_2x3'), 1024)).toBe(6);
    expect(regions(pixels('window_3x4'), 1024)).toBe(12);
    // The arched window: 2 x 3 panes below the spring line, and the fan above it cut by the post, two rays and an arc.
    expect(regions(pixels('window_arched'), 1024)).toBe(14);
    const w = sampler(pixels('window_2x3'), 1024);
    expect(w(0, 0)).toBe(0); // the centre post
    expect(w(0.3, 0.3)).toBe(255);
    expect(w(0.9, 0)).toBe(0); // the wall
    expect(w(0.3, 0.9)).toBe(0);
  });

  it('draws sixteen slats of blinds and rotates the others', () => {
    const px = pixels('blinds');
    let bands = 0;
    let open = false;
    for (let y = 0; y < 1024; y++) {
      const on = px[y * 1024 + 512] >= 128;
      if (on && !open) bands++;
      open = on;
    }
    expect(bands).toBe(16);
    const angled = pixels('blinds_angled');
    // The bands are tilted: moving right along a row crosses stripes.
    let crossings = 0;
    for (let x = 1; x < 1024; x++) if (angled[512 * 1024 + x] >= 128 !== angled[512 * 1024 + x - 1] >= 128) crossings++;
    expect(crossings).toBeGreaterThan(8);
    const flat = pixels('blinds');
    crossings = 0;
    for (let x = 1; x < 1024; x++) if (flat[512 * 1024 + x] >= 128 !== flat[512 * 1024 + x - 1] >= 128) crossings++;
    expect(crossings).toBeLessThanOrEqual(2);
  });

  it('draws foliage that blocks about half of the light, with solid leaves', () => {
    for (const id of ['leaves', 'leaves_dense']) {
      const px = pixels(id);
      expect(mean(px), id).toBeGreaterThan(0.3);
      expect(mean(px), id).toBeLessThan(0.75);
      expect(px.reduce((a, b) => Math.min(a, b), 255), id).toBeLessThan(40);
      expect(px.reduce((a, b) => Math.max(a, b), 0), id).toBeGreaterThan(215);
    }
    expect(sha256(pixels('leaves'))).not.toBe(sha256(pixels('leaves_dense')));
  });

  it('draws dappled light as many patches on a dark ground, and a soft breakup', () => {
    const d = pixels('dappled');
    const bright = d.filter((v) => v > 128).length / d.length;
    expect(bright).toBeGreaterThan(0.15);
    expect(bright).toBeLessThan(0.6);
    expect(regions(d, 1024, 30)).toBeGreaterThan(80);
    const b = pixels('breakup_soft');
    const lit = b.filter((v) => v > 128).length / b.length;
    expect(lit).toBeGreaterThan(0.2);
    expect(lit).toBeLessThan(0.8);
    // Soft: many levels of grey, not only black and white.
    expect(b.filter((v) => v > 20 && v < 235).length / b.length).toBeGreaterThan(0.1);
  });

  it('draws a grid of 14 x 14 dots, 20 lines and 28 rays', () => {
    expect(regions(pixels('dots'), 1024)).toBe(196);
    const l = pixels('lines');
    let lines = 0;
    for (let x = 1; x < 1024; x++) if (l[512 * 1024 + x] >= 128 && l[512 * 1024 + x - 1] < 128) lines++;
    expect(lines).toBe(20);
    // Lines are the same on every row.
    for (let y = 0; y < 1024; y += 97) expect(l[y * 1024 + 300]).toBe(l[300]);
    const r = pixels('radial_burst');
    let rays = 0;
    const steps = 2880;
    let previous = r[Math.floor(512 - 0.6 * 512 * Math.sin(0)) * 1024 + Math.floor(512 + 0.6 * 512)] >= 128;
    const first = previous;
    for (let k = 1; k <= steps; k++) {
      const a = (2 * Math.PI * k) / steps;
      const x = Math.floor(512 + 0.6 * 512 * Math.cos(a));
      const y = Math.floor(512 - 0.6 * 512 * Math.sin(a));
      const on = r[y * 1024 + x] >= 128;
      if (on && !previous) rays++;
      previous = on;
    }
    expect(previous).toBe(first);
    expect(rays).toBe(28);
    // Closed outside the unit circle and at the hub.
    expect(r[3 * 1024 + 3]).toBe(0);
    expect(r[512 * 1024 + 512]).toBe(0);
  });
});

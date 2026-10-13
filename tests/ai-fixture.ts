// The synthetic scene and "models" of engine/crates/rt-post/src/fixture.rs, step for step, so post.wasm can be
// run on the very same bits as the native tests (tests/ai-post-wasm.test.ts). Integer arithmetic only: every
// float is an integer over 4096, exact in f32. Keep the two files in step.

import { DEFAULT_AI_PIPELINE, type AiGuardMaterial, type AiPipelineSettings, type LinearImage } from '../src/core/ai';
import type { RenderPasses } from '../src/core/passes';
import type { PostJob, PostTile, TileImage, TileRequest } from '../src/ai/post-wasm';

export const W = 1160;
export const H = 340;

export function hash(x: number, y: number, c: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(c, 0xc2b2ae3d)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export const BODY = 1;
export const CAP = 2;
export const LABEL = 3;
export const LED = 4;

const inBody = (x: number, y: number) => x >= 100 && x < 560 && y >= 60 && y < 280;
const inCap = (x: number, y: number) => (x - 860) ** 2 + (y - 170) ** 2 <= 120 * 120;
const div = (a: number, b: number) => Math.trunc(a / b);

export interface Scene {
  image: LinearImage;
  passes: RenderPasses;
}

export function scene(): Scene {
  const n = W * H;
  const rgba = new Float32Array(n * 4);
  const partId = new Uint32Array(n);
  const materialId = new Uint32Array(n);
  const normal = new Float32Array(n * 3);
  const depth = new Float32Array(n).fill(Infinity);
  const coc = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const value = [0, 0, 0];
      if (inBody(x, y)) {
        let m = BODY;
        if (x >= 380 && x < 520 && y >= 120 && y < 220) m = LABEL;
        if (x >= 110 && x < 130 && y >= 70 && y < 90) m = LED;
        partId[p] = 1;
        materialId[p] = m;
        normal.set(x < 330 ? [0, 0, 1] : [1, 0, 0], p * 3);
        depth[p] = 1000 + x;
        const base =
          m === BODY ? [2600, 1300, 800] : m === LABEL ? (Math.floor(x / 3) % 2 === 0 && y >= 150 && y < 190 ? [400, 400, 400] : [3600, 3600, 3400]) : [4000, 1000, 1000];
        const shade = 3072 + div((x - 100) * 1024, 460) - div((y - 60) * 512, 220);
        for (let c = 0; c < 3; c++) value[c] = ((base[c] * shade) >> 12) + ((hash(x, y, c) & 31) - 16);
      } else if (inCap(x, y)) {
        partId[p] = 2;
        materialId[p] = CAP;
        normal.set([0, -1, 0], p * 3);
        depth[p] = 700;
        coc[p] = 6;
        const shade = 4096 - div(((x - 860) ** 2 + (y - 170) ** 2) * 1024, 14_400);
        const base = [700, 1400, 2800];
        for (let c = 0; c < 3; c++) value[c] = ((base[c] * shade) >> 12) + ((hash(x, y, c) & 7) - 4);
      } else {
        for (let c = 0; c < 3; c++) value[c] = 1200 + 4 * y + ((hash(x, y, c) & 31) - 16);
      }
      for (let c = 0; c < 3; c++) rgba[p * 4 + c] = value[c] / 4096;
      rgba[p * 4 + 3] = 1;
    }
  }
  return { image: { width: W, height: H, rgba }, passes: { width: W, height: H, partId, materialId, normal, depth, coc } };
}

export const MATERIALS: readonly AiGuardMaterial[] = [
  { materialId: BODY, name: 'Body', allowsWear: true, locked: false },
  { materialId: CAP, name: 'Cap', allowsWear: false, locked: false },
  { materialId: LABEL, name: 'Label', allowsWear: false, locked: false },
  { materialId: LED, name: 'LED', allowsWear: false, locked: true },
];

export const FULL: AiPipelineSettings = { intervention: 100, light: 100, bounce: 100, wear: 100, style: 'NATURAL', styleStrength: 100, seed: 7 };

export function job(settings: AiPipelineSettings): PostJob {
  return { width: W, height: H, tonemap: 1, exposureEv: 0, settings, materials: MATERIALS, modelKey: 'ZIMAGE_Q4', runtime: 'synthetic' };
}

/** A tile image being edited, addressed by tile coordinates clamped to the tile. */
class Edit {
  rgb: Int32Array;
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly w: number,
    readonly h: number,
    input: Uint8Array,
  ) {
    this.rgb = Int32Array.from(input);
  }

  get(i: number, j: number, c: number): number {
    const ii = Math.max(0, Math.min(this.w - 1, i));
    const jj = Math.max(0, Math.min(this.h - 1, j));
    return this.rgb[(jj * this.w + ii) * 3 + c];
  }

  map(f: (x: number, y: number, i: number, j: number, c: number) => number): void {
    const out = new Int32Array(this.rgb.length);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) for (let c = 0; c < 3; c++) out[(j * this.w + i) * 3 + c] = f(this.x0 + i, this.y0 + j, i, j, c);
    this.rgb = out;
  }

  done(): TileImage {
    return { width: this.w, height: this.h, rgb: Uint8Array.from(this.rgb, (v) => Math.max(0, Math.min(255, v))) };
  }
}

type Area = (x: number, y: number) => boolean;
const bodyArea: Area = inBody;
const capArea: Area = (x) => x >= 740 && x < 980;

const shift = (e: Edit, d: number) => e.map((_x, _y, i, j, c) => e.get(i - d, j, c));
const box = (e: Edit, i: number, j: number, c: number) => {
  let s = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += e.get(i + di, j + dj, c);
  return s;
};
const blur = (e: Edit, inside: Area) => e.map((x, y, i, j, c) => (inside(x, y) ? div(box(e, i, j, c) + 4, 9) : e.get(i, j, c)));
const sharpen = (e: Edit, inside: Area) =>
  e.map((x, y, i, j, c) => {
    const v = e.get(i, j, c);
    return inside(x, y) ? v + div(2 * (9 * v - box(e, i, j, c)), 9) : v;
  });
const ramp = (e: Edit, amount: number) => e.map((x, _y, i, j, c) => e.get(i, j, c) + div(x * amount, W));
const band = (e: Edit, from: number, amount: number) => e.map((_x, y, i, j, c) => e.get(i, j, c) + (y >= from ? amount : 0));
const tint = (e: Edit, inside: Area) =>
  e.map((x, y, i, j, c) => {
    const v = e.get(i, j, c);
    if (!inside(x, y)) return v;
    return c === 0 ? div(v * 5, 4) : c === 2 ? div(v * 3, 4) : v;
  });

export type Model = (request: TileRequest, tile: PostTile) => TileImage;

const edit = (r: TileRequest, t: PostTile) => new Edit(t.x, t.y, r.width, r.height, r.input);

/** The model that does every forbidden thing at once. */
export const forbidden: Model = (r, t) => {
  const e = edit(r, t);
  blur(e, bodyArea);
  sharpen(e, capArea);
  shift(e, 3);
  ramp(e, 24);
  band(e, 300, 40);
  tint(e, capArea);
  return e.done();
};

export const limitedModel: Model = (r, t) => {
  const e = edit(r, t);
  ramp(e, [60, 36, 21, 12][r.attempt]);
  return e.done();
};

export const wrongSize: Model = (r) => ({ width: r.width + 16, height: r.height, rgb: new Uint8Array((r.width + 16) * r.height * 3) });

/** The edge limit of the "limited" scenario (LIMITED_EDGES_PX in rt-post's tests). */
export const LIMITED_EDGES_PX = 0.005;

/** The scenarios of tests/fixtures/ai-guard.json, in order. */
export function scenarios(): { name: string; job: PostJob; model: Model }[] {
  const defaults = { ...DEFAULT_AI_PIPELINE };
  return [
    { name: 'untouched', job: job({ ...FULL, intervention: 0 }), model: forbidden },
    { name: 'forbidden', job: job(defaults), model: forbidden },
    { name: 'strong', job: job(FULL), model: forbidden },
    { name: 'limited', job: { ...job(FULL), tolerances: { edgesPx: LIMITED_EDGES_PX } }, model: limitedModel },
    { name: 'rejected', job: job(defaults), model: wrongSize },
  ];
}

/** FNV-1a over bytes, continuing from `h`. */
export function fnvBytes(h: number, bytes: Uint8Array): number {
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}

/** FNV-1a over the little-endian bytes of floats. */
export function fnvF32(values: Float32Array): number {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return fnvBytes(0x811c9dc5, bytes);
}

export const hex = (h: number) => `0x${(h >>> 0).toString(16).padStart(8, '0')}`;

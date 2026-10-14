// Measures on the light-setup thumbnails (L6): what a set must look like once rendered and tone mapped (the
// lead's criteria for the high key, the bright field, the pools and the halo), on the PNGs `rt` wrote for
// public/thumbs/setups (they are the scenes the code builds now: tests/sets.test.ts checks their manifest).

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { activeCamera, cameraBasis, cameraPosition, fieldOfView } from '../src/core/camera';
import { boundsOf, productBounds, productParts, worldMatrix } from '../src/core/scene';
import { getMesh } from '../src/core/meshes';
import { dot, sub, transformPoint, type Box, type Mat4, type Vec3 } from '../src/core/math';
import type { ProjectState } from '../src/core/store';
import { lightFrame } from '../src/core/lighting';
import { setupScene, THUMB } from './set-heroes';

export interface Image {
  width: number;
  height: number;
  /** RGB, 8 bits, rows from the top. */
  rgb: Uint8Array;
}

/** An 8-bit RGB or RGBA PNG (any filter). */
export function decodePng(bytes: Uint8Array): Image {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  for (let o = 8; o < bytes.length; ) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(o + 8);
      height = view.getUint32(o + 12);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const all = new Uint8Array(idat.reduce((a, d) => a + d.length, 0));
  idat.reduce((at, d) => (all.set(d, at), at + d.length), 0);
  const raw = inflateSync(all);
  const stride = width * channels;
  const rgb = new Uint8Array(width * height * 3);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, paeth][f]) & 255;
    }
    for (let x = 0; x < width; x++) for (let k = 0; k < 3; k++) rgb[(y * width + x) * 3 + k] = line[x * channels + k];
    prev = line;
  }
  return { width, height, rgb };
}

/** The luminance of a pixel after tone mapping (the display values, Rec. 709 weights), 0..1. */
export function lum(img: Image, x: number, y: number): number {
  const i = (Math.round(y) * img.width + Math.round(x)) * 3;
  return (0.2126 * img.rgb[i] + 0.7152 * img.rgb[i + 1] + 0.0722 * img.rgb[i + 2]) / 255;
}

/** The largest channel of a pixel, 0..1 (1: clipped). */
export function peak(img: Image, x: number, y: number): number {
  const i = (Math.round(y) * img.width + Math.round(x)) * 3;
  return Math.max(img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]) / 255;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where a world point lands in a `width x height` picture of the active camera (pixels, y down). */
export function project(state: ProjectState, p: Vec3, width: number, height: number): [number, number] {
  const cam = activeCamera(state);
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const fov = fieldOfView(cam.focalMm, width / height);
  const d = sub(p, cameraPosition(cam));
  const z = dot(d, forward);
  const x = dot(d, right) / z / Math.tan(fov.h / 2);
  const y = dot(d, up) / z / Math.tan(fov.v / 2);
  return [((x + 1) / 2) * width, ((1 - y) / 2) * height];
}

/** The pixels a box covers in the picture. */
export function boxRect(state: ProjectState, box: Box, width: number, height: number): Rect {
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < 8; i++) {
    const [x, y] = project(state, [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]], width, height);
    r.x0 = Math.min(r.x0, x);
    r.x1 = Math.max(r.x1, x);
    r.y0 = Math.min(r.y0, y);
    r.y1 = Math.max(r.y1, y);
  }
  return r;
}

/** A setup's thumbnail with the scene it shows. */
export function thumbnail(key: string): { img: Image; state: ProjectState; product: Rect } {
  const img = decodePng(readFileSync(`public/thumbs/setups/thumb_${key.toLowerCase()}.png`));
  const state = setupScene(key, { width: THUMB.width, height: THUMB.height });
  return { img, state, product: boxRect(state, productBounds(state, true), img.width, img.height) };
}

/** Mean luminance over the pixels of a rectangle (clipped to the picture) that `keep` accepts. */
export function meanLum(img: Image, r: Rect, keep: (x: number, y: number) => boolean = () => true): number {
  let sum = 0;
  let n = 0;
  for (let y = Math.max(0, Math.ceil(r.y0)); y <= Math.min(img.height - 1, Math.floor(r.y1)); y++) {
    for (let x = Math.max(0, Math.ceil(r.x0)); x <= Math.min(img.width - 1, Math.floor(r.x1)); x++) {
      if (!keep(x, y)) continue;
      sum += lum(img, x, y);
      n++;
    }
  }
  return n > 0 ? sum / n : NaN;
}

/** Outside a rectangle grown by `m` pixels. */
export const outside = (r: Rect, m: number) => (x: number, y: number) => x < r.x0 - m || x > r.x1 + m || y < r.y0 - m || y > r.y1 + m;

/**
 * The backdrop of a thumbnail: every pixel above the bottom of the product and away from it (6 pixels), where the
 * camera sees the background or the backdrop behind the product.
 */
export function backdropLum(t: ReturnType<typeof thumbnail>): number {
  const { img, product } = t;
  return meanLum(img, { x0: 0, y0: 0, x1: img.width - 1, y1: product.y1 }, outside(product, 6));
}

/** The largest channel over a part's pixels (its box, a quarter in from each side): 1 when it is clipped. */
export function partPeak(t: ReturnType<typeof thumbnail>, partKey: string): number {
  const id = Object.values(t.state.scene.nodes).find((n) => n.key === partKey)!.id;
  const r = boxRect(t.state, boundsOf(t.state, [id], true), t.img.width, t.img.height);
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  let max = 0;
  for (let y = Math.ceil(r.y0 + h / 4); y <= r.y1 - h / 4; y++) for (let x = Math.ceil(r.x0 + w / 4); x <= r.x1 - w / 4; x++) max = Math.max(max, peak(t.img, x, y));
  return max;
}

/** The luminance along a row, averaged over `rows` rows centred on `y`, from `x0` to `x1` (either way). */
export function rowProfile(img: Image, y: number, x0: number, x1: number, rows = 5): number[] {
  const out: number[] = [];
  const step = x1 >= x0 ? 1 : -1;
  for (let x = Math.round(x0); step > 0 ? x <= x1 : x >= x1; x += step) {
    let s = 0;
    let n = 0;
    for (let k = -Math.floor(rows / 2); k <= Math.floor(rows / 2); k++) {
      const yy = Math.round(y) + k;
      if (yy < 0 || yy >= img.height || x < 0 || x >= img.width) continue;
      s += lum(img, x, yy);
      n++;
    }
    out.push(n > 0 ? s / n : NaN);
  }
  return out;
}

/**
 * Which pixels of a `width x height` picture the product covers (its parts' triangles, projected and filled: the
 * silhouette, without what its glass bends).
 */
export function productMask(state: ProjectState, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const cache = new Map<string, Mat4>();
  for (const id of productParts(state, true)) {
    const node = state.scene.nodes[id];
    const data = node.mesh ? getMesh(node.mesh.id) : undefined;
    if (!data) continue;
    const m = worldMatrix(state, id, cache);
    const pts: [number, number][] = [];
    for (let i = 0; i < data.positions.length; i += 3) pts.push(project(state, transformPoint(m, [data.positions[i], data.positions[i + 1], data.positions[i + 2]]), width, height));
    for (let t = 0; t + 2 < data.indices.length; t += 3) {
      const [a, b, c] = [pts[data.indices[t]], pts[data.indices[t + 1]], pts[data.indices[t + 2]]];
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (Math.abs(area) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
          const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
          if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) mask[y * width + x] = 1;
        }
      }
    }
  }
  return mask;
}

/** A mask grown by `r` pixels. */
export function grow(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < width && yy < height) out[yy * width + xx] = 1;
        }
    }
  return out;
}

/** The pixels of the backdrop: away from the product (`margin` pixels) and above its lowest point in the picture. */
export function backdropMask(t: ReturnType<typeof thumbnail>, margin = 3): Uint8Array {
  const { img, state } = t;
  const mask = grow(productMask(state, img.width, img.height), img.width, img.height, margin);
  let bottom = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) bottom = Math.max(bottom, Math.floor(i / img.width));
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < bottom; y++) for (let x = 0; x < img.width; x++) out[y * img.width + x] = mask[y * img.width + x] ? 0 : 1;
  return out;
}

/** The mean luminance of the pixels of a mask inside a rectangle (the whole picture by default). */
export function maskedMean(img: Image, mask: Uint8Array, r: Rect = { x0: 0, y0: 0, x1: img.width - 1, y1: img.height - 1 }): number {
  let sum = 0;
  let n = 0;
  for (let y = Math.max(0, Math.round(r.y0)); y <= Math.min(img.height - 1, Math.round(r.y1)); y++)
    for (let x = Math.max(0, Math.round(r.x0)); x <= Math.min(img.width - 1, Math.round(r.x1)); x++) {
      if (!mask[y * img.width + x]) continue;
      sum += lum(img, x, y);
      n++;
    }
  return n > 0 ? sum / n : NaN;
}

/** Where a set's pool lands in its thumbnail, pixels. */
export function poolPixel(t: ReturnType<typeof thumbnail>): [number, number] {
  const pool = t.state.studio.lights.find((l) => l.setPiece === 'POOL')!;
  return project(t.state, lightFrame(t.state, pool).target, t.img.width, t.img.height);
}

/**
 * How much brighter the backdrop is where the pool lands than at the edges of the frame, after tone mapping: the mean
 * of the backdrop in a 49 × 33 window on the pool over the mean of 16-pixel windows at the left and right edges.
 */
export function poolContrast(t: ReturnType<typeof thumbnail>): number {
  const { img } = t;
  const mask = backdropMask(t);
  const [px, py] = poolPixel(t);
  const centre = maskedMean(img, mask, { x0: px - 24, x1: px + 24, y0: py - 16, y1: py + 16 });
  const left = maskedMean(img, mask, { x0: 0, x1: 15, y0: py - 16, y1: py + 16 });
  const right = maskedMean(img, mask, { x0: img.width - 16, x1: img.width - 1, y0: py - 16, y1: py + 16 });
  return centre / ((left + right) / 2);
}

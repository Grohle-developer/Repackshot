// The front glass on the Fast viewport (phase S3b, decision S3 ◆9): an approximation of what the engine traces
// (rt-core `optics::glass`), from the engine's own drops and motes (the layout it makes of a pane by hand,
// `rt_scene_glass`, or the frame of a recorded simulation, core/wet.ts). Rule 10: the meter says it is an approximation,
// and it draws nothing the engine has not laid out.
//
// **What a camera sees of its glass.** A pane `d` in front of the lens is far out of focus: every point of the image
// gathers the light that crossed a disc of the pane, the cone from the aperture (diameter `A = f / N`) to the point of
// sharp focus at `s`, cut by the pane: its radius is `R = (A / 2) |1 − d / s|` (0 for a pinhole or an orthographic
// camera, whose rays are parallel lines). What lies on the pane weighs on that point by the share of the disc it covers.
// So the glass is drawn as two maps over the pane, in its own millimetres, blurred by that disc: the share of the
// footprint under drops (the image there is replaced by the scene seen through a strong lens far out of focus: the
// image blurred, dimmed by the two faces of water at normal incidence), the share under a drop's rim, where a ray along
// the axis meets the dome past the critical angle and goes back by total internal reflection (the outer ring from
// `ρ / a = 1 / (n sin θ)`: 0.87 for water at 60°; the image there is dark), and the share under dust, times the motes'
// opacity (the image there is dimmed: a tint). Drops are soft discs with a darker edge, a mote sharper than the
// footprint a speck. The inversion of the scene inside a drop is not drawn (the Full mode and the render trace it).

import type { Vec3 } from '../core/math';

/** A pane as the engine laid it out: where it is, what lies on it (mm in its own axes: right, up). */
export interface PaneLayout {
  distanceMm: number;
  /** x, y, a per drop (a: the contact circle's radius). */
  drops: Float32Array;
  /** x, y, r per mote. */
  motes: Float32Array;
  dustOpacity: number;
  ior: number;
  /** The drops' contact angle, degrees. */
  contactAngleDeg: number;
}

/** The maps over a rectangle of the pane: per cell, the share of the footprint under drops and the dust's dimming. */
export interface PaneGrid {
  width: number;
  height: number;
  /** The rectangle's lower left corner and the side of a cell, mm. */
  x0: number;
  y0: number;
  cell: number;
  /** Three floats per cell, rows from the bottom: drops' share, dust's dimming, the drops' rims' share, 0..1. */
  data: Float32Array;
  drops: number;
  motes: number;
}

/** Most cells of the grid along its longer side. */
export const MAX_GRID_CELLS = 256;

/**
 * The radius of the footprint of an image point on a pane `distanceMm` in front of a lens of `focalMm` at `fstop`
 * focused at `focusMm`: `(A / 2) |1 − d / s|`, mm. 0 for a pinhole (fstop 0) or an orthographic camera.
 */
export function footprintRadiusMm(focalMm: number, fstop: number, focusMm: number, distanceMm: number, ortho: boolean): number {
  if (ortho || !(fstop > 0) || !(focalMm > 0)) return 0;
  const aperture = focalMm / fstop;
  const s = focusMm > 0 ? focusMm : Infinity;
  return 0.5 * aperture * Math.abs(1 - distanceMm / s);
}

/** The transmittance of a drop at its centre: two faces of water at normal incidence (Fresnel). */
export function dropTransmittance(ior: number): number {
  const r = ((ior - 1) / (ior + 1)) ** 2;
  return (1 - r) * (1 - r);
}

/** The share of a drop's radius inside which a ray along the axis leaves through its dome (the rest is its dark rim). */
export function rimStart(contactAngleDeg: number, ior: number): number {
  const s = Math.sin((Math.min(175, Math.max(5, contactAngleDeg)) * Math.PI) / 180);
  return Math.min(1, 1 / (Math.max(1, ior) * Math.max(1e-3, s)));
}

/** A separable box blur of half width `w` cells, in place on channel `c` of a three-channel grid. */
function boxBlur(data: Float32Array, width: number, height: number, c: number, w: number): void {
  if (w <= 0) return;
  const line = new Float32Array(Math.max(width, height));
  const run = (n: number, get: (i: number) => number, set: (i: number, v: number) => void) => {
    for (let i = 0; i < n; i++) line[i] = get(i);
    let sum = 0;
    for (let i = -w; i <= w; i++) sum += i >= 0 && i < n ? line[i] : 0;
    for (let i = 0; i < n; i++) {
      set(i, sum / (2 * w + 1));
      const out = i - w;
      const inn = i + w + 1;
      if (out >= 0) sum -= line[out];
      if (inn < n) sum += line[inn];
    }
  };
  for (let y = 0; y < height; y++) run(width, (i) => data[3 * (y * width + i) + c], (i, v) => (data[3 * (y * width + i) + c] = v));
  for (let x = 0; x < width; x++) run(height, (i) => data[3 * (i * width + x) + c], (i, v) => (data[3 * (i * width + x) + c] = v));
}

/**
 * The maps of `layout` over the rectangle `[x0, x1] × [y0, y1]` of the pane (what the view sees of it), blurred by the
 * footprint of radius `footprintMm`: the cells are at most MAX_GRID_CELLS along the longer side and at most a third of
 * the footprint (or, when the footprint is sharp, half the width of the smallest drop's rim). Each object is laid into the cells it covers by
 * the share of each cell inside it (sampled 4 × 4 per cell for the drops; a mote smaller than a cell gives the cell its
 * area's share), then two box blurs of half width `0.61 R` stand for the disc (the same variance).
 */
export function paneGrid(layout: PaneLayout, rect: { x0: number; y0: number; x1: number; y1: number }, footprintMm: number): PaneGrid {
  const spanX = Math.max(1e-3, rect.x1 - rect.x0);
  const spanY = Math.max(1e-3, rect.y1 - rect.y0);
  let smallest = Infinity;
  for (let i = 2; i < layout.drops.length; i += 3) smallest = Math.min(smallest, layout.drops[i]);
  // Sharp drops: cells fine enough for the smallest one's rim (the rest is blurred over the footprint anyway).
  const ring = Math.max(0.1, 1 - rimStart(layout.contactAngleDeg, layout.ior));
  const detail = footprintMm > 0 ? footprintMm / 3 : Number.isFinite(smallest) ? (smallest * ring) / 2 : spanX / MAX_GRID_CELLS;
  const cell = Math.max(Math.max(spanX, spanY) / MAX_GRID_CELLS, detail, 1e-3);
  const width = Math.max(1, Math.min(MAX_GRID_CELLS, Math.ceil(spanX / cell)));
  const height = Math.max(1, Math.min(MAX_GRID_CELLS, Math.ceil(spanY / cell)));
  const data = new Float32Array(3 * width * height);
  const rim = rimStart(layout.contactAngleDeg, layout.ior);
  const { x0, y0 } = rect;
  // Drops: the share of each cell inside the disc, from 4 × 4 samples (a cell wholly inside or outside is exact).
  const S = 4;
  for (let i = 0; i + 2 < layout.drops.length; i += 3) {
    const [cx, cy, a] = [layout.drops[i], layout.drops[i + 1], layout.drops[i + 2]];
    const c0 = Math.max(0, Math.floor((cx - a - x0) / cell));
    const c1 = Math.min(width - 1, Math.floor((cx + a - x0) / cell));
    const r0 = Math.max(0, Math.floor((cy - a - y0) / cell));
    const r1 = Math.min(height - 1, Math.floor((cy + a - y0) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        let inside = 0;
        let edge = 0;
        for (let sy = 0; sy < S; sy++) {
          for (let sx = 0; sx < S; sx++) {
            const px = x0 + (c + (sx + 0.5) / S) * cell - cx;
            const py = y0 + (r + (sy + 0.5) / S) * cell - cy;
            const d2 = px * px + py * py;
            if (d2 <= a * a) {
              inside++;
              if (d2 > rim * rim * a * a) edge++;
            }
          }
        }
        const k = 3 * (r * width + c);
        data[k] = Math.min(1, data[k] + inside / (S * S));
        data[k + 2] = Math.min(1, data[k + 2] + edge / (S * S));
      }
    }
  }
  // Motes: their area's share of the cell they are in (a mote bigger than a cell, laid as a disc).
  const op = Math.min(1, Math.max(0, layout.dustOpacity));
  for (let i = 0; i + 2 < layout.motes.length; i += 3) {
    const [mx, my, mr] = [layout.motes[i], layout.motes[i + 1], layout.motes[i + 2]];
    if (mr * 2 <= cell) {
      const c = Math.floor((mx - x0) / cell);
      const r = Math.floor((my - y0) / cell);
      if (c < 0 || r < 0 || c >= width || r >= height) continue;
      const k = 3 * (r * width + c) + 1;
      data[k] = Math.min(1, data[k] + (op * Math.PI * mr * mr) / (cell * cell));
      continue;
    }
    const c0 = Math.max(0, Math.floor((mx - mr - x0) / cell));
    const c1 = Math.min(width - 1, Math.floor((mx + mr - x0) / cell));
    const r0 = Math.max(0, Math.floor((my - mr - y0) / cell));
    const r1 = Math.min(height - 1, Math.floor((my + mr - y0) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const px = x0 + (c + 0.5) * cell - mx;
        const py = y0 + (r + 0.5) * cell - my;
        if (px * px + py * py <= mr * mr) {
          const k = 3 * (r * width + c) + 1;
          data[k] = Math.min(1, data[k] + op);
        }
      }
    }
  }
  const w = Math.round((0.61 * footprintMm) / cell);
  for (const ch of [0, 1, 2]) {
    boxBlur(data, width, height, ch, w);
    boxBlur(data, width, height, ch, w);
  }
  return { width, height, x0, y0, cell, data, drops: layout.drops.length / 3, motes: layout.motes.length / 3 };
}

/**
 * What a camera's projection does to the pane: the pane point (mm) a pixel's chief ray crosses is
 * `(ndc − offset) × scale`, from a three.js projection matrix (column-major `elements`) and the pane's distance; an
 * orthographic matrix has no division by the distance.
 */
export function paneMapping(elements: ArrayLike<number>, distanceMm: number, ortho: boolean): { scale: [number, number]; offset: [number, number] } {
  const p00 = elements[0];
  const p11 = elements[5];
  if (ortho) return { scale: [1 / p00, 1 / p11], offset: [elements[12], elements[13]] };
  // x_ndc = (P00 x + P02 z) / −z with z = −d: P00 x / d − P02.
  return { scale: [distanceMm / p00, distanceMm / p11], offset: [-elements[8], -elements[9]] };
}

/** The pane rectangle a mapping sees (ndc −1..1), a cell of margin on each side. */
export function seenRect(m: { scale: [number, number]; offset: [number, number] }): { x0: number; y0: number; x1: number; y1: number } {
  const xs = [(-1 - m.offset[0]) * m.scale[0], (1 - m.offset[0]) * m.scale[0]];
  const ys = [(-1 - m.offset[1]) * m.scale[1], (1 - m.offset[1]) * m.scale[1]];
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** The mean of a channel over the cells within `radius` mm of a pane point (tests). */
export function gridMean(g: PaneGrid, at: Vec3 | [number, number], radius: number, channel: 0 | 1 | 2): number {
  let sum = 0;
  let n = 0;
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      const x = g.x0 + (c + 0.5) * g.cell - at[0];
      const y = g.y0 + (r + 0.5) * g.cell - at[1];
      if (x * x + y * y <= radius * radius) {
        sum += g.data[3 * (r * g.width + c) + channel];
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 0;
}

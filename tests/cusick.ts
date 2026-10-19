// Cusick's drape tester (BS 5058, ISO 9073-9) as the engine's tests build it (rt-phys tests/cloth.rs `cusick`), for the
// contact sheet (tests/cloth-dump.test.ts): the same CLT1 to the last bit (the ring disc and the support of
// rt_phys::example `cloth_disc` and `cylinder_mesh`, their trigonometry rt_core::fmath's, every operation rounded to f32
// as the engine does it), so that the real rt.wasm drapes it exactly as the native test does, and the same measure of
// the drape: the drape coefficient from the shadow seen from above and the nodes of its outline.

import { cltBytes, type ClothParamsResolved, type ClothRunSpec } from '../src/core/cloth';
import type { FabricPreset } from '../src/data/fabrics';

const f = Math.fround;
const PI = f(Math.PI);
const TAU = f(2 * Math.PI);
const PIO2_1 = f(1.5703125);
const PIO2_2 = f(4.837513e-4);
const PIO2_3 = f(7.54979e-8);

/** rt_core::fmath::sin_cos, operation by operation in f32. */
export function sinCos(x: number): [number, number] {
  const k = Math.floor(f(f(x * f(2 / PI)) + 0.5));
  const r = f(f(f(x - f(k * PIO2_1)) - f(k * PIO2_2)) - f(k * PIO2_3));
  const r2 = f(r * r);
  let p = f(1 / 362880);
  p = f(f(p * r2) - f(1 / 5040));
  p = f(f(p * r2) + f(1 / 120));
  p = f(f(p * r2) - f(1 / 6));
  const s = f(r + f(f(r * r2) * p));
  let q = f(-1 / 3628800);
  q = f(f(q * r2) + f(1 / 40320));
  q = f(f(q * r2) - f(1 / 720));
  q = f(f(q * r2) + f(1 / 24));
  q = f(f(q * r2) - 0.5);
  const c = f(1 + f(r2 * q));
  switch (((k % 4) + 4) % 4) {
    case 0:
      return [s, c];
    case 1:
      return [c, -s];
    case 2:
      return [-s, -c];
    default:
      return [-c, s];
  }
}

/** rt_phys::example::cloth_disc: `rings` rings of 6k vertices about `center`, strips between them. */
export function clothDisc(radius: number, rings: number, center: [number, number, number]): { positions: number[]; indices: number[] } {
  const positions = [...center];
  const start = (k: number) => (k === 0 ? 0 : 1 + 3 * k * (k - 1));
  const count = (k: number) => (k === 0 ? 1 : 6 * k);
  for (let k = 1; k <= rings; k++) {
    const r = f(f(radius * k) / rings);
    for (let i = 0; i < count(k); i++) {
      const [s, c] = sinCos(f(f(TAU * i) / count(k)));
      positions.push(f(center[0] + f(c * r)), f(center[1] + f(s * r)), f(center[2] + 0));
    }
  }
  const indices: number[] = [];
  for (let k = 1; k <= rings; k++) {
    const [outer, inner] = [count(k), count(k - 1)];
    const [o0, i0] = [start(k), start(k - 1)];
    let i = 0;
    let j = 0;
    while (i < outer || (k > 1 && j < inner)) {
      const a = o0 + (i % outer);
      const b = i0 + (j % inner);
      const nextOuter = (i + 1) * inner;
      const nextInner = (j + 1) * outer;
      if (k === 1 || (i < outer && (j >= inner || nextOuter <= nextInner))) {
        indices.push(b, a, o0 + ((i + 1) % outer));
        i++;
      } else {
        indices.push(b, a, i0 + ((j + 1) % inner));
        j++;
      }
    }
  }
  return { positions, indices };
}

/** rt_phys::example::cylinder_mesh: closed, axis Z, about the origin. */
export function cylinderMesh(radius: number, height: number, segments: number): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  for (let s = 0; s < segments; s++) {
    const [sp, cp] = sinCos(f(f(TAU * s) / segments));
    positions.push(f(cp * radius), f(sp * radius), f(-0.5 * height), f(cp * radius), f(sp * radius), f(0.5 * height));
  }
  const bottom = positions.length / 3;
  positions.push(0, 0, f(-0.5 * height), 0, 0, f(0.5 * height));
  const indices: number[] = [];
  for (let s = 0; s < segments; s++) {
    const [a0, a1] = [2 * s, 2 * s + 1];
    const [b0, b1] = [2 * ((s + 1) % segments), 2 * ((s + 1) % segments) + 1];
    indices.push(a0, b0, b1, a0, b1, a1, bottom, b0, a0, bottom + 1, a1, b1);
  }
  return { positions, indices };
}

/** The support (radius, top), mm: 180 mm across, its top at 300 mm. */
export const CUSICK_SUPPORT = { radius: 90, top: 300 } as const;
/** The longest a sample drapes for, seconds (tests/cloth.rs CUSICK_SECONDS). */
export const CUSICK_SECONDS = 4;

/** rt_phys::example::fabric of a preset: what the engine's tests drape (self-collision on, the warp along X). */
export function presetParams(p: FabricPreset): ClothParamsResolved {
  return {
    massPerArea: p.weightGsm / 1000,
    stretch: p.stretch,
    shear: p.shear,
    bend: p.bend,
    damping: p.damping,
    thickness: p.thicknessMm,
    friction: p.friction,
    area: 0,
    pressure: 0,
    warp: [1, 0, 0],
    selfCollision: true,
  };
}

/** The CLT1 of the engine's Cusick test for a preset: the 300 mm ring disc held within the support's radius. */
export function cusickBytes(p: FabricPreset): { bytes: Uint8Array; disc: { positions: Float32Array; indices: Uint32Array }; support: { positions: Float32Array; indices: Uint32Array } } {
  const { radius, top } = CUSICK_SUPPORT;
  const params = presetParams(p);
  const z = f(f(top + f(params.thickness)) + 0.5);
  const d = clothDisc(150, 24, [0, 0, z]);
  const pinned: boolean[] = [];
  for (let i = 0; i < d.positions.length; i += 3) {
    const x = d.positions[i];
    const y = d.positions[i + 1];
    pinned.push(f(f(x * x) + f(y * y)) <= f(radius * radius));
  }
  const c = cylinderMesh(radius, 100, 128);
  const lift = f(top - 50);
  const support = { positions: Float32Array.from(c.positions.map((v, i) => (i % 3 === 2 ? f(v + lift) : v))), indices: Uint32Array.from(c.indices) };
  const disc = { positions: Float32Array.from(d.positions), indices: Uint32Array.from(d.indices) };
  const spec = {
    pieces: [{ positions: disc.positions, indices: disc.indices, pinned, params }],
    statics: [support],
    floor: { z: 0, friction: 0.6 },
    wind: { velocity: [0, 0, 0], gust: 0, scale: 0, speed: 0, seed: 0 },
  } as unknown as ClothRunSpec;
  return { bytes: cltBytes(spec), disc, support };
}

/** tests/cloth.rs `shadow`: the cloth's triangles rasterised from above at a millimetre within 160 mm; area and outline. */
export function shadow(pos: Float32Array, tris: Uint32Array): { area: number; radius: number[] } {
  const HALF = 160;
  const n = 2 * HALF;
  const on = new Uint8Array(n * n);
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) => f(f(f(px - ox) * f(qy - oy)) - f(f(py - oy) * f(qx - ox)));
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]].map((i) => [pos[3 * i], pos[3 * i + 1]]);
    const area = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
    if (area === 0) continue;
    const lox = Math.min(a[0], b[0], c[0]);
    const loy = Math.min(a[1], b[1], c[1]);
    const hix = Math.max(a[0], b[0], c[0]);
    const hiy = Math.max(a[1], b[1], c[1]);
    for (let y = Math.max(Math.floor(loy), -HALF); y < Math.min(Math.ceil(hiy), HALF); y++) {
      for (let x = Math.max(Math.floor(lox), -HALF); x < Math.min(Math.ceil(hix), HALF); x++) {
        const qx = f(x + 0.5);
        const qy = f(y + 0.5);
        const u = cross(b[0], b[1], c[0], c[1], qx, qy);
        const v = cross(c[0], c[1], a[0], a[1], qx, qy);
        const w = cross(a[0], a[1], b[0], b[1], qx, qy);
        const inside = area > 0 ? u >= 0 && v >= 0 && w >= 0 : u <= 0 && v <= 0 && w <= 0;
        if (inside) on[(y + HALF) * n + (x + HALF)] = 1;
      }
    }
  }
  const radius = new Array<number>(360).fill(0);
  let count = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!on[y * n + x]) continue;
      count++;
      const px = f(f(x - HALF) + 0.5);
      const py = f(f(y - HALF) + 0.5);
      const deg = Math.floor((((Math.atan2(py, px) * 180) / Math.PI) % 360 + 360) % 360) % 360;
      radius[deg] = Math.max(radius[deg], f(Math.sqrt(f(f(px * px) + f(py * py)))));
    }
  }
  return { area: count, radius };
}

/** tests/cloth.rs `nodes`: the waves of the outline's radius (smoothed over 7°) above its mean by a sixth of its range. */
export function nodes(radius: number[]): number {
  const n = radius.length;
  const smooth = radius.map((_, i) => {
    let s = 0;
    for (let k = 0; k < 7; k++) s = f(s + radius[(i + n + k - 3) % n]);
    return f(s / 7);
  });
  let sum = 0;
  for (const r of smooth) sum = f(sum + r);
  const mean = f(sum / n);
  const lo = Math.min(...smooth);
  const hi = Math.max(...smooth);
  const band = f(f(hi - lo) / 6);
  if (band < 1) return 0;
  let first = 0;
  for (let i = 0; i < n; i++) if (smooth[i] < smooth[first]) first = i;
  let above = false;
  let count = 0;
  for (let k = 0; k < n; k++) {
    const r = smooth[(first + k) % n];
    if (!above && r > f(mean + band)) {
      above = true;
      count++;
    } else if (above && r < f(mean - band)) above = false;
  }
  return count;
}

/** The drape coefficient of a draped disc, `(A_shadow − A_support) / (A_sample − A_support)`, against its flat shadow. */
export function drapeCoefficient(flatArea: number, area: number): number {
  const r = CUSICK_SUPPORT.radius;
  const disc = f(f(PI * r) * r);
  return f(f(area - disc) / f(flatArea - disc));
}

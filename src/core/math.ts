// Small vector, box and matrix helpers for the model. Plain arrays only, so
// everything stays serialisable and testable without three.js.
//
// Coordinate system (see docs/ARCHITECTURE.md §3): Z up, Y into the scene,
// X to the right. World units are millimetres. Rotations are Euler angles in
// degrees applied with the same convention as three.js order 'XYZ'
// (matrix = Rx * Ry * Rz), so the preview can copy them verbatim.

/** A point or direction in model space, millimetres. */
export type Vec3 = [number, number, number];

/** Axis-aligned box. An empty box has min > max. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/** 4x4 matrix, column-major (same layout as three.js `Matrix4.elements`). */
export type Mat4 = number[];

export const DEG = Math.PI / 180;

export function add(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: readonly number[], k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a: readonly number[]): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: readonly number[]): Vec3 {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/** `v` turned `deg` degrees about the unit `axis` (right hand), by Rodrigues' formula. */
export function rotateAbout(v: readonly number[], axis: readonly number[], deg: number): Vec3 {
  if (deg === 0) return [v[0], v[1], v[2]];
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = normalize(axis);
  const kxv = cross(k, v);
  const kv = dot(k, v) * (1 - c);
  return [v[0] * c + kxv[0] * s + k[0] * kv, v[1] * c + kxv[1] * s + k[1] * kv, v[2] * c + kxv[2] * s + k[2] * kv];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function emptyBox(): Box {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function isEmptyBox(b: Box): boolean {
  return !(b.min[0] <= b.max[0] && b.min[1] <= b.max[1] && b.min[2] <= b.max[2]);
}

export function unionBox(a: Box, b: Box): Box {
  if (isEmptyBox(a)) return b;
  if (isEmptyBox(b)) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export function boxSize(b: Box): Vec3 {
  if (isEmptyBox(b)) return [0, 0, 0];
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

export function boxCenter(b: Box): Vec3 {
  if (isEmptyBox(b)) return [0, 0, 0];
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/** Largest dimension of a box. */
export function boxMaxDim(b: Box): number {
  const s = boxSize(b);
  return Math.max(s[0], s[1], s[2]);
}

/** Radius of the sphere around the box centre that contains the box. */
export function boxRadius(b: Box): number {
  return length(boxSize(b)) / 2;
}

export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Translation * Rotation(XYZ, degrees, three.js convention) * Scale. */
export function mat4Compose(position: readonly number[], rotationDeg: readonly number[], scl: readonly number[]): Mat4 {
  const x = rotationDeg[0] * DEG;
  const y = rotationDeg[1] * DEG;
  const z = rotationDeg[2] * DEG;
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  const m = mat4Identity();
  m[0] = c * e;
  m[4] = -c * f;
  m[8] = d;
  m[1] = af + be * d;
  m[5] = ae - bf * d;
  m[9] = -b * c;
  m[2] = bf - ae * d;
  m[6] = be + af * d;
  m[10] = a * c;
  m[0] *= scl[0];
  m[1] *= scl[0];
  m[2] *= scl[0];
  m[4] *= scl[1];
  m[5] *= scl[1];
  m[6] *= scl[1];
  m[8] *= scl[2];
  m[9] *= scl[2];
  m[10] *= scl[2];
  m[12] = position[0];
  m[13] = position[1];
  m[14] = position[2];
  return m;
}

/** a * b (apply b first). */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

/** General inverse; a singular matrix gives the identity. */
export function mat4Invert(m: Mat4): Mat4 {
  const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = m;
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (Math.abs(det) < 1e-20) return mat4Identity();
  const di = 1 / det;
  const o = new Array<number>(16);
  o[0] = t11 * di;
  o[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * di;
  o[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * di;
  o[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * di;
  o[4] = t12 * di;
  o[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * di;
  o[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * di;
  o[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * di;
  o[8] = t13 * di;
  o[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * di;
  o[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * di;
  o[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * di;
  o[12] = t14 * di;
  o[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * di;
  o[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * di;
  o[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * di;
  return o;
}

export function transformPoint(m: Mat4, p: readonly number[]): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Applies the linear part only (no translation). */
export function transformDirection(m: Mat4, d: readonly number[]): Vec3 {
  return [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ];
}

/** Box of the eight transformed corners (exact for translations and axis scales). */
export function transformBox(m: Mat4, b: Box): Box {
  if (isEmptyBox(b)) return emptyBox();
  let out = emptyBox();
  for (let i = 0; i < 8; i++) {
    const p = transformPoint(m, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
    out = unionBox(out, { min: p, max: [p[0], p[1], p[2]] });
  }
  return out;
}

/** Rounds to `digits` decimals, avoiding -0. */
export function round(v: number, digits = 3): number {
  const k = 10 ** digits;
  const r = Math.round(v * k) / k;
  return r === 0 ? 0 : r;
}

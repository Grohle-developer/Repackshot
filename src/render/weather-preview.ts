// S3c: the Fast preview's rain, dust and snow on the parts: what the recorded simulation (core/wet-parts.ts) holds at
// the frame the playhead shows, drawn as the engine shades it (rt-core `weather`): every triangle of a wet part carries
// the grid of samples of the engine's layout, and its fragments read them as the engine's hits do (the small triangle
// of the grid they fall in, blended linearly), then lay dust, a film of water and snow over the material with the
// engine's numbers. The drops are caps of water (an instanced dome at the part's contact angle), placed where the part
// stands. A wet part draws with a copy of its geometry that is not indexed (each triangle carries its number and the
// barycentric weights of its corners) and a copy of its materials that runs this patch after its own.
//
// S3d: the drops in the air of the frame (drips and splashes falling) are spheres of the same water, one instanced
// sphere each where the engine has it (the model's world, the root's space), for the parts that draw the weather.
//
// S3f: a recorded drop with a shape (core/wet-parts.ts `DropShape`) is a deformed cap, as the engine meshes it
// (rt-core `weather::shape_point`): the instanced cap is finer (8 rings), each instance carries its shape in the cap's
// own frame (contact radius 1, its normal +Z: `localShape`) and the vertex shader moves every vertex the same way
// (`shapePointLocal` is its twin in TypeScript), with the normals of the deformed surface.
//
// S3e: the studio floor of the frame (`PartsFrame.floor`) is a plane over the shadow-catching floor that draws its cells
// as the engine's catcher does: where dust and snow cover it, their layer, lit; where its film wets it, darker (a grey of
// 0.5 darkened as a porous floor, ◆) and smoother. The dust's motes (the track's `motes`, placed as the engine places
// them: core/wet-parts.ts `motesOn`) are grains, one instanced octahedron each, on the part they lie on, following it.
// A part the run moves draws its weather on its posed object, as any part does.

import * as THREE from 'three';
import type { Pose } from '../core/animation';
import type { NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';
import { isRoundShape, motesOn, partsResolution, partsShown, recordedParts, SNOW_STEP_MM, type DropShape, type FallingDropFrame, type FloorFrame, type PartsShown, type PartsTrack } from '../core/wet-parts';
import { FLOOR_POROSITY } from '../data/wet-parts';

/** The engine's look (rt-core `weather`, ◆ proposals there): the same numbers. */
export const WEATHER_LOOK = {
  snowCoverMm: 0.5,
  wetCoatRoughness: 0.03,
  wetDarken: 1,
  dustAlbedo: [0.42, 0.39, 0.35] as const,
  dustRoughness: 0.9,
  snowAlbedo: 0.9,
  snowRoughness: 0.85,
} as const;

/** Texels per row of the data textures. */
const TEX_W = 2048;
/** Segments around and rings of a drop's cap (rt-core `CAP_SEGMENTS`, `CAP_RINGS`). */
const CAP_SEGMENTS = 16;
const CAP_RINGS = 4;
/** S3f: rings of a shaped cap (rt-core `SHAPED_CAP_RINGS`). */
export const SHAPED_CAP_RINGS = 8;
/** S3f: the share of a paraboloid cap's volume a neck of depth 1 takes from its width (rt-core `NECK_VOLUME`). */
export const NECK_VOLUME = 35 / 48;

/**
 * S3f: a drop's shape in its cap's own frame (contact radius 1, the surface's normal +Z, as the instanced cap is drawn):
 * the axis and the merge's axis as unit vectors in the plane (or zero), gravity, and the round cap's height.
 */
export interface LocalShape {
  axis: [number, number];
  aspect: number;
  bulge: number;
  taper: number;
  mergeAxis: [number, number];
  along: number;
  across: number;
  neck: number;
  shift: number;
  sag: number;
  pinch: number;
  gravity: [number, number, number];
  height: number;
}

/**
 * S3f: `shape` (axes in the part's object space) in the frame of a cap whose rotation from +Z to its normal is `q`,
 * gravity `gravityObject` in the part's object space, contact angle `capAngleDeg`.
 */
export function localShape(shape: DropShape, q: THREE.Quaternion, gravityObject: THREE.Vector3, capAngleDeg: number): LocalShape {
  const inv = q.clone().invert();
  const plane = (x: number, y: number, z: number): [number, number] => {
    const v = new THREE.Vector3(x, y, z).applyQuaternion(inv);
    const len = Math.hypot(v.x, v.y);
    return len > 1e-6 ? [v.x / len, v.y / len] : [0, 0];
  };
  const g = gravityObject.clone().applyQuaternion(inv).normalize();
  const theta = (Math.min(179, Math.max(1, capAngleDeg)) * Math.PI) / 180;
  return {
    axis: plane(shape[0], shape[1], shape[2]),
    aspect: shape[3],
    bulge: shape[4],
    taper: shape[5],
    mergeAxis: plane(shape[6], shape[7], shape[8]),
    along: shape[9],
    across: shape[10],
    neck: shape[11],
    shift: shape[12],
    sag: shape[13],
    pinch: shape[14],
    gravity: [g.x, g.y, g.z],
    height: (1 - Math.cos(theta)) / Math.sin(theta),
  };
}

/** S3f: where the point `p` of a round unit cap goes under `s` (the twin of the vertex shader's `wShape`). */
export function shapePointLocal(p: readonly number[], s: LocalShape): [number, number, number] {
  let [x, y, z] = p;
  const t = s.height > 0 ? Math.min(1, Math.max(0, z / s.height)) : 0;
  const [ex, ey] = s.axis;
  if (ex !== 0 || ey !== 0) {
    const x0 = x * ex + y * ey;
    const y0 = -x * ey + y * ex;
    const xb = x0 + s.bulge * t;
    const yb = y0 * (1 + s.taper * Math.min(1, Math.max(-1, x0)));
    const st = Math.sqrt(Math.max(1, s.aspect));
    [x, y] = [ex * xb * st - ey * (yb / st), ey * xb * st + ex * (yb / st)];
  }
  const [mx, my] = s.mergeAxis;
  if (mx !== 0 || my !== 0) {
    const xm = x * mx + y * my;
    const ym = -x * my + y * mx;
    const u = Math.min(1, Math.max(-1, xm));
    const k = 1 - u * u;
    const pinch = 1 - s.neck * k * k;
    const keep = s.along * s.across * (1 - NECK_VOLUME * s.neck);
    const a = xm * s.along + s.shift;
    const b = ym * s.across * pinch;
    [x, y] = [mx * a - my * b, my * a + mx * b];
    if (keep > 0) z /= keep;
  }
  if (s.sag > 0 || s.pinch > 0) {
    const k = 1 + Math.max(0, s.sag);
    const c = Math.min(0.95, Math.max(0, s.pinch));
    const kt = k / (1 - (4 * c) / 3 + (8 * c * c) / 15);
    const [gx, gy, gz] = s.gravity;
    const par = x * gx + y * gy + z * gz;
    const across = (1 - c * 4 * t * (1 - t)) / Math.sqrt(k);
    [x, y, z] = [gx * par * kt + (x - gx * par) * across, gy * par * kt + (y - gy * par) * across, gz * par * kt + (z - gz * par) * across];
  }
  return [x, y, z];
}

/** S3f: the vertex shader's deformation of a shaped cap (the same steps as `shapePointLocal`). */
const SHAPE_VERTEX_DECL = `
attribute vec4 aShapeA;
attribute vec4 aShapeB;
attribute vec4 aShapeC;
attribute vec4 aShapeD;
attribute float aShapeH;
vec3 wShape(vec3 q) {
  float t = aShapeH > 0.0 ? clamp(q.z / aShapeH, 0.0, 1.0) : 0.0;
  vec2 e = aShapeA.xy;
  if (dot(e, e) > 0.0) {
    vec2 w = vec2(-e.y, e.x);
    float x0 = dot(q.xy, e);
    float y0 = dot(q.xy, w);
    float x = x0 + aShapeA.w * t;
    float y = y0 * (1.0 + aShapeB.x * clamp(x0, -1.0, 1.0));
    float st = sqrt(max(aShapeA.z, 1.0));
    q.xy = e * (x * st) + w * (y / st);
  }
  vec2 m = aShapeB.yz;
  if (dot(m, m) > 0.0) {
    vec2 w = vec2(-m.y, m.x);
    float xm = dot(q.xy, m);
    float ym = dot(q.xy, w);
    float u = clamp(xm, -1.0, 1.0);
    float k = 1.0 - u * u;
    float pinch = 1.0 - aShapeC.y * k * k;
    float keep = aShapeB.w * aShapeC.x * (1.0 - ${(35 / 48).toFixed(6)} * aShapeC.y);
    q.xy = m * (xm * aShapeB.w + aShapeC.z) + w * (ym * aShapeC.x * pinch);
    if (keep > 0.0) q.z /= keep;
  }
  if (aShapeC.w > 0.0 || aShapeD.x > 0.0) {
    float k = 1.0 + max(aShapeC.w, 0.0);
    float c = clamp(aShapeD.x, 0.0, 0.95);
    float kt = k / (1.0 - 4.0 * c / 3.0 + 8.0 * c * c / 15.0);
    vec3 g = aShapeD.yzw;
    float par = dot(q, g);
    vec3 perp = q - g * par;
    q = g * (par * kt) + perp * ((1.0 - c * 4.0 * t * (1.0 - t)) / sqrt(k));
  }
  return q;
}
`;
const SHAPE_NORMAL = `
{
  vec3 wn = normalize(objectNormal);
  vec3 wt = normalize(abs(wn.z) < 0.9 ? cross(vec3(0.0, 0.0, 1.0), wn) : cross(vec3(1.0, 0.0, 0.0), wn));
  vec3 wb = cross(wn, wt);
  vec3 w0 = wShape(position);
  vec3 wd = cross(wShape(position + wt * 1e-3) - w0, wShape(position + wb * 1e-3) - w0);
  if (dot(wd, wd) > 0.0) objectNormal = normalize(wd) * sign(dot(wd, wn) + 1e-12);
}
`;
/** S3d: segments around and bands of a drop in the air (rt-core `SPHERE_SEGMENTS`, `SPHERE_RINGS`). */
const SPHERE_SEGMENTS = 12;
const SPHERE_RINGS = 6;

const f = (v: number) => v.toFixed(4);
const FRAGMENT_DECL = `
uniform highp sampler2D wTri;
uniform highp sampler2D wVal;
uniform float wPorosity;
flat varying float vWTri;
varying vec2 vWBary;
float wWet;
float wDust;
float wSnow;
ivec2 wAt(float k) {
  int i = int(k + 0.5);
  return ivec2(i % ${TEX_W}, i / ${TEX_W});
}
vec3 wSample(float first, float r, float i, float j) {
  return texelFetch(wVal, wAt(first + j * (r + 1.0) - j * max(j - 1.0, 0.0) * 0.5 + i), 0).rgb * 255.0;
}
void wLayers() {
  vec2 tr = texelFetch(wTri, wAt(vWTri), 0).rg;
  float first = tr.x;
  float r = tr.y;
  float x = clamp(vWBary.x * r, 0.0, r);
  float y = clamp(vWBary.y * r, 0.0, r);
  float i = min(floor(x), r);
  float j = min(floor(y), r);
  float e = i + j - (r - 1.0);
  if (e > 0.0) {
    float di = min(i, e);
    i -= di;
    j -= e - di;
  }
  float fx = x - i;
  float fy = y - j;
  vec3 v;
  if (fx + fy > 1.0 && i + j + 2.0 <= r) {
    v = wSample(first, r, i + 1.0, j + 1.0) * (fx + fy - 1.0) + wSample(first, r, i, j + 1.0) * (1.0 - fx) + wSample(first, r, i + 1.0, j) * (1.0 - fy);
  } else {
    float w0 = max(1.0 - fx - fy, 0.0);
    float s = w0 + fx + fy;
    v = (wSample(first, r, i, j) * w0 + wSample(first, r, i + 1.0, j) * fx + wSample(first, r, i, j + 1.0) * fy) / s;
  }
  wWet = v.r / 255.0;
  wDust = v.g / 255.0;
  float depth = v.b * ${f(SNOW_STEP_MM)};
  wSnow = depth > 0.0 ? 1.0 - exp(-depth / ${f(WEATHER_LOOK.snowCoverMm)}) : 0.0;
}
`;
const DUST = `vec3(${WEATHER_LOOK.dustAlbedo.map(f).join(', ')})`;
// After the metalness: the dust (darker where wet), the porous albedo darker where wet, the snow.
const FRAGMENT_LAYERS = `
wLayers();
{
  vec3 wDustC = mix(${DUST}, ${DUST} * ${DUST}, wWet);
  diffuseColor.rgb = mix(diffuseColor.rgb, wDustC, wDust);
  roughnessFactor = mix(roughnessFactor, ${f(WEATHER_LOOK.dustRoughness)}, wDust);
  metalnessFactor *= 1.0 - wDust;
  float wk = 1.0 + wWet * wPorosity * ${f(WEATHER_LOOK.wetDarken)};
  diffuseColor.rgb = mix(pow(clamp(diffuseColor.rgb, 0.0, 1.0), vec3(wk)), diffuseColor.rgb, clamp(metalnessFactor, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${f(WEATHER_LOOK.snowAlbedo)}), wSnow);
  roughnessFactor = mix(roughnessFactor, ${f(WEATHER_LOOK.snowRoughness)}, wSnow);
  metalnessFactor *= 1.0 - wSnow;
}
`;
// After the physical material is set up: the film of water as a clear coat.
const FRAGMENT_COAT = `
#ifdef USE_CLEARCOAT
  material.clearcoat = max(material.clearcoat * (1.0 - wDust), wWet) * (1.0 - wSnow);
  material.clearcoatRoughness = mix(material.clearcoatRoughness, ${f(WEATHER_LOOK.wetCoatRoughness)}, wWet);
#endif
`;

interface WeatherUniforms {
  wTri: { value: THREE.DataTexture | null };
  wVal: { value: THREE.DataTexture | null };
  wPorosity: { value: number };
}

/** The material a weathered copy was made from (its own patch runs first). */
const UNDER = new WeakMap<THREE.Material, THREE.Material>();
const UNIFORMS = new WeakMap<THREE.Material, WeatherUniforms>();

/** Makes `m` (a copy of `under`) draw the weather of the textures of `u`. */
function enableWeather(m: THREE.MeshPhysicalMaterial, under: THREE.Material, u: WeatherUniforms): void {
  UNDER.set(m, under);
  UNIFORMS.set(m, u);
  // The coat must be compiled in for the film (a coat of nothing elsewhere).
  if (!(m.clearcoat > 0)) {
    m.clearcoat = 1e-4;
    m.clearcoatRoughness = WEATHER_LOOK.wetCoatRoughness;
  }
  m.onBeforeCompile = (shader, renderer) => {
    UNDER.get(m)?.onBeforeCompile(shader, renderer);
    Object.assign(shader.uniforms, UNIFORMS.get(m));
    shader.vertexShader =
      'attribute float aWTri;\nattribute vec2 aWBary;\nflat varying float vWTri;\nvarying vec2 vWBary;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWTri = aWTri;\nvWBary = aWBary;');
    shader.fragmentShader = (FRAGMENT_DECL + shader.fragmentShader)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>${FRAGMENT_LAYERS}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>${FRAGMENT_COAT}`)
      .replace('#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment.replace('material.transmission = transmission;', 'material.transmission = transmission * (1.0 - wDust) * (1.0 - wSnow);'));
  };
  m.customProgramCacheKey = () => `repack-weather|${UNDER.get(m)?.customProgramCacheKey() ?? ''}`;
  m.needsUpdate = true;
}

/** The weather drawn on one part. */
interface PartWeatherDraw {
  /** The base geometry this was made from, and the copy with the weather's attributes. */
  base: THREE.BufferGeometry;
  geometry: THREE.BufferGeometry;
  uniforms: WeatherUniforms;
  valTex: THREE.DataTexture;
  /** Object-space unit normal of each triangle (3 floats each). */
  normals: Float32Array;
  caps: THREE.InstancedMesh | null;
  /** S3f: its caps are shaped (their own finer geometry, with the shapes as instance attributes). */
  shaped: boolean;
  /** S3e: the dust's motes on it (grains in its object space), or none. */
  motes: THREE.InstancedMesh | null;
  capAngle: number;
  /** Copies of the part's materials, by the base material. */
  materials: Map<THREE.Material, THREE.MeshPhysicalMaterial>;
  used: Set<THREE.Material>;
}

function dataTexture(data: Float32Array | Uint8Array, format: THREE.PixelFormat, type: THREE.TextureDataType): THREE.DataTexture {
  const per = format === THREE.RGFormat ? 2 : 4;
  const texels = data.length / per;
  const h = Math.max(1, Math.ceil(texels / TEX_W));
  const full = new (data instanceof Float32Array ? Float32Array : Uint8Array)(TEX_W * h * per);
  full.set(data);
  const t = new THREE.DataTexture(full, TEX_W, h, format, type);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** The unit cap of a drop at contact angle `deg`: contact radius 1, its axis +Z, the surface z = 0. */
export function capGeometry(deg: number, rings = CAP_RINGS): THREE.BufferGeometry {
  const theta = (Math.min(179, Math.max(1, deg)) * Math.PI) / 180;
  const big = 1 / Math.sin(theta);
  const cz = -big * Math.cos(theta);
  const pos: number[] = [0, 0, cz + big];
  const nrm: number[] = [0, 0, 1];
  for (let r = 1; r <= rings; r++) {
    const phi = (theta * r) / rings;
    for (let s = 0; s < CAP_SEGMENTS; s++) {
      const psi = (2 * Math.PI * s) / CAP_SEGMENTS;
      const d = [Math.sin(phi) * Math.cos(psi), Math.sin(phi) * Math.sin(psi), Math.cos(phi)];
      pos.push(d[0] * big, d[1] * big, cz + d[2] * big);
      nrm.push(d[0], d[1], d[2]);
    }
  }
  const ring = (r: number, s: number) => 1 + (r - 1) * CAP_SEGMENTS + (s % CAP_SEGMENTS);
  const idx: number[] = [];
  for (let s = 0; s < CAP_SEGMENTS; s++) idx.push(0, ring(1, s), ring(1, s + 1));
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < CAP_SEGMENTS; s++) {
      const a = ring(r, s);
      const b = ring(r, s + 1);
      const c = ring(r + 1, s);
      const d = ring(r + 1, s + 1);
      idx.push(a, c, d, a, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** The weathered copy of a part's geometry: not indexed, each corner with its triangle's number and its weights. */
function weatherGeometry(base: THREE.BufferGeometry): { geometry: THREE.BufferGeometry; normals: Float32Array } {
  const g = base.index ? base.toNonIndexed() : base.clone();
  const n = g.getAttribute('position').count;
  const tri = new Float32Array(n);
  const bary = new Float32Array(2 * n);
  const corner = [
    [0, 0],
    [1, 0],
    [0, 1],
  ];
  for (let v = 0; v < n; v++) {
    tri[v] = Math.floor(v / 3);
    bary[2 * v] = corner[v % 3][0];
    bary[2 * v + 1] = corner[v % 3][1];
  }
  g.setAttribute('aWTri', new THREE.BufferAttribute(tri, 1));
  g.setAttribute('aWBary', new THREE.BufferAttribute(bary, 2));
  const p = g.getAttribute('position');
  const normals = new Float32Array(3 * Math.floor(n / 3));
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < n / 3; t++) {
    a.fromBufferAttribute(p, 3 * t);
    b.fromBufferAttribute(p, 3 * t + 1).sub(a);
    c.fromBufferAttribute(p, 3 * t + 2).sub(a);
    b.cross(c).normalize();
    normals.set([b.x, b.y, b.z], 3 * t);
  }
  g.userData = { ...base.userData };
  return { geometry: g, normals };
}

/** The Fast preview's rain, dust and snow on the parts. */
export class WeatherPreview {
  private readonly parts = new Map<NodeId, PartWeatherDraw>();
  private track: PartsTrack | null = null;
  private frameKey = '';
  private readonly capMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 1, ior: 1.333, thickness: 0.5 });
  private readonly capGeometries = new Map<number, THREE.BufferGeometry>();
  /** S3f: the caps' water, deformed by their shapes. */
  private readonly shapedMaterial = (() => {
    const m = this.capMaterial.clone();
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = (SHAPE_VERTEX_DECL + shader.vertexShader)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>${SHAPE_NORMAL}`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = wShape(transformed);');
    };
    m.customProgramCacheKey = () => 'repack-drop-shapes';
    return m;
  })();
  /** S3d: the drops in the air (unit spheres, scaled), in the root's space. */
  private readonly sphere = new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_RINGS);
  private falling: THREE.InstancedMesh | null = null;
  /** S3e: the dust's grains (a unit octahedron, scaled) and their dry dust. */
  private readonly grain = new THREE.OctahedronGeometry(1, 0);
  private readonly dustMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(...WEATHER_LOOK.dustAlbedo), roughness: WEATHER_LOOK.dustRoughness, metalness: 0 });
  /** S3e: the studio floor's plane and its cells. */
  private floorMesh: THREE.Mesh | null = null;
  private floorTex: THREE.DataTexture | null = null;
  /** What the frame holds on the parts that draw it (the meter: core/wet-parts.ts `partsShown`). */
  shown: PartsShown | null = null;

  constructor(private readonly root: THREE.Object3D) {}

  /** The base geometries of the parts that draw the weather (their copies are made of them). */
  bases(): THREE.BufferGeometry[] {
    return [...this.parts.values()].map((p) => p.base);
  }

  /** The geometry a part draws with now: its weathered copy, or `base`. */
  geometryOf(id: NodeId, base: THREE.BufferGeometry): THREE.BufferGeometry {
    const p = this.parts.get(id);
    return p && p.base === base ? p.geometry : base;
  }

  /** The material a part draws `base` with now: a copy that runs the weather after `base`'s own patch, or `base`. */
  materialOf<M extends THREE.Material>(id: NodeId, base: M): M {
    const p = this.parts.get(id);
    if (!p || !(base instanceof THREE.MeshPhysicalMaterial)) return base;
    const under: THREE.MeshPhysicalMaterial = base;
    p.used.add(under);
    const userData = under.userData;
    under.userData = {};
    let m = p.materials.get(under);
    if (m) m.copy(under);
    else {
      m = under.clone();
      p.materials.set(under, m);
    }
    under.userData = userData;
    enableWeather(m, under, p.uniforms);
    return m as unknown as M;
  }

  /** After the materials were assigned: the copies no part uses go. */
  prune(): void {
    for (const p of this.parts.values()) {
      for (const [b, m] of p.materials) {
        if (!p.used.has(b)) {
          m.dispose();
          p.materials.delete(b);
        }
      }
      p.used.clear();
    }
  }

  /**
   * Follows the pose: the recorded frame's samples and drops on every part that has them. `objects` are the parts'
   * objects (posed), `geometryOf` their base geometries. True when the parts that draw the weather changed (their
   * geometries and materials must be assigned again).
   */
  update(state: ProjectState, pose: Pose | null, objects: ReadonlyMap<NodeId, THREE.Object3D>, geometryOf: (id: NodeId) => THREE.BufferGeometry | null): boolean {
    const rec = recordedParts(state, pose);
    const key = rec ? `${rec.track.key}|${pose?.parts?.frame ?? 0}` : '';
    if (!rec) {
      const had = this.parts.size > 0;
      this.clear();
      this.placeFalling([]);
      this.placeFloor(null);
      this.track = null;
      this.frameKey = '';
      this.shown = null;
      return had;
    }
    let changed = false;
    if (rec.track !== this.track) {
      this.clear();
      this.track = rec.track;
      changed = true;
    }
    // Which parts draw it, made the first time (or when their geometry changed).
    const wanted = new Set<NodeId>();
    rec.track.parts.forEach((tp, k) => {
      const node = state.scene.nodes[tp.node];
      const base = node ? geometryOf(tp.node) : null;
      const res = partsResolution(rec.track, k);
      if (!node || !base || !res || node.mesh?.id !== tp.mesh || (base.index ? base.index.count : base.getAttribute('position').count) / 3 !== tp.triangles) return;
      wanted.add(tp.node);
      const have = this.parts.get(tp.node);
      if (have && have.base === base) return;
      if (have) this.drop(tp.node);
      const { geometry, normals } = weatherGeometry(base);
      const tri = new Float32Array(2 * res.length);
      let first = 0;
      res.forEach((r, t) => {
        tri[2 * t] = first;
        tri[2 * t + 1] = r;
        first += ((r + 1) * (r + 2)) / 2;
      });
      const valTex = dataTexture(new Uint8Array(4 * first), THREE.RGBAFormat, THREE.UnsignedByteType);
      const uniforms: WeatherUniforms = { wTri: { value: dataTexture(tri, THREE.RGFormat, THREE.FloatType) }, wVal: { value: valTex }, wPorosity: { value: tp.porosity } };
      this.parts.set(tp.node, { base, geometry, uniforms, valTex, normals, caps: null, shaped: false, motes: null, capAngle: tp.capAngleDeg, materials: new Map(), used: new Set() });
      changed = true;
    });
    for (const id of [...this.parts.keys()]) {
      if (!wanted.has(id)) {
        this.drop(id);
        changed = true;
      }
    }
    // The frame: the samples' bytes into the textures, the caps where the drops are.
    if (key !== this.frameKey || changed) {
      this.frameKey = key;
      rec.track.parts.forEach((tp, k) => {
        const p = this.parts.get(tp.node);
        const fr = rec.frame.parts[k];
        if (!p || !fr) return;
        const data = p.valTex.image.data as Uint8Array;
        for (let s = 0; s < fr.values.length / 3; s++) {
          data[4 * s] = fr.values[3 * s];
          data[4 * s + 1] = fr.values[3 * s + 1];
          data[4 * s + 2] = fr.values[3 * s + 2];
        }
        p.valTex.needsUpdate = true;
        this.placeCaps(tp.node, p, fr.drops, objects.get(tp.node) ?? null);
        this.placeMotes(tp.node, p, rec.track, k, fr.values, objects.get(tp.node) ?? null);
      });
      // S3e: the studio floor.
      this.placeFloor(state.studio.floor ? (rec.frame.floor ?? null) : null);
      // S3d: what the frame holds (on the parts drawn), and its drops in the air.
      const drawn = (k: number) => this.parts.has(rec.track.parts[k]?.node ?? '');
      this.shown = partsShown(rec.frame, drawn);
      this.placeFalling(rec.frame.falling.filter((f) => drawn(f.part)));
    } else {
      // The parts may have moved (a clip of the pose): the caps and the motes follow them.
      for (const [id, p] of this.parts) {
        this.followCaps(p, objects.get(id) ?? null);
        if (p.motes) this.follow(p.motes, objects.get(id) ?? null);
      }
    }
    return changed;
  }

  private capGeometry(deg: number): THREE.BufferGeometry {
    const k = Math.round(deg * 10) / 10;
    let g = this.capGeometries.get(k);
    if (!g) {
      g = capGeometry(k);
      this.capGeometries.set(k, g);
    }
    return g;
  }

  /** The caps of a part's drops, in the part's object space. S3f: shaped when the drops have shapes. */
  private placeCaps(id: NodeId, p: PartWeatherDraw, drops: readonly { triangle: number; position: readonly number[]; radius: number; shape?: DropShape }[], obj: THREE.Object3D | null): void {
    const shaped = drops.some((d) => d.shape !== undefined);
    if (p.caps && (p.caps.count < drops.length || p.caps.instanceMatrix.count < drops.length || p.shaped !== shaped)) {
      p.caps.removeFromParent();
      if (p.shaped) p.caps.geometry.dispose();
      p.caps.dispose();
      p.caps = null;
    }
    if (!p.caps && drops.length > 0) {
      const n = Math.max(16, drops.length);
      let geometry = this.capGeometry(p.capAngle);
      if (shaped) {
        geometry = capGeometry(p.capAngle, SHAPED_CAP_RINGS);
        for (const [name, size] of [['aShapeA', 4], ['aShapeB', 4], ['aShapeC', 4], ['aShapeD', 4], ['aShapeH', 1]] as const) {
          geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(n * size), size));
        }
      }
      p.caps = new THREE.InstancedMesh(geometry, shaped ? this.shapedMaterial : this.capMaterial, n);
      p.caps.name = `drops:${id}`;
      p.caps.castShadow = false;
      p.caps.matrixAutoUpdate = false;
      p.caps.userData.weatherCaps = true;
      p.caps.userData.shaped = shaped;
      p.shaped = shaped;
      this.root.add(p.caps);
    }
    if (!p.caps) return;
    this.followCaps(p, obj);
    const z = new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const lift = 1e-3;
    // S3f: gravity (the model's −Z) in the part's object space, where it stands now.
    const gravity = new THREE.Vector3(0, 0, -1).transformDirection(p.caps.matrix.clone().invert());
    drops.forEach((d, i) => {
      n.fromArray(p.normals, 3 * d.triangle);
      q.setFromUnitVectors(z, n);
      m.compose(new THREE.Vector3(d.position[0] + n.x * lift * d.radius, d.position[1] + n.y * lift * d.radius, d.position[2] + n.z * lift * d.radius), q, new THREE.Vector3(d.radius, d.radius, d.radius));
      p.caps!.setMatrixAt(i, m);
      if (shaped) {
        const s = localShape(d.shape && !isRoundShape(d.shape) ? d.shape : [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0], q, gravity, p.capAngle);
        const g = p.caps!.geometry;
        (g.getAttribute('aShapeA') as THREE.InstancedBufferAttribute).setXYZW(i, s.axis[0], s.axis[1], s.aspect, s.bulge);
        (g.getAttribute('aShapeB') as THREE.InstancedBufferAttribute).setXYZW(i, s.taper, s.mergeAxis[0], s.mergeAxis[1], s.along);
        (g.getAttribute('aShapeC') as THREE.InstancedBufferAttribute).setXYZW(i, s.across, s.neck, s.shift, s.sag);
        (g.getAttribute('aShapeD') as THREE.InstancedBufferAttribute).setXYZW(i, s.pinch, s.gravity[0], s.gravity[1], s.gravity[2]);
        (g.getAttribute('aShapeH') as THREE.InstancedBufferAttribute).setX(i, s.height);
      }
    });
    if (shaped) for (const name of ['aShapeA', 'aShapeB', 'aShapeC', 'aShapeD', 'aShapeH']) p.caps.geometry.getAttribute(name).needsUpdate = true;
    p.caps.count = drops.length;
    p.caps.instanceMatrix.needsUpdate = true;
  }

  /** S3f: the shapes of a part's caps as the vertex shader takes them (tests): its local shapes, or null when round. */
  capShapes(id: NodeId): { shape: number[]; height: number }[] | null {
    const p = this.parts.get(id);
    if (!p?.caps || !p.shaped) return null;
    const g = p.caps.geometry;
    const out = [];
    for (let i = 0; i < p.caps.count; i++) {
      const v = (name: string, size: number) => Array.from({ length: size }, (_, c) => (g.getAttribute(name) as THREE.InstancedBufferAttribute).array[i * size + c]);
      out.push({ shape: [...v('aShapeA', 4), ...v('aShapeB', 4), ...v('aShapeC', 4), ...v('aShapeD', 4)], height: v('aShapeH', 1)[0] });
    }
    return out;
  }

  /** S3d: the spheres of the drops in the air, where the engine has them (the model's world: the root's space). */
  private placeFalling(drops: readonly FallingDropFrame[]): void {
    if (this.falling && this.falling.instanceMatrix.count < drops.length) {
      this.falling.removeFromParent();
      this.falling.dispose();
      this.falling = null;
    }
    if (!this.falling && drops.length > 0) {
      this.falling = new THREE.InstancedMesh(this.sphere, this.capMaterial, Math.max(16, drops.length));
      this.falling.name = 'drops:air';
      this.falling.castShadow = false;
      this.falling.userData.weatherCaps = true;
      this.falling.frustumCulled = false;
      this.root.add(this.falling);
    }
    if (!this.falling) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    drops.forEach((d, i) => {
      m.compose(new THREE.Vector3(d.position[0], d.position[1], d.position[2]), q, new THREE.Vector3(d.radius, d.radius, d.radius));
      this.falling!.setMatrixAt(i, m);
    });
    this.falling.count = drops.length;
    this.falling.instanceMatrix.needsUpdate = true;
  }

  /** S3d: the drops in the air drawn now (tests). */
  fallingDrawn(): number {
    return this.falling?.count ?? 0;
  }

  /** The caps where the part stands: its object's matrix in the root's space. */
  private followCaps(p: PartWeatherDraw, obj: THREE.Object3D | null): void {
    if (p.caps) this.follow(p.caps, obj);
  }

  /** `m` where the part `obj` stands: its object's matrix in the root's space (S3e: the motes too). */
  private follow(m: THREE.Object3D, obj: THREE.Object3D | null): void {
    if (!obj) {
      m.visible = false;
      return;
    }
    obj.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, false);
    m.matrix.copy(this.root.matrixWorld).invert().multiply(obj.matrixWorld);
    m.matrixWorldNeedsUpdate = true;
    m.visible = obj.visible;
  }

  /** S3e: the motes of part `k` of `track` at a frame (its samples' bytes `values`), in the part's object space. */
  private placeMotes(id: NodeId, p: PartWeatherDraw, track: PartsTrack, k: number, values: Uint8Array, obj: THREE.Object3D | null): void {
    const res = partsResolution(track, k);
    const pos = p.geometry.getAttribute('position');
    const motes =
      track.motes && res
        ? motesOn(res, values, (t) => (3 * t + 2 < pos.count ? [[pos.getX(3 * t), pos.getY(3 * t), pos.getZ(3 * t)], [pos.getX(3 * t + 1), pos.getY(3 * t + 1), pos.getZ(3 * t + 1)], [pos.getX(3 * t + 2), pos.getY(3 * t + 2), pos.getZ(3 * t + 2)]] : null), track.motes)
        : [];
    if (p.motes && p.motes.instanceMatrix.count < motes.length) {
      p.motes.removeFromParent();
      p.motes.dispose();
      p.motes = null;
    }
    if (!p.motes && motes.length > 0) {
      p.motes = new THREE.InstancedMesh(this.grain, this.dustMaterial, Math.max(64, motes.length));
      p.motes.name = `motes:${id}`;
      p.motes.matrixAutoUpdate = false;
      p.motes.castShadow = false;
      p.motes.userData.weatherCaps = true;
      this.root.add(p.motes);
    }
    if (!p.motes) return;
    this.follow(p.motes, obj);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const z = new THREE.Vector3(0, 0, 1);
    motes.forEach((g, i) => {
      q.setFromUnitVectors(z, new THREE.Vector3(...g.normal));
      const c = new THREE.Vector3(g.position[0] + (g.normal[0] * g.radius) / 3, g.position[1] + (g.normal[1] * g.radius) / 3, g.position[2] + (g.normal[2] * g.radius) / 3);
      m.compose(c, q, new THREE.Vector3(g.radius, g.radius, g.radius));
      p.motes!.setMatrixAt(i, m);
    });
    p.motes.count = motes.length;
    p.motes.instanceMatrix.needsUpdate = true;
  }

  /** S3e: the motes drawn on a part now (tests). */
  motesDrawn(id: NodeId): number {
    return this.parts.get(id)?.motes?.count ?? 0;
  }

  /** S3e: the studio floor's plane over the frame's cells (null: none). */
  private placeFloor(fl: FloorFrame | null): void {
    if (!fl) {
      if (this.floorMesh) this.floorMesh.visible = false;
      return;
    }
    const n = fl.nx * fl.ny;
    if (!this.floorMesh || !this.floorTex || this.floorTex.image.width !== fl.nx || this.floorTex.image.height !== fl.ny) {
      this.disposeFloor();
      const data = new Uint8Array(4 * n);
      const tex = new THREE.DataTexture(data, fl.nx, fl.ny, THREE.RGBAFormat, THREE.UnsignedByteType);
      // Linear between the cells' centres, as the engine reads them.
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      this.floorTex = tex;
      // The cells are the material's map, read by the patch instead of three's colour lookup.
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: WEATHER_LOOK.dustRoughness, metalness: 0, transparent: true, depthWrite: false });
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `{
  vec4 wv = texture2D(map, vMapUv);
  float wet = wv.r;
  float dust = wv.g;
  float depth = wv.b * 255.0 * ${f(SNOW_STEP_MM)};
  float snow = depth > 0.0 ? 1.0 - exp(-depth / ${f(WEATHER_LOOK.snowCoverMm)}) : 0.0;
  float cover = 1.0 - (1.0 - dust) * (1.0 - snow);
  vec3 dustC = mix(${DUST}, ${DUST} * ${DUST}, wet);
  vec3 coverC = mix(dustC, vec3(${f(WEATHER_LOOK.snowAlbedo)}), cover > 0.0 ? clamp(snow / cover, 0.0, 1.0) : 0.0);
  float dark = 1.0 - pow(0.5, wet * ${f(FLOOR_POROSITY)});
  float a = cover + (1.0 - cover) * dark;
  diffuseColor = vec4(a > 0.0 ? coverC * cover / a : vec3(0.0), a);
}`,
        ).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, ${f(WEATHER_LOOK.wetCoatRoughness)}, texture2D(map, vMapUv).r * (1.0 - texture2D(map, vMapUv).g));`);
      };
      mat.customProgramCacheKey = () => 'repack-wet-floor';
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.name = 'floor:weather';
      mesh.receiveShadow = true;
      mesh.renderOrder = 0;
      mesh.userData.weatherCaps = true;
      this.floorMesh = mesh;
      this.root.add(mesh);
    }
    const data = this.floorTex!.image.data as Uint8Array;
    for (let c = 0; c < n; c++) {
      data[4 * c] = fl.values[3 * c];
      data[4 * c + 1] = fl.values[3 * c + 1];
      data[4 * c + 2] = fl.values[3 * c + 2];
      data[4 * c + 3] = 255;
    }
    this.floorTex!.needsUpdate = true;
    const w = fl.nx * fl.cell;
    const h = fl.ny * fl.cell;
    this.floorMesh!.scale.set(w, h, 1);
    this.floorMesh!.position.set(fl.x0 + w / 2, fl.y0 + h / 2, fl.z + 0.02);
    this.floorMesh!.visible = true;
  }

  /** S3e: the studio floor's cells drawn now (tests): their count, or 0. */
  floorDrawn(): number {
    return this.floorMesh?.visible && this.floorTex ? this.floorTex.image.width * this.floorTex.image.height : 0;
  }

  private disposeFloor(): void {
    if (this.floorMesh) {
      this.floorMesh.removeFromParent();
      this.floorMesh.geometry.dispose();
      (this.floorMesh.material as THREE.Material).dispose();
      this.floorMesh = null;
    }
    this.floorTex?.dispose();
    this.floorTex = null;
  }

  private drop(id: NodeId): void {
    const p = this.parts.get(id);
    if (!p) return;
    p.geometry.dispose();
    p.valTex.dispose();
    p.uniforms.wTri.value?.dispose();
    for (const m of p.materials.values()) m.dispose();
    if (p.caps) {
      p.caps.removeFromParent();
      if (p.shaped) p.caps.geometry.dispose();
      p.caps.dispose();
    }
    if (p.motes) {
      p.motes.removeFromParent();
      p.motes.dispose();
    }
    this.parts.delete(id);
  }

  private clear(): void {
    for (const id of [...this.parts.keys()]) this.drop(id);
  }

  dispose(): void {
    this.clear();
    if (this.falling) {
      this.falling.removeFromParent();
      this.falling.dispose();
      this.falling = null;
    }
    this.sphere.dispose();
    this.disposeFloor();
    this.grain.dispose();
    this.dustMaterial.dispose();
    this.capMaterial.dispose();
    this.shapedMaterial.dispose();
    for (const g of this.capGeometries.values()) g.dispose();
  }
}

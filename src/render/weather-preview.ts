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

import * as THREE from 'three';
import type { Pose } from '../core/animation';
import type { NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';
import { partsResolution, partsShown, recordedParts, SNOW_STEP_MM, type FallingDropFrame, type PartsShown, type PartsTrack } from '../core/wet-parts';

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
export function capGeometry(deg: number): THREE.BufferGeometry {
  const theta = (Math.min(179, Math.max(1, deg)) * Math.PI) / 180;
  const big = 1 / Math.sin(theta);
  const cz = -big * Math.cos(theta);
  const pos: number[] = [0, 0, cz + big];
  const nrm: number[] = [0, 0, 1];
  for (let r = 1; r <= CAP_RINGS; r++) {
    const phi = (theta * r) / CAP_RINGS;
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
  for (let r = 1; r < CAP_RINGS; r++) {
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
  /** S3d: the drops in the air (unit spheres, scaled), in the root's space. */
  private readonly sphere = new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_RINGS);
  private falling: THREE.InstancedMesh | null = null;
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
      this.parts.set(tp.node, { base, geometry, uniforms, valTex, normals, caps: null, capAngle: tp.capAngleDeg, materials: new Map(), used: new Set() });
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
      });
      // S3d: what the frame holds (on the parts drawn), and its drops in the air.
      const drawn = (k: number) => this.parts.has(rec.track.parts[k]?.node ?? '');
      this.shown = partsShown(rec.frame, drawn);
      this.placeFalling(rec.frame.falling.filter((f) => drawn(f.part)));
    } else {
      // The parts may have moved (a clip of the pose): the caps follow them.
      for (const [id, p] of this.parts) this.followCaps(p, objects.get(id) ?? null);
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

  /** The caps of a part's drops, in the part's object space. */
  private placeCaps(id: NodeId, p: PartWeatherDraw, drops: readonly { triangle: number; position: readonly number[]; radius: number }[], obj: THREE.Object3D | null): void {
    if (p.caps && p.caps.count < drops.length) {
      p.caps.removeFromParent();
      p.caps.dispose();
      p.caps = null;
    }
    if (!p.caps && drops.length > 0) {
      p.caps = new THREE.InstancedMesh(this.capGeometry(p.capAngle), this.capMaterial, Math.max(16, drops.length));
      p.caps.name = `drops:${id}`;
      p.caps.castShadow = false;
      p.caps.matrixAutoUpdate = false;
      p.caps.userData.weatherCaps = true;
      this.root.add(p.caps);
    }
    if (!p.caps) return;
    const z = new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const lift = 1e-3;
    drops.forEach((d, i) => {
      n.fromArray(p.normals, 3 * d.triangle);
      q.setFromUnitVectors(z, n);
      m.compose(new THREE.Vector3(d.position[0] + n.x * lift * d.radius, d.position[1] + n.y * lift * d.radius, d.position[2] + n.z * lift * d.radius), q, new THREE.Vector3(d.radius, d.radius, d.radius));
      p.caps!.setMatrixAt(i, m);
    });
    p.caps.count = drops.length;
    p.caps.instanceMatrix.needsUpdate = true;
    this.followCaps(p, obj);
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
    if (!p.caps) return;
    if (!obj) {
      p.caps.visible = false;
      return;
    }
    obj.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, false);
    p.caps.matrix.copy(this.root.matrixWorld).invert().multiply(obj.matrixWorld);
    p.caps.matrixWorldNeedsUpdate = true;
    p.caps.visible = obj.visible;
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
      p.caps.dispose();
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
    this.capMaterial.dispose();
    for (const g of this.capGeometries.values()) g.dispose();
  }
}

// The passes of AI-POST.md §7.4 drawn with three.js, at the size of the Fast-mode preview (phase X4): albedo,
// shading normal in the world (Z up), depth along the view axis, the part id and the material id (RSB index
// + 1, from the engine's own scene: core/pass-ids.ts) and the circle of confusion of the thin lens. They are
// the same planes the engine writes (core/passes.ts), so the interface and the AI guard work from the same
// format whichever engine drew the picture.
//
//   - The ids are written as the four bytes of the u32 into an 8-bit target, nearest-filtered and without
//     multisampling, so they come back exact. Depth and normal share one float target (xyz = normal,
//     w = depth); the albedo has its own. Nothing is anti-aliased: every plane is one sample at the pixel
//     centre, like the engine's one ray without jitter.
//   - Both sides of a triangle count (a ray hits either); the lights and every overlay do not (they are not
//     parts), and the background is 0 / +∞ as in the contract.
//   - The studio floor (X3c, AI-POST.md §7.4) is not drawn: its plane is found by casting the engine's own
//     centre ray of every pixel (`floorHits`, the camera of `Camera::generate_ray`), and it is FLOOR_ID in
//     both ids wherever it is nearer than the parts, with its normal turned to the camera and its colour as
//     the albedo, like the engine's passes. An infinite plane needs no far plane and no depth buffer.
//   - The Y-up of three.js never leaves this file as such: normals go out in model space through the
//     basis `preview.ts` derives from its `toThree`.
//
// The part that reads the GPU is `drawPasses`; `assemblePasses` (flip the rows, unpack the ids, convert the
// normals, +∞ for the background, the coc from the depth) is plain arithmetic and is tested in Node.

import * as THREE from 'three';
import { cocPass, type LensParams } from '../core/lens-coc';
import { indexPassIds, type PassCamera, type PassFloor, type PassIds, type PassIndex } from '../core/pass-ids';
import { FLOOR_ID, PASS_KEYS, type PassKey, type RenderPasses } from '../core/passes';

/** A visible part of the preview: its mesh (with current world matrix) and the material key of each geometry group. */
export interface PassMesh {
  mesh: THREE.Mesh;
  /** The scene node (the part). */
  node: string;
  /**
   * The material key of the triangles drawn with material index `i` of the mesh: the project's material id, or
   * null for the default material. A mesh without groups has one entry.
   */
  keys: readonly (string | null)[];
}

export interface DrawPassesInput {
  renderer: THREE.WebGLRenderer;
  /** Already placed for the output (aspect included). */
  camera: THREE.Camera;
  meshes: readonly PassMesh[];
  ids: PassIds;
  width: number;
  height: number;
  lens: LensParams;
  /** The model-space images of three.js's +X, +Y and +Z (preview.ts derives them from `toThree`). */
  axes: readonly [readonly number[], readonly number[], readonly number[]];
  /** The passes to give (the part ids are always drawn: they are the coverage of the others). */
  passes: readonly PassKey[];
}

/** What the render targets hold, rows from the bottom as OpenGL reads them. */
export interface RawPasses {
  /** u32 part id as four bytes (little-endian) per pixel. */
  part: Uint8Array;
  /** u32 material id as four bytes per pixel. */
  material: Uint8Array | null;
  /** xyz = normal in three.js space (0 on the background), w = depth along the view axis. */
  nd: Float32Array | null;
  /** rgb = albedo (0 on the background). */
  albedo: Float32Array | null;
}

// ------------------------------------------------------------------ pure arithmetic

/** The four bytes of a u32, least significant first. */
export function packId(id: number): [number, number, number, number] {
  const v = id >>> 0;
  return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
}

/** The u32 ids of `packId` bytes (4 per pixel), reading rows from the top: the bottom-up rows are flipped. */
export function unpackIds(bytes: Uint8Array, width: number, height: number): Uint32Array {
  const out = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width;
    for (let x = 0; x < width; x++) {
      const i = (src + x) * 4;
      out[y * width + x] = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
    }
  }
  return out;
}

/** `Ray::EPSILON` of the engine: a hit nearer than this along the ray is none. */
const RAY_EPSILON = 1e-3;

type V3 = [number, number, number];
const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The engine camera's basis (`Camera::basis`): forward, right, up, with its fallbacks for degenerate cameras. */
export function cameraBasis(cam: PassCamera): { forward: V3; right: V3; up: V3 } {
  let forward = norm3([cam.target[0] - cam.position[0], cam.target[1] - cam.position[1], cam.target[2] - cam.position[2]]);
  if (forward[0] === 0 && forward[1] === 0 && forward[2] === 0) forward = [0, 1, 0];
  let right = norm3(cross3(forward, [cam.up[0], cam.up[1], cam.up[2]]));
  if (right[0] * right[0] + right[1] * right[1] + right[2] * right[2] < 0.5) right = norm3(cross3(forward, Math.abs(forward[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return { forward, right, up: cross3(right, forward) };
}

/**
 * Where the centre ray of every pixel (rows from the top) meets the floor plane: the distance along the view
 * axis (+∞ where it does not: the ray runs level or away from it) and the z of the plane's normal turned to the
 * ray (`FirstHit::Floor`). The rays are the engine's (`Camera::generate_ray` at the pixel centre and the lens
 * centre); depth as `Exact::of` measures it.
 */
export function floorHits(floor: PassFloor, width: number, height: number): { depth: Float32Array; normalZ: Int8Array } {
  const cam = floor.camera;
  const { forward, right, up } = cameraBasis(cam);
  const aspect = width / height;
  const [sw, sh] = aspect >= 1 ? [cam.sensorMm, cam.sensorMm / aspect] : [cam.sensorMm * aspect, cam.sensorMm];
  const out = new Float32Array(width * height).fill(Infinity);
  const normalZ = new Int8Array(width * height);
  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height;
    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width;
      let oz = cam.position[2];
      let dir: V3;
      if (cam.ortho) {
        oz += (u - 0.5) * cam.orthoWidth * right[2] + ((0.5 - v) * cam.orthoWidth * up[2]) / aspect;
        dir = forward;
      } else {
        const x = (u - 0.5) * sw;
        const y = (0.5 - v) * sh;
        dir = norm3([forward[0] * cam.focalMm + right[0] * x + up[0] * y, forward[1] * cam.focalMm + right[1] * x + up[1] * y, forward[2] * cam.focalMm + right[2] * x + up[2] * y]);
      }
      if (dir[2] === 0) continue;
      const t = (floor.z - oz) / dir[2];
      if (!(t > RAY_EPSILON) || !Number.isFinite(t)) continue;
      // The orthographic origin's offset is across the axis: it adds nothing along it.
      out[py * width + px] = t * (dir[0] * forward[0] + dir[1] * forward[1] + dir[2] * forward[2]);
      normalZ[py * width + px] = dir[2] < 0 ? 1 : -1;
    }
  }
  return { depth: out, normalZ };
}

/** Assembles the contract's planes from what the targets hold, and the studio floor where it is in front. */
export function assemblePasses(raw: RawPasses, width: number, height: number, axes: DrawPassesInput['axes'], lens: LensParams, wanted: readonly PassKey[], floor: PassFloor | null = null): RenderPasses {
  const has = (k: PassKey) => wanted.includes(k);
  const n = width * height;
  const partId = unpackIds(raw.part, width, height);
  const materialId = raw.material ? unpackIds(raw.material, width, height) : new Uint32Array(n);
  const out: RenderPasses = { width, height };
  const albedo = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const depth = new Float32Array(n).fill(Infinity);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width;
    for (let x = 0; x < width; x++) {
      const o = y * width + x;
      if (partId[o] === 0) continue;
      const i = (src + x) * 4;
      if (raw.albedo) {
        albedo[o * 3] = raw.albedo[i];
        albedo[o * 3 + 1] = raw.albedo[i + 1];
        albedo[o * 3 + 2] = raw.albedo[i + 2];
      }
      if (raw.nd) {
        const nx = raw.nd[i];
        const ny = raw.nd[i + 1];
        const nz = raw.nd[i + 2];
        for (let c = 0; c < 3; c++) normal[o * 3 + c] = nx * axes[0][c] + ny * axes[1][c] + nz * axes[2][c];
        depth[o] = raw.nd[i + 3];
      }
    }
  }
  if (floor) {
    // The nearer of the parts and the floor, as the engine's first hit (without a depth target a part always wins).
    const hits = floorHits(floor, width, height);
    for (let o = 0; o < n; o++) {
      const d = hits.depth[o];
      if (d === Infinity || (partId[o] !== 0 && !(raw.nd && d < depth[o]))) continue;
      partId[o] = FLOOR_ID;
      materialId[o] = FLOOR_ID;
      depth[o] = d;
      normal[o * 3] = 0;
      normal[o * 3 + 1] = 0;
      normal[o * 3 + 2] = hits.normalZ[o];
      albedo[o * 3] = floor.albedo[0];
      albedo[o * 3 + 1] = floor.albedo[1];
      albedo[o * 3 + 2] = floor.albedo[2];
    }
  }
  if (has('partId')) out.partId = partId;
  if (has('materialId')) out.materialId = materialId;
  if (has('albedo')) out.albedo = albedo;
  if (has('normal')) out.normal = normal;
  if (has('depth')) out.depth = depth;
  if (has('coc')) out.coc = cocPass(lens, depth, width, height);
  return out;
}

// ------------------------------------------------------------------ the shaders

const VERT_PLAIN = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG_BYTES = /* glsl */ `
uniform vec4 uBytes;
void main() { gl_FragColor = uBytes; }
`;

// The normal goes to the world (three.js space) through the view matrix, which is a rotation and a translation.
const VERT_NORMAL_DEPTH = /* glsl */ `
varying vec3 vNormal;
varying float vDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  vNormal = transpose(mat3(viewMatrix)) * (normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG_NORMAL_DEPTH = /* glsl */ `
varying vec3 vNormal;
varying float vDepth;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  gl_FragColor = vec4(n, vDepth);
}
`;

const FRAG_COLOUR = /* glsl */ `
uniform vec3 uColour;
void main() { gl_FragColor = vec4(uColour, 1.0); }
`;

const shader = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform> = {}): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, side: THREE.DoubleSide, blending: THREE.NoBlending, transparent: false, depthTest: true, depthWrite: true });

function bytesMaterial(id: number): THREE.ShaderMaterial {
  const [a, b, c, d] = packId(id);
  return shader(VERT_PLAIN, FRAG_BYTES, { uBytes: { value: new THREE.Vector4(a / 255, b / 255, c / 255, d / 255) } });
}

function hidden(): THREE.ShaderMaterial {
  const m = shader(VERT_PLAIN, FRAG_BYTES, { uBytes: { value: new THREE.Vector4() } });
  m.visible = false;
  return m;
}

/** The base colour of one of the preview's materials, linear (a transmissive one tinted by its attenuation colour). */
export function albedoOf(m: THREE.Material | undefined): [number, number, number] {
  if (m instanceof THREE.MeshPhysicalMaterial) {
    const tint = m.transmission > 0 ? m.attenuationColor : null;
    return [m.color.r * (tint?.r ?? 1), m.color.g * (tint?.g ?? 1), m.color.b * (tint?.b ?? 1)];
  }
  if (m && 'color' in m && (m as THREE.MeshBasicMaterial).color instanceof THREE.Color) {
    const c = (m as THREE.MeshBasicMaterial).color;
    return [c.r, c.g, c.b];
  }
  return [0.8, 0.8, 0.8];
}

// ------------------------------------------------------------------ drawing

interface Proxy {
  mesh: THREE.Mesh;
  part: THREE.ShaderMaterial[];
  material: THREE.ShaderMaterial[];
  albedo: THREE.ShaderMaterial[];
}

/** A mesh draws with an array of materials only when its geometry has groups; otherwise with the single material. */
const slotsOf = (mesh: THREE.Mesh, list: THREE.ShaderMaterial[]): THREE.ShaderMaterial | THREE.ShaderMaterial[] => (mesh.geometry.groups.length > 0 ? list : list[0]);

function proxiesOf(meshes: readonly PassMesh[], index: PassIndex): Proxy[] {
  const out: Proxy[] = [];
  for (const pm of meshes) {
    const geometry = pm.mesh.geometry;
    const sources = Array.isArray(pm.mesh.material) ? pm.mesh.material : [pm.mesh.material];
    const slots = Math.max(1, geometry.groups.reduce((n, g) => Math.max(n, (g.materialIndex ?? 0) + 1), 0));
    const part: THREE.ShaderMaterial[] = [];
    const material: THREE.ShaderMaterial[] = [];
    const albedo: THREE.ShaderMaterial[] = [];
    for (let i = 0; i < slots; i++) {
      const id = index.partId(pm.node, pm.keys[i] ?? pm.keys[0] ?? null);
      if (id === 0) {
        // Not an instance of the engine's scene (hidden, or without triangles): nothing is drawn for it.
        part.push(hidden());
        material.push(hidden());
        albedo.push(hidden());
        continue;
      }
      part.push(bytesMaterial(id));
      material.push(bytesMaterial(index.materialId(id)));
      const [r, g, b] = albedoOf(sources[Math.min(i, sources.length - 1)]);
      albedo.push(shader(VERT_PLAIN, FRAG_COLOUR, { uColour: { value: new THREE.Vector3(r, g, b) } }));
    }
    const mesh = new THREE.Mesh(geometry, slotsOf(pm.mesh, part));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(pm.mesh.matrixWorld);
    mesh.matrixWorld.copy(pm.mesh.matrixWorld);
    mesh.frustumCulled = false;
    out.push({ mesh, part, material, albedo });
  }
  return out;
}

function target(width: number, height: number, type: THREE.TextureDataType): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  });
}

/**
 * Draws the passes of the parts in `meshes` from `camera`, at `width × height`, and reads them back. The
 * renderer's target and clear colour are put back as they were.
 */
export function drawPasses(input: DrawPassesInput): RenderPasses {
  const { renderer, camera, width, height } = input;
  const wanted = input.passes.length > 0 ? input.passes : PASS_KEYS;
  const needs = (k: PassKey) => wanted.includes(k);
  const floor = input.ids.floor ?? null;
  // With a floor the parts' depth decides which is in front, even when no depth is asked for.
  const needsND = needs('normal') || needs('depth') || needs('coc') || floor !== null;
  const caps = renderer.capabilities;
  if ((needsND || needs('albedo')) && !caps.isWebGL2) throw new Error('float render targets need WebGL 2');
  if (width > caps.maxTextureSize || height > caps.maxTextureSize) throw new Error(`${width} × ${height} > ${caps.maxTextureSize}`);
  const proxies = proxiesOf(input.meshes, indexPassIds(input.ids));
  const scene = new THREE.Scene();
  for (const p of proxies) scene.add(p.mesh);

  const previousTarget = renderer.getRenderTarget();
  const previousColour = renderer.getClearColor(new THREE.Color());
  const previousAlpha = renderer.getClearAlpha();
  const targets: THREE.WebGLRenderTarget[] = [];
  const normalDepth = needsND ? shader(VERT_NORMAL_DEPTH, FRAG_NORMAL_DEPTH) : null;

  /** One draw of every proxy with the materials `use` gives, read back as bytes or floats. */
  const draw = <B extends Uint8Array | Float32Array>(type: THREE.TextureDataType, use: (p: Proxy) => THREE.ShaderMaterial | THREE.ShaderMaterial[]): B => {
    const rt = target(width, height, type);
    targets.push(rt);
    for (const p of proxies) p.mesh.material = use(p);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    const buf = (type === THREE.FloatType ? new Float32Array(width * height * 4) : new Uint8Array(width * height * 4)) as B;
    renderer.readRenderTargetPixels(rt, 0, 0, width, height, buf);
    return buf;
  };
  try {
    const part = draw<Uint8Array>(THREE.UnsignedByteType, (p) => slotsOf(p.mesh, p.part));
    const material = needs('materialId') ? draw<Uint8Array>(THREE.UnsignedByteType, (p) => slotsOf(p.mesh, p.material)) : null;
    const nd = normalDepth ? draw<Float32Array>(THREE.FloatType, () => normalDepth) : null;
    const albedo = needs('albedo') ? draw<Float32Array>(THREE.FloatType, (p) => slotsOf(p.mesh, p.albedo)) : null;
    return assemblePasses({ part, material, nd, albedo }, width, height, input.axes, input.lens, wanted, floor);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColour, previousAlpha);
    for (const rt of targets) rt.dispose();
    normalDepth?.dispose();
    for (const p of proxies) for (const m of [...p.part, ...p.material, ...p.albedo]) m.dispose();
  }
}

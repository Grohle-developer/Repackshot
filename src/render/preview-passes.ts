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
//   - Both sides of a triangle count (a ray hits either), the floor, the lights and every overlay do not
//     (they are not parts), and the background is 0 / +∞ as in the contract.
//   - The Y-up of three.js never leaves this file as such: normals go out in model space through the
//     basis `preview.ts` derives from its `toThree`.
//
// The part that reads the GPU is `drawPasses`; `assemblePasses` (flip the rows, unpack the ids, convert the
// normals, +∞ for the background, the coc from the depth) is plain arithmetic and is tested in Node.

import * as THREE from 'three';
import { cocPass, type LensParams } from '../core/lens-coc';
import { indexPassIds, type PassIds, type PassIndex } from '../core/pass-ids';
import { PASS_KEYS, type PassKey, type RenderPasses } from '../core/passes';

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

/** Assembles the contract's planes from what the targets hold. */
export function assemblePasses(raw: RawPasses, width: number, height: number, axes: DrawPassesInput['axes'], lens: LensParams, wanted: readonly PassKey[]): RenderPasses {
  const has = (k: PassKey) => wanted.includes(k);
  const n = width * height;
  const partId = unpackIds(raw.part, width, height);
  const out: RenderPasses = { width, height };
  if (has('partId')) out.partId = partId;
  if (has('materialId')) out.materialId = raw.material ? unpackIds(raw.material, width, height) : new Uint32Array(n);
  if (has('albedo') || has('normal') || has('depth') || has('coc')) {
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
    if (has('albedo')) out.albedo = albedo;
    if (has('normal')) out.normal = normal;
    if (has('depth')) out.depth = depth;
    if (has('coc')) out.coc = cocPass(lens, depth, width, height);
  }
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
  const needsND = needs('normal') || needs('depth') || needs('coc');
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
    return assemblePasses({ part, material, nd, albedo }, width, height, input.axes, input.lens, wanted);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColour, previousAlpha);
    for (const rt of targets) rt.dispose();
    normalDepth?.dispose();
    for (const p of proxies) for (const m of [...p.part, ...p.material, ...p.albedo]) m.dispose();
  }
}

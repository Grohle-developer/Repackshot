// The preview engine: three.js rasterisation behind RenderEngine. It
// subscribes to the state (sync) and never mutates it; camera gestures are
// reported through `onViewChange` and main.ts turns them into actions.
//
// The model is Z up in millimetres; three.js is Y up. The conversion lives
// in ONE function, `toThree`, and everything else derives from it.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { CAMERA_AZIMUTH_DEG } from '../data/light-setups';
import { DOME_FLOOR, DOME_HORIZON, DOME_ZENITH } from '../data/environment';
import { evaluate, type Pose } from '../core/animation';
import { activeCamera, cameraPosition, fieldOfView, orbitFromPosition, outputFrameRect, type CameraState } from '../core/camera';
import { polar } from '../core/light-math';
import { rigPivot, type LightInstance } from '../core/lighting';
import { boxCenter, boxMaxDim, isEmptyBox, type Vec3 } from '../core/math';
import { getMesh } from '../core/meshes';
import { partsUnder, sceneBounds, type NodeId, type SceneNode } from '../core/scene';
import type { ProjectState } from '../core/store';
import type { EngineStatus, PickHit, RenderEngine, RenderOptions } from './engine';
import { applyMaterial, makeMaterial } from './materials';

/** Model space (Z up, mm) to three.js space (Y up): (x, y, z) -> (x, z, -y). */
export function toThree(p: readonly number[]): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[2], -p[1]);
}

/** The basis change of `toThree` as a matrix (model root) and its inverse. */
const BASIS = new THREE.Matrix4().makeBasis(toThree([1, 0, 0]), toThree([0, 1, 0]), toThree([0, 0, 1]));
const BASIS_INV = BASIS.clone().invert();

function fromThree(v: THREE.Vector3): Vec3 {
  const m = v.clone().applyMatrix4(BASIS_INV);
  return [m.x, m.y, m.z];
}

/** Luminance of an area light per watt over its area in part sizes (calibrated by eye). */
const AREA_K = 0.2;
/** Sun intensity per W/m2, consistent with AREA_K for the same irradiance. */
const SUN_K = AREA_K * 4 * Math.PI;

const LAYER_SELECTED = 1;
const LAYER_HOVER = 2;

/** The procedural studio dome as an equirectangular canvas (data/environment.ts). */
function domeCanvas(kind: string, flat: readonly number[]): HTMLCanvasElement {
  const w = 512;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const enc = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));
  if (kind === 'FLAT') {
    ctx.fillStyle = `rgb(${enc(flat[0])}, ${enc(flat[1])}, ${enc(flat[2])})`;
    ctx.fillRect(0, 0, w, h);
    return c;
  }
  const img = ctx.createImageData(1, h);
  for (let y = 0; y < h; y++) {
    const el = (0.5 - (y + 0.5) / h) * Math.PI;
    const p = 0.5 + 0.5 * Math.sin(el);
    const g = p < 0.5 ? DOME_FLOOR + (DOME_HORIZON - DOME_FLOOR) * (p / 0.5) : DOME_HORIZON + (DOME_ZENITH - DOME_HORIZON) * ((p - 0.5) / 0.5);
    const v = enc(g);
    img.data.set([v, v, v, 255], y * 4);
  }
  const strip = document.createElement('canvas');
  strip.width = 1;
  strip.height = h;
  strip.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(strip, 0, 0, w, h);
  return c;
}

/** Soft disc for bright-field panels (never a rectangle with edges, SPEC §3.4). */
function softDisc(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const OUTLINE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const OUTLINE_FRAG = /* glsl */ `
uniform sampler2D mask;
uniform vec2 texel;
uniform vec3 ink;
uniform float hoverAlpha;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(mask, vUv);
  float sMax = 0.0;
  float hMax = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 o = vec2(i == 0 ? 1.0 : i == 1 ? -1.0 : i == 4 ? 1.0 : i == 5 ? -1.0 : i == 6 ? 1.0 : i == 7 ? -1.0 : 0.0,
                  i == 2 ? 1.0 : i == 3 ? -1.0 : i == 4 ? 1.0 : i == 5 ? -1.0 : i == 6 ? -1.0 : i == 7 ? 1.0 : 0.0);
    vec4 n = texture2D(mask, vUv + o * texel);
    sMax = max(sMax, n.r);
    hMax = max(hMax, n.g);
  }
  float sel = (1.0 - step(0.5, c.r)) * step(0.5, sMax);
  float hov = (1.0 - step(0.5, c.g)) * step(0.5, hMax) * (1.0 - step(0.5, c.r));
  float a = max(sel, hov * hoverAlpha);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(ink, a);
}
`;

export interface ViewChange {
  azimuth: number;
  elevation: number;
  distance: number;
  target: Vec3;
  orthoWidth?: number;
}

export type PreviewTool = 'select' | 'orbit' | 'pan' | 'zoom';

export class PreviewEngine implements RenderEngine {
  readonly kind = 'preview' as const;
  private renderer!: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly modelRoot = new THREE.Group();
  private readonly lightRoot = new THREE.Group();
  private readonly persp = new THREE.PerspectiveCamera(30, 1, 1, 1e6);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1e6);
  private controls!: OrbitControls;
  private pmrem!: THREE.PMREMGenerator;
  private state: ProjectState | null = null;
  private readonly objects = new Map<NodeId, THREE.Object3D>();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.MeshPhysicalMaterial>();
  private readonly fallbackMaterial = new THREE.MeshPhysicalMaterial({ color: 0xb3b3b3, roughness: 0.5 });
  private readonly floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private readonly shadowLight = new THREE.DirectionalLight(0xffffff, 0);
  private envKey = '';
  private envTexture: THREE.Texture | null = null;
  private envMap: THREE.Texture | null = null;
  private readonly disc = softDisc();
  private faceOverlay: THREE.Mesh | null = null;
  private hover: readonly NodeId[] = [];
  private width = 1;
  private height = 1;
  private dpr = 1;
  private needsRender = true;
  private interacting = false;
  private poseActive = false;
  private lastFrameMs = 0;
  private device = 'WebGL';
  private readonly frameListeners = new Set<() => void>();
  private viewListener: ((v: ViewChange) => void) | null = null;
  private maskTarget: THREE.WebGLRenderTarget | null = null;
  private readonly maskSelected = new THREE.MeshBasicMaterial({ toneMapped: false });
  private readonly maskHover = new THREE.MeshBasicMaterial({ toneMapped: false, blending: THREE.AdditiveBlending, transparent: true });
  private readonly outlineMaterial = new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    uniforms: { mask: { value: null }, texel: { value: new THREE.Vector2() }, ink: { value: new THREE.Vector3(1, 1, 1) }, hoverAlpha: { value: 0.55 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly raycaster = new THREE.Raycaster();

  constructor() {
    this.modelRoot.matrixAutoUpdate = false;
    this.modelRoot.matrix.copy(BASIS);
    this.scene.add(this.modelRoot, this.lightRoot);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.5 }));
    this.floor.receiveShadow = true;
    this.floor.renderOrder = -1;
    this.modelRoot.add(this.floor);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(2048, 2048);
    this.shadowLight.shadow.radius = 8;
    this.shadowLight.shadow.bias = -0.0005;
    this.scene.add(this.shadowLight, this.shadowLight.target);
    this.maskSelected.color.setRGB(1, 0, 0);
    this.maskHover.color.setRGB(0, 1, 0);
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.outlineMaterial));
  }

  mount(canvas: HTMLCanvasElement): void {
    RectAreaLightUniformsLib.init();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.device = this.detectDevice();
    this.controls = new OrbitControls(this.persp, canvas);
    this.controls.enableDamping = false;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener('start', () => (this.interacting = true));
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      this.emitView();
    });
  }

  private detectDevice(): string {
    const gl = this.renderer.getContext();
    let name = gl instanceof WebGL2RenderingContext ? 'WebGL 2' : 'WebGL';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      if (r) {
        const inner = r.match(/\(([^)]*)\)/)?.[1] ?? r;
        name += ` · ${inner.split(',').slice(0, 2).join(',').trim().slice(0, 48)}`;
      }
    } catch {
      // The renderer name is optional.
    }
    return name;
  }

  /** main.ts turns camera gestures into store actions. */
  onViewChange(fn: (v: ViewChange) => void): void {
    this.viewListener = fn;
  }

  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  setTool(tool: PreviewTool): void {
    const left = tool === 'pan' ? THREE.MOUSE.PAN : tool === 'zoom' ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
    this.controls.mouseButtons = { LEFT: left, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }

  /** Ink of the outline (the theme's --ink-0), linear 0..1. */
  setInk(rgb: readonly number[]): void {
    this.outlineMaterial.uniforms.ink.value.set(rgb[0], rgb[1], rgb[2]);
    this.needsRender = true;
  }

  setHover(ids: readonly NodeId[]): void {
    if (ids.length === this.hover.length && ids.every((x, i) => x === this.hover[i])) return;
    this.hover = [...ids];
    this.updateLayers();
  }

  private get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    const s = this.state;
    return s && activeCamera(s)?.projection === 'ORTHOGRAPHIC' ? this.ortho : this.persp;
  }

  // ------------------------------------------------------------------ sync

  sync(state: ProjectState, prev: ProjectState | null): void {
    this.state = state;
    const full = prev === null;
    const nodesChanged = full || state.scene.nodes !== prev.scene.nodes || state.scene.roots !== prev.scene.roots;
    const matsChanged = full || state.materials !== prev.materials || state.scene.partSizeMm !== prev.scene.partSizeMm;
    if (matsChanged) this.syncMaterials(state, prev);
    if (nodesChanged) this.syncNodes(state, prev);
    if (nodesChanged || matsChanged) this.assignMaterials(state);
    const anim = state.animation;
    const posed = anim.clips.length > 0 && (anim.playing || anim.playhead > 0);
    const poseChanged = posed !== this.poseActive || (posed && (full || anim !== prev.animation));
    const pose = posed ? evaluate(state, anim.playhead) : null;
    if (posed || this.poseActive) this.applyNodePose(state, pose);
    this.poseActive = posed;
    if (full || nodesChanged || poseChanged || state.studio !== prev.studio || state.scene.partSizeMm !== prev.scene.partSizeMm) this.syncLights(state, pose);
    if (full || state.environment !== prev.environment || poseChanged) this.syncEnvironment(state, pose);
    if (full || state.image !== prev.image) this.syncImage(state);
    if (full || nodesChanged || state.studio !== prev.studio || state.environment !== prev.environment) this.syncFloor(state);
    if (full || state.camera !== prev.camera || state.render.width !== prev.render.width || state.render.height !== prev.render.height || poseChanged || nodesChanged) {
      if (!this.interacting) this.syncCamera(state, pose);
    }
    if (full || nodesChanged || state.selection !== prev.selection) {
      this.updateLayers();
      this.syncFaceOverlay(state);
    }
    this.needsRender = true;
  }

  private syncMaterials(state: ProjectState, prev: ProjectState | null): void {
    for (const [id, inst] of Object.entries(state.materials)) {
      const m = this.materials.get(id);
      if (!m) this.materials.set(id, makeMaterial(inst, state.scene.partSizeMm));
      else if (!prev || prev.materials[id] !== inst || prev.scene.partSizeMm !== state.scene.partSizeMm) applyMaterial(m, inst, state.scene.partSizeMm);
    }
    for (const [id, m] of this.materials) {
      if (!state.materials[id]) {
        m.dispose();
        this.materials.delete(id);
      }
    }
  }

  private geometryFor(node: SceneNode): THREE.BufferGeometry | null {
    if (!node.mesh) return null;
    const faces = node.faceMaterials?.length ? JSON.stringify(node.faceMaterials) : '';
    const key = `${node.mesh.id}|${node.smooth === false ? 'f' : 's'}|${faces}`;
    const hit = this.geometries.get(key);
    if (hit) return hit;
    const data = getMesh(node.mesh.id);
    if (!data) return null;
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    if (data.uvs) g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    if (node.smooth === false) {
      g = g.toNonIndexed();
      g.computeVertexNormals();
    }
    if (node.faceMaterials?.length) {
      // Material index 0 is the part material; then each face material in order of appearance.
      const ids: (string | null)[] = [node.material ?? null];
      const per = new Array<number>(node.mesh.triangles).fill(0);
      for (const f of node.faceMaterials) {
        let i = ids.indexOf(f.material);
        if (i < 0) i = ids.push(f.material) - 1;
        for (let t = f.start; t < f.start + f.count && t < per.length; t++) per[t] = i;
      }
      let start = 0;
      for (let t = 1; t <= per.length; t++) {
        if (t === per.length || per[t] !== per[start]) {
          g.addGroup(start * 3, (t - start) * 3, per[start]);
          start = t;
        }
      }
      g.userData.materialIds = ids;
    }
    g.computeBoundingSphere();
    this.geometries.set(key, g);
    return g;
  }

  private syncNodes(state: ProjectState, prev: ProjectState | null): void {
    const nodes = state.scene.nodes;
    // Remove what is gone.
    for (const [id, obj] of this.objects) {
      if (!nodes[id]) {
        obj.removeFromParent();
        this.objects.delete(id);
      }
    }
    // Create or update.
    for (const node of Object.values(nodes)) {
      let obj = this.objects.get(node.id);
      const isPart = node.kind === 'PART';
      if (obj && isPart !== obj instanceof THREE.Mesh) {
        obj.removeFromParent();
        obj = undefined;
      }
      if (!obj) {
        obj = isPart ? new THREE.Mesh(undefined, this.fallbackMaterial) : new THREE.Group();
        obj.userData.nodeId = node.id;
        if (obj instanceof THREE.Mesh) obj.castShadow = true;
        this.objects.set(node.id, obj);
      } else if (prev && prev.scene.nodes[node.id] === node) {
        continue;
      }
      this.applyTransform(obj, node.transform.position, node.transform.rotation, node.transform.scale);
      obj.visible = node.visible;
      obj.name = node.name;
      if (obj instanceof THREE.Mesh) {
        const g = this.geometryFor(node);
        if (g && obj.geometry !== g) obj.geometry = g;
      }
    }
    // Parent links.
    for (const node of Object.values(nodes)) {
      const obj = this.objects.get(node.id)!;
      const parent = node.parent ? this.objects.get(node.parent) : this.modelRoot;
      if (parent && obj.parent !== parent) parent.add(obj);
    }
    // Drop geometries no node uses.
    const used = new Set<THREE.BufferGeometry>();
    for (const obj of this.objects.values()) if (obj instanceof THREE.Mesh) used.add(obj.geometry);
    for (const [k, g] of this.geometries) {
      if (!used.has(g)) {
        g.dispose();
        this.geometries.delete(k);
      }
    }
  }

  private applyTransform(obj: THREE.Object3D, p: readonly number[], r: readonly number[], s: readonly number[]): void {
    obj.position.set(p[0], p[1], p[2]);
    obj.rotation.set(THREE.MathUtils.degToRad(r[0]), THREE.MathUtils.degToRad(r[1]), THREE.MathUtils.degToRad(r[2]), 'XYZ');
    obj.scale.set(s[0], s[1], s[2]);
  }

  private assignMaterials(state: ProjectState): void {
    for (const [id, obj] of this.objects) {
      if (!(obj instanceof THREE.Mesh)) continue;
      const node = state.scene.nodes[id];
      const ids = obj.geometry.userData.materialIds as (string | null)[] | undefined;
      const get = (m: string | null | undefined) => (m ? (this.materials.get(m) ?? this.fallbackMaterial) : this.fallbackMaterial);
      obj.material = ids ? ids.map((m, i) => get(i === 0 ? node.material : m)) : get(node.material);
    }
  }

  private applyNodePose(state: ProjectState, pose: Pose | null): void {
    for (const [id, obj] of this.objects) {
      const node = state.scene.nodes[id];
      if (!node) continue;
      const p = pose?.nodes[id];
      if (p) {
        this.applyTransform(obj, p.position, p.rotation, p.scale);
        obj.visible = p.visible;
      } else {
        this.applyTransform(obj, node.transform.position, node.transform.rotation, node.transform.scale);
        obj.visible = node.visible;
      }
    }
  }

  private syncLights(state: ProjectState, pose: Pose | null): void {
    for (const child of [...this.lightRoot.children]) {
      child.removeFromParent();
      if (child instanceof THREE.Sprite) child.material.dispose();
    }
    const size = state.scene.partSizeMm || 1;
    const pivot = rigPivot(state);
    const target = toThree(pivot);
    let key: LightInstance | null = null;
    for (const l0 of state.studio.lights) {
      const lp = pose?.lights[l0.id];
      const l = lp ? { ...l0, power: lp.power, color: lp.color, az: lp.az, el: lp.el, enabled: lp.enabled } : l0;
      if (!l.enabled) continue;
      if (!key && l.role === 'KEY') key = l;
      const pos = toThree([pivot[0], pivot[1], pivot[2]].map((v, i) => v + polar(l.az + CAMERA_AZIMUTH_DEG, l.el, l.dist * size)[i]));
      const color = new THREE.Color().setRGB(l.color[0], l.color[1], l.color[2], THREE.LinearSRGBColorSpace);
      if (l.type === 'SUN') {
        const sun = new THREE.DirectionalLight(color, l.power * SUN_K);
        sun.position.copy(pos);
        sun.target.position.copy(target);
        this.lightRoot.add(sun, sun.target);
      } else {
        const w = Math.max(1e-3, l.size) * size;
        const hgt = Math.max(1e-3, l.shape === 'SQUARE' || l.shape === 'DISK' ? l.size : l.sizeY) * size;
        const area = Math.max(1e-6, (w / size) * (hgt / size) * (l.shape === 'DISK' || l.shape === 'ELLIPSE' ? Math.PI / 4 : 1));
        const rect = new THREE.RectAreaLight(color, (AREA_K * l.power) / area, w, hgt);
        rect.position.copy(pos);
        rect.lookAt(target);
        this.lightRoot.add(rect);
      }
      if (l.camera) {
        // A panel the camera sees: a soft disc, never a hard-edged rectangle.
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.disc, color, transparent: true, depthWrite: false, toneMapped: false }));
        sprite.position.copy(pos);
        const s = Math.max(l.size, l.sizeY) * size;
        sprite.scale.set(s, s, 1);
        this.lightRoot.add(sprite);
      }
    }
    // The shadow caster: a zero-intensity sun from above, leaning toward the key light.
    const keyDir = key ? polar(key.az + CAMERA_AZIMUTH_DEG, Math.max(55, key.el), 1) : [0, 0, 1];
    const d = toThree(keyDir).normalize();
    const b = sceneBounds(state, true);
    const radius = isEmptyBox(b) ? size : boxMaxDim(b) * 0.9;
    this.shadowLight.position.copy(target).addScaledVector(d, radius * 6);
    this.shadowLight.target.position.copy(isEmptyBox(b) ? target : toThree(boxCenter(b)));
    const cam = this.shadowLight.shadow.camera;
    cam.left = -radius * 1.6;
    cam.right = radius * 1.6;
    cam.top = radius * 1.6;
    cam.bottom = -radius * 1.6;
    cam.near = radius * 0.5;
    cam.far = radius * 14;
    cam.updateProjectionMatrix();
    this.shadowLight.shadow.radius = Math.max(4, 10);
    this.shadowLight.shadow.needsUpdate = true;
  }

  private syncEnvironment(state: ProjectState, pose: Pose | null): void {
    const env = state.environment;
    // Sky and HDRI files are later phases: the studio dome stands in for them.
    const kind = env.kind === 'FLAT' ? 'FLAT' : 'STUDIO';
    const key = kind === 'FLAT' ? `FLAT:${env.color.join(',')}` : 'STUDIO';
    if (key !== this.envKey) {
      this.envKey = key;
      this.envTexture?.dispose();
      this.envMap?.dispose();
      const tex = new THREE.CanvasTexture(domeCanvas(kind, env.color));
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.envTexture = tex;
      this.envMap = this.pmrem.fromEquirectangular(tex).texture;
    }
    const rot = THREE.MathUtils.degToRad(pose ? pose.envRotationDeg : env.rotationDeg);
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = env.strength;
    this.scene.environmentRotation.set(0, rot, 0);
    this.scene.backgroundRotation.set(0, rot, 0);
    this.scene.backgroundIntensity = env.strength;
    if (env.background === 'COLOR') {
      this.scene.background = new THREE.Color().setRGB(env.color[0], env.color[1], env.color[2], THREE.LinearSRGBColorSpace);
    } else if (env.background === 'TRANSPARENT') {
      this.scene.background = null;
    } else {
      this.scene.background = this.envTexture;
    }
  }

  private syncImage(state: ProjectState): void {
    const img = state.image;
    this.renderer.toneMapping = img.viewTransform === 'AGX' ? THREE.AgXToneMapping : img.viewTransform === 'STANDARD' ? THREE.LinearToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = Math.pow(2, img.exposureEv);
  }

  private syncFloor(state: ProjectState): void {
    const size = state.scene.partSizeMm || 200;
    this.floor.scale.set(size * 60, size * 60, 1);
    this.floor.visible = state.studio.floor && state.scene.roots.length > 0;
    this.floor.material.opacity = state.studio.shadow ? state.environment.groundShadow : 0;
    this.shadowLight.castShadow = state.studio.floor && state.studio.shadow;
  }

  private syncCamera(state: ProjectState, pose: Pose | null): void {
    const base = pose?.camera ? (state.camera.cameras[pose.camera.camera] ?? activeCamera(state)) : activeCamera(state);
    if (!base) return;
    const cam: CameraState = pose?.camera ? { ...base, ...pose.camera, id: base.id } : base;
    this.placeCamera(cam, this.width, this.height, state.render.width, state.render.height, true);
    this.controls.enabled = !cam.locked && !pose?.camera;
  }

  /** Puts the three cameras where a CameraState says, framing the output inside a view of w x h. */
  private placeCamera(cam: CameraState, w: number, h: number, outW: number, outH: number, inset: boolean): void {
    const pos = toThree(cameraPosition(cam));
    const target = toThree(cam.target);
    const outAspect = outW > 0 && outH > 0 ? outW / outH : 16 / 9;
    const fov = fieldOfView(cam.focalMm, outAspect);
    const frame = inset ? outputFrameRect(w, h, outW, outH) : { x: 0, y: 0, width: w, height: h };
    const k = h / Math.max(1, frame.height);
    for (const c of [this.persp, this.ortho]) {
      c.position.copy(pos);
      c.up.set(0, 1, 0);
      c.lookAt(target);
    }
    this.persp.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(fov.v / 2) * k));
    this.persp.aspect = w / Math.max(1, h);
    this.persp.near = Math.max(cam.clipStart, 0.01);
    this.persp.far = Math.max(cam.clipEnd, this.persp.near * 10);
    this.persp.updateProjectionMatrix();
    const halfH = (cam.orthoWidth / outAspect / 2) * k;
    const halfW = halfH * (w / Math.max(1, h));
    this.ortho.left = -halfW;
    this.ortho.right = halfW;
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
    this.ortho.zoom = 1;
    this.ortho.near = -cam.clipEnd;
    this.ortho.far = cam.clipEnd;
    this.ortho.updateProjectionMatrix();
    if (this.controls) {
      this.controls.object = cam.projection === 'ORTHOGRAPHIC' ? this.ortho : this.persp;
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  private emitView(): void {
    const s = this.state;
    if (!s || !this.viewListener) return;
    const cam = activeCamera(s);
    const c = this.camera;
    const pos = fromThree(c.position);
    const target = fromThree(this.controls.target);
    const orbit = orbitFromPosition(pos, target);
    const change: ViewChange = { ...orbit, target };
    if (c === this.ortho && this.ortho.zoom !== 1) change.orthoWidth = cam.orthoWidth / this.ortho.zoom;
    this.viewListener(change);
  }

  private updateLayers(): void {
    const s = this.state;
    if (!s) return;
    const selected = new Set(partsUnder(s, s.selection.ids.filter((id) => s.scene.nodes[id])));
    const hovered = new Set(partsUnder(s, this.hover));
    for (const [id, obj] of this.objects) {
      if (!(obj instanceof THREE.Mesh)) continue;
      obj.layers.set(0);
      if (selected.has(id) && s.selection.level !== 'FACES') obj.layers.enable(LAYER_SELECTED);
      if (hovered.has(id)) obj.layers.enable(LAYER_HOVER);
    }
    this.needsRender = true;
  }

  private syncFaceOverlay(state: ProjectState): void {
    this.faceOverlay?.removeFromParent();
    this.faceOverlay?.geometry.dispose();
    this.faceOverlay = null;
    const f = state.selection.level === 'FACES' ? state.selection.faces : undefined;
    if (!f || f.indices.length === 0) return;
    const node = state.scene.nodes[f.part];
    const obj = this.objects.get(f.part);
    const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
    if (!obj || !data) return;
    const pos = new Float32Array(f.indices.length * 9);
    f.indices.forEach((tri, i) => {
      for (let k = 0; k < 3; k++) {
        const v = data.indices[tri * 3 + k];
        pos.set(data.positions.subarray(v * 3, v * 3 + 3), i * 9 + k * 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ink = this.outlineMaterial.uniforms.ink.value as THREE.Vector3;
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(ink.x, ink.y, ink.z), transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false, side: THREE.DoubleSide });
    this.faceOverlay = new THREE.Mesh(g, m);
    obj.add(this.faceOverlay);
  }

  // ------------------------------------------------------------------ frame

  resize(width: number, height: number, dpr: number): void {
    if (!this.renderer || width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(2, dpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(width, height, false);
    if (this.state) this.syncCamera(this.state, this.poseActive ? evaluate(this.state, this.state.animation.playhead) : null);
    this.needsRender = true;
  }

  /** Forces a redraw on the next frame. */
  invalidate(): void {
    this.needsRender = true;
  }

  frame(): void {
    if (!this.renderer || !this.needsRender || !this.state) return;
    this.needsRender = false;
    const t0 = performance.now();
    const cam = this.camera;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.render(this.scene, cam);
    this.drawOutline(cam);
    this.lastFrameMs = performance.now() - t0;
    for (const fn of this.frameListeners) fn();
  }

  private drawOutline(cam: THREE.Camera): void {
    const anySelected = [...this.objects.values()].some((o) => o.layers.isEnabled(LAYER_SELECTED) || o.layers.isEnabled(LAYER_HOVER));
    if (!anySelected) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!this.maskTarget || this.maskTarget.width !== size.x || this.maskTarget.height !== size.y) {
      this.maskTarget?.dispose();
      this.maskTarget = new THREE.WebGLRenderTarget(size.x, size.y);
    }
    const bg = this.scene.background;
    const floorVisible = this.floor.visible;
    const lightsVisible = this.lightRoot.visible;
    this.scene.background = null;
    this.floor.visible = false;
    this.lightRoot.visible = false;
    this.renderer.setRenderTarget(this.maskTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    const layers = cam.layers.mask;
    this.scene.overrideMaterial = this.maskSelected;
    cam.layers.set(LAYER_SELECTED);
    this.renderer.render(this.scene, cam);
    this.renderer.autoClear = false;
    this.scene.overrideMaterial = this.maskHover;
    cam.layers.set(LAYER_HOVER);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, cam);
    cam.layers.mask = layers;
    this.scene.overrideMaterial = null;
    this.scene.background = bg;
    this.floor.visible = floorVisible;
    this.lightRoot.visible = lightsVisible;
    this.renderer.setRenderTarget(null);
    const px = Math.max(1, Math.round(this.dpr));
    this.outlineMaterial.uniforms.mask.value = this.maskTarget.texture;
    this.outlineMaterial.uniforms.texel.value.set(px / size.x, px / size.y);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.autoClear = true;
  }

  status(): EngineStatus {
    return { samples: 1, seconds: this.lastFrameMs / 1000, converged: true, device: this.device };
  }

  // ------------------------------------------------------------------ pick

  pick(x: number, y: number): PickHit | null {
    if (!this.state || this.width <= 0) return null;
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    const cam = this.camera;
    this.raycaster.setFromCamera(ndc, cam);
    const visible = (o: THREE.Object3D): boolean => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    const meshes = [...this.objects.values()].filter((o) => o instanceof THREE.Mesh && visible(o));
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit || !hit.face) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const n = fromThree(normal);
    return { node: hit.object.userData.nodeId as NodeId, face: hit.faceIndex ?? 0, point: fromThree(hit.point), normal: [n[0], n[1], n[2]] };
  }

  // ------------------------------------------------------------------ render

  async render(opts: RenderOptions): Promise<ImageBitmap> {
    const s = this.state;
    if (!s || !this.renderer) throw new Error('engine not ready');
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const gl = this.renderer.getContext();
    const max = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
    if (opts.width > max || opts.height > max) throw new Error(`${opts.width} × ${opts.height} > ${max}`);
    opts.onProgress?.({ jobId: null, progress: 0, samples: 0, seconds: 0 });
    // Let the progress paint before the (blocking) render.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const t0 = performance.now();
    const cam = (opts.camera && s.camera.cameras[opts.camera]) || activeCamera(s);
    const bg = this.scene.background;
    const out = document.createElement('canvas');
    out.width = opts.width;
    out.height = opts.height;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(opts.width, opts.height, false);
      if (this.renderer.domElement.width !== opts.width || gl.drawingBufferWidth !== opts.width || gl.drawingBufferHeight !== opts.height) {
        throw new Error(`${opts.width} × ${opts.height}`);
      }
      this.placeCamera(cam, opts.width, opts.height, opts.width, opts.height, false);
      if (opts.transparent) this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
      const three = cam.projection === 'ORTHOGRAPHIC' ? this.ortho : this.persp;
      this.renderer.render(this.scene, three);
      out.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    } finally {
      this.scene.background = bg;
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.width, this.height, false);
      this.syncCamera(s, this.poseActive ? evaluate(s, s.animation.playhead) : null);
      this.needsRender = true;
    }
    const seconds = (performance.now() - t0) / 1000;
    opts.onProgress?.({ jobId: null, progress: 1, samples: 1, seconds });
    return createImageBitmap(out);
  }

  /** The viewport as it is now (one fresh frame), PNG. */
  capture(): Promise<Blob | null> {
    this.needsRender = true;
    this.frame();
    return new Promise((resolve) => this.renderer.domElement.toBlob((b) => resolve(b), 'image/png'));
  }

  dispose(): void {
    this.controls?.dispose();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.envTexture?.dispose();
    this.envMap?.dispose();
    this.maskTarget?.dispose();
    this.pmrem?.dispose();
    this.renderer?.dispose();
  }
}

// The preview engine: three.js rasterisation behind RenderEngine. It
// subscribes to the state (sync) and never mutates it; camera gestures are
// reported through `onViewChange` and main.ts turns them into actions.
//
// The model is Z up in millimetres; three.js is Y up. The conversion lives
// in ONE function, `toThree`, and everything else derives from it.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { DOME_FLOOR, DOME_HORIZON, DOME_ZENITH } from '../data/environment';
import { evaluate, type Pose } from '../core/animation';
import { effectFxam, effectRegion, engineParticleCap, fxamPayload, PREVIEW_PARTICLES, type AmbientEffect } from '../core/effects';
import { materialPreset } from '../data/materials';
import { evalParticles, PARTICLE_FLOATS, previewTint, tintSeed, type RtParticleExports } from './particles';
import type { Projection, Rect } from '../core/box-select';
import { activeCamera, cameraPosition, fieldOfView, orbitFromPosition, outputFrameRect, type CameraState } from '../core/camera';
import { polar, toWorldAzimuth } from '../core/light-math';
import { fitImageRect, getImage, type ImageData as RegistryImage, type Rect as FrameRect } from '../core/images';
import { isSphereLike, lightFrame, rigPivot, skySunDirection, SPOT_DEFAULTS, type LightInstance } from '../core/lighting';
import { boxCenter, boxMaxDim, isEmptyBox, normalize, transformPoint, type Vec3 } from '../core/math';
import { lensOf } from '../core/lens-coc';
import { getMesh } from '../core/meshes';
import type { PassIds } from '../core/pass-ids';
import type { PassKey, RenderPasses } from '../core/passes';
import { SKY_HEIGHT, SKY_WIDTH, skyImage } from '../core/sky';
import { areaLightRadiance, pointLightIntensity, SUN_IRRADIANCE_PER_POWER } from '../core/photometry';
import { partsUnder, productBounds, worldMatrix, type NodeId, type SceneNode } from '../core/scene';
import { movableTargets, selectionFrame, type GizmoDelta, type GizmoHandle, type Space } from '../core/transform';
import { glyphsOf, lookThroughCamera, objectFrame, pickGlyph, sameObject, type Glyph, type ViewObject } from '../core/view-objects';
import type { ProjectState } from '../core/store';
import type { DisplayPrefs, EngineStatus, NavigationPrefs, PickHit, RenderEngine, RenderOptions } from './engine';
import { Gizmo, GizmoDrag, modelRay, SCALE_CUBE_AT, type GizmoMode } from './gizmo';
import { applyMaterial, makeMaterial } from './materials';
import { drawPasses, type PassMesh } from './preview-passes';
import { TexturePreview } from './texture-preview';

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


const LAYER_SELECTED = 1;
const LAYER_HOVER = 2;

/** Linear to sRGB-encoded 0..255 (the canvas's encoding). */
const encodeSrgb8 = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));

/** The procedural studio dome as an equirectangular canvas (data/environment.ts). */
function domeCanvas(kind: string, flat: readonly number[]): HTMLCanvasElement {
  const w = 512;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const enc = encodeSrgb8;
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

/**
 * A linear equirectangular panorama (RGB floats, rows from the top: the HDRI's preview copy, the sky) as
 * a half-float texture. A DataTexture's first row is the bottom one (v = 0), so the rows are turned over.
 */
function equirectTexture(rgb: Float32Array, w: number, h: number): THREE.DataTexture {
  const data = new Uint16Array(4 * w * h);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let y = 0; y < h; y++) {
    const src = 3 * (h - 1 - y) * w;
    const dst = 4 * y * w;
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) data[dst + 4 * x + k] = THREE.DataUtils.toHalfFloat(Math.max(0, rgb[src + 3 * x + k]));
      data[dst + 4 * x + 3] = one;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** The background image's pixels on a canvas of their own (drawn from many times). */
function imageCanvas(img: RegistryImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba8!), img.width, img.height), 0, 0);
  return c;
}

/**
 * The background of BACKPLATE for a `w x h` picture: the background colour, and over it the image placed
 * in `frame` by `fit` (core/images.ts `fitImageRect`, as the engine places it), clipped to the frame.
 */
function plateCanvas(src: HTMLCanvasElement, fit: 'FILL' | 'FIT' | 'STRETCH', color: readonly number[], w: number, h: number, frame: FrameRect): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `rgb(${encodeSrgb8(color[0])}, ${encodeSrgb8(color[1])}, ${encodeSrgb8(color[2])})`;
  ctx.fillRect(0, 0, w, h);
  const r = fitImageRect(fit, src.width, src.height, frame);
  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.x, frame.y, frame.width, frame.height);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, r.x, r.y, r.width, r.height);
  ctx.restore();
  return c;
}

/** A canvas as the scene's flat background (sRGB, drawn as it is, not tone mapped). */
function backgroundTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

export type PreviewTool = 'select' | 'orbit' | 'pan' | 'zoom' | 'move' | 'scale';

/** A camera gesture as it happens: start, every move (with the live view), end. */
export type GesturePhase = 'start' | 'move' | 'end';

/**
 * What the move tool shows: the gizmo of these nodes, in these axes; the scale tool shows only its scale handles. With
 * `object` (L4) it is the gizmo of a light or a camera instead (no scale handles: `handles` MOVE).
 */
export interface GizmoSpec {
  ids: readonly NodeId[];
  space: Space;
  /** Default ALL (the move tool). */
  handles?: GizmoMode;
  object?: ViewObject | null;
}

/** Which glyphs of lights and cameras the viewport draws (L4): all of them or only the selected one's, and whose view it shows. */
export interface GlyphSpec {
  all: boolean;
  selected: ViewObject | null;
  lookThrough: ViewObject | null;
}

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
  /** M2a: the image maps and labels of the materials (render/texture-preview.ts). */
  private textures: TexturePreview = new TexturePreview(() => (this.needsRender = true));
  private readonly floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private readonly shadowLight = new THREE.DirectionalLight(0xffffff, 0);
  private envKey = '';
  private envTexture: THREE.Texture | null = null;
  private envMap: THREE.Texture | null = null;
  /** The background image (BACKPLATE) for the viewport, and the canvas of its pixels, by image id. */
  private plateKey = '';
  private plateTexture: THREE.CanvasTexture | null = null;
  private plateSource: { id: string; canvas: HTMLCanvasElement } | null = null;
  private readonly disc = softDisc();
  private faceOverlay: THREE.Mesh | null = null;
  /** The faces a dragged material would reach (a lighter tint over the same depth rules as the selected faces). */
  private dropOverlay: THREE.Mesh | null = null;
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
  private gestureListener: ((phase: GesturePhase, v: ViewChange | null) => void) | null = null;
  /** Full mode: the path tracer paints the image under this canvas; only overlays are drawn here. */
  private overlayOnly = false;
  /** Full mode: the canvas is clear and nothing on it needs drawing. */
  private overlayClear = false;
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
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
  /** The gizmo of the move tool, drawn over everything after the outline. */
  private readonly overlayScene = new THREE.Scene();
  private readonly overlayRoot = new THREE.Group();
  private readonly gizmo = new Gizmo();
  private gizmoSpec: GizmoSpec | null = null;
  private gizmoDragging: GizmoDrag | null = null;
  /** The glyphs of lights and cameras (L4), drawn in the overlay with the gizmo, and what is looked through. */
  private glyphSpec: GlyphSpec = { all: false, selected: null, lookThrough: null };
  private glyphs: Glyph[] = [];
  // The glyphs that are not selected are dashed, as a drawing's construction lines: never an edge of the product.
  private readonly glyphLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false, dashSize: 4, gapSize: 3 }));
  private readonly glyphSelected = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false }));
  private readonly glyphDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, toneMapped: false }));
  /** Settings ▸ Preferences: how the mouse moves the camera, and the floor grid. */
  private tool: PreviewTool = 'select';
  private nav: NavigationPrefs = { mouse: 'LEFT', invertZoom: false, orbitSpeed: 1, zoomSpeed: 1 };
  private gridOn = false;
  private grid: THREE.GridHelper | null = null;
  private gridCell = 0;
  /**
   * S4a: the ambient effects. `particleEngine` is rt.wasm on the page's thread (`rt_particles_eval`): undefined while
   * it loads, null when there is none (then only the region boxes are drawn and the meter says so).
   */
  private particleEngine: RtParticleExports | null | undefined = undefined;
  private readonly effectsRoot = new THREE.Group();
  /** Per effect id: the payload last evaluated and its particles (a drag of an unrelated knob evaluates nothing). */
  private readonly particleCache = new Map<string, { key: string; data: Float32Array | null }>();
  private selectedEffect: string | null = null;
  private particleStats: { shown: number; total: number; boxesOnly: boolean } | null = null;

  constructor() {
    this.modelRoot.matrixAutoUpdate = false;
    this.modelRoot.matrix.copy(BASIS);
    this.scene.add(this.modelRoot, this.lightRoot);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.5 }));
    this.floor.receiveShadow = true;
    this.floor.renderOrder = -1;
    this.modelRoot.add(this.floor);
    this.modelRoot.add(this.effectsRoot);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(2048, 2048);
    this.shadowLight.shadow.radius = 8;
    this.shadowLight.shadow.bias = -0.0005;
    this.scene.add(this.shadowLight, this.shadowLight.target);
    this.maskSelected.color.setRGB(1, 0, 0);
    this.maskHover.color.setRGB(0, 1, 0);
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.outlineMaterial));
    this.overlayRoot.matrixAutoUpdate = false;
    this.overlayRoot.matrix.copy(BASIS);
    for (const g of [this.glyphLines, this.glyphSelected, this.glyphDots]) {
      g.frustumCulled = false;
      g.renderOrder = -1;
      g.visible = false;
    }
    this.overlayRoot.add(this.glyphLines, this.glyphSelected, this.glyphDots, this.gizmo.root);
    this.overlayScene.add(this.overlayRoot);
  }

  mount(canvas: HTMLCanvasElement): void {
    RectAreaLightUniformsLib.init();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.textures.dispose();
    // Every texture as sharp at a grazing angle as the device allows.
    this.textures = new TexturePreview(() => (this.needsRender = true), this.renderer.capabilities.getMaxAnisotropy());
    this.device = this.detectDevice();
    // "Alt + left button orbits": the left button's action is decided as it goes down, before the controls see it.
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button === 0 && this.nav.mouse === 'ALT_LEFT') this.applyButtons(e.altKey);
      },
      { capture: true },
    );
    this.controls = new OrbitControls(this.persp, canvas);
    this.controls.enableDamping = false;
    this.applyNavigation();
    this.controls.addEventListener('start', () => {
      this.interacting = true;
      this.gestureListener?.('start', null);
    });
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
      if (this.interacting && this.gestureListener) this.gestureListener('move', this.currentView());
    });
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      this.emitView();
      this.gestureListener?.('end', null);
    });
  }

  private detectDevice(): string {
    const gl = this.renderer.getContext();
    let name = gl instanceof WebGL2RenderingContext ? 'WebGL 2' : 'WebGL';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      if (r) {
        // "ANGLE (Vendor, Renderer (details), Backend)": keep the renderer's short name.
        let short = r;
        if (/swiftshader/i.test(r)) short = 'SwiftShader';
        else {
          const inner = r.replace(/^ANGLE \(/, '').replace(/\)$/, '');
          short = (inner.split(', ')[1] ?? inner).replace(/\s*\(.*$/, '').replace(/Direct3D.*$/, '').trim();
        }
        name += ` · ${short.slice(0, 40)}`;
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

  /** The live view while a gesture lasts (the store hears of it only at the end): the path tracer follows it. */
  onGesture(fn: (phase: GesturePhase, v: ViewChange | null) => void): void {
    this.gestureListener = fn;
  }

  /** Full mode: draw only the overlays (outline, selected faces, gizmo) over a transparent canvas. */
  setOverlayOnly(on: boolean): void {
    if (on === this.overlayOnly) return;
    this.overlayOnly = on;
    this.overlayClear = false;
    this.needsRender = true;
  }

  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  setTool(tool: PreviewTool): void {
    this.tool = tool;
    this.applyButtons(false);
  }

  /** Settings ▸ Preferences ▸ Viewport and navigation: mouse scheme, zoom direction, speeds. */
  setNavigation(nav: NavigationPrefs): void {
    this.nav = { ...nav };
    this.applyNavigation();
  }

  private applyNavigation(): void {
    if (!this.controls) return;
    // The factory speeds (0.8 for zoom) times the setting; a negative zoom speed inverts the wheel and the drag.
    this.controls.zoomSpeed = 0.8 * this.nav.zoomSpeed * (this.nav.invertZoom ? -1 : 1);
    this.controls.rotateSpeed = this.nav.orbitSpeed;
    this.applyButtons(false);
  }

  /**
   * The buttons' actions for the tool and the mouse scheme. The Pan and Zoom tools take the left button; the
   * Orbit tool always orbits with it; otherwise the scheme decides which button orbits (the move tool orbits
   * where no handle is under the pointer: the interface takes those). The right button pans, the wheel zooms.
   */
  private applyButtons(alt: boolean): void {
    if (!this.controls) return;
    const NONE = -1 as unknown as THREE.MOUSE;
    const scheme = this.nav.mouse;
    let left: THREE.MOUSE = THREE.MOUSE.ROTATE;
    let middle: THREE.MOUSE = THREE.MOUSE.DOLLY;
    if (this.tool === 'pan') left = THREE.MOUSE.PAN;
    else if (this.tool === 'zoom') left = THREE.MOUSE.DOLLY;
    else if (this.tool !== 'orbit') {
      if (scheme === 'ALT_LEFT') left = alt ? THREE.MOUSE.ROTATE : NONE;
      else if (scheme === 'MIDDLE') {
        left = NONE;
        middle = THREE.MOUSE.ROTATE;
      }
    } else if (scheme === 'MIDDLE') middle = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons = { LEFT: left, MIDDLE: middle, RIGHT: THREE.MOUSE.PAN };
  }

  /** Settings ▸ Preferences: the floor grid (Fast mode only, never in a render) and the gizmo's size. */
  setDisplay(display: DisplayPrefs): void {
    this.gridOn = display.floorGrid;
    this.gizmo.setScale(display.gizmoScale);
    this.sizeGizmo();
    if (this.state) this.syncGrid(this.state);
    this.needsRender = true;
  }

  /** A grid on the floor plane with cells of a round size near a tenth of the part. */
  private syncGrid(state: ProjectState): void {
    const size = state.scene.partSizeMm || 200;
    const cell = 10 ** Math.round(Math.log10(size / 10));
    if (this.grid && cell !== this.gridCell) {
      this.modelRoot.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
      this.grid = null;
    }
    if (!this.grid && this.gridOn) {
      const n = 40;
      const g = new THREE.GridHelper(cell * n, n, 0x8a8a8a, 0x5c5c5c);
      const m = g.material as THREE.LineBasicMaterial;
      m.transparent = true;
      m.opacity = 0.45;
      m.depthWrite = false;
      // GridHelper lies on its XZ plane; the model is Z-up, so the floor is XY.
      g.rotation.x = Math.PI / 2;
      g.renderOrder = -1;
      this.grid = g;
      this.gridCell = cell;
      this.modelRoot.add(g);
    }
    if (this.grid) this.grid.visible = this.gridOn && state.scene.roots.length > 0;
  }

  /** Ink of the outline (the theme's --ink-0), linear 0..1. */
  setInk(rgb: readonly number[]): void {
    this.outlineMaterial.uniforms.ink.value.set(rgb[0], rgb[1], rgb[2]);
    this.gizmo.setInk(rgb);
    for (const g of [this.glyphLines, this.glyphSelected, this.glyphDots]) g.material.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
    this.needsRender = true;
  }

  setHover(ids: readonly NodeId[]): void {
    if (ids.length === this.hover.length && ids.every((x, i) => x === this.hover[i])) return;
    this.hover = [...ids];
    this.updateLayers();
  }

  private get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    const s = this.state;
    return s && this.viewCamera(s)?.projection === 'ORTHOGRAPHIC' ? this.ortho : this.persp;
  }

  /** The camera the viewport looks through: a light's or a saved camera's view (Look through, L4), or the active one. */
  private viewCamera(state: ProjectState): CameraState | undefined {
    const lt = this.glyphSpec.lookThrough;
    return (lt ? lookThroughCamera(state, lt) : null) ?? activeCamera(state);
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
    const poseToggled = posed !== this.poseActive;
    const poseChanged = poseToggled || (posed && (full || anim !== prev.animation));
    const pose = posed ? evaluate(state, anim.playhead) : null;
    if (posed || this.poseActive) this.applyNodePose(state, pose);
    this.poseActive = posed;
    // Lights and environment follow the playhead only when a clip moves them.
    const poseLights = poseToggled || (poseChanged && anim.clips.some((c) => c.target.kind === 'LIGHT'));
    const poseEnv = poseToggled || (poseChanged && anim.clips.some((c) => c.target.kind === 'SCENE'));
    if (full || nodesChanged || poseLights || state.studio !== prev.studio || state.scene.partSizeMm !== prev.scene.partSizeMm) this.syncLights(state, pose);
    // The sky follows the sun light; the background image the frame (output size).
    const skyFollows = state.environment.kind === 'SKY' && !full && (state.studio !== prev.studio || poseLights);
    const plateFollows = state.environment.background === 'BACKPLATE' && !full && (state.render.width !== prev.render.width || state.render.height !== prev.render.height);
    if (full || state.environment !== prev.environment || poseEnv || skyFollows || plateFollows) this.syncEnvironment(state, pose);
    if (full || state.image !== prev.image) this.syncImage(state);
    if (full || nodesChanged || state.studio !== prev.studio || state.environment !== prev.environment) this.syncFloor(state);
    if (full || nodesChanged || state.scene.partSizeMm !== prev.scene.partSizeMm) this.syncGrid(state);
    if (full || nodesChanged || state.effects !== prev.effects || state.scene.partSizeMm !== prev.scene.partSizeMm || state.materials !== prev.materials) this.syncEffects(state);
    // Looking through a light (L4), the view follows it wherever it is moved from (the inspector, undo).
    const throughLight = this.glyphSpec.lookThrough?.kind === 'LIGHT' && state.studio !== prev?.studio;
    if (full || state.camera !== prev.camera || state.render.width !== prev.render.width || state.render.height !== prev.render.height || poseChanged || nodesChanged || throughLight) {
      if (!this.interacting) this.syncCamera(state, pose);
    }
    if (full || nodesChanged || state.selection !== prev.selection) {
      this.updateLayers();
      this.syncFaceOverlay(state);
    }
    // The parts may have been rebuilt: the tint of a drag in progress would hang from one that is gone.
    if (nodesChanged) this.dropOverlay = PreviewEngine.dropTint(this.dropOverlay);
    // The interface may hand the gizmo new ids before this sync: place it again with the state that has them. A
    // light's or a camera's gizmo follows the light (and the product it is placed around) and the camera.
    const objectsMoved = full || nodesChanged || state.studio !== prev.studio || state.camera !== prev.camera || state.scene.partSizeMm !== prev.scene.partSizeMm || state.render.width !== prev.render.width || state.render.height !== prev.render.height;
    if (this.gizmoSpec && (full || nodesChanged || state.selection !== prev.selection || (this.gizmoSpec.object && objectsMoved))) this.placeGizmo();
    if (objectsMoved || state.selection !== prev.selection) this.syncGlyphs();
    this.needsRender = true;
  }

  private syncMaterials(state: ProjectState, prev: ProjectState | null): void {
    for (const [id, inst] of Object.entries(state.materials)) {
      const m = this.materials.get(id);
      if (!m) {
        const made = makeMaterial(inst, state.scene.partSizeMm);
        this.textures.apply(made, inst);
        this.materials.set(id, made);
      } else if (!prev || prev.materials[id] !== inst || prev.scene.partSizeMm !== state.scene.partSizeMm) {
        applyMaterial(m, inst, state.scene.partSizeMm);
        this.textures.apply(m, inst);
      }
    }
    for (const [id, m] of this.materials) {
      if (!state.materials[id]) {
        m.dispose();
        this.materials.delete(id);
      }
    }
    this.textures.prune(this.materials.values());
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
    // M2a: the second UV set, for the slots that name it.
    if (data.uvs && data.uvs2) g.setAttribute('uv1', new THREE.BufferAttribute(data.uvs2, 2));
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
      // Around the rig pivot, aimed at it or at its own aim, turned by its roll (core/lighting.ts lightFrame).
      const f = lightFrame(state, l);
      const pos = toThree(f.position);
      const aim = toThree(f.target);
      const color = new THREE.Color().setRGB(l.color[0], l.color[1], l.color[2], THREE.LinearSRGBColorSpace);
      if (l.type === 'SUN') {
        // The same irradiance the path tracer gets (core/photometry.ts).
        const sun = new THREE.DirectionalLight(color, l.power * SUN_IRRADIANCE_PER_POWER);
        sun.position.copy(pos);
        sun.target.position.copy(aim);
        this.lightRoot.add(sun, sun.target);
      } else if (isSphereLike(l)) {
        // A point, a glowing sphere or a spot (L4): the engine's intensity for that flux (core/photometry.ts), decay 2.
        const intensity = pointLightIntensity(l.power, state.scene.partSizeMm);
        if (l.type === 'SPOT') {
          const half = (Math.min(179, Math.max(1, l.spread)) * Math.PI) / 360;
          const spot = new THREE.SpotLight(color, intensity, 0, half, Math.min(1, Math.max(0, l.blend ?? SPOT_DEFAULTS.blend)), 2);
          spot.position.copy(pos);
          spot.target.position.copy(aim);
          this.lightRoot.add(spot, spot.target);
        } else {
          const point = new THREE.PointLight(color, intensity, 0, 2);
          point.position.copy(pos);
          this.lightRoot.add(point);
        }
      } else {
        const w = Math.max(1e-3, l.size) * size;
        const hgt = Math.max(1e-3, l.shape === 'SQUARE' || l.shape === 'DISK' ? l.size : l.sizeY) * size;
        const area = Math.max(1e-6, (w / size) * (hgt / size) * (l.shape === 'DISK' || l.shape === 'ELLIPSE' ? Math.PI / 4 : 1));
        // RectAreaLight takes radiance: the path tracer's for this flux and area (core/photometry.ts).
        const rect = new THREE.RectAreaLight(color, areaLightRadiance(l.power, area), w, hgt);
        rect.position.copy(pos);
        // Its sides level with the floor, or turned by its roll.
        if (l.roll) rect.up.copy(toThree(f.up));
        rect.lookAt(aim);
        this.lightRoot.add(rect);
      }
      if (l.camera) {
        // A panel the camera sees: a soft disc, never a hard-edged rectangle.
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.disc, color, transparent: true, depthWrite: false, toneMapped: false }));
        sprite.position.copy(pos);
        // Drawn before the shadow-catching floor, so the floor never cuts it into a hard edge.
        sprite.renderOrder = -2;
        const s = Math.max(isSphereLike(l) ? l.size : Math.max(l.size, l.sizeY), 1e-3) * size;
        sprite.scale.set(s, s, 1);
        this.lightRoot.add(sprite);
      }
    }
    // The shadow caster: a zero-intensity sun from above, leaning toward the key light.
    const keyDir = key ? polar(toWorldAzimuth(key.az), Math.max(55, key.el), 1) : [0, 0, 1];
    const d = toThree(keyDir).normalize();
    // Around the product: the contact shadow is what the shadow catcher shows, and a backdrop would spread the map thin.
    const b = productBounds(state, true);
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
    // What lights: the studio dome, a flat colour, the sky, or the HDRI (the dome while none is loaded).
    const hdri = env.kind === 'HDRI' && env.hdri ? getImage(env.hdri.id) : undefined;
    const kind = env.kind === 'FLAT' ? 'FLAT' : env.kind === 'SKY' ? 'SKY' : hdri?.linear ? 'HDRI' : 'STUDIO';
    let sun: Vec3 = [0, 0, 1];
    if (kind === 'SKY') {
      // The sky's sun is the rig's sun light, posed like syncLights poses it (or the environment's own).
      const lights = state.studio.lights.map((l0) => {
        const lp = pose?.lights[l0.id];
        return lp ? { ...l0, power: lp.power, az: lp.az, el: lp.el, enabled: lp.enabled } : l0;
      });
      sun = skySunDirection(state, lights);
    }
    const key =
      kind === 'FLAT'
        ? `FLAT:${env.color.join(',')}`
        : kind === 'SKY'
          ? `SKY:${env.skyModel}:${env.skyTurbidity}:${sun.map((v) => v.toFixed(4)).join(',')}`
          : kind === 'HDRI'
            ? `HDRI:${env.hdri!.id}`
            : 'STUDIO';
    if (key !== this.envKey) {
      this.envKey = key;
      this.envTexture?.dispose();
      this.envMap?.dispose();
      let tex: THREE.Texture;
      if (kind === 'HDRI') {
        tex = equirectTexture(hdri!.linear!, hdri!.previewWidth ?? hdri!.width, hdri!.previewHeight ?? hdri!.height);
      } else if (kind === 'SKY') {
        // The engine's sky (core/sky.ts), unscaled by strength: environmentIntensity applies it.
        const deg = 180 / Math.PI;
        const rgb = skyImage({
          model: env.skyModel,
          sunAzimuthDeg: Math.atan2(sun[1], sun[0]) * deg,
          sunElevationDeg: Math.asin(Math.max(-1, Math.min(1, sun[2]))) * deg,
          turbidity: env.skyTurbidity,
          floor: DOME_FLOOR,
          horizon: DOME_HORIZON,
          zenith: DOME_ZENITH,
          strength: 1,
        });
        tex = equirectTexture(rgb, SKY_WIDTH, SKY_HEIGHT);
      } else {
        tex = new THREE.CanvasTexture(domeCanvas(kind, env.color));
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
      }
      this.envTexture = tex;
      this.envMap = this.pmrem.fromEquirectangular(tex).texture;
    }
    // The sky is placed by its sun, not turned (as in the engine).
    const rot = kind === 'SKY' ? 0 : THREE.MathUtils.degToRad(pose ? pose.envRotationDeg : env.rotationDeg);
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = env.strength;
    this.scene.environmentRotation.set(0, rot, 0);
    this.scene.backgroundRotation.set(0, rot, 0);
    this.scene.backgroundIntensity = env.strength;
    const color = () => new THREE.Color().setRGB(env.color[0], env.color[1], env.color[2], THREE.LinearSRGBColorSpace);
    if (env.background === 'COLOR') {
      this.scene.background = color();
    } else if (env.background === 'TRANSPARENT') {
      this.scene.background = null;
    } else if (env.background === 'BACKPLATE') {
      // The image fitted to the output frame of the viewport, the colour while none is loaded.
      const frame = outputFrameRect(this.width, this.height, state.render.width, state.render.height);
      this.scene.background = this.viewportPlate(state, this.width, this.height, frame) ?? color();
    } else {
      this.scene.background = this.envTexture;
    }
  }

  /** The canvas of the background image's pixels, or null when none is loaded. */
  private plateImage(state: ProjectState): HTMLCanvasElement | null {
    const ref = state.environment.backplate;
    const img = ref ? getImage(ref.id) : undefined;
    if (!ref || !img?.rgba8) return null;
    if (this.plateSource?.id !== ref.id) this.plateSource = { id: ref.id, canvas: imageCanvas(img) };
    return this.plateSource.canvas;
  }

  /** The viewport's background image texture (`w x h` CSS pixels, at most 2048 on the longer side), cached. */
  private viewportPlate(state: ProjectState, w: number, h: number, frame: FrameRect): THREE.Texture | null {
    const src = this.plateImage(state);
    if (!src) return null;
    const env = state.environment;
    const k = Math.min(Math.max(1, this.dpr), 2048 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k));
    const ch = Math.max(1, Math.round(h * k));
    const f = { x: frame.x * k, y: frame.y * k, width: frame.width * k, height: frame.height * k };
    const key = `${this.plateSource!.id}|${env.backplateFit}|${env.color.join(',')}|${cw}x${ch}|${f.x},${f.y},${f.width},${f.height}`;
    if (key !== this.plateKey || !this.plateTexture) {
      this.plateKey = key;
      this.plateTexture?.dispose();
      this.plateTexture = backgroundTexture(plateCanvas(src, env.backplateFit, env.color, cw, ch, f));
    }
    return this.plateTexture;
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
    // Looking through a light or a saved camera (L4): its view, and the navigation moves it (main.ts).
    const through = this.glyphSpec.lookThrough ? lookThroughCamera(state, this.glyphSpec.lookThrough) : null;
    if (through) {
      this.placeCamera(through, this.width, this.height, state.render.width, state.render.height, true);
      this.controls.enabled = !through.locked;
      return;
    }
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

  /** The view the controls have now. */
  private currentView(): ViewChange | null {
    const s = this.state;
    if (!s) return null;
    const cam = this.viewCamera(s)!;
    const c = this.camera;
    const pos = fromThree(c.position);
    const target = fromThree(this.controls.target);
    const orbit = orbitFromPosition(pos, target);
    const change: ViewChange = { ...orbit, target };
    if (c === this.ortho && this.ortho.zoom !== 1) change.orthoWidth = cam.orthoWidth / this.ortho.zoom;
    return change;
  }

  private emitView(): void {
    const change = this.viewListener ? this.currentView() : null;
    if (change) this.viewListener!(change);
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

  /** A tinted copy of some triangles of a part, a child of the part (so it moves with it); null without geometry. */
  private faceTint(state: ProjectState, part: NodeId, indices: readonly number[], opacity: number): THREE.Mesh | null {
    if (indices.length === 0) return null;
    const node = state.scene.nodes[part];
    const obj = this.objects.get(part);
    const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
    if (!obj || !data) return null;
    const pos = new Float32Array(indices.length * 9);
    indices.forEach((tri, i) => {
      for (let k = 0; k < 3; k++) {
        const v = data.indices[tri * 3 + k];
        pos.set(data.positions.subarray(v * 3, v * 3 + 3), i * 9 + k * 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ink = this.outlineMaterial.uniforms.ink.value as THREE.Vector3;
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(ink.x, ink.y, ink.z), transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    obj.add(mesh);
    return mesh;
  }

  private static dropTint(mesh: THREE.Mesh | null): null {
    mesh?.removeFromParent();
    mesh?.geometry.dispose();
    (mesh?.material as THREE.Material | undefined)?.dispose();
    return null;
  }

  private syncFaceOverlay(state: ProjectState): void {
    this.faceOverlay = PreviewEngine.dropTint(this.faceOverlay);
    const f = state.selection.level === 'FACES' ? state.selection.faces : undefined;
    if (f) this.faceOverlay = this.faceTint(state, f.part, f.indices, 0.45);
  }

  /** The faces a dragged material would reach, tinted until the drag moves on (null clears them). */
  setHoverFaces(spec: { part: NodeId; indices: readonly number[] } | null): void {
    this.dropOverlay = PreviewEngine.dropTint(this.dropOverlay);
    if (spec && this.state) this.dropOverlay = this.faceTint(this.state, spec.part, spec.indices, 0.3);
    this.needsRender = true;
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
    // The background image follows the output frame inside the viewport.
    if (this.state?.environment.background === 'BACKPLATE') this.syncEnvironment(this.state, this.poseActive ? evaluate(this.state, this.state.animation.playhead) : null);
    this.needsRender = true;
  }

  /** Forces a redraw on the next frame. */
  invalidate(): void {
    this.needsRender = true;
  }

  /** Something to draw over the path tracer: an outline, selected faces, the gizmo. */
  private hasOverlay(): boolean {
    if (this.faceOverlay || this.dropOverlay || (this.gizmo.visible && !this.poseActive) || this.glyphs.length > 0) return true;
    for (const o of this.objects.values()) if (o.layers.isEnabled(LAYER_SELECTED) || o.layers.isEnabled(LAYER_HOVER)) return true;
    return false;
  }

  frame(): void {
    if (!this.renderer || !this.needsRender || !this.state) return;
    this.needsRender = false;
    const t0 = performance.now();
    const cam = this.camera;
    this.renderer.setClearColor(0x000000, 0);
    // Full mode with nothing to draw over the image: one clear, then no GL work at all (camera
    // gestures stay cheap on a software GL).
    if (this.overlayOnly && !this.hasOverlay()) {
      if (!this.overlayClear) {
        this.renderer.clear();
        // An invisible canvas is left out of compositing: a software compositor would otherwise read
        // the WebGL canvas back on every frame the image under it changes. It still gets the pointer.
        this.renderer.domElement.style.opacity = '0';
      }
      this.overlayClear = true;
      this.lastFrameMs = performance.now() - t0;
      for (const fn of this.frameListeners) fn();
      return;
    }
    if (this.overlayClear || !this.overlayOnly) this.renderer.domElement.style.opacity = '';
    this.overlayClear = false;
    if (this.overlayOnly) this.drawOverlayBase(cam);
    else this.renderer.render(this.scene, cam);
    this.drawOutline(cam);
    this.drawGizmo(cam);
    this.lastFrameMs = performance.now() - t0;
    for (const fn of this.frameListeners) fn();
  }

  /**
   * Full mode: a transparent canvas, and the selected faces drawn over the model's depth (which
   * writes no colour), so they hide behind the part like they do in Fast mode.
   */
  private drawOverlayBase(cam: THREE.Camera): void {
    this.renderer.clear();
    const tints = [this.faceOverlay, this.dropOverlay].filter((m): m is THREE.Mesh => m !== null);
    if (tints.length === 0) return;
    const bg = this.scene.background;
    const floorVisible = this.floor.visible;
    const lightsVisible = this.lightRoot.visible;
    const gridVisible = this.grid?.visible ?? false;
    this.scene.background = null;
    this.floor.visible = false;
    this.lightRoot.visible = false;
    if (this.grid) this.grid.visible = false;
    for (const m of tints) m.visible = false;
    this.scene.overrideMaterial = this.depthOnly;
    this.renderer.render(this.scene, cam);
    this.scene.overrideMaterial = null;
    this.renderer.autoClear = false;
    for (const m of tints) {
      m.visible = true;
      this.renderer.render(m, cam);
    }
    this.renderer.autoClear = true;
    this.scene.background = bg;
    this.floor.visible = floorVisible;
    this.lightRoot.visible = lightsVisible;
    if (this.grid) this.grid.visible = gridVisible;
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
    const gridVisible = this.grid?.visible ?? false;
    this.scene.background = null;
    this.floor.visible = false;
    this.lightRoot.visible = false;
    if (this.grid) this.grid.visible = false;
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
    if (this.grid) this.grid.visible = gridVisible;
    this.renderer.setRenderTarget(null);
    const px = Math.max(1, Math.round(this.dpr));
    this.outlineMaterial.uniforms.mask.value = this.maskTarget.texture;
    this.outlineMaterial.uniforms.texel.value.set(px / size.x, px / size.y);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.autoClear = true;
  }

  // ------------------------------------------------------------------ gizmo

  /** Shows the gizmo of the move tool for some nodes (null hides it). */
  setGizmo(spec: GizmoSpec | null): void {
    const handles = spec?.handles ?? 'ALL';
    const same =
      spec &&
      this.gizmoSpec &&
      spec.space === this.gizmoSpec.space &&
      handles === (this.gizmoSpec.handles ?? 'ALL') &&
      spec.ids.length === this.gizmoSpec.ids.length &&
      spec.ids.every((id, i) => id === this.gizmoSpec!.ids[i]) &&
      sameObject(spec.object, this.gizmoSpec.object);
    if (same || (!spec && !this.gizmoSpec)) return;
    this.gizmoSpec = spec ? { ids: [...spec.ids], space: spec.space, handles, object: spec.object ?? null } : null;
    this.gizmoDragging = null;
    this.gizmo.setActive(null);
    this.gizmo.setMode(handles);
    this.placeGizmo();
  }

  private placeGizmo(): void {
    const s = this.state;
    const spec = this.gizmoSpec;
    if (s && spec?.object) {
      // A light or a camera (L4): at its position, with the aim handle at what it looks at; none on the one looked through.
      const placed = sameObject(spec.object, this.glyphSpec.lookThrough) ? null : objectFrame(s, spec.object, spec.space);
      this.gizmo.place(placed?.frame ?? null, placed?.aim ?? null);
      if (!placed) this.gizmo.setHover(null);
      this.needsRender = true;
      return;
    }
    const ids = s && spec ? movableTargets(s, spec.ids) : [];
    const frame = s && spec && ids.length > 0 ? selectionFrame(s, ids, spec.space) : null;
    const first = s && ids[0] ? s.scene.nodes[ids[0]] : undefined;
    // A light also gets the aim handle: a line from it to its target.
    const aim = s && frame && first?.kind === 'LIGHT' && first.target ? { from: transformPoint(worldMatrix(s, first.id), [0, 0, 0]), target: first.target } : null;
    this.gizmo.place(frame, aim);
    if (!frame) this.gizmo.setHover(null);
    this.needsRender = true;
  }

  // ------------------------------------------------------------------ lights and cameras (L4)

  /** Which glyphs of lights and cameras to draw and what the viewport looks through (Look through). */
  setGlyphs(spec: GlyphSpec): void {
    const cur = this.glyphSpec;
    if (spec.all === cur.all && sameObject(spec.selected, cur.selected) && sameObject(spec.lookThrough, cur.lookThrough)) return;
    const lookChanged = !sameObject(spec.lookThrough, cur.lookThrough);
    this.glyphSpec = { all: spec.all, selected: spec.selected, lookThrough: spec.lookThrough };
    this.syncGlyphs();
    if (this.state && lookChanged) {
      this.syncCamera(this.state, this.poseActive ? evaluate(this.state, this.state.animation.playhead) : null);
      if (this.gizmoSpec) this.placeGizmo();
    }
    this.needsRender = true;
  }

  private syncGlyphs(): void {
    const s = this.state;
    this.glyphs = s ? glyphsOf(s, this.glyphSpec) : [];
    const selected = this.glyphSpec.selected;
    const lines: number[] = [];
    const strong: number[] = [];
    const dots: number[] = [];
    for (const g of this.glyphs) {
      const out = sameObject(g.obj, selected) ? strong : lines;
      for (const p of g.lines) out.push(p[0], p[1], p[2]);
      for (const p of g.dots) dots.push(p[0], p[1], p[2]);
    }
    const put = (obj: THREE.LineSegments | THREE.Points, data: number[]) => {
      obj.geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
      obj.geometry.computeBoundingSphere();
      obj.visible = data.length > 0;
    };
    put(this.glyphLines, lines);
    put(this.glyphSelected, strong);
    put(this.glyphDots, dots);
    // Dashes of a fortieth and gaps of a sixtieth of the part, so they read the same for a ring and a sofa.
    const size = s?.scene.partSizeMm || 200;
    this.glyphLines.material.dashSize = size / 40;
    this.glyphLines.material.gapSize = size / 60;
    if (lines.length > 0) this.glyphLines.computeLineDistances();
    this.needsRender = true;
  }

  /** Where an object (a light, a camera) is on the canvas now, CSS pixels; null behind the view (for checks). */
  objectAt(obj: ViewObject): { x: number; y: number } | null {
    const s = this.state;
    const placed = s ? objectFrame(s, obj, 'GLOBAL') : null;
    if (!placed || this.width <= 0) return null;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const v = toThree(placed.frame.origin).project(cam);
    if (v.z < -1 || v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /** The light or camera whose glyph is under a point (CSS pixels on the canvas), or null. */
  glyphAt(x: number, y: number): ViewObject | null {
    if (this.glyphs.length === 0 || this.width <= 0 || this.poseActive) return null;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    const project = (p: Vec3) => {
      v.copy(toThree(p)).project(cam);
      if (v.z < -1 || v.z > 1) return null;
      return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
    };
    return pickGlyph(this.glyphs, project, x, y);
  }

  /** World millimetres per CSS pixel at a model point, for handles of a constant size on screen. */
  private worldPerPixel(p: Vec3): number {
    const cam = this.camera;
    const h = Math.max(1, this.height);
    if (cam instanceof THREE.OrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / h;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const d = Math.max(1e-6, toThree(p).sub(cam.position).dot(dir));
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h;
  }

  private sizeGizmo(): void {
    const f = this.gizmo.frame;
    if (!f) return;
    this.gizmo.setPixelSize(this.worldPerPixel(f.origin), this.worldPerPixel(this.gizmo.aimTarget ?? f.origin));
  }

  private drawGizmo(cam: THREE.Camera): void {
    const gizmo = this.gizmo.visible && !this.poseActive;
    if (!gizmo && this.glyphs.length === 0) return;
    // The glyphs of lights and cameras (L4) go with the gizmo, over everything; while the animation plays, not the gizmo.
    const shown = this.gizmo.root.visible;
    if (!gizmo) this.gizmo.root.visible = false;
    if (gizmo) this.sizeGizmo();
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, cam);
    this.renderer.autoClear = true;
    this.gizmo.root.visible = shown;
  }

  private rayAt(x: number, y: number): THREE.Raycaster {
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  /** The handle under a point (CSS pixels on the canvas), highlighted; null when none. */
  gizmoHover(x: number, y: number): GizmoHandle | null {
    if (!this.gizmo.visible || this.poseActive || this.width <= 0) {
      if (this.gizmo.setHover(null)) this.needsRender = true;
      return null;
    }
    this.sizeGizmo();
    const id = this.gizmo.pick(this.rayAt(x, y));
    if (this.gizmo.setHover(id)) this.needsRender = true;
    return id;
  }

  /** Starts a drag on the handle under a point; null when there is none. */
  gizmoBegin(x: number, y: number): GizmoHandle | null {
    const id = this.gizmoHover(x, y);
    const frame = this.gizmo.frame;
    if (!id || !frame) return null;
    const rc = this.rayAt(x, y);
    const view = normalize(fromThree(this.camera.getWorldDirection(new THREE.Vector3())));
    this.gizmoDragging = new GizmoDrag(id, frame, this.gizmo.baseWorldSize, modelRay(rc, fromThree), { x, y }, view, this.gizmo.aimTarget, this.gizmo.handleMode === 'SCALE' ? SCALE_CUBE_AT : null);
    this.gizmo.setActive(id);
    this.needsRender = true;
    return id;
  }

  /** What the drag did so far, measured from where it began (not snapped). */
  gizmoDrag(x: number, y: number): GizmoDelta | null {
    if (!this.gizmoDragging) return null;
    return this.gizmoDragging.update(modelRay(this.rayAt(x, y), fromThree), { x, y });
  }

  gizmoEnd(): void {
    this.gizmoDragging = null;
    this.gizmo.setActive(null);
    this.needsRender = true;
  }

  status(): EngineStatus {
    return { samples: 1, seconds: this.lastFrameMs / 1000, converged: true, device: this.device, ...(this.particleStats ? { particles: { ...this.particleStats } } : {}) };
  }

  // ------------------------------------------------------------------ ambient effects (S4a)

  /** rt.wasm for the particles (null: there is none; the region boxes are drawn instead). */
  setParticleEngine(rt: RtParticleExports | null): void {
    this.particleEngine = rt;
    this.particleCache.clear();
    if (this.state) this.syncEffects(this.state);
    this.needsRender = true;
  }

  /** The effect whose region box is drawn (the one being edited), or null. */
  setSelectedEffect(id: string | null): void {
    if (this.selectedEffect === id) return;
    this.selectedEffect = id;
    if (this.state) this.syncEffects(this.state);
    this.needsRender = true;
  }

  /** The particles an effect's material shows in the preview: its colour, and whether it is clear. */
  private effectLook(e: AmbientEffect): { color: readonly number[]; clear: boolean } {
    if (e.material) {
      const p = materialPreset(e.material);
      const c = p?.params.baseColor;
      const color = Array.isArray(c) && c.length >= 3 ? (c as number[]) : [0.8, 0.8, 0.8];
      return { color, clear: p?.family === 'GLASS' };
    }
    return { color: e.ownMaterial.baseColor, clear: e.ownMaterial.kind === 'GLASS' || e.ownMaterial.transmission > 0.6 };
  }

  private clearEffects(): void {
    for (const child of [...this.effectsRoot.children]) {
      this.effectsRoot.remove(child);
      const o = child as THREE.Mesh;
      o.geometry?.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    }
  }

  /** A region box as lines (model space): dashed for the boxes drawn instead of particles, solid for the selected one. */
  private boxLines(min: readonly number[], max: readonly number[], dashed: boolean): THREE.LineSegments {
    const box = new THREE.Box3(new THREE.Vector3(min[0], min[1], min[2]), new THREE.Vector3(max[0], max[1], max[2]));
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(box.max.x - box.min.x || 1e-3, box.max.y - box.min.y || 1e-3, box.max.z - box.min.z || 1e-3));
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color: 0x9a9a9a, transparent: true, opacity: 0.8, dashSize: 6, gapSize: 4, depthWrite: false, toneMapped: false })
      : new THREE.LineBasicMaterial({ color: 0xd0d0d0, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.position.copy(box.getCenter(new THREE.Vector3()));
    if (dashed) lines.computeLineDistances();
    lines.renderOrder = 2;
    return lines;
  }

  /** The particles of every effect from the engine's own simulator, at most PREVIEW_PARTICLES of each. */
  private syncEffects(state: ProjectState): void {
    this.clearEffects();
    const rt = this.particleEngine;
    const enabled = state.effects.filter((e) => e.enabled);
    if (enabled.length === 0) {
      this.particleStats = null;
      this.particleCache.clear();
      return;
    }
    let shown = 0;
    let total = 0;
    const live = new Set<string>();
    for (const e of enabled) {
      live.add(e.id);
      const fields = effectFxam(state, e, 0, engineParticleCap());
      total += fields.count;
      const region = effectRegion(state, e);
      if (!rt) {
        this.effectsRoot.add(this.boxLines(region.min, region.max, true));
        continue;
      }
      const n = Math.min(fields.count, PREVIEW_PARTICLES);
      const payload = fxamPayload(fields);
      const key = `${n}|${Array.from(payload).join(',')}`;
      let cached = this.particleCache.get(e.id);
      if (!cached || cached.key !== key) {
        cached = { key, data: evalParticles(rt, payload, n) };
        this.particleCache.set(e.id, cached);
      }
      const data = cached.data;
      if (!data || data.length === 0) continue;
      const count = data.length / PARTICLE_FLOATS;
      shown += count;
      const look = this.effectLook(e);
      const centre: Vec3 = [(region.min[0] + region.max[0]) / 2, (region.min[1] + region.max[1]) / 2, (region.min[2] + region.max[2]) / 2];
      const perPixel = this.worldPerPixel(centre);
      if (e.shape === 'CAPSULE') {
        // Streaks: thin cylinders along each capsule's segment, at least a pixel wide.
        const geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(look.color[0], look.color[1], look.color[2], THREE.LinearSRGBColorSpace), transparent: true, opacity: look.clear ? 0.35 : 0.9, depthWrite: false });
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const axis = new THREE.Vector3();
        for (let i = 0; i < count; i++) {
          const o = i * PARTICLE_FLOATS;
          axis.set(data[o + 4], data[o + 5], data[o + 6]);
          const length = 2 * axis.length();
          if (length > 0) q.setFromUnitVectors(up, axis.normalize());
          else q.identity();
          const r = Math.max(data[o + 3], 0.5 * perPixel);
          m.compose(new THREE.Vector3(data[o], data[o + 1], data[o + 2]), q, new THREE.Vector3(r, Math.max(length, 2 * r), r));
          mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        this.effectsRoot.add(mesh);
      } else {
        // Dots: as wide as the particle at the region's centre, never under a pixel and a half.
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const o = i * PARTICLE_FLOATS;
          positions[i * 3] = data[o];
          positions[i * 3 + 1] = data[o + 1];
          positions[i * 3 + 2] = data[o + 2];
          const tint = previewTint(tintSeed(data, i), e.palette, e.tintVar);
          for (let c = 0; c < 3; c++) colors[i * 3 + c] = look.color[c] * tint[c];
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const px = Math.min(16, Math.max(1.5, e.sizeMm / Math.max(1e-6, perPixel)));
        const mat = new THREE.PointsMaterial({ size: px * this.dpr, sizeAttenuation: false, vertexColors: true, map: this.disc, transparent: true, opacity: look.clear ? 0.5 : 1, depthWrite: false, alphaTest: 0.05 });
        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        this.effectsRoot.add(points);
      }
    }
    for (const id of [...this.particleCache.keys()]) if (!live.has(id)) this.particleCache.delete(id);
    // The effect being edited shows its region.
    const sel = enabled.find((e) => e.id === this.selectedEffect);
    if (sel && rt) {
      const r = effectRegion(state, sel);
      this.effectsRoot.add(this.boxLines(r.min, r.max, false));
    }
    // While rt.wasm loads the boxes stand in for the particles and the meter waits.
    this.particleStats = rt === undefined ? null : { shown, total, boxesOnly: rt === null };
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

  // ------------------------------------------------------------------ box selection

  /** How the parts are projected as they are drawn now (core/box-select.ts): the viewport's size and a matrix for each part. */
  projection(): Projection | null {
    if (!this.state || this.width <= 0) return null;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const viewProj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    return {
      width: this.width,
      height: this.height,
      mvp: (id) => {
        const obj = this.objects.get(id);
        if (!(obj instanceof THREE.Mesh)) return null;
        obj.updateWorldMatrix(true, false);
        return new THREE.Matrix4().multiplyMatrices(viewProj, obj.matrixWorld).elements.slice();
      },
    };
  }

  private idTarget: THREE.WebGLRenderTarget | null = null;
  private readonly idBlack = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, toneMapped: false });
  private readonly idColours = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });

  /**
   * The triangles of a part that show in a rectangle (CSS pixels), found by drawing the scene into an offscreen
   * target with a flat colour for each: the other parts in black (they hide what is behind them), the part with the
   * number of each triangle in its colour (and its own triangles hiding each other, as they do on the screen).
   * A pixel counts when the four around it show the same triangle: the one-pixel lines along a silhouette, where
   * the faces behind a ridge peep out by the rasterizer's rounding, are not what the person sees.
   * Null when it cannot be drawn (too many triangles to number, no geometry).
   */
  visibleTriangles(part: NodeId, rect: Rect): Set<number> | null {
    const state = this.state;
    const obj = this.objects.get(part);
    const node = state?.scene.nodes[part];
    const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
    if (!state || !(obj instanceof THREE.Mesh) || !data || this.width <= 0 || this.height <= 0) return null;
    const T = Math.floor(data.indices.length / 3);
    if (T === 0 || T >= 0xffffff) return null;
    const W = Math.max(1, Math.round(this.width));
    const H = Math.max(1, Math.round(this.height));
    if (!this.idTarget || this.idTarget.width !== W || this.idTarget.height !== H) {
      this.idTarget?.dispose();
      this.idTarget = new THREE.WebGLRenderTarget(W, H, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: true });
    }
    // The rectangle in target pixels, and a ring of one more around it for the pixels at its border.
    const x0 = Math.min(W - 1, Math.max(0, Math.floor(rect.x0)));
    const x1 = Math.min(W, Math.max(x0 + 1, Math.ceil(rect.x1)));
    const y0 = Math.min(H - 1, Math.max(0, Math.floor(rect.y0)));
    const y1 = Math.min(H, Math.max(y0 + 1, Math.ceil(rect.y1)));
    const rx0 = Math.max(0, x0 - 1);
    const rx1 = Math.min(W, x1 + 1);
    const ry0 = Math.max(0, y0 - 1);
    const ry1 = Math.min(H, y1 + 1);
    // The part with an id in the colour of each triangle (not indexed: a colour for each corner).
    const pos = new Float32Array(T * 9);
    const col = new Uint8Array(T * 9);
    for (let t = 0; t < T; t++) {
      const id = t + 1;
      for (let k = 0; k < 3; k++) {
        const v = data.indices[3 * t + k];
        pos.set(data.positions.subarray(3 * v, 3 * v + 3), 9 * t + 3 * k);
        col[9 * t + 3 * k] = id & 255;
        col[9 * t + 3 * k + 1] = (id >> 8) & 255;
        col[9 * t + 3 * k + 2] = (id >> 16) & 255;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    const ids = new THREE.Mesh(g, this.idColours);
    ids.frustumCulled = false;
    obj.add(ids);
    const r = this.renderer;
    const cam = this.camera;
    const was = { bg: this.scene.background, floor: this.floor.visible, lights: this.lightRoot.visible, grid: this.grid?.visible ?? false, part: obj.visible, faces: this.faceOverlay?.visible ?? false, drop: this.dropOverlay?.visible ?? false };
    const found = new Set<number>();
    try {
      this.scene.background = null;
      this.floor.visible = false;
      this.lightRoot.visible = false;
      if (this.grid) this.grid.visible = false;
      if (this.faceOverlay) this.faceOverlay.visible = false;
      if (this.dropOverlay) this.dropOverlay.visible = false;
      r.setRenderTarget(this.idTarget);
      r.setClearColor(0x000000, 1);
      r.clear();
      // Everything else is the occluder; the part is drawn after it, with its ids.
      ids.visible = false;
      obj.visible = false;
      this.scene.overrideMaterial = this.idBlack;
      r.autoClear = false;
      r.render(this.scene, cam);
      this.scene.overrideMaterial = null;
      // Only `ids` (the part's child) is drawn now, as the root, over the depth of the rest.
      ids.visible = true;
      obj.visible = true;
      r.render(ids, cam);
      const pw = rx1 - rx0;
      const ph = ry1 - ry0;
      const buf = new Uint8Array(pw * ph * 4);
      r.readRenderTargetPixels(this.idTarget, rx0, H - ry1, pw, ph, buf);
      // Rows of the buffer run bottom up; `at` reads the id of a pixel by its screen coordinates (-1 outside the target).
      const at = (x: number, y: number): number => {
        if (x < 0 || y < 0 || x >= W || y >= H) return -1;
        const i = ((ry1 - 1 - y) * pw + (x - rx0)) * 4;
        return buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16);
      };
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const id = at(x, y);
          if (id <= 0 || id > T || found.has(id - 1)) continue;
          // A neighbour outside the target does not count against the pixel (the face runs off the screen).
          const same = (nx: number, ny: number) => {
            const n = at(nx, ny);
            return n === id || n === -1;
          };
          if (same(x - 1, y) && same(x + 1, y) && same(x, y - 1) && same(x, y + 1)) found.add(id - 1);
        }
      }
    } finally {
      this.scene.overrideMaterial = null;
      r.setRenderTarget(null);
      r.autoClear = true;
      r.setClearColor(0x000000, 0);
      this.scene.background = was.bg;
      this.floor.visible = was.floor;
      this.lightRoot.visible = was.lights;
      if (this.grid) this.grid.visible = was.grid;
      obj.visible = was.part;
      if (this.faceOverlay) this.faceOverlay.visible = was.faces;
      if (this.dropOverlay) this.dropOverlay.visible = was.drop;
      ids.removeFromParent();
      g.dispose();
      this.needsRender = true;
    }
    return found;
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
    // The floor grid is a working aid: never in a picture.
    const gridVisible = this.grid?.visible ?? false;
    if (this.grid) this.grid.visible = false;
    const out = document.createElement('canvas');
    out.width = opts.width;
    out.height = opts.height;
    let stillPlate: THREE.Texture | null = null;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(opts.width, opts.height, false);
      if (this.renderer.domElement.width !== opts.width || gl.drawingBufferWidth !== opts.width || gl.drawingBufferHeight !== opts.height) {
        throw new Error(`${opts.width} × ${opts.height}`);
      }
      this.placeCamera(cam, opts.width, opts.height, opts.width, opts.height, false);
      // A picture's background image fills the whole picture (it is the output frame).
      const plate = !opts.transparent && s.environment.background === 'BACKPLATE' ? this.plateImage(s) : null;
      if (plate) {
        stillPlate = backgroundTexture(plateCanvas(plate, s.environment.backplateFit, s.environment.color, opts.width, opts.height, { x: 0, y: 0, width: opts.width, height: opts.height }));
        this.scene.background = stillPlate;
      }
      if (opts.transparent) this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
      const three = cam.projection === 'ORTHOGRAPHIC' ? this.ortho : this.persp;
      this.renderer.render(this.scene, three);
      out.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    } finally {
      this.scene.background = bg;
      stillPlate?.dispose();
      if (this.grid) this.grid.visible = gridVisible;
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.width, this.height, false);
      this.syncCamera(s, this.poseActive ? evaluate(s, s.animation.playhead) : null);
      this.needsRender = true;
    }
    const seconds = (performance.now() - t0) / 1000;
    opts.onProgress?.({ jobId: null, progress: 1, samples: 1, seconds });
    return createImageBitmap(out);
  }

  // ------------------------------------------------------------------ AI frame (phase X4)

  /** The visible parts as the passes draw them: mesh, node and the material key of every group (see PassMesh). */
  private passMeshes(): PassMesh[] {
    const s = this.state;
    if (!s) return [];
    this.scene.updateMatrixWorld(true);
    const visible = (o: THREE.Object3D): boolean => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    const out: PassMesh[] = [];
    for (const [id, obj] of this.objects) {
      const node = s.scene.nodes[id];
      if (!node || !(obj instanceof THREE.Mesh) || !node.mesh || !visible(obj)) continue;
      const ids = obj.geometry.userData.materialIds as (string | null)[] | undefined;
      // Group 0 is the part's own material (assignMaterials); the others are the face materials, as they appeared.
      const keys = ids ? ids.map((m, i) => (i === 0 ? (node.material ?? null) : m)) : [node.material ?? null];
      out.push({ mesh: obj, node: id, keys });
    }
    return out;
  }

  /**
   * A frame for the AI step (AI-POST.md §4): the picture of a camera at `width × height` as the Fast mode
   * draws it (8-bit sRGB, straight RGBA, rows from the top; null when `colour` is off, for a picture the
   * path tracer draws) and the passes of §7.4 drawn at the same size from the same camera. `ids` come from
   * the engine's scene (`projectScene(...).ids`), so the part and material ids are the engine's.
   */
  aiFrame(opts: { width: number; height: number; camera?: string; ids: PassIds; colour: boolean; passes?: readonly PassKey[] }): { rgba: Uint8ClampedArray | null; passes: RenderPasses } {
    const s = this.state;
    if (!s || !this.renderer) throw new Error('engine not ready');
    const gl = this.renderer.getContext();
    const max = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
    if (opts.width > max || opts.height > max) throw new Error(`${opts.width} × ${opts.height} > ${max}`);
    const cam = (opts.camera && s.camera.cameras[opts.camera]) || activeCamera(s);
    const bg = this.scene.background;
    const gridVisible = this.grid?.visible ?? false;
    if (this.grid) this.grid.visible = false;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(opts.width, opts.height, false);
      this.placeCamera(cam, opts.width, opts.height, opts.width, opts.height, false);
      const three = cam.projection === 'ORTHOGRAPHIC' ? this.ortho : this.persp;
      let rgba: Uint8ClampedArray | null = null;
      if (opts.colour) {
        if (gl.drawingBufferWidth !== opts.width || gl.drawingBufferHeight !== opts.height) throw new Error(`${opts.width} × ${opts.height}`);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.render(this.scene, three);
        const out = document.createElement('canvas');
        out.width = opts.width;
        out.height = opts.height;
        const g = out.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(this.renderer.domElement, 0, 0);
        rgba = g.getImageData(0, 0, opts.width, opts.height).data;
      }
      // The images of three.js's axes in model space: the one place the Y-up is undone (toThree's inverse).
      const axes = [fromThree(new THREE.Vector3(1, 0, 0)), fromThree(new THREE.Vector3(0, 1, 0)), fromThree(new THREE.Vector3(0, 0, 1))] as const;
      const passes = drawPasses({
        renderer: this.renderer,
        camera: three,
        meshes: this.passMeshes(),
        ids: opts.ids,
        width: opts.width,
        height: opts.height,
        lens: lensOf(cam),
        axes,
        passes: opts.passes ?? [],
      });
      return { rgba, passes };
    } finally {
      this.scene.background = bg;
      if (this.grid) this.grid.visible = gridVisible;
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.width, this.height, false);
      this.syncCamera(s, this.poseActive ? evaluate(s, s.animation.playhead) : null);
      this.needsRender = true;
    }
  }

  /** The viewport as it is now (one fresh frame), PNG. */
  capture(): Promise<Blob | null> {
    this.needsRender = true;
    this.frame();
    return new Promise((resolve) => this.renderer.domElement.toBlob((b) => resolve(b), 'image/png'));
  }

  dispose(): void {
    this.controls?.dispose();
    this.clearEffects();
    this.gizmo.dispose();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.textures.dispose();
    this.envTexture?.dispose();
    this.envMap?.dispose();
    this.maskTarget?.dispose();
    this.pmrem?.dispose();
    this.plateTexture?.dispose();
    this.renderer?.dispose();
  }
}

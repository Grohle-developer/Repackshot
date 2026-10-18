// The effect filters of the camera on the Fast viewport (phase O3a, decision 5): the scene is drawn into a linear
// half-float target, each filter of the stack makes `(1 − s)·I + s·a·(I ⊗ K_T)` of it with the kernels of
// render/lens-filter-image.ts (the same numbers: Gaussians blurred at a reduced size when they are wide, each with its
// colour, and taps along the lines of a star, a streak or a net), and the result goes to the screen through the
// renderer's tone curve and output colour space. An approximation of what the engine traces (the meter says so).
// O2: a traced lens's distortion and falloff (the engine's tables, `LensProfile`) are drawn in that last step.
// S3b: the front glass (render/glass-overlay.ts) is drawn after the filters, before that step.

import * as THREE from 'three';
import type { FilterKernel } from './lens-filter-image';
import { PROFILE_GLSL, ProfileUniformSet, type LensProfile } from './lens-profile';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Half the size: the four source texels around the output pixel. */
const DOWN = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  gl_FragColor = 0.25 * (texture2D(src, vUv + texel * vec2(-0.5, -0.5)) + texture2D(src, vUv + texel * vec2(0.5, -0.5))
    + texture2D(src, vUv + texel * vec2(-0.5, 0.5)) + texture2D(src, vUv + texel * vec2(0.5, 0.5)));
}`;

/** One direction of a Gaussian of `sigma` texels (at most 10: wider ones are blurred at a reduced size). */
const BLUR = /* glsl */ `
uniform sampler2D src;
uniform vec2 stepv;
uniform float sigma;
varying vec2 vUv;
void main() {
  vec4 acc = vec4(0.0);
  float sum = 0.0;
  float r = ceil(3.0 * sigma);
  for (int i = -32; i <= 32; i++) {
    float x = float(i);
    if (abs(x) > r) continue;
    float w = exp(-x * x / (2.0 * sigma * sigma));
    acc += texture2D(src, vUv + stepv * x) * w;
    sum += w;
  }
  gl_FragColor = acc / sum;
}`;

/** Adds `scale` (per channel) times a texture (of any size, bilinear) to the target. */
const ADD = /* glsl */ `
uniform sampler2D src;
uniform vec3 scale;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(src, vUv) * vec4(scale, 1.0);
}`;

const MAX_LINES = 8;
const MAX_TAPS = 49;

/** The lines of a star, a streak or a net: a pixel gathers what lies at −dir·r from it. */
const LINES = /* glsl */ `
uniform sampler2D src;
uniform vec2 dirs[${MAX_LINES}];
uniform float radii[${MAX_TAPS}];
uniform float weights[${MAX_TAPS}];
uniform int nDirs;
uniform int nTaps;
uniform vec3 scale;
varying vec2 vUv;
void main() {
  vec4 acc = vec4(0.0);
  for (int d = 0; d < ${MAX_LINES}; d++) {
    if (d >= nDirs) break;
    for (int i = 0; i < ${MAX_TAPS}; i++) {
      if (i >= nTaps) break;
      acc += texture2D(src, vUv - dirs[d] * radii[i]) * weights[i];
    }
  }
  gl_FragColor = acc * vec4(scale, 1.0);
}`;

/** `(1 − s)·I + s·scattered` (the scattered light with its colours), the alpha of I. */
const COMBINE = /* glsl */ `
uniform sampler2D image;
uniform sampler2D scattered;
uniform float s;
varying vec2 vUv;
void main() {
  vec4 i = texture2D(image, vUv);
  vec3 k = texture2D(scattered, vUv).rgb;
  gl_FragColor = vec4((1.0 - s) * i.rgb + s * k, i.a);
}`;

/**
 * S3b: the front glass (render/glass-overlay.ts): where the pixel's chief ray crosses the pane, the share of its
 * footprint under the drops' middles takes the image blurred (dimmed by the drops' two faces), the share under their
 * rims (total internal reflection) is dark, and the dust's share dims it.
 */
const GLASS = /* glsl */ `
uniform sampler2D image;
uniform sampler2D blurred;
uniform sampler2D pane;
uniform vec2 scale;
uniform vec2 offset;
uniform vec4 rect;
uniform float dropT;
varying vec2 vUv;
void main() {
  vec2 p = (vUv * 2.0 - 1.0 - offset) * scale;
  vec2 uv = (p - rect.xy) / rect.zw;
  vec3 m = (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) ? texture2D(pane, uv).rgb : vec3(0.0);
  vec4 i = texture2D(image, vUv);
  vec3 b = texture2D(blurred, vUv).rgb * dropT;
  float keep = (1.0 - clamp(m.g, 0.0, 1.0)) * (1.0 - clamp(m.b, 0.0, 1.0));
  gl_FragColor = vec4(mix(i.rgb, b, clamp(m.r - m.b, 0.0, 1.0)) * keep, i.a);
}`;

/** S3b: the front glass the Fast viewport draws over the picture (render/glass-overlay.ts makes its maps). */
export interface GlassDraw {
  /** The maps over the pane: R the drops' share of the footprint, G the dust's dimming, B the drops' rims' share. */
  texture: THREE.Texture;
  /** Pane mm of a pixel's chief ray: (ndc − offset) × scale. */
  scale: [number, number];
  offset: [number, number];
  /** The maps' rectangle: lower left corner, width and height, mm. */
  rect: [number, number, number, number];
  /** How much the scene blurs inside a drop, full-size pixels. */
  sigmaPx: number;
  /** The drops' transmittance at normal incidence. */
  dropT: number;
}

/** To the screen, through the renderer's tone curve and output colour space (O2: and a traced lens's profile). */
const PRESENT = /* glsl */ `
uniform sampler2D src;
${PROFILE_GLSL}
varying vec2 vUv;
void main() {
  vec3 at = lensProfileSource(vUv);
  gl_FragColor = texture2D(src, at.xy);
  gl_FragColor.rgb *= at.z;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The taps of a line two by two (the first one, the flat part, alone): their weights added, at their weights' mean distance. */
function pairTaps(taps: readonly { r: number; w: number }[]): { r: number; w: number }[] {
  const out = taps.length > 0 ? [taps[0]] : [];
  for (let i = 1; i < taps.length; i += 2) {
    const a = taps[i];
    const b = taps[i + 1];
    if (!b) out.push(a);
    else out.push({ r: (a.r * a.w + b.r * b.w) / (a.w + b.w), w: a.w + b.w });
  }
  return out;
}

function material(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, additive = false, toneMapped = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped,
    ...(additive ? { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true } : { blending: THREE.NoBlending }),
  });
}

/** The passes, their targets and the quad they draw on. */
export class LensFilterPass {
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly down = material(DOWN, { src: { value: null }, texel: { value: new THREE.Vector2() } });
  private readonly blur = material(BLUR, { src: { value: null }, stepv: { value: new THREE.Vector2() }, sigma: { value: 1 } });
  private readonly add = material(ADD, { src: { value: null }, scale: { value: new THREE.Vector3(1, 1, 1) } }, true);
  private readonly lines = material(
    LINES,
    {
      src: { value: null },
      dirs: { value: Array.from({ length: MAX_LINES }, () => new THREE.Vector2()) },
      radii: { value: new Array<number>(MAX_TAPS).fill(0) },
      weights: { value: new Array<number>(MAX_TAPS).fill(0) },
      nDirs: { value: 0 },
      nTaps: { value: 0 },
      scale: { value: new THREE.Vector3(1, 1, 1) },
    },
    true,
  );
  private readonly combine = material(COMBINE, { image: { value: null }, scattered: { value: null }, s: { value: 0 } });
  private readonly glassMat = material(GLASS, {
    image: { value: null },
    blurred: { value: null },
    pane: { value: null },
    scale: { value: new THREE.Vector2(1, 1) },
    offset: { value: new THREE.Vector2(0, 0) },
    rect: { value: new THREE.Vector4(0, 0, 1, 1) },
    dropT: { value: 1 },
  });
  /** O2: the map of a traced lens's profile (render/lens-profile.ts), the one the hit tests invert. */
  private readonly profileSet = new ProfileUniformSet();
  private readonly present = material(PRESENT, { src: { value: null }, ...this.profileSet.uniforms }, false, true);
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private ping: THREE.WebGLRenderTarget | null = null;
  private pong: THREE.WebGLRenderTarget | null = null;
  private accum: THREE.WebGLRenderTarget | null = null;
  /** Reduced sizes, by level (1/2, 1/4, ...), two each for the separable blur. */
  private levels: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget][] = [];
  private size = new THREE.Vector2();

  constructor() {
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private target(w: number, h: number, samples = 0, depth = false): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: depth, samples });
  }

  private ensure(w: number, h: number): void {
    if (this.sceneTarget && this.size.x === w && this.size.y === h) return;
    this.dispose();
    this.size.set(w, h);
    this.sceneTarget = this.target(w, h, 4, true);
    this.ping = this.target(w, h);
    this.pong = this.target(w, h);
    this.accum = this.target(w, h);
  }

  private level(k: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    while (this.levels.length <= k) {
      const f = 2 ** (this.levels.length + 1);
      const w = Math.max(1, Math.ceil(this.size.x / f));
      const h = Math.max(1, Math.ceil(this.size.y / f));
      this.levels.push([this.target(w, h), this.target(w, h)]);
    }
    return this.levels[k];
  }

  private draw(r: THREE.WebGLRenderer, m: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null, clear = false): void {
    this.quad.material = m;
    r.setRenderTarget(to);
    if (clear) {
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
    }
    r.render(this.scene, this.camera);
  }

  /** `src` blurred by a Gaussian of `sigma` full-size pixels, added `share` times its colour `weight` to the accumulation. */
  private gaussian(r: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, sigma: number, share: number, weight: readonly number[]): void {
    let from = src;
    let k = -1;
    let f = 1;
    // A level where the Gaussian is at most 8 texels wide.
    while (sigma / f > 8) {
      k++;
      f *= 2;
      const [a] = this.level(k);
      this.down.uniforms.src.value = from.texture;
      this.down.uniforms.texel.value.set(1 / from.width, 1 / from.height);
      this.draw(r, this.down, a);
      from = a;
    }
    const s = Math.sqrt(Math.max(0, sigma * sigma - (f > 1 ? (f * f) / 12 : 0))) / f;
    // Horizontally into one scratch target, vertically into the other: ping and pong at full size, the level's two
    // below it (its first one held the reduced picture, which the horizontal pass has read by then).
    const [first, second] = k < 0 ? [this.ping!, this.pong!] : [this.level(k)[1], this.level(k)[0]];
    this.blur.uniforms.sigma.value = Math.max(0.3, s);
    this.blur.uniforms.src.value = from.texture;
    this.blur.uniforms.stepv.value.set(1 / from.width, 0);
    this.draw(r, this.blur, first);
    this.blur.uniforms.src.value = first.texture;
    this.blur.uniforms.stepv.value.set(0, 1 / from.height);
    this.draw(r, this.blur, second);
    this.add.uniforms.src.value = second.texture;
    this.add.uniforms.scale.value.set(share * weight[0], share * weight[1], share * weight[2]);
    this.draw(r, this.add, this.accum);
  }

  /**
   * Draws `scene` from `camera` through the filter `kernels` to the screen (the renderer's current size), and with a
   * traced lens's `profile` (O2). The kernels' pixels are full-size pixels of the drawing buffer. S3b: then the front
   * `glass` over it, in front of the filters as the pane is in front of them.
   */
  render(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, kernels: readonly FilterKernel[], profile: LensProfile | null = null, glass: GlassDraw | null = null): void {
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.ensure(size.x, size.y);
    const autoClear = r.autoClear;
    r.setRenderTarget(this.sceneTarget);
    r.render(scene, camera);
    r.autoClear = false;
    let cur = this.sceneTarget!;
    for (const k of kernels) {
      // The accumulation of I ⊗ K.
      r.setRenderTarget(this.accum);
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
      for (const g of k.gaussians) this.gaussian(r, cur, g.sigmaPx, g.share, g.weight);
      // The lines gather from the half-size picture into its level's second target, which is then added (bilinear)
      // to the accumulation: a quarter of the pixels, and half the taps along each line.
      if (k.lines) {
        const [half, out] = this.level(0);
        this.down.uniforms.src.value = cur.texture;
        this.down.uniforms.texel.value.set(1 / cur.width, 1 / cur.height);
        this.draw(r, this.down, half);
        r.setRenderTarget(out);
        r.setClearColor(0x000000, 0);
        r.clear(true, false, false);
        const u = this.lines.uniforms;
        const dirs = k.lines.dirs.slice(0, MAX_LINES);
        // Offsets in texture coordinates: the same at any size. The picture's y runs down, the texture's up.
        dirs.forEach(([x, y], i) => (u.dirs.value as THREE.Vector2[])[i].set(x / size.x, -y / size.y));
        const taps = pairTaps(k.lines.taps).slice(0, MAX_TAPS);
        taps.forEach((t, i) => {
          (u.radii.value as number[])[i] = t.r;
          (u.weights.value as number[])[i] = t.w;
        });
        u.nDirs.value = dirs.length;
        u.nTaps.value = taps.length;
        const per = k.lines.share / dirs.length;
        (u.scale.value as THREE.Vector3).set(per * k.lines.weight[0], per * k.lines.weight[1], per * k.lines.weight[2]);
        u.src.value = half.texture;
        this.draw(r, this.lines, out);
        this.add.uniforms.src.value = out.texture;
        this.add.uniforms.scale.value.set(1, 1, 1);
        this.draw(r, this.add, this.accum);
      }
      // The combination goes to the result target that is not `cur` (ping and pong are the blurs' scratch).
      const c = this.combine.uniforms;
      c.image.value = cur.texture;
      c.scattered.value = this.accum!.texture;
      c.s.value = k.s;
      const into = this.result(size);
      this.draw(r, this.combine, into);
      cur = into;
    }
    if (glass) {
      r.setRenderTarget(this.accum);
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
      this.gaussian(r, cur, Math.max(0.5, glass.sigmaPx), 1, [1, 1, 1]);
      const g = this.glassMat.uniforms;
      g.image.value = cur.texture;
      g.blurred.value = this.accum!.texture;
      g.pane.value = glass.texture;
      (g.scale.value as THREE.Vector2).set(glass.scale[0], glass.scale[1]);
      (g.offset.value as THREE.Vector2).set(glass.offset[0], glass.offset[1]);
      (g.rect.value as THREE.Vector4).set(...glass.rect);
      g.dropT.value = glass.dropT;
      const into = this.result(size);
      this.draw(r, this.glassMat, into);
      cur = into;
    }
    const u = this.present.uniforms;
    u.src.value = cur.texture;
    this.profileSet.set(profile, size.x, size.y);
    this.draw(r, this.present, null);
    r.autoClear = autoClear;
  }

  /** The two full-size targets the filters' results alternate between (neither is a blur's scratch). */
  private resultTargets: THREE.WebGLRenderTarget[] = [];
  private flip = 0;
  private result(size: THREE.Vector2): THREE.WebGLRenderTarget {
    if (this.resultTargets.length < 2 || this.resultTargets[0].width !== size.x || this.resultTargets[0].height !== size.y) {
      for (const t of this.resultTargets) t.dispose();
      this.resultTargets = [this.target(size.x, size.y), this.target(size.x, size.y)];
    }
    this.flip ^= 1;
    return this.resultTargets[this.flip];
  }

  dispose(): void {
    for (const t of [this.sceneTarget, this.ping, this.pong, this.accum, ...this.resultTargets]) t?.dispose();
    for (const [a, b] of this.levels) {
      a.dispose();
      b.dispose();
    }
    this.levels = [];
    this.resultTargets = [];
    this.sceneTarget = this.ping = this.pong = this.accum = null;
  }
}

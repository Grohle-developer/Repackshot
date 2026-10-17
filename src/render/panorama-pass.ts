// The panoramas of the Fast preview (K3): the scene drawn on the six faces of a cube around the camera, then the
// canvas drawn from the cube through the projection the engine renders (core/panorama.ts, PANORAMA_GLSL), so the
// preview's equirectangular panorama and fisheye show what the engine's do, direction for direction. The cube is in
// linear light (half floats, a render target three.js does not tone map); the pass to the canvas applies the renderer's
// tone curve and output encoding like any material.

import * as THREE from 'three';
import { PANORAMA_GLSL } from '../core/panorama';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
uniform samplerCube cube;
uniform int kind;
uniform vec2 fov;
uniform float aspect;
uniform vec3 forward;
uniform vec3 right;
uniform vec3 up;
varying vec2 vUv;
${PANORAMA_GLSL}
void main() {
  vec4 d = panoramaDirection(kind, fov, aspect, vec2(vUv.x, 1.0 - vUv.y));
  if (d.w == 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    gl_FragColor = textureCube(cube, normalize(forward * d.x + right * d.y + up * d.z));
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The camera's frame for a panorama, in three.js space: the unit view axis, right and up. */
export interface PanoramaBasis {
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

/** The faces' size for a view `width` pixels wide whose width spans `fovXDeg`: about a pixel per pixel, a power of two. */
export function cubeFaceSize(width: number, fovXDeg: number, maxSize: number): number {
  const want = (Math.max(1, width) * 90) / Math.max(1, fovXDeg);
  let size = 64;
  while (size < want && size < maxSize) size *= 2;
  return Math.min(size, maxSize);
}

export class PanoramaPass {
  private target: THREE.WebGLCubeRenderTarget | null = null;
  private camera: THREE.CubeCamera | null = null;
  private readonly scene = new THREE.Scene();
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      cube: { value: null },
      kind: { value: 1 },
      fov: { value: new THREE.Vector2(2 * Math.PI, Math.PI) },
      aspect: { value: 2 },
      forward: { value: new THREE.Vector3(0, 0, -1) },
      right: { value: new THREE.Vector3(1, 0, 0) },
      up: { value: new THREE.Vector3(0, 1, 0) },
    },
    depthTest: false,
    depthWrite: false,
  });
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /**
   * Draws `scene` seen from `position` into the current render target (the canvas, or the target three.js treats as
   * it) through the panorama `kind` (1 equirectangular, 2 fisheye) of fields `fovDeg` across the view's width and
   * height, for a view of `aspect`, the camera's frame `basis`; the cube's faces `faceSize` pixels, `near` to `far`.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, position: THREE.Vector3, basis: PanoramaBasis, kind: 1 | 2, fovDeg: { x: number; y: number }, aspect: number, faceSize: number, near: number, far: number): void {
    if (!this.target || this.target.width !== faceSize) {
      this.target?.dispose();
      this.target = new THREE.WebGLCubeRenderTarget(faceSize, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.camera = new THREE.CubeCamera(near, far, this.target);
    }
    const cam = this.camera!;
    for (const c of cam.children) {
      const p = c as THREE.PerspectiveCamera;
      if (p.near !== near || p.far !== far) {
        p.near = near;
        p.far = far;
        p.updateProjectionMatrix();
      }
    }
    cam.position.copy(position);
    cam.updateMatrixWorld(true);
    const target = renderer.getRenderTarget();
    cam.update(renderer, scene);
    renderer.setRenderTarget(target);
    const u = this.material.uniforms;
    u.cube.value = this.target.texture;
    u.kind.value = kind;
    (u.fov.value as THREE.Vector2).set(THREE.MathUtils.degToRad(fovDeg.x), THREE.MathUtils.degToRad(fovDeg.y));
    u.aspect.value = aspect;
    (u.forward.value as THREE.Vector3).copy(basis.forward);
    (u.right.value as THREE.Vector3).copy(basis.right);
    (u.up.value as THREE.Vector3).copy(basis.up);
    renderer.render(this.scene, this.quadCamera);
  }

  dispose(): void {
    this.target?.dispose();
    this.material.dispose();
  }
}

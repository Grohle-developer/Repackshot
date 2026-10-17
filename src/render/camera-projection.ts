// The projection of the Fast preview's perspective camera (render/preview.ts), as a pure function of three.js maths so
// that it can be tested without WebGL: the frustum of the focal length, the lens shift of the optics (O1) and, K3, the
// straight verticals (core/interior-camera.ts).
//
// The orbit camera the navigation moves stays as it is (OrbitControls owns its orientation). The straight verticals
// are put in the projection instead: the view space of the tilted camera is turned by the corrected tilt about its
// right axis (that is the level camera's view space: the same position, the same right axis) and the frame is moved
// down on the sensor by the shift. P · R is still a projective matrix, so picking (its inverse), the frustum's culling
// and everything drawn over the picture follow it unchanged.

import * as THREE from 'three';
import { SENSOR_MM } from '../core/camera';

/** Where the output frame sits in the view (CSS pixels) and the view's size. */
export interface ProjectionFrame {
  /** Width and height of the view (the canvas), CSS pixels. */
  viewW: number;
  viewH: number;
  /** The output frame inside it (core/camera.ts `outputFrameRect`). */
  frameW: number;
  frameH: number;
  /** Width over height of the output image. */
  outAspect: number;
}

/**
 * The lens shift as offsets of the projection's centre in normalised device coordinates: millimetres of the 36 mm
 * sensor over half the frame's size on it, scaled from the frame to the view.
 */
export function shiftNdc(shiftXMm: number, shiftYMm: number, f: ProjectionFrame): [number, number] {
  const frameMmW = f.outAspect >= 1 ? SENSOR_MM : SENSOR_MM * f.outAspect;
  const frameMmH = f.outAspect >= 1 ? SENSOR_MM / f.outAspect : SENSOR_MM;
  const kx = f.viewW / Math.max(1, f.frameW);
  const ky = f.viewH / Math.max(1, f.frameH);
  return [shiftXMm / ((frameMmW / 2) * kx), shiftYMm / ((frameMmH / 2) * ky)];
}

/**
 * The projection matrix of a perspective camera of vertical field `fovDeg` over a view of `aspect` (width / height),
 * `near` to `far`, its centre moved by `shift` (NDC), and its view space first turned up by `levelDeg` about the right
 * axis (the straight verticals: the corrected tilt of a camera looking down; 0 leaves it as it is).
 */
export function perspectiveProjection(fovDeg: number, aspect: number, near: number, far: number, shift: readonly [number, number], levelDeg: number, out: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  const top = near * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  const height = 2 * top;
  const width = aspect * height;
  out.makePerspective(-width / 2, width / 2, top, top - height, near, far);
  const e = out.elements;
  e[8] = shift[0];
  e[9] = shift[1];
  if (levelDeg !== 0) out.multiply(new THREE.Matrix4().makeRotationX(-THREE.MathUtils.degToRad(levelDeg)));
  return out;
}

/** The elevation of a three.js camera's view (degrees above the horizon, Y up): positive looking up. */
export function viewElevation(camera: THREE.Camera): number {
  const d = camera.getWorldDirection(new THREE.Vector3());
  return THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, d.y))));
}

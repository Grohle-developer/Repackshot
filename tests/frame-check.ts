// What the camera's frame sees (L6): the camera that frames a product the way Create studio does (the reference view,
// the product type's focal length, the output's aspect), and whether a flat polygon (a set's card) enters that frame.

import { cameraBasis, cameraPosition, fieldOfView, frameBox, makeCamera, type CameraState } from '../src/core/camera';
import { CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG } from '../src/data/light-setups';
import { add, dot, normalize, scale, sub, type Box, type Vec3 } from '../src/core/math';

/** The camera Create studio leaves: reference azimuth, `el` (default the reference), `focal`, the product framed. */
export function framedCamera(box: Box, focal: number, aspect: number, el = CAMERA_ELEVATION_DEG): CameraState {
  const cam = { ...makeCamera('c', '', 200), azimuth: CAMERA_AZIMUTH_DEG, elevation: el, focalMm: focal };
  return frameBox(cam, box, aspect);
}

/** The part of a polygon (world points) inside the camera's frame, in camera space; empty when it is out of frame. */
export function inFrame(cam: CameraState, aspect: number, polygon: readonly Vec3[]): number[][] {
  const eye = cameraPosition(cam);
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const fov = fieldOfView(cam.focalMm, aspect);
  const tx = Math.tan(fov.h / 2);
  const ty = Math.tan(fov.v / 2);
  let poly = polygon.map((p) => {
    const d = sub(p, eye);
    return [dot(d, right), dot(d, up), dot(d, forward)];
  });
  const planes: ((p: number[]) => number)[] = [
    (p) => p[2] - 1e-6,
    (p) => p[2] * tx - p[0],
    (p) => p[2] * tx + p[0],
    (p) => p[2] * ty - p[1],
    (p) => p[2] * ty + p[1],
  ];
  for (const f of planes) {
    const out: number[][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const fa = f(a);
      const fb = f(b);
      if (fa >= 0) out.push(a);
      if (fa >= 0 !== fb >= 0) {
        const t = fa / (fa - fb);
        out.push(a.map((v, k) => v + (b[k] - v) * t));
      }
    }
    poly = out;
    if (poly.length === 0) break;
  }
  // A sliver along an edge of the frame is not in it.
  if (poly.length < 3) return [];
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += (a[0] / a[2]) * (b[1] / b[2]) - (b[0] / b[2]) * (a[1] / a[2]);
  }
  return Math.abs(area) / 2 > 1e-9 ? poly : [];
}

/** The screen rectangle (camera space x/z and y/z) a box covers, for a camera. */
export function screenRect(cam: CameraState, box: Box): { x0: number; x1: number; y0: number; y1: number } {
  const eye = cameraPosition(cam);
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c: Vec3 = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
    const d = sub(c, eye);
    const z = dot(d, forward);
    const x = dot(d, right) / z;
    const y = dot(d, up) / z;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}

/** A polygon mirrored in the floor plane z = `floorZ`. */
export function mirrored(polygon: readonly Vec3[], floorZ = 0): Vec3[] {
  return polygon.map((p) => [p[0], p[1], 2 * floorZ - p[2]] as Vec3);
}

/**
 * Where the reflection of a polygon in the floor (z = `floorZ`) shows in the frame in front of the product: the points of
 * its mirror image inside the frame whose reflection on the floor is not behind the product's footprint (farther from
 * the camera, along its ground direction, than the farthest point of the product's box). Empty: the reflection is out
 * of the frame or behind the product. The part of the mirror image in the frame is convex and "behind" is a half-plane
 * of the floor, so its corners decide.
 */
export function reflectionSeen(cam: CameraState, aspect: number, polygon: readonly Vec3[], product: Box, floorZ = 0): Vec3[] {
  const eye = cameraPosition(cam);
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const ground = normalize([forward[0], forward[1], 0]);
  let far = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c: Vec3 = [i & 1 ? product.max[0] : product.min[0], i & 2 ? product.max[1] : product.min[1], i & 4 ? product.max[2] : product.min[2]];
    far = Math.max(far, dot(sub(c, eye), ground));
  }
  const seen = inFrame(cam, aspect, mirrored(polygon, floorZ));
  const out: Vec3[] = [];
  for (const [x, y, z] of seen) {
    const p: Vec3 = [eye[0] + x * right[0] + y * up[0] + z * forward[0], eye[1] + x * right[1] + y * up[1] + z * forward[1], eye[2] + x * right[2] + y * up[2] + z * forward[2]];
    // Where the camera's ray to the mirror image meets the floor: where the reflection is.
    const t = (eye[2] - floorZ) / (eye[2] - p[2]);
    const r = sub(add(eye, scale(sub(p, eye), t)), eye);
    if (dot(r, ground) <= far) out.push(add(eye, r));
  }
  return out;
}

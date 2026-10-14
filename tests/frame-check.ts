// What the camera's frame sees (L6): the camera that frames a product the way Create studio does (the reference view,
// the product type's focal length, the output's aspect), and whether a flat polygon (a set's card) enters that frame.

import { cameraBasis, cameraPosition, fieldOfView, frameBox, makeCamera, type CameraState } from '../src/core/camera';
import { CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG } from '../src/data/light-setups';
import { dot, sub, type Box, type Vec3 } from '../src/core/math';

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

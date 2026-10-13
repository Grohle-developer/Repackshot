// The passes as the engine's rules give them, by ray casting on the CPU (phase X4): the engine's camera
// (`rt_core::scene::Camera::generate_ray`: the sensor 36 mm along the longer side, one ray through the pixel
// centre, the lens centre for the passes), the instances of `projectScene` with their transforms, and
// double-sided triangles. The reference for the passes the preview draws with three.js. X3c: the studio floor
// too (`FLOR`, visible or a shadow catcher): FLOOR_ID in both ids where it is the nearest, its normal turned to
// the ray, its colour as the albedo.

import { projectScene } from '../../src/io/rsb';
import { FLOOR_ID, type RenderPasses } from '../../src/core/passes';
import { FLOOR_NONE } from '../../src/io/rsb';
import type { ProjectState } from '../../src/core/store';

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function referencePasses(state: ProjectState, width: number, height: number): RenderPasses {
  const { scene } = projectScene(state, { width, height, maxSamples: 1, maxSeconds: 0 });
  const cam = scene.camera;
  const forward = norm(sub(cam.target, cam.position));
  const right = norm(cross(forward, cam.up));
  const up = cross(right, forward);
  const aspect = width / height;
  const [sw, sh] = aspect >= 1 ? [cam.sensorMm, cam.sensorMm / aspect] : [cam.sensorMm * aspect, cam.sensorMm];

  // World triangles of every instance.
  const tris: { a: V; b: V; c: V; instance: number }[] = [];
  scene.instances!.forEach((inst, k) => {
    const mesh = scene.meshes[inst.mesh];
    const m = inst.transform;
    const at = (i: number): V => {
      const x = mesh.positions[i * 3];
      const y = mesh.positions[i * 3 + 1];
      const z = mesh.positions[i * 3 + 2];
      return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
    };
    for (let t = 0; t < mesh.indices.length; t += 3) tris.push({ a: at(mesh.indices[t]), b: at(mesh.indices[t + 1]), c: at(mesh.indices[t + 2]), instance: k });
  });

  const n = width * height;
  const out: RenderPasses = {
    width,
    height,
    albedo: new Float32Array(n * 3),
    normal: new Float32Array(n * 3),
    depth: new Float32Array(n).fill(Infinity),
    partId: new Uint32Array(n),
    materialId: new Uint32Array(n),
  };
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = ((px + 0.5) / width - 0.5) * sw;
      const y = (0.5 - (py + 0.5) / height) * sh;
      const dir = norm([forward[0] * cam.focalMm + right[0] * x + up[0] * y, forward[1] * cam.focalMm + right[1] * x + up[1] * y, forward[2] * cam.focalMm + right[2] * x + up[2] * y]);
      let best = Infinity;
      let hit: { instance: number; normal: V } | null = null;
      for (const tri of tris) {
        const e1 = sub(tri.b, tri.a);
        const e2 = sub(tri.c, tri.a);
        const p = cross(dir, e2);
        const det = dot(e1, p);
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const s = sub(cam.position, tri.a);
        const u = dot(s, p) * inv;
        if (u < 0 || u > 1) continue;
        const q = cross(s, e1);
        const v = dot(dir, q) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = dot(e2, q) * inv;
        if (t > 1e-6 && t < best) {
          best = t;
          let nrm = norm(cross(e1, e2));
          if (dot(nrm, dir) > 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
          hit = { instance: tri.instance, normal: nrm };
        }
      }
      const o = py * width + px;
      if (scene.floor.mode !== FLOOR_NONE && dir[2] !== 0) {
        const t = (scene.floor.z - cam.position[2]) / dir[2];
        if (t > 1e-3 && t < best) {
          out.partId![o] = FLOOR_ID;
          out.materialId![o] = FLOOR_ID;
          out.depth![o] = t * dot(dir, forward);
          out.normal!.set([0, 0, dir[2] < 0 ? 1 : -1], o * 3);
          out.albedo!.set(scene.floor.color, o * 3);
          continue;
        }
      }
      if (!hit) continue;
      const inst = scene.instances![hit.instance];
      out.partId![o] = hit.instance + 1;
      out.materialId![o] = inst.materialId + 1;
      out.depth![o] = best * dot(dir, forward);
      out.normal!.set(hit.normal, o * 3);
      out.albedo!.set(scene.materials[inst.materialId].baseColor, o * 3);
    }
  }
  return out;
}

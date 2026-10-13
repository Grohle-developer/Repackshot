// RSB writer (phase E4): byte parity with the engine's own writer, round trip of every section,
// and the mapping of a project onto the engine's scene.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeCamera, cameraPosition, outputFrameRect, type CameraState } from '../src/core/camera';
import { polar, toWorldAzimuth } from '../src/core/light-math';
import { lightPosition, rigPivot } from '../src/core/lighting';
import { getMesh } from '../src/core/meshes';
import { areaLightFlux, areaLightRadiance, EMIT_RADIANCE_PER_WATT } from '../src/core/photometry';
import { allParts, worldMatrix } from '../src/core/scene';
import type { ProjectState } from '../src/core/store';
import { DOME_FLOOR, DOME_HORIZON, DOME_ZENITH } from '../src/data/environment';
import {
  BACKGROUND_COLOR,
  BACKGROUND_ENVIRONMENT,
  BACKGROUND_TRANSPARENT,
  cameraToRsb,
  defaultCamera,
  defaultEnvironment,
  defaultFloor,
  defaultLight,
  defaultMaterial,
  defaultRender,
  ENV_FLAT,
  ENV_STUDIO,
  FLOOR_NONE,
  FLOOR_SHADOW_CATCHER,
  IDENTITY_ROWS,
  implicitInstances,
  LIGHT_DISK,
  LIGHT_FLAG_CAMERA,
  LIGHT_FLAG_GLOSSY,
  LIGHT_RECT,
  LIGHT_SUN,
  MATERIAL_EMISSIVE,
  MATERIAL_FLAG_LIGHT,
  MATERIAL_GLASS,
  MATERIAL_PRINCIPLED,
  matrixRows,
  projectScene,
  TONEMAP_AGX,
  TONEMAP_FILMIC,
  TONEMAP_STANDARD,
  writeRsb,
  type RsbMesh,
  type RsbScene,
  type RsbVec,
  type SceneView,
} from '../src/io/rsb';
import { apply, exampleState, keyIds } from './helpers';
import { asF32, readRsb, sections } from './rsb-reader';

// ------------------------------------------------------------------ the engine's example in f32

const f = Math.fround;
type V = [number, number, number];
const vadd = (a: V, b: V): V => [f(a[0] + b[0]), f(a[1] + b[1]), f(a[2] + b[2])];
const vsub = (a: V, b: V): V => [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
const vmul = (a: V, s: number): V => [f(a[0] * s), f(a[1] * s), f(a[2] * s)];
// Rust: x * x + y * y + z * z, left to right, every step rounded to f32; sqrt correctly rounded.
const vlen = (a: V): number => f(Math.sqrt(f(f(f(a[0] * a[0]) + f(a[1] * a[1])) + f(a[2] * a[2]))));
const vnorm = (a: V): V => {
  const l = vlen(a);
  return l > 0 && Number.isFinite(l) ? [f(a[0] / l), f(a[1] / l), f(a[2] / l)] : a;
};

/** rt_core::example::icosphere, operation for operation. */
function icosphere(center: V, radius: number, subdivisions: number): RsbMesh {
  const t = f(f(1 + f(Math.sqrt(5))) / 2);
  const base: [number, number, number][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const dirs: V[] = base.map((p) => vnorm(p));
  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const mids = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      let i = mids.get(key);
      if (i === undefined) {
        dirs.push(vnorm(vadd(dirs[a], dirs[b])));
        i = dirs.length - 1;
        mids.set(key, i);
      }
      return i;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const positions = dirs.flatMap((d) => vadd(center, vmul(d, radius)));
  return { positions, normals: dirs.flat(), indices: faces.flat(), materialId: 0 };
}

/** rt_core::example::scene(), built from TypeScript. */
function engineExample(): RsbScene {
  const lightPos: V = [250, -450, 650];
  const camPos: V = [560, -900, 400];
  const target: V = [0, 0, 90];
  return {
    camera: { position: camPos, target, up: [0, 0, 1], focalMm: 85, sensorMm: 36, fstop: 11, focusDist: vlen(vsub(target, camPos)), ortho: false, orthoWidth: 600 },
    materials: [
      { ...defaultMaterial(), baseColor: [0.92, 0.38, 0.22], roughness: 0.35 },
      { ...defaultMaterial(), baseColor: [0.3, 0.3, 0.32], roughness: 0.8 },
      { ...defaultMaterial(), baseColor: [0.2, 0.42, 0.85], roughness: 0.25 },
    ],
    meshes: [
      icosphere([0, 0, 100], 100, 2),
      {
        positions: [-900, -900, 0, 900, -900, 0, 900, 900, 0, -900, 900, 0],
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        indices: [0, 1, 2, 0, 2, 3],
        materialId: 1,
      },
    ],
    instances: [
      { mesh: 0, transform: [...IDENTITY_ROWS], materialId: 0, flags: 0 },
      { mesh: 1, transform: [...IDENTITY_ROWS], materialId: 1, flags: 0 },
      { mesh: 0, transform: [0.5, 0, 0, -330, 0, 0.5, 0, 120, 0, 0, 0.5, 0], materialId: 2, flags: 0 },
    ],
    lights: [
      { kind: LIGHT_RECT, position: lightPos, direction: vnorm(vsub(target, lightPos)), up: [0, 0, 1], sizeX: 400, sizeY: 400, color: [1, 1, 1], power: 5, spreadDeg: 180, angleDeg: 0, flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA },
    ],
    environment: { kind: ENV_STUDIO, floor: 0.05, horizon: 0.12, zenith: 0.3, strength: 1, rotationDeg: 0, backgroundColor: [0.05, 0.05, 0.05], backgroundMode: 0 },
    floor: defaultFloor(),
    render: { width: 512, height: 384, maxSamples: 16, seed: 1, maxSeconds: 0, exposureEv: 0, tonemap: 1, maxDepth: 8, clampIndirect: 0 },
  };
}

/** Every field away from its default, like rt-core's `full_scene` test. */
function fullScene(): RsbScene {
  return {
    camera: { position: [10, -200, 50], target: [1, 2, 3], up: [0, 0, 1], focalMm: 85, sensorMm: 36, fstop: 5.6, focusDist: 212.5, ortho: true, orthoWidth: 320 },
    materials: [
      defaultMaterial(),
      { kind: 2, baseColor: [0.9, 0.5, 0.1], metallic: 1, roughness: 0.2, ior: 1.33, transmission: 0.25, coat: 0.5, coatRoughness: 0.05, emission: [1, 0.9, 0.8], emissionPower: 12, flags: 1 },
    ],
    meshes: [
      { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 2, 1, 3], materialId: 1 },
      { positions: [5, 5, 5, 5, 5, 5, 5, 5, 5], normals: [], indices: [0, 1, 2], materialId: 0 },
    ],
    instances: [
      { mesh: 0, transform: [...IDENTITY_ROWS], materialId: 1, flags: 0 },
      { mesh: 0, transform: [0, -1, 0, 10, 2, 0, 0, -5, 0, 0, 0.5, 1.25], materialId: 0, flags: 1 },
      { mesh: 1, transform: [1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3], materialId: 1, flags: 0 },
    ],
    lights: [
      defaultLight(),
      { kind: 2, position: [1, 2, 3], direction: [0.3, 0.2, -0.9], up: [0, 1, 0], sizeX: 10, sizeY: 20, color: [1, 0.95, 0.9], power: 3.5, spreadDeg: 45, angleDeg: 0.53, flags: 3 },
      { ...defaultLight(), kind: 1, flags: 0 },
    ],
    environment: { kind: 1, floor: 0.2, horizon: 0.4, zenith: 0.8, strength: 1.5, rotationDeg: 90, backgroundColor: [0.1, 0.2, 0.3], backgroundMode: 1 },
    floor: { mode: 2, z: -12.5, color: [0.4, 0.5, 0.6] },
    render: { width: 1920, height: 1080, maxSamples: 256, seed: 77, maxSeconds: 12.5, exposureEv: -0.5, tonemap: 3, maxDepth: 12, clampIndirect: 10 },
  };
}

const fixture = new Uint8Array(readFileSync('tests/fixtures/example.rsb'));

function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

describe('RSB writer: byte parity with rt-core', () => {
  it('writes the engine example exactly as `rt --write-example` does', () => {
    const bytes = writeRsb(engineExample());
    expect(bytes.length).toBe(fixture.length);
    expect(firstDiff(bytes, fixture)).toBe(-1);
  });

  it('writes sections in the order and sizes of rt-core', () => {
    const bytes = writeRsb(fullScene());
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RSB1');
    expect([...bytes.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    const s = sections(bytes);
    expect(s.map((x) => x.tag)).toEqual(['CAMR', 'MATL', 'MATL', 'MESH', 'MESH', 'INST', 'INST', 'INST', 'LGHT', 'LGHT', 'LGHT', 'ENVR', 'FLOR', 'RNDR']);
    const size = (tag: string) => s.find((x) => x.tag === tag)!.payload.byteLength;
    expect([size('CAMR'), size('MATL'), size('LGHT'), size('ENVR'), size('FLOR'), size('RNDR'), size('INST')]).toEqual([60, 60, 76, 40, 20, 36, 60]);
    // 4 vertices, 6 indices: 2 + 4 * 6 + 6 + 1 words.
    expect(s[3].payload.byteLength).toBe((2 + 24 + 6 + 1) * 4);
  });

  it('leaves INST out when the instances are the implicit ones, like rt-core', () => {
    const scene = fullScene();
    scene.instances = scene.meshes.map((m, i) => ({ mesh: i, transform: [...IDENTITY_ROWS], materialId: m.materialId, flags: 0 }));
    expect(sections(writeRsb(scene)).some((x) => x.tag === 'INST')).toBe(false);
    scene.instances = null;
    expect(sections(writeRsb(scene)).some((x) => x.tag === 'INST')).toBe(false);
  });

  it('writes an update without meshes and always with its instances', () => {
    const scene = fullScene();
    scene.instances = null;
    const update = writeRsb(scene, { meshes: false });
    const tags = sections(update).map((x) => x.tag);
    expect(tags.includes('MESH')).toBe(false);
    expect(tags.filter((t) => t === 'INST')).toHaveLength(2);
    expect(update.length).toBeLessThan(writeRsb(scene).length);
  });
});

describe('RSB writer: round trip of every section', () => {
  for (const [name, build] of [
    ['the engine example', engineExample],
    ['a scene with every field set', fullScene],
  ] as const) {
    it(name, () => {
      const scene = build();
      const back = readRsb(writeRsb(scene));
      expect(back.camera).toEqual(asF32(scene.camera));
      expect(back.materials).toEqual(asF32(scene.materials));
      expect(back.lights).toEqual(asF32(scene.lights));
      expect(back.environment).toEqual(asF32(scene.environment));
      expect(back.floor).toEqual(asF32(scene.floor));
      expect(back.render).toEqual(asF32(scene.render));
      expect(back.instances).toEqual(asF32(scene.instances));
      expect(back.meshes.length).toBe(scene.meshes.length);
      back.meshes.forEach((m, i) => {
        const src = scene.meshes[i];
        expect(Array.from(m.positions)).toEqual(asF32(Array.from(src.positions)));
        // A mesh without normals is written with zero normals (what rt-core writes back too).
        expect(Array.from(m.normals)).toEqual(src.normals.length ? asF32(Array.from(src.normals)) : new Array(src.positions.length).fill(0));
        expect(Array.from(m.indices)).toEqual(Array.from(src.indices));
        expect(m.materialId).toBe(src.materialId);
      });
    });
  }

  it('reads back the defaults of rt-core', () => {
    const scene: RsbScene = { camera: defaultCamera(), materials: [], meshes: [], instances: null, lights: [], environment: defaultEnvironment(), floor: defaultFloor(), render: defaultRender() };
    const back = readRsb(writeRsb(scene));
    expect(back.tags).toEqual(['CAMR', 'ENVR', 'FLOR', 'RNDR']);
    expect(back.render).toEqual(asF32(defaultRender()));
  });
});

// ------------------------------------------------------------------ project mapping

const view = (s: ProjectState, extra: Partial<SceneView> = {}): SceneView => ({ width: s.render.width, height: s.render.height, maxSamples: s.render.maxSamples, maxSeconds: s.render.maxSeconds, ...extra });

/** The engine's camera ray through image point (u, v) (rt-core Camera::generate_ray, pinhole). */
function rayDir(c: ReturnType<typeof cameraToRsb>, aspect: number, u: number, v: number): RsbVec {
  const sub3 = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a: number[]) => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const fwd = norm(sub3(c.target, c.position));
  const right = norm(cross(fwd, c.up));
  const up = cross(right, fwd);
  const [sw, sh] = aspect >= 1 ? [c.sensorMm, c.sensorMm / aspect] : [c.sensorMm * aspect, c.sensorMm];
  const x = (u - 0.5) * sw;
  const y = (0.5 - v) * sh;
  return norm([0, 1, 2].map((k) => fwd[k] * c.focalMm + right[k] * x + up[k] * y)) as RsbVec;
}

describe('project to RSB: camera', () => {
  const s = exampleState();
  const cam = activeCamera(s);

  it('renders the output frame through the active camera on the 36 mm sensor', () => {
    const { scene } = projectScene(s, view(s));
    expect(scene.camera.position).toEqual(cameraPosition(cam));
    expect(scene.camera.target).toEqual(cam.target);
    expect(scene.camera.up).toEqual([0, 0, 1]);
    expect(scene.camera.focalMm).toBe(cam.focalMm);
    expect(scene.camera.sensorMm).toBe(36);
    expect(scene.camera.fstop).toBe(cam.fstop);
    expect(scene.camera.focusDist).toBe(cam.focusDistance);
    expect(scene.camera.ortho).toBe(false);
    expect([scene.render.width, scene.render.height]).toEqual([1920, 1080]);
  });

  it('in the viewport, the output frame inset sees exactly what the output image sees', () => {
    for (const [vw, vh, ow, oh] of [
      [1000, 700, 1920, 1080],
      [700, 1000, 1920, 1080],
      [1000, 700, 1080, 1350],
      [640, 640, 2048, 2048],
    ]) {
      const st: ProjectState = { ...s, render: { ...s.render, width: ow, height: oh } };
      const out = cameraToRsb(cam, ow, oh, ow, oh);
      // The viewport image at half the CSS size, as during a gesture.
      const w = Math.round(vw / 2);
      const h = Math.round(vh / 2);
      const vp = projectScene(st, view(st, { width: w, height: h, viewport: { viewW: vw, viewH: vh } })).scene.camera;
      const r = outputFrameRect(vw, vh, ow, oh);
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [0.5, 0.5],
        [0.25, 1],
      ]) {
        const inView: [number, number] = [(r.x + u * r.width) / vw, (r.y + v * r.height) / vh];
        const a = rayDir(out, ow / oh, u, v);
        const b = rayDir(vp, w / h, inView[0], inView[1]);
        for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k], 2);
      }
    }
  });

  it('follows a gesture patch and the orthographic width', () => {
    const patch: Partial<CameraState> = { azimuth: cam.azimuth + 40, elevation: 10, distance: cam.distance * 1.5 };
    const { scene } = projectScene(s, view(s, { cameraPatch: patch }));
    expect(scene.camera.position).toEqual(cameraPosition({ ...cam, ...patch }));
    const ortho = apply(s, { type: 'camera/set', id: cam.id, patch: { projection: 'ORTHOGRAPHIC', orthoWidth: 300 } });
    const vp = projectScene(ortho, view(ortho, { width: 500, height: 350, viewport: { viewW: 1000, viewH: 700 } })).scene.camera;
    const r = outputFrameRect(1000, 700, ortho.render.width, ortho.render.height);
    expect(vp.ortho).toBe(true);
    expect(vp.orthoWidth).toBeCloseTo((300 * 1000) / r.width, 6);
    expect(projectScene(ortho, view(ortho)).scene.camera.orthoWidth).toBe(300);
  });
});

describe('project to RSB: lights', () => {
  const s = exampleState();

  it('places every enabled light of the rig like the preview and converts its power', () => {
    const { scene } = projectScene(s, view(s));
    const enabled = s.studio.lights.filter((l) => l.enabled && l.power > 0);
    expect(scene.lights).toHaveLength(enabled.length);
    const pivot = rigPivot(s);
    enabled.forEach((l, i) => {
      const r = scene.lights[i];
      const pos = lightPosition(s, l);
      expect(r.position).toEqual(pos);
      expect(pos).toEqual(pivot.map((p, k) => p + polar(toWorldAzimuth(l.az), l.el, l.dist * s.scene.partSizeMm)[k]));
      // Aimed at the pivot.
      const d = [pivot[0] - pos[0], pivot[1] - pos[1], pivot[2] - pos[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      for (let k = 0; k < 3; k++) expect(r.direction[k]).toBeCloseTo(d[k] / len, 9);
      expect(r.flags).toBe((l.glossy ? LIGHT_FLAG_GLOSSY : 0) | (l.camera ? LIGHT_FLAG_CAMERA : 0));
      if (l.type === 'SUN') {
        expect(r.kind).toBe(LIGHT_SUN);
        expect(r.power).toBe(l.power);
      } else {
        expect(r.power).toBeCloseTo((l.power * (s.scene.partSizeMm / 1000) ** 2) / 4, 12);
        expect(r.sizeX).toBeCloseTo(l.size * s.scene.partSizeMm, 9);
      }
    });
  });

  it('the flux gives the irradiance the rig promises, on axis and far away', () => {
    // A 1 cm panel 2 m away, part size 200 mm: E = F / (pi d^2) must equal power / (4 pi dist^2).
    const power = 30;
    const partMm = 200;
    const dist = 10; // part sizes = 2 m
    const flux = areaLightFlux(power, partMm);
    const d = (dist * partMm) / 1000;
    expect(flux / (Math.PI * d * d)).toBeCloseTo(power / (4 * Math.PI * dist * dist), 12);
    // The radiance the preview uses is the engine's F / (pi A), independent of the part size.
    const areaPs = 0.3 * 0.2;
    const areaM2 = areaPs * (partMm / 1000) ** 2;
    expect(areaLightRadiance(power, areaPs)).toBeCloseTo(flux / (Math.PI * areaM2), 9);
  });

  it('leaves out lights that are off, and maps disks, ellipses and suns', () => {
    const l0 = s.studio.lights[0];
    const off = apply(s, { type: 'studio/setLight', id: l0.id, patch: { enabled: false } });
    expect(projectScene(off, view(off)).scene.lights).toHaveLength(projectScene(s, view(s)).scene.lights.length - 1);
    const disk = apply(s, { type: 'studio/setLight', id: l0.id, patch: { shape: 'DISK', size: 0.5 } });
    const dl = projectScene(disk, view(disk)).scene.lights[0];
    expect(dl.kind).toBe(LIGHT_DISK);
    expect(dl.sizeX).toBeCloseTo(0.5 * s.scene.partSizeMm, 9);
    const ell = apply(s, { type: 'studio/setLight', id: l0.id, patch: { shape: 'ELLIPSE', size: 0.8, sizeY: 0.2 } });
    const el = projectScene(ell, view(ell)).scene.lights[0];
    // Same area as the ellipse: pi/4 w h = pi/4 d^2.
    expect(el.kind).toBe(LIGHT_DISK);
    expect(el.sizeX ** 2).toBeCloseTo(0.8 * 0.2 * s.scene.partSizeMm ** 2, 6);
    const sun = apply(s, { type: 'studio/setLight', id: l0.id, patch: { type: 'SUN', power: 3, angle: 0.545 } });
    const sl = projectScene(sun, view(sun)).scene.lights[0];
    expect(sl.kind).toBe(LIGHT_SUN);
    expect(sl.power).toBe(3);
    // Degrees in, degrees out: the real sun is about half a degree wide, not 31 degrees.
    expect(sl.angleDeg).toBeCloseTo(0.545, 9);
  });

  it('the catalogue SUN setup reaches the engine as a half-degree sun', () => {
    const s = apply(exampleState(), { type: 'studio/setSetup', key: 'SUN' });
    const suns = projectScene(s, view(s)).scene.lights.filter((l) => l.kind === LIGHT_SUN);
    expect(suns.length).toBeGreaterThan(0);
    for (const l of suns) {
      expect(l.angleDeg).toBeGreaterThan(0.4);
      expect(l.angleDeg).toBeLessThan(1);
    }
  });
});

describe('project to RSB: geometry and materials', () => {
  const s = exampleState();
  const ids = keyIds(s);

  it('one instance per visible part with its world matrix, meshes shared', () => {
    const { scene, meshKey } = projectScene(s, view(s));
    const parts = allParts(s);
    expect(scene.instances).toHaveLength(parts.length);
    expect(scene.meshes).toHaveLength(parts.length);
    parts.forEach((p, i) => {
      expect(scene.instances![i].transform).toEqual(matrixRows(worldMatrix(s, p)));
      const node = s.scene.nodes[p];
      const data = getMesh(node.mesh!.id)!;
      expect(scene.meshes[scene.instances![i].mesh].positions).toBe(data.positions);
      expect(scene.meshes[scene.instances![i].mesh].normals).toBe(data.normals);
    });
    expect(meshKey.split(';')).toHaveLength(parts.length);

    // Hidden parts are not drawn; a hidden group hides its parts.
    const hidden = apply(s, { type: 'scene/setVisible', ids: [ids.closure], visible: false });
    const h = projectScene(hidden, view(hidden)).scene;
    expect(h.instances!.length).toBe(parts.length - 2);

    // A moved part: its translation in the rows.
    const moved = apply(s, { type: 'scene/setTransform', id: ids.cap, transform: { position: [5, 6, 7] } });
    const m = projectScene(moved, view(moved)).scene;
    const cap = allParts(moved).indexOf(ids.cap);
    expect(m.instances![cap].transform).toEqual(matrixRows(worldMatrix(moved, ids.cap)));

    // A linked duplicate shares the mesh.
    const dup = apply(s, { type: 'scene/duplicate', ids: [ids.cap], linked: true });
    const d = projectScene(dup, view(dup)).scene;
    expect(d.instances).toHaveLength(parts.length + 1);
    expect(d.meshes).toHaveLength(parts.length);
  });

  it('keeps the mesh key when only materials, lights or the camera change', () => {
    const base = projectScene(s, view(s)).meshKey;
    const mat = s.scene.nodes[ids.body].material!;
    const edited = apply(
      s,
      { type: 'material/setParam', id: mat, key: 'roughness', value: 0.9 },
      { type: 'studio/setLight', id: s.studio.lights[0].id, patch: { power: 5 } },
      { type: 'camera/set', id: activeCamera(s).id, patch: { azimuth: 10 } },
    );
    expect(projectScene(edited, view(edited)).meshKey).toBe(base);
    const flat = apply(s, { type: 'scene/setSmooth', ids: [ids.body], smooth: false });
    expect(projectScene(flat, view(flat)).meshKey).not.toBe(base);
  });

  it('flat shading writes zero normals', () => {
    const flat = apply(s, { type: 'scene/setSmooth', ids: [ids.body], smooth: false });
    const { scene } = projectScene(flat, view(flat));
    const body = allParts(flat).indexOf(ids.body);
    const mesh = scene.meshes[scene.instances![body].mesh];
    expect(mesh.normals.length).toBe(0);
    const back = readRsb(writeRsb(scene));
    expect(Array.from(back.meshes[scene.instances![body].mesh].normals).every((v) => v === 0)).toBe(true);
  });

  it('splits a part with face materials into one mesh per material', () => {
    const tris = s.scene.nodes[ids.body].mesh!.triangles;
    const faced = apply(s, { type: 'material/assign', preset: 'GOLD', targets: [ids.body], faces: { part: ids.body, indices: [0, 1, 2, tris - 1] }, mode: 'REPLACE' });
    const { scene } = projectScene(faced, view(faced));
    expect(scene.instances).toHaveLength(allParts(faced).length + 1);
    const node = faced.scene.nodes[ids.body];
    const gold = node.faceMaterials![0].material;
    const counts = scene.instances!.map((i) => scene.meshes[i.mesh].indices.length / 3);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(allParts(faced).reduce((n, p) => n + faced.scene.nodes[p].mesh!.triangles, 0));
    const goldIndex = scene.materials.findIndex((m) => m.metallic === 1 && m.baseColor[0] > m.baseColor[2]);
    expect(goldIndex).toBeGreaterThanOrEqual(0);
    expect(scene.instances!.some((i) => i.materialId === goldIndex && scene.meshes[i.mesh].indices.length === 12)).toBe(true);
    expect(gold).toBeTruthy();
  });

  it('maps every material family to the E3 semantics', () => {
    const body = s.scene.nodes[ids.body].material!;
    const cap = s.scene.nodes[ids.cap].material!;
    const { scene } = projectScene(s, view(s));
    const parts = allParts(s);
    const matOf = (id: string) => scene.materials[scene.instances![parts.indexOf(id)].materialId];
    const capMat = matOf(ids.cap);
    expect(capMat.kind).toBe(MATERIAL_PRINCIPLED);
    expect(capMat.metallic).toBe(s.materials[cap].params.metallic);
    expect(capMat.roughness).toBe(s.materials[cap].params.roughness);
    expect(capMat.baseColor).toEqual((s.materials[cap].params.baseColor as unknown as number[]).slice(0, 3));
    expect(matOf(ids.body).coat).toBe(s.materials[body].params.coat ?? 0);

    const glass = apply(s, { type: 'material/assign', preset: 'GLASS_CLEAR', targets: [ids.body], mode: 'REPLACE' });
    const g = projectScene(glass, view(glass)).scene;
    expect(g.materials[g.instances![parts.indexOf(ids.body)].materialId].kind).toBe(MATERIAL_GLASS);

    const lamp = apply(s, { type: 'material/assign', preset: 'NEON_RED', targets: [ids.cap], mode: 'REPLACE' });
    const e = projectScene(lamp, view(lamp)).scene;
    const em = e.materials[e.instances![parts.indexOf(ids.cap)].materialId];
    const inst = lamp.materials[lamp.scene.nodes[ids.cap].material!];
    expect(em.kind).toBe(MATERIAL_EMISSIVE);
    expect(em.flags).toBe(MATERIAL_FLAG_LIGHT);
    expect(em.emissionPower).toBeCloseTo((inst.params.emitPower as number) * EMIT_RADIANCE_PER_WATT, 12);
  });
});

describe('project to RSB: environment, floor and render settings', () => {
  const s = exampleState();

  it('the studio dome times the strength, the background modes and transparency', () => {
    const dome = apply(s, { type: 'env/set', patch: { kind: 'STUDIO', background: 'ENVIRONMENT', strength: 0.75 } });
    const { scene } = projectScene(dome, view(dome));
    expect(scene.environment.kind).toBe(ENV_STUDIO);
    expect([scene.environment.floor, scene.environment.horizon, scene.environment.zenith]).toEqual([DOME_FLOOR, DOME_HORIZON, DOME_ZENITH]);
    expect(scene.environment.strength).toBe(0.75);
    expect(scene.environment.backgroundMode).toBe(BACKGROUND_ENVIRONMENT);
    expect(projectScene(dome, view(dome, { transparent: true })).scene.environment.backgroundMode).toBe(BACKGROUND_TRANSPARENT);
    const color = apply(s, { type: 'env/set', patch: { background: 'COLOR', color: [0.2, 0.4, 0.6, 1] } });
    const c = projectScene(color, view(color)).scene.environment;
    expect(c.backgroundMode).toBe(BACKGROUND_COLOR);
    expect(c.backgroundColor).toEqual([0.2, 0.4, 0.6]);
    const flat = apply(s, { type: 'env/set', patch: { kind: 'FLAT', color: [0.5, 0.5, 0.5, 1] } });
    const fl = projectScene(flat, view(flat)).scene.environment;
    expect(fl.kind).toBe(ENV_FLAT);
    expect(fl.horizon).toBeCloseTo(0.5, 9);
  });

  it('a shadow catcher when the floor and its shadow are on, nothing otherwise', () => {
    expect(projectScene(s, view(s)).scene.floor.mode).toBe(s.studio.floor && s.studio.shadow ? FLOOR_SHADOW_CATCHER : FLOOR_NONE);
    const on = apply(s, { type: 'studio/set', patch: { floor: true, shadow: true } });
    expect(projectScene(on, view(on)).scene.floor.mode).toBe(FLOOR_SHADOW_CATCHER);
    const noShadow = apply(s, { type: 'studio/set', patch: { floor: true, shadow: false } });
    expect(projectScene(noShadow, view(noShadow)).scene.floor.mode).toBe(FLOOR_NONE);
    expect(projectScene(noShadow, view(noShadow)).scene.floor.z).toBe(0);
  });

  it('exposure, tone curve, depth, budget; seed and clamp as rt-core defaults them', () => {
    const r = projectScene(s, view(s, { maxSamples: 4, maxSeconds: 9 })).scene.render;
    expect(r.exposureEv).toBe(s.image.exposureEv);
    expect(r.tonemap).toBe(TONEMAP_FILMIC);
    expect([r.maxSamples, r.maxSeconds, r.seed, r.clampIndirect]).toEqual([4, 9, 0, 0]);
    expect(r.maxDepth).toBe(8);
    const agx = apply(s, { type: 'image/set', patch: { viewTransform: 'AGX', exposureEv: 1.5 } }, { type: 'render/quality', quality: 'FINAL' });
    const ra = projectScene(agx, view(agx)).scene.render;
    expect([ra.tonemap, ra.exposureEv, ra.maxDepth]).toEqual([TONEMAP_AGX, 1.5, 12]);
    const std = apply(s, { type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    expect(projectScene(std, view(std)).scene.render.tonemap).toBe(TONEMAP_STANDARD);
  });

  it('a whole project round-trips through the writer', () => {
    const { scene } = projectScene(s, view(s));
    const back = readRsb(writeRsb(scene));
    expect(back.camera).toEqual(asF32(scene.camera));
    expect(back.lights).toEqual(asF32(scene.lights));
    expect(back.materials).toEqual(asF32(scene.materials));
    // Meshes name material 0 and the instances carry the materials, so INST is written.
    expect(scene.meshes.every((m) => m.materialId === 0)).toBe(true);
    expect(scene.instances).not.toEqual(implicitInstances(scene.meshes));
    expect(back.instances).toEqual(asF32(scene.instances));
    const update = readRsb(writeRsb(scene, { meshes: false }));
    expect(update.meshes).toHaveLength(0);
    expect(update.instances).toEqual(asF32(scene.instances));
  });
});

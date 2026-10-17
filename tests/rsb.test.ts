// RSB writer (phase E4): byte parity with the engine's own writer, round trip of every section,
// and the mapping of a project onto the engine's scene.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeCamera, cameraPosition, outputFrameRect, type CameraState } from '../src/core/camera';
import { registerImage } from '../src/core/images';
import { kelvinToRgb, polar, toWorldAzimuth } from '../src/core/light-math';
import { instanceFromPreset } from '../src/core/materials';
import { lightPosition, rigPivot } from '../src/core/lighting';
import { getMesh } from '../src/core/meshes';
import { AI_PASS_KEYS, PASS_KEYS } from '../src/core/passes';
import { CAUSTICS_PRESETS, isCaster, lightAngleDeg, SMALL_LIGHT_DEG } from '../src/core/caustics';
import { areaLightFlux, areaLightRadiance, EMIT_RADIANCE_PER_WATT } from '../src/core/photometry';
import { allParts, worldMatrix } from '../src/core/scene';
import { createInitialState, type ProjectState } from '../src/core/store';
import { DOME_FLOOR, DOME_HORIZON, DOME_ZENITH } from '../src/data/environment';
import {
  BACKGROUND_BACKPLATE,
  BACKGROUND_COLOR,
  BACKGROUND_ENVIRONMENT,
  BACKPLATE_FIT,
  BITMAP_HDR,
  BITMAP_RGBA8,
  ENV_HDRI,
  ENV_SKY,
  GLASS_ABSORPTION_MM,
  MATERIAL_FLAG_THIN,
  materialToRsb,
  NO_BITMAP,
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
    environment: { ...defaultEnvironment(), kind: ENV_STUDIO, floor: 0.05, horizon: 0.12, zenith: 0.3, strength: 1, rotationDeg: 0, backgroundColor: [0.05, 0.05, 0.05], backgroundMode: 0 },
    floor: defaultFloor(),
    render: { width: 512, height: 384, maxSamples: 16, seed: 1, maxSeconds: 0, exposureEv: 0, tonemap: 1, maxDepth: 8, clampIndirect: 0, passes: 0, denoise: 0, causticPhotons: 0, causticRadius: 0, denoiseStrength: 1, pixelFilter: 0, edgeSupersample: 1, adaptive: 0, noiseThreshold: 0 },
    bitmaps: [],
  };
}

/** Every field away from its default, like rt-core's `full_scene` test. */
function fullScene(): RsbScene {
  return {
    camera: { position: [10, -200, 50], target: [1, 2, 3], up: [0, 0, 1], focalMm: 85, sensorMm: 36, fstop: 5.6, focusDist: 212.5, ortho: true, orthoWidth: 320 },
    materials: [
      defaultMaterial(),
      { kind: 2, baseColor: [0.9, 0.5, 0.1], metallic: 1, roughness: 0.2, ior: 1.33, transmission: 0.25, coat: 0.5, coatRoughness: 0.05, emission: [1, 0.9, 0.8], emissionPower: 12, flags: 3, opacity: 0.75, anisotropy: 0.4, absorptionMm: 25, bevelMm: 0.35, scatterMm: 2.5, scatterColor: [0.9, 0.8, 0.7], scatterG: -0.3, abbe: 42 },
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
    environment: {
      kind: 1,
      floor: 0.2,
      horizon: 0.4,
      zenith: 0.8,
      strength: 1.5,
      rotationDeg: 90,
      backgroundColor: [0.1, 0.2, 0.3],
      backgroundMode: 1,
      hdriMap: 1,
      backplateMap: 0,
      backplateFit: 1,
      skyTurbidity: 4.5,
      sunAzimuthDeg: -30,
      sunElevationDeg: 12,
      backplateRect: [0.1, 0.05, 0.9, 0.95],
      skyModel: 1,
    },
    floor: { mode: 2, z: -12.5, color: [0.4, 0.5, 0.6] },
    render: { width: 1920, height: 1080, maxSamples: 256, seed: 77, maxSeconds: 12.5, exposureEv: -0.5, tonemap: 3, maxDepth: 12, clampIndirect: 10, passes: 0b101101, denoise: 3, causticPhotons: 4096, causticRadius: 2.5, denoiseStrength: 0.25, pixelFilter: 3, edgeSupersample: 4, adaptive: 1, noiseThreshold: 0.02 },
    // A raw plate (an odd number of bytes: padded) and the bytes of a file.
    bitmaps: [
      { format: 0, width: 3, height: 1, data: new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]) },
      { format: 16, width: 0, height: 0, data: new TextEncoder().encode('#?RADIANCE\n\n-Y 1 +X 1\n\u0080\u0080\u0080\u0081') },
    ],
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
    expect(s.map((x) => x.tag)).toEqual(['CAMR', 'MATL', 'MATL', 'MESH', 'MESH', 'INST', 'INST', 'INST', 'LGHT', 'LGHT', 'LGHT', 'BMAP', 'BMAP', 'ENVR', 'FLOR', 'RNDR']);
    const size = (tag: string) => s.find((x) => x.tag === tag)!.payload.byteLength;
    expect([size('CAMR'), size('MATL'), size('LGHT'), size('ENVR'), size('FLOR'), size('RNDR'), size('INST')]).toEqual([60, 100, 76, 84, 20, 72, 60]);
    // The first bitmap: 16 bytes of header and 9 of data, padded to 12.
    expect(size('BMAP')).toBe(16 + 12);
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
    // The bitmaps stay with the meshes: an update keeps the loaded ones.
    expect(tags.includes('BMAP')).toBe(false);
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
      expect(back.bitmaps).toEqual(scene.bitmaps);
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
    const scene: RsbScene = { camera: defaultCamera(), materials: [], meshes: [], instances: null, lights: [], environment: defaultEnvironment(), floor: defaultFloor(), render: defaultRender(), bitmaps: [] };
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
      // The size typed in the render window: the active camera takes its ratio, which is the frame the viewport draws (U13).
      const st: ProjectState = apply(s, { type: 'render/set', patch: { width: ow, height: oh } });
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
        expect(r.power).toBeCloseTo((Math.PI / 4) * l.power * (s.scene.partSizeMm / 1000) ** 2, 12);
        expect(r.sizeX).toBeCloseTo(l.size * s.scene.partSizeMm, 9);
      }
    });
  });

  it('the flux gives the irradiance Cycles gives the recipe, on axis and far away', () => {
    // A small panel 2 m away, part size 200 mm. In Blender Cycles the recipe's power P over an area A
    // is the radiance L = P / (4 A), so on axis and far away E = P / (4 dist^2): pi times the
    // isotropic-source P / (4 pi dist^2) the recipes' `share` is stated in. The engine's one-sided
    // Lambertian panel of flux F has the intensity F / pi, so E = F / (pi d^2).
    const power = 30;
    const partMm = 200;
    const dist = 10; // part sizes = 2 m
    const flux = areaLightFlux(power, partMm);
    const d = (dist * partMm) / 1000;
    expect(flux / (Math.PI * d * d)).toBeCloseTo(power / (4 * dist * dist), 12);
    // The radiance the preview uses is the engine's F / (pi A), independent of the part size, and
    // Cycles' P / (4 A) with A in square part sizes.
    const areaPs = 0.3 * 0.2;
    const areaM2 = areaPs * (partMm / 1000) ** 2;
    expect(areaLightRadiance(power, areaPs)).toBeCloseTo(flux / (Math.PI * areaM2), 9);
    expect(areaLightRadiance(power, areaPs)).toBeCloseTo(power / (4 * areaPs), 12);
    // Part size 1 m: the watts of the recipe are the watts of the engine, times pi / 4.
    expect(areaLightFlux(power, 1000)).toBeCloseTo((Math.PI / 4) * power, 12);
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

describe('project to RSB: an empty project', () => {
  it('is a whole scene with lights and a dome but no MESH and no INST, and an empty mesh key', () => {
    const s = createInitialState({ lang: 'en', theme: 'dark' });
    const { scene, meshKey } = projectScene(s, view(s));
    expect(meshKey).toBe('');
    expect(scene.meshes).toHaveLength(0);
    const tags = sections(writeRsb(scene, { meshes: true })).map((x) => x.tag);
    // What the native launcher cannot tell from an update unless the request says it is whole
    // (`full=1`, tests/native.test.ts).
    expect(tags).not.toContain('MESH');
    expect(tags).not.toContain('INST');
    expect(tags).toContain('CAMR');
    expect(tags).toContain('ENVR');
    expect(tags).toContain('RNDR');
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

  it('the pass mask: none by default, bit i for PASS_KEYS[i] when the view asks (X2), and it reaches the RNDR bytes', () => {
    expect(r0().passes).toBe(0);
    const asked = projectScene(s, view(s, { passes: ['albedo', 'depth', 'coc'] })).scene;
    expect(asked.render.passes).toBe(0b100101);
    expect(projectScene(s, view(s, { passes: [...AI_PASS_KEYS] })).scene.render.passes).toBe(0b111111);
    // N2: the alpha is the seventh, appended after the six (bit 6), and every key is a bit.
    expect(projectScene(s, view(s, { passes: ['alpha'] })).scene.render.passes).toBe(0b1000000);
    expect(projectScene(s, view(s, { passes: [...PASS_KEYS] })).scene.render.passes).toBe(0b1111111);
    const payload = sections(writeRsb(asked)).find((x) => x.tag === 'RNDR')!.payload;
    expect(payload.byteLength).toBe(64);
    expect(payload.getUint32(36, true)).toBe(0b100101);
    expect(readRsb(writeRsb(asked)).render!.passes).toBe(0b100101);
    function r0() {
      return projectScene(s, view(s)).scene.render;
    }
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

// ------------------------------------------------------------------ E5: glass, cut-outs, images

describe('RSB writer: the E5 sections, byte for byte with rt-core', () => {
  // `rt --write-e5-example`: clear glass with absorption, a thin wall, a cut-out, anisotropy, an
  // HDRI as the bytes of a Radiance file, a background image of raw sRGB pixels.
  const e5 = new Uint8Array(readFileSync('tests/fixtures/e5.rsb'));

  it('reads the fixture into the shapes of src/io/rsb.ts and writes it back to the same bytes', () => {
    const r = readRsb(e5);
    expect(r.tags.filter((t) => t === 'BMAP')).toHaveLength(2);
    expect(r.bitmaps.map((b) => [b.format, b.width, b.height])).toEqual([[16, 0, 0], [0, 16, 8]]);
    expect(String.fromCharCode(...r.bitmaps[0].data.subarray(0, 10))).toBe('#?RADIANCE');
    const env = r.environment!;
    expect([env.kind, env.hdriMap, env.backplateMap, env.backgroundMode]).toEqual([ENV_HDRI, 0, 1, BACKGROUND_BACKPLATE]);
    expect(r.materials[0].absorptionMm).toBe(80);
    expect(r.materials[2].anisotropy).toBeCloseTo(0.8, 6);
    expect(r.materials[3].flags & MATERIAL_FLAG_THIN).toBe(MATERIAL_FLAG_THIN);
    expect(r.materials[4].opacity).toBeCloseTo(0.4, 6);
    const scene: RsbScene = {
      camera: r.camera!,
      materials: r.materials,
      meshes: r.meshes,
      instances: r.instances,
      lights: r.lights,
      environment: env,
      floor: r.floor!,
      render: r.render!,
      bitmaps: r.bitmaps,
    };
    const bytes = writeRsb(scene);
    expect(bytes.length).toBe(e5.length);
    expect(firstDiff(bytes, e5)).toBe(-1);
  });
});

describe('project to RSB: E5 materials and environments', () => {
  const s = exampleState();
  const ids = keyIds(s);

  it('glass gets its absorption distance and thin walls; standard materials their cut-out and anisotropy', () => {
    const glass = materialToRsb(instanceFromPreset('g', 'GLASS_TINT', 200));
    expect(glass.kind).toBe(MATERIAL_GLASS);
    expect(glass.absorptionMm).toBe(GLASS_ABSORPTION_MM);
    expect(glass.flags & MATERIAL_FLAG_THIN).toBe(0);
    const inst = instanceFromPreset('g', 'GLASS_CLEAR', 200)!;
    const thin = materialToRsb({ ...inst, params: { ...inst.params, walls: 'THIN', absorptionMm: 0 } });
    expect(thin.flags & MATERIAL_FLAG_THIN).toBe(MATERIAL_FLAG_THIN);
    expect(thin.absorptionMm).toBe(0);
    const brushed = materialToRsb(instanceFromPreset('b', 'ALU_BRUSH', 200));
    expect(brushed.anisotropy).toBeGreaterThan(0.5);
    const plain = instanceFromPreset('p', 'WHITE_STUDIO', 200)!;
    const cut = materialToRsb({ ...plain, params: { ...plain.params, opacity: 0.3, anisotropic: 2 } });
    expect([cut.opacity, cut.anisotropy]).toEqual([0.3, 1]);
    expect(materialToRsb(plain).opacity).toBe(1);
  });

  it("E6: every material but an emitter carries its edge bevel, and the example's reach the engine", () => {
    const plain = instanceFromPreset('p', 'WHITE_STUDIO', 200)!;
    expect(plain.bevelRadiusMm).toBe(0.5);
    expect(materialToRsb(plain).bevelMm).toBe(0.5);
    expect(materialToRsb({ ...plain, bevelRadiusMm: 1.25 }).bevelMm).toBe(1.25);
    expect(materialToRsb({ ...plain, bevelRadiusMm: -3 }).bevelMm).toBe(0);
    expect(materialToRsb({ ...plain, bevelRadiusMm: Number.NaN }).bevelMm).toBe(0);
    for (const key of ['GLASS_CLEAR', 'OAK', 'COTTON', 'CHROME']) {
      expect(materialToRsb(instanceFromPreset('m', key, 200)).bevelMm, key).toBe(0.5);
    }
    const lamp = instanceFromPreset('e', 'LED_WARM', 200);
    expect(lamp?.family).toBe('EMISSIVE');
    expect(materialToRsb({ ...lamp!, bevelRadiusMm: 2 }).bevelMm).toBe(0);
    expect(materialToRsb(null).bevelMm).toBe(0);
    // The example bottle (121 mm): its materials' 0.25 % of the part size.
    const { scene } = projectScene(s, view(s));
    expect(scene.materials.map((m) => m.bevelMm)).toEqual(scene.materials.map(() => 0.303));
    const back = readRsb(writeRsb(scene));
    expect(back.materials.map((m) => m.bevelMm)).toEqual(scene.materials.map(() => Math.fround(0.303)));
  });

  it("a SKY setup puts the sky's sun where the rig's sun light is", () => {
    const sky = apply(s, { type: 'studio/setSetup', key: 'SUN' });
    expect(sky.environment.kind).toBe('SKY');
    const { scene } = projectScene(sky, view(sky));
    expect(scene.environment.kind).toBe(ENV_SKY);
    const sun = scene.lights.find((l) => l.kind === LIGHT_SUN)!;
    const toSun = [-sun.direction[0], -sun.direction[1], -sun.direction[2]];
    const az = (scene.environment.sunAzimuthDeg * Math.PI) / 180;
    const el = (scene.environment.sunElevationDeg * Math.PI) / 180;
    const dir = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    for (let k = 0; k < 3; k++) expect(dir[k]).toBeCloseTo(toSun[k], 5);
    expect(scene.environment.sunElevationDeg).toBeCloseTo(55, 0);
    expect(scene.environment.skyTurbidity).toBe(3);
    // The sun light keeps the setup's 5200 K colour: what the sky's disc is.
    expect(sun.color).toEqual(kelvinToRgb(5200));
    // Without a sun light, the environment's own sun (camera-relative) takes its place.
    const lamp = apply(sky, { type: 'studio/setLight', id: sky.studio.lights[0].id, patch: { enabled: false } }, { type: 'env/set', patch: { skySun: { az: 0, el: 30 } } });
    const own = projectScene(lamp, view(lamp)).scene.environment;
    const want = polar(toWorldAzimuth(0), 30, 1);
    expect(own.sunElevationDeg).toBeCloseTo(30, 4);
    expect(Math.cos((own.sunAzimuthDeg * Math.PI) / 180)).toBeCloseTo(want[0] / Math.hypot(want[0], want[1]), 4);
  });

  it('an HDRI and a background image travel as bitmaps, and change the mesh key', () => {
    const hdr = new Uint8Array(readFileSync('tests/fixtures/studio.hdr'));
    registerImage('hdri:test', 'studio.hdr', { format: 'HDR', bytes: hdr, width: 1024, height: 512 });
    registerImage('plate:test', 'plate.png', { format: 'PNG', bytes: new Uint8Array(4), width: 2, height: 1, rgba8: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) });
    const before = projectScene(s, view(s));
    const lit = apply(
      s,
      { type: 'env/set', patch: { kind: 'HDRI', hdri: { id: 'hdri:test', name: 'studio.hdr', width: 1024, height: 512 }, rotationDeg: 30 } },
      { type: 'env/set', patch: { background: 'BACKPLATE', backplate: { id: 'plate:test', name: 'plate.png', width: 2, height: 1 }, backplateFit: 'FIT' } },
    );
    const { scene, meshKey } = projectScene(lit, view(lit, { viewport: { viewW: 1000, viewH: 800 } }));
    expect(scene.bitmaps.map((b) => [b.format, b.width, b.height, b.data.length])).toEqual([
      [BITMAP_HDR, 0, 0, hdr.length],
      [BITMAP_RGBA8, 2, 1, 8],
    ]);
    expect([scene.environment.kind, scene.environment.hdriMap, scene.environment.backplateMap, scene.environment.backplateFit]).toEqual([ENV_HDRI, 0, 1, BACKPLATE_FIT]);
    expect(scene.environment.rotationDeg).toBe(30);
    // The output frame sits inside the viewport where the preview draws it.
    const f = outputFrameRect(1000, 800, lit.render.width, lit.render.height);
    expect(scene.environment.backplateRect).toEqual([f.x / 1000, f.y / 800, (f.x + f.width) / 1000, (f.y + f.height) / 800]);
    expect(meshKey).not.toBe(before.meshKey);
    expect(meshKey.startsWith(before.meshKey)).toBe(true);
    // An update leaves them out (the engine keeps them), the full scene has them.
    expect(readRsb(writeRsb(scene, { meshes: false })).bitmaps).toHaveLength(0);
    expect(readRsb(writeRsb(scene)).bitmaps).toHaveLength(2);
    // A transparent render does not send the background image; another kind does not send the HDRI.
    const transparent = projectScene(lit, view(lit, { transparent: true })).scene;
    expect(transparent.bitmaps).toHaveLength(1);
    expect(transparent.environment.backplateMap).toBe(NO_BITMAP);
    const studio = apply(lit, { type: 'env/set', patch: { kind: 'STUDIO' } });
    expect(projectScene(studio, view(studio)).scene.environment.hdriMap).toBe(NO_BITMAP);
    // An image the registry no longer has is left out: the dome and the colour stand in.
    const gone = apply(s, { type: 'env/set', patch: { kind: 'HDRI', hdri: { id: 'hdri:missing', name: 'x.hdr', width: 1, height: 1 } } });
    expect(projectScene(gone, view(gone)).scene.bitmaps).toHaveLength(0);
    void ids;
  });
});

describe('project to RSB: denoise and caustics (E5b-1)', () => {
  const s = exampleState();
  const ids = keyIds(s);
  const glass = apply(s, { type: 'material/assign', preset: 'GLASS_CLEAR', targets: [ids.body], mode: 'REPLACE' });
  const fields = (st: ProjectState, extra: Partial<SceneView>) => {
    const r = projectScene(st, view(st, extra)).scene.render;
    return [r.denoise, r.causticPhotons, r.causticRadius];
  };

  it('writes the denoise bits and the caustic photons into RNDR, in the order of rt-core', () => {
    const scene = projectScene(glass, view(glass, { denoise: 3, caustics: { mode: 'ON', quality: 'HIGH' } })).scene;
    expect([scene.render.denoise, scene.render.causticPhotons, scene.render.causticRadius]).toEqual([3, CAUSTICS_PRESETS.HIGH.photons, CAUSTICS_PRESETS.HIGH.radiusPx]);
    const payload = sections(writeRsb(scene)).find((x) => x.tag === 'RNDR')!.payload;
    expect([payload.getUint32(40, true), payload.getUint32(44, true), payload.getFloat32(48, true)]).toEqual([3, 65536, 2]);
    expect(readRsb(writeRsb(scene)).render).toEqual(asF32(scene.render));
    // Nothing asked: denoise and caustics off, as a file before E5b-1 means.
    expect(fields(glass, {})).toEqual([0, 0, 0]);
    // U11b: the strength comes last, a fraction; without one, all of the filter.
    expect(payload.getFloat32(52, true)).toBe(1);
    const half = projectScene(glass, view(glass, { denoise: 1, denoiseStrength: 0.5 })).scene;
    expect(sections(writeRsb(half)).find((x) => x.tag === 'RNDR')!.payload.getFloat32(52, true)).toBe(0.5);
    expect(projectScene(glass, view(glass, { denoiseStrength: 7 })).scene.render.denoiseStrength).toBe(1);
    expect(projectScene(glass, view(glass, { denoiseStrength: -1 })).scene.render.denoiseStrength).toBe(0);
    expect(fields(glass, { caustics: { mode: 'OFF', quality: 'MEDIUM' } })).toEqual([0, 0, 0]);
  });

  it('E11: writes the pixel filter and the edge samples last into RNDR; without them the box and none, as rt-core reads a file of before', () => {
    const plain = sections(writeRsb(projectScene(glass, view(glass)).scene)).find((x) => x.tag === 'RNDR')!.payload;
    expect([plain.getUint32(56, true), plain.getUint32(60, true)]).toEqual([0, 1]);
    const fine = projectScene(glass, view(glass, { pixelFilter: 3, edgeSupersample: 4 })).scene;
    const payload = sections(writeRsb(fine)).find((x) => x.tag === 'RNDR')!.payload;
    expect([payload.getUint32(56, true), payload.getUint32(60, true)]).toEqual([3, 4]);
    expect(readRsb(writeRsb(fine)).render).toEqual(asF32(fine.render));
    // Out of range is brought into it (rt-core refuses more than 16 edge samples).
    expect(projectScene(glass, view(glass, { edgeSupersample: 99 })).scene.render.edgeSupersample).toBe(16);
    expect(projectScene(glass, view(glass, { edgeSupersample: 0 })).scene.render.edgeSupersample).toBe(1);
    expect(projectScene(glass, view(glass, { pixelFilter: -2 })).scene.render.pixelFilter).toBe(0);
  });

  it('Automatic: on with glass (or polished metal) and a small light, off without either', () => {
    const auto = { caustics: { mode: 'AUTO' as const, quality: 'MEDIUM' as const } };
    const medium = [0, CAUSTICS_PRESETS.MEDIUM.photons, CAUSTICS_PRESETS.MEDIUM.radiusPx];
    // The example's body is plastic: nothing focuses light.
    expect(fields(s, auto)).toEqual([0, 0, 0]);
    // Glass under the default rig: its softboxes are large, seen from the part.
    const big = projectScene(glass, view(glass)).scene.lights;
    const sizes = big.map((l) => lightAngleDeg({ kind: l.kind, position: l.position, sizeX: l.sizeX, sizeY: l.sizeY, angleDeg: l.angleDeg, glossy: true }, [0, 0, 0]));
    expect(fields(glass, auto)).toEqual(sizes.some((d) => d <= SMALL_LIGHT_DEG) ? medium : [0, 0, 0]);
    // A sun is a small light.
    const sun = apply(glass, { type: 'studio/setLight', id: glass.studio.lights[0].id, patch: { type: 'SUN', power: 3, angle: 0.545 } });
    expect(fields(sun, auto)).toEqual(medium);
    // So is a lit emitter (a filament, a neon tube).
    const lamp = apply(glass, { type: 'material/assign', preset: 'NEON_RED', targets: [ids.cap], mode: 'REPLACE' });
    expect(fields(lamp, auto)).toEqual(medium);
    // Polished metal focuses too; brushed (rough) metal does not.
    const chrome = apply(s, { type: 'material/assign', preset: 'CHROME', targets: [ids.body], mode: 'REPLACE' }, { type: 'studio/setLight', id: s.studio.lights[0].id, patch: { type: 'SUN', power: 3, angle: 0.545 } });
    expect(fields(chrome, auto)).toEqual(medium);
  });

  it("the caster test is the engine's", () => {
    // rt_core::caustics::is_caster, case by case (crates/rt-core/src/caustics/tests.rs).
    expect(isCaster({ kind: MATERIAL_GLASS, roughness: 0, transmission: 1, metallic: 0 })).toBe(true);
    expect(isCaster({ kind: MATERIAL_GLASS, roughness: 0.25, transmission: 1, metallic: 0 })).toBe(true);
    expect(isCaster({ kind: MATERIAL_GLASS, roughness: 0.4, transmission: 1, metallic: 0 })).toBe(false);
    expect(isCaster({ kind: MATERIAL_PRINCIPLED, roughness: 0.05, transmission: 0, metallic: 1 })).toBe(true);
    expect(isCaster({ kind: MATERIAL_PRINCIPLED, roughness: 0.5, transmission: 0, metallic: 1 })).toBe(false);
    expect(isCaster({ kind: MATERIAL_PRINCIPLED, roughness: 0, transmission: 0, metallic: 0 })).toBe(false);
    expect(isCaster({ kind: MATERIAL_EMISSIVE, roughness: 0.05, transmission: 0, metallic: 1 })).toBe(false);
    // Brushed metal along its brush.
    expect(isCaster({ kind: MATERIAL_PRINCIPLED, roughness: 0.28, transmission: 0, metallic: 1, anisotropy: 0.8 })).toBe(true);
    expect(isCaster({ kind: MATERIAL_PRINCIPLED, roughness: 0.28, transmission: 0, metallic: 1, anisotropy: 0 })).toBe(false);
  });
});

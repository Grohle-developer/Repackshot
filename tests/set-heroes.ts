// The objects the light-setup thumbnails show (L6, tools/setup-thumbs.mjs): each set on the object it is designed
// for (`LightSetup.hero`), and the 72 setups before L6 on the object of their style. Built with the application's own
// code (the example bottle, the primitives of U9, catalogue materials) and lit with the store's actions, so a
// thumbnail is what the person gets when they pick that setup.

import { cameraBasis } from '../src/core/camera';
import { DENOISE_IMAGE } from '../src/core/caustics';
import { projectScene, writeRsb, type SceneView } from '../src/io/rsb';
import { buildExample } from '../src/core/example';
import { instanceFromPreset, type MaterialInstance } from '../src/core/materials';
import { registerMesh, getMesh, type MeshData } from '../src/core/meshes';
import { normalizeParams, ensurePrimitiveMesh, type PrimitiveSpec } from '../src/core/primitives';
import type { ModelPayload, SceneNode } from '../src/core/scene';
import { createInitialState, reduce, type Action, type ProjectState } from '../src/core/store';
import { CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG, LIGHT_SETUPS } from '../src/data/light-setups';
import type { LightSetup, LightStyle, SetHero } from '../src/data/types';

/** The hero of each style of the setups before L6 (the brief of L6). */
export const STYLE_HERO: Readonly<Record<Exclude<LightStyle, 'SETS'>, SetHero>> = {
  PRODUCT: 'SPHERES',
  TRADITIONAL: 'SPHERES',
  CINEMATIC: 'BOTTLE',
  CREATIVE: 'BOX',
  EMOTIONAL: 'BOTTLE',
  EXPERIMENTAL: 'CHROME',
  SIGNATURE: 'RING',
  SPICY: 'BOTTLE',
};

/** The object of a setup's thumbnail. */
export function heroOf(setup: LightSetup): SetHero {
  return setup.hero ?? (setup.style === 'SETS' ? 'SPHERES' : STYLE_HERO[setup.style]);
}

function material(id: string, preset: string, params: Record<string, unknown> = {}): MaterialInstance {
  const m = instanceFromPreset(id, preset, 120)!;
  return { ...m, params: { ...m.params, ...params }, edited: Object.keys(params).length > 0 };
}

function part(id: string, name: string, mesh: ReturnType<typeof registerMesh>, mat: string, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]): SceneNode {
  return {
    id,
    name,
    kind: 'PART',
    parent: null,
    children: [],
    transform: { position, rotation, scale: [1, 1, 1] },
    visible: true,
    locked: false,
    mesh,
    material: mat,
    smooth: true,
  };
}

/** A primitive's mesh under a fixed id, as a plain part (the hero is the product, not a set piece). */
function primMesh(id: string, spec: PrimitiveSpec) {
  return ensurePrimitiveMesh(`hero-${id}`, { kind: spec.kind, params: normalizeParams(spec.kind, spec.params) }).ref;
}

/** The liquid inside the example bottle: its body narrowed and cut flat at a fill line. */
function liquidMesh(): MeshData {
  const body = getMesh('example:body')!;
  const p = new Float32Array(body.positions);
  const n = new Float32Array(body.normals);
  const fill = 70;
  for (let i = 0; i < p.length; i += 3) {
    p[i] *= 0.9;
    p[i + 1] *= 0.9;
    const z = 7 + (p[i + 2] - 5) * 0.92;
    if (z >= fill) {
      p[i + 2] = fill;
      n[i] = 0;
      n[i + 1] = 0;
      n[i + 2] = 1;
    } else p[i + 2] = z;
  }
  return { positions: p, normals: n, indices: body.indices };
}

/** The payload of a hero, centred on the origin and standing on the floor. */
export function heroPayload(hero: SetHero): ModelPayload {
  if (hero === 'BOTTLE') {
    const ex = buildExample();
    // Glass body, a coloured liquid inside that absorbs as it goes through.
    const body = ex.nodes.body;
    ex.materials[body.material!] = material(body.material!, 'GLASS_CLEAR');
    const liquid = registerMesh('hero:liquid', liquidMesh());
    ex.materials.m_liquid = material('m_liquid', 'GLASS_TINT', { baseColor: [0.95, 0.5, 0.12, 1], ior: 1.33, absorptionMm: 35 });
    ex.nodes.liquid = { ...part('liquid', 'Liquid', liquid, 'm_liquid', [0, 0, body.transform.position[2]]), parent: 'model' };
    ex.nodes.model = { ...ex.nodes.model, children: [...ex.nodes.model.children, 'liquid'] };
    return ex;
  }
  const nodes: Record<string, SceneNode> = {};
  const materials: Record<string, MaterialInstance> = {};
  const add = (id: string, spec: PrimitiveSpec, preset: string, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], params: Record<string, unknown> = {}) => {
    materials[`m_${id}`] = material(`m_${id}`, preset, params);
    nodes[id] = part(id, id, primMesh(id, spec), `m_${id}`, position, rotation);
  };
  switch (hero) {
    case 'BOX':
      add('box', { kind: 'BOX', params: { width: 100, depth: 100, height: 140, bevel: 3, bevelSegments: 4 } }, 'ABS_GLOSS', [0, 0, 70]);
      add('band', { kind: 'BOX', params: { width: 102.4, depth: 102.4, height: 22, bevel: 1, bevelSegments: 2 } }, 'ALU_BRUSH', [0, 0, 92]);
      break;
    case 'RING':
      add('ring', { kind: 'TORUS', params: { radius: 20, tube: 3.2, segments: 128, tubeSegments: 32 } }, 'GOLD', [0, 0, 23.2], [90, 0, 0]);
      break;
    case 'CHROME':
      add('chrome', { kind: 'TORUS', params: { radius: 40, tube: 13, segments: 128, tubeSegments: 48 } }, 'CHROME', [0, 0, 53], [90, 0, 0]);
      break;
    case 'SHOE':
      add('shoe', { kind: 'CAPSULE', params: { radius: 32, height: 160, segments: 64, rings: 16 } }, 'LEATHER', [0, 0, 32], [0, 90, 0]);
      break;
    case 'SPHERES': {
      // Matte, glossy and metal, side by side across the reference view.
      const { right } = cameraBasis(CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG);
      const at = (k: number): [number, number, number] => [right[0] * 70 * k, right[1] * 70 * k, 30];
      add('matte', { kind: 'SPHERE', params: { radius: 30, segments: 64 } }, 'NYLON_SLS', at(-1));
      add('glossy', { kind: 'SPHERE', params: { radius: 30, segments: 64 } }, 'CERAMIC', at(0));
      add('metal', { kind: 'SPHERE', params: { radius: 30, segments: 64 } }, 'CHROME', at(1));
      break;
    }
    default:
      break;
  }
  return { nodes, roots: Object.keys(nodes), materials };
}

/** A project with `hero` in it, `width x height` output, the product type built (its camera framing the hero). */
export function heroState(hero: SetHero, width: number, height: number, preset = 'GENERIC'): ProjectState {
  let s = createInitialState();
  const acts: Action[] = [
    { type: 'scene/addModel', payload: heroPayload(hero), replace: true },
    { type: 'render/set', patch: { width, height } },
    { type: 'studio/setPreset', key: preset },
  ];
  for (const a of acts) s = reduce(s, a);
  return s;
}

/** The hero lit by a setup: the product type built, the setup applied and, for a set with a camera, that camera. */
export function setupScene(key: string, opts: { width: number; height: number; preset?: string; hero?: SetHero; custom?: Action }): ProjectState {
  const setup = LIGHT_SETUPS.find((x) => x.key === key)!;
  let s = heroState(opts.hero ?? heroOf(setup), opts.width, opts.height, opts.preset);
  if (opts.custom) s = reduce(s, opts.custom);
  s = reduce(s, { type: 'studio/build' });
  s = reduce(s, { type: 'studio/setSetup', key });
  if (setup.camera) s = reduce(s, { type: 'studio/useSetCamera' });
  return s;
}

/** How a thumbnail is rendered (L6): square, 96 samples, denoised, a fixed seed. */
export const THUMB = { width: 256, height: 256, spp: 96, seed: 1 } as const;

/** The engine's view of a setup's scene: its samples, the seed, denoise, and caustics on when the setup asks for them. */
export function thumbView(setup: Pick<LightSetup, 'caustics'>, width: number, height: number, spp: number): SceneView {
  return {
    width,
    height,
    maxSamples: spp,
    maxSeconds: 0,
    seed: THUMB.seed,
    denoise: DENOISE_IMAGE,
    caustics: { mode: setup.caustics ? 'ON' : 'AUTO', quality: 'MEDIUM' },
  };
}

/** The RSB of a setup's thumbnail, as tools/setup-thumbs.mjs renders it. */
export function thumbRsb(key: string, width: number = THUMB.width, height: number = THUMB.height, spp: number = THUMB.spp): Uint8Array {
  const setup = LIGHT_SETUPS.find((x) => x.key === key)!;
  return writeRsb(projectScene(setupScene(key, { width, height }), thumbView(setup, width, height, spp)).scene);
}

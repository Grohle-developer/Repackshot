// The scene of the Q1 region comparison (tests/section-full-browser.test.ts): the example bottle in five flat colours,
// cut in half through its axis by a plane across the camera's direction, so the cut faces the camera. The Fast preview
// draws it in Chromium and the engine renders the same state; the test compares where the cut and its caps fall.
//
//   body (a closed solid)   red       its cut is capped: a red section of the whole body
//   cap  (a closed solid)   green     capped
//   collar (a closed ring)  blue      capped
//   base (an open cup)      yellow    not capped: the cut shows its inside
//   label (an open band)    magenta   on the front, wholly on the removed side: gone
//   core (a closed solid)   cyan      a cylinder hidden inside the body: the cut shows its section as a disc in the
//                                     red one (the surface met first after the plane is the core's, not the body's)
//
// Built the same way in the page and in Node.

import { buildExample } from '../../src/core/example';
import { instanceFromPreset } from '../../src/core/materials';
import { registerMesh } from '../../src/core/meshes';
import { generatePrimitive } from '../../src/core/primitives';
import { defaultSection, type SectionPlane } from '../../src/core/section';
import { createInitialState, reduce, type ProjectState } from '../../src/core/store';

/** Linear colours of the five parts, as the materials are given them. */
export const SECTION_COLOURS = {
  body: [0.85, 0.12, 0.1],
  cap: [0.1, 0.75, 0.2],
  collar: [0.12, 0.3, 0.9],
  base: [0.9, 0.78, 0.12],
  label: [0.85, 0.1, 0.75],
  core: [0.08, 0.7, 0.75],
} as const;

/** Radius and height of the core, mm: it sits on the bottle's axis inside the body (the body's wall is 31 mm out). */
export const CORE = { radius: 12, height: 50, from: 24 } as const;

/** The bottle with flat matte colours, the reference camera pulled in, and the cut. */
export function sectionScene(width: number, height: number, opts: { offsetMm?: number; flip?: boolean; cap?: boolean } = {}): ProjectState {
  const payload = buildExample();
  for (const key of ['body', 'cap', 'collar', 'base', 'label'] as const) {
    const id = `m_${key}`;
    const m = instanceFromPreset(id, 'WHITE_STUDIO', 121)!;
    const [r, g, b] = SECTION_COLOURS[key];
    m.params = { ...m.params, baseColor: [r, g, b, 1], roughness: 1, coat: 0, metallic: 0 };
    payload.materials[id] = m;
  }
  // The core: a cylinder primitive on the axis, between 24 and 74 mm above the floor, inside the body.
  const cylinder = generatePrimitive({ kind: 'CYLINDER', params: { radius: CORE.radius, height: CORE.height, segments: 64 } });
  let zMin = Infinity;
  for (let i = 2; i < cylinder.data.positions.length; i += 3) zMin = Math.min(zMin, cylinder.data.positions[i]);
  const half = payload.nodes.model.transform.position[2];
  const core = instanceFromPreset('m_core', 'WHITE_STUDIO', 121)!;
  core.params = { ...core.params, baseColor: [...SECTION_COLOURS.core, 1], roughness: 1, coat: 0, metallic: 0 };
  payload.materials.m_core = core;
  payload.nodes.model.children = [...payload.nodes.model.children, 'core'];
  payload.nodes.core = {
    id: 'core',
    name: 'core',
    kind: 'PART',
    parent: 'model',
    children: [],
    transform: { position: [0, 0, CORE.from - zMin - half], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    mesh: registerMesh('q1:core', cylinder.data),
    material: 'm_core',
    smooth: true,
  };
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload, replace: true });
  s = reduce(s, { type: 'render/set', patch: { width, height } });
  s = reduce(s, { type: 'camera/set', id: s.camera.active, patch: { azimuth: -40, elevation: 12, distance: 380, target: [0, 0, 60], focalMm: 60, fstop: 0 } });
  const base = defaultSection(s);
  const n = base.normal;
  const off = opts.offsetMm ?? 0;
  const plane: SectionPlane = { ...base, point: [base.point[0] + n[0] * off, base.point[1] + n[1] * off, base.point[2] + n[2] * off], normal: opts.flip ? [-n[0], -n[1], -n[2]] : n, cap: opts.cap ?? true };
  return reduce(s, { type: 'section/set', plane });
}

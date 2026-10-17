// The section view in the RSB (phase Q1): the SECT payload byte for byte as the engine writes it (the section of
// `rt --write-q1-example`, tests/fixtures/q1.rsb), where projectScene puts it, what it carries (the plane the clips
// have moved, nothing without a plane or with it off), that an update without meshes carries it, and, with the real
// rt.wasm (`npm run engine:build`), that the engine reads what the page writes: the fixture renders to the pinned
// hash through the page's code, and the bottle the page writes cut in two is cut.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/animation';
import { sectionOf, type SectionPlane } from '../src/core/section';
import { defaultCamera, defaultEnvironment, defaultFloor, defaultRender, projectScene, SECT_BYTES, SECTION_CAP, writeRsb, type RsbScene } from '../src/io/rsb';
import { apply, exampleState } from './helpers';
import { readRsb, sections } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const fixture = new Uint8Array(readFileSync('tests/fixtures/q1.rsb'));
const SECTION_TESTS = 'engine/crates/rt-core/src/render/section_tests.rs';
const view = { width: 160, height: 120, maxSamples: 4, maxSeconds: 0 };

const plane = (over: Partial<SectionPlane> = {}): SectionPlane => ({ enabled: true, point: [10, 20, 30], normal: [0, 0, 1], cap: true, ...over });
const withPlane = (p: SectionPlane = plane()) => apply(exampleState(), { type: 'section/set', plane: p });

/** A scene of nothing but a camera, an environment, a floor and the render settings, with `section`. */
function bare(section?: RsbScene['section']): RsbScene {
  return { camera: defaultCamera(), materials: [], meshes: [], instances: null, lights: [], environment: defaultEnvironment(), floor: defaultFloor(), render: defaultRender(), bitmaps: [], ...(section ? { section } : {}) };
}

describe('SECT: the engine layout', () => {
  it('is the 20 bytes the engine writes: flags, normal, distance', () => {
    const [sect] = sections(fixture).filter((s) => s.tag === 'SECT');
    expect(sect.payload.byteLength).toBe(SECT_BYTES);
    expect(readRsb(fixture).section).toEqual({ cap: true, normal: [1, 0, 0], distance: 0 });
    // The page writes the same bytes for the same plane.
    const written = sections(writeRsb(bare({ cap: true, normal: [1, 0, 0], distance: 0 }))).find((s) => s.tag === 'SECT')!;
    expect(Array.from(new Uint8Array(written.payload.buffer, written.payload.byteOffset, written.payload.byteLength))).toEqual(Array.from(new Uint8Array(sect.payload.buffer, sect.payload.byteOffset, sect.payload.byteLength)));
    // The cap flag is bit 0 and a plane without caps clears it.
    const open = sections(writeRsb(bare({ cap: false, normal: [0, 0, 1], distance: 12.5 }))).find((s) => s.tag === 'SECT')!;
    expect(open.payload.getUint32(0, true)).toBe(0);
    expect(sect.payload.getUint32(0, true)).toBe(SECTION_CAP);
    expect(open.payload.getFloat32(16, true)).toBe(12.5);
  });

  it('sits after the lights and the effects, before the environment, and only for a plane that is on', () => {
    const tags = (s: ReturnType<typeof withPlane>) => sections(writeRsb(projectScene(s, view).scene)).map((x) => x.tag);
    const on = tags(withPlane());
    expect(on.filter((t) => t === 'SECT')).toHaveLength(1);
    const at = on.indexOf('SECT');
    expect(on[at - 1]).toBe('LGHT');
    expect(on[at + 1]).toBe('ENVR');
    // With an effect, after its FXAM.
    const fx = tags(apply(withPlane(), { type: 'effect/add', preset: 'DUST_MOTES' }));
    expect(fx[fx.indexOf('SECT') - 1]).toBe('FXAM');
    // No plane, or one switched off: the bytes of before Q1.
    expect(tags(exampleState())).not.toContain('SECT');
    expect(tags(withPlane(plane({ enabled: false })))).not.toContain('SECT');
    const plain = writeRsb(projectScene(exampleState(), view).scene);
    const off = writeRsb(projectScene(withPlane(plane({ enabled: false })), view).scene);
    expect(Array.from(off)).toEqual(Array.from(plain));
    // Everything else is the same bytes in the same order with the plane on.
    const cut = sections(writeRsb(projectScene(withPlane(), view).scene)).filter((x) => x.tag !== 'SECT');
    expect(cut.map((x) => x.tag)).toEqual(sections(plain).map((x) => x.tag));
  });

  it('writes the plane as normal and distance, the clips’ offset added along the normal, and in an update without meshes', () => {
    const s = withPlane(plane({ point: [10, 20, 30], normal: [0, 0, 1] }));
    const written = readRsb(writeRsb(projectScene(s, view).scene)).section!;
    expect(written).toEqual({ cap: true, normal: [0, 0, 1], distance: 30 });
    // A tilted plane: n · p.
    const tilted = readRsb(writeRsb(projectScene(withPlane(plane({ point: [10, 20, 30], normal: [0.6, 0, 0.8] })), view).scene)).section!;
    expect(tilted.distance).toBeCloseTo(0.6 * 10 + 0.8 * 30, 5);
    // The pose of the playhead moves it.
    const clipped = apply(s, { type: 'anim/addClip', clip: { target: { kind: 'SCENE' }, move: 'SECTION', shot: null, start: 0, duration: 2, amount: -0.5, easing: 'LINEAR' } });
    const halfway = readRsb(writeRsb(projectScene(clipped, { ...view, pose: evaluate(clipped, 1) }).scene)).section!;
    expect(halfway.distance).toBeCloseTo(30 - 0.25 * s.scene.partSizeMm, 4);
    const start = readRsb(writeRsb(projectScene(clipped, { ...view, pose: evaluate(clipped, 0) }).scene)).section!;
    expect(start.distance).toBe(30);
    // An update (no meshes) carries the plane too, so the engine never keeps a stale one.
    const update = writeRsb(projectScene(s, view).scene, { meshes: false });
    expect(sections(update).some((x) => x.tag === 'SECT')).toBe(true);
    expect(sections(update).some((x) => x.tag === 'MESH')).toBe(false);
    // The plane is the same object the helper makes (a click or a line, flipped, switched on).
    expect(sectionOf({ point: [1, 2, 3], normal: [0, 1, 0] }).enabled).toBe(true);
  });
});

describe.skipIf(!RT_WASM)('with the real rt.wasm', () => {
  it('renders the fixture to the native hash through the page code', async () => {
    const rt = await loadRt();
    const { image } = renderWithPasses(rt, fixture, 160, 120, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned(SECTION_TESTS, 'PINNED_Q1_SECTION_4SPP'));
  });

  it('cuts the bottle the page writes, and caps it only when the page says so', async () => {
    const rt = await loadRt();
    // The bottle seen from the front, cut through its axis by a plane across the view (the front half goes).
    const base = exampleState();
    const cam = base.camera.cameras[base.camera.active];
    const framed = apply(base, { type: 'camera/set', id: cam.id, patch: { azimuth: 0, elevation: 0, distance: 400, target: [0, 0, 60], focalMm: 60, fstop: 0 } });
    const rendered = (s: ReturnType<typeof exampleState>) => {
      const { image } = renderWithPasses(rt, writeRsb(projectScene(s, { ...view, width: 120, height: 160 }).scene), 120, 160, 8, 0);
      return resolveRgb(image, 8);
    };
    const differ = (a: Float32Array, b: Float32Array, by = 0.02) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > by) n++;
      return n;
    };
    const plane0 = apply(framed, { type: 'section/enable', enabled: true }).section!;
    const capped = rendered(apply(framed, { type: 'section/set', plane: { ...plane0, point: [0, 0, 60], cap: true } }));
    const open = rendered(apply(framed, { type: 'section/set', plane: { ...plane0, point: [0, 0, 60], cap: false } }));
    const whole = rendered(framed);
    // The front half is gone: the picture is not the whole bottle's.
    expect(differ(whole, capped)).toBeGreaterThan(500);
    // And the cut is capped or not as the page said: the engine's picture of the same cut changes with the flag.
    expect(differ(capped, open)).toBeGreaterThan(200);
    // The same state twice is the same picture: nothing about the cut is random.
    expect(differ(capped, rendered(apply(framed, { type: 'section/set', plane: { ...plane0, point: [0, 0, 60], cap: true } })), 1e-6)).toBe(0);
  });
});

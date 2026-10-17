// The camera's optics (phase O1, STUDIO-TOOLS §1 mode 1): the project's side (core/optics.ts), the LENS section of
// the RSB writer (io/rsb.ts) byte for byte with rt-core, the pupil pictures (core/aperture.ts, io/aperture.ts),
// cameras saved before O1 (they open and render exactly as before), and, with the real rt.wasm, the engine's pinned
// image of the O1 scene and of a bokeh thumbnail (tools/bokeh-scene.mjs, tools/bokeh-thumbs.mjs).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APERTURE_SIZE, combinePictures, getAperturePicture, halve, registerAperturePicture } from '../src/core/aperture';
import { makeCamera, type CameraState } from '../src/core/camera';
import { createInitialState } from '../src/core/store';
import { OPTICS_NEUTRAL, isNeutralOptics, normalizeOptics, opticsForBokeh, opticsOf, opticsPictures } from '../src/core/optics';
import { BOKEH_NEUTRAL, BOKEH_TYPES, bokehParams } from '../src/data/bokeh';
import { decodeGreyPng, loadAperturePicture, picturePixels } from '../src/io/aperture';
import { migrateProject } from '../src/io/project';
import { cameraToRsb, frameFieldMm, lensToRsb, MASK_APERTURE, MASK_NONE, MASK_TEXTURE, projectScene, writeRsb, type RsbScene } from '../src/io/rsb';
import { readRsb, sections } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';
import * as scene from '../tools/bokeh-scene.mjs';

const bokehData = JSON.parse(readFileSync('src/data/bokeh.json', 'utf8'));
const lensCatalogue = JSON.parse(readFileSync('tests/fixtures/lens-catalogue.json', 'utf8'));

/** The pictures of public/assets/aperture as the page gets them (io/aperture.ts), registered once. */
async function registerAll(): Promise<void> {
  const ids = new Set(BOKEH_TYPES.flatMap((t) => [t.thin, ...t.variants.map((v) => bokehParams(t, v.key))]).flatMap((p) => (p ? [p.mask, p.texture] : [])).filter((x): x is string => !!x));
  for (const id of ids) {
    if (getAperturePicture(id)) continue;
    const file = `public/assets/aperture/${id.replace(/_/g, '-')}.png`;
    registerAperturePicture(id, await picturePixels(new Uint8Array(readFileSync(file))));
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const camera = (patch: Partial<CameraState> = {}): CameraState => ({ ...makeCamera('cam1', '', 200), ...patch });

describe('the optics of a camera', () => {
  it('a camera without optics is the neutral thin lens, and the neutral optics write no LENS section', () => {
    const cam = camera();
    expect(cam.optics).toBeUndefined();
    expect(opticsOf(cam)).toBe(OPTICS_NEUTRAL);
    expect(isNeutralOptics(undefined)).toBe(true);
    expect(isNeutralOptics(OPTICS_NEUTRAL)).toBe(true);
    expect(cameraToRsb(cam, 1600, 900, 1600, 900).lens).toBeUndefined();
    expect(cameraToRsb({ ...cam, optics: { ...OPTICS_NEUTRAL } }, 1600, 900, 1600, 900).lens).toBeUndefined();
    // Any knob makes it a lens; tilt and shift too.
    for (const patch of [{ blades: 6 }, { profile: 'apodized' as const }, { obstruction: 0.3 }, { catsEye: 0.2 }, { squeeze: 2 }, { caAmount: 0.1 }, { swirl: 0.1 }, { shiftYMm: 3 }, { tiltDeg: 2 }, { mask: 'heart' }, { texture: 'dust' }]) {
      expect(isNeutralOptics({ ...OPTICS_NEUTRAL, ...patch }), JSON.stringify(patch)).toBe(false);
    }
  });

  it('a bokeh type sets its thin-lens parameters and keeps the tilt and shift; a traced one puts its lens on (O2), wave optics is not offered', () => {
    const base = { ...OPTICS_NEUTRAL, tiltDeg: 3, shiftXMm: -2 };
    for (const t of BOKEH_TYPES) {
      const o = opticsForBokeh(base, t.key);
      if (t.requires === 'wave') {
        expect(o, t.key).toBeNull();
        continue;
      }
      if (t.requires === 'traced') {
        // The traced lens's own: it goes on, and the simple lens's bokeh type stays for when the camera comes back (O4).
        expect(o?.traced?.key, t.key).toBe(t.lens);
        expect([o!.bokeh, o!.tiltDeg, o!.shiftXMm]).toEqual([null, 3, -2]);
        continue;
      }
      expect(o!.bokeh).toBe(t.key);
      expect([o!.tiltDeg, o!.shiftXMm]).toEqual([3, -2]);
      for (const [k, v] of Object.entries(t.thin!)) expect((o as unknown as Record<string, unknown>)[k], `${t.key}.${k}`).toBe(v);
      for (const v of t.variants) {
        const ov = opticsForBokeh(base, t.key, v.key)!;
        expect(ov.variant).toBe(v.key);
        for (const [k, x] of Object.entries(bokehParams(t, v.key)!)) expect((ov as unknown as Record<string, unknown>)[k], `${t.key}/${v.key}.${k}`).toBe(x);
      }
    }
  });

  it('normalises what a file holds to the engine’s limits', () => {
    const n = normalizeOptics({ blades: 2, roundness: 3, obstruction: 1, squeeze: 9, tiltDeg: 80, profile: 'weird', caAmount: -1, shiftXMm: 1e9, mask: '', bokeh: 'bubble' });
    expect([n.blades, n.roundness, n.obstruction, n.squeeze, n.tiltDeg, n.profile, n.caAmount, n.shiftXMm, n.mask, n.bokeh]).toEqual([0, 1, 0.95, 4, 12, 'uniform', 0, 24, null, 'bubble']);
    expect(normalizeOptics({ blades: 6.4 }).blades).toBe(6);
    expect(normalizeOptics(null)).toEqual({ ...OPTICS_NEUTRAL });
  });
});

describe('the LENS section', () => {
  it('reads the O1 fixture written by rt and writes it back to the same bytes', () => {
    const o1 = new Uint8Array(readFileSync('tests/fixtures/o1.rsb'));
    const r = readRsb(o1);
    expect(r.tags.slice(0, 2)).toEqual(['CAMR', 'LENS']);
    const lens = r.camera!.lens!;
    expect([lens.blades, lens.maskKind, lens.maskWidth, lens.maskHeight, lens.mask.length]).toEqual([7, MASK_TEXTURE, 48, 48, 48 * 48]);
    expect(lens.squeeze).toBeCloseTo(1.33, 6);
    const back: RsbScene = { camera: r.camera!, materials: r.materials, meshes: r.meshes, instances: r.instances, lights: r.lights, environment: r.environment!, floor: r.floor!, render: r.render!, bitmaps: r.bitmaps };
    const bytes = writeRsb(back);
    expect(bytes.length).toBe(o1.length);
    expect(sameBytes(bytes, o1)).toBe(true);
  });

  it('measures the field from the output frame, whatever part of the viewport the image covers', () => {
    expect(frameFieldMm(1600, 900)).toBeCloseTo(Math.hypot(36, 20.25) / 2, 9);
    expect(frameFieldMm(900, 1600)).toBeCloseTo(Math.hypot(20.25, 36) / 2, 9);
    const cam = camera({ optics: { ...OPTICS_NEUTRAL, catsEye: 0.5 } });
    const out = cameraToRsb(cam, 1600, 900, 1600, 900).lens!;
    const view = cameraToRsb(cam, 1600, 900, 1200, 800, { viewW: 1200, viewH: 800 }).lens!;
    expect(view.fieldMm).toBe(out.fieldMm);
    expect(cameraToRsb({ ...cam, projection: 'ORTHOGRAPHIC' }, 1600, 900, 1600, 900).lens).toBeUndefined();
  });

  it('sends a mask as the aperture, a texture as a texture, both as one picture, and waits for none', async () => {
    const o = { ...OPTICS_NEUTRAL, blades: 6 };
    expect(lensToRsb({ ...o, mask: 'not_read_yet' }, 16, 9).maskKind).toBe(MASK_NONE);
    await registerAll();
    const star = lensToRsb({ ...o, mask: 'star_5' }, 16, 9);
    expect([star.maskKind, star.maskWidth, star.maskHeight, star.mask.length]).toEqual([MASK_APERTURE, APERTURE_SIZE, APERTURE_SIZE, APERTURE_SIZE ** 2]);
    expect(sameBytes(star.mask, getAperturePicture('star_5')!)).toBe(true);
    const dust = lensToRsb({ ...o, texture: 'dust' }, 16, 9);
    expect(dust.maskKind).toBe(MASK_TEXTURE);
    expect(sameBytes(dust.mask, getAperturePicture('dust')!)).toBe(true);
    // The onion rings are a modulation of the camera's amplitude: 1 − a + a·t.
    const rings = lensToRsb({ ...o, texture: 'onion_rings', onionAmplitude: 0.25 }, 16, 9);
    const t = getAperturePicture('onion_rings')!;
    for (const i of [0, 5000, 33000, 40000]) expect(rings.mask[i]).toBe(Math.round((255 * (255 * 0.75 + 0.25 * t[i])) / 255));
    const both = lensToRsb({ ...o, mask: 'heart', texture: 'dust' }, 16, 9);
    expect(both.maskKind).toBe(MASK_APERTURE);
    expect(sameBytes(both.mask, combinePictures(getAperturePicture('heart')!, getAperturePicture('dust')!, 1))).toBe(true);
    expect(opticsPictures({ ...o, mask: 'heart', texture: 'dust' })).toEqual(['heart', 'dust']);
  }, 60000);

  it('reads the pictures exactly: the PNG decoder, the 2 × 2 average, and a missing file draws the iris', async () => {
    const { width, height, pixels } = await decodeGreyPng(new Uint8Array(readFileSync('public/assets/aperture/heart.png')));
    expect([width, height]).toEqual([512, 512]);
    // The index's canonical hash is of these raw pixels.
    const index = JSON.parse(readFileSync('public/assets/aperture/index.json', 'utf8')) as { masks: { id: string; pixelsSha256: string }[] };
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(pixels).digest('hex')).toBe(index.masks.find((m) => m.id === 'heart')!.pixelsSha256);
    // The 2 × 2 average, rounded half up, pixel for pixel (the edge has sums that round).
    const half = halve(pixels, 512);
    let rounded = 0;
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const sum = pixels[2 * y * 512 + 2 * x] + pixels[2 * y * 512 + 2 * x + 1] + pixels[(2 * y + 1) * 512 + 2 * x] + pixels[(2 * y + 1) * 512 + 2 * x + 1];
        if (half[y * 256 + x] !== Math.round(sum / 4)) throw new Error(`pixel (${x}, ${y}): ${half[y * 256 + x]} for a sum of ${sum}`);
        if (sum % 4 >= 2) rounded++;
      }
    expect(rounded).toBeGreaterThan(100);
    expect(await loadAperturePicture('no_such_mask', async () => new Response(null, { status: 404 }))).toBe(false);
  }, 30000);

  it('the bokeh scene of the thumbnails writes the LENS section the page writes, for every type', async () => {
    await registerAll();
    const base = emptyScene();
    for (const th of scene.thumbnails(bokehData) as { key: string; variant: string | null; lens?: string }[]) {
      const o = opticsForBokeh(OPTICS_NEUTRAL, th.key, th.variant)!;
      const page = lensToRsb(o, 128, 96);
      // O2: a type of the traced lens with its catalogue lens, rt's bytes (tests/fixtures/lens-catalogue.json).
      const traced = th.lens ? scene.catalogueLens(lensCatalogue, th.lens) : null;
      const tool = scene.lensFields(scene.bokehParams(bokehData, th.key, th.variant), [128, 96], (id: string) => getAperturePicture(id) ?? null, traced);
      expect(sameBytes(scene.lensPayload(tool), sectionPayload(writeRsb({ ...base, camera: { ...base.camera, lens: page } }), 'LENS')), `${th.key}/${th.variant}`).toBe(true);
    }
  }, 60000);
});

describe('the bokeh thumbnails', () => {
  const index = JSON.parse(readFileSync('public/thumbs/bokeh/index.json', 'utf8')) as { thumbs: { key: string; variant: string | null; file: string; width: number; height: number; samples: number; thin: unknown; lens?: string; rsbSha256: string }[] };

  it('cover every type the thin lens or a traced lens can do and every variant, and not wave optics', () => {
    const want = scene.thumbnails(bokehData).map((t: { file: string }) => t.file).sort();
    expect(index.thumbs.map((t) => t.file).sort()).toEqual(want);
    for (const t of BOKEH_TYPES) {
      const has = index.thumbs.some((x) => x.key === t.key);
      expect(has, t.key).toBe(t.requires !== 'wave');
    }
    for (const t of index.thumbs) expect(readFileSync(`public/thumbs/bokeh/${t.file}`).subarray(1, 4).toString(), t.file).toBe('PNG');
  });

  it('are current: each was rendered from the scene and the parameters the data give today', async () => {
    await registerAll();
    const { createHash } = await import('node:crypto');
    for (const t of index.thumbs) {
      const type = BOKEH_TYPES.find((x) => x.key === t.key)!;
      // A type of the traced lens: its lens, and the thin lens's neutral knobs (the lens makes its bokeh).
      expect(t.lens, t.file).toBe(type.requires === 'traced' ? type.lens : undefined);
      expect(t.thin, t.file).toEqual(type.requires === 'traced' ? BOKEH_NEUTRAL : bokehParams(type, t.variant ?? undefined));
      const traced = t.lens ? scene.catalogueLens(lensCatalogue, t.lens) : null;
      const rsb: Uint8Array = scene.bokehScene(t.thin, [t.width, t.height], t.samples, (id: string) => getAperturePicture(id) ?? null, undefined, undefined, traced);
      expect(createHash('sha256').update(rsb).digest('hex'), `${t.file}: run node tools/bokeh-thumbs.mjs`).toBe(t.rsbSha256);
    }
  }, 60000);
});

function emptyScene(): RsbScene {
  const s = projectScene(createInitialState(), { width: 16, height: 16, maxSamples: 1, maxSeconds: 0 }).scene;
  return { ...s, camera: { ...s.camera } };
}

function sectionPayload(bytes: Uint8Array, tag: string): Uint8Array {
  const s = sections(bytes).find((x) => x.tag === tag)!;
  return new Uint8Array(s.payload.buffer, s.payload.byteOffset, s.payload.byteLength);
}

describe('cameras saved before O1', () => {
  it('open without optics and write the same RSB as a camera that never had any', () => {
    const file = JSON.parse(readFileSync('tests/fixtures/project-v2.json', 'utf8'));
    const state = migrateProject(file);
    for (const cam of Object.values(state.camera.cameras)) expect('optics' in cam, cam.id).toBe(false);
    const view = { width: 64, height: 36, maxSamples: 1, maxSeconds: 0 };
    const bytes = writeRsb(projectScene(state, view).scene);
    expect(sections(bytes).some((s) => s.tag === 'LENS')).toBe(false);
    // The same project with the neutral optics on every camera: the same bytes.
    const neutral = { ...state, camera: { ...state.camera, cameras: Object.fromEntries(Object.entries(state.camera.cameras).map(([id, c]) => [id, { ...c, optics: { ...OPTICS_NEUTRAL } }])) } };
    expect(sameBytes(writeRsb(projectScene(neutral, view).scene), bytes)).toBe(true);
  });

  it('a project with optics keeps them through a save, normalised', () => {
    const file = JSON.parse(readFileSync('tests/fixtures/project-v2.json', 'utf8'));
    const id = Object.keys(file.state.camera.cameras)[0];
    file.state.camera.cameras[id].optics = { bokeh: 'bubble', profile: 'ringBright', profileParam: 2, tiltDeg: 1.5 };
    const state = migrateProject(file);
    const o = state.camera.cameras[id].optics!;
    expect([o.bokeh, o.profile, o.profileParam, o.tiltDeg, o.squeeze]).toEqual(['bubble', 'ringBright', 1, 1.5, 1]);
  });
});

describe.skipIf(!RT_WASM)('the real rt.wasm', () => {
  it('renders the O1 fixture to the native engine’s pinned hash', async () => {
    const rt = await loadRt();
    const rsb = new Uint8Array(readFileSync('tests/fixtures/o1.rsb'));
    const { image } = renderWithPasses(rt, rsb, 256, 192, 4, 0);
    expect(fnv1a(resolveRgb(image, 4)).toString(16)).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_O1_LENS_4SPP').toString(16));
  }, 120000);

  it('renders a bokeh thumbnail scene, the curved polygon, to its pinned hash (4 spp)', async () => {
    await registerAll();
    const rt = await loadRt();
    const rsb: Uint8Array = scene.bokehScene(scene.bokehParams(bokehData, 'polygon', 'curved'), [128, 96], 4, (id: string) => getAperturePicture(id) ?? null);
    const { image } = renderWithPasses(rt, rsb, 128, 96, 4, 0);
    expect(fnv1a(resolveRgb(image, 4)).toString(16)).toBe(PINNED_BOKEH_THUMB.toString(16));
  }, 120000);
});

/** FNV-1a of the curved polygon's thumbnail scene at 4 samples (tools/bokeh-scene.mjs). */
const PINNED_BOKEH_THUMB = 0xfa8496aa;

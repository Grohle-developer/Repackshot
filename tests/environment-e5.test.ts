// Phase E5 on the interface side: the sky the preview draws (core/sky.ts) against the engine's, the
// placement of a background image (core/images.ts), the environment images inside a project file
// (io/project.ts) and the messages for an image the environment cannot take (ui/commands.ts).

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOME_FLOOR, DOME_HORIZON, DOME_ZENITH } from '../src/data/environment';
import { fitImageRect, getImage, imageIdsInUse, registerImage, retainImages } from '../src/core/images';
import { skySunDirection } from '../src/core/lighting';
import { panoramaDirection, preetham, SKY_HEIGHT, SKY_WIDTH, skyImage } from '../src/core/sky';
import { createInitialState, type ProjectState } from '../src/core/store';
import { ImageFileError, loadBackplate, loadHdri, type PixelDecoder } from '../src/io/hdri';
import { loadProject, readProjectFile, serializeProject } from '../src/io/project';
import { imageErrorText, isHdriFile } from '../src/ui/commands';
import { setLang } from '../src/ui/strings';

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('the sky of the preview', () => {
  const params = { sunAzimuthDeg: -40, sunElevationDeg: 35, turbidity: 3, floor: DOME_FLOOR, horizon: DOME_HORIZON, zenith: DOME_ZENITH, strength: 1 };

  it('is the engine’s, pixel for pixel (rt-core environment.rs `sky_image`, same parameters)', () => {
    const rgb = skyImage(params);
    expect(rgb.length).toBe(3 * SKY_WIDTH * SKY_HEIGHT);
    // Printed by the engine for these parameters (f32 and its own transcendental functions).
    const engine: [number, number, [number, number, number]][] = [
      [0, 0, [0.3049363, 0.5080962, 0.9906215]],
      [128, 20, [0.5617244, 0.7857973, 1.4046196]],
      [64, 60, [0.6278363, 0.635421, 0.72683686]],
      [200, 63, [0.96382624, 0.7951886, 0.83648103]],
      [100, 40, [0.41222528, 0.63499886, 1.1070102]],
      [10, 100, [0.12, 0.12, 0.12]],
    ];
    for (const [x, y, c] of engine) {
      const i = 3 * (y * SKY_WIDTH + x);
      for (let k = 0; k < 3; k++) expect(Math.abs(rgb[i + k] / c[k] - 1), `pixel ${x}, ${y}`).toBeLessThan(1e-5);
    }
  });

  it('lights a horizontal surface like the studio dome of the same values, over a ground of floor x strength', () => {
    for (const strength of [1, 0.4]) {
      const rgb = skyImage({ ...params, strength });
      let e = 0;
      const cell = (Math.PI / SKY_HEIGHT) * ((2 * Math.PI) / SKY_WIDTH);
      for (let y = 0; y < SKY_HEIGHT / 2; y++) {
        for (let x = 0; x < SKY_WIDTH; x++) {
          const d = panoramaDirection(x, y, SKY_WIDTH, SKY_HEIGHT);
          const i = 3 * (y * SKY_WIDTH + x);
          e += lum([rgb[i], rgb[i + 1], rgb[i + 2]]) * d[2] * Math.sin(Math.PI * ((y + 0.5) / SKY_HEIGHT)) * cell;
        }
      }
      expect(e).toBeCloseTo(strength * 2 * Math.PI * (DOME_HORIZON / 6 + DOME_ZENITH / 3), 4);
      expect(rgb[3 * (SKY_HEIGHT - 1) * SKY_WIDTH]).toBeCloseTo(DOME_FLOOR * strength, 6);
    }
  });

  it('is darker and bluer at the zenith than at the horizon away from the sun, brightest around the sun', () => {
    const sky = preetham(0, 20, 3);
    const zenith = sky([0, 0, 1]);
    const horizon = sky([-Math.cos(0.1), 0, Math.sin(0.1)]);
    expect(lum(zenith)).toBeLessThan(lum(horizon));
    expect(zenith[2] / zenith[0]).toBeGreaterThan(horizon[2] / horizon[0]);
    const near = sky([Math.cos((21 * Math.PI) / 180), 0, Math.sin((21 * Math.PI) / 180)]);
    expect(lum(near)).toBeGreaterThan(lum(zenith));
    // Hazier is whiter: less blue over red at the zenith.
    const hazy = preetham(0, 20, 8)([0, 0, 1]);
    expect(hazy[2] / hazy[0]).toBeLessThan(zenith[2] / zenith[0]);
  });

  it('lays the panorama out in the engine’s convention: u = ½ + atan2(-y, x) / 2π, v = acos(z) / π', () => {
    const [w, h] = [64, 32];
    for (const [x, y] of [[0, 0], [17, 5], [40, 20], [63, 31]]) {
      const d = panoramaDirection(x, y, w, h);
      expect(Math.hypot(...d)).toBeCloseTo(1, 9);
      let u = 0.5 + Math.atan2(-d[1], d[0]) / (2 * Math.PI);
      u -= Math.floor(u);
      expect(u).toBeCloseTo((x + 0.5) / w, 9);
      expect(Math.acos(d[2]) / Math.PI).toBeCloseTo((y + 0.5) / h, 9);
    }
  });

  it('takes its sun from the setup’s sun light, else from the environment', () => {
    const s = createInitialState();
    const own = { ...s, environment: { ...s.environment, skySun: { az: 30, el: 40 } }, studio: { ...s.studio, lights: [] } };
    const d = skySunDirection(own);
    expect(Math.asin(d[2]) * (180 / Math.PI)).toBeCloseTo(40, 6);
    const sun = { ...s.studio.lights[0], type: 'SUN' as const, enabled: true, power: 1, az: -55, el: 12 };
    const lit = { ...own, studio: { ...own.studio, lights: [sun] } };
    expect(Math.asin(skySunDirection(lit)[2]) * (180 / Math.PI)).toBeCloseTo(12, 6);
    // A sun light that is off does not count.
    expect(Math.asin(skySunDirection({ ...lit, studio: { ...lit.studio, lights: [{ ...sun, enabled: false }] } })[2]) * (180 / Math.PI)).toBeCloseTo(40, 6);
  });
});

describe('placing a background image in the frame', () => {
  const frame = { x: 10, y: 20, width: 400, height: 200 };
  it('fill covers the frame and crops the longer side, fit shows all of it, stretch squeezes it', () => {
    // An image wider than the frame (4:1 in 2:1).
    expect(fitImageRect('FILL', 400, 100, frame)).toEqual({ x: -190, y: 20, width: 800, height: 200 });
    expect(fitImageRect('FIT', 400, 100, frame)).toEqual({ x: 10, y: 70, width: 400, height: 100 });
    // An image taller than the frame (1:1 in 2:1).
    expect(fitImageRect('FILL', 300, 300, frame)).toEqual({ x: 10, y: -80, width: 400, height: 400 });
    expect(fitImageRect('FIT', 300, 300, frame)).toEqual({ x: 110, y: 20, width: 200, height: 200 });
    expect(fitImageRect('STRETCH', 300, 300, frame)).toEqual(frame);
    // Nothing to fit.
    expect(fitImageRect('FILL', 0, 300, frame)).toEqual(frame);
  });
});

describe('environment images in a project file', () => {
  const plateDecoder: PixelDecoder = async () => ({ width: 2, height: 1, rgba: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]) });
  const withImages = async (): Promise<ProjectState> => {
    const s = createInitialState();
    const hdri = await loadHdri('studio.hdr', fixture('studio.hdr'), 'hdri:1');
    const plate = await loadBackplate('plate.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), plateDecoder, 'plate:1');
    return { ...s, environment: { ...s.environment, kind: 'HDRI', hdri, background: 'BACKPLATE', backplate: plate, backplateFit: 'FIT', skyTurbidity: 4.5, skySun: { az: 12, el: 34 } } };
  };
  beforeEach(() => retainImages([]));

  it('are written as their files and come back in a new session, with the environment as it was', async () => {
    const s = await withImages();
    const file = serializeProject(s);
    const body = JSON.parse(await file.text());
    expect(body.images.map((e: { id: string; name: string }) => [e.id, e.name])).toEqual([
      ['hdri:1', 'studio.hdr'],
      ['plate:1', 'plate.png'],
    ]);
    retainImages([]);
    const out = await readProjectFile(file, plateDecoder);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.warnings).toEqual([]);
    expect(out.state.environment).toEqual(s.environment);
    expect(getImage('hdri:1')!.bytes).toEqual(fixture('studio.hdr'));
    expect(getImage('hdri:1')!.linear!.length).toBe(3 * 1024 * 512);
    expect(Array.from(getImage('plate:1')!.rgba8!)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('a file without images writes no images block', async () => {
    const body = JSON.parse(await serializeProject(createInitialState()).text());
    expect('images' in body).toBe(false);
    expect(imageIdsInUse(createInitialState().environment)).toEqual([]);
  });

  it('never replaces another image that has the file’s id (ids are numbered per session)', async () => {
    const file = serializeProject(await withImages());
    retainImages([]);
    registerImage('hdri:1', 'other.hdr', { format: 'HDR', bytes: new Uint8Array([1, 2, 3]), width: 1, height: 1, linear: new Float32Array(3) });
    const out = await readProjectFile(file, plateDecoder);
    if (!out.ok) throw new Error('did not open');
    expect(out.state.environment.hdri!.id).not.toBe('hdri:1');
    expect(getImage('hdri:1')!.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(getImage(out.state.environment.hdri!.id)!.bytes).toEqual(fixture('studio.hdr'));
    // The same bytes under the same id are reused.
    const again = await readProjectFile(file, plateDecoder);
    if (!again.ok) throw new Error('did not open');
    expect(again.state.environment.backplate!.id).toBe('plate:1');
  });

  it('an image that is missing or does not decode is dropped and reported, and the project still opens', async () => {
    const body = JSON.parse(await serializeProject(await withImages()).text());
    body.images = [{ ...body.images[0], file: 'AAAA' }];
    retainImages([]);
    const out = await readProjectFile(new Blob([JSON.stringify(body)]), plateDecoder);
    if (!out.ok) throw new Error('did not open');
    expect(out.warnings).toEqual([{ code: 'MISSING_IMAGES', count: 2 }]);
    expect(out.state.environment.hdri).toBeNull();
    expect(out.state.environment.backplate).toBeNull();
    expect(out.state.environment.kind).toBe('HDRI');
  });

  it('a project from before E5 opens with the new fields at their defaults; a damaged ref is damage', async () => {
    const body = JSON.parse(await serializeProject(createInitialState()).text());
    const env = body.state.environment;
    for (const k of ['hdri', 'backplate', 'backplateFit', 'skyTurbidity', 'skySun']) delete env[k];
    const old = loadProject(JSON.stringify(body)).state.environment;
    expect([old.hdri, old.backplate, old.backplateFit, old.skyTurbidity, old.skySun]).toEqual([null, null, 'FILL', 3, { az: -55, el: 55 }]);
    env.hdri = { id: 7 };
    expect(() => loadProject(JSON.stringify(body))).toThrow(/environment.hdri/);
    env.hdri = null;
    env.skySun = { az: 'west', el: 3 };
    expect(() => loadProject(JSON.stringify(body))).toThrow(/skySun/);
  });
});

describe('telling the person about an image file', () => {
  it('names the file and what is wrong, in both languages', () => {
    expect(imageErrorText('a.tif', new ImageFileError('FORMAT', 'x'), false)).toMatch(/a\.tif.*\.hdr or \.exr/);
    expect(imageErrorText('a.gif', new ImageFileError('FORMAT', 'x'), true)).toMatch(/\.png, \.jpg or \.webp/);
    expect(imageErrorText('a.exr', new ImageFileError('UNSUPPORTED', 'PIZ compression'), false)).toMatch(/a\.exr.*PIZ compression/);
    setLang('es');
    expect(imageErrorText('a.exr', new ImageFileError('TOO_LARGE', 'x'), false)).toBe('a.exr es demasiado grande.');
    expect(imageErrorText('a.exr', new Error('cut'), false)).toBe('No se pudo leer a.exr (cut).');
    setLang('en');
    expect(isHdriFile(new File([], 'studio.HDR'))).toBe(true);
    expect(isHdriFile(new File([], 'part.step'))).toBe(false);
  });
});

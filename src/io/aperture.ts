// Reading the pupil pictures of public/assets/aperture/ (phase O1) into core/aperture.ts: the files are 8-bit grey,
// non-interlaced PNGs written by tools/assets/aperture-masks.mjs, decoded here exactly (inflate and the five PNG
// filters, no canvas and no colour management), so the engine gets the same bytes in every browser and in Node, and
// halved to the engine's 256 × 256 by a 2 × 2 average.

import { APERTURE_SIZE, apertureFile, getAperturePicture, halve, registerAperturePicture } from '../core/aperture';
import { opticsPictures } from '../core/optics';
import type { ProjectState } from '../core/store';

/** Inflates a zlib stream with the platform's DecompressionStream. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The pixels of an 8-bit grey, non-interlaced PNG. */
export async function decodeGreyPng(png: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((b, i) => png[i] !== b)) throw new Error('not a PNG');
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8;
  let width = 0;
  let height = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    if (o + 8 > png.length) throw new Error('truncated PNG');
    const len = v.getUint32(o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    if (type === 'IHDR') {
      width = v.getUint32(o + 8);
      height = v.getUint32(o + 12);
      if (png[o + 16] !== 8 || png[o + 17] !== 0 || png[o + 20] !== 0) throw new Error('an aperture picture is an 8-bit grey PNG');
    } else if (type === 'IDAT') parts.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (all.set(p, at), at + p.length), 0);
  const raw = await inflate(all);
  if (raw.length < (width + 1) * height) throw new Error('truncated PNG data');
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)];
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? pixels[y * width + x - 1] : 0;
      const b = y > 0 ? pixels[(y - 1) * width + x] : 0;
      const c = x > 0 && y > 0 ? pixels[(y - 1) * width + x - 1] : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * width + x] = (raw[y * (width + 1) + 1 + x] + p) & 0xff;
    }
  }
  return { width, height, pixels };
}

/** A picture's file bytes to the engine's size: as it is at 256, halved from 512. */
export async function picturePixels(png: Uint8Array): Promise<Uint8Array> {
  const { width, height, pixels } = await decodeGreyPng(png);
  if (width === APERTURE_SIZE && height === APERTURE_SIZE) return pixels;
  if (width === APERTURE_SIZE * 2 && height === APERTURE_SIZE * 2) return halve(pixels, width);
  throw new Error(`an aperture picture is ${APERTURE_SIZE * 2} or ${APERTURE_SIZE} pixels square, not ${width} x ${height}`);
}

const pending = new Map<string, Promise<boolean>>();

/** Reads the picture `id` (once); true when it is there. A failure is reported and the lens draws its iris instead. */
export function loadAperturePicture(id: string, fetcher: (url: string) => Promise<Response> = (u) => fetch(u)): Promise<boolean> {
  if (getAperturePicture(id)) return Promise.resolve(true);
  const known = pending.get(id);
  if (known) return known;
  const base = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL : '/';
  const job = (async () => {
    try {
      const res = await fetcher(`${base}assets/aperture/${apertureFile(id)}`);
      if (!res.ok) throw new Error(`${res.status}`);
      registerAperturePicture(id, await picturePixels(new Uint8Array(await res.arrayBuffer())));
      return true;
    } catch (err) {
      console.warn(`aperture picture ${id}:`, err);
      pending.delete(id);
      return false;
    }
  })();
  pending.set(id, job);
  return job;
}

/** Reads every picture the cameras of a project use (a project opened, an undo): the render waits for none. */
export function loadCameraPictures(state: ProjectState): void {
  for (const cam of Object.values(state.camera.cameras)) for (const id of opticsPictures(cam.optics)) void loadAperturePicture(id);
}

// Image registry (phase E5): the HDRI and the background image of the environment. Like the
// meshes (core/meshes.ts), the bytes are large and immutable, so they live here, keyed by id,
// and the project state only keeps a small `ImageRef`. The file's own bytes are kept (they are
// what the engine reads, RSB `BMAP`, and what a project file embeds); a background image also
// keeps its decoded 8-bit pixels (the engine has no PNG or JPEG reader), and an HDRI the linear
// pixels the preview shows, at most PREVIEW_HDRI_WIDTH wide.

export type ImageId = string;

/** What the state keeps about an image. */
export interface ImageRef {
  id: ImageId;
  /** File name, for the inspector. */
  name: string;
  width: number;
  height: number;
}

/** The file formats an image comes from. */
export type ImageFormat = 'HDR' | 'EXR' | 'PNG' | 'JPEG' | 'WEBP';

export interface ImageData {
  format: ImageFormat;
  /** The file as it was read. */
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Background images: straight RGBA, 8 bits, sRGB, rows from the top. */
  rgba8?: Uint8Array;
  /** Texture images (M2a): how many channels the file's pixels have (1, 3 or 4; core/image-header.ts). */
  channels?: 1 | 3 | 4;
  /** HDRIs: linear RGB floats for the preview, rows from the top (`previewWidth` x `previewHeight`). */
  linear?: Float32Array;
  previewWidth?: number;
  previewHeight?: number;
}

/** Widest panorama the preview keeps (larger ones are averaged down). */
export const PREVIEW_HDRI_WIDTH = 2048;

const registry = new Map<ImageId, ImageData>();

/** Stores an image under `id` and returns its ref. As for meshes, an id names one image for as long as it is registered. */
export function registerImage(id: ImageId, name: string, data: ImageData): ImageRef {
  registry.set(id, data);
  return { id, name, width: data.width, height: data.height };
}

export function getImage(id: ImageId): ImageData | undefined {
  return registry.get(id);
}

export function unregisterImage(id: ImageId): void {
  registry.delete(id);
}

/** Forgets every image but `keep` (a project was replaced). */
export function retainImages(keep: Iterable<ImageId>): void {
  const wanted = new Set(keep);
  for (const id of [...registry.keys()]) if (!wanted.has(id)) registry.delete(id);
}

/** A fresh id for an image of `kind`, unused in the registry. */
export function nextImageId(kind: 'hdri' | 'plate'): ImageId {
  let n = registry.size + 1;
  while (registry.has(`${kind}:${n}`)) n++;
  return `${kind}:${n}`;
}

/** The format of a file by its name, or null when it is not one the environment takes. */
export function imageFormatOf(name: string): ImageFormat | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'hdr' || ext === 'rgbe' || ext === 'pic') return 'HDR';
  if (ext === 'exr') return 'EXR';
  if (ext === 'png') return 'PNG';
  if (ext === 'jpg' || ext === 'jpeg') return 'JPEG';
  if (ext === 'webp') return 'WEBP';
  return null;
}

/** Ids of the images an environment uses. */
export function imageIdsInUse(env: { hdri?: ImageRef | null; backplate?: ImageRef | null }): ImageId[] {
  const out: ImageId[] = [];
  if (env.hdri) out.push(env.hdri.id);
  if (env.backplate) out.push(env.backplate.id);
  return out;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a background image of `imageW x imageH` lands in `frame`: STRETCH squeezes it into the frame,
 * FILL covers the frame and crops the image's longer side, FIT shows the whole image inside the frame
 * (the background colour around it). The engine's `Backplate::lookup` (rt-core integrator) the other way
 * round, so the preview and the path tracer place it alike.
 */
export function fitImageRect(fit: 'FILL' | 'FIT' | 'STRETCH', imageW: number, imageH: number, frame: Rect): Rect {
  if (fit === 'STRETCH' || !(imageW > 0 && imageH > 0) || !(frame.width > 0 && frame.height > 0)) return { ...frame };
  // r > 1: the image is wider than the frame.
  const r = imageW / imageH / (frame.width / frame.height);
  let { width, height } = frame;
  if (r > 1 !== (fit === 'FIT')) width = frame.width * r;
  else height = frame.height / r;
  return { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height };
}

/** Rows of the generated image of a GRADIENT background (L6): enough for no visible banding once stretched. */
export const GRADIENT_ROWS = 256;
/** Its width: one colour per row, a few columns so every reader takes it as an image. */
export const GRADIENT_COLUMNS = 4;

/** Linear light to an 8-bit sRGB value. */
const srgb8 = (v: number): number => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));

/**
 * The pixels of a GRADIENT background (L6): straight RGBA, 8 bits, sRGB, rows from the top, `top` at the first row
 * and `bottom` at the last, mixed in linear light. The engine stretches it over the output frame (RSB backplate).
 */
export function gradientPixels(top: readonly number[], bottom: readonly number[], width = GRADIENT_COLUMNS, height = GRADIENT_ROWS): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = height > 1 ? y / (height - 1) : 0;
    const px = [0, 1, 2].map((c) => srgb8(top[c] + (bottom[c] - top[c]) * t));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[i] = px[0];
      out[i + 1] = px[1];
      out[i + 2] = px[2];
      out[i + 3] = 255;
    }
  }
  return out;
}

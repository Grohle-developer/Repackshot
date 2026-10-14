// The pictures of the pupil (aperture masks and pupil textures, public/assets/aperture/, phase A6) as the engine
// receives them (phase O1): 8-bit grey, APERTURE_SIZE × APERTURE_SIZE, rows top to bottom, covering [−1, 1]² of
// the pupil with the unit circle inscribed. They are read once (io/aperture.ts) and kept here, outside the project
// state like the meshes and images: the project names a picture by its id only.

/** Side of a picture as the engine gets it: the 512 px files averaged 2 × 2 (a LENS section of 64 KB). */
export const APERTURE_SIZE = 256;

const pictures = new Map<string, Uint8Array>();
const listeners = new Set<(id: string) => void>();

/** The file of a picture under public/assets/aperture/ (the index's naming: `star_5` is `star-5.png`). */
export function apertureFile(id: string): string {
  return `${id.replace(/_/g, '-')}.png`;
}

/** The picture `id`, if it has been read. */
export function getAperturePicture(id: string): Uint8Array | undefined {
  return pictures.get(id);
}

/** Keeps a picture (APERTURE_SIZE² bytes) and tells the listeners. */
export function registerAperturePicture(id: string, pixels: Uint8Array): void {
  if (pixels.length !== APERTURE_SIZE * APERTURE_SIZE) throw new Error(`aperture picture ${id}: ${pixels.length} bytes`);
  pictures.set(id, pixels);
  for (const fn of listeners) fn(id);
}

/** Called with the id of every picture registered from now on; returns the unsubscribe function. */
export function onAperturePicture(fn: (id: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A 2 × 2 box average of an 8-bit grey picture of twice the size (exact integer rounding, the same everywhere). */
export function halve(src: Uint8Array | Uint8ClampedArray, size: number, channels = 1): Uint8Array {
  const half = size >> 1;
  const out = new Uint8Array(half * half);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const at = (xx: number, yy: number) => src[(yy * size + xx) * channels];
      const sum = at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1);
      out[y * half + x] = (sum + 2) >> 2;
    }
  }
  return out;
}

/**
 * The single picture the engine gets for a mask (replacing the iris) and a texture (multiplied with it, an onion-ring
 * texture at `amount`: 1 − a + a·t), or null when a picture the optics need is not read yet.
 */
export function combinePictures(mask: Uint8Array | null, texture: Uint8Array | null, amount: number): Uint8Array {
  const n = APERTURE_SIZE * APERTURE_SIZE;
  const out = new Uint8Array(n);
  const a = Math.min(1, Math.max(0, amount));
  for (let i = 0; i < n; i++) {
    let v = mask ? mask[i] : 255;
    if (texture) v = Math.round((v * (255 * (1 - a) + a * texture[i])) / 255);
    out[i] = v;
  }
  return out;
}

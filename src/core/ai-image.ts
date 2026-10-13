// Linear images for the AI step (core/ai.ts `LinearImage`): the 8-bit display images of the Fast-mode preview
// and of a finished render become linear light for the service, and the service's image goes back to 8 bits
// for the screen and the files. The sRGB transfer function, exact in both directions: every byte survives
// decode → encode unchanged, which is what lets an AI step that changes nothing give back the very same file.

import type { LinearImage } from './ai';

/** sRGB electro-optical transfer function: display value 0..1 to linear light. */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** The inverse: linear light to a display value (not clamped above 1; negative values give 0). */
export function linearToSrgb(v: number): number {
  if (!(v > 0)) return 0;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

const BYTE_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i / 255);
  return t;
})();

/** A display byte as linear light. */
export function byteToLinear(b: number): number {
  return BYTE_TO_LINEAR[b & 255];
}

/** A linear value as a display byte, rounded and clamped. */
export function linearToByte(v: number): number {
  const s = linearToSrgb(v);
  return s >= 1 ? 255 : Math.round(s * 255);
}

/** 8-bit straight RGBA (a decoded image, row-major from the top) as a linear image; alpha stays 0..1. */
export function rgba8ToLinear(data: ArrayLike<number>, width: number, height: number): LinearImage {
  const rgba = new Float32Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = BYTE_TO_LINEAR[data[i] & 255];
    rgba[i + 1] = BYTE_TO_LINEAR[data[i + 1] & 255];
    rgba[i + 2] = BYTE_TO_LINEAR[data[i + 2] & 255];
    rgba[i + 3] = (data[i + 3] & 255) / 255;
  }
  return { width, height, rgba };
}

/** A linear image as 8-bit straight RGBA. */
export function linearToRgba8(img: LinearImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = linearToByte(img.rgba[i]);
    out[i + 1] = linearToByte(img.rgba[i + 1]);
    out[i + 2] = linearToByte(img.rgba[i + 2]);
    const a = img.rgba[i + 3];
    out[i + 3] = a >= 1 ? 255 : a > 0 ? Math.round(a * 255) : 0;
  }
  return out;
}

/** Relative luminance (Rec. 709 weights) of linear RGB. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whether two linear images are the same bit for bit. */
export function sameImage(a: LinearImage, b: LinearImage): boolean {
  if (a.width !== b.width || a.height !== b.height || a.rgba.length !== b.rgba.length) return false;
  for (let i = 0; i < a.rgba.length; i++) if (!Object.is(a.rgba[i], b.rgba[i])) return false;
  return true;
}

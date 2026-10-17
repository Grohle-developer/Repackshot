// The camera track's fade to a colour on a rendered frame (phase N1, SPEC §3.7 "Fundidos"): the engine renders the
// shot as it is, and the frame is mixed with the colour by the fade's amount at that instant (core/animation.ts
// `shotFadeAt`). On a display picture (8 or 16 bits, the curve applied) the mix is in the picture's own values, so a
// fade to white ends white whatever the curve; on scene-linear light (EXR, a float TIFF, DNG, exposure applied) it is
// in linear light, towards the colour at that exposure (white is 1). Alpha goes towards opaque: a frame faded all
// the way is the colour, even over a transparent background. Pure.

import type { FadeToColor } from './animation';

/** A display picture, RGBA, mixed with the fade's colour in place of a copy (`max`: 255 for bytes, 65535 for words). */
export function fadeDisplay<T extends Uint8ClampedArray | Uint8Array | Uint16Array>(px: T, fade: FadeToColor | null | undefined, max: number): T {
  if (!fade || !(fade.amount > 0)) return px;
  const a = Math.min(1, fade.amount);
  const out = px.slice() as T;
  const c = [fade.color[0] * max, fade.color[1] * max, fade.color[2] * max, max];
  for (let i = 0; i < out.length; i += 4) {
    for (let k = 0; k < 4; k++) out[i + k] = Math.round(px[i + k] * (1 - a) + c[k] * a);
  }
  return out;
}

/** Scene-linear RGBA (exposure applied), mixed with the fade's colour in linear light; alpha towards 1. A copy. */
export function fadeLinear(px: Float32Array, fade: FadeToColor | null | undefined): Float32Array {
  if (!fade || !(fade.amount > 0)) return px;
  const a = Math.min(1, fade.amount);
  const out = new Float32Array(px.length);
  const c = [fade.color[0], fade.color[1], fade.color[2], 1];
  for (let i = 0; i < px.length; i += 4) {
    for (let k = 0; k < 4; k++) out[i + k] = Math.fround(px[i + k] * (1 - a) + c[k] * a);
  }
  return out;
}

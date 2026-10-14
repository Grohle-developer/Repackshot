// The bokeh kernel scene (phase O1): small lights far behind the focus plane on black, so that each one is drawn by
// the lens as its blur disc. Pure functions (no file or process access): tools/bokeh-thumbs.mjs renders it with `rt`
// for the selector's thumbnails and the sheet, and tests/bokeh-thumbs.test.ts checks what it writes against the
// page's own RSB writer (src/io/rsb.ts) and renders one thumbnail with the real rt.wasm.
//
// The LENS section is written here as src/io/rsb.ts `lensToRsb` writes it for the same optics (the test compares the
// bytes for every type): the mask and texture pictures halved to 256 × 256 by a 2 × 2 average, combined as
// `mask × (1 − a + a·texture)` with the onion rings' amplitude (1 for the other textures), the field at the corner of
// the frame. Change one, change both.

/** Side of the pictures the engine gets (core/aperture.ts APERTURE_SIZE). */
export const PICTURE_SIZE = 256;
/** The reference sensor (core/camera.ts SENSOR_MM), along the longer side. */
export const SENSOR_MM = 36;

/** The scene's optics: an 85 mm at f/1.6 focused at 600 mm, the lights 6 m away, in a 4 × 3 grid. */
export const SCENE = {
  focalMm: 85,
  fstop: 1.6,
  focusMm: 600,
  lightDepthMm: 6000,
  lightDiameterMm: 100,
  /** Where the lights sit, as fractions of the frame's half width and half height (x right, y up). */
  grid: [-0.75, -0.25, 0.25, 0.75].flatMap((x) => [-0.62, 0, 0.62].map((y) => [x, y])),
  /** Mean radiance of a blur disc in the image (before the tone curve, which is the plain sRGB one). */
  discRadiance: 0.45,
};

/**
 * The sheet's second row (the lead's request on the O1 sheet): point sources of a fifteenth of the blur disc, so the
 * kernel is barely convolved with the source and fine structure (textures, fringes) reads; the discs keep their
 * brightness (the radiance grows with the area ratio).
 */
export const PURE_LIGHT_MM = 32;

/**
 * The sheet's third row: one light filling the frame (a 300 mm at f/5.6, the same entrance pupil as the 85 mm at
 * f/1.6, so a disc of about 320 px at 480 × 360), a fortieth of the blur disc across: the finest textures (onion rings
 * of about 14 px a period here, 4 px in the twelve-light frame) are wider than the source and read once the noise
 * averages out, which takes far more samples than the rows above (a pixel sees the light in 1 of 1600 samples).
 */
export const CLOSE_UP = { ...SCENE, focalMm: 300, fstop: 5.6, lightDiameterMm: 12, grid: [[0, 0]] };

/** Image sizes: the selector's thumbnail (shown at half size) and the sheet's. */
export const THUMB_SIZE = [128, 96];
export const SHEET_SIZE = [480, 360];

const PROFILE = { uniform: 0, centreBright: 1, ringBright: 2, apodized: 3 };

/** `src/data/bokeh.ts` BOKEH_NEUTRAL, merged with a type's and a variant's `thin` (bokehParams). */
export function bokehParams(data, key, variant) {
  const neutral = { blades: 0, roundness: 1, rotationDeg: 0, mask: null, profile: 'uniform', profileParam: 0, obstruction: 0, catsEye: 0, squeeze: 1, streaks: 0, caAmount: 0, swirl: 0, onionAmplitude: 0, texture: null };
  const type = data.types.find((t) => t.key === key);
  if (!type || type.thin === null) return null;
  const v = variant ? type.variants.find((x) => x.key === variant) : null;
  return { ...neutral, ...type.thin, ...(v ? v.thin : {}) };
}

/** Every thumbnail: each type the thin lens can do, and each of its variants. */
export function thumbnails(data) {
  const out = [];
  for (const t of data.types) {
    if (t.requires !== null || t.thin === null) continue;
    out.push({ key: t.key, variant: null, file: `${t.key.replace(/_/g, '-')}.png` });
    for (const v of t.variants) out.push({ key: t.key, variant: v.key, file: `${t.key.replace(/_/g, '-')}--${v.key.replace(/_/g, '-')}.png` });
  }
  return out;
}

/** A 2 × 2 average of a 512 × 512 picture (core/aperture.ts `halve`). */
export function halve(src, size) {
  const half = size >> 1;
  const out = new Uint8Array(half * half);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const at = (xx, yy) => src[yy * size + xx];
      const sum = at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1);
      out[y * half + x] = (sum + 2) >> 2;
    }
  }
  return out;
}

/** core/aperture.ts `combinePictures`. */
export function combine(mask, texture, amount) {
  const n = PICTURE_SIZE * PICTURE_SIZE;
  const out = new Uint8Array(n);
  const a = Math.min(1, Math.max(0, amount));
  for (let i = 0; i < n; i++) {
    let v = mask ? mask[i] : 255;
    if (texture) v = Math.round((v * (255 * (1 - a) + a * texture[i])) / 255);
    out[i] = v;
  }
  return out;
}

/** Half the diagonal of a frame of `w × h` on the reference sensor (io/rsb.ts `frameFieldMm`). */
export function frameFieldMm(w, h) {
  const aspect = w / h;
  const [sw, sh] = aspect >= 1 ? [SENSOR_MM, SENSOR_MM / aspect] : [SENSOR_MM * aspect, SENSOR_MM];
  return Math.hypot(sw, sh) / 2;
}

/**
 * The LENS fields of bokeh parameters (io/rsb.ts `lensToRsb` of the same camera optics, no tilt or shift).
 * `pictures(id)` gives a picture of 256 × 256 or null.
 */
export function lensFields(thin, size, pictures) {
  const mask = thin.mask ? pictures(thin.mask) : null;
  const texture = thin.texture ? pictures(thin.texture) : null;
  const amount = thin.texture === 'onion_rings' ? thin.onionAmplitude : 1;
  const picture = mask || texture ? combine(mask, texture, amount) : null;
  const unit = (v) => Math.min(1, Math.max(0, v));
  return {
    blades: thin.blades >= 3 ? Math.min(18, Math.round(thin.blades)) : 0,
    roundness: unit(thin.roundness),
    rotationDeg: thin.rotationDeg,
    profile: PROFILE[thin.profile] ?? 0,
    profileParam: unit(thin.profileParam),
    obstruction: Math.min(0.95, Math.max(0, thin.obstruction)),
    catsEye: unit(thin.catsEye),
    squeeze: Math.min(4, Math.max(1, thin.squeeze)),
    shiftXMm: 0,
    shiftYMm: 0,
    tiltDeg: 0,
    tiltAxisDeg: 0,
    caAmount: unit(thin.caAmount),
    swirl: unit(thin.swirl),
    fieldMm: frameFieldMm(size[0], size[1]),
    maskKind: mask ? 1 : texture ? 2 : 0,
    maskWidth: picture ? PICTURE_SIZE : 0,
    maskHeight: picture ? PICTURE_SIZE : 0,
    mask: picture ?? new Uint8Array(0),
  };
}

/** The payload of a LENS section. */
export function lensPayload(l) {
  const pad = (4 - (l.mask.length % 4)) % 4;
  const out = new Uint8Array(72 + l.mask.length + pad);
  const v = new DataView(out.buffer);
  let o = 0;
  const u32 = (x) => (v.setUint32(o, x >>> 0, true), (o += 4));
  const f32 = (x) => (v.setFloat32(o, x, true), (o += 4));
  u32(l.blades);
  f32(l.roundness);
  f32(l.rotationDeg);
  u32(l.profile);
  for (const x of [l.profileParam, l.obstruction, l.catsEye, l.squeeze, l.shiftXMm, l.shiftYMm, l.tiltDeg, l.tiltAxisDeg, l.caAmount, l.swirl, l.fieldMm]) f32(x);
  u32(l.maskKind);
  u32(l.maskWidth);
  u32(l.maskHeight);
  out.set(l.mask, o);
  return out;
}

/**
 * The whole RSB file of the scene for bokeh parameters `thin`, an image of `size`, `samples` per pixel;
 * `lightDiameterMm` makes the lights smaller (PURE_LIGHT_MM) or larger than the scene's; `scene` is SCENE or CLOSE_UP.
 */
export function bokehScene(thin, size, samples, pictures, lightDiameterMm = SCENE.lightDiameterMm, scene = SCENE) {
  const [w, h] = size;
  const sections = [];
  const section = (tag, bytes) => sections.push({ tag, bytes });
  const words = (fill) => {
    const list = [];
    fill({ u32: (x) => list.push(['u', x]), f32: (x) => list.push(['f', x]) });
    const out = new Uint8Array(list.length * 4);
    const v = new DataView(out.buffer);
    list.forEach(([k, x], i) => (k === 'u' ? v.setUint32(i * 4, x >>> 0, true) : v.setFloat32(i * 4, x, true)));
    return out;
  };
  const { focalMm, fstop, focusMm, lightDepthMm, grid, discRadiance } = scene;
  // Camera at the origin looking along +Y, Z up.
  section('CAMR', words(({ u32, f32 }) => {
    for (const x of [0, 0, 0, 0, 1000, 0, 0, 0, 1]) f32(x);
    f32(focalMm);
    f32(SENSOR_MM);
    f32(fstop);
    f32(focusMm);
    u32(0);
    f32(1000);
  }));
  section('LENS', lensPayload(lensFields(thin, size, pictures)));
  // The lights: discs facing the camera, seen by camera rays only, bright enough that a blur disc averages
  // `discRadiance`: the disc's radiance times (source / blur)² in solid angle.
  const aspect = w / h;
  const sensorW = aspect >= 1 ? SENSOR_MM : SENSOR_MM * aspect;
  const sensorH = aspect >= 1 ? SENSOR_MM / aspect : SENSOR_MM;
  const aperture = focalMm / fstop;
  const blurAtFocus = (aperture * (lightDepthMm - focusMm)) / lightDepthMm;
  const blurAngle = blurAtFocus / focusMm;
  const sourceAngle = lightDiameterMm / lightDepthMm;
  const radiance = discRadiance * (blurAngle / sourceAngle) ** 2;
  const areaM2 = Math.PI * (lightDiameterMm / 2000) ** 2;
  const power = radiance * Math.PI * areaM2;
  for (const [gx, gy] of grid) {
    const x = ((gx * sensorW) / 2) * (lightDepthMm / focalMm);
    const z = ((gy * sensorH) / 2) * (lightDepthMm / focalMm);
    const len = Math.hypot(x, lightDepthMm, z);
    section('LGHT', words(({ u32, f32 }) => {
      u32(1); // disk
      for (const v of [x, lightDepthMm, z]) f32(v);
      for (const v of [-x / len, -lightDepthMm / len, -z / len]) f32(v);
      for (const v of [0, 0, 1]) f32(v);
      f32(lightDiameterMm);
      f32(lightDiameterMm);
      for (const v of [1, 1, 1]) f32(v);
      f32(power);
      f32(180);
      f32(0);
      u32(2); // seen by camera rays, lights nothing
    }));
  }
  // A black world, no floor, the plain sRGB curve.
  section('ENVR', words(({ u32, f32 }) => {
    u32(1); // flat
    for (const v of [0, 0, 0, 0, 0]) f32(v);
    for (const v of [0, 0, 0]) f32(v);
    u32(1); // the background colour
    u32(0xffffffff);
    u32(0xffffffff);
    u32(0);
    f32(3);
    f32(0);
    f32(45);
    for (const v of [0, 0, 1, 1]) f32(v);
    u32(0);
  }));
  section('FLOR', words(({ u32, f32 }) => {
    u32(0);
    f32(0);
    for (const v of [0.5, 0.5, 0.5]) f32(v);
  }));
  section('RNDR', words(({ u32, f32 }) => {
    u32(w);
    u32(h);
    u32(samples);
    u32(0);
    f32(0);
    f32(0);
    u32(4); // standard sRGB
    u32(2);
    f32(0);
    u32(0);
    u32(0);
    u32(0);
    f32(0);
  }));
  const total = 8 + sections.reduce((n, s) => n + 8 + s.bytes.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out.set([0x52, 0x53, 0x42, 0x31], 0); // RSB1
  v.setUint32(4, 0, true);
  let o = 8;
  for (const s of sections) {
    for (let i = 0; i < 4; i++) out[o + i] = s.tag.charCodeAt(i);
    v.setUint32(o + 4, s.bytes.length, true);
    out.set(s.bytes, o + 8);
    o += 8 + s.bytes.length;
  }
  return out;
}

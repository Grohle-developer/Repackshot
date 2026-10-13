// The daylight sky of the environment kind SKY, for the preview (phase E5): the same model, scale and
// layout as the engine's (engine/crates/rt-core/src/sky.rs and environment.rs `sky_image`), so the Fast
// viewport shows the sky Full renders. A. J. Preetham, P. Shirley and B. Smits, "A Practical Analytic Model
// for Daylight", SIGGRAPH 1999 (Perez distribution, coefficients of Appendix A.2), scaled so that a
// horizontal surface gets the irradiance of the studio dome with the same values, a neutral ground of
// `floor · strength` below the horizon. Equirectangular in the engine's convention (rt-core
// environment.rs, which is three.js's layout): column u = ½ + atan2(-y, x) / 2π, row v = acos(z) / π
// from the top. If the engine moves to the Hošek–Wilkie model, this port follows it
// (tests/environment-e5.test.ts pins the two together, pixel for pixel).

/** Columns and rows of the tabulated sky (as the engine's SKY_WIDTH, SKY_HEIGHT). */
export const SKY_WIDTH = 256;
export const SKY_HEIGHT = 128;

const PEREZ: readonly (readonly [number, number])[][] = [
  [[0.1787, -1.463], [-0.3554, 0.4275], [-0.0227, 5.3251], [0.1206, -2.5771], [-0.067, 0.3703]],
  [[-0.0193, -0.2592], [-0.0665, 0.0008], [-0.0004, 0.2125], [-0.0641, -0.8989], [-0.0033, 0.0452]],
  [[-0.0167, -0.2608], [-0.095, 0.0092], [-0.0079, 0.2102], [-0.0441, -1.6537], [-0.0109, 0.0529]],
];
const ZENITH_X = [
  [0.00166, -0.00375, 0.00209, 0],
  [-0.02903, 0.06377, -0.03202, 0.00394],
  [0.11693, -0.21196, 0.06052, 0.25886],
];
const ZENITH_Y = [
  [0.00275, -0.0061, 0.00317, 0],
  [-0.04214, 0.0897, -0.04153, 0.00516],
  [0.15346, -0.26756, 0.0667, 0.26688],
];

const clampExp = (x: number) => Math.exp(Math.max(-80, Math.min(80, x)));

function perez(c: readonly number[], cosTheta: number, gamma: number, cosGamma: number): number {
  return (1 + c[0] * clampExp(c[1] / cosTheta)) * (1 + c[2] * clampExp(c[3] * gamma) + c[4] * cosGamma * cosGamma);
}

/** CIE xyY to linear Rec. 709 RGB, negatives clamped. */
export function xyyToRgb(x: number, y: number, lum: number): [number, number, number] {
  const X = (x / y) * lum;
  const Z = ((1 - x - y) / y) * lum;
  return [
    Math.max(0, 3.2404542 * X - 1.5371385 * lum - 0.4985314 * Z),
    Math.max(0, -0.969266 * X + 1.8760108 * lum + 0.041556 * Z),
    Math.max(0, 0.0556434 * X - 0.2040259 * lum + 1.0572252 * Z),
  ];
}

/** The sky for a sun at azimuth / elevation in degrees (azimuth from +X towards +Y, Z up) and a turbidity, unscaled. */
export function preetham(azimuthDeg: number, elevationDeg: number, turbidity: number): (dir: readonly number[]) => [number, number, number] {
  const t = Number.isFinite(turbidity) ? Math.min(10, Math.max(1.7, turbidity)) : 3;
  const el = Number.isFinite(elevationDeg) ? Math.min(90, Math.max(1, elevationDeg)) : 45;
  const az = Number.isFinite(azimuthDeg) ? azimuthDeg : 0;
  const rad = Math.PI / 180;
  const sun = [Math.cos(el * rad) * Math.cos(az * rad), Math.cos(el * rad) * Math.sin(az * rad), Math.sin(el * rad)];
  const thetaS = (90 - el) * rad;
  const coef = PEREZ.map((row) => row.map(([a, b]) => a * t + b));
  const chi = (4 / 9 - t / 120) * (Math.PI - 2 * thetaS);
  const yz = (4.0453 * t - 4.971) * Math.tan(chi) - 0.2155 * t + 2.4192;
  const th = [thetaS ** 3, thetaS ** 2, thetaS, 1];
  const poly = (m: number[][]) => [t * t, t, 1].reduce((s, tt, i) => s + tt * m[i].reduce((r, c, j) => r + c * th[j], 0), 0);
  const zenith = [Math.max(1e-3, yz), poly(ZENITH_X), poly(ZENITH_Y)];
  const ratio = zenith.map((z, q) => z / perez(coef[q], 1, thetaS, Math.cos(thetaS)));
  return (d) => {
    if (d[2] <= 0) return [0, 0, 0];
    const cg = Math.max(-1, Math.min(1, d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2]));
    const g = Math.acos(cg);
    const ct = Math.max(1e-3, d[2]);
    const v = ratio.map((r, q) => r * perez(coef[q], ct, g, cg));
    return xyyToRgb(v[1], Math.max(1e-4, v[2]), Math.max(0, v[0]));
  };
}

/** The direction of the centre of pixel (x, y) of a `w x h` panorama in the engine's convention. */
export function panoramaDirection(x: number, y: number, w: number, h: number): [number, number, number] {
  const u = (x + 0.5) / w;
  const v = (y + 0.5) / h;
  const st = Math.sin(Math.PI * v);
  const phi = 2 * Math.PI * (u - 0.5);
  return [st * Math.cos(phi), -st * Math.sin(phi), Math.cos(Math.PI * v)];
}

export interface SkyParams {
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  turbidity: number;
  /** The dome's values the sky is scaled to (DOME_FLOOR, DOME_HORIZON, DOME_ZENITH) and the strength. */
  floor: number;
  horizon: number;
  zenith: number;
  strength: number;
}

/** The sky as the engine tabulates it: SKY_WIDTH x SKY_HEIGHT linear RGB, rows from the top. */
export function skyImage(p: SkyParams): Float32Array {
  const sky = preetham(p.sunAzimuthDeg, p.sunElevationDeg, p.turbidity);
  const w = SKY_WIDTH;
  const h = SKY_HEIGHT;
  const rgb = new Float32Array(3 * w * h);
  const cell = (Math.PI / h) * ((2 * Math.PI) / w);
  let irradiance = 0;
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w; x++) {
      const d = panoramaDirection(x, y, w, h);
      const c = sky(d);
      rgb.set(c, 3 * (y * w + x));
      const st = Math.sin(Math.PI * ((y + 0.5) / h));
      irradiance += (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * d[2] * st * cell;
    }
  }
  const strength = Math.max(0, p.strength);
  const target = strength * 2 * Math.PI * (Math.max(0, p.horizon) / 6 + Math.max(0, p.zenith) / 3);
  const scale = irradiance > 0 ? target / irradiance : 0;
  const ground = Math.max(0, p.floor * strength);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.floor(i / (3 * w)) < h / 2 ? rgb[i] * scale : ground;
  return rgb;
}

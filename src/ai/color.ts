// Colour difference for the guard's report (AI-POST.md §3.2: ΔE₀₀ per material region): linear sRGB to CIE Lab
// (D65) and the CIEDE2000 formula of Sharma, Wu and Dalal (2005), "The CIEDE2000 Color-Difference Formula:
// Implementation Notes, Supplementary Test Data, and Mathematical Observations". Pure TypeScript, no tables.

const WHITE: readonly [number, number, number] = [0.95047, 1, 1.08883];
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

function labF(t: number): number {
  return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

/** Linear Rec. 709 / sRGB primaries to CIE Lab with the D65 white. */
export function linearRgbToLab(r: number, g: number, b: number, out: number[] = [0, 0, 0]): number[] {
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = labF(x / WHITE[0]);
  const fy = labF(y / WHITE[1]);
  const fz = labF(z / WHITE[2]);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
  return out;
}

const RAD = Math.PI / 180;
const POW25_7 = Math.pow(25, 7);

/** CIEDE2000 between two Lab colours (kL = kC = kH = 1). */
export function deltaE2000(l1: number, a1: number, b1: number, l2: number, a2: number, b2: number): number {
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = Math.pow(cBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + POW25_7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number): number => {
    if (b === 0 && a === 0) return 0;
    const h = Math.atan2(b, a) / RAD;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * RAD) / 2);
  const lBarP = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP: number;
  if (c1p * c2p === 0) hBarP = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hBarP = (h1p + h2p) / 2;
  else hBarP = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const t = 1 - 0.17 * Math.cos((hBarP - 30) * RAD) + 0.24 * Math.cos(2 * hBarP * RAD) + 0.32 * Math.cos((3 * hBarP + 6) * RAD) - 0.2 * Math.cos((4 * hBarP - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const cBarP7 = Math.pow(cBarP, 7);
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + POW25_7));
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * dTheta * RAD) * rc;
  const x = dLp / sl;
  const y = dCp / sc;
  const z = dHp / sh;
  return Math.sqrt(x * x + y * y + z * z + rt * y * z);
}

// The cross-section of a traced lens (phase O2, STUDIO-TOOLS §1 "corte de la lente"): an SVG drawn from the lens as
// the engine prepared it (rt-core `LensSection`: the prescription scaled to the camera's focal length, focused, with
// the semi-apertures it derived), so the drawing is what is traced. Pure and string-only (no DOM): the inspector puts
// it in the Lens section and tools/lens-sheet.mjs in the sheet. The interface chrome is achromatic (rule 4): glass is
// a grey, the lines are `currentColor`. Only type imports, so Node can load this file as it is.

import type { LensSection, SectionSurface } from '../core/traced-lens';

/** rt-core SURFACE_MIRROR. */
const MIRROR = 5;

/** The sag of a surface at height `y` (sphere, conic and even asphere), mm along the axis from its vertex. */
export function sag(s: SectionSurface, y: number): number {
  const c = s.curvature;
  const y2 = y * y;
  let z = 0;
  if (c !== 0) {
    const q = 1 - (1 + s.conic) * c * c * y2;
    z = (c * y2) / (1 + Math.sqrt(Math.max(0, q)));
  }
  let yk = y2 * y2;
  for (const a of s.aspheric) {
    z += a * yk;
    yk *= y2;
  }
  return z;
}

/** The highest point of a surface that its own curvature allows (a hemisphere at most), up to its semi-aperture. */
function reach(s: SectionSurface): number {
  const c = Math.abs(s.curvature);
  const limit = c > 0 && s.conic >= -1 ? 1 / (c * Math.sqrt(Math.max(1e-9, 1 + s.conic))) : Infinity;
  return Math.min(s.semiAperture, 0.999 * limit);
}

/** The outline of a surface from −h to +h, as [z, y] points. */
function outline(s: SectionSurface, h: number, steps = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const y = -h + (2 * h * i) / steps;
    out.push([s.z + sag(s, y), y]);
  }
  return out;
}

export interface SectionOptions {
  /** Size of the drawing, px. */
  width: number;
  height: number;
  /** Half the sensor's height, mm, for the sensor's line (0: none). */
  sensorHalfMm?: number;
  /** An accessible name. */
  title?: string;
}

/**
 * The SVG of a lens's cross-section in its horizontal meridian (where an anamorphic adapter's cylinders have their
 * power): glass in grey between its surfaces, mirrors as thick lines, the iris at the stop for the f-number in use,
 * the sensor and the axis. The light comes from the left.
 */
export function lensSectionSvg(section: LensSection, o: SectionOptions): string {
  const { surfaces, stop } = section;
  const heights = surfaces.map(reach);
  const ext = Math.max(1e-3, ...heights, o.sensorHalfMm ?? 0);
  const zs = surfaces.flatMap((s, i) => [s.z, s.z + sag(s, heights[i]), s.z + sag(s, -heights[i])]);
  const z0 = Math.min(...zs, section.sensorZMm);
  const z1 = Math.max(...zs, section.sensorZMm);
  const pad = 8;
  const k = Math.min((o.width - 2 * pad) / Math.max(1e-3, z1 - z0), (o.height - 2 * pad) / (2.3 * ext));
  const cx = (o.width - k * (z1 - z0)) / 2;
  const X = (z: number) => (cx + (z - z0) * k).toFixed(2);
  const Y = (y: number) => (o.height / 2 - y * k).toFixed(2);
  const path = (pts: [number, number][]) => pts.map(([z, y], i) => `${i ? 'L' : 'M'}${X(z)} ${Y(y)}`).join('');
  const parts: string[] = [];
  // Glass: between a surface followed by glass and the next one (rims joined straight).
  for (let i = 0; i + 1 < surfaces.length; i++) {
    const a = surfaces[i];
    const b = surfaces[i + 1];
    if (!(a.index > 1) || a.kind === MIRROR) continue;
    const front = outline(a, heights[i]);
    const back = outline(b, heights[i + 1]).reverse();
    parts.push(`<path d="${path([...front, ...back])}Z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>`);
  }
  // Mirrors, thick.
  surfaces.forEach((s, i) => {
    if (s.kind === MIRROR) parts.push(`<path d="${path(outline(s, heights[i]))}" fill="none" stroke="currentColor" stroke-width="3"/>`);
  });
  // The iris at the stop: two blades from the opening to beyond the stop's rim.
  const st = surfaces[stop];
  if (st) {
    const outer = Math.max(heights[stop], section.stopRadiusMm) + 0.12 * ext;
    const r = section.stopRadiusMm;
    for (const sgn of [1, -1]) parts.push(`<line x1="${X(st.z)}" y1="${Y(sgn * r)}" x2="${X(st.z)}" y2="${Y(sgn * outer)}" stroke="currentColor" stroke-width="2.5"/>`);
  }
  // The sensor and the axis.
  if (o.sensorHalfMm && o.sensorHalfMm > 0) {
    parts.push(`<line x1="${X(section.sensorZMm)}" y1="${Y(o.sensorHalfMm)}" x2="${X(section.sensorZMm)}" y2="${Y(-o.sensorHalfMm)}" stroke="currentColor" stroke-width="2"/>`);
  }
  parts.push(`<line x1="${pad}" y1="${Y(0)}" x2="${o.width - pad}" y2="${Y(0)}" stroke="currentColor" stroke-opacity="0.45" stroke-width="0.75" stroke-dasharray="4 3"/>`);
  const title = o.title ? `<title>${o.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" width="${o.width}" height="${o.height}" role="img">${title}${parts.join('')}</svg>`;
}

/**
 * A small line chart of a profile against image height (distortion in percent, relative illumination as a ratio):
 * the engine's points joined, a zero line, and the extreme value written at the end. Achromatic.
 */
export function profileChartSvg(points: readonly (readonly [number, number])[], o: { width: number; height: number; min: number; max: number; zero?: number; title?: string }): string {
  const pad = 4;
  const pts: (readonly [number, number])[] = points.length > 0 && points[0][0] > 0 ? [[0, o.zero ?? points[0][1]], ...points] : [...points];
  const hMax = Math.max(1e-3, ...pts.map((p) => p[0]));
  const span = Math.max(1e-9, o.max - o.min);
  const X = (h: number) => (pad + ((o.width - 2 * pad) * h) / hMax).toFixed(2);
  const Y = (v: number) => (o.height - pad - ((o.height - 2 * pad) * (Math.min(o.max, Math.max(o.min, v)) - o.min)) / span).toFixed(2);
  const line = pts.map(([h, v], i) => `${i ? 'L' : 'M'}${X(h)} ${Y(v)}`).join('');
  const zero = o.zero !== undefined ? `<line x1="${pad}" y1="${Y(o.zero)}" x2="${o.width - pad}" y2="${Y(o.zero)}" stroke="currentColor" stroke-opacity="0.35" stroke-width="0.75" stroke-dasharray="3 3"/>` : '';
  const title = o.title ? `<title>${o.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" width="${o.width}" height="${o.height}" role="img">${title}${zero}<path d="${line}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

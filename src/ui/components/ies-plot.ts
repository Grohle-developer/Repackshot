// The polar plot of an IES profile (phase L5), small, in the light's inspector: the intensity over the peak against the
// angle from the axis, in the two planes through the axis a photometric report draws, C0–C180 (solid) and C90–C270
// (dashed), the axis pointing down. Drawn from the table the engine reads (core/ies.ts `iesPolar`), in the interface's
// greys: the chrome is achromatic. A profile that is round about its axis has the one curve.

import { iesIsRound, iesPolar, type IesProfile } from '../../core/ies';
import { h } from '../dom';
import { t } from '../strings';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The plot's box and where its centre and its outer ring are. */
export const IES_PLOT = { size: 150, centre: 75, radius: 62 } as const;

/** One curve of the plot as an SVG path in the box: the points of `iesPolar`, the axis (0°) at the bottom. */
export function iesPlotPath(points: readonly (readonly [number, number])[]): string {
  const { centre, radius } = IES_PLOT;
  const at = ([angle, r]: readonly [number, number]): string => {
    const a = (angle * Math.PI) / 180;
    return `${(centre + radius * r * Math.sin(a)).toFixed(2)} ${(centre + radius * r * Math.cos(a)).toFixed(2)}`;
  };
  return `M${points.map(at).join('L')}Z`;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** The plot of `profile`, with a legend of its planes beside it. */
export function iesPlot(profile: IesProfile): HTMLElement {
  const { size, centre, radius } = IES_PLOT;
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'ies-plot', role: 'img', 'aria-label': t('lightEdit.iesPlot'), 'data-ies-plot': '' });
  // The rings at a quarter, a half, three quarters and the peak; the axis and its square.
  for (const f of [0.25, 0.5, 0.75, 1]) root.append(svg('circle', { cx: String(centre), cy: String(centre), r: String(radius * f), class: f === 1 ? 'ies-plot-ring is-peak' : 'ies-plot-ring' }));
  root.append(svg('path', { d: `M${centre} ${centre - radius}V${centre + radius}M${centre - radius} ${centre}H${centre + radius}`, class: 'ies-plot-axes' }));
  // The angles from the axis (0° down, 180° up), at the rim.
  root.append(
    svg('text', { x: String(centre), y: String(size - 1), class: 'ies-plot-tick', 'text-anchor': 'middle' }, '0°'),
    svg('text', { x: String(centre), y: '8', class: 'ies-plot-tick', 'text-anchor': 'middle' }, '180°'),
    svg('text', { x: String(size - 1), y: String(centre - 2), class: 'ies-plot-tick', 'text-anchor': 'end' }, '90°'),
    svg('text', { x: '1', y: String(centre - 2), class: 'ies-plot-tick', 'text-anchor': 'start' }, '90°'),
  );
  const curves = iesPolar(profile, 2);
  const shown = iesIsRound(profile) ? curves.slice(0, 1) : curves;
  for (const c of shown) root.append(svg('path', { d: iesPlotPath(c.points), class: `ies-plot-curve ies-plot-${c.plane.toLowerCase()}`, 'data-plane': c.plane }));
  const legend = h(
    'div',
    { class: 'ies-plot-legend note' },
    ...shown.map((c) => h('div', { class: `ies-plot-key ies-plot-key-${c.plane.toLowerCase()}` }, h('span', { class: 'ies-plot-swatch' }), t(c.plane === 'C0' ? 'lightEdit.iesPlotC0' : 'lightEdit.iesPlotC90'))),
  );
  return h('div', { class: 'ies-plot-box', 'data-field': 'ies-plot' }, root, legend);
}

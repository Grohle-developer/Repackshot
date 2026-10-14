// The canvas of the material editor (phase M3a, UI.md §2.10): the graph's nodes as cards on a plane that zooms
// (the wheel, about the cursor) and pans (the middle button, or Space or Alt with the left one), their sockets on
// the edges with a shape for each type (circle a number, diamond a colour, square a vector, triangle a normal:
// shape, never colour), and the links as curves. A node is dragged by its body (the selection with it, one undo
// entry per drag); a link is drawn from an output to an input or back, a socket that cannot take it is marked while
// dragging and the refusal says why; an input's link is picked up from the input and dropped on another or on
// nothing (disconnected). A drag on the empty plane selects the nodes in its box; a double click or a right click
// there opens Add node at that point. The canvas never holds the graph: it draws the store's and dispatches.

import { nodeSpec, type SocketType } from '../../data/material-nodes';
import { linkInto, linkProblem, nodeById, outputSpecOf, inputSpecOf, visibleInputs, type GraphNode, type MaterialGraph } from '../../core/material-graph';
import type { MaterialId } from '../../core/materials';
import { connectSockets, duplicateGraphNodes, moveGraphNodes, relinkSocket, removeGraphNodes, disconnectSocket } from '../graph-commands';
import { newGesture } from '../components/controls';
import { openMenuAt, type MenuItems } from '../components/widgets';
import { h, linearToHex } from '../dom';
import type { Ctx, Scope } from '../reactive';
import { dyn } from '../names';
import { kbdText } from '../shortcuts';
import { formatNumber, getLang, lbl, t } from '../strings';

/** Card metrics, canvas pixels (layout of material-editor.css): the sockets' places follow from them. */
export const NODE_W = 184;
export const HEAD_H = 26;
export const PREVIEW_H = 72;
export const ROW_H = 22;
const FOOT_H = 6;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

export interface CanvasView {
  /** Screen offset of the canvas origin, pixels. */
  x: number;
  y: number;
  zoom: number;
}

/** Where each material's canvas was looked at last, for this session. */
const views = new Map<MaterialId, CanvasView>();

export interface Selection {
  get(): ReadonlySet<string>;
  set(ids: Iterable<string>): void;
}

export interface GraphCanvasOptions {
  ctx: Ctx;
  scope: Scope;
  material: MaterialId;
  selection: Selection;
  /** Add node at a canvas point (screen point for the menu). */
  addMenu(screen: { x: number; y: number }, world: { x: number; y: number }): void;
}

export interface GraphCanvas {
  el: HTMLElement;
  /** Fits every node in view. */
  frame(): void;
  /** The canvas point at the centre of the view. */
  centre(): { x: number; y: number };
  /** A node's preview (RGBA, `size` square). */
  setPreview(node: string, rgba: Uint8ClampedArray, size: number): void;
  /** Redraws the selection marks. */
  refreshSelection(): void;
}

/** The rows of a card, in order: its outputs, then the inputs its parameters show. */
export function cardRows(n: GraphNode): { dir: 'out' | 'in'; key: string; type: SocketType; label: string }[] {
  const spec = nodeSpec(n.type);
  if (!spec) return [];
  return [...spec.outputs.map((s) => ({ dir: 'out' as const, key: s.key, type: s.type, label: lbl(s.label) })), ...visibleInputs(n).map((s) => ({ dir: 'in' as const, key: s.key, type: s.type, label: lbl(s.label) }))];
}

export function cardHeight(n: GraphNode): number {
  return HEAD_H + PREVIEW_H + cardRows(n).length * ROW_H + FOOT_H;
}

/** Where a socket is on the canvas; null for a socket the card does not show. */
export function socketPoint(n: GraphNode, dir: 'in' | 'out', key: string): { x: number; y: number } | null {
  const i = cardRows(n).findIndex((r) => r.dir === dir && r.key === key);
  if (i < 0) return null;
  return { x: dir === 'out' ? n.x + NODE_W : n.x, y: n.y + HEAD_H + PREVIEW_H + i * ROW_H + ROW_H / 2 };
}

/** The curve of a link from (x1, y1) to (x2, y2), leaving and arriving horizontally. */
export function linkPath(x1: number, y1: number, x2: number, y2: number): string {
  const d = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`;
}

const SVG = 'http://www.w3.org/2000/svg';

/** A card's title: the node's name, and for the nodes that are one operation of many (Maths, Mix) the operation. */
export function cardTitle(n: GraphNode): string {
  const spec = nodeSpec(n.type);
  if (!spec) return n.type;
  const key = n.type === 'MATH' ? 'op' : n.type === 'MIX' ? 'blend' : null;
  const option = key ? spec.params.find((p) => p.key === key)?.options?.find((o) => o.value === n.params[key]) : undefined;
  return option ? `${lbl(spec.label)} · ${lbl(option.label)}` : lbl(spec.label);
}

/** The value an unconnected input shows on its card. */
function inlineValue(n: GraphNode, key: string): HTMLElement | null {
  const v = n.inputs[key];
  if (v === undefined) return null;
  if (typeof v === 'number') return h('span', { class: 'ge-val tabular' }, formatNumber(v, getLang(), Math.abs(v) >= 100 ? 0 : 2));
  // A colour shows as itself (content: the material's own colour).
  return h('span', { class: 'ge-swatch', style: `background:${linearToHex(v)}` });
}

export function graphCanvas(o: GraphCanvasOptions): GraphCanvas {
  const { ctx, scope, material, selection } = o;
  const graph = (): MaterialGraph | undefined => ctx.store.get().materials[material]?.graph;
  const view: CanvasView = views.get(material) ?? { x: 40, y: 40, zoom: 1 };
  views.set(material, view);
  const links = document.createElementNS(SVG, 'svg');
  links.setAttribute('class', 'ge-links');
  const dragPath = document.createElementNS(SVG, 'path');
  dragPath.setAttribute('class', 'ge-link is-dragging');
  const world = h('div', { class: 'ge-world' });
  world.appendChild(links);
  const band = h('div', { class: 'ge-band', hidden: true });
  const zoomLabel = h('div', { class: 'ge-zoom aux tabular', 'aria-hidden': 'true' });
  zoomLabel.setAttribute('data-tip', t('ge.canvasTip'));
  const el = h('div', { class: 'ge-canvas', tabindex: '0', role: 'application', 'aria-label': t('ge.canvas'), 'aria-description': t('ge.canvasTip') }, world, band, zoomLabel);
  const cards = new Map<string, { node: GraphNode; el: HTMLElement; key: string }>();
  const previews = new Map<string, { rgba: Uint8ClampedArray; size: number }>();

  const applyView = () => {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    zoomLabel.textContent = `${Math.round(view.zoom * 100)} %`;
    el.style.setProperty('--ge-zoom', String(view.zoom));
  };

  const paintPreview = (card: HTMLElement, id: string) => {
    const p = previews.get(id);
    const c = card.querySelector('canvas');
    if (!p || !c) return;
    if (c.width !== p.size) {
      c.width = p.size;
      c.height = p.size;
    }
    const g2 = c.getContext('2d');
    if (g2) g2.putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.size, p.size), 0, 0);
  };

  const buildCard = (n: GraphNode, g: MaterialGraph): HTMLElement => {
    const spec = nodeSpec(n.type)!;
    const rows = cardRows(n).map((r) => {
      const linked = r.dir === 'in' ? !!linkInto(g, n.id, r.key) : g.links.some((l) => l.from === n.id && l.output === r.key);
      const sock = h('span', { class: `ge-sock${linked ? ' is-linked' : ''}`, 'data-sock': r.dir, 'data-node': n.id, 'data-socket': r.key, 'data-type': r.type, 'aria-label': `${r.label} (${t(dyn(`ge.type.${r.type}`))})` });
      if (r.dir === 'out') return h('div', { class: 'ge-row is-out' }, h('span', { class: 'ge-row-label' }, r.label), sock);
      return h('div', { class: 'ge-row is-in' }, sock, h('span', { class: 'ge-row-label' }, r.label), linked ? null : inlineValue(n, r.key));
    });
    const card = h(
      'div',
      { class: `ge-node${n.type === 'OUTPUT' ? ' is-output' : ''}`, 'data-node': n.id, 'data-type': n.type, role: 'group', 'aria-label': lbl(spec.label), style: `left:${n.x}px;top:${n.y}px;width:${NODE_W}px` },
      h('div', { class: 'ge-head', 'data-tip': lbl(spec.description) }, cardTitle(n)),
      h('div', { class: 'ge-preview' }, h('canvas', { width: 64, height: 64, 'aria-hidden': 'true' })),
      ...rows,
    );
    return card;
  };

  /** What decides whether a card is rebuilt: its contents and which of its sockets are linked. */
  const cardKey = (n: GraphNode, g: MaterialGraph): string => {
    const linked = g.links.filter((l) => l.to === n.id || l.from === n.id).map((l) => (l.to === n.id ? `i:${l.input}` : `o:${l.output}`));
    return `${n.type}|${JSON.stringify(n.params)}|${JSON.stringify(n.inputs)}|${[...new Set(linked)].sort().join(',')}|${getLang()}`;
  };

  const render = () => {
    const g = graph();
    if (!g) return;
    const seen = new Set<string>();
    for (const n of g.nodes) {
      seen.add(n.id);
      const key = cardKey(n, g);
      const had = cards.get(n.id);
      if (!had || had.key !== key) {
        const card = buildCard(n, g);
        if (had) had.el.replaceWith(card);
        else world.appendChild(card);
        cards.set(n.id, { node: n, el: card, key });
        paintPreview(card, n.id);
      } else if (had.node !== n) {
        had.el.style.left = `${n.x}px`;
        had.el.style.top = `${n.y}px`;
        had.node = n;
      }
    }
    for (const [id, c] of cards) {
      if (seen.has(id)) continue;
      c.el.remove();
      cards.delete(id);
      previews.delete(id);
    }
    drawLinks(g);
    refreshSelection();
  };

  const drawLinks = (g: MaterialGraph) => {
    const paths: SVGPathElement[] = [];
    const sel = selection.get();
    for (const l of g.links) {
      const from = nodeById(g, l.from);
      const to = nodeById(g, l.to);
      const a = from && socketPoint(from, 'out', l.output);
      const b = to && socketPoint(to, 'in', l.input);
      if (!a || !b) continue;
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', linkPath(a.x, a.y, b.x, b.y));
      p.setAttribute('class', `ge-link${sel.has(l.from) || sel.has(l.to) ? ' is-selected' : ''}`);
      p.setAttribute('data-link', `${l.from}.${l.output}>${l.to}.${l.input}`);
      paths.push(p);
    }
    links.replaceChildren(...paths, dragPath);
  };

  const refreshSelection = () => {
    const sel = selection.get();
    for (const [id, c] of cards) c.el.classList.toggle('is-selected', sel.has(id));
    for (const p of links.querySelectorAll<SVGPathElement>('path[data-link]')) {
      const [from, to] = (p.getAttribute('data-link') ?? '').split('>');
      p.classList.toggle('is-selected', sel.has(from.split('.')[0]) || sel.has(to.split('.')[0]));
    }
  };

  // ------------------------------------------------------------------ coordinates
  const toWorld = (clientX: number, clientY: number) => {
    const r = el.getBoundingClientRect();
    // The window may be zoomed by the interface size: client pixels to the canvas's own.
    const z = r.width > 0 && el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
    return { x: ((clientX - r.left) / z - view.x) / view.zoom, y: ((clientY - r.top) / z - view.y) / view.zoom };
  };
  const zoomAt = (clientX: number, clientY: number, zoom: number) => {
    const before = toWorld(clientX, clientY);
    view.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    const r = el.getBoundingClientRect();
    const z = r.width > 0 && el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
    view.x = (clientX - r.left) / z - before.x * view.zoom;
    view.y = (clientY - r.top) / z - before.y * view.zoom;
    applyView();
  };

  const frame = () => {
    const g = graph();
    if (!g || g.nodes.length === 0) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of g.nodes) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + NODE_W);
      y1 = Math.max(y1, n.y + cardHeight(n));
    }
    const w = el.clientWidth || 800;
    const hh = el.clientHeight || 500;
    const margin = 32;
    view.zoom = Math.min(1, Math.max(ZOOM_MIN, Math.min((w - 2 * margin) / (x1 - x0), (hh - 2 * margin) / (y1 - y0))));
    view.x = (w - (x1 - x0) * view.zoom) / 2 - x0 * view.zoom;
    view.y = (hh - (y1 - y0) * view.zoom) / 2 - y0 * view.zoom;
    applyView();
  };

  // ------------------------------------------------------------------ pointer
  type Drag =
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { kind: 'move'; start: { x: number; y: number }; nodes: { id: string; x: number; y: number }[]; gesture: string; moved: boolean }
    | { kind: 'box'; start: { x: number; y: number }; cx: number; cy: number; add: boolean }
    | { kind: 'link'; fromOut: { node: string; output: string } | null; toIn: { node: string; input: string } | null; relink: { node: string; input: string } | null; anchor: { x: number; y: number } };
  let drag: Drag | null = null;
  let space = false;
  let hot: HTMLElement | null = null;

  const sockAt = (clientX: number, clientY: number): HTMLElement | null => {
    const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    return (target?.closest?.('.ge-sock') as HTMLElement | null) ?? null;
  };

  /** Whether the socket under the pointer can end the link being drawn, and why not. */
  const judge = (sock: HTMLElement): { ok: boolean; why: string | null } => {
    const g = graph();
    const d = drag;
    if (!g || !d || d.kind !== 'link') return { ok: false, why: null };
    const dir = sock.dataset.sock;
    const node = sock.dataset.node!;
    const key = sock.dataset.socket!;
    if (d.fromOut) {
      if (dir !== 'in') return { ok: false, why: null };
      const relink = d.relink;
      const links = relink ? g.links.filter((l) => !(l.to === relink.node && l.input === relink.input)) : g.links;
      const problem = linkProblem({ ...g, links: links.filter((l) => !(l.to === node && l.input === key)) }, { from: d.fromOut.node, output: d.fromOut.output, to: node, input: key });
      return { ok: problem === null, why: problem };
    }
    const toIn = d.toIn;
    if (dir !== 'out' || !toIn) return { ok: false, why: null };
    const problem = linkProblem({ ...g, links: g.links.filter((l) => !(l.to === toIn.node && l.input === toIn.input)) }, { from: node, output: key, to: toIn.node, input: toIn.input });
    return { ok: problem === null, why: problem };
  };

  const setHot = (sock: HTMLElement | null) => {
    if (hot && hot !== sock) hot.classList.remove('is-ok', 'is-bad');
    hot = sock;
    if (sock) {
      const j = judge(sock);
      sock.classList.toggle('is-ok', j.ok);
      sock.classList.toggle('is-bad', !j.ok && j.why !== null);
    }
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    el.focus({ preventScroll: true });
    const target = e.target as HTMLElement;
    const g = graph();
    if (!g) return;
    const w = toWorld(e.clientX, e.clientY);
    const panning = e.button === 1 || ((space || e.altKey) && e.button === 0);
    const sock = panning ? null : (target.closest('.ge-sock') as HTMLElement | null);
    const card = panning ? null : (target.closest('.ge-node') as HTMLElement | null);
    if (panning) drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    else if (sock) {
      const node = sock.dataset.node!;
      const key = sock.dataset.socket!;
      const n = nodeById(g, node)!;
      if (sock.dataset.sock === 'out') drag = { kind: 'link', fromOut: { node, output: key }, toIn: null, relink: null, anchor: socketPoint(n, 'out', key)! };
      else {
        const l = linkInto(g, node, key);
        if (l) {
          // Pick the link up from its input: it follows the pointer from its output.
          const from = nodeById(g, l.from)!;
          drag = { kind: 'link', fromOut: { node: l.from, output: l.output }, toIn: null, relink: { node, input: key }, anchor: socketPoint(from, 'out', l.output)! };
        } else drag = { kind: 'link', fromOut: null, toIn: { node, input: key }, relink: null, anchor: socketPoint(n, 'in', key)! };
      }
    } else if (card) {
      const id = card.dataset.node!;
      const sel = new Set(selection.get());
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (sel.has(id)) sel.delete(id);
        else sel.add(id);
      } else if (!sel.has(id)) {
        sel.clear();
        sel.add(id);
      }
      selection.set(sel);
      // Bring the card to the front.
      world.appendChild(card);
      const moving = g.nodes.filter((n) => sel.has(n.id)).map((n) => ({ id: n.id, x: n.x, y: n.y }));
      drag = { kind: 'move', start: w, nodes: moving, gesture: newGesture('graph-move'), moved: false };
    } else {
      drag = { kind: 'box', start: w, cx: e.clientX, cy: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey };
      if (!drag.add) selection.set([]);
    }
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events.
    }
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const w = toWorld(e.clientX, e.clientY);
    switch (drag.kind) {
      case 'pan': {
        const r = el.getBoundingClientRect();
        const z = r.width > 0 && el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
        view.x = drag.vx + (e.clientX - drag.sx) / z;
        view.y = drag.vy + (e.clientY - drag.sy) / z;
        applyView();
        break;
      }
      case 'move': {
        const dx = Math.round(w.x - drag.start.x);
        const dy = Math.round(w.y - drag.start.y);
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        drag.moved = true;
        moveGraphNodes(
          ctx,
          material,
          drag.nodes.map((n) => ({ id: n.id, x: n.x + dx, y: n.y + dy })),
          drag.gesture,
        );
        break;
      }
      case 'box': {
        const r = el.getBoundingClientRect();
        const z = r.width > 0 && el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
        const x0 = (Math.min(drag.cx, e.clientX) - r.left) / z;
        const y0 = (Math.min(drag.cy, e.clientY) - r.top) / z;
        band.hidden = false;
        band.style.left = `${x0}px`;
        band.style.top = `${y0}px`;
        band.style.width = `${Math.abs(e.clientX - drag.cx) / z}px`;
        band.style.height = `${Math.abs(e.clientY - drag.cy) / z}px`;
        break;
      }
      case 'link': {
        const a = drag.anchor;
        dragPath.setAttribute('d', drag.fromOut ? linkPath(a.x, a.y, w.x, w.y) : linkPath(w.x, w.y, a.x, a.y));
        setHot(sockAt(e.clientX, e.clientY));
        break;
      }
    }
  });

  const finish = (e: PointerEvent) => {
    const d = drag;
    drag = null;
    if (!d) return;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
    if (d.kind === 'box') {
      band.hidden = true;
      const w = toWorld(e.clientX, e.clientY);
      const g = graph();
      if (!g) return;
      const x0 = Math.min(d.start.x, w.x);
      const x1 = Math.max(d.start.x, w.x);
      const y0 = Math.min(d.start.y, w.y);
      const y1 = Math.max(d.start.y, w.y);
      if (x1 - x0 < 2 && y1 - y0 < 2) return;
      const hit = g.nodes.filter((n) => n.x < x1 && n.x + NODE_W > x0 && n.y < y1 && n.y + cardHeight(n) > y0).map((n) => n.id);
      selection.set(d.add ? [...selection.get(), ...hit] : hit);
    } else if (d.kind === 'link') {
      dragPath.removeAttribute('d');
      const sock = sockAt(e.clientX, e.clientY);
      setHot(null);
      sock?.classList.remove('is-ok', 'is-bad');
      const node = sock?.dataset.node;
      const key = sock?.dataset.socket;
      if (d.fromOut && sock?.dataset.sock === 'in' && node && key) {
        if (d.relink) {
          if (d.relink.node !== node || d.relink.input !== key) relinkSocket(ctx, material, d.relink, { node, input: key });
        } else connectSockets(ctx, material, { from: d.fromOut.node, output: d.fromOut.output, to: node, input: key });
      } else if (d.toIn && sock?.dataset.sock === 'out' && node && key) {
        connectSockets(ctx, material, { from: node, output: key, to: d.toIn.node, input: d.toIn.input });
      } else if (d.relink && !sock) relinkSocket(ctx, material, d.relink, null);
    }
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // Pinch on a trackpad comes as a wheel with Ctrl; both zoom about the pointer.
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(e.clientX, e.clientY, view.zoom * k);
    },
    { passive: false },
  );

  el.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.ge-node')) return;
    o.addMenu({ x: e.clientX, y: e.clientY }, toWorld(e.clientX, e.clientY));
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const card = (e.target as HTMLElement).closest('.ge-node') as HTMLElement | null;
    const g = graph();
    if (!card || !g) {
      o.addMenu({ x: e.clientX, y: e.clientY }, toWorld(e.clientX, e.clientY));
      return;
    }
    const id = card.dataset.node!;
    if (!selection.get().has(id)) selection.set([id]);
    const ids = [...selection.get()];
    const isOutput = nodeById(g, id)?.type === 'OUTPUT';
    const items: MenuItems = [
      { label: t('ge.duplicate'), kbd: kbdText('mod+d'), disabled: isOutput && ids.length === 1, run: () => selection.set(duplicateGraphNodes(ctx, material, ids)) },
      { label: t('ge.disconnectAll'), disabled: !g.links.some((l) => ids.includes(l.to)), run: () => ctx.store.transaction(t('ge.disconnectAll'), () => g.links.filter((l) => ids.includes(l.to)).forEach((l) => disconnectSocket(ctx, material, l.to, l.input))) },
      null,
      { label: t('ge.delete'), kbd: kbdText('delete'), disabled: isOutput && ids.length === 1, run: () => removeGraphNodes(ctx, material, ids) },
    ];
    openMenuAt(e.clientX, e.clientY, items);
  });

  const onKeyState = (e: KeyboardEvent) => {
    if (e.code === 'Space') space = e.type === 'keydown';
  };
  el.addEventListener('keydown', onKeyState);
  el.addEventListener('keyup', onKeyState);

  scope.watch((s) => s.materials[material]?.graph, render);
  scope.watch(
    (s) => s.meta.lang,
    () => {
      for (const c of cards.values()) c.key = '';
      render();
    },
  );
  applyView();

  return {
    el,
    frame,
    centre: () => {
      const w = el.clientWidth || 800;
      const hh = el.clientHeight || 500;
      return { x: Math.round((w / 2 - view.x) / view.zoom - NODE_W / 2), y: Math.round((hh / 2 - view.y) / view.zoom - 60) };
    },
    setPreview: (node, rgba, size) => {
      previews.set(node, { rgba, size });
      const c = cards.get(node);
      if (c) paintPreview(c.el, node);
    },
    refreshSelection: () => {
      const g = graph();
      if (g) drawLinks(g);
      refreshSelection();
    },
  };
}

/** Whether a node's output is connected anywhere (tests and the editor's panel). */
export function outputLinked(g: MaterialGraph, node: string, output: string): boolean {
  return g.links.some((l) => l.from === node && l.output === output);
}

/** The words for a link's source, as the node panel lists a connected input. */
export function linkSourceText(g: MaterialGraph, node: string, input: string): string | null {
  const l = linkInto(g, node, input);
  const from = l && nodeById(g, l.from);
  if (!l || !from) return null;
  const spec = nodeSpec(from.type);
  const out = outputSpecOf(from, l.output);
  return t('ge.linkedFrom', { node: spec ? lbl(spec.label) : from.type, socket: out ? lbl(out.label) : l.output });
}

/** The input's spec, re-exported for the node panel. */
export { inputSpecOf };

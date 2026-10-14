// The material editor (phase M3a, UI.md §2.10): a window of its own, like the render window, open on one material.
// It floats over the application without dimming it (the viewport keeps drawing what the graph does), is moved by
// its title bar, made larger by its corner, and remembers where and how large it was; Esc or × closes it.
//
//   Title bar   Material editor · the material's name · Simple | Nodes · Examples ▾ · Add node · Frame · ×
//   Left        the canvas (panels/graph-canvas.ts)
//   Right       the material on its sphere; what Fast shows of it and what it approximates; the selected node:
//               its parameters and its inputs (a connected one names its source and can be disconnected)
//   Foot        nodes, links and the program's size (or why it does not compile); the shortcuts
//
// Keys while the editor has the focus: Delete removes the selection, Ctrl/⌘ D duplicates it, Ctrl/⌘ A selects
// everything, Shift A adds a node, F frames the graph, Esc deselects and then closes; Ctrl/⌘ Z and ⇧ Z are the
// application's undo and redo. Every edit is a store action (ui/graph-commands.ts).

import { MATERIAL_GRAPHS } from '../../data/material-graphs';
import { MATERIAL_NODES, NODE_CATEGORIES, nodeSpec, type ParamSpec, type SocketSpec } from '../../data/material-nodes';
import type { ImageRef } from '../../core/images';
import { linkInto, nodeById, visibleInputs, visibleParams, type GraphNode, type GraphRampStop, type MaterialGraph } from '../../core/material-graph';
import { compileGraph } from '../../core/material-program';
import * as gc from '../graph-commands';
import { colorField, field, numberField, segmented, select, slider, toggle, type Control } from '../components/controls';
import { openFloating, openMenu, showConfirmIn } from '../components/widgets';
import { h, icon, isTyping, placeAt } from '../dom';
import { preventedByGuard } from '../guards';
import { dyn, materialName } from '../names';
import { dynamic, type Ctx, type Scope } from '../reactive';
import { kbdText } from '../shortcuts';
import { lbl, t } from '../strings';
import { readTextureFile } from '../texture-commands';
import { normalize } from '../components/palette';
import { graphCanvas, linkSourceText, type GraphCanvas, type Selection } from './graph-canvas';

/** The window's size before it is made another (CSS pixels). */
export const EDITOR_W = 1040;
export const EDITOR_H = 660;
export const EDITOR_MIN_W = 560;
export const EDITOR_MIN_H = 360;
/** The material's sphere in the side panel, pixels. */
const MATERIAL_SPHERE = 128;

// --- The Add node menu ---------------------------------------------------------------------------------

/** The node types the Add node menu offers for a query, by category: label, description and keywords match. */
export function addNodeMatches(query: string): { category: string; types: string[] }[] {
  const q = normalize(query);
  const out: { category: string; types: string[] }[] = [];
  for (const c of NODE_CATEGORIES) {
    const types = MATERIAL_NODES.filter((n) => !n.unique && n.category === c.key)
      .filter((n) => !q || [n.label.en, n.label.es, n.keywords ?? '', n.description.en, n.description.es].some((s) => normalize(s).includes(q)))
      .map((n) => n.key);
    if (types.length > 0) out.push({ category: c.key, types });
  }
  return out;
}

function openAddMenu(ctx: Ctx, material: string, screen: { x: number; y: number }, at: { x: number; y: number }, selection: Selection): void {
  const anchor = h('div', { style: `position:fixed;left:${screen.x}px;top:${screen.y - 6}px;width:0;height:0` });
  document.body.appendChild(anchor);
  const search = h('input', { type: 'search', class: 'text-input', placeholder: t('ge.addNodeSearch'), 'aria-label': t('ge.addNodeSearch'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const list = h('div', { class: 'ge-add-list', role: 'listbox', 'aria-label': t('ge.addNode') });
  let close = () => {};
  let items: HTMLButtonElement[] = [];
  let active = 0;
  const pick = (type: string) => {
    close();
    const id = gc.addGraphNode(ctx, material, type, at.x, at.y);
    if (id) selection.set([id]);
  };
  const mark = () => items.forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
  const fill = () => {
    const groups = addNodeMatches(search.value);
    items = [];
    const rows: HTMLElement[] = [];
    for (const g of groups) {
      rows.push(h('div', { class: 'menu-heading' }, lbl(NODE_CATEGORIES.find((c) => c.key === g.category)!.label)));
      for (const type of g.types) {
        const spec = nodeSpec(type)!;
        const b = h('button', { type: 'button', class: 'menu-item', role: 'option', 'data-add': type, 'data-tip': lbl(spec.description), onclick: () => pick(type) }, lbl(spec.label)) as HTMLButtonElement;
        items.push(b);
        rows.push(b);
      }
    }
    if (items.length === 0) rows.push(h('p', { class: 'note' }, t('ge.noMatch')));
    active = 0;
    list.replaceChildren(...rows);
    mark();
  };
  search.addEventListener('input', fill);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      mark();
      items[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const type = items[active]?.dataset.add;
      if (type) pick(type);
    }
    if (e.key !== 'Escape') e.stopPropagation();
  });
  fill();
  close = openFloating(anchor, h('div', { class: 'ge-add', 'data-ge-add': '' }, search, list), { onClose: () => anchor.remove() });
  requestAnimationFrame(() => search.focus());
}

// --- The node panel -----------------------------------------------------------------------------------

function paramControl(ctx: Ctx, sc: Scope, material: string, node: string, p: ParamSpec): HTMLElement {
  const cur = () => ctx.store.get().materials[material]?.graph?.nodes.find((n) => n.id === node)?.params[p.key];
  const set = (v: unknown, g?: string) => gc.setGraphParam(ctx, material, node, p.key, v as never, g);
  const label = lbl(p.label);
  let ctrl: Control<never> | null = null;
  switch (p.kind) {
    case 'enum':
      ctrl = select((p.options ?? []).map((o) => ({ value: o.value, label: lbl(o.label) })), String(cur()), (v) => set(v), label) as Control<never>;
      break;
    case 'bool':
      ctrl = toggle(cur() === true, (v) => set(v), label) as Control<never>;
      break;
    case 'color':
      ctrl = colorField(cur() as number[], (rgb, g) => set(rgb, g), label) as Control<never>;
      break;
    case 'number':
    case 'int': {
      const range = (p.max ?? 1e6) - (p.min ?? -1e6);
      const props = { value: Number(cur()), min: p.min, max: p.max, step: p.step ?? (p.kind === 'int' ? 1 : 0.01), unit: p.unit, ariaLabel: label, onChange: (v: number, g: string) => set(p.kind === 'int' ? Math.round(v) : v, g) };
      ctrl = (range <= 10 && p.kind === 'number' ? slider({ ...props, min: p.min ?? 0, max: p.max ?? 1 }) : numberField(props)) as Control<never>;
      break;
    }
    case 'image':
      return imageControl(ctx, sc, material, node, p);
    case 'ramp':
      return rampControl(ctx, sc, material, node, p);
  }
  sc.watch(() => cur(), (v) => v !== undefined && (ctrl!.set as (x: unknown) => void)(v));
  return field(label, ctrl!.el);
}

function imageControl(ctx: Ctx, sc: Scope, material: string, node: string, p: ParamSpec): HTMLElement {
  const name = h('span', { class: 'aux ge-image-name' });
  const load = h('button', { type: 'button', class: 'btn', 'data-ge-image-load': '', onclick: () => void readTextureFile(ctx).then((ref) => ref && gc.setGraphParam(ctx, material, node, p.key, ref)) }, t('ge.image.load'));
  const remove = h('button', { type: 'button', class: 'btn', onclick: () => gc.setGraphParam(ctx, material, node, p.key, null) }, t('ge.image.remove'));
  sc.watch(
    (s) => s.materials[material]?.graph?.nodes.find((n) => n.id === node)?.params[p.key] as ImageRef | null | undefined,
    (ref) => {
      name.textContent = ref ? `${ref.name} · ${ref.width} × ${ref.height}` : t('ge.image.none');
      remove.toggleAttribute('disabled', !ref);
    },
  );
  return h('div', { class: 'stack', style: 'gap:6px' }, field(lbl(p.label), name), h('div', { class: 'row', style: 'gap:6px' }, load, remove));
}

/** A colour ramp's stops: a bar that shows it (content), and each stop's position and colour. */
function rampControl(ctx: Ctx, sc: Scope, material: string, node: string, p: ParamSpec): HTMLElement {
  const stopsOf = (): GraphRampStop[] => (ctx.store.get().materials[material]?.graph?.nodes.find((n) => n.id === node)?.params[p.key] as GraphRampStop[] | undefined) ?? [];
  const set = (stops: GraphRampStop[], g?: string) => gc.setGraphParam(ctx, material, node, p.key, stops, g);
  const bar = h('canvas', { class: 'ge-ramp-bar', width: 240, height: 14, 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const paint = (stops: readonly GraphRampStop[]) => {
    const g2 = bar.getContext('2d');
    if (!g2) return;
    const grad = g2.createLinearGradient(0, 0, bar.width, 0);
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    const hex = (c: readonly number[]) => `rgb(${c.map((x) => Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.min(1, x) ** (1 / 2.4) - 0.055))).join(',')})`;
    for (const s of sorted) grad.addColorStop(Math.min(1, Math.max(0, s.pos)), hex(s.color));
    g2.fillStyle = grad;
    g2.fillRect(0, 0, bar.width, bar.height);
  };
  const rows = dynamic(
    sc,
    () => stopsOf().length,
    (rsc) => {
      const els = stopsOf().map((s, i) => {
        const pos = numberField({ value: s.pos, min: 0, max: 1, step: 0.01, digits: 2, ariaLabel: t('ge.ramp.pos'), onChange: (v, g) => set(stopsOf().map((x, j) => (j === i ? { ...x, pos: v } : x)), g) });
        const col = colorField(s.color, (rgb, g) => set(stopsOf().map((x, j) => (j === i ? { ...x, color: rgb } : x)), g), t('ge.ramp.color'));
        rsc.watch(
          () => stopsOf()[i],
          (x) => {
            if (!x) return;
            pos.set(x.pos);
            col.set(x.color);
          },
        );
        const del = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('ge.ramp.remove'), 'data-tip': t('ge.ramp.remove'), disabled: stopsOf().length <= 1, onclick: () => set(stopsOf().filter((_x, j) => j !== i)) }, icon('close', 14));
        return h('div', { class: 'ge-ramp-stop' }, pos.el, col.el, del);
      });
      return h('div', { class: 'stack', style: 'gap:4px' }, ...els);
    },
  );
  const add = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      onclick: () => {
        const stops = [...stopsOf()].sort((a, b) => a.pos - b.pos);
        if (stops.length >= 8) return;
        // In the middle of the widest gap, with the colour there.
        let at = 0;
        let gap = -1;
        for (let i = 0; i + 1 < stops.length; i++) if (stops[i + 1].pos - stops[i].pos > gap) [gap, at] = [stops[i + 1].pos - stops[i].pos, i];
        const a = stops[at] ?? { pos: 0, color: [0, 0, 0] as [number, number, number] };
        const b = stops[at + 1] ?? { pos: 1, color: [1, 1, 1] as [number, number, number] };
        const mid: GraphRampStop = { pos: (a.pos + b.pos) / 2, color: [(a.color[0] + b.color[0]) / 2, (a.color[1] + b.color[1]) / 2, (a.color[2] + b.color[2]) / 2] };
        set([...stopsOf(), mid]);
      },
    },
    icon('plus', 14),
    t('ge.ramp.add'),
  );
  sc.watch(() => stopsOf(), paint);
  return h('div', { class: 'stack ge-ramp', style: 'gap:6px' }, h('div', { class: 'subhead' }, lbl(p.label)), bar, rows, add);
}

function inputControl(ctx: Ctx, sc: Scope, material: string, n: GraphNode, s: SocketSpec, g: MaterialGraph): HTMLElement {
  const label = lbl(s.label);
  if (linkInto(g, n.id, s.key)) {
    const from = h('span', { class: 'aux' }, linkSourceText(g, n.id, s.key) ?? '');
    const off = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('ge.disconnect'), 'data-tip': t('ge.disconnect'), onclick: () => gc.disconnectSocket(ctx, material, n.id, s.key) }, icon('close', 14));
    return field(label, h('div', { class: 'row', style: 'gap:6px;justify-content:space-between' }, from, off));
  }
  if (s.default === undefined) return field(label, h('span', { class: 'aux' }, t(dyn(`ge.implicit.${s.implicit}`))));
  const cur = () => ctx.store.get().materials[material]?.graph?.nodes.find((x) => x.id === n.id)?.inputs[s.key];
  let ctrl: Control<never>;
  if (s.type === 'float') {
    const props = { value: Number(cur()), min: s.min, max: s.max, step: s.step ?? 0.01, unit: s.unit, ariaLabel: label, onChange: (v: number, gg: string) => gc.setGraphInput(ctx, material, n.id, s.key, v, gg) };
    ctrl = ((s.max ?? 1) - (s.min ?? 0) <= 10 ? slider({ ...props, min: s.min ?? 0, max: s.max ?? 1 }) : numberField(props)) as Control<never>;
  } else ctrl = colorField(cur() as number[], (rgb, gg) => gc.setGraphInput(ctx, material, n.id, s.key, rgb, gg), label) as Control<never>;
  sc.watch(() => cur(), (v) => v !== undefined && (ctrl.set as (x: unknown) => void)(v));
  return field(label, ctrl.el);
}

function nodePanel(ctx: Ctx, scope: Scope, material: string, selection: Selection, changed: { on(fn: () => void): void }): HTMLElement {
  const host = h('div', { class: 'me-node', 'data-ge-panel': '' });
  let inner: Scope | null = null;
  let lastKey = '';
  const build = () => {
    const g = ctx.store.get().materials[material]?.graph;
    const ids = [...selection.get()];
    const n = g && ids.length === 1 ? nodeById(g, ids[0]) : undefined;
    // Rebuilt for another node, other visible parameters or inputs, or another set of links into it; values update in place.
    const key = !g ? 'none' : n ? `${n.id}|${n.type}|${visibleParams(n).map((p) => p.key).join(',')}|${visibleInputs(n).map((s) => `${s.key}:${linkInto(g, n.id, s.key) ? 1 : 0}`).join(',')}` : `many:${ids.length}`;
    if (key === lastKey) return;
    lastKey = key;
    inner?.dispose();
    inner = scope.child();
    const sc = inner;
    if (!g) return host.replaceChildren();
    if (!n) {
      if (ids.length === 0) return host.replaceChildren(h('p', { class: 'note' }, t('ge.noSelection')));
      return host.replaceChildren(
        h('div', { class: 'subhead' }, t('ge.selected', { n: ids.length })),
        h('div', { class: 'row', style: 'gap:6px' }, h('button', { type: 'button', class: 'btn', onclick: () => selection.set(gc.duplicateGraphNodes(ctx, material, ids)) }, t('ge.duplicate')), h('button', { type: 'button', class: 'btn', onclick: () => gc.removeGraphNodes(ctx, material, ids) }, t('ge.delete'))),
      );
    }
    const spec = nodeSpec(n.type)!;
    const parts: (HTMLElement | null)[] = [h('div', { class: 'me-node-title' }, lbl(spec.label)), h('p', { class: 'note' }, lbl(spec.description))];
    const params = visibleParams(n);
    if (params.length > 0) parts.push(h('div', { class: 'subhead' }, t('ge.params')), ...params.map((p) => paramControl(ctx, sc, material, n.id, p)));
    const inputs = visibleInputs(n);
    if (inputs.length > 0) parts.push(h('div', { class: 'subhead' }, t('ge.inputs')), ...inputs.map((s) => inputControl(ctx, sc, material, n, s, g)));
    if (!spec.unique) {
      parts.push(
        h('div', { class: 'row', style: 'gap:6px;margin-top:4px' }, h('button', { type: 'button', class: 'btn', onclick: () => selection.set(gc.duplicateGraphNodes(ctx, material, [n.id])) }, t('ge.duplicate')), h('button', { type: 'button', class: 'btn', onclick: () => gc.removeGraphNodes(ctx, material, [n.id]) }, t('ge.delete'))),
      );
    }
    host.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  };
  changed.on(build);
  scope.watch((s) => s.materials[material]?.graph, build);
  scope.onDispose(() => inner?.dispose());
  return host;
}

// --- The window ---------------------------------------------------------------------------------------

export function materialEditor(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui, services } = ctx;
  const material = ui.get().materialEditor!.material;
  const mat = () => store.get().materials[material];

  // The selection of nodes: the editor's own (not the project's, not undone).
  let selected = new Set<string>();
  const listeners: (() => void)[] = [];
  let canvas: GraphCanvas | null = null;
  const selection: Selection = {
    get: () => selected,
    set: (ids) => {
      const g = mat()?.graph;
      selected = new Set([...ids].filter((id) => !g || nodeById(g, id)));
      canvas?.refreshSelection();
      for (const fn of listeners) fn();
    },
  };
  const changed = { on: (fn: () => void) => listeners.push(fn) };

  // ------------------------------------------------------------------ title bar
  const nameEl = h('span', { class: 'aux me-mat-name' });
  scope.watch((s) => s.materials[material], (m) => (nameEl.textContent = m ? materialName(m) : ''));
  const confirmHost = h('div', { class: 'me-confirm' });
  const mode = segmented(
    [
      { value: 'SIMPLE' as const, label: t('ge.simple') },
      { value: 'NODES' as const, label: t('ge.nodes') },
    ],
    mat()?.graph ? 'NODES' : 'SIMPLE',
    (v) => {
      if (v === 'NODES') gc.toNodes(ctx, material);
      else {
        const ask = gc.toSimple(ctx, material);
        if (ask) {
          showConfirmIn(confirmHost, ask);
          mode.set('NODES');
        }
      }
    },
    { ariaLabel: t('ge.modeTip') },
  );
  scope.watch((s) => !!s.materials[material]?.graph, (on) => mode.set(on ? 'NODES' : 'SIMPLE'));
  const examplesBtn = h('button', { type: 'button', class: 'btn', 'aria-haspopup': 'menu', 'data-ge-examples': '' }, t('ge.examples'), icon('chevronDown', 14));
  examplesBtn.addEventListener('click', () =>
    openMenu(
      examplesBtn,
      MATERIAL_GRAPHS.map((g) => ({
        label: lbl(g.label),
        note: lbl(g.description),
        run: () => {
          if (gc.applyExample(ctx, material, g.key)) {
            selection.set([]);
            requestAnimationFrame(() => {
              canvas?.frame();
              // The keys are the editor's again (the menu had the focus).
              canvas?.el.focus({ preventScroll: true });
            });
          }
        },
      })),
    ),
  );
  const addBtn = h('button', { type: 'button', class: 'btn', 'data-ge-addnode': '', 'data-tip': t('ge.addNode'), 'data-kbd': kbdText('shift+a') }, icon('plus', 14), t('ge.addNode'));
  addBtn.addEventListener('click', () => {
    const r = addBtn.getBoundingClientRect();
    if (canvas) openAddMenu(ctx, material, { x: r.left, y: r.bottom + 8 }, canvas.centre(), selection);
  });
  const frameBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('ge.frame'), 'data-tip': t('ge.frame'), 'data-kbd': 'F', onclick: () => canvas?.frame() }, icon('frame', 16));
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.close'), 'data-tip': t('ge.close'), 'data-kbd': t('key.escape'), onclick: () => gc.closeMaterialEditor(ctx) }, icon('close'));
  const titleBar = h('div', { class: 'me-titlebar' }, h('span', { class: 'me-title-text' }, t('ge.title')), nameEl, mode.el, examplesBtn, addBtn, h('span', { style: 'flex:1' }), frameBtn, closeBtn);

  // ------------------------------------------------------------------ canvas and side
  const sphere = h('canvas', { class: 'me-sphere', width: MATERIAL_SPHERE, height: MATERIAL_SPHERE, 'aria-label': t('ge.sphere'), role: 'img', 'data-ge-sphere': '' }) as HTMLCanvasElement;
  const fastNote = h('div', { class: 'me-fast note', 'data-ge-fast': '' });
  const status = h('div', { class: 'me-status aux tabular', role: 'status', 'aria-live': 'polite', 'data-ge-status': '' });
  scope.watch(
    (s) => [s.materials[material]?.graph, s.scene.nodes, s.scene.partSizeMm, s.meta.lang] as const,
    ([g]) => {
      if (!g) {
        fastNote.replaceChildren();
        status.textContent = '';
        return;
      }
      fastNote.replaceChildren(h('div', { class: 'subhead' }, t('ge.fast.title')), ...gc.fastNoteLines(store.get(), material, g).map((line) => h('p', { class: 'note' }, line)));
      status.textContent = gc.graphStatusText(g);
      status.classList.toggle('is-fault', !gc.programOf(g).program);
    },
    (a, b) => a.every((x, i) => x === b[i]),
  );
  const canvasHost = dynamic(
    scope,
    (s) => (s.materials[material] ? (s.materials[material].graph ? 'graph' : 'simple') : 'gone'),
    (sc, key) => {
      canvas = null;
      if (key === 'gone') return h('div', { class: 'me-empty' }, h('p', { class: 'note' }, t('ge.empty.gone')));
      if (key === 'simple') {
        return h('div', { class: 'me-empty' }, h('p', { class: 'note' }, t('ge.empty.simple')), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => gc.toNodes(ctx, material) }, t('ge.empty.toNodes')));
      }
      canvas = graphCanvas({ ctx, scope: sc, material, selection, addMenu: (screen, world) => openAddMenu(ctx, material, screen, world, selection) });
      requestAnimationFrame(() => {
        if (canvas && !canvas.el.dataset.framed) {
          canvas.el.dataset.framed = '1';
          canvas.frame();
        }
      });
      return canvas.el;
    },
    undefined,
    'div',
    'me-canvas-host',
  );
  const side = h('div', { class: 'me-side' }, h('div', { class: 'me-sphere-box' }, sphere), confirmHost, fastNote, nodePanel(ctx, scope, material, selection, changed));
  const keysHint = h('span', { class: 'aux' }, t('ge.keys', { del: kbdText('delete'), dup: kbdText('mod+d'), add: kbdText('shift+a') }));
  const foot = h('div', { class: 'me-foot' }, status, h('span', { style: 'flex:1' }), keysHint);
  const grip = h('div', { class: 'me-grip', 'aria-hidden': 'true' });
  const win = h('div', { class: 'me', role: 'dialog', 'aria-label': t('ge.title'), tabindex: '-1', 'data-guide': 'material-editor', 'data-material-editor': material }, titleBar, h('div', { class: 'me-body' }, canvasHost, side), foot, grip);
  const host = h('div', { class: 'me-mount-inner' }, win);

  // ------------------------------------------------------------------ previews
  let previewTimer = 0;
  let previewSeq = 0;
  const requestPreviews = () => {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      const g = mat()?.graph;
      const port = services.graphPreview;
      if (!g || !port) return;
      const probes = g.nodes.filter((n) => n.type !== 'OUTPUT' && (nodeSpec(n.type)?.outputs.length ?? 0) > 0).map((n) => ({ node: n.id, socket: nodeSpec(n.type)!.outputs[0].key }));
      const { program } = compileGraph(g, { probes });
      if (!program) return;
      const seq = ++previewSeq;
      void port.previews(program, `editor:${material}`).then((r) => {
        if (!r || seq !== previewSeq) return;
        program.probes.forEach((p, i) => canvas?.setPreview(p.node, r.probes[i], r.size));
        const out = g.nodes.find((n) => n.type === 'OUTPUT');
        if (out) canvas?.setPreview(out.id, r.material, r.materialSize);
        const c2 = sphere.getContext('2d');
        if (c2) {
          const img = new ImageData(new Uint8ClampedArray(r.material), r.materialSize, r.materialSize);
          if (r.materialSize === MATERIAL_SPHERE) c2.putImageData(img, 0, 0);
          else {
            const tmp = document.createElement('canvas');
            tmp.width = tmp.height = r.materialSize;
            tmp.getContext('2d')?.putImageData(img, 0, 0);
            c2.clearRect(0, 0, MATERIAL_SPHERE, MATERIAL_SPHERE);
            c2.drawImage(tmp, 0, 0, MATERIAL_SPHERE, MATERIAL_SPHERE);
          }
        }
        win.dataset.previews = String(seq);
      });
    }, 60);
  };
  scope.watch((s) => s.materials[material]?.graph, requestPreviews);
  scope.onDispose(() => window.clearTimeout(previewTimer));

  // ------------------------------------------------------------------ place, move, size
  const fit = () => {
    const r = ui.get().materialEditorRect;
    const w = Math.min(window.innerWidth - 16, Math.max(EDITOR_MIN_W, r?.w ?? EDITOR_W));
    const hh = Math.min(window.innerHeight - 16, Math.max(EDITOR_MIN_H, r?.h ?? EDITOR_H));
    win.style.width = `${w}px`;
    win.style.height = `${hh}px`;
    const x = r ? Math.max(8 - w + 160, Math.min(window.innerWidth - 160, r.x)) : (window.innerWidth - w) / 2;
    const y = r ? Math.max(8, Math.min(window.innerHeight - 48, r.y)) : Math.max(8, (window.innerHeight - hh) / 2);
    placeAt(win, x, y);
    win.style.visibility = '';
  };
  // Hidden until it is placed (a frame after it is mounted, when it has its size).
  win.style.visibility = 'hidden';
  requestAnimationFrame(fit);
  const remember = () => {
    const r = win.getBoundingClientRect();
    const z = win.offsetWidth > 0 ? r.width / win.offsetWidth : 1;
    ui.set({ materialEditorRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width / z), h: Math.round(r.height / z) } });
  };
  const dragFrom = (handle: HTMLElement, move: (dx: number, dy: number, start: DOMRect) => void) => {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, .seg')) return;
      e.preventDefault();
      const start = win.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events.
      }
      win.classList.add('is-moving');
      const onMove = (ev: PointerEvent) => move(ev.clientX - sx, ev.clientY - sy, start);
      const up = () => {
        win.classList.remove('is-moving');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        remember();
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  };
  dragFrom(titleBar, (dx, dy, start) => placeAt(win, Math.max(8 - start.width + 160, Math.min(window.innerWidth - 160, start.left + dx)), Math.max(8, Math.min(window.innerHeight - 48, start.top + dy))));
  dragFrom(grip, (dx, dy, start) => {
    const z = win.offsetWidth > 0 ? start.width / win.offsetWidth : 1;
    win.style.width = `${Math.max(EDITOR_MIN_W, (start.width + dx) / z)}px`;
    win.style.height = `${Math.max(EDITOR_MIN_H, (start.height + dy) / z)}px`;
  });
  titleBar.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('button, .seg')) return;
    ui.set({ materialEditorRect: null });
    fit();
  });

  // ------------------------------------------------------------------ keys
  const onKey = (e: KeyboardEvent): void => {
    // The guards (ui/guards.ts) may have prevented the browser's own action of a key (Ctrl/⌘ D): the editor's still runs.
    if ((e.defaultPrevented && !preventedByGuard(e)) || e.isComposing || !win.contains(e.target as Node) || document.querySelector('.floating')) return;
    if (ui.get().paletteOpen) return;
    const typing = isTyping(e);
    const mod = e.ctrlKey || e.metaKey;
    const act = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    const g = mat()?.graph;
    const ids = [...selected];
    if (e.key === 'Escape' && !typing) return act(() => (selected.size > 0 ? selection.set([]) : gc.closeMaterialEditor(ctx)));
    if (typing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) return act(() => gc.removeGraphNodes(ctx, material, ids));
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') return act(() => selection.set(gc.duplicateGraphNodes(ctx, material, ids)));
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'a') return act(() => selection.set(g?.nodes.map((n) => n.id) ?? []));
    if (!mod && e.shiftKey && e.key.toLowerCase() === 'a') {
      return act(() => {
        const r = (canvas?.el ?? win).getBoundingClientRect();
        if (canvas) openAddMenu(ctx, material, { x: r.left + r.width / 2 - 120, y: r.top + 60 }, canvas.centre(), selection);
      });
    }
    if (!mod && !e.altKey && (e.key === 'f' || e.key === 'F' || e.key === 'Home')) return act(() => canvas?.frame());
    // The rest of the plain keys are the editor's while it has the focus: none reaches the application's tools.
    if (!mod && !e.altKey && e.key !== 'Tab') e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  scope.onDispose(() => document.removeEventListener('keydown', onKey, true));
  requestAnimationFrame(() => win.focus({ preventScroll: true }));
  return host;
}

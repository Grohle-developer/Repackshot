// What the material editor and the inspector do with a material's graph (phase M3a): open and close the editor,
// Simple ↔ Nodes (back to Simple asks when the graph holds more than a family can), the examples, and every edit of
// the canvas and of the node panel. Each one is a store action (core/material-graph.ts), undoable, with its label.

import { MATERIAL_GRAPHS } from '../data/material-graphs';
import { nodeSpec, type SocketType } from '../data/material-nodes';
import type { Label } from '../data/types';
import { exampleGraph, registerLabelImage } from '../core/material-examples';
import {
  backToSimple,
  duplicateIds,
  isMinimal,
  linkProblem,
  newNode,
  nextNodeId,
  nodeById,
  outputSpecOf,
  inputSpecOf,
  type GraphLink,
  type InputValue,
  type MaterialGraph,
  type ParamValue,
} from '../core/material-graph';
import { compileGraph, type CompileResult, type Program } from '../core/material-program';
import { bakeNotes, planBake, BAKE_SIZE, MAPPED_OUTPUTS, type BakeNote } from '../core/material-preview';
import { OUTPUT_KEYS } from '../core/material-program';
import { partMaterials, type MaterialId } from '../core/materials';
import { partsUnder } from '../core/scene';
import type { ProjectState } from '../core/store';
import type { ConfirmSpec } from './components/widgets';
import { dyn, materialLabel } from './names';
import type { Ctx } from './reactive';
import { L, lbl, t } from './strings';

/** The material the editor should open on: the one the selection carries, when it carries one. */
export function editorMaterialFor(ctx: Ctx): MaterialId | null {
  const s = ctx.store.get();
  const sel = s.selection;
  const parts = sel.level === 'FACES' && sel.faces ? [sel.faces.part] : partsUnder(s, sel.ids);
  const mats = new Set<MaterialId>();
  for (const p of parts) for (const m of partMaterials(s.scene.nodes[p])) mats.add(m);
  return mats.size === 1 ? [...mats][0] : null;
}

/**
 * Opens the material editor on a material (the selection's by default). A material in Simple mode goes to Nodes
 * first (its minimal graph: one undo entry). Without a material to open on, says so.
 */
export function openMaterialEditor(ctx: Ctx, material: MaterialId | null = editorMaterialFor(ctx)): boolean {
  const m = material ? ctx.store.get().materials[material] : undefined;
  if (!material || !m) {
    ctx.ui.toast(t('ge.pickOne'));
    return false;
  }
  if (!m.graph) toNodes(ctx, material);
  ctx.ui.set({ materialEditor: { material } });
  return true;
}

export function closeMaterialEditor(ctx: Ctx): void {
  ctx.ui.set({ materialEditor: null });
}

/** Simple → Nodes. */
export function toNodes(ctx: Ctx, material: MaterialId): void {
  const m = ctx.store.get().materials[material];
  if (!m || m.graph) return;
  ctx.store.dispatch({ type: 'graph/enable', material, label: L('undo.graph.enable', { material: materialLabel(m) }) });
}

/**
 * Nodes → Simple: at once when nothing is lost; otherwise the question to ask (the caller shows it), whose answer
 * goes back keeping the output's own values.
 */
export function toSimple(ctx: Ctx, material: MaterialId): ConfirmSpec | null {
  const m = ctx.store.get().materials[material];
  if (!m?.graph) return null;
  const label = L('undo.graph.disable', { material: materialLabel(m) });
  if (backToSimple(m).exact) {
    ctx.store.dispatch({ type: 'graph/disable', material, label });
    return null;
  }
  const extra = m.graph.nodes.length - 1;
  return {
    message: `${t('ge.toSimple.title')} ${isMinimal(m.graph) ? t('ge.toSimple.lossy') : t('ge.toSimple.text', { n: extra })}`,
    options: [{ label: t('ge.toSimple.ok'), primary: true, run: () => ctx.store.dispatch({ type: 'graph/disable', material, force: true, label }) }],
  };
}

/** Lays an example on the material (replacing its graph; one undo entry). The label example gets its picture. */
export function applyExample(ctx: Ctx, material: MaterialId, key: string): boolean {
  const def = MATERIAL_GRAPHS.find((g) => g.key === key);
  const m = ctx.store.get().materials[material];
  if (!def || !m) return false;
  const graph = exampleGraph(key, def.labelImage ? registerLabelImage() : null)!;
  const label = L('undo.graph.example', { example: def.label, material: materialLabel(m) });
  ctx.store.transaction(label, () => {
    if (!ctx.store.get().materials[material].graph) ctx.store.dispatch({ type: 'graph/enable', material });
    ctx.store.dispatch({ type: 'graph/set', material, graph, label });
  });
  return true;
}

const graphOf = (ctx: Ctx, material: MaterialId): MaterialGraph | undefined => ctx.store.get().materials[material]?.graph;
const nodeLabel = (g: MaterialGraph, id: string): Label => nodeSpec(nodeById(g, id)?.type ?? '')?.label ?? { en: id, es: id };

/** Adds a node of a type at a canvas point; with `link`, connected at once. Returns its id. */
export function addGraphNode(ctx: Ctx, material: MaterialId, type: string, x: number, y: number, link?: (id: string) => GraphLink): string | null {
  const g = graphOf(ctx, material);
  const spec = nodeSpec(type);
  if (!g || !spec || spec.unique) return null;
  const id = nextNodeId(g);
  const node = newNode(type, id, x, y)!;
  ctx.store.dispatch({ type: 'graph/addNode', material, node, link: link?.(id), label: L('undo.graph.add', { node: spec.label }) });
  return graphOf(ctx, material)?.nodes.some((n) => n.id === id) ? id : null;
}

export function removeGraphNodes(ctx: Ctx, material: MaterialId, ids: readonly string[]): void {
  const g = graphOf(ctx, material);
  if (!g) return;
  const gone = ids.filter((id) => nodeById(g, id) && nodeById(g, id)!.type !== 'OUTPUT');
  if (gone.length === 0) return;
  const label = gone.length === 1 ? L('undo.graph.removeOne', { node: nodeLabel(g, gone[0]) }) : L('undo.graph.remove', { n: gone.length });
  ctx.store.dispatch({ type: 'graph/removeNodes', material, ids: gone, label });
}

/** Duplicates nodes 30 px away; returns the copies' ids. */
export function duplicateGraphNodes(ctx: Ctx, material: MaterialId, ids: readonly string[]): string[] {
  const g = graphOf(ctx, material);
  if (!g) return [];
  const fresh = duplicateIds(g, ids);
  if (fresh.size === 0) return [];
  ctx.store.dispatch({ type: 'graph/duplicate', material, ids: [...ids], dx: 30, dy: 30, label: L('undo.graph.duplicate', { n: fresh.size }) });
  return [...fresh.values()];
}

/** Moves nodes; a drag passes the same gesture throughout (one undo entry). */
export function moveGraphNodes(ctx: Ctx, material: MaterialId, moves: { id: string; x: number; y: number }[], gesture?: string): void {
  ctx.store.dispatch({ type: 'graph/moveNodes', material, moves, gesture, label: L('undo.graph.move') });
}

const TYPE_WORD = (type: SocketType): string => t(dyn(`ge.type.${type}`));

/** Why a link cannot be made, in words; null when it can. */
export function linkProblemText(g: MaterialGraph, link: GraphLink): string | null {
  const problem = linkProblem({ ...g, links: g.links.filter((l) => !(l.to === link.to && l.input === link.input)) }, link);
  if (!problem) return null;
  if (problem === 'TYPE') {
    const from = outputSpecOf(nodeById(g, link.from)!, link.output)!;
    const to = inputSpecOf(nodeById(g, link.to)!, link.input)!;
    return t('ge.link.TYPE', { from: TYPE_WORD(from.type), to: TYPE_WORD(to.type) });
  }
  return t(dyn(`ge.link.${problem}`));
}

/** Connects two sockets, or says why it cannot (a toast); true when connected. */
export function connectSockets(ctx: Ctx, material: MaterialId, link: GraphLink): boolean {
  const g = graphOf(ctx, material);
  if (!g) return false;
  const why = linkProblemText(g, link);
  if (why) {
    ctx.ui.toast(why);
    return false;
  }
  const from = nodeById(g, link.from)!;
  const to = nodeById(g, link.to)!;
  ctx.store.dispatch({
    type: 'graph/connect',
    material,
    link,
    label: L('undo.graph.connect', { from: nodeSpec(from.type)!.label, to: { en: `${nodeSpec(to.type)!.label.en} · ${inputSpecOf(to, link.input)!.label.en}`, es: `${nodeSpec(to.type)!.label.es} · ${inputSpecOf(to, link.input)!.label.es}` } }),
  });
  return true;
}

export function disconnectSocket(ctx: Ctx, material: MaterialId, node: string, input: string): void {
  const g = graphOf(ctx, material);
  const n = g && nodeById(g, node);
  if (!n) return;
  const spec = inputSpecOf(n, input);
  ctx.store.dispatch({ type: 'graph/disconnect', material, node, input, label: L('undo.graph.disconnect', { node: nodeSpec(n.type)!.label, socket: spec?.label ?? { en: input, es: input } }) });
}

/** Moves the link that goes into (node, input) to another input, or takes it away (`to` null): one undo entry. */
export function relinkSocket(ctx: Ctx, material: MaterialId, from: { node: string; input: string }, to: { node: string; input: string } | null): void {
  const g = graphOf(ctx, material);
  const old = g?.links.find((l) => l.to === from.node && l.input === from.input);
  if (!g || !old) return;
  if (!to) {
    disconnectSocket(ctx, material, from.node, from.input);
    return;
  }
  const link: GraphLink = { from: old.from, output: old.output, to: to.node, input: to.input };
  const why = linkProblemText({ ...g, links: g.links.filter((l) => l !== old) }, link);
  if (why) {
    ctx.ui.toast(why);
    return;
  }
  ctx.store.transaction(L('undo.graph.relink'), () => {
    ctx.store.dispatch({ type: 'graph/disconnect', material, node: from.node, input: from.input });
    ctx.store.dispatch({ type: 'graph/connect', material, link });
  });
}

export function setGraphParam(ctx: Ctx, material: MaterialId, node: string, key: string, value: ParamValue, gesture?: string): void {
  const g = graphOf(ctx, material);
  const n = g && nodeById(g, node);
  if (!n) return;
  const p = nodeSpec(n.type)?.params.find((x) => x.key === key);
  ctx.store.dispatch({ type: 'graph/setParam', material, node, key, value, gesture, label: L('undo.graph.param', { node: nodeSpec(n.type)!.label, param: p?.label ?? { en: key, es: key } }) });
}

export function setGraphInput(ctx: Ctx, material: MaterialId, node: string, input: string, value: InputValue, gesture?: string): void {
  const g = graphOf(ctx, material);
  const n = g && nodeById(g, node);
  if (!n) return;
  const s = inputSpecOf(n, input);
  ctx.store.dispatch({ type: 'graph/setInput', material, node, input, value, gesture, label: L('undo.graph.param', { node: nodeSpec(n.type)!.label, param: s?.label ?? { en: input, es: input } }) });
}

// --- What the editor and the inspector say ------------------------------------------------------------

const compiled = new WeakMap<MaterialGraph, CompileResult>();

/** The graph's program (cached per graph object). */
export function programOf(g: MaterialGraph): CompileResult {
  let r = compiled.get(g);
  if (!r) {
    r = compileGraph(g);
    compiled.set(g, r);
  }
  return r;
}

/** One line on the graph and its program: nodes, links, instructions and registers, or why it does not compile. */
export function graphStatusText(g: MaterialGraph, r: CompileResult = programOf(g)): string {
  if (!r.program) return t(dyn(`ge.error.${r.error!.code}`), { limit: r.error!.limit ?? 0 });
  const p = r.program;
  return t('ge.status', { nodes: g.nodes.length, links: g.links.length, instructions: p.code.length / 6, f: p.nF, v: p.nV - 9 });
}

/** The bounds of the parts that carry a material (part space; null when none has a mesh). */
export function materialBounds(s: ProjectState, material: MaterialId): { min: [number, number, number]; max: [number, number, number] } | null {
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const n of Object.values(s.scene.nodes)) {
    if (!n.mesh || !partMaterials(n).includes(material)) continue;
    const b = n.mesh.bounds;
    if (!Number.isFinite(b.min[0])) continue;
    min = [Math.min(min[0], b.min[0]), Math.min(min[1], b.min[1]), Math.min(min[2], b.min[2])];
    max = [Math.max(max[0], b.max[0]), Math.max(max[1], b.max[1]), Math.max(max[2], b.max[2])];
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/** The outputs of a program that are not constants (what may vary over the part). */
export function varyingOutputs(p: Program): string[] {
  return OUTPUT_KEYS.filter((_k, i) => p.outputs[i].kind === 'F' || p.outputs[i].kind === 'V').filter((k, i) => !(k === 'normal' && p.outputs[i].kind === 'V' && p.outputs[i].index === 1));
}

/**
 * How Fast shows the material, in sentences: the maps and the surface they are made on, then what is approximated
 * or left out. What Full does with it until the engine evaluates graphs (M3b) comes last.
 */
export function fastNoteLines(s: ProjectState, material: MaterialId, g: MaterialGraph): string[] {
  const r = programOf(g);
  if (!r.program) return [graphStatusText(g, r)];
  const plan = planBake(r.program, materialBounds(s, material), s.scene.partSizeMm);
  const { notes, means } = bakeNotes(plan, varyingOutputs(r.program));
  const lines: string[] = [];
  const size = BAKE_SIZE;
  if (plan.mode === 'UV') lines.push(t('ge.fast.UV', { size }));
  else if (plan.mode === 'PROJECTION') lines.push(t('ge.fast.PROJECTION', { size, projection: t(dyn(`texture.projection.${plan.mapping.projection}`)).toLowerCase() }));
  else lines.push(t('ge.fast.TRIPLANAR', { size }));
  for (const n of notes as BakeNote[]) {
    if (n === 'TRIPLANAR') continue;
    if (n === 'MEANS') {
      const names = means.map((k) => lbl(nodeSpec('OUTPUT')!.inputs.find((x) => x.key === k)!.label).toLowerCase());
      lines.push(t('ge.fast.note.MEANS', { list: names.join(', ') }));
    } else lines.push(t(dyn(`ge.fast.note.${n}`)));
  }
  lines.push(t('ge.full.note'));
  return lines;
}

/** Outputs a material map of Fast holds (for tests of the note). */
export const FAST_MAPPED = MAPPED_OUTPUTS;

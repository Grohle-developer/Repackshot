// Material graphs (phase M3a, SPEC §3.3, ARCHITECTURE §5.2 quater): a material made of nodes instead of the
// parameters of its family. Pure: no DOM, no three.
//
// A graph is a typed DAG: nodes of the catalogue (data/material-nodes.ts), each with its parameters and the inline
// values of its unconnected inputs, and links from an output socket to an input socket. One node is the material
// output; what it receives at a point is the material at that point. The compiler (core/material-program.ts) turns
// the graph into the linear program the engine runs (M3b) and the preview interprets.
//
// Socket types and the implicit conversions a link may make (anything else is refused):
//
//   from \ to   float           colour             vector          normal
//   float       =               (f, f, f)          (f, f, f)       —
//   colour      luminance       =                  (r, g, b)       —
//   vector      (x + y + z)/3   (x, y, z)          =               —
//   normal      —               —                  (x, y, z)       =
//
// Luminance is 0.2126 r + 0.7152 g + 0.0722 b (Rec. 709, the weights of M2a's `L` channel). A normal only goes into
// a normal or a vector input; a colour becomes a normal only through the Normal map node.
//
// A material is in Nodes mode when it has a `graph`; its family and parameters stay as they were (Simple), so going
// back to Simple from a graph nobody changed gives the material back exactly. Simple → Nodes makes the minimal
// graph: the output node alone, its inline values the material's (`outputSetup`). Nodes → Simple happens without a
// question only when the graph is minimal: the output node alone, no links, and values a family can hold exactly;
// otherwise the interface asks, and `force` takes the output's own values.
//
// The image maps and labels of M2a (`material.textures`) stay a layer over the material in both modes: in Nodes
// mode they lie over what the graph gives, as they lie over the parameters in Simple mode.
//
// Serialised in the project as `material.graph` (`version` 1); files from before M3a have no such field and open
// as Simple materials. Every edit is an action of the store (`graph/*`, below): undoable, one entry each, a drag one
// entry, no entry when nothing changes.

import { nodeSpec, OUTPUT_INPUTS, type NodeSpec, type ParamSpec, type SocketSpec, type SocketType } from '../data/material-nodes';
import type { MaterialFamily, MaterialParams } from '../data/types';
import type { ImageRef } from './images';
import { nextId, nextIds } from './ids';
import { kelvinToRgb } from './light-math';
import type { MaterialId, MaterialInstance } from './materials';
import { EMIT_RADIANCE_PER_WATT } from './photometry';
import type { ActionBase, ProjectState } from './store';

// --- Vocabulary -----------------------------------------------------------------------------------

/** The schema of a graph in a project; a graph of a newer version is not read (the material opens as Simple). */
export const GRAPH_VERSION = 1;

export type Vec3 = [number, number, number];
/** The inline value of an input: a number (float) or three (colour, vector). */
export type InputValue = number | Vec3;
export interface GraphRampStop {
  pos: number;
  color: Vec3;
}
export type ParamValue = string | number | boolean | Vec3 | ImageRef | null | GraphRampStop[];

export interface GraphNode {
  /** Unique in its graph: 'n1', 'n2'… */
  id: string;
  /** A key of the node catalogue. */
  type: string;
  /** Where it is drawn on the editor's canvas (its top-left corner, canvas pixels). */
  x: number;
  y: number;
  /** Every parameter of its type. */
  params: Record<string, ParamValue>;
  /** The inline value of every input of its type that has one (used while the input is not connected). */
  inputs: Record<string, InputValue>;
}

/** From the output socket `output` of node `from` to the input socket `input` of node `to`. */
export interface GraphLink {
  from: string;
  output: string;
  to: string;
  input: string;
}

export interface MaterialGraph {
  version: number;
  nodes: GraphNode[];
  links: GraphLink[];
}

// --- Limits ---------------------------------------------------------------------------------------

/** The most nodes a graph may hold (the compiled program has its own limits, material-program.ts). */
export const GRAPH_MAX_NODES = 256;
export const GRAPH_MAX_LINKS = 512;
export const RAMP_MAX_STOPS = 8;
/** The canvas coordinates a node may have. */
const CANVAS_LIMIT = 1e5;

export const OUTPUT_TYPE = 'OUTPUT';

// --- Small helpers --------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const vec3Of = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every(finite) ? [v[0], v[1], v[2]] : null);
const copy3 = (v: readonly number[]): Vec3 => [v[0], v[1], v[2]];

function imageRefOf(v: unknown): ImageRef | null {
  if (!isObject(v) || typeof v.id !== 'string' || v.id === '' || typeof v.name !== 'string') return null;
  if (!finite(v.width) || !finite(v.height) || !(v.width > 0 && v.height > 0)) return null;
  return { id: v.id, name: v.name, width: Math.round(v.width), height: Math.round(v.height) };
}

/** A deep copy of a parameter value. */
function copyParam(v: ParamValue): ParamValue {
  if (Array.isArray(v)) {
    if (v.length > 0 && isObject(v[0])) return (v as GraphRampStop[]).map((s) => ({ pos: s.pos, color: copy3(s.color) }));
    return copy3(v as number[]);
  }
  if (isObject(v)) return { ...(v as unknown as ImageRef) };
  return v;
}

export function cloneNode(n: GraphNode): GraphNode {
  const params: Record<string, ParamValue> = {};
  for (const [k, v] of Object.entries(n.params)) params[k] = copyParam(v);
  const inputs: Record<string, InputValue> = {};
  for (const [k, v] of Object.entries(n.inputs)) inputs[k] = Array.isArray(v) ? copy3(v) : v;
  return { id: n.id, type: n.type, x: n.x, y: n.y, params, inputs };
}

export function cloneGraph(g: MaterialGraph): MaterialGraph {
  return { version: g.version, nodes: g.nodes.map(cloneNode), links: g.links.map((l) => ({ ...l })) };
}

// --- Sockets --------------------------------------------------------------------------------------

/** Whether a link may carry a value of type `from` into an input of type `to` (the table above). */
export function canConvert(from: SocketType, to: SocketType): boolean {
  if (from === to) return true;
  if (to === 'normal') return false;
  if (from === 'normal') return to === 'vector';
  return true;
}

export function inputSpecOf(node: GraphNode, key: string): SocketSpec | undefined {
  return nodeSpec(node.type)?.inputs.find((s) => s.key === key);
}

export function outputSpecOf(node: GraphNode, key: string): SocketSpec | undefined {
  return nodeSpec(node.type)?.outputs.find((s) => s.key === key);
}

/** Whether a socket or a parameter with a `when` is shown (and compiled) for a node's current parameters. */
export function shownFor(node: GraphNode, when: { param: string; values: readonly string[] } | undefined): boolean {
  return !when || when.values.includes(String(node.params[when.param]));
}

/** The inputs a node shows (and the compiler reads) for its parameters. */
export function visibleInputs(node: GraphNode): SocketSpec[] {
  return (nodeSpec(node.type)?.inputs ?? []).filter((s) => shownFor(node, s.when));
}

export function visibleParams(node: GraphNode): ParamSpec[] {
  return (nodeSpec(node.type)?.params ?? []).filter((p) => shownFor(node, p.when));
}

// --- Values ---------------------------------------------------------------------------------------

/** A parameter value as a file has it, kept within its kind and range; the default when it does not fit. */
export function normalizeParam(spec: ParamSpec, v: unknown): ParamValue {
  const d = spec.default;
  switch (spec.kind) {
    case 'enum':
      return typeof v === 'string' && (spec.options ?? []).some((o) => o.value === v) ? v : (d as string);
    case 'number':
      return finite(v) ? clamp(v, spec.min ?? -1e6, spec.max ?? 1e6) : (d as number);
    case 'int':
      return finite(v) ? clamp(Math.round(v), spec.min ?? -1e6, spec.max ?? 1e6) : (d as number);
    case 'bool':
      return typeof v === 'boolean' ? v : (d as boolean);
    case 'color': {
      const c = vec3Of(v);
      return c ? (c.map((x) => clamp(x, 0, 1e4)) as Vec3) : copy3(d as readonly number[]);
    }
    case 'image':
      return imageRefOf(v);
    case 'ramp': {
      const stops: GraphRampStop[] = [];
      if (Array.isArray(v)) {
        for (const s of v.slice(0, RAMP_MAX_STOPS)) {
          const color = isObject(s) ? vec3Of(s.color) : null;
          if (!isObject(s) || !finite(s.pos) || !color) continue;
          stops.push({ pos: clamp(s.pos, 0, 1), color: color.map((x) => clamp(x, 0, 1e4)) as Vec3 });
        }
      }
      if (stops.length > 0) return stops;
      return (d as readonly { pos: number; color: readonly number[] }[]).map((s) => ({ pos: s.pos, color: copy3(s.color) }));
    }
  }
}

/** An inline input value within its socket's type and range; the default when it does not fit. */
export function normalizeInput(spec: SocketSpec, v: unknown): InputValue {
  if (spec.type === 'float') {
    const d = typeof spec.default === 'number' ? spec.default : 0;
    return finite(v) ? clamp(v, spec.min ?? -1e6, spec.max ?? 1e6) : d;
  }
  const d = Array.isArray(spec.default) ? copy3(spec.default) : ([0, 0, 0] as Vec3);
  const c = vec3Of(v);
  if (!c) return d;
  return spec.type === 'color' ? (c.map((x) => clamp(x, 0, 1e4)) as Vec3) : (c.map((x) => clamp(x, -1e6, 1e6)) as Vec3);
}

/** A new node of a catalogue type with its defaults; null for a type this version does not know. */
export function newNode(type: string, id: string, x = 0, y = 0): GraphNode | null {
  const spec = nodeSpec(type);
  if (!spec) return null;
  const params: Record<string, ParamValue> = {};
  for (const p of spec.params) params[p.key] = normalizeParam(p, undefined);
  const inputs: Record<string, InputValue> = {};
  for (const s of spec.inputs) if (s.default !== undefined) inputs[s.key] = normalizeInput(s, undefined);
  return { id, type, x: Math.round(x), y: Math.round(y), params, inputs };
}

/** A node as a file has it, every field checked; null for one this version cannot hold. */
export function normalizeNode(v: unknown): GraphNode | null {
  if (!isObject(v) || typeof v.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(v.id) || typeof v.type !== 'string') return null;
  const spec = nodeSpec(v.type);
  if (!spec) return null;
  const rawParams = isObject(v.params) ? v.params : {};
  const rawInputs = isObject(v.inputs) ? v.inputs : {};
  const params: Record<string, ParamValue> = {};
  for (const p of spec.params) params[p.key] = normalizeParam(p, rawParams[p.key]);
  const inputs: Record<string, InputValue> = {};
  for (const s of spec.inputs) if (s.default !== undefined) inputs[s.key] = normalizeInput(s, rawInputs[s.key]);
  return { id: v.id, type: spec.key, x: finite(v.x) ? clamp(v.x, -CANVAS_LIMIT, CANVAS_LIMIT) : 0, y: finite(v.y) ? clamp(v.y, -CANVAS_LIMIT, CANVAS_LIMIT) : 0, params, inputs };
}

// --- Structure ------------------------------------------------------------------------------------

export function nodeById(g: MaterialGraph, id: string): GraphNode | undefined {
  return g.nodes.find((n) => n.id === id);
}

export function outputNode(g: MaterialGraph): GraphNode | undefined {
  return g.nodes.find((n) => n.type === OUTPUT_TYPE);
}

/** The link into an input, if any. */
export function linkInto(g: MaterialGraph, node: string, input: string): GraphLink | undefined {
  return g.links.find((l) => l.to === node && l.input === input);
}

/** Whether node `a` depends on node `b` (b is upstream of a, or a is b). */
export function dependsOn(g: MaterialGraph, a: string, b: string): boolean {
  const seen = new Set<string>();
  const stack = [a];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n === b) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const l of g.links) if (l.to === n) stack.push(l.from);
  }
  return false;
}

/** Why a link cannot be made, or null when it can. */
export type LinkProblem = 'NODE' | 'SOCKET' | 'SELF' | 'TYPE' | 'CYCLE';

export function linkProblem(g: MaterialGraph, link: GraphLink): LinkProblem | null {
  const from = nodeById(g, link.from);
  const to = nodeById(g, link.to);
  if (!from || !to) return 'NODE';
  const out = outputSpecOf(from, link.output);
  const inp = inputSpecOf(to, link.input);
  if (!out || !inp) return 'SOCKET';
  if (from.id === to.id) return 'SELF';
  if (!canConvert(out.type, inp.type)) return 'TYPE';
  // The new link makes `to` depend on `from`: refused when `from` already depends on `to`.
  if (dependsOn(g, from.id, to.id)) return 'CYCLE';
  return null;
}

/** The graph with a link added (replacing the one that went into the same input); unchanged when it cannot be made. */
export function withLink(g: MaterialGraph, link: GraphLink): MaterialGraph {
  if (linkProblem({ ...g, links: g.links.filter((l) => !(l.to === link.to && l.input === link.input)) }, link)) return g;
  const links = g.links.filter((l) => !(l.to === link.to && l.input === link.input));
  if (links.length >= GRAPH_MAX_LINKS) return g;
  return { ...g, links: [...links, { from: link.from, output: link.output, to: link.to, input: link.input }] };
}

/**
 * A graph as a file has it: the nodes this version knows (unknown ones and their links dropped), exactly one
 * output node (added when missing, the later ones dropped), links that fit (valid ends, types that convert, one per
 * input, no cycles; in the file's order). Null for what is not a graph or comes from a newer version.
 */
export function normalizeGraph(v: unknown): MaterialGraph | null {
  if (!isObject(v) || !Array.isArray(v.nodes)) return null;
  const version = v.version === undefined ? 1 : v.version;
  if (!finite(version) || version < 1 || version > GRAPH_VERSION) return null;
  const nodes: GraphNode[] = [];
  const ids = new Set<string>();
  let hasOutput = false;
  for (const raw of v.nodes.slice(0, GRAPH_MAX_NODES)) {
    const n = normalizeNode(raw);
    if (!n || ids.has(n.id)) continue;
    if (n.type === OUTPUT_TYPE) {
      if (hasOutput) continue;
      hasOutput = true;
    }
    ids.add(n.id);
    nodes.push(n);
  }
  if (!hasOutput) nodes.push(newNode(OUTPUT_TYPE, nextId('n', ids), 600, 80)!);
  let g: MaterialGraph = { version: GRAPH_VERSION, nodes, links: [] };
  if (Array.isArray(v.links)) {
    for (const raw of v.links.slice(0, GRAPH_MAX_LINKS)) {
      if (!isObject(raw) || typeof raw.from !== 'string' || typeof raw.output !== 'string' || typeof raw.to !== 'string' || typeof raw.input !== 'string') continue;
      const link: GraphLink = { from: raw.from, output: raw.output, to: raw.to, input: raw.input };
      if (linkInto(g, link.to, link.input) || linkProblem(g, link)) continue;
      g = { ...g, links: [...g.links, link] };
    }
  }
  return g;
}

/** The images a graph's image nodes name, once each. */
export function graphImageRefs(g: MaterialGraph | null | undefined): ImageRef[] {
  const out: ImageRef[] = [];
  for (const n of g?.nodes ?? []) {
    const r = n.type === 'IMAGE' ? (n.params.image as ImageRef | null) : null;
    if (r && !out.some((x) => x.id === r.id)) out.push(r);
  }
  return out;
}

/** The graph with each image node's image passed through `fix` (null empties the node); the same graph when none changes. */
export function mapGraphImages(g: MaterialGraph, fix: (ref: ImageRef) => ImageRef | null): MaterialGraph {
  let changed = false;
  const nodes = g.nodes.map((n) => {
    const r = n.type === 'IMAGE' ? (n.params.image as ImageRef | null) : null;
    if (!r) return n;
    const next = fix(r);
    if (next === r) return n;
    changed = true;
    return { ...n, params: { ...n.params, image: next ? { ...next } : null } };
  });
  return changed ? { ...g, nodes } : g;
}

// --- Simple ↔ Nodes -------------------------------------------------------------------------------

/** The output node's inline values and parameters for a material of parameters (what the minimal graph holds). */
export interface OutputSetup {
  inputs: Record<string, InputValue>;
  params: { absorptionMm: number; thinWalls: boolean };
}

const num = (v: unknown, d: number): number => (finite(v) ? v : d);
const rgbOf = (v: unknown, d: readonly number[]): Vec3 => (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(finite) ? [v[0], v[1], v[2]] : copy3(d));

/**
 * What the output of a material's minimal graph receives: the values the engine and the preview read from its
 * parameters (io/rsb.ts `materialToRsb`, render/materials.ts), family by family. Wood and fabric become their flat
 * colour (their rings and weave are the engine's, E6): the conversion keeps their parameters, so going back to
 * Simple without changes gives them back.
 */
export function outputSetup(m: Pick<MaterialInstance, 'family' | 'params'>): OutputSetup {
  const inputs: Record<string, InputValue> = {};
  for (const s of OUTPUT_INPUTS) if (s.default !== undefined) inputs[s.key] = normalizeInput(s, undefined);
  const p = m.params;
  const params = { absorptionMm: 0, thinWalls: false };
  const set = (k: string, v: InputValue) => (inputs[k] = normalizeInput(OUTPUT_INPUTS.find((s) => s.key === k)!, v));
  switch (m.family) {
    case 'SIMPLE': {
      const base = Array.isArray(p.baseColor) ? p.baseColor : [0.8, 0.8, 0.8, 1];
      set('baseColor', rgbOf(base, [0.8, 0.8, 0.8]));
      set('metallic', num(p.metallic, 0));
      set('roughness', num(p.roughness, 0.5));
      set('coat', num(p.coat, 0));
      set('coatRoughness', num(p.coatRoughness, 0.03));
      set('ior', num(p.ior, 1.5));
      set('transmission', num(p.transmission, 0));
      set('anisotropic', num(p.anisotropic, 0));
      set('subsurface', num(p.subsurface, 0));
      set('opacity', num(p.opacity, 1) * num(base[3], 1));
      break;
    }
    case 'GLASS':
      set('baseColor', rgbOf(p.baseColor, [1, 1, 1]));
      set('roughness', num(p.roughness, 0));
      set('ior', num(p.ior, 1.52));
      set('transmission', num(p.transmission, 1));
      params.absorptionMm = clamp(num(p.absorptionMm, 50), 0, 5000);
      params.thinWalls = p.walls === 'THIN';
      break;
    case 'WOOD': {
      const a = rgbOf(p.woodColor1, [0.56, 0.38, 0.21]);
      const b = rgbOf(p.woodColor2, [0.3, 0.18, 0.09]);
      set('baseColor', [a[0] * 0.6 + b[0] * 0.4, a[1] * 0.6 + b[1] * 0.4, a[2] * 0.6 + b[2] * 0.4]);
      set('roughness', num(p.roughness, 0.45));
      set('coat', num(p.coat, 0));
      break;
    }
    case 'FABRIC': {
      const a = rgbOf(p.threadColor1, [0.7, 0.7, 0.68]);
      const b = rgbOf(p.threadColor2, [0.6, 0.6, 0.58]);
      set('baseColor', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
      set('roughness', num(p.roughness, 0.75));
      set('coat', num(p.coat, 0));
      set('coatRoughness', num(p.coatRoughness, 0.05));
      break;
    }
    case 'EMISSIVE':
      set('baseColor', [0.03, 0.03, 0.03]);
      set('roughness', 0.4);
      set('emission', p.emitKind === 'COLOR' ? rgbOf(p.emitColor, [1, 1, 1]) : copy3(kelvinToRgb(num(p.temperature, 5600))));
      set('emissionStrength', Math.max(0, num(p.emitPower, 50)) * EMIT_RADIANCE_PER_WATT);
      break;
  }
  return { inputs, params };
}

/** Where a new graph's output node sits on the canvas. */
export const OUTPUT_POSITION = { x: 560, y: 60 } as const;

/** The minimal graph of a material of parameters: its output node alone, with the material's values. */
export function minimalGraph(m: Pick<MaterialInstance, 'family' | 'params'>): MaterialGraph {
  const node = newNode(OUTPUT_TYPE, 'n1', OUTPUT_POSITION.x, OUTPUT_POSITION.y)!;
  const s = outputSetup(m);
  node.inputs = s.inputs;
  node.params = { ...node.params, absorptionMm: s.params.absorptionMm, thinWalls: s.params.thinWalls };
  return { version: GRAPH_VERSION, nodes: [node], links: [] };
}

/** A graph that is its output node alone, with nothing connected. */
export function isMinimal(g: MaterialGraph): boolean {
  return g.nodes.length === 1 && g.nodes[0].type === OUTPUT_TYPE && g.links.length === 0;
}

const close = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function sameSetup(s: OutputSetup, node: GraphNode): boolean {
  if (!close(Number(node.params.absorptionMm), s.params.absorptionMm) || node.params.thinWalls !== s.params.thinWalls) return false;
  for (const [k, v] of Object.entries(s.inputs)) {
    const w = node.inputs[k];
    if (Array.isArray(v) !== Array.isArray(w)) return false;
    if (Array.isArray(v)) {
      if (!v.every((x, i) => close(x, (w as Vec3)[i]))) return false;
    } else if (!close(v, w as number)) return false;
  }
  return true;
}

/**
 * The family and parameters that hold an output node's own values: an emitter when it emits, glass when it has an
 * absorption distance or thin walls, the plain family otherwise. Links are not looked at.
 */
export function simpleFromOutput(node: GraphNode): { family: MaterialFamily; params: MaterialParams } {
  const v = node.inputs;
  const n = (k: string, d: number) => num(v[k], d);
  const c = (k: string, d: readonly number[]) => rgbOf(v[k], d);
  const emission = c('emission', [0, 0, 0]);
  const strength = n('emissionStrength', 1);
  const base = c('baseColor', [0.8, 0.8, 0.8]);
  if (strength > 0 && Math.max(...emission) > 0) {
    return { family: 'EMISSIVE', params: { emitKind: 'COLOR', emitColor: [emission[0], emission[1], emission[2], 1], emitPower: strength / EMIT_RADIANCE_PER_WATT } };
  }
  const absorptionMm = num(node.params.absorptionMm, 0);
  if (absorptionMm > 0 || node.params.thinWalls === true) {
    return {
      family: 'GLASS',
      params: { baseColor: [base[0], base[1], base[2], 1], roughness: n('roughness', 0), ior: n('ior', 1.52), transmission: n('transmission', 1), absorptionMm, walls: node.params.thinWalls === true ? 'THIN' : 'SOLID' },
    };
  }
  return {
    family: 'SIMPLE',
    params: {
      baseColor: [base[0], base[1], base[2], 1],
      metallic: n('metallic', 0),
      roughness: n('roughness', 0.5),
      coat: n('coat', 0),
      coatRoughness: n('coatRoughness', 0.03),
      ior: n('ior', 1.5),
      transmission: n('transmission', 0),
      opacity: n('opacity', 1),
      anisotropic: n('anisotropic', 0),
      subsurface: n('subsurface', 0),
    },
  };
}

/** A material without its graph (the key goes away, as before M3a). */
function withoutGraph(m: MaterialInstance): MaterialInstance {
  const { graph: _drop, ...rest } = m;
  return rest;
}

/**
 * Going back to Simple: `exact` when nothing is lost (the graph is minimal and its values are the material's own,
 * or ones a family holds exactly); `material` is the material without its graph, with the family and parameters
 * of the output's own values unless they are the material's own already.
 */
export function backToSimple(m: MaterialInstance): { exact: boolean; material: MaterialInstance } {
  const g = m.graph;
  if (!g) return { exact: true, material: m };
  const out = outputNode(g);
  if (!out) return { exact: false, material: withoutGraph(m) };
  if (isMinimal(g) && sameSetup(outputSetup(m), out)) return { exact: true, material: withoutGraph(m) };
  const s = simpleFromOutput(out);
  const exact = isMinimal(g) && sameSetup(outputSetup(s), out);
  return { exact, material: { ...withoutGraph(m), family: s.family, params: s.params } };
}

// --- Ids ------------------------------------------------------------------------------------------

/** The id the next node of a graph gets. */
export function nextNodeId(g: MaterialGraph): string {
  return nextId('n', g.nodes.map((n) => n.id));
}

/** The ids `graph/duplicate` gives the copies of `ids`, in the order of the graph's nodes. */
export function duplicateIds(g: MaterialGraph, ids: readonly string[]): Map<string, string> {
  const sources = g.nodes.filter((n) => ids.includes(n.id) && n.type !== OUTPUT_TYPE);
  const fresh = nextIds('n', g.nodes.map((n) => n.id), sources.length);
  return new Map(sources.map((n, i) => [n.id, fresh[i]]));
}

// --- Actions --------------------------------------------------------------------------------------

export type GraphAction =
  /** Simple → Nodes: the material gets its minimal graph. */
  | ({ type: 'graph/enable'; material: MaterialId } & ActionBase)
  /** Nodes → Simple: only when exact (`backToSimple`), or with `force` (the interface asked). */
  | ({ type: 'graph/disable'; material: MaterialId; force?: boolean } & ActionBase)
  /** The whole graph (an example, a paste). */
  | ({ type: 'graph/set'; material: MaterialId; graph: MaterialGraph } & ActionBase)
  /** A node; with `link`, connected at once (one undo entry). */
  | ({ type: 'graph/addNode'; material: MaterialId; node: GraphNode; link?: GraphLink } & ActionBase)
  /** Nodes and their links; the output node stays. */
  | ({ type: 'graph/removeNodes'; material: MaterialId; ids: string[] } & ActionBase)
  | ({ type: 'graph/moveNodes'; material: MaterialId; moves: { id: string; x: number; y: number }[] } & ActionBase)
  | ({ type: 'graph/setParam'; material: MaterialId; node: string; key: string; value: ParamValue } & ActionBase)
  | ({ type: 'graph/setInput'; material: MaterialId; node: string; input: string; value: InputValue } & ActionBase)
  /** A link, replacing the one that went into the same input; refused (no change) when `linkProblem` says so. */
  | ({ type: 'graph/connect'; material: MaterialId; link: GraphLink } & ActionBase)
  | ({ type: 'graph/disconnect'; material: MaterialId; node: string; input: string } & ActionBase)
  /** Copies of the nodes, `dx`, `dy` away, with the links among them (ids: `duplicateIds`). */
  | ({ type: 'graph/duplicate'; material: MaterialId; ids: string[]; dx: number; dy: number } & ActionBase);

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function setMaterial(state: ProjectState, id: MaterialId, m: MaterialInstance): ProjectState {
  return { ...state, materials: { ...state.materials, [id]: m } };
}

/** Applies `fn` to a material's graph; no graph or no change is the same state. Edits make the material the user's own. */
function editGraph(state: ProjectState, id: MaterialId, fn: (g: MaterialGraph) => MaterialGraph | null): ProjectState {
  const m = state.materials[id];
  if (!m?.graph) return state;
  const next = fn(m.graph);
  if (!next || next === m.graph || sameValue(next, m.graph)) return state;
  return setMaterial(state, id, { ...m, graph: next, preset: null, edited: true });
}

function patchNode(g: MaterialGraph, id: string, fn: (n: GraphNode) => GraphNode | null): MaterialGraph | null {
  const i = g.nodes.findIndex((n) => n.id === id);
  if (i < 0) return null;
  const n = fn(g.nodes[i]);
  if (!n) return null;
  const nodes = [...g.nodes];
  nodes[i] = n;
  return { ...g, nodes };
}

export function reduceGraph(state: ProjectState, action: GraphAction): ProjectState {
  switch (action.type) {
    case 'graph/enable': {
      const m = state.materials[action.material];
      if (!m || m.graph) return state;
      // A material in Nodes mode is the user's own: an assignment of its preset must not reuse it.
      return setMaterial(state, action.material, { ...m, graph: minimalGraph(m), preset: null, edited: true });
    }
    case 'graph/disable': {
      const m = state.materials[action.material];
      if (!m?.graph) return state;
      const back = backToSimple(m);
      if (!back.exact && !action.force) return state;
      return setMaterial(state, action.material, { ...back.material, preset: null, edited: true });
    }
    case 'graph/set': {
      const m = state.materials[action.material];
      const g = normalizeGraph(action.graph);
      if (!m || !g) return state;
      if (m.graph && sameValue(g, m.graph)) return state;
      return setMaterial(state, action.material, { ...m, graph: g, preset: null, edited: true });
    }
    case 'graph/addNode':
      return editGraph(state, action.material, (g) => {
        const n = normalizeNode(action.node);
        if (!n || n.type === OUTPUT_TYPE || g.nodes.length >= GRAPH_MAX_NODES || nodeById(g, n.id)) return null;
        const next = { ...g, nodes: [...g.nodes, n] };
        return action.link ? withLink(next, action.link) : next;
      });
    case 'graph/removeNodes':
      return editGraph(state, action.material, (g) => {
        const gone = new Set(g.nodes.filter((n) => action.ids.includes(n.id) && n.type !== OUTPUT_TYPE).map((n) => n.id));
        if (gone.size === 0) return null;
        return { ...g, nodes: g.nodes.filter((n) => !gone.has(n.id)), links: g.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)) };
      });
    case 'graph/moveNodes':
      return editGraph(state, action.material, (g) => {
        const by = new Map(action.moves.filter((mv) => finite(mv.x) && finite(mv.y)).map((mv) => [mv.id, mv]));
        let changed = false;
        const nodes = g.nodes.map((n) => {
          const mv = by.get(n.id);
          if (!mv) return n;
          const x = clamp(Math.round(mv.x), -CANVAS_LIMIT, CANVAS_LIMIT);
          const y = clamp(Math.round(mv.y), -CANVAS_LIMIT, CANVAS_LIMIT);
          if (x === n.x && y === n.y) return n;
          changed = true;
          return { ...n, x, y };
        });
        return changed ? { ...g, nodes } : null;
      });
    case 'graph/setParam':
      return editGraph(state, action.material, (g) =>
        patchNode(g, action.node, (n) => {
          const spec = nodeSpec(n.type)?.params.find((p) => p.key === action.key);
          if (!spec) return null;
          return { ...n, params: { ...n.params, [action.key]: normalizeParam(spec, action.value) } };
        }),
      );
    case 'graph/setInput':
      return editGraph(state, action.material, (g) =>
        patchNode(g, action.node, (n) => {
          const spec = inputSpecOf(n, action.input);
          if (!spec || spec.default === undefined) return null;
          return { ...n, inputs: { ...n.inputs, [action.input]: normalizeInput(spec, action.value) } };
        }),
      );
    case 'graph/connect':
      return editGraph(state, action.material, (g) => withLink(g, action.link));
    case 'graph/disconnect':
      return editGraph(state, action.material, (g) => (linkInto(g, action.node, action.input) ? { ...g, links: g.links.filter((l) => !(l.to === action.node && l.input === action.input)) } : null));
    case 'graph/duplicate':
      return editGraph(state, action.material, (g) => {
        const ids = duplicateIds(g, action.ids);
        if (ids.size === 0 || g.nodes.length + ids.size > GRAPH_MAX_NODES) return null;
        const dx = finite(action.dx) ? action.dx : 0;
        const dy = finite(action.dy) ? action.dy : 0;
        const copies = g.nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...cloneNode(n), id: ids.get(n.id)!, x: Math.round(n.x + dx), y: Math.round(n.y + dy) }));
        const links = g.links.filter((l) => ids.has(l.from) && ids.has(l.to)).map((l) => ({ ...l, from: ids.get(l.from)!, to: ids.get(l.to)! }));
        return { ...g, nodes: [...g.nodes, ...copies], links: [...g.links, ...links].slice(0, GRAPH_MAX_LINKS) };
      });
    default:
      return state;
  }
}

/** The node catalogue entry of a node (for code that has already checked the graph). */
export function specOf(n: GraphNode): NodeSpec {
  return nodeSpec(n.type)!;
}

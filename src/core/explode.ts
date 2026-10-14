// Exploded views (phase N6, SPEC §3.7): how an EXPLODE clip takes the parts of its target apart. Pure and
// deterministic, like the rest of the animation: the same project, clip and phase give the same displacements.
//
// The geometries follow the three every CAD tool with an exploded view offers (public documentation of Onshape,
// Fusion 360, SolidWorks Composer and Inventor; black-box observation, no code):
//   - LINEAR: along an axis. SEPARATE moves every part away from the middle plane, on its own side; STACK moves them
//     all the same way, spread in their order along the axis (a bottle's cap, collar and body).
//   - CYLINDRICAL ("radial" in the interface): away from an axis, perpendicular to it.
//   - SPHERICAL: away from a point, the centre.
// and the hierarchy (`levels`) is orthogonal to them: every part on its own, the target's children as blocks, or the
// blocks first and then the parts inside each group, in stages.
//
// The legacy keys of EXPLODE_MODES keep working: RADIAL is the spherical one (its meaning since the catalogue was
// ported: "each part moves outward from the centre"), AXIS_X/Y/Z are LINEAR SEPARATE along that axis. A clip without
// parameters (every clip saved before N6) is the explode of then: spherical, every part the same distance (EVEN),
// from the centre of the model, all at once.

import type { ExplodeMode } from '../data/types';
import { boxCenter, boxMaxDim, cross, dot, emptyBox, isEmptyBox, length, normalize, scale, sub, unionBox, type Box, type Mat4, type Vec3 } from './math';
import { isSetPiece, partWorldBounds, partsUnder, type NodeId } from './scene';
import type { ProjectState } from './store';
import { pivotPoint } from './transform';

/** The geometry an explode resolves to (the legacy keys map onto these). */
export type ExplodeGeometry = 'LINEAR' | 'CYLINDRICAL' | 'SPHERICAL';
/** LINEAR: away from the middle plane on each side, or all one way in order. */
export type ExplodeLinear = 'SEPARATE' | 'STACK';
export type ExplodeAxis = 'X' | 'Y' | 'Z' | 'CUSTOM';
/** Every part on its own; the target's children as blocks; the blocks and then the parts inside each group, in stages. */
export type ExplodeLevels = 'NONE' | 'ONE' | 'ALL';
/** What the clip's `amount` measures: times the model size (`scene.partSizeMm`) or millimetres. */
export type ExplodeUnit = 'SIZE' | 'MM';
/** EVEN: every part travels the distance; SPREAD: the travel grows with the distance from the centre (the farthest travels it). */
export type ExplodeSpacing = 'EVEN' | 'SPREAD';
/** When each part goes: all at once, staggered by distance from the centre (farthest first), or by depth in the tree (shallowest first). */
export type ExplodeOrder = 'AT_ONCE' | 'BY_DISTANCE' | 'BY_DEPTH';
/** Where the parts move away from: the centre of the target, a chosen part's centre, the target's pivot, a point (world mm). */
export type ExplodeCentre = { kind: 'MODEL' } | { kind: 'PART'; id: NodeId } | { kind: 'PIVOT' } | { kind: 'POINT'; point: Vec3 };

export const EXPLODE_GEOMETRIES: readonly ExplodeGeometry[] = ['LINEAR', 'CYLINDRICAL', 'SPHERICAL'];
export const EXPLODE_AXES: readonly ExplodeAxis[] = ['X', 'Y', 'Z', 'CUSTOM'];
export const EXPLODE_LEVELS: readonly ExplodeLevels[] = ['NONE', 'ONE', 'ALL'];
export const EXPLODE_ORDERS: readonly ExplodeOrder[] = ['AT_ONCE', 'BY_DISTANCE', 'BY_DEPTH'];
export const EXPLODE_CENTRES: readonly ExplodeCentre['kind'][] = ['MODEL', 'PART', 'PIVOT', 'POINT'];

/**
 * The parameters of an EXPLODE clip (`MotionClip.explode`). Every field but `mode` is optional: a missing one takes
 * the value the explode had before N6, so a project saved then reads the same.
 */
export interface ExplodeParams {
  /** A key of EXPLODE_MODES: LINEAR, CYLINDRICAL, SPHERICAL, or a legacy one (RADIAL, AXIS_X/Y/Z, CUSTOM). */
  mode: ExplodeMode;
  linear?: ExplodeLinear;
  /** LINEAR: the direction; CYLINDRICAL: the axis. */
  axis?: ExplodeAxis;
  /** Axis CUSTOM: a world direction (any length; Z when it has none). */
  direction?: Vec3;
  levels?: ExplodeLevels;
  unit?: ExplodeUnit;
  spacing?: ExplodeSpacing;
  /** Each part's travel scales with its size: the largest travels the whole distance. */
  proportional?: boolean;
  centre?: ExplodeCentre;
  order?: ExplodeOrder;
  /** Staggered orders and the stages of `levels` ALL: how much a step overlaps the next, 0 (one after the other) to 1 (together). */
  overlap?: number;
  /** The exceptions: parts (a group stands for every part under it) that stay where they are. */
  pinned?: NodeId[];
  /** false: each part also tilts away as it travels. */
  keepOrientation?: boolean;
}

/** Every parameter filled in. */
export interface ResolvedExplode {
  geometry: ExplodeGeometry;
  linear: ExplodeLinear;
  axis: ExplodeAxis;
  /** The unit vector of the axis. */
  direction: Vec3;
  levels: ExplodeLevels;
  unit: ExplodeUnit;
  spacing: ExplodeSpacing;
  proportional: boolean;
  centre: ExplodeCentre;
  order: ExplodeOrder;
  overlap: number;
  pinned: NodeId[];
  keepOrientation: boolean;
}

/** How far a part tilts at the end of its travel when the orientation is not kept, degrees. */
export const EXPLODE_TILT_DEG = 20;

/** The parameters a new explode starts with (the interface's default; the explode of before N6 is `resolveExplode(undefined)`). */
export function newExplode(): ExplodeParams {
  return {
    mode: 'SPHERICAL',
    linear: 'SEPARATE',
    axis: 'Z',
    levels: 'NONE',
    unit: 'SIZE',
    spacing: 'SPREAD',
    proportional: false,
    centre: { kind: 'MODEL' },
    order: 'AT_ONCE',
    overlap: 0.5,
    pinned: [],
    keepOrientation: true,
  };
}

const AXIS_VECTORS: Record<'X' | 'Y' | 'Z', Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** The geometry a mode key means (legacy keys included). */
export function explodeGeometry(mode: ExplodeMode | undefined): ExplodeGeometry {
  switch (mode) {
    case 'LINEAR':
    case 'AXIS_X':
    case 'AXIS_Y':
    case 'AXIS_Z':
      return 'LINEAR';
    case 'CYLINDRICAL':
      return 'CYLINDRICAL';
    // RADIAL is the spherical explode (its catalogue meaning); CUSTOM (a direction per part) is not built and falls
    // back to it, which is what it did before N6.
    default:
      return 'SPHERICAL';
  }
}

/** Every parameter of a clip's explode, the missing ones as they were before N6. */
export function resolveExplode(p: ExplodeParams | undefined): ResolvedExplode {
  const mode = p?.mode;
  const legacyAxis = mode === 'AXIS_X' ? 'X' : mode === 'AXIS_Y' ? 'Y' : mode === 'AXIS_Z' ? 'Z' : null;
  const axis: ExplodeAxis = legacyAxis ?? (p?.axis && EXPLODE_AXES.includes(p.axis) ? p.axis : 'Z');
  const custom = axis === 'CUSTOM' ? normalize(p?.direction ?? [0, 0, 1]) : null;
  const direction: Vec3 = custom && length(custom) > 0 ? custom : AXIS_VECTORS[axis === 'CUSTOM' ? 'Z' : axis];
  const overlap = Number.isFinite(p?.overlap) ? Math.min(1, Math.max(0, p!.overlap!)) : 0.5;
  return {
    geometry: explodeGeometry(mode),
    linear: legacyAxis ? 'SEPARATE' : p?.linear === 'STACK' ? 'STACK' : 'SEPARATE',
    axis,
    direction,
    levels: p?.levels === 'ONE' || p?.levels === 'ALL' ? p.levels : 'NONE',
    unit: p?.unit === 'MM' ? 'MM' : 'SIZE',
    spacing: p?.spacing === 'SPREAD' ? 'SPREAD' : 'EVEN',
    proportional: p?.proportional === true,
    centre: p?.centre && EXPLODE_CENTRES.includes(p.centre.kind) ? p.centre : { kind: 'MODEL' },
    order: p?.order === 'BY_DISTANCE' || p?.order === 'BY_DEPTH' ? p.order : 'AT_ONCE',
    overlap,
    pinned: Array.isArray(p?.pinned) ? p!.pinned!.filter((x) => typeof x === 'string') : [],
    keepOrientation: p?.keepOrientation !== false,
  };
}

/** What an explode acts on: its target (the model or a node) and its own params. */
export interface ExplodeSubject {
  /** NODE target id, or null for the whole model (SUBJECT). */
  node: NodeId | null;
  amount: number;
  explode?: ExplodeParams;
}

/** One thing that moves as a unit: a part, or a block (a group or a loose part at some level of the tree). */
export interface ExplodeMover {
  /** The parts it moves (exceptions left out); never empty. */
  parts: NodeId[];
  /** Centre of its bounds at rest (the exceptions under it included: they are part of its shape), world mm. */
  ref: Vec3;
  /** Its displacement at the end of its travel, world mm. */
  delta: Vec3;
  /** 0 for the outermost blocks (or every part, without levels); the stage of `levels` ALL. */
  stage: number;
  /** Where its window of time starts and ends in the clip's phase, 0..1. */
  from: number;
  to: number;
}

/** The parts an explode on this target can move: the model's (or the node's), never a set's decoration (L6). */
export function explodeParts(state: ProjectState, node: NodeId | null): NodeId[] {
  const roots = node === null ? state.scene.roots : state.scene.nodes[node] ? [node] : [];
  return partsUnder(state, roots).filter((p) => !isSetPiece(state.scene.nodes[p]));
}

/**
 * The movers of an explode with their displacement and window of time: the whole explode, without its curve (the
 * evaluation applies the clip's curve inside each window). Empty when the target has no parts.
 */
export function explodeMovers(state: ProjectState, subject: ExplodeSubject, cache?: Map<NodeId, Mat4>): ExplodeMover[] {
  const prm = resolveExplode(subject.explode);
  const parts = explodeParts(state, subject.node);
  if (parts.length === 0) return [];
  const inTarget = new Set(parts);
  const pinned = new Set(partsUnder(state, prm.pinned));
  const bounds = new Map<NodeId, Box>();
  let all = emptyBox();
  for (const p of parts) {
    const b = partWorldBounds(state, p, cache);
    bounds.set(p, b);
    all = unionBox(all, b);
  }
  if (isEmptyBox(all)) return [];
  const boundsOfParts = (ps: readonly NodeId[]): Box => ps.reduce((b, p) => unionBox(b, bounds.get(p) ?? emptyBox()), emptyBox());
  const partsOf = (id: NodeId): NodeId[] => partsUnder(state, [id]).filter((p) => inTarget.has(p));
  // The children of a node that hold parts of the target; a chain of single children is walked down (a block that is
  // the whole of its parent cannot move away from it).
  const blocksOf = (id: NodeId | null): NodeId[] => {
    let kids = (id === null ? state.scene.roots : (state.scene.nodes[id]?.children ?? [])).filter((c) => partsOf(c).length > 0);
    while (kids.length === 1 && state.scene.nodes[kids[0]]?.kind !== 'PART') {
      kids = state.scene.nodes[kids[0]].children.filter((c) => partsOf(c).length > 0);
    }
    return kids;
  };
  const depthBelow = (p: NodeId, top: NodeId | null): number => {
    let d = 0;
    let cur = state.scene.nodes[p]?.parent ?? null;
    while (cur !== null && cur !== top && state.scene.nodes[cur]) {
      d++;
      cur = state.scene.nodes[cur].parent;
    }
    return d;
  };

  const size = state.scene.partSizeMm || 1;
  const distance = subject.amount * (prm.unit === 'MM' ? 1 : size);
  const topCentre = (): Vec3 => {
    const c = prm.centre;
    if (c.kind === 'PART') {
      const b = bounds.get(c.id) ?? (state.scene.nodes[c.id] ? boundsOfParts(partsUnder(state, [c.id]).filter((p) => bounds.has(p))) : emptyBox());
      if (!isEmptyBox(b)) return boxCenter(b);
    }
    if (c.kind === 'PIVOT') return pivotPoint(state, subject.node === null ? state.scene.roots : [subject.node]);
    if (c.kind === 'POINT' && Array.isArray(c.point) && c.point.length === 3 && c.point.every(Number.isFinite)) return [c.point[0], c.point[1], c.point[2]];
    return boxCenter(all);
  };

  // A set of siblings that explode together, from one centre: their raw vectors are normalised within the set.
  interface Item {
    parts: NodeId[];
    ref: Vec3;
    size: number;
    depth: number;
  }
  const out: ExplodeMover[] = [];
  const rank: { stage: number; key: number }[] = [];
  const explodeSet = (items: Item[], centre: Vec3, stage: number, distance: number): void => {
    const moving = items.filter((it) => it.parts.length > 0);
    if (moving.length === 0) return;
    const a = prm.direction;
    const vec = (r: Vec3): Vec3 => {
      const v = sub(r, centre);
      if (prm.geometry === 'SPHERICAL') return v;
      const along = dot(v, a);
      if (prm.geometry === 'LINEAR') return scale(a, along);
      return sub(v, scale(a, along));
    };
    const maxSize = Math.max(...moving.map((it) => it.size)) || 1;
    if (prm.geometry === 'LINEAR' && prm.linear === 'STACK') {
      // In order along the axis: the first stays, the last travels the whole distance, the others evenly between.
      const order = moving.map((it, i) => ({ it, i, s: dot(it.ref, a) })).sort((x, y) => x.s - y.s || x.i - y.i);
      const n = order.length;
      order.forEach(({ it }, k) => {
        const f = n > 1 ? k / (n - 1) : 0;
        const kk = prm.proportional ? it.size / maxSize : 1;
        out.push({ parts: it.parts, ref: it.ref, delta: scale(a, distance * kk * f), stage, from: 0, to: 1 });
        rank.push({ stage, key: prm.order === 'BY_DEPTH' ? it.depth : -k });
      });
      return;
    }
    const raw = moving.map((it) => vec(it.ref));
    const far = Math.max(...raw.map((v) => length(v)));
    moving.forEach((it, i) => {
      const v = raw[i];
      const kk = prm.proportional ? it.size / maxSize : 1;
      let delta: Vec3;
      if (prm.spacing === 'SPREAD') delta = far > 1e-9 ? scale(v, (distance * kk) / far) : [0, 0, 0];
      // EVEN: the explode of before N6 (a saved project reads the same).
      else delta = scale(normalize(v), distance * kk);
      out.push({ parts: it.parts, ref: it.ref, delta, stage, from: 0, to: 1 });
      rank.push({ stage, key: prm.order === 'BY_DEPTH' ? it.depth : -length(v) });
    });
  };

  const item = (id: NodeId, top: NodeId | null): Item => {
    const ps = partsOf(id);
    const b = boundsOfParts(ps);
    return { parts: ps.filter((p) => !pinned.has(p)), ref: boxCenter(b), size: boxMaxDim(b), depth: depthBelow(id, top) };
  };
  const frame = subject.node;
  if (prm.levels === 'NONE') {
    const top = frame === null && state.scene.roots.length === 1 ? state.scene.roots[0] : frame;
    explodeSet(
      parts.map((p) => ({ parts: pinned.has(p) ? [] : [p], ref: boxCenter(bounds.get(p)!), size: boxMaxDim(bounds.get(p)!), depth: depthBelow(p, top) })),
      topCentre(),
      0,
      distance,
    );
  } else {
    // Inside a group the parts travel in proportion to the group: a closure opens by its own size, not the bottle's.
    const whole = boxMaxDim(all) || 1;
    const walk = (node: NodeId | null, centre: Vec3, stage: number, dist: number): void => {
      const blocks = blocksOf(node);
      if (blocks.length === 0) return;
      explodeSet(blocks.map((b) => item(b, node)), centre, stage, dist);
      if (prm.levels !== 'ALL') return;
      for (const b of blocks) {
        if (state.scene.nodes[b]?.kind === 'PART') continue;
        const inner = blocksOf(b);
        const box = boundsOfParts(partsOf(b));
        if (inner.length > 1) walk(b, boxCenter(box), stage + 1, distance * (boxMaxDim(box) / whole));
      }
    };
    walk(frame, topCentre(), 0, distance);
  }

  // Windows of time: the stages one after another (levels ALL), and inside a stage the order.
  const stages = out.reduce((m, x) => Math.max(m, x.stage), 0) + 1;
  const stagger = (count: number, i: number): [number, number] => {
    if (count <= 1) return [0, 1];
    const w = 1 / (1 + (count - 1) * (1 - prm.overlap));
    const a = i * w * (1 - prm.overlap);
    return [a, Math.min(1, a + w)];
  };
  for (let s = 0; s < stages; s++) {
    const [s0, s1] = stagger(prm.levels === 'ALL' ? stages : 1, prm.levels === 'ALL' ? s : 0);
    const idx = out.map((_, i) => i).filter((i) => out[i].stage === s);
    let ranks: number[] = idx.map(() => 0);
    if (prm.order !== 'AT_ONCE') {
      // Equal keys share a step (two parts as far from the centre go together).
      const keys = [...new Set(idx.map((i) => rank[i].key))].sort((x, y) => x - y);
      const merged: number[] = [];
      const tol = 1e-6 * Math.max(1, ...keys.map(Math.abs));
      for (const k of keys) if (merged.length === 0 || k - merged[merged.length - 1] > tol) merged.push(k);
      ranks = idx.map((i) => merged.findIndex((k) => Math.abs(rank[i].key - k) <= tol));
      const count = merged.length;
      idx.forEach((i, j) => {
        const [a, b] = stagger(count, ranks[j]);
        out[i].from = s0 + a * (s1 - s0);
        out[i].to = s0 + b * (s1 - s0);
      });
    } else {
      for (const i of idx) {
        out[i].from = s0;
        out[i].to = s1;
      }
    }
  }
  return out.filter((m) => m.parts.length > 0);
}

/** A mover's own progress for the clip's linear phase `x`, before the curve: 0 before its window, 1 after it. */
export function moverPhase(m: Pick<ExplodeMover, 'from' | 'to'>, x: number): number {
  if (m.from <= 0 && m.to >= 1) return x;
  const w = m.to - m.from;
  if (w <= 0) return x >= m.to ? 1 : 0;
  return Math.min(1, Math.max(0, (x - m.from) / w));
}

/** The axis a mover tilts about when the orientation is not kept: square to its travel and to the vertical (or X). */
export function tiltAxis(delta: Vec3): Vec3 | null {
  const u = normalize(delta);
  if (length(u) === 0) return null;
  const ref: Vec3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const axis = normalize(cross(ref, u));
  return length(axis) > 0 ? axis : null;
}

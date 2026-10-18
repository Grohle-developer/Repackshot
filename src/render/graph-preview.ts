// Material graphs in the Fast preview (phase M3a): the graph's program evaluated into maps by the graph workers
// (render/graph-client.ts, core/material-preview.ts) and drawn by M2a's texture path (render/texture-preview.ts) on the
// preview's MeshPhysicalMaterial: the colour, roughness, metal, opacity, normal and emission maps go in the slots of
// those names with the plan's mapping; every other output (clear coat, transmission, IOR…) is its mean. A bake comes
// in two passes, 128² at once and then 512²; until the first arrives the material shows the means of its outputs.
// The material's own image maps (M2a slots) win over the graph's map of the same slot (that output is then its
// mean under the image), and its labels lie over everything, as in Simple mode.

import type * as THREE from 'three';
import type { MaterialInstance } from '../core/materials';
import { flattenGraph, materialBounds, planBake, BAKE_SIZE, type BakePlan, type BakeResult, type OutputValues } from '../core/material-preview';
import { compileGraph, type Program } from '../core/material-program';
import type { MaterialGraph } from '../core/material-graph';
import type { ProjectState } from '../core/store';
import { cloneTextures, newSlot, type MaterialTextures, type TextureSlotKey } from '../core/textures';
import type { MaterialFamily, MaterialParams } from '../data/types';
import type { GraphWorkers } from './graph-client';
import { applyMaterial } from './materials';
import { BAKED_PREFIX, type TexturePreview } from './texture-preview';

/** The first, quick pass of a bake. */
export const QUICK_BAKE_SIZE = 128;

interface Entry {
  key: string;
  program: Program;
  plan: BakePlan;
  result: BakeResult | null;
  /** Bumped with each result: the baked maps' ids change with it (the texture cache is by id). */
  version: number;
  /** The preview material and the instance it was last applied with (a result re-applies them). */
  target: { m: THREE.MeshPhysicalMaterial; inst: MaterialInstance; partSizeMm: number } | null;
}

const programs = new WeakMap<MaterialGraph, Program | null>();
function programOf(g: MaterialGraph): Program | null {
  if (!programs.has(g)) programs.set(g, compileGraph(g).program);
  return programs.get(g)!;
}

/** What tells two bakes apart: the program and the plan. */
function bakeKey(p: Program, plan: BakePlan): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n;
    h = Math.imul(h, 0x01000193);
  };
  for (const w of p.code) mix(w);
  const fb = new Uint32Array(p.consts.buffer, p.consts.byteOffset, p.consts.length);
  for (const w of fb) mix(w);
  return `${(h >>> 0).toString(16)}|${p.images.map((i) => i.image?.id ?? '-').join(',')}|${JSON.stringify(plan)}`;
}

/** Which output each map holds, and the slot it goes in. */
const MAPS: readonly { map: keyof BakeResult['maps']; slot: TextureSlotKey; output: string }[] = [
  { map: 'color', slot: 'color', output: 'baseColor' },
  { map: 'roughness', slot: 'roughness', output: 'roughness' },
  { map: 'metal', slot: 'metal', output: 'metallic' },
  { map: 'alpha', slot: 'alpha', output: 'opacity' },
  { map: 'normal', slot: 'normal', output: 'normal' },
  { map: 'emission', slot: 'emission', output: 'emission' },
];

const num = (v: OutputValues[string] | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const rgb = (v: OutputValues[string] | undefined, d: readonly number[]): number[] => (Array.isArray(v) ? v : [...d]);

/** The family and parameters a preview material gets for output values; outputs drawn by a map get 1 (the map multiplies). */
export function previewParams(values: OutputValues, mapped: ReadonlySet<string>, absorptionMm: number, thinWalls: boolean): { family: MaterialFamily; params: MaterialParams } {
  const base = mapped.has('baseColor') ? [1, 1, 1] : rgb(values.baseColor, [0.8, 0.8, 0.8]);
  if (absorptionMm > 0 || thinWalls) {
    return { family: 'GLASS', params: { baseColor: [base[0], base[1], base[2], 1], roughness: mapped.has('roughness') ? 1 : num(values.roughness, 0), ior: num(values.ior, 1.5), transmission: num(values.transmission, 1), absorptionMm, walls: thinWalls ? 'THIN' : 'SOLID' } };
  }
  return {
    family: 'SIMPLE',
    params: {
      baseColor: [base[0], base[1], base[2], 1],
      metallic: mapped.has('metallic') ? 1 : num(values.metallic, 0),
      roughness: mapped.has('roughness') ? 1 : num(values.roughness, 0.5),
      coat: num(values.coat, 0),
      coatRoughness: num(values.coatRoughness, 0.03),
      ior: num(values.ior, 1.5),
      transmission: num(values.transmission, 0),
      opacity: mapped.has('opacity') ? 1 : num(values.opacity, 1),
      anisotropic: num(values.anisotropic, 0),
    },
  };
}

export class GraphBakes {
  private readonly entries = new Map<string, Entry>();
  private workers: GraphWorkers | null = null;
  private pending = 0;

  constructor(
    private readonly textures: () => TexturePreview,
    private readonly ready: () => void,
    private readonly onPending: (n: number) => void = () => undefined,
  ) {}

  setWorkers(w: GraphWorkers | null): void {
    this.workers = w;
  }

  /** True when there are workers to bake with (M3d: without them a family's wood keeps its own Fast drawing). */
  hasWorkers(): boolean {
    return this.workers !== null;
  }

  /** Bakes running or waiting. */
  busy(): number {
    return this.pending;
  }

  /**
   * Gives a preview material its graph: the maps it has (or its means while they come) and its own textures. M3d: a
   * wood of the family comes here too, with the graph Simple → Nodes makes of it as its `graph` (core/material-graph.ts
   * `familyBakeGraph`), and is baked as the Wood node is.
   */
  apply(m: THREE.MeshPhysicalMaterial, inst: MaterialInstance, state: ProjectState): void {
    const g = inst.graph!;
    const program = programOf(g);
    if (!program) {
      // A graph that does not compile draws as the means of its outputs (the default grey).
      applyMaterial(m, { ...inst, ...flattenGraph(g) }, state.scene.partSizeMm);
      this.textures().apply(m, inst);
      return;
    }
    const plan = planBake(program, materialBounds(state, inst.id), state.scene.partSizeMm);
    const key = bakeKey(program, plan);
    let e = this.entries.get(inst.id);
    if (!e || e.key !== key) {
      e = { key, program, plan, result: null, version: (e?.version ?? 0) + 1, target: null };
      this.entries.set(inst.id, e);
      this.request(inst.id, e);
    }
    e.target = { m, inst, partSizeMm: state.scene.partSizeMm };
    this.draw(e);
  }

  /** Forgets the bakes of materials that are gone. */
  prune(live: ReadonlySet<string>): void {
    for (const id of [...this.entries.keys()]) if (!live.has(id)) this.entries.delete(id);
  }

  private request(id: string, e: Entry): void {
    const w = this.workers;
    if (!w) return;
    const channel = `fast:${id}`;
    const take = (r: BakeResult | null) => {
      if (!r || this.entries.get(id) !== e) return;
      // A quick pass that arrives after the full one is not taken.
      if (e.result && e.result.size > r.size) return;
      e.result = r;
      e.version++;
      this.draw(e);
      this.ready();
    };
    const count = (p: Promise<BakeResult | null>) => {
      this.pending++;
      this.onPending(this.pending);
      return p.finally(() => {
        this.pending--;
        this.onPending(this.pending);
      });
    };
    void count(w.bake(e.program, e.plan, QUICK_BAKE_SIZE, `${channel}:quick`)).then(take);
    void count(w.bake(e.program, e.plan, BAKE_SIZE, channel)).then(take);
  }

  private draw(e: Entry): void {
    const t = e.target;
    if (!t) return;
    const { m, inst, partSizeMm } = t;
    const r = e.result;
    const tp = this.textures();
    if (!r) {
      applyMaterial(m, { ...inst, ...flattenGraph(inst.graph!) }, partSizeMm);
      tp.apply(m, inst);
      return;
    }
    const own = inst.textures;
    const textures: MaterialTextures = cloneTextures(own);
    const mapped = new Set<string>();
    for (const { map, slot, output } of MAPS) {
      const px = r.maps[map];
      // The material's own image in that slot wins: the output is its mean under it.
      if (!px || own[slot]) continue;
      const id = `${BAKED_PREFIX}${inst.id}:${e.version}:${slot}`;
      tp.setBaked(id, px, r.size);
      const s = newSlot(slot, { id, name: `${slot}.graph`, width: r.size, height: r.size });
      s.mapping = { ...e.plan.mapping, offset: [...e.plan.mapping.offset], repeat: [...e.plan.mapping.repeat] };
      s.channel = 'R';
      if (slot === 'emission') s.strength = r.emissionScale;
      textures[slot] = s;
      mapped.add(output);
    }
    const flat = previewParams(r.values, mapped, e.program.absorptionMm, e.program.thinWalls);
    applyMaterial(m, { ...inst, ...flat }, partSizeMm);
    // An emission without a map: its mean as the material's own.
    const strength = num(r.values.emissionStrength, 0);
    const em = rgb(r.values.emission, [0, 0, 0]);
    if (!mapped.has('emission') && strength > 0 && Math.max(...em) > 0) {
      m.emissive.setRGB(em[0], em[1], em[2]);
      m.emissiveIntensity = strength;
    }
    tp.apply(m, { ...inst, family: flat.family, textures });
  }
}

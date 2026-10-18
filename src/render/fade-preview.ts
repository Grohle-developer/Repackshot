// The Fast preview's fades and material changes (phase N1): what the FADE and MATERIAL_COLOR clips leave at the
// playhead, drawn with three.js. A material the animation tints or fades is the shared material itself, set from its
// instance as the clip leaves it (and set back from the instance when the clip no longer touches it); a part that
// fades draws with a see-through copy of its material at its opacity, made the way the section's copies are (the
// original's shader patch runs first, so textures and knots stay). A material of nodes keeps its colour here: its
// look comes from its graph's bakes, which the colour of the Simple parameters does not reach (the engine fades it).

import * as THREE from 'three';
import { posedMaterial, type Pose } from '../core/animation';
import type { MaterialInstance } from '../core/materials';
import { allParts, type NodeId, type SceneNode } from '../core/scene';
import type { ProjectState } from '../core/store';

/** N1: the parts a pose fades and their opacity (their own and their ancestors' fades, multiplied); only those below 1. */
export function partOpacities(state: ProjectState, pose: Pose | null): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  if (!pose) return out;
  const faded = Object.entries(pose.nodes).some(([, p]) => p.opacity !== undefined && p.opacity < 1);
  if (!faded) return out;
  const nodes = state.scene.nodes;
  for (const id of allParts(state)) {
    let o = 1;
    for (let n: SceneNode | undefined = nodes[id]; n; n = n.parent ? nodes[n.parent] : undefined) o *= pose.nodes[n.id]?.opacity ?? 1;
    if (o < 1) out.set(id, Math.max(0, o));
  }
  return out;
}

/** What a pose fades and tints, as a key: the same key, the same drawing. */
export function fadeKey(parts: ReadonlyMap<NodeId, number>, pose: Pose | null): string {
  const p = [...parts].map(([id, o]) => `${id}:${o.toFixed(4)}`).join(',');
  const m = Object.entries(pose?.materials ?? {})
    .map(([id, mp]) => `${id}:${mp.opacity.toFixed(4)}:${mp.color ? mp.color.map((v) => v.toFixed(4)).join('/') : ''}`)
    .join(',');
  return `${p}|${m}`;
}

export class FadePreview {
  private parts = new Map<NodeId, number>();
  private key = '|';
  /** Materials the last pose tinted or faded (set back from their instance once it no longer does). */
  private posed = new Set<string>();
  private readonly copies = new Map<string, { material: THREE.MeshPhysicalMaterial; version: number }>();

  /** Takes the pose on screen; true when what it fades or tints changed (the parts' materials are assigned again). */
  update(state: ProjectState, pose: Pose | null): boolean {
    const parts = partOpacities(state, pose);
    const key = fadeKey(parts, pose);
    this.parts = parts;
    if (key === this.key) return false;
    this.key = key;
    return true;
  }

  /** A part's opacity in the pose on screen (1: not faded). */
  opacityOf(id: NodeId): number {
    return this.parts.get(id) ?? 1;
  }

  /**
   * The shared materials as the pose leaves them: the ones it tints or fades set from their instance as the clips
   * leave it, the ones it touched before and no longer does set back. `reset` sets a material from its instance and
   * the instance as the clips leave it (`posed`): its parameters and textures, or, M3d, a family's wood's bake.
   */
  applyMaterials(state: ProjectState, materials: ReadonlyMap<string, THREE.MeshPhysicalMaterial>, pose: Pose | null, reset: (m: THREE.MeshPhysicalMaterial, inst: MaterialInstance, posed: MaterialInstance) => void): void {
    const want = pose?.materials ?? {};
    for (const id of new Set([...this.posed, ...Object.keys(want)])) {
      const m = materials.get(id);
      const inst = state.materials[id];
      if (!m || !inst || inst.graph) continue;
      const mp = want[id];
      const was = m.transparent;
      reset(m, inst, mp ? posedMaterial(inst, mp) : inst);
      const o = mp?.opacity ?? 1;
      if (o < 1) {
        m.opacity *= o;
        m.transparent = true;
      }
      if (m.transparent !== was) m.needsUpdate = true;
    }
    this.posed = new Set(Object.keys(want).filter((id) => materials.has(id)));
  }

  /** The material a part draws with: `base`, or a see-through copy of it at the part's opacity (`key` names the copy). */
  faded(key: string, base: THREE.MeshPhysicalMaterial, opacity: number, used: Set<string>): THREE.MeshPhysicalMaterial {
    if (!(opacity < 1)) return base;
    used.add(key);
    // Not its userData: the texture state (live textures, which a copy would serialise) stays with `base`.
    const userData = base.userData;
    base.userData = {};
    let entry = this.copies.get(key);
    if (entry) entry.material.copy(base);
    else {
      entry = { material: base.clone(), version: -1 };
      this.copies.set(key, entry);
    }
    base.userData = userData;
    const m = entry.material;
    m.onBeforeCompile = (shader, renderer) => base.onBeforeCompile(shader, renderer);
    m.customProgramCacheKey = () => `${base.customProgramCacheKey()}|fade`;
    m.opacity = base.opacity * Math.max(0, opacity);
    m.transparent = true;
    // What is behind a part that fades shows through it.
    m.depthWrite = false;
    if (entry.version !== base.version) {
      entry.version = base.version;
      m.needsUpdate = true;
    }
    return m;
  }

  /** Drops the copies that are not in `used`. */
  prune(used: ReadonlySet<string>): void {
    for (const [key, e] of this.copies) {
      if (used.has(key)) continue;
      e.material.dispose();
      this.copies.delete(key);
    }
  }

  dispose(): void {
    for (const e of this.copies.values()) e.material.dispose();
    this.copies.clear();
  }
}

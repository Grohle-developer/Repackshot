// The section view in the Fast preview (phase Q1): the cutting plane as a clipping plane of three.js, the cut capped,
// and what picking does with it. The same plane as the engine's (core/section.ts `ResolvedSection`, `SECT`): what is
// on the removed side of `normal · p = distance` is never drawn, never casts a shadow and never takes a click.
//
// **The cap.** The engine caps the cut where the nearest surface met after the plane is the back of a closed solid;
// the preview draws exactly that: for every part that is a closed solid (core/solid.ts, the engine's rule) a second
// mesh of the same geometry that draws only its BACK faces, in the part's own material but shaded with the plane's
// normal, as a flat surface on the plane (the engine's cap is one). The depth test does the rest: where a front face
// of anything is nearer than that back face the part shows as usual; where the cut has taken the front away, the back
// shows and it is the cap. Open meshes (and thin walls, and parts with a material per face, which the engine sees as
// separate sheets) have no cap: the cut shows their inside, as in the engine, which is why every material of the model
// draws both sides while a section cuts (an open mesh shows the back of its faces, shaded as the engine shades them),
// and the cap, pulled a hair nearer, draws over the back faces of the solids. A glass cap is a see-through glass
// (the preview's transmission), not the engine's refraction; the cap has no texture, as in the engine.
//
// **The plane.** One shared `THREE.Plane` set in three.js space by `setPlane`; every material of the model carries it
// in `clippingPlanes` all the time, and without a section it is far away, so the shaders never change when the section
// goes on or off. The floor, the effects and the overlays do not carry it: they are not the model.
//
// **The studio is not cut.** The pieces of a set (backdrop, floor, cards: `partIsExempt`) are not the model, and the
// engine does not cut them (`INSTANCE_NO_SECTION`): while a section cuts, they draw with a copy of their material that
// carries no plane (`unclipped`), the pick and the box selection take them whole, and they have no cap.

import * as THREE from 'three';
import type { MaterialInstance } from '../core/materials';
import { partIsCapped } from '../core/section';
import type { NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';
import { applyMaterial, makeMaterial } from './materials';

/** A plane so far away that nothing is on its removed side. */
const NEVER = 1e9;

/** What a pick through the section found: a part of the kept side, or the cap of one (on the plane). */
export interface SectionPick {
  hit: THREE.Intersection;
  /** The hit is on the cap of the part: the point is where the ray crosses the plane, the normal the plane's. */
  cap: { point: THREE.Vector3; normal: THREE.Vector3 } | null;
}

export class SectionPreview {
  /** In three.js space: a point is kept when its distance from the plane is not negative. */
  readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), NEVER);
  /** The unit normal of the removed side, three.js space (what the cap is shaded with). */
  private readonly normal = { value: new THREE.Vector3(0, 1, 0) };
  /** The plane on the removed side's terms: `normalT · x = distance`. */
  private distance = NEVER;
  private on = false;
  /** The section caps what it cuts (the plane's flag). */
  private capOn = false;
  private readonly clippingPlanes = [this.plane];
  private readonly caps = new Map<NodeId, THREE.Mesh>();
  private readonly capMaterials = new Map<string, { inst: MaterialInstance | null; size: number; material: THREE.MeshPhysicalMaterial }>();
  private readonly fallback = new THREE.MeshPhysicalMaterial({ color: 0xb3b3b3, roughness: 0.5 });
  /** Materials that draw the model for other purposes (the outline's masks, depth) and show both sides while cutting. */
  private readonly twoSided: THREE.Material[] = [];
  /** The materials of the studio's pieces while a section cuts: no plane, by `part|material`. */
  private readonly studio = new Map<string, { material: THREE.MeshPhysicalMaterial; version: number }>();
  /** What `removed` found for a mesh, with what it depended on. */
  private readonly goneCache = new WeakMap<THREE.Mesh, { key: string; gone: boolean }>();
  private cutKey = '';

  /** True while a section cuts the model. */
  get active(): boolean {
    return this.on;
  }

  /** True while the cut is capped (a section is on and its cap is). */
  get capping(): boolean {
    return this.on && this.capOn;
  }

  /** The cap meshes, for the pick. */
  capMeshes(): THREE.Mesh[] {
    return [...this.caps.values()];
  }

  /** Makes `m` a material of the model: it carries the plane (and its shadow is cut too). */
  clip<T extends THREE.Material>(m: T): T {
    m.clippingPlanes = this.clippingPlanes;
    m.clipShadows = true;
    return m;
  }

  /** The side a material of the model draws now: both while a section cuts, the front as it always did otherwise. */
  sided<T extends THREE.Material>(m: T): T {
    const side = this.on ? THREE.DoubleSide : THREE.FrontSide;
    if (m.side !== side) {
      m.side = side;
      m.needsUpdate = true;
    }
    return m;
  }

  /** A material that draws the model for the outline or depth: clipped, and two-sided while a section cuts. */
  clipTwoSided<T extends THREE.Material>(m: T): T {
    this.clip(m);
    this.twoSided.push(m);
    return m;
  }

  /**
   * Puts the plane where `cut` says: the unit normal of the removed side in three.js space (preview.ts converts it with
   * `toThree`, the one place the Y-up is made) and the distance `normal · p = distance`, mm, resolved at an instant of
   * the animation (core/section.ts `resolveSection`); null: no section. True when anything about it changed.
   */
  setPlane(cut: { normal: THREE.Vector3; distance: number; cap: boolean } | null): boolean {
    const was = this.cutKey;
    this.capOn = !!cut?.cap;
    if (!cut) {
      this.cutKey = '';
      this.on = false;
      this.plane.set(new THREE.Vector3(0, 1, 0), NEVER);
      this.distance = NEVER;
    } else {
      // The kept side is `n·p <= d`; three keeps `m·x + c >= 0`: m = -n, c = d (the basis change keeps lengths).
      const n = cut.normal.clone().normalize();
      this.cutKey = `${n.x},${n.y},${n.z},${cut.distance},${cut.cap}`;
      this.on = true;
      this.normal.value.copy(n);
      this.distance = cut.distance;
      this.plane.set(n.clone().negate(), cut.distance);
    }
    const sided = this.on ? THREE.DoubleSide : THREE.FrontSide;
    for (const m of this.twoSided) {
      if (m.side !== sided) {
        m.side = sided;
        m.needsUpdate = true;
      }
    }
    return was !== this.cutKey;
  }

  /**
   * The material a piece of the studio draws with while a section cuts: `base` (the part's own, or its knotted copy)
   * seen through a copy that carries no clipping plane. `key` names the copy; `used` collects the keys in use for
   * `pruneStudio`. Not its userData: the texture state of `base` (live textures, which a copy would serialise) stays
   * with it, and the copy runs its shader patch.
   */
  unclipped(key: string, base: THREE.MeshPhysicalMaterial, used: Set<string>): THREE.MeshPhysicalMaterial {
    used.add(key);
    const userData = base.userData;
    base.userData = {};
    let entry = this.studio.get(key);
    if (entry) entry.material.copy(base);
    else {
      entry = { material: base.clone(), version: -1 };
      this.studio.set(key, entry);
    }
    base.userData = userData;
    const m = entry.material;
    m.clippingPlanes = null;
    m.clipShadows = false;
    m.side = THREE.FrontSide;
    m.onBeforeCompile = (shader, renderer) => base.onBeforeCompile(shader, renderer);
    m.customProgramCacheKey = () => `${base.customProgramCacheKey()}|studio`;
    // A new program only when the original asked for one (a texture came or went), not at every colour it changes.
    if (entry.version !== base.version) {
      entry.version = base.version;
      m.needsUpdate = true;
    }
    return m;
  }

  /** Drops the copies of the studio's materials that are not in `used`. */
  pruneStudio(used: ReadonlySet<string>): void {
    for (const [key, e] of this.studio) {
      if (used.has(key)) continue;
      e.material.dispose();
      this.studio.delete(key);
    }
  }

  /** Signed distance of a three.js point from the plane: positive on the removed side. */
  side(p: THREE.Vector3): number {
    return this.normal.value.dot(p) - this.distance;
  }

  /** The cap material of a project material (null: the part has none): the same material seen from behind, flat. */
  private capMaterial(id: string | null, state: ProjectState): THREE.MeshPhysicalMaterial {
    const inst = id ? (state.materials[id] ?? null) : null;
    const key = id ?? '';
    const size = state.scene.partSizeMm;
    const have = this.capMaterials.get(key);
    if (have && have.inst === inst && have.size === size) return have.material;
    let m = have?.material;
    if (!m) {
      m = inst ? makeMaterial(inst.graph ? null : inst, size) : this.fallback.clone();
      m.side = THREE.BackSide;
      m.clippingPlanes = this.clippingPlanes;
      m.clipShadows = false;
      // Over the back faces the part's own material draws at the same depth.
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -1;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.capNormal = this.normal;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 capNormal;')
          // A flat surface on the plane: its normal, whichever way the back face the ray found points.
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(capNormal, 0.0)).xyz);\nnonPerturbedNormal = normal;');
      };
      m.customProgramCacheKey = () => 'section-cap';
    } else if (inst && !inst.graph) {
      applyMaterial(m, inst, size);
    }
    this.capMaterials.set(key, { inst, size, material: m });
    return m;
  }

  /**
   * Makes the caps of the parts a section caps, and none while there is no section. `objects` are the parts' meshes of
   * the preview, by node id. Call it when the parts, the materials or the section's presence changed.
   */
  syncCaps(state: ProjectState, objects: ReadonlyMap<NodeId, THREE.Object3D>): void {
    const wanted = new Set<NodeId>();
    if (this.capping) {
      for (const [id, obj] of objects) if (obj instanceof THREE.Mesh && partIsCapped(state, id)) wanted.add(id);
    }
    for (const [id, cap] of this.caps) {
      const obj = objects.get(id);
      if (!wanted.has(id) || !(obj instanceof THREE.Mesh) || cap.parent !== obj) {
        cap.removeFromParent();
        this.caps.delete(id);
      }
    }
    const used = new Set<string>();
    for (const id of wanted) {
      const obj = objects.get(id) as THREE.Mesh;
      const material = this.capMaterial(state.scene.nodes[id].material ?? null, state);
      used.add(state.scene.nodes[id].material ?? '');
      let cap = this.caps.get(id);
      if (!cap) {
        cap = new THREE.Mesh(obj.geometry, material);
        cap.userData.nodeId = id;
        cap.userData.cap = true;
        // The mesh the preview draws is the part's: the cap moves with it and shares its geometry.
        obj.add(cap);
        this.caps.set(id, cap);
      } else {
        if (cap.geometry !== obj.geometry) cap.geometry = obj.geometry;
        if (cap.material !== material) cap.material = material;
      }
    }
    for (const [key, entry] of this.capMaterials) {
      if (!used.has(key)) {
        entry.material.dispose();
        this.capMaterials.delete(key);
      }
    }
  }

  /**
   * What a ray through the model finds first on the kept side, from the hits of the parts and of the caps (a hit on a
   * cap mesh is the back of a closed solid): the engine's rule. A hit on the removed side is nothing; where the ray
   * enters the kept side and the next surface is the back of a closed solid, that is the cap, at the plane.
   */
  firstKept(hits: readonly THREE.Intersection[], ray: THREE.Ray): SectionPick | null {
    if (!this.on) return hits[0] ? { hit: hits[0], cap: null } : null;
    // The studio is whole: a hit on it counts on whichever side of the plane it is.
    const kept = hits.find((h) => h.object.userData.sectionExempt || this.side(h.point) <= 0);
    if (!kept) return null;
    if (!kept.object.userData.cap) return { hit: kept, cap: null };
    // The back of a closed solid, met first on the kept side. A ray that starts on the kept side (inside the solid)
    // finds that surface itself; one that enters from the removed side finds the cut, where it meets the plane.
    const from = this.side(ray.origin);
    if (from <= 0) return { hit: kept, cap: null };
    const t = from / -this.normal.value.dot(ray.direction);
    return { hit: kept, cap: { point: ray.at(t, new THREE.Vector3()), normal: this.normal.value.clone() } };
  }

  /**
   * True when a mesh is gone from the view: its box lies wholly on the removed side. `exact` also looks at the
   * vertices when the box is cut (a curved band whose box reaches over the plane is gone all the same): the first
   * vertex on the kept side ends the look, so only a part that is gone wholly is read to the end.
   */
  removed(obj: THREE.Mesh, exact = false): boolean {
    if (!this.on || obj.userData.sectionExempt) return false;
    const g = obj.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const box = g.boundingBox;
    if (!box) return false;
    // The part's matrix from its own chain (not the cached `matrixWorld`, which is a frame behind after a change and
    // before the first frame): the model root's basis change is a matrix set by hand.
    const world = new THREE.Matrix4();
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
      if (o.matrixAutoUpdate) o.updateMatrix();
      world.premultiply(o.matrix);
    }
    // The answer for this plane, this geometry and this place is the same until one of them changes.
    const key = `${this.cutKey}|${exact}|${g.uuid}|${world.elements.join(',')}`;
    const known = this.goneCache.get(obj);
    if (known?.key === key) return known.gone;
    const gone = this.isGone(g, box, world, exact);
    this.goneCache.set(obj, { key, gone });
    return gone;
  }

  private isGone(g: THREE.BufferGeometry, box: THREE.Box3, world: THREE.Matrix4, exact: boolean): boolean {
    const corner = new THREE.Vector3();
    let gone = true;
    for (let i = 0; i < 8 && gone; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(world);
      if (this.side(corner) <= 0) gone = false;
    }
    if (gone || !exact) return gone;
    const position = g.getAttribute('position');
    if (!position || position.count === 0) return false;
    // side(v) = n · (W v) − d = (Wᵀ n) · v + n · t − d.
    const e = world.elements;
    const n = this.normal.value;
    const ax = n.x * e[0] + n.y * e[1] + n.z * e[2];
    const ay = n.x * e[4] + n.y * e[5] + n.z * e[6];
    const az = n.x * e[8] + n.y * e[9] + n.z * e[10];
    const c = n.x * e[12] + n.y * e[13] + n.z * e[14] - this.distance;
    for (let i = 0; i < position.count; i++) {
      if (ax * position.getX(i) + ay * position.getY(i) + az * position.getZ(i) + c <= 0) return false;
    }
    return true;
  }

  dispose(): void {
    for (const cap of this.caps.values()) cap.removeFromParent();
    this.caps.clear();
    for (const e of this.capMaterials.values()) e.material.dispose();
    this.capMaterials.clear();
    for (const e of this.studio.values()) e.material.dispose();
    this.studio.clear();
    this.fallback.dispose();
  }
}

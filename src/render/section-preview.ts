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
    const kept = hits.find((h) => this.side(h.point) <= 0);
    if (!kept) return null;
    if (!kept.object.userData.cap) return { hit: kept, cap: null };
    // The back of a closed solid, met first on the kept side. A ray that starts on the kept side (inside the solid)
    // finds that surface itself; one that enters from the removed side finds the cut, where it meets the plane.
    const from = this.side(ray.origin);
    if (from <= 0) return { hit: kept, cap: null };
    const t = from / -this.normal.value.dot(ray.direction);
    return { hit: kept, cap: { point: ray.at(t, new THREE.Vector3()), normal: this.normal.value.clone() } };
  }

  /** True when a mesh's box lies wholly on the removed side: the part is gone from the view. */
  removed(obj: THREE.Mesh): boolean {
    if (!this.on) return false;
    const g = obj.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const box = g.boundingBox;
    if (!box) return false;
    obj.updateWorldMatrix(true, false);
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(obj.matrixWorld);
      if (this.side(corner) <= 0) return false;
    }
    return true;
  }

  dispose(): void {
    for (const cap of this.caps.values()) cap.removeFromParent();
    this.caps.clear();
    for (const e of this.capMaterials.values()) e.material.dispose();
    this.capMaterials.clear();
    this.fallback.dispose();
  }
}

// Dropping a material on something (UI.md §2.2, §2.3): where a drop lands, and the one assignment it makes.
// The interface finds what is under the pointer (a pick in the viewport, a row of the tree) and hands it here;
// everything that decides what the drop means is pure, so it is tested with numbers and not with a mouse.
//
// What is reached:
//   - On a row of the tree: the node of the row, and with it every part under it (a group, a model).
//   - On the viewport: what a click there would select at the level in force. Part: the part. Group: its
//     assembly (the part when it has none). Model: the whole model. Faces: the whole face under the pointer
//     (a CAD face of a STEP or IGES part, otherwise the surface that continues, see core/faces.ts), through
//     the face materials of the part.
//
// What is assigned (the rules of a drop, documented once here):
//   - A catalogue preset or an item of the library: the instance the scene has of it, made if there is none
//     (the same as a click on its thumbnail, so a drop and a click leave the same project).
//   - An instance (the sphere of the material of the selection): that instance, so the target is linked to
//     the parts that already carry it.
//   - With `copy` (Alt): whatever the source is, a new instance of its own, shared with no part outside this
//     drop. Edit it and nothing else changes.
// The assignment is one `material/assign` action: one undo entry, whatever the target holds.

import { cadFaceRegion } from './faces';
import type { LibrarySource, MaterialAction, MaterialId } from './materials';
import { getMesh } from './meshes';
import { resolvePick, type NodeId, type SelectionLevel } from './scene';
import type { ProjectState } from './store';

/** What a drop lands on. */
export type DropTarget =
  /** Nodes at any level: the action reaches every part under them. */
  | { kind: 'nodes'; ids: NodeId[] }
  /** The triangles of a part, through its face materials. */
  | { kind: 'faces'; part: NodeId; indices: number[] };

/** Where the viewport's pick hit: the part and the triangle (the interface's `PickResult`). */
export interface PickedFace {
  node: NodeId;
  face: number;
}

/** The material being dragged, as an assignment names it. */
export interface DroppedMaterial {
  preset?: string;
  library?: LibrarySource;
  material?: MaterialId;
}

export type AssignAction = Extract<MaterialAction, { type: 'material/assign' }>;

/** What a drop on the viewport reaches at a selection level; null when nothing is under the pointer. */
export function viewportDropTarget(state: ProjectState, hit: PickedFace | null, level: SelectionLevel): DropTarget | null {
  if (!hit) return null;
  const node = state.scene.nodes[hit.node];
  if (!node || node.kind !== 'PART') return null;
  if (level === 'FACES') {
    const data = node.mesh ? getMesh(node.mesh.id) : undefined;
    const indices = data ? cadFaceRegion(data, hit.face, { faceRanges: node.faceRanges }) : [hit.face];
    return indices.length > 0 ? { kind: 'faces', part: node.id, indices } : null;
  }
  return { kind: 'nodes', ids: [resolvePick(state, node.id, level)] };
}

/** What a drop on a row of the tree reaches: the row's node and what is under it. Null for a row with no parts. */
export function treeDropTarget(state: ProjectState, id: NodeId): DropTarget | null {
  const node = state.scene.nodes[id];
  if (!node || (node.kind !== 'PART' && node.kind !== 'GROUP' && node.kind !== 'MODEL')) return null;
  if (node.kind !== 'PART' && !hasPartBelow(state, id)) return null;
  return { kind: 'nodes', ids: [id] };
}

function hasPartBelow(state: ProjectState, id: NodeId): boolean {
  const stack = [id];
  while (stack.length > 0) {
    const n = state.scene.nodes[stack.pop()!];
    if (!n) continue;
    if (n.kind === 'PART') return true;
    stack.push(...n.children);
  }
  return false;
}

/** The part a target reaches the most of, for naming it: the nodes, or the part of the faces. */
export function dropNodes(target: DropTarget): NodeId[] {
  return target.kind === 'nodes' ? target.ids : [target.part];
}

/** The assignment a drop makes. `copy`: a new instance of its own (Alt). */
export function dropAction(source: DroppedMaterial, target: DropTarget, copy = false): AssignAction {
  const base: AssignAction = { type: 'material/assign', ...source, targets: dropNodes(target), mode: 'REPLACE' };
  if (target.kind === 'faces') base.faces = { part: target.part, indices: [...target.indices] };
  if (copy) base.copy = true;
  return base;
}

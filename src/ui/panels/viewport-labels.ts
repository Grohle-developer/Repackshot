// The label tool in the viewport (phase M2a, UI.md §2.3): while `labelTool` is set, a press on a part that
// carries the material lays a label there (planar from the surface's normal, upright, its centre where the press
// was) and a drag sets its width; Move label slides a label over the surface under the pointer, keeping its
// size and turn. The whole gesture is one undo entry. It takes the pointer before the camera, the gizmo and the
// selection do (capture on the viewport, installed before the other overlays), and Esc leaves it.

import { partMaterials, triangleMaterials, type MaterialId } from '../../core/materials';
import { dot, mat4Invert, normalize, transformPoint, type Mat4 } from '../../core/math';
import { worldMatrix, type NodeId } from '../../core/scene';
import { labelWidthFromDrag, newLabel, nextLabelId, placeLabel, tangentOf, type TextureLabel } from '../../core/textures';
import { newGesture } from '../components/controls';
import { h } from '../dom';
import { materialLabel, materialName } from '../names';
import type { Ctx, Scope } from '../reactive';
import { getLang, L, t } from '../strings';
import { labelName } from '../texture-commands';

/** The share of the part's largest side a label gets from a click without a drag. */
const CLICK_WIDTH = 0.25;

interface Drag {
  pointer: number;
  gesture: string;
  material: MaterialId;
  label: string;
  part: NodeId;
  world: Mat4;
  kind: 'place' | 'move';
  aspect: number;
}

/** Whether the triangle `face` of a part shows `material`. */
function carries(ctx: Ctx, part: NodeId, face: number, material: MaterialId): boolean {
  const node = ctx.store.get().scene.nodes[part];
  if (!node || node.kind !== 'PART') return false;
  if (!node.faceMaterials?.length) return partMaterials(node).includes(material);
  return triangleMaterials(node)[face] === material;
}

export function viewportLabels(ctx: Ctx, scope: Scope, vp: HTMLElement): HTMLElement {
  const { store, ui, services } = ctx;
  const port = services.viewport!;
  const canvas = port.canvas;
  const banner = h('div', { class: 'ov ov-pick ov-label-tool', role: 'status', style: 'display:none', 'data-label-tool': '' });
  scope.watch(
    (s, u) => [u.labelTool, s.materials] as const,
    ([tool]) => {
      banner.style.display = tool ? '' : 'none';
      vp.toggleAttribute('data-label-tool', tool !== null);
      if (!tool) return;
      const m = store.get().materials[tool.material];
      const material = m ? materialName(m, getLang()) : '';
      banner.textContent = tool.kind === 'place' ? t('viewport.pickLabel', { material }) : t('viewport.moveLabel', { label: labelName(m, tool.label) });
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );

  const off = new AbortController();
  scope.onDispose(() => off.abort());
  const listen = { signal: off.signal };
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  let drag: Drag | null = null;
  const swallow = (e: Event) => {
    e.stopImmediatePropagation();
    e.preventDefault();
  };

  vp.addEventListener(
    'pointerdown',
    (e) => {
      const tool = ui.get().labelTool;
      if (!tool || e.button !== 0 || e.target !== canvas) return;
      swallow(e);
      const p = local(e);
      const hit = port.pick(p.x, p.y);
      if (!hit) return;
      if (!carries(ctx, hit.node, hit.face, tool.material)) {
        const m = store.get().materials[tool.material];
        ui.toast(t('viewport.labelWrongPart', { material: m ? materialName(m, getLang()) : '' }));
        return;
      }
      const s = store.get();
      const world = worldMatrix(s, hit.node);
      const mat = s.materials[tool.material];
      if (!mat) return;
      const gesture = newGesture('label');
      if (tool.kind === 'place') {
        const at = placeLabel(world, hit.point, hit.normal);
        const b = s.scene.nodes[hit.node].mesh?.bounds;
        const size = b ? Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : s.scene.partSizeMm;
        const id = nextLabelId(mat.textures);
        const label = newLabel(id, tool.image, at, Math.max(1, Math.round(CLICK_WIDTH * size * 10) / 10));
        store.dispatch({ type: 'texture/addLabel', material: tool.material, value: label, gesture, label: L('undo.labelAdd', { name: { en: tool.image.name, es: tool.image.name }, material: materialLabel(mat) }) });
        drag = { pointer: e.pointerId, gesture, material: tool.material, label: id, part: hit.node, world, kind: 'place', aspect: tool.image.width / tool.image.height };
      } else {
        const l = mat.textures.labels.find((x) => x.id === tool.label);
        if (!l) return;
        drag = { pointer: e.pointerId, gesture, material: tool.material, label: l.id, part: hit.node, world, kind: 'move', aspect: l.image.width / l.image.height };
        slide(hit.point, hit.normal, hit.node);
      }
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events have no pointer to capture.
      }
    },
    { capture: true, signal: off.signal },
  );

  /** Move: the label's centre to a point of the surface (model space), its axis laid on the new plane. */
  const slide = (point: readonly number[], normal: readonly number[], part: NodeId): void => {
    if (!drag) return;
    const s = store.get();
    const l = s.materials[drag.material]?.textures.labels.find((x) => x.id === drag!.label);
    if (!l) return;
    const world = part === drag.part ? drag.world : worldMatrix(s, part);
    const at = placeLabel(world, point, normal);
    // Keep the turn it had: its right laid on the new plane (or the upright one where it falls along the normal).
    const k = dot(l.uAxis, at.normal);
    let u = normalize([l.uAxis[0] - k * at.normal[0], l.uAxis[1] - k * at.normal[1], l.uAxis[2] - k * at.normal[2]]);
    if (Math.hypot(u[0], u[1], u[2]) < 0.5) u = tangentOf(at.normal);
    const patch: Partial<Omit<TextureLabel, 'id'>> = { origin: at.origin, normal: at.normal, uAxis: u };
    store.dispatch({ type: 'texture/setLabel', material: drag.material, labelId: drag.label, patch, gesture: drag.gesture, label: L('undo.labelMove', { name: { en: l.image.name, es: l.image.name } }) });
  };

  window.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const p = local(e);
      const hit = port.pick(p.x, p.y);
      if (!hit || !carries(ctx, hit.node, hit.face, drag.material)) return;
      if (drag.kind === 'move') {
        slide(hit.point, hit.normal, hit.node);
        return;
      }
      if (hit.node !== drag.part) return;
      const s = store.get();
      const l = s.materials[drag.material]?.textures.labels.find((x) => x.id === drag!.label);
      if (!l) return;
      const q = transformPoint(mat4Invert(drag.world), hit.point);
      const widthMm = Math.round(labelWidthFromDrag(l, drag.aspect, q, 0.5) * 100) / 100;
      if (widthMm === l.widthMm) return;
      store.dispatch({ type: 'texture/setLabel', material: drag.material, labelId: drag.label, patch: { widthMm }, gesture: drag.gesture, label: L('undo.labelAdd', { name: { en: l.image.name, es: l.image.name }, material: materialLabel(s.materials[drag.material]) }) });
    },
    listen,
  );
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const placed = drag.kind === 'place';
    drag = null;
    swallow(e);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Not captured.
    }
    // One label per Add label…; Move label stays on until Esc or its button.
    if (placed) ui.set({ labelTool: null });
  };
  window.addEventListener('pointerup', end, { capture: true, signal: off.signal });
  window.addEventListener('pointercancel', end, { capture: true, signal: off.signal });
  // While the tool is on, a release on the canvas is not a click that selects.
  vp.addEventListener(
    'pointerup',
    (e) => {
      if (ui.get().labelTool && e.target === canvas) swallow(e);
    },
    { capture: true, signal: off.signal },
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !ui.get().labelTool) return;
      e.preventDefault();
      e.stopPropagation();
      drag = null;
      ui.set({ labelTool: null });
    },
    { capture: true, signal: off.signal },
  );
  return banner;
}

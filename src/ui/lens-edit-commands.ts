// The commands of the lens editor (phase O2c, UI.md §2.4 Camera ▸ Lens ▸ Edit elements…). The editor works on a copy
// of the camera's traced lens, the camera's `lensDraft`: the first edit makes the copy (a catalogue lens is never
// edited in place) and every edit is one undo entry (a drag of a field is one gesture: one entry). Applying puts the
// copy on the camera as a lens of its own, one entry; it is refused unless the engine has checked that very lens
// (the editor passes what it checked). Discarding forgets the copy. Everything goes through the store (camera/set);
// which camera the window is open on is interface state.

import type { CameraId, CameraState } from '../core/camera';
import { editableLens, insertElement, lensRows, type EditedLens, type InsertAt } from '../core/lens-edit';
import { opticsOf, tracedOf } from '../core/optics';
import { startEdit, type TracedLens } from '../core/traced-lens';
import { lensPrescription } from '../data/lenses';
import { saveLensToLibrary } from './commands';
import type { Ctx } from './reactive';
import { L, lbl, t, type StringKey } from './strings';

/** The lens the editor shows for camera `cam`: its copy being edited, else the camera's own traced lens (null: none). */
export function editorLens(cam: CameraState | undefined): TracedLens | null {
  if (!cam) return null;
  return cam.lensDraft ?? tracedOf(opticsOf(cam));
}

/** True when the lens on `cam` can be edited (a traced lens that refracts only). */
export function canEditLens(cam: CameraState | undefined): boolean {
  const tr = editorLens(cam);
  const p = tr ? lensPrescription(tr.key) : undefined;
  return !!p && editableLens(p);
}

/** Opens the editor on camera `camId`; says why when its lens cannot be edited. */
export function openLensEditor(ctx: Ctx, camId: CameraId): boolean {
  const cam = ctx.store.get().camera.cameras[camId];
  if (!tracedOf(opticsOf(cam ?? ({} as CameraState))) && !cam?.lensDraft) {
    ctx.ui.toast(t('lensEditor.pickTraced'));
    return false;
  }
  if (!canEditLens(cam)) {
    ctx.ui.toast(t('lensEditor.notEditable'));
    return false;
  }
  ctx.ui.set({ lensEditor: { camera: camId } });
  return true;
}

export function closeLensEditor(ctx: Ctx): void {
  ctx.ui.set({ lensEditor: null });
}

/** The name of a copy of lens `tr`: the catalogue lens's, marked as edited. */
export function copyName(tr: TracedLens): string {
  const p = lensPrescription(tr.key);
  return t('lensEditor.copyName', { name: p ? lbl(p.name) : tr.key });
}

/**
 * One edit of the lens in the editor of camera `camId`: `fn` takes the edited lens and gives the next one (the same
 * object: nothing changed, nothing recorded). The first edit copies the camera's lens. One undo entry, or one per
 * gesture.
 */
export function editLens(ctx: Ctx, camId: CameraId, fn: (e: EditedLens) => EditedLens, what: StringKey, gesture?: string): boolean {
  const cam = ctx.store.get().camera.cameras[camId];
  const tr = editorLens(cam);
  if (!cam || !tr) return false;
  const base = startEdit(tr, copyName(tr));
  if (!base?.edited) return false;
  const next = fn(base.edited);
  // An edit that leaves every number as it was records nothing (a field set to its own value, a step at its limit).
  if (next === base.edited || JSON.stringify(next) === JSON.stringify(base.edited)) return false;
  ctx.store.dispatch({ type: 'camera/set', id: camId, patch: { lensDraft: { ...base, edited: next } }, gesture, label: L('undo.lensEdit', { what: L(what) }) });
  return true;
}

/**
 * Where a new element goes for "Add before" / "Add after" row `row` of the list: in front of its cemented group, or
 * after it (the editor never cuts into a cemented group).
 */
export function insertPlace(e: EditedLens, row: number, where: 'before' | 'after'): InsertAt {
  const rows = lensRows(e.surfaces);
  if (where === 'after') return { after: Math.max(0, Math.min(rows.length - 1, row)) };
  let first = Math.max(0, Math.min(rows.length - 1, row));
  while (first > 0) {
    const r = rows[first];
    if (r.kind !== 'element' || !r.cementedBefore) break;
    first--;
  }
  return first === 0 ? { front: true } : { after: first - 1 };
}

/** Adds the default element next to row `row` (see insertPlace). */
export function addElement(ctx: Ctx, camId: CameraId, row: number, where: 'before' | 'after', singlet: Parameters<typeof insertElement>[2], focal: number): boolean {
  return editLens(ctx, camId, (e) => insertElement(e, insertPlace(e, row, where), singlet, focal), 'lensEditor.op.add');
}

/**
 * Puts the copy on camera `camId` (its traced lens, one undo entry) and closes the copy. `checked` is the lens the
 * engine checked and found valid: anything else is refused (false), an invalid lens never reaches the camera.
 */
export function applyLensDraft(ctx: Ctx, camId: CameraId, checked: TracedLens): boolean {
  const cam = ctx.store.get().camera.cameras[camId];
  const draft = cam?.lensDraft;
  if (!cam || !draft || JSON.stringify(draft) !== JSON.stringify(checked)) return false;
  ctx.store.dispatch({ type: 'camera/set', id: camId, patch: { optics: { ...opticsOf(cam), traced: draft }, lensDraft: undefined }, label: L('undo.lensApply') });
  ctx.ui.toast(t('lensEditor.applied', { name: draft.edited?.name ?? '' }));
  return true;
}

/** Forgets the copy of camera `camId` (one undo entry): the editor shows the camera's lens again. */
export function discardLensDraft(ctx: Ctx, camId: CameraId): void {
  const cam = ctx.store.get().camera.cameras[camId];
  if (!cam?.lensDraft) return;
  ctx.store.dispatch({ type: 'camera/set', id: camId, patch: { lensDraft: undefined }, label: L('undo.lensDiscard') });
}

/** Saves `checked` (the editor's lens, checked by the engine) to the library as a lens of one's own, with the camera's iris. */
export function saveEditedToLibrary(ctx: Ctx, camId: CameraId, checked: TracedLens, name: string): void {
  saveLensToLibrary(ctx, camId, name, checked);
}

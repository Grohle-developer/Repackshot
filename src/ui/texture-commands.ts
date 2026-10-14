// What the texture slots and the labels of the material inspector do (phase M2a): load an image into a slot
// (the system's dialog on the desktop, the file input in the browser), take it out, edit how it reads, and the
// label tool's commands. Every change is a store action, undoable; the image itself goes to the registry first.

import { getImage, type ImageRef } from '../core/images';
import { partMaterials, type MaterialId } from '../core/materials';
import type { NodeId } from '../core/scene';
import { registerTextureImage, imageByteSize, TextureImageError } from '../core/texture-images';
import { newSlot, PROJECT_TEXTURE_MAX_BYTES, textureImages, type TextureMapping, type TextureSlot, type TextureSlotKey } from '../core/textures';
import { pickImage } from './commands';
import { dyn, materialLabel } from './names';
import type { Ctx } from './reactive';
import { L, t } from './strings';

const TEXTURE_EXTENSIONS = ['png', 'jpg', 'jpeg'];

/** The slot's name in both languages, for history labels. */
export const slotLabel = (slot: TextureSlotKey) => L(dyn(`texture.slot.${slot}`));

/** The toast for a file that cannot be a texture. */
export function textureErrorText(name: string, err: unknown): string {
  const reason = err instanceof TextureImageError ? err.reason : 'unreadable';
  return t('texture.error.load', { name, reason: t(dyn(`texture.drop.${reason}`)) });
}

/**
 * Reads an image file into the registry as a texture, or says why it cannot be one (a toast) and gives null.
 * The project's budget for texture files counts what it holds already.
 */
export async function readTextureFile(ctx: Ctx, file?: File): Promise<ImageRef | null> {
  const f = file ?? (await pickImage(ctx, 'dialog.loadTexture', 'dialog.textures', TEXTURE_EXTENSIONS));
  if (!f) return null;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const used = [...textureImages(ctx.store.get()).keys()];
    const ref = registerTextureImage(f.name, bytes);
    if (!used.includes(ref.id)) {
      const total = used.reduce((a, id) => a + imageByteSize(id), 0) + bytes.length;
      if (total > PROJECT_TEXTURE_MAX_BYTES) throw new TextureImageError('budget', f.name);
    }
    return ref;
  } catch (err) {
    ctx.ui.toast(textureErrorText(f.name, err));
    return null;
  }
}

/** Slot ▸ Load…: the file into the slot (replacing what was there, keeping how the slot read it), one undo entry. */
export async function loadSlotImage(ctx: Ctx, material: MaterialId, slot: TextureSlotKey, file?: File): Promise<boolean> {
  const ref = await readTextureFile(ctx, file);
  if (!ref) return false;
  const m = ctx.store.get().materials[material];
  if (!m) return false;
  const prev = m.textures[slot];
  const value: TextureSlot = prev ? { ...prev, image: ref } : newSlot(slot, ref);
  // A colour image with alpha in no alpha slot: nothing changes until the person asks (the alpha slot is its own).
  ctx.store.dispatch({ type: 'texture/setSlot', material, slot, value, label: L('undo.textureLoad', { name: ref.name, slot: slotLabel(slot), material: materialLabel(m) }) });
  return true;
}

export function removeSlotImage(ctx: Ctx, material: MaterialId, slot: TextureSlotKey): void {
  const m = ctx.store.get().materials[material];
  if (!m?.textures[slot]) return;
  ctx.store.dispatch({ type: 'texture/setSlot', material, slot, value: null, label: L('undo.textureRemove', { slot: slotLabel(slot), material: materialLabel(m) }) });
}

export function patchSlot(ctx: Ctx, material: MaterialId, slot: TextureSlotKey, patch: Partial<Omit<TextureSlot, 'image' | 'mapping'>>, gesture?: string): void {
  const m = ctx.store.get().materials[material];
  if (!m) return;
  ctx.store.dispatch({ type: 'texture/patchSlot', material, slot, patch, gesture, label: L('undo.texture', { slot: slotLabel(slot), material: materialLabel(m) }) });
}

/** Edits the shared mapping, or a slot's own. */
export function setMapping(ctx: Ctx, material: MaterialId, patch: Partial<TextureMapping>, gesture?: string, slot?: TextureSlotKey): void {
  const m = ctx.store.get().materials[material];
  if (!m) return;
  ctx.store.dispatch({ type: 'texture/setMapping', material, ...(slot ? { slot } : {}), patch, gesture, label: L('undo.mapping', { material: materialLabel(m) }) });
}

export function shareMapping(ctx: Ctx, material: MaterialId, slot: TextureSlotKey): void {
  const m = ctx.store.get().materials[material];
  if (!m) return;
  ctx.store.dispatch({ type: 'texture/shareMapping', material, slot, label: L('undo.mapping', { material: materialLabel(m) }) });
}

/** The parts that carry a material (whole or on some faces). */
export function partsWith(ctx: Ctx, material: MaterialId): NodeId[] {
  return Object.values(ctx.store.get().scene.nodes)
    .filter((n) => n.kind === 'PART' && partMaterials(n).includes(material))
    .map((n) => n.id);
}

/** The largest side of the parts that carry a material, mm of their own space (what "Fit to part" sizes a repeat to). */
export function materialPartSize(ctx: Ctx, material: MaterialId): number {
  const s = ctx.store.get();
  let size = 0;
  for (const id of partsWith(ctx, material)) {
    const b = s.scene.nodes[id].mesh?.bounds;
    if (!b || !(b.max[0] >= b.min[0])) continue;
    size = Math.max(size, b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  }
  return size > 0 ? Math.round(size * 100) / 100 : s.scene.partSizeMm;
}

/** Labels ▸ Add label…: an image, then the tool that places it with a press and a drag. */
export async function addLabel(ctx: Ctx, material: MaterialId, file?: File): Promise<boolean> {
  const ref = await readTextureFile(ctx, file);
  if (!ref) return false;
  ctx.ui.set({ labelTool: { kind: 'place', material, image: ref }, pickMode: null });
  return true;
}

/** Labels ▸ Move label: the tool slides that label over the part, or stops doing so. */
export function toggleMoveLabel(ctx: Ctx, material: MaterialId, label: string): void {
  const cur = ctx.ui.get().labelTool;
  ctx.ui.set({ labelTool: cur?.kind === 'move' && cur.label === label ? null : { kind: 'move', material, label }, pickMode: null });
}

/** The name a label shows: its image's. */
export function labelName(material: { textures: { labels: { id: string; image: ImageRef }[] } } | undefined, id: string): string {
  return material?.textures.labels.find((l) => l.id === id)?.image.name ?? id;
}

/** An object URL of a registered image's file, for the inspector's small previews (one per image, kept). */
const urls = new Map<string, string>();
export function imageUrl(id: string): string | null {
  const hit = urls.get(id);
  if (hit) return hit;
  const data = getImage(id);
  if (!data || typeof URL.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(new Blob([data.bytes as Uint8Array<ArrayBuffer>], { type: data.format === 'PNG' ? 'image/png' : 'image/jpeg' }));
  urls.set(id, url);
  return url;
}

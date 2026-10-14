// Phase M2a in the interface without the DOM: a model chosen with its material library and images goes through the
// sheet with them, Import registers the images and brings the materials with their slots as one undo entry and
// the project's 64 MB budget for texture files holds; the inspector's commands load and remove an image, and the
// label tool starts and stops.

import { describe, expect, it } from 'vitest';
import { getImage } from '../src/core/images';
import { textureSummary } from '../src/core/import-options';
import { createInitialState, createStore } from '../src/core/store';
import { registerTextureImage, textureImageId } from '../src/core/texture-images';
import { newSlot, PROJECT_TEXTURE_MAX_BYTES, textureImages } from '../src/core/textures';
import { importFile } from '../src/io/import';
import { confirmImport, importFiles, projectTextures } from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { t } from '../src/ui/strings';
import { addLabel, loadSlotImage, removeSlotImage, toggleMoveLabel } from '../src/ui/texture-commands';
import { createUiStore } from '../src/ui/ui-state';
import { buildExample } from '../src/core/example';
import { colourImage, texturedObj } from '../tools/texture-fixtures.mjs';

function makeCtx(): Ctx {
  const services = {
    viewport: null,
    importFile: (file: File, options?: Parameters<typeof importFile>[1]) => importFile(file, options),
  } as unknown as AppServices;
  return { store: createStore(createInitialState()), ui: createUiStore(), services };
}

const objFiles = (): File[] => {
  const { obj, mtl, images } = texturedObj();
  return [new File([obj], 'quad.obj'), new File([mtl], 'quad.mtl'), ...Object.entries(images).map(([n, b]) => new File([b as Uint8Array<ArrayBuffer>], n))];
};

/** A PNG-looking file of about `size` bytes (a header, then filler): what the budget counts, never decoded here. */
function bigPng(size: number, seed: number): Uint8Array {
  const head = colourImage(4);
  const out = new Uint8Array(size);
  out.set(head.subarray(0, 33));
  out[40] = seed;
  return out;
}

describe('a model chosen with its material library and images', () => {
  it('goes to the sheet with them, and Import brings the materials with their slots in one undo entry', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, objFiles());
    const sheet = ctx.ui.get().importSheet!;
    // The images and the library were not read as models of their own: one sheet, nothing queued.
    expect(sheet.name).toBe('quad.obj');
    expect(sheet.queued).toBe(0);
    expect(textureSummary(sheet.payload.textures ?? []).kept).toBe(4);
    confirmImport(ctx);
    const s = ctx.store.get();
    const m = Object.values(s.materials).find((x) => x.name === 'Paint')!;
    expect(m.textures.color?.image.name).toBe('paint colour.png');
    for (const id of textureImages(s).keys()) expect(getImage(id), id).toBeDefined();
    expect(ctx.store.history().undo).toEqual(['Import quad.obj']);
  });

  it('images alone are not a model', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, [new File([colourImage(4) as Uint8Array<ArrayBuffer>], 'only.png')]);
    expect(ctx.ui.get().importSheet).toBeNull();
    expect(ctx.ui.get().importMessage).toBe(t('import.unknown', { name: 'only.png' }));
  });

  it('the project’s budget drops what does not fit, with its reason, and counts what the project holds', async () => {
    const ctx = makeCtx();
    ctx.store.dispatch({ type: 'scene/addModel', payload: buildExample(), replace: true });
    // The project already holds just under 64 MB of textures.
    const mat = Object.keys(ctx.store.get().materials)[0];
    const quarter = Math.floor(PROJECT_TEXTURE_MAX_BYTES / 4) - 40;
    const slots = ['color', 'roughness', 'metal', 'normal'] as const;
    slots.forEach((slot, i) => {
      const ref = registerTextureImage(`big${i}.png`, bigPng(quarter, i + 1));
      ctx.store.dispatch({ type: 'texture/setSlot', material: mat, slot, value: newSlot(slot, ref), label: 'big' });
    });
    await importFiles(ctx, objFiles());
    const textures = projectTextures(ctx, ctx.ui.get().importSheet!.payload.textures ?? []);
    expect(textures.filter((x) => x.dropped === 'budget').length).toBeGreaterThan(0);
    confirmImport(ctx);
    const paint = Object.values(ctx.store.get().materials).find((x) => x.name === 'Paint')!;
    // A slot whose image did not fit is empty; the toasts say why.
    const kept = (['color', 'roughness', 'alpha', 'normal'] as const).filter((k) => paint.textures[k] !== null).length;
    expect(kept).toBeLessThan(4);
    expect(ctx.ui.get().toasts.some((x) => x.text.includes(t('texture.drop.budget')))).toBe(true);
  });
});

describe('the inspector’s texture commands', () => {
  it('Load… puts the file in the slot (undoable), Remove takes it out; a file that is not an image is refused', async () => {
    const ctx = makeCtx();
    ctx.store.dispatch({ type: 'scene/addModel', payload: buildExample(), replace: true });
    const mat = Object.keys(ctx.store.get().materials)[0];
    const png = colourImage(16);
    expect(await loadSlotImage(ctx, mat, 'color', new File([png as Uint8Array<ArrayBuffer>], 'c.png'))).toBe(true);
    expect(ctx.store.get().materials[mat].textures.color?.image).toEqual({ id: textureImageId(png), name: 'c.png', width: 16, height: 16 });
    expect(ctx.store.history().undo[0]).toMatch(/^Load c\.png into Colour of /);
    removeSlotImage(ctx, mat, 'color');
    expect(ctx.store.get().materials[mat].textures.color).toBeNull();
    ctx.store.undo();
    expect(ctx.store.get().materials[mat].textures.color).not.toBeNull();
    expect(await loadSlotImage(ctx, mat, 'normal', new File(['not an image'], 'n.png'))).toBe(false);
    expect(ctx.ui.get().toasts.at(-1)?.text).toBe(t('texture.error.load', { name: 'n.png', reason: t('texture.drop.format') }));
  });

  it('Add label… starts the tool with its image; Move label starts and stops it', async () => {
    const ctx = makeCtx();
    ctx.store.dispatch({ type: 'scene/addModel', payload: buildExample(), replace: true });
    const mat = Object.keys(ctx.store.get().materials)[0];
    const history = ctx.store.history().undo.length;
    expect(await addLabel(ctx, mat, new File([colourImage(8) as Uint8Array<ArrayBuffer>], 'l.png'))).toBe(true);
    expect(ctx.ui.get().labelTool).toMatchObject({ kind: 'place', material: mat, image: { name: 'l.png', width: 8 } });
    // Choosing an image does not change the project: the press on the part does.
    expect(ctx.store.history().undo.length).toBe(history);
    toggleMoveLabel(ctx, mat, 'lb1');
    expect(ctx.ui.get().labelTool).toEqual({ kind: 'move', material: mat, label: 'lb1' });
    toggleMoveLabel(ctx, mat, 'lb1');
    expect(ctx.ui.get().labelTool).toBeNull();
  });
});

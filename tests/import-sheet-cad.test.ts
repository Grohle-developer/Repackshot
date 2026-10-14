// STEP and IGES in the import sheet (phase I2), without the DOM: the sheet opens as soon as the file is
// dropped and says where the read is; the payload arrives in the background (the real library, in this thread,
// through tests/occt-node.ts); Import pressed early imports when the file is read; a new tessellation reads the
// file again; a file that cannot be read says why in the sheet; Cancel stops the read.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { describePayload, ImportError, TESSELLATION_PRESETS, type ImportReadOptions } from '../src/core/import-options';
import { hasMesh } from '../src/core/meshes';
import { ownParts } from '../src/core/scene';
import { createInitialState, createStore, type ProjectState } from '../src/core/store';
import { importFile } from '../src/io/import';
import { releaseCadWorker, setCadWorkerFactory } from '../src/io/step';
import { CAD_REREAD_DELAY_MS, cancelImport, confirmImport, importFiles, setImportOptions } from '../src/ui/commands';
import { cadStatusText } from '../src/ui/panels/import-sheet';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang, t } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { fixture, inProcessWorker, loadOcct } from './occt-node';

/** The roots of the model: not the pieces a set (L6) dresses an imported product with. */
const ownRoots = (st: ProjectState): string[] => st.scene.roots.filter((r) => !st.scene.nodes[r].setPiece);

beforeAll(async () => {
  await loadOcct();
  setCadWorkerFactory(() => inProcessWorker());
}, 60_000);

afterEach(() => {
  releaseCadWorker();
  setLang('en');
});

/** A context whose importer is the real one (the CAD worker is the in-process stand-in); `calls` records each read. */
function makeCtx(importer?: (file: File, o?: ImportReadOptions) => Promise<Awaited<ReturnType<AppServices['importFile']>>>) {
  const calls: { file: File; options?: ImportReadOptions }[] = [];
  const services = {
    viewport: null,
    renderImage: async () => new Blob(),
    captureViewport: async () => null,
    importFile: (file: File, options?: ImportReadOptions) => {
      calls.push({ file, options });
      return importer ? importer(file, options) : importFile(file, options);
    },
    serializeProject: () => new Blob(),
  } as unknown as AppServices;
  const ctx: Ctx = { store: createStore(createInitialState()), ui: createUiStore(), services };
  return { ctx, calls };
}
const cadFile = (name: string) => new File([fixture(name) as BlobPart], name);
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}
const ready = (ctx: Ctx) => ctx.ui.get().importSheet?.cad?.stage === 'ready';

describe('a STEP file in the sheet', () => {
  it('opens the sheet at once, reading, and fills it when the file is read', async () => {
    const { ctx, calls } = makeCtx();
    await importFiles(ctx, [cadFile('assembly.step')]);
    const sheet = ctx.ui.get().importSheet!;
    // Open before anything is read: no parts yet, the status says where the read is.
    expect(sheet).toMatchObject({ name: 'assembly.step', format: 'STEP', rev: 0 });
    expect(describePayload(sheet.payload).parts).toBe(0);
    expect(sheet.cad!.stage).not.toBe('ready');
    expect(calls[0].options!.tessellation).toEqual(TESSELLATION_PRESETS.MEDIUM);
    expect(calls[0].options!.signal).toBeInstanceOf(AbortSignal);
    await until(() => ready(ctx));
    const now = ctx.ui.get().importSheet!;
    expect(now.rev).toBe(1);
    expect(describePayload(now.payload)).toMatchObject({ parts: 2, groups: 1, materials: 2 });
    expect(ownRoots(ctx.store.get())).toEqual([]);
    confirmImport(ctx);
    const s = ctx.store.get();
    expect(ownParts(s).map((p) => s.scene.nodes[p].name).sort()).toEqual(['Body', 'Cap']);
    // The CAD faces reach the scene with the parts.
    expect(ownParts(s).map((p) => s.scene.nodes[p].faceRanges!.length).sort()).toEqual([3, 6]);
    expect(ctx.ui.get().importSheet).toBeNull();
  });

  it('takes the units the file declares once it is read: inches, 25.4 times millimetres', async () => {
    const { ctx } = makeCtx();
    await importFiles(ctx, [cadFile('box-inch.step')]);
    await until(() => ready(ctx));
    expect(ctx.ui.get().importSheet!.options.units).toBe('in');
    confirmImport(ctx);
    expect(ctx.store.get().scene.partSizeMm).toBeCloseTo(50.8, 3);
  });

  it('imports when the file is read if Import was pressed before', async () => {
    const { ctx } = makeCtx();
    await importFiles(ctx, [cadFile('box.step')]);
    confirmImport(ctx);
    expect(ctx.ui.get().importSheet!.cad!.confirm).toBe(true);
    expect(cadStatusText('box.step', ctx.ui.get().importSheet!.cad!)).toContain(t('import.cad.whenRead'));
    expect(ownRoots(ctx.store.get())).toEqual([]);
    await until(() => ctx.ui.get().importSheet === null);
    expect(ownParts(ctx.store.get())).toHaveLength(1);
    expect(ctx.store.history().undo).toEqual(['Import box.step']);
  });

  it('reads the file again with another quality, and the sheet shows the new triangles', async () => {
    const { ctx, calls } = makeCtx();
    await importFiles(ctx, [cadFile('cylinder.step')]);
    await until(() => ready(ctx));
    const medium = describePayload(ctx.ui.get().importSheet!.payload).triangles;
    const oldMeshes = Object.values(ctx.ui.get().importSheet!.payload.nodes).filter((n) => n.mesh).map((n) => n.mesh!.id);
    setImportOptions(ctx, { tessellation: 'HIGH' });
    expect(ctx.ui.get().importSheet!.options).toMatchObject({ tessellation: 'HIGH', ...TESSELLATION_PRESETS.HIGH });
    // Not at once: the fields may still be moving. But the sheet says the counts are about to change, and Import
    // pressed now waits for the new quality.
    expect(calls).toHaveLength(1);
    expect(ctx.ui.get().importSheet!.cad!.stage).toBe('read');
    await new Promise((r) => setTimeout(r, CAD_REREAD_DELAY_MS + 20));
    expect(calls).toHaveLength(2);
    expect(calls[1].options!.tessellation).toEqual(TESSELLATION_PRESETS.HIGH);
    await until(() => ready(ctx) && ctx.ui.get().importSheet!.rev === 2);
    expect(describePayload(ctx.ui.get().importSheet!.payload).triangles).toBeGreaterThan(medium);
    // The meshes of the first read are freed.
    expect(oldMeshes.some(hasMesh)).toBe(false);
    // Units chosen by the person are kept on a re-read.
    setImportOptions(ctx, { units: 'cm' });
    setImportOptions(ctx, { angleDeg: 30 });
    expect(ctx.ui.get().importSheet!.options).toMatchObject({ tessellation: 'CUSTOM', angleDeg: 30, chordPercent: TESSELLATION_PRESETS.HIGH.chordPercent });
    await until(() => ready(ctx) && ctx.ui.get().importSheet!.rev === 3);
    expect(ctx.ui.get().importSheet!.options.units).toBe('cm');
    // Choosing the values of a preset by hand selects that preset; the same values do not read again.
    setImportOptions(ctx, { chordPercent: TESSELLATION_PRESETS.LOW.chordPercent, angleDeg: TESSELLATION_PRESETS.LOW.angleDeg });
    expect(ctx.ui.get().importSheet!.options.tessellation).toBe('LOW');
    await until(() => ready(ctx) && ctx.ui.get().importSheet!.rev === 4);
    const reads = calls.length;
    setImportOptions(ctx, { tessellation: 'LOW', flipNormals: true });
    await new Promise((r) => setTimeout(r, CAD_REREAD_DELAY_MS + 20));
    expect(calls).toHaveLength(reads);
    cancelImport(ctx);
  });

  it('a file that cannot be read says why in the sheet, and Import does nothing', async () => {
    const { ctx } = makeCtx();
    await importFiles(ctx, [new File(['ISO-10303-21;\nnot really'], 'broken.step')]);
    await until(() => ctx.ui.get().importSheet?.cad?.stage === 'error');
    const sheet = ctx.ui.get().importSheet!;
    expect(sheet.cad!.error).toBe(t('import.error.unreadable'));
    expect(cadStatusText(sheet.name, sheet.cad!)).toBe(t('import.cad.failed', { name: 'broken.step', reason: t('import.error.unreadable') }));
    confirmImport(ctx);
    expect(ownRoots(ctx.store.get())).toEqual([]);
    expect(ctx.ui.get().toasts.some((x) => x.text.includes('broken.step'))).toBe(true);
    cancelImport(ctx);
    expect(ctx.ui.get().importSheet).toBeNull();
  });

  it('says it in Spanish too', async () => {
    setLang('es');
    const { ctx } = makeCtx(async () => {
      throw new ImportError('timeout', '60 s');
    });
    await importFiles(ctx, [new File(['x'], 'slow.stp')]);
    await until(() => ctx.ui.get().importSheet?.cad?.stage === 'error');
    expect(ctx.ui.get().importSheet!.cad!.error).toBe('la lectura tardaba demasiado y se detuvo');
    expect(cadStatusText('slow.stp', { stage: 'download', loaded: 3_100_000, total: 7_600_000 })).toBe('Cargando el lector de STEP e IGES: 3,1 de 7,6 MB');
    setLang('en');
    expect(cadStatusText('slow.stp', { stage: 'download', loaded: 3_100_000, total: 7_600_000 })).toBe('Loading the STEP and IGES reader: 3.1 of 7.6 MB');
    expect(cadStatusText('slow.stp', { stage: 'download', loaded: 3_100_000, total: 0 })).toBe('Loading the STEP and IGES reader: 3.1 MB');
    expect(cadStatusText('slow.stp', { stage: 'read' })).toBe('Reading and tessellating slow.stp…');
    cancelImport(ctx);
  });

  it('Cancel stops the read in flight', async () => {
    let signal: AbortSignal | undefined;
    const { ctx } = makeCtx(
      (_file, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal;
          signal?.addEventListener('abort', () => reject(new ImportError('aborted')));
        }),
    );
    await importFiles(ctx, [new File(['x'], 'big.igs')]);
    expect(ctx.ui.get().importSheet!.format).toBe('IGES');
    expect(signal!.aborted).toBe(false);
    cancelImport(ctx);
    expect(signal!.aborted).toBe(true);
    expect(ctx.ui.get().importSheet).toBeNull();
  });

  it('the next file of the queue waits for the CAD sheet like for any other', async () => {
    const { ctx } = makeCtx();
    await importFiles(ctx, [cadFile('box.step'), cadFile('quarter.igs')]);
    expect(ctx.ui.get().importSheet).toMatchObject({ name: 'box.step', queued: 1 });
    await until(() => ready(ctx));
    confirmImport(ctx);
    await until(() => ctx.ui.get().importSheet?.name === 'quarter.igs' && ready(ctx));
    expect(ctx.ui.get().importSheet!.format).toBe('IGES');
    confirmImport(ctx);
    expect(ownParts(ctx.store.get()).map((p) => ctx.store.get().scene.nodes[p].name).sort()).toEqual(['Box', 'Quarter shell']);
  });
});

// The import path of the interface without the DOM (phase I3): a file is read,
// the sheet's state holds the detected values and the options, nothing reaches
// the scene until Import, and Import applies every option through the store as
// one undoable step. The DOM of the sheet itself is checked in the browser.

import { afterEach, describe, expect, it } from 'vitest';
import { activeCamera } from '../src/core/camera';
import { runDoctor } from '../src/core/doctor';
import { centrePivot, describePayload } from '../src/core/import-options';
import { hasMesh } from '../src/core/meshes';
import { allParts, boundsOf, partsUnder } from '../src/core/scene';
import { createInitialState, createStore } from '../src/core/store';
import { buildExample } from '../src/core/example';
import { importFile, READ_EXTENSIONS } from '../src/io/import';
import { CAD_FORMATS, cancelImport, confirmImport, importFiles, MODEL_ACCEPT, READ_FORMATS, setImportOptions } from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang, STRINGS, t } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import twoPartsFbx from './fixtures/two-parts.fbx?raw';
import cubeObj from './fixtures/cube-two-groups.obj?raw';
import { makePayload } from './io-helpers';

const close = (got: readonly number[], want: readonly number[], digits = 4) => want.forEach((w, i) => expect(got[i], `[${i}]`).toBeCloseTo(w, digits));

function makeCtx(): Ctx {
  const services = {
    viewport: null,
    renderImage: async () => new Blob(),
    captureViewport: async () => null,
    importFile: (file: File) => importFile(file),
    serializeProject: () => new Blob(),
  } as unknown as AppServices;
  return { store: createStore(createInitialState()), ui: createUiStore(), services };
}
const file = (name: string, text: string) => new File([text], name);
/** Waits for something the interface does after an await (the next file of a queue is read in the background). */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}
const fbx = () => file('two-parts.fbx', twoPartsFbx);
const obj = () => file('cube-two-groups.obj', cubeObj);

afterEach(() => setLang('en'));

describe('the sheet opens with what the file says and imports nothing yet', () => {
  it('reads the file, preselects the detected values and leaves the scene alone', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, [fbx()]);
    const sheet = ctx.ui.get().importSheet!;
    expect(sheet).toBeTruthy();
    expect(sheet).toMatchObject({ name: 'two-parts.fbx', format: 'FBX', queued: 0 });
    expect(describePayload(sheet.payload)).toEqual({ parts: 2, groups: 2, triangles: 24, materials: 1 });
    expect(sheet.options).toEqual({
      units: 'cm', upAxis: 'Y', center: true, restOnFloor: true, frameCamera: true, mode: 'replace', groupBy: 'object',
      materials: 'keep', separate: 'none', tessellation: 'MEDIUM', chordPercent: 0.05, angleDeg: 12, importHidden: false, flipNormals: false,
    });
    expect(ctx.store.get().scene.roots).toEqual([]);
    expect(ctx.store.history().undo).toEqual([]);
    expect(ctx.ui.get().rightCollapsed).toBe(false);
    expect(ctx.ui.get().importMessage).toContain('two-parts.fbx');
  });

  it('starts on Add when the scene already has parts, and on Replace when it has none', async () => {
    const ctx = makeCtx();
    ctx.store.dispatch({ type: 'scene/addModel', payload: buildExample(), replace: true });
    await importFiles(ctx, [fbx()]);
    expect(ctx.ui.get().importSheet!.options.mode).toBe('add');
    const empty = makeCtx();
    await importFiles(empty, [fbx()]);
    expect(empty.ui.get().importSheet!.options.mode).toBe('replace');
  });

  it('changes only the options it is told to', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, [fbx()]);
    const before = ctx.ui.get().importSheet!;
    setImportOptions(ctx, { units: 'in', flipNormals: true });
    const after = ctx.ui.get().importSheet!;
    expect(after.options).toEqual({ ...before.options, units: 'in', flipNormals: true });
    expect(after.id).toBe(before.id);
    expect(after.payload).toBe(before.payload);
  });

  it('says so for formats it cannot read, and for files that fail, without opening a sheet', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, [file('notes.txt', 'hello')]);
    expect(ctx.ui.get().importMessage).toBe(t('import.unknown', { name: 'notes.txt' }));
    await importFiles(ctx, [file('broken.fbx', 'hello')]);
    expect(ctx.ui.get().importSheet).toBeNull();
    expect(ctx.ui.get().importMessage).toContain('broken.fbx');
    expect(ctx.ui.get().toasts.length).toBeGreaterThan(0);
  });

  it('lists the same formats as the importer', () => {
    expect([...READ_FORMATS].sort()).toEqual([...READ_EXTENSIONS].sort());
    for (const ext of READ_FORMATS) expect(MODEL_ACCEPT.split(',')).toContain(`.${ext}`);
    expect(CAD_FORMATS).toEqual(['step', 'stp', 'iges', 'igs']);
    for (const ext of CAD_FORMATS) expect(READ_FORMATS).toContain(ext);
    // The empty state names every format that is read, and none as coming soon any more.
    for (const f of ['glTF/GLB', 'OBJ', 'STL', 'FBX', '3DM', '3MF', 'PLY', 'DAE', 'USD/USDZ', 'STEP', 'IGES']) expect(t('empty.formats')).toContain(f);
    expect(STRINGS.es['empty.formats']).toContain('USD/USDZ');
    for (const lang of ['en', 'es'] as const) expect(STRINGS[lang]['empty.formats']).not.toMatch(/soon|próximamente/);
  });
});

describe('Import', () => {
  it('adds the model centred, resting on the floor and framed, as one undoable step', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, [fbx()]);
    confirmImport(ctx);
    const s = ctx.store.get();
    expect(ctx.ui.get().importSheet).toBeNull();
    expect(s.scene.roots).toHaveLength(1);
    expect(allParts(s)).toHaveLength(2);
    // Centimetres, Y up: 40 x 40 x 70 mm, centred on the origin in XY, standing on z = 0.
    const b = boundsOf(s, s.scene.roots);
    close(b.min, [-20, -20, 0], 3);
    close(b.max, [20, 20, 70], 3);
    expect(s.scene.partSizeMm).toBeCloseTo(70, 3);
    // The model's origin is at the centre of its bounds, so the Doctor has nothing to say about it.
    const root = s.scene.nodes[s.scene.roots[0]];
    close(root.transform.position, [0, 0, 35], 3);
    expect(runDoctor(s).find((r) => r.key === 'origin')!.status).toBe('OK');
    // The camera looks at the part, with clip planes that contain it.
    const cam = activeCamera(s);
    close(cam.target, [0, 0, 35], 3);
    expect(cam.clipStart).toBeLessThan(cam.distance - 50);
    expect(cam.clipEnd).toBeGreaterThan(cam.distance + 50);
    // One entry in the history, named after the file.
    expect(ctx.store.history().undo).toEqual(['Import two-parts.fbx']);
    ctx.store.undo();
    expect(ctx.store.get().scene.roots).toEqual([]);
    expect(ctx.ui.get().toasts.some((x) => x.text === t('import.done', { name: 'two-parts.fbx' }))).toBe(true);
  });

  it('applies the units: inches are 25.4 times bigger than millimetres', async () => {
    const size = async (units: 'mm' | 'cm' | 'm' | 'in') => {
      const ctx = makeCtx();
      await importFiles(ctx, [fbx()]);
      setImportOptions(ctx, { units });
      confirmImport(ctx);
      return ctx.store.get().scene.partSizeMm;
    };
    expect(await size('mm')).toBeCloseTo(7, 4);
    expect(await size('cm')).toBeCloseTo(70, 3);
    expect(await size('in')).toBeCloseTo(7 * 25.4, 3);
    expect(await size('m')).toBeCloseTo(7000, 2);
  });

  it('applies the up axis: Y up and Z up give a model that stands differently', async () => {
    const dims = async (upAxis: 'Y' | 'Z') => {
      const ctx = makeCtx();
      await importFiles(ctx, [fbx()]);
      setImportOptions(ctx, { upAxis });
      confirmImport(ctx);
      const s = ctx.store.get();
      const b = boundsOf(s, s.scene.roots);
      return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    };
    // The file is 4 x 6 x 4 cm with y as height: standing (Y up), 70 tall; lying (Z up), 40 tall and 70 deep.
    close(await dims('Y'), [40, 40, 70], 3);
    close(await dims('Z'), [40, 70, 40], 3);
  });

  it('groups by material and separates by material', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, [obj()]);
    setImportOptions(ctx, { groupBy: 'material', separate: 'material' });
    confirmImport(ctx);
    const s = ctx.store.get();
    const model = s.scene.nodes[s.scene.roots[0]];
    // The OBJ has two groups (Caps without material, Body in Steel): two groups of one part each.
    expect(model.children.map((c) => [s.scene.nodes[c].kind, s.scene.nodes[c].children.length])).toEqual([['GROUP', 1], ['GROUP', 1]]);
    expect(allParts(s)).toHaveLength(2);
  });

  it('keeps the file materials or applies the default one', async () => {
    const materials = async (policy: 'keep' | 'default') => {
      const ctx = makeCtx();
      await importFiles(ctx, [obj()]);
      setImportOptions(ctx, { materials: policy });
      confirmImport(ctx);
      return Object.values(ctx.store.get().materials).map((m) => m.name ?? 'Default').sort();
    };
    expect(await materials('keep')).toEqual(['Default', 'Steel']);
    expect(await materials('default')).toEqual(['Default']);
  });

  it('Center, Rest on floor and Frame camera each do their part, and nothing when off', async () => {
    // Both groups of the file moved 30 cm along x and 10 cm up (file y): the part floats 100 mm above the floor, 300 mm off the centre.
    const shifted = twoPartsFbx.replace(/(Model: (?:1000|1003)[\s\S]*?"A",)0,0,0/g, '$130,10,0');
    expect(shifted).not.toBe(twoPartsFbx);
    const run = async (patch: object) => {
      const ctx = makeCtx();
      const before = activeCamera(ctx.store.get());
      await importFiles(ctx, [file('shifted.fbx', shifted)]);
      setImportOptions(ctx, patch);
      confirmImport(ctx);
      const s = ctx.store.get();
      return { b: boundsOf(s, s.scene.roots), cam: activeCamera(s), before };
    };
    const off = await run({ center: false, restOnFloor: false, frameCamera: false });
    // Nothing moved: the file's own placement.
    close(off.b.min, [280, -20, 100], 3);
    close(off.b.max, [320, 20, 170], 3);
    expect(off.cam.target).toEqual(off.before.target);
    expect(off.cam.distance).toBe(off.before.distance);
    const centred = await run({ restOnFloor: false, frameCamera: false });
    close(centred.b.min, [-20, -20, 100], 3); // x and y centred, z left alone
    const rested = await run({ center: false, frameCamera: false });
    close(rested.b.min, [280, -20, 0], 3); // down to the floor, x left alone
    const both = await run({ frameCamera: false });
    close(both.b.min, [-20, -20, 0], 3);
    close(both.b.max, [20, 20, 70], 3);
    // Frame camera moves the camera, and only when on.
    expect(both.cam.distance).toBe(both.before.distance);
    const framed = await run({});
    expect(framed.cam.distance).not.toBe(framed.before.distance);
    close(framed.cam.target, [0, 0, 35], 3);
  });

  it('Replace swaps the scene, Add keeps it', async () => {
    const parts = async (mode: 'add' | 'replace') => {
      const ctx = makeCtx();
      ctx.store.dispatch({ type: 'scene/addModel', payload: buildExample(), replace: true });
      const before = allParts(ctx.store.get()).length;
      await importFiles(ctx, [fbx()]);
      setImportOptions(ctx, { mode });
      confirmImport(ctx);
      const s = ctx.store.get();
      return { before, after: allParts(s).length, roots: s.scene.roots.length };
    };
    const add = await parts('add');
    expect(add.after).toBe(add.before + 2);
    expect(add.roots).toBe(2);
    const replace = await parts('replace');
    expect(replace.after).toBe(2);
    expect(replace.roots).toBe(1);
  });

  it('a model imported at the wrong scale is framed with planes that contain it', async () => {
    const ctx = makeCtx();
    // 0.02 mm: a part in metres taken as millimetres.
    await importFiles(ctx, [file('metres.obj', cubeObj.replace(/^v (.*)$/gm, (_m, xyz: string) => `v ${xyz.split(/\s+/).filter(Boolean).map((x) => Number(x) / 1000).join(' ')}`))]);
    expect(ctx.ui.get().importSheet!.options.units).toBe('m');
    setImportOptions(ctx, { units: 'mm' });
    confirmImport(ctx);
    const s = ctx.store.get();
    const cam = activeCamera(s);
    expect(s.scene.partSizeMm).toBeCloseTo(0.02, 6);
    expect(cam.distance).toBeLessThan(1);
    expect(cam.clipStart).toBeLessThan(cam.distance - 0.01);
  });
});

describe('Cancel and the queue', () => {
  it('forgets the file and frees its meshes', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, [fbx()]);
    const ids = Object.values(ctx.ui.get().importSheet!.payload.nodes).filter((n) => n.mesh).map((n) => n.mesh!.id);
    expect(ids).toHaveLength(2);
    expect(ids.every(hasMesh)).toBe(true);
    cancelImport(ctx);
    expect(ctx.ui.get().importSheet).toBeNull();
    expect(ctx.ui.get().importMessage).toBeNull();
    expect(ctx.store.get().scene.roots).toEqual([]);
    expect(ids.some(hasMesh)).toBe(false);
    // Nothing to cancel is fine.
    expect(() => cancelImport(ctx)).not.toThrow();
  });

  it('frees the raw meshes the result does not use after Import', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, [fbx()]);
    const ids = Object.values(ctx.ui.get().importSheet!.payload.nodes).filter((n) => n.mesh).map((n) => n.mesh!.id);
    confirmImport(ctx);
    // cm and Y up: new meshes were made for both parts.
    expect(ids.some(hasMesh)).toBe(false);
    for (const p of partsUnder(ctx.store.get(), ctx.store.get().scene.roots)) expect(hasMesh(ctx.store.get().scene.nodes[p].mesh!.id)).toBe(true);
  });

  it('shows files dropped together one after the other', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, [fbx(), obj()]);
    expect(ctx.ui.get().importSheet).toMatchObject({ name: 'two-parts.fbx', queued: 1 });
    // A drop while the sheet is open waits too.
    await importFiles(ctx, [file('third.fbx', twoPartsFbx)]);
    expect(ctx.ui.get().importSheet!.queued).toBe(2);
    confirmImport(ctx);
    await until(() => ctx.ui.get().importSheet?.name === 'cube-two-groups.obj');
    expect(ctx.ui.get().importSheet!.queued).toBe(1);
    expect(ctx.store.get().scene.roots).toHaveLength(1);
    cancelImport(ctx);
    await until(() => ctx.ui.get().importSheet?.name === 'third.fbx');
    expect(ctx.ui.get().importSheet!.queued).toBe(0);
    cancelImport(ctx);
    expect(ctx.ui.get().importSheet).toBeNull();
  });

  it('a file whose parts are all hidden keeps the sheet open and says why', async () => {
    const ctx = makeCtx();
    await importFiles(ctx, [fbx()]);
    const sheet = ctx.ui.get().importSheet!;
    // Hide the whole model in the file.
    const model = sheet.payload.nodes[sheet.payload.roots[0]];
    model.visible = false;
    confirmImport(ctx);
    expect(ctx.ui.get().importSheet).not.toBeNull();
    expect(ctx.store.get().scene.roots).toEqual([]);
    expect(ctx.ui.get().toasts.some((x) => x.text === t('import.noParts', { name: 'two-parts.fbx' }))).toBe(true);
    // The file's meshes are still there for another try.
    const ids = Object.values(sheet.payload.nodes).filter((n) => n.mesh).map((n) => n.mesh!.id);
    expect(ids.every(hasMesh)).toBe(true);
    setImportOptions(ctx, { importHidden: true });
    confirmImport(ctx);
    expect(ctx.ui.get().importSheet).toBeNull();
    expect(allParts(ctx.store.get())).toHaveLength(2);
  });
});

describe('origin at the centre', () => {
  it('moves the model node to the centre of its bounds and gives the offset back to its children', () => {
    const raw = makePayload([
      { name: 'A', size: [10, 10, 10], at: [100, 0, 0] },
      { name: 'B', size: [10, 10, 10], at: [100, 0, 30], group: 'G' },
    ]);
    const out = centrePivot(raw);
    const root = out.nodes.m;
    close(root.transform.position, [100, 0, 15]);
    // Direct children (a part, a group) give the offset back; what is inside the group is relative to the group.
    close(out.nodes.p1.transform.position, [0, 0, -15]);
    close(out.nodes.g1.transform.position, [-100, 0, -15]);
    close(out.nodes.p2.transform.position, [100, 0, 30]);
    // The input is not touched, and the geometry stays where it was: world = model + group + part.
    close(raw.nodes.m.transform.position, [0, 0, 0]);
    close(out.nodes.p1.transform.position.map((v, i) => v + root.transform.position[i]), [100, 0, 0]);
    close([0, 1, 2].map((i) => root.transform.position[i] + out.nodes.g1.transform.position[i] + out.nodes.p2.transform.position[i]), [100, 0, 30]);
    // Centred once, centred for good.
    close(centrePivot(out).nodes.m.transform.position, [100, 0, 15]);
  });
});

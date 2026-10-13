// Where project files go and come from (phase U2): the File System Access service with a remembered file and its
// fallbacks, and the commands behind Open, Save, Save as…, New and dropping a file (no DOM: the services are stubs
// and the inline question is the interface state it sets).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasMesh, meshIds, registerMesh, retainMeshes } from '../src/core/meshes';
import { meshIdsInUse } from '../src/core/scene';
import { createInitialState, createStore, type ProjectState } from '../src/core/store';
import { createProjectFiles } from '../src/io/project-file';
import { PROJECT_FORMAT, readProjectFile, serializeProject } from '../src/io/project';
import * as cmd from '../src/ui/commands';
import type { AppServices, ProjectFilesPort, SaveResult } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { ACTIONS, actionById, kbdText, matches } from '../src/ui/shortcuts';
import { setLang, STRINGS } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { apply, exampleState } from './helpers';

// The program says why a file did not open or a dialog fell back on the console; these tests do not need to hear it.
beforeEach(() => void vi.spyOn(console, 'warn').mockImplementation(() => undefined));
afterEach(() => {
  vi.restoreAllMocks();
  setLang('en');
  retainMeshes(new Set());
});

// --- The File System Access service --------------------------------------------------------------------------

interface FakeHandle {
  kind: 'file';
  name: string;
  writes: string[];
  createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  getFile(): Promise<File>;
  queryPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
}

function handle(name: string, opts: { query?: PermissionState; request?: PermissionState; failWrite?: boolean; contents?: string } = {}): FakeHandle {
  const writes: string[] = [];
  return {
    kind: 'file',
    name,
    writes,
    async createWritable() {
      return {
        async write(b: Blob) {
          if (opts.failWrite) throw new Error('disk is full');
          writes.push(await b.text());
        },
        async close() {},
        async abort() {},
      };
    },
    getFile: async () => new File([opts.contents ?? '{}'], name),
    queryPermission: async () => opts.query ?? 'granted',
    requestPermission: async () => opts.request ?? 'granted',
  };
}

const abort = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
const blobOf = (text: string) => () => new Blob([text]);

describe('the project file service, in a browser with the File System Access API', () => {
  function setup(opts: { save?: (o: Record<string, unknown>) => Promise<FakeHandle>; open?: (o: Record<string, unknown>) => Promise<FakeHandle[]> } = {}) {
    const downloads: [string, string][] = [];
    const saved = handle('first.repack.json');
    const showSaveFilePicker = vi.fn(opts.save ?? (async () => saved));
    const showOpenFilePicker = vi.fn(opts.open ?? (async () => [handle('opened.repack.json', { contents: '{"x":1}' })]));
    const files = createProjectFiles({ showSaveFilePicker, showOpenFilePicker, isSecureContext: true }, (b, name) => void downloads.push([name, String(b.size)]), {
      description: () => 'Repackshot project',
    });
    return { files, showSaveFilePicker, showOpenFilePicker, saved, downloads };
  }

  it('asks once, then Save writes to the same file without asking; Save as… asks again', async () => {
    const { files, showSaveFilePicker, saved } = setup();
    expect(files.canSaveInPlace).toBe(true);
    expect(await files.save(blobOf('one'), 'Name.repack.json', { saveAs: false })).toEqual({ kind: 'SAVED', name: 'first.repack.json', inPlace: true });
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(showSaveFilePicker.mock.calls[0][0]).toMatchObject({
      suggestedName: 'Name.repack.json',
      types: [{ description: 'Repackshot project', accept: { 'application/json': ['.repack.json'] } }],
    });
    expect(await files.save(blobOf('two'), 'Name.repack.json', { saveAs: false })).toMatchObject({ kind: 'SAVED', inPlace: true });
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(saved.writes).toEqual(['one', 'two']);
    // Save as…: the dialog again, and the new file is the one Save writes to from then on.
    const other = handle('other.repack.json');
    showSaveFilePicker.mockResolvedValueOnce(other);
    expect(await files.save(blobOf('three'), 'Name.repack.json', { saveAs: true })).toMatchObject({ name: 'other.repack.json' });
    await files.save(blobOf('four'), 'Name.repack.json', { saveAs: false });
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
    expect(other.writes).toEqual(['three', 'four']);
    expect(saved.writes).toEqual(['one', 'two']);
  });

  it('builds the file only once the destination is known (the dialog can take a long time)', async () => {
    const order: string[] = [];
    const { files } = setup({ save: async () => (order.push('picker'), handle('x.repack.json')) });
    await files.save(() => (order.push('make'), new Blob(['x'])), 'x.repack.json', { saveAs: false });
    expect(order).toEqual(['picker', 'make']);
  });

  it('cancelling the dialog writes nothing and keeps the file it had', async () => {
    const { files, showSaveFilePicker, saved } = setup();
    await files.save(blobOf('one'), 'a.repack.json', { saveAs: false });
    showSaveFilePicker.mockRejectedValueOnce(abort());
    expect(await files.save(blobOf('x'), 'a.repack.json', { saveAs: true })).toEqual({ kind: 'CANCELLED' });
    await files.save(blobOf('two'), 'a.repack.json', { saveAs: false });
    expect(saved.writes).toEqual(['one', 'two']);
  });

  it('a file opened with the picker is the one Save writes to, once the project is open (adopt)', async () => {
    const opened = handle('opened.repack.json', { contents: '{"x":1}' });
    const { files, showSaveFilePicker } = setup({ open: async () => [opened] });
    const picked = await files.pick();
    expect(picked!.file.name).toBe('opened.repack.json');
    expect(await picked!.file.text()).toBe('{"x":1}');
    // Not the file of the project until the interface says the project opened.
    files.adopt(picked!.handle);
    expect(await files.save(blobOf('saved'), 'n.repack.json', { saveAs: false })).toMatchObject({ name: 'opened.repack.json', inPlace: true });
    expect(opened.writes).toEqual(['saved']);
    expect(showSaveFilePicker).not.toHaveBeenCalled();
    // New project: nothing to write to, so it asks.
    files.adopt(null);
    await files.save(blobOf('again'), 'n.repack.json', { saveAs: false });
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    // A dropped file that is not a file handle (a directory, a string) is not remembered.
    files.adopt({ kind: 'directory', name: 'd' });
    files.adopt('x');
    await files.save(blobOf('again'), 'n.repack.json', { saveAs: false });
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
  });

  it('asks where when the remembered file cannot be written (permission refused, file gone, disk error)', async () => {
    for (const [what, h] of [
      ['permission refused', handle('a.repack.json', { query: 'prompt', request: 'denied' })],
      ['write error', handle('b.repack.json', { failWrite: true })],
    ] as const) {
      const { files, showSaveFilePicker, saved } = setup();
      files.adopt(h);
      expect(await files.save(blobOf('x'), 'n.repack.json', { saveAs: false }), what).toMatchObject({ kind: 'SAVED', name: 'first.repack.json' });
      expect(showSaveFilePicker, what).toHaveBeenCalledTimes(1);
      expect(saved.writes, what).toEqual(['x']);
    }
    // Asked and granted: written in place.
    const { files, showSaveFilePicker } = setup();
    const h = handle('c.repack.json', { query: 'prompt', request: 'granted' });
    files.adopt(h);
    await files.save(blobOf('x'), 'n.repack.json', { saveAs: false });
    expect(h.writes).toEqual(['x']);
    expect(showSaveFilePicker).not.toHaveBeenCalled();
  });

  it('a mesh too big to embed is a failure to report, not a reason to forget the file or ask again', async () => {
    const { files, showSaveFilePicker } = setup();
    const h = handle('a.repack.json');
    files.adopt(h);
    const result = await files.save(
      () => {
        throw new Error('mesh m is too large to save in a project file');
      },
      'n.repack.json',
      { saveAs: false },
    );
    expect(result).toEqual({ kind: 'FAILED', reason: 'mesh m is too large to save in a project file' });
    expect(showSaveFilePicker).not.toHaveBeenCalled();
    expect(await files.save(blobOf('ok'), 'n.repack.json', { saveAs: false })).toMatchObject({ kind: 'SAVED', name: 'a.repack.json' });
  });

  it('a write error after choosing the file is reported', async () => {
    const { files } = setup({ save: async () => handle('bad.repack.json', { failWrite: true }) });
    expect(await files.save(blobOf('x'), 'n.repack.json', { saveAs: false })).toEqual({ kind: 'FAILED', reason: 'disk is full' });
  });

  it('a browser that refuses the file types gets the same dialog without them', async () => {
    const { files, showSaveFilePicker, showOpenFilePicker } = setup({
      save: vi.fn(async (o) => {
        if (o.types) throw new TypeError('Invalid extension');
        return handle('ok.repack.json');
      }),
      open: vi.fn(async (o) => {
        if (o.types) throw new TypeError('Invalid extension');
        return [handle('ok.repack.json')];
      }),
    });
    expect(await files.save(blobOf('x'), 'n.repack.json', { saveAs: false })).toMatchObject({ kind: 'SAVED', name: 'ok.repack.json' });
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
    expect((await files.pick())!.file.name).toBe('ok.repack.json');
    expect(showOpenFilePicker).toHaveBeenCalledTimes(2);
  });

  it('a dialog that cannot be shown downloads the file instead of losing it', async () => {
    const { files, downloads } = setup({ save: async () => Promise.reject(Object.assign(new Error('needs a user gesture'), { name: 'SecurityError' })) });
    expect(await files.save(blobOf('12345'), 'n.repack.json', { saveAs: false })).toEqual({ kind: 'SAVED', name: 'n.repack.json', inPlace: false });
    expect(downloads).toEqual([['n.repack.json', '5']]);
  });

  it('the Open dialog: cancelled gives nothing; broken falls back to the input', async () => {
    const cancelled = createProjectFiles({ showOpenFilePicker: async () => Promise.reject(abort()), showSaveFilePicker: async () => handle('x') }, () => {});
    expect(await cancelled.pick()).toBeNull();
    const none = createProjectFiles({ showOpenFilePicker: async () => [], showSaveFilePicker: async () => handle('x') }, () => {});
    expect(await none.pick()).toBeNull();
    const broken = createProjectFiles(
      { showOpenFilePicker: async () => Promise.reject(new Error('boom')), showSaveFilePicker: async () => handle('x') },
      () => {},
      { chooseWithInput: async () => new File(['{}'], 'from-input.repack.json') },
    );
    expect(await broken.pick()).toMatchObject({ file: { name: 'from-input.repack.json' }, handle: null });
  });
});

describe('the project file service, in a browser without it', () => {
  it('downloads under the project’s name and opens through the input', async () => {
    const downloads: [string, string][] = [];
    const files = createProjectFiles({}, (b, name) => void downloads.push([name, String(b.size)]), { chooseWithInput: async () => new File(['{"a":1}'], 'p.repack.json') });
    expect(files.canSaveInPlace).toBe(false);
    for (const saveAs of [false, true]) {
      expect(await files.save(blobOf('abc'), 'My-project.repack.json', { saveAs })).toEqual({ kind: 'SAVED', name: 'My-project.repack.json', inPlace: false });
    }
    expect(downloads).toEqual([['My-project.repack.json', '3'], ['My-project.repack.json', '3']]);
    const picked = await files.pick();
    expect(picked).toMatchObject({ handle: null });
    expect(await picked!.file.text()).toBe('{"a":1}');
    files.adopt({ kind: 'file', name: 'x', createWritable: async () => ({}) }); // nothing to write to in place
    await files.save(blobOf('abc'), 'again.repack.json', { saveAs: false });
    expect(downloads).toHaveLength(3);
    // The input dialog dismissed.
    expect(await createProjectFiles({}, () => {}, { chooseWithInput: async () => null }).pick()).toBeNull();
  });

  it('an insecure page has no picker either (the API only exists in secure contexts)', () => {
    const files = createProjectFiles({ showSaveFilePicker: async () => handle('x'), showOpenFilePicker: async () => [], isSecureContext: false }, () => {});
    expect(files.canSaveInPlace).toBe(false);
  });

  it('a mesh too big to embed is reported when downloading too', async () => {
    const files = createProjectFiles({}, () => {});
    const result = await files.save(
      () => {
        throw new Error('too big');
      },
      'n.repack.json',
      { saveAs: false },
    );
    expect(result).toEqual({ kind: 'FAILED', reason: 'too big' });
  });
});

// --- The commands ---------------------------------------------------------------------------------------------

interface Stubs {
  saves: { name: string; saveAs: boolean; text: string }[];
  adopted: unknown[];
  imported: string[];
  next: SaveResult | null;
  /** Runs while the file is being written (the person kept working). */
  during: (() => void) | null;
  picked: { file: File; handle: unknown } | null;
}

function makeCtx(state: ProjectState = createInitialState()): { ctx: Ctx; stubs: Stubs } {
  const stubs: Stubs = { saves: [], adopted: [], imported: [], next: null, during: null, picked: null };
  const projectFiles: ProjectFilesPort = {
    canSaveInPlace: true,
    async save(make, name, { saveAs }) {
      const blob = make();
      stubs.saves.push({ name, saveAs, text: await blob.text() });
      stubs.during?.();
      return stubs.next ?? { kind: 'SAVED', name, inPlace: true };
    },
    pick: async () => stubs.picked,
    adopt: (h) => void stubs.adopted.push(h),
  };
  const services = {
    viewport: null,
    project: { serialize: serializeProject, open: readProjectFile },
    projectFiles,
    importFile: async (file: File) => {
      stubs.imported.push(file.name);
      throw new Error('stub');
    },
  } as unknown as AppServices;
  return { ctx: { store: createStore(state), ui: createUiStore(), services }, stubs };
}

const fileOf = (text: string, name = 'saved.repack.json') => new File([text], name);
const toasts = (ctx: Ctx) => ctx.ui.get().toasts.map((t) => t.text);
const edit = (ctx: Ctx, ev = 1) => ctx.store.dispatch({ type: 'image/set', patch: { exposureEv: ev }, label: 'Exposure' });

/** A project file made from the example, with a name. */
async function exampleFile(name = 'Bottle'): Promise<{ text: string; state: ProjectState }> {
  const state = apply(exampleState(), { type: 'meta/rename', name });
  return { text: await serializeProject(state).text(), state };
}

describe('Save and Save as…', () => {
  it('writes the project and clears the dot; the name is the project’s', async () => {
    const { ctx, stubs } = makeCtx(exampleState());
    ctx.store.dispatch({ type: 'meta/rename', name: 'Bottle “A” été' });
    expect(ctx.store.get().meta.dirty).toBe(true);
    expect(await cmd.saveProject(ctx)).toBe(true);
    expect(ctx.store.get().meta.dirty).toBe(false);
    expect(stubs.saves).toHaveLength(1);
    expect(stubs.saves[0]).toMatchObject({ name: 'bottle-a-ete.repack.json', saveAs: false });
    expect(JSON.parse(stubs.saves[0].text)).toMatchObject({ format: PROJECT_FORMAT, state: { meta: { name: 'Bottle “A” été' } } });
    expect(toasts(ctx)).toEqual(['Saved bottle-a-ete.repack.json']);
    // Saving is not an undoable change: the history holds the rename and nothing else.
    expect(ctx.store.history().undo).toHaveLength(1);
  });

  it('Save as… passes the flag; an untitled project is saved as untitled', async () => {
    const { ctx, stubs } = makeCtx();
    await cmd.saveProject(ctx, { saveAs: true });
    expect(stubs.saves[0]).toMatchObject({ name: 'untitled.repack.json', saveAs: true });
  });

  it('a cancelled dialog changes nothing; a failed write says why and keeps the dot', async () => {
    const { ctx, stubs } = makeCtx();
    edit(ctx);
    stubs.next = { kind: 'CANCELLED' };
    expect(await cmd.saveProject(ctx)).toBe(false);
    expect(ctx.store.get().meta.dirty).toBe(true);
    expect(toasts(ctx)).toEqual([]);
    stubs.next = { kind: 'FAILED', reason: 'disk is full' };
    expect(await cmd.saveProject(ctx)).toBe(false);
    expect(ctx.store.get().meta.dirty).toBe(true);
    expect(toasts(ctx)).toEqual(['Could not save untitled.repack.json: disk is full']);
  });

  it('a service that throws is a failed save, not an unhandled error', async () => {
    const { ctx } = makeCtx();
    edit(ctx);
    ctx.services.projectFiles.save = async () => Promise.reject(new Error('nope'));
    expect(await cmd.saveProject(ctx)).toBe(false);
    expect(toasts(ctx)).toEqual(['Could not save untitled.repack.json: nope']);
  });

  it('changes made while the file was being written stay unsaved', async () => {
    const { ctx, stubs } = makeCtx();
    edit(ctx, 1);
    stubs.during = () => edit(ctx, 2);
    expect(await cmd.saveProject(ctx)).toBe(true);
    expect(ctx.store.get().meta.dirty).toBe(true);
    expect(JSON.parse(stubs.saves[0].text).state.image.exposureEv).toBe(1);
  });
});

describe('Open', () => {
  it('replaces the project (a clean one): the state, an empty history, no dot, the file kept for Save', async () => {
    const { text, state } = await exampleFile();
    const { ctx, stubs } = makeCtx();
    ctx.store.dispatch({ type: 'meta/theme', theme: 'light' });
    ctx.ui.set({ catalogOpen: true, hover: 'n1', importMessage: 'x' });
    const handle = { kind: 'file', name: 'saved.repack.json' };
    await cmd.openProjectFile(ctx, fileOf(text), Promise.resolve(handle));
    await Promise.resolve();
    const s = ctx.store.get();
    expect(s).toEqual({ ...state, meta: { ...state.meta, dirty: false, theme: 'light' } });
    expect(ctx.store.history()).toEqual({ undo: [], redo: [] });
    expect(ctx.ui.get()).toMatchObject({ prompt: null, catalogOpen: false, hover: null, importMessage: null });
    expect(toasts(ctx)).toEqual(['Opened saved.repack.json']);
    expect(stubs.adopted).toEqual([handle]);
    // Undo cannot go back before the opening.
    ctx.store.undo();
    expect(ctx.store.get()).toBe(s);
  });

  it('keeps the language and theme of the person, not of the file', async () => {
    const { text } = await exampleFile();
    const { ctx } = makeCtx({ ...createInitialState(), meta: { ...createInitialState().meta, lang: 'es', theme: 'dark' } });
    await cmd.openProjectFile(ctx, fileOf(text));
    expect(ctx.store.get().meta).toMatchObject({ name: 'Bottle', lang: 'es', theme: 'dark' });
  });

  it('with unsaved changes it asks first (in place), and nothing moves until the person answers', async () => {
    const { text } = await exampleFile();
    const { ctx, stubs } = makeCtx();
    edit(ctx);
    const before = ctx.store.get();
    await cmd.openProjectFile(ctx, fileOf(text));
    const prompt = ctx.ui.get().prompt!;
    expect(prompt.message).toBe('Save changes to “Untitled” before opening saved.repack.json?');
    expect(prompt.options.map((o) => o.label)).toEqual(['Save', 'Don’t save']);
    expect(ctx.store.get()).toBe(before);
    expect(stubs.saves).toEqual([]);

    // Don't save: opens.
    prompt.options[1].run();
    expect(ctx.store.get().meta.name).toBe('Bottle');
    expect(stubs.saves).toEqual([]);
  });

  it('Save first writes the old project, then opens; if the save is cancelled it stays', async () => {
    const { text } = await exampleFile();
    const { ctx, stubs } = makeCtx();
    edit(ctx);
    await cmd.openProjectFile(ctx, fileOf(text));
    stubs.next = { kind: 'CANCELLED' };
    ctx.ui.get().prompt!.options[0].run();
    await new Promise((r) => setTimeout(r));
    expect(ctx.store.get().meta.name).toBe('');
    expect(ctx.store.get().meta.dirty).toBe(true);

    await cmd.openProjectFile(ctx, fileOf(text));
    stubs.next = null;
    ctx.ui.get().prompt!.options[0].run();
    await new Promise((r) => setTimeout(r));
    expect(stubs.saves.map((s) => JSON.parse(s.text).state.meta.name)).toEqual(['', '']);
    expect(ctx.store.get().meta).toMatchObject({ name: 'Bottle', dirty: false });
  });

  it('Esc (the prompt is dismissed) leaves everything as it was', async () => {
    const { text } = await exampleFile();
    const { ctx } = makeCtx();
    edit(ctx);
    const before = ctx.store.get();
    await cmd.openProjectFile(ctx, fileOf(text));
    ctx.ui.set({ prompt: null });
    expect(ctx.store.get()).toBe(before);
  });

  it('a file that is not a project, is from a newer version or is damaged says so in the language of the person and touches nothing', async () => {
    const { text } = await exampleFile();
    const bad: [string, string, RegExp, RegExp][] = [
      ['an OBJ', 'v 0 0 0\nf 1 1 1\n', /is not a Repackshot project/, /no es un proyecto de Repackshot/],
      ['a newer version', JSON.stringify({ format: PROJECT_FORMAT, schema: 99, state: {} }), /newer version of Repackshot \(project format 99\)/, /versión más nueva de Repackshot \(formato de proyecto 99\)/],
      ['cut short', text.slice(0, 3000), /is damaged and could not be opened\./, /está dañado y no se pudo abrir/],
      ['damaged state', JSON.stringify({ format: PROJECT_FORMAT, schema: 2, state: { scene: { nodes: 5 } } }), /damaged/, /dañado/],
    ];
    for (const lang of ['en', 'es'] as const) {
      for (const [what, src, en, es] of bad) {
        setLang(lang);
        const { ctx, stubs } = makeCtx(exampleState());
        edit(ctx);
        const before = ctx.store.get();
        const ids = meshIds().sort();
        await cmd.openProjectFile(ctx, fileOf(src, `${what}.repack.json`));
        expect(toasts(ctx), `${lang}: ${what}`).toHaveLength(1);
        expect(toasts(ctx)[0], `${lang}: ${what}`).toMatch(lang === 'en' ? en : es);
        expect(toasts(ctx)[0]).toContain(`${what}.repack.json`);
        expect(ctx.store.get(), what).toBe(before);
        expect(ctx.ui.get().prompt, what).toBeNull();
        expect(ctx.ui.get().importMessage, what).toBeNull();
        expect(stubs.adopted, what).toEqual([]);
        expect(meshIds().sort(), what).toEqual(ids);
      }
    }
  });

  it('a reader that throws is a damaged file, not an unhandled error', async () => {
    const { ctx } = makeCtx();
    ctx.services.project.open = async () => Promise.reject(new Error('worker died'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await cmd.openProjectFile(ctx, fileOf('{}'));
      // The sentence is in the person's language; the technical reason goes to the console.
      expect(toasts(ctx)).toEqual(['saved.repack.json is damaged and could not be opened. The current project was not touched.']);
      expect(warn).toHaveBeenCalledWith('project saved.repack.json: worker died');
    } finally {
      warn.mockRestore();
    }
    expect(ctx.ui.get().importMessage).toBeNull();
  });

  it('releases the old project’s geometry and keeps the new one’s', async () => {
    const { text } = await exampleFile();
    const old = exampleState();
    const { ctx } = makeCtx(old);
    // The stray mesh stands for the geometry of a project that is gone.
    registerMesh('stray:mesh', { positions: new Float32Array(9), normals: new Float32Array(9), indices: Uint32Array.of(0, 1, 2) });
    expect(hasMesh('stray:mesh')).toBe(true);
    await cmd.openProjectFile(ctx, fileOf(text));
    expect(hasMesh('stray:mesh')).toBe(false);
    for (const id of meshIdsInUse(ctx.store.get())) expect(hasMesh(id), id).toBe(true);
    expect(meshIds().sort()).toEqual([...meshIdsInUse(ctx.store.get())].sort());
  });

  it('the Open command asks the dialog, and does nothing when the person cancels', async () => {
    const { text } = await exampleFile();
    const { ctx, stubs } = makeCtx();
    await cmd.openProject(ctx);
    expect(ctx.store.get().meta.name).toBe('');
    stubs.picked = { file: fileOf(text), handle: null };
    await cmd.openProject(ctx);
    expect(ctx.store.get().meta.name).toBe('Bottle');
    expect(stubs.adopted).toEqual([null]);
  });

  it('a missing geometry is reported', async () => {
    const { state } = await exampleFile();
    const raw = JSON.parse(await serializeProject(state).text());
    const byKey = (key: string) => Object.values(raw.state.scene.nodes as Record<string, { key?: string; mesh: { id: string } }>).find((n) => n.key === key)!;
    byKey('base').mesh.id = 'gone:1';
    byKey('cap').mesh.id = 'gone:2';
    const { ctx } = makeCtx();
    await cmd.openProjectFile(ctx, fileOf(JSON.stringify(raw)));
    expect(toasts(ctx)).toEqual(['Opened saved.repack.json', 'The file has no geometry for 2 part(s); they stay in the scene without it']);
  });
});

describe('New', () => {
  it('starts a fresh project at once when nothing is unsaved, and forgets the file', () => {
    const { ctx, stubs } = makeCtx(exampleState());
    // exampleState() is built with the reducer: clean.
    cmd.requestNewProject(ctx);
    expect(ctx.ui.get().prompt).toBeNull();
    expect(ctx.store.get().scene.roots).toEqual([]);
    expect(stubs.adopted).toEqual([null]);
  });

  it('asks when there are unsaved changes: Save, Don’t save, or Esc', async () => {
    const { ctx, stubs } = makeCtx(exampleState());
    ctx.store.dispatch({ type: 'meta/rename', name: 'Bottle' });
    cmd.requestNewProject(ctx);
    const prompt = ctx.ui.get().prompt!;
    expect(prompt.message).toBe('Save changes to “Bottle” before starting a new project?');
    expect(ctx.store.get().scene.roots).toHaveLength(1);
    ctx.ui.set({ prompt: null }); // Esc
    expect(ctx.store.get().scene.roots).toHaveLength(1);

    cmd.requestNewProject(ctx);
    ctx.ui.get().prompt!.options[0].run(); // Save
    await new Promise((r) => setTimeout(r));
    expect(stubs.saves).toHaveLength(1);
    expect(ctx.store.get().scene.roots).toEqual([]);
    expect(ctx.store.get().meta.name).toBe('');

    // Don't save.
    ctx.store.dispatch({ type: 'meta/rename', name: 'Other' });
    cmd.requestNewProject(ctx);
    ctx.ui.get().prompt!.options[1].run();
    expect(stubs.saves).toHaveLength(1);
    expect(ctx.store.get().meta.name).toBe('');
  });

  it('the questions exist in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      setLang(lang);
      const { ctx } = makeCtx();
      edit(ctx);
      cmd.requestNewProject(ctx);
      const p = ctx.ui.get().prompt!;
      expect(p.message.length).toBeGreaterThan(10);
      expect(p.options.map((o) => o.label)).toEqual(lang === 'en' ? ['Save', 'Don’t save'] : ['Guardar', 'No guardar']);
    }
  });
});

describe('dropping files on the window', () => {
  it('a project is opened and never goes to the importers', async () => {
    const { text } = await exampleFile();
    const { ctx, stubs } = makeCtx();
    cmd.dropFiles(ctx, [fileOf(text)]);
    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.store.get().meta.name).toBe('Bottle');
    expect(stubs.imported).toEqual([]);
  });

  it('with models in the same drop only the project is opened, and the person is told', async () => {
    const { text } = await exampleFile();
    const { ctx, stubs } = makeCtx();
    cmd.dropFiles(ctx, [fileOf('v 0 0 0', 'a.obj'), fileOf(text), fileOf('solid x', 'b.stl')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.store.get().meta.name).toBe('Bottle');
    expect(stubs.imported).toEqual([]);
    expect(toasts(ctx)).toContain('A project was opened; the other dropped files were ignored');
  });

  it('models go to the import sheet as before', async () => {
    const { ctx, stubs } = makeCtx();
    cmd.dropFiles(ctx, [fileOf('v 0 0 0', 'a.obj')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(stubs.imported).toEqual(['a.obj']);
  });

  it('the Import dialog and every other way into importFiles route a project to Open too', async () => {
    const { text } = await exampleFile();
    const { ctx, stubs } = makeCtx();
    await cmd.importFiles(ctx, [fileOf(text, 'Mine.REPACK.JSON')]);
    expect(ctx.store.get().meta.name).toBe('Bottle');
    expect(stubs.imported).toEqual([]);
  });

  it('knows a project by its double extension, not by .json alone', () => {
    expect(cmd.isProjectFile({ name: 'a.repack.json' })).toBe(true);
    expect(cmd.isProjectFile({ name: 'A B.REPACK.JSON' })).toBe(true);
    expect(cmd.isProjectFile({ name: 'a.json' })).toBe(false);
    expect(cmd.isProjectFile({ name: 'repack.json' })).toBe(false);
    expect(cmd.isProjectFile({ name: 'a.repack' })).toBe(false);
    expect(cmd.isProjectFile({ name: 'a.gltf' })).toBe(false);
  });

  it('reads a drop: the files and, in Chromium, their handles', async () => {
    const f = fileOf('x');
    const withHandle = { kind: 'file' as const, getAsFile: () => f, getAsFileSystemHandle: async () => ({ kind: 'file', name: 'x' }) };
    const plain = { kind: 'file' as const, getAsFile: () => fileOf('y', 'y.obj') };
    const text = { kind: 'string' as const, getAsFile: () => null };
    const read = cmd.readDrop({ items: [withHandle, plain, text], files: [] } as unknown as DataTransfer);
    expect(read.files.map((x) => x.name)).toEqual(['saved.repack.json', 'y.obj']);
    expect(await Promise.all(read.handles)).toEqual([{ kind: 'file', name: 'x' }, null]);
    // A browser that lists only `files`.
    const only = cmd.readDrop({ items: [], files: [fileOf('z', 'z.stl')] } as unknown as DataTransfer);
    expect(only.files.map((x) => x.name)).toEqual(['z.stl']);
    expect(cmd.readDrop(null)).toEqual({ files: [], handles: [] });
  });
});

describe('the keyboard', () => {
  const press = (key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) =>
    ({ key, code: `Key${key.toUpperCase()}`, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: false }) as KeyboardEvent;

  it('Ctrl/⌘ O opens, Ctrl/⌘ S saves, Ctrl/⌘ ⇧ S saves as…', async () => {
    const ids: [string, KeyboardEvent, KeyboardEvent][] = [
      ['open', press('o', { ctrl: true }), press('o', { meta: true })],
      ['save', press('s', { ctrl: true }), press('s', { meta: true })],
      ['saveAs', press('s', { ctrl: true, shift: true }), press('s', { meta: true, shift: true })],
    ];
    for (const [id, ctrl, meta] of ids) {
      const action = actionById(id)!;
      expect(matches(ctrl, action.keys!), id).toBe(true);
      expect(matches(meta, action.keys!), id).toBe(true);
      expect(action.global, `${id} works while typing in a field`).toBe(true);
    }
    // Each key combination belongs to one action only (Save is not also Save as…).
    expect(ACTIONS.filter((a) => matches(press('s', { ctrl: true }), a.keys ?? '')).map((a) => a.id)).toEqual(['save']);
    expect(ACTIONS.filter((a) => matches(press('s', { ctrl: true, shift: true }), a.keys ?? '')).map((a) => a.id)).toEqual(['saveAs']);
    expect(ACTIONS.filter((a) => matches(press('o', { ctrl: true }), a.keys ?? '')).map((a) => a.id)).toEqual(['open']);
    const all = ACTIONS.flatMap((a) => [a.keys, ...(a.altKeys ?? [])]).filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
    expect(kbdText('mod+shift+s')).toMatch(/^(Ctrl|⌘) ⇧ S$/);

    // And they do what the menu does.
    const { ctx, stubs } = makeCtx();
    await actionById('save')!.run(ctx);
    await actionById('saveAs')!.run(ctx);
    await actionById('open')!.run(ctx);
    await new Promise((r) => setTimeout(r));
    expect(stubs.saves.map((x) => x.saveAs)).toEqual([false, true]);
  });

  it('the actions and the menu entries have their words in both languages', () => {
    for (const key of ['action.open', 'action.save', 'action.saveAs', 'menu.openProject', 'menu.save', 'menu.saveAs'] as const) {
      expect(STRINGS.en[key], key).toBeTruthy();
      expect(STRINGS.es[key], key).toBeTruthy();
    }
    for (const id of ['open', 'save', 'saveAs']) expect(actionById(id)!.palette, `${id} is in the palette`).not.toBe(false);
  });
});

// --- General ▸ On start ▸ Last project (U6) ------------------------------------------------------------------------

describe('Last project', () => {
  function remembering() {
    const kept: { value: unknown } = { value: null };
    const remember = { put: vi.fn(async (h: unknown) => void (kept.value = h)), get: async () => kept.value };
    return { kept, remember };
  }

  it('remembers the file a project was saved to or opened from, not a new project', async () => {
    const { kept, remember } = remembering();
    const saved = handle('saved.repack.json');
    const files = createProjectFiles({ showSaveFilePicker: async () => saved, showOpenFilePicker: async () => [], isSecureContext: true }, () => undefined, { remember });
    expect(await files.last()).toBeNull();
    await files.save(blobOf('x'), 'a.repack.json', { saveAs: true });
    await Promise.resolve();
    expect(kept.value).toBe(saved);
    expect(await files.last()).toEqual({ name: 'saved.repack.json', handle: saved });
    const opened = handle('opened.repack.json');
    files.adopt(opened);
    await Promise.resolve();
    expect((await files.last())?.name).toBe('opened.repack.json');
    // New (adopt(null)) leaves the last file remembered.
    files.adopt(null);
    await Promise.resolve();
    expect((await files.last())?.name).toBe('opened.repack.json');
    // Without a place to keep it, nothing is offered.
    expect(await createProjectFiles({}, () => undefined).last()).toBeNull();
  });

  it('reads the file again only with the permission to read it', async () => {
    const files = createProjectFiles({ showSaveFilePicker: async () => handle('x'), showOpenFilePicker: async () => [], isSecureContext: true }, () => undefined);
    expect(await (await files.reopen(handle('a.repack.json', { contents: 'A' })))?.text()).toBe('A');
    const asked = handle('b.repack.json', { query: 'prompt', request: 'granted', contents: 'B' });
    const request = vi.spyOn(asked, 'requestPermission');
    expect(await (await files.reopen(asked))?.text()).toBe('B');
    expect(request).toHaveBeenCalledWith({ mode: 'read' });
    expect(await files.reopen(handle('c.repack.json', { query: 'prompt', request: 'denied' }))).toBeNull();
    const moved = { ...handle('d.repack.json'), getFile: async () => Promise.reject(new Error('NotFoundError')) };
    expect(await files.reopen(moved)).toBeNull();
    expect(await files.reopen({ name: 'not a handle' })).toBeNull();
  });

  it('offers it in the header; Open reads it and opens the project, a file that cannot be read says so', async () => {
    const { ctx, stubs } = makeCtx();
    expect(await cmd.offerLastProject(ctx)).toBe(false);
    const { text } = await exampleFile('Lamp');
    const h = { name: 'lamp.repack.json' };
    let readable = true;
    Object.assign(ctx.services.projectFiles, { last: async () => ({ name: 'lamp.repack.json', handle: h }), reopen: async () => (readable ? fileOf(text, 'lamp.repack.json') : null) });
    expect(await cmd.offerLastProject(ctx)).toBe(true);
    const prompt = ctx.ui.get().prompt!;
    expect(prompt.message).toBe('Open the last project, “lamp.repack.json”?');
    expect(prompt.cancelLabel).toBe('Not now');
    prompt.options[0].run();
    await vi.waitFor(() => expect(ctx.store.get().meta.name).toBe('Lamp'));
    await vi.waitFor(() => expect(stubs.adopted.at(-1)).toBe(h));
    readable = false;
    await cmd.offerLastProject(ctx);
    ctx.ui.get().prompt!.options[0].run();
    await vi.waitFor(() => expect(toasts(ctx).some((x) => x.startsWith('Could not open “lamp.repack.json”'))).toBe(true));
  });
});

// Files on the desktop (phase P3b, io/desktop-files.ts) against a stand-in for the launcher's dialogs and file API:
// render outputs into a chosen folder (and Downloads when it is gone), a folder of an earlier launch confirmed again,
// projects saved in place and opened, Last project, imports read in ranges and hashed by the launcher.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getImage, retainImages } from '../src/core/images';
import { createInitialState } from '../src/core/store';
import { loadBackplate, loadHdri, type PixelDecoder } from '../src/io/hdri';
import { readProjectFile, serializeProject } from '../src/io/project';
import { createDesktopDialogs, createDesktopFiles, createDesktopProjectFiles, hashNativeFile, NativeFile, whenReady, type DesktopApi } from '../src/io/desktop-files';
import { NativeError, NativeClient, type DialogResult, type NativeGrant, type NativeInfo } from '../src/io/native';

interface Disk {
  files: Map<string, Uint8Array>;
  grants: Map<string, NativeGrant>;
  answers: (DialogResult | Error)[];
  calls: string[];
  ranges: string[];
}

const grant = (id: string, path: string, folder = false, write = true): NativeGrant => ({ id, name: path.split('/').pop()!, path, folder, read: !folder, write, size: null });

function fakeLauncher(): { api: DesktopApi; disk: Disk } {
  const disk: Disk = { files: new Map(), grants: new Map([['downloads', grant('downloads', '/home/a/Downloads', true)]]), answers: [], calls: [], ranges: [] };
  const answer = (kind: string, opts: unknown): DialogResult => {
    disk.calls.push(`${kind} ${JSON.stringify(opts)}`);
    const a = disk.answers.shift();
    if (!a) throw new Error('no answer prepared');
    if (a instanceof Error) throw a;
    if (!a.cancelled) for (const g of a.files) disk.grants.set(g.id, g);
    return a;
  };
  const need = (id: string) => {
    const g = disk.grants.get(id);
    if (!g) throw new NativeError(404, 'not-granted', 'no such file');
    return g;
  };
  const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
  const api: DesktopApi = {
    dialogFolder: async (o) => answer('folder', o),
    dialogOpen: async (o) => answer('open', o),
    dialogSave: async (o) => answer('save', o),
    async writeNew(dir, name, body) {
      const g = need(dir);
      let k = 1;
      const named = (n: number) => (n === 1 ? name : name.replace(/(\.[^.]+)$/, ` (${n})$1`));
      while (disk.files.has(`${g.path}/${named(k)}`)) k++;
      const path = `${g.path}/${named(k)}`;
      disk.files.set(path, await bytes(body));
      disk.calls.push(`writeNew ${dir} ${named(k)}`);
      const f = { ...grant(`f:${path}`, path, false, false), read: false };
      disk.grants.set(f.id, f);
      return f;
    },
    async writeFile(id, body) {
      const g = need(id);
      if (!g.write) throw new NativeError(403, 'forbidden', 'read only');
      disk.files.set(g.path, await bytes(body));
      disk.calls.push(`writeFile ${id}`);
      return g;
    },
    async readFile(id, range) {
      const g = need(id);
      const all = disk.files.get(g.path) ?? new Uint8Array();
      if (range) disk.ranges.push(`${range[0]}-${range[1]}`);
      const body = range ? all.slice(range[0], range[1] + 1) : all.slice();
      return new Response(body, { status: range ? 206 : 200 });
    },
    async fileInfo(id) {
      return { ...need(id), hashing: { done: 5, total: 10 } };
    },
    async hashFile(id) {
      need(id);
      await new Promise((r) => setTimeout(r, 30));
      return { sha256: 'ab'.repeat(32), bytes: 10 };
    },
    async listFolder(id) {
      const g = need(id);
      const files = [...disk.files.keys()].filter((p) => p.startsWith(`${g.path}/`)).map((p) => ({ id: `f:${p}`, name: p.split('/').pop()!, rel: p.slice(g.path.length + 1), size: disk.files.get(p)!.length }));
      for (const f of files) disk.grants.set(f.id, grant(f.id, `${g.path}/${f.rel}`, false, false));
      return { files };
    },
    async reveal(id) {
      need(id);
      disk.calls.push(`reveal ${id}`);
    },
    async lastProject() {
      const id = disk.calls.filter((c) => c.startsWith('last ')).pop()?.slice(5);
      return id ? need(id) : null;
    },
    async setLastProject(id) {
      disk.calls.push(`last ${id}`);
    },
    async openUrl(url) {
      disk.calls.push(`url ${url}`);
    },
  };
  return { api, disk };
}

const chosen = (...files: NativeGrant[]): DialogResult => ({ cancelled: false, file: files[0], files });
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('render outputs on the desktop', () => {
  const opts = (mem = memory()) => ({ folderTitle: () => 'Choose the output folder', confirmTitle: () => 'Choose it again', folderItem: () => 'Folder selection', memory: mem });

  it('go into the chosen folder as new files, shown by its path', async () => {
    const { api, disk } = fakeLauncher();
    const files = createDesktopFiles(api, opts());
    expect(files.canChooseFolder && files.canOpenFolder && files.desktop).toBe(true);
    disk.answers.push(chosen(grant('d1', '/renders', true)));
    const f = await files.chooseFolder();
    expect(f).toEqual({ id: 'd1', name: '/renders' });
    expect(await files.ensureAccess('d1')).toBe(true);
    expect(await files.save({ kind: 'FOLDER', id: 'd1', name: '/renders' }, 'a.png', new Blob(['1']))).toBe('FOLDER');
    expect(await files.save({ kind: 'FOLDER', id: 'd1', name: '/renders' }, 'a.png', new Blob(['2']))).toBe('FOLDER');
    expect([...disk.files.keys()]).toEqual(['/renders/a.png', '/renders/a (2).png']);
    // Open folder selects the file that was written.
    await files.openFolder('d1', 'a.png');
    expect(disk.calls.at(-1)).toBe('reveal f:/renders/a (2).png');
    await files.openFolder('d1');
    expect(disk.calls.at(-1)).toBe('reveal d1');
    // Downloads is the system's folder, written by the launcher (never the browser's download bubble).
    expect(await files.save({ kind: 'DOWNLOADS' }, 'b.png', new Blob(['3']))).toBe('DOWNLOAD');
    expect(disk.files.has('/home/a/Downloads/b.png')).toBe(true);
    // Cancelled.
    disk.answers.push({ cancelled: true });
    expect(await files.chooseFolder()).toBeNull();
  });

  it('a folder of an earlier launch is confirmed again, where it was; refused, the images go to Downloads', async () => {
    const mem = memory();
    const first = fakeLauncher();
    first.disk.answers.push(chosen(grant('d-old', '/renders', true)));
    await createDesktopFiles(first.api, opts(mem)).chooseFolder();
    // The next launch: the launcher no longer knows d-old.
    const { api, disk } = fakeLauncher();
    const files = createDesktopFiles(api, opts(mem));
    disk.answers.push({ cancelled: true });
    expect(await files.ensureAccess('d-old')).toBe(false);
    expect(disk.calls[0]).toContain('"start":"/renders"');
    expect(await files.save({ kind: 'FOLDER', id: 'd-old', name: '/renders' }, 'x.png', new Blob(['x']))).toBe('DOWNLOAD');
    expect(disk.files.has('/home/a/Downloads/x.png')).toBe(true);
    // Confirmed: the old id writes into the folder chosen now.
    disk.answers.push(chosen(grant('d-new', '/renders', true)));
    expect(await files.ensureAccess('d-old')).toBe(true);
    expect(await files.save({ kind: 'FOLDER', id: 'd-old', name: '/renders' }, 'x.png', new Blob(['y']))).toBe('FOLDER');
    expect(disk.calls).toContain('writeNew d-new x.png');
  });

  it('a dialog that cannot open says why', async () => {
    const { api, disk } = fakeLauncher();
    const errors: string[] = [];
    const files = createDesktopFiles(api, { ...opts(), onDialogError: (c) => errors.push(c) });
    disk.answers.push(new NativeError(501, 'no-dialog', 'install zenity'));
    expect(await files.chooseFolder()).toBeNull();
    expect(errors).toEqual(['no-dialog']);
  });
});

describe('project files on the desktop', () => {
  const opts = { description: () => 'Repackshot project', openTitle: () => 'Open project', saveTitle: () => 'Save project', allFiles: () => 'All files' };

  it('Save asks once, then writes the same file; Save as asks again; Last project is remembered', async () => {
    const { api, disk } = fakeLauncher();
    const pf = createDesktopProjectFiles(api, opts);
    expect(pf.canSaveInPlace).toBe(true);
    disk.answers.push(chosen(grant('p1', '/work/bottle.repack')));
    let made = 0;
    const make = () => new Blob([`{"v":${++made}}`]);
    expect(await pf.save(make, 'bottle.repack', { saveAs: false })).toEqual({ kind: 'SAVED', name: 'bottle.repack', inPlace: true });
    // The dialog proposes .repack and lists .repack.json too (the first is what a bare name gets).
    expect(disk.calls[0]).toMatch(/^save .*"defaultName":"bottle.repack".*"extensions":\["repack","repack.json"\]/);
    expect(await pf.save(make, 'bottle.repack', { saveAs: false })).toEqual({ kind: 'SAVED', name: 'bottle.repack', inPlace: true });
    expect(disk.calls.filter((c) => c.startsWith('save '))).toHaveLength(1);
    expect(new TextDecoder().decode(disk.files.get('/work/bottle.repack'))).toBe('{"v":2}');
    disk.answers.push({ cancelled: true });
    expect(await pf.save(make, 'bottle.repack', { saveAs: true })).toEqual({ kind: 'CANCELLED' });
    expect(disk.calls.filter((c) => c.startsWith('save '))).toHaveLength(2);
    const last = await pf.last!();
    expect(last?.name).toBe('bottle.repack');
    const file = await pf.reopen!(last!.handle);
    expect(await file!.text()).toBe('{"v":2}');
  });

  it('Open reads the chosen file and keeps it for Save; a dropped file is not one of ours', async () => {
    const { api, disk } = fakeLauncher();
    disk.files.set('/work/a.repack.json', new TextEncoder().encode('{"a":1}'));
    const pf = createDesktopProjectFiles(api, opts);
    disk.answers.push(chosen(grant('p2', '/work/a.repack.json')));
    const picked = await pf.pick();
    expect(await picked!.file.text()).toBe('{"a":1}');
    expect(picked!.file.name).toBe('a.repack.json');
    expect(disk.calls[0]).toContain('"writable":true');
    // The Open dialog lists both extensions in one filter, then every file.
    expect(disk.calls[0]).toContain('"extensions":["repack","repack.json"]');
    pf.adopt(picked!.handle);
    await pf.save(() => new Blob(['{"a":2}']), 'a.repack.json', { saveAs: false });
    expect(new TextDecoder().decode(disk.files.get('/work/a.repack.json'))).toBe('{"a":2}');
    // A file dropped on the window (a browser handle): the next Save asks where.
    pf.adopt({ kind: 'file', name: 'x' });
    disk.answers.push({ cancelled: true });
    expect((await pf.save(() => new Blob(['x']), 'a.repack.json', { saveAs: false })).kind).toBe('CANCELLED');
  });
});

describe('a project with environment images on the desktop (E5)', () => {
  const opts = { description: () => 'Repackshot project', openTitle: () => 'Open project', saveTitle: () => 'Save project', allFiles: () => 'All files' };
  const decode: PixelDecoder = async () => ({ width: 2, height: 1, rgba: new Uint8Array([9, 8, 7, 255, 6, 5, 4, 255]) });

  it('saves through the launcher’s dialog with its HDRI and background image, and opens with them', async () => {
    retainImages([]);
    const hdrBytes = new Uint8Array(readFileSync('tests/fixtures/studio.hdr'));
    const s = createInitialState();
    const hdri = await loadHdri('studio.hdr', hdrBytes, 'hdri:1');
    const backplate = await loadBackplate('plate.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), decode, 'plate:1');
    const state = { ...s, environment: { ...s.environment, kind: 'HDRI' as const, hdri, background: 'BACKPLATE' as const, backplate } };
    const { api, disk } = fakeLauncher();
    const pf = createDesktopProjectFiles(api, opts);
    disk.answers.push(chosen(grant('p9', '/work/lit.repack.json')));
    expect(await pf.save(() => serializeProject(state), 'lit.repack.json', { saveAs: false })).toEqual({ kind: 'SAVED', name: 'lit.repack.json', inPlace: true });
    // A new session opens it with the launcher's Open dialog: the images come back from the file.
    retainImages([]);
    disk.answers.push(chosen(grant('p9', '/work/lit.repack.json')));
    const picked = await pf.pick();
    const out = await readProjectFile(picked!.file, decode);
    if (!out.ok) throw new Error(out.fault.detail);
    expect(out.warnings).toEqual([]);
    expect(out.state.environment.hdri).toEqual(hdri);
    expect(out.state.environment.backplate).toEqual(backplate);
    expect(getImage('hdri:1')!.bytes).toEqual(hdrBytes);
    expect(Array.from(getImage('plate:1')!.rgba8!)).toEqual([9, 8, 7, 255, 6, 5, 4, 255]);
    retainImages([]);
  });
});

describe('imports and exports on the desktop', () => {
  it('files to import are read through the launcher; AI model files are read in ranges and hashed there', async () => {
    const { api, disk } = fakeLauncher();
    const data = new Uint8Array(100).map((_, i) => i);
    disk.files.set('/m/model.safetensors', data);
    disk.files.set('/m/model.obj', new TextEncoder().encode('v 0 0 0'));
    const d = createDesktopDialogs(api);
    disk.answers.push(chosen({ ...grant('o1', '/m/model.obj', false, false), size: 7 }));
    const [obj] = (await d.openFiles({ title: 'Import model', filters: [{ name: '3D models', extensions: ['obj'] }] }))!;
    expect(obj).toBeInstanceOf(File);
    expect(await obj.text()).toBe('v 0 0 0');
    disk.answers.push(chosen({ ...grant('m1', '/m/model.safetensors', false, false), size: 100 }));
    const [big] = (await d.openFiles({ title: 'Import AI model files', filters: [], multiple: true, lazy: true }))!;
    expect(big).toBeInstanceOf(NativeFile);
    expect(big.size).toBe(100);
    expect(big.name).toBe('model.safetensors');
    const part = big.slice(10, 20);
    expect(part.size).toBe(10);
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(disk.ranges).toEqual(['10-19']);
    expect([...new Uint8Array(await big.slice(95).slice(2).arrayBuffer())]).toEqual([97, 98, 99]);
    const progress: number[] = [];
    expect(await hashNativeFile(api, big as NativeFile, (n) => progress.push(n), 5)).toBe('ab'.repeat(32));
    expect(progress.at(-1)).toBe(100);
    // A folder: every file under it, with its path inside the folder.
    disk.answers.push(chosen(grant('d-m', '/m', true, false)));
    const all = (await d.openFolderFiles({ title: 'Import an AI model folder', folderItem: 'Folder selection' }))!;
    expect(all.map((f) => f.webkitRelativePath).sort()).toEqual(['m/model.obj', 'm/model.safetensors']);
    expect(disk.calls.find((c) => c.startsWith('folder'))).toContain('"read":true');
  });

  it('exports are written where the save dialog says; links open in the system’s browser', async () => {
    const { api, disk } = fakeLauncher();
    const d = createDesktopDialogs(api);
    disk.answers.push(chosen(grant('s1', '/out/scene.rsb')));
    expect(await d.saveFile(new Blob(['RSB1']), 'bottle.rsb', { title: 'Export scene', filters: [{ name: 'Scene', extensions: ['rsb'] }] })).toEqual({ kind: 'SAVED', name: 'scene.rsb', path: '/out/scene.rsb' });
    expect(new TextDecoder().decode(disk.files.get('/out/scene.rsb'))).toBe('RSB1');
    disk.answers.push({ cancelled: true });
    expect((await d.saveFile(new Blob(['x']), 'x.rsb', { title: 't', filters: [] })).kind).toBe('CANCELLED');
    await d.openExternal('https://example.org/');
    expect(disk.calls.at(-1)).toBe('url https://example.org/');
  });
});

describe('whenReady', () => {
  it('uses the browser’s service until the launcher answered, and waits for it in a method called before', async () => {
    let settle!: (v: { kind: string; go(): string } | null) => void;
    const ready = new Promise<{ kind: string; go(): string } | null>((r) => (settle = r));
    const svc = whenReady({ kind: 'web', go: () => 'web' }, ready);
    expect(svc.kind).toBe('web');
    const early = svc.go() as unknown as Promise<string>;
    settle({ kind: 'desktop', go: () => 'desktop' });
    expect(await early).toBe('desktop');
    expect(svc.kind).toBe('desktop');
    expect(svc.go()).toBe('desktop');
    const web = whenReady({ kind: 'web', go: () => 'web' }, Promise.resolve(null));
    await Promise.resolve();
    await Promise.resolve();
    expect(web.go()).toBe('web');
  });
});

describe('the launcher client’s file API', () => {
  it('speaks the routes of files.rs', async () => {
    const seen: string[] = [];
    const fetchFn = async (input: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${input} ${typeof init?.body === 'string' ? init.body : ''}`.trim());
      expect(new Headers(init?.headers).get('X-Repackshot-Token')).toBe('0123456789abcdef0123456789abcdef');
      return new Response(input.includes('dialog') ? '{"cancelled":true}' : input.endsWith('/projects/last') && !init?.method ? 'null' : '{}', { status: 200 });
    };
    const info = { app: 'repackshot', filesApi: 1 } as NativeInfo;
    const c = new NativeClient('0123456789abcdef0123456789abcdef', info, fetchFn);
    expect(c.hasFiles).toBe(true);
    expect(new NativeClient('0123456789abcdef0123456789abcdef', { app: 'repackshot' } as NativeInfo, fetchFn).hasFiles).toBe(false);
    await c.dialogFolder({ title: 'T' });
    await c.dialogOpen({ title: 'O', multiple: true });
    await c.dialogSave({ title: 'S', defaultName: 'a.png' });
    await c.writeNew('d1', 'a b.png', new Blob(['x']));
    await c.writeFile('f1', new Blob(['x']));
    await c.reveal('f1');
    await c.setLastProject('f1');
    expect(await c.lastProject()).toBeNull();
    await c.openUrl('https://example.org/');
    expect(seen).toEqual([
      'POST /api/dialog/folder {"title":"T"}',
      'POST /api/dialog/open {"title":"O","multiple":true}',
      'POST /api/dialog/save {"title":"S","defaultName":"a.png"}',
      'PUT /api/files?dir=d1&name=a+b.png',
      'PUT /api/files/f1',
      'POST /api/files/f1/reveal',
      'PUT /api/projects/last {"id":"f1"}',
      'GET /api/projects/last',
      'POST /api/open-url {"url":"https://example.org/"}',
    ]);
  });
});

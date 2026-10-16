// Files on the desktop (phase P3b): the launcher's own dialogs and file API
// (engine/crates/rt-app/src/files.rs) behind the same services the browser
// version has (io/files.ts, io/project-file.ts), so the desktop window never
// shows a browser file picker, a download bubble or a permission prompt.
//
// * Render outputs: Choose folder… asks the system's folder dialog; images are
//   new files in it (never an overwrite). A folder of an earlier launch is
//   confirmed again with the dialog, opened where it was (the launcher grants
//   only what was chosen in this launch). Downloads is the system's Downloads
//   folder, written by the launcher.
// * Projects: Open and Save as… with the system's dialogs, Save writes the
//   same file again, Last project is the file the launcher remembers.
// * Imports and exports: the system's open and save dialogs. A file to import
//   is read through the launcher; an AI model file (tens of GB) stays a
//   `NativeFile`, read in ranges and hashed by the launcher, never copied whole
//   into the page.

import { PROJECT_FILTER_EXTENSIONS } from '../core/project-names';
import type { Destination } from '../core/render';
import type { FilesService } from './files';
import type { ProjectFilesService, SaveResult } from './project-file';
import { NativeError, type DialogFilter, type DialogResult, type FolderDialogOptions, type NativeClient, type NativeGrant, type OpenDialogOptions, type SaveDialogOptions } from './native';

/** The parts of the launcher's client used here (a test double implements just these). */
export type DesktopApi = Pick<NativeClient, 'dialogFolder' | 'dialogOpen' | 'dialogSave' | 'writeNew' | 'writeFile' | 'readFile' | 'fileInfo' | 'hashFile' | 'listFolder' | 'reveal' | 'lastProject' | 'setLastProject' | 'openUrl'>;

/** Where small things are remembered between launches: the platform's memory (io/platform.ts), on the desktop the launcher's data folder. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const FOLDERS_KEY = 'repackshot.desktop.folders';
const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Why a dialog did not open, for the interface to word: `no-dialog` (Linux without zenity or kdialog), `dialog-open`, or another code. */
export function dialogErrorCode(err: unknown): string {
  return err instanceof NativeError ? err.code : 'dialog-failed';
}

// ------------------------------------------------------------------ files read through the launcher

/** A chosen file read in ranges through the launcher, never held whole: `slice()` gives blobs that fetch their bytes when read. */
export class NativeFile extends File {
  readonly nativeId: string;
  override readonly webkitRelativePath: string;
  readonly #api: Pick<DesktopApi, 'readFile'>;
  readonly #size: number;

  constructor(api: Pick<DesktopApi, 'readFile'>, grant: { id: string; name: string; size: number | null }, relativePath = '') {
    super([], grant.name, { type: 'application/octet-stream' });
    this.nativeId = grant.id;
    this.#api = api;
    this.#size = grant.size ?? 0;
    this.webkitRelativePath = relativePath;
  }

  override get size(): number {
    return this.#size;
  }

  override slice(start = 0, end = this.#size, contentType = ''): Blob {
    const clamp = (v: number) => (v < 0 ? Math.max(0, this.#size + v) : Math.min(v, this.#size));
    return new NativeSlice(this.#api, this.nativeId, clamp(start), clamp(end), contentType);
  }

  override arrayBuffer(): Promise<ArrayBuffer> {
    return this.slice().arrayBuffer();
  }

  override async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    return this.slice().stream();
  }
}

class NativeSlice extends Blob {
  constructor(
    private readonly api: Pick<DesktopApi, 'readFile'>,
    private readonly id: string,
    private readonly start: number,
    private readonly end: number,
    contentType: string,
  ) {
    super([], { type: contentType });
  }

  override get size(): number {
    return Math.max(0, this.end - this.start);
  }

  private async response(): Promise<Response> {
    const res = await this.api.readFile(this.id, [this.start, this.end - 1]);
    if (!res.ok) throw new Error(`the launcher could not read the file (${res.status})`);
    return res;
  }

  override slice(start = 0, end = this.size, contentType = ''): Blob {
    const clamp = (v: number) => (v < 0 ? Math.max(0, this.size + v) : Math.min(v, this.size));
    return new NativeSlice(this.api, this.id, this.start + clamp(start), this.start + clamp(end), contentType);
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.size === 0) return new ArrayBuffer(0);
    const buf = await (await this.response()).arrayBuffer();
    if (buf.byteLength !== this.size) throw new Error('the file changed while it was read');
    return buf;
  }

  override async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    const self = this;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async start(controller) {
        try {
          controller.enqueue(new Uint8Array(await self.arrayBuffer()));
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }
}

/** A chosen file as an ordinary File in the page (models, projects, libraries: read whole anyway). The browser keeps a large one on disk. */
export async function readChosen(api: Pick<DesktopApi, 'readFile'>, grant: { id: string; name: string }): Promise<File> {
  const res = await api.readFile(grant.id);
  if (!res.ok) throw new Error(`the launcher could not read ${grant.name} (${res.status})`);
  return new File([await res.blob()], grant.name, { type: 'application/octet-stream' });
}

/** The SHA-256 of a NativeFile, by the launcher, with progress (imports of AI models). */
export async function hashNativeFile(api: Pick<DesktopApi, 'hashFile' | 'fileInfo'>, file: NativeFile, onProgress?: (done: number) => void, pollMs = 300): Promise<string> {
  let finished = false;
  const job = api.hashFile(file.nativeId).finally(() => (finished = true));
  const poll = async () => {
    while (!finished && onProgress) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (finished) break;
      try {
        const info = await api.fileInfo(file.nativeId);
        if (info.hashing) onProgress(info.hashing.done);
      } catch {
        // The bar just does not move.
      }
    }
  };
  void poll();
  const { sha256 } = await job;
  onProgress?.(file.size);
  return sha256;
}

// ------------------------------------------------------------------ render outputs

export interface DesktopFilesOptions {
  /** The folder dialog's title for Choose folder…. */
  folderTitle: () => string;
  /** The title when a folder of an earlier launch is confirmed again ({path} filled in). */
  confirmTitle: (path: string) => string;
  /** Windows' fallback folder dialog: the text of its file name box. */
  folderItem: () => string;
  /** A dialog could not open (the code from dialogErrorCode). */
  onDialogError?: (code: string) => void;
  memory?: KeyValue | null;
}

/** The desktop's FilesService, plus what only the desktop has. */
export interface DesktopFilesService extends FilesService {
  readonly desktop: true;
  /** Results saved to Downloads can be shown in the file manager too. */
  readonly canOpenDownloads: boolean;
}

export function createDesktopFiles(api: DesktopApi, opts: DesktopFilesOptions): DesktopFilesService {
  /** Folder ids of an earlier launch → the grant confirmed for them in this one. */
  const alias = new Map<string, string>();
  /** Folders granted in this launch. */
  const granted = new Set<string>(['downloads']);
  /** (folder, name asked) → the file written, so Open folder can select it. */
  const written = new Map<string, string>();
  const readPaths = (): Record<string, string> => {
    try {
      const raw = opts.memory?.getItem(FOLDERS_KEY);
      const v = raw ? (JSON.parse(raw) as unknown) : null;
      return v && typeof v === 'object' ? (v as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  const rememberPath = (id: string, path: string) => {
    try {
      const all = readPaths();
      all[id] = path;
      const keys = Object.keys(all);
      // A few dozen folders are plenty.
      for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete all[k];
      opts.memory?.setItem(FOLDERS_KEY, JSON.stringify(all));
    } catch {
      // Not remembered: the next launch's confirmation starts elsewhere.
    }
  };
  const resolve = (id: string) => alias.get(id) ?? id;
  const ask = async (o: FolderDialogOptions): Promise<NativeGrant | null> => {
    let r: DialogResult;
    try {
      r = await api.dialogFolder(o);
    } catch (err) {
      console.warn(`folder dialog: ${reasonOf(err)}`);
      opts.onDialogError?.(dialogErrorCode(err));
      return null;
    }
    if (r.cancelled) return null;
    granted.add(r.file.id);
    rememberPath(r.file.id, r.file.path);
    return r.file;
  };
  const note = (dir: string, name: string, file: NativeGrant) => {
    written.set(`${dir}\n${name}`, file.id);
    if (written.size > 500) written.delete(written.keys().next().value as string);
  };
  return {
    desktop: true,
    canChooseFolder: true,
    canOpenFolder: true,
    canOpenDownloads: true,
    async chooseFolder() {
      const g = await ask({ title: opts.folderTitle(), folderItem: opts.folderItem() });
      // On the desktop the folder is shown by its path (UI.md §2.7).
      return g ? { id: g.id, name: g.path } : null;
    },
    async ensureAccess(id) {
      const now = resolve(id);
      if (granted.has(now)) return true;
      try {
        await api.fileInfo(now);
        granted.add(now);
        return true;
      } catch {
        // Not chosen in this launch: confirmed again below.
      }
      const path = readPaths()[id];
      const g = await ask({ title: opts.confirmTitle(path ?? ''), folderItem: opts.folderItem(), ...(path ? { start: path } : {}) });
      if (!g) return false;
      alias.set(id, g.id);
      return true;
    },
    async save(dest: Destination, name: string, blob: Blob) {
      if (dest.kind === 'FOLDER') {
        const dir = resolve(dest.id);
        try {
          const file = await api.writeNew(dir, name, blob);
          note(dest.id, name, file);
          return 'FOLDER';
        } catch (err) {
          // Not confirmed in this launch, full, refused: the image still goes to Downloads.
          console.warn(`could not write to the folder, saving to Downloads instead: ${reasonOf(err)}`);
        }
      }
      const file = await api.writeNew('downloads', name, blob);
      note('downloads', name, file);
      return 'DOWNLOAD';
    },
    async openFolder(id: string, name?: string) {
      const file = name !== undefined ? written.get(`${id}\n${name}`) : undefined;
      await api.reveal(file ?? resolve(id));
    },
  };
}

// ------------------------------------------------------------------ project files

/** A project file chosen in the launcher's dialogs (a ProjectFilesService handle). */
export interface DesktopHandle {
  kind: 'desktop-file';
  grant: NativeGrant;
}

export const isDesktopHandle = (h: unknown): h is DesktopHandle => typeof h === 'object' && h !== null && (h as { kind?: unknown }).kind === 'desktop-file';

export interface DesktopProjectOptions {
  description: () => string;
  openTitle: () => string;
  saveTitle: () => string;
  allFiles: () => string;
  onDialogError?: (code: string) => void;
}

export function createDesktopProjectFiles(api: DesktopApi, opts: DesktopProjectOptions): ProjectFilesService {
  let current: NativeGrant | null = null;
  const filter = (): DialogFilter => ({ name: opts.description(), extensions: [...PROJECT_FILTER_EXTENSIONS] });
  const remember = (g: NativeGrant) => void api.setLastProject(g.id).catch(() => undefined);
  return {
    canSaveInPlace: true,
    async save(make, suggestedName, { saveAs }): Promise<SaveResult> {
      if (!saveAs && current?.write) {
        let blob: Blob;
        try {
          blob = make();
        } catch (err) {
          return { kind: 'FAILED', reason: reasonOf(err) };
        }
        try {
          await api.writeFile(current.id, blob);
          remember(current);
          return { kind: 'SAVED', name: current.name, inPlace: true };
        } catch (err) {
          console.warn(`could not write to ${current.name}, asking where to save instead: ${reasonOf(err)}`);
        }
      }
      let r: DialogResult;
      const o: SaveDialogOptions = { title: opts.saveTitle(), defaultName: suggestedName, filters: [filter()], ...(current ? { start: current.id } : {}) };
      try {
        r = await api.dialogSave(o);
      } catch (err) {
        opts.onDialogError?.(dialogErrorCode(err));
        return { kind: 'FAILED', reason: reasonOf(err) };
      }
      if (r.cancelled) return { kind: 'CANCELLED' };
      try {
        await api.writeFile(r.file.id, make());
      } catch (err) {
        return { kind: 'FAILED', reason: reasonOf(err) };
      }
      current = r.file;
      remember(r.file);
      return { kind: 'SAVED', name: r.file.name, inPlace: true };
    },
    async pick() {
      let r: DialogResult;
      const o: OpenDialogOptions = { title: opts.openTitle(), filters: [filter(), { name: opts.allFiles(), extensions: ['*'] }], writable: true, ...(current ? { start: current.id } : {}) };
      try {
        r = await api.dialogOpen(o);
      } catch (err) {
        opts.onDialogError?.(dialogErrorCode(err));
        return null;
      }
      if (r.cancelled) return null;
      const handle: DesktopHandle = { kind: 'desktop-file', grant: r.file };
      return { file: await readChosen(api, r.file), handle };
    },
    adopt(handle) {
      current = isDesktopHandle(handle) ? handle.grant : null;
      if (current) remember(current);
    },
    async last() {
      try {
        const g = await api.lastProject();
        return g ? { name: g.name, handle: { kind: 'desktop-file', grant: g } satisfies DesktopHandle } : null;
      } catch {
        return null;
      }
    },
    async reopen(handle) {
      if (!isDesktopHandle(handle)) return null;
      try {
        return await readChosen(api, handle.grant);
      } catch {
        return null;
      }
    },
  };
}

// ------------------------------------------------------------------ imports, exports, links

export interface OpenFilesRequest {
  title: string;
  filters: DialogFilter[];
  multiple?: boolean;
  /** Keep the files in the launcher and read them in ranges (AI model files): NativeFile. */
  lazy?: boolean;
}

export type SaveFileResult = { kind: 'SAVED'; name: string; path: string } | { kind: 'CANCELLED' } | { kind: 'FAILED'; reason: string };

/** The system's dialogs for the interface's imports and exports (ui/ports.ts DialogsPort). */
export interface DesktopDialogs {
  openFiles(req: OpenFilesRequest): Promise<File[] | null>;
  openFolderFiles(req: { title: string; folderItem: string }): Promise<File[] | null>;
  saveFile(blob: Blob, suggestedName: string, req: { title: string; filters: DialogFilter[] }): Promise<SaveFileResult>;
  openExternal(url: string): Promise<void>;
}

export function createDesktopDialogs(api: DesktopApi, onDialogError?: (code: string) => void): DesktopDialogs {
  const guarded = async (call: () => Promise<DialogResult>): Promise<DialogResult | null> => {
    try {
      return await call();
    } catch (err) {
      console.warn(`dialog: ${reasonOf(err)}`);
      onDialogError?.(dialogErrorCode(err));
      return null;
    }
  };
  return {
    async openFiles(req) {
      const r = await guarded(() => api.dialogOpen({ title: req.title, filters: req.filters, multiple: req.multiple === true }));
      if (!r || r.cancelled) return null;
      if (req.lazy) return r.files.map((g) => new NativeFile(api, g));
      return Promise.all(r.files.map((g) => readChosen(api, g)));
    },
    async openFolderFiles(req) {
      const r = await guarded(() => api.dialogFolder({ title: req.title, folderItem: req.folderItem, read: true, write: false }));
      if (!r || r.cancelled) return null;
      const { files } = await api.listFolder(r.file.id);
      return files.map((f) => new NativeFile(api, { id: f.id, name: f.name, size: f.size }, `${r.file.name}/${f.rel}`));
    },
    async saveFile(blob, suggestedName, req) {
      const r = await guarded(() => api.dialogSave({ title: req.title, defaultName: suggestedName, filters: req.filters }));
      if (!r) return { kind: 'FAILED', reason: 'dialog' };
      if (r.cancelled) return { kind: 'CANCELLED' };
      try {
        const g = await api.writeFile(r.file.id, blob);
        return { kind: 'SAVED', name: g.name, path: g.path };
      } catch (err) {
        return { kind: 'FAILED', reason: reasonOf(err) };
      }
    },
    openExternal: (url) => api.openUrl(url),
  };
}

/**
 * `fallback` until `ready` settles, then what it gave (or `fallback` when it gave null): plain properties read the one in
 * force, and a method called before `ready` settles waits for it, so a desktop window never uses the browser's version.
 */
export function whenReady<T extends object>(fallback: T, ready: Promise<T | null>): T {
  let current: T | null = null;
  const settled = ready.then(
    (d) => (current = d ?? fallback),
    () => (current = fallback),
  );
  return new Proxy(fallback, {
    get(_target, prop) {
      const now = (current ?? fallback) as Record<PropertyKey, unknown>;
      const v = now[prop];
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        if (current) return ((current as Record<PropertyKey, unknown>)[prop] as (...a: unknown[]) => unknown).apply(current, args);
        return settled.then((impl) => ((impl as Record<PropertyKey, unknown>)[prop] as (...a: unknown[]) => unknown).apply(impl, args));
      };
    },
  });
}

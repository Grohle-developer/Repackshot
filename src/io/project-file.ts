// Where a project file is written and read (UI.md §2.1: Open, Save, Save as…).
//
// Browsers with the File System Access API (Chromium, so the desktop window too) get real files: Open and Save
// as… remember the file's handle, and Save writes to it again without asking. Elsewhere the project is
// downloaded under the project's name and opened through an `<input type="file">`. A handle is only a
// convenience: when it stops working (the file moved, the permission was refused) Save asks where again, and a
// picker that cannot be shown downloads the file, so a project is never lost to the dialogs.

import { PROJECT_EXTENSIONS } from '../core/project-names';

/** The part of a FileSystemWritableFileStream used here. */
interface Writable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

/** The part of a FileSystemFileHandle used here, with the permission methods Chromium has. */
interface FileHandle {
  readonly kind: 'file';
  readonly name: string;
  createWritable(): Promise<Writable>;
  getFile(): Promise<File>;
  queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface PickerOptions {
  id?: string;
  suggestedName?: string;
  multiple?: boolean;
  types?: { description: string; accept: Record<string, string[]> }[];
}
type SavePicker = (opts?: PickerOptions) => Promise<FileHandle>;
type OpenPicker = (opts?: PickerOptions) => Promise<FileHandle[]>;

export interface ProjectFilesService {
  readonly canSaveInPlace: boolean;
  save(make: () => Blob, suggestedName: string, opts: { saveAs: boolean }): Promise<SaveResult>;
  pick(): Promise<{ file: File; handle: unknown } | null>;
  adopt(handle: unknown): void;
  /** The project file opened or saved last (General ▸ On start ▸ Last project), when it is remembered. */
  last(): Promise<{ name: string; handle: unknown } | null>;
  /** Reads a remembered file again; asks for permission, so call it from a click. Null when it cannot be read. */
  reopen(handle: unknown): Promise<File | null>;
}

export type SaveResult = { kind: 'SAVED'; name: string; inPlace: boolean } | { kind: 'CANCELLED' } | { kind: 'FAILED'; reason: string };

export interface ProjectFilesOptions {
  /** The name of the file type in the system's dialogs (in the language of the interface). */
  description?: () => string;
  /** Asks for a file with an `<input type="file">` (the default does it with the page's `document`). */
  chooseWithInput?: () => Promise<File | null>;
  /** Where the last project file's handle is kept between sessions (IndexedDB); without it nothing is remembered. */
  remember?: { put(handle: unknown): Promise<void>; get(): Promise<unknown> };
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const aborted = (err: unknown): boolean => (err as { name?: string } | null)?.name === 'AbortError';
const isFileHandle = (h: unknown): h is FileHandle => typeof h === 'object' && h !== null && (h as { kind?: unknown }).kind === 'file' && typeof (h as { createWritable?: unknown }).createWritable === 'function';

/** The browser's own `<input type="file">`, for browsers without the picker. */
function chooseWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_EXTENSIONS.join(',')},.json,application/json`;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    // A dialog that is dismissed fires `cancel` in current browsers.
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function createProjectFiles(
  win: { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown; isSecureContext?: boolean },
  download: (blob: Blob, name: string) => void,
  options: ProjectFilesOptions = {},
): ProjectFilesService {
  const secure = win.isSecureContext !== false;
  const savePicker = typeof win.showSaveFilePicker === 'function' && secure ? (win.showSaveFilePicker as SavePicker).bind(win) : null;
  const openPicker = typeof win.showOpenFilePicker === 'function' && secure ? (win.showOpenFilePicker as OpenPicker).bind(win) : null;
  const types = () => [{ description: options.description?.() ?? 'Repackshot project', accept: { 'application/json': [...PROJECT_EXTENSIONS] } }];
  /** The file the open project came from or was last saved to. */
  let current: FileHandle | null = null;
  /** Kept for the next session: a failure only means Last project has nothing to offer. */
  const remember = (h: FileHandle) => void options.remember?.put(h).catch(() => undefined);

  const writeAccess = async (h: FileHandle): Promise<boolean> => {
    try {
      const q = h.queryPermission ? await h.queryPermission({ mode: 'readwrite' }) : 'granted';
      if (q === 'granted') return true;
      return h.requestPermission ? (await h.requestPermission({ mode: 'readwrite' })) === 'granted' : false;
    } catch {
      return false;
    }
  };
  const write = async (h: FileHandle, blob: Blob): Promise<void> => {
    const w = await h.createWritable();
    try {
      await w.write(blob);
      await w.close();
    } catch (err) {
      await w.abort?.().catch(() => undefined);
      throw err;
    }
  };
  /** A picker called with the file types, and again without them if the browser refuses them (a TypeError). */
  const ask = async <T>(call: (opts: PickerOptions) => Promise<T>, base: PickerOptions): Promise<T> => {
    try {
      return await call({ ...base, types: types() });
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      return call(base);
    }
  };

  return {
    canSaveInPlace: savePicker !== null,
    async save(make, suggestedName, { saveAs }) {
      if (!savePicker) {
        try {
          download(make(), suggestedName);
          return { kind: 'SAVED', name: suggestedName, inPlace: false };
        } catch (err) {
          return { kind: 'FAILED', reason: reasonOf(err) };
        }
      }
      // The file it already is: no dialog.
      if (!saveAs && current && (await writeAccess(current))) {
        let blob: Blob;
        try {
          blob = make();
        } catch (err) {
          return { kind: 'FAILED', reason: reasonOf(err) };
        }
        try {
          await write(current, blob);
          return { kind: 'SAVED', name: current.name, inPlace: true };
        } catch (err) {
          console.warn(`could not write to ${current.name}, asking where to save instead: ${reasonOf(err)}`);
        }
      }
      let handle: FileHandle;
      try {
        handle = await ask((o) => savePicker(o), { id: 'repackshot-projects', suggestedName });
      } catch (err) {
        if (aborted(err)) return { kind: 'CANCELLED' };
        // No dialog can be shown (no user gesture, a policy): the download still keeps the work.
        console.warn(`could not ask where to save, downloading instead: ${reasonOf(err)}`);
        try {
          download(make(), suggestedName);
          return { kind: 'SAVED', name: suggestedName, inPlace: false };
        } catch (e2) {
          return { kind: 'FAILED', reason: reasonOf(e2) };
        }
      }
      try {
        await write(handle, make());
      } catch (err) {
        return { kind: 'FAILED', reason: reasonOf(err) };
      }
      current = handle;
      remember(handle);
      return { kind: 'SAVED', name: handle.name, inPlace: true };
    },
    async pick() {
      if (!openPicker) {
        const file = await (options.chooseWithInput ?? chooseWithInput)();
        return file ? { file, handle: null } : null;
      }
      try {
        const [handle] = await ask((o) => openPicker(o), { id: 'repackshot-projects', multiple: false });
        return handle ? { file: await handle.getFile(), handle } : null;
      } catch (err) {
        if (aborted(err)) return null;
        console.warn(`could not open the file picker, using the input instead: ${reasonOf(err)}`);
      }
      const file = await (options.chooseWithInput ?? chooseWithInput)();
      return file ? { file, handle: null } : null;
    },
    adopt(handle) {
      current = isFileHandle(handle) ? handle : null;
      // A new project (null) leaves the last file remembered: it is still the last one opened or saved.
      if (current) remember(current);
    },
    async last() {
      if (!options.remember) return null;
      try {
        const h = await options.remember.get();
        return isFileHandle(h) ? { name: h.name, handle: h } : null;
      } catch {
        return null;
      }
    },
    async reopen(handle) {
      if (!isFileHandle(handle)) return null;
      try {
        const q = handle.queryPermission ? await handle.queryPermission({ mode: 'read' }) : 'granted';
        if (q !== 'granted' && (!handle.requestPermission || (await handle.requestPermission({ mode: 'read' })) !== 'granted')) return null;
        return await handle.getFile();
      } catch {
        // Moved, deleted, or the permission was refused.
        return null;
      }
    },
  };
}

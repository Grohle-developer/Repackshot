// Where render outputs go (UI.md §2.7 "Folder when done"): the browser's
// downloads, or a folder the person chose with the File System Access API
// (`showDirectoryPicker`, Chromium browsers). The folder's handle is kept in
// IndexedDB (io/results.ts) so the permission is remembered; it is asked
// again when the browser forgets it (from a user gesture: Render or Add to
// queue). A folder that is gone or not writable never loses an image: it is
// downloaded instead. Browsers cannot show a folder in the system's file
// manager, so `canOpenFolder` is false here (the desktop build, P2, can).

import type { Destination } from '../core/render';

/** Where handles are kept (the results store). */
export interface HandleStore {
  putHandle(id: string, handle: unknown): Promise<void>;
  getHandle(id: string): Promise<unknown>;
}

/** The part of FileSystemDirectoryHandle used here, with the permission methods Chromium has. */
interface DirHandle {
  readonly kind: 'directory';
  readonly name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
  queryPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
}

export interface FilesService {
  readonly canChooseFolder: boolean;
  readonly canOpenFolder: boolean;
  chooseFolder(): Promise<{ id: string; name: string } | null>;
  ensureAccess(id: string): Promise<boolean>;
  save(dest: Destination, name: string, blob: Blob): Promise<'FOLDER' | 'DOWNLOAD'>;
  openFolder(id: string): Promise<void>;
}

type Picker = (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirHandle>;

/** `name (2).ext`, `name (3).ext`… */
export function numberedName(name: string, k: number): string {
  if (k <= 1) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${k})${name.slice(dot)}` : `${name} (${k})`;
}

export function createFiles(handles: HandleStore, download: (blob: Blob, name: string) => void, win: { showDirectoryPicker?: unknown; isSecureContext?: boolean } = globalThis as never): FilesService {
  const picker = typeof win.showDirectoryPicker === 'function' && win.isSecureContext !== false ? (win.showDirectoryPicker as Picker).bind(win) : null;
  const handleOf = async (id: string): Promise<DirHandle | null> => {
    try {
      const h = (await handles.getHandle(id)) as DirHandle | null;
      return h && h.kind === 'directory' ? h : null;
    } catch {
      return null;
    }
  };
  const granted = async (h: DirHandle, ask: boolean): Promise<boolean> => {
    try {
      const q = h.queryPermission ? await h.queryPermission({ mode: 'readwrite' }) : 'granted';
      if (q === 'granted') return true;
      if (!ask || !h.requestPermission) return false;
      return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch {
      return false;
    }
  };
  return {
    canChooseFolder: picker !== null,
    canOpenFolder: false,
    async chooseFolder() {
      if (!picker) return null;
      let h: DirHandle;
      try {
        h = await picker({ id: 'repackshot-renders', mode: 'readwrite' });
      } catch {
        // Cancelled, or refused.
        return null;
      }
      const id = `folder-${Date.now().toString(36)}`;
      try {
        await handles.putHandle(id, h);
      } catch {
        return null;
      }
      return { id, name: h.name };
    },
    async ensureAccess(id) {
      const h = await handleOf(id);
      return h ? granted(h, true) : false;
    },
    async save(dest, name, blob) {
      if (dest.kind === 'FOLDER') {
        const h = await handleOf(dest.id);
        if (h && (await granted(h, false))) {
          try {
            // Never overwrite: "name (2).png" when "name.png" is there.
            let k = 1;
            for (; k < 1000; k++) {
              try {
                await h.getFileHandle(numberedName(name, k));
              } catch {
                break;
              }
            }
            const fh = await h.getFileHandle(numberedName(name, k), { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
            return 'FOLDER';
          } catch (err) {
            console.warn(`could not write to the folder, downloading instead: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      download(blob, name);
      return 'DOWNLOAD';
    },
    async openFolder() {
      // Browsers cannot reveal a folder; the interface hides the button (canOpenFolder).
    },
  };
}

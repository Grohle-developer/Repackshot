// The platform seam (phase P3e): every service the interface uses that keeps something or asks
// something of the computer goes through one `Platform`, chosen once at start.
//
// * **Web** (io/platform-web.ts): the page is the application and keeps its own state in the
//   browser: localStorage (settings, library, small things, thumbnails), IndexedDB (results
//   history, folder handles), the origin's private file system (AI models, through the model
//   worker), WebGPU and what the browser reports of the computer.
// * **Desktop** (io/platform-desktop.ts): in the launcher's window the page is only the
//   interface. Every service and every byte of state is the launcher's (engine/crates/rt-app):
//   `settings.json`, `state/`, `library/`, `results/`, `cache/thumbs/` and `models/` in the data
//   folder, `/api/hardware`, `/api/storage/usage`, and its dialogs and file API for outputs,
//   projects, imports and exports (P3b: never the browser's pickers, downloads or file handles).
//   The browser's storage is never touched, except
//   once: what an older version left there is copied to the launcher, and a mark in the data folder
//   says it was done.
//
// Both implement the same interface; main.ts builds the interface's services from it.

import type { Library } from '../core/library';
import type { HardwareInfo } from '../core/models';
import type { HistoryLimits } from '../core/results';
import type { SettingsDoc } from '../core/settings';
import type { DesktopDialogs } from './desktop-files';
import type { FilesService, HandleStore } from './files';
import type { LoadResult, SaveStatus } from './library';
import type { ModelStore } from './model-store';
import { connectNative, type NativeClient, type PendingModels } from './native';
import type { StorageUsage } from './native-store';
import type { KeyValue } from './prefs';
import type { ProjectFilesService } from './project-file';
import { desktopPlatform } from './platform-desktop';
import { webPlatform, type BrowserApis } from './platform-web';
import type { ResultsStore } from './results';

/** Where rendered material spheres are kept between sessions (render/thumbs.ts's `ThumbStore`). */
export interface ThumbCache {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, url: string): void;
}

/** The space the application's data takes, and freeing it (Settings ▸ Storage). */
export interface StorageService {
  /** `browser`: the site's storage, which the browser may evict; `folder`: the launcher's data folder. */
  readonly kind: 'browser' | 'folder';
  /** What the browser reports of its quota (web), null where it does not (and always on the desktop). */
  estimate(): Promise<{ usage: number; quota: number } | null>;
  /** Whether the browser keeps the data (web); null where it cannot say or there is no browser storage. */
  persisted(): Promise<boolean | null>;
  /** Asks the browser to keep the data (web); null where it cannot be asked. */
  persist(): Promise<boolean | null>;
  /** The library's bytes. */
  libraryBytes(): Promise<number>;
  /** The thumbnail cache's bytes. */
  cacheBytes(): Promise<number>;
  /** Deletes the thumbnail cache; the bytes freed. */
  clearCache(): Promise<number>;
  /** The data folder by part, as the launcher measured it; null on the web. */
  usage(): Promise<StorageUsage | null>;
}

export interface LibraryStore {
  /** The library as it was at start (never throws: damaged items are skipped and reported). */
  readonly initial: LoadResult;
  /** Keeps the library. The desktop answers `ok` at once and reports a failed write through `onWriteError`. */
  save(lib: Library): SaveStatus;
  /** Reads it again (another tab changed it: web only). */
  reload(): LoadResult;
}

/** What the file services need from the interface: the words of the dialogs, and how a failed one is said. */
export interface FilesOptions {
  /** Where the web version keeps the handles of the folders chosen (the results store). */
  handles: HandleStore;
  /** A download (the web version; the own window of P3c refuses every one). */
  download: (blob: Blob, name: string) => void;
  folderTitle: () => string;
  confirmTitle: (path: string) => string;
  folderItem: () => string;
  onDialogError: (code: string) => void;
}

export interface ProjectFilesOptions {
  download: (blob: Blob, name: string) => void;
  description: () => string;
  openTitle: () => string;
  saveTitle: () => string;
  allFiles: () => string;
  onDialogError: (code: string) => void;
  /** Where the web version keeps the last project's file handle (General ▸ On start ▸ Last project). */
  remember: { put(handle: unknown): Promise<void>; get(): Promise<unknown> };
}

export interface Platform {
  readonly kind: 'web' | 'desktop';
  /** The launcher's client in its window; null on the web. */
  readonly native: NativeClient | null;
  /** The settings document as it was at start, and where it goes. */
  readonly settings: {
    readonly initial: { doc: SettingsDoc; migrated: boolean };
    /** Keeps the document; `final`: the page is going away (the write must outlive it). */
    save(doc: SettingsDoc, opts?: { final?: boolean }): void;
  };
  /** Small remembered things (`repackshot.<name>`): read at once, written through. */
  readonly memory: KeyValue;
  readonly library: LibraryStore;
  /** The results history: IndexedDB (or memory) on the web, the launcher's results folder on the desktop. */
  openResults(limits: HistoryLimits): Promise<ResultsStore>;
  /**
   * The AI model store: `local` (OPFS through the model worker) on the web when the browser has it, the launcher's
   * on the desktop (a file chosen in its dialog is hashed by the launcher, never read into the page).
   */
  modelStore(local: ModelStore): Promise<ModelStore | null>;
  /** Where render outputs go: downloads or a folder of the browser's file system access; the launcher's folders. */
  files(opts: FilesOptions): FilesService;
  /** Where projects are opened and saved: the browser's pickers or downloads; the launcher's dialogs and the file it remembers. */
  projectFiles(opts: ProjectFilesOptions): ProjectFilesService;
  /** The system's dialogs for imports and exports: the launcher's on the desktop, null on the web (inputs and downloads). */
  dialogs(onDialogError: (code: string) => void): DesktopDialogs | null;
  /** What the desktop installer chose to download; null on the web. */
  pendingModels(): Promise<PendingModels | null>;
  /** Asks to keep the model store at the first download (the browser's persistence; the launcher's folder is kept). */
  requestPersistence(): Promise<boolean>;
  /** What this computer has: the browser's WebGPU limits on the web, the launcher's detection on the desktop. */
  hardware(again?: boolean): Promise<HardwareInfo>;
  readonly storage: StorageService;
  readonly thumbs: ThumbCache;
  /** Calls `fn` when the library was changed outside this page (another tab, web only). */
  onLibraryChange(fn: () => void): void;
  /** A write to the platform's storage failed (desktop: the launcher refused or did not answer). */
  onWriteError(fn: (what: 'settings' | 'library' | 'memory', err: unknown) => void): void;
  /** Writes still under way are sent so that they outlive the page (`pagehide`). */
  flush(): void;
}

export interface PlatformDeps {
  /** The launcher's client (tests); by default `connectNative()` (io/native.ts). */
  native?: NativeClient | null | Promise<NativeClient | null>;
  /** The browser's storage the web platform and the one migration use (tests pass doubles). */
  browser?: BrowserApis;
}

/** The platform this page runs on: the desktop when the launcher answers, the web otherwise. Call it once, early. */
export async function choosePlatform(deps: PlatformDeps = {}): Promise<Platform> {
  const native = await (deps.native !== undefined ? deps.native : connectNative());
  return native ? desktopPlatform(native, deps.browser) : webPlatform(deps.browser);
}

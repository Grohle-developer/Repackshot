// Entry point: creates the store, mounts the interface, starts the two
// viewport engines (the three.js preview, and the path tracer in a pool of
// workers once rt.wasm has loaded) and applies the optional demo / screenshot
// URL parameters (see src/ui/README.md). The header's Fast · Full switch
// picks which one the viewport shows; Render always uses the path tracer: in
// the desktop launcher's window the native one (render/native.ts), else the
// wasm pool.
// Sets #app[data-ready="1"] once the interface has painted and the viewport
// has drawn its first frame, and then starts the check for a newer version
// (Settings ▸ Updates ▸ Check at startup) in the background.

import './ui/theme.css';
import './ui/layout.css';
import './ui/components.css';
import './ui/panels.css';
import './ui/render.css';
import './ui/settings.css';
import './ui/guards.css';
import { evaluate, totalDuration } from './core/animation';
import { AI_MODELS, type AiModelEntry, type AiModelsCatalogue } from './data/ai-models';
import { activeCamera, sameView } from './core/camera';
import { historyLimits, startViewportMode, withProjectDefaults, type Layout, type SettingKey, type Settings, type SettingsDoc } from './core/settings';
import { createInitialState, createStore } from './core/store';
import { DownloadManager, type DownloadMemory } from './io/downloads';
import { detectWebHardware, fromNativeHardware } from './io/hardware';
import { nativeModelStore, workerModelStore } from './io/model-store';
import { createFiles, type FilesService } from './io/files';
import { createDesktopDialogs, createDesktopFiles, createDesktopProjectFiles, hashNativeFile, NativeFile, whenReady } from './io/desktop-files';
import { buildExample } from './core/example';
import { encodeExr, encodeImage, encodePixels, encodePng16 } from './io/image';
import { LIBRARY_STORAGE_KEY, exportLibrary, importLibrary, loadLibrary, saveLibrary } from './io/library';
import { connectHost, downloadsFor } from './io/host';
import { AiRuntimeClient } from './io/ai-runtime';
import { connectNative, type PendingModels } from './io/native';
import { readProjectFile, serializeProject } from './io/project';
import { createProjectFiles } from './io/project-file';
import { openResultsStore } from './io/results';
import { fetchLatestRelease } from './io/updates';
import { projectScene, tonemapFor, writeRsb } from './io/rsb';
import { NativeEngine } from './render/native';
import { loadEngineModule, PathTracerEngine, Pool, simdSupported, type SceneSource } from './render/pathtracer';
import { PreviewEngine } from './render/preview';
import { clearThumbCache, thumbCacheBytes, ThumbnailRenderer } from './render/thumbs';
import { exactWords16, linearRgba, poolSize } from './render/tiles';
import { mountApp } from './ui/app';
import { exampleNames, loadExample, loadResults, maybeShowModelChooser, offerLastProject, requestCloseWindow } from './ui/commands';
import { installGuards } from './ui/guards';
import { downloadBlob, openInNewTab } from './ui/dom';
import { startupUpdateCheck } from './ui/updates';
import type { AppServices, EngineConfig, ViewportPort } from './ui/ports';
import { loadSettingsDoc, readPref, saveSettingsDoc, writePref } from './ui/prefs';
import { isaLabel, L, t } from './ui/strings';
import { createUiStore, effectiveMode, type EngineInfo } from './ui/ui-state';
import { applyUrlParams, readUrlParams } from './ui/url-params';

const appEl = document.getElementById('app')!;
// The page behaves like an application: no browser menus, selection, zoom, reload, print... (ui/guards.ts).
const guards = installGuards(window, import.meta.env.PROD);
// In the desktop launcher's window: its token leaves the address bar now, and the heartbeat keeps
// the launcher running while this page is open.
const nativeReady = connectNative().then((client) => {
  client?.startHeartbeat();
  return client;
});
// The launcher's dialogs and file API (P3b): files, projects, imports and exports go through it, never through the
// browser's pickers, downloads or permission prompts.
const desktopIo = nativeReady.then((n) => (n && n.hasFiles ? n : null));
// Repackshot's own window (P3c, WebView2): known at once, before the interface decides on beforeunload.
// Null in a browser and in the browser's app window.
const windowHost = connectHost();
// In that window nothing is ever downloaded: every file goes through the launcher's dialogs (P3b).
const download = downloadsFor(windowHost, downloadBlob, () => ui.toast(t('dialog.err.notReady')));
const params = readUrlParams(window.location.search);

// The application settings (U6, core/settings.ts): one document in localStorage, migrated from the loose
// preferences of before. ?theme and ?lang (demos, screenshots) take effect for this session only: they are
// not saved unless the person changes them here.
const settingsDoc: SettingsDoc = loadSettingsDoc().doc;
const transient = new Map<SettingKey, unknown>();
const startSettings: Settings = { ...settingsDoc.settings };
if (params.lang && params.lang !== startSettings['general.lang']) {
  transient.set('general.lang', params.lang);
  startSettings['general.lang'] = params.lang;
}
if (params.theme && params.theme !== startSettings['general.theme']) {
  transient.set('general.theme', params.theme);
  startSettings['general.theme'] = params.theme;
}
const lang = startSettings['general.lang'];
const theme = startSettings['general.theme'];
// A new project, with the defaults for new projects of Preferences.
const store = createStore(withProjectDefaults(createInitialState({ lang, theme }), startSettings));
// The user's library (U4) lives in the interface state and in one localStorage entry.
const loadedLibrary = loadLibrary();
let savedLayout: Layout = settingsDoc.layout;
let saveTimer = 0;
const saveSettings = () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const now = ui.get().settings;
    const settings: Settings = { ...now };
    for (const [k, v] of [...transient]) {
      // Still the value the URL gave: what is saved stays what was saved.
      if (now[k] === v) (settings as unknown as Record<string, unknown>)[k] = settingsDoc.settings[k];
      else transient.delete(k);
    }
    settingsDoc.settings = settings;
    settingsDoc.layout = savedLayout;
    saveSettingsDoc(settingsDoc);
  }, 120);
};
const ui = createUiStore(
  {
    library: loadedLibrary.lib,
    settings: startSettings,
    viewportMode: startViewportMode(startSettings, settingsDoc.layout.viewportMode),
  },
  {
    layout: settingsDoc.layout,
    onLayout: (patch) => {
      savedLayout = { ...savedLayout, ...patch };
      saveSettings();
    },
  },
);
ui.subscribe((u, prev) => u.settings !== prev.settings && saveSettings());
window.addEventListener('pagehide', () => {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    settingsDoc.layout = savedLayout;
    saveSettingsDoc(settingsDoc);
  }
});

// The preview always exists (it draws the overlays, picks and moves the camera); the path tracer
// joins when its engine has loaded.
const canvas = document.createElement('canvas');
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', 'viewport');
const backdrop = document.createElement('canvas');
backdrop.setAttribute('aria-hidden', 'true');
backdrop.style.visibility = 'hidden';
let preview: PreviewEngine | null = null;
try {
  preview = new PreviewEngine();
  preview.mount(canvas);
} catch (err) {
  console.error(err);
  preview = null;
}
const thumbs = new ThumbnailRenderer();

// The project to the engine's scene (io/rsb.ts); the path tracer only sees this interface.
const sceneSource: SceneSource = {
  build(state, view) {
    const { scene, meshKey } = projectScene(state, {
      ...view,
      // A frame of an animation: the pose of that instant (the camera track's camera unless one is named).
      ...(view.time !== undefined ? { pose: evaluate(state, view.time) } : {}),
      ...(view.advanced ? { maxDepth: view.advanced.maxBounces ?? undefined, clampIndirect: view.advanced.clampIndirect, seed: view.advanced.seed } : {}),
    });
    return { meshKey, bytes: (meshes) => writeRsb(scene, { meshes }) };
  },
  tone: (state) => ({ exposureEv: state.image.exposureEv, tonemap: tonemapFor(state.image.viewTransform) }),
};

let tracer: PathTracerEngine | NativeEngine | null = null;
/** The viewport shows the path tracer now. */
let full = false;
/** The viewport's last size (the path tracer may arrive after it). */
const lastSize: { w: number; h: number; dpr: number } = { w: 0, h: 0, dpr: 1 };
const tracerFrames = new Set<() => void>();

const applyMode = () => {
  const next = tracer !== null && preview !== null && effectiveMode(ui.get()) === 'FULL';
  if (next === full) return;
  full = next;
  preview?.setOverlayOnly(full);
  tracer?.setActive(full);
  backdrop.style.visibility = full ? 'visible' : 'hidden';
};
ui.subscribe(applyMode);

/** The engine settings in force (Settings ▸ Render engine); configure() changes them. */
let engineCfg: EngineConfig | null = null;
/** The configuration the running engine was made with (backend, pool size, SIMD build). */
let poolCfg: { backend: 'native' | 'wasm'; threads: number; simd: EngineConfig['simd'] } | null = null;
let engineGen = 0;
let restartTimer = 0;
const base = new URL(import.meta.env.BASE_URL, window.location.href).href;
const cores = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : null;

const useTracer = (t: PathTracerEngine | NativeEngine, cfg: EngineConfig, info: EngineInfo) => {
  t.setGestureResolution(cfg.gestureResolution);
  t.setViewportLimit(cfg.viewportLimit);
  t.mount(backdrop);
  if (lastSize.w > 0) t.resize(lastSize.w, lastSize.h, lastSize.dpr);
  t.sync(store.get(), null);
  t.onFrame(() => tracerFrames.forEach((fn) => fn()));
  tracer = t;
  ui.set({ engine: 'READY', engineInfo: info });
  applyMode();
};

/**
 * Starts (or starts again) the path tracer with the settings. In the desktop launcher's window the native engine
 * (all the threads the launcher started with), unless Render engine ▸ Engine says WebAssembly; elsewhere the wasm
 * pool, with its size and build.
 */
async function startEngine(cfg: EngineConfig): Promise<void> {
  const gen = ++engineGen;
  if (tracer) {
    // The old engine goes; Full shows the preview until the new one is ready.
    const old = tracer;
    tracer = null;
    if (full) {
      full = false;
      preview?.setOverlayOnly(false);
      backdrop.style.visibility = 'hidden';
    }
    old.setActive(false);
    old.dispose();
  }
  ui.set({ engine: 'LOADING', engineInfo: null });
  const native = await nativeReady;
  if (gen !== engineGen) return;
  const simdOk = simdSupported();
  if (native && cfg.backend !== 'WASM') {
    const i = native.info;
    const t = new NativeEngine(native, sceneSource, i);
    poolCfg = { backend: 'native', threads: cfg.threads, simd: cfg.simd };
    useTracer(t, cfg, {
      backend: 'native',
      version: i.engineVersion,
      build: i.isa,
      workers: i.threads,
      autoThreads: i.threads,
      simd: t.simd,
      simdSupported: simdOk,
      cores,
      native: { threads: i.threads, isa: i.isa, simd: i.simd, os: i.os, arch: i.arch, engineVersion: i.engineVersion },
    });
    return;
  }
  const loaded = await loadEngineModule(base, { simd: cfg.simd !== 'OFF' });
  if (gen !== engineGen) return;
  if ('error' in loaded) {
    console.warn(`path tracer: ${loaded.detail}`);
    ui.set({ engine: loaded.error });
    return;
  }
  const auto = poolSize(navigator.hardwareConcurrency);
  const size = cfg.threads > 0 ? cfg.threads : auto;
  try {
    const pool = await Pool.create(loaded.module, size, () => new Worker(new URL('./render/worker.ts', import.meta.url), { type: 'module' }));
    if (gen !== engineGen) {
      pool.dispose();
      return;
    }
    const t = new PathTracerEngine(pool, sceneSource, loaded.simd);
    poolCfg = { backend: 'wasm', threads: cfg.threads, simd: cfg.simd };
    useTracer(t, cfg, { backend: 'wasm', version: t.version, build: loaded.simd ? 'rt-simd.wasm' : 'rt.wasm', workers: pool.size, autoThreads: auto, simd: loaded.simd, simdSupported: simdOk, cores });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`path tracer: ${reason}`);
    ui.set({ engine: reason === 'outdated' ? 'OUTDATED' : 'FAILED' });
  }
}

/** Settings ▸ Render engine and ▸ Preferences: live where it can be, a restarted engine where it must. */
function configureEngine(cfg: EngineConfig): void {
  const first = engineCfg === null;
  engineCfg = cfg;
  if (!preview) {
    ui.set({ engine: 'FAILED' });
    return;
  }
  if (first) {
    void startEngine(cfg);
    return;
  }
  tracer?.setGestureResolution(cfg.gestureResolution);
  tracer?.setViewportLimit(cfg.viewportLimit);
  void nativeReady.then((native) => {
    const backend = native && cfg.backend !== 'WASM' ? 'native' : 'wasm';
    // The native engine's threads are the launcher's (--threads): only the backend restarts it.
    const needs = !poolCfg || poolCfg.backend !== backend || (backend === 'wasm' && (poolCfg.threads !== cfg.threads || poolCfg.simd !== cfg.simd));
    if (needs && (tracer || ui.get().engine !== 'LOADING')) {
      // A field being dragged restarts the engine once, when it settles.
      window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(() => void startEngine(engineCfg!), 400);
    }
  });
}

/**
 * The AI model catalogue: the data. Only a build made with `vite build --mode model-test` (the browser check of
 * phase U6) also reads `?testModels=<base64 JSON>`, models served by a local test server; in every other build
 * this branch is removed at build time (the mode is a constant).
 */
function modelCatalogue(): AiModelsCatalogue {
  if (import.meta.env.MODE !== 'model-test') return AI_MODELS;
  const raw = new URLSearchParams(window.location.search).get('testModels');
  if (!raw) return AI_MODELS;
  try {
    const extra = JSON.parse(atob(raw)) as AiModelEntry[];
    return { ...AI_MODELS, models: [...AI_MODELS.models, ...extra] };
  } catch {
    return AI_MODELS;
  }
}

/** The model worker: the OPFS store in the browser, and the hashing of imported files in both. */
const spawnModelWorker = () => new Worker(new URL('./io/model-worker.ts', import.meta.url), { type: 'module' });
const MODELS_KEY = 'models.downloads';
const hasOpfs = typeof (navigator as Navigator & { storage?: { getDirectory?: unknown } }).storage?.getDirectory === 'function';

/** What the desktop installer chose to download, read before the manager takes it (then there is no chooser). */
let pendingAtStart: PendingModels | null = null;

/**
 * The model manager: on the desktop the launcher's data folder (its API), in the browser OPFS through the model
 * worker; none where the browser has no private file system. It exists at once and reads "loading" until it is
 * known whether this page is in the launcher's window.
 */
const modelsService = (() => {
  // The worker is only started when something is asked of it.
  const local = workerModelStore(spawnModelWorker);
  const store = nativeReady.then(async (native) => {
    if (!native) return hasOpfs ? local : null;
    pendingAtStart = await native.pendingModels().catch(() => null);
    // A file chosen in the launcher's dialog stays there: the launcher hashes it.
    return nativeModelStore(native, (blob, onProgress) => (blob instanceof NativeFile ? hashNativeFile(native, blob, onProgress) : local.hash(blob, onProgress)));
  });
  const manager = new DownloadManager({
    store,
    storeError: 'opfs',
    catalogue: modelCatalogue(),
    fetch: (url, init) => fetch(url, init),
    persist: {
      load: () => readPref<DownloadMemory | null>(MODELS_KEY, null as unknown as DownloadMemory) ?? null,
      save: (m) => writePref(MODELS_KEY, m),
    },
    // Asks the browser to keep OPFS (the launcher's folder is not the browser's to evict).
    requestPersistence: async () => ((await nativeReady) ? true : ((await navigator.storage?.persist?.()) ?? false)),
  });
  manager.subscribe((snap) => ui.set({ models: snap }));
  ui.set({ models: manager.snapshot() });
  return { manager, started: manager.start() };
})();

let firstFrame = false;
const viewport: ViewportPort | null = preview
  ? {
      get kind() {
        return full ? ('pathtracer' as const) : ('preview' as const);
      },
      canvas,
      backdrop,
      resize: (w, h, dpr) => {
        Object.assign(lastSize, { w, h, dpr });
        preview!.resize(w, h, dpr);
        tracer?.resize(w, h, dpr);
      },
      // Picking is geometry: the preview's, in both modes.
      pick: (x, y) => preview!.pick(x, y),
      setHover: (ids) => preview!.setHover(ids),
      setTool: (tool) => preview!.setTool(tool),
      setGizmo: (spec) => preview!.setGizmo(spec),
      gizmoHover: (x, y) => preview!.gizmoHover(x, y),
      gizmoBegin: (x, y) => {
        const handle = preview!.gizmoBegin(x, y);
        // Dragging a handle is a gesture for the path tracer too: reduced resolution until it ends.
        if (handle && full) tracer?.beginGesture();
        return handle;
      },
      gizmoDrag: (x, y) => preview!.gizmoDrag(x, y),
      gizmoEnd: () => {
        preview!.gizmoEnd();
        tracer?.endGesture();
      },
      status: () => (full && tracer ? tracer.status() : preview!.status()),
      onFrame: (fn) => {
        const off = preview!.onFrame(fn);
        tracerFrames.add(fn);
        return () => {
          off();
          tracerFrames.delete(fn);
        };
      },
      materialThumbnail: (mat, key) => thumbs.get(mat, key),
      thumbnailsPending: () => thumbs.pendingCount(),
      setNavigation: (nav) => preview!.setNavigation(nav),
      setDisplay: (d) => preview!.setDisplay(d),
    }
  : null;

// The results history (IndexedDB, or memory when the browser keeps nothing) and where outputs go: the browser's
// downloads or a folder of its file system access, and on the desktop the launcher's folders.
const resultsReady = openResultsStore(historyLimits(startSettings));
/** A dialog of the launcher did not open: why, in a toast. */
const dialogError = (code: string) => ui.toast(t(code === 'no-dialog' ? 'dialog.err.noDialog' : code === 'dialog-open' ? 'dialog.err.busy' : 'dialog.err.failed'));
const localMemory = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const files = whenReady<FilesService>(
  createFiles(
    {
      putHandle: async (id, handle) => (await resultsReady).putHandle(id, handle),
      getHandle: async (id) => (await resultsReady).getHandle(id),
    },
    download,
    window as unknown as { showDirectoryPicker?: unknown; isSecureContext?: boolean },
  ),
  desktopIo.then((n) => n && createDesktopFiles(n, { folderTitle: () => t('dialog.chooseFolder'), confirmTitle: () => t('dialog.confirmFolder'), folderItem: () => t('dialog.folderItem'), onDialogError: dialogError, memory: localMemory })),
);

const LAST_PROJECT_HANDLE = 'project:last';
const services: AppServices = {
  viewport,
  async renderFrame(req) {
    // Render and every queue job use the path tracer, whatever the viewport shows; without the engine there is
    // no render (the preview is never passed off as one).
    if (!tracer) throw new Error(t('render.noEngine'));
    const linear = req.format === 'EXR' || (req.format === 'PNG' && req.bitDepth === 16);
    const px = await tracer.renderPixels({
      width: req.width,
      height: req.height,
      finishBy: req.finishBy,
      maxSamples: req.maxSamples,
      maxSeconds: req.maxSeconds,
      transparent: req.transparent,
      signal: req.signal,
      keepLinear: linear,
      ...(req.camera ? { camera: req.camera } : {}),
      ...(req.time !== undefined ? { time: req.time } : {}),
      ...(req.advanced ? { advanced: req.advanced } : {}),
      onProgress: (p) => req.onProgress?.(p.progress, p.samples, p.seconds),
    });
    let file: Blob;
    let display: Blob | null = null;
    if (req.format === 'EXR') {
      const data = linearRgba(px.sum!, px.samples, px.exposureEv);
      file = new Blob([encodeExr({ width: px.width, height: px.height, data }, { alpha: req.transparent }) as Uint8Array<ArrayBuffer>], { type: 'image/x-exr' });
      // Browsers do not show EXR: the viewer and the thumbnails use the 8-bit image of the same render.
      display = await encodePixels(px, 'PNG', 0.92, { dpi: req.dpi });
    } else if (req.format === 'PNG' && req.bitDepth === 16) {
      const words = exactWords16(px.sum!, px.samples, px.exposureEv, px.tonemap);
      file = new Blob([(await encodePng16({ width: px.width, height: px.height, data: words }, { dpi: req.dpi })) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
    } else file = await encodePixels(px, req.format === 'JPEG' ? 'JPEG' : 'PNG', req.jpegQuality / 100, { dpi: req.dpi });
    return { file, display, width: px.width, height: px.height, samples: px.samples, seconds: px.seconds };
  },
  results: {
    persistent: async () => (await resultsReady).persistent,
    list: async () => (await resultsReady).list(),
    add: async (meta, file, display) => (await resultsReady).add(meta, file, display),
    get: async (id) => (await resultsReady).get(id),
    remove: async (id) => (await resultsReady).remove(id),
    clear: async () => (await resultsReady).clear(),
    setLimits: async (limits) => (await resultsReady).setLimits(limits),
  },
  files,
  async renderImage(req) {
    const opts = {
      width: req.width,
      height: req.height,
      maxSamples: req.maxSamples,
      maxSeconds: req.maxSeconds,
      transparent: req.transparent,
      camera: req.camera,
      signal: req.signal,
      onProgress: (p: { progress: number; samples: number }) => req.onProgress?.(p.progress, p.samples),
    };
    // Render and every queue job use the path tracer, whatever the viewport shows. Without the
    // engine there is no render: the preview is never passed off as one (only `quick` thumbnails
    // use it).
    if (!req.quick) {
      if (!tracer) throw new Error(t('render.noEngine'));
      return encodePixels(await tracer.renderPixels(opts), req.format);
    }
    if (!preview) throw new Error('WebGL');
    return encodeImage(await preview.render(opts), req.format);
  },
  captureViewport: () => (full && tracer ? tracer.capture() : preview ? preview.capture() : Promise.resolve(null)),
  exportScene(state) {
    const { scene } = projectScene(state, { width: state.render.width, height: state.render.height, maxSamples: state.render.maxSamples, maxSeconds: state.render.maxSeconds, transparent: state.render.transparent && state.render.format === 'PNG' });
    return new Blob([writeRsb(scene) as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
  },
  async importFile(file, options) {
    const { importFile } = await import('./io/import');
    return importFile(file, options);
  },
  project: { serialize: serializeProject, open: readProjectFile },
  projectFiles: whenReady(
    createProjectFiles(window as never, download, {
      description: () => t('project.fileType'),
      // The last project file's handle, next to the output folders' handles (General ▸ On start ▸ Last project).
      remember: { put: async (h) => (await resultsReady).putHandle(LAST_PROJECT_HANDLE, h), get: async () => (await resultsReady).getHandle(LAST_PROJECT_HANDLE) },
    }),
    desktopIo.then((n) => n && createDesktopProjectFiles(n, { description: () => t('project.fileType'), openTitle: () => t('dialog.openProject'), saveTitle: () => t('dialog.saveProject'), allFiles: () => t('dialog.allFiles'), onDialogError: dialogError })),
  ),
  library: {
    export: (lib) => new Blob([exportLibrary(lib)], { type: 'application/json' }),
    import: importLibrary,
  },
  engine: {
    configure: configureEngine,
    async measure({ seconds, signal, onProgress }) {
      // The example scene, framed, in a project of its own: the open one is not touched.
      if (!tracer) throw new Error(t('render.noEngine'));
      const example = createStore(createInitialState());
      example.dispatch({ type: 'scene/addModel', payload: buildExample(exampleNames()), replace: true });
      example.dispatch({ type: 'camera/frame' });
      const width = 640;
      const height = 360;
      const px = await tracer.renderPixels({ state: example.get(), width, height, finishBy: 'TIME', maxSamples: 100000, maxSeconds: seconds, transparent: false, signal, onProgress: (p) => onProgress?.(p.seconds) });
      if (px.samples <= 0 || px.seconds <= 0) throw new Error('no samples');
      const workers = tracer.workers;
      const engine = tracer instanceof NativeEngine ? t('viewport.native', { threads: tracer.info.threads, isa: isaLabel(tracer.info.isa) }) : t('viewport.pool', { workers, isa: tracer.simd ? t('status.isaSimd') : t('status.isaScalar') });
      return {
        width,
        height,
        samples: px.samples,
        seconds: px.seconds,
        pixelSamplesPerSecond: (px.samples * width * height) / px.seconds,
        engine,
      };
    },
  },
  models: modelsService.manager,
  async hardware(again) {
    const native = await nativeReady;
    // The launcher keeps what it detected; "Detect again" asks it to look again.
    return native ? fromNativeHardware(await native.hardware(undefined, again === true)) : detectWebHardware();
  },
  storage: {
    async estimate() {
      try {
        const e = await navigator.storage?.estimate?.();
        return e && typeof e.usage === 'number' && typeof e.quota === 'number' ? { usage: e.usage, quota: e.quota } : null;
      } catch {
        return null;
      }
    },
    async persisted() {
      try {
        return typeof navigator.storage?.persisted === 'function' ? await navigator.storage.persisted() : null;
      } catch {
        return null;
      }
    },
    async persist() {
      try {
        return typeof navigator.storage?.persist === 'function' ? await navigator.storage.persist() : null;
      } catch {
        return null;
      }
    },
    libraryBytes() {
      try {
        return (window.localStorage.getItem(LIBRARY_STORAGE_KEY)?.length ?? 0) * 2;
      } catch {
        return 0;
      }
    },
    cacheBytes: thumbCacheBytes,
    clearCache: clearThumbCache,
  },
  windowHost,
  // Only reached where ui.desktop is set (the launcher answered).
  desktop: {
    async openFolder(target) {
      const native = await nativeReady;
      if (!native) throw new Error('not in the desktop application');
      await native.openFolder(target);
    },
    // The app window of the launcher's browser closes from the page (it has one history entry).
    closeWindow: () => window.close(),
  },
  updates: { latest: () => fetchLatestRelease() },
  // Links out of the application (https only): the system's browser on the desktop, a new tab in the browser.
  async openExternal(url) {
    if (!/^https:\/\/[^\s"'<>\\^`{|}]+$/.test(url)) return;
    const native = await nativeReady;
    if (native?.hasFiles) await native.openUrl(url);
    else if (!native) openInNewTab(url);
    else throw new Error('this launcher cannot open links');
  },
  // The system's dialogs for imports and exports: set once the launcher answered (null in the browser).
  dialogs: null,
  async licenceText(path) {
    // Only the licence texts shipped with the build (tools/licences.mjs, tools/vendor.mjs).
    if (!/^(licences\/[A-Za-z0-9._-]+|vendor\/occt-import-js\/license\.[a-z-]+\.txt)$/.test(path)) return null;
    try {
      const res = await fetch(new URL(path, base).href);
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || type.includes('text/html')) return null;
      return await res.text();
    } catch {
      return null;
    }
  },
};

const app = mountApp(appEl, store, ui, services);
void loadResults(app.ctx);

// The desktop launcher's window (P2): its folders, its model store and, in a portable folder's first start, the
// model chooser. In the browser this resolves at once to null: OPFS models, no Desktop section.
void nativeReady.then(async (native) => {
  if (!native) return;
  // The desktop window: Ctrl/⌘ W asks our own question, links open in the system's browser.
  guards.setDesktop(true, {
    onClose: () => requestCloseWindow(app.ctx),
    openExternal: (url) => void services.openExternal(url).catch((err: unknown) => console.warn(`open ${url}: ${err instanceof Error ? err.message : String(err)}`)),
  });
  if (native.hasFiles) services.dialogs = createDesktopDialogs(native, dialogError);
  // The inference runtime of the AI post-processing (X3b): Settings ▸ AI post-processing ▸ Runtime.
  if ((native.info.aiApi ?? 0) >= 1) services.aiRuntime = new AiRuntimeClient(native);
  const i = native.info;
  ui.set({ desktop: { portable: i.portable, dataDir: i.dataDir, modelsDir: i.modelsDir, logsDir: i.logsDir, browser: i.browser, version: i.version, os: i.os, arch: i.arch, window: i.window ?? null } });
  // The manager has read what the installer chose (if anything) once it has started.
  await modelsService.started;
  maybeShowModelChooser(app.ctx, { portable: i.portable, pending: !!pendingAtStart && pendingAtStart.keys.length > 0 });
});

// Whatever changes the library is kept at once; if the browser cannot keep it, the person is told.
{
  let warned = false;
  ui.subscribe((u, prev) => {
    if (u.library === prev.library) return;
    const status = saveLibrary(u.library);
    if (status !== 'ok' && !warned) {
      warned = true;
      ui.toast(t(status === 'failed' ? 'library.saveFailed' : 'library.saveNoThumbs'));
    }
    if (status === 'ok') warned = false;
  });
  // Another tab changed it: follow.
  window.addEventListener('storage', (e) => {
    if (e.key !== LIBRARY_STORAGE_KEY) return;
    const r = loadLibrary();
    if ((r.status === 'ok' || r.status === 'empty') && exportLibrary(r.lib) !== exportLibrary(ui.get().library)) ui.set({ library: r.lib });
  });
  if (loadedLibrary.status === 'corrupt' || loadedLibrary.skipped.length > 0) ui.toast(t('library.loadDamaged'));
}

if (preview) {
  preview.sync(store.get(), null);
  store.subscribe((s, prev) => {
    preview!.sync(s, prev);
    tracer?.sync(s, prev);
  });

  // The outline ink follows the theme (--ink-0).
  const updateInk = () => {
    // The browser may shorten the token (#000); a 2D context normalises any CSS colour to #rrggbb.
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.fillStyle = '#ffffff';
    probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink-0').trim() || '#ffffff';
    const hex = /^#([0-9a-f]{6})$/i.exec(String(probe.fillStyle))?.[1];
    const c = hex ? parseInt(hex, 16) : 0xffffff;
    const lin = (x: number) => {
      const s = x / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    preview!.setInk([lin((c >> 16) & 255), lin((c >> 8) & 255), lin(c & 255)]);
  };
  new MutationObserver(updateInk).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  updateInk();

  // Camera gestures become one undoable action each (wheel ticks close in time join one gesture).
  let gesture = 0;
  let lastEnd = 0;
  preview.onViewChange((v) => {
    const now = performance.now();
    if (now - lastEnd > 450) gesture++;
    lastEnd = now;
    const s = store.get();
    const cam = activeCamera(s);
    const patch = { azimuth: v.azimuth, elevation: v.elevation, distance: v.distance, target: v.target, focusDistance: v.distance, ...(v.orthoWidth ? { orthoWidth: v.orthoWidth } : {}) };
    // A click that did not move the camera (selecting a part, picking a point) leaves no undo entry.
    if (sameView(cam, patch)) return;
    store.dispatch({ type: 'camera/set', id: cam.id, patch, gesture: `orbit${gesture}`, label: L('undo.orbit') });
  });
  preview.onFrame(() => (firstFrame = true));
  // While a camera gesture lasts the store hears nothing; the path tracer follows the live view.
  preview.onGesture((phase, v) => {
    if (!full || !tracer) return;
    if (phase === 'start') tracer.beginGesture();
    else if (phase === 'end') tracer.endGesture();
    else if (v) tracer.gestureView({ azimuth: v.azimuth, elevation: v.elevation, distance: v.distance, target: v.target, focusDistance: v.distance, ...(v.orthoWidth ? { orthoWidth: v.orthoWidth } : {}) });
  });

  // One loop: animation playback, then a frame when something changed.
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = store.get();
    if (s.animation.playing) {
      const total = totalDuration(s);
      if (total <= 0) store.dispatch({ type: 'anim/play', playing: false });
      else {
        const t = s.animation.playhead + dt;
        store.dispatch({ type: 'anim/playhead', t: t > total ? t - total : t });
      }
    }
    preview!.frame();
    if (full) tracer?.frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

applyUrlParams(app.ctx, params);
// General ▸ On start: the example in Standard mode, an empty project, or the last project file offered in the
// header (an empty project until it is opened, and where the browser keeps no file handles).
if (!params.example && startSettings['general.onStart'] === 'EXAMPLE') loadExample(app.ctx);
if (!params.example && startSettings['general.onStart'] === 'LAST') void offerLastProject(app.ctx);

// Ready for screenshots: the interface painted, the viewport drew a frame and
// the material spheres in view are rendered (bounded wait).
const started = performance.now();
void app.painted.then(() => {
  const check = () => {
    const spheresDone = thumbs.pendingCount() === 0;
    const elapsed = performance.now() - started;
    if (((firstFrame || !preview) && spheresDone && elapsed > 300) || elapsed > 9000) {
      requestAnimationFrame(() => {
        appEl.dataset.ready = '1';
        // Updates ▸ Check at startup: once, in the background, now that the interface is there. Never waited for.
        void startupUpdateCheck(app.ctx);
      });
      return;
    }
    setTimeout(check, 100);
  };
  check();
});

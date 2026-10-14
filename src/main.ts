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
// Every service that keeps something or asks the computer comes from the
// platform (io/platform.ts), chosen once before anything is drawn: the
// browser's storage in the web version, the launcher's data folder and
// detection in the desktop application (where the page is only the interface).

import './ui/theme.css';
import './ui/layout.css';
import './ui/components.css';
import './ui/panels.css';
import './ui/render.css';
import './ui/settings.css';
import './ui/guards.css';
import './ui/tour.css';
import { createSyntheticService } from './ai/synthetic';
import { notBuiltService } from './ai/not-built';
import { buildPrompt, guardMaterials } from './ai/prompt';
import type { AiPostService, LinearImage } from './core/ai';
import { AI_GUARD_PASSES, pipelineOf } from './core/ai-post';
import { linearToRgba8, linearToSrgb, rgba8ToLinear } from './core/ai-image';
import { evaluate, totalDuration } from './core/animation';
import { AI_MODELS, type AiModelEntry, type AiModelsCatalogue } from './data/ai-models';
import { activeCamera, sameView, type CameraState } from './core/camera';
import { lookThroughAction, lookThroughCamera, sameObject, type ViewObject } from './core/view-objects';
import { historyLimits, startViewportMode, withProjectDefaults, type Layout, type SettingKey, type Settings, type SettingsDoc } from './core/settings';
import { createInitialState, createStore } from './core/store';
import { DownloadManager, type DownloadMemory } from './io/downloads';
import { workerModelStore } from './io/model-store';
import { buildExample } from './core/example';
import { encodeExr, encodeImage, encodePixels, encodePng16 } from './io/image';
import { exportLibrary, importLibrary } from './io/library';
import { connectHost, downloadsFor } from './io/host';
import { AiRuntimeClient } from './io/ai-runtime';
import { DesktopAiService } from './io/ai-post';
import type { PendingModels } from './io/native';
import { choosePlatform } from './io/platform';
import { readPref, writePref } from './io/prefs';
import { readProjectFile, serializeProject } from './io/project';
import { fetchLatestRelease } from './io/updates';
import { projectScene, tonemapFor, writeRsb } from './io/rsb';
import { NativeEngine } from './render/native';
import { loadEngineModule, PathTracerEngine, Pool, simdSupported, type SceneSource } from './render/pathtracer';
import { PreviewEngine } from './render/preview';
import { ThumbnailRenderer } from './render/thumbs';
import { exactWords16, linearRgba, poolSize, straightBytes, straightExr, straightWords16 } from './render/tiles';
import { mountApp } from './ui/app';
import { cameraLabel, lightName } from './ui/names';
import { applyInstallerChoice, detectHardware, exampleNames, loadExample, loadResults, maybeShowModelChooser, offerLastProject, requestCloseWindow } from './ui/commands';
import { startupRuntimeCheck } from './ui/ai-runtime-state';
import { installGuards } from './ui/guards';
import { downloadBlob, openInNewTab } from './ui/dom';
import { startupUpdateCheck } from './ui/updates';
import { maybeStartTour } from './ui/tour';
import type { AiPort, AppServices, EngineConfig, ViewportPort } from './ui/ports';
import { aiRuntimeQuery } from './ui/ai-query';
import { isaLabel, L, setStringsPlatform, t } from './ui/strings';
import { createUiStore, effectiveMode, type EngineInfo } from './ui/ui-state';
import { applyUrlParams, readUrlParams } from './ui/url-params';

const appEl = document.getElementById('app')!;
// The page behaves like an application: no browser menus, selection, zoom, reload, print... (ui/guards.ts).
const guards = installGuards(window, import.meta.env.PROD);
// The platform, once: in the desktop launcher's window (its token leaves the address bar at once) every service
// and every byte of state is the launcher's (P3e), its dialogs and file API included (P3b), and the heartbeat
// keeps it running while this page is open; in the browser the page keeps its own. The desktop's words never
// speak of a browser.
const platform = await choosePlatform();
const nativeReady = Promise.resolve(platform.native);
platform.native?.startHeartbeat();
setStringsPlatform(platform.kind);
// Repackshot's own window (P3c, WebView2): known at once, before the interface decides on beforeunload.
// Null in a browser and in the browser's app window.
const windowHost = connectHost();
// In that window nothing is ever downloaded: every file goes through the launcher's dialogs (P3b).
const download = downloadsFor(windowHost, downloadBlob, () => ui.toast(t('dialog.err.notReady')));
const params = readUrlParams(window.location.search);

// The application settings (U6, core/settings.ts): one document, in localStorage on the web and in
// `settings.json` of the data folder on the desktop, migrated from the loose preferences of before. ?theme and
// ?lang (demos, screenshots) take effect for this session only: they are not saved unless the person changes
// them here.
const settingsDoc: SettingsDoc = platform.settings.initial.doc;
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
// The user's library (U4) lives in the interface state and in the platform's store (one localStorage entry on
// the web, `library/library.json` on the desktop).
const loadedLibrary = platform.library.initial;
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
    platform.settings.save(settingsDoc);
  }, 120);
};
const nativeInfo = platform.native?.info ?? null;
const ui = createUiStore(
  {
    library: loadedLibrary.lib,
    settings: startSettings,
    viewportMode: startViewportMode(startSettings, settingsDoc.layout.viewportMode),
    // The desktop launcher's window (P2): its folders and what draws the window, known before the first paint.
    desktop: nativeInfo
      ? {
          portable: nativeInfo.portable,
          dataDir: nativeInfo.dataDir,
          modelsDir: nativeInfo.modelsDir,
          logsDir: nativeInfo.logsDir,
          browser: nativeInfo.browser,
          version: nativeInfo.version,
          os: nativeInfo.os,
          arch: nativeInfo.arch,
          window: nativeInfo.window ?? null,
        }
      : null,
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
  // The launcher stops this window's render jobs at once (the requests outlive the page); were the page to come
  // back from the browser's cache, the viewport posts its view again.
  if (tracer instanceof NativeEngine) tracer.release();
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    settingsDoc.layout = savedLayout;
    platform.settings.save(settingsDoc, { final: true });
  }
  // The desktop: what the launcher has not confirmed yet goes again, so that it outlives the window.
  platform.flush();
});
// A write the platform could not make (the desktop launcher refused or did not answer): said once per kind.
{
  const told = new Set<string>();
  platform.onWriteError((what) => {
    if (told.has(what)) return;
    told.add(what);
    ui.toast(t(what === 'library' ? 'library.saveFailed' : 'store.saveFailed'));
  });
}

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
const thumbs = new ThumbnailRenderer(platform.thumbs);

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
/** Look through (L4): what the viewport looks through, and the camera the path tracer renders from for it. */
let lookingThrough: ViewObject | null = null;
let viewCameraFn: ((state: ProjectStateOf) => CameraState | null) | null = null;
type ProjectStateOf = ReturnType<typeof store.get>;

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
  t.setWhileRender(cfg.whileRender);
  t.mount(backdrop);
  t.setViewCamera(viewCameraFn);
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
  tracer?.setWhileRender(cfg.whileRender);
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
  const store = (async () => {
    pendingAtStart = await platform.pendingModels();
    return platform.modelStore(local);
  })();
  const manager = new DownloadManager({
    store,
    storeError: 'opfs',
    catalogue: modelCatalogue(),
    fetch: (url, init) => fetch(url, init),
    persist: {
      load: () => readPref<DownloadMemory | null>(platform.memory, MODELS_KEY, null),
      save: (m) => writePref(platform.memory, MODELS_KEY, m),
    },
    // Asks the browser to keep OPFS (the launcher's folder is not the browser's to evict).
    requestPersistence: () => platform.requestPersistence(),
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
      setHoverFaces: (spec) => preview!.setHoverFaces(spec),
      projection: () => preview!.projection(),
      visibleTriangles: (part, rect) => preview!.visibleTriangles(part, rect),
      setTool: (tool) => preview!.setTool(tool),
      setGizmo: (spec) => preview!.setGizmo(spec),
      setGlyphs: (spec) => {
        preview!.setGlyphs(spec);
        // Full mode renders from the same view (worked out from each state: it moves with the light).
        if (!sameObject(spec.lookThrough, lookingThrough)) {
          const lt = spec.lookThrough;
          lookingThrough = lt;
          viewCameraFn = lt ? (state) => lookThroughCamera(state, lt) : null;
          tracer?.setViewCamera(viewCameraFn);
        }
      },
      glyphAt: (x, y) => preview!.glyphAt(x, y),
      objectAt: (obj) => preview!.objectAt(obj),
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

// The results history (IndexedDB, or memory when the browser keeps nothing; the launcher's results folder on the
// desktop) and where outputs go: the browser's downloads or a folder of its file system access, and on the desktop
// the launcher's dialogs and folders (P3b), all through the platform.
const resultsReady = platform.openResults(historyLimits(startSettings));
/** A dialog of the launcher did not open: why, in a toast. */
const dialogError = (code: string) => ui.toast(t(code === 'no-dialog' ? 'dialog.err.noDialog' : code === 'dialog-open' ? 'dialog.err.busy' : 'dialog.err.failed'));
const files = platform.files({
  handles: {
    putHandle: async (id, handle) => (await resultsReady).putHandle(id, handle),
    getHandle: async (id) => (await resultsReady).getHandle(id),
  },
  download,
  folderTitle: () => t('dialog.chooseFolder'),
  confirmTitle: () => t('dialog.confirmFolder'),
  folderItem: () => t('dialog.folderItem'),
  onDialogError: dialogError,
});

// AI post-processing (AI-POST.md §4, §7): the pipeline the interface talks to, and what it needs around it. In the
// desktop launcher's window that reports the pipeline (`aiPost`, X3c) it is the launcher's (io/ai-post.ts: tiles,
// stable-diffusion.cpp and the guard run natively); the web says it is not built yet (X3d). The synthetic service
// (no model, deterministic) runs only when the page is opened with ?ai=synthetic, for tests and screenshots. Whether
// the switch can be on is what `status()` says.
const aiServiceReady: Promise<AiPostService> =
  params.ai === 'synthetic' ? Promise.resolve(createSyntheticService()) : nativeReady.then((native) => (native && (native.info.aiPost ?? 0) >= 1 ? new DesktopAiService(native, () => aiRuntimeQuery(ui.get())) : notBuiltService));
const aiService: AiPostService = {
  status: async () => (await aiServiceReady).status(),
  post: async (request, onProgress, signal) => (await aiServiceReady).post(request, onProgress, signal),
};

/** A picture file as linear light (8-bit display values decoded with the sRGB curve). */
async function decodeLinear(blob: Blob): Promise<LinearImage> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return rgba8ToLinear(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

/** A linear image as a file in the job's format. */
async function encodeLinear(img: LinearImage, o: Parameters<AiPort['encode']>[1]): Promise<Blob> {
  const { width, height, rgba } = img;
  if (o.tone) {
    // The render's own light (the RENDER source): written exactly as the engine's file was (render/tiles.ts).
    const { exposureEv, tonemap } = o.tone;
    if (o.format === 'EXR') return new Blob([encodeExr({ width, height, data: straightExr(rgba, exposureEv) }, { alpha: o.transparent }) as Uint8Array<ArrayBuffer>], { type: 'image/x-exr' });
    if (o.format === 'PNG' && o.bitDepth === 16) return new Blob([(await encodePng16({ width, height, data: straightWords16(rgba, exposureEv, tonemap) }, { dpi: o.dpi })) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
    return encodePixels({ width, height, data: straightBytes(rgba, exposureEv, tonemap) }, o.format === 'JPEG' ? 'JPEG' : 'PNG', o.jpegQuality / 100, { dpi: o.dpi });
  }
  if (o.format === 'EXR') {
    // EXR holds premultiplied alpha.
    const data = new Float32Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3];
      data[i] = rgba[i] * a;
      data[i + 1] = rgba[i + 1] * a;
      data[i + 2] = rgba[i + 2] * a;
      data[i + 3] = a;
    }
    return new Blob([encodeExr({ width, height, data }, { alpha: o.transparent }) as Uint8Array<ArrayBuffer>], { type: 'image/x-exr' });
  }
  if (o.format === 'PNG' && o.bitDepth === 16) {
    const words = new Uint16Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      for (let c = 0; c < 3; c++) words[i + c] = Math.round(Math.min(1, linearToSrgb(rgba[i + c])) * 65535);
      words[i + 3] = Math.round(Math.max(0, Math.min(1, rgba[i + 3])) * 65535);
    }
    return new Blob([(await encodePng16({ width, height, data: words }, { dpi: o.dpi })) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
  }
  return encodePixels({ width, height, data: linearToRgba8(img) }, o.format === 'JPEG' ? 'JPEG' : 'PNG', o.jpegQuality / 100, { dpi: o.dpi });
}

const aiPort: AiPort | null = preview
  ? {
      service: aiService,
      async frame(req) {
        const view = { width: req.width, height: req.height, maxSamples: 1, maxSeconds: 0, ...(req.camera ? { camera: req.camera } : {}) };
        // The ids are the engine's own (io/rsb.ts); the passes and, in Fast mode, the picture come from three.js.
        const out = preview!.aiFrame({ width: req.width, height: req.height, ...(req.camera ? { camera: req.camera } : {}), ids: projectScene(store.get(), view).ids, colour: req.fullEngine === null });
        if (out.rgba) return { image: rgba8ToLinear(out.rgba, req.width, req.height), passes: out.passes };
        // "Use the full engine for the preview": the path tracer's picture at preview size, the job's budget.
        const fe = req.fullEngine!;
        const done = await services.renderFrame({
          width: req.width,
          height: req.height,
          finishBy: fe.finishBy,
          maxSamples: fe.maxSamples,
          maxSeconds: fe.maxSeconds,
          transparent: false,
          format: 'PNG',
          bitDepth: 8,
          jpegQuality: 92,
          dpi: 72,
          ...(req.camera ? { camera: req.camera } : {}),
          ...(req.signal ? { signal: req.signal } : {}),
        });
        return { image: await decodeLinear(done.file), passes: out.passes };
      },
      async passes(req) {
        const view = { width: req.width, height: req.height, maxSamples: 1, maxSeconds: 0, ...(req.camera ? { camera: req.camera } : {}) };
        return preview!.aiFrame({ width: req.width, height: req.height, ...(req.camera ? { camera: req.camera } : {}), ids: projectScene(store.get(), view).ids, colour: false }).passes;
      },
      decode: decodeLinear,
      encode: encodeLinear,
      // The prompt from the scene's materials and lights, and the fixed negative (AI-POST.md §3.2, src/ai/prompt.ts);
      // with a context (X4b), Settings' system prompt first and the job's own last, fitted to the model.
      scenePrompt: (state, settings, context) => buildPrompt(state, settings ?? pipelineOf(state.render.ai), context),
      // The guard's table, numbered as the engine's scene numbers its materials (io/rsb.ts).
      materials: (state, camera) => guardMaterials(state, projectScene(state, { width: 16, height: 16, maxSamples: 1, maxSeconds: 0, ...(camera ? { camera } : {}) }).materialOrder),
      renderSource: async () => (await aiServiceReady) instanceof DesktopAiService,
    }
  : null;

const LAST_PROJECT_HANDLE = 'project:last';
const services: AppServices = {
  viewport,
  async renderFrame(req) {
    // Render and every queue job use the path tracer, whatever the viewport shows; without the engine there is
    // no render (the preview is never passed off as one).
    if (!tracer) throw new Error(t('render.noEngine'));
    const linear = req.format === 'EXR' || (req.format === 'PNG' && req.bitDepth === 16);
    // The AI step of a Render on the desktop: the launcher keeps the image with the guard's passes (X3c).
    const kept = req.aiPasses === true && tracer instanceof NativeEngine;
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
      ...(kept ? { passes: AI_GUARD_PASSES, passesInLauncher: true } : {}),
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
    return { file, display, width: px.width, height: px.height, samples: px.samples, seconds: px.seconds, tone: { exposureEv: px.exposureEv, tonemap: px.tonemap }, ...(kept && px.renderId !== undefined ? { renderId: String(px.renderId) } : {}) };
  },
  results: {
    persistent: async () => (await resultsReady).persistent,
    list: async () => (await resultsReady).list(),
    add: async (meta, file, display, ai, aiMore) => (await resultsReady).add(meta, file, display, ai, aiMore),
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
  // Projects: the launcher's dialogs and the file it remembers on the desktop (P3b); the browser's file system access,
  // or downloads, on the web.
  projectFiles: platform.projectFiles({
    download,
    description: () => t('project.fileType'),
    openTitle: () => t('dialog.openProject'),
    saveTitle: () => t('dialog.saveProject'),
    allFiles: () => t('dialog.allFiles'),
    onDialogError: dialogError,
    // The web version: the last project file's handle, next to the output folders' handles (General ▸ On start).
    remember: { put: async (h) => (await resultsReady).putHandle(LAST_PROJECT_HANDLE, h), get: async () => (await resultsReady).getHandle(LAST_PROJECT_HANDLE) },
  }),
  ai: aiPort,
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
  // The launcher keeps what it detected on the desktop ("Detect again" asks it to look again); WebGPU on the web.
  hardware: (again) => platform.hardware(again),
  storage: platform.storage,
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
  // The system's dialogs for imports and exports (the launcher's; null in the browser).
  dialogs: platform.dialogs(dialogError),
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
  images: {
    async loadHdri(file) {
      const { loadHdri } = await import('./io/hdri');
      return loadHdri(file.name, new Uint8Array(await file.arrayBuffer()));
    },
    async loadBackplate(file) {
      const { loadBackplate } = await import('./io/hdri');
      return loadBackplate(file.name, new Uint8Array(await file.arrayBuffer()));
    },
  },
};

const app = mountApp(appEl, store, ui, services);
void loadResults(app.ctx);

// The desktop launcher's window (P2): its folders, its model store and, in a portable folder's first start, the
// model chooser. In the browser this resolves at once to null: OPFS models, no Desktop section. `desktopStart` is
// settled when all of that has had its turn (the guided tour waits for it: the chooser comes first).
const desktopStart = nativeReady.then(async (native) => {
  if (!native) return;
  // The desktop window: Ctrl/⌘ W asks our own question, links open in the system's browser.
  guards.setDesktop(true, {
    onClose: () => requestCloseWindow(app.ctx),
    openExternal: (url) => void services.openExternal(url).catch((err: unknown) => console.warn(`open ${url}: ${err instanceof Error ? err.message : String(err)}`)),
  });
  // The inference runtime of the AI post-processing (X3b): Settings ▸ AI post-processing ▸ Runtime.
  if ((native.info.aiApi ?? 0) >= 1) services.aiRuntime = new AiRuntimeClient(native);
  const i = native.info;
  // The AI pipeline (X3c) asks the launcher with the active model, which, unless the person chose one, is the
  // recommendation for this computer: the hardware is detected now, not only when Settings opens.
  if ((i.aiPost ?? 0) >= 1) void detectHardware(app.ctx);
  // The manager has read what the installer chose (if anything) once it has started.
  await modelsService.started;
  // The installer's choice of device is the person's (the runtime it ticked is the launcher's to download).
  if (pendingAtStart) applyInstallerChoice(app.ctx, pendingAtStart);
  maybeShowModelChooser(app.ctx, { portable: i.portable, pending: !!pendingAtStart && pendingAtStart.keys.length > 0 });
  // A model is installed and the inference runtime is not: one quiet note in the status bar, once per session (U10).
  void startupRuntimeCheck(app.ctx);
});

// Whatever changes the library is kept at once; if the browser cannot keep it, the person is told.
{
  let warned = false;
  ui.subscribe((u, prev) => {
    if (u.library === prev.library) return;
    const status = platform.library.save(u.library);
    if (status !== 'ok' && !warned) {
      warned = true;
      ui.toast(t(status === 'failed' ? 'library.saveFailed' : 'library.saveNoThumbs'));
    }
    if (status === 'ok') warned = false;
  });
  // Another tab changed it (the web version): follow.
  platform.onLibraryChange(() => {
    const r = platform.library.reload();
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

  // Camera gestures become one undoable action each (wheel ticks close in time join one gesture). A gesture gets
  // its token when it starts, so what it does while it lasts and where it ends are one entry.
  let gesture = 0;
  let lastEnd = 0;
  const nextGesture = () => {
    const now = performance.now();
    if (now - lastEnd > 450) gesture++;
    lastEnd = now;
  };
  // Looking through a light or a saved camera (L4): the navigation moves that object, live and as one undo entry.
  const lookName = (o: ViewObject) => {
    const s = store.get();
    return o.kind === 'LIGHT' ? { en: lightName(s, o.id, 'en'), es: lightName(s, o.id, 'es') } : cameraLabel(s, s.camera.cameras[o.id]);
  };
  const moveLookedThrough = (v: { azimuth: number; elevation: number; distance: number; target: [number, number, number]; orthoWidth?: number }): boolean => {
    const lt = ui.get().lookThrough;
    if (!lt) return false;
    const action = lookThroughAction(store.get(), lt, v, { gesture: `orbit${gesture}`, label: L('undo.lookThrough', { name: lookName(lt) }) });
    if (action) store.dispatch(action);
    return true;
  };
  preview.onViewChange((v) => {
    lastEnd = performance.now();
    if (moveLookedThrough(v)) return;
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
    if (phase === 'start') nextGesture();
    if (phase === 'move' && v) moveLookedThrough(v);
    if (!full || !tracer) return;
    if (phase === 'start') tracer.beginGesture();
    else if (phase === 'end') tracer.endGesture();
    else if (v) tracer.gestureView({ azimuth: v.azimuth, elevation: v.elevation, distance: v.distance, target: v.target, focusDistance: v.distance, ...(v.orthoWidth ? { orthoWidth: v.orthoWidth } : {}) });
  });

  // One loop: animation playback, then a frame when something changed. The next frame is asked for first: an
  // error in one frame is reported and the loop goes on (it used to stop the viewport for good).
  let last = performance.now();
  let lastError = '';
  const step = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      const text = `viewport frame (${name}): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
      if (text !== lastError) console.error(text);
      lastError = text;
    }
  };
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    step('animation', () => {
      const s = store.get();
      if (s.animation.playing) {
        const total = totalDuration(s);
        if (total <= 0) store.dispatch({ type: 'anim/play', playing: false });
        else {
          const t = s.animation.playhead + dt;
          store.dispatch({ type: 'anim/playhead', t: t > total ? t - total : t });
        }
      }
    });
    step('preview', () => preview!.frame());
    if (full) step('path tracer', () => tracer?.frame());
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
        // The guided tour (phase U10): by itself at the first start only, never under automation (ui/tour.ts). After the
        // desktop's start (the portable's model chooser, which the tour then waits to be closed).
        void desktopStart.catch(() => undefined).then(() => maybeStartTour(app.ctx, { automated: navigator.webdriver === true, param: params.tour ?? null }));
      });
      return;
    }
    setTimeout(check, 100);
  };
  check();
});

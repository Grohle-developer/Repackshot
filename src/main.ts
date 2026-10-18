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
import './ui/material-editor.css';
import './ui/lens-editor.css';
import './ui/guards.css';
import './ui/tour.css';
import { createSyntheticService } from './ai/synthetic';
import { notBuiltService } from './ai/not-built';
import { buildPrompt, guardMaterials, materialName as promptMaterialName } from './ai/prompt';
import type { AiPostService, LinearImage } from './core/ai';
import { AI_GUARD_PASSES, pipelineOf, withGuardTolerances } from './core/ai-post';
import { enginePasses, type LegendPart } from './core/pass-files';
import { linearToRgba8, linearToSrgb, rgba8ToLinear } from './core/ai-image';
import { evaluate, playheadPose, totalDuration } from './core/animation';
import { AI_MODELS, type AiModelEntry, type AiModelsCatalogue } from './data/ai-models';
import { PLUGIN_REGISTRY, validEntries, type PluginRegistryEntry } from './data/plugins';
import { PluginHost, type WorkerLike } from './plugins/host';
import { PluginsService } from './plugins/service';
import { openPluginStore } from './plugins/store';
import { activeCamera, orbitPatch, type CameraState } from './core/camera';
import { focusPickAction, lookThroughAction, lookThroughCamera, sameObject, viewedCamera, type ViewObject } from './core/view-objects';
import { historyLimits, startViewportMode, withProjectDefaults, type Layout, type SettingKey, type Settings, type SettingsDoc } from './core/settings';
import { createInitialState, createStore, reduce, type ProjectState } from './core/store';
import { autoExposure } from './core/image-passes';
import { DownloadManager, type DownloadMemory } from './io/downloads';
import { workerModelStore } from './io/model-store';
import { buildExample } from './core/example';
import { adaptiveOf, DEFAULT_NOISE_THRESHOLD, needsLinearSums, videoLabel } from './core/render';
import { encodeDng, encodeExr, encodeImage, encodePixels, encodePng16, encodeTiff } from './io/image';
import { exportLibrary, importLibrary } from './io/library';
import { connectHost, downloadsFor } from './io/host';
import { AiRuntimeClient } from './io/ai-runtime';
import { DesktopAiService } from './io/ai-post';
import type { PendingModels } from './io/native';
import { choosePlatform } from './io/platform';
import { readPref, writePref } from './io/prefs';
import { readProjectFile, serializeProject } from './io/project';
import { NativeInstaller } from './io/update-install';
import { fetchLatestRelease } from './io/updates';
import { focusPickRsb, lensInfoRsb, projectScene, tonemapFor, writeRsb } from './io/rsb';
import { decodeTexturePixels } from './io/texture-pixels';
import { encodePassFiles } from './io/passes';
import { zipStore } from './io/zip';
import { loadCameraPictures } from './io/aperture';
import { onAperturePicture } from './core/aperture';
import { NativeEngine } from './render/native';
import { loadEngineModule, PathTracerEngine, Pool, simdSupported, type SceneSource } from './render/pathtracer';
import { msaaSamples } from './core/antialias';
import { PreviewEngine } from './render/preview';
import { hasParticleExport } from './render/particles';
import { hasLensInfoExport, readLensVerdict } from './render/lens-info';
import { enginePick, focusSolverOf, hasFocusExports, settledFocusPick } from './render/focus-pick';
import { setFocusSolver } from './core/focus';
import { parseLensInfo, type EngineLensInfo } from './core/traced-lens';
import { engineParticleCap, particleCapFor, setEngineParticleCap } from './core/effects';
import { PhysicsClient } from './render/physics';
import { writePhysicsScene } from './io/phys';
import { bakeLaneCount, GraphWorkers } from './render/graph-client';
import { ThumbnailRenderer } from './render/thumbs';
import { exactWords16 as exactWords16Of, linearRgba, poolSize, straightBytes, straightExr, straightLinear, straightLinearRgba as straightLinearRgbaOf, straightWords16 } from './render/tiles';
import { fadeDisplay, fadeLinear } from './core/fade';
import { mountApp } from './ui/app';
import { watchReset as watchPhysicsReset } from './ui/physics';
import { cameraLabel, lightName } from './ui/names';
import { applyInstallerChoice, detectHardware, exampleNames, loadExample, loadResults, maybeShowModelChooser, offerLastProject, requestCloseWindow } from './ui/commands';
import { startupRuntimeCheck } from './ui/ai-runtime-state';
import { installGuards } from './ui/guards';
import { downloadBlob, openInNewTab } from './ui/dom';
import { startupUpdateCheck, syncInstall } from './ui/updates';
import { maybeStartTour } from './ui/tour';
import type { AiPort, AppServices, EngineConfig, LensCheck, PluginsPort, ViewportPort } from './ui/ports';
import { aiRuntimeQuery } from './ui/ai-query';
import { isaLabel, L, setStringsPlatform, t } from './ui/strings';
import { createUiStore, effectiveMode, type EngineInfo, type VideoSupportUi } from './ui/ui-state';
import { browserVideoEnv, createVideoWriter, probeVideo, type VideoSupport } from './io/video';
import { installDoctorFacts } from './ui/doctor-facts';
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
    viewportMode: startViewportMode(),
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
          afterUpdate: nativeInfo.afterUpdate === true,
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
// M3a: the workers of the material graphs, for the editor's node previews and the Fast preview's bakes.
const graphWorkers = typeof Worker === 'function' ? new GraphWorkers(() => new Worker(new URL('./render/graph-worker.ts', import.meta.url), { type: 'module' }), bakeLaneCount()) : null;
try {
  preview = new PreviewEngine();
  if (graphWorkers) preview.setGraphWorkers(graphWorkers);
  // K3: the Fast mode's automatic exposure is the path tracer's last reading of its image.
  preview.setExposureMeter(() => tracer?.meteredExposure() ?? null);
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
  // K3: the exposure pass of the image state: by hand, or (auto) the compensation over what the engine's image meters.
  tone: (state) => ({ exposureEv: state.image.exposureEv, tonemap: tonemapFor(state.image.viewTransform), ...(autoExposure(state.image) ? { auto: true } : {}) }),
};

let tracer: PathTracerEngine | NativeEngine | null = null;
const physicsClient = new PhysicsClient(
  async () => {
    const loaded = await loadEngineModule(base, { simd: false });
    if ('error' in loaded) throw new Error('NO_ENGINE');
    return loaded.module;
  },
  () => new Worker(new URL('./render/physics-worker.ts', import.meta.url), { type: 'module' }),
);
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
  // While a simulation runs (S2) the viewport shows it in Fast: the path tracer would start again every frame.
  const next = tracer !== null && preview !== null && effectiveMode(ui.get()) === 'FULL' && ui.get().physics.state === 'STOPPED';
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

// The page's own rt.wasm on this thread (the scalar build is enough), loaded once: the Fast preview's particles (S4a:
// the engine's own simulator; without the module the preview draws the region boxes and the meter says so) and the
// numbers of a traced lens (O2).
let pageEngineLoad: Promise<WebAssembly.Exports | null> | null = null;
const pageEngine = (): Promise<WebAssembly.Exports | null> =>
  (pageEngineLoad ??= loadEngineModule(base, { simd: false }).then(async (loaded) => {
    if ('error' in loaded) return null;
    try {
      return (await WebAssembly.instantiate(loaded.module, {})).exports;
    } catch {
      return null;
    }
  }));
if (preview) {
  const p = preview;
  void pageEngine().then((exports) => p.setParticleEngine(exports && hasParticleExport(exports) ? exports : null));
}
// O2: the engine's numbers of a traced lens, from the page's module (or the launcher's, without it), the last few kept.
// O2c: with the engine's reason when it refuses the lens (the lens editor says why).
const lensCheckCache = new Map<string, LensCheck>();
async function engineLensCheck(cam: CameraState): Promise<LensCheck> {
  if (!cam.optics?.traced || cam.projection === 'ORTHOGRAPHIC') return { state: 'none' };
  const rsb = lensInfoRsb(cam, cam.aspect.w, cam.aspect.h);
  const key = Array.from(rsb, (b) => b.toString(16).padStart(2, '0')).join('');
  const kept = lensCheckCache.get(key);
  if (kept) return kept;
  let check: LensCheck = { state: 'none' };
  const exports = await pageEngine();
  if (exports && hasLensInfoExport(exports)) {
    try {
      const v = readLensVerdict(exports, rsb);
      check = v.state === 'ready' ? v : v.state === 'thin' ? { state: 'none' } : { state: 'refused', reason: v.reason };
    } catch {
      // The module trapped: nothing to say of this lens (never a crash of the page).
      return { state: 'none' };
    }
  } else if (platform.native) {
    try {
      const res = await platform.native.request('/api/lens/info', { method: 'POST', body: rsb as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': 'application/octet-stream' } });
      const text = await res.text();
      if (res.ok) {
        const info = parseLensInfo(text);
        check = info ? { state: 'ready', info } : info === null ? { state: 'none' } : { state: 'refused', reason: '' };
      } else {
        let reason = '';
        try {
          const m = (JSON.parse(text) as { message?: unknown }).message;
          reason = typeof m === 'string' ? m : '';
        } catch {
          // Not the launcher's JSON: no reason to give.
        }
        check = { state: 'refused', reason };
      }
    } catch {
      return { state: 'none' };
    }
  }
  if (lensCheckCache.size >= 16) lensCheckCache.delete(lensCheckCache.keys().next().value!);
  lensCheckCache.set(key, check);
  return check;
}
async function engineLensInfo(cam: CameraState): Promise<EngineLensInfo | null | undefined> {
  if (!cam.optics?.traced || cam.projection === 'ORTHOGRAPHIC') return null;
  const c = await engineLensCheck(cam);
  return c.state === 'ready' ? c.info : c.state === 'refused' ? undefined : null;
}
// F1: focus with a click. The pixel's chief ray comes from the engine (render/focus-pick.ts), for the camera of the view
// exactly as the Full view renders it (io/rsb.ts focusPickRsb: the playhead's pose, the camera looked through and its
// frame, the viewport's image round the frame, a traced lens's distortion), and the preview casts it at its geometry
// through both faces (as the engine's triangles are): the point the pixel shows. Without rt.wasm, or with one older than
// F1, the preview's own pick.
async function focusPickAt(x: number, y: number, opts: { settle?: boolean; camera?: string } = {}): Promise<ReturnType<NonNullable<typeof preview>['pick']>> {
  const p = preview;
  if (!p) return null;
  const exports = await pageEngine();
  const { w, h } = lastSize;
  if (exports && hasFocusExports(exports) && w > 0 && h > 0) {
    const look = lookingThrough;
    const rsbOf = (s: ProjectStateOf) => {
      const through = viewCameraFn?.(s) ?? null;
      const cameraPatch = through ? (({ id: _id, ...rest }) => rest)(through) : undefined;
      return focusPickRsb(s, { width: w, height: h, viewport: { viewW: w, viewH: h }, ...(cameraPatch ? { cameraPatch } : {}) });
    };
    // Focus on a point of the camera seen: the pick settles through the camera focused on what it meets (a traced
    // lens breathes). A pick for another camera, or for an object, is the first one.
    const focusedOn = opts.settle
      ? (s: ProjectStateOf, hit: { node: string; point: [number, number, number] }) => {
          const a = focusPickAction(s, look, hit, { label: '' }, playheadPose(s), opts.camera);
          return a ? reduce(s, a) : null;
        }
      : null;
    const cast = (o: [number, number, number], d: [number, number, number]) => p.pickAlong(o, d);
    const hit = settledFocusPick(exports, store.get(), x / w, y / h, rsbOf, cast, focusedOn);
    if (hit) return hit;
    if (enginePick(exports, rsbOf(store.get()), x / w, y / h)) return null;
  }
  return p.pick(x, y);
}
// F1: a traced lens's exact focus on a point (the engine solves it from the lens's real rays: its spherical aberration
// and field curvature put the sharpest image millimetres away from the paraxial focus wide open), for the camera of the
// output frame (io/rsb.ts lensInfoRsb), the last answers kept.
void pageEngine().then((exports) => {
  if (!exports || !hasFocusExports(exports)) return;
  setFocusSolver(focusSolverOf(exports, (cam) => lensInfoRsb(cam, cam.aspect.w, cam.aspect.h)));
  // The Full view's focus on a point through a traced lens is the exact one from now on.
  tracer?.sceneChanged();
});
// The particle cap of the engine that renders here (Settings ▸ Render engine ▸ Particles per effect): the Doctor
// warns about what goes over it and the scene sent to the engine holds at most that many.
const applyParticleCap = () => {
  const u = ui.get();
  const cap = particleCapFor(u.settings['engine.particleCap'], u.engineInfo?.backend === 'native');
  if (cap === engineParticleCap()) return;
  setEngineParticleCap(cap);
  store.dispatch({ type: 'doctor/refresh' });
  // The scene the engine is sent holds at most that many: the Full viewport builds it again.
  tracer?.sceneChanged();
};
applyParticleCap();
ui.subscribe((u, prev) => {
  if (u.settings['engine.particleCap'] !== prev.settings['engine.particleCap'] || u.engineInfo?.backend !== prev.engineInfo?.backend) applyParticleCap();
});

// D1: what the Doctor knows of the engine (the pool, SIMD, the denoise, the speed measured, and what its accumulation
// says), handed in whenever it changes; a tick catches the accumulation, which the engine reads when its samples double.
const doctorFacts = installDoctorFacts(store, ui, () => (full && tracer ? tracer.status() : null));
window.setInterval(doctorFacts.sync, 1000);

const cores = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : null;

const useTracer = (t: PathTracerEngine | NativeEngine, cfg: EngineConfig, info: EngineInfo) => {
  t.setGestureResolution(cfg.gestureResolution);
  t.setViewportLimit(cfg.viewportLimit);
  t.setWhileRender(cfg.whileRender);
  t.setPixelFilter(cfg.pixelFilter);
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
      denoise: true,
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
    useTracer(t, cfg, { backend: 'wasm', version: t.version, build: loaded.simd ? 'rt-simd.wasm' : 'rt.wasm', workers: pool.size, autoThreads: auto, simd: loaded.simd, simdSupported: simdOk, cores, denoise: t.canDenoise });
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
  // E11: Fast mode's multisampling, at once; what the device draws is said in the settings.
  preview.setMsaa(msaaSamples(cfg.fastAa));
  ui.set({ fastAa: preview.msaa() });
  if (first) {
    void startEngine(cfg);
    return;
  }
  tracer?.setGestureResolution(cfg.gestureResolution);
  tracer?.setViewportLimit(cfg.viewportLimit);
  tracer?.setWhileRender(cfg.whileRender);
  tracer?.setPixelFilter(cfg.pixelFilter);
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
      // F1: focus with a click casts the engine's own ray of the pixel (the Full view's camera), else the preview's.
      pickFocus: (x, y, opts) => focusPickAt(x, y, opts),
      setHover: (ids) => preview!.setHover(ids),
      setSelectedEffect: (id) => preview!.setSelectedEffect(id),
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
      setMotionHint: (hint) => preview!.setMotionHint(hint),
      setFocusPlane: (hint) => preview!.setFocusPlane(hint),
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
// C1: every request carries the guard's tolerances of Settings (the queue's and the preview's alike).
const aiService: AiPostService = withGuardTolerances(
  {
    status: async () => (await aiServiceReady).status(),
    post: async (request, onProgress, signal) => (await aiServiceReady).post(request, onProgress, signal),
  },
  () => ui.get().settings,
);

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

const TIFF_TYPE = 'image/tiff';
const DNG_TYPE = 'image/x-adobe-dng';
const blobOf = (bytes: Uint8Array, type: string): Blob => new Blob([bytes as Uint8Array<ArrayBuffer>], { type });

/** A linear image as a file in the job's format. */
async function encodeLinear(img: LinearImage, o: Parameters<AiPort['encode']>[1]): Promise<Blob> {
  const { width, height, rgba } = img;
  if (o.tone) {
    // The render's own light (the RENDER source): written exactly as the engine's file was (render/tiles.ts).
    const { exposureEv, tonemap } = o.tone;
    if (o.format === 'EXR') return new Blob([encodeExr({ width, height, data: straightExr(rgba, exposureEv) }, { alpha: o.transparent }) as Uint8Array<ArrayBuffer>], { type: 'image/x-exr' });
    if (o.format === 'DNG') return blobOf(encodeDng({ width, height, data: straightLinear(rgba, exposureEv) }), DNG_TYPE);
    if (o.format === 'TIFF') {
      const tiff = { alpha: o.transparent, dpi: o.dpi };
      if (o.bitDepth === 32) return blobOf(encodeTiff({ width, height, data: straightLinear(rgba, exposureEv) }, { bits: 32, ...tiff }), TIFF_TYPE);
      if (o.bitDepth === 16) return blobOf(encodeTiff({ width, height, data: straightWords16(rgba, exposureEv, tonemap) }, { bits: 16, ...tiff }), TIFF_TYPE);
      return blobOf(encodeTiff({ width, height, data: straightBytes(rgba, exposureEv, tonemap) }, { bits: 8, ...tiff }), TIFF_TYPE);
    }
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
  // A picture in display light (decoded from 8 bits): the 16-bit words are its sRGB encoding.
  const words16 = () => {
    const words = new Uint16Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      for (let c = 0; c < 3; c++) words[i + c] = Math.round(Math.min(1, linearToSrgb(rgba[i + c])) * 65535);
      words[i + 3] = Math.round(Math.max(0, Math.min(1, rgba[i + 3])) * 65535);
    }
    return words;
  };
  if (o.format === 'DNG') return blobOf(encodeDng({ width, height, data: rgba }), DNG_TYPE);
  if (o.format === 'TIFF') {
    const tiff = { alpha: o.transparent, dpi: o.dpi };
    if (o.bitDepth === 32) return blobOf(encodeTiff({ width, height, data: rgba }, { bits: 32, ...tiff }), TIFF_TYPE);
    if (o.bitDepth === 16) return blobOf(encodeTiff({ width, height, data: words16() }, { bits: 16, ...tiff }), TIFF_TYPE);
    return blobOf(encodeTiff({ width, height, data: linearToRgba8(img) }, { bits: 8, ...tiff }), TIFF_TYPE);
  }
  if (o.format === 'PNG' && o.bitDepth === 16) return new Blob([(await encodePng16({ width, height, data: words16() }, { dpi: o.dpi })) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
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

/**
 * The plugin registry: the data. Only a build made with `vite build --mode plugin-test` (the browser check of phase
 * P6, tools/plugins-check.mjs) also reads `?testPlugins=<base64 JSON>`, entries served by a local test server; in
 * every other build this branch is removed at build time (the mode is a constant), as `?testModels=` is.
 */
function pluginRegistry(): PluginRegistryEntry[] {
  const base = validEntries(PLUGIN_REGISTRY);
  if (import.meta.env.MODE !== 'plugin-test') return base;
  const raw = new URLSearchParams(window.location.search).get('testPlugins');
  if (!raw) return base;
  try {
    // base64 of the JSON's UTF-8 bytes (names have "·" and accents).
    const text = new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)));
    const extra = validEntries({ schema: 1, plugins: JSON.parse(text) as PluginRegistryEntry[] });
    return [...base.filter((e) => !extra.some((x) => x.id === e.id)), ...extra];
  } catch {
    return base;
  }
}

/** A picture file as 8-bit straight RGBA, as it was written (no colour management, no premultiplication). */
async function decodeRgba(blob: Blob): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, rgba: g.getImageData(0, 0, canvas.width, canvas.height).data };
}

// Plugins (P6, src/plugins/): the host with its store (IndexedDB, in the browser and in the desktop's WebView2 alike),
// the module workers it starts from the packages' code, and the decoders a run over a result needs.
const pluginEntries = pluginRegistry();
const pluginStore = openPluginStore();
const pluginHost = new PluginHost({
  store: pluginStore,
  registry: pluginEntries,
  fetch: (url, init) => fetch(url, init),
  spawn: (url) => new Worker(url, { type: 'module', name: 'plugin' }) as unknown as WorkerLike,
  createObjectURL: (b) => URL.createObjectURL(b),
  revokeObjectURL: (u) => URL.revokeObjectURL(u),
  now: () => Date.now(),
});
const pluginsService = new PluginsService({
  host: pluginHost,
  registry: pluginEntries,
  result: async (id) => (await resultsReady).get(id),
  decode: decodeRgba,
  decodeExr: async (bytes) => (await import('./io/hdri')).decodeExr(bytes),
  encodePng: (img) => encodePixels({ width: img.width, height: img.height, data: img.rgba }, 'PNG'),
  store: pluginStore,
  now: () => performance.now(),
});
pluginHost.subscribe((snap) => ui.set({ plugins: snap }));
ui.set({ plugins: pluginHost.snapshot() });
void pluginHost.start().catch((err: unknown) => console.warn(`plugins: ${err instanceof Error ? err.message : String(err)}`));
window.addEventListener('pagehide', () => pluginHost.dispose());
const pluginsPort: PluginsPort = {
  registry: pluginsService.registry,
  snapshot: () => pluginsService.snapshot(),
  subscribe: (fn) => pluginsService.subscribe(fn),
  install: (id) => pluginsService.install(id),
  provideKey: (id, key) => pluginsService.provideKey(id, key),
  cancelInstall: (id) => pluginsService.cancelInstall(id),
  installFile: (file, key) => pluginsService.installFile(file, key),
  remove: (id) => pluginsService.remove(id),
  text: (id, file) => pluginsService.text(id, file),
  presets: (id) => pluginsService.presets(id),
  stop: (id) => pluginsService.stop(id),
  run: (req, signal) => pluginsService.run(req, signal),
  hasBase: (id) => pluginsService.hasBase(id),
  runImage: (req, signal) => pluginsService.runImage(req, signal),
  thumbnails: (id, onThumb, signal) => pluginsService.thumbnails(id, onThumb, signal),
  encode: (img, format, dpi) => encodePixels({ width: img.width, height: img.height, data: img.rgba }, format, 0.92, { dpi }),
};

// N1: encoded video. What this system encodes is asked of the browser once (WebCodecs, for a 1080p frame at 24 fps)
// and kept in the interface state: the render window offers only that, and the Doctor warns of a project that asks
// for more. A job asks again for its own size and rate when it opens its writer.
const videoEnv = browserVideoEnv();
let videoProbe: Promise<VideoSupport> | null = null;
const videoSupport = (): Promise<VideoSupport> => (videoProbe ??= probeVideo(videoEnv));
const videoUi = (v: VideoSupport): VideoSupportUi => ({ MP4: v.MP4 ? 'H264' : null, WEBM: v.WEBM ? (v.WEBM.track === 'VP8' ? 'VP8' : 'VP9') : null });
void videoSupport().then((v) => ui.set({ video: videoUi(v) }));

/**
 * N2: who each id of the part-id pass is: the engine's instance order (`projectScene(...).ids`, what `partId` counts from 1),
 * with the part's name and the material it wears.
 */
function partLegendOf(project: ProjectState, camera?: string): LegendPart[] {
  const { ids } = projectScene(project, { width: 16, height: 16, maxSamples: 1, maxSeconds: 0, ...(camera ? { camera } : {}) });
  return ids.instances.map((inst, i) => {
    const material = inst.material ? project.materials[inst.material] : undefined;
    return { id: i + 1, part: project.scene.nodes[inst.node]?.name ?? inst.node, material: material ? promptMaterialName(material) : null };
  });
}

const LAST_PROJECT_HANDLE = 'project:last';
const services: AppServices = {
  viewport,
  video: {
    support: async () => videoUi(await videoSupport()),
    async open(o) {
      const choice = videoEnv ? (await probeVideo(videoEnv, o.width, o.height, o.fps))[o.container] : null;
      if (!videoEnv || !choice) throw new Error(t('render.videoCannot', { video: videoLabel(o.container) }));
      const w = createVideoWriter(videoEnv, { container: o.container, choice, width: o.width, height: o.height, fps: o.fps });
      return { track: w.track, add: (picture, index) => w.add(picture, index), finish: () => w.finish(), close: () => w.close() };
    },
  },
  async renderFrame(req) {
    // Render and every queue job use the path tracer, whatever the viewport shows; without the engine there is
    // no render (the preview is never passed off as one).
    if (!tracer) throw new Error(t('render.noEngine'));
    // N2: a job with a saved studio renders a copy of the project with the studio on (the open one is not touched).
    const project = req.state ?? store.get();
    // M2b: the texture images the engine reads, decoded before the scene is written.
    await decodeTexturePixels(project);
    const linear = needsLinearSums(req.format, req.bitDepth);
    // The AI step of a Render on the desktop: the launcher keeps the image with the guard's passes (X3c).
    const kept = req.aiPasses === true && tracer instanceof NativeEngine;
    // N2: the pass files asked for. With the AI step beside them the launcher renders both sets (and keeps them for the
    // AI all the same), but then the page reads the planes back too, so they do not stay in the launcher alone.
    const wanted = req.passes && req.passes.keys.length > 0 ? req.passes : null;
    const passKeys = [...new Set([...(kept ? AI_GUARD_PASSES : []), ...(wanted ? enginePasses(wanted.keys) : [])])];
    const px = await tracer.renderPixels({
      width: req.width,
      height: req.height,
      finishBy: req.finishBy,
      maxSamples: req.maxSamples,
      maxSeconds: req.maxSeconds,
      transparent: req.transparent,
      signal: req.signal,
      keepLinear: linear,
      ...(req.state ? { state: req.state } : {}),
      ...(req.camera ? { camera: req.camera } : {}),
      ...(req.time !== undefined ? { time: req.time } : {}),
      ...(req.advanced ? { advanced: req.advanced } : {}),
      // E10: Finish by Noise samples adaptively to its threshold.
      ...adaptiveOf({ finishBy: req.finishBy, noiseThreshold: req.noiseThreshold ?? DEFAULT_NOISE_THRESHOLD }),
      ...(passKeys.length > 0 ? { passes: passKeys } : {}),
      ...(kept && !wanted ? { passesInLauncher: true } : {}),
      // U14: the queue's live view of the job (its box and cadence are the queue's).
      ...(req.frameBox && req.onFrame ? { frameBox: req.frameBox, onFrame: req.onFrame } : {}),
      onProgress: (p) => req.onProgress?.(p.progress, p.samples, p.seconds, p.adaptive),
    });
    // The file in the job's format from the 8-bit pixels and, for 16 bits, EXR, the 32-bit TIFF and DNG, the linear sums.
    // N1: a frame of an animation under a fade to a colour (the camera track's change of shot) is mixed with it: the
    // display picture in its own values, linear light in linear light (core/fade.ts).
    const fade = req.fade ?? null;
    const encode = async (raw: Uint8ClampedArray, sum: Float32Array | undefined): Promise<{ file: Blob; display: Blob | null }> => {
      const data = fadeDisplay(raw, fade, 255);
      const img = { ...px, data };
      const { width, height } = px;
      const straightLinearRgba = (s: Float32Array, n: number, ev: number) => fadeLinear(straightLinearRgbaOf(s, n, ev), fade);
      const exactWords16 = (s: Float32Array, n: number, ev: number, tm: number) => fadeDisplay(exactWords16Of(s, n, ev, tm), fade, 65535);
      if (req.format === 'EXR') {
        const linear = fadeLinear(linearRgba(sum!, px.samples, px.exposureEv), fade);
        const file = new Blob([encodeExr({ width, height, data: linear }, { alpha: req.transparent }) as Uint8Array<ArrayBuffer>], { type: 'image/x-exr' });
        // Browsers do not show EXR: the viewer and the thumbnails use the 8-bit image of the same render.
        return { file, display: await encodePixels(img, 'PNG', 0.92, { dpi: req.dpi }) };
      }
      if (req.format === 'DNG' || req.format === 'TIFF') {
        // TIFF and DNG keep straight alpha, so the linear data is divided by its coverage (EXR keeps it premultiplied).
        const tiff = { alpha: req.transparent, dpi: req.dpi };
        const dng = req.format === 'DNG';
        const file = dng
          ? blobOf(encodeDng({ width, height, data: straightLinearRgba(sum!, px.samples, px.exposureEv) }), DNG_TYPE)
          : req.bitDepth === 32
            ? blobOf(encodeTiff({ width, height, data: straightLinearRgba(sum!, px.samples, px.exposureEv) }, { bits: 32, ...tiff }), TIFF_TYPE)
            : req.bitDepth === 16
              ? blobOf(encodeTiff({ width, height, data: exactWords16(sum!, px.samples, px.exposureEv, px.tonemap) }, { bits: 16, ...tiff }), TIFF_TYPE)
              : blobOf(encodeTiff({ width, height, data }, { bits: 8, ...tiff }), TIFF_TYPE);
        // A browser shows neither: the viewer and the thumbnails get the 8-bit picture of the same render.
        return { file, display: await encodePixels(img, 'PNG', 0.92, { dpi: req.dpi }) };
      }
      if (req.format === 'PNG' && req.bitDepth === 16) {
        const words = exactWords16(sum!, px.samples, px.exposureEv, px.tonemap);
        return { file: new Blob([(await encodePng16({ width, height, data: words }, { dpi: req.dpi })) as Uint8Array<ArrayBuffer>], { type: 'image/png' }), display: null };
      }
      return { file: await encodePixels(img, req.format === 'JPEG' ? 'JPEG' : 'PNG', req.jpegQuality / 100, { dpi: req.dpi }), display: null };
    };
    const { file, display } = await encode(px.data, px.sum);
    // E5b-1, Also save without denoise: the same render before the engine's denoiser, in the same format.
    const noisyFile = px.noisy ? (await encode(px.noisy.data, px.noisy.sum)).file : undefined;
    // N2: the pass files, from the planes the engine rendered with the image.
    let extras: { name: string; blob: Blob }[] | undefined;
    if (wanted) {
      if (!px.passes) throw new Error(t('render.noPasses'));
      const legend = wanted.keys.includes('partId') ? partLegendOf(project, req.camera) : undefined;
      extras = (await encodePassFiles(px.passes, wanted, { imageName: req.imageName ?? 'render.png', dpi: req.dpi, ...(legend ? { legend } : {}) })).map((f) => ({ name: f.name, blob: f.blob }));
    }
    return {
      file,
      display,
      width: px.width,
      height: px.height,
      samples: px.samples,
      seconds: px.seconds,
      tone: { exposureEv: px.exposureEv, tonemap: px.tonemap },
      ...(kept && px.renderId !== undefined ? { renderId: String(px.renderId) } : {}),
      ...(px.denoised ? { denoised: true } : {}),
      ...(noisyFile ? { noisyFile } : {}),
      ...(extras ? { extras } : {}),
    };
  },
  // N2: the ZIP of a batch, written by our own store-method writer.
  archive: { zip: (entries) => zipStore(entries) },
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
      await decodeTexturePixels(store.get());
      return encodePixels(await tracer.renderPixels(opts), req.format);
    }
    if (!preview) throw new Error('WebGL');
    return encodeImage(await preview.render(opts), req.format);
  },
  captureViewport: () => (full && tracer ? tracer.capture() : preview ? preview.capture() : Promise.resolve(null)),
  exportScene(state) {
    // M2b: with the textures `rt` reads (the images decoded since the materials took them); M3b: and the programs; L5: and the IES lights.
    const { scene } = projectScene(state, { width: state.render.width, height: state.render.height, maxSamples: state.render.maxSamples, maxSeconds: state.render.maxSeconds, transparent: state.render.transparent && state.render.format === 'PNG', textures: true, programs: true, ies: true, drops: true });
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
  plugins: pluginsPort,
  // The rigid body simulator (S2): rt-phys in a worker of its own, with the scalar rt.wasm (started on the first
  // simulation). In the desktop window too: the page serves the same module.
  physics: typeof Worker === 'undefined' ? null : {
    run(spec, options, onUpdate) {
      return physicsClient.run(writePhysicsScene(spec), spec.bodies.length, options, onUpdate);
    },
  },
  graphPreview: graphWorkers ? { previews: (program, channel) => graphWorkers.previews(program, channel) } : null,
  lens: { info: engineLensInfo, check: engineLensCheck },
};

const app = mountApp(appEl, store, ui, services);
watchPhysicsReset(app.ctx);
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
  // Updating from inside the application (P5): the launcher downloads, checks and installs; one that was already at it
  // (this page was reloaded) is followed again, and a launcher the previous version started to finish an update says so.
  if ((native.info.updateApi ?? 0) >= 1) {
    services.updates.installer = new NativeInstaller(native);
    void syncInstall(app.ctx);
  }
  if (native.info.afterUpdate) ui.toast(t('up.updated', { version: native.info.version }));
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

// O1: the pupil pictures (aperture masks, textures) a camera's optics name are read once; when one arrives, the
// path tracer starts the image again with it (until then the lens draws its iris).
loadCameraPictures(store.get());
store.subscribe((s) => loadCameraPictures(s));
// O2: the Fast viewport draws the active camera's traced lens with its distortion and falloff, the engine's numbers.
if (preview) {
  const p = preview;
  let asked = '';
  const askLens = (s: ReturnType<typeof store.get>) => {
    const c = activeCamera(s);
    if (!c.optics?.traced || c.projection === 'ORTHOGRAPHIC') {
      if (asked !== '') p.setLensInfo(c.id, null);
      asked = '';
      return;
    }
    const key = JSON.stringify([c.id, c.optics, c.focalMm, c.fstop, c.focusDistance, c.aspect]);
    if (key === asked) return;
    asked = key;
    void engineLensInfo(c).then((info) => {
      if (asked === key) p.setLensInfo(c.id, info ?? null);
    });
  };
  askLens(store.get());
  store.subscribe((s) => askLens(s));
}
onAperturePicture(() => tracer?.sync(store.get(), null));

// M2b: the texture images the materials use, decoded to pixels for the engine (io/texture-pixels.ts) as soon as they
// are there; when new pixels arrive the Full viewport builds its scene again (its mesh key names the decoded images).
const decodeTextures = (state: ReturnType<typeof store.get>) =>
  void decodeTexturePixels(state).then((n) => {
    if (n > 0) tracer?.sceneChanged();
  });
decodeTextures(store.get());
store.subscribe((s, prev) => {
  if (s.materials !== prev.materials) decodeTextures(s);
});

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
    // A click that did not move the camera (selecting a part, picking a point) leaves no undo entry and leaves the
    // focus where it was; an orbit takes the focus along only if it sat at the orbit distance.
    const patch = orbitPatch(cam, v);
    if (!patch) return;
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
    // The camera as it is now (the one looked through, if any): no patch is the camera as it stands, as at the start.
    else if (v) tracer.gestureView(orbitPatch(viewedCamera(store.get(), ui.get().lookThrough), v) ?? {});
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
          // N6: the timeline's Loop; off, playing stops at the end.
          if (t > total && !ui.get().animLoop) {
            store.dispatch({ type: 'anim/playhead', t: total });
            store.dispatch({ type: 'anim/play', playing: false });
          } else store.dispatch({ type: 'anim/playhead', t: t > total ? t - total : t });
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
        // The mode asked for (not the one drawn, which is Fast without an engine too): what the start-mode test reads.
        appEl.dataset.viewportMode = ui.get().viewportMode.toLowerCase();
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

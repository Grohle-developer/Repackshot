// Entry point: creates the store, mounts the interface, starts the two
// viewport engines (the three.js preview, and the path tracer in a pool of
// workers once rt.wasm has loaded) and applies the optional demo / screenshot
// URL parameters (see src/ui/README.md). The header's Fast · Full switch
// picks which one the viewport shows; Render always uses the path tracer.
// Sets #app[data-ready="1"] once the interface has painted and the viewport
// has drawn its first frame.

import './ui/theme.css';
import './ui/layout.css';
import './ui/components.css';
import './ui/panels.css';
import './ui/render.css';
import { evaluate, totalDuration } from './core/animation';
import { activeCamera, sameView } from './core/camera';
import { createInitialState, createStore } from './core/store';
import { createFiles } from './io/files';
import { encodeExr, encodeImage, encodePixels, encodePng16 } from './io/image';
import { LIBRARY_STORAGE_KEY, exportLibrary, importLibrary, loadLibrary, saveLibrary } from './io/library';
import { readProjectFile, serializeProject } from './io/project';
import { createProjectFiles } from './io/project-file';
import { openResultsStore } from './io/results';
import { projectScene, tonemapFor, writeRsb } from './io/rsb';
import { loadEngineModule, PathTracerEngine, Pool, type SceneSource } from './render/pathtracer';
import { PreviewEngine } from './render/preview';
import { ThumbnailRenderer } from './render/thumbs';
import { exactWords16, linearRgba, poolSize } from './render/tiles';
import { mountApp } from './ui/app';
import { loadResults } from './ui/commands';
import { downloadBlob } from './ui/dom';
import type { AppServices, ViewportPort } from './ui/ports';
import { readPref } from './ui/prefs';
import { L, t } from './ui/strings';
import { createUiStore, effectiveMode } from './ui/ui-state';
import { applyUrlParams, readUrlParams } from './ui/url-params';

const appEl = document.getElementById('app')!;
const params = readUrlParams(window.location.search);
const lang = params.lang ?? (readPref<string>('lang', 'en') === 'es' ? 'es' : 'en');
const savedTheme = readPref<string>('theme', 'system');
const theme = params.theme ?? (savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : 'system');
const store = createStore(createInitialState({ lang, theme }));
// The user's library (U4) lives in the interface state and in one localStorage entry.
const loadedLibrary = loadLibrary();
const ui = createUiStore({ library: loadedLibrary.lib });

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

let tracer: PathTracerEngine | null = null;
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

if (preview) {
  void (async () => {
    const base = new URL(import.meta.env.BASE_URL, window.location.href).href;
    const loaded = await loadEngineModule(base);
    if ('error' in loaded) {
      console.warn(`path tracer: ${loaded.detail}`);
      ui.set({ engine: loaded.error });
      return;
    }
    try {
      const pool = await Pool.create(loaded.module, poolSize(navigator.hardwareConcurrency), () => new Worker(new URL('./render/worker.ts', import.meta.url), { type: 'module' }));
      const t = new PathTracerEngine(pool, sceneSource, loaded.simd);
      t.mount(backdrop);
      if (lastSize.w > 0) t.resize(lastSize.w, lastSize.h, lastSize.dpr);
      t.sync(store.get(), null);
      t.onFrame(() => tracerFrames.forEach((fn) => fn()));
      tracer = t;
      ui.set({ engine: 'READY' });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`path tracer: ${reason}`);
      ui.set({ engine: reason === 'outdated' ? 'OUTDATED' : 'FAILED' });
    }
  })();
} else ui.set({ engine: 'FAILED' });

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
    }
  : null;

// The results history (IndexedDB, or memory when the browser keeps nothing) and where outputs go.
const resultsReady = openResultsStore();
const files = createFiles(
  {
    putHandle: async (id, handle) => (await resultsReady).putHandle(id, handle),
    getHandle: async (id) => (await resultsReady).getHandle(id),
  },
  downloadBlob,
  window as unknown as { showDirectoryPicker?: unknown; isSecureContext?: boolean },
);

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
  async importFile(file) {
    const { importFile } = await import('./io/import');
    return importFile(file);
  },
  project: { serialize: serializeProject, open: readProjectFile },
  projectFiles: createProjectFiles(window as never, downloadBlob, { description: () => t('project.fileType') }),
  library: {
    export: (lib) => new Blob([exportLibrary(lib)], { type: 'application/json' }),
    import: importLibrary,
  },
};

const app = mountApp(appEl, store, ui, services);
void loadResults(app.ctx);

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

// Ready for screenshots: the interface painted, the viewport drew a frame and
// the material spheres in view are rendered (bounded wait).
const started = performance.now();
void app.painted.then(() => {
  const check = () => {
    const spheresDone = thumbs.pendingCount() === 0;
    const elapsed = performance.now() - started;
    if (((firstFrame || !preview) && spheresDone && elapsed > 300) || elapsed > 9000) {
      requestAnimationFrame(() => (appEl.dataset.ready = '1'));
      return;
    }
    setTimeout(check, 100);
  };
  check();
});

// Entry point: creates the store, mounts the interface, starts the viewport
// engine and applies the optional demo / screenshot URL parameters (see
// src/ui/README.md). Sets #app[data-ready="1"] once the interface has
// painted and the viewport has drawn its first frame.

import './ui/theme.css';
import './ui/layout.css';
import './ui/components.css';
import './ui/panels.css';
import { totalDuration } from './core/animation';
import { activeCamera } from './core/camera';
import { createInitialState, createStore } from './core/store';
import { encodeImage } from './io/image';
import { serializeProject } from './io/project';
import type { RenderEngine } from './render/engine';
import { PreviewEngine } from './render/preview';
import { ThumbnailRenderer } from './render/thumbs';
import { mountApp } from './ui/app';
import type { AppServices, ViewportPort } from './ui/ports';
import { readPref } from './ui/prefs';
import { L } from './ui/strings';
import { createUiStore } from './ui/ui-state';
import { applyUrlParams, readUrlParams } from './ui/url-params';

const appEl = document.getElementById('app')!;
const params = readUrlParams(window.location.search);
const lang = params.lang ?? (readPref<string>('lang', 'en') === 'es' ? 'es' : 'en');
const savedTheme = readPref<string>('theme', 'system');
const theme = params.theme ?? (savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : 'system');
const store = createStore(createInitialState({ lang, theme }));
const ui = createUiStore();

// The engine lives in a variable: the path tracer phase adds a second
// implementation behind the same RenderEngine interface.
const canvas = document.createElement('canvas');
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', 'viewport');
let preview: PreviewEngine | null = null;
let engine: RenderEngine | null = null;
try {
  preview = new PreviewEngine();
  preview.mount(canvas);
  engine = preview;
} catch (err) {
  console.error(err);
  preview = null;
  engine = null;
}
const thumbs = new ThumbnailRenderer();

let firstFrame = false;
const viewport: ViewportPort | null =
  preview && engine
    ? {
        kind: engine.kind,
        canvas,
        resize: (w, h, dpr) => engine!.resize(w, h, dpr),
        pick: (x, y) => engine!.pick(x, y),
        setHover: (ids) => preview!.setHover(ids),
        setTool: (tool) => preview!.setTool(tool),
        status: () => engine!.status(),
        onFrame: (fn) => preview!.onFrame(fn),
        materialThumbnail: (mat, key) => thumbs.get(mat, key),
        thumbnailsPending: () => thumbs.pendingCount(),
      }
    : null;

const services: AppServices = {
  viewport,
  async renderImage(req) {
    if (!engine) throw new Error('WebGL');
    const bitmap = await engine.render({
      width: req.width,
      height: req.height,
      maxSamples: req.maxSamples,
      maxSeconds: req.maxSeconds,
      transparent: req.transparent,
      camera: req.camera,
      signal: req.signal,
      onProgress: (p) => req.onProgress?.(p.progress),
    });
    return encodeImage(bitmap, req.format);
  },
  captureViewport: () => (preview ? preview.capture() : Promise.resolve(null)),
  async importFile(file) {
    const { readGltf } = await import('./io/gltf');
    return readGltf(file);
  },
  serializeProject,
};

const app = mountApp(appEl, store, ui, services);

if (engine && preview) {
  engine.sync(store.get(), null);
  store.subscribe((s, prev) => engine!.sync(s, prev));

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
    store.dispatch({
      type: 'camera/set',
      id: cam.id,
      patch: { azimuth: v.azimuth, elevation: v.elevation, distance: v.distance, target: v.target, focusDistance: v.distance, ...(v.orthoWidth ? { orthoWidth: v.orthoWidth } : {}) },
      gesture: `orbit${gesture}`,
      label: L('undo.orbit'),
    });
  });
  preview.onFrame(() => (firstFrame = true));

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
    engine!.frame();
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
    if (((firstFrame || !engine) && spheresDone && elapsed > 300) || elapsed > 9000) {
      requestAnimationFrame(() => (appEl.dataset.ready = '1'));
      return;
    }
    setTimeout(check, 100);
  };
  check();
});

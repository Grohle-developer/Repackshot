// Entry point: creates the store, mounts the interface, starts the viewport
// engine and applies the optional demo / screenshot URL parameters (see
// src/ui/README.md). Sets #app[data-ready="1"] once the interface has
// painted and the viewport has drawn its first frame.

import './ui/theme.css';
import './ui/layout.css';
import './ui/components.css';
import './ui/panels.css';
import { createInitialState, createStore } from './core/store';
import { mountApp } from './ui/app';
import type { AppServices } from './ui/ports';
import { readPref } from './ui/prefs';
import { createUiStore } from './ui/ui-state';
import { applyUrlParams, readUrlParams } from './ui/url-params';

const appEl = document.getElementById('app')!;
const params = readUrlParams(window.location.search);
const lang = params.lang ?? (readPref<string>('lang', 'en') === 'es' ? 'es' : 'en');
const theme = params.theme ?? readPref<'dark' | 'light' | 'system'>('theme', 'system');
const store = createStore(createInitialState({ lang, theme }));
const ui = createUiStore();

const services: AppServices = {
  viewport: null,
  renderImage: () => Promise.reject(new Error('no engine')),
  captureViewport: () => Promise.resolve(null),
  importFile: () => Promise.reject(new Error('no importer')),
  serializeProject: (state) => new Blob([JSON.stringify({ format: 'repackshot-project', schema: 1, state })], { type: 'application/json' }),
};

const app = mountApp(appEl, store, ui, services);
applyUrlParams(app.ctx, params);
void app.painted.then(() => {
  appEl.dataset.ready = '1';
});

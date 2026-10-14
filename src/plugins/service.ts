// What the interface asks of plugins (ui/ports.ts `PluginsPort`), over the host: the registry and the installed
// list, installs, and runs over a finished result. A run takes the result from the history, decodes it (an EXR's
// float light as linear planes, a PNG's or a JPEG's display bytes as RGBA), scales it to the preview's width when it
// is a preview, gives it to the plugin, puts the source's alpha back on the answer, and says how long the plugin took
// (measured around its render). The decoders and the encoder come from main.ts, which wires io/ in.
//
// Decision 8: a run with no result is a run over the plugin's base picture (`base` of its manifest), and the recipe
// cards' pictures are that picture, halved (THUMB_SIZE), through the plugin once per recipe with the controls at
// their defaults, one at a time and only while no preview or Apply is waiting, each kept in the store by plugin
// version and recipe so that it is made once. Decision 9: a render job's frames come as blobs (`runImage`).

import { downscaleRgba8, linearPlanes, unpremultiply, withAlpha } from '../core/plugin-pixels';
import { defaultControls, previewSize, THUMB_SIZE, thumbKey, type InstallOutcome, type PluginControlValue, type PluginImageRequest, type PluginManifest, type PluginPixels, type PluginPresets, type PluginRunRequest, type PluginRunResult, type PluginsSnapshot, type ThumbsOutcome } from '../core/plugins';
import type { PluginRegistryEntry } from '../data/plugins';
import type { PluginHost } from './host';
import type { PluginStore } from './store';

/** The blobs of a result as the history keeps them. */
export interface ResultBlobs {
  file: Blob;
  display: Blob | null;
}

export interface ServiceDeps {
  host: PluginHost;
  registry: readonly PluginRegistryEntry[];
  /** A result's stored blobs, or null when it left the history. */
  result(id: string): Promise<ResultBlobs | null>;
  /** An image file (PNG, JPEG) as 8-bit straight RGBA. */
  decode(blob: Blob): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }>;
  /** An EXR as interleaved linear RGB (premultiplied, as the engine writes it). */
  decodeExr(bytes: Uint8Array): Promise<{ width: number; height: number; rgb: Float32Array }>;
  /** 8-bit RGBA as a PNG (a recipe card's picture). */
  encodePng(img: { width: number; height: number; rgba: Uint8ClampedArray }): Promise<Blob>;
  /** Where the recipe cards' pictures are kept (the host's store). */
  store: PluginStore | Promise<PluginStore>;
  now(): number;
}


export class NoResultError extends Error {
  constructor() {
    super('the result is no longer in the history');
    this.name = 'NoResultError';
  }
}

const isExr = (b: Blob) => b.type === 'image/x-exr' || b.type === 'image/aces';
const abortError = () => new DOMException('aborted', 'AbortError');

/** A decoded source, kept for the next run over the same result (a preview runs again on every control). */
interface Source {
  key: string;
  width: number;
  height: number;
  display: Uint8ClampedArray;
  /** Interleaved linear RGB, straight, when the result is an EXR. */
  linear: Float32Array | null;
}

export class PluginsService {
  readonly registry: readonly PluginRegistryEntry[];
  private readonly deps: ServiceDeps;
  private cache: Source[] = [];
  /** Runs a person is waiting for (previews, Apply, a job's images): the recipe cards wait for none to be left. */
  private active = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(deps: ServiceDeps) {
    this.deps = deps;
    this.registry = deps.registry;
  }

  snapshot(): PluginsSnapshot {
    return this.deps.host.snapshot();
  }
  subscribe(fn: (s: PluginsSnapshot) => void): () => void {
    return this.deps.host.subscribe(fn);
  }
  install(id: string): Promise<InstallOutcome> {
    return this.deps.host.install(id);
  }
  provideKey(id: string, key: string): Promise<InstallOutcome> {
    return this.deps.host.provideKey(id, key);
  }
  cancelInstall(id: string): void {
    this.deps.host.cancelInstall(id);
  }
  installFile(file: Blob, key: string): Promise<InstallOutcome> {
    return this.deps.host.installFile(file, key);
  }
  remove(id: string): Promise<void> {
    return this.deps.host.remove(id);
  }
  text(id: string, file: string): Promise<string | null> {
    return this.deps.host.text(id, file);
  }
  stop(id: string): Promise<void> {
    return this.deps.host.stop(id);
  }
  async presets(id: string): Promise<PluginPresets> {
    return (await this.deps.host.session(id)).presets();
  }

  private manifest(id: string): PluginManifest | null {
    return this.deps.host.snapshot().installed.find((p) => p.id === id)?.manifest ?? null;
  }

  private async decodeBlobs(key: string, blobs: ResultBlobs): Promise<Source> {
    const shown = await this.deps.decode(blobs.display ?? blobs.file);
    let linear: Float32Array | null = null;
    if (isExr(blobs.file)) {
      const exr = await this.deps.decodeExr(new Uint8Array(await blobs.file.arrayBuffer()));
      if (exr.width === shown.width && exr.height === shown.height) linear = unpremultiply(exr.rgb, shown.rgba);
    }
    return { key, width: shown.width, height: shown.height, display: shown.rgba, linear };
  }

  /** A decoded source, from the two kept last or decoded now: a result (its id) or a plugin's base picture. */
  private async source(key: string, load: () => Promise<ResultBlobs | null>): Promise<Source> {
    const hit = this.cache.find((s) => s.key === key);
    if (hit) return hit;
    const blobs = await load();
    if (!blobs) throw new NoResultError();
    const s = await this.decodeBlobs(key, blobs);
    this.cache = [s, ...this.cache.filter((x) => x.key !== key)].slice(0, 2);
    return s;
  }

  /** The plugin's base picture (decision 8), decoded; NoResultError when it has none. */
  private baseSource(id: string): Promise<Source> {
    const m = this.manifest(id);
    const base = m?.base;
    return this.source(`base:${id}@${m?.version ?? ''}`, async () => {
      const bytes = base ? await this.deps.host.file(id, base) : null;
      return bytes ? { file: new Blob([bytes.slice().buffer], { type: 'image/png' }), display: null } : null;
    });
  }

  /** Whether the plugin has a base picture to show before there is a result. */
  hasBase(id: string): boolean {
    return !!this.manifest(id)?.base;
  }

  private async through(plugin: string, src: Source, maxWidth: number | null, recipe: string | null, controls: Record<string, PluginControlValue>, signal?: AbortSignal): Promise<PluginRunResult> {
    if (signal?.aborted) throw abortError();
    const { width, height } = maxWidth ? previewSize(src.width, src.height, maxWidth) : { width: src.width, height: src.height };
    const before = downscaleRgba8(src.display, src.width, src.height, width, height);
    const pixels: PluginPixels = src.linear ? { kind: 'linear-f32-planes', data: linearPlanes(src.linear, src.width, src.height, width, height) } : { kind: 'rgba8', data: new Uint8ClampedArray(before) };
    const session = await this.deps.host.session(plugin);
    const t0 = this.deps.now();
    const answer = await session.render({ width, height, pixels, recipe, controls }, signal);
    const seconds = Math.max(0, (this.deps.now() - t0) / 1000);
    return { width, height, before, after: withAlpha(answer.rgba8, before), info: answer.info, seconds, input: pixels.kind };
  }

  private async waited<T>(work: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      if (this.active === 0) for (const w of this.idleWaiters.splice(0)) w();
    }
  }

  private async idle(): Promise<void> {
    while (this.active > 0) await new Promise<void>((r) => this.idleWaiters.push(r));
  }

  /** A result through a plugin (the plugin's base picture when `result` is null): at the preview's width, or at its own size. */
  run(req: PluginRunRequest, signal?: AbortSignal): Promise<PluginRunResult> {
    return this.waited(async () => {
      const src = req.result === null ? await this.baseSource(req.plugin) : await this.source(req.result, () => this.deps.result(req.result!));
      return this.through(req.plugin, src, req.maxWidth, req.recipe, req.controls, signal);
    });
  }

  /** An image a render job made, through a plugin at its own size (decision 9). */
  runImage(req: PluginImageRequest, signal?: AbortSignal): Promise<PluginRunResult> {
    return this.waited(async () => this.through(req.plugin, await this.decodeBlobs('job', { file: req.file, display: req.display }), null, req.recipe, req.controls, signal));
  }

  /**
   * The recipe cards' pictures (decision 8), each given to `onThumb` as it is ready: the kept ones first, then the
   * missing ones made one at a time (no recipe first, then the plugin's order), each only once nothing a person is
   * waiting for is running. Nothing for a plugin without a base picture. Rejects with an AbortError when `signal`
   * aborts; what was made by then is kept.
   */
  async thumbnails(id: string, onThumb: (recipe: string | null, png: Blob) => void, signal?: AbortSignal): Promise<ThumbsOutcome> {
    const out: ThumbsOutcome = { cached: 0, made: 0, seconds: [] };
    const m = this.manifest(id);
    if (!m?.base) return out;
    const presets = await this.presets(id);
    const store = await this.deps.store;
    const recipes: (string | null)[] = [null, ...presets.presets.map((p) => p.id)];
    const missing: (string | null)[] = [];
    for (const r of recipes) {
      if (signal?.aborted) throw abortError();
      const kept = await store.thumb(thumbKey(id, m.version, r)).catch(() => null);
      if (kept) {
        out.cached++;
        onThumb(r, kept);
      } else missing.push(r);
    }
    if (missing.length === 0) return out;
    const src = await this.baseSource(id);
    const controls = defaultControls(m);
    for (const r of missing) {
      await this.idle();
      if (signal?.aborted) throw abortError();
      const run = await this.through(id, src, THUMB_SIZE.width, r, controls, signal);
      out.seconds.push(run.seconds);
      const png = await this.deps.encodePng({ width: run.width, height: run.height, rgba: run.after });
      await store.putThumb(thumbKey(id, m.version, r), id, png).catch(() => undefined);
      out.made++;
      onThumb(r, png);
    }
    return out;
  }
}

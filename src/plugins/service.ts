// What the interface asks of plugins (ui/ports.ts `PluginsPort`), over the host: the registry and the installed
// list, installs, and runs over a finished result. A run takes the result from the history, decodes it (an EXR's
// float light as linear planes, a PNG's or a JPEG's display bytes as RGBA), scales it to the preview's width when it
// is a preview, gives it to the plugin, puts the source's alpha back on the answer, and says how long the plugin took
// (measured around its render). The decoders and the encoder come from main.ts, which wires io/ in.

import { downscaleRgba8, linearPlanes, unpremultiply, withAlpha } from '../core/plugin-pixels';
import { previewSize, type InstallOutcome, type PluginPixels, type PluginPresets, type PluginRunRequest, type PluginRunResult, type PluginsSnapshot } from '../core/plugins';
import type { PluginRegistryEntry } from '../data/plugins';
import type { PluginHost } from './host';

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
  now(): number;
}

export class NoResultError extends Error {
  constructor() {
    super('the result is no longer in the history');
    this.name = 'NoResultError';
  }
}

const isExr = (b: Blob) => b.type === 'image/x-exr' || b.type === 'image/aces';

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

  private async source(resultId: string): Promise<Source> {
    const hit = this.cache.find((s) => s.key === resultId);
    if (hit) return hit;
    const blobs = await this.deps.result(resultId);
    if (!blobs) throw new NoResultError();
    const shown = await this.deps.decode(blobs.display ?? blobs.file);
    let linear: Float32Array | null = null;
    if (isExr(blobs.file)) {
      const exr = await this.deps.decodeExr(new Uint8Array(await blobs.file.arrayBuffer()));
      if (exr.width === shown.width && exr.height === shown.height) linear = unpremultiply(exr.rgb, shown.rgba);
    }
    const s: Source = { key: resultId, width: shown.width, height: shown.height, display: shown.rgba, linear };
    this.cache = [s, ...this.cache.filter((x) => x.key !== resultId)].slice(0, 2);
    return s;
  }

  /** A result through a plugin: at the preview's width, or at its own size. */
  async run(req: PluginRunRequest, signal?: AbortSignal): Promise<PluginRunResult> {
    const src = await this.source(req.result);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const { width, height } = req.maxWidth ? previewSize(src.width, src.height, req.maxWidth) : { width: src.width, height: src.height };
    const before = downscaleRgba8(src.display, src.width, src.height, width, height);
    const pixels: PluginPixels = src.linear ? { kind: 'linear-f32-planes', data: linearPlanes(src.linear, src.width, src.height, width, height) } : { kind: 'rgba8', data: new Uint8ClampedArray(before) };
    const session = await this.deps.host.session(req.plugin);
    const t0 = this.deps.now();
    const answer = await session.render({ width, height, pixels, recipe: req.recipe, controls: req.controls }, signal);
    const seconds = Math.max(0, (this.deps.now() - t0) / 1000);
    return { width, height, before, after: withAlpha(answer.rgba8, before), info: answer.info, seconds, input: pixels.kind };
  }
}

// A result a plugin made (P6, Render window ▸ Plugins ▸ Apply): the plugin's image at full size becomes a new result
// of the history, next to the one it was made from, the way the AI's image goes next to the engine's. It is saved
// where its source was (a PNG, or a JPEG for a JPEG result, with the source's DPI), its file named after its source
// and the plugin, and it keeps its provenance: the plugin, its version, the recipe, the controls and, for a plugin
// with a seed, the seed set and the rule a frame's seed follows (decision 9). A render job that goes through a
// plugin (decision 9) keeps its first image this way too; the other frames are only saved (`savePluginImage`).

import { derivedFileName, type PluginControlValue, type PluginLabel, type PluginManifest, type PluginRunResult, type ResultProvenance } from '../core/plugins';
import type { ResultMeta } from '../core/results';
import type { FrameResult } from './ports';
import type { Ctx } from './reactive';
import { recordResult, resultId, thumbnailOf } from './render-queue';
import { t } from './strings';

export interface PluginApply {
  source: ResultMeta;
  run: PluginRunResult;
  manifest: PluginManifest;
  recipe: string | null;
  recipeName: PluginLabel | null;
  controls: Record<string, PluginControlValue>;
  seed?: ResultProvenance['seed'];
}

/** The plugin's image as the file its source's format asks for, and the name it is saved under. */
export async function pluginImageFile(ctx: Ctx, run: PluginRunResult, sourceName: string, sourceFormat: string, dpi: number, pluginId: string): Promise<{ blob: Blob; name: string; format: 'PNG' | 'JPEG' }> {
  const port = ctx.services.plugins;
  if (!port) throw new Error('no plugins in this build');
  const format = sourceFormat === 'JPEG' ? 'JPEG' : 'PNG';
  const blob = await port.encode({ width: run.width, height: run.height, rgba: run.after }, format, dpi);
  return { blob, name: derivedFileName(sourceName, pluginId, format === 'JPEG' ? 'jpg' : 'png'), format };
}

/** Keeps the plugin's image as a new result (saved, in the history) and returns its record. */
export async function recordPluginResult(ctx: Ctx, a: PluginApply, now: () => number = Date.now): Promise<ResultMeta> {
  const { blob, name, format } = await pluginImageFile(ctx, a.run, a.source.name, a.source.format, a.source.dpi, a.manifest.id);
  let savedTo = a.source.savedTo;
  try {
    const where = await ctx.services.files.save(savedTo, name, blob);
    if (where === 'DOWNLOAD') savedTo = { kind: 'DOWNLOADS' };
  } catch (err) {
    // The image stays in the history, where Save again can write it.
    ctx.ui.toast(t('rw.pl.saveFailed', { reason: err instanceof Error ? err.message : String(err) }));
  }
  const at = now();
  const meta: ResultMeta = {
    id: resultId(at),
    jobId: a.source.jobId,
    name,
    createdAt: at,
    width: a.run.width,
    height: a.run.height,
    dpi: a.source.dpi,
    samples: a.source.samples,
    seconds: a.source.seconds,
    cameraId: a.source.cameraId,
    camera: a.source.camera,
    format,
    bitDepth: 8,
    savedTo,
    thumb: await thumbnailOf(blob),
    bytes: blob.size,
    provenance: {
      plugin: a.manifest.id,
      version: a.manifest.version,
      recipe: a.recipe,
      controls: { ...a.controls },
      from: a.source.id,
      label: { plugin: a.manifest.name, recipe: a.recipeName },
      ...(a.seed ? { seed: a.seed } : {}),
    },
  };
  const out: FrameResult = { file: blob, display: null, width: a.run.width, height: a.run.height, samples: a.source.samples, seconds: a.source.seconds };
  await recordResult(ctx, meta, out);
  return meta;
}

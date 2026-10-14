// A result a plugin made (P6, Render window ▸ Plugins ▸ Apply): the plugin's image at full size becomes a new result
// of the history, next to the one it was made from, the way the AI's image goes next to the engine's. It is saved
// where its source was (a PNG, or a JPEG for a JPEG result, with the source's DPI), its file named after its source
// and the plugin, and it keeps its provenance: the plugin, its version, the recipe and the controls.

import { derivedFileName, type PluginControlValue, type PluginLabel, type PluginManifest, type PluginRunResult } from '../core/plugins';
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
}

/** Keeps the plugin's image as a new result (saved, in the history) and returns its record. */
export async function recordPluginResult(ctx: Ctx, a: PluginApply, now: () => number = Date.now): Promise<ResultMeta> {
  const port = ctx.services.plugins;
  if (!port) throw new Error('no plugins in this build');
  const format = a.source.format === 'JPEG' ? 'JPEG' : 'PNG';
  const blob = await port.encode({ width: a.run.width, height: a.run.height, rgba: a.run.after }, format, a.source.dpi);
  const name = derivedFileName(a.source.name, a.manifest.id, format === 'JPEG' ? 'jpg' : 'png');
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
    },
  };
  const out: FrameResult = { file: blob, display: null, width: a.run.width, height: a.run.height, samples: a.source.samples, seconds: a.source.seconds };
  await recordResult(ctx, meta, out);
  return meta;
}

// The files of the passes (phase N2): the engine's planes (core/passes.ts `RenderPasses`) written as 16-bit PNG or as
// OpenEXR, one file per pass, by the encoders of io/image.ts. The numbers of each pass are core/pass-files.ts's (what
// 65535 means, where the background is); this file only chooses the encoder and the channels.
//
//   PNG16   alpha, depth and partId: one grey channel; normal: RGB. The density (pHYs) is the render's DPI, and the
//           depth carries its range in a tEXt chunk ("Depth range") so the picture can be turned back into distances.
//   EXR     alpha: A; depth: Z; normal: R G B; partId: Y (all 32-bit floats, values as they are).

import { alphaWords, depthNote, depthRange, depthWords, idFloats, idWords, legendFileName, normalWords, partLegend, passFileName, type LegendPart, type PassFormat, type PassOutputKey, type PassesOutput } from '../core/pass-files';
import type { RenderPasses } from '../core/passes';
import { encodeExrPlanes, encodePngWords } from './image';

/** One file of a pass: its name suffix after the image's (`depth`, `normal`…), its extension, and its bytes. */
export interface PassFile {
  key: PassOutputKey | 'legend';
  /** The whole file name, from the name of the image it belongs to. */
  name: string;
  blob: Blob;
}

/** What the files need besides the planes. */
export interface PassFileContext {
  /** The name of the image the passes belong to (`Bottle_Camera 1_0001.png`): the files are named from it. */
  imageName: string;
  /** Written into a PNG as its density. */
  dpi: number;
  /** The part-id legend (who each id is); absent: no legend file. */
  legend?: readonly LegendPart[];
}

const PNG = 'image/png';
const EXR = 'image/x-exr';

/** The plane of a pass or an error that names the pass: the engine was asked for it, so it must be there. */
function planeOf<K extends PassOutputKey>(passes: RenderPasses, key: K): NonNullable<RenderPasses[K]> {
  const plane = passes[key];
  if (!plane) throw new Error(`the engine returned no ${key} pass`);
  return plane as NonNullable<RenderPasses[K]>;
}

/** One pass as a PNG of 16-bit words, or an EXR of floats. */
export async function encodePassFile(passes: RenderPasses, key: PassOutputKey, format: PassFormat, ctx: Pick<PassFileContext, 'imageName' | 'dpi'>): Promise<PassFile> {
  const { width, height } = passes;
  const name = passFileName(ctx.imageName, key, format);
  const bytes = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;
  if (format === 'EXR') {
    const plane =
      key === 'alpha'
        ? [{ name: 'A', data: planeOf(passes, 'alpha') }]
        : key === 'depth'
          ? [{ name: 'Z', data: planeOf(passes, 'depth') }]
          : key === 'partId'
            ? [{ name: 'Y', data: idFloats(planeOf(passes, 'partId')) }]
            : (() => {
                const n = planeOf(passes, 'normal');
                const channel = (c: number) => Float32Array.from({ length: width * height }, (_, i) => n[i * 3 + c]);
                return [
                  { name: 'R', data: channel(0) },
                  { name: 'G', data: channel(1) },
                  { name: 'B', data: channel(2) },
                ];
              })();
    return { key, name, blob: new Blob([bytes(encodeExrPlanes(width, height, plane))], { type: EXR }) };
  }
  const png = (channels: 1 | 3, words: Uint16Array, text?: [string, string][]) => encodePngWords(width, height, channels, words, { dpi: ctx.dpi, ...(text ? { text } : {}) });
  let file: Uint8Array;
  switch (key) {
    case 'alpha':
      file = await png(1, alphaWords(planeOf(passes, 'alpha')));
      break;
    case 'depth': {
      const depth = planeOf(passes, 'depth');
      const range = depthRange(depth);
      file = await png(1, depthWords(depth, range), [['Depth range', depthNote(range)]]);
      break;
    }
    case 'normal':
      file = await png(3, normalWords(planeOf(passes, 'normal')));
      break;
    default:
      file = await png(1, idWords(planeOf(passes, 'partId')).words);
  }
  return { key, name, blob: new Blob([bytes(file)], { type: PNG }) };
}

/**
 * The files of the passes a render asked for, in the order of the keys, then the part-id legend when the part ids are
 * among them and a legend is given. The passes must hold every asked plane.
 */
export async function encodePassFiles(passes: RenderPasses, output: PassesOutput, ctx: PassFileContext): Promise<PassFile[]> {
  const files: PassFile[] = [];
  for (const key of output.keys) files.push(await encodePassFile(passes, key, output.format, ctx));
  if (output.keys.includes('partId') && ctx.legend) files.push({ key: 'legend', name: legendFileName(ctx.imageName), blob: new Blob([partLegend(ctx.legend)], { type: 'application/json' }) });
  return files;
}

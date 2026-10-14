// The decoded pixels of the texture images (phase M2a), for the RSB writer's IMGS section (M2b reads it): each
// image of the project decoded once (by the browser's decoder, or one a caller gives) into straight 8-bit RGBA,
// rows from the top, kept next to its file in the registry. The project file never holds them.

import { getImage, registerImage } from '../core/images';
import type { ProjectState } from '../core/store';
import { textureImages } from '../core/textures';
import { browserDecoder, type PixelDecoder } from './hdri';

/** Decodes the texture images a state uses that have no pixels yet; one that does not decode is left without (its slots write -1). */
export async function decodeTexturePixels(state: Pick<ProjectState, 'materials'>, decode: PixelDecoder = browserDecoder): Promise<number> {
  let decoded = 0;
  for (const [id, ref] of textureImages(state)) {
    const data = getImage(id);
    if (!data || data.rgba8 || (data.format !== 'PNG' && data.format !== 'JPEG')) continue;
    try {
      const px = await decode(data.bytes, data.format);
      if (px.width !== data.width || px.height !== data.height) continue;
      registerImage(id, ref.name, { ...data, rgba8: px.rgba });
      decoded++;
    } catch {
      // Left without pixels: the engine gets no image for its slots.
    }
  }
  return decoded;
}

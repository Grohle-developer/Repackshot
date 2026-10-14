// Texture images (phase M2a): the PNG and JPEG files a material's slots and labels show, kept in the image
// registry (core/images.ts) as the bytes they came in, and embedded in the project file as those bytes. Pure: the
// header says the size (core/image-header.ts); nothing is decoded here (the preview decodes with the browser,
// the engine's writer of M2b with a decoder it is given).
//
// A texture's id names its content: `tex:` and the first 16 hex digits of the file's SHA-256. The same file
// imported twice, used by two materials or opened again from a project is one image under one id, so a project
// file never holds it twice and a project opened in another session keeps its ids.

import { readImageHeader, type ImageHeader } from './image-header';
import { getImage, registerImage, type ImageRef } from './images';
import { sha256Hex } from './sha256';
import { TEXTURE_MAX_BYTES, TEXTURE_MAX_SIDE, type TextureDropReason } from './textures';

/** Why a file was not taken as a texture: `reason` selects the string `texture.drop.<reason>`. */
export class TextureImageError extends Error {
  constructor(
    readonly reason: TextureDropReason,
    detail = '',
  ) {
    super(detail || reason);
    this.name = 'TextureImageError';
  }
}

/** The id of a texture file: its content. */
export function textureImageId(bytes: Uint8Array): string {
  return `tex:${sha256Hex(bytes).slice(0, 16)}`;
}

/** Checks a file against what a texture may be: its header, or why it cannot be one. */
export function checkTextureFile(bytes: Uint8Array): { header: ImageHeader } | { reason: TextureDropReason } {
  if (bytes.length > TEXTURE_MAX_BYTES) return { reason: 'tooLarge' };
  const header = readImageHeader(bytes);
  if (!header) return { reason: 'format' };
  if (header.width > TEXTURE_MAX_SIDE || header.height > TEXTURE_MAX_SIDE) return { reason: 'tooManyPixels' };
  return { header };
}

/** Puts a texture file in the registry (once per content) and returns its ref; throws a TextureImageError when it cannot be one. */
export function registerTextureImage(name: string, bytes: Uint8Array, id = textureImageId(bytes)): ImageRef {
  const checked = checkTextureFile(bytes);
  if ('reason' in checked) throw new TextureImageError(checked.reason, name);
  const { header } = checked;
  const have = getImage(id);
  if (!have) registerImage(id, name, { format: header.format, bytes, width: header.width, height: header.height, channels: header.channels });
  return { id, name, width: header.width, height: header.height };
}

/** The size in bytes of a registered image's file (0 when it is not registered). */
export function imageByteSize(id: string): number {
  return getImage(id)?.bytes.length ?? 0;
}

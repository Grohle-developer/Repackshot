// Image output: encodes a rendered bitmap as PNG or JPEG. EXR comes later.

export type ImageFormat = 'PNG' | 'JPEG';

export async function encodeImage(bitmap: ImageBitmap, format: ImageFormat, quality = 0.92): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  if (format === 'JPEG') {
    // JPEG has no alpha: compose over white, like a print.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  const type = format === 'JPEG' ? 'image/jpeg' : 'image/png';
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, quality));
}

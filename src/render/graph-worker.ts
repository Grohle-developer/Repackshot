// A material graph worker (phase M3a): runs the reference interpreter (core/material-interp.ts) off the main thread,
// for the material editor's node previews and for bands of the Fast preview's bakes (core/material-preview.ts). It
// keeps the pixels of every image it was given, by id, decoding the files it gets with the browser's decoder.

import { bakeRows, renderMaterialSphere, renderNodePreviews } from '../core/material-preview';
import type { ImagePixels } from '../core/material-interp';
import type { Program } from '../core/material-program';
import type { GraphImageMsg, GraphReply, GraphRequest } from './graph-protocol';

interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<GraphRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const pixels = new Map<string, ImagePixels | null>();

async function decode(m: GraphImageMsg): Promise<ImagePixels | null> {
  if (m.rgba) return { width: m.width, height: m.height, rgba: m.rgba };
  if (!m.bytes || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(new Blob([m.bytes as Uint8Array<ArrayBuffer>], { type: m.format === 'JPEG' ? 'image/jpeg' : 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = g.getImageData(0, 0, canvas.width, canvas.height);
    return { width: data.width, height: data.height, rgba: new Uint8Array(data.data.buffer) };
  } catch {
    return null;
  }
}

async function imagesOf(program: Program, sent: GraphImageMsg[]): Promise<(ImagePixels | null)[]> {
  for (const m of sent) if (!pixels.has(m.id)) pixels.set(m.id, await decode(m));
  return program.images.map((im) => (im.image ? (pixels.get(im.image.id) ?? null) : null));
}

const reply = (msg: GraphReply, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

scope.onmessage = (e) => {
  const req = e.data;
  void (async () => {
    try {
      const images = await imagesOf(req.program, req.images);
      if (req.kind === 'previews') {
        const r = renderNodePreviews(req.program, images, req.size);
        const material = req.materialSize === req.size ? r.material : renderMaterialSphere(req.program, images, req.materialSize);
        reply({ kind: 'previews', seq: req.seq, probes: r.probes, material, size: req.size, materialSize: req.materialSize }, [...r.probes.map((p) => p.buffer), material.buffer]);
      } else {
        const band = bakeRows(req.program, images, req.plan, req.size, req.r0, req.r1);
        reply({ kind: 'bake', seq: req.seq, band }, [band.floats.buffer, band.frames.buffer]);
      }
    } catch (err) {
      reply({ kind: 'error', seq: req.seq, message: err instanceof Error ? err.message : String(err) });
    }
  })();
};

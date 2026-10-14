// The example graphs as graphs (phase M3a): data/material-graphs.ts gives each node's type, place and the values it
// changes; here they become normalised graphs with the catalogue's defaults for the rest. The example with a label
// gets a picture drawn here (paper, a frame, a title band, lines of "text" and a barcode: no font, no file), put in
// the image registry as a PNG like any texture, so it saves with the project.

import { MATERIAL_GRAPHS, type ExampleGraph } from '../data/material-graphs';
import { getImage, registerImage, type ImageRef } from './images';
import { normalizeGraph, type MaterialGraph } from './material-graph';
import { registerTextureImage } from './texture-images';

/** The size of the built-in label picture. */
export const LABEL_WIDTH = 256;
export const LABEL_HEIGHT = 128;

/** The built-in label: straight RGBA, rows from the top; a transparent margin of two pixels, so a clamped read past it is nothing. */
export function labelPixels(): Uint8Array {
  const w = LABEL_WIDTH;
  const h = LABEL_HEIGHT;
  const px = new Uint8Array(w * h * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const o = (y * w + x) * 4;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = 255;
  };
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      // Paper.
      let c: [number, number, number] = [236, 230, 214];
      // A thin dark frame inset by 6 pixels.
      const fx = x === 8 || x === w - 9;
      const fy = y === 8 || y === h - 9;
      if ((fx && y >= 8 && y <= h - 9) || (fy && x >= 8 && x <= w - 9)) c = [30, 34, 44];
      // The title band.
      if (y >= 16 && y < 44 && x >= 16 && x < w - 16) c = [24, 40, 92];
      // A round mark in the band.
      if (Math.hypot(x - 34, y - 30) < 9) c = [228, 176, 64];
      // Lines of text under the band.
      for (const [y0, len] of [
        [56, 150],
        [66, 120],
        [76, 136],
      ] as const)
        if (y >= y0 && y < y0 + 4 && x >= 16 && x < 16 + len && ((x - 16) % 14) < 11) c = [70, 72, 80];
      // A barcode at the bottom right.
      if (y >= 88 && y < 112 && x >= 168 && x < 236) {
        const bar = x - 168;
        if ((bar * 7 + (bar >> 2) * 3) % 5 < 2) c = [20, 20, 22];
      }
      set(x, y, c[0], c[1], c[2]);
    }
  }
  return px;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** An 8-bit RGBA PNG with its pixels stored without compression (deflate's stored blocks): small images only. */
export function encodePngStored(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const row = width * 4 + 1;
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * row + 1);
  // zlib: header, stored blocks of at most 65535 bytes, Adler-32.
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78;
  z[1] = 0x01;
  let at = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, raw.length - start);
    z[at++] = b === blocks - 1 ? 1 : 0;
    z[at++] = len & 0xff;
    z[at++] = len >> 8;
    z[at++] = ~len & 0xff;
    z[at++] = (~len >> 8) & 0xff;
    z.set(raw.subarray(start, start + len), at);
    at += len;
  }
  let a = 1;
  let s = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    s = (s + a) % 65521;
  }
  const adler = ((s << 16) | a) >>> 0;
  z[at++] = adler >>> 24;
  z[at++] = (adler >>> 16) & 0xff;
  z[at++] = (adler >>> 8) & 0xff;
  z[at++] = adler & 0xff;
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The built-in label in the registry (as a PNG, with its decoded pixels), under the id its bytes give it. */
export function registerLabelImage(): ImageRef {
  const pixels = labelPixels();
  const ref = registerTextureImage('label.png', encodePngStored(LABEL_WIDTH, LABEL_HEIGHT, pixels));
  const data = getImage(ref.id)!;
  if (!data.rgba8) registerImage(ref.id, ref.name, { ...data, rgba8: pixels });
  return ref;
}

/** An example as a graph; `label` is the image its label node gets (none: the node waits for one). Undefined for an unknown key. */
export function exampleGraph(key: string, label: ImageRef | null = null): MaterialGraph | undefined {
  const def = MATERIAL_GRAPHS.find((g) => g.key === key);
  return def ? graphOfExample(def, label) : undefined;
}

export function graphOfExample(def: ExampleGraph, label: ImageRef | null = null): MaterialGraph {
  const g = normalizeGraph({
    version: 1,
    nodes: def.nodes.map((n) => ({ ...n, params: { ...n.params, ...(n.id === def.labelImage && label ? { image: label } : {}) }, inputs: { ...n.inputs } })),
    links: def.links.map(([from, output, to, input]) => ({ from, output, to, input })),
  });
  if (!g) throw new Error(`example graph ${def.key} does not read`);
  return g;
}

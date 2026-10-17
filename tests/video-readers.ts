// Readers for the tests of the video files (phase N1): an EBML (WebM) element walker and an ISO BMFF (MP4) box
// walker, written from the same public specifications as the writers but separately, so a test reads back what the
// writers wrote without trusting them.

export interface EbmlElement {
  id: number;
  /** Offset of the element's first byte, and of its data. */
  offset: number;
  dataOffset: number;
  size: number;
  children: EbmlElement[];
  data: Uint8Array;
}

/** Element ids whose data is more elements. */
const MASTERS = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0x1c53bb6b, 0xbb, 0xb7, 0x1f43b675]);

function readId(b: Uint8Array, at: number): { id: number; len: number } {
  const first = b[at];
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4) throw new Error(`bad EBML id at ${at}`);
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[at + i];
  return { id, len };
}

function readSize(b: Uint8Array, at: number): { size: number; len: number } {
  const first = b[at];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8) throw new Error(`bad EBML size at ${at}`);
  let size = first & (0xff >> len);
  for (let i = 1; i < len; i++) size = size * 256 + b[at + i];
  return { size, len };
}

export function readEbml(b: Uint8Array, from = 0, to = b.length): EbmlElement[] {
  const out: EbmlElement[] = [];
  let at = from;
  while (at < to) {
    const id = readId(b, at);
    const size = readSize(b, at + id.len);
    const dataOffset = at + id.len + size.len;
    if (dataOffset + size.size > to) throw new Error(`EBML element ${id.id.toString(16)} runs past its parent`);
    const data = b.subarray(dataOffset, dataOffset + size.size);
    out.push({ id: id.id, offset: at, dataOffset, size: size.size, data, children: MASTERS.has(id.id) ? readEbml(b, dataOffset, dataOffset + size.size) : [] });
    at = dataOffset + size.size;
  }
  return out;
}

export const uintOf = (d: Uint8Array): number => d.reduce((a, v) => a * 256 + v, 0);
export const floatOf = (d: Uint8Array): number => new DataView(d.buffer, d.byteOffset, d.byteLength)[d.length === 4 ? 'getFloat32' : 'getFloat64'](0);
export const textOf = (d: Uint8Array): string => new TextDecoder().decode(d);
export const child = (e: EbmlElement, id: number): EbmlElement | undefined => e.children.find((c) => c.id === id);

export interface Mp4Box {
  type: string;
  offset: number;
  size: number;
  /** The payload (after the 8-byte header). */
  data: Uint8Array;
  children: Mp4Box[];
}

/** Boxes whose payload is more boxes (after a fixed header for some). */
const CONTAINERS: Record<string, number> = { moov: 0, trak: 0, mdia: 0, minf: 0, dinf: 0, stbl: 0, stsd: 8, avc1: 78, dref: 8 };

export function readMp4(b: Uint8Array, from = 0, to = b.length): Mp4Box[] {
  const out: Mp4Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    const dv = new DataView(b.buffer, b.byteOffset + at, 8);
    const size = dv.getUint32(0);
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    if (size < 8 || at + size > to) throw new Error(`MP4 box ${type} at ${at} has size ${size}`);
    const data = b.subarray(at + 8, at + size);
    const skip = CONTAINERS[type];
    out.push({ type, offset: at, size, data, children: skip === undefined ? [] : readMp4(b, at + 8 + skip, at + size) });
    at += size;
  }
  if (at !== to) throw new Error(`MP4 boxes end at ${at}, not ${to}`);
  return out;
}

export function findBox(boxes: Mp4Box[], path: string): Mp4Box | undefined {
  const [head, ...rest] = path.split('/');
  const b = boxes.find((x) => x.type === head);
  return !b || rest.length === 0 ? b : findBox(b.children, rest.join('/'));
}

export const u32At = (d: Uint8Array, at: number): number => new DataView(d.buffer, d.byteOffset + at, 4).getUint32(0);

// A minimal MP4 (ISO base media file format) writer for one H.264 video track (phase N1), from the public ISO/IEC
// 14496-12 box layout and the AVC sample entry of ISO/IEC 14496-15. Own code, no library.
//
//   ftyp  isom, with iso2, avc1 and mp41 compatible
//   moov  mvhd (timescale 1000), one trak: tkhd, mdia (mdhd at fps × 1000 per second, hdlr "vide", minf: vmhd,
//         dinf/dref, stbl: stsd with an avc1 entry and its avcC, stts, stss, stsc, stsz, stco or co64)
//   mdat  the frames one after another, as the encoder gave them (length-prefixed NAL units, the `avc` format)
//
// The movie box goes first ("fast start": a player can begin before the whole file has arrived); every frame is in
// one chunk. Frames are in decoding order and presentation order alike (the encoder is asked for no B-frames, so
// there is no `ctts`). Pure: the same frames give the same bytes.

import type { EncodedVideoFrame, VideoTrackInfo } from './video-track';

const enc = new TextEncoder();

/** A box: four bytes of size, its type, its payload. */
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, size);
  out.set(enc.encode(type), 4);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A full box: a box whose payload starts with a version byte and three bytes of flags. */
function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, u8(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff), ...parts);
}

const u8 = (...v: number[]): Uint8Array => Uint8Array.from(v);
function u16(...v: number[]): Uint8Array {
  const b = new Uint8Array(2 * v.length);
  const dv = new DataView(b.buffer);
  v.forEach((x, i) => dv.setUint16(2 * i, x));
  return b;
}
function u32(...v: number[]): Uint8Array {
  const b = new Uint8Array(4 * v.length);
  const dv = new DataView(b.buffer);
  v.forEach((x, i) => dv.setUint32(4 * i, x >>> 0));
  return b;
}
function u64(v: number): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, Math.floor(v / 2 ** 32));
  dv.setUint32(4, v % 2 ** 32);
  return b;
}
const zeros = (n: number): Uint8Array => new Uint8Array(n);
/** The unity matrix of mvhd and tkhd (16.16 and 2.30 fixed point). */
const MATRIX = u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);

/**
 * One MP4 file of an H.264 track: its frames in decoding order (the first a key frame) and the encoder's
 * configuration record (`track.description`, the avcC payload).
 */
export function muxMp4(track: VideoTrackInfo, frames: readonly EncodedVideoFrame[]): Uint8Array {
  if (track.codec !== 'H264') throw new Error(`this MP4 writer carries H.264, not ${track.codec}`);
  if (!track.description || track.description.length === 0) throw new Error('an H.264 track needs its configuration record (avcC)');
  if (frames.length === 0) throw new Error('a video needs at least one frame');
  if (!frames[0].key) throw new Error('the first frame of a video must be a key frame');
  const timescale = Math.max(1, Math.round(track.fps)) * 1000;
  // Each frame lasts until the next one starts; the last one its own duration.
  const deltas = frames.map((f, i) => Math.max(1, Math.round((((i + 1 < frames.length ? frames[i + 1].timestampUs : f.timestampUs + f.durationUs) - f.timestampUs) * timescale) / 1e6)));
  const mediaDuration = deltas.reduce((a, d) => a + d, 0);
  const movieDuration = Math.round((mediaDuration * 1000) / timescale);
  const mdatSize = 8 + frames.reduce((a, f) => a + f.data.length, 0);

  // stts: runs of equal deltas.
  const runs: [number, number][] = [];
  for (const d of deltas) {
    const last = runs[runs.length - 1];
    if (last && last[1] === d) last[0]++;
    else runs.push([1, d]);
  }
  const keys = frames.map((f, i) => (f.key ? i + 1 : 0)).filter((n) => n > 0);
  const w = Math.round(track.width);
  const h = Math.round(track.height);

  const stbl = (chunkOffset: number, wide: boolean): Uint8Array =>
    box(
      'stbl',
      fullBox(
        'stsd',
        0,
        0,
        u32(1),
        box(
          'avc1',
          zeros(6),
          u16(1), // data reference index
          zeros(16), // pre-defined and reserved
          u16(w, h),
          u32(0x00480000, 0x00480000), // 72 dpi
          u32(0),
          u16(1), // frames per sample
          zeros(32), // compressor name
          u16(0x0018, 0xffff), // depth, pre-defined -1
          box('avcC', track.description!),
        ),
      ),
      fullBox('stts', 0, 0, u32(runs.length), ...runs.map(([n, d]) => u32(n, d))),
      fullBox('stss', 0, 0, u32(keys.length), ...keys.map((k) => u32(k))),
      fullBox('stsc', 0, 0, u32(1, 1, frames.length, 1)),
      fullBox('stsz', 0, 0, u32(0, frames.length), ...frames.map((f) => u32(f.data.length))),
      wide ? fullBox('co64', 0, 0, u32(1), u64(chunkOffset)) : fullBox('stco', 0, 0, u32(1, chunkOffset)),
    );
  const moov = (chunkOffset: number, wide: boolean): Uint8Array =>
    box(
      'moov',
      fullBox('mvhd', 0, 0, u32(0, 0, 1000, movieDuration, 0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2)),
      box(
        'trak',
        fullBox('tkhd', 0, 3, u32(0, 0, 1, 0, movieDuration), zeros(8), u16(0, 0, 0, 0), MATRIX, u32(w * 0x10000, h * 0x10000)),
        box(
          'mdia',
          // Language "und", packed as three 5-bit letters.
          fullBox('mdhd', 0, 0, u32(0, 0, timescale, mediaDuration), u16(0x55c4, 0)),
          fullBox('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), enc.encode('VideoHandler\0')),
          box(
            'minf',
            fullBox('vmhd', 0, 1, u16(0, 0, 0, 0)),
            box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
            stbl(chunkOffset, wide),
          ),
        ),
      ),
    );
  const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isom'), enc.encode('iso2'), enc.encode('avc1'), enc.encode('mp41'));
  // The chunk's offset is after the movie box, whose size does not depend on the offset's value (only on its width).
  const wide = ftyp.length + moov(0, false).length + mdatSize > 0xffffffff;
  const head = ftyp.length + moov(0, wide).length;
  const movie = moov(head + 8, wide);
  const out = new Uint8Array(head + mdatSize);
  out.set(ftyp, 0);
  out.set(movie, ftyp.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(head, mdatSize);
  out.set(enc.encode('mdat'), head + 4);
  let at = head + 8;
  for (const f of frames) {
    out.set(f.data, at);
    at += f.data.length;
  }
  return out;
}

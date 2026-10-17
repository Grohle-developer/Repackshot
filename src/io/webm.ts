// A minimal WebM (Matroska) writer for one video track (phase N1), from the public Matroska and WebM specifications
// (EBML, RFC 8794; the Matroska element table, RFC 9559; the WebM container guidelines). Own code, no library.
//
// The file is written in one go from the encoded frames, so every size is known:
//
//   EBML header (DocType "webm")
//   Segment
//     Info      TimestampScale 1 ms, Duration, the muxing and writing app
//     Tracks    one TrackEntry: number 1, video, V_VP9 or V_VP8, DefaultDuration, the pixel size
//     Cues      one CuePoint per cluster (its first frame is a key frame), so a player can seek
//     Cluster…  a cluster at every key frame (and before a block's time would leave a signed 16-bit offset),
//               its Timestamp, and a SimpleBlock per frame (track 1, the offset in ms, the key-frame flag)
//
// Cues come before the clusters and their positions are written as 8-byte unsigned integers, so the size of Cues
// does not depend on the positions it holds. Pure: the same frames give the same bytes.

import type { EncodedVideoFrame, VideoTrackInfo } from './video-track';

/** Element ids of the Matroska table (the ones written here). */
export const EBML_ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  FlagLacing: 0x9c,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  DefaultDuration: 0x23e383,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
} as const;

/** The longest a block may be after its cluster's start, ms (a SimpleBlock's offset is a signed 16-bit number). */
const MAX_BLOCK_OFFSET_MS = 30000;

/** An EBML element id: its own bytes (the id carries its length marker). */
function idBytes(id: number): number[] {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return out;
}

/** An EBML size as a variable-length integer, in `width` bytes (the shortest that holds it when omitted). */
export function vint(value: number, width?: number): number[] {
  let len = width ?? 1;
  if (width === undefined) while (len < 8 && value >= 2 ** (7 * len) - 1) len++;
  if (value >= 2 ** (7 * len) - 1) throw new RangeError(`EBML size ${value} does not fit in ${len} bytes`);
  const out = new Array<number>(len).fill(0);
  let v = value;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

/** An unsigned integer in the fewest bytes (at least one), or exactly `width` bytes. */
function uintBytes(value: number, width?: number): number[] {
  const out: number[] = [];
  let v = Math.max(0, Math.floor(value));
  do {
    out.unshift(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  if (width !== undefined) {
    while (out.length < width) out.unshift(0);
    if (out.length > width) throw new RangeError(`${value} does not fit in ${width} bytes`);
  }
  return out;
}

/** A tree of elements to serialise: an element is its id and its payload (bytes or children). */
type Node = { id: number; data: Uint8Array | number[] } | { id: number; children: Node[] };

const uint = (id: number, v: number, width?: number): Node => ({ id, data: uintBytes(v, width) });
const str = (id: number, s: string): Node => ({ id, data: [...new TextEncoder().encode(s)] });
const float64 = (id: number, v: number): Node => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return { id, data: b };
};
const master = (id: number, children: Node[]): Node => ({ id, children });

function sizeOf(n: Node): number {
  const payload = 'data' in n ? n.data.length : n.children.reduce((a, c) => a + sizeOf(c), 0);
  return idBytes(n.id).length + vint(payload).length + payload;
}

function write(n: Node, out: Uint8Array, at: number): number {
  const head = idBytes(n.id);
  const payload = 'data' in n ? n.data.length : n.children.reduce((a, c) => a + sizeOf(c), 0);
  const size = vint(payload);
  out.set(head, at);
  at += head.length;
  out.set(size, at);
  at += size.length;
  if ('data' in n) {
    out.set(n.data, at);
    return at + n.data.length;
  }
  for (const c of n.children) at = write(c, out, at);
  return at;
}

/** The milliseconds of a frame's timestamp (µs). */
const ms = (us: number): number => Math.round(us / 1000);

/**
 * One WebM file of a video track: its frames in decoding order, each with its timestamp and duration in µs and
 * whether it is a key frame (the first must be). The duration is the last frame's end.
 */
export function muxWebm(track: VideoTrackInfo, frames: readonly EncodedVideoFrame[]): Uint8Array {
  if (track.codec !== 'VP9' && track.codec !== 'VP8') throw new Error(`WebM carries VP9 or VP8, not ${track.codec}`);
  if (frames.length === 0) throw new Error('a video needs at least one frame');
  if (!frames[0].key) throw new Error('the first frame of a video must be a key frame');
  const frameNs = Math.round(1e9 / track.fps);
  const end = frames.reduce((a, f) => Math.max(a, f.timestampUs + f.durationUs), 0);

  // Clusters: a new one at each key frame, or when a block would be too far from the cluster's start.
  const clusters: { time: number; blocks: Node[] }[] = [];
  for (const f of frames) {
    const t = ms(f.timestampUs);
    const cur = clusters[clusters.length - 1];
    if (!cur || f.key || t - cur.time > MAX_BLOCK_OFFSET_MS) clusters.push({ time: t, blocks: [] });
    const c = clusters[clusters.length - 1];
    const rel = t - c.time;
    const head = [0x81, (rel >> 8) & 0xff, rel & 0xff, f.key ? 0x80 : 0x00];
    const data = new Uint8Array(head.length + f.data.length);
    data.set(head, 0);
    data.set(f.data, head.length);
    c.blocks.push({ id: EBML_ID.SimpleBlock, data });
  }
  const clusterNodes = clusters.map((c) => master(EBML_ID.Cluster, [uint(EBML_ID.Timestamp, c.time), ...c.blocks]));

  const ebml = master(EBML_ID.EBML, [
    uint(EBML_ID.EBMLVersion, 1),
    uint(EBML_ID.EBMLReadVersion, 1),
    uint(EBML_ID.EBMLMaxIDLength, 4),
    uint(EBML_ID.EBMLMaxSizeLength, 8),
    str(EBML_ID.DocType, 'webm'),
    uint(EBML_ID.DocTypeVersion, 4),
    uint(EBML_ID.DocTypeReadVersion, 2),
  ]);
  const info = master(EBML_ID.Info, [
    uint(EBML_ID.TimestampScale, 1_000_000),
    float64(EBML_ID.Duration, end / 1000),
    str(EBML_ID.MuxingApp, 'Repackshot'),
    str(EBML_ID.WritingApp, 'Repackshot'),
  ]);
  const tracks = master(EBML_ID.Tracks, [
    master(EBML_ID.TrackEntry, [
      uint(EBML_ID.TrackNumber, 1),
      uint(EBML_ID.TrackUID, 1),
      uint(EBML_ID.TrackType, 1),
      uint(EBML_ID.FlagLacing, 0),
      str(EBML_ID.CodecID, track.codec === 'VP9' ? 'V_VP9' : 'V_VP8'),
      ...(track.description && track.description.length > 0 ? [{ id: EBML_ID.CodecPrivate, data: track.description }] : []),
      uint(EBML_ID.DefaultDuration, frameNs),
      master(EBML_ID.Video, [uint(EBML_ID.PixelWidth, track.width), uint(EBML_ID.PixelHeight, track.height)]),
    ]),
  ]);
  // Cues with 8-byte positions (filled in below): their size is known before the positions are.
  const cuePoints = (positions: number[]): Node =>
    master(
      EBML_ID.Cues,
      clusters.map((c, i) => master(EBML_ID.CuePoint, [uint(EBML_ID.CueTime, c.time), master(EBML_ID.CueTrackPositions, [uint(EBML_ID.CueTrack, 1), uint(EBML_ID.CueClusterPosition, positions[i] ?? 0, 8)])])),
    );
  const before = sizeOf(info) + sizeOf(tracks) + sizeOf(cuePoints([]));
  const positions: number[] = [];
  let at = before;
  for (const c of clusterNodes) {
    positions.push(at);
    at += sizeOf(c);
  }
  const segment = master(EBML_ID.Segment, [info, tracks, cuePoints(positions), ...clusterNodes]);
  const out = new Uint8Array(sizeOf(ebml) + sizeOf(segment));
  write(segment, out, write(ebml, out, 0));
  return out;
}

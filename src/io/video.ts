// Encoded video in the browser (phase N1): the frames the engine renders, through the browser's own encoder
// (WebCodecs `VideoEncoder`, in Chromium, Edge, the desktop's WebView2, Safari), into one WebM (VP9, or VP8 where VP9
// is not there) or MP4 (H.264) file, written by our own muxers (io/webm.ts, io/mp4.ts). What the system can encode is
// asked at run time (`VideoEncoder.isConfigSupported`), never assumed: a codec it cannot encode is not offered, and a
// frame sequence is always there instead.
//
// The encoder and the frame constructor come in as `VideoEnv`, so the tests drive this very code with a fake encoder.

import type { VideoCodec } from '../core/render';
import { muxMp4 } from './mp4';
import type { EncodedVideoFrame, TrackCodec, VideoTrackInfo } from './video-track';
import { muxWebm } from './webm';

/** The WebCodecs API this module uses (the browser's, or a test's fake). */
export interface VideoEnv {
  VideoEncoder: {
    new (init: { output: (chunk: EncodedChunkLike, meta?: { decoderConfig?: { description?: AllowSharedBufferSource } }) => void; error: (e: Error) => void }): EncoderLike;
    isConfigSupported(config: EncoderConfigLike): Promise<{ supported?: boolean }>;
  };
  VideoFrame: new (image: CanvasImageSource | ImageBitmap, init: { timestamp: number; duration?: number; visibleRect?: { x: number; y: number; width: number; height: number } }) => { close(): void };
  createImageBitmap(blob: Blob): Promise<ImageBitmap | { width: number; height: number; close(): void }>;
}

export interface EncodedChunkLike {
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(dest: AllowSharedBufferSource): void;
}

export interface EncoderConfigLike {
  codec: string;
  width: number;
  height: number;
  bitrate?: number;
  framerate?: number;
  latencyMode?: 'quality' | 'realtime';
  avc?: { format: 'avc' | 'annexb' };
}

export interface EncoderLike {
  readonly encodeQueueSize: number;
  readonly state: string;
  configure(config: EncoderConfigLike): void;
  encode(frame: { close(): void }, options?: { keyFrame?: boolean }): void;
  flush(): Promise<void>;
  close(): void;
  addEventListener?(type: 'dequeue', fn: () => void, opts?: { once?: boolean }): void;
}

/** The browser's WebCodecs, where it has them (a secure page in Chromium, Edge, WebView2, Safari); null elsewhere. */
export function browserVideoEnv(): VideoEnv | null {
  const g = globalThis as unknown as Partial<VideoEnv> & { isSecureContext?: boolean };
  if (typeof g.VideoEncoder !== 'function' || typeof g.VideoFrame !== 'function' || typeof g.createImageBitmap !== 'function') return null;
  return { VideoEncoder: g.VideoEncoder, VideoFrame: g.VideoFrame, createImageBitmap: (b) => g.createImageBitmap!(b) } as VideoEnv;
}

/** What a container is encoded with here: its track codec and the WebCodecs codec string, or null when it cannot be. */
export interface VideoCodecChoice {
  track: TrackCodec;
  codec: string;
}

export type VideoSupport = Record<VideoCodec, VideoCodecChoice | null>;

export const NO_VIDEO: VideoSupport = Object.freeze({ MP4: null, WEBM: null });

/**
 * The H.264 level a size and rate need (ISO/IEC 14496-10, table A-1: the largest frame and the macroblocks a second),
 * as the last byte of an `avc1` codec string.
 */
export function avcLevel(width: number, height: number, fps: number): number {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = mbs * Math.max(1, fps);
  const LEVELS: [number, number, number][] = [
    [0x1e, 1620, 40500],
    [0x1f, 3600, 108000],
    [0x20, 5120, 216000],
    [0x28, 8192, 245760],
    [0x2a, 8704, 522240],
    [0x32, 22080, 589824],
    [0x33, 36864, 983040],
    [0x34, 36864, 2073600],
    [0x3c, 139264, 4177920],
    [0x3d, 139264, 8355840],
    [0x3e, 139264, 16711680],
  ];
  return (LEVELS.find(([, fs, mbps]) => mbs <= fs && rate <= mbps) ?? LEVELS[LEVELS.length - 1])[0];
}

/** The WebCodecs codec strings tried for each container, in order of preference. */
export function codecCandidates(container: VideoCodec, width: number, height: number, fps: number): VideoCodecChoice[] {
  if (container === 'WEBM') return [{ track: 'VP9', codec: 'vp09.00.10.08' }, { track: 'VP8', codec: 'vp8' }];
  // H.264 Constrained Baseline: no B-frames, so frames come in presentation order (the MP4 writer has no ctts).
  return [{ track: 'H264', codec: `avc1.42E0${avcLevel(width, height, fps).toString(16).toUpperCase().padStart(2, '0')}` }];
}

/** The even size a 4:2:0 video takes (an odd row or column of the frame is left out). */
export function videoSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(2, width - (width % 2)), height: Math.max(2, height - (height % 2)) };
}

/** Bits a second for a size and rate: about 0.1 bit a pixel, between 1 and 50 Mbit/s (a product film, not a stream). */
export function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(50e6, Math.max(1e6, width * height * fps * 0.1)));
}

function configOf(choice: VideoCodecChoice, width: number, height: number, fps: number): EncoderConfigLike {
  return { codec: choice.codec, width, height, bitrate: videoBitrate(width, height, fps), framerate: fps, latencyMode: 'quality', ...(choice.track === 'H264' ? { avc: { format: 'avc' as const } } : {}) };
}

/** What this system encodes for a frame of this size and rate: the first supported codec of each container. */
export async function probeVideo(env: VideoEnv | null, width = 1920, height = 1080, fps = 24): Promise<VideoSupport> {
  if (!env) return NO_VIDEO;
  const size = videoSize(width, height);
  const out: Record<VideoCodec, VideoCodecChoice | null> = { MP4: null, WEBM: null };
  for (const container of ['MP4', 'WEBM'] as const) {
    for (const choice of codecCandidates(container, size.width, size.height, fps)) {
      try {
        const r = await env.VideoEncoder.isConfigSupported(configOf(choice, size.width, size.height, fps));
        if (r.supported) {
          out[container] = choice;
          break;
        }
      } catch {
        // Not this one.
      }
    }
  }
  return out;
}

/** A key frame every this many seconds (a player seeks to them; WebM starts a cluster at each). */
export const KEY_EVERY_S = 2;

/** One video being written: frames in order (pictures the browser decodes), then the file. */
export interface VideoWriter {
  readonly container: VideoCodec;
  readonly track: TrackCodec;
  /** Frame `index` (0 for the first) of the video; resolves once the encoder has taken it. */
  add(picture: Blob, index: number): Promise<void>;
  /** Every frame encoded and muxed: the file. */
  finish(): Promise<Blob>;
  /** Stops and lets the encoder go (a stopped job). */
  close(): void;
}

/** The instant of frame `index` and its duration, microseconds. */
export function frameTiming(index: number, fps: number): { timestampUs: number; durationUs: number } {
  const t0 = Math.round((index * 1e6) / fps);
  const t1 = Math.round(((index + 1) * 1e6) / fps);
  return { timestampUs: t0, durationUs: t1 - t0 };
}

/**
 * A writer for one video of `width` × `height` (made even) at `fps`, in `container` with the codec `choice` (from
 * `probeVideo`). Frames are encoded as they come and kept, then muxed into the file at `finish`.
 */
export function createVideoWriter(env: VideoEnv, opts: { container: VideoCodec; choice: VideoCodecChoice; width: number; height: number; fps: number }): VideoWriter {
  const { width, height } = videoSize(opts.width, opts.height);
  const fps = Math.max(1, Math.round(opts.fps));
  const frames: EncodedVideoFrame[] = [];
  let description: Uint8Array | undefined;
  let failure: Error | null = null;
  const encoder = new env.VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength));
      frames.push({ data, timestampUs: chunk.timestamp, durationUs: chunk.duration ?? Math.round(1e6 / fps), key: chunk.type === 'key' });
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure(configOf(opts.choice, width, height, fps));
  const keyEvery = Math.max(1, Math.round(KEY_EVERY_S * fps));
  /** Waits while the encoder has more than a couple of frames queued (the pictures are large). */
  const room = async (): Promise<void> => {
    while (encoder.encodeQueueSize > 2 && !failure) {
      await new Promise<void>((resolve) => {
        if (encoder.addEventListener) encoder.addEventListener('dequeue', () => resolve(), { once: true });
        else setTimeout(resolve, 5);
      });
    }
  };
  return {
    container: opts.container,
    track: opts.choice.track,
    async add(picture, index) {
      if (failure) throw failure;
      const bitmap = await env.createImageBitmap(picture);
      const { timestampUs, durationUs } = frameTiming(index, fps);
      const frame = new env.VideoFrame(bitmap as ImageBitmap, { timestamp: timestampUs, duration: durationUs, visibleRect: { x: 0, y: 0, width, height } });
      bitmap.close();
      try {
        encoder.encode(frame, { keyFrame: index % keyEvery === 0 });
      } finally {
        frame.close();
      }
      await room();
      if (failure) throw failure;
    },
    async finish() {
      await encoder.flush();
      if (failure) throw failure;
      encoder.close();
      const track: VideoTrackInfo = { codec: opts.choice.track, width, height, fps, ...(description ? { description } : {}) };
      // Decoding order is the order the encoder gave them; with no B-frames it is also the order of their time.
      const bytes = opts.container === 'MP4' ? muxMp4(track, frames) : muxWebm(track, frames);
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: opts.container === 'MP4' ? 'video/mp4' : 'video/webm' });
    },
    close() {
      try {
        if (encoder.state !== 'closed') encoder.close();
      } catch {
        // Already gone.
      }
    },
  };
}

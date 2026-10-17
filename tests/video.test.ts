// Phase N1: encoded video. The WebM and MP4 writers read back by separate readers (tests/video-readers.ts); the
// WebCodecs writer driven by a fake encoder; a video job of the queue from the first frame to the file; and, where
// this machine has ffmpeg, the writers fed with real VP9 and H.264 frames and the files read by ffprobe.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStore } from '../src/core/store';
import { memoryResultsStore } from '../src/io/results';
import { muxMp4 } from '../src/io/mp4';
import { avcLevel, codecCandidates, createVideoWriter, frameTiming, KEY_EVERY_S, probeVideo, videoBitrate, videoSize, type EncodedChunkLike, type EncoderConfigLike, type VideoEnv } from '../src/io/video';
import type { EncodedVideoFrame, VideoTrackInfo } from '../src/io/video-track';
import { EBML_ID, muxWebm, vint } from '../src/io/webm';
import * as cmd from '../src/ui/commands';
import type { AppServices, FrameRequest, FrameResult, VideoPort } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { isVideoJob, jobFileNames, queueSettled } from '../src/ui/render-queue';
import { setLang } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { exampleState } from './helpers';
import { child, findBox, floatOf, readEbml, readMp4, textOf, u32At, uintOf, type EbmlElement } from './video-readers';

/** `n` frames at `fps`, a key frame every `keyEvery`, each frame's bytes its own index (so their order can be read). */
function frames(n: number, fps: number, keyEvery = Math.round(KEY_EVERY_S * fps)): EncodedVideoFrame[] {
  return Array.from({ length: n }, (_, i) => ({ data: Uint8Array.from([i, i ^ 0xa5, 7, i & 3]), ...frameTiming(i, fps), key: i % keyEvery === 0 }));
}

const blocksOf = (segment: EbmlElement): { cluster: number; rel: number; key: boolean; data: Uint8Array }[] =>
  segment.children
    .filter((c) => c.id === EBML_ID.Cluster)
    .flatMap((c) => {
      const time = uintOf(child(c, EBML_ID.Timestamp)!.data);
      return c.children
        .filter((b) => b.id === EBML_ID.SimpleBlock)
        .map((b) => ({ cluster: time, rel: (b.data[1] << 8) | b.data[2], key: (b.data[3] & 0x80) !== 0, track: b.data[0], data: b.data.subarray(4) }));
    });

describe('the WebM writer', () => {
  it('a 2 s video at 12 fps: 24 frames in order, its duration, one track of VP9 and its size, read back', () => {
    const track: VideoTrackInfo = { codec: 'VP9', width: 320, height: 180, fps: 12 };
    const file = muxWebm(track, frames(24, 12));
    const top = readEbml(file);
    expect(top.map((e) => e.id)).toEqual([EBML_ID.EBML, EBML_ID.Segment]);
    expect(textOf(child(top[0], EBML_ID.DocType)!.data)).toBe('webm');
    const segment = top[1];
    // The segment runs to the end of the file.
    expect(segment.dataOffset + segment.size).toBe(file.length);
    const info = child(segment, EBML_ID.Info)!;
    expect(uintOf(child(info, EBML_ID.TimestampScale)!.data)).toBe(1_000_000);
    expect(floatOf(child(info, EBML_ID.Duration)!.data)).toBe(2000);
    const entry = child(child(segment, EBML_ID.Tracks)!, EBML_ID.TrackEntry)!;
    expect(textOf(child(entry, EBML_ID.CodecID)!.data)).toBe('V_VP9');
    expect(uintOf(child(entry, EBML_ID.TrackType)!.data)).toBe(1);
    expect(uintOf(child(entry, EBML_ID.DefaultDuration)!.data)).toBe(Math.round(1e9 / 12));
    const video = child(entry, EBML_ID.Video)!;
    expect([uintOf(child(video, EBML_ID.PixelWidth)!.data), uintOf(child(video, EBML_ID.PixelHeight)!.data)]).toEqual([320, 180]);
    const blocks = blocksOf(segment);
    expect(blocks).toHaveLength(24);
    expect(blocks.map((b) => b.data[0])).toEqual([...Array(24).keys()]);
    expect(blocks.map((b) => b.cluster + b.rel)).toEqual(frames(24, 12).map((f) => Math.round(f.timestampUs / 1000)));
    expect(blocks[0].key).toBe(true);
    expect(blocks.filter((b) => b.key)).toHaveLength(1);
  });

  it('a cluster at every key frame, and Cues that point at them', () => {
    const file = muxWebm({ codec: 'VP8', width: 64, height: 48, fps: 12 }, frames(60, 12));
    const segment = readEbml(file)[1];
    const clusters = segment.children.filter((c) => c.id === EBML_ID.Cluster);
    expect(clusters.map((c) => uintOf(child(c, EBML_ID.Timestamp)!.data))).toEqual([0, 2000, 4000]);
    const cues = child(segment, EBML_ID.Cues)!.children;
    expect(cues).toHaveLength(3);
    cues.forEach((cue, i) => {
      const pos = uintOf(child(child(cue, EBML_ID.CueTrackPositions)!, EBML_ID.CueClusterPosition)!.data);
      // Relative to the segment's data, as Matroska has it.
      expect(segment.dataOffset + pos).toBe(clusters[i].offset);
      expect(uintOf(child(cue, EBML_ID.CueTime)!.data)).toBe(i * 2000);
    });
    expect(textOf(child(child(child(segment, EBML_ID.Tracks)!, EBML_ID.TrackEntry)!, EBML_ID.CodecID)!.data)).toBe('V_VP8');
    expect(floatOf(child(child(segment, EBML_ID.Info)!, EBML_ID.Duration)!.data)).toBe(5000);
  });

  it('sizes are EBML variable-length integers; what cannot be a video is refused', () => {
    expect(vint(0)).toEqual([0x80]);
    expect(vint(126)).toEqual([0xfe]);
    // 127 is all ones in one byte (reserved for an unknown size): two bytes.
    expect(vint(127)).toEqual([0x40, 0x7f]);
    expect(vint(1, 8)).toEqual([0x01, 0, 0, 0, 0, 0, 0, 1]);
    expect(() => muxWebm({ codec: 'VP9', width: 2, height: 2, fps: 12 }, [])).toThrow();
    expect(() => muxWebm({ codec: 'VP9', width: 2, height: 2, fps: 12 }, frames(3, 12).map((f) => ({ ...f, key: false })))).toThrow(/key frame/);
    expect(() => muxWebm({ codec: 'H264', width: 2, height: 2, fps: 12 }, frames(3, 12))).toThrow(/VP9 or VP8/);
  });
});

describe('the MP4 writer', () => {
  const avcc = Uint8Array.from([1, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xc0, 0x1e, 1, 0, 2, 0x68, 0xce]);

  it('a 2 s video at 12 fps: 24 samples, their sizes and offsets, the key frames, the duration, the avcC', () => {
    const fr = frames(24, 12);
    const file = muxMp4({ codec: 'H264', width: 320, height: 180, fps: 12, description: avcc }, fr);
    const top = readMp4(file);
    expect(top.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(String.fromCharCode(...top[0].data.subarray(0, 4))).toBe('isom');
    const mvhd = findBox(top, 'moov/mvhd')!;
    expect([u32At(mvhd.data, 12), u32At(mvhd.data, 16)]).toEqual([1000, 2000]);
    const mdhd = findBox(top, 'moov/trak/mdia/mdhd')!;
    expect(u32At(mdhd.data, 16) / u32At(mdhd.data, 12)).toBe(2);
    const tkhd = findBox(top, 'moov/trak/tkhd')!;
    expect([u32At(tkhd.data, 76) / 65536, u32At(tkhd.data, 80) / 65536]).toEqual([320, 180]);
    expect(String.fromCharCode(...findBox(top, 'moov/trak/mdia/hdlr')!.data.subarray(8, 12))).toBe('vide');
    const avc1 = findBox(top, 'moov/trak/mdia/minf/stbl/stsd/avc1')!;
    expect([(avc1.data[24] << 8) | avc1.data[25], (avc1.data[26] << 8) | avc1.data[27]]).toEqual([320, 180]);
    expect([...findBox(avc1.children, 'avcC')!.data]).toEqual([...avcc]);
    const stsz = findBox(top, 'moov/trak/mdia/minf/stbl/stsz')!;
    expect(u32At(stsz.data, 8)).toBe(24);
    expect(Array.from({ length: 24 }, (_, i) => u32At(stsz.data, 12 + 4 * i))).toEqual(fr.map((f) => f.data.length));
    const stts = findBox(top, 'moov/trak/mdia/minf/stbl/stts')!;
    // One run: 24 samples of 1/12 s each (1000 in a timescale of 12000).
    expect([u32At(stts.data, 4), u32At(stts.data, 8), u32At(stts.data, 12)]).toEqual([1, 24, 1000]);
    const stss = findBox(top, 'moov/trak/mdia/minf/stbl/stss')!;
    expect([u32At(stss.data, 4), u32At(stss.data, 8)]).toEqual([1, 1]);
    const stco = findBox(top, 'moov/trak/mdia/minf/stbl/stco')!;
    const offset = u32At(stco.data, 8);
    expect(offset).toBe(top[2].offset + 8);
    // The samples, one after another where stco says, each its own frame.
    let at = offset;
    fr.forEach((f) => {
      expect([...file.subarray(at, at + f.data.length)]).toEqual([...f.data]);
      at += f.data.length;
    });
    expect(at).toBe(file.length);
  });

  it('refuses what is not an H.264 track with its configuration', () => {
    expect(() => muxMp4({ codec: 'VP9', width: 2, height: 2, fps: 12, description: avcc }, frames(2, 12))).toThrow(/H.264/);
    expect(() => muxMp4({ codec: 'H264', width: 2, height: 2, fps: 12 }, frames(2, 12))).toThrow(/avcC/);
  });
});

// ------------------------------------------------------------------ the WebCodecs writer with a fake encoder

interface FakeLog {
  configs: EncoderConfigLike[];
  encoded: { timestamp: number; duration: number | undefined; key: boolean }[];
  closed: number;
}

/** A WebCodecs stand-in: the encoder hands each frame back as a chunk of four bytes (its index), the first with a description. */
function fakeEnv(log: FakeLog, supported: (c: EncoderConfigLike) => boolean = () => true): VideoEnv {
  class FakeFrame {
    constructor(
      public image: unknown,
      public init: { timestamp: number; duration?: number },
    ) {}
    close(): void {}
  }
  class FakeEncoder {
    encodeQueueSize = 0;
    state = 'unconfigured';
    private n = 0;
    constructor(private readonly init: { output: (chunk: EncodedChunkLike, meta?: { decoderConfig?: { description?: AllowSharedBufferSource } }) => void; error: (e: Error) => void }) {}
    configure(config: EncoderConfigLike): void {
      log.configs.push(config);
      this.state = 'configured';
    }
    encode(frame: FakeFrame, opts?: { keyFrame?: boolean }): void {
      const i = this.n++;
      log.encoded.push({ timestamp: frame.init.timestamp, duration: frame.init.duration, key: opts?.keyFrame === true });
      const bytes = Uint8Array.from([i, 0xee, 0xee, i]);
      const chunk: EncodedChunkLike = { type: opts?.keyFrame ? 'key' : 'delta', timestamp: frame.init.timestamp, duration: frame.init.duration ?? null, byteLength: bytes.length, copyTo: (d) => (ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d)).set(bytes) };
      this.init.output(chunk, i === 0 ? { decoderConfig: { description: Uint8Array.from([1, 2, 3]).buffer } } : undefined);
    }
    async flush(): Promise<void> {}
    close(): void {
      log.closed++;
      this.state = 'closed';
    }
  }
  return {
    VideoEncoder: Object.assign(FakeEncoder, { isConfigSupported: async (c: EncoderConfigLike) => ({ supported: supported(c) }) }) as unknown as VideoEnv['VideoEncoder'],
    VideoFrame: FakeFrame as unknown as VideoEnv['VideoFrame'],
    createImageBitmap: async () => ({ width: 320, height: 180, close() {} }),
  };
}

describe('the WebCodecs writer', () => {
  it('asks the system for each container and takes the first codec it encodes; none without WebCodecs', async () => {
    expect(await probeVideo(null)).toEqual({ MP4: null, WEBM: null });
    const log: FakeLog = { configs: [], encoded: [], closed: 0 };
    // A browser without H.264 and without VP9 (VP8 only): MP4 cannot be written, WebM falls back to VP8.
    const v = await probeVideo(fakeEnv(log, (c) => c.codec === 'vp8'));
    expect(v).toEqual({ MP4: null, WEBM: { track: 'VP8', codec: 'vp8' } });
    const all = await probeVideo(fakeEnv(log));
    expect(all.MP4?.track).toBe('H264');
    expect(all.WEBM?.track).toBe('VP9');
    // H.264 Constrained Baseline at the level the size needs (no B-frames: frames in their own order).
    expect(codecCandidates('MP4', 1920, 1080, 24)[0].codec).toBe('avc1.42E028');
    expect(codecCandidates('MP4', 3840, 2160, 30)[0].codec).toBe('avc1.42E033');
    expect(avcLevel(640, 360, 30)).toBe(0x1e);
    expect(avcLevel(1280, 720, 60)).toBe(0x20);
    expect(avcLevel(1920, 1080, 60)).toBe(0x2a);
  });

  it('encodes every frame at its instant, a key frame every 2 s, and muxes the file: a 2 s video at 12 fps', async () => {
    const log: FakeLog = { configs: [], encoded: [], closed: 0 };
    const env = fakeEnv(log);
    const choice = (await probeVideo(env)).WEBM!;
    const w = createVideoWriter(env, { container: 'WEBM', choice, width: 321, height: 181, fps: 12 });
    for (let i = 0; i < 24; i++) await w.add(new Blob([new Uint8Array(1)]), i);
    const blob = await w.finish();
    expect(blob.type).toBe('video/webm');
    // The even size of a 4:2:0 video, the rate and a bitrate for it.
    expect(log.configs.at(-1)).toMatchObject({ codec: 'vp09.00.10.08', width: 320, height: 180, framerate: 12, bitrate: videoBitrate(320, 180, 12) });
    expect(log.encoded.map((e) => e.timestamp)).toEqual(Array.from({ length: 24 }, (_, i) => Math.round((i * 1e6) / 12)));
    expect(log.encoded.filter((e) => e.key).map((e) => e.timestamp)).toEqual([0]);
    const segment = readEbml(new Uint8Array(await blob.arrayBuffer()))[1];
    const blocks = blocksOf(segment);
    expect(blocks).toHaveLength(24);
    expect(blocks.map((b) => b.data[0])).toEqual([...Array(24).keys()]);
    expect(floatOf(child(child(segment, EBML_ID.Info)!, EBML_ID.Duration)!.data)).toBe(2000);
    w.close();
    expect(log.closed).toBeGreaterThan(0);
    expect(videoSize(3, 5)).toEqual({ width: 2, height: 4 });
  });

  it('an MP4 takes the encoder’s configuration record as its avcC', async () => {
    const log: FakeLog = { configs: [], encoded: [], closed: 0 };
    const env = fakeEnv(log);
    const choice = (await probeVideo(env)).MP4!;
    const w = createVideoWriter(env, { container: 'MP4', choice, width: 64, height: 64, fps: 25 });
    for (let i = 0; i < 50; i++) await w.add(new Blob([new Uint8Array(1)]), i);
    const file = new Uint8Array(await (await w.finish()).arrayBuffer());
    const top = readMp4(file);
    expect([...findBox(top, 'moov/trak/mdia/minf/stbl/stsd/avc1/avcC')!.data]).toEqual([1, 2, 3]);
    expect(log.configs.at(-1)?.avc).toEqual({ format: 'avc' });
    const stss = findBox(top, 'moov/trak/mdia/minf/stbl/stss')!;
    // Key frames every 2 s at 25 fps: samples 1 and 51 would be; 50 frames: just the first.
    expect(u32At(stss.data, 4)).toBe(1);
    const mdhd = findBox(top, 'moov/trak/mdia/mdhd')!;
    expect(u32At(mdhd.data, 16) / u32At(mdhd.data, 12)).toBe(2);
  });
});

// ------------------------------------------------------------------ a video job of the queue

function videoCtx(): { ctx: Ctx; requests: FrameRequest[]; saved: { name: string; blob: Blob }[]; log: FakeLog } {
  const results = memoryResultsStore();
  const requests: FrameRequest[] = [];
  const saved: { name: string; blob: Blob }[] = [];
  const log: FakeLog = { configs: [], encoded: [], closed: 0 };
  const env = fakeEnv(log, (c) => !c.codec.startsWith('avc1'));
  const video: VideoPort = {
    support: async () => ({ MP4: null, WEBM: 'VP9' }),
    async open(o) {
      const choice = (await probeVideo(env, o.width, o.height, o.fps))[o.container];
      if (!choice) throw new Error(`cannot encode ${o.container}`);
      return createVideoWriter(env, { container: o.container, choice, width: o.width, height: o.height, fps: o.fps });
    },
  };
  const services = {
    viewport: null,
    renderImage: async () => new Blob(),
    async renderFrame(req: FrameRequest): Promise<FrameResult> {
      requests.push(req);
      return { file: new Blob([new Uint8Array(10)], { type: 'image/png' }), display: null, width: req.width, height: req.height, samples: 4, seconds: 0.25 };
    },
    results: { persistent: async () => results.persistent, list: () => results.list(), add: (m, f, d) => results.add(m, f, d), get: (id) => results.get(id), remove: (id) => results.remove(id), clear: () => results.clear() },
    files: {
      canChooseFolder: false,
      canOpenFolder: false,
      chooseFolder: async () => null,
      ensureAccess: async () => false,
      save: async (_dest, name, blob) => {
        saved.push({ name, blob });
        return 'DOWNLOAD' as const;
      },
      openFolder: async () => {},
    },
    video,
  } as Partial<AppServices> as AppServices;
  const store = createStore(exampleState());
  store.dispatch({ type: 'meta/rename', name: 'Bottle' });
  return { ctx: { store, ui: createUiStore(), services }, requests, saved, log };
}

afterEach(() => setLang('en'));

describe('a video job of the queue', () => {
  it('renders 24 frames of a 2 s animation at 12 fps as opaque 8-bit pictures and saves one WebM that reads back', async () => {
    const f = videoCtx();
    const { store } = f.ctx;
    store.dispatch({ type: 'anim/addShot', duration: 1 });
    store.dispatch({ type: 'anim/addShot', duration: 1 });
    store.dispatch({ type: 'anim/setShot', id: store.get().animation.shots[1].id, patch: { transition: { kind: 'FADE', color: 'BLACK', duration: 0.5 } } });
    store.dispatch({ type: 'anim/addClip', clip: { target: { kind: 'CAMERA' }, move: 'ORBIT', shot: null, start: 0, duration: 2, amount: 90, easing: 'EASE' } });
    store.dispatch({ type: 'render/set', patch: { mode: 'ANIMATION', width: 320, height: 180, format: 'EXR', transparent: true, animation: { ...store.get().render.animation, fps: 12, output: 'VIDEO', video: 'WEBM' } } });
    expect(isVideoJob(store.get().render)).toBe(true);
    await cmd.renderFromWindow(f.ctx);
    await queueSettled(f.ctx);
    const job = store.get().render.queue[0];
    expect(job.status).toBe('DONE');
    expect(f.requests).toHaveLength(24);
    // The encoder's pictures: PNG, 8 bits, opaque, whatever the frames' format says; each at its instant.
    expect(f.requests.every((r) => r.format === 'PNG' && r.bitDepth === 8 && r.transparent === false)).toBe(true);
    expect(f.requests.map((r) => r.time)).toEqual(Array.from({ length: 24 }, (_, i) => i / 12));
    // The fade to black at the cut (1 s): full at the cut, nothing far from it.
    expect(f.requests[12].fade).toEqual({ color: [0, 0, 0], amount: 1 });
    expect(f.requests[0].fade).toBeNull();
    expect(f.requests[11].fade!.amount).toBeGreaterThan(0);
    // One file, named like the job, and nothing else.
    expect(f.saved.map((s) => s.name)).toEqual(jobFileNames(store.get(), job));
    expect(f.saved).toHaveLength(1);
    expect(f.saved[0].name).toMatch(/\.webm$/);
    const segment = readEbml(new Uint8Array(await f.saved[0].blob.arrayBuffer()))[1];
    expect(blocksOf(segment)).toHaveLength(24);
    expect(floatOf(child(child(segment, EBML_ID.Info)!, EBML_ID.Duration)!.data)).toBe(2000);
    // The history keeps the first frame as the picture it is, with the video it belongs to.
    const result = f.ctx.ui.get().results[0];
    expect(result).toMatchObject({ format: 'PNG', bitDepth: 8, frames: 24, video: { name: f.saved[0].name, codec: 'VP9' } });
    expect(result.name).toMatch(/_0001\.png$/);
    expect(f.log.closed).toBeGreaterThan(0);
  });

  it('a container the system cannot encode fails the job before any frame, and says so', async () => {
    const f = videoCtx();
    const { store } = f.ctx;
    store.dispatch({ type: 'anim/addClip', clip: { target: { kind: 'CAMERA' }, move: 'ORBIT', shot: null, start: 0, duration: 1, amount: 90, easing: 'EASE' } });
    store.dispatch({ type: 'render/set', patch: { mode: 'ANIMATION', width: 64, height: 64, animation: { ...store.get().render.animation, fps: 12, output: 'VIDEO', video: 'MP4' } } });
    await cmd.renderFromWindow(f.ctx);
    await queueSettled(f.ctx);
    expect(store.get().render.queue[0].status).toBe('FAILED');
    expect(store.get().render.queue[0].error).toMatch(/MP4/);
    expect(f.requests).toHaveLength(0);
    expect(f.saved).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ real frames, read by ffprobe

const has = (bin: string) => {
  try {
    return spawnSync(bin, ['-version'], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
};
/** Runs a program to its end; its output, or a failure that says why. */
function run(bin: string, args: string[]): string {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(`${bin} failed: ${r.stderr}`);
  return r.stdout;
}
const FFMPEG = has('ffmpeg') && has('ffprobe');

/** The NAL units of an Annex B stream. */
function nals(b: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  for (let i = 0; i + 3 <= b.length; i++) if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) starts.push(i + 3);
  return starts.map((s, k) => {
    let end = k + 1 < starts.length ? starts[k + 1] - 3 : b.length;
    while (end > s && b[end - 1] === 0) end--;
    return b.subarray(s, end);
  });
}

function probe(file: string): { codec: string; frames: number; duration: number; width: number; height: number } {
  const out = JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,nb_read_frames,width,height:format=duration', '-of', 'json', file]));
  return { codec: out.streams[0].codec_name, frames: Number(out.streams[0].nb_read_frames), duration: Number(out.format.duration), width: out.streams[0].width, height: out.streams[0].height };
}

describe.skipIf(!FFMPEG)('the writers with real frames (ffmpeg here)', () => {
  it('24 H.264 frames of libx264 in our MP4: ffprobe reads 24 frames and 2 s', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-mp4-'));
    try {
      const raw = join(dir, 'in.h264');
      run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=12:duration=2', '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-g', '24', '-bf', '0', '-x264-params', 'aud=0', '-f', 'h264', raw]);
      const units = nals(new Uint8Array(readFileSync(raw)));
      const sps = units.find((u) => (u[0] & 0x1f) === 7)!;
      const pps = units.find((u) => (u[0] & 0x1f) === 8)!;
      // The configuration record of ISO/IEC 14496-15: version, profile, compatibility, level, 4-byte lengths, one SPS, one PPS.
      const avcc = Uint8Array.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 0xff, ...sps, 1, pps.length >> 8, pps.length & 0xff, ...pps]);
      // One sample per picture (x264 writes one slice a picture at this size), with the SEI before it, length-prefixed.
      const samples: Uint8Array[][] = [];
      let pending: Uint8Array[] = [];
      for (const u of units) {
        const type = u[0] & 0x1f;
        if (type === 1 || type === 5) {
          samples.push([...pending, u]);
          pending = [];
        } else if (type === 6) pending.push(u);
      }
      const encoded: EncodedVideoFrame[] = samples.map((p, i) => {
        const data = new Uint8Array(p.reduce((a, u) => a + 4 + u.length, 0));
        let at = 0;
        for (const u of p) {
          new DataView(data.buffer).setUint32(at, u.length);
          data.set(u, at + 4);
          at += 4 + u.length;
        }
        return { data, ...frameTiming(i, 12), key: p.some((u) => (u[0] & 0x1f) === 5) };
      });
      expect(encoded).toHaveLength(24);
      const out = join(dir, 'out.mp4');
      writeFileSync(out, muxMp4({ codec: 'H264', width: 320, height: 180, fps: 12, description: avcc }, encoded));
      expect(probe(out)).toEqual({ codec: 'h264', frames: 24, duration: 2, width: 320, height: 180 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it('24 VP9 frames of libvpx in our WebM: ffprobe reads 24 frames and 2 s', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-webm-'));
    try {
      const ivf = join(dir, 'in.ivf');
      run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=12:duration=2', '-c:v', 'libvpx-vp9', '-g', '24', '-auto-alt-ref', '0', '-lag-in-frames', '0', '-deadline', 'realtime', '-cpu-used', '8', '-f', 'ivf', ivf]);
      // IVF: a 32-byte header, then per frame 4 bytes of size, 8 of timestamp and the frame.
      const b = new Uint8Array(readFileSync(ivf));
      const dv = new DataView(b.buffer, b.byteOffset);
      const encoded: EncodedVideoFrame[] = [];
      for (let at = 32; at + 12 <= b.length; ) {
        const size = dv.getUint32(at, true);
        const data = b.slice(at + 12, at + 12 + size);
        // A key frame every 24 (-g 24), as ffmpeg was asked.
        const key = encoded.length % 24 === 0;
        encoded.push({ data, ...frameTiming(encoded.length, 12), key });
        at += 12 + size;
      }
      expect(encoded).toHaveLength(24);
      const out = join(dir, 'out.webm');
      writeFileSync(out, muxWebm({ codec: 'VP9', width: 320, height: 180, fps: 12 }, encoded));
      expect(probe(out)).toEqual({ codec: 'vp9', frames: 24, duration: 2, width: 320, height: 180 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

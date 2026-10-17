// What a video file is made of (phase N1): one video track and its encoded frames, as the browser's encoder
// (WebCodecs) hands them out. The muxers (io/webm.ts, io/mp4.ts) write them into a file; nothing here knows how the
// frames were encoded.

/** The codec of a track: what the frames are. */
export type TrackCodec = 'VP9' | 'VP8' | 'H264';

export interface VideoTrackInfo {
  codec: TrackCodec;
  width: number;
  height: number;
  /** Frames per second, a whole number. */
  fps: number;
  /** The codec's configuration record (H.264: the `avcC` box's payload, from the encoder's decoder configuration). */
  description?: Uint8Array;
}

/** One encoded frame, in decoding order. */
export interface EncodedVideoFrame {
  data: Uint8Array;
  /** Presentation time and duration, microseconds. */
  timestampUs: number;
  durationUs: number;
  key: boolean;
}

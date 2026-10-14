// The messages between the interface and the material graph workers (phase M3a, render/graph-worker.ts): the node
// previews of the material editor and the bands of the Fast preview's bakes. A program travels whole (typed arrays
// structured-cloned); an image travels once per worker, as its decoded pixels when the registry has them, else as
// its file for the worker to decode.

import type { BakeBand, BakePlan } from '../core/material-preview';
import type { Program } from '../core/material-program';

export interface GraphImageMsg {
  id: string;
  width: number;
  height: number;
  /** Straight 8-bit RGBA, rows from the top. */
  rgba?: Uint8Array;
  /** Or the file, to decode. */
  bytes?: Uint8Array;
  format?: 'PNG' | 'JPEG';
}

export type GraphRequest =
  | { kind: 'previews'; seq: number; program: Program; images: GraphImageMsg[]; size: number; materialSize: number }
  | { kind: 'bake'; seq: number; program: Program; images: GraphImageMsg[]; plan: BakePlan; size: number; r0: number; r1: number };

export type GraphReply =
  | { kind: 'previews'; seq: number; probes: Uint8ClampedArray[]; material: Uint8ClampedArray; size: number; materialSize: number }
  | { kind: 'bake'; seq: number; band: BakeBand }
  | { kind: 'error'; seq: number; message: string };

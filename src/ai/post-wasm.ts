// The AI guard in WebAssembly (phase X3a): a typed wrapper over public/engine/post.wasm, the build of
// engine/crates/rt-post (conditioning, tiles, the deterministic guard, its checks and the step machine,
// AI-POST.md §7.2). No DOM and no fetch of its own unless asked: it runs in a web worker and in Node tests.
//
// The steps are rt-post's: `open` plans the job, `input` and `control` give each tile what the model needs,
// `setOutput` takes what it returned and `accept` guards, checks and decides (accepted, retry at a lower strength,
// rejected). The model itself is not here: `runGuarded` is the trivial driver that calls it between the steps.

import { MAX_ATTEMPTS, type AiGuardMaterial, type AiGuardTolerances, type AiPipelineSettings, type AiPostProgress, type AiPostResult, type GuardReport, type LinearImage } from '../core/ai';
import type { RenderPasses } from '../core/passes';

/** The guard's tolerances as rt-post names them (`Tolerances::KEYS`), in its order. Provisional: X1b calibrates them. */
export const GUARD_TOLERANCE_KEYS = [
  'deltaEMean',
  'deltaEP95',
  'edgesPx',
  'detailSsim',
  'focus',
  'inFocusCoc',
  'outOfFocusCoc',
  'creaseDeg',
  'edgeContrast',
  'capLight',
  'capBounce',
  'capStyle',
  'capWear',
] as const;
export type GuardToleranceKey = (typeof GUARD_TOLERANCE_KEYS)[number];
export type GuardTolerances = Record<GuardToleranceKey, number>;

/** One job for the guard: the image's size and look, the controls, the material regions. */
export interface PostJob {
  width: number;
  height: number;
  /** The render's tone curve, as `RNDR.tonemap` codes it (0 linear, 1 ACES, 2 filmic, 3 AgX, 4 standard): the model sees the image as the user does. */
  tonemap: number;
  /** The render's exposure, EV. */
  exposureEv: number;
  settings: AiPipelineSettings;
  materials: readonly AiGuardMaterial[];
  /** Echoed in the report. */
  modelKey: string;
  runtime: string;
  /**
   * Overrides of the provisional tolerances: the person's from Settings (`jobTolerances`, C1), and any other key for
   * the calibration tools.
   */
  tolerances?: Partial<GuardTolerances>;
}

/** The overrides a request's tolerances (Settings ▸ AI post-processing ▸ Advanced) make of a job's (C1). */
export function jobTolerances(t: AiGuardTolerances | undefined): Partial<GuardTolerances> | undefined {
  return t ? { deltaEMean: t.deltaEMean, deltaEP95: t.deltaEP95, edgesPx: t.edgesPx } : undefined;
}

/** One tile of the plan: a rectangle of the image and the padded size the model works at (a multiple of 16). */
export interface PostTile {
  x: number;
  y: number;
  width: number;
  height: number;
  paddedWidth: number;
  paddedHeight: number;
}

/** What rt-post planned for a job (its `Plan::to_json`). No tiles: nothing may change and the model is never called. */
export interface PostPlan {
  width: number;
  height: number;
  tiles: PostTile[];
  /** The img2img strength of every attempt. */
  strengths: number[];
  maxStrength: number;
  maxAttempts: number;
  retryFactor: number;
  sigmaLow: number;
  tolerances: GuardTolerances;
}

/** 8-bit sRGB, 3 bytes a pixel: what the model is given and what it returns. */
export interface TileImage {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** What the model gets for one tile: the engine image as the user sees it and the control images (one byte a pixel), all padded. */
export interface TileControl {
  width: number;
  height: number;
  input: Uint8Array;
  /** Id and normal discontinuities: 255 on both sides of an edge. */
  edges: Uint8Array;
  /** Near 255, the farthest surface 16, background 0. */
  depth: Uint8Array;
}

export type AcceptResult =
  /** ACCEPTED: the guarded image. REJECTED: the engine image, unchanged. `reportJson` is the report exactly as rt-post wrote it. */
  | { kind: 'ACCEPTED' | 'REJECTED'; image: LinearImage; report: GuardReport; reportJson: string }
  | { kind: 'RETRY'; strength: number; attempt: number; reason: string };

/** A call the guard refused (bad input, or a step out of order); `status` is post.wasm's code. */
export class PostError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PostError';
  }
}

const STATUS_NAMES = ['ok', 'bad handle', 'bad argument', 'null pointer', 'missing input', 'invalid input'];
const OUTCOME_ACCEPTED = 0;
const OUTCOME_RETRY = 1;
const OUTCOME_REJECTED = 2;
const OUTCOME_ERROR = 16;
const CONTROL_EDGES = 0;
const CONTROL_DEPTH = 1;

interface Exports {
  memory: WebAssembly.Memory;
  post_version(): number;
  post_alloc(len: number): number;
  post_free(ptr: number, len: number): void;
  post_error_len(): number;
  post_error_copy(ptr: number): void;
  post_text_len(): number;
  post_text_copy(ptr: number): void;
  post_open(ptr: number, len: number): number;
  post_close(handle: number): number;
  post_set_image(handle: number, ptr: number, width: number, height: number): number;
  post_set_passes(handle: number, width: number, height: number, part: number, material: number, normal: number, depth: number, coc: number): number;
  post_tile_input(handle: number, tile: number, out: number): number;
  post_tile_control(handle: number, tile: number, kind: number, out: number): number;
  post_set_output(handle: number, tile: number, width: number, height: number, ptr: number): number;
  post_strength(handle: number, attempt: number): number;
  post_accept(handle: number, attempt: number): number;
  post_result(handle: number, out: number): number;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** The little-endian bytes of a typed array (a view when the platform is little-endian, which every one in use is). */
function leBytes(a: Float32Array | Uint32Array): Uint8Array {
  if (LITTLE_ENDIAN) return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const out = new Uint8Array(a.byteLength);
  const view = new DataView(out.buffer);
  a.forEach((v, i) => (a instanceof Float32Array ? view.setFloat32(i * 4, v, true) : view.setUint32(i * 4, v, true)));
  return out;
}

/** The binary job rt-post reads (`Job::from_bytes`, magic RPJ1). */
export function encodeJob(job: PostJob): Uint8Array {
  const text = new TextEncoder();
  const strings: Uint8Array[] = [];
  const str = (s: string) => {
    const b = text.encode(s);
    strings.push(b);
    return b;
  };
  const names = job.materials.map((m) => str(m.name));
  const model = str(job.modelKey);
  const runtime = str(job.runtime);
  const overrides = GUARD_TOLERANCE_KEYS.filter((k) => job.tolerances?.[k] !== undefined).map((k) => [str(k), job.tolerances![k]!] as const);
  const size = 4 + 4 * 4 + 6 * 4 + 4 + job.materials.length * 12 + strings.reduce((n, b) => n + b.length, 0) + 8 + 4 + overrides.length * 8;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u32 = (v: number) => (view.setUint32(at, v >>> 0, true), (at += 4));
  const f32 = (v: number) => (view.setFloat32(at, v, true), (at += 4));
  const bytes = (b: Uint8Array) => (u32(b.length), out.set(b, at), (at += b.length));
  out.set([0x52, 0x50, 0x4a, 0x31], 0); // "RPJ1"
  at = 4;
  u32(job.width);
  u32(job.height);
  u32(job.tonemap);
  f32(job.exposureEv);
  const s = job.settings;
  const control = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  for (const v of [s.intervention, s.light, s.bounce, s.wear, s.styleStrength]) u32(control(v));
  u32(s.seed);
  u32(job.materials.length);
  job.materials.forEach((m, i) => {
    u32(m.materialId);
    u32((m.allowsWear ? 1 : 0) | (m.locked ? 2 : 0));
    bytes(names[i]);
  });
  bytes(model);
  bytes(runtime);
  u32(overrides.length);
  for (const [key, value] of overrides) {
    bytes(key);
    f32(value);
  }
  return out;
}

/** The loaded post.wasm. One instance serves any number of sessions, one call at a time. */
export class PostGuard {
  private constructor(private readonly x: Exports) {}

  static async fromBytes(bytes: BufferSource): Promise<PostGuard> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new PostGuard(instance.exports as unknown as Exports);
  }

  static async fromModule(module: WebAssembly.Module): Promise<PostGuard> {
    const instance = await WebAssembly.instantiate(module, {});
    return new PostGuard(instance.exports as unknown as Exports);
  }

  /** Fetches and instantiates the module (in a worker: `new URL('engine/post.wasm', base)`). */
  static async fromUrl(url: string | URL): Promise<PostGuard> {
    const response = await fetch(url);
    if (!response.ok) throw new PostError(`post.wasm: ${response.status} ${response.statusText}`, 0);
    return PostGuard.fromBytes(await response.arrayBuffer());
  }

  /** `major.minor.patch` of the guard (the engine's version). */
  get version(): string {
    const v = this.x.post_version();
    return `${v >>> 16}.${(v >>> 8) & 0xff}.${v & 0xff}`;
  }

  /** Plans `job` on the engine image and its passes (ids required; the others optional) and opens its session. */
  open(job: PostJob, image: LinearImage, passes: RenderPasses): PostSession {
    const x = this.x;
    const handle = withBytes(x, encodeJob(job), (ptr, len) => x.post_open(ptr, len));
    if (handle === 0) throw new PostError(`post.wasm refused the job: ${readError(x)}`, 5);
    const session = new PostSession(x, handle, JSON.parse(readText(x)) as PostPlan, job);
    try {
      session.setImage(image);
      session.setPasses(passes);
    } catch (e) {
      session.close();
      throw e;
    }
    return session;
  }
}

/** One job on post.wasm: its plan and the steps. Close it when done (it holds the image and passes in wasm memory). */
export class PostSession {
  private closed = false;

  /** @internal */
  constructor(
    private readonly x: Exports,
    private readonly handle: number,
    readonly plan: PostPlan,
    readonly job: PostJob,
  ) {}

  /** The img2img strength of attempt `attempt` (0 first), as rt-post computes it. */
  strength(attempt: number): number {
    return this.x.post_strength(this.handle, attempt);
  }

  /** @internal */
  setImage(image: LinearImage): void {
    const x = this.x;
    // The C ABI reads as many bytes as the size says: the sizes are checked here, before any pointer is handed over.
    if (image.width !== this.plan.width || image.height !== this.plan.height || image.rgba.length !== image.width * image.height * 4) {
      throw new PostError(`the image is ${image.width}x${image.height} with ${image.rgba.length} floats, the job ${this.plan.width}x${this.plan.height}`, 2);
    }
    check(x, withBytes(x, leBytes(image.rgba), (ptr) => x.post_set_image(this.handle, ptr, image.width, image.height)), 'the image');
  }

  /** @internal */
  setPasses(passes: RenderPasses): void {
    const x = this.x;
    if (!passes.partId || !passes.materialId) throw new PostError('the guard needs the partId and materialId passes', 4);
    const n = this.plan.width * this.plan.height;
    if (passes.width !== this.plan.width || passes.height !== this.plan.height) throw new PostError(`the passes are ${passes.width}x${passes.height}, the job ${this.plan.width}x${this.plan.height}`, 2);
    const sizes: [string, { length: number } | undefined, number][] = [
      ['partId', passes.partId, n],
      ['materialId', passes.materialId, n],
      ['normal', passes.normal, n * 3],
      ['depth', passes.depth, n],
      ['coc', passes.coc, n],
    ];
    for (const [key, plane, want] of sizes) if (plane && plane.length !== want) throw new PostError(`the ${key} pass has the wrong size: ${plane.length} values for ${want}`, 2);
    const planes = [passes.partId, passes.materialId, passes.normal, passes.depth, passes.coc];
    const ptrs = planes.map((p) => (p ? upload(x, leBytes(p)) : 0));
    try {
      check(x, x.post_set_passes(this.handle, passes.width, passes.height, ptrs[0], ptrs[1], ptrs[2], ptrs[3], ptrs[4]), 'the passes');
    } finally {
      planes.forEach((p, i) => p && x.post_free(ptrs[i], p.byteLength));
    }
  }

  /** What the model gets for tile `tile`. */
  control(tile: number): TileControl {
    const t = this.plan.tiles[tile];
    if (!t) throw new PostError(`the plan has no tile ${tile}`, 2);
    const x = this.x;
    const n = t.paddedWidth * t.paddedHeight;
    const input = readInto(x, n * 3, (out) => x.post_tile_input(this.handle, tile, out), 'the tile input');
    const edges = readInto(x, n, (out) => x.post_tile_control(this.handle, tile, CONTROL_EDGES, out), 'the edges');
    const depth = readInto(x, n, (out) => x.post_tile_control(this.handle, tile, CONTROL_DEPTH, out), 'the depth');
    return { width: t.paddedWidth, height: t.paddedHeight, input, edges, depth };
  }

  /** What the model returned for tile `tile` in this attempt (any size: a wrong one fails the size check). */
  setOutput(tile: number, image: TileImage): void {
    const x = this.x;
    if (image.rgb.length !== image.width * image.height * 3) throw new PostError('the tile output has the wrong number of bytes', 2);
    check(x, withBytes(x, image.rgb, (ptr) => x.post_set_output(this.handle, tile, image.width, image.height, ptr)), `tile ${tile}`);
  }

  /** Guards, checks and decides on the tiles set for attempt `attempt`. The tiles are cleared: a retry sets new ones. */
  accept(attempt: number): AcceptResult {
    const x = this.x;
    const code = x.post_accept(this.handle, attempt);
    if (code >= OUTCOME_ERROR) {
      const status = code - OUTCOME_ERROR;
      throw new PostError(`accept: ${STATUS_NAMES[status] ?? status}${status === 5 ? `: ${readError(x)}` : ''}`, status);
    }
    const text = readText(x);
    if (code === OUTCOME_RETRY) {
      const r = JSON.parse(text) as { strength: number; attempt: number; reason: string };
      return { kind: 'RETRY', strength: r.strength, attempt: r.attempt, reason: r.reason };
    }
    const prefix = `{"outcome":"${code === OUTCOME_ACCEPTED ? 'ACCEPTED' : 'REJECTED'}","report":`;
    if (!text.startsWith(prefix) || (code !== OUTCOME_ACCEPTED && code !== OUTCOME_REJECTED)) throw new PostError(`accept: unexpected outcome ${code}`, 0);
    const reportJson = text.slice(prefix.length, -1);
    const n = this.plan.width * this.plan.height * 4;
    const bytes = readInto(x, n * 4, (out) => x.post_result(this.handle, out), 'the result');
    const rgba = new Float32Array(n);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) rgba[i] = view.getFloat32(i * 4, true);
    return {
      kind: code === OUTCOME_ACCEPTED ? 'ACCEPTED' : 'REJECTED',
      image: { width: this.plan.width, height: this.plan.height, rgba },
      report: JSON.parse(reportJson) as GuardReport,
      reportJson,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.x.post_close(this.handle);
  }
}

/** One call of the model: what `runGuarded` hands it for one tile of one attempt. */
export interface TileRequest extends TileControl {
  tile: number;
  tiles: number;
  strength: number;
  attempt: number;
  seed: number;
}

export type GuardedModel = (request: TileRequest) => TileImage | Promise<TileImage>;

/**
 * The driver (AI-POST.md §7.2): for every attempt, run `model` on every tile and let the guard decide, until it
 * accepts or rejects. Intervention 0 (or every aspect at 0) never calls the model and returns the input bit for bit.
 * The report's `seconds` is the time measured here.
 */
export async function runGuarded(
  session: PostSession,
  model: GuardedModel,
  onProgress?: (p: AiPostProgress) => void,
  signal?: AbortSignal,
): Promise<AiPostResult & { reportJson: string }> {
  const start = performance.now();
  const tiles = session.plan.tiles.length;
  const controls = session.plan.tiles.map((_, i) => session.control(i));
  // The progress is 1-based and its bar is split by attempts (core/ai.ts AiPostProgress); the model's own `attempt` is 0-based.
  let sentBack: string | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const strength = session.strength(attempt);
    const at = (within: number) => (attempt + within) / MAX_ATTEMPTS;
    const where = { tiles, attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, ...(sentBack ? { reason: sentBack } : {}) };
    for (let tile = 0; tile < tiles; tile++) {
      signal?.throwIfAborted();
      onProgress?.({ stage: attempt === 0 ? 'INFERENCE' : 'RETRY', tile: tile + 1, ...where, fraction: at(tile / (tiles + 1)) });
      const out = await model({ ...controls[tile], tile, tiles, strength, attempt, seed: session.job.settings.seed });
      signal?.throwIfAborted();
      session.setOutput(tile, out);
    }
    onProgress?.({ stage: 'GUARD', tile: tiles, ...where, fraction: at(tiles / (tiles + 1)) });
    const r = session.accept(attempt);
    if (r.kind === 'RETRY') {
      sentBack = r.reason;
      continue;
    }
    const seconds = Math.round((performance.now() - start) / 10) / 100;
    return { image: r.image, report: { ...r.report, seconds }, reportJson: r.reportJson };
  }
  throw new PostError('the guard neither accepted nor rejected within MAX_ATTEMPTS', 0);
}

function upload(x: Exports, bytes: Uint8Array): number {
  const ptr = x.post_alloc(bytes.length);
  // A fresh view: allocating may have grown (and detached) the memory.
  new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
}

function withBytes<T>(x: Exports, bytes: Uint8Array, use: (ptr: number, len: number) => T): T {
  const ptr = upload(x, bytes);
  try {
    return use(ptr, bytes.length);
  } finally {
    x.post_free(ptr, bytes.length);
  }
}

function readInto(x: Exports, len: number, fill: (out: number) => number, what: string): Uint8Array {
  const ptr = x.post_alloc(len);
  try {
    check(x, fill(ptr), what);
    return new Uint8Array(x.memory.buffer, ptr, len).slice();
  } finally {
    x.post_free(ptr, len);
  }
}

function check(x: Exports, status: number, what: string): void {
  if (status !== 0) throw new PostError(`${what}: ${STATUS_NAMES[status] ?? status}${status === 5 ? `: ${readError(x)}` : ''}`, status);
}

function readUtf8(x: Exports, len: number, copy: (ptr: number) => void): string {
  if (len === 0) return '';
  const ptr = x.post_alloc(len);
  try {
    copy(ptr);
    return new TextDecoder().decode(new Uint8Array(x.memory.buffer, ptr, len).slice());
  } finally {
    x.post_free(ptr, len);
  }
}

function readText(x: Exports): string {
  return readUtf8(x, x.post_text_len(), (p) => x.post_text_copy(p));
}

function readError(x: Exports): string {
  return readUtf8(x, x.post_error_len(), (p) => x.post_error_copy(p));
}

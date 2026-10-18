// The physics bar's commands and the simulation in progress (phase S2, UI.md §2.5). Drop simulates the selection;
// Start, the parts whose role is Dynamic. Every run records itself (ROADMAP, physics decision 5): when the world is
// built each mover gets a PHYSICS clip at the playhead, the clips grow a frame at a time (at the project's fps) while
// it runs and the playhead follows them, so the viewport shows the simulation through the timeline. Pause freezes it
// where the viewport shows it: what the simulator reports while paused waits for Resume. Stop commits the pose shown
// (what comes after it is left out); everything falling asleep, or the time limit, commits the last frame. Either way
// the movers end where their clips end. The clips, the roles Drop
// gives and the final poses are one undo step (one gesture); Reset takes the clips away and puts the movers back, as
// a step of its own. Anything else that takes the run's clips or movers away (an undo, a deletion) ends it without
// committing anything.
//
// S3b: Start also runs the front glass of the active camera when it is fed by the scene (Camera ▸ Front glass ▸ From
// the scene) and some effect rains or dusts on it (core/wet.ts): its pane steps with the bodies in the same worker, or
// alone, each frame's record grows a PHYSICS clip of the camera (the glass track, the cache), and a run with a glass
// stops only by Stop or its time (it keeps raining). Drop runs the bodies alone. Reset takes the glass clip away too.
//
// S3c: Start also wets the parts when some effect falls on them (its switch in Scene ▸ Ambient, core/wet-parts.ts): every
// visible part that does not move in the run steps under the effects in the same worker, each frame's record grows a
// PHYSICS clip of the scene (the parts track, the cache), and such a run too stops only by Stop or its time.

import { activeCamera, isPanoramic, type CameraId } from '../core/camera';
import { nextIds } from '../core/ids';
import { glassFromScene } from '../core/optics';
import { capAngleDeg, GlassTrackWriter, wetBytes, wetKey, wetSpec, type GlassTrack, type WetPaneSpec } from '../core/wet';
import { MAX_GLASS_SECONDS } from '../data/front-glass';
import { MAX_PARTS_SECONDS } from '../data/wet-parts';
import { parseLayout, PartsTrackWriter, wetPartsKey, wetPartsSpec, wptBytes, writtenParts, type PartsTrack, type WetPartEntry } from '../core/wet-parts';
import {
  anchorOf,
  glassClip,
  moverSample,
  partsClip,
  moverTransforms,
  NO_BODY,
  physicsClip,
  physicsSpec,
  poseTransforms,
  STEPS_PER_SECOND,
  TrackWriter,
  type PhysicsResult,
  type PhysicsRole,
  type PhysicsRunHandle,
  type PhysicsSpec,
  type PhysicsStarted,
  type PhysicsTrack,
  type PhysicsUpdate,
} from '../core/physics';
import type { NodeId, Transform } from '../core/scene';
import type { Store } from '../core/store';
import { movableTargets } from '../core/transform';
import { MAX_SIMULATED_SECONDS } from '../data/physics';
import type { Label } from '../data/types';
import { targetLabel } from './names';
import type { Ctx } from './reactive';
import { L, t } from './strings';
import type { PhysicsUi } from './ui-state';

interface Session {
  ctx: Ctx;
  run: PhysicsRunHandle;
  spec: PhysicsSpec;
  gesture: string;
  label: Label;
  roles?: Record<NodeId, PhysicsRole>;
  /** The movers' transforms before the run (what Reset puts back). */
  pre: Record<NodeId, Transform>;
  /** Where the clips start (the playhead, on a frame), seconds; their fps. */
  start: number;
  fps: number;
  ids: Uint32Array | null;
  initial: Float32Array | null;
  /** The clip of each body of the spec ('' for one the simulator kept out). */
  clips: string[];
  writers: (TrackWriter | null)[];
  frames: number;
  /** The poses of the last frame shown, and what the simulator said with it. */
  last: Float32Array | null;
  shown: { steps: number; awake: number; bodies: number };
  /** Paused: reports wait in `held` (and the end in `heldEnd`) for Resume. Stopped: what comes is left out. */
  paused: boolean;
  stopped: boolean;
  held: PhysicsUpdate[];
  heldEnd: PhysicsResult | null;
  begun: boolean;
  over: boolean;
  unsubscribe: () => void;
  /** S3b: the front glass that runs with it, its track and its clip ('' until it begins). */
  glass: GlassRun | null;
  /** S3c: the parts it wets, their track and their clip ('' until it begins). */
  parts: PartsRun | null;
}

/** S3c: the wet parts of a run. */
interface PartsRun {
  bytes: Uint8Array;
  key: string;
  /** The parts the WPT1 holds, in its order. */
  parts: WetPartEntry[];
  writer: PartsTrackWriter | null;
  clip: string;
}

/** S3b: the front glass of a run. */
interface GlassRun {
  camera: CameraId;
  spec: WetPaneSpec;
  key: string;
  writer: GlassTrackWriter | null;
  clip: string;
}

interface LastRun {
  pre: Record<NodeId, Transform>;
  clips: string[];
  start: number;
}

const sessions = new WeakMap<Store, Session>();
const lastRuns = new WeakMap<Store, LastRun>();
let gestureCount = 0;

function setUi(ctx: Ctx, patch: Partial<PhysicsUi>): void {
  ctx.ui.set({ physics: { ...ctx.ui.get().physics, ...patch } });
}

/** A run is in progress (starting, running or paused). */
export function simulating(ctx: Ctx): boolean {
  return sessions.has(ctx.store);
}

/** The last run's clips are still in the project (Reset would take them away). */
function lastRunAlive(ctx: Ctx): LastRun | null {
  const last = lastRuns.get(ctx.store);
  if (!last) return null;
  const clips = ctx.store.get().animation.clips;
  return last.clips.some((id) => clips.some((c) => c.id === id)) ? last : null;
}

/** Ends a run without committing anything (Reset, an undo that took its clips away). */
function abandon(session: Session): void {
  if (session.over) return;
  session.over = true;
  session.unsubscribe();
  session.run.stop();
  forget(session);
}

/** The run is no longer the store's (only if a newer one has not taken its place). */
function forget(session: Session): void {
  if (sessions.get(session.ctx.store) === session) sessions.delete(session.ctx.store);
}

/** The run's clips: the bodies', its glass's and its parts'. */
function runClips(session: Session): string[] {
  return [...session.clips.filter(Boolean), ...(session.glass?.clip ? [session.glass.clip] : []), ...(session.parts?.clip ? [session.parts.clip] : [])];
}

function grow(session: Session, frames: readonly Float32Array[], glass?: readonly Uint8Array[], parts?: readonly Uint8Array[]): void {
  if (!session.ids || !session.initial || frames.length === 0) return;
  const { spec, ids, initial } = session;
  frames.forEach((frame, k) => {
    session.writers.forEach((w, i) => w?.push(moverSample(spec, i, initial, frame, ids[i])));
    const record = glass?.[k];
    if (record) session.glass?.writer?.push(record);
    const partsRecord = parts?.[k];
    if (partsRecord) session.parts?.writer?.push(partsRecord);
    session.frames++;
    session.last = frame;
  });
  const tracks: Record<string, PhysicsTrack> = {};
  session.writers.forEach((w, i) => {
    if (w && session.clips[i]) tracks[session.clips[i]] = w.track();
  });
  const g = session.glass;
  const glassTracks: Record<string, GlassTrack> | undefined = g?.writer && g.clip ? { [g.clip]: g.writer.track() } : undefined;
  if (g?.writer) setUi(session.ctx, { glass: { drops: g.writer.lastDrops, motes: g.writer.motesAlive } });
  const pr = session.parts;
  const partsTracks: Record<string, PartsTrack> | undefined = pr?.writer && pr.clip ? { [pr.clip]: pr.writer.track() } : undefined;
  if (pr?.writer) setUi(session.ctx, { parts: { drops: pr.writer.lastDrops, drips: pr.writer.totalDrips, falling: pr.writer.lastFalling } });
  const { store } = session.ctx;
  store.dispatch({ type: 'physics/grow', tracks, ...(glassTracks ? { glass: glassTracks } : {}), ...(partsTracks ? { parts: partsTracks } : {}), gesture: session.gesture, label: session.label });
  store.dispatch({ type: 'anim/playhead', t: session.start + (session.frames - 1) / session.fps });
}

function begin(session: Session, started: PhysicsStarted): void {
  if (session.over) return;
  const { ctx, spec } = session;
  session.ids = started.ids;
  session.initial = started.initial;
  session.last = started.initial;
  session.shown = { steps: 0, awake: started.bodies, bodies: started.bodies };
  const state = ctx.store.get();
  const kept = spec.bodies.map((_, i) => started.ids[i] !== undefined && started.ids[i] !== NO_BODY);
  const fresh = nextIds('c', state.animation.clips.map((c) => c.id), kept.filter(Boolean).length);
  let k = 0;
  session.clips = kept.map((ok) => (ok ? fresh[k++] : ''));
  session.writers = kept.map((ok, i) => {
    if (!ok) return null;
    const w = new TrackWriter(session.fps);
    w.push(moverSample(spec, i, started.initial, started.initial, started.ids[i]));
    return w;
  });
  session.frames = 1;
  const clips = spec.bodies
    .map((b, i) => (session.writers[i] ? physicsClip(session.clips[i], b.mover, session.start, session.writers[i]!.track(), anchorOf(session.pre[b.mover] ?? state.scene.nodes[b.mover].transform)) : null))
    .filter((c) => c !== null);
  // S3b: the glass's clip, its first frame the dry pane of step 0.
  const g = session.glass;
  if (g && started.glass) {
    g.writer = new GlassTrackWriter(g.camera, session.fps, g.key, capAngleDeg(g.spec));
    g.writer.push(started.glass);
    g.clip = nextIds('c', [...state.animation.clips.map((c) => c.id), ...session.clips.filter(Boolean)], 1)[0];
    clips.push(glassClip(g.clip, session.start, g.writer.track()));
  }
  // S3c: the parts' clip, its first frame the dry parts of step 0.
  const pr = session.parts;
  const layout = started.parts ? parseLayout(started.parts.layout) : null;
  if (pr && started.parts && layout && layout.parts.length === pr.parts.length) {
    const meta = pr.parts.map((p, k) => ({ node: p.node, mesh: p.mesh, triangles: layout.parts[k].triangles, samples: layout.parts[k].samples, capAngleDeg: layout.parts[k].capAngleDeg, porosity: p.porosity }));
    pr.writer = new PartsTrackWriter(session.fps, pr.key, meta, started.parts.layout);
    pr.writer.push(started.parts.frame);
    pr.clip = nextIds('c', [...state.animation.clips.map((c) => c.id), ...session.clips.filter(Boolean), ...(g?.clip ? [g.clip] : [])], 1)[0];
    clips.push(partsClip(pr.clip, session.start, pr.writer.track()));
  }
  ctx.store.dispatch({ type: 'anim/play', playing: false });
  ctx.store.dispatch({ type: 'physics/begin', clips, roles: session.roles, gesture: session.gesture, label: session.label });
  ctx.store.dispatch({ type: 'anim/playhead', t: session.start });
  session.begun = true;
  // From now on, anything that takes the run's clips or movers away ends it.
  session.unsubscribe = ctx.store.subscribe((s) => {
    if (session.over) return;
    const alive = runClips(session).every((id) => s.animation.clips.some((c) => c.id === id)) && spec.bodies.every((b) => s.scene.nodes[b.mover]);
    if (!alive) {
      abandon(session);
      setUi(ctx, { state: 'STOPPED', ended: 'STOPPED', canReset: lastRunAlive(ctx) !== null });
    }
  });
  setUi(ctx, { state: ctx.ui.get().physics.state === 'PAUSED' ? 'PAUSED' : 'RUNNING', time: 0, bodies: started.bodies, awake: started.bodies, ended: null, canReset: true, glass: g?.writer ? { drops: 0, motes: 0 } : null, parts: pr?.writer ? { drops: 0, drips: 0, falling: 0 } : null });
}

function update(session: Session, u: PhysicsUpdate): void {
  if (session.over || !session.begun || session.stopped) return;
  if (session.paused) {
    session.held.push(u);
    return;
  }
  grow(session, u.frames, u.glass, u.parts);
  session.shown = { steps: u.steps, awake: u.awake, bodies: u.bodies };
  setUi(session.ctx, { time: u.steps / STEPS_PER_SECOND, awake: u.awake, bodies: u.bodies });
}

function ended(session: Session, r: PhysicsResult): void {
  if (session.paused && !session.stopped) session.heldEnd = r;
  else finish(session, r);
}

function finish(session: Session, r: PhysicsResult): void {
  if (session.over) return;
  const { ctx, spec } = session;
  // Stopped by the person: the pose shown, not what the simulator did after it.
  const cut = session.stopped;
  if (!cut) grow(session, r.frames, r.glass, r.parts);
  session.over = true;
  session.unsubscribe();
  forget(session);
  if (session.ids && session.initial && session.last) {
    const transforms = poseTransforms(ctx.store.get(), spec, session.ids, session.initial, session.last);
    ctx.store.dispatch({ type: 'physics/commit', transforms, clips: session.clips.filter(Boolean), gesture: session.gesture, label: session.label });
    lastRuns.set(ctx.store, { pre: session.pre, clips: runClips(session), start: session.start });
  }
  const said = cut ? session.shown : { steps: r.steps, awake: r.awake, bodies: r.bodies };
  // A run that replaced this one owns the bar now.
  if (!simulating(ctx)) setUi(ctx, { state: 'STOPPED', ended: cut ? 'STOPPED' : r.reason, time: said.steps / STEPS_PER_SECOND, awake: said.awake, bodies: said.bodies, canReset: true });
}

/**
 * S3b: the front glass a Start runs: the active camera's, when it is fed by the scene and some effect rains or dusts on
 * it, with the spec of its simulation (its square and axes from the engine, data/wettability.ts, its seed); NO_ENGINE
 * without the engine's pane, null when there is nothing to run.
 */
function glassRun(ctx: Ctx): GlassRun | 'NO_ENGINE' | null {
  const state = ctx.store.get();
  const cam = activeCamera(state);
  const g = cam.optics?.frontGlass;
  if (!g?.on || !glassFromScene(g) || isPanoramic(cam.projection)) return null;
  const engine = ctx.services.glass?.pane(state, cam.id) ?? null;
  if (!engine) return 'NO_ENGINE';
  const spec = wetSpec(state, engine.axes, engine.pane.halfExtentMm, g.seed);
  if (!spec) return null;
  return { camera: cam.id, spec, key: wetKey(wetBytes(spec)), writer: null, clip: '' };
}

/**
 * S3c: the parts a Start wets: every visible part that the run does not move, when some effect falls on them, with the
 * bytes of the simulation (its WPT1) and their key; null when there is nothing to run.
 */
function partsRun(ctx: Ctx, spec: PhysicsSpec | null): PartsRun | null {
  const moving = new Set((spec?.bodies ?? []).flatMap((b) => b.pieces.map((p) => p.part)));
  const parts = wetPartsSpec(ctx.store.get(), moving);
  if (!parts) return null;
  const written = writtenParts(parts);
  if (written.length === 0) return null;
  const bytes = wptBytes(parts);
  return { bytes, key: wetPartsKey(bytes), parts: written, writer: null, clip: '' };
}

function fail(session: Session, err: unknown): void {
  if (session.over) return;
  const { ctx } = session;
  abandon(session);
  const missing = err instanceof Error && err.message === 'NO_ENGINE';
  if (!missing) console.warn('physics:', err);
  setUi(ctx, { state: 'STOPPED', ended: missing ? 'NO_ENGINE' : 'FAILED', canReset: lastRunAlive(ctx) !== null });
  ctx.ui.toast(t(missing ? 'phys.noEngine' : 'phys.failed'));
}

/** Starts a run: of `drop` (Drop: they become Dynamic), or of the parts whose role is Dynamic. */
function simulate(ctx: Ctx, drop: NodeId[] | null): void {
  const port = ctx.services.physics;
  if (!port) {
    setUi(ctx, { ended: 'NO_ENGINE' });
    ctx.ui.toast(t('phys.noEngine'));
    return;
  }
  // A run in progress stops first and commits its poses; the new one starts from them.
  const current = sessions.get(ctx.store);
  if (current?.begun) {
    stop(ctx);
    void current.run.done.catch(() => undefined).then(() => simulate(ctx, drop));
    return;
  }
  if (current) abandon(current);
  const state = ctx.store.get();
  // S3b: Start runs the front glass fed by the scene too (Drop runs the bodies it drops).
  const glass = drop ? null : glassRun(ctx);
  if (glass === 'NO_ENGINE') {
    setUi(ctx, { ended: 'NO_ENGINE' });
    ctx.ui.toast(t('phys.noEngine'));
    return;
  }
  const bodies = physicsSpec(state, drop ?? undefined);
  // S3c: Start wets the parts too (Drop runs the bodies it drops).
  const parts = drop ? null : partsRun(ctx, bodies);
  const spec = bodies ?? (glass || parts ? { bodies: [], statics: [], floor: { z: 0, friction: 0, bounciness: 0 } } : null);
  if (!spec) {
    setUi(ctx, { ended: 'NOTHING' });
    ctx.ui.toast(t(drop ? 'phys.nothingToDrop' : 'phys.nothingDynamic'));
    return;
  }
  const fps = state.animation.fps;
  const targets = drop ? movableTargets(state, drop) : [];
  const roles = drop ? Object.fromEntries(targets.map((id) => [id, 'DYNAMIC' as PhysicsRole])) : undefined;
  const label = drop ? L('undo.drop', { target: targetLabel(state, targets) }) : L('undo.simulate');
  const session: Session = {
    ctx,
    run: null as unknown as PhysicsRunHandle,
    spec,
    gesture: `physics${++gestureCount}:${Date.now()}`,
    label,
    roles,
    pre: moverTransforms(state, spec),
    start: Math.round(state.animation.playhead * fps) / fps,
    fps,
    ids: null,
    initial: null,
    clips: [],
    writers: [],
    frames: 0,
    last: null,
    shown: { steps: 0, awake: 0, bodies: 0 },
    paused: false,
    stopped: false,
    held: [],
    heldEnd: null,
    begun: false,
    over: false,
    unsubscribe: () => undefined,
    glass,
    parts,
  };
  // A run with a glass or wet parts goes on as long as it rains: only Stop or its time stops it.
  const maxSeconds = glass || parts ? Math.max(glass ? MAX_GLASS_SECONDS : 0, parts ? MAX_PARTS_SECONDS : 0) : MAX_SIMULATED_SECONDS;
  session.run = port.run(spec, { fps, maxSeconds }, (u) => update(session, u), glass?.spec ?? null, parts?.bytes ?? null);
  sessions.set(ctx.store, session);
  setUi(ctx, { state: 'STARTING', time: 0, awake: 0, bodies: spec.bodies.length, ended: null, glass: null, parts: null });
  ctx.ui.set({ drawer: 'physics' });
  session.run.started.then(
    (st) => begin(session, st),
    (err: unknown) => fail(session, err),
  );
  session.run.done.then(
    (r) => ended(session, r),
    (err: unknown) => fail(session, err),
  );
}

/** Drop: the nodes fall onto the floor and whatever is under them (UI.md §2.2, the context menu). */
export function drop(ctx: Ctx, ids: NodeId[]): void {
  simulate(ctx, ids);
}

/** ▶ Start: the parts whose role is Dynamic; while paused, Resume. */
export function start(ctx: Ctx): void {
  const session = sessions.get(ctx.store);
  if (session) {
    resume(ctx);
    return;
  }
  simulate(ctx, null);
}

/** ⏸ Pause: the simulation freezes where it is. */
export function pause(ctx: Ctx): void {
  const session = sessions.get(ctx.store);
  if (!session || session.stopped) return;
  session.paused = true;
  session.run.pause();
  setUi(ctx, { state: 'PAUSED' });
}

/** ▶ Resume. */
export function resume(ctx: Ctx): void {
  const session = sessions.get(ctx.store);
  if (!session || session.stopped || !session.paused) return;
  session.paused = false;
  session.run.resume();
  setUi(ctx, { state: session.begun ? 'RUNNING' : 'STARTING' });
  // What came while paused, in order; then the end, if it came too.
  const held = session.held;
  session.held = [];
  for (const u of held) update(session, u);
  const end = session.heldEnd;
  session.heldEnd = null;
  if (end) finish(session, end);
}

/** ■ Stop: the movers keep the pose they have (committed when the simulator answers). */
export function stop(ctx: Ctx): void {
  const session = sessions.get(ctx.store);
  if (!session) return;
  if (!session.begun) {
    abandon(session);
    setUi(ctx, { state: 'STOPPED', ended: 'STOPPED' });
    return;
  }
  if (session.stopped) return;
  session.stopped = true;
  session.held = [];
  if (session.heldEnd) finish(session, session.heldEnd);
  else session.run.stop();
}

/** ↺ Reset: the run's clips go and the movers go back to where they were before it, as one undo step. */
export function reset(ctx: Ctx): void {
  const session = sessions.get(ctx.store);
  let target: LastRun | null = null;
  if (session) {
    abandon(session);
    if (session.begun) target = { pre: session.pre, clips: runClips(session), start: session.start };
  } else target = lastRunAlive(ctx);
  lastRuns.delete(ctx.store);
  if (target) {
    const nodes = ctx.store.get().scene.nodes;
    const transforms = Object.fromEntries(Object.entries(target.pre).filter(([id]) => nodes[id]));
    ctx.store.dispatch({ type: 'physics/reset', transforms, clips: target.clips, label: L('undo.physicsReset') });
    ctx.store.dispatch({ type: 'anim/playhead', t: target.start });
  }
  setUi(ctx, { state: 'STOPPED', time: 0, awake: 0, ended: null, canReset: false, glass: null, parts: null });
}

/** Keeps the bar's Reset honest: it has something to do only while the last run's clips are in the project. */
export function watchReset(ctx: Ctx): () => void {
  return ctx.store.subscribe(() => {
    if (simulating(ctx)) return;
    const can = lastRunAlive(ctx) !== null;
    if (ctx.ui.get().physics.canReset !== can) setUi(ctx, { canReset: can });
  });
}

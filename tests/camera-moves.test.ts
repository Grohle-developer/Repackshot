// The product-relative camera moves of src/data/camera-moves.json (STUDIO-TOOLS §4 and §6): every move expands into
// valid clips of the existing animation, which evaluate to finite, deterministic poses that start from the camera as
// it is and end where the move says.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate, TARGET_MOVES, totalDuration } from '../src/core/animation';
import { activeCamera, cameraBasis } from '../src/core/camera';
import { expandCameraMove, type MoveContext } from '../src/core/camera-moves';
import { CAMERA_MOVE_LIBRARY, HANDHELD_PRESETS, cameraMove, handheldPreset, type CameraMove, type MoveClipSpec } from '../src/data/camera-moves';
import { EASING_KINDS } from '../src/data/animation';
import type { ProjectState } from '../src/core/store';
import { apply, exampleState } from './helpers';

const KEYS = [
  'turntable',
  'three_quarter_push_in',
  'pull_back_reveal',
  'arc_rise',
  'truck_slide',
  'pedestal',
  'contra_zoom',
  'spiral_up',
  'spiral_down',
  'rack_focus',
  'macro_edge_slide',
  'exploded_orbit',
  'crane',
  'whip_pan',
];

const text = readFileSync('src/data/camera-moves.json', 'utf8');
const FORBIDDEN = ['cinepack', 'keyshot', 'blender', 'zeiss', 'canon', 'nikon', 'sony', 'arri', 'panavision'];
const easings = EASING_KINDS.map((e) => e.key) as string[];

/** The one amount field each kind carries. */
const FIELD: Record<MoveClipSpec['move'], keyof MoveClipSpec> = {
  ORBIT: 'degrees',
  RISE: 'degrees',
  SPIN: 'degrees',
  DOLLY: 'percent',
  TRACK: 'vector',
  ZOOM: 'focalFactor',
  FOCUS: 'focus',
  EXPLODE: 'parts',
};
const FIELDS = ['degrees', 'percent', 'vector', 'focalFactor', 'focus', 'parts'] as const;

function contextOf(state: ProjectState): MoveContext {
  const cam = activeCamera(state);
  return { focalMm: cam.focalMm, focusDistanceMm: cam.focusDistance };
}

/** The project with the move added at `opts` and the camera prepared as the move asks. */
function withMove(move: CameraMove, ctx?: MoveContext, opts?: Parameters<typeof expandCameraMove>[2]): { state: ProjectState; base: ProjectState; expanded: ReturnType<typeof expandCameraMove> } {
  const base = exampleState();
  const expanded = expandCameraMove(move, ctx ?? contextOf(base), opts);
  let prepared = base;
  if (expanded.setup.focusDistanceMm !== undefined) prepared = apply(base, { type: 'camera/set', id: activeCamera(base).id, patch: { focusDistance: expanded.setup.focusDistanceMm } });
  const state = apply(prepared, ...expanded.clips.map((clip) => ({ type: 'anim/addClip' as const, clip })));
  return { state, base: prepared, expanded };
}

describe('camera moves: the library', () => {
  it('has the 14 moves of the plan, with stable unique keys and names in both languages', () => {
    expect(CAMERA_MOVE_LIBRARY.map((m) => m.key)).toEqual(KEYS);
    for (const m of CAMERA_MOVE_LIBRARY) {
      expect(cameraMove(m.key)).toBe(m);
      for (const label of [m.name, m.description]) {
        expect(label.en.trim().length, m.key).toBeGreaterThan(0);
        expect(label.es.trim().length, m.key).toBeGreaterThan(0);
      }
      expect(m.description.en, m.key).not.toMatch(/\n/);
    }
    expect(cameraMove('nope')).toBeUndefined();
  });

  it('uses no brand name', () => {
    for (const word of FORBIDDEN) expect(new RegExp(`(^|[^\\p{L}\\p{N}])${word}([^\\p{L}\\p{N}]|$)`, 'iu').test(text), word).toBe(false);
  });

  it('has a default duration and easing, and bars in relative units that make sense', () => {
    for (const m of CAMERA_MOVE_LIBRARY) {
      expect(m.durationS, m.key).toBeGreaterThanOrEqual(1);
      expect(m.durationS, m.key).toBeLessThanOrEqual(15);
      expect(easings, m.key).toContain(m.easing);
      expect(m.clips.length, m.key).toBeGreaterThan(0);
      for (const c of m.clips) {
        const at = `${m.key} ${c.move}`;
        expect(['CAMERA', 'SUBJECT'], at).toContain(c.target);
        expect(TARGET_MOVES[c.target], at).toContain(c.move);
        expect(c.start, at).toBeGreaterThanOrEqual(0);
        expect(c.length, at).toBeGreaterThan(0);
        expect(c.start + c.length, at).toBeLessThanOrEqual(1 + 1e-9);
        if (c.easing) expect(easings, at).toContain(c.easing);
        // Exactly the amount field of its kind.
        const present = FIELDS.filter((f) => c[f] !== undefined);
        expect(present, at).toEqual([FIELD[c.move]]);
        if (c.degrees !== undefined) expect(Math.abs(c.degrees), at).toBeLessThanOrEqual(720);
        if (c.percent !== undefined) {
          expect(c.percent, at).toBeLessThan(100); // 100 % would put the camera on the target
          expect(c.percent, at).toBeGreaterThan(-300);
        }
        if (c.vector) {
          expect(c.vector, at).toHaveLength(3);
          for (const v of c.vector) expect(Number.isFinite(v) && Math.abs(v) <= 5, at).toBe(true);
        }
        if (c.focalFactor !== undefined) {
          expect(c.focalFactor, at).toBeGreaterThan(0.2);
          expect(c.focalFactor, at).toBeLessThan(5);
        }
        if (c.focus) {
          expect(c.focus.from, at).toBeGreaterThan(0);
          expect(c.focus.to, at).toBeGreaterThan(0);
        }
        if (c.parts !== undefined) expect(c.parts, at).toBeGreaterThan(0);
        // A camera move moves the camera; only the turntable and the exploded view touch the model.
        if (c.target === 'SUBJECT') expect(['turntable', 'exploded_orbit'], at).toContain(m.key);
      }
    }
    expect(CAMERA_MOVE_LIBRARY.filter((m) => m.loop).map((m) => m.key)).toEqual(['turntable']);
    expect(CAMERA_MOVE_LIBRARY.filter((m) => m.needsParts).map((m) => [m.key, m.needsParts])).toEqual([['rack_focus', 2]]);
  });
});

describe('camera moves: expansion into the timeline', () => {
  for (const move of CAMERA_MOVE_LIBRARY) {
    it(`${move.key}: expands into valid clips that evaluate finitely and deterministically at the start and at the end`, () => {
      const { state, base, expanded } = withMove(move);
      expect(expanded.clips).toHaveLength(move.clips.length);
      expect(expanded.durationS).toBe(move.durationS);
      for (const c of expanded.clips) {
        expect(Number.isFinite(c.start) && c.start >= 0, move.key).toBe(true);
        expect(c.duration, move.key).toBeGreaterThan(0);
        expect(c.start + c.duration, move.key).toBeLessThanOrEqual(move.durationS + 1e-9);
        expect(Number.isFinite(c.amount), move.key).toBe(true);
        expect(easings, move.key).toContain(c.easing);
        expect(TARGET_MOVES[c.target.kind], move.key).toContain(c.move);
        expect(c.shot, move.key).toBeNull();
      }
      // The timeline takes them all and runs exactly as long as the move.
      expect(state.animation.clips).toHaveLength(move.clips.length);
      expect(totalDuration(state)).toBeCloseTo(Math.max(...expanded.clips.map((c) => c.start + c.duration)), 9);

      const end = totalDuration(state);
      for (const t of [0, end]) {
        const pose = evaluate(state, t);
        const again = evaluate(state, t);
        expect(JSON.stringify(again), `${move.key} at ${t}`).toBe(JSON.stringify(pose));
        const numbers = [
          pose.envRotationDeg,
          ...(pose.camera ? [pose.camera.azimuth, pose.camera.elevation, pose.camera.distance, pose.camera.focalMm, pose.camera.focusDistance, ...pose.camera.target] : []),
          ...Object.values(pose.nodes).flatMap((n) => [...n.position, ...n.rotation, ...n.scale]),
        ];
        for (const n of numbers) expect(Number.isFinite(n), `${move.key} at ${t}`).toBe(true);
        if (pose.camera) {
          expect(pose.camera.distance).toBeGreaterThan(0);
          expect(pose.camera.focalMm).toBeGreaterThan(0);
        }
      }
      // A second, independent project gives the same poses (nothing hidden in the clips: no clock, no random).
      const other = withMove(move).state;
      expect(JSON.stringify(evaluate(other, end / 2))).toBe(JSON.stringify(evaluate(state, end / 2)));

      // Every move starts from the camera as it is: at t = 0 nothing has moved.
      const cam = activeCamera(base);
      const p0 = evaluate(state, 0);
      if (p0.camera) {
        expect(p0.camera.azimuth).toBeCloseTo(cam.azimuth, 9);
        expect(p0.camera.elevation).toBeCloseTo(cam.elevation, 9);
        expect(p0.camera.distance).toBeCloseTo(cam.distance, 9);
        expect(p0.camera.focalMm).toBeCloseTo(cam.focalMm, 9);
        expect(p0.camera.focusDistance).toBeCloseTo(cam.focusDistance, 6);
        for (let i = 0; i < 3; i++) expect(p0.camera.target[i]).toBeCloseTo(cam.target[i], 9);
      }
      for (const [id, node] of Object.entries(p0.nodes)) {
        for (let i = 0; i < 3; i++) {
          expect(node.position[i], `${move.key} ${id}`).toBeCloseTo(base.scene.nodes[id].transform.position[i], 9);
          expect(node.rotation[i], `${move.key} ${id}`).toBeCloseTo(base.scene.nodes[id].transform.rotation[i], 9);
        }
      }
    });
  }

  it('ends where the move says: degrees, percent, part sizes and factors of the camera', () => {
    for (const move of CAMERA_MOVE_LIBRARY.filter((m) => m.key !== 'rack_focus' && m.key !== 'exploded_orbit')) {
      const { state, base } = withMove(move);
      const cam = activeCamera(base);
      const pose = evaluate(state, totalDuration(state) + 1);
      const sum = (kind: string): number => move.clips.filter((c) => c.target === 'CAMERA' && c.move === kind).reduce((a, c) => a + (c.degrees ?? 0), 0);
      if (pose.camera) {
        expect(pose.camera.azimuth - cam.azimuth, `${move.key} orbit`).toBeCloseTo(sum('ORBIT'), 9);
        expect(pose.camera.elevation - cam.elevation, `${move.key} rise`).toBeCloseTo(sum('RISE'), 9);
        const dolly = move.clips.filter((c) => c.move === 'DOLLY').reduce((a, c) => a * (1 - (c.percent ?? 0) / 100), 1);
        expect(pose.camera.distance / cam.distance, `${move.key} dolly`).toBeCloseTo(dolly, 9);
        const zoom = move.clips.find((c) => c.move === 'ZOOM');
        expect(pose.camera.focalMm / cam.focalMm, `${move.key} zoom`).toBeCloseTo(zoom?.focalFactor ?? 1, 9);
      }
    }
  });

  it('the turntable turns every model root once about its vertical axis, and the loop closes', () => {
    const { state, base } = withMove(cameraMove('turntable')!);
    expect(evaluate(state, 0).camera).toBeNull();
    const pose = evaluate(state, 8);
    for (const root of base.scene.roots) expect(pose.nodes[root].rotation[2] - base.scene.nodes[root].transform.rotation[2]).toBeCloseTo(360, 9);
    // Halfway through a linear turn is half a turn.
    expect(evaluate(state, 4).nodes[base.scene.roots[0]].rotation[2] - base.scene.nodes[base.scene.roots[0]].transform.rotation[2]).toBeCloseTo(180, 9);
  });

  it('the truck and the pedestal move the camera along its own axes, in part sizes, without turning it', () => {
    for (const [key, axis] of [['truck_slide', 'right'], ['pedestal', 'up']] as const) {
      const move = cameraMove(key)!;
      const { state, base } = withMove(move);
      const cam = activeCamera(base);
      const pose = evaluate(state, move.durationS);
      const basis = cameraBasis(cam.azimuth, cam.elevation)[axis];
      const v = move.clips[0].vector!;
      const k = (axis === 'right' ? v[0] : v[2]) * base.scene.partSizeMm;
      for (let i = 0; i < 3; i++) expect(pose.camera!.target[i] - cam.target[i], `${key} axis ${i}`).toBeCloseTo(basis[i] * k, 6);
      expect(pose.camera!.azimuth).toBeCloseTo(cam.azimuth, 9);
      expect(pose.camera!.elevation).toBeCloseTo(cam.elevation, 9);
      expect(pose.camera!.distance).toBeCloseTo(cam.distance, 9);
      // Half the time of an eased move is half the way.
      const half = evaluate(state, move.durationS / 2);
      for (let i = 0; i < 3; i++) expect(half.camera!.target[i] - cam.target[i], `${key} half ${i}`).toBeCloseTo((basis[i] * k) / 2, 6);
    }
  });

  it('the contra-zoom keeps the product the same size: focal length over distance does not change', () => {
    const move = cameraMove('contra_zoom')!;
    const { state, base } = withMove(move);
    const cam = activeCamera(base);
    const ratio = cam.focalMm / cam.distance;
    for (let f = 0; f <= 20; f++) {
      const pose = evaluate(state, (move.durationS * f) / 20);
      expect(pose.camera!.focalMm / pose.camera!.distance / ratio, `frame ${f}`).toBeCloseTo(1, 9);
    }
    const end = evaluate(state, move.durationS).camera!;
    expect(end.distance).toBeLessThan(cam.distance); // it did move in
    expect(end.focalMm).toBeLessThan(cam.focalMm); // and the lens did open up
  });

  it('the spirals climb and sink while they turn, and close in', () => {
    const up = withMove(cameraMove('spiral_up')!);
    const down = withMove(cameraMove('spiral_down')!);
    const camUp = activeCamera(up.base);
    const endUp = evaluate(up.state, 8).camera!;
    const endDown = evaluate(down.state, 8).camera!;
    expect(endUp.elevation).toBeGreaterThan(camUp.elevation);
    expect(endDown.elevation).toBeLessThan(camUp.elevation);
    expect(endUp.azimuth - camUp.azimuth).toBeCloseTo(270, 9);
    expect(endDown.azimuth - camUp.azimuth).toBeCloseTo(270, 9);
    expect(endUp.distance).toBeLessThan(camUp.distance);
    expect(endDown.distance).toBeLessThan(camUp.distance);
  });

  it('the rack focus holds, shifts and holds; between two picked parts it starts on the first and ends on the second', () => {
    const move = cameraMove('rack_focus')!;
    const free = withMove(move);
    const cam = activeCamera(free.base);
    const base0 = activeCamera(exampleState()).focusDistance;
    // Without parts: from 0.85 to 1.15 of the camera's focus distance.
    expect(free.expanded.setup.focusDistanceMm).toBeCloseTo(base0 * 0.85, 9);
    expect(cam.focusDistance).toBeCloseTo(base0 * 0.85, 9);
    expect(evaluate(free.state, 0).camera!.focusDistance).toBeCloseTo(base0 * 0.85, 6);
    expect(evaluate(free.state, 0.1 * move.durationS).camera!.focusDistance).toBeCloseTo(base0 * 0.85, 6); // the hold
    expect(evaluate(free.state, move.durationS).camera!.focusDistance).toBeCloseTo(base0 * 1.15, 6);
    expect(evaluate(free.state, 0.9 * move.durationS).camera!.focusDistance).toBeCloseTo(base0 * 1.15, 6); // the hold
    const mid = evaluate(free.state, 0.5 * move.durationS).camera!.focusDistance;
    expect(mid).toBeGreaterThan(base0 * 0.85);
    expect(mid).toBeLessThan(base0 * 1.15);

    const picked = withMove(move, { ...contextOf(exampleState()), partDistancesMm: [400, 900] });
    expect(picked.expanded.setup.focusDistanceMm).toBe(400);
    expect(evaluate(picked.state, 0).camera!.focusDistance).toBeCloseTo(400, 6);
    expect(evaluate(picked.state, move.durationS).camera!.focusDistance).toBeCloseTo(900, 6);
    // The focus distance moves and nothing else does.
    const pose = evaluate(picked.state, move.durationS);
    expect(pose.camera!.distance).toBeCloseTo(activeCamera(picked.base).distance, 9);
    expect(pose.camera!.azimuth).toBeCloseTo(activeCamera(picked.base).azimuth, 9);
  });

  it('the macro slide closes in and its focus follows the approach', () => {
    const move = cameraMove('macro_edge_slide')!;
    const { state, base } = withMove(move);
    const cam = activeCamera(base);
    const pose = evaluate(state, move.durationS).camera!;
    // 55 % closer, and the focus distance shrinks by the same share.
    expect(pose.distance / cam.distance).toBeCloseTo(0.45, 9);
    expect(pose.focusDistance / cam.focusDistance).toBeCloseTo(0.45, 9);
    // It slides sideways as well.
    const right = cameraBasis(cam.azimuth, cam.elevation).right;
    const shift = [0, 1, 2].map((i) => pose.target[i] - cam.target[i]);
    expect(shift[0] * right[0] + shift[1] * right[1] + shift[2] * right[2]).toBeCloseTo(0.8 * base.scene.partSizeMm, 6);
  });

  it('the exploded orbit opens the model out and goes around it', () => {
    const move = cameraMove('exploded_orbit')!;
    const { state, base } = withMove(move);
    const cam = activeCamera(base);
    const start = evaluate(state, 0);
    const end = evaluate(state, move.durationS);
    const moved = Object.entries(end.nodes).filter(([id, n]) => n.position.some((p, i) => Math.abs(p - base.scene.nodes[id].transform.position[i]) > 1e-6));
    expect(moved.length).toBeGreaterThan(1);
    expect(Object.keys(start.nodes).length).toBeGreaterThan(0);
    expect(end.camera!.azimuth - cam.azimuth).toBeCloseTo(140, 9);
    expect(end.camera!.distance / cam.distance).toBeCloseTo(1.22, 9);
  });

  it('the whip pan holds the frame, sweeps fast in the middle and holds again', () => {
    const move = cameraMove('whip_pan')!;
    const { state, base } = withMove(move);
    const cam = activeCamera(base);
    const az = (t: number): number => evaluate(state, t).camera!.azimuth - cam.azimuth;
    expect(az(0.2 * move.durationS)).toBeCloseTo(0, 9);
    expect(az(0.8 * move.durationS)).toBeCloseTo(100, 9);
    expect(az(move.durationS)).toBeCloseTo(100, 9);
    // Most of the sweep happens in a fifth of the time.
    expect(az(0.6 * move.durationS) - az(0.4 * move.durationS)).toBeGreaterThan(60);
  });

  it('scales to a chosen start and length, and stays inside them', () => {
    const move = cameraMove('arc_rise')!;
    const { state, base, expanded } = withMove(move, undefined, { start: 2, durationS: 12 });
    expect(expanded.durationS).toBe(12);
    const cam = activeCamera(base);
    for (const c of expanded.clips) {
      expect(c.start).toBeCloseTo(2, 9);
      expect(c.duration).toBeCloseTo(12, 9);
    }
    expect(evaluate(state, 2).camera!.azimuth).toBeCloseTo(cam.azimuth, 9);
    expect(evaluate(state, 8).camera!.azimuth - cam.azimuth).toBeCloseTo(30, 9); // halfway, eased: half of 60 degrees
    expect(evaluate(state, 14).camera!.azimuth - cam.azimuth).toBeCloseTo(60, 9);
    expect(totalDuration(state)).toBeCloseTo(14, 9);
  });

  it('puts the camera bars in one shot when asked, and the model bars in none', () => {
    const { expanded } = withMove(cameraMove('exploded_orbit')!, undefined, { shot: 1 });
    for (const c of expanded.clips) expect(c.shot).toBe(c.target.kind === 'CAMERA' ? 1 : null);
  });
});

describe('handheld presets', () => {
  it('has subtle, medium and strong, growing in amplitude and in speed', () => {
    expect(HANDHELD_PRESETS.map((p) => p.key)).toEqual(['subtle', 'medium', 'strong']);
    for (const p of HANDHELD_PRESETS) expect(handheldPreset(p.key)).toBe(p);
    expect(handheldPreset('nope')).toBeUndefined();
    const [a, b, c] = HANDHELD_PRESETS;
    for (const key of ['pitch', 'yaw', 'roll'] as const) {
      expect(b.rotationDeg[key]).toBeGreaterThan(a.rotationDeg[key]);
      expect(c.rotationDeg[key]).toBeGreaterThan(b.rotationDeg[key]);
    }
    expect(b.positionPartSizes).toBeGreaterThan(a.positionPartSizes);
    expect(c.positionPartSizes).toBeGreaterThan(b.positionPartSizes);
    expect(b.bandHz[1]).toBeGreaterThan(a.bandHz[1]);
    expect(c.bandHz[1]).toBeGreaterThan(b.bandHz[1]);
  });

  it('is complete, finite and in both languages, each with its own seed', () => {
    expect(new Set(HANDHELD_PRESETS.map((p) => p.seed)).size).toBe(3);
    for (const p of HANDHELD_PRESETS) {
      for (const label of [p.name, p.description]) {
        expect(label.en.trim().length, p.key).toBeGreaterThan(0);
        expect(label.es.trim().length, p.key).toBeGreaterThan(0);
      }
      expect(Number.isInteger(p.seed), p.key).toBe(true);
      expect(p.bandHz[0], p.key).toBeGreaterThan(0);
      expect(p.bandHz[1], p.key).toBeGreaterThan(p.bandHz[0]);
      expect(p.bandHz[1], p.key).toBeLessThan(30);
      expect(Number.isInteger(p.octaves) && p.octaves >= 1 && p.octaves <= 6, p.key).toBe(true);
      for (const v of [...Object.values(p.rotationDeg), p.positionPartSizes, p.referenceFocalMm]) expect(Number.isFinite(v) && v > 0, p.key).toBe(true);
      expect(p.rotationDeg.pitch, p.key).toBeLessThan(3); // degrees: a hand, not an earthquake
      expect(p.positionPartSizes, p.key).toBeLessThan(0.2);
      expect(p.scaleWithFocal && p.scaleWithDistance, p.key).toBe(true);
    }
  });
});

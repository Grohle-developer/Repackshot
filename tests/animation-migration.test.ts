// Phase N1: a project of the first interface (U1, schema 1: shots and moves in their own lists) opens in the timeline
// of N6 and N1 with nothing lost: its shots are the segments of the camera track, its moves are bars, and the pose it
// plays is the one U1 played. The poses were taken with U1's own `evaluate` (commit 67b9154) on the project of
// `project-v1.json` (tests/fixtures/README.md says how).

import { describe, expect, it } from 'vitest';
import { clipEnd, evaluate, totalDuration } from '../src/core/animation';
import { cameraSegments, timelineRows } from '../src/core/timeline';
import { migrateProject } from '../src/io/project';
import posesText from './fixtures/u1-hero-poses.json?raw';
import v1Text from './fixtures/project-v1.json?raw';

const u1 = JSON.parse(posesText) as { times: number[]; poses: { t: number; shot: number; camera: Record<string, unknown> | null; nodes: Record<string, { position: number[]; rotation: number[]; scale: number[]; visible: boolean }>; lights: Record<string, unknown>; envRotationDeg: number }[] };
const v1 = JSON.parse(v1Text) as { state: { animation: { shots: { id: string; duration: number }[]; clips: { id: string; start: number; duration: number }[] } } };

describe('a U1 project in the timeline of N1', () => {
  const state = migrateProject(JSON.parse(v1Text));

  it('keeps every shot as a segment of the camera track and every move as a bar, at the times it had', () => {
    const segs = cameraSegments(state);
    expect(segs.map((s) => [s.shot, s.start, s.end])).toEqual([
      [0, 0, 4],
      [1, 4, 7],
      [2, 7, 11],
    ]);
    expect(state.animation.shots.map((s) => s.id)).toEqual(v1.state.animation.shots.map((s) => s.id));
    // A cut at every change, as U1 had (no change of camera of N1 in an old file).
    expect(state.animation.shots.every((s) => s.transition === undefined)).toBe(true);
    const rows = timelineRows(state);
    const bars = rows.filter((r) => r.kind === 'CLIP').map((r) => (r.kind === 'CLIP' ? r.clip : ''));
    expect(bars.sort()).toEqual(v1.state.animation.clips.map((c) => c.id).sort());
    for (const c of v1.state.animation.clips) {
      const now = state.animation.clips.find((x) => x.id === c.id)!;
      expect([now.start, clipEnd(now)]).toEqual([c.start, c.start + c.duration]);
    }
    expect(totalDuration(state)).toBe(11);
  });

  it('plays the pose U1 played at 2 s (and at the other instants taken)', () => {
    expect(u1.times).toContain(2);
    u1.times.forEach((t, i) => {
      const want = u1.poses[i];
      const got = evaluate(state, t);
      expect(got.shot, `t=${t}`).toBe(want.shot);
      // A shot whose moves are over (and no camera of its own) leaves the camera alone, then as now.
      if (want.camera === null) expect(got.camera, `t=${t}`).toBeNull();
      else {
        const cam = want.camera;
        const c = got.camera!;
        expect(c.camera, `t=${t}`).toBe(cam.camera);
        for (const k of ['azimuth', 'elevation', 'distance', 'focalMm', 'focusDistance'] as const) expect(c[k], `t=${t} ${k}`).toBeCloseTo(cam[k] as number, 9);
        (cam.target as number[]).forEach((v, k) => expect(c.target[k], `t=${t} target`).toBeCloseTo(v, 9));
      }
      expect(Object.keys(got.nodes).sort()).toEqual(Object.keys(want.nodes).sort());
      for (const [id, n] of Object.entries(want.nodes)) {
        const g = got.nodes[id];
        for (const key of ['position', 'rotation', 'scale'] as const) n[key].forEach((v, k) => expect(g[key][k], `t=${t} ${id}.${key}`).toBeCloseTo(v, 9));
        expect(g.visible).toBe(n.visible);
        // Nothing of N1 shows in a U1 project: no fade, no material changed, the sky's sun where it was.
        expect(g.opacity ?? 1).toBe(1);
      }
      expect(got.envRotationDeg, `t=${t}`).toBeCloseTo(want.envRotationDeg, 9);
      expect(got.fade).toBeNull();
      expect(got.materials).toEqual({});
      expect(got.skySun).toBeNull();
    });
    // The numbers themselves at 2 s: the Hero preset's orbit and rise at half way with the smooth curve.
    expect(evaluate(state, 2).camera!.azimuth).toBeCloseTo(20 + 45, 9);
    expect(evaluate(state, 2).camera!.elevation).toBeCloseTo(10 + 9, 9);
  });
});

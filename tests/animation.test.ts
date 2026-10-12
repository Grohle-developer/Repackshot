import { describe, expect, it } from 'vitest';
import { SEQUENCE_PRESETS } from '../src/data/animation';
import { clipConflicts, evaluate, shotIndexAt, totalDuration } from '../src/core/animation';
import { activeCamera } from '../src/core/camera';
import { clipSentence } from '../src/ui/sentence';
import { apply, exampleState, keyIds } from './helpers';

describe('animation', () => {
  it('orbit 90 degrees over 4 s with EASE gives 45 degrees at 2 s', () => {
    const s = apply(exampleState(), {
      type: 'anim/addClip',
      clip: { target: { kind: 'CAMERA' }, move: 'ORBIT', shot: null, start: 0, duration: 4, amount: 90, easing: 'EASE' },
    });
    const base = activeCamera(s).azimuth;
    expect(evaluate(s, 2).camera!.azimuth - base).toBeCloseTo(45, 9);
    expect(evaluate(s, 0).camera!.azimuth - base).toBeCloseTo(0, 9);
    expect(evaluate(s, 9).camera!.azimuth - base).toBeCloseTo(90, 9);
  });

  it('spin, dolly, zoom, environment and light moves', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const s = apply(
      s0,
      { type: 'anim/addClip', clip: { target: { kind: 'SUBJECT' }, move: 'SPIN', shot: null, start: 0, duration: 2, amount: 360, easing: 'LINEAR' } },
      { type: 'anim/addClip', clip: { target: { kind: 'CAMERA' }, move: 'DOLLY', shot: null, start: 0, duration: 2, amount: 50, easing: 'LINEAR' } },
      { type: 'anim/addClip', clip: { target: { kind: 'CAMERA' }, move: 'ZOOM', shot: null, start: 0, duration: 2, amount: 185, easing: 'LINEAR' } },
      { type: 'anim/addClip', clip: { target: { kind: 'SCENE' }, move: 'HDRI', shot: null, start: 0, duration: 2, amount: 100, easing: 'LINEAR' } },
      { type: 'anim/addClip', clip: { target: { kind: 'LIGHT', id: s0.studio.lights[0].id }, move: 'INTENSITY', shot: null, start: 0, duration: 2, amount: 0, easing: 'LINEAR' } },
      { type: 'anim/addClip', clip: { target: { kind: 'NODE', id: ids.cap }, move: 'VISIBILITY', shot: null, start: 1, duration: 1, amount: 0, easing: 'LINEAR' } },
    );
    const p = evaluate(s, 1);
    expect(p.nodes[ids.model].rotation[2]).toBeCloseTo(180, 9);
    expect(p.camera!.distance).toBeCloseTo(activeCamera(s).distance * 0.75, 9);
    expect(p.camera!.focalMm).toBeCloseTo((activeCamera(s).focalMm + 185) / 2, 9);
    expect(p.envRotationDeg).toBeCloseTo(50, 9);
    expect(p.lights[s.studio.lights[0].id].power).toBeCloseTo(s.studio.lights[0].power / 2, 9);
    expect(p.nodes[ids.cap].visible).toBe(true);
    expect(evaluate(s, 1.6).nodes[ids.cap].visible).toBe(false);
  });

  it('every sequence preset yields a valid pose on every frame', () => {
    for (const preset of SEQUENCE_PRESETS) {
      const s = apply(exampleState(), { type: 'anim/preset', key: preset.key });
      expect(s.animation.shots).toHaveLength(preset.shots.length);
      expect(s.animation.clips).toHaveLength(preset.clips.length);
      const total = totalDuration(s);
      for (let f = 0; f <= Math.ceil(total * 12); f++) {
        const p = evaluate(s, f / 12);
        const numbers = [
          p.envRotationDeg,
          ...(p.camera ? [p.camera.azimuth, p.camera.elevation, p.camera.distance, p.camera.focalMm, ...p.camera.target] : []),
          ...Object.values(p.nodes).flatMap((n) => [...n.position, ...n.rotation, ...n.scale]),
        ];
        for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
        if (p.camera) expect(p.camera.distance).toBeGreaterThan(0);
      }
    }
  });

  it('camera clips of a shot only act during that shot (cuts)', () => {
    const s = apply(exampleState(), { type: 'anim/preset', key: 'HERO' });
    expect(shotIndexAt(s, 3.9)).toBe(0);
    expect(shotIndexAt(s, 4.1)).toBe(1);
    const base = activeCamera(s);
    // In shot 1 the orbit of shot 0 no longer applies: the camera cut back.
    expect(evaluate(s, 3.99).camera!.azimuth).not.toBeCloseTo(base.azimuth, 1);
    expect(evaluate(s, 4.5).camera!.azimuth).toBeCloseTo(base.azimuth, 9);
    expect(evaluate(s, 4.5).camera!.distance).toBeLessThan(base.distance);
  });

  it('flags two clips of the same kind on the same target overlapping in time', () => {
    const clip = { target: { kind: 'SUBJECT' as const }, move: 'SPIN' as const, shot: null, start: 0, duration: 2, amount: 90, easing: 'LINEAR' as const };
    const s = apply(exampleState(), { type: 'anim/addClip', clip }, { type: 'anim/addClip', clip: { ...clip, start: 1 } }, { type: 'anim/addClip', clip: { ...clip, start: 5 } });
    expect([...clipConflicts(s)].sort()).toEqual(['c1', 'c2']);
  });

  it('describes a clip in plain language, in both languages', () => {
    const clip = { id: 'c1', target: { kind: 'CAMERA' as const }, move: 'ORBIT' as const, shot: null, start: 0, duration: 4, amount: 90, easing: 'EASE' as const };
    const s = exampleState();
    expect(clipSentence(s, clip, 'en')).toBe('The camera orbits 90° over 4 s, smooth');
    expect(clipSentence(s, clip, 'es')).toBe('La cámara orbita 90° durante 4 s, suave');
  });

  it('shots can be removed and reordered with their clips', () => {
    let s = apply(exampleState(), { type: 'anim/preset', key: 'HERO' });
    const [a, b] = s.animation.shots;
    s = apply(s, { type: 'anim/moveShot', id: a.id, delta: 1 });
    expect(s.animation.shots.map((x) => x.id)).toEqual([b.id, a.id, s.animation.shots[2].id]);
    expect(s.animation.clips.filter((c) => c.shot === 1)).toHaveLength(2);
    s = apply(s, { type: 'anim/removeShot', id: b.id });
    expect(s.animation.shots).toHaveLength(2);
    expect(s.animation.clips.filter((c) => c.target.kind === 'CAMERA').every((c) => c.shot === null || c.shot < 2)).toBe(true);
  });
});

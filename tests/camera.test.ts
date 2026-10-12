import { describe, expect, it } from 'vitest';
import { activeCamera, cameraBasis, cameraPosition, fieldOfView, frameBox, orbitFromPosition, outputFrameRect, FRAME_MARGIN } from '../src/core/camera';
import { boxCenter, dot, sub } from '../src/core/math';
import { sceneBounds } from '../src/core/scene';
import { apply, exampleState } from './helpers';

describe('camera', () => {
  it('field of view on a 36 mm sensor fits the longer side', () => {
    const f = fieldOfView(50, 16 / 9);
    expect(f.h).toBeCloseTo(2 * Math.atan(18 / 50), 12);
    expect(f.v).toBeCloseTo(2 * Math.atan(18 / (16 / 9) / 50), 12);
    expect(fieldOfView(50, 0.8).v).toBeCloseTo(2 * Math.atan(18 / 50), 12);
  });

  it('framing keeps every corner inside the frame and one on its edge', () => {
    const s = exampleState();
    const box = sceneBounds(s);
    const cam = frameBox(activeCamera(s), box, 16 / 9);
    const fov = fieldOfView(cam.focalMm, 16 / 9);
    const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
    const eye = cameraPosition(cam);
    let tightest = 0;
    for (let i = 0; i < 8; i++) {
      const c = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
      const v = sub(c, eye);
      const depth = dot(v, forward);
      const x = Math.abs(dot(v, right)) / depth / Math.tan(fov.h / 2);
      const y = Math.abs(dot(v, up)) / depth / Math.tan(fov.v / 2);
      expect(x).toBeLessThanOrEqual(1 / FRAME_MARGIN + 1e-9);
      expect(y).toBeLessThanOrEqual(1 / FRAME_MARGIN + 1e-9);
      tightest = Math.max(tightest, x, y);
    }
    expect(tightest).toBeCloseTo(1 / FRAME_MARGIN, 6);
    boxCenter(box).forEach((v, i) => expect(cam.target[i]).toBeCloseTo(v, 9));
  });

  it('orbit parameters round-trip through the position', () => {
    const cam = { azimuth: -35, elevation: 22, distance: 500, target: [10, 20, 30] as [number, number, number] };
    const o = orbitFromPosition(cameraPosition(cam), cam.target);
    expect(o.azimuth).toBeCloseTo(-35, 9);
    expect(o.elevation).toBeCloseTo(22, 9);
    expect(o.distance).toBeCloseTo(500, 9);
  });

  it('the output frame is centred with the output aspect', () => {
    const r = outputFrameRect(1000, 700, 1920, 1080, 20);
    expect(r.width / r.height).toBeCloseTo(16 / 9, 9);
    expect(r.x).toBeCloseTo(20, 9);
    expect(r.y * 2 + r.height).toBeCloseTo(700, 9);
  });

  it('lens presets set focal and aperture and reframe; views keep the frame', () => {
    let s = apply(exampleState(), { type: 'camera/lens', key: 'WIDE' });
    expect([activeCamera(s).focalMm, activeCamera(s).fstop, activeCamera(s).lens]).toEqual([24, 5.6, 'WIDE']);
    const d24 = activeCamera(s).distance;
    s = apply(s, { type: 'camera/lens', key: 'TELE' });
    expect(activeCamera(s).distance).toBeGreaterThan(d24 * 4);
    s = apply(s, { type: 'camera/set', id: s.camera.active, patch: { focalMm: 60 } });
    expect(activeCamera(s).lens).toBeNull();
    s = apply(s, { type: 'camera/view', view: 'FRONT' });
    expect([activeCamera(s).azimuth, activeCamera(s).elevation]).toEqual([0, 4]);
  });

  it('cameras are added, activated and deleted, never the last one', () => {
    let s = exampleState();
    s = apply(s, { type: 'camera/add', name: 'Detail' });
    expect(Object.keys(s.camera.cameras)).toHaveLength(2);
    expect(activeCamera(s).name).toBe('Detail');
    s = apply(s, { type: 'camera/delete', id: s.camera.active });
    expect(Object.keys(s.camera.cameras)).toHaveLength(1);
    const t = apply(s, { type: 'camera/delete', id: s.camera.active });
    expect(t).toBe(s);
  });
});

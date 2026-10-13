import { describe, expect, it } from 'vitest';
import { cameraBasis, cameraPosition, focusDistanceTo } from '../src/core/camera';
import { add, dot, length, normalize, scale, sub, type Vec3 } from '../src/core/math';

// The engine focuses a plane at right angles to the view axis (rt-core `Camera::generate_ray`):
// a ray through the lens centre in direction `dir` is in focus at `position + dir * (focus / dir·forward)`.
function engineFocusPoint(position: Vec3, forward: Vec3, through: Vec3, focus: number): Vec3 {
  const dir = normalize(sub(through, position));
  return add(position, scale(dir, focus / dot(dir, forward)));
}

const cam = { azimuth: -35, elevation: 18, distance: 900, target: [0, 0, 60] as Vec3 };

describe('focus with a click (user report: the click did not focus exactly on the clicked point)', () => {
  const pos = cameraPosition(cam);
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);

  it('puts a point off the centre of the frame exactly on the focus plane', () => {
    const point = add(pos, add(scale(forward, 500), add(scale(right, 220), scale(up, -140))));
    const focus = focusDistanceTo(cam, point);
    expect(focus).toBeCloseTo(500, 6);
    const p = engineFocusPoint(pos, forward, point, focus);
    expect(length(sub(p, point))).toBeLessThan(1e-6);
    // The straight-line distance (what the click used before) focuses about 66 mm behind the point.
    const straight = length(sub(point, pos));
    expect(length(sub(engineFocusPoint(pos, forward, point, straight), point))).toBeGreaterThan(50);
  });

  it('is the straight-line distance for a point on the view axis', () => {
    const point = add(pos, scale(forward, 750));
    expect(focusDistanceTo(cam, point)).toBeCloseTo(length(sub(point, pos)), 6);
  });

  it('never goes below 1 mm, even for a point beside or behind the lens', () => {
    expect(focusDistanceTo(cam, add(pos, scale(right, 100)))).toBe(1);
    expect(focusDistanceTo(cam, add(pos, scale(forward, -100)))).toBe(1);
  });
});

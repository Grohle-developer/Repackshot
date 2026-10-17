// A lens-information port that is not the engine, for the tests of the window of a lens's elements (phase O2b): the
// numbers say which lens they are for (so a window that shows another lens's data is caught), the questions are
// counted, and the answer can be held back, refused or missing. Shared by tests/lens-peek.test.ts (Node) and the page of
// tests/lens-peek-browser.test.ts.

import type { CameraState } from '../../src/core/camera';
import type { EngineLensInfo } from '../../src/core/traced-lens';
import { LENS_PRESCRIPTIONS } from '../../src/data/lenses';
import type { LensPort } from '../../src/ui/ports';

/** A lens information whose numbers say which lens it is for (the catalogue's order), and a section that can be drawn. */
export function fakeInfo(cam: CameraState): EngineLensInfo {
  const key = cam.optics!.traced!.key;
  const i = LENS_PRESCRIPTIONS.findIndex((p) => p.key === key);
  const s = (z: number, kind: number, curvature: number, index: number, semiAperture = 10) => ({ z, kind, curvature, semiAperture, index, conic: 0, aspheric: [0, 0, 0, 0] as [number, number, number, number] });
  return {
    eflMm: cam.focalMm,
    designEflMm: 100,
    bflMm: 30 + i,
    eflFocusedMm: cam.focalMm,
    imageScaleMm: cam.focalMm,
    fNumber: Math.max(cam.fstop, 1.4),
    fNumberMin: 1.4,
    tiltDeg: 0,
    tStop: Math.max(cam.fstop, 1.4) * 1.1,
    transmittance: [0.9, 0.9, 0.9],
    lengthMm: 40 + i,
    entrancePupilMm: [5, 10],
    elements: 3 + i,
    groups: 2 + i,
    sensorMm: 43.3,
    squeeze: key === 'anamorphic_adapter_2x' ? 1.96 : 1,
    distortion: [[10, -1]],
    relativeIllumination: [[0, 1]],
    section: { surfaces: [s(0, 0, 1 / 50, 1.5), s(5, 0, -1 / 50, 1), s(8, 1, 0, 1, 6)], stop: 2, stopRadiusMm: 4, sensorZMm: 60 },
  };
}

export type FakeMode = 'ok' | 'hold' | 'none' | 'refuse';

export interface FakePort {
  port: LensPort;
  /** The cameras the engine was asked about, in order. */
  asked: CameraState[];
  mode: FakeMode;
  /** Answers the questions held back (mode 'hold'). */
  release(): void;
}

/** A port that counts its questions and answers as `mode` says. */
export function fakePort(mode: FakeMode = 'ok'): FakePort {
  const held: (() => void)[] = [];
  const fake: FakePort = {
    asked: [],
    mode,
    release: () => held.splice(0).forEach((g) => g()),
    port: {
      info(cam) {
        fake.asked.push(cam);
        if (fake.mode === 'none') return Promise.resolve(null);
        if (fake.mode === 'refuse') return Promise.resolve(undefined);
        if (fake.mode === 'hold') return new Promise((resolve) => held.push(() => resolve(fakeInfo(cam))));
        return Promise.resolve(fakeInfo(cam));
      },
    },
  };
  return fake;
}

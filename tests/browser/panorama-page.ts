// The page of the browser test of the preview's panoramas (phase K3, tests/panorama-browser.test.ts): the preview engine
// draws the room of six glowing walls (tests/browser/panorama-scene.ts) through an equirectangular panorama and a
// fisheye from six cube faces, the canvas is read back, and the colour class at the pixel where the page's map
// (core/panorama.ts `panoramaPoint`) puts each world axis is returned, with the pick through that pixel.

import { activeCamera, type CameraState } from '../../src/core/camera';
import { panoramaFov, panoramaPoint } from '../../src/core/panorama';
import { outputFrameRect } from '../../src/core/camera';
import { PreviewEngine } from '../../src/render/preview';
import { cameraFrame, colourClass, panoramaRoom, ROOM_WALLS } from './panorama-scene';

export interface PanoramaResult {
  /** Per projection, per wall: the class at the mapped pixel, the pixel, and the wall the pick through it finds. */
  runs: Record<string, { key: string; want: string; got: string; x: number; y: number; picked: string | null }[]>;
}

declare global {
  interface Window {
    runPanorama?: (width: number, height: number) => PanoramaResult;
    panoramaReady?: boolean;
  }
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new PreviewEngine();
engine.mount(canvas);
const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;

function run(width: number, height: number, patch: Partial<CameraState>, keys: readonly string[]): PanoramaResult['runs'][string] {
  const s0 = panoramaRoom(patch);
  const state = { ...s0, image: { ...s0.image, viewTransform: 'STANDARD' as const } };
  engine.sync(state, null);
  engine.resize(width, height, 1);
  engine.invalidate();
  engine.frame();
  const buf = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const cam = activeCamera(state);
  // The panorama covers the whole canvas, the output frame inset in it (as the engine's viewport image does).
  const frame = outputFrameRect(width, height, cam.aspect.w, cam.aspect.h);
  const fov = panoramaFov(cam, frame.width, frame.height, width, height);
  const out: PanoramaResult['runs'][string] = [];
  for (const key of keys) {
    const wall = ROOM_WALLS.find((w) => w.key === key)!;
    const at = panoramaPoint(cam.projection as 'EQUIRECTANGULAR' | 'FISHEYE', fov.x, fov.y, width / height, cameraFrame(cam, wall.dir));
    if (!at) {
      out.push({ key, want: wall.cls, got: 'none', x: -1, y: -1, picked: null });
      continue;
    }
    const x = Math.min(width - 1, Math.floor(at[0] * width));
    const y = Math.min(height - 1, Math.floor(at[1] * height));
    const i = 4 * ((height - 1 - y) * width + x);
    const hit = engine.pick(x + 0.5, y + 0.5);
    out.push({ key, want: wall.cls, got: colourClass(buf[i], buf[i + 1], buf[i + 2]), x, y, picked: hit ? (state.scene.nodes[hit.node]?.name ?? null) : null });
  }
  return out;
}

window.runPanorama = (width, height) => ({
  runs: {
    equirectangular: run(width, height, { projection: 'EQUIRECTANGULAR', azimuth: 30, aspect: { preset: '2:1', w: 2, h: 1 } }, ROOM_WALLS.map((w) => w.key)),
    fisheye: run(width, height, { projection: 'FISHEYE', azimuth: 30, aspect: { preset: '3:2', w: 3, h: 2 }, fisheyeFovDeg: 360 }, ['+X', '-X', '+Y', '+Z', '-Z']),
  },
});
window.panoramaReady = true;

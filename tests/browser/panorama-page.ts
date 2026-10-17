// The page of the browser test of the preview's panoramas (phase K3, tests/panorama-browser.test.ts): the preview engine
// draws the room of six glowing walls (tests/browser/panorama-scene.ts) through an equirectangular panorama and a
// fisheye from six cube faces, the canvas is read back, and the colour class at the pixel where the page's map
// (core/panorama.ts `panoramaPoint`) puts each world axis is returned, with the pick through that pixel.

import { activeCamera, type CameraState } from '../../src/core/camera';
import { panoramaDirection, panoramaFov, panoramaPoint } from '../../src/core/panorama';
import { outputFrameRect } from '../../src/core/camera';
import { reduce } from '../../src/core/store';
import { PreviewEngine } from '../../src/render/preview';
import { cameraFrame, colourClass, panoramaRoom, ROOM_WALLS } from './panorama-scene';

export interface PanoramaResult {
  /** Per projection, per wall: the class at the mapped pixel, the pixel, and the wall the pick through it finds. */
  runs: Record<string, { key: string; want: string; got: string; x: number; y: number; picked: string | null }[]>;
  /** The fisheye's canvas corner, beyond half a turn from its axis: its class and the pick through it. */
  fisheyeCorner: { got: string; picked: string | null; inside: boolean };
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

function run(width: number, height: number, patch: Partial<CameraState>, keys: readonly string[], hide?: string): PanoramaResult['runs'][string] {
  const room = panoramaRoom(patch);
  // A wall hidden to the camera (K3, Visible to camera off): drawn neither in colour nor in depth, nor picked.
  const hidden = hide ? Object.values(room.scene.nodes).find((n) => n.name === hide)?.id : undefined;
  const s0 = hidden ? reduce(room, { type: 'scene/setCameraHidden', ids: [hidden], hidden: true }) : room;
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

/** The pixel (1, 1) of the last run: beyond the image circle of a fisheye of 360° over the frame, which the canvas is wider than. */
function corner(width: number, height: number, patch: Partial<CameraState>): PanoramaResult['fisheyeCorner'] {
  const buf = new Uint8Array(4);
  gl.readPixels(1, height - 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const hit = engine.pick(1.5, 1.5);
  const cam = activeCamera(panoramaRoom(patch));
  const frame = outputFrameRect(width, height, cam.aspect.w, cam.aspect.h);
  const fov = panoramaFov(cam, frame.width, frame.height, width, height);
  // Its direction by the page's map: none (beyond half a turn) is what the canvas must show, black and nothing picked.
  const inside = panoramaDirection('FISHEYE', fov.x, fov.y, width / height, 1.5 / width, 1.5 / height) !== null;
  return { got: colourClass(buf[0], buf[1], buf[2]), picked: hit ? hit.node : null, inside };
}

window.runPanorama = (width, height) => {
  const equirectangular = run(width, height, { projection: 'EQUIRECTANGULAR', azimuth: 30, aspect: { preset: '2:1', w: 2, h: 1 } }, ROOM_WALLS.map((w) => w.key));
  const eye: Partial<CameraState> = { projection: 'FISHEYE', azimuth: 30, aspect: { preset: '3:2', w: 3, h: 2 }, fisheyeFovDeg: 360 };
  const fisheye = run(width, height, eye, ['+X', '-X', '+Y', '+Z', '-Z']);
  const fisheyeCorner = corner(width, height, eye);
  const hidden = run(width, height, { projection: 'EQUIRECTANGULAR', azimuth: 30, aspect: { preset: '2:1', w: 2, h: 1 } }, ['+X', '-X'], 'w+X');
  return { runs: { equirectangular, fisheye, hidden }, fisheyeCorner };
};
window.panoramaReady = true;

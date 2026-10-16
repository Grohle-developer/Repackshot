// The page of the M2b region comparison (tests/textures-full-browser.test.ts): the Fast preview draws the scenes of
// textures-scene.ts with their images (PNG bytes handed in by the test, decoded by the browser as in the app) and
// gives back its colour pixels.

import { registerTextureImage } from '../../src/core/texture-images';
import { projectScene } from '../../src/io/rsb';
import { PreviewEngine } from '../../src/render/preview';
import { checkerScene, labelScene } from './textures-scene';

declare global {
  interface Window {
    runTextures?: (scene: 'checker' | 'label', png: number[], width: number, height: number) => Promise<{ rgba: number[]; tries: number }>;
    texturesReady?: boolean;
  }
}

const engine = new PreviewEngine();
engine.mount(document.getElementById('c') as HTMLCanvasElement);

window.runTextures = async (scene, png, width, height) => {
  const image = registerTextureImage(`${scene}.png`, new Uint8Array(png));
  const state = scene === 'checker' ? checkerScene(image, width, height) : labelScene(image, width, height);
  engine.sync(state, null);
  engine.resize(width, height, 1);
  const ids = projectScene(state, { width, height, maxSamples: 1, maxSeconds: 0 }).ids;
  // The preview decodes the image asynchronously and draws again when it is there: frames until two in a row
  // agree and some pixel is saturated (the texture is on), or a few seconds.
  let last: Uint8Array | null = null;
  for (let tries = 1; tries <= 60; tries++) {
    const frame = engine.aiFrame({ width, height, ids, colour: true });
    const rgba = frame.rgba!;
    let saturated = 0;
    for (let i = 0; i < rgba.length; i += 4) if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) - Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) > 80) saturated++;
    if (last && saturated > 50 && last.every((v, i) => v === rgba[i])) return { rgba: Array.from(rgba), tries };
    last = Uint8Array.from(rgba);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { rgba: Array.from(last ?? []), tries: -1 };
};
window.texturesReady = true;

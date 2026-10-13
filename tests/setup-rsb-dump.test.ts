// Writes the RSB files that tools/setup-contrast.mjs renders with the native `rt` (the image check
// of the light-power fix). Skipped unless REPACKSHOT_SETUP_RSB_DIR is set, so `npm run qa` writes
// nothing; the tool sets the variable itself.
//
//   REPACKSHOT_SETUP_RSB_DIR=out/setup-contrast npx vitest run tests/setup-rsb-dump.test.ts
//
// Optional: REPACKSHOT_SETUP_PRESET (default JEWELLERY), REPACKSHOT_SETUP_KEYS (comma list, default
// REMBRANDT,NEON_NOIR,KEY_ONLY), REPACKSHOT_SETUP_SIZE (WxH, default 480x270) and
// REPACKSHOT_SETUP_SPP (default 64) and REPACKSHOT_SETUP_DOME_SCALE (default 1: multiplies the dome's
// strength, to see how much of the picture is the dome; a diagnostic, not a setting of the product).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectScene, writeRsb } from '../src/io/rsb';
import { apply, exampleState } from './helpers';

const dir = process.env.REPACKSHOT_SETUP_RSB_DIR;
const preset = process.env.REPACKSHOT_SETUP_PRESET ?? 'JEWELLERY';
const keys = (process.env.REPACKSHOT_SETUP_KEYS ?? 'REMBRANDT,NEON_NOIR,KEY_ONLY').split(',').map((k: string) => k.trim()).filter(Boolean);
const [width, height] = (process.env.REPACKSHOT_SETUP_SIZE ?? '480x270').split('x').map(Number);
const spp = Number(process.env.REPACKSHOT_SETUP_SPP ?? 64);
const domeScale = Number(process.env.REPACKSHOT_SETUP_DOME_SCALE ?? 1);

describe.skipIf(!dir)('setup contrast: RSB dump', () => {
  it(`writes ${preset} x ${keys.join(', ')} at ${width}x${height}, ${spp} spp`, () => {
    mkdirSync(dir!, { recursive: true });
    for (const key of keys) {
      const s = apply(exampleState(), { type: 'studio/setPreset', key: preset }, { type: 'studio/build' }, { type: 'studio/setSetup', key });
      expect(s.studio.lightSetup).toBe(key);
      const { scene } = projectScene(s, { width, height, maxSamples: spp, maxSeconds: 0, seed: 0 });
      scene.environment.strength *= domeScale;
      writeFileSync(join(dir!, `${preset}-${key}.rsb`), writeRsb(scene));
    }
  });
});

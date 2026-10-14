// Writes the RSB files that tools/setup-thumbs.mjs renders with the native `rt` (the light-setup thumbnails, L6) and
// that tools/sets-sheet.mjs renders for the contact sheet. Skipped unless REPACKSHOT_THUMBS_DIR is set, so `npm run
// qa` writes nothing; the tools set the variables themselves.
//
//   REPACKSHOT_THUMBS_DIR=out/thumbs npx vitest run tests/setup-thumbs-dump.test.ts
//
// REPACKSHOT_THUMBS_MODE: THUMBS (default: every setup on its hero, 256 x 256, 96 spp), SHEET (the 16 sets on
// BOTTLE, BOX and CHROME, and every product type's own rig before and after L6 on BOTTLE, 512 x 512, 256 spp).
// REPACKSHOT_THUMBS_SIZE (WxH), REPACKSHOT_THUMBS_SPP and REPACKSHOT_THUMBS_KEYS (a comma list) override them.
// Each RSB has a line in <dir>/scenes.json: its file, setup, hero, product type and the sha-256 of the RSB.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { sha256Hex } from '../src/core/sha256';
import { projectScene, writeRsb } from '../src/io/rsb';
import { LIGHT_SETUPS } from '../src/data/light-setups';
import { PRESET_SETS, STUDIO_PRESETS, studioPreset } from '../src/data/studios';
import type { LightSpec, SetHero } from '../src/data/types';
import type { ProjectState } from '../src/core/store';
import { heroOf, setupScene, THUMB, thumbRsb, thumbView } from './set-heroes';

const dir = process.env.REPACKSHOT_THUMBS_DIR;
const mode = process.env.REPACKSHOT_THUMBS_MODE ?? 'THUMBS';
const sheet = mode === 'SHEET';
const [width, height] = (process.env.REPACKSHOT_THUMBS_SIZE ?? (sheet ? '512x512' : `${THUMB.width}x${THUMB.height}`)).split('x').map(Number);
const spp = Number(process.env.REPACKSHOT_THUMBS_SPP ?? (sheet ? 256 : THUMB.spp));
const keys = process.env.REPACKSHOT_THUMBS_KEYS?.split(',').map((k) => k.trim()).filter(Boolean);

interface Entry {
  file: string;
  setup: string;
  hero: SetHero;
  preset: string;
  variant?: string;
  sha256: string;
}

function write(entries: Entry[], s: ProjectState, file: string, meta: Omit<Entry, 'file' | 'sha256'>, caustics: boolean): void {
  const bytes = writeRsb(projectScene(s, thumbView({ caustics }, width, height, spp)).scene);
  writeFileSync(join(dir!, file), bytes);
  entries.push({ file, ...meta, sha256: sha256Hex(bytes) });
}

describe.skipIf(!dir)('setup thumbnails: RSB dump', () => {
  it(`writes the ${mode} scenes at ${width}x${height}, ${spp} spp`, () => {
    mkdirSync(dir!, { recursive: true });
    const entries: Entry[] = [];
    if (!sheet) {
      for (const setup of LIGHT_SETUPS) {
        if (keys && !keys.includes(setup.key)) continue;
        const bytes = thumbRsb(setup.key, width, height, spp);
        writeFileSync(join(dir!, `${setup.key.toLowerCase()}.rsb`), bytes);
        entries.push({ file: `${setup.key.toLowerCase()}.rsb`, setup: setup.key, hero: heroOf(setup), preset: 'GENERIC', sha256: sha256Hex(bytes) });
      }
    } else {
      for (const setup of LIGHT_SETUPS.filter((x) => x.style === 'SETS')) {
        if (keys && !keys.includes(setup.key)) continue;
        for (const hero of ['BOTTLE', 'BOX', 'CHROME'] as const) {
          const s = setupScene(setup.key, { width, height, hero });
          write(entries, s, `${setup.key.toLowerCase()}-${hero.toLowerCase()}.rsb`, { setup: setup.key, hero, preset: 'GENERIC' }, setup.caustics === true);
        }
      }
      // Every product type's own rig before L6 (the fixture) and after, on the bottle, with its own camera and look.
      const before = JSON.parse(readFileSync('tests/fixtures/studio-rigs-before-l6.json', 'utf8')) as { lights: Record<string, LightSpec[]>; exposure: Record<string, number> };
      for (const p of STUDIO_PRESETS) {
        if (keys && !keys.includes(p.key)) continue;
        const now = setupScene('PRESET', { width, height, hero: 'BOTTLE', preset: p.key });
        write(entries, now, `preset-${p.key.toLowerCase()}-after.rsb`, { setup: 'PRESET', hero: 'BOTTLE', preset: p.key, variant: 'after' }, p.caustics);
        const old = { ...studioPreset(p.key)!, key: `LIB:before-${p.key}`, set: undefined, exposure: before.exposure[p.key], lights: before.lights[p.key] };
        const then = setupScene('PRESET', { width, height, hero: 'BOTTLE', preset: p.key, custom: { type: 'studio/setPreset', key: old.key, custom: old } });
        write(entries, then, `preset-${p.key.toLowerCase()}-before.rsb`, { setup: 'PRESET', hero: 'BOTTLE', preset: p.key, variant: 'before' }, p.caustics);
      }
    }
    // What the contact sheet prints next to the pictures.
    const meta = {
      sets: Object.fromEntries(LIGHT_SETUPS.filter((x) => x.style === 'SETS').map((x) => [x.key, { en: x.label.en, es: x.label.es, why: x.why?.en ?? '', hero: x.hero }])),
      presets: { ...PRESET_SETS },
    };
    writeFileSync(join(dir!, 'scenes.json'), JSON.stringify({ mode, width, height, spp, seed: THUMB.seed, scenes: entries, ...(sheet ? { meta } : {}) }, null, 1) + '\n');
  });
});

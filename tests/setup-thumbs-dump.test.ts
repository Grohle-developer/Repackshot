// Writes the RSB files that tools/setup-thumbs.mjs renders with the native `rt` (the light-setup thumbnails, L6) and
// that tools/sets-sheet.mjs renders for the contact sheet. Skipped unless REPACKSHOT_THUMBS_DIR is set, so `npm run
// qa` writes nothing; the tools set the variables themselves.
//
//   REPACKSHOT_THUMBS_DIR=out/thumbs npx vitest run tests/setup-thumbs-dump.test.ts
//
// REPACKSHOT_THUMBS_MODE: THUMBS (default: every setup on its hero, 256 x 256, 96 spp), SHEET (the 16 sets on
// BOTTLE, BOX and CHROME, and the product types' own rigs before and after L6, 512 x 512, 96 spp).
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
const spp = Number(process.env.REPACKSHOT_THUMBS_SPP ?? (sheet ? 96 : THUMB.spp));
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
      // The product types that are a set: their own rig before L6 (the fixture) and after, on the bottle, with their own
      // camera and look; Standard and Electronics on the box too (packaging's first look).
      const before = JSON.parse(readFileSync('tests/fixtures/studio-rigs-before-l6.json', 'utf8')) as { lights: Record<string, LightSpec[]>; exposure: Record<string, number> };
      const pairs: [string, SetHero][] = [...STUDIO_PRESETS.filter((p) => p.set).map((p) => [p.key, 'BOTTLE'] as [string, SetHero]), ['GENERIC', 'BOX'], ['ELECTRONICS', 'BOX']];
      for (const [key, hero] of pairs) {
        if (keys && !keys.includes(key)) continue;
        const p = studioPreset(key)!;
        const tag = `preset-${key.toLowerCase()}-${hero.toLowerCase()}`;
        const now = setupScene('PRESET', { width, height, hero, preset: key });
        write(entries, now, `${tag}-after.rsb`, { setup: 'PRESET', hero, preset: key, variant: 'after' }, p.caustics);
        const old = { ...p, key: `LIB:before-${key}`, set: undefined, exposure: before.exposure[key], lights: before.lights[key] };
        const then = setupScene('PRESET', { width, height, hero, preset: key, custom: { type: 'studio/setPreset', key: old.key, custom: old } });
        write(entries, then, `${tag}-before.rsb`, { setup: 'PRESET', hero, preset: key, variant: 'before' }, p.caustics);
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

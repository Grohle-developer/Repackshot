// Rewrites the lights and the exposure of the product types that are a set (L6, `StudioPreset.set`) from that set:
// its lights at the level the type had before L6 (tests/fixtures/old-setup-rigs.json), each energy to 13 significant
// digits, and the type's exposure before L6 plus the set's offset. Run it after tuning a set; tests/sets.test.ts checks
// that the two agree. Skipped unless REPACKSHOT_SYNC_PRESETS is set, so `npm run qa` writes nothing.
//
//   REPACKSHOT_SYNC_PRESETS=1 npx vitest run tests/preset-rigs-sync.test.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { specIrradiance } from '../src/core/light-math';
import { lightSetup } from '../src/data/light-setups';
import { STUDIO_PRESETS } from '../src/data/studios';

describe.skipIf(!process.env.REPACKSHOT_SYNC_PRESETS)('product types from their sets', () => {
  it('rewrites src/data/studios.ts', () => {
    const levels = (JSON.parse(readFileSync('tests/fixtures/old-setup-rigs.json', 'utf8')) as { levels: Record<string, number> }).levels;
    const exposures = (JSON.parse(readFileSync('tests/fixtures/studio-rigs-before-l6.json', 'utf8')) as { exposure: Record<string, number> }).exposure;
    let src = readFileSync('src/data/studios.ts', 'utf8');
    for (const p of STUDIO_PRESETS) {
      if (!p.set) continue;
      const set = lightSetup(p.set)!;
      const k = levels[p.key] / set.lights!.reduce((a, l) => a + specIrradiance(l), 0);
      const at = src.indexOf(`    key: '${p.key}',`);
      const lights = src.indexOf('    lights: [\n', at);
      const end = src.indexOf('    ],\n', lights);
      const lines = set.lights!.map((l) => {
        const o: Record<string, unknown> = { role: l.role };
        for (const f of ['type', 'shape', 'size', 'sizeY', 'az', 'el', 'dist'] as const) if (l[f] !== undefined) o[f] = l[f];
        o.energy = Number((k * (l.share ?? 0)).toPrecision(13));
        for (const f of ['kelvin', 'color', 'spread', 'blend', 'glossy', 'camera'] as const) if (l[f] !== undefined) o[f] = l[f];
        const text = Object.entries(o).map(([a, b]) => `${a}: ${typeof b === 'string' ? `'${b}'` : JSON.stringify(b).replace(/,/g, ', ')}`).join(', ');
        return `      { ${text} },`;
      });
      src = src.slice(0, lights) + '    lights: [\n' + lines.join('\n') + '\n' + src.slice(end);
      // The exposure: the type's before L6 plus the set's offset.
      const exp = Math.round((exposures[p.key] + (set.exposureEv ?? 0)) * 1e4) / 1e4;
      const e = src.indexOf('exposure: ', at);
      const comma = src.indexOf(',', e);
      src = src.slice(0, e) + `exposure: ${exp}` + src.slice(comma);
    }
    writeFileSync('src/data/studios.ts', src);
  });
});

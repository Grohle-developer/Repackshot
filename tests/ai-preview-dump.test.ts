// Writes the stored example of the AI section's preview (X6) for tools/ai-preview-sheet.mjs, through the page's own code
// and the real post.wasm. Skipped unless REPACKSHOT_AI_PREVIEW_DIR is set, so `npm run qa` writes nothing; the tool sets
// it and REPACKSHOT_AI_PREVIEW_STAGE:
//
//   scene  the reference scene (the example bottle as the app opens it) as an RSB at the sheet's size that asks for the
//          guard's passes, and the guard's job for it (its material table, its look): scene.rsb, job.json;
//   sheet  after `rt scene.rsb --ai-inputs inputs` (the Full engine): every example of the grid (src/ai/preview-sheet.ts)
//          through post.wasm with the test model (rt-post's `test_model`), each as display bytes with the render's
//          exposure and tone curve (<key>.rgba, RGBA8) and its report, the engine's own as before.rgba: sheet.json.
//
// Optional: REPACKSHOT_AI_PREVIEW_SIZE (WxH, default 512x288), REPACKSHOT_AI_PREVIEW_SPP (default 256).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_GUARD_PASSES } from '../src/core/ai-post';
import { guardMaterials } from '../src/ai/prompt';
import { PostGuard, runGuarded, type PostJob } from '../src/ai/post-wasm';
import { SHEET_BASE, sheetGrid, sheetKey, type SheetReport } from '../src/ai/preview-sheet';
import { decodeLinearImage } from '../src/io/ai-post';
import { projectScene, writeRsb } from '../src/io/rsb';
import { parsePasses } from '../src/render/pass-planes';
import { straightBytes } from '../src/render/tiles';
import { activeCamera } from '../src/core/camera';
import { apply, exampleState } from './helpers';

const dir = process.env.REPACKSHOT_AI_PREVIEW_DIR;
const stage = process.env.REPACKSHOT_AI_PREVIEW_STAGE ?? 'scene';
const [width, height] = (process.env.REPACKSHOT_AI_PREVIEW_SIZE ?? '512x288').split('x').map(Number);
const spp = Number(process.env.REPACKSHOT_AI_PREVIEW_SPP ?? 256);

describe.skipIf(!dir)('the stored example of the AI preview (X6)', { timeout: 3_600_000 }, () => {
  it.runIf(stage === 'scene')('writes the reference scene and its guard job', () => {
    mkdirSync(dir!, { recursive: true });
    // The example bottle, the camera brought closer so that the bottle and its floor fill the frame (◆ the framing).
    const s0 = exampleState();
    const cam = activeCamera(s0);
    const k = Number(process.env.REPACKSHOT_AI_PREVIEW_CLOSER ?? 0.7);
    const lower = Number(process.env.REPACKSHOT_AI_PREVIEW_LOWER ?? 40);
    const target: [number, number, number] = [cam.target[0], cam.target[1], cam.target[2] - lower];
    const s = apply(s0, { type: 'camera/set', id: cam.id, patch: { distance: cam.distance * k, focusDistance: cam.focusDistance * k, target } });
    const built = projectScene(s, { width, height, maxSamples: spp, maxSeconds: 0, passes: AI_GUARD_PASSES, textures: true, programs: true, patternNodes: true, ies: true, cameras: true });
    writeFileSync(join(dir!, 'scene.rsb'), writeRsb(built.scene));
    const job = { width, height, tonemap: built.scene.render.tonemap, exposureEv: built.scene.render.exposureEv, materials: guardMaterials(s, built.materialOrder), samples: spp };
    writeFileSync(join(dir!, 'job.json'), JSON.stringify(job, null, 2));
    expect(job.materials.length).toBeGreaterThan(0);
  });

  it.runIf(stage === 'sheet')('runs every example of the grid through post.wasm with the test model', async () => {
    const job = JSON.parse(readFileSync(join(dir!, 'job.json'), 'utf8')) as Omit<PostJob, 'settings' | 'modelKey' | 'runtime'> & { samples: number };
    const image = decodeLinearImage(new Uint8Array(readFileSync(join(dir!, 'inputs.rpl'))).buffer);
    const { passes } = parsePasses(new Uint8Array(readFileSync(join(dir!, 'inputs.rpp'))).buffer);
    expect([image.width, image.height]).toEqual([job.width, job.height]);
    const wasm = ['public/engine/post.wasm'].find((p) => existsSync(p));
    if (!wasm) throw new Error('post.wasm is missing: npm run engine:build');
    const guard = await PostGuard.fromBytes(readFileSync(wasm));
    const display = (rgba: Float32Array) => { const b = straightBytes(rgba, job.exposureEv, job.tonemap); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); };
    writeFileSync(join(dir!, 'before.rgba'), display(image.rgba));
    const entries: { key: string; settings: unknown; report: SheetReport }[] = [];
    for (const settings of sheetGrid(SHEET_BASE)) {
      const key = sheetKey(settings);
      const session = guard.open({ ...job, settings, modelKey: 'TEST_MODEL', runtime: 'test-model' }, image, passes);
      try {
        const sentBack = new Set<string>();
        const { image: out, report } = await runGuarded(session, guard.testModelFor(session), (p) => p.reason && sentBack.add(p.reason));
        writeFileSync(join(dir!, `${key}.rgba`), display(out.rgba));
        const limited = report.materials.filter((m) => (m.kept ?? 1) < 1).sort((a, b) => (a.kept ?? 1) - (b.kept ?? 1))[0];
        entries.push({ key, settings, report: { verdict: report.verdict, usedFraction: report.usedFraction, ...(report.capped ? { capped: report.capped } : {}), kept: limited ? { name: limited.name, kept: limited.kept ?? 1 } : null, ...(report.reason ? { reason: report.reason } : {}), ...(sentBack.size > 0 ? { sentBack: [...sentBack] } : {}) } });
      } finally {
        session.close();
      }
    }
    writeFileSync(join(dir!, 'sheet.json'), JSON.stringify({ width: job.width, height: job.height, samples: job.samples, entries }, null, 1));
    expect(entries.length).toBe(sheetGrid(SHEET_BASE).length);
  });
});

// The AI model manager's model (core/models.ts, phase U6): manifest validation of an import
// (AI-POST.md §5), licences that are not commercial or not known, the model in use after a
// deletion, what the list shows of the recommendation rule's output (the rule itself is P2's and is
// tested there with tests/fixtures/ai-recommend-cases.json), and the memory check.

import { describe, expect, it } from 'vitest';
import type { AiModelEntry } from '../src/data/ai-models';
import { recommend, type Recommendation } from '../src/core/ai-recommend';
import { AI_MODELS } from '../src/data/ai-models';
import { fromNativeHardware } from '../src/io/hardware';
import {
  activeModel,
  allModels,
  blobsToDelete,
  commercialOk,
  emptySnapshot,
  fallbackActive,
  fitsMemory,
  formatBytes,
  importedKey,
  isAcceptedFile,
  isPickleFile,
  modelState,
  recommendationView,
  recommendInput,
  rowBadges,
  SpeedMeter,
  validateManifest,
  type HardwareInfo,
  type ImportedModel,
  type ModelsSnapshot,
} from '../src/core/models';

const SHA = (c: string) => c.repeat(64);

function entry(key: string, files: string[], extra: Partial<AiModelEntry> = {}): AiModelEntry {
  return {
    key,
    label: { en: key, es: key },
    summary: { en: '', es: '' },
    family: 'z-image',
    role: 'img2img',
    quantization: 'Q4_0',
    runtimes: ['desktop'],
    default: false,
    available: true,
    licence: { spdx: 'Apache-2.0', url: 'https://example.org/l', commercialUse: true, useRestrictions: false },
    files: files.map((sha, i) => ({ role: 'transformer', name: `f${i}.gguf`, url: `https://h/${sha}`, bytes: 100, sha256: sha })),
    totalBytes: files.length * 100,
    requirements: { minVramGiB: 6, minRamGiB: 16 },
    ...extra,
  };
}

const good = () => ({
  format: 'repackshot-model',
  key: 'my-sdxl',
  name: 'My SDXL',
  family: 'sdxl',
  role: 'img2img',
  quantization: 'fp16',
  licence: { spdx: 'Apache-2.0', url: 'https://example.org/licence', commercialUse: true },
  files: [{ name: 'unet.safetensors', role: 'transformer', bytes: 1000, sha256: SHA('a') }],
  capabilities: { strength: true, referenceEdit: false, control: ['depth'] },
  source: 'https://example.org/model',
});

describe('importing: the manifest', () => {
  it('a complete manifest is accepted as it is', () => {
    const r = validateManifest(good(), { selected: ['unet.safetensors'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.model).toMatchObject({ key: 'my-sdxl', name: 'My SDXL', family: 'sdxl', files: [{ name: 'unet.safetensors', bytes: 1000, sha256: SHA('a') }], capabilities: { strength: true, control: ['depth'] } });
  });

  it('each missing field is reported with its name', () => {
    const m = good() as Record<string, unknown>;
    delete m.family;
    delete m.source;
    (m.licence as Record<string, unknown>).commercialUse = undefined;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(expect.arrayContaining([{ field: 'family', code: 'missing' }, { field: 'source', code: 'missing' }, { field: 'licence.commercialUse', code: 'missing' }]));
  });

  it('wrong values are invalid, with the reason', () => {
    const r = validateManifest({ ...good(), family: 'midjourney', files: [{ name: 'a.gguf', role: 'transformer', bytes: -1, sha256: 'xyz' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toContainEqual({ field: 'family', code: 'invalid' });
      expect(r.problems).toContainEqual({ field: 'files.0.bytes', code: 'invalid' });
      expect(r.problems).toContainEqual({ field: 'files.0.sha256', code: 'invalid' });
    }
    expect(validateManifest('nope')).toEqual({ ok: false, problems: [{ field: 'format', code: 'notManifest' }] });
    expect(validateManifest({ ...good(), format: 'other' }).ok).toBe(false);
  });

  it('pickle formats are refused, inside a manifest and as files', () => {
    for (const ext of ['ckpt', 'pt', 'pth', 'bin', 'pkl']) {
      expect(isPickleFile(`model.${ext}`), ext).toBe(true);
      expect(isAcceptedFile(`model.${ext}`), ext).toBe(false);
      const r = validateManifest({ ...good(), files: [{ name: `model.${ext}`, role: 'transformer', bytes: 10, sha256: SHA('b') }] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems).toContainEqual({ field: 'files', code: 'pickle', file: `model.${ext}` });
    }
    for (const name of ['m.safetensors', 'm.gguf', 'm.onnx', 'm.onnx_data', 'm.onnx_data_1', 'model_index.json']) expect(isAcceptedFile(name), name).toBe(true);
    expect(isAcceptedFile('m.exe')).toBe(false);
  });

  it('a file of the manifest that was not chosen is a problem; a missing sha256 is computed later unless asked for', () => {
    const r = validateManifest(good(), { selected: ['other.gguf'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContainEqual({ field: 'files', code: 'notSelected', file: 'unet.safetensors' });
    const noSha = { ...good(), files: [{ name: 'unet.safetensors', role: 'transformer', bytes: 1000 }] };
    expect(validateManifest(noSha).ok).toBe(true);
    expect(validateManifest(noSha, { requireSha: true }).ok).toBe(false);
  });

  it('a key that is taken or unusable is replaced by one from the name', () => {
    const r = validateManifest(good(), { taken: ['my-sdxl'] });
    expect(r.ok && r.model.key).toBe('user-my-sdxl');
    expect(importedKey('Mí modelo ñ', ['user-mi-modelo-n'])).toBe('user-mi-modelo-n-2');
    const bad = validateManifest({ ...good(), key: '../../etc' });
    expect(bad.ok && bad.model.key).toBe('user-my-sdxl');
  });
});

describe('licences', () => {
  it('only a known licence that allows it is commercial; unknown ones are not', () => {
    expect(commercialOk({ spdx: 'Apache-2.0', commercialUse: true })).toBe(true);
    expect(commercialOk({ spdx: 'LicenseRef-CreativeML-OpenRAIL-M', commercialUse: true })).toBe(true);
    expect(commercialOk({ spdx: 'CC-BY-NC-4.0', commercialUse: true })).toBe(false);
    expect(commercialOk({ spdx: 'LicenseRef-Mine', commercialUse: true })).toBe(false);
    expect(commercialOk({ spdx: 'Apache-2.0', commercialUse: false })).toBe(false);
  });

  it('a noncommercial or unknown imported model is marked, and never becomes the model in use by itself', () => {
    const imported: ImportedModel = { ...(validateManifest(good()) as { model: ImportedModel }).model, key: 'user-x', licence: { spdx: 'LicenseRef-Mine', url: 'https://x', commercialUse: true } };
    const snap = { ...emptySnapshot({ schema: 1, models: [], recommendation: [] }), imported: [imported] };
    const models = allModels(snap);
    expect(rowBadges(models[0], null).noncommercial).toBe(true);
    expect(fallbackActive(models, ['user-x'], { rowId: 'r', recommended: 'user-x', offered: [], skipped: [] })).toBe('');
    // Chosen by the person, it is used.
    expect(activeModel('user-x', models, ['user-x'], null)).toBe('user-x');
  });

  it('use restrictions are flagged for the licence panel', () => {
    const sd = entry('SD', [SHA('c')], { licence: { spdx: 'LicenseRef-CreativeML-OpenRAIL-M', url: 'https://x', commercialUse: true, useRestrictions: true } });
    const m = allModels({ catalogue: { schema: 1, models: [sd], recommendation: [] }, imported: [] })[0];
    expect(rowBadges(m, null)).toEqual({ recommended: false, offered: false, noncommercial: false, restrictions: true });
  });
});

describe('the model in use', () => {
  const cat = { schema: 1, models: [entry('Q8', [SHA('1'), SHA('e')], { default: true }), entry('Q4', [SHA('2'), SHA('e')]), entry('SD', [SHA('3')])], recommendation: [] };
  const models = allModels({ catalogue: cat, imported: [] });
  const rec: Recommendation = { rowId: 'gpu-6', recommended: 'Q4', offered: ['SD'], skipped: [] };

  it('deleting the active model falls back to the recommendation when it is installed', () => {
    expect(fallbackActive(models, ['Q4', 'Q8', 'SD'], rec, 'Q8')).toBe('Q4');
  });

  it('without the recommendation installed: the default, else none (never a guess)', () => {
    expect(fallbackActive(models, ['Q8', 'SD'], rec)).toBe('Q8');
    expect(fallbackActive(models, ['SD'], rec)).toBe('');
    expect(fallbackActive(models, ['Q8'], null, 'Q8')).toBe('');
  });

  it('a chosen model that is not installed any more is not in use', () => {
    expect(activeModel('SD', models, ['Q4'], rec)).toBe('Q4');
    expect(activeModel('SD', models, ['SD', 'Q4'], rec)).toBe('SD');
  });

  it('deleting a model keeps the files another installed or downloading model uses', () => {
    expect(blobsToDelete(models, ['Q8', 'Q4'], 'Q8')).toEqual([SHA('1')]);
    expect(blobsToDelete(models, ['Q8'], 'Q8')).toEqual([SHA('1'), SHA('e')]);
    expect(blobsToDelete(models, ['Q8'], 'Q8', ['Q4'])).toEqual([SHA('1')]);
  });
});

describe('what the list shows', () => {
  const cat = { schema: 1, models: [entry('A', [SHA('1'), SHA('2')]), entry('W', [SHA('3')], { available: false, unavailableReason: { en: 'later', es: 'luego' } })], recommendation: [] };
  const base = (extra: Partial<ModelsSnapshot> = {}): ModelsSnapshot => ({ ...emptySnapshot(cat), ready: true, ...extra });
  const a = () => allModels(base()).find((m) => m.key === 'A')!;

  it('the recommendation rule’s output, as the Hardware part says it', () => {
    expect(recommendationView(null)).toEqual({ kind: 'FAILED' });
    expect(recommendationView({ rowId: null, recommended: null, offered: [], skipped: [] })).toEqual({ kind: 'NO_ROW' });
    expect(recommendationView({ rowId: 'web-gpu', recommended: null, offered: [], skipped: ['ZIMAGE_WEB'] })).toEqual({ kind: 'NONE', rowId: 'web-gpu', skipped: ['ZIMAGE_WEB'] });
    expect(recommendationView({ rowId: 'gpu-12', recommended: 'A', offered: ['B'], skipped: [] })).toEqual({ kind: 'MODEL', rowId: 'gpu-12', key: 'A', offered: ['B'], skipped: [] });
    const rec = { rowId: 'gpu-12', recommended: 'A', offered: ['W'], skipped: [] };
    expect(rowBadges(a(), rec)).toMatchObject({ recommended: true, offered: false });
  });

  it('what is detected becomes the rule’s input, and a failed detection none', () => {
    const web: HardwareInfo = { detected: true, where: 'web', cores: 8, ramGiB: 8, ramCapped: true, gpus: [], webgpu: true, maxBufferBytes: 2 * 2 ** 30 };
    expect(recommendInput(web, 'GPU')).toEqual({ device: 'web', webgpu: true, maxBufferGiB: 2 });
    expect(recommendInput({ ...web, webgpu: null }, 'GPU')).toBeNull();
    const desk: HardwareInfo = { detected: true, where: 'desktop', cores: 16, ramGiB: 31.9, gpus: [{ name: 'A', vramGiB: 8 }, { name: 'B', vramGiB: 24 }], webgpu: null, maxBufferBytes: null };
    expect(recommendInput(desk, 'GPU', 1)).toEqual({ device: 'gpu', vramGiB: 24 });
    expect(recommendInput(desk, 'CPU')).toEqual({ device: 'cpu', ramGiB: 31.9 });
    expect(recommendInput({ ...desk, detected: false }, 'GPU')).toBeNull();
    expect(recommendInput(null, 'GPU')).toBeNull();
  });

  it('the memory warning compares what the model asks with what was detected, and stays quiet when unknown', () => {
    const desk: HardwareInfo = { detected: true, where: 'desktop', cores: 16, ramGiB: 12, gpus: [{ name: 'A', vramGiB: 4 }], webgpu: null, maxBufferBytes: null };
    expect(fitsMemory(a(), desk, 'GPU')).toEqual({ fits: false, needGiB: 6, haveGiB: 4 });
    expect(fitsMemory(a(), desk, 'CPU')).toEqual({ fits: false, needGiB: 16, haveGiB: 12 });
    expect(fitsMemory(a(), { ...desk, ramGiB: 8, ramCapped: true }, 'CPU')).toBeNull();
    expect(fitsMemory(a(), null, 'GPU')).toBeNull();
    // Measured memory is compared as effective GiB, like the rule: a "6 GB" card that reads 5.7 GiB fits a 6 GiB model.
    expect(fitsMemory(a(), { ...desk, gpus: [{ name: 'G', vramGiB: 5.7 }] }, 'GPU')).toEqual({ fits: true, needGiB: 6, haveGiB: 5.7 });
    expect(fitsMemory(a(), { ...desk, gpus: [{ name: 'G', vramGiB: 5.5 }] }, 'GPU')?.fits).toBe(false);
  });

  it('states: not downloaded, kept bytes, downloading with measured numbers, damaged, ready, in use, not available', () => {
    expect(modelState(a(), base(), '')).toEqual({ kind: 'NOT_DOWNLOADED', done: 0, total: 200 });
    const blobs = { [SHA('1')]: { sha256: SHA('1'), state: 'complete' as const, contiguous: 100, total: 100, damaged: false } };
    expect(modelState(a(), base({ blobs }), '')).toEqual({ kind: 'NOT_DOWNLOADED', done: 100, total: 200 });
    const downloads = { A: { key: 'A', phase: 'DOWNLOADING' as const, done: 150, total: 200, bytesPerSecond: 50, etaSeconds: 1 } };
    expect(modelState(a(), base({ blobs, downloads }), '')).toEqual({ kind: 'DOWNLOADING', done: 150, total: 200, bytesPerSecond: 50, etaSeconds: 1 });
    const damaged = { ...blobs, [SHA('2')]: { sha256: SHA('2'), state: 'partial' as const, contiguous: 100, total: 100, damaged: true } };
    expect(modelState(a(), base({ blobs: damaged }), '')).toEqual({ kind: 'DAMAGED', files: ['f1.gguf'] });
    expect(modelState(a(), base({ installed: ['A'] }), '')).toEqual({ kind: 'READY' });
    expect(modelState(a(), base({ installed: ['A'] }), 'A')).toEqual({ kind: 'IN_USE' });
    const w = allModels(base()).find((m) => m.key === 'W')!;
    expect(modelState(w, base(), '')).toEqual({ kind: 'UNAVAILABLE', reason: { en: 'later', es: 'luego' } });
  });

  it('speed is measured, not assumed, and sizes come from the bytes', () => {
    const m = new SpeedMeter(8, 1.5);
    m.add(0, 1000);
    expect(m.rate(1)).toBeNull();
    m.add(1, 1000);
    m.add(2, 1000);
    expect(m.rate(2)).toBe(1000);
    expect(m.rate(20)).toBeNull();
    expect(formatBytes(6_515_955_588, 'en')).toBe('6.5 GB');
    expect(formatBytes(6_515_955_588, 'es')).toBe('6,5 GB');
    expect(formatBytes(820_000_000, 'en')).toBe('820 MB');
  });
});

describe('the desktop launcher’s detection', () => {
  const measured = {
    cpu: 'Some CPU',
    cores: 8,
    threads: 16,
    ramBytes: null,
    ramGiB: 15.6,
    ramUsableBytes: null,
    gpus: [{ name: 'Card', vendor: 'v', vramBytes: null, vramGiB: 11.99 }],
    device: 'gpu' as const,
    gpuFound: true,
    detected: true,
    input: { device: 'gpu' as const, vramGiB: 11.99 },
    recommendation: { rowId: 'gpu-12', recommended: 'ZIMAGE_Q8', offered: ['KLEIN4B_Q4'], skipped: [] },
  };

  it('becomes what the Hardware part shows, and the same rule gives the launcher’s recommendation', () => {
    const hw = fromNativeHardware(measured);
    expect(hw).toMatchObject({ detected: true, where: 'desktop', cores: 16, ramGiB: 15.6, cpu: 'Some CPU', device: 'gpu', webgpu: null });
    expect(hw.gpus).toEqual([{ name: 'Card', vramGiB: 11.99 }]);
    // A "12 GB" card that reads 11.99 GiB is in the 12 GiB row (MEMORY_REPORTING_FACTOR), as in recommend.rs.
    const rec = recommend(recommendInput(hw, 'GPU'), AI_MODELS);
    expect(rec).toEqual(measured.recommendation);
    // A "16 GB" computer reading 15.6 GiB is in the 16 GiB CPU row.
    expect(recommend(recommendInput(hw, 'CPU'), AI_MODELS)?.rowId).toBe('cpu-16');
  });

  it('without a GPU the launcher can use (under 4 GiB), the CPU rows decide, as for the installer', () => {
    const hw = fromNativeHardware({ ...measured, gpus: [{ name: 'Small', vendor: 'v', vramBytes: null, vramGiB: 2 }], device: 'cpu' });
    expect(recommendInput(hw, 'GPU')).toEqual({ device: 'cpu', ramGiB: 15.6 });
    expect(recommend(recommendInput(hw, 'GPU'), AI_MODELS)?.rowId).toBe('cpu-16');
    // In the browser there is no such choice: the web rows.
    expect(recommendInput({ ...hw, where: 'web', webgpu: false }, 'GPU')).toEqual({ device: 'web', webgpu: false, maxBufferGiB: null });
  });

  it('a failed detection recommends nothing', () => {
    const hw = fromNativeHardware({ ...measured, detected: false });
    expect(hw.error).toBe('launcher');
    expect(recommend(recommendInput(hw, 'GPU'), AI_MODELS)).toBeNull();
  });

  it('"no graphics card" and "the graphics cards could not be read" are not the same answer', async () => {
    const { noGpuText } = await import('../src/ui/panels/settings-ai');
    const { setLang, setStringsPlatform } = await import('../src/ui/strings');
    // v0.1.2 on Windows: no source answered, and the interface said there was no graphics card.
    const failed = fromNativeHardware({ ...measured, gpus: [], device: 'cpu', gpuDetection: 'failed' });
    expect(failed.gpuDetectionFailed).toBe(true);
    const none = fromNativeHardware({ ...measured, gpus: [], device: 'cpu', gpuDetection: 'ok' });
    expect(none.gpuDetectionFailed).toBeUndefined();
    // A launcher from before the field: as before, no graphics card.
    expect(fromNativeHardware({ ...measured, gpus: [], device: 'cpu' }).gpuDetectionFailed).toBeUndefined();
    setStringsPlatform('desktop');
    try {
      expect(noGpuText({ state: 'DONE', info: failed })).toBe('The graphics cards could not be read: see the logs');
      expect(noGpuText({ state: 'DONE', info: none })).toBe('No graphics card found');
      expect(noGpuText({ state: 'DETECTING', info: null })).toBe('Detecting…');
      expect(noGpuText({ state: 'DONE', info: { ...none, detected: false } })).toBe('Not detected');
      setLang('es');
      expect(noGpuText({ state: 'DONE', info: failed })).toBe('No se han podido leer las tarjetas gráficas: mira los registros');
      expect(noGpuText({ state: 'DONE', info: none })).toBe('No se ha encontrado ninguna tarjeta gráfica');
    } finally {
      setLang('en');
      setStringsPlatform('web');
    }
    // Either way the CPU rows decide, as the launcher does.
    expect(recommendInput(failed, 'GPU')).toEqual({ device: 'cpu', ramGiB: 15.6 });
  });
});

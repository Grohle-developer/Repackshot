// The page's side of the launcher's AI runtime API (src/io/ai-runtime.ts against
// engine/crates/rt-app/src/ai/mod.rs): paths, methods, the status query, the file the person
// chose, errors with the launcher's reason, and one inference followed to its end with progress
// and a cancel. The launcher side of the same contract is tested over sockets in
// engine/crates/rt-app/tests/ai.rs.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runtimeQuery, type AiRunState } from '../src/core/ai-runtimes';
import { AiRunError, AiRuntimeClient, statusQuery } from '../src/io/ai-runtime';
import { NativeClient, NativeError, type NativeInfo } from '../src/io/native';
import { STRINGS } from '../src/ui/strings';
import { AI_RUNTIMES } from '../src/data/ai-runtimes';
import { openVcRuntime, runtimeActions, VC_RUNTIME_URL } from '../src/ui/panels/settings-ai';
import { LICENCE_PATHS } from '../src/ui/panels/settings-sections';
import type { Ctx } from '../src/ui/reactive';

const TOKEN = '00112233445566778899aabbccddeeff';
const INFO = { app: 'repackshot', aiApi: 1, filesApi: 1 } as unknown as NativeInfo;

interface Call {
  method: string;
  path: string;
  body: string | null;
  token: string | null;
}

function launcher(answer: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = async (input: string, init?: RequestInit) => {
    const c: Call = {
      method: init?.method ?? 'GET',
      path: input,
      body: typeof init?.body === 'string' ? init.body : null,
      token: new Headers(init?.headers).get('X-Repackshot-Token'),
    };
    calls.push(c);
    return answer(c);
  };
  return { calls, client: new AiRuntimeClient(new NativeClient(TOKEN, INFO, fetchFn)) };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const run = (patch: Partial<AiRunState>): AiRunState => ({
  id: 7,
  state: 'QUEUED',
  step: 0,
  steps: 0,
  fraction: 0,
  seconds: 0,
  version: 1,
  model: 'ZIMAGE_Q4',
  runtime: 'SDCPP_LINUX_CPU',
  width: 512,
  height: 512,
  error: null,
  message: null,
  ...patch,
});

describe('AI runtime client (the launcher API of X3b)', () => {
  it('asks the status with the settings: forced backend, the CPU as device, the active model', async () => {
    expect(statusQuery(runtimeQuery('AUTO', 'GPU', null))).toBe('');
    expect(statusQuery(runtimeQuery('VULKAN', 'CPU', 'ZIMAGE_Q4'))).toBe('?force=VULKAN&device=cpu&model=ZIMAGE_Q4');
    expect(runtimeQuery('CPU', 'GPU', '')).toEqual({ force: 'CPU', cpu: false, model: null });
    const { calls, client } = launcher(() => json(200, { available: false, reason: 'NO_RUNTIME' }));
    const st = await client.status(runtimeQuery('AUTO', 'CPU', 'SD15_LIGHT'));
    expect(st.reason).toBe('NO_RUNTIME');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/ai/runtime?device=cpu&model=SD15_LIGHT', token: TOKEN });
  });

  it('downloads, pauses, removes, probes and releases by key, and refuses keys that are not keys', async () => {
    const { calls, client } = launcher((c) => (c.method === 'DELETE' ? new Response(null, { status: 204 }) : json(c.path.endsWith('/download') ? 202 : 200, { key: 'SDCPP_WIN_CPU' })));
    await client.download('SDCPP_WIN_CPU');
    await client.pause('SDCPP_WIN_CPU');
    await client.probe('SDCPP_WIN_CPU');
    await client.remove('SDCPP_WIN_CPU');
    await client.release();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/ai/runtimes/SDCPP_WIN_CPU/download',
      'POST /api/ai/runtimes/SDCPP_WIN_CPU/pause',
      'POST /api/ai/runtimes/SDCPP_WIN_CPU/probe',
      'DELETE /api/ai/runtimes/SDCPP_WIN_CPU',
      'DELETE /api/ai/sidecar',
    ]);
    await expect(client.download('../x')).rejects.toThrow(/not a runtime key/);
  });

  it('installs the archive the person chose in the system dialog, by its grant', async () => {
    const { calls, client } = launcher((c) => {
      if (c.path === '/api/dialog/open') return json(200, { cancelled: false, file: { id: 'fabc', name: 'x.zip' }, files: [] });
      return json(202, { key: 'SDCPP_LINUX_CPU', state: 'verifying' });
    });
    expect(await client.installFromFile('SDCPP_LINUX_CPU', { title: 'Choose', filterName: 'Zip archives' })).toBe(true);
    expect(JSON.parse(calls[0].body!)).toEqual({ title: 'Choose', filters: [{ name: 'Zip archives', extensions: ['zip'] }] });
    expect(calls[1]).toMatchObject({ method: 'POST', path: '/api/ai/runtimes/SDCPP_LINUX_CPU/import' });
    expect(JSON.parse(calls[1].body!)).toEqual({ file: 'fabc' });
    const cancelled = launcher(() => json(200, { cancelled: true }));
    expect(await cancelled.client.installFromFile('SDCPP_LINUX_CPU', { title: 'Choose', filterName: 'Zip' })).toBe(false);
    expect(cancelled.calls).toHaveLength(1);
  });

  it('a refused run throws with the launcher reason', async () => {
    const { client } = launcher(() => json(409, { error: 'unavailable', reason: 'MODEL_UNSUPPORTED', message: 'ZIMAGE_WEB is not one this runtime loads' }));
    const err = await client.run({ model: 'ZIMAGE_WEB', image: 'x', prompt: '', negative: '', strength: 0.3, seed: 0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NativeError);
    expect((err as NativeError).status).toBe(409);
    expect((err as NativeError).code).toBe('MODEL_UNSUPPORTED');
  });

  it('follows one inference with long polls to its image, then forgets it', async () => {
    const states = [run({ state: 'LOADING', version: 2 }), run({ state: 'INFERENCE', step: 3, steps: 8, fraction: 0.4, version: 3 }), run({ state: 'DONE', step: 8, steps: 8, fraction: 1, version: 4 })];
    const { calls, client } = launcher((c) => {
      if (c.method === 'POST') return json(202, run({}));
      if (c.method === 'DELETE') return new Response(null, { status: 204 });
      if (c.path.endsWith('/image')) return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'Content-Type': 'image/png' } });
      return json(200, states.shift());
    });
    const seen: string[] = [];
    const png = await client.infer({ model: 'ZIMAGE_Q4', image: 'iVBOR', prompt: 'p', negative: 'n', strength: 0.3, seed: 1, device: 'cpu' }, (s) => seen.push(`${s.state}${s.step}`));
    expect(seen).toEqual(['QUEUED0', 'LOADING0', 'INFERENCE3', 'DONE8']);
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const paths = calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toEqual(['POST /api/ai/run', 'GET /api/ai/run/7?after=1', 'GET /api/ai/run/7?after=2', 'GET /api/ai/run/7?after=3', 'GET /api/ai/run/7/image', 'DELETE /api/ai/run/7']);
    expect(JSON.parse(calls[0].body!)).toMatchObject({ model: 'ZIMAGE_Q4', strength: 0.3, device: 'cpu' });
  });

  it('a failed run throws with its code, and an abort cancels the run', async () => {
    const failed = launcher((c) => (c.method === 'POST' ? json(202, run({})) : json(200, run({ state: 'FAILED', error: 'wrong-size', message: 'the runtime returned 32×32 instead of 512×512', version: 2 }))));
    const err = await failed.client.infer({ model: 'M', image: 'x', prompt: '', negative: '', strength: 0.5, seed: 0 }, () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRunError);
    expect((err as AiRunError).state.error).toBe('wrong-size');

    const controller = new AbortController();
    let cancelled = false;
    const slow = launcher((c) => {
      if (c.method === 'POST') return json(202, run({}));
      if (c.method === 'DELETE') {
        cancelled = true;
        return new Response(null, { status: 204 });
      }
      return json(200, cancelled ? run({ state: 'CANCELLED', version: 3 }) : run({ state: 'INFERENCE', step: 1, steps: 8, version: 2 }));
    });
    const p = slow.client.infer({ model: 'M', image: 'x', prompt: '', negative: '', strength: 0.5, seed: 0 }, (s) => {
      if (s.state === 'INFERENCE') controller.abort();
    }, controller.signal);
    await expect(p).rejects.toBeInstanceOf(AiRunError);
    expect(slow.calls.some((c) => c.method === 'DELETE' && c.path === '/api/ai/run/7')).toBe(true);
  });
});

describe('the Runtime row says why each choice was made, in both languages', () => {
  it('has a sentence for every row of the rule', () => {
    for (const row of AI_RUNTIMES.choice) {
      const key = `set.rt.choice.${row.id}` as keyof typeof STRINGS.en;
      expect(STRINGS.en[key], row.id).toBeTruthy();
      expect(STRINGS.es[key], row.id).toBeTruthy();
    }
  });
});

describe('the Windows builds and the Microsoft Visual C++ runtime (X3c)', () => {
  const installed = { state: 'installed' as const, vcRuntime: null };

  it('an installed build that lacks it offers Microsoft’s page and a new check, before Remove; otherwise not', () => {
    expect(runtimeActions({ ...installed, vcRuntime: 'missing' })).toEqual(['vcRuntime', 'probe', 'remove']);
    expect(runtimeActions(installed)).toEqual(['remove']);
    expect(runtimeActions({ state: 'missing', vcRuntime: null })).toEqual(['download', 'fromFile']);
    expect(runtimeActions({ state: 'paused', vcRuntime: 'missing' })).toEqual(['resume', 'remove']);
    expect(runtimeActions({ state: 'downloading', vcRuntime: null })).toEqual(['pause']);
  });

  it('the button opens Microsoft’s official page in the system’s browser: we do not ship its DLLs', async () => {
    const opened: string[] = [];
    const ctx = { services: { openExternal: async (url: string) => void opened.push(url) } } as unknown as Ctx;
    await openVcRuntime(ctx, { vcRuntimeUrl: 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist' });
    await openVcRuntime(ctx, { vcRuntimeUrl: null });
    expect(opened).toEqual([VC_RUNTIME_URL, VC_RUNTIME_URL]);
    expect(VC_RUNTIME_URL).toMatch(/^https:\/\/learn\.microsoft\.com\//);
    for (const key of ['set.rt.vcRuntime', 'set.rt.vcRuntimeInstall', 'set.rt.vcRuntimeTip', 'set.rt.probe'] as const) {
      expect(STRINGS.en[key], key).toBeTruthy();
      expect(STRINGS.es[key], key).toBeTruthy();
    }
    expect(STRINGS.en['set.rt.vcRuntimeInstall']).toBe('Install Microsoft Visual C++ runtime…');
  });

  it('About lists stable-diffusion.cpp and ggml with their MIT licences, shipped as files', () => {
    expect(LICENCE_PATHS.sdcpp).toBe('licences/stable-diffusion.cpp.LICENSE.txt');
    expect(LICENCE_PATHS.ggml).toBe('licences/ggml.LICENSE.txt');
    expect(STRINGS.en['set.ab.sdcpp']).toMatch(/^stable-diffusion\.cpp: .*\(MIT\)$/);
    expect(STRINGS.es['set.ab.ggml']).toMatch(/^ggml: .*\(MIT\)$/);
    // tools/licences.mjs copies them byte for byte from tools/third-party/.
    const tool = readFileSync('tools/licences.mjs', 'utf8');
    expect(tool).toContain("['tools/third-party/stable-diffusion.cpp-d637cfb.LICENSE', 'stable-diffusion.cpp.LICENSE.txt']");
    expect(tool).toContain("['tools/third-party/ggml-d25b121.LICENSE', 'ggml.LICENSE.txt']");
    expect(readFileSync('tools/third-party/stable-diffusion.cpp-d637cfb.LICENSE', 'utf8')).toMatch(/^MIT License\n\nCopyright \(c\) 2023 leejet\n/);
    expect(readFileSync('tools/third-party/ggml-d25b121.LICENSE', 'utf8')).toMatch(/^MIT License\n\nCopyright \(c\) 2023-2026 The ggml authors\n/);
  });
});

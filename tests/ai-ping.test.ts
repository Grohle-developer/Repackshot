// The ping test (Settings ▸ AI ▸ Test connection): one minimal call through the same backend, and the
// answer thrown away. A fake backend stands in for the service.

import { describe, expect, it } from 'vitest';
import { pingBackend, pingPass, PING_SIDE } from '../src/ai/api-ping';
import { ApiCallError } from '../src/core/ai-remote';
import type { AiModelBackend, AiModelPass, AiTileImage } from '../src/core/ai-backend';

function fakeBackend(run: (pass: AiModelPass) => Promise<AiTileImage>): AiModelBackend {
  return {
    kind: 'API',
    runtime: 'api:example.test',
    run: (pass, _signal) => run(pass),
  };
}

describe('the ping test', () => {
  it('sends one 512 × 512 solid grey tile, the fixed prompt, and takes the answer as the connection working', async () => {
    const seen: AiModelPass[] = [];
    const backend = fakeBackend(async (pass) => {
      seen.push(pass);
      return { width: 512, height: 512, rgb: new Uint8Array(512 * 512 * 3).fill(200) };
    });
    await expect(pingBackend(backend, new AbortController().signal)).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
    const pass = seen[0]!;
    expect(pass).toMatchObject({
      tile: 1,
      tiles: 1,
      attempt: 0,
      strength: 0.5,
      seed: 1,
      width: PING_SIDE,
      height: PING_SIDE,
      prompt: 'Return this image unchanged.',
      negative: '',
    });
    expect(PING_SIDE).toBe(512);
    expect([...pass.input]).toEqual(new Array(512 * 512 * 3).fill(128));
    expect([...pass.depth!]).toEqual(new Array(512 * 512).fill(128));
    expect([...pass.edges!]).toEqual(new Array(512 * 512).fill(0));
    expect(pingPass()).toMatchObject({ width: 512, height: 512 });
  });

  it('a failed call throws the call’s error, so the settings row can word it', async () => {
    const err = new ApiCallError('api-auth', 'HTTP 401', 1, 401);
    const backend = fakeBackend(async () => {
      throw err;
    });
    await expect(pingBackend(backend, new AbortController().signal)).rejects.toBe(err);
  });
});

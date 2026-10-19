// The ping result line of Settings ▸ AI ▸ Model by API: a finished result stays while the configuration it was
// measured for still holds. Regression: the refresh that ran after a test wiped the result (the line showed
// nothing, neither error nor success) whenever a key was stored.

import { describe, expect, it } from 'vitest';
import { apiPreset } from '../src/data/ai-api-presets';
import { pingKey, pingLine } from '../src/ui/panels/settings-api';

const NO_KEY = 'No key stored for example.com: save one first.';
const OPTIONS = { sendPasses: false, timeoutSeconds: 120, attempts: 3 } as const;
const ENDPOINT = apiPreset('GOOGLE_GEMINI').endpoint;
const OTHER_ENDPOINT = { ...ENDPOINT, url: 'https://example.com/other' };

describe('pingLine', () => {
  it('keeps a finished result across the trailing refresh with the same configuration', () => {
    const key = pingKey('GOOGLE_GEMINI', ENDPOINT, OPTIONS, true);
    const state = { result: 'Connection works: the service answered with an image.', resultKey: key };
    const line = pingLine(state, key, true, NO_KEY);
    expect(line.text).toBe('Connection works: the service answered with an image.');
    expect(line.result).toBe(state.result);
    expect(line.resultKey).toBe(key);
  });

  it('keeps a finished error across the trailing refresh with the same configuration', () => {
    const key = pingKey('GOOGLE_GEMINI', ENDPOINT, OPTIONS, true);
    const state = { result: 'The service is limiting requests (HTTP 429).', resultKey: key };
    expect(pingLine(state, key, true, NO_KEY).text).toBe('The service is limiting requests (HTTP 429).');
  });

  it('drops the result when the endpoint changes', () => {
    const key = pingKey('GOOGLE_GEMINI', ENDPOINT, OPTIONS, true);
    const state = { result: 'Connection works: the service answered with an image.', resultKey: key };
    const next = pingKey('GOOGLE_GEMINI', OTHER_ENDPOINT, OPTIONS, true);
    const line = pingLine(state, next, true, NO_KEY);
    expect(line.text).toBe('');
    expect(line.result).toBeNull();
    expect(line.resultKey).toBe('');
  });

  it('drops the result when the options change', () => {
    const key = pingKey('GOOGLE_GEMINI', ENDPOINT, OPTIONS, true);
    const state = { result: 'Connection works: the service answered with an image.', resultKey: key };
    const next = pingKey('GOOGLE_GEMINI', ENDPOINT, { ...OPTIONS, attempts: 1 }, true);
    const line = pingLine(state, next, true, NO_KEY);
    expect(line.text).toBe('');
    expect(line.result).toBeNull();
  });

  it('drops the result and shows the no-key line once the key is gone', () => {
    const key = pingKey('GOOGLE_GEMINI', ENDPOINT, OPTIONS, true);
    const state = { result: 'Connection works: the service answered with an image.', resultKey: key };
    const line = pingLine(state, pingKey('GOOGLE_GEMINI', ENDPOINT, OPTIONS, false), false, NO_KEY);
    expect(line.text).toBe(NO_KEY);
    expect(line.result).toBeNull();
  });

  it('shows nothing when no result was ever measured', () => {
    expect(pingLine({ result: null, resultKey: '' }, pingKey('GOOGLE_GEMINI', ENDPOINT, OPTIONS, true), true, NO_KEY).text).toBe('');
  });
});

describe('pingKey', () => {
  it('differs across provider, endpoint, options and key state', () => {
    const base = pingKey('GOOGLE_GEMINI', ENDPOINT, OPTIONS, true);
    expect(pingKey('XAI_IMAGINE', ENDPOINT, OPTIONS, true)).not.toBe(base);
    expect(pingKey('GOOGLE_GEMINI', OTHER_ENDPOINT, OPTIONS, true)).not.toBe(base);
    expect(pingKey('GOOGLE_GEMINI', ENDPOINT, { ...OPTIONS, attempts: 1 }, true)).not.toBe(base);
    expect(pingKey('GOOGLE_GEMINI', ENDPOINT, OPTIONS, false)).not.toBe(base);
    expect(pingKey('GOOGLE_GEMINI', ENDPOINT, OPTIONS, true)).toBe(base);
  });
});

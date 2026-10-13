import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/core/version';

describe('smoke', () => {
  it('exposes a semver VERSION', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/core/version';

describe('smoke', () => {
  it('exposes a semver VERSION', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('VERSION is the version in package.json (the launcher, the release and the update check read that one)', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

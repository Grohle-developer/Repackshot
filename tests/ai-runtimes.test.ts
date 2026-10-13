import { describe, expect, it } from 'vitest';
import { chooseRuntime, runtimeInput, type RuntimeChoice, type RuntimeChoiceInput } from '../src/core/ai-runtimes';
import { AI_MODELS, aiModel } from '../src/data/ai-models';
import { AI_RUNTIMES, aiRuntime } from '../src/data/ai-runtimes';
import CASES_JSON from './fixtures/ai-runtime-cases.json';

interface Case {
  note?: string;
  input: RuntimeChoiceInput | null;
  expect: RuntimeChoice | null;
}

// The same file is read by the Rust test of the desktop launcher (rt-app, src/ai/catalogue.rs).
const CASES = CASES_JSON as unknown as Case[];

describe('the runtime choice (AI-POST §7.1)', () => {
  for (const c of CASES) {
    it(c.note ?? JSON.stringify(c.input), () => {
      expect(chooseRuntime(c.input)).toEqual(c.expect);
    });
  }

  it('covers both systems, both backends, forcing both, a failed detection and no build', () => {
    const inputs = CASES.map((c) => c.input).filter((i): i is RuntimeChoiceInput => i !== null);
    for (const os of ['windows', 'linux']) for (const gpu of [true, false]) expect(inputs.some((i) => i.os === os && i.gpu === gpu && i.force === null)).toBe(true);
    for (const force of ['VULKAN', 'CPU']) expect(inputs.some((i) => i.force === force)).toBe(true);
    expect(inputs.some((i) => i.gpu === null)).toBe(true);
    expect(CASES.some((c) => c.expect !== null && c.expect.key === null)).toBe(true);
  });

  it('reads the desktop hardware report and the settings as the launcher does', () => {
    const hw = { detected: true, where: 'desktop' as const, cores: 8, ramGiB: 32, gpus: [{ name: 'GPU', vramGiB: 8 }], webgpu: null, maxBufferBytes: null, device: 'gpu' as const };
    expect(runtimeInput('linux', 'x86_64', hw, 'GPU', 'AUTO')).toEqual({ os: 'linux', arch: 'x86_64', gpu: true, force: null });
    // The person chose the CPU as the device: no GPU for the rule (the launcher gets device=cpu).
    expect(runtimeInput('linux', 'x86_64', hw, 'CPU', 'AUTO').gpu).toBe(false);
    // A GPU under 4 GiB is not one to use: the launcher said cpu.
    expect(runtimeInput('windows', 'x86_64', { ...hw, device: 'cpu' }, 'GPU', 'VULKAN')).toEqual({ os: 'windows', arch: 'x86_64', gpu: false, force: 'VULKAN' });
    expect(runtimeInput('windows', 'x86_64', null, 'GPU', 'CPU')).toEqual({ os: 'windows', arch: 'x86_64', gpu: null, force: 'CPU' });
    expect(chooseRuntime(runtimeInput('windows', 'x86_64', hw, 'GPU', 'AUTO'))?.key).toBe('SDCPP_WIN_VULKAN');
  });
});

describe('the runtime catalogue (src/data/ai-runtimes.json)', () => {
  it('pins two builds per system to one release, by size and sha256', () => {
    const { tag, commit } = AI_RUNTIMES.release;
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(commit.startsWith(tag.split('-').pop()!)).toBe(true);
    const keys = AI_RUNTIMES.runtimes.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of ['SDCPP_WIN_VULKAN', 'SDCPP_WIN_CPU', 'SDCPP_LINUX_VULKAN', 'SDCPP_LINUX_CPU']) expect(aiRuntime(key)).toBeDefined();
    for (const r of AI_RUNTIMES.runtimes) {
      expect(r.key).toMatch(/^[A-Z0-9_]+$/);
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(r.bytes) && r.bytes > 0).toBe(true);
      expect(r.url).toBe(`https://github.com/leejet/stable-diffusion.cpp/releases/download/${tag}/${r.name}`);
      expect(r.label.en && r.label.es && r.requires.en && r.requires.es).toBeTruthy();
      expect(r.archive.format).toBe('zip');
      const exe = r.os === 'windows' ? '.exe' : '';
      expect(r.archive.server).toBe(`sd-server${exe}`);
      expect(r.archive.cli).toBe(`sd-cli${exe}`);
      // Nothing is verified before a real computer loads it (X1 part B).
      for (const k of r.verified) expect(r.supports).toContain(k);
    }
    for (const os of ['windows', 'linux']) for (const b of ['VULKAN', 'CPU']) expect(AI_RUNTIMES.runtimes.filter((r) => r.os === os && r.backend === b && r.arch === 'x86_64')).toHaveLength(1);
    for (const l of AI_RUNTIMES.release.licences) expect(l.spdx).toBe('MIT');
  });

  it('supports desktop models only, each with a profile whose files exist', () => {
    for (const r of AI_RUNTIMES.runtimes) {
      for (const key of r.supports) {
        const m = aiModel(key);
        expect(m, key).toBeDefined();
        expect(m!.runtimes).toContain('desktop');
        const p = AI_RUNTIMES.profiles[m!.family];
        expect(p, m!.family).toBeDefined();
        const refs = [...p.load, ...Object.values(p.controls).flatMap((c) => c.load)].filter((a) => a.startsWith('@'));
        for (const ref of refs) {
          const [role, hint = ''] = ref.slice(1).split('~');
          expect(m!.files.filter((f) => f.role === role && f.name.includes(hint)), `${key} ${ref}`).toHaveLength(1);
        }
      }
    }
    // The web-only model is not one the desktop runtimes load.
    expect(AI_RUNTIMES.runtimes.some((r) => r.supports.includes('ZIMAGE_WEB'))).toBe(false);
    expect(AI_MODELS.models.filter((m) => m.runtimes.includes('desktop')).every((m) => AI_RUNTIMES.runtimes.every((r) => r.supports.includes(m.key)))).toBe(true);
  });
});

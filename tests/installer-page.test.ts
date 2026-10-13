// The installer's AI models page (packaging/windows/models-page.nsh) as the page of the application sees its output, phase
// U10: NSIS cannot run here (nor under Wine), so the script is read as text. What it reads from hw.ini and what it writes
// to pending-models.json are checked against the launcher in Rust (engine/crates/rt-app/tests/installer.rs); here, the
// words of the new check box in both languages, and the line the page writes, as the interface will read it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_RUNTIMES } from '../src/data/ai-runtimes';
import { chooseRuntime } from '../src/core/ai-runtimes';

const PAGE = readFileSync('packaging/windows/models-page.nsh', 'utf8');

const langStrings = (): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const m of PAGE.matchAll(/^LangString (\w+) \$\{LANG_(ENGLISH|SPANISH)\} "(.*)"$/gm)) {
    const langs = out.get(m[1]) ?? new Set<string>();
    langs.add(m[2]);
    out.set(m[1], langs);
  }
  return out;
};

describe('the installer page’s words', () => {
  it('every string of the page exists in English and in Spanish, the runtime’s included', () => {
    const all = langStrings();
    expect(all.size).toBeGreaterThan(12);
    for (const [name, langs] of all) expect([...langs].sort(), name).toEqual(['ENGLISH', 'SPANISH']);
    for (const name of ['RuntimeLabel', 'RuntimeGpu', 'RuntimeCpu', 'RuntimeNone']) expect(all.has(name), name).toBe(true);
  });

  it('the runtime says what it is for and which build it is, in the words of Settings', () => {
    const text = (name: string, lang: string) => new RegExp(`^LangString ${name} \\$\\{LANG_${lang}\\} "(.*)"$`, 'm').exec(PAGE)![1];
    expect(text('RuntimeLabel', 'ENGLISH')).toBe('Inference runtime for the models');
    expect(text('RuntimeLabel', 'SPANISH')).toBe('Motor de ejecución de los modelos');
    expect(text('RuntimeGpu', 'ENGLISH')).toMatch(/Vulkan/);
    expect(text('RuntimeCpu', 'ENGLISH')).toMatch(/CPU/);
    // No word of the browser in a desktop installer.
    expect(PAGE).not.toMatch(/browser|navegador/i);
  });
});

/** The line `FileWrite` puts in pending-models.json, with the script's variables filled as the script fills them. */
function line(device: string, keys: string, tail: string): string {
  const row = PAGE.split('\n').find((l) => l.includes('FileWrite $0') && l.includes('"device"'))!;
  return row.split("'")[1].replace('$6', device).replace('$5', keys).replace('$9', tail).replace('$\\r$\\n', '\r\n');
}

describe('the line the page writes, as the application reads it', () => {
  it('with models and the runtime ticked it carries the runtime’s key; unticked or with no model it does not', () => {
    const tailOf = (key: string) => PAGE.split('\n').find((l) => l.includes("StrCpy $9 '"))!.split("'")[1].replace('$RtKey', key);
    const ticked = JSON.parse(line('gpu', '"ZIMAGE_Q8", "SD15_LIGHT"', tailOf('SDCPP_WIN_VULKAN')));
    expect(ticked).toEqual({ device: 'gpu', keys: ['ZIMAGE_Q8', 'SD15_LIGHT'], runtime: 'SDCPP_WIN_VULKAN' });
    expect(JSON.parse(line('cpu', '"SD15_LIGHT"', ''))).toEqual({ device: 'cpu', keys: ['SD15_LIGHT'] });
    expect(JSON.parse(line('cpu', '', ''))).toEqual({ device: 'cpu', keys: [] });
  });

  it('the keys it can write are the builds of the catalogue, the ones the application’s own rule chooses between', () => {
    const windows = AI_RUNTIMES.runtimes.filter((r) => r.os === 'windows' && r.arch === 'x86_64');
    expect(windows.map((r) => r.backend).sort()).toEqual(['CPU', 'VULKAN']);
    // With a graphics card to use: Vulkan; without: the processor build (the rule of src/core/ai-runtimes.ts, the launcher’s too).
    expect(chooseRuntime({ os: 'windows', arch: 'x86_64', gpu: true, force: null })?.key).toBe('SDCPP_WIN_VULKAN');
    expect(chooseRuntime({ os: 'windows', arch: 'x86_64', gpu: false, force: null })?.key).toBe('SDCPP_WIN_CPU');
    expect(PAGE).toContain('"runtime"');
  });
});

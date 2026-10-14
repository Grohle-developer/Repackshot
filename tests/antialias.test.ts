// Phase E11, the smoothing of edges (Settings ▸ Render engine ▸ Edge smoothing): two lists, each from the cheapest to
// the costliest, global settings (not of a project); what each choice asks of the engine (RNDR.pixel_filter and
// RNDR.edge_supersample) and of the preview (its multisampling); the launcher's engine (render/native.ts) sending them
// with its views and finals. The pool's engine is in tests/pathtracer.test.ts, the RSB bytes in tests/rsb.test.ts,
// the filters and the edges themselves in rt-core (pixel_filter.rs) and the module in rt-wasm.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FAST_AA,
  DEFAULT_PIXEL_FILTER,
  FAST_AA,
  FILTER_BLACKMAN_HARRIS,
  FILTER_NONE,
  FILTER_STANDARD,
  FILTER_TENT,
  msaaInUse,
  msaaSamples,
  PIXEL_FILTERS,
  pixelFilterFields,
  pixelFilterSetting,
} from '../src/core/antialias';
import { defaultSettings, settingMeta, SETTING_ROWS, validateValue, validateSettings } from '../src/core/settings';
import { createInitialState, type ProjectState } from '../src/core/store';
import { projectScene, writeRsb } from '../src/io/rsb';
import { NativeEngine } from '../src/render/native';
import type { SceneSource, TracerView } from '../src/render/pathtracer';
import { setLang, STRINGS } from '../src/ui/strings';
import { installDom, LauncherMock, viewBytes } from './launcher-mock';
import { exampleState } from './helpers';
import { sections } from './rsb-reader';
import { fnv1a, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

afterEach(() => setLang('en'));

describe('the two lists, cheapest first', () => {
  it('Fast mode: None · MSAA 2× · 4× · 8×, 4× by default, capped by the device', () => {
    expect(FAST_AA).toEqual(['NONE', 'MSAA2', 'MSAA4', 'MSAA8']);
    expect(FAST_AA.map(msaaSamples)).toEqual([0, 2, 4, 8]);
    expect(DEFAULT_FAST_AA).toBe('MSAA4');
    expect([msaaInUse(8, 4), msaaInUse(2, 4), msaaInUse(0, 16), msaaInUse(4, 0)]).toEqual([4, 2, 0, 0]);
  });

  it('Full mode and render: None, Standard, Soft, Fine (the default), Fine + edges ×2 and ×4, as the engine’s fields', () => {
    expect(PIXEL_FILTERS).toEqual(['NONE', 'STANDARD', 'SOFT', 'FINE', 'FINE_EDGES2', 'FINE_EDGES4']);
    // The factory choice is Fine: the same rays as Standard (the engine's own default, without the field, is the box).
    expect(DEFAULT_PIXEL_FILTER).toBe('FINE');
    expect(PIXEL_FILTERS.map((s) => pixelFilterFields(s))).toEqual([
      { pixelFilter: FILTER_NONE, edgeSupersample: 1 },
      { pixelFilter: FILTER_STANDARD, edgeSupersample: 1 },
      { pixelFilter: FILTER_TENT, edgeSupersample: 1 },
      { pixelFilter: FILTER_BLACKMAN_HARRIS, edgeSupersample: 1 },
      { pixelFilter: FILTER_BLACKMAN_HARRIS, edgeSupersample: 2 },
      { pixelFilter: FILTER_BLACKMAN_HARRIS, edgeSupersample: 4 },
    ]);
    // rt_core::pixel_filter's numbers; the standard one is 0, what a file of before means.
    expect([FILTER_STANDARD, FILTER_NONE, FILTER_TENT, FILTER_BLACKMAN_HARRIS]).toEqual([0, 1, 2, 3]);
    // And back, for the meter: the choice the engine's fields are, or none.
    for (const s of PIXEL_FILTERS) expect(pixelFilterSetting(pixelFilterFields(s))).toBe(s);
    expect(pixelFilterSetting({ pixelFilter: 2, edgeSupersample: 4 })).toBeNull();
    // An unknown choice (a settings file of a later version): the standard filter.
    expect(pixelFilterFields('GAUSS' as never)).toEqual({ pixelFilter: 0, edgeSupersample: 1 });
  });
});

describe('the settings (global, kept with the others: settings.json on the desktop)', () => {
  it('have their factory values, are checked when read, and live in Render engine ▸ Edge smoothing', () => {
    const d = defaultSettings();
    expect([d['engine.fastAa'], d['engine.pixelFilter']]).toEqual(['MSAA4', 'FINE']);
    expect(validateValue('engine.pixelFilter', 'FINE_EDGES4')).toBe('FINE_EDGES4');
    expect(validateValue('engine.pixelFilter', 'GAUSS')).toBeNull();
    expect(validateValue('engine.fastAa', 'MSAA16')).toBeNull();
    const read = validateSettings({ 'engine.fastAa': 'MSAA8', 'engine.pixelFilter': 'nope' });
    expect([read['engine.fastAa'], read['engine.pixelFilter']]).toEqual(['MSAA8', 'FINE']);
    // A choice stored before is kept.
    expect(validateSettings({ 'engine.pixelFilter': 'STANDARD' })['engine.pixelFilter']).toBe('STANDARD');
    for (const key of ['engine.fastAa', 'engine.pixelFilter'] as const) {
      const meta = settingMeta(key);
      expect([meta.section, meta.block]).toEqual(['engine', 'antialias']);
      expect(meta.control).toMatchObject({ kind: 'choice', options: key === 'engine.fastAa' ? FAST_AA : PIXEL_FILTERS });
    }
    // Fast mode's list comes first, then the engine's: in the order of the window.
    const rows = SETTING_ROWS.filter((r) => r.block === 'antialias').map((r) => r.id);
    expect(rows).toEqual(['engine.fastAa', 'engine.pixelFilter']);
  });

  it('every label, help line and the meter’s words exist in English and Spanish, with no cost in numbers', () => {
    const keys = [
      'set.block.antialias',
      'set.engine.fastAa',
      'set.engine.fastAa.aux',
      ...FAST_AA.map((o) => `set.engine.fastAa.${o}`),
      'set.engine.fastAa.device',
      'set.engine.fastAa.noDevice',
      'set.engine.fastAa.over',
      'set.engine.pixelFilter',
      'set.engine.pixelFilter.aux',
      ...PIXEL_FILTERS.map((o) => `set.engine.pixelFilter.${o}`),
      ...PIXEL_FILTERS.map((o) => `set.engine.pixelFilter.help.${o}`),
      'viewport.meterFilter',
      'viewport.meterMsaa',
      'viewport.meterNoMsaa',
    ];
    const table = (k: string): [string, string] => [(STRINGS.en as Record<string, string>)[k], (STRINGS.es as Record<string, string>)[k]];
    for (const k of keys) {
      const [en, es] = table(k);
      expect(en !== undefined && es !== undefined, k).toBe(true);
      expect(en.length > 0 && es.length > 0, k).toBe(true);
      // Rule 10: the order and a line of help, never a percentage nobody measured.
      expect(/%|\bms\b|\bx\d/.test(en + es), k).toBe(false);
    }
    expect(table('set.engine.pixelFilter.FINE_EDGES2')).toEqual(['Fine + edges ×2', 'Fino + bordes ×2']);
    expect(table('set.engine.pixelFilter.STANDARD')).toEqual(['Standard', 'Estándar']);
  });
});

describe('the launcher’s engine sends the filter with its views and finals', () => {
  let restore: (() => void) | null = null;
  const engines: NativeEngine[] = [];
  beforeEach(() => {
    restore = installDom().restore;
  });
  afterEach(() => {
    engines.splice(0).forEach((e) => e.setActive(false));
    restore?.();
  });

  /** A source that records the views, whose bytes say the filter (another filter, another scene). */
  function source(views: TracerView[]): SceneSource {
    return {
      build: (_s, view) => {
        views.push(view);
        return { meshKey: 'm', bytes: (meshes) => viewBytes(view.width, view.height, meshes, 1 + (view.pixelFilter ?? 0) * 16 + (view.edgeSupersample ?? 1)) };
      },
      tone: () => ({ exposureEv: 0, tonemap: 1 }),
    };
  }

  async function until(engine: NativeEngine, cond: () => boolean, ms = 10000): Promise<boolean> {
    const end = performance.now() + ms;
    while (!cond()) {
      if (performance.now() > end) return false;
      engine.frame();
      await new Promise((r) => setTimeout(r, 3));
    }
    return true;
  }

  it('the view starts over with the new filter, its gestures leave out the edge samples, and the status says it', async () => {
    const launcher = new LauncherMock();
    const views: TracerView[] = [];
    const engine = new NativeEngine({ request: launcher.request }, source(views), { threads: 8, isa: 'avx2' });
    engines.push(engine);
    const dom = installDom();
    engine.mount(dom.canvas as unknown as HTMLCanvasElement);
    const state: ProjectState = createInitialState({ lang: 'en', theme: 'dark' });
    engine.sync(state, null);
    engine.resize(8, 6, 1);
    engine.setActive(true);
    const posts = () => launcher.log.filter((l) => l.startsWith('POST /api/render?'));
    expect(await until(engine, () => (engine.status().passes ?? 0) >= 2)).toBe(true);
    // Before Settings says anything: the factory choice, Fine.
    expect(views.at(-1)).toMatchObject({ pixelFilter: FILTER_BLACKMAN_HARRIS, edgeSupersample: 1 });
    expect(engine.status().pixelFilter).toEqual({ pixelFilter: FILTER_BLACKMAN_HARRIS, edgeSupersample: 1 });
    // Standard: the status says the box.
    const first = posts().length;
    engine.setPixelFilter('STANDARD');
    expect(await until(engine, () => posts().length > first && engine.status().pixelFilter?.pixelFilter === 0 && (engine.status().passes ?? 0) >= 1)).toBe(true);
    expect(engine.status().pixelFilter).toEqual({ pixelFilter: 0, edgeSupersample: 1 });
    expect(views.at(-1)).toMatchObject({ pixelFilter: 0, edgeSupersample: 1 });
    const before = posts().length;
    engine.setPixelFilter('FINE_EDGES2');
    expect(await until(engine, () => posts().length > before && (engine.status().pixelFilter?.edgeSupersample ?? 0) === 2)).toBe(true);
    expect(views.at(-1)).toMatchObject({ pixelFilter: FILTER_BLACKMAN_HARRIS, edgeSupersample: 2 });
    expect(engine.status().pixelFilter).toEqual({ pixelFilter: FILTER_BLACKMAN_HARRIS, edgeSupersample: 2 });
    // The same choice again changes nothing.
    const now = posts().length;
    engine.setPixelFilter('FINE_EDGES2');
    for (let i = 0; i < 20; i++) {
      engine.frame();
      await new Promise((r) => setTimeout(r, 3));
    }
    expect(posts().length).toBe(now);
    // A gesture's reduced frames: the filter, without the edge samples.
    engine.beginGesture();
    engine.gestureView({ azimuth: 1 });
    expect(await until(engine, () => views.some((v) => (v.width < 8 || v.height < 6) && v.pixelFilter === FILTER_BLACKMAN_HARRIS))).toBe(true);
    const reduced = views.filter((v) => v.width < 8 || v.height < 6);
    expect(reduced.every((v) => v.edgeSupersample === 1)).toBe(true);
    engine.endGesture();
  });

  it('a final carries the filter in force', async () => {
    const views: TracerView[] = [];
    const width = 2;
    const height = 1;
    const launcher = new LauncherMock();
    launcher.viewportSamples = 1;
    const engine = new NativeEngine({ request: launcher.request }, source(views), { threads: 4, isa: 'avx2' });
    engines.push(engine);
    engine.sync(createInitialState({ lang: 'en', theme: 'dark' }), null);
    engine.setPixelFilter('SOFT');
    await engine.renderPixels({ width, height, maxSamples: 2, maxSeconds: 0, transparent: false }).catch(() => undefined);
    expect(views[0]).toMatchObject({ width, height, pixelFilter: FILTER_TENT, edgeSupersample: 1 });
  });
});

const live = RT_WASM ? describe : describe.skip;

live('the real rt.wasm through the page’s code', () => {
  it('renders the example with the fine filter and twice the samples on its edges to rt-core’s pinned image', async () => {
    // The example's RSB (tests/fixtures/example.rsb) with RNDR.pixel_filter 3 and edge_supersample 2: the E11 parity
    // scene (rt_core::example::e11_scene), tile by tile as the pool renders it; each tile finds its edges in the module.
    const { loadRt } = await import('./wasm-engine');
    const rt = await loadRt();
    const rsb = new Uint8Array(readFileSync('tests/fixtures/example.rsb'));
    const rndr = sections(rsb).find((x) => x.tag === 'RNDR')!.payload;
    expect([rndr.byteLength, rndr.getUint32(56, true), rndr.getUint32(60, true)]).toEqual([64, 0, 1]);
    const plain = renderWithPasses(rt, rsb, 512, 384, 4, 0).image;
    expect(fnv1a(resolveRgb(plain, 4))).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_EXAMPLE_4SPP'));
    rndr.setUint32(56, FILTER_BLACKMAN_HARRIS, true);
    rndr.setUint32(60, 2, true);
    const { image } = renderWithPasses(rt, rsb, 512, 384, 4, 0);
    expect(fnv1a(resolveRgb(image, 4))).toBe(pinned('engine/crates/rt-core/src/render.rs', 'PINNED_E11_EDGES_4SPP'));
  }, 240_000);
});

// tools/aa-sheet.mjs asks for the scene of its sheet: the example bottle as the page sends it to the engine.
describe.runIf(!!process.env.REPACK_AA_SHEET)('the scene of out/aa-sheet.html', () => {
  it('writes the example bottle as the engine’s scene', () => {
    const path = process.env.REPACK_AA_SHEET!;
    const state = exampleState();
    const { scene } = projectScene(state, { width: 960, height: 540, maxSamples: 64, maxSeconds: 0 });
    mkdirSync(path.slice(0, Math.max(0, path.lastIndexOf('/'))) || '.', { recursive: true });
    writeFileSync(path, writeRsb(scene));
    expect(readFileSync(path).length).toBeGreaterThan(1000);
  });
});

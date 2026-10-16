// The window of a lens's elements (phase O2b, the triage's 1.4): what it asks the engine, what it keeps, when it opens
// and closes, and what its cards say. The logic is in ui/lens-peek.ts (no DOM); the window itself and the list it
// opens from are tried in a browser by tests/lens-peek-browser.test.ts. With the real rt.wasm the cards are checked
// against the engine's own numbers for lenses that are not on the camera.

import { describe, expect, it } from 'vitest';
import { makeCamera, type CameraState } from '../src/core/camera';
import { OPTICS_NEUTRAL, type CameraOptics } from '../src/core/optics';
import { newTracedLens, type TracedLens } from '../src/core/traced-lens';
import { lensPrescription } from '../src/data/lenses';
import { lensInfoRsb } from '../src/io/rsb';
import { hasLensInfoExport, readLensInfo } from '../src/render/lens-info';
import { placePeek } from '../src/ui/components/lens-peek';
import { createPeekController, lensPeekCache, lensSourceLine, peekCamera, peekCard, PEEK_CACHE_SIZE, PEEK_DELAY_MS, type PeekAnswer, type PeekTimers } from '../src/ui/lens-peek';
import type { LensPort } from '../src/ui/ports';
import { setLang } from '../src/ui/strings';
import { fakeInfo, fakePort } from './browser/lens-peek-fake';
import { loadRt, RT_WASM } from './wasm-engine';

const traced = (key: string, patch: Partial<TracedLens> = {}): CameraOptics => ({ ...OPTICS_NEUTRAL, traced: { ...newTracedLens(key), ...patch } });
const camera = (optics: CameraOptics = OPTICS_NEUTRAL, patch: Partial<CameraState> = {}): CameraState => ({ ...makeCamera('cam1', '', 200), optics, focalMm: 50, fstop: 5.6, focusDistance: 2000, ...patch });

describe('the camera the engine is asked about', () => {
  it('is the camera with the hovered lens on it, as choosing it would leave it', () => {
    const cam = camera(traced('double_gauss_normal', { coating: 'single', distortion: 0.3 }), { focalMm: 85, fstop: 2, focusDistance: 1500 });
    const asked = peekCamera(cam, 'fisheye_180');
    expect(asked.optics?.traced).toEqual(newTracedLens('fisheye_180'));
    expect([asked.focalMm, asked.fstop, asked.focusDistance, asked.aspect, asked.projection]).toEqual([85, 2, 1500, cam.aspect, cam.projection]);
    // The lens on the camera is asked with the settings it has: the section below the list is drawn from them.
    expect(peekCamera(cam, 'double_gauss_normal')).toBe(cam);
    // From the thin lens, and without the bokeh type that belonged to the other lens.
    expect(peekCamera(camera(OPTICS_NEUTRAL), 'triplet').optics?.traced?.key).toBe('triplet');
    expect(peekCamera(camera({ ...traced('double_gauss_fast'), bokeh: 'coma_comet', variant: 'a' }), 'triplet').optics).toMatchObject({ bokeh: null, variant: null });
  });
});

describe('the answers of the engine, kept per lens and per what they depend on', () => {
  it('asks the engine once for a lens, however many times it is hovered', async () => {
    const f = fakePort();
    const cache = lensPeekCache(f.port);
    const cam = camera(traced('double_gauss_normal'));
    const first = await cache.load(cam, 'petzval_portrait');
    expect(first).toEqual({ state: 'ready', info: fakeInfo(peekCamera(cam, 'petzval_portrait')) });
    expect(f.asked.map((c) => c.optics!.traced!.key)).toEqual(['petzval_portrait']);
    expect(cache.known(cam, 'petzval_portrait')).toBe(first);
    expect(await cache.load(cam, 'petzval_portrait')).toBe(first);
    expect(f.asked).toHaveLength(1);
    // Another lens is another question.
    await cache.load(cam, 'triplet');
    expect(f.asked).toHaveLength(2);
    // The cache belongs to the port: one the page makes again for the same port is the same.
    expect(lensPeekCache(f.port)).toBe(cache);
    expect(lensPeekCache(fakePort().port)).not.toBe(cache);
  });

  it('shares a question already on its way', async () => {
    const f = fakePort();
    f.mode = 'hold';
    const cache = lensPeekCache(f.port);
    const cam = camera(traced('double_gauss_normal'));
    const a = cache.load(cam, 'triplet');
    const b = cache.load(cam, 'triplet');
    expect(f.asked).toHaveLength(1);
    expect(cache.known(cam, 'triplet')).toBeUndefined();
    f.release();
    expect(await a).toBe(await b);
    expect(cache.known(cam, 'triplet')?.state).toBe('ready');
  });

  it('asks again when what the numbers depend on changes: the focal length, the focus, the f-number, the frame, the lens’s settings', async () => {
    const f = fakePort();
    const cache = lensPeekCache(f.port);
    const base = camera(traced('double_gauss_normal'));
    await cache.load(base, 'triplet');
    for (const patch of [{ focalMm: 85 }, { focusDistance: 800 }, { fstop: 2 }, { aspect: { ...base.aspect, w: base.aspect.w + 1 } }, { projection: 'ORTHOGRAPHIC' as const }]) {
      const n = f.asked.length;
      await cache.load({ ...base, ...patch }, 'triplet');
      expect(f.asked.length, JSON.stringify(patch)).toBe(n + 1);
    }
    // Hovering the lens on the camera depends on its settings (a coating, a master behind an adapter).
    const n = f.asked.length;
    await cache.load(camera(traced('anamorphic_adapter_2x')), 'anamorphic_adapter_2x');
    await cache.load(camera(traced('anamorphic_adapter_2x', { master: 'triplet' })), 'anamorphic_adapter_2x');
    expect(f.asked.length).toBe(n + 2);
    // And the same question again is not asked.
    await cache.load({ ...base, focalMm: 85 }, 'triplet');
    expect(f.asked.length).toBe(n + 2);
  });

  it('keeps the refusal, but neither a missing engine nor a failed question', async () => {
    let mode: 'refuse' | 'none' | 'fail' | 'ok' = 'refuse';
    const asked: string[] = [];
    const port: LensPort = {
      info(cam) {
        asked.push(mode);
        if (mode === 'fail') return Promise.reject(new Error('boom'));
        return Promise.resolve(mode === 'refuse' ? undefined : mode === 'none' ? null : fakeInfo(cam));
      },
    };
    const cache = lensPeekCache(port);
    const cam = camera(traced('double_gauss_normal'));
    expect(await cache.load(cam, 'triplet')).toEqual({ state: 'refused' });
    expect(await cache.load(cam, 'triplet')).toEqual({ state: 'refused' });
    expect(asked).toEqual(['refuse']);
    // No engine: asked again next time, and then answered.
    mode = 'none';
    expect(await cache.load(cam, 'meniscus_single')).toEqual({ state: 'none' });
    mode = 'fail';
    expect(await cache.load(cam, 'meniscus_single')).toEqual({ state: 'none' });
    mode = 'ok';
    expect((await cache.load(cam, 'meniscus_single')).state).toBe('ready');
    expect(asked).toEqual(['refuse', 'none', 'fail', 'ok']);
    // A port that throws instead of rejecting is the same.
    const throwing = lensPeekCache({
      info() {
        throw new Error('sync');
      },
    });
    expect(await throwing.load(cam, 'triplet')).toEqual({ state: 'none' });
  });

  it('keeps a bounded number of answers', async () => {
    const f = fakePort();
    const cache = lensPeekCache(f.port);
    for (let focal = 20; focal < 20 + PEEK_CACHE_SIZE + 4; focal++) await cache.load(camera(OPTICS_NEUTRAL, { focalMm: focal }), 'triplet');
    expect(cache.known(camera(OPTICS_NEUTRAL, { focalMm: 20 }), 'triplet')).toBeUndefined();
    expect(cache.known(camera(OPTICS_NEUTRAL, { focalMm: 20 + PEEK_CACHE_SIZE + 3 }), 'triplet')?.state).toBe('ready');
  });
});

/** Timers the test moves by hand. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const timers: PeekTimers = {
    set(fn, ms) {
      const id = next++;
      queue.set(id, { at: now + ms, fn });
      return id;
    },
    clear(handle) {
      queue.delete(handle as number);
    },
  };
  return {
    timers,
    pending: () => queue.size,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && queue.delete(id)) t.fn();
      }
    },
  };
}

describe('when the window opens and closes', () => {
  const make = () => {
    const clock = fakeTimers();
    const log: string[] = [];
    const c = createPeekController<string>({ timers: clock.timers, onOpen: (t) => log.push(`open ${t}`), onClose: (t) => log.push(`close ${t}`) });
    return { clock, log, c };
  };

  it('opens after the pointer has rested, not before', () => {
    const { clock, log, c } = make();
    c.enter('a');
    clock.advance(PEEK_DELAY_MS - 1);
    expect(log).toEqual([]);
    expect(c.open).toBeNull();
    clock.advance(1);
    expect(log).toEqual(['open a']);
    expect(c.open).toBe('a');
    expect(PEEK_DELAY_MS).toBeGreaterThanOrEqual(200);
    expect(PEEK_DELAY_MS).toBeLessThanOrEqual(500);
  });

  it('opens nothing for a pointer that crosses the list', () => {
    const { clock, log, c } = make();
    for (const t of ['a', 'b', 'c', 'd']) {
      c.enter(t);
      clock.advance(PEEK_DELAY_MS / 3);
      c.leave(t);
    }
    clock.advance(PEEK_DELAY_MS * 2);
    expect(log).toEqual([]);
    expect(clock.pending()).toBe(0);
    // Moving on to the next entry without a leave in between (the focus does) also starts the wait again.
    c.enter('a');
    clock.advance(PEEK_DELAY_MS - 10);
    c.enter('b');
    clock.advance(PEEK_DELAY_MS - 10);
    expect(log).toEqual([]);
    clock.advance(10);
    expect(log).toEqual(['open b']);
  });

  it('closes when the pointer or the focus leaves, and shows another entry only after its own rest', () => {
    const { clock, log, c } = make();
    c.enter('a');
    clock.advance(PEEK_DELAY_MS);
    c.leave('b');
    expect(c.open).toBe('a');
    c.enter('b');
    expect(log).toEqual(['open a', 'close a']);
    clock.advance(PEEK_DELAY_MS);
    expect(log).toEqual(['open a', 'close a', 'open b']);
    c.leave('b');
    expect(log.at(-1)).toBe('close b');
    expect(c.open).toBeNull();
  });

  it('keeps the wait of an entry it is already waiting on, and does not open one twice', () => {
    const { clock, log, c } = make();
    c.enter('a');
    clock.advance(PEEK_DELAY_MS - 50);
    c.enter('a');
    clock.advance(50);
    expect(log).toEqual(['open a']);
    c.enter('a');
    clock.advance(PEEK_DELAY_MS * 2);
    expect(log).toEqual(['open a']);
  });

  it('is shut by Escape or by choosing, and stays shut until the pointer or the focus comes back', () => {
    const { clock, log, c } = make();
    c.enter('a');
    clock.advance(PEEK_DELAY_MS);
    c.dismiss();
    expect(log).toEqual(['open a', 'close a']);
    clock.advance(PEEK_DELAY_MS * 3);
    expect(log).toEqual(['open a', 'close a']);
    // Dismissed while still waiting: it never opens.
    c.leave('a');
    c.enter('a');
    clock.advance(PEEK_DELAY_MS / 2);
    c.dismiss();
    clock.advance(PEEK_DELAY_MS * 2);
    expect(log).toEqual(['open a', 'close a']);
    expect(clock.pending()).toBe(0);
    c.enter('a');
    clock.advance(PEEK_DELAY_MS);
    expect(log.at(-1)).toBe('open a');
  });
});

describe('what a card says', () => {
  const cam = camera(traced('double_gauss_normal'), { focalMm: 50, fstop: 5.6 });

  it('is the lens’s name, its source and the engine’s numbers for that lens, with the section drawn from the engine’s section', () => {
    setLang('en');
    const key = 'petzval_portrait';
    const answer: PeekAnswer = { state: 'ready', info: fakeInfo(peekCamera(cam, key)) };
    const card = peekCard(cam, key, answer)!;
    const p = lensPrescription(key)!;
    const i = answer.state === 'ready' ? answer.info : null!;
    expect(card.key).toBe(key);
    expect(card.name).toBe('Petzval portrait');
    expect(card.source).toBe(lensSourceLine(p));
    expect(card.source).toContain(p.source.doc);
    expect(card.state).toBe('ready');
    expect(card.note).toBeNull();
    expect(card.numbers.map((r) => [r.id, r.label])).toEqual([
      ['camera.lensInfoFocal', 'Focal length'],
      ['camera.lensInfoStop', 'Aperture'],
      ['camera.lensInfoElements', 'Elements · groups'],
      ['camera.lensInfoLength', 'Length'],
    ]);
    expect(card.numbers.map((r) => r.value)).toEqual(['50 mm', `f/5.6 · T${(5.6 * 1.1).toFixed(2).replace(/0$/, '')}`, `${i.elements} · ${i.groups}`, `${i.lengthMm} mm`]);
    // The drawing is the one of the section: glass, the iris and the sensor.
    expect(card.figure).toContain('<svg');
    expect(card.figure).toContain('fill-opacity="0.16"');
    expect(card.figure).toContain('<title>Petzval portrait</title>');
  });

  it('differs from lens to lens only by what the engine said of each', () => {
    setLang('en');
    const a = peekCard(cam, 'triplet', { state: 'ready', info: fakeInfo(peekCamera(cam, 'triplet')) })!;
    const b = peekCard(cam, 'fisheye_180', { state: 'ready', info: fakeInfo(peekCamera(cam, 'fisheye_180')) })!;
    expect(a.name).not.toBe(b.name);
    expect(a.numbers.find((r) => r.id === 'camera.lensInfoElements')!.value).not.toBe(b.numbers.find((r) => r.id === 'camera.lensInfoElements')!.value);
    // An adapter adds the squeeze the engine traced.
    const ana = peekCard(cam, 'anamorphic_adapter_2x', { state: 'ready', info: fakeInfo(peekCamera(cam, 'anamorphic_adapter_2x')) })!;
    expect(ana.numbers.at(-1)).toMatchObject({ id: 'camera.lensInfoSqueeze', value: '1.96×' });
    expect(a.numbers.some((r) => r.id === 'camera.lensInfoSqueeze')).toBe(false);
  });

  it('says it is asking while the engine has not answered, with no numbers and no drawing', () => {
    setLang('en');
    const card = peekCard(cam, 'triplet', undefined)!;
    expect(card).toMatchObject({ state: 'loading', numbers: [], figure: null, note: 'Asking the engine…' });
    expect(card.name).toBe('Triplet');
    expect(card.source).not.toBe('');
  });

  it('has only the name and the source, and says so, when there is no engine (rule 10: no numbers of its own)', () => {
    setLang('en');
    const card = peekCard(cam, 'triplet', { state: 'none' })!;
    expect(card).toMatchObject({ state: 'none', numbers: [], figure: null });
    expect(card.note).toBe('The engine is not loaded: no section or numbers for this lens');
    expect(card.name).toBe('Triplet');
    expect(card.source).toBe(lensSourceLine(lensPrescription('triplet')!));
  });

  it('says when the engine forms no image with the lens', () => {
    setLang('en');
    expect(peekCard(cam, 'triplet', { state: 'refused' })).toMatchObject({ state: 'refused', numbers: [], figure: null, note: 'The engine forms no image with this lens and these settings' });
  });

  it('is in the language of the interface, and none for a key the catalogue does not have', () => {
    setLang('es');
    const card = peekCard(cam, 'triplet', undefined)!;
    expect(card.name).toBe('Triplete');
    expect(card.note).toBe('Preguntando al motor…');
    expect(peekCard(cam, 'triplet', { state: 'none' })!.note).toBe('El motor no está cargado: sin corte ni números para esta lente');
    const ready = peekCard(cam, 'triplet', { state: 'ready', info: fakeInfo(peekCamera(cam, 'triplet')) })!;
    expect(ready.numbers.map((r) => r.label)).toEqual(['Focal', 'Diafragma', 'Elementos · grupos', 'Longitud']);
    expect(ready.source).toMatch(/comprobada|pendiente|diseño propio/);
    expect(peekCard(cam, 'no_such_lens', undefined)).toBeNull();
    setLang('en');
  });
});

describe('where the window goes', () => {
  const view = { width: 1600, height: 900 };
  const box = { width: 240, height: 200 };
  const rect = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

  it('is beside the list on the side with room, level with the entry', () => {
    // The inspector on the right: the window on its left.
    const at = placePeek(box, rect(1300, 300, 280, 28), rect(1260, 200, 340, 400), view);
    expect(at.left + box.width).toBeLessThanOrEqual(1260);
    expect(at.top).toBeCloseTo(300 - 6, 0);
    // A list at the left edge: on its right.
    const right = placePeek(box, rect(20, 300, 280, 28), rect(10, 200, 300, 400), view);
    expect(right.left).toBeGreaterThanOrEqual(310);
  });

  it('stays inside the viewport at any size', () => {
    for (const v of [{ width: 1600, height: 900 }, { width: 700, height: 420 }, { width: 330, height: 260 }]) {
      for (const item of [rect(v.width - 300, 2, 280, 28), rect(v.width - 300, v.height - 30, 280, 28), rect(4, v.height / 2, 200, 28)]) {
        const at = placePeek(box, item, rect(Math.max(0, item.left - 8), 0, 300, v.height), v);
        expect(at.left, JSON.stringify([v, item])).toBeGreaterThanOrEqual(8);
        expect(at.top).toBeGreaterThanOrEqual(8);
        expect(at.left + box.width).toBeLessThanOrEqual(Math.max(v.width - 8, box.width + 8));
        expect(at.top + box.height).toBeLessThanOrEqual(Math.max(v.height - 8, box.height + 8));
      }
    }
  });
});

describe.skipIf(!RT_WASM)('with the real engine', () => {
  it('shows, for lenses that are not on the camera, the numbers the engine reports for them', async () => {
    setLang('en');
    const rt = await loadRt();
    expect(hasLensInfoExport(rt)).toBe(true);
    if (!hasLensInfoExport(rt)) return;
    let asks = 0;
    const port: LensPort = {
      async info(cam) {
        asks++;
        return cam.optics?.traced ? readLensInfo(rt, lensInfoRsb(cam, cam.aspect.w, cam.aspect.h)) : null;
      },
    };
    const cache = lensPeekCache(port);
    const cam = camera(traced('double_gauss_normal'), { focalMm: 50, fstop: 0, focusDistance: 2000 });
    for (const key of ['petzval_portrait', 'fisheye_180', 'macro_floating', 'anamorphic_adapter_2x']) {
      const answer = await cache.load(cam, key);
      expect(answer.state, key).toBe('ready');
      if (answer.state !== 'ready') continue;
      const card = peekCard(cam, key, answer)!;
      const own = readLensInfo(rt, lensInfoRsb(peekCamera(cam, key), cam.aspect.w, cam.aspect.h))!;
      expect(card.numbers.find((r) => r.id === 'camera.lensInfoElements')!.value, key).toBe(`${own.elements} · ${own.groups}`);
      expect(own.eflMm, key).toBeCloseTo(50, 2);
      expect(card.figure, key).toContain('fill-opacity="0.16"');
    }
    // The Petzval has four elements in three groups, as the engine counts them (the section's own check says six and four for the Gauss).
    const petzval = (await cache.load(cam, 'petzval_portrait')) as Extract<PeekAnswer, { state: 'ready' }>;
    expect([petzval.info.elements, petzval.info.groups]).toEqual([4, 3]);
    expect(asks).toBe(4);
  }, 120000);
});

import { describe, expect, it } from 'vitest';
import { matchResolution } from '../src/core/render';
import { createInitialState, createStore } from '../src/core/store';
import { apply, exampleState } from './helpers';

describe('render settings', () => {
  it('quality tiers set the sample budget; touching it makes it custom', () => {
    let s = apply(exampleState(), { type: 'render/quality', quality: 'FINAL' });
    expect([s.render.quality, s.render.maxSamples]).toEqual(['FINAL', 1024]);
    s = apply(s, { type: 'render/set', patch: { maxSamples: 300 } });
    expect(s.render.quality).toBe('CUSTOM');
  });

  it('formats without alpha switch transparency off', () => {
    let s = apply(exampleState(), { type: 'render/set', patch: { transparent: true } });
    s = apply(s, { type: 'render/set', patch: { format: 'JPEG' } });
    expect(s.render.transparent).toBe(false);
  });

  it('sizes are clamped and matched to presets', () => {
    const s = apply(exampleState(), { type: 'render/set', patch: { width: 99999, height: 3 } });
    expect([s.render.width, s.render.height]).toEqual([8192, 16]);
    expect(matchResolution(1920, 1080)).toBe('HD');
    expect(matchResolution(1000, 1000)).toBe('CUSTOM');
  });

  it('the queue keeps camera, size and quality per job, and is not part of the undo history', () => {
    const store = createStore(createInitialState());
    store.dispatch({ type: 'render/enqueue', name: 'A' });
    store.dispatch({ type: 'render/set', patch: { width: 1080, height: 1350 }, label: 'Size' });
    store.dispatch({ type: 'render/enqueue', name: 'B' });
    const q = store.get().render.queue;
    expect(q.map((j) => [j.name, j.width, j.height, j.status])).toEqual([
      ['A', 1920, 1080, 'QUEUED'],
      ['B', 1080, 1350, 'QUEUED'],
    ]);
    store.undo();
    expect(store.get().render.queue).toHaveLength(2);
    expect(store.get().render.width).toBe(1920);
    store.dispatch({ type: 'render/job', id: q[0].id, patch: { status: 'RUNNING' } });
    store.dispatch({ type: 'render/clearQueue' });
    expect(store.get().render.queue.map((j) => j.name)).toEqual(['A']);
  });
});

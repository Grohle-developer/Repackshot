// The results history (phase U5, UI.md §2.8): eviction by count and size, the in-memory store used
// when the browser keeps nothing, and what a result can be compared with.

import { describe, expect, it } from 'vitest';
import { compareCandidates, evictionPlan, HISTORY_LIMITS, sortResults, type ResultMeta } from '../src/core/results';
import { memoryResultsStore } from '../src/io/results';

const MB = 1024 * 1024;
const meta = (id: string, createdAt: number, bytes = 1, cameraId: string | null = 'cam1'): ResultMeta => ({
  id,
  jobId: 'j1',
  name: `${id}.png`,
  createdAt,
  width: 10,
  height: 10,
  dpi: 300,
  samples: 4,
  seconds: 1,
  cameraId,
  camera: 'Camera 1',
  format: 'PNG',
  bitDepth: 8,
  savedTo: { kind: 'DOWNLOADS' },
  thumb: '',
  bytes,
});

describe('history limits', () => {
  it('default: 50 results or 500 MB', () => {
    expect(HISTORY_LIMITS).toEqual({ count: 50, bytes: 500 * MB });
  });

  it('evicts the oldest first until the count fits', () => {
    const list = Array.from({ length: 53 }, (_, i) => meta(`r${i}`, 1000 + ((i * 7) % 53)));
    const out = evictionPlan(list);
    expect(out).toHaveLength(3);
    const oldest = [...list].sort((a, b) => a.createdAt - b.createdAt).slice(0, 3).map((r) => r.id);
    expect(out).toEqual(oldest);
  });

  it('evicts the oldest first until the size fits', () => {
    const list = [meta('a', 1, 200 * MB), meta('b', 2, 200 * MB), meta('c', 3, 150 * MB), meta('d', 4, 100 * MB)];
    expect(evictionPlan(list)).toEqual(['a']); // 650 → 450 MB
    expect(evictionPlan(list, { count: 50, bytes: 260 * MB })).toEqual(['a', 'b']);
    expect(evictionPlan(list, { count: 2, bytes: 1e12 })).toEqual(['a', 'b']);
    expect(evictionPlan(list.slice(1))).toEqual([]);
  });

  it('never evicts the result just added, even when it alone is over the limit', () => {
    const list = [meta('old', 1, 10 * MB), meta('huge', 2, 600 * MB)];
    expect(evictionPlan(list, HISTORY_LIMITS, 'huge')).toEqual(['old']);
  });

  it('the memory store keeps the limits and measures the blobs itself', async () => {
    const store = memoryResultsStore({ count: 2, bytes: 1000 });
    expect(store.persistent).toBe(false);
    const blob = (n: number) => new Blob([new Uint8Array(n)]);
    expect(await store.add(meta('a', 1, 0), blob(100), null)).toEqual([]);
    expect(await store.add(meta('b', 2, 0), blob(100), blob(50))).toEqual([]);
    expect((await store.list()).map((r) => [r.id, r.bytes])).toEqual([
      ['b', 150],
      ['a', 100],
    ]);
    expect(await store.add(meta('c', 3, 0), blob(100), null)).toEqual(['a']);
    expect(await store.get('a')).toBeNull();
    expect(await store.add(meta('d', 4, 0), blob(950), null)).toEqual(['b', 'c']);
    expect((await store.list()).map((r) => r.id)).toEqual(['d']);
    expect((await store.get('d'))?.file.size).toBe(950);
    await store.remove('d');
    expect(await store.list()).toEqual([]);
    await store.add(meta('e', 5), blob(1), null);
    await store.clear();
    expect(await store.list()).toEqual([]);
    await store.putHandle('f1', { kind: 'directory' });
    expect(await store.getHandle('f1')).toEqual({ kind: 'directory' });
    expect(await store.getHandle('nope')).toBeNull();
  });
});

describe('results order and comparison', () => {
  it('newest first; compare candidates of the same camera first', () => {
    const list = [meta('a', 1, 1, 'cam1'), meta('b', 2, 1, 'cam2'), meta('c', 3, 1, 'cam1'), meta('d', 4, 1, null)];
    expect(sortResults(list).map((r) => r.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(compareCandidates(list, list[2]).map((r) => r.id)).toEqual(['a', 'd', 'b']);
  });
});

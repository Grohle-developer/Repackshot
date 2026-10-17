// What the Doctor knows of the engine (phase D1): the page's own state about it (`ui.engine`, `ui.engineInfo`, the
// engine settings, the speed measured) and what the viewport's engine says of its accumulation (`status().scan`),
// as the `EngineFacts` the checks of core/doctor-engine.ts read. Pure; main.ts hands the result in whenever it changes.

import { VIDEO_AVAILABLE } from '../core/render';
import { setEngineFacts, type EngineFacts } from '../core/doctor-engine';
import type { Store } from '../core/store';
import type { EngineStatus } from './ports';
import { effectiveMode, type UiState, type UiStore } from './ui-state';

/** The video codecs this system can encode: none until N1 builds the encoders. */
export const ENCODABLE_CODECS: EngineFacts['videoCodecs'] = VIDEO_AVAILABLE ? ['MP4', 'WEBM'] : [];

/** The facts for this interface state; `status` is the viewport engine's, or null when the path tracer is not the one on screen. */
export function engineFactsFrom(u: Pick<UiState, 'engine' | 'engineInfo' | 'settings' | 'throughput' | 'viewportMode'>, status: Pick<EngineStatus, 'scan'> | null): EngineFacts {
  const info = u.engineInfo;
  const full = effectiveMode(u) === 'FULL';
  return {
    availability: u.engine,
    backend: info?.backend ?? null,
    workers: info?.workers ?? 0,
    autoWorkers: info?.autoThreads ?? 0,
    cores: info?.cores ?? null,
    simd: info?.simd ?? false,
    simdSupported: info?.simdSupported ?? false,
    simdOff: u.settings['engine.simd'] === 'OFF',
    // An engine that does not say can denoise (the native one always can, rt.wasm says in its workers' first message).
    denoise: info?.denoise ?? true,
    videoCodecs: ENCODABLE_CODECS,
    throughput: u.throughput,
    full,
    scan: full ? (status?.scan ?? null) : null,
  };
}

/** Whether two sets of facts say the same (the scan by identity: the engine hands out the same object until it reads the accumulation again). */
export function sameEngineFacts(a: EngineFacts, b: EngineFacts): boolean {
  return (
    a.availability === b.availability &&
    a.backend === b.backend &&
    a.workers === b.workers &&
    a.autoWorkers === b.autoWorkers &&
    a.cores === b.cores &&
    a.simd === b.simd &&
    a.simdSupported === b.simdSupported &&
    a.simdOff === b.simdOff &&
    a.denoise === b.denoise &&
    a.videoCodecs.length === b.videoCodecs.length &&
    a.videoCodecs.every((c, i) => c === b.videoCodecs[i]) &&
    a.throughput === b.throughput &&
    a.full === b.full &&
    a.scan === b.scan
  );
}

/**
 * Keeps the Doctor told of the engine: builds the facts from the interface state and the viewport engine's
 * status, hands them in (`setEngineFacts`) and asks the store to run the Doctor again (`doctor/refresh`, volatile:
 * no undo entry) whenever they change, and nothing otherwise. It runs at once when what the facts are made of
 * changes in the interface state (the engine starting, failing, the SIMD setting, the speed measured, the viewport
 * mode) and after an undo or redo (the state jumps back with the findings it was left with); `sync()` is for a tick
 * that catches what only the engine knows (its accumulation, read when its samples double). `status` is the
 * viewport engine's `status()` when the path tracer is on screen, else null.
 */
export function installDoctorFacts(store: Store, ui: UiStore, status: () => Pick<EngineStatus, 'scan'> | null): { sync(): void; dispose(): void } {
  let last: EngineFacts | null = null;
  const sync = (): void => {
    const u = ui.get();
    const next = engineFactsFrom(u, effectiveMode(u) === 'FULL' ? status() : null);
    if (last && sameEngineFacts(last, next)) return;
    last = next;
    setEngineFacts(next);
    store.dispatch({ type: 'doctor/refresh' });
  };
  const offUi = ui.subscribe((u, prev) => {
    if (u.engine !== prev.engine || u.engineInfo !== prev.engineInfo || u.settings['engine.simd'] !== prev.settings['engine.simd'] || u.throughput !== prev.throughput || u.viewportMode !== prev.viewportMode) sync();
  });
  const offStore = store.subscribe((_s, _prev, action) => {
    if (action.type === 'history/undo' || action.type === 'history/redo') store.dispatch({ type: 'doctor/refresh' });
  });
  return {
    sync,
    dispose() {
      offUi();
      offStore();
    },
  };
}

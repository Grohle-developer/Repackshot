// What this computer has, for the AI models (UI.md §2.9 ▸ Hardware,
// AI-POST.md §2.4): in the browser, the WebGPU adapter's limits (the largest
// buffer) and what the browser reports of cores and memory; on the desktop,
// the launcher's own detection (`GET /api/hardware`, phase P2). Only reported
// figures: a browser does not say how much video memory there is, and then
// the field says so. A detection that fails or hangs is a failure, and
// nothing is recommended.

import type { HardwareInfo } from '../core/models';

interface GpuAdapter {
  limits?: { maxBufferSize?: number };
  info?: { vendor?: string; architecture?: string; device?: string; description?: string };
  requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; device?: string; description?: string }>;
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** The graphics card's name as WebGL reports it (the unmasked renderer string), when it does. */
function webglRenderer(): string | null {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return r || null;
  } catch {
    return null;
  }
}

export async function detectWebHardware(nav: Navigator = navigator, timeoutMs = 5000): Promise<HardwareInfo> {
  const n = nav as unknown as { hardwareConcurrency?: number; deviceMemory?: number; gpu?: { requestAdapter(): Promise<GpuAdapter | null> } };
  const cores = typeof n.hardwareConcurrency === 'number' && n.hardwareConcurrency > 0 ? n.hardwareConcurrency : null;
  const ram = typeof n.deviceMemory === 'number' && n.deviceMemory > 0 ? n.deviceMemory : null;
  const base: HardwareInfo = { detected: true, where: 'web', cores, ramGiB: ram, ramCapped: ram !== null && ram >= 8, gpus: [], webgpu: null, maxBufferBytes: null };
  let name: string | null = null;
  try {
    if (!n.gpu) base.webgpu = false;
    else {
      const adapter = await within(n.gpu.requestAdapter(), timeoutMs);
      if (!adapter) base.webgpu = false;
      else {
        base.webgpu = true;
        const max = adapter.limits?.maxBufferSize;
        base.maxBufferBytes = typeof max === 'number' && max > 0 ? max : null;
        const info = adapter.info ?? (adapter.requestAdapterInfo ? await within(adapter.requestAdapterInfo(), timeoutMs).catch(() => undefined) : undefined);
        name = [info?.vendor, info?.architecture, info?.description].filter((x) => typeof x === 'string' && x.length > 0).join(' ') || null;
      }
    }
  } catch (err) {
    return { ...base, detected: false, error: err instanceof Error ? err.message : String(err) };
  }
  name ??= webglRenderer();
  if (name) base.gpus = [{ name, vramGiB: null }];
  return base;
}

/** The launcher's detection (P2's `NativeHardware`, `GET /api/hardware`): the fields used here. */
export interface NativeHardwareLike {
  cpu: string;
  cores: number;
  threads: number;
  ramGiB: number | null;
  gpus: { name: string; vramGiB: number | null }[];
  device: 'gpu' | 'cpu';
  detected: boolean;
}

export function fromNativeHardware(hw: NativeHardwareLike): HardwareInfo {
  return {
    detected: hw.detected,
    where: 'desktop',
    cores: hw.threads || hw.cores || null,
    ramGiB: hw.ramGiB,
    gpus: hw.gpus.map((g) => ({ name: g.name, vramGiB: g.vramGiB })),
    webgpu: null,
    maxBufferBytes: null,
    cpu: hw.cpu,
    device: hw.device,
    ...(hw.detected ? {} : { error: 'launcher' }),
  };
}

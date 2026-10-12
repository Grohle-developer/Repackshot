// Render settings, output size, budget and the queue (SPEC §3.8).

import { QUALITY_PRESETS, RESOLUTION_PRESETS } from '../data/quality';
import type { QualityKey, ResolutionKey } from '../data/types';
import type { ActionBase, ProjectState } from './store';
import type { CameraId } from './camera';
import { nextId } from './ids';

export type RenderQuality = QualityKey | 'CUSTOM';
export type OutputFormat = 'PNG' | 'JPEG' | 'EXR';

/** One job of the render queue. */
export interface RenderJob {
  id: string;
  name: string;
  camera: CameraId;
  width: number;
  height: number;
  quality: RenderQuality;
  maxSamples: number;
  maxSeconds: number;
  format: OutputFormat;
  transparent: boolean;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  /** 0..1 */
  progress: number;
}

/** Progress of the render in flight, as reported by the engine. */
export interface RenderProgress {
  /** Queue job being rendered, or null for the Render button. */
  jobId: string | null;
  /** 0..1 */
  progress: number;
  samples: number;
  seconds: number;
}

/** Formats this version can actually write. */
export const WRITABLE_FORMATS: ReadonlySet<OutputFormat> = new Set<OutputFormat>(['PNG', 'JPEG']);

/** Formats that carry an alpha channel. */
export function supportsAlpha(format: OutputFormat): boolean {
  return format === 'PNG' || format === 'EXR';
}

/** The RESOLUTION_PRESETS key for a size, or 'CUSTOM'. */
export function matchResolution(width: number, height: number): ResolutionKey | 'CUSTOM' {
  return RESOLUTION_PRESETS.find((r) => r.width === width && r.height === height)?.key ?? 'CUSTOM';
}

/** Largest side the preview can render in one go. */
export const MAX_OUTPUT_SIDE = 8192;

export type RenderAction =
  | ({ type: 'render/quality'; quality: QualityKey } & ActionBase)
  | ({ type: 'render/set'; patch: Partial<Pick<ProjectState['render'], 'width' | 'height' | 'maxSamples' | 'maxSeconds' | 'format' | 'transparent'>> } & ActionBase)
  | ({ type: 'render/enqueue'; name: string } & ActionBase)
  | ({ type: 'render/job'; id: string; patch: Partial<Pick<RenderJob, 'status' | 'progress'>> } & ActionBase)
  | ({ type: 'render/removeJob'; id: string } & ActionBase)
  | ({ type: 'render/clearQueue' } & ActionBase)
  | ({ type: 'render/running'; running: RenderProgress | null } & ActionBase);

function clampSize(v: number): number {
  return Math.max(16, Math.min(MAX_OUTPUT_SIDE, Math.round(v)));
}

export function reduceRender(state: ProjectState, action: RenderAction): ProjectState {
  const r = state.render;
  switch (action.type) {
    case 'render/quality': {
      const q = QUALITY_PRESETS[action.quality];
      if (!q) return state;
      return { ...state, render: { ...r, quality: action.quality, maxSamples: q.samples } };
    }
    case 'render/set': {
      const p = { ...action.patch };
      if (p.width !== undefined) p.width = clampSize(p.width);
      if (p.height !== undefined) p.height = clampSize(p.height);
      if (p.maxSamples !== undefined) p.maxSamples = Math.max(1, Math.round(p.maxSamples));
      if (p.maxSeconds !== undefined) p.maxSeconds = Math.max(0, Math.round(p.maxSeconds));
      const next = { ...r, ...p };
      // Touching the budget away from the tier makes the quality custom.
      if (p.maxSamples !== undefined && r.quality !== 'CUSTOM' && QUALITY_PRESETS[r.quality].samples !== p.maxSamples) {
        next.quality = 'CUSTOM';
      }
      if (p.format !== undefined && !supportsAlpha(p.format)) next.transparent = false;
      return { ...state, render: next };
    }
    case 'render/enqueue': {
      const job: RenderJob = {
        id: nextId('j', r.queue.map((j) => j.id)),
        name: action.name,
        camera: state.camera.active,
        width: r.width,
        height: r.height,
        quality: r.quality,
        maxSamples: r.maxSamples,
        maxSeconds: r.maxSeconds,
        format: WRITABLE_FORMATS.has(r.format) ? r.format : 'PNG',
        transparent: r.transparent,
        status: 'QUEUED',
        progress: 0,
      };
      return { ...state, render: { ...r, queue: [...r.queue, job] } };
    }
    case 'render/job':
      return { ...state, render: { ...r, queue: r.queue.map((j) => (j.id === action.id ? { ...j, ...action.patch } : j)) } };
    case 'render/removeJob':
      return { ...state, render: { ...r, queue: r.queue.filter((j) => j.id !== action.id) } };
    case 'render/clearQueue':
      return { ...state, render: { ...r, queue: r.queue.filter((j) => j.status === 'RUNNING') } };
    case 'render/running':
      return { ...state, render: { ...r, running: action.running } };
    default:
      return state;
  }
}

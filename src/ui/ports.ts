// What the interface needs from the rest of the application. `ui` never
// imports from `render` or `io` (ARCHITECTURE §2): main.ts builds these
// services from the engine and the importers and hands them in.

import type { CameraId } from '../core/camera';
import type { MaterialInstance } from '../core/materials';
import type { ModelPayload, NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';
import type { Tool } from './ui-state';

export interface PickResult {
  node: NodeId;
  face: number;
  point: [number, number, number];
  normal: [number, number, number];
}

/** What the engine reports; the meter prints exactly this. */
export interface EngineStatus {
  samples: number;
  seconds: number;
  converged: boolean;
  device: string;
}

/** The viewport as the interface sees it. */
export interface ViewportPort {
  readonly kind: 'preview' | 'pathtracer';
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number, dpr: number): void;
  /** Coordinates in CSS pixels relative to the canvas. */
  pick(x: number, y: number): PickResult | null;
  /** Parts to outline as hovered (the ones under the cursor, or under a dragged material). */
  setHover(ids: readonly NodeId[]): void;
  setTool(tool: Tool): void;
  status(): EngineStatus;
  /** Called after every drawn frame. */
  onFrame(fn: () => void): () => void;
  /** A sphere with the material, 96 x 96, as a data URL (cached by key). */
  materialThumbnail(mat: MaterialInstance, key: string): Promise<string | null>;
  /** Number of thumbnails waiting to be rendered. */
  thumbnailsPending(): number;
}

export interface RenderRequest {
  width: number;
  height: number;
  maxSamples: number;
  maxSeconds: number;
  transparent: boolean;
  format: 'PNG' | 'JPEG';
  camera?: CameraId;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface AppServices {
  /** Null when WebGL is not available. */
  viewport: ViewportPort | null;
  /** Renders at output size and encodes the image. */
  renderImage(req: RenderRequest): Promise<Blob>;
  /** The viewport as it is now, PNG. */
  captureViewport(): Promise<Blob | null>;
  /** Reads a model file; throws with a readable reason. Names come from the file. */
  importFile(file: File): Promise<ModelPayload>;
  /** The project as a .repack.json blob. */
  serializeProject(state: ProjectState): Blob;
}

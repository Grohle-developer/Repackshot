// What src/io/step.ts and its worker (step-worker.ts) say to each other, and
// the shape of what occt-import-js returns (its README, "Processing the
// result"). No imports: the worker bundles this file and nothing else of ours,
// so the worker stays a thin shell around the library.
//
// occt-import-js (LGPL-2.1, OpenCascade compiled to wasm) is never bundled:
// the worker fetches `occt-import-js.js` and `occt-import-js.wasm` from
// `public/vendor/occt-import-js/` (copied unmodified by tools/vendor.mjs) the
// first time a STEP or IGES file is read (ARCHITECTURE §1).

/** The two formats the library reads that the importer uses (it also reads OpenCascade's own BREP). */
export type OcctFormat = 'step' | 'iges';

/** The library's output units (`linearUnit`). */
export type OcctUnit = 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';

/** Triangulation parameters of `ReadFile` (README of the package; angular deflection in radians). */
export interface OcctParams {
  linearUnit: OcctUnit;
  linearDeflectionType: 'bounding_box_ratio' | 'absolute_value';
  linearDeflection: number;
  angularDeflection: number;
}

/** A node of the assembly tree: a name, the meshes it holds (indices into `meshes`), its children. */
export interface OcctNode {
  name: string;
  meshes: number[];
  children: OcctNode[];
}

/** A face of the B-rep: its triangles `first..last` (inclusive) in the mesh, and its own colour (linear RGB) or null. */
export interface OcctFace {
  first: number;
  last: number;
  color: number[] | null;
}

/** One solid, shell or set of loose faces, triangulated face by face. Colours are linear RGB in 0..1. */
export interface OcctMesh {
  name: string;
  color?: number[];
  brep_faces: OcctFace[];
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } };
  index: { array: ArrayLike<number> };
}

export interface OcctResult {
  success: boolean;
  root?: OcctNode;
  meshes?: OcctMesh[];
}

/** The module the library's factory resolves to. */
export interface OcctModule {
  ReadFile(format: OcctFormat, content: Uint8Array, params: OcctParams | null): OcctResult;
}

/** Main thread to worker: read a file. `libraryUrl` is the absolute URL of the folder that holds the library. */
export interface WorkerRequest {
  type: 'read';
  id: number;
  libraryUrl: string;
  format: OcctFormat;
  bytes: Uint8Array;
  params: OcctParams;
}

/** Why the worker could not answer: the library did not load, the file is not readable, or the library threw. */
export type WorkerErrorCode = 'loadFailed' | 'unreadable' | 'crashed';

/** Worker to main thread. */
export type WorkerReply =
  | { type: 'progress'; id: number; stage: 'download' | 'start' | 'read'; loaded?: number; total?: number }
  | { type: 'result'; id: number; result: OcctResult }
  | { type: 'error'; id: number; code: WorkerErrorCode; detail: string };

/**
 * The library's result with its plain arrays turned into typed arrays (positions and normals as Float32Array,
 * indices as Uint32Array), so they cross from the worker without a copy. Everything else is kept as it is.
 * The tests run the library in Node and go through this too, like the worker does.
 */
export function packOcctResult(r: OcctResult): { result: OcctResult; transfer: ArrayBuffer[] } {
  const transfer: ArrayBuffer[] = [];
  const meshes = (r.meshes ?? []).map((m): OcctMesh => {
    const positions = Float32Array.from(m.attributes.position.array);
    const normals = m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null;
    const indices = Uint32Array.from(m.index.array);
    transfer.push(positions.buffer, indices.buffer);
    if (normals) transfer.push(normals.buffer);
    return {
      name: m.name,
      ...(m.color ? { color: [...m.color] } : {}),
      brep_faces: m.brep_faces.map((f) => ({ first: f.first, last: f.last, color: f.color ? [...f.color] : null })),
      attributes: { position: { array: positions }, ...(normals ? { normal: { array: normals } } : {}) },
      index: { array: indices },
    };
  });
  return { result: { success: r.success, ...(r.root ? { root: r.root } : {}), ...(r.meshes ? { meshes } : {}) }, transfer };
}

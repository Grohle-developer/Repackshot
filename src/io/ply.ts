// PLY (ASCII and binary, either byte order) through three's PLYLoader: one
// part per file, with the vertex normals and texture coordinates the file has.
// PLY has no units and no up axis: Z up is the detected default (what
// scanners, Blender and MeshLab write), the units come from the size
// heuristic. Vertex colours (scans) are not used yet and the reader says so.
// A file without faces is a point cloud and cannot be rendered as a surface.

import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import type { ImportMessage } from '../core/import-options';
import type { ReadResult } from './gltf';
import { convertScene, toPayload } from './three-scene';

export async function readPly(name: string, buffer: ArrayBuffer): Promise<ReadResult> {
  const geometry = new PLYLoader().parse(buffer);
  if (!geometry.index || geometry.index.count < 3) throw new Error('no faces found');
  const notes: ImportMessage[] = [];
  if (geometry.getAttribute('color')) notes.push({ code: 'vertexColors', params: {} });
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0, roughness: 0.5 }));
  mesh.name = name.replace(/\.[^.]+$/, '') || 'Part';
  // The material is the loader-less default of a file that has none: the part takes the neutral Default.
  const converted = convertScene(mesh, { fileName: name, format: 'PLY', isFallbackMaterial: () => true });
  return { ...toPayload(converted, { units: null, upAxis: 'Z', upAxisDeclared: false }), warnings: converted.warnings, notes };
}

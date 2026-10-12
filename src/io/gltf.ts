// GLB / glTF import through three's GLTFLoader (UI.md §5 allows it here).
// Every mesh becomes a PART, every node with children a GROUP, all under one
// MODEL named after the file. The mesh's world transform is baked into its
// vertices and the part is re-centred on its own bounds, so parts keep a
// sensible pivot. glTF is Y up in metres (glTF 2.0 §3.4); the model is
// Z up in millimetres: `fromGltf` is that file-format conversion.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { defaultInstance, plainInstance, type MaterialId, type MaterialInstance } from '../core/materials';
import { boxCenter } from '../core/math';
import { positionsBounds, registerMesh } from '../core/meshes';
import type { ModelPayload, NodeId, SceneNode } from '../core/scene';

let importCounter = 0;

/** glTF space (Y up, metres) to model space (Z up, millimetres). */
function fromGltf(x: number, y: number, z: number): [number, number, number] {
  return [x * 1000, -z * 1000, y * 1000];
}

function materialParams(m: THREE.Material): { name: string; params: Record<string, unknown> } {
  const std = m as THREE.MeshStandardMaterial & Partial<THREE.MeshPhysicalMaterial>;
  const c = std.color ? std.color.clone() : new THREE.Color(0.8, 0.8, 0.8);
  const params: Record<string, unknown> = {
    baseColor: [c.r, c.g, c.b, 1],
    metallic: typeof std.metalness === 'number' ? std.metalness : 0,
    roughness: typeof std.roughness === 'number' ? std.roughness : 0.5,
  };
  if (std.opacity !== undefined && std.opacity < 1) params.opacity = std.opacity;
  if (typeof std.transmission === 'number' && std.transmission > 0) params.transmission = std.transmission;
  if (typeof std.clearcoat === 'number' && std.clearcoat > 0) params.coat = std.clearcoat;
  return { name: m.name || 'Material', params };
}

function parse(buffer: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf), (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

export async function readGltf(file: File): Promise<ModelPayload> {
  const buffer = await file.arrayBuffer();
  const gltf = await parse(buffer);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const run = ++importCounter;
  const nodes: Record<NodeId, SceneNode> = {};
  const materials: Record<MaterialId, MaterialInstance> = {};
  const matIds = new Map<string, MaterialId>();
  let n = 0;
  const newId = () => `t${++n}`;
  const base = (id: string, name: string, kind: SceneNode['kind'], parent: string | null): SceneNode => ({
    id,
    name,
    kind,
    parent,
    children: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
  });
  const modelId = newId();
  nodes[modelId] = { ...base(modelId, file.name.replace(/\.(glb|gltf)$/i, ''), 'MODEL', null), source: { kind: 'FILE', name: file.name, format: 'GLTF' } };

  const materialFor = (m: THREE.Material | THREE.Material[]): MaterialId => {
    const mat = Array.isArray(m) ? m[0] : m;
    const hit = matIds.get(mat.uuid);
    if (hit) return hit;
    // A primitive without a material gets the loader's built-in one, which no
    // glTF material maps to: the part takes the neutral Default instead.
    // (Clones made for flat shading carry an undefined mapping, so test the value.)
    const mapping = gltf.parser.associations.get(mat) as { materials?: number } | undefined;
    if (mapping?.materials === undefined) {
      const id = 'tm_default';
      materials[id] = defaultInstance(id, 100);
      matIds.set(mat.uuid, id);
      return id;
    }
    const id = `tm${matIds.size + 1}`;
    const { name, params } = materialParams(mat);
    materials[id] = plainInstance(id, name, params);
    matIds.set(mat.uuid, id);
    return id;
  };

  const normalMatrix = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const addMesh = (mesh: THREE.Mesh, parent: string): string | null => {
    const g = mesh.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    if (!pos || pos.count === 0) return null;
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const positions = new Float32Array(pos.count * 3);
    const normals = new Float32Array(pos.count * 3);
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      positions.set(fromGltf(v.x, v.y, v.z), i * 3);
      if (nor) {
        v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
        const m = fromGltf(v.x, v.y, v.z);
        const l = Math.hypot(m[0], m[1], m[2]) || 1;
        normals.set([m[0] / l, m[1] / l, m[2] / l], i * 3);
      }
    }
    let indices: Uint32Array;
    if (g.index) indices = Uint32Array.from(g.index.array as ArrayLike<number>);
    else indices = Uint32Array.from({ length: pos.count }, (_, i) => i);
    // A negative determinant mirrors the mesh: flip the winding to keep fronts outward.
    if (mesh.matrixWorld.determinant() < 0) {
      for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    }
    if (!nor) {
      const tmp = new THREE.BufferGeometry();
      tmp.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      tmp.setIndex(new THREE.BufferAttribute(indices, 1));
      tmp.computeVertexNormals();
      normals.set(tmp.getAttribute('normal').array as Float32Array);
    }
    // Re-centre the part on its bounds: the node position carries the offset.
    const c = boxCenter(positionsBounds(positions));
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= c[0];
      positions[i + 1] -= c[1];
      positions[i + 2] -= c[2];
    }
    const id = newId();
    const ref = registerMesh(`gltf:${run}:${id}`, { positions, normals, indices, uvs: uv ? Float32Array.from(uv.array as ArrayLike<number>) : undefined });
    nodes[id] = { ...base(id, mesh.name || `Part ${n}`, 'PART', parent), mesh: ref, material: materialFor(mesh.material), smooth: true };
    nodes[id].transform.position = c;
    return id;
  };

  const walk = (obj: THREE.Object3D, parent: string): void => {
    for (const child of obj.children) {
      if ((child as THREE.Mesh).isMesh) {
        const id = addMesh(child as THREE.Mesh, parent);
        if (id) nodes[parent].children.push(id);
        if (child.children.length) walk(child, parent);
      } else if (child.children.length > 0) {
        const id = newId();
        nodes[id] = base(id, child.name || `Group ${n}`, 'GROUP', parent);
        walk(child, id);
        if (nodes[id].children.length > 0) nodes[parent].children.push(id);
        else delete nodes[id];
      }
    }
  };
  walk(root, modelId);
  if (nodes[modelId].children.length === 0) throw new Error('no meshes');
  return { nodes, roots: [modelId], materials };
}

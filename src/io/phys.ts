// PHY1, the scene the simulator reads (engine/crates/rt-phys/src/scene.rs, phase S2), written from a PhysicsSpec
// (core/physics.ts): every mesh the bodies use once, then the bodies (the dynamic ones first, in the spec's order,
// which is the order of the simulator's poses; then each static part), then the floor. Little-endian 4-byte words:
//
//   "PHY1"  u32 version (1)
//   u32 meshes; per mesh: u32 vertices, u32 indices, f32 positions[3 × vertices], u32 indices[]
//   u32 bodies; per body: u32 kind (0 static, 1 dynamic), f32 density (kg/m³), f32 friction, f32 restitution,
//                         u32 pieces; per piece: u32 mesh, f32 rows[12] (the 3 × 4 object-to-world matrix by rows)
//   u32 floor (0 none, 1 yes), f32 z, f32 friction, f32 restitution
//
// The meshes go as they are in the registry (model space of their part, millimetres); the hulls are built by the
// simulator.

import { getMesh, type MeshData, type MeshId } from '../core/meshes';
import type { Mat4 } from '../core/math';
import type { PhysicsPiece, PhysicsSpec } from '../core/physics';

export const PHY1_VERSION = 1;

/** The rows of the 3 × 4 object-to-world part of a column-major matrix. */
function rows(m: Mat4): number[] {
  return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]];
}

/**
 * The PHY1 bytes of a spec. A piece whose mesh is not in the registry is left out (a dynamic body left without any
 * has no mass, and the simulator keeps it out of its poses: `phys_ids` says so).
 */
export function writePhysicsScene(spec: PhysicsSpec, meshes: (id: MeshId) => MeshData | undefined = getMesh): Uint8Array {
  const index = new Map<MeshId, number>();
  const list: MeshData[] = [];
  const known = (p: PhysicsPiece) => {
    if (index.has(p.mesh)) return true;
    const data = meshes(p.mesh);
    if (!data) return false;
    index.set(p.mesh, list.length);
    list.push(data);
    return true;
  };
  const bodies: { kind: number; density: number; friction: number; restitution: number; pieces: PhysicsPiece[] }[] = [];
  for (const b of spec.bodies) bodies.push({ kind: 1, density: b.density, friction: b.friction, restitution: b.bounciness, pieces: b.pieces.filter(known) });
  for (const s of spec.statics) {
    if (known(s.piece)) bodies.push({ kind: 0, density: 1000, friction: s.friction, restitution: s.bounciness, pieces: [s.piece] });
  }
  let size = 8 + 4;
  for (const m of list) size += 8 + m.positions.length * 4 + m.indices.length * 4;
  size += 4;
  for (const b of bodies) size += 20 + b.pieces.length * 52;
  size += 16;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u32 = (v: number) => {
    view.setUint32(at, v >>> 0, true);
    at += 4;
  };
  const f32 = (v: number) => {
    view.setFloat32(at, Number.isFinite(v) ? v : 0, true);
    at += 4;
  };
  out.set([0x50, 0x48, 0x59, 0x31], 0); // "PHY1"
  at = 4;
  u32(PHY1_VERSION);
  u32(list.length);
  for (const m of list) {
    u32(m.positions.length / 3);
    u32(m.indices.length);
    for (let i = 0; i < m.positions.length; i++) f32(m.positions[i]);
    for (let i = 0; i < m.indices.length; i++) u32(m.indices[i]);
  }
  u32(bodies.length);
  for (const b of bodies) {
    u32(b.kind);
    f32(b.density);
    f32(b.friction);
    f32(b.restitution);
    u32(b.pieces.length);
    for (const p of b.pieces) {
      u32(index.get(p.mesh)!);
      for (const v of rows(p.matrix)) f32(v);
    }
  }
  u32(1);
  f32(spec.floor.z);
  f32(spec.floor.friction);
  f32(spec.floor.bounciness);
  return out;
}

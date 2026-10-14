//! `PHY1`, the scene the interface hands the simulator: the meshes, the bodies (static or
//! dynamic, each made of pieces: a mesh and its object-to-world transform) with their parameters,
//! and the floor. Little-endian, 4-byte words throughout:
//!
//! ```text
//! "PHY1"  u32 version (1)
//! u32 meshes; per mesh: u32 vertices, u32 indices, f32 positions[3 × vertices], u32 indices[]
//! u32 bodies; per body: u32 kind (0 static, 1 dynamic), f32 density (kg/m³), f32 friction,
//!                       f32 restitution, u32 pieces; per piece: u32 mesh, f32 rows[12] (3 × 4)
//! u32 floor (0 none, 1 yes), f32 z, f32 friction, f32 restitution
//! ```
//!
//! A dynamic body with several pieces is one body (the hull of all their points: a group that
//! falls as one); a static body's pieces all become static triangles. Dynamic bodies are numbered
//! in the order they come, which is the order of [`World::poses`].

use crate::world::{BodyParams, ShapeSource, Transform, World};
use rt_core::math::Vec3;

/// The magic number.
pub const MAGIC: &[u8; 4] = b"PHY1";
/// The version this reader understands.
pub const VERSION: u32 = 1;

/// A mesh of the scene.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SceneMesh {
    /// Vertex positions.
    pub positions: Vec<Vec3>,
    /// Three per triangle.
    pub indices: Vec<u32>,
}

/// A piece of a body: a mesh and where it is.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Piece {
    /// Index into the meshes.
    pub mesh: u32,
    /// Object to world.
    pub transform: Transform,
}

/// A body of the scene.
#[derive(Clone, Debug, PartialEq)]
pub struct SceneBody {
    /// Moves (true) or stays (false).
    pub dynamic: bool,
    /// Density, friction, restitution.
    pub params: BodyParams,
    /// What it is made of.
    pub pieces: Vec<Piece>,
}

/// The floor plane.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Floor {
    /// Height, mm.
    pub z: f32,
    /// Coulomb friction.
    pub friction: f32,
    /// Restitution.
    pub restitution: f32,
}

/// A whole scene.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Scene {
    /// The meshes.
    pub meshes: Vec<SceneMesh>,
    /// The bodies.
    pub bodies: Vec<SceneBody>,
    /// The floor, if any.
    pub floor: Option<Floor>,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn word(&mut self) -> Result<[u8; 4], String> {
        let end = self.at + 4;
        let w = self
            .bytes
            .get(self.at..end)
            .ok_or_else(|| format!("PHY1: cut short at byte {}", self.at))?;
        self.at = end;
        Ok([w[0], w[1], w[2], w[3]])
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.word()?))
    }
    fn f32(&mut self) -> Result<f32, String> {
        let v = f32::from_le_bytes(self.word()?);
        if v.is_finite() {
            Ok(v)
        } else {
            Err(format!(
                "PHY1: a value that is not finite at byte {}",
                self.at - 4
            ))
        }
    }
    /// A count of items of `bytes` each that must fit in what is left.
    fn count(&mut self, bytes: usize) -> Result<usize, String> {
        let n = self.u32()? as usize;
        if n.saturating_mul(bytes) > self.bytes.len() - self.at {
            return Err(format!("PHY1: a count of {n} does not fit in the file"));
        }
        Ok(n)
    }
}

/// A large enough floor for any scene: half a side, mm.
pub const FLOOR_HALF: f32 = 100_000.0;

impl Scene {
    /// Reads a `PHY1` file.
    pub fn parse(bytes: &[u8]) -> Result<Scene, String> {
        let mut r = Reader { bytes, at: 0 };
        if r.word()? != *MAGIC {
            return Err("PHY1: not a physics scene".into());
        }
        let version = r.u32()?;
        if version != VERSION {
            return Err(format!(
                "PHY1: version {version}, this simulator reads {VERSION}"
            ));
        }
        let mut scene = Scene::default();
        let meshes = r.count(8)?;
        for _ in 0..meshes {
            let nv = r.count(12)?;
            let ni = r.u32()? as usize;
            let mut positions = Vec::with_capacity(nv);
            for _ in 0..nv {
                positions.push(Vec3::new(r.f32()?, r.f32()?, r.f32()?));
            }
            if ni.saturating_mul(4) > bytes.len() - r.at {
                return Err("PHY1: an index count does not fit in the file".into());
            }
            let mut indices = Vec::with_capacity(ni);
            for _ in 0..ni {
                let i = r.u32()?;
                if i as usize >= nv {
                    return Err(format!("PHY1: index {i} of a mesh of {nv} vertices"));
                }
                indices.push(i);
            }
            scene.meshes.push(SceneMesh { positions, indices });
        }
        let bodies = r.count(20)?;
        for _ in 0..bodies {
            let kind = r.u32()?;
            if kind > 1 {
                return Err(format!("PHY1: body kind {kind}"));
            }
            let params = BodyParams {
                density: r.f32()?,
                friction: r.f32()?,
                restitution: r.f32()?,
            };
            let pieces = r.count(52)?;
            let mut list = Vec::with_capacity(pieces);
            for _ in 0..pieces {
                let mesh = r.u32()?;
                if mesh as usize >= scene.meshes.len() {
                    return Err(format!("PHY1: mesh {mesh} of {}", scene.meshes.len()));
                }
                let mut rows = [[0.0f32; 4]; 3];
                for row in rows.iter_mut() {
                    for v in row.iter_mut() {
                        *v = r.f32()?;
                    }
                }
                list.push(Piece {
                    mesh,
                    transform: Transform { rows },
                });
            }
            scene.bodies.push(SceneBody {
                dynamic: kind == 1,
                params,
                pieces: list,
            });
        }
        let floor = r.u32()?;
        let (z, friction, restitution) = (r.f32()?, r.f32()?, r.f32()?);
        if floor == 1 {
            scene.floor = Some(Floor {
                z,
                friction,
                restitution,
            });
        }
        if r.at != bytes.len() {
            return Err(format!("PHY1: {} bytes after the end", bytes.len() - r.at));
        }
        Ok(scene)
    }

    /// Writes the scene as `PHY1`.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let u = |out: &mut Vec<u8>, v: u32| out.extend_from_slice(&v.to_le_bytes());
        let f = |out: &mut Vec<u8>, v: f32| out.extend_from_slice(&v.to_le_bytes());
        out.extend_from_slice(MAGIC);
        u(&mut out, VERSION);
        u(&mut out, self.meshes.len() as u32);
        for m in &self.meshes {
            u(&mut out, m.positions.len() as u32);
            u(&mut out, m.indices.len() as u32);
            for p in &m.positions {
                f(&mut out, p.x);
                f(&mut out, p.y);
                f(&mut out, p.z);
            }
            for &i in &m.indices {
                u(&mut out, i);
            }
        }
        u(&mut out, self.bodies.len() as u32);
        for b in &self.bodies {
            u(&mut out, b.dynamic as u32);
            f(&mut out, b.params.density);
            f(&mut out, b.params.friction);
            f(&mut out, b.params.restitution);
            u(&mut out, b.pieces.len() as u32);
            for p in &b.pieces {
                u(&mut out, p.mesh);
                for row in &p.transform.rows {
                    for &v in row {
                        f(&mut out, v);
                    }
                }
            }
        }
        match self.floor {
            Some(fl) => {
                u(&mut out, 1);
                f(&mut out, fl.z);
                f(&mut out, fl.friction);
                f(&mut out, fl.restitution);
            }
            None => {
                u(&mut out, 0);
                f(&mut out, 0.0);
                f(&mut out, 0.0);
                f(&mut out, 0.0);
            }
        }
        out
    }

    /// The world of this scene. Dynamic bodies that have no mass (no points, flat with no
    /// thickness) become static instead, so the order of the others does not change: their
    /// indices in the returned list are `None`.
    pub fn build(&self) -> (World, Vec<Option<u32>>) {
        let mut world = World::new();
        let mut ids = Vec::new();
        for b in &self.bodies {
            if !b.dynamic {
                continue;
            }
            let mut points = Vec::new();
            for p in &b.pieces {
                for v in &self.meshes[p.mesh as usize].positions {
                    points.push(p.transform.apply(*v));
                }
            }
            let id = world
                .add_dynamic(ShapeSource::Points(&points), &Transform::IDENTITY, b.params)
                .ok();
            ids.push(id);
        }
        for b in &self.bodies {
            if b.dynamic {
                continue;
            }
            for p in &b.pieces {
                let m = &self.meshes[p.mesh as usize];
                world.add_static_mesh(
                    &m.positions,
                    &m.indices,
                    &p.transform,
                    b.params.friction,
                    b.params.restitution,
                );
            }
        }
        if let Some(fl) = self.floor {
            world.add_floor(fl.z, (0.0, 0.0), FLOOR_HALF, fl.friction, fl.restitution);
        }
        (world, ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scene_reads_back_what_was_written() {
        let scene = Scene {
            meshes: vec![SceneMesh {
                positions: vec![
                    Vec3::new(0.0, 0.0, 0.0),
                    Vec3::new(1.0, 0.0, 0.0),
                    Vec3::new(0.0, 1.0, 0.0),
                ],
                indices: vec![0, 1, 2],
            }],
            bodies: vec![SceneBody {
                dynamic: true,
                params: BodyParams {
                    density: 900.0,
                    friction: 0.4,
                    restitution: 0.2,
                },
                pieces: vec![Piece {
                    mesh: 0,
                    transform: Transform::translation(Vec3::new(1.0, 2.0, 3.0)),
                }],
            }],
            floor: Some(Floor {
                z: 0.0,
                friction: 0.6,
                restitution: 0.0,
            }),
        };
        let bytes = scene.to_bytes();
        assert_eq!(Scene::parse(&bytes).unwrap(), scene);
        // Damaged: cut short, a wrong index, garbage after the end.
        assert!(Scene::parse(&bytes[..bytes.len() - 2]).is_err());
        let mut bad = bytes.clone();
        // The first index (after the magic, the version, the counts and nine floats).
        bad[4 + 4 + 4 + 8 + 36] = 9;
        assert!(Scene::parse(&bad).is_err());
        let mut long = bytes.clone();
        long.extend_from_slice(&[0, 0, 0, 0]);
        assert!(Scene::parse(&long).is_err());
        assert!(Scene::parse(b"RSB1\0\0\0\0").is_err());
    }
}

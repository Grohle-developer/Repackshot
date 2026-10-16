//! Indexed triangle meshes, structure-of-arrays, with their own BVH.

use super::bvh::{leaf_ref, BuildParams, Bvh, BvhStats, BvhWidth, MAX_LEAF_FIRST};
use super::edges::{EdgeCache, MeshEdges};
use super::triangle::TriPacket;
use crate::math::{Aabb, Vec3};
use std::fmt;

/// Leaf policy of mesh BVHs: one 4-triangle packet per leaf, two when the SAH prefers it.
const MESH_LEAVES: BuildParams = BuildParams {
    leaf_target: 4,
    leaf_max: 8,
};

/// Largest number of triangles in one mesh (a limit of the leaf encoding).
pub const MAX_TRIANGLES: usize = MAX_LEAF_FIRST;

/// Why a mesh could not be built.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MeshError {
    /// The number of indices is not a multiple of three.
    IndexCount,
    /// An index does not refer to a vertex.
    IndexOutOfRange,
    /// Normals were given, but not one per vertex.
    NormalCount,
    /// A position is NaN or infinite.
    NonFinitePosition,
    /// A normal is NaN or infinite.
    NonFiniteNormal,
    /// More than [`MAX_TRIANGLES`] triangles or `u32::MAX` vertices.
    TooLarge,
}

impl MeshError {
    /// A short English description.
    pub fn reason(self) -> &'static str {
        match self {
            MeshError::IndexCount => "index_count is not a multiple of 3",
            MeshError::IndexOutOfRange => "vertex index out of range",
            MeshError::NormalCount => "normals are not one per vertex",
            MeshError::NonFinitePosition => "non-finite vertex position",
            MeshError::NonFiniteNormal => "non-finite vertex normal",
            MeshError::TooLarge => "too many triangles or vertices",
        }
    }
}

impl fmt::Display for MeshError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.reason())
    }
}

impl std::error::Error for MeshError {}

/// Three coordinate arrays of equal length.
#[derive(Clone, Debug, Default, PartialEq)]
struct Soa {
    x: Vec<f32>,
    y: Vec<f32>,
    z: Vec<f32>,
}

impl Soa {
    fn from_points(points: &[Vec3]) -> Soa {
        Soa {
            x: points.iter().map(|p| p.x).collect(),
            y: points.iter().map(|p| p.y).collect(),
            z: points.iter().map(|p| p.z).collect(),
        }
    }

    #[inline]
    fn get(&self, i: usize) -> Option<Vec3> {
        Some(Vec3::new(*self.x.get(i)?, *self.y.get(i)?, *self.z.get(i)?))
    }
}

/// An indexed triangle mesh in its own (object) space.
///
/// Positions (and optional normals) are stored structure-of-arrays. Construction validates the
/// data and builds the mesh's BVH and the leaf-ordered triangle packets of the intersection
/// kernel, so a `Mesh` is immutable: build a new one to change it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mesh {
    positions: Soa,
    /// `None` when the mesh has no usable normals (none given, or all zero).
    normals: Option<Soa>,
    indices: Vec<u32>,
    material_id: u32,
    bounds: Aabb,
    bvh: Bvh,
    packets: Vec<TriPacket>,
    /// The vertex normals point, on the whole, against the winding order's normals.
    inside_out: bool,
    /// The sharp and boundary edges, extracted on first use (E6, the edge bevel).
    edges: EdgeCache,
}

impl Mesh {
    /// Builds a mesh with a BVH of the [native width](BvhWidth::native).
    ///
    /// `normals` is empty or one per position; a zero normal means "use the face normal", and
    /// all-zero normals are dropped. `material_id` is the material of the mesh's implicit
    /// instance (see [`super::Geometry::from_meshes`]).
    pub fn new(
        positions: &[Vec3],
        normals: &[Vec3],
        indices: &[u32],
        material_id: u32,
    ) -> Result<Mesh, MeshError> {
        Mesh::with_width(positions, normals, indices, material_id, BvhWidth::native())
    }

    /// Like [`Mesh::new`] with an explicit BVH width.
    pub fn with_width(
        positions: &[Vec3],
        normals: &[Vec3],
        indices: &[u32],
        material_id: u32,
        width: BvhWidth,
    ) -> Result<Mesh, MeshError> {
        if !indices.len().is_multiple_of(3) {
            return Err(MeshError::IndexCount);
        }
        if indices.len() / 3 > MAX_TRIANGLES || positions.len() >= u32::MAX as usize {
            return Err(MeshError::TooLarge);
        }
        if indices.iter().any(|&i| i as usize >= positions.len()) {
            return Err(MeshError::IndexOutOfRange);
        }
        if !normals.is_empty() && normals.len() != positions.len() {
            return Err(MeshError::NormalCount);
        }
        if !positions.iter().all(|p| p.is_finite()) {
            return Err(MeshError::NonFinitePosition);
        }
        if !normals.iter().all(|n| n.is_finite()) {
            return Err(MeshError::NonFiniteNormal);
        }

        let mut mesh = Mesh {
            positions: Soa::from_points(positions),
            normals: normals
                .iter()
                .any(|&n| n != Vec3::ZERO)
                .then(|| Soa::from_points(normals)),
            indices: indices.to_vec(),
            material_id,
            bounds: positions.iter().fold(Aabb::EMPTY, |b, &p| b.extend(p)),
            bvh: Bvh::default(),
            packets: Vec::new(),
            inside_out: false,
            edges: EdgeCache::default(),
        };
        mesh.inside_out = mesh.normals_oppose_winding();
        mesh.build_bvh(width);
        Ok(mesh)
    }

    /// True when the vertex normals, summed over the triangles, point against the winding
    /// normals: the outside of the surface is then the side the winding calls the back.
    fn normals_oppose_winding(&self) -> bool {
        let Some(normals) = &self.normals else {
            return false;
        };
        let mut agreement = 0.0f32;
        for t in 0..self.triangle_count() {
            let (Some([a, b, c]), Some(ids)) = (self.triangle(t), self.triangle_indices(t)) else {
                continue;
            };
            let winding = (b - a).cross(c - a);
            let mut n = Vec3::ZERO;
            for i in ids {
                n += normals.get(i as usize).unwrap_or(Vec3::ZERO);
            }
            agreement += winding.normalize().dot(n);
        }
        agreement < 0.0
    }

    /// True when the vertex normals say the outside is the back of the winding order (a mesh
    /// whose triangles are wound clockwise seen from outside, with outward normals).
    pub fn inside_out(&self) -> bool {
        self.inside_out
    }

    fn build_bvh(&mut self, width: BvhWidth) {
        let count = self.triangle_count();
        let mut boxes = Vec::with_capacity(count);
        let mut centroids = Vec::with_capacity(count);
        for i in 0..count {
            let b = self.triangle(i).map_or(Aabb::EMPTY, |[a, b, c]| {
                Aabb::EMPTY.extend(a).extend(b).extend(c)
            });
            boxes.push(b);
            centroids.push(b.centroid());
        }
        let mut packets = Vec::with_capacity(count / 3 + 1);
        let bvh = Bvh::build(&boxes, &centroids, MESH_LEAVES, width, |prims| {
            let first = packets.len();
            for chunk in prims.chunks(4) {
                packets.push(self.packet(chunk));
            }
            leaf_ref(first, packets.len() - first)
        });
        self.bvh = bvh;
        self.packets = packets;
    }

    /// The packet of up to four triangles; missing lanes repeat the last triangle.
    fn packet(&self, triangles: &[u32]) -> TriPacket {
        let mut p = TriPacket {
            v: [[[0.0; 4]; 3]; 3],
            id: [0; 4],
        };
        for lane in 0..4 {
            let Some(&id) = triangles.get(lane).or(triangles.last()) else {
                break;
            };
            p.id[lane] = id;
            if let Some(corners) = self.triangle(id as usize) {
                for (corner, v) in corners.iter().enumerate() {
                    p.v[corner][0][lane] = v.x;
                    p.v[corner][1][lane] = v.y;
                    p.v[corner][2][lane] = v.z;
                }
            }
        }
        p
    }

    /// Number of vertices.
    pub fn vertex_count(&self) -> usize {
        self.positions.x.len()
    }

    /// Number of triangles.
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// Position of vertex `i`.
    pub fn position(&self, i: usize) -> Option<Vec3> {
        self.positions.get(i)
    }

    /// Normal of vertex `i`, or `None` when the mesh has no normals.
    pub fn normal(&self, i: usize) -> Option<Vec3> {
        self.normals.as_ref()?.get(i)
    }

    /// True when the mesh carries vertex normals.
    pub fn has_normals(&self) -> bool {
        self.normals.is_some()
    }

    /// The x, y and z coordinate arrays of the positions.
    pub fn positions_soa(&self) -> [&[f32]; 3] {
        [&self.positions.x, &self.positions.y, &self.positions.z]
    }

    /// Triangle vertex indices, three per triangle.
    pub fn indices(&self) -> &[u32] {
        &self.indices
    }

    /// The vertex indices of triangle `i`.
    pub fn triangle_indices(&self, i: usize) -> Option<[u32; 3]> {
        let idx = self.indices.get(i * 3..i * 3 + 3)?;
        Some([idx[0], idx[1], idx[2]])
    }

    /// The three corners of triangle `i`, or `None` if `i` is out of range.
    pub fn triangle(&self, i: usize) -> Option<[Vec3; 3]> {
        let [a, b, c] = self.triangle_indices(i)?;
        Some([
            self.position(a as usize)?,
            self.position(b as usize)?,
            self.position(c as usize)?,
        ])
    }

    /// Material of the mesh's implicit instance.
    pub fn material_id(&self) -> u32 {
        self.material_id
    }

    /// Bounding box of all vertices ([`Aabb::EMPTY`] for an empty mesh).
    pub fn bounds(&self) -> Aabb {
        self.bounds
    }

    /// Size figures of the mesh's BVH.
    pub fn bvh_stats(&self) -> BvhStats {
        self.bvh.stats()
    }

    /// The sharp and boundary edges of the mesh, for the edge bevel of the shading (see
    /// [`MeshEdges`]). Extracted the first time they are asked for, then kept with the mesh (and
    /// its clones) as long as it lives, like its BVH.
    pub fn sharp_edges(&self) -> &MeshEdges {
        self.edges.get(self)
    }

    /// The BVH and its leaf packets (for the kernels).
    pub(crate) fn accel(&self) -> (&Bvh, &[TriPacket]) {
        (&self.bvh, &self.packets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quad() -> (Vec<Vec3>, Vec<u32>) {
        (
            vec![
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(1.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 3.0),
            ],
            vec![0, 1, 2, 0, 2, 3],
        )
    }

    #[test]
    fn accessors_and_bounds() {
        let (p, i) = quad();
        let mesh = Mesh::new(&p, &[], &i, 7).expect("valid");
        assert_eq!(mesh.vertex_count(), 4);
        assert_eq!(mesh.triangle_count(), 2);
        assert_eq!(mesh.position(3), Some(p[3]));
        assert_eq!(mesh.position(4), None);
        assert_eq!(mesh.normal(0), None);
        assert!(!mesh.has_normals());
        assert_eq!(mesh.triangle(1), Some([p[0], p[2], p[3]]));
        assert_eq!(mesh.triangle(2), None);
        assert_eq!(mesh.triangle_indices(0), Some([0, 1, 2]));
        assert_eq!(mesh.material_id(), 7);
        assert_eq!(mesh.indices(), &i[..]);
        assert_eq!(mesh.positions_soa()[2], &[0.0, 0.0, 0.0, 3.0]);
        assert_eq!(
            mesh.bounds(),
            Aabb::new(Vec3::ZERO, Vec3::new(1.0, 1.0, 3.0))
        );
        assert!(Mesh::default().bounds().is_empty());
        assert_eq!(Mesh::default().triangle_count(), 0);
    }

    #[test]
    fn normals_are_optional_and_all_zero_means_none() {
        let (p, i) = quad();
        let up = vec![Vec3::new(0.0, 0.0, 1.0); 4];
        let with = Mesh::new(&p, &up, &i, 0).expect("valid");
        assert!(with.has_normals());
        assert_eq!(with.normal(2), Some(up[2]));
        let zero = Mesh::new(&p, &[Vec3::ZERO; 4], &i, 0).expect("valid");
        assert!(!zero.has_normals());
        assert_eq!(zero, Mesh::new(&p, &[], &i, 0).expect("valid"));
    }

    #[test]
    fn invalid_meshes_are_rejected() {
        let (p, i) = quad();
        assert_eq!(Mesh::new(&p, &[], &i[..5], 0), Err(MeshError::IndexCount));
        assert_eq!(
            Mesh::new(&p, &[], &[0, 1, 4], 0),
            Err(MeshError::IndexOutOfRange)
        );
        assert_eq!(
            Mesh::new(&p, &[Vec3::ZERO; 3], &i, 0),
            Err(MeshError::NormalCount)
        );
        let mut bad = p.clone();
        bad[1].y = f32::NAN;
        assert_eq!(
            Mesh::new(&bad, &[], &i, 0),
            Err(MeshError::NonFinitePosition)
        );
        let mut bad_n = vec![Vec3::new(0.0, 0.0, 1.0); 4];
        bad_n[0].x = f32::INFINITY;
        assert_eq!(
            Mesh::new(&p, &bad_n, &i, 0),
            Err(MeshError::NonFiniteNormal)
        );
        assert_eq!(
            MeshError::IndexOutOfRange.to_string(),
            "vertex index out of range"
        );
    }

    #[test]
    fn packets_pad_with_the_last_triangle() {
        let (p, i) = quad();
        let mesh = Mesh::with_width(&p, &[], &i, 0, BvhWidth::Four).expect("valid");
        let (_, packets) = mesh.accel();
        assert_eq!(packets.len(), 1);
        assert_eq!(packets[0].id, [0, 1, 1, 1]);
        assert_eq!(packets[0].v[2][2], [0.0, 3.0, 3.0, 3.0]);
    }
}

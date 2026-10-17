//! Which meshes are closed solids (Q1, the section view).
//!
//! A section caps what it cuts only where the cut goes through the inside of a solid, and the
//! engine can only know that for a mesh whose surface is closed: a ray that crosses the cutting
//! plane and meets next the back of a triangle of a closed mesh was inside it. For an open mesh
//! (a sheet, a cup without a lid, a model with holes) the back of a triangle means nothing of the
//! kind, so it is not capped and shows its inside.
//!
//! **Closed** means: after welding the vertices that share a position (as the edge extraction of
//! the bevel does, [`super::edges`]: a seam, split normals and UV islands do not open a mesh),
//! every edge of every triangle that has an area is shared by exactly two triangles that run
//! along it in opposite directions (so the winding is consistent). Triangles that collapse when
//! welded, or have no area, take no part. An edge used once (a boundary), three or more times (a
//! non-manifold join), or twice in the same direction (a flipped triangle) makes the mesh open.
//!
//! **Orientation.** The sign of the volume the closed surface encloses (the divergence theorem,
//! `V = ⅙ Σ p0 · (p1 × p2)` about the mesh's centre, summed in blocks so that the result does not
//! depend on anything but the mesh) says which side of the winding is the inside: a positive
//! volume is wound counter-clockwise seen from outside (the usual), a negative one is inside out.
//! A mesh whose volume is nothing (flat, degenerate) is open.
//!
//! The answer depends on the mesh alone and is computed once, the first time a section asks.

use super::edges::weld_vertices;
use super::Mesh;
use std::fmt;
use std::sync::OnceLock;

/// What a mesh is as a solid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Solid {
    /// Not a closed, consistently wound surface: no inside.
    Open,
    /// Closed and wound counter-clockwise seen from outside: the back of a triangle is the inside.
    Outward,
    /// Closed and wound clockwise seen from outside: the front of a triangle is the inside.
    Inward,
}

impl Solid {
    /// True when a ray that meets a triangle of this mesh from its `front` (the ray travels
    /// against the triangle's winding normal) or its back is inside the solid just before it.
    #[inline]
    pub fn inside_before(self, front: bool) -> bool {
        match self {
            Solid::Open => false,
            Solid::Outward => !front,
            Solid::Inward => front,
        }
    }
}

/// Terms summed at a time when the volume is computed (see the module documentation).
const VOLUME_BLOCK: usize = 256;
/// A volume under this fraction of the cube of the mesh's size is no volume.
const MIN_VOLUME: f32 = 1.0e-9;

/// Works out what `mesh` is as a solid.
pub(crate) fn analyse(mesh: &Mesh) -> Solid {
    let triangles = mesh.triangle_count();
    if triangles == 0 || mesh.bounds().is_empty() {
        return Solid::Open;
    }
    let weld = weld_vertices(mesh).ids;
    let centre = mesh.bounds().centroid();
    // The directed edges of the triangles that count: (smaller id, larger id, runs upwards).
    let mut halves: Vec<(u32, u32, bool)> = Vec::with_capacity(triangles * 3);
    let mut blocks = 0.0f32;
    let mut block = 0.0f32;
    let mut in_block = 0usize;
    for t in 0..triangles {
        let (Some(ids), Some([p0, p1, p2])) = (mesh.triangle_indices(t), mesh.triangle(t)) else {
            continue;
        };
        let w = ids.map(|i| weld[i as usize]);
        if w[0] == w[1] || w[1] == w[2] || w[2] == w[0] {
            continue;
        }
        if (p1 - p0).cross(p2 - p0).length_squared() <= 0.0 {
            continue;
        }
        for k in 0..3 {
            let (from, to) = (w[k], w[(k + 1) % 3]);
            halves.push((from.min(to), from.max(to), from < to));
        }
        block += (p0 - centre).dot((p1 - centre).cross(p2 - centre));
        in_block += 1;
        if in_block == VOLUME_BLOCK {
            blocks += block;
            block = 0.0;
            in_block = 0;
        }
    }
    if halves.is_empty() {
        return Solid::Open;
    }
    halves.sort_unstable();
    // Every edge exactly twice, once in each direction: sorted, a pair is (…, false), (…, true).
    for pair in halves.chunks(2) {
        match pair {
            [(lo0, hi0, up0), (lo1, hi1, up1)] if (lo0, hi0) == (lo1, hi1) && !up0 && *up1 => {}
            _ => return Solid::Open,
        }
    }
    // A run of three or more would have split a pair across chunks of different edges (or put two
    // equal directions side by side), so every chunk above was a whole edge. The count of edges
    // must also be even: it is, `chunks(2)` of an odd length ends in a short chunk (open above).
    let extent = (mesh.bounds().max - mesh.bounds().min).max_component();
    let volume = (blocks + block) / 6.0;
    if !volume.is_finite() || volume.abs() <= extent * extent * extent * MIN_VOLUME {
        return Solid::Open;
    }
    if volume > 0.0 {
        Solid::Outward
    } else {
        Solid::Inward
    }
}

/// The solid-ness of a mesh, worked out on first use and kept with it (and its clones), like
/// [`super::edges::EdgeCache`]. Derived data: two caches always compare equal.
#[derive(Clone, Default)]
pub(crate) struct SolidCache(OnceLock<Solid>);

impl SolidCache {
    /// What `mesh` (which must be the mesh holding this cache) is as a solid.
    pub(crate) fn get(&self, mesh: &Mesh) -> Solid {
        *self.0.get_or_init(|| analyse(mesh))
    }
}

impl PartialEq for SolidCache {
    fn eq(&self, _: &SolidCache) -> bool {
        true
    }
}

impl fmt::Debug for SolidCache {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0.get() {
            Some(s) => write!(f, "SolidCache({s:?})"),
            None => f.write_str("SolidCache(not analysed)"),
        }
    }
}

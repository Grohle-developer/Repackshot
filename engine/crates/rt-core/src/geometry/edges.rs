//! The sharp edges of a mesh, for the edge bevel of the shading ([`crate::bevel`], E6).
//!
//! **Extraction** (once per mesh, the first time a bevelled instance needs it, and kept with the
//! mesh across scene updates: [`super::Mesh::sharp_edges`]). Vertices are welded first by their
//! exact position (the bits of the three coordinates, `-0` read as `0`), then those closer than
//! [`WELD_TOLERANCE`] of the mesh's size along every axis (a lathe's seam, whose last ring is its
//! first one up to the rounding of `sin 2π`), so a mesh whose vertices are split along its hard
//! edges, as CAD tessellations and meshes with split normals are, still
//! knows which triangles meet at an edge. Every welded edge then falls in one of three cases:
//!
//! * **one triangle**: a *boundary* edge (an open rim, or the border of a group of faces sent as a
//!   mesh of its own; [`crate::bevel`] looks for the other side in the meshes of the same part);
//! * **two triangles** whose normals, oriented consistently across the edge (the edge runs in
//!   opposite directions in the two triangles of a consistently wound mesh; when it runs the same
//!   way one normal is flipped), are more than [`SHARP_ANGLE_DEG`] apart: a *sharp* edge, unless
//!   the mesh's vertex normals agree across it at both ends (within about 2°): then the mesh
//!   already shades it round and it is left alone;
//! * **three or more** (non-manifold, doubled faces): ignored.
//!
//! Degenerate triangles (no area) take no part. The result is deterministic: it depends only on
//! the mesh, never on hashing or on the order threads run in.
//!
//! **Acceleration.** A binary BVH over the edges' segments (median split of the centroids along
//! the widest axis, at most [`LEAF_EDGES`] edges per leaf), queried with a sphere: the nearest
//! [`MAX_CANDIDATES`] edges within a radius, visiting at most [`MAX_VISITS`] nodes, so the work per
//! shading point is bounded whatever the mesh. Each triangle also stores its **clearance**, a lower
//! bound of its distance to the nearest sharp edge (the distance from its centroid to the nearest
//! edge minus the distance from the centroid to its farthest corner), so that a shading point far
//! from every edge costs one comparison.

use super::Mesh;
use crate::math::Vec3;
use std::fmt;
use std::sync::{Arc, OnceLock};

/// Dihedral angle above which an edge is sharp, in degrees.
pub const SHARP_ANGLE_DEG: f32 = 20.0;
/// `cos 20°`: two faces whose consistently oriented normals have a larger dot product meet at a
/// smooth edge.
const COS_SHARP: f32 = 0.939_692_6;
/// `cos 2°`: two vertex normals at least this close shade an edge continuously.
const COS_SAME_NORMAL: f32 = 0.999_390_8;
/// Most edges in a BVH leaf.
pub const LEAF_EDGES: usize = 4;
/// Most edges a query returns (the nearest ones).
pub const MAX_CANDIDATES: usize = 8;
/// Most BVH nodes a query visits.
pub const MAX_VISITS: usize = 128;
/// "No triangle on this side": the second face of a boundary edge.
pub const NO_FACE: u32 = u32::MAX;
/// Vertices closer than this fraction of the mesh's largest extent (on every axis) are one.
pub const WELD_TOLERANCE: f32 = 1.0e-5;

/// One sharp or boundary edge: its end points (object space) and the triangles on its sides.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SharpEdge {
    /// First end (the welded vertex that comes first in `(x, y, z)` order: the smallest position
    /// among the vertices welded into it).
    pub a: Vec3,
    /// Second end.
    pub b: Vec3,
    /// Per side, `triangle << 3 | forward << 2 | corner`: the triangle, whether its side along the
    /// edge runs from `a` to `b`, and the corner that side starts from (it ends at the next one);
    /// [`NO_FACE`] for the missing side of a boundary edge.
    faces: [u32; 2],
}

/// A side of an edge: the triangle and the corner its side along the edge starts from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EdgeFace {
    /// Triangle index.
    pub triangle: u32,
    /// Corner (0, 1 or 2) the edge starts from; it ends at the next corner.
    pub corner: u32,
    /// The side runs from the edge's `a` to its `b` (the corner `corner` is at `a`).
    pub forward: bool,
}

impl SharpEdge {
    /// The triangle on side `i` (0 or 1), if any.
    pub fn face(&self, i: usize) -> Option<EdgeFace> {
        let f = *self.faces.get(i)?;
        (f != NO_FACE).then_some(EdgeFace {
            triangle: f >> 3,
            corner: f & 3,
            forward: f & 4 != 0,
        })
    }

    /// True for a boundary edge (a triangle on one side only).
    pub fn is_boundary(&self) -> bool {
        self.faces[1] == NO_FACE
    }
}

/// A node of the edge BVH: its box and either two children or a run of edges.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Node {
    lo: Vec3,
    hi: Vec3,
    /// Leaf: index of the first edge. Interior: index of the first child (the second follows).
    start: u32,
    /// Number of edges of a leaf; 0 for an interior node.
    count: u32,
}

/// The nearest edges a query found, nearest first.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Candidates {
    /// `(squared distance, edge index)`, sorted.
    items: [(f32, u32); MAX_CANDIDATES],
    len: usize,
}

impl Candidates {
    pub(crate) const fn new() -> Candidates {
        Candidates {
            items: [(0.0, 0); MAX_CANDIDATES],
            len: 0,
        }
    }

    /// The edges found, nearest first: `(squared distance, edge index)`.
    pub(crate) fn as_slice(&self) -> &[(f32, u32)] {
        &self.items[..self.len]
    }

    /// The largest squared distance still accepted.
    fn bound(&self, radius2: f32) -> f32 {
        if self.len == MAX_CANDIDATES {
            self.items[MAX_CANDIDATES - 1].0.min(radius2)
        } else {
            radius2
        }
    }

    /// Inserts in `(distance, index)` order, dropping the farthest beyond capacity.
    fn insert(&mut self, d2: f32, edge: u32) {
        let key = (d2, edge);
        let mut i = self.len;
        while i > 0 && (self.items[i - 1].0, self.items[i - 1].1) > key {
            i -= 1;
        }
        if i >= MAX_CANDIDATES {
            return;
        }
        let end = self.len.min(MAX_CANDIDATES - 1);
        let mut j = end;
        while j > i {
            self.items[j] = self.items[j - 1];
            j -= 1;
        }
        self.items[i] = key;
        self.len = (self.len + 1).min(MAX_CANDIDATES);
    }
}

/// The sharp and boundary edges of a mesh, their BVH and the clearance of every triangle.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MeshEdges {
    /// The edges, in the order of the BVH's leaves.
    edges: Vec<SharpEdge>,
    nodes: Vec<Node>,
    /// Per triangle: a lower bound of its distance to the nearest edge (infinite without edges).
    clearance: Vec<f32>,
}

/// Squared distance from `p` to the segment `a b`, and the parameter of the closest point.
#[inline]
pub(crate) fn segment_distance2(p: Vec3, a: Vec3, b: Vec3) -> (f32, f32) {
    let ab = b - a;
    let len2 = ab.length_squared();
    let t = if len2 > 0.0 {
        ((p - a).dot(ab) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let q = a + ab * t;
    ((p - q).length_squared(), t)
}

/// Squared distance from `p` to the box `lo hi` (0 inside).
#[inline]
fn box_distance2(p: Vec3, lo: Vec3, hi: Vec3) -> f32 {
    let d = |v: f32, l: f32, h: f32| {
        if v < l {
            l - v
        } else if v > h {
            v - h
        } else {
            0.0
        }
    };
    let (x, y, z) = (d(p.x, lo.x, hi.x), d(p.y, lo.y, hi.y), d(p.z, lo.z, hi.z));
    x * x + y * y + z * z
}

/// The welding key of a position: the bits of its coordinates, `-0` read as `0`.
#[inline]
fn position_key(p: Vec3) -> (u32, u32, u32) {
    let bits = |v: f32| if v == 0.0 { 0 } else { v.to_bits() };
    (bits(p.x), bits(p.y), bits(p.z))
}

/// The welded vertices of a mesh: the weld id of every vertex and the position of every id.
struct Weld {
    ids: Vec<u32>,
    positions: Vec<Vec3>,
}

/// `(x, y, z)` order of positions (IEEE total order per coordinate).
fn position_order(p: Vec3, q: Vec3) -> std::cmp::Ordering {
    p.x.total_cmp(&q.x)
        .then(p.y.total_cmp(&q.y))
        .then(p.z.total_cmp(&q.z))
}

/// Welds the vertices of `mesh`: equal positions, then positions within [`WELD_TOLERANCE`] of the
/// mesh's largest extent on every axis (transitively). Ids follow the `(x, y, z)` order of the
/// welded positions, each the smallest of its vertices; deterministic.
fn weld_vertices(mesh: &Mesh) -> Weld {
    let n = mesh.vertex_count();
    let positions: Vec<Vec3> = (0..n)
        .map(|i| mesh.position(i).unwrap_or_default())
        .collect();
    // Exact positions first: unique positions, in key order.
    let mut order: Vec<u32> = (0..n as u32).collect();
    order.sort_by(|&i, &j| {
        position_key(positions[i as usize])
            .cmp(&position_key(positions[j as usize]))
            .then(i.cmp(&j))
    });
    let mut unique_of = vec![0u32; n];
    let mut unique: Vec<Vec3> = Vec::new();
    let mut last = None;
    for &v in &order {
        let key = position_key(positions[v as usize]);
        if last != Some(key) {
            unique.push(positions[v as usize]);
            last = Some(key);
        }
        unique_of[v as usize] = unique.len() as u32 - 1;
    }
    // Then near ones: cells of twice the tolerance, each unique position against the 27 cells
    // around its own, merged by union-find (the root is the smallest index).
    let bounds = mesh.bounds();
    let extent = if bounds.is_empty() {
        0.0
    } else {
        (bounds.max - bounds.min).max_component()
    };
    let tolerance = extent * WELD_TOLERANCE;
    let mut parent: Vec<u32> = (0..unique.len() as u32).collect();
    fn root(parent: &mut [u32], mut i: u32) -> u32 {
        while parent[i as usize] != i {
            let up = parent[parent[i as usize] as usize];
            parent[i as usize] = up;
            i = up;
        }
        i
    }
    if tolerance > 0.0 && tolerance.is_finite() {
        let cell_size = 2.0 * tolerance;
        let cell = |p: Vec3| -> (i64, i64, i64) {
            let c = |v: f32, lo: f32| ((v - lo) / cell_size).floor() as i64;
            (
                c(p.x, bounds.min.x),
                c(p.y, bounds.min.y),
                c(p.z, bounds.min.z),
            )
        };
        let mut by_cell: Vec<((i64, i64, i64), u32)> = unique
            .iter()
            .enumerate()
            .map(|(i, &p)| (cell(p), i as u32))
            .collect();
        by_cell.sort();
        for (i, &p) in unique.iter().enumerate() {
            let (cx, cy, cz) = cell(p);
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for dz in -1..=1 {
                        let key = (cx + dx, cy + dy, cz + dz);
                        let from = by_cell.partition_point(|e| e.0 < key);
                        for &(k, j) in &by_cell[from..] {
                            if k != key {
                                break;
                            }
                            if j as usize <= i {
                                continue;
                            }
                            let q = unique[j as usize];
                            let d = (p - q).abs();
                            if d.x <= tolerance && d.y <= tolerance && d.z <= tolerance {
                                let (a, b) = (root(&mut parent, i as u32), root(&mut parent, j));
                                let (lo, hi) = (a.min(b), a.max(b));
                                parent[hi as usize] = lo;
                            }
                        }
                    }
                }
            }
        }
    }
    // Every group's position is its smallest; ids in the order of those positions.
    let roots: Vec<u32> = (0..unique.len() as u32)
        .map(|i| root(&mut parent, i))
        .collect();
    let mut smallest: Vec<Vec3> = unique.clone();
    for (i, &r) in roots.iter().enumerate() {
        if position_order(unique[i], smallest[r as usize]).is_lt() {
            smallest[r as usize] = unique[i];
        }
    }
    let mut groups: Vec<u32> = (0..unique.len() as u32)
        .filter(|&i| roots[i as usize] == i)
        .collect();
    groups.sort_by(|&x, &y| {
        position_order(smallest[x as usize], smallest[y as usize]).then(x.cmp(&y))
    });
    let mut id_of_root = vec![0u32; unique.len()];
    for (id, &g) in groups.iter().enumerate() {
        id_of_root[g as usize] = id as u32;
    }
    Weld {
        ids: (0..n)
            .map(|v| id_of_root[roots[unique_of[v] as usize] as usize])
            .collect(),
        positions: groups.iter().map(|&g| smallest[g as usize]).collect(),
    }
}

/// One side of a welded edge, as a triangle sees it.
#[derive(Clone, Copy, Debug)]
struct HalfEdge {
    lo: u32,
    hi: u32,
    triangle: u32,
    corner: u32,
    /// The triangle runs from `lo` to `hi` (else from `hi` to `lo`).
    forward: bool,
}

impl MeshEdges {
    /// Finds the sharp and boundary edges of `mesh` and builds their BVH (see the module
    /// documentation).
    pub fn extract(mesh: &Mesh) -> MeshEdges {
        let triangles = mesh.triangle_count();
        let weld = weld_vertices(mesh);
        let welded_positions = weld.positions;
        let weld = weld.ids;

        // Half edges of every triangle with an area.
        let mut halves = Vec::with_capacity(triangles * 3);
        for t in 0..triangles {
            let (Some(ids), Some([p0, p1, p2])) = (mesh.triangle_indices(t), mesh.triangle(t))
            else {
                continue;
            };
            if (p1 - p0).cross(p2 - p0).length_squared() <= 0.0 {
                continue;
            }
            let w = ids.map(|i| weld[i as usize]);
            for k in 0..3 {
                let (from, to) = (w[k], w[(k + 1) % 3]);
                if from == to {
                    continue;
                }
                halves.push(HalfEdge {
                    lo: from.min(to),
                    hi: from.max(to),
                    triangle: t as u32,
                    corner: k as u32,
                    forward: from < to,
                });
            }
        }
        halves.sort_by(|x, y| {
            (x.lo, x.hi, x.triangle, x.corner).cmp(&(y.lo, y.hi, y.triangle, y.corner))
        });

        let mut edges = Vec::new();
        let mut i = 0;
        while i < halves.len() {
            let mut j = i + 1;
            while j < halves.len() && halves[j].lo == halves[i].lo && halves[j].hi == halves[i].hi {
                j += 1;
            }
            let group = &halves[i..j];
            let pack = |h: &HalfEdge| h.triangle << 3 | u32::from(h.forward) << 2 | h.corner;
            let (a, b) = (
                welded_positions[group[0].lo as usize],
                welded_positions[group[0].hi as usize],
            );
            match group {
                [one] => edges.push(SharpEdge {
                    a,
                    b,
                    faces: [pack(one), NO_FACE],
                }),
                [h0, h1] if sharp_between(mesh, &weld, h0, h1) => edges.push(SharpEdge {
                    a,
                    b,
                    faces: [pack(h0), pack(h1)],
                }),
                _ => {}
            }
            i = j;
        }

        let mut out = MeshEdges {
            edges: Vec::new(),
            nodes: Vec::new(),
            clearance: Vec::new(),
        };
        out.build(edges);
        out.clearance = (0..triangles)
            .map(|t| match mesh.triangle(t) {
                Some([p0, p1, p2]) if !out.edges.is_empty() => {
                    let c = (p0 + p1 + p2) * (1.0 / 3.0);
                    let reach = (p0 - c)
                        .length()
                        .max((p1 - c).length())
                        .max((p2 - c).length());
                    (out.nearest_distance(c) - reach).max(0.0)
                }
                _ => f32::INFINITY,
            })
            .collect();
        out
    }

    /// The edges, in the order of the BVH's leaves.
    pub fn edges(&self) -> &[SharpEdge] {
        &self.edges
    }

    /// True when the mesh has no sharp or boundary edge.
    pub fn is_empty(&self) -> bool {
        self.edges.is_empty()
    }

    /// A lower bound of the distance from triangle `t` to the nearest edge (infinite when the mesh
    /// has none or `t` is out of range).
    pub fn clearance(&self, t: u32) -> f32 {
        self.clearance
            .get(t as usize)
            .copied()
            .unwrap_or(f32::INFINITY)
    }

    /// Builds the BVH over `edges`, storing them in leaf order.
    fn build(&mut self, edges: Vec<SharpEdge>) {
        if edges.is_empty() {
            return;
        }
        let centroids: Vec<Vec3> = edges.iter().map(|e| (e.a + e.b) * 0.5).collect();
        let mut items: Vec<u32> = (0..edges.len() as u32).collect();
        self.nodes.push(Node {
            lo: Vec3::ZERO,
            hi: Vec3::ZERO,
            start: 0,
            count: 0,
        });
        // (node, first item, item count)
        let mut stack = vec![(0usize, 0usize, items.len())];
        while let Some((node, first, count)) = stack.pop() {
            let range = &mut items[first..first + count];
            let (mut lo, mut hi) = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
            let (mut clo, mut chi) = (lo, hi);
            for &e in range.iter() {
                let edge = &edges[e as usize];
                lo = lo.min(edge.a).min(edge.b);
                hi = hi.max(edge.a).max(edge.b);
                clo = clo.min(centroids[e as usize]);
                chi = chi.max(centroids[e as usize]);
            }
            let extent = chi - clo;
            let axis = if extent.x >= extent.y && extent.x >= extent.z {
                0
            } else if extent.y >= extent.z {
                1
            } else {
                2
            };
            if count <= LEAF_EDGES || extent[axis] <= 0.0 {
                self.nodes[node] = Node {
                    lo,
                    hi,
                    start: first as u32,
                    count: count as u32,
                };
                continue;
            }
            range.sort_by(|&x, &y| {
                centroids[x as usize][axis]
                    .total_cmp(&centroids[y as usize][axis])
                    .then(x.cmp(&y))
            });
            let left = self.nodes.len();
            self.nodes.push(self.nodes[node]);
            self.nodes.push(self.nodes[node]);
            self.nodes[node] = Node {
                lo,
                hi,
                start: left as u32,
                count: 0,
            };
            let half = count / 2;
            // Right first, so the left subtree is built (and numbered) first.
            stack.push((left + 1, first + half, count - half));
            stack.push((left, first, half));
        }
        self.edges = items.iter().map(|&e| edges[e as usize]).collect();
    }

    /// Distance from `p` to the nearest edge (infinite without edges).
    fn nearest_distance(&self, p: Vec3) -> f32 {
        if self.nodes.is_empty() {
            return f32::INFINITY;
        }
        let mut best = f32::INFINITY;
        let mut stack = [0u32; 64];
        let mut top = 1usize;
        while top > 0 {
            top -= 1;
            let node = self.nodes[stack[top] as usize];
            if box_distance2(p, node.lo, node.hi) >= best {
                continue;
            }
            if node.count > 0 {
                for e in &self.edges[node.start as usize..(node.start + node.count) as usize] {
                    best = best.min(segment_distance2(p, e.a, e.b).0);
                }
                continue;
            }
            let (l, r) = (node.start, node.start + 1);
            let dl = box_distance2(p, self.nodes[l as usize].lo, self.nodes[l as usize].hi);
            let dr = box_distance2(p, self.nodes[r as usize].lo, self.nodes[r as usize].hi);
            // Nearer child last, so it is visited first.
            let (near, far) = if dl <= dr { (l, r) } else { (r, l) };
            if top + 2 <= stack.len() {
                stack[top] = far;
                stack[top + 1] = near;
                top += 2;
            } else {
                // Deeper than any median split of 2^60 edges: visit only the nearer child.
                stack[top] = near;
                top += 1;
            }
        }
        best.sqrt()
    }

    /// The nearest edges (at most [`MAX_CANDIDATES`]) whose segment is within `radius` of `p`,
    /// visiting at most [`MAX_VISITS`] nodes.
    pub(crate) fn within(&self, p: Vec3, radius: f32) -> Candidates {
        let mut found = Candidates::new();
        if self.nodes.is_empty() || radius.is_nan() || radius <= 0.0 {
            return found;
        }
        let radius2 = radius * radius;
        let mut stack = [0u32; 64];
        let mut top = 1usize;
        let mut visits = 0usize;
        while top > 0 && visits < MAX_VISITS {
            top -= 1;
            visits += 1;
            let node = self.nodes[stack[top] as usize];
            if box_distance2(p, node.lo, node.hi) > found.bound(radius2) {
                continue;
            }
            if node.count > 0 {
                let first = node.start as usize;
                for (k, e) in self.edges[first..first + node.count as usize]
                    .iter()
                    .enumerate()
                {
                    let d2 = segment_distance2(p, e.a, e.b).0;
                    if d2 <= found.bound(radius2) {
                        found.insert(d2, (first + k) as u32);
                    }
                }
                continue;
            }
            let (l, r) = (node.start, node.start + 1);
            let dl = box_distance2(p, self.nodes[l as usize].lo, self.nodes[l as usize].hi);
            let dr = box_distance2(p, self.nodes[r as usize].lo, self.nodes[r as usize].hi);
            let (near, far) = if dl <= dr { (l, r) } else { (r, l) };
            if top + 2 <= stack.len() {
                stack[top] = far;
                stack[top + 1] = near;
                top += 2;
            } else {
                stack[top] = near;
                top += 1;
            }
        }
        found
    }
}

/// A mesh's [`MeshEdges`], extracted the first time they are asked for and shared by the clones of
/// the mesh. It is derived data: two caches always compare equal, so a mesh compares by its
/// geometry only.
#[derive(Clone, Default)]
pub(crate) struct EdgeCache(OnceLock<Arc<MeshEdges>>);

impl EdgeCache {
    /// The edges of `mesh` (which must be the mesh holding this cache).
    pub(crate) fn get(&self, mesh: &Mesh) -> &MeshEdges {
        self.0.get_or_init(|| Arc::new(MeshEdges::extract(mesh)))
    }
}

impl PartialEq for EdgeCache {
    fn eq(&self, _: &EdgeCache) -> bool {
        true
    }
}

impl fmt::Debug for EdgeCache {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0.get() {
            Some(e) => write!(f, "EdgeCache({} edges)", e.edges.len()),
            None => f.write_str("EdgeCache(not extracted)"),
        }
    }
}

/// The unit normal of triangle `t` as wound.
pub(crate) fn winding_normal(mesh: &Mesh, t: u32) -> Vec3 {
    match mesh.triangle(t as usize) {
        Some([p0, p1, p2]) => (p1 - p0).cross(p2 - p0).normalize(),
        None => Vec3::ZERO,
    }
}

/// True when the two triangles of a welded edge meet at a sharp edge (module documentation).
fn sharp_between(mesh: &Mesh, weld: &[u32], h0: &HalfEdge, h1: &HalfEdge) -> bool {
    let n0 = winding_normal(mesh, h0.triangle);
    let mut n1 = winding_normal(mesh, h1.triangle);
    if h0.forward == h1.forward {
        n1 = -n1; // wound inconsistently across the edge
    }
    if n0.dot(n1) > COS_SHARP {
        return false;
    }
    if !mesh.has_normals() {
        return true;
    }
    // The vertex normal each triangle uses at a welded vertex.
    let corner_normal = |h: &HalfEdge, welded: u32| -> Option<Vec3> {
        let ids = mesh.triangle_indices(h.triangle as usize)?;
        let id = ids.into_iter().find(|&i| weld[i as usize] == welded)?;
        mesh.normal(id as usize).map(Vec3::normalize)
    };
    let same = |welded: u32| match (corner_normal(h0, welded), corner_normal(h1, welded)) {
        (Some(a), Some(b)) => a != Vec3::ZERO && a.dot(b) >= COS_SAME_NORMAL,
        _ => false,
    };
    !(same(h0.lo) && same(h0.hi))
}

#[cfg(test)]
/// An axis-aligned box from `lo` to `hi`, 24 vertices (split per face) with face normals
/// when `normals`, outward and counter-clockwise.
pub(crate) fn faceted_box(lo: Vec3, hi: Vec3, normals: bool) -> Mesh {
    let c = |x: usize, y: usize, z: usize| {
        Vec3::new(
            if x == 0 { lo.x } else { hi.x },
            if y == 0 { lo.y } else { hi.y },
            if z == 0 { lo.z } else { hi.z },
        )
    };
    // Each face: four corners counter-clockwise seen from outside, and its normal.
    let faces = [
        (
            [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)],
            Vec3::new(0.0, 0.0, -1.0),
        ),
        (
            [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
            Vec3::new(0.0, 0.0, 1.0),
        ),
        (
            [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
            Vec3::new(0.0, -1.0, 0.0),
        ),
        (
            [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
            Vec3::new(0.0, 1.0, 0.0),
        ),
        (
            [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)],
            Vec3::new(-1.0, 0.0, 0.0),
        ),
        (
            [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
            Vec3::new(1.0, 0.0, 0.0),
        ),
    ];
    let mut p = Vec::new();
    let mut n = Vec::new();
    let mut idx = Vec::new();
    for (quad, normal) in faces {
        let base = p.len() as u32;
        p.extend_from_slice(&quad);
        n.extend_from_slice(&[normal; 4]);
        idx.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    Mesh::new(&p, if normals { &n } else { &[] }, &idx, 0).expect("box")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_faceted_box_has_its_twelve_edges() {
        for normals in [false, true] {
            let mesh = faceted_box(Vec3::ZERO, Vec3::splat(10.0), normals);
            let edges = MeshEdges::extract(&mesh);
            assert_eq!(edges.edges().len(), 12, "normals {normals}");
            assert!(edges.edges().iter().all(|e| !e.is_boundary()));
            for e in edges.edges() {
                assert!(((e.b - e.a).length() - 10.0).abs() < 1.0e-5);
            }
            // Every triangle touches an edge.
            assert!((0..12).all(|t| edges.clearance(t) == 0.0));
        }
    }

    #[test]
    fn smooth_normals_across_an_edge_make_it_round() {
        // The icosphere's facets meet at less than 20°, and its normals are shared: no edges.
        let sphere = crate::example::icosphere(Vec3::ZERO, 50.0, 2);
        assert!(MeshEdges::extract(&sphere).is_empty());
        // A coarse one (the icosahedron, 41.8° between faces) with shared normals: still none,
        // the vertex normals already round it; without normals every edge is sharp.
        let coarse = crate::example::icosphere(Vec3::ZERO, 50.0, 0);
        assert!(MeshEdges::extract(&coarse).is_empty());
        let positions: Vec<Vec3> = (0..coarse.vertex_count())
            .filter_map(|i| coarse.position(i))
            .collect();
        let flat = Mesh::new(&positions, &[], coarse.indices(), 0).expect("flat");
        assert_eq!(MeshEdges::extract(&flat).edges().len(), 30);
    }

    #[test]
    fn open_rims_are_boundary_edges_and_inconsistent_winding_is_tolerated() {
        // A flat quad: four boundary edges, no interior edge (its diagonal is flat).
        let quad = Mesh::new(
            &[
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(1.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            &[],
            &[0, 1, 2, 0, 2, 3],
            0,
        )
        .expect("quad");
        let edges = MeshEdges::extract(&quad);
        assert_eq!(edges.edges().len(), 4);
        assert!(edges.edges().iter().all(SharpEdge::is_boundary));
        // The same quad with its second triangle wound the other way: the diagonal is still
        // flat (the normals are compared consistently oriented).
        let flipped = Mesh::new(
            &[
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(1.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            &[],
            &[0, 1, 2, 0, 3, 2],
            0,
        )
        .expect("quad");
        assert_eq!(MeshEdges::extract(&flipped).edges().len(), 4);
    }

    #[test]
    fn a_seam_off_by_rounding_is_welded() {
        // A tube whose last column of vertices repeats the first one, as a lathe makes it: the
        // copy is off by the rounding of sin 2π (a few 1e-7 of the size), which an exact weld
        // would leave as two open rims down the seam.
        let (sides, rows) = (24u32, 4u32);
        let mut p = Vec::new();
        for j in 0..=sides {
            let a = std::f32::consts::TAU * j as f32 / sides as f32;
            for i in 0..rows {
                p.push(Vec3::new(14.0 * a.cos(), 14.0 * a.sin(), 3.0 * i as f32));
            }
        }
        assert_ne!(
            p[0],
            p[(sides * rows) as usize],
            "the seam must be off by rounding"
        );
        let mut idx = Vec::new();
        for j in 0..sides {
            for i in 0..rows - 1 {
                let (a, b) = (j * rows + i, (j + 1) * rows + i);
                idx.extend_from_slice(&[a, b, b + 1, a, b + 1, a + 1]);
            }
        }
        let tube = Mesh::new(&p, &[], &idx, 0).expect("tube");
        let edges = MeshEdges::extract(&tube);
        // Only the two open ends remain: 2 x 24 boundary edges, nothing along the seam (the
        // 15° between the tube's facets is not sharp).
        assert_eq!(edges.edges().len(), 2 * sides as usize);
        assert!(edges
            .edges()
            .iter()
            .all(|e| e.is_boundary() && e.a.z == e.b.z));
    }

    #[test]
    fn queries_match_brute_force_and_are_bounded() {
        // A flat-shaded icosphere subdivided once (80 facets).
        let ico = crate::example::icosphere(Vec3::ZERO, 40.0, 1);
        let positions: Vec<Vec3> = (0..ico.vertex_count())
            .filter_map(|i| ico.position(i))
            .collect();
        let flat = Mesh::new(&positions, &[], ico.indices(), 0).expect("flat");
        let edges = MeshEdges::extract(&flat);
        assert!(edges.edges().len() > 50);
        let mut rng = crate::rng::Pcg32::seeded(7, 1);
        for _ in 0..500 {
            let p = Vec3::new(
                rng.next_f32() * 100.0 - 50.0,
                rng.next_f32() * 100.0 - 50.0,
                rng.next_f32() * 100.0 - 50.0,
            );
            let radius = rng.next_f32() * 20.0;
            let mut brute: Vec<(f32, u32)> = edges
                .edges()
                .iter()
                .enumerate()
                .map(|(i, e)| (segment_distance2(p, e.a, e.b).0, i as u32))
                .filter(|&(d2, _)| d2 <= radius * radius)
                .collect();
            brute.sort_by(|x, y| x.partial_cmp(y).expect("finite"));
            brute.truncate(MAX_CANDIDATES);
            assert_eq!(edges.within(p, radius).as_slice(), &brute[..]);
            let nearest = brute_nearest(&edges, p);
            assert_eq!(edges.nearest_distance(p), nearest);
        }
        // Clearance is a lower bound of the distance from any point of the triangle.
        for t in 0..flat.triangle_count() {
            let [p0, p1, p2] = flat.triangle(t).expect("triangle");
            for (u, v) in [(0.2, 0.3), (0.6, 0.1), (0.05, 0.9), (1.0 / 3.0, 1.0 / 3.0)] {
                let p = p0 + (p1 - p0) * u + (p2 - p0) * v;
                assert!(edges.clearance(t as u32) <= brute_nearest(&edges, p) + 1.0e-4);
            }
        }
    }

    fn brute_nearest(edges: &MeshEdges, p: Vec3) -> f32 {
        edges
            .edges()
            .iter()
            .map(|e| segment_distance2(p, e.a, e.b).0)
            .fold(f32::INFINITY, f32::min)
            .sqrt()
    }

    #[test]
    fn extraction_is_deterministic() {
        let mesh = faceted_box(Vec3::new(-3.0, 1.0, 2.0), Vec3::new(4.0, 9.0, 5.5), true);
        assert_eq!(MeshEdges::extract(&mesh), MeshEdges::extract(&mesh));
    }
}

//! Convex hulls: our own quickhull (Barber, Dobkin and Huhdanpaa, "The Quickhull Algorithm for
//! Convex Hulls", ACM TOMS 22(4), 1996: the algorithm as the paper describes it, the code ours),
//! the merge of its coplanar triangles into polygon faces, the oriented box a hull falls back to,
//! and the mass properties of a convex solid.
//!
//! **Quickhull.** Start from the tetrahedron of four extreme points; every other point outside a
//! face goes to the outside set of the face it is farthest above. While a face has an outside
//! set: its farthest point is the *eye*; the faces it sees (found by walking the adjacency from
//! that face) are removed, their boundary (the horizon, in order) is joined to the eye by new
//! triangles, and the orphaned points go to the new face they are farthest above (or are inside
//! now). Faces, points and ties are always taken in index order, and the tolerance is relative to
//! the size of the cloud, so the same points give the same hull on every platform.
//!
//! **Faces.** Adjacent triangles whose planes agree are merged into one convex polygon (a box has
//! six faces, not twelve triangles): the clipping of contact manifolds and the separating axes need
//! the real faces.
//!
//! **Mass.** Volume, centre of mass and inertia from the tetrahedra of each face fan with an
//! interior point (the covariance of a tetrahedron is `det/120 (Σ vᵢvᵢᵀ + (Σ vᵢ)(Σ vᵢ)ᵀ)`, Blow and
//! Binstock 2004, "How to find the inertia tensor of a 3D solid", public notes).

use crate::math::{above, Mat3};
use rt_core::math::Vec3;

/// A hull with more vertices than this falls back to its oriented box (the separating-axis test
/// of two hulls costs about the product of their edge counts).
pub const HULL_VERTEX_CAP: usize = 128;

/// Two adjacent triangles are one face when their normals differ by less than about 0.25°.
const MERGE_COS: f32 = 0.99999;

/// A convex polyhedron: vertices, polygon faces (counter-clockwise seen from outside) and its
/// edges with the two faces that meet at each.
#[derive(Clone, Debug, PartialEq)]
pub struct Hull {
    /// The vertices.
    pub vertices: Vec<Vec3>,
    /// Outward unit normal of each face.
    pub normals: Vec<Vec3>,
    /// `normal · p` for the points `p` of each face.
    pub offsets: Vec<f32>,
    /// The vertex indices of all faces, one loop after another.
    pub loops: Vec<u32>,
    /// Where each face's loop starts in `loops`; `loop_start[faces]` is `loops.len()`.
    pub loop_start: Vec<u32>,
    /// Edges: the two vertices, the face on whose loop `a → b` runs, and the face across.
    pub edges: Vec<Edge>,
}

/// An edge of a hull.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Edge {
    /// First vertex.
    pub a: u32,
    /// Second vertex.
    pub b: u32,
    /// The face whose loop runs `a → b`.
    pub left: u32,
    /// The face whose loop runs `b → a`.
    pub right: u32,
}

/// Why a set of points has no hull.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HullError {
    /// Fewer than four points, or all of them on a plane, a line or a point.
    Degenerate,
}

/// Volume, centre of mass and inertia of a solid of unit density.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MassProperties {
    /// mm³.
    pub volume: f32,
    /// Centre of mass, in the coordinates of the hull.
    pub center: Vec3,
    /// Inertia tensor about the centre of mass for unit density (mm⁵); times the density it is the
    /// inertia.
    pub inertia: Mat3,
}

impl Hull {
    /// Number of faces.
    pub fn face_count(&self) -> usize {
        self.normals.len()
    }

    /// The vertex indices of face `f`.
    pub fn face(&self, f: usize) -> &[u32] {
        &self.loops[self.loop_start[f] as usize..self.loop_start[f + 1] as usize]
    }

    /// The hull of `points`. It may have more than [`HULL_VERTEX_CAP`] vertices; [`Hull::build`]
    /// applies the cap.
    pub fn quickhull(points: &[Vec3]) -> Result<Hull, HullError> {
        let (tris, eps) = quickhull_triangles(points)?;
        Ok(merge_faces(points, &tris, eps))
    }

    /// The hull of `points`, or their oriented box when the hull is degenerate (a flat part gets a
    /// box `min_thickness` thick) or has more than [`HULL_VERTEX_CAP`] vertices. The second value
    /// says which.
    pub fn build(points: &[Vec3], min_thickness: f32) -> (Hull, HullKind) {
        match Hull::quickhull(points) {
            Ok(h) if h.vertices.len() <= HULL_VERTEX_CAP => (h, HullKind::Hull),
            Ok(_) => (oriented_box(points, min_thickness), HullKind::OrientedBox),
            Err(HullError::Degenerate) => {
                (oriented_box(points, min_thickness), HullKind::OrientedBox)
            }
        }
    }

    /// The box with centre `center`, unit axes `axes` (a right-handed frame) and half extents
    /// `half`.
    pub fn cuboid(center: Vec3, axes: [Vec3; 3], half: Vec3) -> Hull {
        let mut vertices = Vec::with_capacity(8);
        for i in 0..8u32 {
            let sx = if i & 1 != 0 { 1.0 } else { -1.0 };
            let sy = if i & 2 != 0 { 1.0 } else { -1.0 };
            let sz = if i & 4 != 0 { 1.0 } else { -1.0 };
            vertices.push(
                center
                    + axes[0] * (sx * half.x)
                    + axes[1] * (sy * half.y)
                    + axes[2] * (sz * half.z),
            );
        }
        // Counter-clockwise from outside: -x, +x, -y, +y, -z, +z.
        let faces: [[u32; 4]; 6] = [
            [0, 4, 6, 2],
            [1, 3, 7, 5],
            [0, 1, 5, 4],
            [2, 6, 7, 3],
            [0, 2, 3, 1],
            [4, 5, 7, 6],
        ];
        let mut loops = Vec::with_capacity(24);
        let mut loop_start = Vec::with_capacity(7);
        for f in faces.iter() {
            loop_start.push(loops.len() as u32);
            loops.extend_from_slice(f);
        }
        loop_start.push(loops.len() as u32);
        finish(vertices, loops, loop_start)
    }

    /// The hull translated by `-c` (so `c` becomes its origin).
    pub fn recentred(&self, c: Vec3) -> Hull {
        let mut h = self.clone();
        for v in h.vertices.iter_mut() {
            *v -= c;
        }
        for (f, off) in h.offsets.iter_mut().enumerate() {
            *off -= h.normals[f].dot(c);
        }
        h
    }

    /// Distance of the farthest vertex from the origin.
    pub fn radius(&self) -> f32 {
        self.vertices.iter().fold(0.0f32, |a, v| a.max(v.length()))
    }

    /// Volume, centre and inertia for unit density.
    pub fn mass_properties(&self) -> MassProperties {
        let n = self.vertices.len().max(1) as f32;
        let mut origin = Vec3::ZERO;
        for v in &self.vertices {
            origin += *v;
        }
        origin = origin / n;
        let mut volume6 = 0.0f32;
        let mut first = Vec3::ZERO;
        let mut second = Mat3::ZERO;
        for f in 0..self.face_count() {
            let ids = self.face(f);
            let a = self.vertices[ids[0] as usize] - origin;
            for k in 1..ids.len().saturating_sub(1) {
                let b = self.vertices[ids[k] as usize] - origin;
                let c = self.vertices[ids[k + 1] as usize] - origin;
                let det = a.dot(b.cross(c));
                let s = a + b + c;
                volume6 += det;
                first += s * det;
                let cov = Mat3::outer(a, a)
                    .add(&Mat3::outer(b, b))
                    .add(&Mat3::outer(c, c))
                    .add(&Mat3::outer(s, s));
                second = second.add(&cov.scale(det));
            }
        }
        let volume = volume6 / 6.0;
        if !above(volume, 0.0) {
            return MassProperties {
                volume: 0.0,
                center: origin,
                inertia: Mat3::ZERO,
            };
        }
        // Centroid of each tetrahedron is s/4, weighted by det/6.
        let g = first / (4.0 * volume6);
        let cov = second
            .scale(1.0 / 120.0)
            .add(&Mat3::outer(g, g).scale(-volume));
        let inertia = Mat3::IDENTITY.scale(cov.trace()).add(&cov.scale(-1.0));
        MassProperties {
            volume,
            center: origin + g,
            inertia,
        }
    }
}

/// Where a body's hull came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HullKind {
    /// The convex hull of the points.
    Hull,
    /// Their oriented box: the hull was degenerate or over [`HULL_VERTEX_CAP`].
    OrientedBox,
}

/// Normals, offsets and edges of a hull given its vertices and face loops.
fn finish(vertices: Vec<Vec3>, loops: Vec<u32>, loop_start: Vec<u32>) -> Hull {
    let faces = loop_start.len() - 1;
    let mut normals = Vec::with_capacity(faces);
    let mut offsets = Vec::with_capacity(faces);
    for f in 0..faces {
        let ids = &loops[loop_start[f] as usize..loop_start[f + 1] as usize];
        // Newell's normal of the polygon.
        let mut nrm = Vec3::ZERO;
        let mut centre = Vec3::ZERO;
        for (k, &i) in ids.iter().enumerate() {
            let p = vertices[i as usize];
            let q = vertices[ids[(k + 1) % ids.len()] as usize];
            nrm += Vec3::new(
                (p.y - q.y) * (p.z + q.z),
                (p.z - q.z) * (p.x + q.x),
                (p.x - q.x) * (p.y + q.y),
            );
            centre += p;
        }
        let nrm = nrm.normalize();
        centre = centre / ids.len() as f32;
        normals.push(nrm);
        offsets.push(nrm.dot(centre));
    }
    // Edges: each directed boundary edge once, paired with its twin.
    let mut half: Vec<(u32, u32, u32)> = Vec::with_capacity(loops.len());
    for f in 0..faces {
        let ids = &loops[loop_start[f] as usize..loop_start[f + 1] as usize];
        for k in 0..ids.len() {
            half.push((ids[k], ids[(k + 1) % ids.len()], f as u32));
        }
    }
    let mut sorted: Vec<(u32, u32, u32)> = half.clone();
    sorted.sort_unstable();
    let find = |a: u32, b: u32| -> Option<u32> {
        sorted
            .binary_search_by(|e| (e.0, e.1).cmp(&(a, b)))
            .ok()
            .map(|i| sorted[i].2)
    };
    let mut edges = Vec::new();
    for &(a, b, f) in &half {
        if a < b {
            let right = find(b, a).unwrap_or(f);
            edges.push(Edge {
                a,
                b,
                left: f,
                right,
            });
        } else if find(b, a).is_none() {
            // An open boundary (cannot happen on a closed hull): keep the edge once.
            edges.push(Edge {
                a,
                b,
                left: f,
                right: f,
            });
        }
    }
    Hull {
        vertices,
        normals,
        offsets,
        loops,
        loop_start,
        edges,
    }
}

// ---------------------------------------------------------------------------------------------
// Quickhull
// ---------------------------------------------------------------------------------------------

const DEAD: u32 = u32::MAX;

struct Tri {
    v: [u32; 3],
    n: Vec3,
    d: f32,
    /// Face across edge `i` (`v[i] → v[i + 1]`).
    adj: [u32; 3],
    outside: Vec<u32>,
    alive: bool,
}

impl Tri {
    fn new(points: &[Vec3], v: [u32; 3]) -> Tri {
        let a = points[v[0] as usize];
        let b = points[v[1] as usize];
        let c = points[v[2] as usize];
        let n = (b - a).cross(c - a).normalize();
        Tri {
            v,
            n,
            d: n.dot(a),
            adj: [DEAD; 3],
            outside: Vec::new(),
            alive: true,
        }
    }

    fn distance(&self, p: Vec3) -> f32 {
        self.n.dot(p) - self.d
    }
}

/// The triangles of the hull of `points` (indices into `points`), counter-clockwise from outside.
/// Also returns the tolerance it used.
fn quickhull_triangles(points: &[Vec3]) -> Result<(Vec<[u32; 3]>, f32), HullError> {
    if points.len() < 4 || points.iter().any(|p| !p.is_finite()) {
        return Err(HullError::Degenerate);
    }
    // Tolerance: a point closer than this to a plane is on it.
    let mut lo = points[0];
    let mut hi = points[0];
    let mut sum = Vec3::ZERO;
    for p in points {
        lo = lo.min(*p);
        hi = hi.max(*p);
    }
    for p in points {
        sum = sum.max(p.abs());
    }
    let extent = (hi - lo).length();
    let eps = 3.0 * f32::EPSILON * (sum.x + sum.y + sum.z) + 1e-5 * extent;
    if !above(extent, 0.0) {
        return Err(HullError::Degenerate);
    }

    // The initial tetrahedron: the extremes of the widest axis, the point farthest from their
    // line, the point farthest from the plane of the three.
    let size = hi - lo;
    let axis = if size.x >= size.y && size.x >= size.z {
        0
    } else if size.y >= size.z {
        1
    } else {
        2
    };
    let coord = |p: Vec3| match axis {
        0 => p.x,
        1 => p.y,
        _ => p.z,
    };
    let (mut i0, mut i1) = (0usize, 0usize);
    for (i, p) in points.iter().enumerate() {
        if coord(*p) < coord(points[i0]) {
            i0 = i;
        }
        if coord(*p) > coord(points[i1]) {
            i1 = i;
        }
    }
    let a = points[i0];
    let ab = points[i1] - a;
    if !above(ab.length(), eps) {
        return Err(HullError::Degenerate);
    }
    let (mut i2, mut best) = (usize::MAX, 0.0f32);
    for (i, p) in points.iter().enumerate() {
        let d = ab.cross(*p - a).length();
        if d > best {
            best = d;
            i2 = i;
        }
    }
    if i2 == usize::MAX || !above(best / ab.length(), eps) {
        return Err(HullError::Degenerate);
    }
    let n0 = ab.cross(points[i2] - a).normalize();
    let (mut i3, mut best) = (usize::MAX, 0.0f32);
    for (i, p) in points.iter().enumerate() {
        let d = n0.dot(*p - a).abs();
        if d > best {
            best = d;
            i3 = i;
        }
    }
    if i3 == usize::MAX || !above(best, eps) {
        return Err(HullError::Degenerate);
    }
    let (i0, i1, i2, i3) = (i0 as u32, i1 as u32, i2 as u32, i3 as u32);
    let mut tris: Vec<Tri> = Vec::new();
    // Base and three sides, all counter-clockwise from outside: the apex is below the base.
    let apex = i3;
    let base = if Tri::new(points, [i0, i1, i2]).distance(points[apex as usize]) > 0.0 {
        [i0, i2, i1]
    } else {
        [i0, i1, i2]
    };
    let [b0, b1, b2] = base;
    tris.push(Tri::new(points, [b0, b1, b2]));
    tris.push(Tri::new(points, [b1, b0, apex]));
    tris.push(Tri::new(points, [b2, b1, apex]));
    tris.push(Tri::new(points, [b0, b2, apex]));
    link_all(&mut tris);

    // Outside sets: each point goes to the face it is farthest above.
    let seeds = [b0, b1, b2, apex];
    for (i, p) in points.iter().enumerate() {
        if seeds.contains(&(i as u32)) {
            continue;
        }
        assign(&mut tris, &[0, 1, 2, 3], i as u32, *p, eps);
    }

    while let Some(f) = (0..tris.len()).find(|&f| tris[f].alive && !tris[f].outside.is_empty()) {
        // The eye: the farthest outside point (the first one on a tie).
        let mut eye = tris[f].outside[0];
        let mut far = tris[f].distance(points[eye as usize]);
        for &i in &tris[f].outside[1..] {
            let d = tris[f].distance(points[i as usize]);
            if d > far {
                far = d;
                eye = i;
            }
        }
        let p = points[eye as usize];
        let Some((visible, horizon)) = horizon(&tris, f, p, eps) else {
            // Numerically stuck: drop the point.
            tris[f].outside.retain(|&i| i != eye);
            continue;
        };
        // New faces joining the horizon to the eye.
        let first = tris.len();
        let count = horizon.len();
        for (k, h) in horizon.iter().enumerate() {
            let mut t = Tri::new(points, [h.a, h.b, eye]);
            t.adj[0] = h.across;
            t.adj[1] = (first + (k + 1) % count) as u32;
            t.adj[2] = (first + (k + count - 1) % count) as u32;
            tris[h.across as usize].adj[h.across_edge as usize] = (first + k) as u32;
            tris.push(t);
        }
        // The orphans go to the new faces (or are inside now).
        let mut orphans = Vec::new();
        for &v in &visible {
            let t = &mut tris[v as usize];
            t.alive = false;
            orphans.append(&mut t.outside);
        }
        let new_faces: Vec<u32> = (first..first + count).map(|i| i as u32).collect();
        for i in orphans {
            if i == eye {
                continue;
            }
            assign(&mut tris, &new_faces, i, points[i as usize], eps);
        }
        if tris.len() > 64 * points.len() + 64 {
            // Cannot happen with consistent arithmetic; a guard against a loop on garbage input.
            return Err(HullError::Degenerate);
        }
    }
    Ok((tris.iter().filter(|t| t.alive).map(|t| t.v).collect(), eps))
}

/// Sets the adjacency of a closed set of triangles from their shared edges.
fn link_all(tris: &mut [Tri]) {
    for i in 0..tris.len() {
        for e in 0..3 {
            let (a, b) = (tris[i].v[e], tris[i].v[(e + 1) % 3]);
            let across = (0..tris.len()).find(|&j| {
                j != i && (0..3).any(|k| tris[j].v[k] == b && tris[j].v[(k + 1) % 3] == a)
            });
            if let Some(j) = across {
                tris[i].adj[e] = j as u32;
            }
        }
    }
}

/// Puts point `i` in the outside set of the face of `faces` it is farthest above, if any.
fn assign(tris: &mut [Tri], faces: &[u32], i: u32, p: Vec3, eps: f32) {
    let mut best = DEAD;
    let mut far = eps;
    for &f in faces {
        let d = tris[f as usize].distance(p);
        if d > far {
            far = d;
            best = f;
        }
    }
    if best != DEAD {
        tris[best as usize].outside.push(i);
    }
}

struct HorizonEdge {
    a: u32,
    b: u32,
    /// The face beyond the horizon, and which of its edges this is.
    across: u32,
    across_edge: u32,
}

/// The faces the point `p` sees, starting from `start`, and their boundary as one closed chain
/// (`b` of each edge is `a` of the next), or `None` when the arithmetic does not give one.
fn horizon(tris: &[Tri], start: usize, p: Vec3, eps: f32) -> Option<(Vec<u32>, Vec<HorizonEdge>)> {
    let mut visited = vec![false; tris.len()];
    let mut visible = vec![start as u32];
    let mut edges = Vec::new();
    visited[start] = true;
    // (face, the edges to look at in order, how many, how many done).
    let mut stack: Vec<(usize, [u8; 3], u8, u8)> = vec![(start, [0, 1, 2], 3, 0)];
    while let Some(top) = stack.last_mut() {
        let (f, order, len, k) = *top;
        if k >= len {
            stack.pop();
            continue;
        }
        top.3 += 1;
        let e = order[k as usize] as usize;
        let g = tris[f].adj[e] as usize;
        if g >= tris.len() || visited[g] {
            continue;
        }
        let back = (0..3).find(|&j| tris[g].adj[j] as usize == f)?;
        if tris[g].distance(p) > eps {
            visited[g] = true;
            visible.push(g as u32);
            // Enter g across its edge back to f, and look at its other two edges in order.
            stack.push((g, [((back + 1) % 3) as u8, ((back + 2) % 3) as u8, 0], 2, 0));
        } else {
            edges.push(HorizonEdge {
                a: tris[f].v[e],
                b: tris[f].v[(e + 1) % 3],
                across: g as u32,
                across_edge: back as u32,
            });
        }
    }
    // Chain the edges from the first one.
    if edges.len() < 3 {
        return None;
    }
    let mut chain = Vec::with_capacity(edges.len());
    let mut used = vec![false; edges.len()];
    let mut at = 0usize;
    for _ in 0..edges.len() {
        used[at] = true;
        let next = edges[at].b;
        chain.push(at);
        if chain.len() == edges.len() {
            break;
        }
        at = (0..edges.len()).find(|&k| !used[k] && edges[k].a == next)?;
    }
    if edges[chain[chain.len() - 1]].b != edges[chain[0]].a {
        return None;
    }
    let ordered = chain
        .into_iter()
        .map(|k| HorizonEdge {
            a: edges[k].a,
            b: edges[k].b,
            across: edges[k].across,
            across_edge: edges[k].across_edge,
        })
        .collect();
    Some((visible, ordered))
}

/// Merges coplanar adjacent triangles into polygons and builds the hull. Two triangles are
/// coplanar when their normals agree and each one's corners are within `eps` of the other's plane
/// (and of the plane of the first triangle of each group), so a curved surface never merges.
fn merge_faces(points: &[Vec3], tris: &[[u32; 3]], eps: f32) -> Hull {
    let normal = |t: &[u32; 3]| {
        let a = points[t[0] as usize];
        (points[t[1] as usize] - a)
            .cross(points[t[2] as usize] - a)
            .normalize()
    };
    let normals: Vec<Vec3> = tris.iter().map(normal).collect();
    // Directed edge -> triangle.
    let mut directed: Vec<(u32, u32, u32)> = Vec::with_capacity(tris.len() * 3);
    for (i, t) in tris.iter().enumerate() {
        for e in 0..3 {
            directed.push((t[e], t[(e + 1) % 3], i as u32));
        }
    }
    directed.sort_unstable();
    let twin = |a: u32, b: u32| -> Option<u32> {
        directed
            .binary_search_by(|e| (e.0, e.1).cmp(&(b, a)))
            .ok()
            .map(|i| directed[i].2)
    };
    // Union-find over coplanar neighbours; the root is always the smallest index.
    let mut parent: Vec<u32> = (0..tris.len() as u32).collect();
    fn root(parent: &mut [u32], mut i: u32) -> u32 {
        while parent[i as usize] != i {
            parent[i as usize] = parent[parent[i as usize] as usize];
            i = parent[i as usize];
        }
        i
    }
    for (i, t) in tris.iter().enumerate() {
        for e in 0..3 {
            if let Some(j) = twin(t[e], t[(e + 1) % 3]) {
                if normals[i].dot(normals[j as usize]) > MERGE_COS {
                    let ri = root(&mut parent, i as u32);
                    let rj = root(&mut parent, j);
                    let on = |plane: usize, tri: usize| {
                        let n = normals[plane];
                        let d = n.dot(points[tris[plane][0] as usize]);
                        tris[tri]
                            .iter()
                            .all(|&v| (n.dot(points[v as usize]) - d).abs() <= 2.0 * eps)
                    };
                    let flat = normals[ri as usize].dot(normals[rj as usize]) > MERGE_COS
                        && on(i, j as usize)
                        && on(j as usize, i)
                        && on(ri as usize, j as usize)
                        && on(rj as usize, i);
                    if ri != rj && flat {
                        let (lo, hi) = if ri < rj { (ri, rj) } else { (rj, ri) };
                        parent[hi as usize] = lo;
                    }
                }
            }
        }
    }
    let groups: Vec<u32> = (0..tris.len() as u32)
        .map(|i| root(&mut parent, i))
        .collect();
    // The boundary of each group: edges whose twin is in another group, chained into a loop.
    let mut face_loops: Vec<Vec<u32>> = Vec::new();
    let mut done = vec![false; tris.len()];
    for g in 0..tris.len() {
        if groups[g] != g as u32 || done[g] {
            continue;
        }
        let members: Vec<usize> = (0..tris.len()).filter(|&i| groups[i] == g as u32).collect();
        for &m in &members {
            done[m] = true;
        }
        let mut boundary: Vec<(u32, u32)> = Vec::new();
        for &m in &members {
            let t = tris[m];
            for e in 0..3 {
                let (a, b) = (t[e], t[(e + 1) % 3]);
                let inside = twin(a, b).is_some_and(|j| groups[j as usize] == g as u32);
                if !inside {
                    boundary.push((a, b));
                }
            }
        }
        boundary.sort_unstable();
        // Chain from the smallest start vertex.
        let mut ring = Vec::with_capacity(boundary.len());
        let mut used = vec![false; boundary.len()];
        let mut at = 0usize;
        loop {
            used[at] = true;
            ring.push(boundary[at].0);
            let next = boundary[at].1;
            match boundary
                .iter()
                .enumerate()
                .find(|(k, e)| !used[*k] && e.0 == next)
            {
                Some((k, _)) => at = k,
                None => break,
            }
        }
        if ring.len() >= 3 {
            face_loops.push(ring);
        }
    }
    // Keep only the vertices the loops use, renumbered in order of first use.
    let mut remap = vec![u32::MAX; points.len()];
    let mut vertices = Vec::new();
    let mut loops = Vec::new();
    let mut loop_start = Vec::with_capacity(face_loops.len() + 1);
    for ring in &face_loops {
        loop_start.push(loops.len() as u32);
        for &v in ring {
            if remap[v as usize] == u32::MAX {
                remap[v as usize] = vertices.len() as u32;
                vertices.push(points[v as usize]);
            }
            loops.push(remap[v as usize]);
        }
    }
    loop_start.push(loops.len() as u32);
    finish(vertices, loops, loop_start)
}

// ---------------------------------------------------------------------------------------------
// Oriented box
// ---------------------------------------------------------------------------------------------

/// The oriented box of `points`: axes from the principal directions of the cloud, extents from the
/// projections. No side is thinner than `min_thickness`.
pub fn oriented_box(points: &[Vec3], min_thickness: f32) -> Hull {
    if points.is_empty() {
        let h = min_thickness.max(1e-3) * 0.5;
        return Hull::cuboid(
            Vec3::ZERO,
            [
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
                Vec3::new(0.0, 0.0, 1.0),
            ],
            Vec3::splat(h),
        );
    }
    let n = points.len() as f32;
    let mut mean = Vec3::ZERO;
    for p in points {
        mean += *p;
    }
    mean = mean / n;
    let mut cov = Mat3::ZERO;
    for p in points {
        let d = *p - mean;
        cov = cov.add(&Mat3::outer(d, d));
    }
    let (frame, _) = cov.scale(1.0 / n).symmetric_eigen();
    let mut axes = [frame.column(0), frame.column(1), frame.column(2)];
    for a in axes.iter_mut() {
        *a = a.normalize();
    }
    // A degenerate cloud (a line, a point) can give a poor frame: fall back to the world axes.
    if !axes
        .iter()
        .all(|a| a.is_finite() && (a.length() - 1.0).abs() < 1e-3)
        || (axes[0].cross(axes[1]).dot(axes[2]) - 1.0).abs() > 1e-3
    {
        axes = [
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
            Vec3::new(0.0, 0.0, 1.0),
        ];
    }
    let mut lo = [f32::INFINITY; 3];
    let mut hi = [f32::NEG_INFINITY; 3];
    for p in points {
        let d = *p - mean;
        for k in 0..3 {
            let t = d.dot(axes[k]);
            lo[k] = lo[k].min(t);
            hi[k] = hi[k].max(t);
        }
    }
    let mut centre = mean;
    let mut half = [0.0f32; 3];
    for k in 0..3 {
        let mid = 0.5 * (lo[k] + hi[k]);
        centre += axes[k] * mid;
        half[k] = (0.5 * (hi[k] - lo[k])).max(0.5 * min_thickness);
    }
    Hull::cuboid(centre, axes, Vec3::new(half[0], half[1], half[2]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rt_core::rng::Pcg32;

    fn cube_points(half: f32) -> Vec<Vec3> {
        let mut pts = Vec::new();
        for i in 0..8 {
            pts.push(Vec3::new(
                if i & 1 != 0 { half } else { -half },
                if i & 2 != 0 { half } else { -half },
                if i & 4 != 0 { half } else { -half },
            ));
        }
        pts
    }

    /// Every point of `pts` is inside or on every face plane, and every face is convex.
    fn assert_valid(h: &Hull, pts: &[Vec3], tol: f32) {
        for f in 0..h.face_count() {
            for p in pts {
                let d = h.normals[f].dot(*p) - h.offsets[f];
                assert!(d <= tol, "point {p:?} is {d} above face {f}");
            }
        }
        // Euler: V - E + F = 2 for a closed convex polyhedron.
        assert_eq!(
            h.vertices.len() as i64 - h.edges.len() as i64 + h.face_count() as i64,
            2
        );
        for e in &h.edges {
            assert_ne!(e.left, e.right, "every edge has two faces");
        }
    }

    #[test]
    fn a_cube_has_six_square_faces() {
        let mut pts = cube_points(10.0);
        // Points on the faces and inside change nothing.
        pts.push(Vec3::new(0.0, 0.0, 10.0));
        pts.push(Vec3::new(3.0, -2.0, 1.0));
        pts.push(Vec3::new(10.0, 5.0, 5.0));
        let h = Hull::quickhull(&pts).unwrap();
        assert_eq!(h.vertices.len(), 8);
        assert_eq!(h.face_count(), 6);
        assert_eq!(h.edges.len(), 12);
        for f in 0..6 {
            assert_eq!(h.face(f).len(), 4);
        }
        assert_valid(&h, &pts, 1e-4);
        let m = h.mass_properties();
        assert!((m.volume - 8000.0).abs() < 0.5, "{}", m.volume);
        assert!(m.center.length() < 1e-4);
        // A cube of side s: I = s²/6 per unit mass (unit density: times the volume).
        let want = 8000.0 * 400.0 / 6.0;
        for i in 0..3 {
            assert!((m.inertia.m[i][i] - want).abs() < want * 1e-4);
        }
        assert!(m.inertia.m[0][1].abs() < 1.0);
    }

    #[test]
    fn a_random_cloud_contains_all_its_points() {
        let mut rng = Pcg32::seeded(7, 1);
        let mut pts = Vec::new();
        for _ in 0..500 {
            // Points in a ball.
            loop {
                let p = Vec3::new(
                    rng.next_f32() * 2.0 - 1.0,
                    rng.next_f32() * 2.0 - 1.0,
                    rng.next_f32() * 2.0 - 1.0,
                );
                if p.length() <= 1.0 {
                    pts.push(p * 30.0);
                    break;
                }
            }
        }
        let h = Hull::quickhull(&pts).unwrap();
        assert_valid(&h, &pts, 1e-3);
        // Same points, same hull.
        assert_eq!(Hull::quickhull(&pts).unwrap(), h);
    }

    #[test]
    fn a_tessellated_sphere_keeps_its_vertices() {
        let mut pts = Vec::new();
        let rings = 12;
        let segs = 24;
        pts.push(Vec3::new(0.0, 0.0, 50.0));
        pts.push(Vec3::new(0.0, 0.0, -50.0));
        for r in 1..rings {
            let th = std::f32::consts::PI * r as f32 / rings as f32;
            for s in 0..segs {
                let ph = 2.0 * std::f32::consts::PI * s as f32 / segs as f32;
                pts.push(Vec3::new(th.sin() * ph.cos(), th.sin() * ph.sin(), th.cos()) * 50.0);
            }
        }
        let h = Hull::quickhull(&pts).unwrap();
        assert_eq!(h.vertices.len(), pts.len());
        assert_valid(&h, &pts, 1e-3);
        let m = h.mass_properties();
        let ball = 4.0 / 3.0 * std::f32::consts::PI * 125_000.0;
        assert!(m.volume < ball && m.volume > 0.9 * ball, "{}", m.volume);
    }

    #[test]
    fn flat_and_oversized_clouds_fall_back_to_a_box() {
        // A square plate: no hull, a box 2 mm thick.
        let pts = vec![
            Vec3::new(-50.0, -50.0, 0.0),
            Vec3::new(50.0, -50.0, 0.0),
            Vec3::new(50.0, 50.0, 0.0),
            Vec3::new(-50.0, 50.0, 0.0),
            Vec3::new(0.0, 0.0, 0.0),
        ];
        assert_eq!(Hull::quickhull(&pts), Err(HullError::Degenerate));
        let (h, kind) = Hull::build(&pts, 2.0);
        assert_eq!(kind, HullKind::OrientedBox);
        assert_eq!(h.vertices.len(), 8);
        let m = h.mass_properties();
        assert!(
            (m.volume - 100.0 * 100.0 * 2.0).abs() < 10.0,
            "{}",
            m.volume
        );
        // A cylinder of 200 segments has 400 hull vertices: over the cap.
        let mut pts = Vec::new();
        for s in 0..200 {
            let ph = 2.0 * std::f32::consts::PI * s as f32 / 200.0;
            for z in [0.0, 40.0] {
                pts.push(Vec3::new(20.0 * ph.cos(), 20.0 * ph.sin(), z));
            }
        }
        assert!(Hull::quickhull(&pts).unwrap().vertices.len() > HULL_VERTEX_CAP);
        let (h, kind) = Hull::build(&pts, 1.0);
        assert_eq!(kind, HullKind::OrientedBox);
        let m = h.mass_properties();
        assert!((m.volume - 40.0 * 40.0 * 40.0).abs() < 40.0, "{}", m.volume);
    }
}

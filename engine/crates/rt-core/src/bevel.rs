//! Edge bevel in the shading (E6): the sharp edges of a mesh read as rounded fillets of the
//! material's `bevel_mm`, in reflections and in shadows, without touching the geometry.
//!
//! A CAD model's edges are mathematically sharp, and a sharp edge catches no light: it is what
//! gives a render away. Here, at a shading point within the radius `r` of a sharp edge of its mesh
//! ([`crate::geometry::edges`]), the shading normal turns towards the face across the edge as the
//! normal of a circular fillet would:
//!
//! * **One edge.** With `n` the shading normal at the point, `n'` the other face's (its vertex
//!   normals interpolated along the edge, or its plane), `θ` the angle between them, `v` the unit
//!   direction of `n'` in the tangent plane of `n` and `d` the distance to the edge, a fillet of
//!   radius `r` tangent to both faces starts `t = r tan(θ/2)` from the edge, and its normal at the
//!   point the line from its axis through ours crosses it is `normalize(r n + (t - d) v)` for
//!   `d < t`: the face's own normal at `t`, the bisector of the two at the edge, the same from
//!   both sides (so the edge is continuous) and the same formula for a concave edge, whose fillet
//!   fills the corner instead of cutting it. Edges sharper than a right angle would need a fillet
//!   reaching beyond `r`: their footprint stays `r` and the fillet's radius shrinks to
//!   `r / tan(θ/2)`, so the normal changes only within `r` of an edge, whatever its angle. A
//!   boundary edge (an open rim, with nothing across it) rounds over a right angle, towards the
//!   outside of the rim.
//! * **Several edges** (corners, and the short segments of a curved edge). Each edge `i` asks
//!   `w · v_i ≥ a_i` of the offset `w` added to `r n` (`a_i = t_i - d_i` above); the offset is the
//!   shortest `w` that satisfies all of them. That is exactly the normal of a box rounded by a
//!   sphere at a right-angled corner, and the largest single pull (not their sum) along a chain
//!   of nearly parallel segments, so curved edges do not bead at their vertices. When the asks
//!   cannot all hold (a wall or a rim thinner than about twice the radius), the radius shrinks at
//!   that point, by bisection, to the largest one that fits: a thin rim becomes a full round.
//!
//! **Space and scale.** Everything is computed in the mesh's own space (the edges are stored
//! with the mesh, once, whatever its instances), with the radius divided by the instance's scale
//! `∛|det M|`. Under a non-uniform scale the fillet is the transformed circular fillet (an
//! elliptical one in the world whose mean radius is `bevel_mm`), and the normal goes to the world
//! by the inverse transpose like every normal.
//!
//! **Shadows and reflections.** A real fillet is lower than the faces it replaces, so light that
//! reaches it from just below a face's plane (from the side of the edge) is not blocked by the
//! corner. The rays leaving a bevelled point (shadow rays and the next bounce) start from the
//! point lifted along the bevelled normal by `d (w · v) / |r n + w|`, the smallest lift from
//! which every direction above the fillet's tangent plane clears the face (derived for one
//! convex edge; the largest over the convex edges at a corner), on top of the terminator lift of
//! [`crate::geometry::Geometry::terminator_point`]. The surface's geometric normal becomes the
//! fillet's too (the bevel applied to the triangle's plane), so the integrator's test "a
//! reflection must leave above the surface" is made against the fillet. A bevelled normal that
//! would face away from the viewer (grazing views) is bent towards it until its cosine is
//! [`MIN_FACING`].
//!
//! **Bias.** A bevelled normal is a shading normal like interpolated vertex normals: the BSDF is
//! evaluated in its frame for light sampling and for BSDF sampling alike, so multiple importance
//! sampling weighs both with the same densities, but a shading normal is not reciprocal and does
//! not conserve energy exactly (Veach 1997, §5.3); on the narrow strips along the edges a white
//! furnace is a few percent off (`tests.rs` measures it).
//!
//! **Cost.** Bounded per shading point: one comparison against the triangle's clearance when no
//! edge is within reach, otherwise a query of the edge BVH (at most
//! [`MAX_VISITS`](crate::geometry::edges::MAX_VISITS) nodes and
//! [`MAX_CANDIDATES`](crate::geometry::edges::MAX_CANDIDATES) edges within `2r`), the shortest
//! offset among at most 36 candidates, and at most [`SHRINK_STEPS`] more for a feature thinner
//! than the radius.

use crate::geometry::edges::{
    segment_distance2, winding_normal, EdgeFace, MeshEdges, SharpEdge, MAX_CANDIDATES,
};
use crate::geometry::{Geometry, Hit, Mesh};
use crate::math::{Frame, Ray, Vec3};
use crate::scene::Scene;
use std::sync::Arc;

/// Edges are looked for within this many radii (the asks of edges a little beyond the radius
/// still bound the offset at corners).
pub const SEARCH_RADII: f32 = 2.0;
/// `cos 25°`: an edge's face counts as the surface of the shading point when its normal is this
/// close to the triangle's.
const COS_SIDE: f32 = 0.906_307_8;
/// `cos 2°`: two normals this close are the same surface across a seam.
const COS_SAME_NORMAL: f32 = 0.999_390_8;
/// `cos 20°`: the sharp-edge angle ([`crate::geometry::edges::SHARP_ANGLE_DEG`]).
const COS_SHARP: f32 = 0.939_692_6;
/// Bisection steps of the radius where a feature is thinner than it allows.
pub const SHRINK_STEPS: u32 = 16;
/// Smallest cosine between a bevelled normal and the direction to the viewer.
pub const MIN_FACING: f32 = 0.01;
/// `tan(θ/2)` used for a fold of 180° (a knife edge).
const KNIFE_TAN: f32 = 1.0e4;

/// What the integrator shades a surface hit with.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShadingPoint {
    /// Where lights are sampled from and reflected rays start.
    pub point: Vec3,
    /// Unit shading normal, facing the side the ray came from.
    pub normal: Vec3,
    /// Unit geometric normal (of the fillet, where bevelled), facing the side the ray came from.
    pub geometric: Vec3,
}

/// What lies across a boundary edge of a mesh, in another mesh of the same part.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Across {
    /// Nothing: an open rim.
    Open,
    /// The surface goes on smoothly: not an edge.
    Seam,
    /// A sharp edge with a face of another mesh: its winding normal (oriented consistently with
    /// this side's winding) and its shading normals at the edge's ends `a` and `b`.
    Face { normal: Vec3, corners: [Vec3; 2] },
}

/// The bevel of one instance.
#[derive(Clone, Debug, PartialEq)]
struct InstanceBevel {
    /// Radius in the mesh's space.
    radius: f32,
    /// For an instance that shares its transform with instances of other meshes (a part sent as
    /// several meshes, one per material): what lies across each edge of its mesh, indexed like
    /// [`MeshEdges::edges`] (only boundary edges are looked up).
    across: Option<Arc<Vec<Across>>>,
}

/// The bevel of every instance of a scene, prepared once per scene ([`crate::integrator::Prepared`]).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BevelSetup {
    /// Per instance; `None` without a bevel.
    instances: Vec<Option<InstanceBevel>>,
}

/// `∛|det M|` of an instance's linear part (1 for the identity).
pub(crate) fn instance_scale(geometry: &Geometry, instance: u32) -> f32 {
    let Some((_, inst)) = geometry.instance_mesh(instance) else {
        return 1.0;
    };
    if inst.transform.is_identity() {
        return 1.0;
    }
    let det = inst.transform.determinant().abs();
    if det > 0.0 && det.is_finite() {
        crate::fmath::exp2(crate::fmath::log2(det) * (1.0 / 3.0))
    } else {
        1.0
    }
}

impl BevelSetup {
    /// The bevel of every instance of `scene` whose material has `bevel_mm > 0` (emitters never
    /// have one). Extracts the sharp edges of the meshes concerned (once per mesh, kept with it)
    /// and matches the boundary edges of meshes that share an instance transform.
    pub fn new(scene: &Scene) -> BevelSetup {
        let geometry = &scene.geometry;
        let instances = geometry.instances();
        let radius_of = |i: usize| -> Option<f32> {
            let inst = &instances[i];
            let m = scene.materials.get(inst.material_id as usize)?;
            if m.is_emissive()
                || m.bevel_mm.is_nan()
                || m.bevel_mm <= 0.0
                || !m.bevel_mm.is_finite()
            {
                return None;
            }
            geometry.instance_mesh(i as u32)?;
            let r = m.bevel_mm / instance_scale(geometry, i as u32);
            (r > 0.0 && r.is_finite()).then_some(r)
        };
        let mut out: Vec<Option<InstanceBevel>> = (0..instances.len())
            .map(|i| {
                radius_of(i).map(|radius| InstanceBevel {
                    radius,
                    across: None,
                })
            })
            .collect();
        if out.iter().all(Option::is_none) {
            return BevelSetup { instances: out };
        }
        // Instances by transform (bit for bit), to find the parts sent as several meshes.
        let key = |i: usize| -> [u32; 12] {
            let mut k = [0u32; 12];
            for (slot, v) in k
                .iter_mut()
                .zip(instances[i].transform.rows.iter().flatten())
            {
                *slot = v.to_bits();
            }
            k
        };
        let mut order: Vec<usize> = (0..instances.len())
            .filter(|&i| geometry.instance_mesh(i as u32).is_some())
            .collect();
        order.sort_by(|&x, &y| key(x).cmp(&key(y)).then(x.cmp(&y)));
        let mut start = 0;
        while start < order.len() {
            let mut end = start + 1;
            while end < order.len() && key(order[end]) == key(order[start]) {
                end += 1;
            }
            let group = &order[start..end];
            for &i in group {
                if out[i].is_some() {
                    let across = across_table(geometry, group, i);
                    if let Some(b) = out[i].as_mut() {
                        b.across = across;
                    }
                }
            }
            start = end;
        }
        for (i, b) in out.iter().enumerate() {
            if b.is_some() {
                if let Some((mesh, _)) = geometry.instance_mesh(i as u32) {
                    mesh.sharp_edges();
                }
            }
        }
        BevelSetup { instances: out }
    }

    /// True when no instance has a bevel.
    pub fn is_empty(&self) -> bool {
        self.instances.iter().all(Option::is_none)
    }

    /// The bevel radius of instance `i` in its mesh's space (0: none).
    pub fn radius(&self, i: u32) -> f32 {
        match self.instances.get(i as usize) {
            Some(Some(b)) => b.radius,
            _ => 0.0,
        }
    }

    /// The point, shading normal and geometric normal to shade the hit `details` of `ray` with:
    /// the shading normal on the geometric side (flat where it would still face away from the
    /// viewer), the terminator point of smooth meshes, then the bevel of the instance.
    pub fn shading_point(&self, scene: &Scene, ray: &Ray, details: &Hit) -> ShadingPoint {
        // Keep the shading normal on the geometric side; where it would still face away from
        // the viewer (silhouettes of coarse smooth meshes), shade flat.
        let ng = details.geometric_normal;
        let mut normal = details.normal;
        if normal.dot(ng) < 0.0 {
            normal = -normal;
        }
        if normal.dot(ray.dir) >= -1.0e-4 {
            normal = ng;
        }
        let base = ShadingPoint {
            point: scene.geometry.terminator_point(details),
            normal,
            geometric: ng,
        };
        match self.instances.get(details.instance as usize) {
            Some(Some(b)) => b.apply(&scene.geometry, ray, details, base),
            _ => base,
        }
    }

    /// [`BevelSetup::shading_point`] with the instance's radius times `scale` (M3b: a material
    /// program's bevel weight): 1 is exactly [`BevelSetup::shading_point`], 0 or less (or NaN) no
    /// bevel at all.
    pub fn shading_point_scaled(
        &self,
        scene: &Scene,
        ray: &Ray,
        details: &Hit,
        scale: f32,
    ) -> ShadingPoint {
        if scale == 1.0 {
            return self.shading_point(scene, ray, details);
        }
        let ng = details.geometric_normal;
        let mut normal = details.normal;
        if normal.dot(ng) < 0.0 {
            normal = -normal;
        }
        if normal.dot(ray.dir) >= -1.0e-4 {
            normal = ng;
        }
        let base = ShadingPoint {
            point: scene.geometry.terminator_point(details),
            normal,
            geometric: ng,
        };
        match self.instances.get(details.instance as usize) {
            Some(Some(b)) if scale > 0.0 => {
                let scaled = InstanceBevel {
                    radius: b.radius * scale,
                    across: b.across.clone(),
                };
                if scaled.radius > 0.0 && scaled.radius.is_finite() {
                    scaled.apply(&scene.geometry, ray, details, base)
                } else {
                    base
                }
            }
            _ => base,
        }
    }

    /// M3b: the curvature of the part at the hit `details` within `radius_mm` (in the part's own
    /// millimetres), as the programs' `EDGE` and `CAVITY` read it: `(convexity, concavity)`, each
    /// 0 to 1. E7 (the curvature of the mesh itself) is not there yet, so it is measured from
    /// the sharp edges the bevel rounds ([`crate::geometry::edges`]: folds of more than 20° and
    /// open rims): each edge within reach gives `smoothstep(1 − d/r) · min(tan(θ/2), 1)` (its
    /// closeness, eased, times how sharp it is: a right angle or sharper is 1, an open rim
    /// counts as a right angle), the largest over the convex edges is the convexity and over
    /// the concave ones the concavity. A smooth rounded mesh without sharp edges reads 0.
    pub fn curvature(&self, scene: &Scene, details: &Hit, radius_mm: f32) -> (f32, f32) {
        let geometry = &scene.geometry;
        let Some((mesh, _)) = geometry.instance_mesh(details.instance) else {
            return (0.0, 0.0);
        };
        let r = radius_mm / instance_scale(geometry, details.instance);
        if !(r > 0.0 && r.is_finite()) {
            return (0.0, 0.0);
        }
        let edges = mesh.sharp_edges();
        if edges.is_empty() || edges.clearance(details.triangle) > r {
            return (0.0, 0.0);
        }
        let Some([p0, p1, p2]) = mesh.triangle(details.triangle as usize) else {
            return (0.0, 0.0);
        };
        let [b0, b1, b2] = details.barycentrics;
        let p = p0 * b0 + p1 * b1 + p2 * b2;
        let found = edges.within(p, r);
        if found.as_slice().is_empty() {
            return (0.0, 0.0);
        }
        let sign = if details.front_face { 1.0 } else { -1.0 };
        let ng = winding_normal(mesh, details.triangle) * sign;
        let mut ns = geometry
            .normal_to_object(details.instance, details.normal)
            .normalize();
        if !ns.is_finite() || ns.dot(ng) < 0.0 {
            ns = ng;
        }
        let across = match self.instances.get(details.instance as usize) {
            Some(Some(b)) => b.across.as_deref().map(Vec::as_slice),
            _ => None,
        };
        let local = Local {
            mesh,
            edges,
            across,
            triangle: details.triangle,
            p,
            ng,
            ns,
            sign,
            frame: Frame::from_normal(ns),
            radius: r,
        };
        let (mut convex, mut concave) = (0.0f32, 0.0f32);
        for &(_, index) in found.as_slice() {
            let Some(pull) = local.pull(index) else {
                continue;
            };
            let near = 1.0 - pull.d / r;
            if near.is_nan() || near <= 0.0 {
                continue;
            }
            let near = near.min(1.0);
            let w = (near * near) * (3.0 - 2.0 * near) * pull.m;
            if pull.convex {
                convex = convex.max(w);
            } else {
                concave = concave.max(w);
            }
        }
        (convex, concave)
    }

    /// The shading normal of the exact normal pass ([`crate::integrator::first_hit`]): the hit's
    /// own (facing the ray) without a bevel, the bevelled one with it.
    pub fn pass_normal(&self, scene: &Scene, ray: &Ray, details: &Hit) -> Vec3 {
        match self.instances.get(details.instance as usize) {
            Some(Some(_)) => self.shading_point(scene, ray, details).normal,
            _ => details.normal,
        }
    }
}

/// The [`Across`] of every edge of instance `i`'s mesh, from the boundary edges of the other
/// meshes in `group` (instances with the same transform). `None` when no other mesh is there.
fn across_table(geometry: &Geometry, group: &[usize], i: usize) -> Option<Arc<Vec<Across>>> {
    let (mesh, inst) = geometry.instance_mesh(i as u32)?;
    let others: Vec<&Mesh> = {
        let mut ids: Vec<u32> = group
            .iter()
            .filter_map(|&j| geometry.instance_mesh(j as u32).map(|(_, x)| x.mesh))
            .filter(|&m| m != inst.mesh)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        ids.iter()
            .filter_map(|&m| geometry.meshes().get(m as usize))
            .collect()
    };
    if others.is_empty() {
        return None;
    }
    let edges = mesh.sharp_edges();
    if !edges.edges().iter().any(SharpEdge::is_boundary) {
        return None;
    }
    // The boundary edges of the other meshes, by the keys of their ends.
    let ends = |e: &SharpEdge| (key(e.a), key(e.b));
    let mut theirs: Vec<((Key, Key), usize, usize)> = Vec::new();
    for (m, other) in others.iter().enumerate() {
        for (k, e) in other.sharp_edges().edges().iter().enumerate() {
            if e.is_boundary() {
                theirs.push((ends(e), m, k));
            }
        }
    }
    theirs.sort();
    let table: Vec<Across> = edges
        .edges()
        .iter()
        .map(|e| {
            if !e.is_boundary() {
                return Across::Open;
            }
            let k = ends(e);
            let at = theirs.partition_point(|t| t.0 < k);
            match theirs.get(at) {
                Some(&(found, m, idx)) if found == k => {
                    across_from(mesh, e, others[m], &others[m].sharp_edges().edges()[idx])
                }
                _ => Across::Open,
            }
        })
        .collect();
    Some(Arc::new(table))
}

/// The welding key of a position (as in [`crate::geometry::edges`]).
type Key = (u32, u32, u32);

fn key(p: Vec3) -> Key {
    let bits = |v: f32| if v == 0.0 { 0 } else { v.to_bits() };
    (bits(p.x), bits(p.y), bits(p.z))
}

/// The vertex normals a triangle side uses at the edge's ends `a` and `b` (unit; `None` without
/// vertex normals).
fn side_normals(mesh: &Mesh, f: EdgeFace) -> Option<[Vec3; 2]> {
    let ids = mesh.triangle_indices(f.triangle as usize)?;
    let (s, t) = (
        ids[f.corner as usize] as usize,
        ids[(f.corner as usize + 1) % 3] as usize,
    );
    let (ns, nt) = (mesh.normal(s)?.normalize(), mesh.normal(t)?.normalize());
    Some(if f.forward { [ns, nt] } else { [nt, ns] })
}

/// What lies across boundary edge `e` of `mesh`, given the matching boundary edge `o` of `other`.
fn across_from(mesh: &Mesh, e: &SharpEdge, other: &Mesh, o: &SharpEdge) -> Across {
    let (Some(fe), Some(fo)) = (e.face(0), o.face(0)) else {
        return Across::Open;
    };
    let ne = winding_normal(mesh, fe.triangle);
    let mut no = winding_normal(other, fo.triangle);
    // Consistently wound faces run along a shared edge in opposite directions.
    if fe.forward == fo.forward {
        no = -no;
    }
    let corners = match side_normals(other, fo) {
        Some(c) => c.map(|n| if n.dot(no) < 0.0 { -n } else { n }),
        None => [no, no],
    };
    if ne.dot(no) > COS_SHARP {
        return Across::Seam;
    }
    if let (Some(mine), true) = (side_normals(mesh, fe), other.has_normals()) {
        let same = |x: Vec3, y: Vec3| x.dot(y).abs() >= COS_SAME_NORMAL;
        if same(mine[0], corners[0]) && same(mine[1], corners[1]) {
            return Across::Seam;
        }
    }
    Across::Face {
        normal: no,
        corners,
    }
}

/// One edge's ask on the offset at a shading point, in the tangent plane of the shading normal.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Pull {
    /// Unit direction the normal turns towards, in the tangent frame.
    pub v: [f32; 2],
    /// `min(tan(θ/2), 1)`: the footprint in radii.
    pub m: f32,
    /// `max(tan(θ/2), 1)`: the scale of the ask.
    pub g: f32,
    /// Distance from the point to the edge.
    pub d: f32,
    /// The edge is convex seen from the point (the other face falls away).
    pub convex: bool,
}

impl Pull {
    /// The ask `a(r) = g (m r - d)`: the offset must satisfy `w · v ≥ a(r)`.
    #[inline]
    fn ask(&self, r: f32) -> f32 {
        self.g * (self.m * r - self.d)
    }
}

#[inline]
fn dot2(a: [f32; 2], b: [f32; 2]) -> f32 {
    a[0] * b[0] + a[1] * b[1]
}

/// The shortest offset `w` with `w · v_i ≥ a_i(r)` for every pull, or `None` when they cannot
/// all hold. The minimum of a convex quadratic over a polygon has at most two active
/// constraints: every single and every pair is a candidate, and the shortest feasible one wins
/// (the first found among equals).
pub(crate) fn shortest_offset(pulls: &[Pull], r: f32) -> Option<[f32; 2]> {
    let mut all = [0.0f32; MAX_CANDIDATES];
    for (a, p) in all.iter_mut().zip(pulls) {
        *a = p.ask(r);
    }
    let asks = &all[..pulls.len().min(MAX_CANDIDATES)];
    let pulls = &pulls[..asks.len()];
    if asks.iter().all(|&a| a <= 0.0) {
        return Some([0.0, 0.0]);
    }
    let tolerance = 1.0e-5 * r;
    let feasible = |w: [f32; 2]| {
        pulls
            .iter()
            .zip(asks)
            .all(|(p, &a)| dot2(w, p.v) >= a - tolerance)
    };
    let mut best: Option<([f32; 2], f32)> = None;
    let mut consider = |w: [f32; 2]| {
        let n2 = dot2(w, w);
        if best.is_none_or(|(_, b)| n2 < b) && feasible(w) {
            best = Some((w, n2));
        }
    };
    for (p, &a) in pulls.iter().zip(asks) {
        if a > 0.0 {
            consider([p.v[0] * a, p.v[1] * a]);
        }
    }
    for i in 0..pulls.len() {
        for j in i + 1..pulls.len() {
            let (vi, vj) = (pulls[i].v, pulls[j].v);
            let det = vi[0] * vj[1] - vi[1] * vj[0];
            if det.abs() <= 1.0e-6 {
                continue;
            }
            let (ai, aj) = (asks[i], asks[j]);
            consider([
                (ai * vj[1] - aj * vi[1]) / det,
                (vi[0] * aj - vj[0] * ai) / det,
            ]);
        }
    }
    best.map(|(w, _)| w)
}

/// The radius actually used and the offset: [`shortest_offset`] at `r`, or at the largest radius
/// below `r` for which the asks can all hold (bisection, [`SHRINK_STEPS`] steps).
pub(crate) fn fit_offset(pulls: &[Pull], r: f32) -> (f32, [f32; 2]) {
    if let Some(w) = shortest_offset(pulls, r) {
        return (r, w);
    }
    // At radius 0 every ask is -g d ≤ 0: the zero offset holds.
    let (mut lo, mut hi) = (0.0f32, r);
    let mut w_lo = [0.0, 0.0];
    for _ in 0..SHRINK_STEPS {
        let mid = 0.5 * (lo + hi);
        match shortest_offset(pulls, mid) {
            Some(w) => {
                lo = mid;
                w_lo = w;
            }
            None => hi = mid,
        }
    }
    (lo, w_lo)
}

/// The shading point near the edges of a mesh, in the mesh's space.
struct Local<'a> {
    mesh: &'a Mesh,
    edges: &'a MeshEdges,
    across: Option<&'a [Across]>,
    triangle: u32,
    /// Point on the triangle.
    p: Vec3,
    /// Triangle's plane normal, facing the ray.
    ng: Vec3,
    /// Shading normal, facing the ray.
    ns: Vec3,
    /// +1 when the ray hit the front of the triangle, -1 for the back.
    sign: f32,
    frame: Frame,
    radius: f32,
}

impl Local<'_> {
    /// The pull of edge `index`, if it bears on this point.
    fn pull(&self, index: u32) -> Option<Pull> {
        let e = self.edges.edges().get(index as usize)?;
        let faces = [e.face(0), e.face(1)];
        let mine = |f: &Option<EdgeFace>| f.is_some_and(|f| f.triangle == self.triangle);
        let side = if mine(&faces[0]) {
            0
        } else if mine(&faces[1]) {
            1
        } else {
            // An edge of a neighbouring triangle: its face that is our surface, if one is.
            let facing = |f: &Option<EdgeFace>| {
                f.map_or(-2.0, |f| {
                    (winding_normal(self.mesh, f.triangle) * self.sign).dot(self.ng)
                })
            };
            let (c0, c1) = (facing(&faces[0]), facing(&faces[1]));
            let (side, best) = if c0 >= c1 { (0, c0) } else { (1, c1) };
            if best < COS_SIDE {
                return None;
            }
            side
        };
        let face = faces[side]?;
        let corners = self.mesh.triangle(face.triangle as usize)?;
        let third = corners[(face.corner as usize + 2) % 3];
        let along = (e.b - e.a).normalize();
        let into = third - e.a;
        let u = (into - along * along.dot(into)).normalize();
        if u.length_squared() == 0.0 || (self.p - e.a).dot(u) < -1.0e-3 * self.radius {
            return None; // the point is not on this face's side of the edge
        }
        let (d2, t) = segment_distance2(self.p, e.a, e.b);
        let d = d2.sqrt();
        // The other side's shading normal at the closest point of the edge, or the rim's.
        let other = match faces[1 - side] {
            Some(f) => Some(self.face_normal_at(face, f, t)),
            None => match self.across.and_then(|a| a.get(index as usize)) {
                Some(Across::Seam) => return None,
                Some(&Across::Face { normal, corners }) => {
                    let n = corners[0] * (1.0 - t) + corners[1] * t;
                    let n = if n.length_squared() > 0.0 {
                        n.normalize()
                    } else {
                        normal
                    };
                    Some(n * self.sign)
                }
                _ => None,
            },
        };
        let outward = -u; // towards the edge, in the face
        let (v, tan_half) = match other {
            None => (outward, 1.0), // an open rim rounds over a right angle
            Some(n_other) => {
                let k = self.ns.dot(n_other);
                let across = n_other - self.ns * k;
                let s = across.length();
                if s < 1.0e-4 {
                    if k > 0.0 {
                        return None; // the same normal on both sides: nothing to round
                    }
                    (outward, KNIFE_TAN)
                } else {
                    (across * (1.0 / s), (s / (1.0 + k)).min(KNIFE_TAN))
                }
            }
        };
        // Into the tangent frame of the shading normal.
        let v2 = [v.dot(self.frame.x), v.dot(self.frame.y)];
        let len = dot2(v2, v2).sqrt();
        if len < 1.0e-6 {
            return None;
        }
        Some(Pull {
            v: [v2[0] / len, v2[1] / len],
            m: tan_half.min(1.0),
            g: tan_half.max(1.0),
            d,
            convex: v.dot(u) < 0.0,
        })
    }

    /// The shading normal of triangle side `f` (across from `mine`) at parameter `t` of edge `e`,
    /// oriented consistently with this point's normals.
    fn face_normal_at(&self, mine: EdgeFace, f: EdgeFace, t: f32) -> Vec3 {
        let mut n = winding_normal(self.mesh, f.triangle);
        if mine.forward == f.forward {
            n = -n; // wound inconsistently across the edge
        }
        n *= self.sign;
        if let Some([na, nb]) = side_normals(self.mesh, f) {
            let s = na * (1.0 - t) + nb * t;
            if s.length_squared() > 0.0 {
                let s = s.normalize();
                return if s.dot(n) < 0.0 { -s } else { s };
            }
        }
        n
    }
}

impl InstanceBevel {
    /// [`BevelSetup::shading_point`] for a hit on this instance: `base` with the bevel applied.
    fn apply(
        &self,
        geometry: &Geometry,
        ray: &Ray,
        details: &Hit,
        base: ShadingPoint,
    ) -> ShadingPoint {
        let Some((mesh, _)) = geometry.instance_mesh(details.instance) else {
            return base;
        };
        let edges = mesh.sharp_edges();
        let r = self.radius;
        let search = r * SEARCH_RADII;
        if edges.is_empty() || edges.clearance(details.triangle) > search {
            return base;
        }
        let Some([p0, p1, p2]) = mesh.triangle(details.triangle as usize) else {
            return base;
        };
        let [b0, b1, b2] = details.barycentrics;
        let p = p0 * b0 + p1 * b1 + p2 * b2;
        let found = edges.within(p, search);
        if found.as_slice().is_empty() {
            return base;
        }
        let sign = if details.front_face { 1.0 } else { -1.0 };
        let ng = winding_normal(mesh, details.triangle) * sign;
        let mut ns = geometry
            .normal_to_object(details.instance, base.normal)
            .normalize();
        if ns.dot(ng) < 0.0 {
            ns = ng;
        }
        let local = Local {
            mesh,
            edges,
            across: self.across.as_deref().map(Vec::as_slice),
            triangle: details.triangle,
            p,
            ng,
            ns,
            sign,
            frame: Frame::from_normal(ns),
            radius: r,
        };
        let mut pulls = [Pull {
            v: [0.0, 0.0],
            m: 0.0,
            g: 0.0,
            d: 0.0,
            convex: false,
        }; MAX_CANDIDATES];
        let mut count = 0;
        for &(_, index) in found.as_slice() {
            if let Some(pull) = local.pull(index) {
                pulls[count] = pull;
                count += 1;
            }
        }
        let pulls = &pulls[..count];
        if pulls.is_empty() {
            return base;
        }
        let (r_used, w) = fit_offset(pulls, r);
        if w == [0.0, 0.0] {
            return base;
        }
        let w3 = local.frame.x * w[0] + local.frame.y * w[1];
        let shading = ns * r_used + w3;
        let fillet = ng * r_used + w3;
        let length = shading.length();
        // Lift so rays above the fillet's tangent plane clear the faces it replaces: for each
        // convex edge that shapes the offset (its ask holds with equality: the nearest of the
        // segments of a curved edge, both edges at a corner), its distance times its ask over
        // the length of the unnormalised normal. Its other segments have nothing to clear.
        let tight = 1.0e-4 * r_used;
        let lift = pulls
            .iter()
            .filter(|p| p.convex)
            .map(|p| (p.ask(r_used), p))
            .filter(|&(ask, p)| ask > 0.0 && dot2(w, p.v) <= ask + tight)
            .map(|(ask, p)| p.d * ask / length)
            .fold(0.0f32, f32::max);
        let to_viewer = -ray.dir.normalize();
        let world = |n: Vec3| -> Vec3 {
            let n = geometry.normal_to_world(details.instance, n).normalize();
            let c = n.dot(to_viewer);
            if c < MIN_FACING {
                (n + to_viewer * (MIN_FACING - c)).normalize()
            } else {
                n
            }
        };
        let normal = world(shading);
        let geometric = world(fillet);
        let offset = geometry.vector_to_world(details.instance, fillet.normalize() * lift);
        if !(normal.is_finite() && geometric.is_finite() && offset.is_finite()) {
            return base;
        }
        ShadingPoint {
            point: base.point + offset,
            normal,
            geometric,
        }
    }
}

#[cfg(test)]
mod tests;

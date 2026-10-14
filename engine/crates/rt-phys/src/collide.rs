//! Narrow phase: the contact manifold of two shapes, in world space.
//!
//! * **Sphere–sphere**, **sphere–triangle** (the closest point of the triangle by its Voronoi
//!   regions) and **sphere–hull** (the closest point of the faces the centre is above, or the
//!   shallowest face from inside) are exact.
//! * **Hull–hull** and **hull–triangle** use the separating axis test over the face normals of
//!   both and the cross products of edge pairs. An edge pair is only an axis when the arcs of its
//!   two edges on the Gauss map cross (they then build a face of the Minkowski difference), which
//!   is cheap to test and leaves few pairs (Gregorius, "The Separating Axis Test between Convex
//!   Polyhedra", GDC 2013, public talk). A triangle is a polyhedron with two faces (both sides)
//!   whose edges each span half a great circle, through the edge's outward direction in its plane.
//!   Face axes win ties (a box on the floor is a face contact, not an edge one).
//! * A **face contact** clips the most anti-parallel face of the other shape against the side
//!   planes of the reference face (Sutherland–Hodgman) and keeps the points below it, at most four
//!   (the deepest, the farthest from it, and the two that span the largest area); an **edge
//!   contact** is the closest pair of points of the two edges.
//!
//! The normal `n` of a manifold points from B to A; for each point, `pa` is on A, `pb` on B and
//! `(pa - pb) · n` is the signed separation (negative: penetration). Points up to `margin` apart
//! are kept as speculative contacts.

use crate::math::above;
use crate::shape::WorldHull;
use rt_core::math::Vec3;

/// Most points in a manifold.
pub const MAX_POINTS: usize = 4;

/// An edge seen as an arc of the Gauss map: its segment and the normals of its two faces.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Arc {
    /// Segment start.
    pub p0: Vec3,
    /// Segment end.
    pub p1: Vec3,
    /// Normal of one face of the edge.
    pub n1: Vec3,
    /// Normal of the other.
    pub n2: Vec3,
}

/// A convex polyhedron in world space, borrowed.
#[derive(Clone, Copy)]
pub struct Poly<'a> {
    /// Vertices.
    pub verts: &'a [Vec3],
    /// Face normals.
    pub normals: &'a [Vec3],
    /// Face offsets (`n · p`).
    pub offsets: &'a [f32],
    /// Face loops, one after another.
    pub loops: &'a [u32],
    /// Loop starts, one more than the faces.
    pub loop_start: &'a [u32],
    /// Edges as arcs.
    pub arcs: &'a [Arc],
    /// A point inside (the centre of mass, the centroid of a triangle).
    pub center: Vec3,
}

impl Poly<'_> {
    fn face(&self, f: usize) -> &[u32] {
        &self.loops[self.loop_start[f] as usize..self.loop_start[f + 1] as usize]
    }
}

/// A triangle as a polyhedron: two faces (front and back) and three edges of two arcs each.
pub struct TriPoly {
    verts: [Vec3; 3],
    normals: [Vec3; 2],
    offsets: [f32; 2],
    arcs: [Arc; 6],
    center: Vec3,
}

const TRI_LOOPS: [u32; 6] = [0, 1, 2, 0, 2, 1];
const TRI_LOOP_START: [u32; 3] = [0, 3, 6];

impl TriPoly {
    /// The triangle `v` with unit normal `n` (counter-clockwise).
    pub fn new(v: [Vec3; 3], n: Vec3) -> TriPoly {
        let mut arcs = [Arc {
            p0: Vec3::ZERO,
            p1: Vec3::ZERO,
            n1: n,
            n2: n,
        }; 6];
        for i in 0..3 {
            let p0 = v[i];
            let p1 = v[(i + 1) % 3];
            // Outward in the plane: for a counter-clockwise loop, edge × n points out.
            let out = (p1 - p0).cross(n).normalize();
            arcs[2 * i] = Arc {
                p0,
                p1,
                n1: n,
                n2: out,
            };
            arcs[2 * i + 1] = Arc {
                p0,
                p1,
                n1: out,
                n2: -n,
            };
        }
        TriPoly {
            verts: v,
            normals: [n, -n],
            offsets: [n.dot(v[0]), -n.dot(v[0])],
            arcs,
            center: (v[0] + v[1] + v[2]) * (1.0 / 3.0),
        }
    }

    /// The borrowed view.
    pub fn poly(&self) -> Poly<'_> {
        Poly {
            verts: &self.verts,
            normals: &self.normals,
            offsets: &self.offsets,
            loops: &TRI_LOOPS,
            loop_start: &TRI_LOOP_START,
            arcs: &self.arcs,
            center: self.center,
        }
    }
}

/// A placed hull with its arcs, ready for the separating axis test.
#[derive(Clone, Debug, Default)]
pub struct PlacedHull {
    /// The world vertices, planes and centre.
    pub world: WorldHull,
    /// The world arcs of its edges.
    pub arcs: Vec<Arc>,
}

impl PlacedHull {
    /// Places `hull` at `x` with rotation `q` (vertices, planes and arcs).
    pub fn place(&mut self, hull: &crate::hull::Hull, x: Vec3, q: crate::math::Quat) {
        self.world.place(hull, x, q);
        self.arcs.clear();
        for e in &hull.edges {
            self.arcs.push(Arc {
                p0: self.world.verts[e.a as usize],
                p1: self.world.verts[e.b as usize],
                n1: self.world.normals[e.left as usize],
                n2: self.world.normals[e.right as usize],
            });
        }
    }

    /// The borrowed view (loops from the hull).
    pub fn poly<'a>(&'a self, hull: &'a crate::hull::Hull) -> Poly<'a> {
        Poly {
            verts: &self.world.verts,
            normals: &self.world.normals,
            offsets: &self.world.offsets,
            loops: &hull.loops,
            loop_start: &hull.loop_start,
            arcs: &self.arcs,
            center: self.world.center,
        }
    }
}

/// One contact point.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ContactPoint {
    /// On A.
    pub pa: Vec3,
    /// On B.
    pub pb: Vec3,
    /// `(pa - pb) · n`.
    pub sep: f32,
    /// Which point of the manifold (a stable feature number for sorting).
    pub feature: u32,
}

/// A contact manifold: up to four points sharing one normal (from B to A).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Manifold {
    /// Unit normal from B to A.
    pub n: Vec3,
    /// The points; `count` are used.
    pub points: [ContactPoint; MAX_POINTS],
    /// Number of points.
    pub count: usize,
}

impl Manifold {
    fn new(n: Vec3) -> Manifold {
        Manifold {
            n,
            points: [ContactPoint {
                pa: Vec3::ZERO,
                pb: Vec3::ZERO,
                sep: 0.0,
                feature: 0,
            }; MAX_POINTS],
            count: 0,
        }
    }

    fn push(&mut self, pa: Vec3, pb: Vec3, feature: u32) {
        if self.count < MAX_POINTS {
            let sep = (pa - pb).dot(self.n);
            self.points[self.count] = ContactPoint {
                pa,
                pb,
                sep,
                feature,
            };
            self.count += 1;
        }
    }

    /// The same contact seen from the other side (A and B swapped).
    pub fn flipped(&self) -> Manifold {
        let mut m = *self;
        m.n = -self.n;
        for p in m.points.iter_mut().take(m.count) {
            std::mem::swap(&mut p.pa, &mut p.pb);
        }
        m
    }

    /// The used points.
    pub fn points(&self) -> &[ContactPoint] {
        &self.points[..self.count]
    }
}

/// Scratch buffers for the clipping, reused between calls.
#[derive(Default)]
pub struct Scratch {
    a: Vec<Vec3>,
    b: Vec<Vec3>,
    kept: Vec<(Vec3, f32)>,
}

// --- Spheres -------------------------------------------------------------------------------

/// Two spheres.
pub fn sphere_sphere(ca: Vec3, ra: f32, cb: Vec3, rb: f32, margin: f32) -> Option<Manifold> {
    let d = ca - cb;
    let dist = d.length();
    if dist - ra - rb > margin {
        return None;
    }
    let n = if dist > 1e-9 {
        d / dist
    } else {
        Vec3::new(0.0, 0.0, 1.0)
    };
    let mut m = Manifold::new(n);
    m.push(ca - n * ra, cb + n * rb, 0);
    Some(m)
}

/// The point of the triangle `abc` closest to `p` (by the Voronoi regions of its corners, edges
/// and face).
pub fn closest_on_triangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3) -> Vec3 {
    let ab = b - a;
    let ac = c - a;
    let ap = p - a;
    let d1 = ab.dot(ap);
    let d2 = ac.dot(ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = p - b;
    let d3 = ab.dot(bp);
    let d4 = ac.dot(bp);
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return a + ab * (d1 / (d1 - d3));
    }
    let cp = p - c;
    let d5 = ab.dot(cp);
    let d6 = ac.dot(cp);
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return a + ac * (d2 / (d2 - d6));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0 {
        return b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)));
    }
    let k = 1.0 / (va + vb + vc);
    a + ab * (vb * k) + ac * (vc * k)
}

/// A sphere (A) and a triangle (B) with unit normal `n`.
pub fn sphere_triangle(c: Vec3, r: f32, v: &[Vec3; 3], n: Vec3, margin: f32) -> Option<Manifold> {
    let q = closest_on_triangle(c, v[0], v[1], v[2]);
    let d = c - q;
    let dist = d.length();
    if dist - r > margin {
        return None;
    }
    let normal = if dist > 1e-6 * r.max(1.0) {
        d / dist
    } else if (c - v[0]).dot(n) >= 0.0 {
        n
    } else {
        -n
    };
    let mut m = Manifold::new(normal);
    m.push(c - normal * r, q, 0);
    Some(m)
}

/// The point of the convex polygon `ids` (of `verts`, normal `n`) closest to `p`, which is above
/// its plane or on it.
fn closest_on_face(p: Vec3, verts: &[Vec3], ids: &[u32], n: Vec3, offset: f32) -> Vec3 {
    let proj = p - n * (n.dot(p) - offset);
    let mut inside = true;
    for k in 0..ids.len() {
        let a = verts[ids[k] as usize];
        let b = verts[ids[(k + 1) % ids.len()] as usize];
        if (b - a).cross(n).dot(proj - a) > 0.0 {
            inside = false;
            break;
        }
    }
    if inside {
        return proj;
    }
    let mut best = proj;
    let mut best_d = f32::INFINITY;
    for k in 0..ids.len() {
        let a = verts[ids[k] as usize];
        let b = verts[ids[(k + 1) % ids.len()] as usize];
        let ab = b - a;
        let len2 = ab.length_squared();
        let t = if len2 > 0.0 {
            ((p - a).dot(ab) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let q = a + ab * t;
        let d = (p - q).length_squared();
        if d < best_d {
            best_d = d;
            best = q;
        }
    }
    best
}

/// A sphere (A) and a convex polyhedron (B).
pub fn sphere_poly(c: Vec3, r: f32, b: &Poly, margin: f32) -> Option<Manifold> {
    let mut max_s = f32::NEG_INFINITY;
    let mut max_f = 0usize;
    for f in 0..b.normals.len() {
        let s = b.normals[f].dot(c) - b.offsets[f];
        if s > max_s {
            max_s = s;
            max_f = f;
        }
    }
    if max_s - r > margin {
        return None;
    }
    if max_s <= 0.0 {
        // The centre is inside: out through the shallowest face.
        let n = b.normals[max_f];
        let mut m = Manifold::new(n);
        m.push(c - n * r, c - n * max_s, 0);
        return Some(m);
    }
    let mut best = c;
    let mut best_d = f32::INFINITY;
    for f in 0..b.normals.len() {
        if b.normals[f].dot(c) - b.offsets[f] <= 0.0 {
            continue;
        }
        let q = closest_on_face(c, b.verts, b.face(f), b.normals[f], b.offsets[f]);
        let d = (c - q).length_squared();
        if d < best_d {
            best_d = d;
            best = q;
        }
    }
    let dist = best_d.sqrt();
    if dist - r > margin {
        return None;
    }
    let n = if dist > 1e-6 * r.max(1.0) {
        (c - best) / dist
    } else {
        b.normals[max_f]
    };
    let mut m = Manifold::new(n);
    m.push(c - n * r, best, 0);
    Some(m)
}

// --- Separating axes -----------------------------------------------------------------------

/// The face of `a` along whose normal `b` is farthest out: (separation, face).
fn face_query(a: &Poly, b: &Poly) -> (f32, usize) {
    let mut best = (f32::NEG_INFINITY, 0usize);
    for f in 0..a.normals.len() {
        let n = a.normals[f];
        let mut lo = f32::INFINITY;
        for v in b.verts {
            lo = lo.min(n.dot(*v));
        }
        let s = lo - a.offsets[f];
        if s > best.0 {
            best = (s, f);
        }
    }
    best
}

/// True when the arcs `a → b` and `c → d` of the unit sphere cross.
#[inline]
fn arcs_cross(a: Vec3, b: Vec3, c: Vec3, d: Vec3) -> bool {
    let bxa = b.cross(a);
    let dxc = d.cross(c);
    let cba = c.dot(bxa);
    let dba = d.dot(bxa);
    let adc = a.dot(dxc);
    let bdc = b.dot(dxc);
    cba * dba < 0.0 && adc * bdc < 0.0 && cba * bdc > 0.0
}

struct EdgeQuery {
    sep: f32,
    ea: usize,
    eb: usize,
    /// Unit axis from A towards B.
    axis: Vec3,
}

/// The edge pair of `a` and `b` (on a face of their Minkowski difference) with the largest
/// separation.
fn edge_query(a: &Poly, b: &Poly) -> EdgeQuery {
    let mut best = EdgeQuery {
        sep: f32::NEG_INFINITY,
        ea: 0,
        eb: 0,
        axis: Vec3::ZERO,
    };
    for (i, ea) in a.arcs.iter().enumerate() {
        let da = ea.p1 - ea.p0;
        for (j, eb) in b.arcs.iter().enumerate() {
            if !arcs_cross(ea.n1, ea.n2, -eb.n1, -eb.n2) {
                continue;
            }
            let db = eb.p1 - eb.p0;
            let axis = da.cross(db);
            let len = axis.length();
            if !above(len, 1e-5 * (da.length() * db.length())) {
                continue;
            }
            let mut axis = axis / len;
            if axis.dot(ea.p0 - a.center) < 0.0 {
                axis = -axis;
            }
            let s = axis.dot(eb.p0 - ea.p0);
            if s > best.sep {
                best = EdgeQuery {
                    sep: s,
                    ea: i,
                    eb: j,
                    axis,
                };
            }
        }
    }
    best
}

/// The closest points of the segments `p1 q1` and `p2 q2`.
pub fn closest_segments(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3) -> (Vec3, Vec3) {
    let d1 = q1 - p1;
    let d2 = q2 - p2;
    let r = p1 - p2;
    let a = d1.dot(d1);
    let e = d2.dot(d2);
    let f = d2.dot(r);
    if a <= 1e-12 && e <= 1e-12 {
        return (p1, p2);
    }
    let (s, t) = if a <= 1e-12 {
        (0.0, (f / e).clamp(0.0, 1.0))
    } else {
        let c = d1.dot(r);
        if e <= 1e-12 {
            ((-c / a).clamp(0.0, 1.0), 0.0)
        } else {
            let b = d1.dot(d2);
            let denom = a * e - b * b;
            let mut s = if denom > 1e-12 * a * e {
                ((b * f - c * e) / denom).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let mut t = (b * s + f) / e;
            if t < 0.0 {
                t = 0.0;
                s = (-c / a).clamp(0.0, 1.0);
            } else if t > 1.0 {
                t = 1.0;
                s = ((b - c) / a).clamp(0.0, 1.0);
            }
            (s, t)
        }
    };
    (p1 + d1 * s, p2 + d2 * t)
}

/// Clips `poly` (in place, using `tmp`) by the half space `side · p <= side · origin`.
fn clip(poly: &mut Vec<Vec3>, tmp: &mut Vec<Vec3>, side: Vec3, origin: Vec3) {
    tmp.clear();
    let k = side.dot(origin);
    for i in 0..poly.len() {
        let p = poly[i];
        let q = poly[(i + 1) % poly.len()];
        let dp = side.dot(p) - k;
        let dq = side.dot(q) - k;
        if dp <= 0.0 {
            tmp.push(p);
        }
        if (dp < 0.0 && dq > 0.0) || (dp > 0.0 && dq < 0.0) {
            let t = dp / (dp - dq);
            tmp.push(p + (q - p) * t);
        }
    }
    std::mem::swap(poly, tmp);
}

/// At most four of `kept` (point, separation): the deepest, the farthest from it, and the two
/// that span the largest areas on either side (normal `n`). Indices into `kept`, in that order.
fn reduce(kept: &[(Vec3, f32)], n: Vec3) -> ([usize; MAX_POINTS], usize) {
    let mut out = [0usize; MAX_POINTS];
    if kept.len() <= MAX_POINTS {
        for (i, o) in out.iter_mut().enumerate().take(kept.len()) {
            *o = i;
        }
        return (out, kept.len());
    }
    let mut i0 = 0;
    for (i, k) in kept.iter().enumerate() {
        if k.1 < kept[i0].1 {
            i0 = i;
        }
    }
    let p0 = kept[i0].0;
    let mut i1 = i0;
    let mut far = -1.0f32;
    for (i, k) in kept.iter().enumerate() {
        let d = (k.0 - p0).length_squared();
        if d > far {
            far = d;
            i1 = i;
        }
    }
    let p1 = kept[i1].0;
    let (mut i2, mut i3) = (usize::MAX, usize::MAX);
    let (mut hi, mut lo) = (0.0f32, 0.0f32);
    for (i, k) in kept.iter().enumerate() {
        let area = (p1 - p0).cross(k.0 - p0).dot(n);
        if area > hi {
            hi = area;
            i2 = i;
        }
        if area < lo {
            lo = area;
            i3 = i;
        }
    }
    let mut count = 0;
    for i in [i0, i1, i2, i3] {
        if i != usize::MAX && !out[..count].contains(&i) {
            out[count] = i;
            count += 1;
        }
    }
    (out, count)
}

/// The contact of reference face `f` of `r` with `inc`. `r_is_a` says which shape is A.
fn face_contact(
    r: &Poly,
    f: usize,
    inc: &Poly,
    margin: f32,
    r_is_a: bool,
    scratch: &mut Scratch,
) -> Option<Manifold> {
    let nr = r.normals[f];
    let dr = r.offsets[f];
    // The incident face: the most anti-parallel one.
    let mut fi = 0usize;
    let mut low = f32::INFINITY;
    for g in 0..inc.normals.len() {
        let d = inc.normals[g].dot(nr);
        if d < low {
            low = d;
            fi = g;
        }
    }
    let poly = &mut scratch.a;
    poly.clear();
    for &i in inc.face(fi) {
        poly.push(inc.verts[i as usize]);
    }
    let ids = r.face(f);
    for k in 0..ids.len() {
        if poly.is_empty() {
            break;
        }
        let a = r.verts[ids[k] as usize];
        let b = r.verts[ids[(k + 1) % ids.len()] as usize];
        clip(poly, &mut scratch.b, (b - a).cross(nr), a);
    }
    let kept = &mut scratch.kept;
    kept.clear();
    for p in poly.iter() {
        let s = nr.dot(*p) - dr;
        if s <= margin {
            kept.push((*p, s));
        }
    }
    if kept.is_empty() {
        return None;
    }
    let (pick, count) = reduce(kept, nr);
    let mut m = Manifold::new(if r_is_a { -nr } else { nr });
    for (slot, &k) in pick.iter().take(count).enumerate() {
        let (p, s) = kept[k];
        let on_ref = p - nr * s;
        let feature = (f as u32) << 8 | slot as u32;
        if r_is_a {
            m.push(on_ref, p, feature);
        } else {
            m.push(p, on_ref, feature);
        }
    }
    Some(m)
}

/// Normals closer than this (about 1.8°) are the same surface for [`merge_manifolds`].
pub const SAME_SURFACE_COS: f32 = 0.9995;

/// One manifold from several that share a normal (a body on a flat surface made of several
/// triangles): all their points, reduced to the four that matter, with the first one's normal.
/// Without it, each triangle's half of the patch pushes the body its own way, and points on their
/// shared edges count twice.
pub fn merge_manifolds(parts: &[Manifold]) -> Manifold {
    let n = parts[0].n;
    let mut all: Vec<ContactPoint> = Vec::new();
    for m in parts {
        for p in m.points() {
            // A point the previous triangle already gave (on their shared edge) once.
            if !all.iter().any(|q| (q.pa - p.pa).length_squared() < 1e-8) {
                all.push(*p);
            }
        }
    }
    let kept: Vec<(Vec3, f32)> = all.iter().map(|p| (p.pa, p.sep)).collect();
    let (pick, count) = reduce(&kept, n);
    let mut out = Manifold::new(n);
    for (slot, &k) in pick.iter().take(count).enumerate() {
        let p = all[k];
        out.push(p.pa, p.pb, slot as u32);
    }
    out
}

/// Prefer a face axis unless an edge axis separates more by this much (mm).
const EDGE_TOLERANCE: f32 = 1e-3;

/// Two convex polyhedra (A is a hull, B a hull or a triangle). `prefer_b` makes B's face the
/// reference on a tie (a triangle of the floor is a better reference than a face of the body).
pub fn poly_poly(
    a: &Poly,
    b: &Poly,
    margin: f32,
    prefer_b: bool,
    scratch: &mut Scratch,
) -> Option<Manifold> {
    let (sa, fa) = face_query(a, b);
    if sa > margin {
        return None;
    }
    let (sb, fb) = face_query(b, a);
    if sb > margin {
        return None;
    }
    let e = edge_query(a, b);
    if e.sep > margin {
        return None;
    }
    let face_best = sa.max(sb);
    if e.sep > face_best + EDGE_TOLERANCE + 1e-3 * face_best.abs() {
        let ea = a.arcs[e.ea];
        let eb = b.arcs[e.eb];
        let (ca, cb) = closest_segments(ea.p0, ea.p1, eb.p0, eb.p1);
        let mut m = Manifold::new(-e.axis);
        m.push(ca, cb, 1 << 16 | (e.ea as u32) << 8 | (e.eb as u32 & 0xff));
        return Some(m);
    }
    let use_b = if prefer_b {
        sb >= sa - EDGE_TOLERANCE
    } else {
        sb > sa + EDGE_TOLERANCE
    };
    if use_b {
        face_contact(b, fb, a, margin, false, scratch)
    } else {
        face_contact(a, fa, b, margin, true, scratch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hull::Hull;
    use crate::math::Quat;

    fn unit_box(half: Vec3) -> Hull {
        Hull::cuboid(
            Vec3::ZERO,
            [
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
                Vec3::new(0.0, 0.0, 1.0),
            ],
            half,
        )
    }

    fn floor() -> [TriPoly; 2] {
        let a = Vec3::new(-1000.0, -1000.0, 0.0);
        let b = Vec3::new(1000.0, -1000.0, 0.0);
        let c = Vec3::new(1000.0, 1000.0, 0.0);
        let d = Vec3::new(-1000.0, 1000.0, 0.0);
        let up = Vec3::new(0.0, 0.0, 1.0);
        [TriPoly::new([a, b, c], up), TriPoly::new([a, c, d], up)]
    }

    #[test]
    fn a_box_on_the_floor_touches_at_its_four_corners() {
        let h = unit_box(Vec3::new(10.0, 10.0, 10.0));
        let mut placed = PlacedHull::default();
        placed.place(&h, Vec3::new(3.0, 2.0, 9.9), Quat::IDENTITY);
        let mut scratch = Scratch::default();
        let mut corners = 0;
        for tri in floor().iter() {
            let m = poly_poly(&placed.poly(&h), &tri.poly(), 0.5, true, &mut scratch).unwrap();
            assert!(
                (m.n - Vec3::new(0.0, 0.0, 1.0)).length() < 1e-6,
                "{:?}",
                m.n
            );
            for p in m.points() {
                assert!((p.sep + 0.1).abs() < 1e-4, "{}", p.sep);
                assert!(p.pb.z.abs() < 1e-5);
            }
            corners += m.count;
        }
        // The diagonal of the floor splits the square: corners on both triangles, some twice.
        assert!(corners >= 4, "{corners}");
        // Lifted beyond the margin: nothing.
        placed.place(&h, Vec3::new(0.0, 0.0, 11.0), Quat::IDENTITY);
        for tri in floor().iter() {
            assert!(poly_poly(&placed.poly(&h), &tri.poly(), 0.5, true, &mut scratch).is_none());
        }
    }

    #[test]
    fn a_box_on_a_box_is_a_face_contact_and_crossed_edges_an_edge_one() {
        let h = unit_box(Vec3::new(10.0, 10.0, 10.0));
        let mut a = PlacedHull::default();
        let mut b = PlacedHull::default();
        let mut scratch = Scratch::default();
        a.place(&h, Vec3::new(2.0, 1.0, 19.8), Quat::IDENTITY);
        b.place(&h, Vec3::ZERO, Quat::IDENTITY);
        let m = poly_poly(&a.poly(&h), &b.poly(&h), 0.5, false, &mut scratch).unwrap();
        assert!((m.n - Vec3::new(0.0, 0.0, 1.0)).length() < 1e-6);
        assert_eq!(m.count, 4);
        for p in m.points() {
            assert!((p.sep + 0.2).abs() < 1e-4);
        }
        // A turned 45° about x and 45° about z, so one of its edges crosses the top face's
        // edge... set an edge on an edge: A rotated 45° about y over B rotated 45° about x.
        let qa = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), std::f32::consts::FRAC_PI_4);
        let qb = Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), std::f32::consts::FRAC_PI_4);
        let s2 = std::f32::consts::SQRT_2;
        a.place(&h, Vec3::new(0.0, 0.0, 20.0 * s2 - 0.3), qa);
        b.place(&h, Vec3::ZERO, qb);
        let m = poly_poly(&a.poly(&h), &b.poly(&h), 0.5, false, &mut scratch).unwrap();
        assert_eq!(m.count, 1);
        assert!(
            (m.n - Vec3::new(0.0, 0.0, 1.0)).length() < 1e-3,
            "{:?}",
            m.n
        );
        assert!((m.points[0].sep + 0.3).abs() < 1e-3, "{}", m.points[0].sep);
        assert!(m.points[0].pa.x.abs() < 1e-3 && m.points[0].pa.y.abs() < 1e-3);
    }

    #[test]
    fn spheres_touch_where_they_should() {
        let m = sphere_sphere(Vec3::new(0.0, 0.0, 19.0), 10.0, Vec3::ZERO, 10.0, 0.5).unwrap();
        assert!((m.points[0].sep + 1.0).abs() < 1e-5);
        assert!((m.n - Vec3::new(0.0, 0.0, 1.0)).length() < 1e-6);
        let tri = floor();
        let m = sphere_triangle(
            Vec3::new(5.0, -3.0, 9.5),
            10.0,
            &tri[0].verts,
            tri[0].normals[0],
            0.5,
        )
        .unwrap();
        assert!((m.points[0].sep + 0.5).abs() < 1e-4);
        assert!((m.points[0].pb - Vec3::new(5.0, -3.0, 0.0)).length() < 1e-4);
        // Against a box: above its top face, beside an edge, and from inside.
        let h = unit_box(Vec3::new(10.0, 10.0, 10.0));
        let mut b = PlacedHull::default();
        b.place(&h, Vec3::ZERO, Quat::IDENTITY);
        let m = sphere_poly(Vec3::new(1.0, 2.0, 15.0), 5.5, &b.poly(&h), 0.5).unwrap();
        assert!((m.points[0].sep + 0.5).abs() < 1e-4);
        let m = sphere_poly(Vec3::new(13.0, 0.0, 13.0), 5.0, &b.poly(&h), 0.5).unwrap();
        assert!((m.points[0].pb - Vec3::new(10.0, 0.0, 10.0)).length() < 1e-4);
        let s = 3.0 * std::f32::consts::SQRT_2 - 5.0;
        assert!((m.points[0].sep - s).abs() < 1e-4);
        let m = sphere_poly(Vec3::new(0.0, 0.0, 9.0), 2.0, &b.poly(&h), 0.5).unwrap();
        assert!((m.n - Vec3::new(0.0, 0.0, 1.0)).length() < 1e-6);
        assert!((m.points[0].sep + 3.0).abs() < 1e-4);
    }

    #[test]
    fn closest_points_of_segments() {
        let (a, b) = closest_segments(
            Vec3::new(-1.0, 0.0, 0.0),
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.5, -1.0, 2.0),
            Vec3::new(0.5, 1.0, 2.0),
        );
        assert!((a - Vec3::new(0.5, 0.0, 0.0)).length() < 1e-6);
        assert!((b - Vec3::new(0.5, 0.0, 2.0)).length() < 1e-6);
        let q = closest_on_triangle(
            Vec3::new(5.0, 5.0, 3.0),
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        );
        assert!((q - Vec3::new(0.5, 0.5, 0.0)).length() < 1e-6);
    }
}

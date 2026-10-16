//! Manifold next-event estimation (phase E13): the light that reaches a vertex through one or
//! two smooth refracting surfaces (a pane of glass, the wall of a bottle with a liquid inside, a
//! glass ball), connected as a light sample instead of left to the paths that happen to refract
//! onto a light.
//!
//! **The method** (J. Hanika, M. Droske and L. Fascione, "Manifold Next Event Estimation",
//! *Computer Graphics Forum* 34(4), EGSR 2015; the specular constraints and their derivatives are
//! those of W. Jakob and S. Marschner, "Manifold Exploration: A Markov Chain Monte Carlo Technique
//! for Rendering Scenes with Difficult Specular Transport", SIGGRAPH 2012; written from the
//! papers). Next-event estimation at a vertex `x` draws a point `y` on a light as usual. When the
//! straight segment from `x` to `y` is stopped by one or two smooth refracting surfaces and by
//! nothing else ([`seed`]), those crossings are the *seed* of a refraction path `x → v₁ (→ v₂) →
//! y`: the vertices `vᵢ` are the unknowns, two per vertex (its offset in the plane of its
//! triangle), and each vertex has two equations, the tangential part of the generalised half
//! vector `ĥ = (ηₐ ωₐ + η_b ω_b) / |…|` (`ωₐ`, `ω_b` the unit directions towards the previous
//! and the next vertex, `η` the indices on their sides), which vanishes exactly where Snell's law
//! holds about the shading normal `n`. It is taken along the triangle's own tangents `e_s`
//! projected onto the shading plane, `c_s = ĥ · (e_s − (n·e_s) n)`, so that its derivatives,
//! the turning of `n` included, are exact (no frame that turns with the normal). Newton's method
//! solves them ([`solve`]): the linear system of the constraints' derivatives gives a step in the
//! tangent planes, the stepped vertices are projected back onto the surfaces by tracing the
//! segments again from `x` (so every segment is also checked to be free), and a step that does
//! not lower the sum of the squared constraints is halved; at most [`MAX_ITERATIONS`]
//! projections, `f32` throughout, no random numbers (the same path for the same `x` and `y` on
//! every platform and thread). For a sun the end is a direction instead of a point. Under curved
//! glass the straight seed often lies outside the solution's basin (a glass ball bends the light
//! far from the straight line); when Newton's method from it fails, a second seed is traced from
//! the light, refracting by Snell's law at each surface of the chain ([`seed_from_light`]), and
//! solved in turn ([`connection_path`]: the same function on both sides of the MIS).
//!
//! **The connection** is a light sample in the measure of the light: its weight is
//! `f(x) |cos θx| T Le · J / p(y)`, where `p(y)` is the density next-event estimation drew `y`
//! with (per mm² of the light, per steradian of a sun's disc), `T` what the refractions keep (the
//! Fresnel transmittance of each interface, the `η²` of radiance across it, the glass's tint or
//! its Beer–Lambert absorption, the cut-outs and thin walls on the way) and `J = |dωx / dA_y|`
//! the generalised geometry term of the paper: how the direction that leaves `x` moves when `y`
//! moves on the light, through the refractions. With the constraint matrix `A = ∂c/∂v` and its
//! derivatives along the light `B = ∂c/∂y`, the vertices move as `dv = -A⁻¹ B dy`, so `J =
//! |ωx·n₁| / d₁² · |det (A⁻¹B)₁|` (the first vertex's block; [`Path::jacobian`]). A point light is
//! measured across its beam and a delta sun across its direction, and their samples are counted
//! whole.
//!
//! **MIS.** A BSDF-sampled path from `x` that refracts through the same surfaces onto the same
//! point of a light is the path manifold next-event estimation connects (in the limit of smooth
//! glass): the two techniques share it, with the densities `p_b(ωx)` of the BSDF and `p(y) / J`
//! of the connection, both per steradian at `x`, and the power heuristic between them. The BSDF
//! side cannot assume the connection would have found its path (Newton's method from the seed of
//! that `y` may fail, or find another of several refraction paths), so it asks: the integrator
//! keeps the last vertex a path could connect from and the smooth refractions since
//! ([`Track`]), and for a light it then finds, [`found_factor`] builds the seed of that `y` from
//! `x`, solves it and compares the direction it leaves `x` with the path's own; only then does
//! the light take the factor `b = p_b² / (p_b² + p_m²)`, otherwise it keeps its weight. Whether
//! `(x, y)` is in the connection's domain at all (a seed of one or two such surfaces, a light that
//! is not the environment and casts shadows, next-event estimation at `x` drawing that point) is
//! decided by the same function on both sides, so the two sides partition every path.
//!
//! **What it takes.** A chain surface ([`is_chain_material`]) is smooth (roughness up to the
//! E9b wall's 0.05, treated as a mirror for the refraction), wholly clear glass with an inside
//! (not a thin wall), no coat, no cut-out, no scattering medium, no dispersion, an index of at
//! least [`MIN_IOR`], on a part without textures, a program, a procedural pattern or an edge
//! bevel (whose normals it could not differentiate). Everything else keeps the behaviour of
//! before: a rough, coated, textured, programmed or dispersive glass, or more than [`MAX_CHAIN`]
//! refractions, stops the shadow ray as ever (a medium's exit vertex still crosses thin walls by
//! the E9b rule). The environment is left to BSDF sampling (it is large and smooth); with caustics
//! on, the lights that send photons are left to the photon map, which already brings that light.
//! Shading normals are the interpolated vertex normals; the integrator's flat fallback at the
//! silhouettes of coarse meshes is not seen.

use super::{peak, shadow_ray, Prepared, Tracer, MAX_SHADOW_CROSSINGS};
use crate::bsdf::{fresnel_dielectric, Bsdf, Lobes};
use crate::color::Rgb;
use crate::geometry::Hit;
use crate::light::{End, Found, Lights, ManifoldEnd, Selection};
use crate::math::{offset_origin, Frame, Ray, Vec3};
use crate::scene::{Material, Scene, MATERIAL_GLASS};
use std::cell::Cell;

/// Most smooth refracting surfaces between a vertex and a light that a connection goes through.
pub const MAX_CHAIN: usize = 2;
/// Most projections (Newton steps, halved steps included) of one solve.
pub const MAX_ITERATIONS: u32 = 8;
/// A path is solved when, at every vertex, the half vector is within this of the shading normal
/// (the sine of the angle between them).
pub const TOLERANCE: f32 = 1.0e-4;
/// Least cosine between the directions two solved paths leave `x` in for them to be the same
/// solution (2·10⁻³ rad: twenty times what [`TOLERANCE`] leaves; distinct solutions, through two
/// facets of a faceted glass, are much further apart but where they merge, at a fold of the
/// caustic, where the connection's density vanishes anyway).
pub const MATCH_COS: f32 = 0.999_998;
/// Least index of refraction of a chain surface (at an index near 1 the half vector vanishes).
pub const MIN_IOR: f32 = 1.01;
/// Roughest chain surface (the E9b wall's).
pub const MAX_ROUGHNESS: f32 = super::WALL_MAX_ROUGHNESS;

/// True when manifold next-event estimation may connect through surfaces of `m` (the module's
/// documentation): the E9b wall's smooth clear glass, without dispersion and with an index of at
/// least [`MIN_IOR`].
pub fn is_chain_material(m: &Material) -> bool {
    super::medium::is_clear_solid(m)
        && super::medium::of(m).is_none()
        && (m.kind == MATERIAL_GLASS || m.metallic <= 0.0)
        && m.transmission >= 1.0
        && m.roughness <= MAX_ROUGHNESS
        && m.coat <= 0.0
        && m.opacity >= 1.0
        && m.ior >= MIN_IOR
        && !super::dispersion::is_dispersive(m)
}

/// One refracting surface of a chain: the instance, and whether the segment from the vertex's side
/// enters its solid there.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Crossing {
    pub(crate) instance: u32,
    pub(crate) entering: bool,
}

/// The refracting surfaces between a vertex and a light, in order from the vertex.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Chain {
    pub(crate) len: usize,
    pub(crate) crossings: [Crossing; MAX_CHAIN],
}

impl Chain {
    /// No surface.
    pub(crate) const EMPTY: Chain = Chain {
        len: 0,
        crossings: [Crossing {
            instance: u32::MAX,
            entering: false,
        }; MAX_CHAIN],
    };

    /// Adds a surface; false when the chain is full.
    pub(crate) fn push(&mut self, c: Crossing) -> bool {
        match self.crossings.get_mut(self.len) {
            Some(slot) => {
                *slot = c;
                self.len += 1;
                true
            }
            None => false,
        }
    }
}

/// A vertex of a refraction path, on a chain surface, with its differential geometry.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Vertex {
    /// On the triangle, world space.
    p: Vec3,
    /// The unit direction of the ray that found it from the previous vertex (or from `x`), and
    /// how far along it.
    dir: Vec3,
    len: f32,
    /// Geometric normal, facing the previous vertex.
    ng: Vec3,
    /// Orthonormal tangents of the triangle's plane: the vertex's two unknowns move it along them.
    e: [Vec3; 2],
    /// Unit shading normal (either orientation) and its derivatives along `e`.
    n: Vec3,
    dn: [Vec3; 2],
    /// The indices on the side of the previous vertex and of the next one.
    eta_a: f32,
    eta_b: f32,
    /// What the cut-outs, thin walls and clear particles on the segment arriving here keep.
    keep: Rgb,
}

impl Vertex {
    const NONE: Vertex = Vertex {
        p: Vec3::ZERO,
        dir: Vec3::ZERO,
        len: 0.0,
        ng: Vec3::ZERO,
        e: [Vec3::ZERO; 2],
        n: Vec3::ZERO,
        dn: [Vec3::ZERO; 2],
        eta_a: 1.0,
        eta_b: 1.0,
        keep: Rgb::WHITE,
    };
}

/// `x > 0`, false for NaN.
#[inline]
fn positive(x: f32) -> bool {
    x > 0.0
}

/// The unit vector along `d` and its length; `None` for a degenerate one.
#[inline]
fn unit(d: Vec3) -> Option<(Vec3, f32)> {
    let l = d.length();
    (l > 0.0 && l.is_finite()).then(|| (d * (1.0 / l), l))
}

/// The vertex at the hit `details` of a ray of unit direction `dir`, `len` from where it left, on
/// the chain surface it crossed: its triangle's plane and the interpolated shading normal with its
/// derivatives over the plane (by the barycentrics of the point, as [`Geometry::hit_details`]
/// interpolates them).
///
/// [`Geometry::hit_details`]: crate::geometry::Geometry::hit_details
fn vertex(
    scene: &Scene,
    prepared: &Prepared,
    details: &Hit,
    dir: Vec3,
    len: f32,
    keep: Rgb,
) -> Option<Vertex> {
    let (corners, normals) = scene
        .geometry
        .world_triangle(details.instance, details.triangle)?;
    let [p0, p1, p2] = corners;
    let (ea, eb) = (p1 - p0, p2 - p0);
    let cross = ea.cross(eb);
    let nn = cross.length_squared();
    if !(nn > 0.0 && nn.is_finite()) {
        return None;
    }
    let plane = cross * (1.0 / nn.sqrt());
    let (e0, _) = unit(ea)?;
    let e1 = plane.cross(e0);
    let p = details.point;
    let (n, dn) = match normals {
        None => (plane, [Vec3::ZERO; 2]),
        Some([n0, n1, n2]) => {
            // Barycentrics of a point of the plane, and their rates along a tangent.
            let bary = |q: Vec3| (q.cross(eb).dot(cross) / nn, ea.cross(q).dot(cross) / nn);
            let (b1, b2) = bary(p - p0);
            let s = n0 * (1.0 - b1 - b2) + n1 * b1 + n2 * b2;
            let (n, l) = unit(s)?;
            if l < 1.0e-6 {
                return None;
            }
            let rate = |e: Vec3| {
                let (d1, d2) = bary(e);
                let ds = (n1 - n0) * d1 + (n2 - n0) * d2;
                (ds - n * n.dot(ds)) * (1.0 / l)
            };
            (n, [rate(e0), rate(e1)])
        }
    };
    let ior = prepared.material(scene, details.instance).ior;
    let (eta_a, eta_b) = if details.outside {
        (1.0, ior)
    } else {
        (ior, 1.0)
    };
    Some(Vertex {
        p,
        dir,
        len,
        ng: details.geometric_normal,
        e: [e0, e1],
        n,
        dn,
        eta_a,
        eta_b,
        keep,
    })
}

/// What a segment traced through cut-outs, thin walls and clear particles (as a shadow ray crosses
/// them) stopped at.
pub(crate) enum Stop {
    /// Nothing before its end.
    Open,
    /// The visible floor, or something that keeps nothing.
    Blocked,
    /// A surface that stops shadow rays, `t` from the segment's start, with what the crossings
    /// before it kept.
    Surface { details: Hit, keep: Rgb, t: f32 },
}

impl Prepared {
    /// Follows `ray` as [`Prepared::shadow`] does, through what shadow rays cross, to the first
    /// surface that stops it (E13: the segments of a refraction path). A surface of an instance
    /// that `accept` refuses blocks it at once, before its details are worked out.
    pub(crate) fn first_stop<T: Tracer>(
        &self,
        scene: &Scene,
        tracer: &T,
        ray: &Ray,
        accept: impl Fn(u32) -> bool,
        rays: &mut u64,
    ) -> Stop {
        let floor = if self.floor_mode == crate::scene::FloorMode::Visible {
            self.floor_t(ray, false)
        } else {
            f32::INFINITY
        };
        let mut keep = Rgb::WHITE;
        let mut r = *ray;
        let mut travelled = 0.0f32;
        for _ in 0..MAX_SHADOW_CROSSINGS {
            *rays += 1;
            let Some(hit) = tracer.trace_shadow(&r) else {
                return if floor < f32::INFINITY {
                    Stop::Blocked
                } else {
                    Stop::Open
                };
            };
            let t = travelled + hit.t;
            if t >= floor {
                return Stop::Blocked;
            }
            let passable = self
                .passable
                .get(hit.instance as usize)
                .copied()
                .unwrap_or(false);
            if !passable && !accept(hit.instance) {
                return Stop::Blocked;
            }
            let Some(details) = scene.geometry.hit_details(&r, hit) else {
                return Stop::Blocked;
            };
            if !passable {
                return Stop::Surface { details, keep, t };
            }
            let (through, origin) = self.straight_through(scene, &r, hit, &details);
            keep = keep * through;
            if peak(keep) <= 0.0 {
                return Stop::Blocked;
            }
            travelled += (origin - r.origin).dot(r.dir);
            let mut next = Ray::new(origin, r.dir);
            next.t_max = ray.t_max - travelled;
            if next.t_max.is_nan() || next.t_max <= next.t_min {
                return Stop::Open;
            }
            r = next;
        }
        Stop::Blocked
    }
}

/// The straight segment from `x` towards a light, stopped by one to [`MAX_CHAIN`] chain surfaces
/// and nothing else: the seed of a refraction path.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Seed {
    pub(crate) chain: Chain,
    vertices: [Vertex; MAX_CHAIN],
}

/// The seed of the segment from `x` along the unit `dir`, `distance` long (infinite towards a
/// sun; it stops short of the light as a shadow ray does): `None` when it is not in the domain of
/// manifold next-event estimation (nothing in the way, the floor, an opaque or rough surface, a
/// surface of anything but a chain material, more than [`MAX_CHAIN`] of them).
pub(crate) fn seed<T: Tracer>(
    prepared: &Prepared,
    scene: &Scene,
    tracer: &T,
    x: Vec3,
    dir: Vec3,
    distance: f32,
    rays: &mut u64,
) -> Option<Seed> {
    let total = shadow_ray(x, dir, distance);
    let mut ray = total;
    let mut travelled = 0.0f32;
    let mut chain = Chain::EMPTY;
    // The crossings' hits, made into vertices only once the seed is known to be one.
    let mut hits = [None; MAX_CHAIN];
    let done = |chain: Chain, hits: &[Option<(Hit, f32, Rgb)>; MAX_CHAIN]| {
        let mut vertices = [Vertex::NONE; MAX_CHAIN];
        for (v, hit) in vertices.iter_mut().zip(hits).take(chain.len) {
            let (details, len, keep) = (*hit)?;
            *v = vertex(scene, prepared, &details, dir, len, keep)?;
        }
        Some(Seed { chain, vertices })
    };
    loop {
        // A chain surface while the chain has room; anything else stops the seed.
        let room = chain.len < MAX_CHAIN;
        let accept = |i: u32| room && prepared.chain_surface(i);
        match prepared.first_stop(scene, tracer, &ray, accept, rays) {
            Stop::Open if chain.len > 0 => return done(chain, &hits),
            Stop::Open | Stop::Blocked => return None,
            Stop::Surface { details, keep, t } => {
                hits[chain.len] = Some((details, travelled + t, keep));
                chain.push(Crossing {
                    instance: details.instance,
                    entering: details.outside,
                });
                // On from beyond the surface, in the same direction.
                let origin = offset_origin(details.point, -details.geometric_normal);
                travelled += (origin - ray.origin).dot(ray.dir);
                let mut next = Ray::new(origin, dir);
                next.t_max = total.t_max - travelled;
                if next.t_max.is_nan() || next.t_max <= next.t_min {
                    return done(chain, &hits);
                }
                ray = next;
            }
        }
    }
}

/// The seed of a BSDF-sampled path from `x` that left in the unit direction `wi` and refracted
/// through the surfaces of `chain` at `points`: its own vertices, traced again along its own
/// segments, from which Newton's method finds the specular path through the same patches of the
/// same surfaces (the engine's smooth glass is a GGX lobe of width 10⁻³ to 2.5·10⁻³, so the path
/// itself lies beside it). `None` when its segments no longer meet them.
#[allow(clippy::too_many_arguments)]
fn seed_through<T: Tracer>(
    prepared: &Prepared,
    scene: &Scene,
    tracer: &T,
    x: Vec3,
    chain: &Chain,
    wi: Vec3,
    points: &[Vec3; MAX_CHAIN],
    rays: &mut u64,
) -> Option<Seed> {
    let mut vertices = [Vertex::NONE; MAX_CHAIN];
    for i in 0..chain.len {
        let (origin, dir) = match i.checked_sub(1) {
            None => (x, wi),
            Some(j) => {
                let origin = offset_origin(vertices[j].p, -vertices[j].ng);
                (origin, unit(points[i] - origin)?.0)
            }
        };
        let ray = Ray::new(origin, dir);
        let want = chain.crossings[i];
        let accept = |i: u32| i == want.instance;
        let Stop::Surface { details, keep, t } =
            prepared.first_stop(scene, tracer, &ray, accept, rays)
        else {
            return None;
        };
        if details.outside != want.entering {
            return None;
        }
        vertices[i] = vertex(scene, prepared, &details, dir, t, keep)?;
    }
    Some(Seed {
        chain: *chain,
        vertices,
    })
}

/// The constraints of a path, their derivatives along the vertices' tangents (`a`, row `2i + r`
/// is the component `r` of vertex `i`, column `2j + s` its rate along tangent `s` of vertex `j`)
/// and along the end's measure (`b`), the largest error at a vertex and the sum of the squares
/// (what a step must lower).
struct Constraints {
    c: [f32; 4],
    a: [[f32; 4]; 4],
    b: [[f32; 2]; 4],
    err: f32,
    merit: f32,
}

/// The two tangents the end of a path is measured along: the light's surface, the area across the
/// last segment `last` (a point light) or the directions about a sun's.
fn end_basis(end: &End, last: Vec3) -> [Vec3; 2] {
    let axis = match *end {
        End::Point { normal, .. } if normal != Vec3::ZERO => normal,
        End::Point { .. } => last,
        End::Direction { w } => w,
    };
    let f = Frame::from_normal(axis);
    [f.x, f.y]
}

/// The unit direction from vertex `i` of `v` to the next vertex or the end, and one over its
/// length (zero towards a sun).
fn onwards(v: &[Vertex], i: usize, end: &End) -> Option<(Vec3, f32)> {
    let target = match (v.get(i + 1), end) {
        (Some(next), _) => next.p,
        (None, End::Point { y, .. }) => *y,
        (None, End::Direction { w }) => return Some((*w, 0.0)),
    };
    let (w, l) = unit(target - v[i].p)?;
    Some((w, 1.0 / l))
}

/// The unit direction from vertex `i` of `v` back to the previous vertex (or to `x`, along the ray
/// that found it), and that distance.
fn backwards(v: &[Vertex], i: usize) -> Option<(Vec3, f32)> {
    match i.checked_sub(1) {
        None => Some((-v[i].dir, v[i].len)),
        Some(j) => unit(v[j].p - v[i].p),
    }
}

/// The constraints of the path `v` (from `x`, which only enters through the first vertex's
/// direction) to `end`, and their derivatives (the module's documentation).
fn constraints(v: &[Vertex], end: &End) -> Option<Constraints> {
    let k = v.len();
    let mut out = Constraints {
        c: [0.0; 4],
        a: [[0.0; 4]; 4],
        b: [[0.0; 2]; 4],
        err: 0.0,
        merit: 0.0,
    };
    for i in 0..k {
        let vi = &v[i];
        let (wa, la) = backwards(v, i)?;
        let (wb, inv_lb) = onwards(v, i, end)?;
        let h_raw = wa * vi.eta_a + wb * vi.eta_b;
        let hl = h_raw.length();
        if !(hl > 1.0e-6 && hl.is_finite()) {
            return None;
        }
        let h = h_raw * (1.0 / hl);
        // The tangential part of h, along the triangle's own (fixed) tangents projected onto the
        // tangent plane of the shading normal: c_s = h·q_s with q_s = e_s − (n·e_s) n, whose
        // derivatives are exact (no frame turns with the normal).
        let n = vi.n;
        let q = [0, 1].map(|s| vi.e[s] - n * n.dot(vi.e[s]));
        let (r0, r1) = (2 * i, 2 * i + 1);
        out.c[r0] = h.dot(q[0]);
        out.c[r1] = h.dot(q[1]);
        let here = out.c[r0] * out.c[r0] + out.c[r1] * out.c[r1];
        out.err = out.err.max(here.sqrt());
        out.merit += here;
        // A change of the unnormalised half vector, as a change of c.
        let dc = |dh: Vec3| {
            let d = (dh - h * h.dot(dh)) * (1.0 / hl);
            (d.dot(q[0]), d.dot(q[1]))
        };
        // How the unit directions to the previous and the next vertex turn as a point moves by e.
        let pa = |e: Vec3| (e - wa * wa.dot(e)) * (1.0 / la);
        let pb = |e: Vec3| (e - wb * wb.dot(e)) * inv_lb;
        let hn = h.dot(n);
        for s in 0..2 {
            let e = vi.e[s];
            // The vertex itself: both directions turn, and so does its normal, which turns q:
            // h·dq_r = −(dn·e_r)(h·n) − (n·e_r)(h·dn).
            let (cx, cy) = dc(-(pa(e) * vi.eta_a) - pb(e) * vi.eta_b);
            let dn = vi.dn[s];
            let turn = |r: usize| -dn.dot(vi.e[r]) * hn - n.dot(vi.e[r]) * h.dot(dn);
            out.a[r0][2 * i + s] = cx + turn(0);
            out.a[r1][2 * i + s] = cy + turn(1);
            if i > 0 {
                let (cx, cy) = dc(pa(v[i - 1].e[s]) * vi.eta_a);
                out.a[r0][2 * (i - 1) + s] = cx;
                out.a[r1][2 * (i - 1) + s] = cy;
            }
            if i + 1 < k {
                let (cx, cy) = dc(pb(v[i + 1].e[s]) * vi.eta_b);
                out.a[r0][2 * (i + 1) + s] = cx;
                out.a[r1][2 * (i + 1) + s] = cy;
            }
        }
        if i + 1 == k {
            let basis = end_basis(end, wb);
            for (s, l) in basis.into_iter().enumerate() {
                let dh = match end {
                    End::Point { .. } => pb(l) * vi.eta_b,
                    End::Direction { .. } => l * vi.eta_b,
                };
                let (cx, cy) = dc(dh);
                out.b[r0][s] = cx;
                out.b[r1][s] = cy;
            }
        }
    }
    Some(out)
}

/// Solves `a x = rhs` for the `n × n` top-left block of `a` (`n` ≤ 4) by Gaussian elimination with
/// partial pivoting; `None` when it is singular.
fn linear_solve<const M: usize>(
    a: &[[f32; 4]; 4],
    rhs: &[[f32; M]; 4],
    n: usize,
) -> Option<[[f32; M]; 4]> {
    let mut a = *a;
    let mut x = *rhs;
    let scale = a
        .iter()
        .take(n)
        .flat_map(|row| row.iter().take(n))
        .fold(0.0f32, |m, v| m.max(v.abs()));
    if !(scale > 0.0 && scale.is_finite()) {
        return None;
    }
    for col in 0..n {
        let pivot = (col..n).fold(col, |p, row| {
            if a[row][col].abs() > a[p][col].abs() {
                row
            } else {
                p
            }
        });
        let size = a[pivot][col].abs();
        if size.is_nan() || size <= 1.0e-7 * scale {
            return None;
        }
        a.swap(col, pivot);
        x.swap(col, pivot);
        let (top, below) = a.split_at_mut(col + 1);
        let (xtop, xbelow) = x.split_at_mut(col + 1);
        let (prow, xrow) = (&top[col], &xtop[col]);
        let inv = 1.0 / prow[col];
        for (row, xr) in below.iter_mut().zip(xbelow.iter_mut()).take(n - col - 1) {
            let f = row[col] * inv;
            if f == 0.0 {
                continue;
            }
            for (v, p) in row.iter_mut().zip(prow).take(n).skip(col) {
                *v -= f * p;
            }
            for (v, p) in xr.iter_mut().zip(xrow) {
                *v -= f * p;
            }
        }
    }
    for col in (0..n).rev() {
        let inv = 1.0 / a[col][col];
        let (head, tail) = x.split_at_mut(col + 1);
        let row = &mut head[col];
        for (m, v) in row.iter_mut().enumerate() {
            let mut sum = *v;
            for (c, solved) in tail.iter().enumerate().take(n - col - 1) {
                sum -= a[col][col + 1 + c] * solved[m];
            }
            *v = sum * inv;
        }
    }
    x.iter()
        .take(n)
        .all(|row| row.iter().all(|v| v.is_finite()))
        .then_some(x)
}

/// The vertices of `old` moved by `step` (scaled by `beta`) in their tangent planes and projected
/// back onto their surfaces: each segment is traced again from the (new) previous vertex, or from
/// `x`, towards the moved vertex, through what shadow rays cross, and must stop on the same
/// surface from the same side.
#[allow(clippy::too_many_arguments)]
fn project<T: Tracer>(
    prepared: &Prepared,
    scene: &Scene,
    tracer: &T,
    x: Vec3,
    chain: &Chain,
    old: &[Vertex; MAX_CHAIN],
    step: &[[f32; 1]; 4],
    beta: f32,
    rays: &mut u64,
) -> Option<[Vertex; MAX_CHAIN]> {
    let mut out = *old;
    for i in 0..chain.len {
        let o = &old[i];
        let delta = (o.e[0] * step[2 * i][0] + o.e[1] * step[2 * i + 1][0]) * beta;
        let (origin, toward) = match i.checked_sub(1) {
            // From x, relative to it (the first segment may be a fraction of a millimetre long).
            None => (x, o.dir * o.len + delta),
            // From just beyond the previous vertex, aimed at the moved point itself (a ray
            // parallel to the segment would land beside it by the offset, as far as a thin pane
            // allows Newton to get).
            Some(j) => {
                let origin = offset_origin(out[j].p, -out[j].ng);
                (origin, o.p + delta - origin)
            }
        };
        let (dir, _) = unit(toward)?;
        let ray = Ray::new(origin, dir);
        let want = chain.crossings[i];
        let accept = |i: u32| i == want.instance;
        let Stop::Surface { details, keep, t } =
            prepared.first_stop(scene, tracer, &ray, accept, rays)
        else {
            return None;
        };
        if details.outside != want.entering {
            return None;
        }
        out[i] = vertex(scene, prepared, &details, dir, t, keep)?;
    }
    Some(out)
}

/// A solved refraction path from `x`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Path {
    chain: Chain,
    vertices: [Vertex; MAX_CHAIN],
    /// `|dωx / dA|` at the solution: how the unit direction leaving `x` changes with the end, per
    /// mm² of its measure (per steradian towards a sun).
    pub(crate) jacobian: f32,
}

impl Path {
    /// The unit direction the path leaves `x` in.
    pub(crate) fn wi(&self) -> Vec3 {
        self.vertices[0].dir
    }

    /// The vertices, in order from `x`.
    fn vertices(&self) -> &[Vertex] {
        &self.vertices[..self.chain.len]
    }

    /// The positions of the vertices (tests).
    #[cfg(test)]
    pub(crate) fn points(&self) -> Vec<Vec3> {
        self.vertices().iter().map(|v| v.p).collect()
    }
}

/// Solves the refraction path of `seed` from `x` to `end` by Newton's method (the module's
/// documentation): `None` when it does not converge within [`MAX_ITERATIONS`] projections, or
/// converges to something that does not refract at every vertex.
pub(crate) fn solve<T: Tracer>(
    prepared: &Prepared,
    scene: &Scene,
    tracer: &T,
    x: Vec3,
    seed: &Seed,
    end: &End,
    rays: &mut u64,
) -> Option<Path> {
    let k = seed.chain.len;
    if k == 0 {
        return None;
    }
    let n = 2 * k;
    let mut v = seed.vertices;
    let mut cons = constraints(&v[..k], end)?;
    let mut beta = 1.0f32;
    let mut iterations = 0;
    while cons.err.is_nan() || cons.err > TOLERANCE {
        if iterations == MAX_ITERATIONS {
            return None;
        }
        iterations += 1;
        let mut rhs = [[0.0f32; 1]; 4];
        for (r, c) in rhs.iter_mut().zip(cons.c) {
            r[0] = -c;
        }
        let step = linear_solve(&cons.a, &rhs, n)?;
        let moved = project(
            prepared,
            scene,
            tracer,
            x,
            &seed.chain,
            &v,
            &step,
            beta,
            rays,
        )
        .and_then(|w| constraints(&w[..k], end).map(|c| (w, c)));
        match moved {
            Some((w, c)) if c.merit < cons.merit => {
                v = w;
                cons = c;
                beta = (2.0 * beta).min(1.0);
            }
            _ => beta *= 0.5,
        }
    }
    // Every vertex refracts: the next segment leaves on the far side of its surface.
    for i in 0..k {
        let (wb, _) = onwards(&v[..k], i, end)?;
        if !positive(-wb.dot(v[i].ng)) {
            return None;
        }
    }
    // dv = -A⁻¹ B dy; the first vertex's block, and the solid angle at x per area there.
    let moves = linear_solve(&cons.a, &cons.b, n)?;
    let det = moves[0][0] * moves[1][1] - moves[0][1] * moves[1][0];
    let first = &v[0];
    let plane = first.e[0].cross(first.e[1]);
    let jacobian = first.dir.dot(plane).abs() / (first.len * first.len) * det.abs();
    (jacobian > 0.0 && jacobian.is_finite()).then_some(Path {
        chain: seed.chain,
        vertices: v,
        jacobian,
    })
}

/// The seed traced from the light: the ray from the end towards `x`, refracted by Snell's law
/// (about the shading normal) at each surface of `chain`, met in reverse order from the far side;
/// its crossings, traced again from `x` ([`seed_through`]). Where the glass bends the light a long
/// way from the straight line (a ball, the curved side of a glass of water), it starts Newton's
/// method nearer the solution than the straight seed does. `None` when the refracted ray does not
/// meet the chain's surfaces in that order.
fn seed_from_light<T: Tracer>(
    prepared: &Prepared,
    scene: &Scene,
    tracer: &T,
    x: Vec3,
    straight: &Seed,
    end: &End,
    rays: &mut u64,
) -> Option<Seed> {
    let chain = &straight.chain;
    let k = chain.len;
    let last = straight.vertices[k - 1].p;
    // From the light's point, or from beyond the chain towards a sun.
    let start = match *end {
        End::Point { y, .. } => y,
        End::Direction { w } => last + w * (2.0 * (last - x).length() + 100.0),
    };
    let (mut dir, _) = unit(x - start)?;
    let mut origin = start;
    let mut points = [Vec3::ZERO; MAX_CHAIN];
    for j in (0..k).rev() {
        let want = chain.crossings[j];
        let accept = |i: u32| i == want.instance;
        let ray = Ray::new(origin, dir);
        let Stop::Surface { details, .. } = prepared.first_stop(scene, tracer, &ray, accept, rays)
        else {
            return None;
        };
        // Met from the far side: where x's side enters the solid, the light leaves it.
        if details.outside == want.entering {
            return None;
        }
        let ior = prepared.material(scene, want.instance).ior;
        let (from, to) = if want.entering {
            (ior, 1.0)
        } else {
            (1.0, ior)
        };
        let n = details.normal;
        let eta = from / to;
        let cos_i = -dir.dot(n);
        let sin2 = eta * eta * (1.0 - cos_i * cos_i);
        if !(sin2 < 1.0) {
            return None;
        }
        dir = (dir * eta + n * (eta * cos_i - (1.0 - sin2).sqrt())).normalize();
        points[j] = details.point;
        origin = offset_origin(details.point, -details.geometric_normal);
    }
    let (wi, _) = unit(points[0] - x)?;
    seed_through(prepared, scene, tracer, x, chain, wi, &points, rays)
}

/// The path manifold next-event estimation connects `x` to `end` by, for the straight seed
/// `seed`: Newton's method from it, and from the seed traced from the light when that fails
/// ([`seed_from_light`]), the first that converges. One function for both sides of the MIS, so
/// each light point has at most one connection, the same on both.
pub(crate) fn connection_path<T: Tracer>(
    prepared: &Prepared,
    scene: &Scene,
    tracer: &T,
    x: Vec3,
    seed: &Seed,
    end: &End,
    rays: &mut u64,
) -> Option<Path> {
    solve(prepared, scene, tracer, x, seed, end, rays).or_else(|| {
        let lit = seed_from_light(prepared, scene, tracer, x, seed, end, rays)?;
        solve(prepared, scene, tracer, x, &lit, end, rays)
    })
}

/// What a solved path keeps of the light that travels it from its end to `x`: at each interface
/// the Fresnel transmittance and the `(ηₐ/η_b)²` of radiance, the glass's tint (once per
/// crossing, as its BSDF tints a refraction) or the Beer–Lambert absorption of the segments inside
/// it, and what the cut-outs and thin walls on the segments keep.
fn transmittance(prepared: &Prepared, scene: &Scene, path: &Path, end: &End) -> Rgb {
    let v = path.vertices();
    let k = v.len();
    let mut keep = Rgb::WHITE;
    for (i, vi) in v.iter().enumerate() {
        let crossing = path.chain.crossings[i];
        let m = prepared.material(scene, crossing.instance);
        let Some((wa, la)) = backwards(v, i) else {
            return Rgb::BLACK;
        };
        let f = fresnel_dielectric(wa.dot(vi.n).abs(), vi.eta_b / vi.eta_a);
        let ratio = vi.eta_a / vi.eta_b;
        keep = keep * vi.keep * ((1.0 - f) * ratio * ratio);
        let sigma = prepared.medium_inside(scene, crossing.instance);
        if sigma.is_none() {
            keep = keep * m.base_color.map(|c| c.clamp(0.0, 1.0).sqrt());
        }
        // The segment arriving at a vertex where the path leaves the solid is inside it.
        if let (false, Some(s)) = (crossing.entering, sigma) {
            keep = keep * super::beer_lambert(s, la);
        }
    }
    // A light inside the last solid the path entered.
    let last = path.chain.crossings[k - 1];
    if let (true, Some(s)) = (last.entering, prepared.medium_inside(scene, last.instance)) {
        let inside = match *end {
            End::Point { y, .. } => (y - v[k - 1].p).length(),
            End::Direction { .. } => f32::INFINITY,
        };
        keep = keep * super::beer_lambert(s, inside);
    }
    keep
}

/// A connection of manifold next-event estimation from a vertex to a light.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Connection {
    /// The unit direction it leaves the vertex in.
    pub(crate) wi: Vec3,
    /// What the light sends along it times what the path keeps ([`Lights::manifold_emission`] and
    /// the transmittance of the refractions, the cut-outs and thin walls, the last segment).
    pub(crate) light: Rgb,
    /// [`Path::jacobian`].
    pub(crate) jacobian: f32,
}

/// Solves the path of `seed` from `x` to the light sample `end` and traces its last segment: the
/// connection, or `None` when it does not converge, is blocked or carries nothing.
#[allow(clippy::too_many_arguments)]
pub(crate) fn connect<T: Tracer>(
    prepared: &Prepared,
    scene: &Scene,
    tracer: &T,
    lights: &Lights,
    x: Vec3,
    seed: &Seed,
    end: &ManifoldEnd,
    rays: &mut u64,
) -> Option<Connection> {
    let path = connection_path(prepared, scene, tracer, x, seed, &end.end, rays)?;
    let v = path.vertices();
    let last = v[v.len() - 1];
    let (wb, distance) = match end.end {
        End::Point { y, .. } => unit(y - last.p)?,
        End::Direction { w } => (w, f32::INFINITY),
    };
    let emitted = lights.manifold_emission(end.entry, &end.end, -wb, last.p);
    if !positive(peak(emitted)) {
        return None;
    }
    *rays += 1;
    let origin = offset_origin(last.p, -last.ng);
    let pass = prepared.shadow(scene, tracer, &shadow_ray(origin, wb, distance))?;
    let light = emitted * transmittance(prepared, scene, &path, &end.end) * pass;
    (peak(light) > 0.0).then_some(Connection {
        wi: path.wi(),
        light,
        jacobian: path.jacobian,
    })
}

/// The last vertex a path left that manifold next-event estimation connects from, and the smooth
/// refractions since (the module's documentation, MIS).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Track {
    /// The shading point, where its lights were chosen and sampled from.
    pub(crate) point: Vec3,
    /// Where its shadow rays leave from, above its surface and below it.
    pub(crate) up: Vec3,
    pub(crate) down: Vec3,
    /// Its BSDF, frame and outgoing direction (local).
    pub(crate) bsdf: Bsdf,
    pub(crate) frame: Frame,
    pub(crate) wo: Vec3,
    /// Its light selection.
    pub(crate) selection: Selection,
    /// The unit direction the path left it in.
    pub(crate) wi: Vec3,
    /// The chain surfaces refracted through since, and where.
    pub(crate) chain: Chain,
    pub(crate) points: [Vec3; MAX_CHAIN],
    /// More of them than a connection goes through.
    pub(crate) overflow: bool,
}

impl Track {
    /// A track from a vertex at the shading point `point` (shadow rays from `up` and `down`) with
    /// its BSDF, frame, outgoing direction and light selection, that the path left in `wi`.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        point: Vec3,
        up: Vec3,
        down: Vec3,
        bsdf: Bsdf,
        frame: Frame,
        wo: Vec3,
        selection: Selection,
        wi: Vec3,
    ) -> Track {
        Track {
            point,
            up,
            down,
            bsdf,
            frame,
            wo,
            selection,
            wi,
            chain: Chain::EMPTY,
            points: [Vec3::ZERO; MAX_CHAIN],
            overflow: false,
        }
    }

    /// The path refracted through a chain surface at `at`.
    pub(crate) fn push(&mut self, c: Crossing, at: Vec3) {
        let slot = self.chain.len;
        if self.chain.push(c) {
            self.points[slot] = at;
        } else {
            self.overflow = true;
        }
    }
}

/// The factor of the MIS weight of a light `found` by a path of `track` (the module's
/// documentation): `None` outside the domain of manifold next-event estimation at the track's
/// vertex (the light keeps its weight), one where the connection to that point does not produce
/// this path, and the power heuristic of the path's BSDF density against the connection's
/// otherwise. `photons`: the camera path gathers caustics (the lights that send photons are left
/// to the map). The rays it traces are added to `rays`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn found_factor<T: Tracer>(
    prepared: &Prepared,
    scene: &Scene,
    tracer: &T,
    lights: &Lights,
    track: &Track,
    found: Found,
    photons: bool,
    rays: &Cell<u64>,
) -> Option<f32> {
    let end = lights.manifold_found(found, track.point, &track.selection)?;
    if end.photon && photons {
        return None;
    }
    // What next-event estimation at the vertex does with that point: its straight direction must
    // light the BSDF there, and its shadow ray leaves on that side.
    let (straight, distance) = match end.end {
        End::Point { y, .. } => unit(y - track.point)?,
        End::Direction { w } => (w, f32::INFINITY),
    };
    let local = track.frame.to_local(straight);
    if !positive(peak(track.bsdf.eval(track.wo, local, Lobes::All))) {
        return None;
    }
    let below = local.z < 0.0;
    let from = if below { track.down } else { track.up };
    let mut traced = 0u64;
    let seed = seed(
        prepared,
        scene,
        tracer,
        from,
        straight,
        distance,
        &mut traced,
    );
    let factor = seed.map(|seed| {
        let same = !track.overflow
            && seed.chain == track.chain
            && below == (track.frame.to_local(track.wi).z < 0.0);
        if !same {
            return 1.0;
        }
        let Some(path) =
            connection_path(prepared, scene, tracer, from, &seed, &end.end, &mut traced)
        else {
            return 1.0;
        };
        let wi = path.wi();
        let local = track.frame.to_local(wi);
        if (local.z < 0.0) != below {
            return 1.0;
        }
        // The specular path through the patches this path crossed: is it that solution?
        let own = seed_through(
            prepared,
            scene,
            tracer,
            from,
            &track.chain,
            track.wi,
            &track.points,
            &mut traced,
        )
        .and_then(|own| solve(prepared, scene, tracer, from, &own, &end.end, &mut traced));
        if !own.is_some_and(|own| own.wi().dot(wi) >= MATCH_COS) {
            return 1.0;
        }
        let p_bsdf = track.bsdf.pdf(track.wo, local);
        lights.found_weight(p_bsdf, end.density / path.jacobian)
    });
    rays.set(rays.get() + traced);
    factor
}

#[cfg(test)]
mod tests;

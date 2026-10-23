//! The world: dynamic bodies, the static triangles, and the fixed-step XPBD loop.
//!
//! One step of [`STEP`] seconds finds the contacts once (broad phase with boxes grown by how far
//! a body can move in the step, narrow phase in [`crate::collide`]; a body's manifolds with
//! coplanar static triangles are merged into one), sorts them by (body, body, feature) and then
//! runs [`SUBSTEPS`] substeps of the rigid body XPBD loop of Müller et al. (SCA 2020,
//! Algorithm 2), one position iteration each:
//!
//! 1. integrate: `v += g h`, `x += v h`, `ω += h I⁻¹(−ω × Iω)`, `q += ½ h [ω, 0] q`;
//! 2. solve positions: for every contact point that penetrates, `Δλ = −C / (w₁ + w₂)` along the
//!    normal (zero compliance), with the generalised inverse masses
//!    `wᵢ = 1/mᵢ + (rᵢ × n)ᵀ Iᵢ⁻¹ (rᵢ × n)`; then the static friction of the manifold's patch;
//! 3. velocities from positions: `v = (x − x_prev)/h`, `ω = 2 vec(q q_prev⁻¹)/h`;
//! 4. solve velocities: restitution of each point towards `−e ṽₙ` (zero below `2 |g| h`, which
//!    keeps resting contacts still), then the dynamic friction of the patch,
//!    `−vₜ/|vₜ| min(h μ |fₙ|, |vₜ|)` with `fₙ = λₙ/h²`, read as impulses (the paper's velocity form
//!    assumes unit generalised masses): a tangential impulse of at most `μ λₙ / h`, no more than
//!    stops the sliding.
//!
//! Where this differs from the paper, and why:
//!
//! * **Friction acts on the patch**, not on each point: the points of a manifold share one
//!   tangential constraint at their centre and one torsional constraint about the normal (with the
//!   patch's mean radius as the arm). Point by point, the order of the points pushed a box sideways
//!   and turned it a little every substep, and a stack crept apart.
//! * **Static friction holds against an anchor** kept from step to step while the patch stays
//!   put (the paper compares with the start of the substep), so the order of the constraints
//!   cannot creep resting bodies along either; a patch that slides re-anchors where it is.
//! * **Rolling resistance**: an angular impulse up to `δ λₙ / h` against the relative rolling,
//!   with `δ` a small fraction of the body's size ([`ROLLING_RESISTANCE`]), without which a ball on
//!   a plane rolls forever. A single point has a patch of that radius for the torsion too.
//! * **Sleeping**: a body whose farthest point moves on average slower than its rest speed for
//!   [`SLEEP_SECONDS`] (and never ten times faster meanwhile) stops and is not integrated; a
//!   sleeping body is immovable for the others until an awake one comes at it faster than its
//!   wake speed. With every body asleep, [`World::settled`] is true.
//!
//! **Determinism.** Everything is `f32` with IEEE operations only, in an order that depends on the
//! input alone: bodies in the order they were added, pairs from a sorted sweep, contacts sorted by
//! their key before the solver sees them. The narrow phase runs over the pairs in fixed chunks
//! ([`World::set_workers`]) and merges them by that key, so a parallel version gives the same
//! contacts in the same order whatever the number of threads; the tests check that the pose hash
//! does not change with it.

use crate::bvh::StaticMesh;
use crate::collide::{
    merge_manifolds, poly_poly, sphere_poly, sphere_sphere, sphere_triangle, Manifold, PlacedHull,
    Scratch, TriPoly, SAME_SURFACE_COS,
};
use crate::math::{above, tangential, Mat3, Quat};
use crate::shape::{BuiltShape, Shape, ShapeKind};
use rt_core::math::{Aabb, Vec3};

/// The fixed time step, seconds.
pub const STEP: f32 = 1.0 / 240.0;
/// Substeps per step.
pub const SUBSTEPS: u32 = 4;
/// Steps per second of simulated time.
pub const STEPS_PER_SECOND: u32 = 240;
/// Gravity, mm/s² along −Z (the model is Z up, in millimetres).
pub const GRAVITY: f32 = 9810.0;
/// A body slower than its rest speed this long falls asleep.
pub const SLEEP_SECONDS: f32 = 0.5;
/// Default density, kg/m³ (water).
pub const DEFAULT_DENSITY: f32 = 1000.0;
/// While it waits to sleep, a body may be this many times faster than its rest speed for a moment
/// (the jitter of a resting contact) as long as it does not get anywhere.
const WINDOW_SPEED_FACTOR: f32 = 10.0;
/// An awake body wakes a sleeping one it comes at faster than this many times the sleeper's rest
/// speed, and at least [`WAKE_SPEED`].
const WAKE_FACTOR: f32 = 10.0;
/// mm/s.
const WAKE_SPEED: f32 = 50.0;
/// Rolling resistance length as a fraction of the body's radius.
pub const ROLLING_RESISTANCE: f32 = 0.02;

/// Index of "no body": the B side of a contact with the static triangles.
const STATIC: u32 = u32::MAX;

/// Where a body is: the translation of its centre of mass and its rotation since it was added.
///
/// A body's frame is the world's axes at its centre of mass when it was added, so the pose maps
/// the body as it was then onto the body now: `p_now = translation + rotation (p_then − c₀)`,
/// with `c₀` the translation at step 0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    /// Centre of mass, mm.
    pub translation: Vec3,
    /// Rotation since the body was added.
    pub rotation: Quat,
}

/// An object-to-world transform: three rows of a 3 x 4 matrix (rotation, scale, translation).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Transform {
    /// `rows[i] = [m_i0, m_i1, m_i2, t_i]`.
    pub rows: [[f32; 4]; 3],
}

impl Transform {
    /// No change.
    pub const IDENTITY: Transform = Transform {
        rows: [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
        ],
    };

    /// A translation.
    pub fn translation(t: Vec3) -> Transform {
        let mut m = Transform::IDENTITY;
        m.rows[0][3] = t.x;
        m.rows[1][3] = t.y;
        m.rows[2][3] = t.z;
        m
    }

    /// A rotation then a translation.
    pub fn from_pose(t: Vec3, q: Quat) -> Transform {
        let r = q.to_mat3();
        Transform {
            rows: [
                [r.m[0][0], r.m[0][1], r.m[0][2], t.x],
                [r.m[1][0], r.m[1][1], r.m[1][2], t.y],
                [r.m[2][0], r.m[2][1], r.m[2][2], t.z],
            ],
        }
    }

    /// The image of the point `p`.
    #[inline]
    pub fn apply(&self, p: Vec3) -> Vec3 {
        let r = &self.rows;
        Vec3::new(
            r[0][0] * p.x + r[0][1] * p.y + r[0][2] * p.z + r[0][3],
            r[1][0] * p.x + r[1][1] * p.y + r[1][2] * p.z + r[1][3],
            r[2][0] * p.x + r[2][1] * p.y + r[2][2] * p.z + r[2][3],
        )
    }
}

/// What a dynamic body is made of.
#[derive(Clone, Copy, Debug)]
pub enum ShapeSource<'a> {
    /// The points of a mesh (its convex hull, or a ball when they are on one).
    Points(&'a [Vec3]),
    /// A ball of this radius centred at the transform's origin (scaled by its first column).
    Sphere(f32),
    /// A box of these half extents about the transform's origin.
    Cuboid(Vec3),
}

/// S9: a dynamic body as [`World::collider`] gives it: its shape about its centre of mass (in the
/// world's axes when it was added), where that centre is now and how the body has turned since,
/// and how fast it goes (zero while it sleeps).
#[derive(Clone, Copy, Debug)]
pub struct Collider<'a> {
    /// The shape, about the centre of mass.
    pub shape: &'a Shape,
    /// Centre of mass, mm.
    pub center: Vec3,
    /// Rotation since the body was added.
    pub rotation: Quat,
    /// mm/s.
    pub velocity: Vec3,
    /// rad/s.
    pub spin: Vec3,
    /// The farthest point of the shape from its centre, mm.
    pub radius: f32,
}

/// Surface and mass parameters of a body.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyParams {
    /// kg/m³.
    pub density: f32,
    /// Coulomb friction (static and dynamic).
    pub friction: f32,
    /// Restitution (bounciness), 0..1.
    pub restitution: f32,
}

impl Default for BodyParams {
    fn default() -> BodyParams {
        BodyParams {
            density: DEFAULT_DENSITY,
            friction: 0.5,
            restitution: 0.0,
        }
    }
}

/// A dynamic rigid body.
#[derive(Clone, Debug)]
struct Body {
    shape: Shape,
    kind: ShapeKind,
    x: Vec3,
    q: Quat,
    v: Vec3,
    w: Vec3,
    x_prev: Vec3,
    q_prev: Quat,
    inv_mass: f32,
    mass: f32,
    inertia: Mat3,
    inv_inertia: Mat3,
    friction: f32,
    restitution: f32,
    radius: f32,
    rest_speed: f32,
    sleep_time: f32,
    /// Where the body was when its current window of slowness began.
    rest_x: Vec3,
    rest_q: Quat,
    asleep: bool,
    aabb: Aabb,
    margin: f32,
}

impl Body {
    #[inline]
    fn movable(&self) -> bool {
        !self.asleep
    }

    /// `I⁻¹ v` in world space.
    #[inline]
    fn inv_inertia_world(&self, v: Vec3) -> Vec3 {
        self.q.rotate(self.inv_inertia.mul_vec(self.q.unrotate(v)))
    }

    /// The generalised inverse mass at the arm `r` along the unit direction `n`.
    #[inline]
    fn generalized(&self, r: Vec3, n: Vec3) -> f32 {
        if !self.movable() {
            return 0.0;
        }
        let rn = r.cross(n);
        self.inv_mass + rn.dot(self.inv_inertia_world(rn))
    }

    /// Applies the positional impulse `p` at the arm `r`.
    #[inline]
    fn apply_position(&mut self, p: Vec3, r: Vec3) {
        if !self.movable() {
            return;
        }
        self.x += p * self.inv_mass;
        let dw = self.inv_inertia_world(r.cross(p));
        self.q = self.q.add_rotation(dw);
    }

    /// Applies the velocity impulse `p` at the arm `r`.
    #[inline]
    fn apply_velocity(&mut self, p: Vec3, r: Vec3) {
        if !self.movable() {
            return;
        }
        self.v += p * self.inv_mass;
        self.w += self.inv_inertia_world(r.cross(p));
    }

    fn speed(&self) -> f32 {
        self.v.length() + self.w.length() * self.radius
    }
}

/// One contact point between a body and a body or the static triangles, for one step.
#[derive(Clone, Copy, Debug)]
struct Contact {
    key: (u32, u32, u32, u32),
    a: u32,
    b: u32,
    n: Vec3,
    /// The point on A, in A's frame.
    ra: Vec3,
    /// The point on B in B's frame, or in the world for the static triangles.
    rb: Vec3,
    friction: f32,
    restitution: f32,
    roll: f32,
    lambda: f32,
    vn_pre: f32,
}

/// The points of one manifold (a run of `contacts` with the same bodies and triangle) and the
/// patch they make, for friction.
#[derive(Clone, Copy, Debug)]
struct ManifoldRange {
    start: usize,
    end: usize,
    a: u32,
    b: u32,
    n: Vec3,
    /// The centre of the patch on A, in A's frame.
    ra: Vec3,
    /// On B, in B's frame or in the world.
    rb: Vec3,
    /// Mean distance of the points from the centre (the arm of the torsional friction), mm.
    radius: f32,
    friction: f32,
    /// Rolling resistance length, mm.
    roll: f32,
    /// The sum of the points' normal multipliers in the current substep.
    lambda: f32,
    /// Where static friction holds the patch: a point on A (A's frame) and the point of B it
    /// stuck to (B's frame, or the world), and the orientation of A in B's frame then.
    anchor: Option<Anchor>,
}

/// The friction anchor of a patch, kept from step to step while the patch stays put, so that
/// static friction holds the bodies where they stuck and not only during each substep (which
/// would let the order of the constraints creep them along).
#[derive(Clone, Copy, Debug, PartialEq)]
struct Anchor {
    on_a: Vec3,
    on_b: Vec3,
    turn: Quat,
}

/// A patch keeps its anchor into the next step while the anchor is closer than this to the new
/// patch centre, mm (a rolling ball's patch moves on at once).
const ANCHOR_KEEP: f32 = 0.25;

/// What [`World::add_dynamic`] could not do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BodyError {
    /// No points, or points that are not finite.
    NoGeometry,
    /// The shape has no volume or the parameters no mass.
    NoMass,
}

/// The simulation.
pub struct World {
    bodies: Vec<Body>,
    statics: StaticMesh,
    contacts: Vec<Contact>,
    manifolds: Vec<ManifoldRange>,
    /// The anchors of the last step's manifolds, by (A, B, triangle).
    anchors: Vec<((u32, u32, u32), Anchor)>,
    steps: u64,
    placed: Vec<PlacedHull>,
    scratch: Scratch,
    pairs: Vec<(u32, u32)>,
    tris: Vec<u32>,
    workers: usize,
}

impl Default for World {
    fn default() -> World {
        World::new()
    }
}

/// Speculative contacts start this far apart (mm) plus what the bodies can travel in a step.
const SLOP: f32 = 0.05;

impl World {
    /// An empty world: gravity −Z, no floor.
    pub fn new() -> World {
        World {
            bodies: Vec::new(),
            statics: StaticMesh::default(),
            contacts: Vec::new(),
            manifolds: Vec::new(),
            anchors: Vec::new(),
            steps: 0,
            placed: Vec::new(),
            scratch: Scratch::default(),
            pairs: Vec::new(),
            tris: Vec::new(),
            workers: 1,
        }
    }

    /// Adds static triangles: `positions` through `transform`, three indices per triangle.
    pub fn add_static_mesh(
        &mut self,
        positions: &[Vec3],
        indices: &[u32],
        transform: &Transform,
        friction: f32,
        restitution: f32,
    ) {
        let world: Vec<Vec3> = positions.iter().map(|p| transform.apply(*p)).collect();
        self.statics.add(&world, indices, friction, restitution);
    }

    /// Adds the floor: one static triangle facing up at height `z` that covers the square of half
    /// side `half` centred on `(cx, cy)` (one triangle, so no edge of the floor runs under the
    /// bodies).
    pub fn add_floor(
        &mut self,
        z: f32,
        center: (f32, f32),
        half: f32,
        friction: f32,
        restitution: f32,
    ) {
        let (cx, cy) = center;
        let p = [
            Vec3::new(cx - half, cy - half, z),
            Vec3::new(cx + 3.0 * half, cy - half, z),
            Vec3::new(cx - half, cy + 3.0 * half, z),
        ];
        self.statics.add(&p, &[0, 1, 2], friction, restitution);
    }

    /// Adds a dynamic body and returns its index (the order of [`World::poses`]). A mesh becomes
    /// its convex hull (or its oriented box: flat, or over the vertex cap), or a ball when its
    /// points are on one; its mass is `density × volume`.
    pub fn add_dynamic(
        &mut self,
        source: ShapeSource,
        transform: &Transform,
        params: BodyParams,
    ) -> Result<u32, BodyError> {
        let built = match source {
            ShapeSource::Points(points) => {
                if points.is_empty() || points.iter().any(|p| !p.is_finite()) {
                    return Err(BodyError::NoGeometry);
                }
                let world: Vec<Vec3> = points.iter().map(|p| transform.apply(*p)).collect();
                let mut lo = world[0];
                let mut hi = world[0];
                for p in &world {
                    lo = lo.min(*p);
                    hi = hi.max(*p);
                }
                let size = (hi - lo).max_component();
                BuiltShape::from_points(&world, (size * 0.01).max(0.5))
            }
            ShapeSource::Sphere(r) => {
                let c = transform.apply(Vec3::ZERO);
                let s = Vec3::new(
                    transform.rows[0][0],
                    transform.rows[1][0],
                    transform.rows[2][0],
                )
                .length();
                BuiltShape::sphere(c, r * s)
            }
            ShapeSource::Cuboid(half) => {
                let mut pts = Vec::with_capacity(8);
                for i in 0..8 {
                    pts.push(transform.apply(Vec3::new(
                        if i & 1 != 0 { half.x } else { -half.x },
                        if i & 2 != 0 { half.y } else { -half.y },
                        if i & 4 != 0 { half.z } else { -half.z },
                    )));
                }
                BuiltShape::from_points(&pts, 0.5)
            }
        };
        let mass = params.density * built.volume * 1e-9;
        let inertia = built.inertia.scale(params.density * 1e-9);
        let inv_inertia = inertia.inverse();
        let (Some(inv_inertia), true) = (inv_inertia, mass > 0.0 && mass.is_finite()) else {
            return Err(BodyError::NoMass);
        };
        let radius = built.shape.radius();
        self.bodies.push(Body {
            shape: built.shape,
            kind: built.kind,
            x: built.center,
            q: Quat::IDENTITY,
            v: Vec3::ZERO,
            w: Vec3::ZERO,
            x_prev: built.center,
            q_prev: Quat::IDENTITY,
            inv_mass: 1.0 / mass,
            mass,
            inertia,
            inv_inertia,
            friction: params.friction.max(0.0),
            restitution: params.restitution.clamp(0.0, 1.0),
            radius,
            rest_speed: (0.05 * radius).max(3.0),
            sleep_time: 0.0,
            rest_x: built.center,
            rest_q: Quat::IDENTITY,
            asleep: false,
            aabb: Aabb::EMPTY,
            margin: 0.0,
        });
        self.placed.push(PlacedHull::default());
        Ok(self.bodies.len() as u32 - 1)
    }

    /// Sets the speed of body `i` (mm/s, rad/s), waking it.
    pub fn set_velocity(&mut self, i: u32, v: Vec3, w: Vec3) {
        if let Some(b) = self.bodies.get_mut(i as usize) {
            b.v = v;
            b.w = w;
            b.asleep = false;
            b.sleep_time = 0.0;
            b.rest_x = b.x;
            b.rest_q = b.q;
        }
    }

    /// Splits the narrow phase into `n` chunks of the pair list, as `n` threads would. The result
    /// does not depend on it (contacts are merged by their key); the tests check that.
    pub fn set_workers(&mut self, n: usize) {
        self.workers = n.max(1);
    }

    /// Number of dynamic bodies.
    pub fn body_count(&self) -> usize {
        self.bodies.len()
    }

    /// Number of static triangles.
    pub fn static_triangles(&self) -> usize {
        self.statics.len()
    }

    /// What body `i`'s shape was made from.
    pub fn shape_kind(&self, i: u32) -> Option<ShapeKind> {
        self.bodies.get(i as usize).map(|b| b.kind)
    }

    /// The mass of body `i`, kg.
    pub fn mass(&self, i: u32) -> Option<f32> {
        self.bodies.get(i as usize).map(|b| b.mass)
    }

    /// Steps simulated.
    pub fn steps(&self) -> u64 {
        self.steps
    }

    /// Simulated time, seconds.
    pub fn time(&self) -> f32 {
        self.steps as f32 / STEPS_PER_SECOND as f32
    }

    /// Bodies awake.
    pub fn awake_count(&self) -> usize {
        self.bodies.iter().filter(|b| !b.asleep).count()
    }

    /// Every body is asleep (the simulation has nothing left to do).
    pub fn settled(&self) -> bool {
        self.bodies.iter().all(|b| b.asleep)
    }

    /// Contacts found in the last step.
    pub fn contact_count(&self) -> usize {
        self.contacts.len()
    }

    /// The pose of every body, in the order they were added.
    pub fn poses(&self) -> Vec<Pose> {
        self.bodies
            .iter()
            .map(|b| Pose {
                translation: b.x,
                rotation: b.q,
            })
            .collect()
    }

    /// The pose of body `i`.
    pub fn pose(&self, i: u32) -> Option<Pose> {
        self.bodies.get(i as usize).map(|b| Pose {
            translation: b.x,
            rotation: b.q,
        })
    }

    /// S9: body `i` as something that is not a body collides with it (the cloth, which the bodies
    /// push but which does not push them back).
    pub fn collider(&self, i: u32) -> Option<Collider<'_>> {
        self.bodies.get(i as usize).map(|b| Collider {
            shape: &b.shape,
            center: b.x,
            rotation: b.q,
            velocity: if b.asleep { Vec3::ZERO } else { b.v },
            spin: if b.asleep { Vec3::ZERO } else { b.w },
            radius: b.radius,
        })
    }

    /// FNV-1a (32 bits) over the little-endian bytes of every pose: translation x, y, z, then the
    /// rotation x, y, z, w, body after body.
    pub fn hash(&self) -> u32 {
        let mut h: u32 = 0x811c_9dc5;
        for b in &self.bodies {
            for v in [b.x.x, b.x.y, b.x.z, b.q.x, b.q.y, b.q.z, b.q.w] {
                for byte in v.to_le_bytes() {
                    h ^= byte as u32;
                    h = h.wrapping_mul(0x0100_0193);
                }
            }
        }
        h
    }

    /// Simulates `n` steps.
    pub fn step(&mut self, n: u32) {
        for _ in 0..n {
            self.step_once();
        }
    }

    fn step_once(&mut self) {
        self.steps += 1;
        if self.settled() {
            return;
        }
        self.collide();
        let h = STEP / SUBSTEPS as f32;
        for _ in 0..SUBSTEPS {
            self.substep(h);
        }
        self.anchors.clear();
        for m in &self.manifolds {
            if let Some(anchor) = m.anchor {
                self.anchors
                    .push(((m.a, m.b, self.contacts[m.start].key.2), anchor));
            }
        }
        for b in self.bodies.iter_mut() {
            if b.asleep {
                continue;
            }
            // Slow: no faster than its rest speed on average since the window began (how far its
            // farthest point got from where it was then), and never much faster in between. The
            // average ignores the jitter of a resting contact, which goes back and forth.
            let turn = b.q * b.rest_q.conj();
            let angle = 2.0 * turn.vector().length().min(1.0);
            let reach = (b.x - b.rest_x).length() + angle * b.radius;
            let calm = b.speed() < WINDOW_SPEED_FACTOR * b.rest_speed;
            if calm && reach <= b.rest_speed * SLEEP_SECONDS {
                b.sleep_time += STEP;
                if b.sleep_time >= SLEEP_SECONDS {
                    b.asleep = true;
                    b.v = Vec3::ZERO;
                    b.w = Vec3::ZERO;
                    b.x_prev = b.x;
                    b.q_prev = b.q;
                }
            } else {
                b.sleep_time = 0.0;
                b.rest_x = b.x;
                b.rest_q = b.q;
            }
        }
    }

    // --- Collision detection ---------------------------------------------------------------

    fn collide(&mut self) {
        // Boxes grown by the reach of a step, and the hulls placed.
        for (i, b) in self.bodies.iter_mut().enumerate() {
            b.margin = if b.asleep {
                SLOP
            } else {
                b.speed() * STEP * 1.5 + SLOP
            };
            let grow = Vec3::splat(b.margin);
            b.aabb = match &b.shape {
                Shape::Sphere { radius } => Aabb::new(
                    b.x - Vec3::splat(*radius) - grow,
                    b.x + Vec3::splat(*radius) + grow,
                ),
                Shape::Hull(h) => {
                    self.placed[i].place(h, b.x, b.q);
                    let mut bx = Aabb::EMPTY;
                    for v in &self.placed[i].world.verts {
                        bx = bx.extend(*v);
                    }
                    Aabb::new(bx.min - grow, bx.max + grow)
                }
            };
        }
        // Body pairs: a sweep along x over the boxes sorted by (min x, index).
        let mut order: Vec<u32> = (0..self.bodies.len() as u32).collect();
        order.sort_by(|&a, &b| {
            self.bodies[a as usize]
                .aabb
                .min
                .x
                .total_cmp(&self.bodies[b as usize].aabb.min.x)
                .then(a.cmp(&b))
        });
        self.pairs.clear();
        for k in 0..order.len() {
            let i = order[k] as usize;
            for &j in &order[k + 1..] {
                let j = j as usize;
                let (bi, bj) = (&self.bodies[i], &self.bodies[j]);
                if bj.aabb.min.x > bi.aabb.max.x {
                    break;
                }
                if bi.asleep && bj.asleep {
                    continue;
                }
                if overlaps(&bi.aabb, &bj.aabb) {
                    self.pairs.push((i.min(j) as u32, i.max(j) as u32));
                }
            }
        }
        // A sleeping body wakes when an awake one comes at it fast (the jitter of a body resting
        // on it does not).
        for &(i, j) in &self.pairs {
            let (i, j) = (i as usize, j as usize);
            let (si, sj) = (self.bodies[i].asleep, self.bodies[j].asleep);
            if si != sj {
                let (sleeper, other) = if si { (i, j) } else { (j, i) };
                let (s, o) = (&self.bodies[sleeper], &self.bodies[other]);
                let towards = (s.x - o.x).normalize();
                let approach = o.v.dot(towards) + o.w.length() * o.radius;
                if approach > (WAKE_FACTOR * s.rest_speed).max(WAKE_SPEED) {
                    let b = &mut self.bodies[sleeper];
                    b.asleep = false;
                    b.sleep_time = 0.0;
                    b.rest_x = b.x;
                    b.rest_q = b.q;
                }
            }
        }
        self.pairs.sort_unstable();
        // Body and static triangles: (body, STATIC) pairs carry the triangle in `tris`.
        let mut static_pairs: Vec<(u32, u32)> = Vec::new();
        for (i, b) in self.bodies.iter().enumerate() {
            if b.asleep {
                continue;
            }
            self.tris.clear();
            self.statics.query(&b.aabb, &mut self.tris);
            for &t in &self.tris {
                static_pairs.push((i as u32, t));
            }
        }
        // Narrow phase in chunks, each with its own lists, merged in a fixed order.
        let body_pairs = std::mem::take(&mut self.pairs);
        let total = body_pairs.len() + static_pairs.len();
        let workers = self.workers.min(total.max(1));
        type Chunk = (Vec<Contact>, Vec<(u32, u32, Manifold)>);
        let mut chunks: Vec<Chunk> = vec![(Vec::new(), Vec::new()); workers];
        // Later chunks first, as threads that finish out of order would.
        for w in (0..workers).rev() {
            let (lo, hi) = (total * w / workers, total * (w + 1) / workers);
            let mut out = Vec::new();
            let mut statics = Vec::new();
            for k in lo..hi {
                if k < body_pairs.len() {
                    let (i, j) = body_pairs[k];
                    self.narrow_bodies(i, j, &mut out);
                } else {
                    let (i, t) = static_pairs[k - body_pairs.len()];
                    if let Some(m) = self.narrow_static(i, t) {
                        statics.push((i, t, m));
                    }
                }
            }
            chunks[w] = (out, statics);
        }
        self.pairs = body_pairs;
        self.contacts.clear();
        let mut statics: Vec<(u32, u32, Manifold)> = Vec::new();
        for (mut c, mut s) in chunks.into_iter().rev() {
            self.contacts.append(&mut c);
            statics.append(&mut s);
        }
        // A body's manifolds with triangles of one flat surface become one (by body, then by
        // triangle, so the grouping does not depend on the chunks).
        statics.sort_unstable_by_key(|s| (s.0, s.1));
        let mut used = vec![false; statics.len()];
        let mut group: Vec<Manifold> = Vec::new();
        let mut contacts = std::mem::take(&mut self.contacts);
        for k in 0..statics.len() {
            if used[k] {
                continue;
            }
            let (body, tri, m) = statics[k];
            group.clear();
            group.push(m);
            used[k] = true;
            for l in k + 1..statics.len() {
                if statics[l].0 != body {
                    break;
                }
                if !used[l] && statics[l].2.n.dot(m.n) > SAME_SURFACE_COS {
                    group.push(statics[l].2);
                    used[l] = true;
                }
            }
            let merged = if group.len() == 1 {
                m
            } else {
                merge_manifolds(&group)
            };
            self.push_manifold(&merged, body, STATIC, tri, &mut contacts);
        }
        self.contacts = contacts;
        self.contacts.sort_unstable_by_key(|c| c.key);
        // The manifolds: runs of the same (A, B, triangle).
        self.manifolds.clear();
        let mut start = 0;
        while start < self.contacts.len() {
            let c0 = self.contacts[start];
            let mut end = start + 1;
            while end < self.contacts.len()
                && (
                    self.contacts[end].key.0,
                    self.contacts[end].key.1,
                    self.contacts[end].key.2,
                ) == (c0.key.0, c0.key.1, c0.key.2)
            {
                end += 1;
            }
            let k = 1.0 / (end - start) as f32;
            let (mut ra, mut rb) = (Vec3::ZERO, Vec3::ZERO);
            for c in &self.contacts[start..end] {
                ra += c.ra;
                rb += c.rb;
            }
            let (ra, rb) = (ra * k, rb * k);
            let mut radius = 0.0;
            for c in &self.contacts[start..end] {
                radius += (c.ra - ra).length();
            }
            // A single point still has a small patch: something to stop a ball spinning in place.
            let radius = (radius * k).max(c0.roll);
            self.manifolds.push(ManifoldRange {
                start,
                end,
                a: c0.a,
                b: c0.b,
                n: c0.n,
                ra,
                rb,
                radius,
                friction: c0.friction,
                roll: c0.roll,
                lambda: 0.0,
                anchor: None,
            });
            start = end;
        }
        // Anchors that are still where the patch is.
        for m in self.manifolds.iter_mut() {
            let key = (m.a, m.b, self.contacts[m.start].key.2);
            let Ok(k) = self.anchors.binary_search_by(|e| e.0.cmp(&key)) else {
                continue;
            };
            let anchor = self.anchors[k].1;
            let a = &self.bodies[m.a as usize];
            let now = a.x + a.q.rotate(m.ra);
            let then = a.x + a.q.rotate(anchor.on_a);
            if (now - then).length() < ANCHOR_KEEP {
                m.anchor = Some(anchor);
            }
        }
    }

    fn push_manifold(&self, m: &Manifold, a: u32, b: u32, tri: u32, out: &mut Vec<Contact>) {
        let ba = &self.bodies[a as usize];
        let (friction, restitution, roll) = if b == STATIC {
            let t = self.statics.tri(tri as usize);
            (
                (ba.friction * t.friction).sqrt(),
                ba.restitution.max(t.restitution),
                ROLLING_RESISTANCE * ba.radius,
            )
        } else {
            let bb = &self.bodies[b as usize];
            (
                (ba.friction * bb.friction).sqrt(),
                ba.restitution.max(bb.restitution),
                ROLLING_RESISTANCE * ba.radius.min(bb.radius),
            )
        };
        for p in m.points() {
            let ra = ba.q.unrotate(p.pa - ba.x);
            let rb = if b == STATIC {
                p.pb
            } else {
                let bb = &self.bodies[b as usize];
                bb.q.unrotate(p.pb - bb.x)
            };
            out.push(Contact {
                key: (a, b, tri, p.feature),
                a,
                b,
                n: m.n,
                ra,
                rb,
                friction,
                restitution,
                roll,
                lambda: 0.0,
                vn_pre: 0.0,
            });
        }
    }

    fn narrow_bodies(&mut self, i: u32, j: u32, out: &mut Vec<Contact>) {
        let (bi, bj) = (&self.bodies[i as usize], &self.bodies[j as usize]);
        let margin = bi.margin + bj.margin;
        let mut scratch = std::mem::take(&mut self.scratch);
        let m = match (&bi.shape, &bj.shape) {
            (Shape::Sphere { radius: ra }, Shape::Sphere { radius: rb }) => {
                sphere_sphere(bi.x, *ra, bj.x, *rb, margin)
            }
            (Shape::Sphere { radius }, Shape::Hull(h)) => {
                sphere_poly(bi.x, *radius, &self.placed[j as usize].poly(h), margin)
            }
            (Shape::Hull(h), Shape::Sphere { radius }) => {
                sphere_poly(bj.x, *radius, &self.placed[i as usize].poly(h), margin)
                    .map(|m| m.flipped())
            }
            (Shape::Hull(ha), Shape::Hull(hb)) => poly_poly(
                &self.placed[i as usize].poly(ha),
                &self.placed[j as usize].poly(hb),
                margin,
                false,
                &mut scratch,
            ),
        };
        self.scratch = scratch;
        if let Some(m) = m {
            self.push_manifold(&m, i, j, 0, out);
        }
    }

    fn narrow_static(&mut self, i: u32, t: u32) -> Option<Manifold> {
        let b = &self.bodies[i as usize];
        let tri = *self.statics.tri(t as usize);
        let mut scratch = std::mem::take(&mut self.scratch);
        let m = match &b.shape {
            Shape::Sphere { radius } => sphere_triangle(b.x, *radius, &tri.v, tri.n, b.margin),
            Shape::Hull(h) => {
                let tp = TriPoly::new(tri.v, tri.n);
                poly_poly(
                    &self.placed[i as usize].poly(h),
                    &tp.poly(),
                    b.margin,
                    true,
                    &mut scratch,
                )
            }
        };
        self.scratch = scratch;
        m
    }

    // --- The solver ------------------------------------------------------------------------

    /// The two bodies of a contact (B is `None` for the static triangles).
    fn pair_mut(bodies: &mut [Body], a: u32, b: u32) -> (&mut Body, Option<&mut Body>) {
        if b == STATIC {
            return (&mut bodies[a as usize], None);
        }
        let (a, b) = (a as usize, b as usize);
        if a < b {
            let (lo, hi) = bodies.split_at_mut(b);
            (&mut lo[a], Some(&mut hi[0]))
        } else {
            let (lo, hi) = bodies.split_at_mut(a);
            (&mut hi[0], Some(&mut lo[b]))
        }
    }

    fn substep(&mut self, h: f32) {
        // Normal velocities before the substep (restitution aims at minus e times them).
        for c in self.contacts.iter_mut() {
            let (a, b) = World::pair_mut(&mut self.bodies, c.a, c.b);
            let ra = a.q.rotate(c.ra);
            let mut vrel = a.v + a.w.cross(ra);
            if let Some(b) = b {
                let rb = b.q.rotate(c.rb);
                vrel -= b.v + b.w.cross(rb);
            }
            c.vn_pre = vrel.dot(c.n);
            c.lambda = 0.0;
        }
        // Integrate.
        let g = Vec3::new(0.0, 0.0, -GRAVITY);
        for b in self.bodies.iter_mut() {
            if b.asleep {
                continue;
            }
            b.x_prev = b.x;
            b.q_prev = b.q;
            b.v += g * h;
            b.x += b.v * h;
            // Gyroscopic term, in the body frame.
            let wl = b.q.unrotate(b.w);
            let torque = -wl.cross(b.inertia.mul_vec(wl));
            let wl = wl + b.inv_inertia.mul_vec(torque) * h;
            b.w = b.q.rotate(wl);
            b.q = b.q.add_rotation(b.w * h);
        }
        // Positions, manifold after manifold: the normal of each point, then the static friction
        // of the patch.
        for m in 0..self.manifolds.len() {
            let range = self.manifolds[m];
            let (a, mut b) = World::pair_mut(&mut self.bodies, range.a, range.b);
            let mut total = 0.0f32;
            for c in self.contacts[range.start..range.end].iter_mut() {
                total += solve_normal(a, b.as_deref_mut(), c);
            }
            let mut range = range;
            if total > 0.0 {
                patch_static_friction((a, b), &mut range, total);
            }
            range.lambda = total;
            self.manifolds[m] = range;
        }
        // Velocities from positions.
        let inv_h = 1.0 / h;
        for b in self.bodies.iter_mut() {
            if b.asleep {
                continue;
            }
            b.v = (b.x - b.x_prev) * inv_h;
            let dq = b.q * b.q_prev.conj();
            let w = dq.vector() * (2.0 * inv_h);
            b.w = if dq.w >= 0.0 { w } else { -w };
        }
        // Velocities: restitution per point, then dynamic friction and rolling resistance of the
        // patch.
        let rest_threshold = 2.0 * GRAVITY * h;
        for m in 0..self.manifolds.len() {
            let range = self.manifolds[m];
            if !above(range.lambda, 0.0) {
                continue;
            }
            let (a, mut b) = World::pair_mut(&mut self.bodies, range.a, range.b);
            for c in self.contacts[range.start..range.end].iter() {
                if c.lambda > 0.0 {
                    solve_restitution(a, b.as_deref_mut(), c, rest_threshold);
                }
            }
            patch_dynamic_friction((a, b), &range, inv_h);
        }
    }
}

/// The two bodies of a contact as the solver sees them.
type Pair<'a> = (&'a mut Body, Option<&'a mut Body>);

/// `I⁻¹ v` of an optional body that may not move (zero then).
fn inv_inertia_of(b: &Option<&mut Body>, v: Vec3) -> Vec3 {
    match b {
        Some(b) if b.movable() => b.inv_inertia_world(v),
        _ => Vec3::ZERO,
    }
}

/// The normal constraint of one contact point: projects its penetration out (zero compliance).
/// Returns the multiplier applied.
fn solve_normal(a: &mut Body, mut b: Option<&mut Body>, c: &mut Contact) -> f32 {
    let pa = a.x + a.q.rotate(c.ra);
    let pb = match &b {
        Some(b) => b.x + b.q.rotate(c.rb),
        None => c.rb,
    };
    let depth = (pa - pb).dot(c.n);
    if depth >= 0.0 {
        return 0.0;
    }
    let ra = pa - a.x;
    let rb = b.as_ref().map_or(Vec3::ZERO, |b| pb - b.x);
    let w = a.generalized(ra, c.n) + b.as_ref().map_or(0.0, |b| b.generalized(rb, c.n));
    if !above(w, 0.0) {
        return 0.0;
    }
    let dl = -depth / w;
    c.lambda += dl;
    let p = c.n * dl;
    a.apply_position(p, ra);
    if let Some(b) = b.as_mut() {
        b.apply_position(-p, rb);
    }
    dl
}

/// The orientation of A in B's frame (in the world's for the static triangles).
fn relative_turn(a: &Body, b: &Option<&mut Body>) -> Quat {
    match b {
        Some(b) => b.q.conj() * a.q,
        None => a.q,
    }
}

/// A point of B's frame (or of the world) in the world.
fn on_b_world(b: &Option<&mut Body>, p: Vec3) -> Vec3 {
    match b {
        Some(b) => b.x + b.q.rotate(p),
        None => p,
    }
}

/// Static friction of a contact patch, against its anchor: the two points that stuck together
/// are brought together again along the surface, and the turn about the normal since then is
/// undone, when that takes less than `μ λₙ` (the turn with the patch's radius as the arm). The
/// whole patch acts as one, so the order of its points does not push the bodies sideways. When it
/// would take more, the patch slides: the anchor moves to where the patch is now and dynamic
/// friction (in the velocity pass) takes over.
fn patch_static_friction((a, mut b): Pair, m: &mut ManifoldRange, lambda: f32) {
    let centre = a.x + a.q.rotate(m.ra);
    let fresh = |a: &Body, b: &Option<&mut Body>| Anchor {
        on_a: m.ra,
        on_b: match b {
            Some(b) => b.q.unrotate(centre - b.x),
            None => centre,
        },
        turn: relative_turn(a, b),
    };
    let Some(mut anchor) = m.anchor else {
        m.anchor = Some(fresh(a, &b));
        return;
    };
    let pa = a.x + a.q.rotate(anchor.on_a);
    let pb = on_b_world(&b, anchor.on_b);
    let slide = tangential(pa - pb, m.n);
    let len = slide.length();
    if len > 1e-9 {
        let t = slide / len;
        let ra = pa - a.x;
        let rb = b.as_ref().map_or(Vec3::ZERO, |b| pb - b.x);
        let w = a.generalized(ra, t) + b.as_ref().map_or(0.0, |b| b.generalized(rb, t));
        if w > 0.0 {
            let dl = len / w;
            if dl < m.friction * lambda {
                let p = t * -dl;
                a.apply_position(p, ra);
                if let Some(b) = b.as_mut() {
                    b.apply_position(-p, rb);
                }
            } else {
                // Sliding: anchor where the patch is now.
                let now = fresh(a, &b);
                anchor.on_a = now.on_a;
                anchor.on_b = now.on_b;
            }
        }
    }
    // Torsion: the relative turn about the normal since the anchor.
    let d = relative_turn(a, &b) * anchor.turn.conj();
    let v = d.vector() * 2.0;
    let v = if d.w >= 0.0 { v } else { -v };
    let axis = match &b {
        Some(b) => b.q.rotate(v),
        None => v,
    };
    let turn = axis.dot(m.n);
    if turn.abs() > 1e-9 && m.radius > 0.0 {
        let ka = if a.movable() {
            m.n.dot(a.inv_inertia_world(m.n))
        } else {
            0.0
        };
        let kb = m.n.dot(inv_inertia_of(&b, m.n));
        if ka + kb > 0.0 {
            let dl = turn.abs() / (ka + kb);
            if dl < m.friction * lambda * m.radius {
                let p = m.n * (-turn / (ka + kb));
                if a.movable() {
                    a.q = a.q.add_rotation(a.inv_inertia_world(p));
                }
                if let Some(b) = b.as_mut() {
                    if b.movable() {
                        b.q = b.q.add_rotation(-b.inv_inertia_world(p));
                    }
                }
            } else {
                anchor.turn = relative_turn(a, &b);
            }
        }
    }
    m.anchor = Some(anchor);
}

/// Restitution of one point: its normal velocity goes to −e ṽₙ, or to zero (also when the
/// position pass made the bodies part faster than that).
fn solve_restitution(a: &mut Body, mut b: Option<&mut Body>, c: &Contact, rest_threshold: f32) {
    let ra = a.q.rotate(c.ra);
    let rb = match &b {
        Some(b) => b.q.rotate(c.rb),
        None => Vec3::ZERO,
    };
    let mut vrel = a.v + a.w.cross(ra);
    if let Some(b) = &b {
        vrel -= b.v + b.w.cross(rb);
    }
    let vn = vrel.dot(c.n);
    let e = if c.vn_pre.abs() <= rest_threshold {
        0.0
    } else {
        c.restitution
    };
    let dvn = (-e * c.vn_pre).max(0.0) - vn;
    let w = a.generalized(ra, c.n) + b.as_ref().map_or(0.0, |b| b.generalized(rb, c.n));
    if w > 0.0 && dvn != 0.0 {
        let p = c.n * (dvn / w);
        a.apply_velocity(p, ra);
        if let Some(b) = b.as_mut() {
            b.apply_velocity(-p, rb);
        }
    }
}

/// Dynamic friction and rolling resistance of a contact patch: a tangential impulse at its centre
/// of at most μ times the patch's normal impulse of the substep (`λₙ / h`), a torsional one of at
/// most that times the patch radius, and an angular one against the rolling of at most `δ λₙ / h`,
/// each no more than stops the motion.
fn patch_dynamic_friction((a, mut b): Pair, m: &ManifoldRange, inv_h: f32) {
    let normal_impulse = m.lambda * inv_h;
    let ra = a.q.rotate(m.ra);
    let rb = match &b {
        Some(b) => b.q.rotate(m.rb),
        None => Vec3::ZERO,
    };
    let mut vrel = a.v + a.w.cross(ra);
    if let Some(b) = &b {
        vrel -= b.v + b.w.cross(rb);
    }
    let vt = tangential(vrel, m.n);
    let len = vt.length();
    if len > 1e-9 {
        let t = vt / len;
        let w = a.generalized(ra, t) + b.as_ref().map_or(0.0, |b| b.generalized(rb, t));
        if w > 0.0 {
            let impulse = (len / w).min(m.friction * normal_impulse);
            let p = t * -impulse;
            a.apply_velocity(p, ra);
            if let Some(b) = b.as_mut() {
                b.apply_velocity(-p, rb);
            }
        }
    }
    // Torsion and rolling: the relative spin about the normal, and the rest of the relative turn.
    let mut wrel = a.w;
    if let Some(b) = &b {
        wrel -= b.w;
    }
    let spin = wrel.dot(m.n);
    let roll = wrel - m.n * spin;
    for (axis, rate, cap) in [
        (m.n, spin, m.friction * normal_impulse * m.radius),
        (roll, roll.length(), m.roll * normal_impulse),
    ] {
        let l = axis.length();
        if !above(l, 1e-9) || rate.abs() <= 1e-9 {
            continue;
        }
        let dir = axis / l * rate.signum();
        let ka = if a.movable() {
            dir.dot(a.inv_inertia_world(dir))
        } else {
            0.0
        };
        let kb = dir.dot(inv_inertia_of(&b, dir));
        if ka + kb > 0.0 {
            let impulse = cap.min(rate.abs() / (ka + kb));
            if a.movable() {
                a.w -= a.inv_inertia_world(dir * impulse);
            }
            if let Some(b) = b.as_mut() {
                if b.movable() {
                    b.w += b.inv_inertia_world(dir * impulse);
                }
            }
        }
    }
}

fn overlaps(a: &Aabb, b: &Aabb) -> bool {
    a.min.x <= b.max.x
        && b.min.x <= a.max.x
        && a.min.y <= b.max.y
        && b.min.y <= a.max.y
        && a.min.z <= b.max.z
        && b.min.z <= a.max.z
}

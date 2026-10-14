//! `rt-phys`: the rigid body simulator of Repackshot (phase S2), in Rust from scratch with `std`
//! only, `f32`, no `unsafe`, no system APIs, deterministic: the same scene gives the same poses,
//! bit for bit, natively and in WebAssembly (`rt-wasm` exports it as `phys_*`).
//!
//! **Method.** Extended position based dynamics for rigid bodies as in Müller, Macklin,
//! Chentanez, Jeschke and Kim, "Detailed Rigid Body Simulation with Extended Position Based
//! Dynamics", Computer Graphics Forum 39(8) (SCA 2020): positions and orientations are integrated
//! first, contacts are projected out as position constraints with zero compliance (with static
//! friction in the same pass), velocities are derived from the positions, and a velocity pass
//! applies dynamic friction and restitution. Implemented from the paper; no code from any physics
//! library. A fixed step of 1/240 s with 4 substeps ("small steps": many substeps of one
//! iteration each), gravity 9.81 m/s² along −Z, scene units millimetres, mass from a density in
//! kg/m³ times the volume of the shape.
//!
//! **Shapes.** A dynamic body is the convex hull of its points (our quickhull, [`hull`]), a ball
//! when the points are on a sphere, or the oriented box of the points when the hull is flat or
//! has more than [`hull::HULL_VERTEX_CAP`] vertices. Static parts and the floor are triangles in a
//! box tree ([`bvh`]). Contacts ([`collide`]) are exact for spheres and come from the separating
//! axis test with face clipping for hulls and triangles.
//!
//! **Sleeping.** A body slower than its rest speed for half a second sleeps; when every body
//! sleeps the simulation is [`World::settled`].
//!
//! **Determinism.** See [`world`]: contacts are sorted by (body, body, feature) before the solver
//! sees them, so a narrow phase split over threads would give the same result; the pose hash
//! ([`World::hash`]) is the check, pinned in the tests and compared with the WebAssembly build.

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod bvh;
pub mod collide;
pub mod example;
pub mod hull;
pub mod math;
pub mod scene;
pub mod shape;
pub mod world;

pub use math::Quat;
pub use scene::Scene;
pub use shape::ShapeKind;
pub use world::{BodyError, BodyParams, Pose, ShapeSource, Transform, World};

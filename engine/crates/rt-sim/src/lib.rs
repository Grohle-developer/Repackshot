//! `rt-sim`: Repackshot's particle effects, the stateless class (phase S4a).
//!
//! An ambient effect (dust motes, pollen, rain, snow, a dust cloud, ash, rising bubbles, falling
//! confetti) is a set of particles that do not interact with each other. Since S3 a particle may
//! also be a drop, and the particles of one effect may mix shapes ([`Shape`], [`AmbientParams::mix`]). Each particle is a
//! **pure function of (seed, id, time)**: nothing is stepped, nothing is cached, and particle `i`
//! is computed without looking at any other one. That gives the engine's determinism contract
//! for free: the same parameters give the same particles on every platform, with any number of
//! threads, in any order, and evaluating the first `n` particles gives a prefix of evaluating
//! more of them.
//!
//! * [`AmbientParams`] holds the parameters of one effect, exactly the fields of the RSB `FXAM`
//!   section ([`AmbientParams::decode`] and [`AmbientParams::encode`] are its codec, shared by the
//!   engine's scene reader and the WebAssembly preview export).
//! * [`Evaluator`] prepares an effect once (its tables of `e^-x` and of the sine, built with the
//!   engine's deterministic [`fmath`]) and evaluates any particle by id; [`evaluate`] evaluates
//!   the first particles of an effect.
//!
//! The model (decided in the roadmap, S0 §2) is in the [`eval`] module documentation; the
//! divergence-free turbulence in [`noise`].
//!
//! The crate depends on nothing, so that `rt-core` (which renders the particles) can depend on
//! it. The deterministic elementary functions and the counter hash are the engine's own: the
//! source files of `rt_core::fmath` and `rt_core::rng` are compiled into this crate as well (one
//! source, the same bits), and `rt-core` checks in its tests that both copies agree.

#![deny(unsafe_code)]
#![deny(missing_docs)]

#[path = "../../rt-core/src/fmath.rs"]
pub mod fmath;
#[path = "../../rt-core/src/rng.rs"]
pub mod rng;

pub mod eval;
pub mod noise;
pub mod params;

pub use eval::{
    evaluate, evaluate_range, positions_hash, shapes_hash, tint_factor, Evaluator, Particle,
    MIN_DROP_PROTRUSION,
};
pub use params::{
    AmbientParams, FxamError, Shape, DROP_TAIL, DROP_TIP, FLAG_CAMERA, FLAG_REFLECTIONS,
    FLAG_SHADOW, FXAM_BYTES, FXAM_MIN_BYTES, FXAM_S3_BYTES, MAX_COUNT, MAX_DROP_TAIL, MAX_PALETTE,
    MIX_SHAPES,
};

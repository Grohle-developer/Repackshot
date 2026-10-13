//! `rt-sky`: Repackshot's own daylight sky, built offline (phase E5c).
//!
//! The engine's physical sky (`rt_core::sky`) has the functional form of L. Hošek and A. Wilkie,
//! "An Analytic Model for Full Spectral Sky-Dome Radiance", ACM TOG 31(4), 2012: an extended
//! Perez distribution with nine coefficients per colour channel, a radiance scale, a quintic
//! Bézier over the cube root of the Sun's elevation, linear in turbidity and ground albedo. The
//! coefficients are ours: this crate simulates the sky with its own atmosphere and radiative
//! transfer ([`atmosphere`], [`simulate`]) and fits the model to it with its own
//! Levenberg–Marquardt ([`fit`]); [`table`] writes the result as the engine's and the preview's
//! data, with its recipe and hash. Nothing here comes from another sky implementation or its
//! tables.
//!
//! Offline only: `f64`, threads and files are fine here (none of it reaches `rt-core`), but the
//! output must be reproducible, so the arithmetic is IEEE with our own elementary functions
//! ([`dmath`]), the random numbers are seeded per work item ([`rng`]) and nothing depends on the
//! number of threads.

#![forbid(unsafe_code)]
#![deny(missing_docs)]
// Per-band arrays are walked by index side by side (throughputs, coefficients, transmittances):
// the index is clearer than zipped iterators there.
#![allow(clippy::needless_range_loop)]

pub mod atmosphere;
pub mod dataset;
pub mod dmath;
pub mod fit;
pub mod fixture;
pub mod model;
pub mod rng;
pub mod sha256;
pub mod simulate;
pub mod spectrum;
pub mod table;
pub mod trace;

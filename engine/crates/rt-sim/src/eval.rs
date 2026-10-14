//! Evaluation of an effect's particles: each one a pure function of (seed, id, time).
//!
//! **Random numbers.** Particle `i` draws everything from counter hashes of
//! `base = mix64(seed << 32 ^ i)` ([`crate::rng::mix64`]): `mix64(base ^ salt)` for what it keeps
//! all its life (size, fall speed, tint, phase), and from `mix64(base ^ life · salt)` for what each
//! life draws anew (where it is born, the direction of its first push, its orientation). Nothing
//! depends on any other particle, on the order of evaluation or on the number of threads.
//!
//! **Lives and the steady state.** What falls (or rises) through the region's height `H` faster
//! than in [`LIFE_MAX`] seconds lives `T = H / |v_z|`: it is born on the top of the region (on the
//! bottom when it rises) and dies when it reaches the other side: rain dies on the ground and is
//! born again above. Its own phase `φ` (uniform in `[0, 1)`) shifts its clock: at effect time `t`
//! it is in life `k = ⌊t / T + φ⌋` at age `a = (t / T + φ − k) T`. The age is uniform over the
//! life at every instant and the births of different lives are independent, so the distribution
//! of the particles is the same at any `t`: the scene is "full" from the first instant and stays
//! so (S0 §2). What barely falls (dust, pollen) lives for ever: it is born once, uniformly in the
//! region, at age `t + φ` [`LIFE_MAX`].
//!
//! **Motion, in closed form.** Born with the drift velocity `v_d` (the wind plus the terminal fall
//! speed times the gravity, downwards) plus a push of speed `energy` in a random direction, the
//! velocity relaxes to `v_d` with the time constant `τ = v_t / g` of linear drag:
//! `v(a) = v_d + (v₀ − v_d) e^{−a/τ}`, so the particle has moved
//! `s(a) = v_d a + (v₀ − v_d) τ (1 − e^{−a/τ})`. The exponential is read from a table built once
//! per effect with [`fmath::exp`] (no `exp` per particle).
//!
//! **Where.** Without a cloud the region is the box cut to its band of heights and never below
//! the ground `z = 0`. A particle is born uniformly across it (on its top or bottom face when it
//! falls or rises through it) and its position is wrapped back into the box on every axis (what
//! leaves on one side comes back on the other): a uniform distribution stays uniform under a
//! translation modulo the box, so the density is the same everywhere in it. With a cloud envelope
//! (`cloud_radius > 0`) the particle is born with a density that is one inside
//! `R (1 − softness)` and falls smoothly to zero at `R (1 + softness)` around the cloud's centre
//! (rejection sampling), lives until it could have crossed the cloud ([`LIFE_MIN`] to
//! [`LIFE_MAX`]) and is not wrapped.
//!
//! **Turbulence.** Then the divergence-free displacement of [`crate::noise::curl`] is added: the
//! field at the particle's position over the turbulence scale, drifting through the lattice at
//! the turbulence speed, times the strength. Being free of divergence, it bends the particles into
//! filaments without piling them up. A particle it pushes under the ground comes back at the top
//! (in a box) or is mirrored above the ground (in a cloud): **no particle is ever below `z = 0`**.
//!
//! **Shape.** A sphere keeps no axis. A capsule's axis is half its segment: `streak / 2` times
//! the velocity, so its length is the distance travelled during `streak` seconds (rain without
//! motion blur). A disc's axis is its unit normal: random per life, turning at `spin` turns per
//! second (times a random factor in `[0.5, 1.5)` and a random sign) about a random axis; the sine
//! of the angle comes from a table built once per effect with [`fmath::sin`].

use crate::fmath;
use crate::noise;
use crate::params::{AmbientParams, Shape};
use crate::rng::mix64;

/// Standard gravity in mm/s².
pub const G_MM: f32 = 9_810.0;
/// Shortest life of a particle of a cloud, seconds.
pub const LIFE_MIN: f32 = 0.05;
/// Longest life, seconds: the longest a particle takes to cross the region before it is counted
/// as barely falling (and lives for ever), and the longest life in a cloud.
pub const LIFE_MAX: f32 = 10.0;
/// Shortest relaxation time of the velocity, seconds.
pub const TAU_MIN: f32 = 0.05;
/// Smallest size of a particle relative to the effect's mean size.
const MIN_SIZE_FACTOR: f32 = 0.05;
/// Steps of the table of `e^-x` over `[0, EXP_RANGE]`.
const EXP_STEPS: usize = 1024;
/// Beyond this `e^-x` is (almost) zero: the table's last value is used.
const EXP_RANGE: f32 = 16.0;
/// Steps of the table of the sine over one turn.
const SIN_STEPS: usize = 1024;
/// Tries of the rejection sampling of a cloud's births (the chance of using all of them is below
/// `1e-12`; then the particle is born at the cloud's centre).
const CLOUD_TRIES: u32 = 256;
/// Scale of the curl field so that its mean magnitude is about one (measured by a test).
const CURL_NORM: f32 = 0.55;
/// Direction in which the turbulence pattern drifts through its lattice (any fixed unit vector).
const PATTERN_DRIFT: [f32; 3] = [0.6, 0.48, 0.64];

// Salts of the counter hashes (fixed forever: changing one changes every effect).
const SALT_SIZE: u64 = 0x5121_0000_0000_0001;
const SALT_FALL: u64 = 0x5121_0000_0000_0002;
const SALT_PHASE: u64 = 0x5121_0000_0000_0003;
const SALT_TINT: u64 = 0x5121_0000_0000_0004;
const SALT_SPIN: u64 = 0x5121_0000_0000_0005;
const SALT_LIFE: u64 = 0x9E37_79B9_7F4A_7C15;
const SALT_BIRTH: u64 = 0x5121_0000_0000_0011;
const SALT_PUSH: u64 = 0x5121_0000_0000_0012;
const SALT_NORMAL: u64 = 0x5121_0000_0000_0013;
const SALT_AXIS: u64 = 0x5121_0000_0000_0014;
const SALT_TURBULENCE: u64 = 0x5121_0000_0000_0015;

/// One particle of an effect at the effect's instant.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Particle {
    /// Centre, mm.
    pub centre: [f32; 3],
    /// Radius, mm.
    pub radius: f32,
    /// Sphere: zero. Disc: its unit normal. Capsule: half its segment (the ends are
    /// `centre ± axis`), mm.
    pub axis: [f32; 3],
    /// Seed of the particle's tint variation.
    pub tint: u32,
    /// The particle's id (its index in the effect).
    pub id: u32,
}

/// A uniform number in `[0, 1)` from the top 24 bits of a hash.
#[inline]
fn unit(h: u64) -> f32 {
    (h >> 40) as f32 * (1.0 / 16_777_216.0)
}

/// A uniform unit vector from a hash (G. Marsaglia, "Choosing a Point from the Surface of a
/// Sphere", *Annals of Mathematical Statistics* 43(2), 1972: no trigonometry).
fn unit_vector(mut h: u64) -> [f32; 3] {
    for _ in 0..64 {
        h = mix64(h);
        let a = 2.0 * unit(h) - 1.0;
        h = mix64(h);
        let b = 2.0 * unit(h) - 1.0;
        let s = a * a + b * b;
        if s > 0.0 && s < 1.0 {
            let k = 2.0 * (1.0 - s).sqrt();
            return [a * k, b * k, 1.0 - 2.0 * s];
        }
    }
    [0.0, 0.0, 1.0]
}

#[inline]
fn add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

#[inline]
fn scale(a: [f32; 3], k: f32) -> [f32; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}

#[inline]
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// The cloud envelope of an effect.
#[derive(Clone, Copy, Debug)]
struct Cloud {
    centre: [f32; 3],
    inner: f32,
    outer: f32,
}

impl Cloud {
    /// Acceptance of a birth at distance `r` from the centre: 1 inside, a smooth step down to 0.
    fn density(&self, r: f32) -> f32 {
        if r <= self.inner {
            return 1.0;
        }
        if r >= self.outer {
            return 0.0;
        }
        let t = (r - self.inner) / (self.outer - self.inner);
        1.0 - t * t * (3.0 - 2.0 * t)
    }
}

/// An effect prepared for evaluation: its region, its tables, its turbulence.
#[derive(Clone, Debug)]
pub struct Evaluator {
    params: AmbientParams,
    /// Corner and size of the region box (band and ground applied).
    lo: [f32; 3],
    extent: [f32; 3],
    cloud: Option<Cloud>,
    /// `e^-x` at `x = i · EXP_RANGE / EXP_STEPS`, `i` in `0..=EXP_STEPS`.
    exp_table: Vec<f32>,
    /// `sin(2π i / SIN_STEPS)`, `i` in `0..=SIN_STEPS`.
    sin_table: Vec<f32>,
    /// Turbulence: strength (mm), 1 / scale, offset of the pattern at the effect's instant.
    turbulence: Option<(f32, f32, [f32; 3])>,
    turbulence_seed: u64,
}

impl Evaluator {
    /// Prepares `params`: the tables of `e^-x` and of the sine (built with [`fmath`], once), the
    /// region cut to its band and to the ground, the cloud and the turbulence at the effect's
    /// instant.
    pub fn new(params: &AmbientParams) -> Evaluator {
        let p = *params;
        let exp_table = (0..=EXP_STEPS)
            .map(|i| fmath::exp(-(i as f32) * (EXP_RANGE / EXP_STEPS as f32)))
            .collect();
        let sin_table = (0..=SIN_STEPS)
            .map(|i| fmath::sin(i as f32 * (fmath::TAU / SIN_STEPS as f32)))
            .collect();
        let mut lo = [0.0f32; 3];
        let mut hi = [0.0f32; 3];
        for axis in 0..3 {
            lo[axis] = p.region_centre[axis] - p.region_half[axis];
            hi[axis] = p.region_centre[axis] + p.region_half[axis];
        }
        if p.band[0] < p.band[1] {
            lo[2] = lo[2].max(p.band[0]);
            hi[2] = hi[2].min(p.band[1]);
        }
        lo[2] = lo[2].max(0.0);
        hi[2] = hi[2].max(lo[2]);
        let extent = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        let cloud = (p.cloud_radius > 0.0).then(|| {
            let soft = p.cloud_softness.clamp(0.0, 1.0);
            Cloud {
                centre: p.cloud_centre,
                inner: p.cloud_radius * (1.0 - soft),
                outer: p.cloud_radius * (1.0 + soft),
            }
        });
        let [strength, length, speed] = p.turbulence;
        let turbulence = (strength > 0.0 && length > 0.0).then(|| {
            let inv = 1.0 / length;
            (
                strength * CURL_NORM,
                inv,
                scale(PATTERN_DRIFT, speed * p.time * inv),
            )
        });
        Evaluator {
            params: p,
            lo,
            extent,
            cloud,
            exp_table,
            sin_table,
            turbulence,
            turbulence_seed: mix64(u64::from(p.seed) ^ SALT_TURBULENCE),
        }
    }

    /// The parameters.
    pub fn params(&self) -> &AmbientParams {
        &self.params
    }

    /// `e^-x` for `x >= 0`, from the table (linear interpolation).
    #[inline]
    fn exp_neg(&self, x: f32) -> f32 {
        let at = x.max(0.0) * (EXP_STEPS as f32 / EXP_RANGE);
        if at >= EXP_STEPS as f32 {
            return self.exp_table[EXP_STEPS];
        }
        let i = at as usize;
        let f = at - i as f32;
        self.exp_table[i] + (self.exp_table[i + 1] - self.exp_table[i]) * f
    }

    /// `(sin, cos)` of `turns` full turns, from the table (linear interpolation).
    #[inline]
    fn sin_cos_turns(&self, turns: f32) -> (f32, f32) {
        let lookup = |t: f32| {
            let f = t - t.floor();
            let at = f * SIN_STEPS as f32;
            let i = (at as usize).min(SIN_STEPS - 1);
            let w = at - i as f32;
            self.sin_table[i] + (self.sin_table[i + 1] - self.sin_table[i]) * w
        };
        (lookup(turns), lookup(turns + 0.25))
    }

    /// A birth position of the life hashed by `life`, at height `entry` when it is given.
    fn birth(&self, life: u64, entry: Option<f32>) -> [f32; 3] {
        let mut h = mix64(life ^ SALT_BIRTH);
        let mut draw = || {
            h = mix64(h);
            unit(h)
        };
        let Some(cloud) = self.cloud else {
            let u = [draw(), draw(), draw()];
            return [
                self.lo[0] + u[0] * self.extent[0],
                self.lo[1] + u[1] * self.extent[1],
                entry.unwrap_or(self.lo[2] + u[2] * self.extent[2]),
            ];
        };
        for _ in 0..CLOUD_TRIES {
            let d = [
                (2.0 * draw() - 1.0) * cloud.outer,
                (2.0 * draw() - 1.0) * cloud.outer,
                (2.0 * draw() - 1.0) * cloud.outer,
            ];
            let r = dot(d, d).sqrt();
            if draw() < cloud.density(r) {
                return add(cloud.centre, d);
            }
        }
        cloud.centre
    }

    /// How long each life of a particle with drift velocity `drift` lasts (`None`: for ever) and,
    /// in a box, the height it is born at (`None`: anywhere).
    fn life(&self, drift: [f32; 3]) -> (Option<f32>, Option<f32>) {
        match self.cloud {
            Some(cloud) => {
                let speed = dot(drift, drift).sqrt();
                let life = if speed * LIFE_MAX > cloud.outer {
                    (cloud.outer / speed).clamp(LIFE_MIN, LIFE_MAX)
                } else {
                    LIFE_MAX
                };
                (Some(life), None)
            }
            None => {
                let vz = drift[2];
                let height = self.extent[2];
                if height > 0.0 && vz.abs() * LIFE_MAX > height {
                    let entry = if vz < 0.0 {
                        self.lo[2] + height
                    } else {
                        self.lo[2]
                    };
                    (Some(height / vz.abs()), Some(entry))
                } else {
                    (None, None)
                }
            }
        }
    }

    /// Particle `id` at the effect's instant.
    pub fn particle(&self, id: u32) -> Particle {
        let p = &self.params;
        let base = mix64((u64::from(p.seed) << 32) ^ u64::from(id));
        let draw = |salt: u64| unit(mix64(base ^ salt));
        let signed = |salt: u64| 2.0 * draw(salt) - 1.0;

        // What the particle keeps all its life.
        let size_factor =
            (1.0 + p.size_var.clamp(0.0, 1.0) * signed(SALT_SIZE)).max(MIN_SIZE_FACTOR);
        let radius = 0.5 * p.size_mm * size_factor;
        let fall = p.fall_speed * (1.0 + p.fall_var.clamp(0.0, 1.0) * signed(SALT_FALL)).max(0.0);
        let drift = [p.wind[0], p.wind[1], p.wind[2] - fall * p.gravity];
        let tau = (fall / G_MM).max(TAU_MIN);
        let (life, entry) = self.life(drift);

        // Which life it is in, and how old.
        let phase = draw(SALT_PHASE);
        let (k, age) = match life {
            Some(life) => {
                let clock = p.time / life + phase;
                let k = clock.floor();
                (k, (clock - k) * life)
            }
            None => (0.0, p.time + phase * LIFE_MAX),
        };
        let lb = mix64(base ^ (k as i64 as u64).wrapping_mul(SALT_LIFE));

        // Where it was born and how far it has gone.
        let birth = self.birth(lb, entry);
        let push = scale(unit_vector(mix64(lb ^ SALT_PUSH)), p.energy);
        let decay = self.exp_neg(age / tau);
        let mut centre = add(
            add(birth, scale(drift, age)),
            scale(push, tau * (1.0 - decay)),
        );
        let velocity = add(drift, scale(push, decay));

        if self.cloud.is_none() {
            for (axis, c) in centre.iter_mut().enumerate() {
                let e = self.extent[axis];
                if e > 0.0 {
                    let x = *c - self.lo[axis];
                    let wrapped = x - (x / e).floor() * e;
                    *c = self.lo[axis] + wrapped.clamp(0.0, e);
                } else {
                    *c = self.lo[axis];
                }
            }
        }
        if let Some((strength, inv, offset)) = self.turbulence {
            let q = add(scale(centre, inv), offset);
            let d = noise::curl(self.turbulence_seed, q);
            centre = add(centre, scale(d, strength));
        }
        if centre[2] < 0.0 {
            centre[2] = if self.cloud.is_none() && self.extent[2] > 0.0 {
                (centre[2] + self.extent[2]).max(0.0)
            } else {
                -centre[2]
            };
        }

        let axis = match p.shape {
            Shape::Sphere => [0.0; 3],
            Shape::Capsule => scale(velocity, 0.5 * p.streak),
            Shape::Disc => {
                let n0 = unit_vector(mix64(lb ^ SALT_NORMAL));
                if p.spin == 0.0 {
                    n0
                } else {
                    let k_axis = unit_vector(mix64(lb ^ SALT_AXIS));
                    let rate = p.spin * (0.5 + draw(SALT_SPIN));
                    let rate = if draw(SALT_SPIN ^ 1) < 0.5 {
                        -rate
                    } else {
                        rate
                    };
                    let (s, c) = self.sin_cos_turns(rate * age);
                    // Rodrigues' rotation of n0 about k_axis.
                    let n = add(
                        add(scale(n0, c), scale(cross(k_axis, n0), s)),
                        scale(k_axis, dot(k_axis, n0) * (1.0 - c)),
                    );
                    let len = dot(n, n).sqrt();
                    if len > 0.0 {
                        scale(n, 1.0 / len)
                    } else {
                        n0
                    }
                }
            }
        };
        Particle {
            centre,
            radius,
            axis,
            tint: (mix64(base ^ SALT_TINT) >> 32) as u32,
            id,
        }
    }
}

/// The first `min(params.count, max)` particles of an effect.
pub fn evaluate(params: &AmbientParams, max: u32) -> Vec<Particle> {
    evaluate_range(params, 0, params.count.min(max))
}

/// Particles `start..end` of an effect (clamped to its count): any split of the ids, evaluated in
/// any order or on any thread, gives the same particles.
pub fn evaluate_range(params: &AmbientParams, start: u32, end: u32) -> Vec<Particle> {
    let end = end.min(params.count);
    if start >= end {
        return Vec::new();
    }
    let e = Evaluator::new(params);
    (start..end).map(|id| e.particle(id)).collect()
}

/// FNV-1a (32 bits) over the little-endian bytes of every particle's centre, radius, axis and
/// tint, in order: the hash the native and WebAssembly builds are compared by.
pub fn positions_hash(particles: &[Particle]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    let mut eat = |word: u32| {
        for b in word.to_le_bytes() {
            h ^= u32::from(b);
            h = h.wrapping_mul(0x0100_0193);
        }
    };
    for p in particles {
        for v in p
            .centre
            .iter()
            .chain([p.radius].iter())
            .chain(p.axis.iter())
        {
            eat(v.to_bits());
        }
        eat(p.tint);
    }
    h
}

#[cfg(test)]
mod tests;

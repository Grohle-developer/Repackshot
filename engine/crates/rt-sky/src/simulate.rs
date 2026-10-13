//! Spectral radiative transfer: the radiance of the sky seen from the ground, single scattering
//! by quadrature and multiple scattering by Monte Carlo.
//!
//! **Single scattering** (light of the Sun scattered once towards the observer) is integrated
//! along the viewing ray, shell by shell, in steps of at most 2 km and 0.05 of optical depth: the
//! transmittance towards the observer is integrated exactly over each step (the density is
//! constant within a shell) and the Sun's transmittance taken at its middle. No noise, and the
//! sharp parts (the aureole, the Earth's shadow at sunrise) come out exactly.
//!
//! **Multiple scattering** by Monte Carlo. Paths start at the observer and go out along the
//! viewing direction; at every scattering event after the first (the first one is the single
//! scattering above) the Sun is sampled explicitly (its direct beam, attenuated to that point and
//! occluded by the Earth), and the path continues in a new direction; a path that reaches the
//! ground bounces off a Lambertian surface with the Sun sampled there too, and one that leaves
//! the top ends.
//!
//! * **All bands at once.** A path carries a throughput per band. Free paths are drawn from the
//!   transmittance of one band picked uniformly (the first event of path `i` uses band `i mod K`
//!   and a stratified number), and every band is weighted by its own density over the mixture of
//!   all bands' densities (one-sample multiple importance sampling with the balance heuristic:
//!   E. Veach, PhD thesis, Stanford 1997, §9.2), so no band's weight can blow up. A ray that would
//!   leave the atmosphere is forced to collide inside it (the density conditioned on a collision,
//!   times its probability); a ray towards the ground is sampled as it is.
//! * **Directions** come from a mixture of the two phase functions around the incoming direction
//!   and a Cornette–Shanks lobe around the Sun (light that reaches the next event from near the
//!   Sun is what the aureole of the next Sun sample multiplies), all weighted by the mixture's
//!   density, so the second-order aureole does not throw fireflies.
//! * **Ground albedo.** The fitted model is linear between albedo 0 and 1, so both are simulated
//!   from the same paths: a path is traced with albedo 1 and what it gathers after `n` ground
//!   bounces carries a factor `a^n`, so the albedo-0 sky is what was gathered before the first one.
//!
//! **Determinism.** Each direction of each configuration has its own random stream, seeded from
//! the recipe's seed, the configuration's values and the direction's index, and its paths run in
//! order on one thread; directions are distributed over threads but written to fixed slots. The
//! result is the same for any number of threads, and on any machine (the arithmetic is IEEE and
//! the elementary functions are [`crate::dmath`]).

use crate::atmosphere::{
    cornette_shanks, rayleigh_phase, Atmosphere, AEROSOL_ALBEDO, EARTH_RADIUS,
};
use crate::dmath;
use crate::rng::Rng;
use crate::spectrum::BANDS;
use crate::trace::{along, columns, dot, length, traverse, Segment};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

/// Paths whose largest throughput is below this continue by Russian roulette.
const ROULETTE: f64 = 0.1;
/// Most scattering events per path.
const MAX_DEPTH: usize = 128;
/// Anisotropy of the Rayleigh phase function used to sample directions (the bands' own, which
/// weight them, lie within 3 % of it).
const SAMPLING_GAMMA: f64 = 0.0143;
/// Share of new directions drawn around the Sun.
const GUIDE: f64 = 0.3;
/// Longest quadrature step of the single scattering, m.
const STEP_LENGTH: f64 = 2_000.0;
/// Largest optical depth of a quadrature step.
const STEP_DEPTH: f64 = 0.05;

/// The sky radiance of one direction, per band, W / (m² sr nm).
#[derive(Clone, Debug, PartialEq)]
pub struct Radiance {
    /// Over a black ground (albedo 0).
    pub black: [f64; BANDS],
    /// Over a white ground (albedo 1).
    pub white: [f64; BANDS],
    /// Over a ground of albedo [`GREY_ALBEDO`] (to check the model's linear albedo).
    pub grey: [f64; BANDS],
}

/// The ground albedo of [`Radiance::grey`]: the engine's (`rt_core::sky::GROUND_ALBEDO`).
pub const GREY_ALBEDO: f64 = 0.2;

/// Runs `f(i)` for `i` in `0..n` on `threads` threads; the results in order.
pub fn parallel_map<T: Send>(n: usize, threads: usize, f: impl Fn(usize) -> T + Sync) -> Vec<T> {
    let next = AtomicUsize::new(0);
    let slots: Mutex<Vec<Option<T>>> = Mutex::new((0..n).map(|_| None).collect());
    std::thread::scope(|scope| {
        for _ in 0..threads.max(1) {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= n {
                    break;
                }
                let v = f(i);
                if let Ok(mut s) = slots.lock() {
                    s[i] = Some(v);
                }
            });
        }
    });
    slots
        .into_inner()
        .unwrap_or_default()
        .into_iter()
        .map(|v| v.expect("every item ran"))
        .collect()
}

/// The unit direction of the Sun `elevation_deg` above the horizon, at azimuth 0 (+X), in the
/// observer's frame (Z up).
pub fn sun_direction(elevation_deg: f64) -> [f64; 3] {
    let (s, c) = dmath::sin_cos(elevation_deg * dmath::DEG);
    [c, 0.0, s]
}

/// The unit direction at zenith angle `theta` and azimuth `phi` (radians, from the Sun's).
pub fn view_direction(theta: f64, phi: f64) -> [f64; 3] {
    let (st, ct) = dmath::sin_cos(theta);
    let (sp, cp) = dmath::sin_cos(phi);
    [st * cp, st * sp, ct]
}

/// An orthonormal basis around the unit vector `n` (T. Duff et al., "Building an Orthonormal
/// Basis, Revisited", JCGT 6(1), 2017).
fn basis(n: [f64; 3]) -> ([f64; 3], [f64; 3]) {
    let sign = if n[2] >= 0.0 { 1.0 } else { -1.0 };
    let a = -1.0 / (sign + n[2]);
    let b = n[0] * n[1] * a;
    (
        [1.0 + sign * n[0] * n[0] * a, sign * b, -sign * n[0]],
        [b, sign + n[1] * n[1] * a, -n[1]],
    )
}

/// The direction at `cos Θ = mu` from `axis` and azimuth `2π u`.
fn rotate(axis: [f64; 3], mu: f64, u: f64) -> [f64; 3] {
    let (b1, b2) = basis(axis);
    let st = ((1.0 - mu) * (1.0 + mu)).max(0.0).sqrt();
    let (sp, cp) = dmath::sin_cos(2.0 * dmath::PI * u);
    let mut d = [0.0; 3];
    for i in 0..3 {
        d[i] = st * cp * b1[i] + st * sp * b2[i] + mu * axis[i];
    }
    let l = length(d);
    [d[0] / l, d[1] / l, d[2] / l]
}

/// `cos Θ` drawn from the Rayleigh phase function of anisotropy `gamma` (rejection).
fn sample_rayleigh(rng: &mut Rng, gamma: f64) -> f64 {
    loop {
        let mu = 2.0 * rng.next_f64() - 1.0;
        let accept = ((1.0 + 3.0 * gamma) + (1.0 - gamma) * mu * mu) / (2.0 + 2.0 * gamma);
        if rng.next_f64() < accept {
            return mu;
        }
    }
}

/// `cos Θ` drawn from the Cornette–Shanks phase function: Henyey–Greenstein of the same `g`,
/// kept with probability `(1 + cos² Θ) / 2`.
fn sample_cornette_shanks(rng: &mut Rng, g: f64) -> f64 {
    loop {
        let u = rng.next_f64();
        let s = (1.0 - g * g) / (1.0 - g + 2.0 * g * u);
        let mu = ((1.0 + g * g - s * s) / (2.0 * g)).clamp(-1.0, 1.0);
        if rng.next_f64() < 0.5 * (1.0 + mu * mu) {
            return mu;
        }
    }
}

/// `∫₀ʰ e^{-σ s} ds` given `decay = e^{-σ h}`, without cancellation for small `σ h`.
#[inline]
fn step_integral(sigma: f64, h: f64, decay: f64) -> f64 {
    let x = sigma * h;
    if x < 1.0e-6 {
        h * (1.0 - 0.5 * x)
    } else {
        (1.0 - decay) / sigma
    }
}

/// Scratch space of one path tracer.
struct Tracer<'a> {
    atm: &'a Atmosphere,
    sun: [f64; 3],
    segments: Vec<Segment>,
    sun_segments: Vec<Segment>,
}

impl Tracer<'_> {
    /// Optical depths per band of three columns.
    #[inline]
    fn depths(&self, c: [f64; 3]) -> [f64; BANDS] {
        let o = &self.atm.optics;
        let mut t = [0.0; BANDS];
        for k in 0..BANDS {
            t[k] = o.rayleigh[k] * c[0] + o.aerosol[k] * c[1] + o.ozone[k] * c[2];
        }
        t
    }

    /// Transmittance per band from `p` towards the Sun (`None` behind the Earth).
    fn sun_transmittance(&mut self, p: [f64; 3]) -> Option<[f64; BANDS]> {
        let mut segs = std::mem::take(&mut self.sun_segments);
        let hit = traverse(self.atm, p, self.sun, &mut segs);
        let out = if hit {
            None
        } else {
            let tau = self.depths(columns(self.atm, &segs, f64::INFINITY));
            let mut t = [0.0; BANDS];
            for k in 0..BANDS {
                t[k] = dmath::exp(-tau[k]);
            }
            Some(t)
        };
        self.sun_segments = segs;
        out
    }

    /// Single scattering towards the observer along `view` (upwards), by quadrature.
    fn single(&mut self, view: [f64; 3]) -> [f64; BANDS] {
        let observer = [0.0, 0.0, EARTH_RADIUS];
        let mut segs = std::mem::take(&mut self.segments);
        traverse(self.atm, observer, view, &mut segs);
        let o = self.atm.optics.clone();
        let mu = dot(self.sun, view);
        let pa = cornette_shanks(mu, self.atm.aerosol_g);
        let mut phase_r = [0.0; BANDS];
        for k in 0..BANDS {
            phase_r[k] = rayleigh_phase(mu, o.rayleigh_gamma[k]);
        }
        let mut out = [0.0; BANDS];
        let mut tr = [1.0f64; BANDS];
        for seg in &segs {
            let sh = self.atm.shells[seg.shell];
            let len = seg.t1 - seg.t0;
            if len <= 0.0 {
                continue;
            }
            let mut sigma = [0.0; BANDS];
            let mut f = [0.0; BANDS];
            let mut max_sigma = 0.0f64;
            for k in 0..BANDS {
                sigma[k] = self.atm.extinction(seg.shell, k);
                max_sigma = max_sigma.max(sigma[k]);
                f[k] = (o.rayleigh[k] * sh.air * phase_r[k]
                    + AEROSOL_ALBEDO * o.aerosol[k] * sh.aerosol * pa)
                    * o.sun[k];
            }
            let n = ((len / STEP_LENGTH).ceil())
                .max((max_sigma * len / STEP_DEPTH).ceil())
                .max(1.0) as usize;
            let h = len / n as f64;
            let mut decay = [0.0; BANDS];
            let mut integral = [0.0; BANDS];
            for k in 0..BANDS {
                decay[k] = dmath::exp(-sigma[k] * h);
                integral[k] = step_integral(sigma[k], h, decay[k]);
            }
            for j in 0..n {
                let mid = seg.t0 + (j as f64 + 0.5) * h;
                if let Some(ts) = self.sun_transmittance(along(observer, view, mid)) {
                    for k in 0..BANDS {
                        out[k] += f[k] * ts[k] * tr[k] * integral[k];
                    }
                }
                for k in 0..BANDS {
                    tr[k] *= decay[k];
                }
            }
        }
        self.segments = segs;
        out
    }

    /// A new direction at a scattering event (incoming `d`, scattering coefficients `sr`, `sa`
    /// per band): drawn from the mixture, and the throughput weighted by it. `None` ends the
    /// path.
    fn scatter(
        &mut self,
        d: [f64; 3],
        sr: &[f64; BANDS],
        sa: &[f64; BANDS],
        beta: &mut [f64; BANDS],
        rng: &mut Rng,
    ) -> Option<[f64; 3]> {
        let o = &self.atm.optics;
        let (mut wr, mut wa) = (0.0, 0.0);
        for k in 0..BANDS {
            wr += beta[k] * sr[k];
            wa += beta[k] * sa[k];
        }
        if (wr + wa).is_nan() || wr + wa <= 0.0 {
            return None;
        }
        let q = wr / (wr + wa);
        let next = if rng.next_f64() < GUIDE {
            rotate(
                self.sun,
                sample_cornette_shanks(rng, self.atm.aerosol_g),
                rng.next_f64(),
            )
        } else {
            let mu = if rng.next_f64() < q {
                sample_rayleigh(rng, SAMPLING_GAMMA)
            } else {
                sample_cornette_shanks(rng, self.atm.aerosol_g)
            };
            rotate(d, mu, rng.next_f64())
        };
        let mu = dot(next, d).clamp(-1.0, 1.0);
        let pa = cornette_shanks(mu, self.atm.aerosol_g);
        let pdf = GUIDE * cornette_shanks(dot(next, self.sun).clamp(-1.0, 1.0), self.atm.aerosol_g)
            + (1.0 - GUIDE) * (q * rayleigh_phase(mu, SAMPLING_GAMMA) + (1.0 - q) * pa);
        for k in 0..BANDS {
            let f = sr[k] * rayleigh_phase(mu, o.rayleigh_gamma[k]) + sa[k] * pa;
            beta[k] *= f / pdf;
        }
        Some(next)
    }

    /// A new direction off the ground at `n` (Lambertian, albedo 1): the mixture of the cosine
    /// lobe and the lobe around the Sun. `None` ends the path.
    fn bounce(&mut self, n: [f64; 3], beta: &mut [f64; BANDS], rng: &mut Rng) -> Option<[f64; 3]> {
        let next = if rng.next_f64() < GUIDE {
            rotate(
                self.sun,
                sample_cornette_shanks(rng, self.atm.aerosol_g),
                rng.next_f64(),
            )
        } else {
            rotate(n, rng.next_f64().sqrt(), rng.next_f64())
        };
        let cos = dot(next, n);
        if cos <= 0.0 {
            return None;
        }
        let pdf = GUIDE * cornette_shanks(dot(next, self.sun).clamp(-1.0, 1.0), self.atm.aerosol_g)
            + (1.0 - GUIDE) * cos * dmath::FRAC_1_PI;
        let w = cos * dmath::FRAC_1_PI / pdf;
        for b in beta.iter_mut() {
            *b *= w;
        }
        Some(next)
    }

    /// Multiple scattering towards the observer along `view`, averaged over `paths` paths (a
    /// multiple of the number of bands is best).
    fn multiple(&mut self, view: [f64; 3], paths: usize, rng: &mut Rng) -> Radiance {
        let observer = [0.0, 0.0, EARTH_RADIUS];
        let o = self.atm.optics.clone();
        let strata = paths.div_ceil(BANDS).max(1);
        let mut black = [0.0; BANDS];
        let mut white = [0.0; BANDS];
        let mut grey = [0.0; BANDS];
        for path in 0..paths {
            let mut beta = [1.0f64; BANDS];
            let mut bounces = 0u32;
            let mut grey_factor = 1.0;
            let (mut p, mut d) = (observer, view);
            for depth in 0..MAX_DEPTH {
                let mut segs = std::mem::take(&mut self.segments);
                let ground = traverse(self.atm, p, d, &mut segs);
                let (band, u) = if depth == 0 {
                    let stratum = path / BANDS;
                    (
                        path % BANDS,
                        (stratum as f64 + rng.next_f64()) / strata as f64,
                    )
                } else {
                    (
                        ((rng.next_f64() * BANDS as f64) as usize).min(BANDS - 1),
                        rng.next_f64(),
                    )
                };
                let end = segs.last().map_or(0.0, |s| s.t1);
                let tau_total = self.depths(columns(self.atm, &segs, f64::INFINITY));
                let mut t_total = [0.0; BANDS];
                for k in 0..BANDS {
                    t_total[k] = dmath::exp(-tau_total[k]);
                }
                // The free path in the chosen band: forced to collide when the ray leaves the
                // atmosphere, as it is when it meets the ground.
                let target = if ground {
                    -dmath::ln(1.0 - u)
                } else {
                    -dmath::ln(1.0 - u * (1.0 - t_total[band]))
                };
                let next = if !ground || target < tau_total[band] {
                    // Find the point where the band's optical depth reaches the target.
                    let mut acc = 0.0;
                    let mut at = segs.last().map_or((0.0, 0), |s| (s.t1, s.shell));
                    for s in &segs {
                        let sigma = self.atm.extinction(s.shell, band);
                        let dtau = sigma * (s.t1 - s.t0);
                        if acc + dtau >= target && sigma > 0.0 {
                            at = ((s.t0 + (target - acc) / sigma).clamp(s.t0, s.t1), s.shell);
                            break;
                        }
                        acc += dtau;
                    }
                    let (t, shell) = at;
                    let tau = self.depths(columns(self.atm, &segs, t));
                    let mut tr = [0.0; BANDS];
                    let mut mix = 0.0;
                    for k in 0..BANDS {
                        tr[k] = dmath::exp(-tau[k]);
                        let pk = self.atm.extinction(shell, k) * tr[k];
                        mix += if ground { pk } else { pk / (1.0 - t_total[k]) };
                    }
                    mix /= BANDS as f64;
                    if mix.is_nan() || mix <= 0.0 {
                        break;
                    }
                    for k in 0..BANDS {
                        beta[k] *= tr[k] / mix;
                    }
                    p = along(p, d, t);
                    let sh = self.atm.shells[shell];
                    let mut sr = [0.0; BANDS];
                    let mut sa = [0.0; BANDS];
                    for k in 0..BANDS {
                        sr[k] = o.rayleigh[k] * sh.air;
                        sa[k] = AEROSOL_ALBEDO * o.aerosol[k] * sh.aerosol;
                    }
                    // The Sun, except at the first event (that is the single scattering).
                    if depth > 0 {
                        if let Some(ts) = self.sun_transmittance(p) {
                            let mu = dot(self.sun, d);
                            let pa = cornette_shanks(mu, self.atm.aerosol_g);
                            for k in 0..BANDS {
                                let f =
                                    sr[k] * rayleigh_phase(mu, o.rayleigh_gamma[k]) + sa[k] * pa;
                                let c = beta[k] * f * o.sun[k] * ts[k];
                                white[k] += c;
                                grey[k] += c * grey_factor;
                                if bounces == 0 {
                                    black[k] += c;
                                }
                            }
                        }
                    }
                    self.scatter(d, &sr, &sa, &mut beta, rng)
                } else {
                    // The ground.
                    let escape: f64 = t_total.iter().sum::<f64>() / BANDS as f64;
                    for k in 0..BANDS {
                        beta[k] *= t_total[k] / escape;
                    }
                    let q = along(p, d, end);
                    let r = length(q);
                    let n = [q[0] / r, q[1] / r, q[2] / r];
                    // Exactly on the sphere, so the next ray starts in the lowest shell.
                    p = [
                        n[0] * EARTH_RADIUS,
                        n[1] * EARTH_RADIUS,
                        n[2] * EARTH_RADIUS,
                    ];
                    bounces += 1;
                    grey_factor *= GREY_ALBEDO;
                    let cos_sun = dot(n, self.sun);
                    if cos_sun > 0.0 {
                        if let Some(ts) = self.sun_transmittance(p) {
                            for k in 0..BANDS {
                                let c = beta[k] * dmath::FRAC_1_PI * cos_sun * o.sun[k] * ts[k];
                                white[k] += c;
                                grey[k] += c * grey_factor;
                            }
                        }
                    }
                    self.bounce(n, &mut beta, rng)
                };
                self.segments = segs;
                let Some(next) = next else { break };
                d = next;
                // Russian roulette on the largest throughput.
                let m = beta.iter().cloned().fold(0.0, f64::max);
                if m < ROULETTE {
                    let survive = m / ROULETTE;
                    if rng.next_f64() >= survive {
                        break;
                    }
                    for b in &mut beta {
                        *b /= survive;
                    }
                }
            }
        }
        let n = paths.max(1) as f64;
        for k in 0..BANDS {
            black[k] /= n;
            white[k] /= n;
            grey[k] /= n;
        }
        Radiance { black, white, grey }
    }

    /// Single plus multiple scattering along `view`.
    fn radiance(&mut self, view: [f64; 3], paths: usize, rng: &mut Rng) -> Radiance {
        let single = self.single(view);
        let mut r = self.multiple(view, paths, rng);
        for k in 0..BANDS {
            r.black[k] += single[k];
            r.white[k] += single[k];
            r.grey[k] += single[k];
        }
        r
    }
}

/// The sky radiance of `atm` with the Sun `elevation_deg` up along `view` (a unit vector in the
/// observer's frame, the Sun at azimuth 0, above the horizon), with `paths` paths for the
/// multiple scattering; `keys` seed its random stream.
pub fn sky_view(
    atm: &Atmosphere,
    elevation_deg: f64,
    view: [f64; 3],
    paths: usize,
    keys: &[u64],
) -> Radiance {
    let mut rng = Rng::new(keys);
    let mut tracer = Tracer {
        atm,
        sun: sun_direction(elevation_deg),
        segments: Vec::with_capacity(160),
        sun_segments: Vec::with_capacity(160),
    };
    tracer.radiance(view, paths, &mut rng)
}

/// [`sky_view`] for each of `views` on `threads` threads; view `i` is keyed by `keys` and `i`.
pub fn sky(
    atm: &Atmosphere,
    elevation_deg: f64,
    views: &[[f64; 3]],
    paths: usize,
    keys: &[u64],
    threads: usize,
) -> Vec<Radiance> {
    parallel_map(views.len(), threads, |i| {
        let mut k = keys.to_vec();
        k.push(i as u64);
        sky_view(atm, elevation_deg, views[i], paths, &k)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spectrum::{bands_to_rgb, cmf_weights};

    fn small_views() -> Vec<[f64; 3]> {
        [(0.1, 0.0), (1.0, 0.3), (1.4, 2.5), (1.55, 3.1), (0.7, 1.6)]
            .iter()
            .map(|&(t, p)| view_direction(t, p))
            .collect()
    }

    #[test]
    fn the_result_does_not_depend_on_the_number_of_threads() {
        let atm = Atmosphere::new(3.0);
        let views = small_views();
        let one = sky(&atm, 20.0, &views, 2 * BANDS, &[1, 2], 1);
        let three = sky(&atm, 20.0, &views, 2 * BANDS, &[1, 2], 3);
        assert_eq!(one, three);
        // Another seed gives other numbers.
        let other = sky(&atm, 20.0, &views, 2 * BANDS, &[1, 3], 2);
        assert_ne!(one, other);
    }

    #[test]
    fn the_sky_is_blue_brighter_near_the_sun_and_whiter_over_a_white_ground() {
        let atm = Atmosphere::new(2.0);
        let w = cmf_weights();
        let views = [
            view_direction(0.0, 0.0),               // zenith
            view_direction(1.2, 0.0),               // 21 degrees up on the Sun's side
            view_direction(1.2, dmath::PI),         // the same away from it
            view_direction(60.0 * dmath::DEG, 0.0), // near the Sun (elevation 30)
        ];
        let r = sky(&atm, 30.0, &views, 8 * BANDS, &[9], 2);
        let rgb: Vec<[f64; 3]> = r.iter().map(|x| bands_to_rgb(&x.black, &w)).collect();
        let lum = |c: [f64; 3]| 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        assert!(
            rgb[0][2] > rgb[0][0] * 1.3,
            "the zenith is blue: {:?}",
            rgb[0]
        );
        assert!(lum(rgb[1]) > lum(rgb[2]), "{:?} {:?}", rgb[1], rgb[2]);
        assert!(lum(rgb[3]) > 2.0 * lum(rgb[0]), "{:?} {:?}", rgb[3], rgb[0]);
        for x in &r {
            for k in 0..BANDS {
                assert!(x.white[k] >= x.grey[k] && x.grey[k] >= x.black[k] && x.black[k] > 0.0);
            }
        }
    }

    #[test]
    fn the_quadrature_agrees_with_monte_carlo_single_scattering() {
        // Single scattering estimated by paths that stop at their first event (the Sun sampled
        // there) must agree with the quadrature, at a low Sun where the Sun's transmittance
        // changes fastest along the ray.
        let atm = Atmosphere::new(4.0);
        let sun = sun_direction(2.0);
        let mut tracer = Tracer {
            atm: &atm,
            sun,
            segments: Vec::new(),
            sun_segments: Vec::new(),
        };
        for view in [view_direction(1.5, 0.2), view_direction(0.5, 2.0)] {
            let q = tracer.single(view);
            let mut rng = Rng::new(&[5]);
            let observer = [0.0, 0.0, EARTH_RADIUS];
            let o = atm.optics.clone();
            let n = 20_000;
            let k = 6; // 440-450 nm
            let mut sum = 0.0;
            let mut segs = Vec::new();
            traverse(&atm, observer, view, &mut segs);
            let tau_total = tracer.depths(columns(&atm, &segs, f64::INFINITY))[k];
            let collide = 1.0 - dmath::exp(-tau_total);
            let mu = dot(sun, view);
            for i in 0..n {
                let u = (i as f64 + rng.next_f64()) / n as f64;
                let target = -dmath::ln(1.0 - u * collide);
                let mut acc = 0.0;
                for s in &segs {
                    let sigma = atm.extinction(s.shell, k);
                    if acc + sigma * (s.t1 - s.t0) >= target {
                        let p = along(observer, view, s.t0 + (target - acc) / sigma);
                        let sh = atm.shells[s.shell];
                        let f = o.rayleigh[k] * sh.air * rayleigh_phase(mu, o.rayleigh_gamma[k])
                            + AEROSOL_ALBEDO
                                * o.aerosol[k]
                                * sh.aerosol
                                * cornette_shanks(mu, atm.aerosol_g);
                        if let Some(ts) = tracer.sun_transmittance(p) {
                            sum += collide * f / sigma * o.sun[k] * ts[k];
                        }
                        break;
                    }
                    acc += sigma * (s.t1 - s.t0);
                }
            }
            let mc = sum / n as f64;
            assert!((mc / q[k] - 1.0).abs() < 0.01, "{view:?}: {mc} vs {}", q[k]);
        }
    }
}

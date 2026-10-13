//! The environment as a light: the procedural studio dome (`ENVR.kind` 0), the flat colour
//! (kind 1), the procedural sky (kind 2, [`crate::sky`]: physical or classic) and an HDRI image
//! (kind 3, a bitmap of the scene).
//!
//! **Dome and flat.** The dome's radiance depends only on the `z` of the direction (the world is
//! Z-up): it ramps linearly from `floor` at `z = -1` to `horizon` at `z = 0` and on to `zenith` at
//! `z = +1`, the ramp of the interface's preview (`p = (1 + z) / 2` over floor, horizon, zenith),
//! scaled by `strength`. A flat environment is the same ramp with three equal values. Because
//! `dω = dz dφ`, a direction density proportional to the radiance is a density proportional to
//! `L(z)` over `z ∈ [-1, 1]` times a uniform azimuth. That 1-D density is piecewise linear, so its
//! CDF is piecewise quadratic and is inverted in closed form (one square root): pick the lower or
//! upper half by its mass, then solve for `z` inside it. The density per steradian is
//! `L(z) / (2π ∫L dz)`, exact, which multiple importance sampling needs.
//!
//! **Images** (the HDRI, and the tabulated sky) are equirectangular, in the convention of the
//! interface's three.js preview so both show the same thing: for a unit direction `(x, y, z)`
//! the column is `u = ½ + atan2(-y, x) / 2π` (the image's centre looks along +X, `u` grows
//! towards -Y) and the row, from the top, `v = acos(z) / π`. `rotation_deg` turns the image about
//! +Z, counter-clockwise seen from above (three.js's `environmentRotation` about its Y axis).
//! Lookups are bilinear, wrapping around in `u`. Sampling uses a [`Distribution2D`] over at most
//! [`SAMPLING_WIDTH`] x [`SAMPLING_WIDTH`]`/2` cells of the image (averaged down), weighted by
//! luminance times `sin θ`; the density per steradian is the cell's density over the unit square
//! divided by `2π² sin θ`. A cell of zero luminance is never sampled; light the bilinear filter
//! spreads into it is still found by BSDF sampling, whose MIS weight is then one.
//! An HDRI scene whose bitmap is missing renders the dome.

use crate::bitmap::{Bitmap, Distribution2D, Image, Pixels};
use crate::color::Rgb;
use crate::fmath;
use crate::math::Vec3;
use crate::scene::{EnvKind, Environment, SkyModel, NO_BITMAP};
use crate::sky::{PhysicalSky, Preetham, GROUND_ALBEDO, SKY_HEIGHT, SKY_WIDTH};
use std::sync::Arc;

/// Most columns of an image's sampling distribution (rows: half as many).
pub const SAMPLING_WIDTH: u32 = 512;

/// The dome or flat ramp, prepared.
#[derive(Clone, Debug, PartialEq)]
struct Ramp {
    /// Radiance straight down, at the horizon and straight up (strength applied, never negative).
    floor: f32,
    horizon: f32,
    zenith: f32,
    /// `∫ L dz` over the lower half (`z ∈ [-1, 0]`) and over the whole range.
    lower_mass: f32,
    total_mass: f32,
}

/// An equirectangular image as a light.
#[derive(Clone, Debug, PartialEq)]
struct Map {
    image: Arc<Image>,
    /// Multiplier of the image's values.
    scale: f32,
    /// `sin` and `cos` of the rotation about +Z.
    rotation: (f32, f32),
    dist: Distribution2D,
    /// Mean luminance over the sphere of directions (scale applied).
    mean_luminance: f32,
}

#[derive(Clone, Debug, PartialEq)]
enum Source {
    Ramp(Ramp),
    Map(Box<Map>),
}

/// The environment prepared for rendering.
#[derive(Clone, Debug, PartialEq)]
pub struct EnvLight {
    source: Source,
}

/// `u`, `v` of a unit direction in the image's own frame.
#[inline]
fn direction_to_uv(d: Vec3) -> (f32, f32) {
    let u = 0.5 + fmath::atan2(-d.y, d.x) * (0.5 * fmath::FRAC_1_PI);
    let v = fmath::acos(d.z) * fmath::FRAC_1_PI;
    (u - u.floor(), v.clamp(0.0, 1.0))
}

/// The unit direction of `(u, v)` in the image's frame, and `sin θ`.
#[inline]
fn uv_to_direction(u: f32, v: f32) -> (Vec3, f32) {
    let (st, ct) = fmath::sin_cos(fmath::PI * v);
    let (sp, cp) = fmath::sin_cos(fmath::TAU * (u - 0.5));
    (Vec3::new(st * cp, -st * sp, ct), st)
}

impl Map {
    /// Prepares `image` (scaled by `scale`, turned by `rotation_deg`). `None` when it is black.
    fn new(image: Arc<Image>, scale: f32, rotation_deg: f32) -> Option<Map> {
        let (w, h) = (image.width as usize, image.height as usize);
        // The sampling grid: the image averaged down by whole factors.
        let fx = w.div_ceil(SAMPLING_WIDTH as usize).max(1);
        let fy = h.div_ceil((SAMPLING_WIDTH / 2) as usize).max(1);
        let (gw, gh) = (w.div_ceil(fx), h.div_ceil(fy));
        let mut weights = vec![0.0f32; gw * gh];
        let mut mean = 0.0f32;
        for gy in 0..gh {
            let theta = fmath::PI * (gy as f32 + 0.5) / gh as f32;
            let s = fmath::sin(theta);
            let mut row_sum = 0.0f32;
            for gx in 0..gw {
                let mut lum = 0.0f32;
                let mut n = 0u32;
                for y in gy * fy..((gy + 1) * fy).min(h) {
                    for x in gx * fx..((gx + 1) * fx).min(w) {
                        lum += image.texel(x as u32, y as u32).luminance().max(0.0);
                        n += 1;
                    }
                }
                let lum = lum / n.max(1) as f32;
                weights[gy * gw + gx] = lum * s;
                row_sum += lum * s;
            }
            mean += row_sum / gw as f32;
        }
        // ∫ L dω / 4π = Σ L sin θ Δθ Δφ / 4π = (mean over cells of L sin θ) · 2π² / 4π.
        let mean_luminance = scale * (mean / gh as f32) * (0.5 * fmath::PI);
        let dist = Distribution2D::new(gw, gh, weights)?;
        let r = rotation_deg * fmath::DEG_TO_RAD;
        Some(Map {
            image,
            scale,
            rotation: fmath::sin_cos(r),
            dist,
            mean_luminance,
        })
    }

    /// World direction to the image's frame (rotated by minus the rotation).
    #[inline]
    fn to_image(&self, d: Vec3) -> Vec3 {
        let (s, c) = self.rotation;
        Vec3::new(c * d.x + s * d.y, -s * d.x + c * d.y, d.z)
    }

    #[inline]
    fn to_world(&self, d: Vec3) -> Vec3 {
        let (s, c) = self.rotation;
        Vec3::new(c * d.x - s * d.y, s * d.x + c * d.y, d.z)
    }

    fn radiance(&self, dir: Vec3) -> Rgb {
        let (u, v) = direction_to_uv(self.to_image(dir));
        self.image.bilinear(u, v, true) * self.scale
    }

    fn pdf(&self, dir: Vec3) -> f32 {
        let local = self.to_image(dir);
        let sin_theta = ((1.0 - local.z) * (1.0 + local.z)).max(0.0).sqrt();
        if sin_theta <= 0.0 {
            return 0.0;
        }
        let (u, v) = direction_to_uv(local);
        self.dist.pdf(u, v) / (2.0 * fmath::PI * fmath::PI * sin_theta)
    }

    fn sample(&self, s: (f32, f32)) -> Option<(Vec3, f32)> {
        let ((u, v), pdf_uv) = self.dist.sample(s);
        let (local, sin_theta) = uv_to_direction(u, v);
        if !(sin_theta > 0.0 && pdf_uv > 0.0) {
            return None;
        }
        // The density of the final direction as `pdf` computes it (the same cell but where
        // rounding moves the direction onto a neighbouring one), so that multiple importance
        // sampling sees one consistent density.
        let d = self.to_world(local).normalize();
        let pdf = self.pdf(d);
        (pdf > 0.0).then_some((d, pdf))
    }
}

/// The sky of `env` tabulated as an equirectangular image, scaled to the dome's horizontal
/// irradiance (see [`crate::sky`]), with the ground below the horizon; and the scale.
pub fn sky_image(env: &Environment) -> (Image, f32) {
    match env.sky_model {
        SkyModel::Classic => {
            let sky = Preetham::new(
                env.sun_azimuth_deg,
                env.sun_elevation_deg,
                env.sky_turbidity,
            );
            tabulate_sky(env, |d| sky.radiance(d), false)
        }
        SkyModel::Physical => {
            let sky = PhysicalSky::new(
                env.sun_azimuth_deg,
                env.sun_elevation_deg,
                env.sky_turbidity,
                GROUND_ALBEDO,
            );
            tabulate_sky(env, |d| sky.radiance(d), true)
        }
    }
}

/// `sum += x` with Neumaier's compensation `c` (A. Neumaier, ZAMM 54, 1974): the total is
/// `sum + c`, nearly as accurate as a sum in double precision.
#[inline]
fn add_compensated(sum: &mut f32, c: &mut f32, x: f32) {
    let t = *sum + x;
    if sum.abs() >= x.abs() {
        *c += (*sum - t) + x;
    } else {
        *c += (x - t) + *sum;
    }
    *sum = t;
}

/// Tabulates `radiance` (the unscaled sky) and scales it. The physical sky sums the irradiance
/// with compensation, so the preview's port (in double precision) agrees with it to about 1e-7;
/// the classic sky keeps the plain sums of E5, whose renders are pinned.
fn tabulate_sky(
    env: &Environment,
    radiance: impl Fn(Vec3) -> Rgb,
    compensated: bool,
) -> (Image, f32) {
    let (w, h) = (SKY_WIDTH as usize, SKY_HEIGHT as usize);
    let mut rgb = vec![0.0f32; 3 * w * h];
    // Horizontal irradiance of the unscaled sky: Σ L cos θ sin θ Δθ Δφ over the upper rows.
    let mut irradiance = 0.0f32;
    let mut irradiance_c = 0.0f32;
    let cell = (fmath::PI / h as f32) * (fmath::TAU / w as f32);
    for y in 0..h / 2 {
        let v = (y as f32 + 0.5) / h as f32;
        let mut row = 0.0f32;
        let mut row_c = 0.0f32;
        for x in 0..w {
            let u = (x as f32 + 0.5) / w as f32;
            let (d, sin_theta) = uv_to_direction(u, v);
            let c = radiance(d);
            rgb[3 * (y * w + x)] = c.r;
            rgb[3 * (y * w + x) + 1] = c.g;
            rgb[3 * (y * w + x) + 2] = c.b;
            let term = c.luminance() * d.z * sin_theta;
            if compensated {
                add_compensated(&mut row, &mut row_c, term);
            } else {
                row += term;
            }
        }
        if compensated {
            add_compensated(&mut irradiance, &mut irradiance_c, (row + row_c) * cell);
        } else {
            irradiance += row * cell;
        }
    }
    let irradiance = irradiance + irradiance_c;
    let strength = env.strength.max(0.0);
    let target = strength * fmath::TAU * (env.horizon.max(0.0) / 6.0 + env.zenith.max(0.0) / 3.0);
    let scale = if irradiance > 0.0 {
        target / irradiance
    } else {
        0.0
    };
    let ground = (env.floor * strength).max(0.0);
    for (i, v) in rgb.iter_mut().enumerate() {
        if i / (3 * w) < h / 2 {
            *v *= scale;
        } else {
            *v = ground;
        }
    }
    let image = Image {
        width: w as u32,
        height: h as u32,
        pixels: Pixels::Linear(rgb),
    };
    (image, scale)
}

impl Ramp {
    fn new(floor: f32, horizon: f32, zenith: f32, strength: f32) -> Ramp {
        let (floor, horizon, zenith) = (
            (floor * strength).max(0.0),
            (horizon * strength).max(0.0),
            (zenith * strength).max(0.0),
        );
        let lower_mass = 0.5 * (floor + horizon);
        let upper_mass = 0.5 * (horizon + zenith);
        Ramp {
            floor,
            horizon,
            zenith,
            lower_mass,
            total_mass: lower_mass + upper_mass,
        }
    }

    /// Radiance as a function of the `z` of a unit direction.
    #[inline]
    fn value(&self, z: f32) -> f32 {
        let z = z.clamp(-1.0, 1.0);
        // Written as weighted sums so that the three stops are reproduced exactly.
        if z < 0.0 {
            self.floor * -z + self.horizon * (1.0 + z)
        } else {
            self.horizon * (1.0 - z) + self.zenith * z
        }
    }

    fn pdf(&self, dir: Vec3) -> f32 {
        if self.total_mass <= 0.0 {
            return 0.0;
        }
        self.value(dir.z) / (fmath::TAU * self.total_mass)
    }

    fn sample(&self, u: (f32, f32)) -> Option<(Vec3, f32)> {
        if self.total_mass <= 0.0 {
            return None;
        }
        let target = u.0 * self.total_mass;
        let z = if target < self.lower_mass {
            -1.0 + invert_linear(self.floor, self.horizon, target / self.lower_mass)
        } else {
            let upper = self.total_mass - self.lower_mass;
            let fraction = ((target - self.lower_mass) / upper).clamp(0.0, 1.0);
            invert_linear(self.horizon, self.zenith, fraction)
        };
        let z = z.clamp(-1.0, 1.0);
        let r = ((1.0 - z) * (1.0 + z)).max(0.0).sqrt();
        let (s, c) = fmath::sin_cos(fmath::TAU * u.1);
        let dir = Vec3::new(r * c, r * s, z);
        let pdf = self.pdf(dir);
        (pdf > 0.0).then_some((dir, pdf))
    }
}

impl EnvLight {
    /// Prepares `env`; `bitmaps` are the scene's (an HDRI refers to one of them).
    pub fn new(env: &Environment, bitmaps: &[Bitmap]) -> EnvLight {
        let strength = env.strength.max(0.0);
        let ramp = |floor, horizon, zenith| EnvLight {
            source: Source::Ramp(Ramp::new(floor, horizon, zenith, strength)),
        };
        let dome = || ramp(env.floor, env.horizon, env.zenith);
        let black = || ramp(0.0, 0.0, 0.0);
        match env.kind {
            EnvKind::Flat => ramp(env.horizon, env.horizon, env.horizon),
            EnvKind::Studio => dome(),
            EnvKind::Sky => {
                let (image, _) = sky_image(env);
                match Map::new(Arc::new(image), 1.0, 0.0) {
                    Some(map) => EnvLight {
                        source: Source::Map(Box::new(map)),
                    },
                    None => black(),
                }
            }
            EnvKind::Hdri => {
                let Some(bitmap) = (env.hdri_map != NO_BITMAP)
                    .then(|| bitmaps.get(env.hdri_map as usize))
                    .flatten()
                else {
                    return dome();
                };
                match Map::new(bitmap.image.clone(), strength, env.rotation_deg) {
                    Some(map) => EnvLight {
                        source: Source::Map(Box::new(map)),
                    },
                    None => black(),
                }
            }
        }
    }

    /// True when the environment emits nothing.
    pub fn is_black(&self) -> bool {
        match &self.source {
            Source::Ramp(r) => r.total_mass <= 0.0,
            Source::Map(m) => m.mean_luminance.is_nan() || m.mean_luminance <= 0.0,
        }
    }

    /// True for an image (sky or HDRI) rather than the analytic ramp.
    pub fn is_image(&self) -> bool {
        matches!(self.source, Source::Map(_))
    }

    /// Radiance arriving from the unit direction `dir` (looking along `dir`).
    #[inline]
    pub fn radiance(&self, dir: Vec3) -> Rgb {
        match &self.source {
            Source::Ramp(r) => Rgb::splat(r.value(dir.z)),
            Source::Map(m) => m.radiance(dir),
        }
    }

    /// Mean radiance (luminance) over the sphere of directions.
    pub fn mean_radiance(&self) -> f32 {
        match &self.source {
            Source::Ramp(r) => 0.5 * r.total_mass,
            Source::Map(m) => m.mean_luminance,
        }
    }

    /// Density per steradian with which [`EnvLight::sample`] returns the unit direction `dir`.
    pub fn pdf(&self, dir: Vec3) -> f32 {
        match &self.source {
            Source::Ramp(r) => r.pdf(dir),
            Source::Map(m) => m.pdf(dir),
        }
    }

    /// A direction distributed in proportion to the radiance, and its density per steradian.
    /// `None` for a black environment.
    pub fn sample(&self, u: (f32, f32)) -> Option<(Vec3, f32)> {
        match &self.source {
            Source::Ramp(r) => r.sample(u),
            Source::Map(m) => m.sample(u),
        }
    }
}

/// Inverse CDF on `[0, 1]` of the density proportional to `a + (b - a) t`: the `t` below which a
/// fraction `u` of the mass lies. Solves `(b - a) t² / 2 + a t = u (a + b) / 2` in the form that
/// does not cancel.
#[inline]
fn invert_linear(a: f32, b: f32, u: f32) -> f32 {
    let c = u * 0.5 * (a + b);
    let denom = a + (a * a + 2.0 * (b - a) * c).max(0.0).sqrt();
    if denom > 0.0 {
        (2.0 * c / denom).clamp(0.0, 1.0)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Pcg32;

    fn dome(floor: f32, horizon: f32, zenith: f32) -> EnvLight {
        EnvLight::new(
            &Environment {
                kind: EnvKind::Studio,
                floor,
                horizon,
                zenith,
                strength: 2.0,
                ..Environment::default()
            },
            &[],
        )
    }

    fn ramp_of(env: &EnvLight) -> &Ramp {
        match &env.source {
            Source::Ramp(r) => r,
            Source::Map(_) => panic!("not a ramp"),
        }
    }

    #[test]
    fn the_dome_ramps_from_floor_through_horizon_to_zenith() {
        let env = dome(0.1, 0.3, 0.6);
        assert_eq!(env.radiance(Vec3::new(0.0, 0.0, -1.0)).g, 0.2);
        assert_eq!(env.radiance(Vec3::new(1.0, 0.0, 0.0)).g, 0.6);
        assert_eq!(env.radiance(Vec3::new(0.0, 0.0, 1.0)).g, 1.2);
        assert!((env.radiance(Vec3::new(0.0, 0.8, 0.6)).g - (0.6 + 0.6 * 0.6)).abs() < 1.0e-6);
        // Mean over the sphere: (0.2 + 0.6) / 4 + (0.6 + 1.2) / 4.
        assert!((env.mean_radiance() - 0.65).abs() < 1.0e-6);
        // Flat: horizon everywhere.
        let flat = EnvLight::new(
            &Environment {
                kind: EnvKind::Flat,
                horizon: 0.5,
                strength: 1.0,
                ..Environment::default()
            },
            &[],
        );
        assert_eq!(flat.radiance(Vec3::new(0.0, 0.0, -1.0)).r, 0.5);
        assert_eq!(flat.radiance(Vec3::new(0.0, 0.0, 1.0)).r, 0.5);
        // An HDRI without its bitmap is the dome.
        let e = Environment {
            kind: EnvKind::Hdri,
            ..Environment::default()
        };
        assert_eq!(
            EnvLight::new(&e, &[]),
            EnvLight::new(
                &Environment {
                    kind: EnvKind::Studio,
                    ..e.clone()
                },
                &[]
            )
        );
        assert!(EnvLight::new(
            &Environment {
                strength: 0.0,
                ..Environment::default()
            },
            &[]
        )
        .is_black());
    }

    #[test]
    fn sampling_follows_the_pdf_and_the_pdf_integrates_to_one() {
        for env in [
            dome(0.1, 0.3, 0.6),
            dome(0.0, 0.0, 1.0),
            dome(1.0, 0.0, 0.0),
            dome(0.4, 0.4, 0.4),
        ] {
            let ramp = ramp_of(&env).clone();
            let mut rng = Pcg32::seeded(4, 2);
            let n = 200_000;
            // E[1/pdf] over sampled directions is the measure of the support. Where the
            // radiance is zero nothing is sampled, so compare with the support's measure.
            let mut inv = 0.0f64;
            let mut bins = [0u32; 8];
            for _ in 0..n {
                let (d, pdf) = env
                    .sample((rng.next_f32(), rng.next_f32()))
                    .expect("sample");
                assert!((d.length() - 1.0).abs() < 1.0e-5);
                assert!((env.pdf(d) - pdf).abs() <= 1.0e-6 * pdf);
                inv += 1.0 / pdf as f64;
                bins[(((d.z + 1.0) * 4.0) as usize).min(7)] += 1;
            }
            let support = inv / n as f64 / (4.0 * std::f64::consts::PI);
            assert!(support <= 1.02, "{env:?}: support {support}");
            // Each z bin holds the share of the radiance mass it covers.
            for (i, &count) in bins.iter().enumerate() {
                let (z0, z1) = (-1.0 + i as f32 * 0.25, -1.0 + (i + 1) as f32 * 0.25);
                let mass = 0.125 * (ramp.value(z0) + ramp.value(z1));
                let want = mass / ramp.total_mass;
                let got = count as f32 / n as f32;
                assert!(
                    (got - want).abs() < 0.005,
                    "{env:?} bin {i}: {got} vs {want}"
                );
            }
        }
        // Uniform: the support is the whole sphere and every direction has density 1 / 4π.
        let flat = dome(0.4, 0.4, 0.4);
        let pdf = flat.pdf(Vec3::new(0.0, 1.0, 0.0));
        assert!((pdf - 1.0 / (4.0 * fmath::PI)).abs() < 1.0e-7);
        assert_eq!(dome(0.0, 0.0, 0.0).sample((0.5, 0.5)), None);
    }

    #[test]
    fn the_linear_inverse_cdf_is_exact() {
        for (a, b) in [
            (1.0f32, 1.0f32),
            (0.0, 1.0),
            (1.0, 0.0),
            (0.2, 0.7),
            (3.0, 0.5),
        ] {
            for i in 0..=10 {
                let u = i as f32 / 10.0;
                let t = invert_linear(a, b, u);
                // The mass below t, as a fraction of the whole.
                let mass = (a * t + 0.5 * (b - a) * t * t) / (0.5 * (a + b));
                assert!((mass - u).abs() < 1.0e-5, "a {a} b {b} u {u}: t {t}");
            }
        }
    }

    /// A 64 x 32 panorama: dark grey with one bright square around `(u, v)`.
    fn spot_panorama(u: f32, v: f32) -> Bitmap {
        let (w, h) = (64u32, 32u32);
        let mut rgb = vec![0.05f32; (3 * w * h) as usize];
        let (cx, cy) = ((u * w as f32) as i32, (v * h as f32) as i32);
        for y in cy - 1..=cy {
            for x in cx - 1..=cx {
                let i = 3
                    * (y.rem_euclid(h as i32) as u32 * w + x.rem_euclid(w as i32) as u32) as usize;
                rgb[i..i + 3].copy_from_slice(&[40.0, 30.0, 20.0]);
            }
        }
        Bitmap::from_linear(w, h, &rgb).unwrap()
    }

    fn hdri(rotation_deg: f32, bitmap: &Bitmap) -> EnvLight {
        EnvLight::new(
            &Environment {
                kind: EnvKind::Hdri,
                hdri_map: 0,
                strength: 2.0,
                rotation_deg,
                ..Environment::default()
            },
            std::slice::from_ref(bitmap),
        )
    }

    #[test]
    fn the_equirectangular_convention_matches_the_preview() {
        // The centre column looks along +X, a quarter to the right along -Y; the top row is up.
        for (d, uv) in [
            (Vec3::new(1.0, 0.0, 0.0), (0.5, 0.5)),
            (Vec3::new(0.0, -1.0, 0.0), (0.75, 0.5)),
            (Vec3::new(0.0, 1.0, 0.0), (0.25, 0.5)),
            (Vec3::new(-1.0, 0.0, 0.0), (0.0, 0.5)),
        ] {
            let (u, v) = direction_to_uv(d);
            assert!(
                ((u - uv.0 + 0.5).rem_euclid(1.0) - 0.5).abs() < 1.0e-6
                    && (v - uv.1).abs() < 1.0e-6,
                "{d:?}: {u} {v}"
            );
            let (back, _) = uv_to_direction(uv.0, uv.1);
            assert!((back - d).length() < 1.0e-5, "{d:?} {back:?}");
        }
        assert!(direction_to_uv(Vec3::new(0.0, 0.0, 1.0)).1 < 1.0e-6);
        // A bright spot at the centre of the image is seen looking along +X; rotating the
        // environment by 90 degrees (counter-clockwise from above) moves it to +Y.
        let b = spot_panorama(0.5, 0.5);
        let still = hdri(0.0, &b);
        assert!(still.radiance(Vec3::new(1.0, 0.0, 0.0)).r > 50.0);
        assert!(still.radiance(Vec3::new(0.0, 1.0, 0.0)).r < 1.0);
        let turned = hdri(90.0, &b);
        assert!(turned.radiance(Vec3::new(0.0, 1.0, 0.0)).r > 50.0);
        assert!(turned.radiance(Vec3::new(1.0, 0.0, 0.0)).r < 1.0);
        // The strength scales it: 2 x the image's values.
        assert!((still.radiance(Vec3::new(0.0, 0.0, -1.0)).g - 0.1).abs() < 1.0e-6);
    }

    #[test]
    fn hdri_sampling_finds_the_bright_spot_with_the_right_density() {
        let b = spot_panorama(0.3, 0.4);
        for rotation in [0.0, 37.0] {
            let env = hdri(rotation, &b);
            let mut rng = Pcg32::seeded(8, 3);
            let n = 200_000;
            let mut inv = 0.0f64;
            let mut weighted = 0.0f64;
            let mut missed = 0;
            for _ in 0..n {
                // At the very pole `sin θ` rounds to zero and nothing is returned.
                let Some((d, pdf)) = env.sample((rng.next_f32(), rng.next_f32())) else {
                    missed += 1;
                    continue;
                };
                assert!((d.length() - 1.0).abs() < 1.0e-4);
                assert_eq!(env.pdf(d), pdf, "{d:?}");
                inv += 1.0 / pdf as f64;
                weighted += (env.radiance(d).luminance() / pdf) as f64;
            }
            assert!(missed < 5, "{missed}");
            // E[1/pdf] is the solid angle of the support: the whole sphere.
            let support = inv / n as f64 / (4.0 * std::f64::consts::PI);
            assert!((support - 1.0).abs() < 0.02, "support {support}");
            // E[L/pdf] is ∫ L dω = 4π times the mean luminance.
            let integral = weighted / n as f64;
            let want = 4.0 * std::f64::consts::PI * env.mean_radiance() as f64;
            assert!((integral / want - 1.0).abs() < 0.03, "{integral} vs {want}");
        }
    }

    #[test]
    fn the_sky_lights_like_the_dome_and_has_the_sun_where_the_sun_is() {
        for model in [SkyModel::Physical, SkyModel::Classic] {
            sky_lights_like_the_dome(model);
        }
    }

    #[test]
    fn the_classic_sky_is_still_preetham_and_the_physical_one_differs() {
        // The parameters of the preview's test (tests/environment-e5.test.ts): the interface's dome.
        let env = |sky_model| Environment {
            kind: EnvKind::Sky,
            sky_model,
            floor: 0.12,
            horizon: 0.45,
            zenith: 0.85,
            strength: 1.0,
            sun_azimuth_deg: -40.0,
            sun_elevation_deg: 35.0,
            ..Environment::default()
        };
        let (classic, _) = sky_image(&env(SkyModel::Classic));
        let (physical, _) = sky_image(&env(SkyModel::Physical));
        // The classic one is E5's, value for value (the TypeScript port pins the same pixels).
        let c = classic.texel(0, 0);
        assert!((c.r / 0.304_936_3 - 1.0).abs() < 1.0e-5, "{c:?}");
        let p = physical.texel(0, 0);
        assert!((p.r / c.r - 1.0).abs() > 0.02 || (p.b / c.b - 1.0).abs() > 0.02);
    }

    fn sky_lights_like_the_dome(sky_model: SkyModel) {
        let env = Environment {
            kind: EnvKind::Sky,
            sky_model,
            strength: 0.6,
            sun_azimuth_deg: 30.0,
            sun_elevation_deg: 40.0,
            ..Environment::default()
        };
        let sky = EnvLight::new(&env, &[]);
        assert!(sky.is_image() && !sky.is_black());
        let dome = EnvLight::new(
            &Environment {
                kind: EnvKind::Studio,
                ..env.clone()
            },
            &[],
        );
        // Horizontal irradiance of both: E = ∫ L cos θ dω over the upper hemisphere.
        let irradiance = |e: &EnvLight| {
            let mut rng = Pcg32::seeded(2, 2);
            let mut sum = 0.0f64;
            let n = 200_000;
            for _ in 0..n {
                let d = crate::warp::cosine_hemisphere((rng.next_f32(), rng.next_f32()));
                sum += e.radiance(d).luminance() as f64;
            }
            std::f64::consts::PI * sum / n as f64
        };
        let (es, ed) = (irradiance(&sky), irradiance(&dome));
        assert!((es / ed - 1.0).abs() < 0.03, "sky {es} vs dome {ed}");
        // Brighter towards the sun than away from it, blue at the zenith, the floor below.
        let (sa, ca) = fmath::sin_cos(30.0 * fmath::DEG_TO_RAD);
        let towards = sky.radiance(Vec3::new(ca * 0.7, sa * 0.7, 0.714).normalize());
        let away = sky.radiance(Vec3::new(-ca * 0.7, -sa * 0.7, 0.714).normalize());
        assert!(towards.luminance() > 2.0 * away.luminance());
        let zenith = sky.radiance(Vec3::new(0.0, 0.0, 1.0));
        assert!(zenith.b > zenith.r);
        let ground = sky.radiance(Vec3::new(0.3, 0.0, -0.9).normalize());
        assert!((ground.g - env.floor * env.strength).abs() < 1.0e-6);
        // Sampling it is consistent with its density.
        let mut rng = Pcg32::seeded(1, 7);
        for _ in 0..1000 {
            if let Some((d, pdf)) = sky.sample((rng.next_f32(), rng.next_f32())) {
                assert_eq!(sky.pdf(d), pdf);
            }
        }
    }
}

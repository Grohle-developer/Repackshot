//! Warps from the unit square to the shapes the renderer samples: disks, hemispheres, cones,
//! spheres and triangles. Each comes with its density where the renderer needs it.
//!
//! All of them use the deterministic [`crate::fmath`] functions, so the same sample gives the
//! same direction everywhere.

use crate::fmath;
use crate::math::Vec3;

/// The concentric map of P. Shirley and K. Chiu, "A Low Distortion Map Between Disk and Square",
/// *JGT* 2(3), 1997: `[0, 1)^2` to the unit disk, uniform in area, keeping strata compact.
pub fn concentric_disk(u: (f32, f32)) -> (f32, f32) {
    let a = 2.0 * u.0 - 1.0;
    let b = 2.0 * u.1 - 1.0;
    if a == 0.0 && b == 0.0 {
        return (0.0, 0.0);
    }
    let (r, phi) = if a.abs() > b.abs() {
        (a, fmath::FRAC_PI_4 * (b / a))
    } else {
        (b, fmath::FRAC_PI_2 - fmath::FRAC_PI_4 * (a / b))
    };
    let (s, c) = fmath::sin_cos(phi);
    (r * c, r * s)
}

/// Cosine-weighted direction on the hemisphere around +Z (Malley's method on the concentric
/// disk). Density `z / π` per steradian.
pub fn cosine_hemisphere(u: (f32, f32)) -> Vec3 {
    let (x, y) = concentric_disk(u);
    let z = (1.0 - x * x - y * y).max(0.0).sqrt();
    Vec3::new(x, y, z)
}

/// Uniform direction inside the cone around +Z whose half-angle has cosine `cos_max`, given
/// `one_minus_cos_max = 1 - cos_max` computed accurately by the caller (it is tiny for the sun).
/// Density `1 / (2π · one_minus_cos_max)`.
pub fn uniform_cone(u: (f32, f32), one_minus_cos_max: f32) -> Vec3 {
    // 1 - cos(theta) is uniform in [0, 1 - cos_max]; sin from it without cancellation.
    let one_minus_cos = u.0 * one_minus_cos_max;
    let cos = 1.0 - one_minus_cos;
    let sin = (one_minus_cos * (2.0 - one_minus_cos)).max(0.0).sqrt();
    let (sp, cp) = fmath::sin_cos(fmath::TAU * u.1);
    Vec3::new(sin * cp, sin * sp, cos)
}

/// Uniform direction on the unit sphere. Density `1 / (4π)`.
pub fn uniform_sphere(u: (f32, f32)) -> Vec3 {
    let z = 1.0 - 2.0 * u.0;
    let r = (1.0 - z * z).max(0.0).sqrt();
    let (s, c) = fmath::sin_cos(fmath::TAU * u.1);
    Vec3::new(r * c, r * s, z)
}

/// Barycentric weights of a point uniformly distributed over a triangle (the square-root
/// parametrisation, e.g. Pharr, Jakob and Humphreys, *PBRT*, 3rd ed., §13.6.5).
pub fn uniform_triangle(u: (f32, f32)) -> [f32; 3] {
    let su = u.0.sqrt();
    let b0 = 1.0 - su;
    let b1 = u.1 * su;
    [b0, b1, 1.0 - b0 - b1]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Pcg32;

    fn points(n: usize) -> Vec<(f32, f32)> {
        let mut rng = Pcg32::seeded(11, 3);
        (0..n).map(|_| (rng.next_f32(), rng.next_f32())).collect()
    }

    #[test]
    fn concentric_disk_is_uniform_and_inside() {
        let mut quadrants = [0usize; 4];
        let mut inner = 0;
        let pts = points(40_000);
        for &u in &pts {
            let (x, y) = concentric_disk(u);
            let r2 = x * x + y * y;
            assert!(r2 <= 1.0 + 1.0e-6);
            inner += usize::from(r2 < 0.25);
            quadrants[usize::from(x < 0.0) + 2 * usize::from(y < 0.0)] += 1;
        }
        // A quarter of the area is inside radius 1/2; each quadrant holds a quarter.
        let frac = inner as f32 / pts.len() as f32;
        assert!((frac - 0.25).abs() < 0.01, "{frac}");
        for q in quadrants {
            assert!((q as f32 / pts.len() as f32 - 0.25).abs() < 0.01);
        }
        assert_eq!(concentric_disk((0.5, 0.5)), (0.0, 0.0));
    }

    #[test]
    fn hemisphere_cone_and_sphere_have_their_densities() {
        let pts = points(100_000);
        // E[cos] under the cosine density is 2/3.
        let mean_z: f32 = pts.iter().map(|&u| cosine_hemisphere(u).z).sum::<f32>() / 1.0e5;
        assert!((mean_z - 2.0 / 3.0).abs() < 0.005, "{mean_z}");
        for &u in pts.iter().take(1000) {
            let d = cosine_hemisphere(u);
            assert!((d.length() - 1.0).abs() < 1.0e-5 && d.z >= 0.0);
            let s = uniform_sphere(u);
            assert!((s.length() - 1.0).abs() < 1.0e-5);
        }
        // Uniform over the sphere: half the directions above the equator, mean z zero.
        let up = pts.iter().filter(|&&u| uniform_sphere(u).z > 0.0).count();
        assert!((up as f32 / 1.0e5 - 0.5).abs() < 0.01);
        // A narrow cone: every direction inside, and uniform in 1 - cos.
        let half_angle = 0.004_625_f32; // the sun, 0.53 degrees across
        let omc = 2.0 * fmath::sin(half_angle * 0.5) * fmath::sin(half_angle * 0.5);
        let cos_max = 1.0 - omc;
        let mut mean_omc = 0.0f64;
        for &u in &pts {
            let d = uniform_cone(u, omc);
            assert!(d.z >= cos_max - 1.0e-7);
            assert!((d.length() - 1.0).abs() < 1.0e-5);
            mean_omc += (u.0 * omc) as f64;
        }
        assert!((mean_omc / 1.0e5 / omc as f64 - 0.5).abs() < 0.01);
    }

    #[test]
    fn triangle_weights_are_uniform() {
        let pts = points(60_000);
        let mut sums = [0.0f64; 3];
        for &u in &pts {
            let b = uniform_triangle(u);
            assert!(b.iter().all(|&w| (-1.0e-6..=1.0 + 1.0e-6).contains(&w)));
            assert!((b[0] + b[1] + b[2] - 1.0).abs() < 1.0e-6);
            for i in 0..3 {
                sums[i] += b[i] as f64;
            }
        }
        // The centroid of a uniform distribution is (1/3, 1/3, 1/3).
        for s in sums {
            assert!((s / 6.0e4 - 1.0 / 3.0).abs() < 0.005);
        }
    }
}

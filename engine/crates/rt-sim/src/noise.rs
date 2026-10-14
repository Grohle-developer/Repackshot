//! Divergence-free turbulence: the curl of a smooth vector potential.
//!
//! R. Bridson, J. Hourihan and M. Nordenstam, "Curl-Noise for Procedural Fluid Flow", *ACM
//! Transactions on Graphics* 26(3), SIGGRAPH 2007: the curl of any smooth vector field ψ is free
//! of divergence (`∇·(∇×ψ) = 0`), so a field built that way neither gathers nor spreads what it
//! moves. Here it is used as a **displacement** of each particle (S0 §2), not as a velocity
//! that would have to be integrated: any instant costs the same.
//!
//! The potential's three components are three independent gradient-noise fields (K. Perlin,
//! "Improving Noise", SIGGRAPH 2002: a pseudo-random gradient at every lattice point, blended
//! with the quintic `6t⁵ − 15t⁴ + 10t³`, whose first and second derivatives vanish at the lattice
//! so the field is C²). Each field is evaluated with its analytic gradient, so the curl is exact
//! (no finite differences). The lattice gradients are picked from the twelve edge directions of
//! a cube by a hash of the lattice point ([`crate::rng::mix64`]): only integer arithmetic and
//! `+ - *` in a fixed order, the same bits everywhere.

use crate::rng::mix64;

/// The twelve edge directions of a cube.
const GRADIENTS: [[f32; 3]; 12] = [
    [1.0, 1.0, 0.0],
    [-1.0, 1.0, 0.0],
    [1.0, -1.0, 0.0],
    [-1.0, -1.0, 0.0],
    [1.0, 0.0, 1.0],
    [-1.0, 0.0, 1.0],
    [1.0, 0.0, -1.0],
    [-1.0, 0.0, -1.0],
    [0.0, 1.0, 1.0],
    [0.0, -1.0, 1.0],
    [0.0, 1.0, -1.0],
    [0.0, -1.0, -1.0],
];

/// The quintic blend and its derivative.
#[inline]
fn fade(t: f32) -> (f32, f32) {
    let t2 = t * t;
    let value = t2 * t * (t * (t * 6.0 - 15.0) + 10.0);
    let slope = 30.0 * t2 * (t - 1.0) * (t - 1.0);
    (value, slope)
}

/// The lattice gradient of the integer point `(i, j, k)` for `seed`.
#[inline]
fn gradient(seed: u64, i: i32, j: i32, k: i32) -> [f32; 3] {
    let key = (i as u32 as u64)
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add((j as u32 as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F))
        .wrapping_add((k as u32 as u64).wrapping_mul(0x1656_67B1_9E37_79F9));
    GRADIENTS[(mix64(seed ^ key) % 12) as usize]
}

/// Gradient noise at `p` and its gradient. Zero at every lattice point; values roughly in
/// `[-1, 1]`.
pub fn gradient_noise(seed: u64, p: [f32; 3]) -> (f32, [f32; 3]) {
    let cell = p.map(f32::floor);
    let [i, j, k] = cell.map(|c| c as i32);
    let f = [p[0] - cell[0], p[1] - cell[1], p[2] - cell[2]];
    let (u, du) = fade(f[0]);
    let (v, dv) = fade(f[1]);
    let (w, dw) = fade(f[2]);
    let mut value = 0.0f32;
    let mut grad = [0.0f32; 3];
    for corner in 0..8u32 {
        let (cx, cy, cz) = (corner & 1, (corner >> 1) & 1, (corner >> 2) & 1);
        let g = gradient(seed, i + cx as i32, j + cy as i32, k + cz as i32);
        let d = [f[0] - cx as f32, f[1] - cy as f32, f[2] - cz as f32];
        let n = g[0] * d[0] + g[1] * d[1] + g[2] * d[2];
        // The blend weight of the corner along each axis and its derivative.
        let (wx, dwx) = if cx == 1 { (u, du) } else { (1.0 - u, -du) };
        let (wy, dwy) = if cy == 1 { (v, dv) } else { (1.0 - v, -dv) };
        let (wz, dwz) = if cz == 1 { (w, dw) } else { (1.0 - w, -dw) };
        let weight = wx * wy * wz;
        value += weight * n;
        grad[0] += weight * g[0] + dwx * wy * wz * n;
        grad[1] += weight * g[1] + wx * dwy * wz * n;
        grad[2] += weight * g[2] + wx * wy * dwz * n;
    }
    (value, grad)
}

/// Seeds of the potential's three components, derived from the effect's seed.
fn component_seeds(seed: u64) -> [u64; 3] {
    [
        mix64(seed ^ 0x5EED_0000_0000_0001),
        mix64(seed ^ 0x5EED_0000_0000_0002),
        mix64(seed ^ 0x5EED_0000_0000_0003),
    ]
}

/// The curl of the noise potential at `p` (in lattice units: the gradient is per unit of `p`).
/// Its magnitude is of order one.
pub fn curl(seed: u64, p: [f32; 3]) -> [f32; 3] {
    let [s1, s2, s3] = component_seeds(seed);
    let (_, g1) = gradient_noise(s1, p);
    let (_, g2) = gradient_noise(s2, p);
    let (_, g3) = gradient_noise(s3, p);
    [g3[1] - g2[2], g1[2] - g3[0], g2[0] - g1[1]]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_analytic_gradient_matches_finite_differences() {
        let h = 1.0e-3f32;
        for n in 0..40 {
            let p = [
                n as f32 * 0.137 - 2.1,
                n as f32 * 0.071 + 0.33,
                -(n as f32) * 0.093,
            ];
            let (_, g) = gradient_noise(9, p);
            for axis in 0..3 {
                let mut a = p;
                let mut b = p;
                a[axis] -= h;
                b[axis] += h;
                let fd = (gradient_noise(9, b).0 - gradient_noise(9, a).0) / (2.0 * h);
                assert!(
                    (fd - g[axis]).abs() < 2.0e-2,
                    "{fd} vs {} at {p:?}",
                    g[axis]
                );
            }
        }
    }

    #[test]
    fn the_curl_has_no_divergence() {
        // Central differences of each component of the curl along its own axis; their sum is the
        // divergence, which must vanish (up to the differencing error) while the curl itself is
        // of order one.
        let h = 2.0e-3f32;
        let mut largest = 0.0f32;
        let mut magnitude = 0.0f32;
        for n in 0..60 {
            let p = [
                n as f32 * 0.311 + 0.05,
                n as f32 * 0.173 - 1.7,
                n as f32 * 0.057,
            ];
            let mut div = 0.0;
            for axis in 0..3 {
                let mut a = p;
                let mut b = p;
                a[axis] -= h;
                b[axis] += h;
                div += (curl(4, b)[axis] - curl(4, a)[axis]) / (2.0 * h);
            }
            let c = curl(4, p);
            magnitude += (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt();
            largest = largest.max(div.abs());
        }
        assert!(magnitude / 60.0 > 0.3, "the field is not trivial");
        assert!(largest < 0.05, "divergence {largest}");
    }

    #[test]
    fn noise_is_zero_on_the_lattice_and_depends_on_the_seed() {
        assert_eq!(gradient_noise(1, [3.0, -2.0, 7.0]).0, 0.0);
        let a = curl(1, [0.3, 0.4, 0.5]);
        let b = curl(2, [0.3, 0.4, 0.5]);
        assert_ne!(a, b);
        assert_eq!(a, curl(1, [0.3, 0.4, 0.5]));
    }
}

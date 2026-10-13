//! CIELAB and the CIEDE2000 colour difference, with the deterministic [`rt_core::fmath`].
//!
//! ΔE₀₀ follows G. Sharma, W. Wu and E. N. Dalal, "The CIEDE2000 color-difference formula:
//! implementation notes, supplementary test data, and mathematical observations", *Color Research
//! & Application* 30(1), 2005, equations (1)–(22), with the parametric factors `kL = kC = kH = 1`.
//! The tests check the paper's 34 test pairs. Display-linear sRGB goes to XYZ with the sRGB
//! (IEC 61966-2-1) matrix, white point D65 taken as the matrix's row sums, so display white is
//! exactly `L* = 100`.

use rt_core::fmath;

const RAD_TO_DEG: f32 = 180.0 / fmath::PI;

/// Cube root of `x >= 0` by Newton's method from an exponent-based first guess; only `+ - * /`.
pub(crate) fn cbrt(x: f32) -> f32 {
    if x <= 0.0 || !x.is_finite() {
        return if x.is_finite() { 0.0 } else { x };
    }
    // Divide the exponent by three: a first guess within a factor 2 of the root.
    let bits = x.to_bits();
    let mut y = f32::from_bits(bits / 3 + 0x2a51_67a8);
    for _ in 0..4 {
        y = y - (y * y * y - x) / (3.0 * y * y);
    }
    y
}

/// sRGB primaries to CIE XYZ (D65).
const RGB_TO_XYZ: [[f32; 3]; 3] = [
    [0.412_456_4, 0.357_576_1, 0.180_437_5],
    [0.212_672_9, 0.715_152_2, 0.072_175],
    [0.019_333_9, 0.119_192, 0.950_304_1],
];

const WHITE: [f32; 3] = [
    RGB_TO_XYZ[0][0] + RGB_TO_XYZ[0][1] + RGB_TO_XYZ[0][2],
    RGB_TO_XYZ[1][0] + RGB_TO_XYZ[1][1] + RGB_TO_XYZ[1][2],
    RGB_TO_XYZ[2][0] + RGB_TO_XYZ[2][1] + RGB_TO_XYZ[2][2],
];

#[inline]
fn lab_f(t: f32) -> f32 {
    const D: f32 = 6.0 / 29.0;
    if t > D * D * D {
        cbrt(t)
    } else {
        t / (3.0 * D * D) + 4.0 / 29.0
    }
}

/// CIELAB of a display-linear sRGB colour.
pub(crate) fn lab(rgb: [f32; 3]) -> [f32; 3] {
    let m = &RGB_TO_XYZ;
    let xyz = [
        m[0][0] * rgb[0] + m[0][1] * rgb[1] + m[0][2] * rgb[2],
        m[1][0] * rgb[0] + m[1][1] * rgb[1] + m[1][2] * rgb[2],
        m[2][0] * rgb[0] + m[2][1] * rgb[1] + m[2][2] * rgb[2],
    ];
    let fx = lab_f(xyz[0] / WHITE[0]);
    let fy = lab_f(xyz[1] / WHITE[1]);
    let fz = lab_f(xyz[2] / WHITE[2]);
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// `x^7`.
#[inline]
fn pow7(x: f32) -> f32 {
    let x2 = x * x;
    x2 * x2 * x2 * x
}

/// Hue angle in degrees, `[0, 360)`; 0 for a neutral colour.
#[inline]
fn hue(b: f32, a: f32) -> f32 {
    if a == 0.0 && b == 0.0 {
        return 0.0;
    }
    let h = fmath::atan2(b, a) * RAD_TO_DEG;
    if h < 0.0 {
        h + 360.0
    } else {
        h
    }
}

#[inline]
fn cos_deg(d: f32) -> f32 {
    fmath::cos(d / RAD_TO_DEG)
}

/// CIEDE2000 difference between two CIELAB colours.
pub(crate) fn delta_e_2000(lab1: [f32; 3], lab2: [f32; 3]) -> f32 {
    const POW25_7: f32 = 6_103_515_625.0;
    let [l1, a1, b1] = lab1;
    let [l2, a2, b2] = lab2;
    let c1 = (a1 * a1 + b1 * b1).sqrt();
    let c2 = (a2 * a2 + b2 * b2).sqrt();
    let c_bar7 = pow7((c1 + c2) * 0.5);
    let g = 0.5 * (1.0 - (c_bar7 / (c_bar7 + POW25_7)).sqrt());
    let a1p = (1.0 + g) * a1;
    let a2p = (1.0 + g) * a2;
    let c1p = (a1p * a1p + b1 * b1).sqrt();
    let c2p = (a2p * a2p + b2 * b2).sqrt();
    let h1p = hue(b1, a1p);
    let h2p = hue(b2, a2p);

    let dl = l2 - l1;
    let dc = c2p - c1p;
    let product = c1p * c2p;
    let dh = if product == 0.0 {
        0.0
    } else {
        let d = h2p - h1p;
        if d > 180.0 {
            d - 360.0
        } else if d < -180.0 {
            d + 360.0
        } else {
            d
        }
    };
    let d_big_h = 2.0 * product.sqrt() * fmath::sin(dh * 0.5 / RAD_TO_DEG);

    let l_bar = (l1 + l2) * 0.5;
    let c_bar_p = (c1p + c2p) * 0.5;
    let h_bar = if product == 0.0 {
        h1p + h2p
    } else if (h1p - h2p).abs() <= 180.0 {
        (h1p + h2p) * 0.5
    } else if h1p + h2p < 360.0 {
        (h1p + h2p + 360.0) * 0.5
    } else {
        (h1p + h2p - 360.0) * 0.5
    };
    let t = 1.0 - 0.17 * cos_deg(h_bar - 30.0)
        + 0.24 * cos_deg(2.0 * h_bar)
        + 0.32 * cos_deg(3.0 * h_bar + 6.0)
        - 0.20 * cos_deg(4.0 * h_bar - 63.0);
    let x = (h_bar - 275.0) / 25.0;
    let d_theta = 30.0 * fmath::exp(-x * x);
    let c7 = pow7(c_bar_p);
    let r_c = 2.0 * (c7 / (c7 + POW25_7)).sqrt();
    let l50 = (l_bar - 50.0) * (l_bar - 50.0);
    let s_l = 1.0 + 0.015 * l50 / (20.0 + l50).sqrt();
    let s_c = 1.0 + 0.045 * c_bar_p;
    let s_h = 1.0 + 0.015 * c_bar_p * t;
    let r_t = -fmath::sin(2.0 * d_theta / RAD_TO_DEG) * r_c;
    let (ql, qc, qh) = (dl / s_l, dc / s_c, d_big_h / s_h);
    (ql * ql + qc * qc + qh * qh + r_t * qc * qh)
        .max(0.0)
        .sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The 34 pairs of Sharma, Wu and Dalal (2005), Table 1: L1 a1 b1, L2 a2 b2, ΔE₀₀.
    const SHARMA: [[f32; 7]; 34] = [
        [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
        [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
        [50.0, 2.8361, -74.0200, 50.0, 0.0, -82.7485, 3.4412],
        [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0000],
        [50.0, -1.1848, -84.8006, 50.0, 0.0, -82.7485, 1.0000],
        [50.0, -0.9009, -85.5211, 50.0, 0.0, -82.7485, 1.0000],
        [50.0, 0.0, 0.0, 50.0, -1.0, 2.0, 2.3669],
        [50.0, -1.0, 2.0, 50.0, 0.0, 0.0, 2.3669],
        [50.0, 2.49, -0.001, 50.0, -2.49, 0.0009, 7.1792],
        [50.0, 2.49, -0.001, 50.0, -2.49, 0.0010, 7.1792],
        [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011, 7.2195],
        [50.0, 2.49, -0.001, 50.0, -2.49, 0.0012, 7.2195],
        [50.0, -0.001, 2.49, 50.0, 0.0009, -2.49, 4.8045],
        [50.0, -0.001, 2.49, 50.0, 0.0010, -2.49, 4.8045],
        [50.0, -0.001, 2.49, 50.0, 0.0011, -2.49, 4.7461],
        [50.0, 2.5, 0.0, 50.0, 0.0, -2.5, 4.3065],
        [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
        [50.0, 2.5, 0.0, 61.0, -5.0, 29.0, 22.8977],
        [50.0, 2.5, 0.0, 56.0, -27.0, -3.0, 31.9030],
        [50.0, 2.5, 0.0, 58.0, 24.0, 15.0, 19.4535],
        [50.0, 2.5, 0.0, 50.0, 3.1736, 0.5854, 1.0000],
        [50.0, 2.5, 0.0, 50.0, 3.2972, 0.0, 1.0000],
        [50.0, 2.5, 0.0, 50.0, 1.8634, 0.5757, 1.0000],
        [50.0, 2.5, 0.0, 50.0, 3.2592, 0.3350, 1.0000],
        [
            60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644,
        ],
        [
            63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.2630,
        ],
        [61.2901, 3.7196, -5.3901, 61.4292, 2.2480, -4.9620, 1.8731],
        [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
        [
            22.7233, 20.0904, -46.6940, 23.0331, 14.9730, -42.5619, 2.0373,
        ],
        [36.4612, 47.8580, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
        [90.8027, -2.0831, 1.4410, 91.1528, -1.6435, 0.0447, 1.4441],
        [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
        [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
        [2.0776, 0.0795, -1.1350, 0.9033, -0.0636, -0.5514, 0.9082],
    ];

    #[test]
    fn ciede2000_matches_the_published_test_data() {
        for (i, row) in SHARMA.iter().enumerate() {
            let got = delta_e_2000([row[0], row[1], row[2]], [row[3], row[4], row[5]]);
            assert!(
                (got - row[6]).abs() < 2.0e-4,
                "pair {}: got {got}, published {}",
                i + 1,
                row[6]
            );
            // Symmetric.
            let back = delta_e_2000([row[3], row[4], row[5]], [row[0], row[1], row[2]]);
            assert!((back - got).abs() < 2.0e-4, "pair {} reversed", i + 1);
        }
        assert_eq!(delta_e_2000([40.0, 10.0, -5.0], [40.0, 10.0, -5.0]), 0.0);
    }

    #[test]
    fn cube_roots_are_accurate() {
        for i in 0..2000 {
            let x = i as f32 * 0.003_7 + 1.0e-6;
            let want = (x as f64).cbrt();
            assert!(((cbrt(x) as f64 - want) / want).abs() < 2.0e-7, "{x}");
        }
        assert_eq!(cbrt(0.0), 0.0);
        assert_eq!(cbrt(8.0), 2.0);
        assert_eq!(cbrt(-1.0), 0.0);
    }

    #[test]
    fn lab_of_white_black_and_grey() {
        let w = lab([1.0, 1.0, 1.0]);
        assert!((w[0] - 100.0).abs() < 1e-4 && w[1].abs() < 1e-3 && w[2].abs() < 1e-3);
        assert_eq!(lab([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
        let g = lab([0.18, 0.18, 0.18]);
        assert!((g[0] - 49.496).abs() < 0.01, "{g:?}");
        let red = lab([1.0, 0.0, 0.0]);
        assert!(
            (red[0] - 53.24).abs() < 0.02 && (red[1] - 80.09).abs() < 0.05,
            "{red:?}"
        );
    }
}

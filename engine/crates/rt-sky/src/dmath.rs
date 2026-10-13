//! Deterministic `f64` elementary functions for the offline tools.
//!
//! The table this crate writes is committed with its hash, and regenerating it must give the same
//! bits on any machine. The `f64` methods of `std` (`exp`, `ln`, `sin`, `atan2`...) call the
//! platform's maths library, which is not correctly rounded and differs between C libraries, so
//! the simulator and the fit use these instead: Cody–Waite argument reduction followed by
//! truncated Taylor series (W. J. Cody and W. Waite, *Software Manual for the Elementary
//! Functions*, 1980), built only from IEEE 754 `+ - * /` and `sqrt` (correctly rounded) and
//! evaluated in a fixed order. The same construction as `rt_core::fmath`, in double precision;
//! the tests check them against `std` (relative error below `1e-14`).

/// `ln 2` split in a high part with trailing zero bits (exact products with small integers) and
/// the rest.
const LN2_HI: f64 = 6.931_471_803_691_238e-1;
const LN2_LO: f64 = 1.908_214_929_270_587_7e-10;
/// `π / 2` in three parts for the reduction of `sin` and `cos`.
const PIO2_1: f64 = 1.570_796_326_734_125_6;
const PIO2_2: f64 = 6.077_100_506_303_966e-11;
const PIO2_3: f64 = 2.022_266_248_711_166_5e-21;

/// Archimedes' constant.
pub const PI: f64 = std::f64::consts::PI;
/// `π / 2`.
pub const FRAC_PI_2: f64 = std::f64::consts::FRAC_PI_2;
/// `1 / π`.
pub const FRAC_1_PI: f64 = std::f64::consts::FRAC_1_PI;
/// Degrees to radians.
pub const DEG: f64 = PI / 180.0;

/// `2^n` for an integer `n` in `[-1022, 1023]`, from its bits.
#[inline]
fn pow2i(n: i64) -> f64 {
    f64::from_bits(((n + 1023) as u64) << 52)
}

/// `e^x`: `+inf` above 709.78, 0 below -745.
pub fn exp(x: f64) -> f64 {
    if x.is_nan() {
        return x;
    }
    if x > 709.78 {
        return f64::INFINITY;
    }
    if x < -745.0 {
        return 0.0;
    }
    let k = (x * std::f64::consts::LOG2_E + 0.5).floor();
    let r = (x - k * LN2_HI) - k * LN2_LO; // |r| <= 0.35
                                           // Taylor series to r^14 (truncation below 1e-17).
    let mut p = 1.0 / 87_178_291_200.0;
    for d in [
        6_227_020_800.0,
        479_001_600.0,
        39_916_800.0,
        3_628_800.0,
        362_880.0,
        40_320.0,
        5_040.0,
        720.0,
        120.0,
        24.0,
        6.0,
        2.0,
        1.0,
        1.0,
    ] {
        p = p * r + 1.0 / d;
    }
    let k = k as i64;
    let k1 = k / 2;
    p * pow2i(k1) * pow2i(k - k1)
}

/// Natural logarithm: `-inf` for zero and negative input, `+inf` for `+inf`.
pub fn ln(x: f64) -> f64 {
    if x.is_nan() {
        return x;
    }
    if x <= 0.0 {
        return f64::NEG_INFINITY;
    }
    if x == f64::INFINITY {
        return x;
    }
    let mut x = x;
    let mut e = 0i64;
    if x < f64::MIN_POSITIVE {
        x *= 4_503_599_627_370_496.0; // 2^52
        e = -52;
    }
    let bits = x.to_bits();
    e += ((bits >> 52) & 0x7ff) as i64 - 1023;
    let mut m = f64::from_bits((bits & 0x000f_ffff_ffff_ffff) | 0x3ff0_0000_0000_0000);
    if m > std::f64::consts::SQRT_2 {
        m *= 0.5;
        e += 1;
    }
    // ln(m) = 2 atanh(s), |s| <= 0.1716, series to s^25.
    let s = (m - 1.0) / (m + 1.0);
    let s2 = s * s;
    let mut p = 1.0 / 25.0;
    for d in [23.0, 21.0, 19.0, 17.0, 15.0, 13.0, 11.0, 9.0, 7.0, 5.0, 3.0] {
        p = p * s2 + 1.0 / d;
    }
    let ln_m = 2.0 * (s + s * s2 * p);
    let e = e as f64;
    e * LN2_HI + (ln_m + e * LN2_LO)
}

/// `x^y` for `x > 0` (0 for `x <= 0` and `y > 0`).
pub fn powf(x: f64, y: f64) -> f64 {
    if y == 0.0 || x == 1.0 {
        return 1.0;
    }
    if x <= 0.0 {
        return if y > 0.0 { 0.0 } else { f64::INFINITY };
    }
    exp(y * ln(x))
}

/// Cube root of a non-negative number (a Newton step after `powf`).
pub fn cbrt(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    let y = powf(x, 1.0 / 3.0);
    y - (y * y * y - x) / (3.0 * y * y)
}

/// `sin r` and `cos r` for `|r| <= π / 4`: Taylor series to `r^19` and `r^18`.
#[inline]
fn sin_cos_poly(r: f64) -> (f64, f64) {
    let r2 = r * r;
    let mut s = -1.0 / 121_645_100_408_832_000.0; // -1 / 19!
    for (sign, d) in [
        (1.0, 355_687_428_096_000.0),
        (-1.0, 1_307_674_368_000.0),
        (1.0, 6_227_020_800.0),
        (-1.0, 39_916_800.0),
        (1.0, 362_880.0),
        (-1.0, 5_040.0),
        (1.0, 120.0),
        (-1.0, 6.0),
    ] {
        s = s * r2 + sign / d;
    }
    let sin = r + r * r2 * s;
    let mut c = 1.0 / 6_402_373_705_728_000.0; // 1 / 18!
    for (sign, d) in [
        (-1.0, 20_922_789_888_000.0),
        (1.0, 87_178_291_200.0),
        (-1.0, 479_001_600.0),
        (1.0, 3_628_800.0),
        (-1.0, 40_320.0),
        (1.0, 720.0),
        (-1.0, 24.0),
        (1.0, 2.0),
    ] {
        c = c * r2 + sign / d;
    }
    let cos = 1.0 - r2 * c;
    (sin, cos)
}

/// `(sin x, cos x)`, accurate for `|x|` up to about `1e5`.
pub fn sin_cos(x: f64) -> (f64, f64) {
    let k = (x * std::f64::consts::FRAC_2_PI + 0.5).floor();
    let r = ((x - k * PIO2_1) - k * PIO2_2) - k * PIO2_3;
    let (s, c) = sin_cos_poly(r);
    match (k as i64).rem_euclid(4) {
        0 => (s, c),
        1 => (c, -s),
        2 => (-s, -c),
        _ => (-c, s),
    }
}

/// `sin x`.
pub fn sin(x: f64) -> f64 {
    sin_cos(x).0
}

/// `cos x`.
pub fn cos(x: f64) -> f64 {
    sin_cos(x).1
}

/// `atan u` for `|u| <= 0.2`: Taylor series to `u^27` (truncation below 1e-20).
#[inline]
fn atan_poly(u: f64) -> f64 {
    let u2 = u * u;
    let mut p = -1.0 / 27.0;
    for (sign, d) in [
        (1.0, 25.0),
        (-1.0, 23.0),
        (1.0, 21.0),
        (-1.0, 19.0),
        (1.0, 17.0),
        (-1.0, 15.0),
        (1.0, 13.0),
        (-1.0, 11.0),
        (1.0, 9.0),
        (-1.0, 7.0),
        (1.0, 5.0),
        (-1.0, 3.0),
    ] {
        p = p * u2 + sign / d;
    }
    u + u * u2 * p
}

/// Arctangent, in `[-π/2, π/2]`.
pub fn atan(x: f64) -> f64 {
    if x.is_nan() {
        return x;
    }
    let a = x.abs();
    let (t, flip) = if a > 1.0 { (1.0 / a, true) } else { (a, false) };
    // atan(t) = 2 atan(t / (1 + sqrt(1 + t²))) brings t <= 1 to u <= tan(π/8) = 0.414, and once
    // more to u <= 0.199.
    let u = t / (1.0 + (1.0 + t * t).sqrt());
    let v = u / (1.0 + (1.0 + u * u).sqrt());
    let r = 4.0 * atan_poly(v);
    let r = if flip { FRAC_PI_2 - r } else { r };
    if x < 0.0 {
        -r
    } else {
        r
    }
}

/// Four-quadrant arctangent of `y / x`, in `[-π, π]`; `atan2(0, 0)` is 0.
pub fn atan2(y: f64, x: f64) -> f64 {
    if x.is_nan() || y.is_nan() {
        return f64::NAN;
    }
    if x == 0.0 {
        return if y > 0.0 {
            FRAC_PI_2
        } else if y < 0.0 {
            -FRAC_PI_2
        } else {
            0.0
        };
    }
    if y.abs() <= x.abs() {
        let r = atan(y / x);
        match (x < 0.0, y < 0.0) {
            (false, _) => r,
            (true, false) => r + PI,
            (true, true) => r - PI,
        }
    } else if y > 0.0 {
        FRAC_PI_2 - atan(x / y)
    } else {
        -FRAC_PI_2 - atan(x / y)
    }
}

/// Arccosine in `[0, π]` (the argument clamped to `[-1, 1]`).
pub fn acos(x: f64) -> f64 {
    let x = x.clamp(-1.0, 1.0);
    atan2(((1.0 - x) * (1.0 + x)).sqrt(), x)
}

/// Arcsine in `[-π/2, π/2]` (the argument clamped to `[-1, 1]`).
pub fn asin(x: f64) -> f64 {
    let x = x.clamp(-1.0, 1.0);
    atan2(x, ((1.0 - x) * (1.0 + x)).sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol * b.abs().max(1.0e-300) || (a == b)
    }

    #[test]
    fn the_functions_agree_with_std() {
        let mut x = -700.0f64;
        while x < 700.0 {
            assert!(
                close(exp(x), x.exp(), 2.0e-14),
                "exp {x}: {} {}",
                exp(x),
                x.exp()
            );
            x += 0.731;
        }
        for &x in &[
            1.0e-300, 1.0e-20, 0.3, 0.999_999, 1.0, 1.000_001, 2.0, 7.5, 1.0e8, 1.0e300,
        ] {
            assert!(
                (ln(x) - x.ln()).abs() <= 1.0e-15 * x.ln().abs().max(1.0),
                "ln {x}"
            );
            assert!(close(cbrt(x), x.cbrt(), 1.0e-14), "cbrt {x}");
        }
        assert!(close(powf(0.55, -1.3), 0.55f64.powf(-1.3), 1.0e-14));
        let mut x = -20.0f64;
        while x < 20.0 {
            let (s, c) = sin_cos(x);
            assert!(
                (s - x.sin()).abs() < 1.0e-15 && (c - x.cos()).abs() < 1.0e-15,
                "{x}"
            );
            x += 0.0173;
        }
        let mut y = -3.0f64;
        while y < 3.0 {
            for x in [-2.5, -1.0, -0.01, 0.0, 0.3, 1.0, 4.0] {
                assert!((atan2(y, x) - y.atan2(x)).abs() < 2.0e-15, "atan2 {y} {x}");
            }
            y += 0.0731;
        }
        for c in [-1.0, -0.999_999_9, -0.5, 0.0, 0.3, 0.999_999, 1.0] {
            assert!((acos(c) - f64::acos(c)).abs() < 2.0e-15, "acos {c}");
            assert!((asin(c) - f64::asin(c)).abs() < 2.0e-15, "asin {c}");
        }
    }
}

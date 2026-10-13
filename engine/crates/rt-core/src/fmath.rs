//! Deterministic elementary functions: `sin`, `cos`, `exp2`, `log2`, `pow`, `atan2`, `acos`...
//!
//! The `f32` methods of `std` (`sin`, `powf`, `exp2`, ...) call the platform's maths library,
//! which is not correctly rounded and differs between glibc, musl, macOS and the `libm` port
//! compiled into WebAssembly. The engine promises the same pixels everywhere, so the renderer
//! uses these functions instead. They are built only from IEEE 754 `+ - * /`, `sqrt` (all
//! correctly rounded), `floor`, comparisons and bit manipulation, evaluated in a fixed order and
//! never fused, so they return the same bits on every platform.
//!
//! The methods are textbook: Cody–Waite argument reduction (W. J. Cody and W. Waite, *Software
//! Manual for the Elementary Functions*, 1980) followed by truncated Taylor series, which on the
//! reduced intervals are accurate to a few units in the last place; `log2` uses the `atanh`
//! series of `ln((1 + s) / (1 - s))`. Accuracy is checked against `std` in the tests (relative
//! error below `4e-7` in the ranges the renderer uses); speed is secondary.

/// Archimedes' constant.
pub const PI: f32 = std::f32::consts::PI;
/// `2π`.
pub const TAU: f32 = std::f32::consts::TAU;
/// `π / 2`.
pub const FRAC_PI_2: f32 = std::f32::consts::FRAC_PI_2;
/// `π / 4`.
pub const FRAC_PI_4: f32 = std::f32::consts::FRAC_PI_4;
/// `1 / π`.
pub const FRAC_1_PI: f32 = std::f32::consts::FRAC_1_PI;
/// `ln 2`.
pub const LN_2: f32 = std::f32::consts::LN_2;
/// `log2 e`.
pub const LOG2_E: f32 = std::f32::consts::LOG2_E;
/// Radians per degree.
pub const DEG_TO_RAD: f32 = PI / 180.0;

/// `π / 2` split into three parts for Cody–Waite reduction: the first two have 12 significant
/// bits, so `k * PIO2_1` and `k * PIO2_2` are exact for `|k| < 4096`.
const PIO2_1: f32 = 1.570_312_5;
const PIO2_2: f32 = 4.837_513e-4;
const PIO2_3: f32 = 7.549_79e-8;

/// `sin(r)` for `|r| <= π / 4`: Taylor series to `r^9`.
#[inline]
fn sin_poly(r: f32) -> f32 {
    let r2 = r * r;
    let p = 1.0 / 362_880.0;
    let p = p * r2 - 1.0 / 5_040.0;
    let p = p * r2 + 1.0 / 120.0;
    let p = p * r2 - 1.0 / 6.0;
    r + r * r2 * p
}

/// `cos(r)` for `|r| <= π / 4`: Taylor series to `r^10`.
#[inline]
fn cos_poly(r: f32) -> f32 {
    let r2 = r * r;
    let p = -1.0 / 3_628_800.0;
    let p = p * r2 + 1.0 / 40_320.0;
    let p = p * r2 - 1.0 / 720.0;
    let p = p * r2 + 1.0 / 24.0;
    let p = p * r2 - 0.5;
    1.0 + r2 * p
}

/// Sine and cosine of `x` (radians). A non-finite `x` gives `(0, 1)`.
pub fn sin_cos(x: f32) -> (f32, f32) {
    if !x.is_finite() {
        return (0.0, 1.0);
    }
    let k = (x * (2.0 / PI) + 0.5).floor();
    let r = ((x - k * PIO2_1) - k * PIO2_2) - k * PIO2_3;
    let (s, c) = (sin_poly(r), cos_poly(r));
    // `k` is integral; the conversion saturates for huge inputs, which only changes the quadrant
    // of a result that has no precision left anyway.
    match (k as i64) & 3 {
        0 => (s, c),
        1 => (c, -s),
        2 => (-s, -c),
        _ => (-c, s),
    }
}

/// Sine of `x` (radians).
#[inline]
pub fn sin(x: f32) -> f32 {
    sin_cos(x).0
}

/// Cosine of `x` (radians).
#[inline]
pub fn cos(x: f32) -> f32 {
    sin_cos(x).1
}

/// `2^n` for an integer `n` in `[-126, 127]`, built from its bits.
#[inline]
fn pow2i(n: i32) -> f32 {
    f32::from_bits(((n + 127) as u32) << 23)
}

/// `2^x`. Returns `+inf` above 128 and 0 below -150; NaN gives NaN.
pub fn exp2(x: f32) -> f32 {
    if x.is_nan() {
        return x;
    }
    if x >= 128.0 {
        return f32::INFINITY;
    }
    if x < -150.0 {
        return 0.0;
    }
    let k = (x + 0.5).floor();
    let t = (x - k) * LN_2; // |t| <= ln(2) / 2
                            // e^t by its Taylor series to t^7 (truncation error below 6e-9).
    let p = 1.0 / 5_040.0;
    let p = p * t + 1.0 / 720.0;
    let p = p * t + 1.0 / 120.0;
    let p = p * t + 1.0 / 24.0;
    let p = p * t + 1.0 / 6.0;
    let p = p * t + 0.5;
    let p = p * t + 1.0;
    let p = p * t + 1.0;
    // Scale by 2^k in two steps so that subnormal results stay exact powers of two apart.
    let k = k as i32;
    let k1 = k / 2;
    p * pow2i(k1) * pow2i(k - k1)
}

/// Base-2 logarithm. Returns `-inf` for zero and negative input (never NaN for numbers), `+inf`
/// for `+inf`; NaN gives NaN.
pub fn log2(x: f32) -> f32 {
    if x.is_nan() {
        return x;
    }
    if x <= 0.0 {
        return f32::NEG_INFINITY;
    }
    if x == f32::INFINITY {
        return x;
    }
    let mut x = x;
    let mut e = 0i32;
    if x < f32::MIN_POSITIVE {
        x *= 8_388_608.0; // 2^23: bring subnormals into the normal range
        e = -23;
    }
    let bits = x.to_bits();
    e += ((bits >> 23) & 0xff) as i32 - 127;
    let mut m = f32::from_bits((bits & 0x007f_ffff) | 0x3f80_0000); // [1, 2)
    if m > std::f32::consts::SQRT_2 {
        m *= 0.5;
        e += 1;
    }
    // ln(m) = 2 atanh(s) with s = (m - 1) / (m + 1), |s| <= 0.1716.
    let s = (m - 1.0) / (m + 1.0);
    let s2 = s * s;
    let p = 1.0 / 11.0;
    let p = p * s2 + 1.0 / 9.0;
    let p = p * s2 + 1.0 / 7.0;
    let p = p * s2 + 1.0 / 5.0;
    let p = p * s2 + 1.0 / 3.0;
    let ln_m = 2.0 * (s + s * s2 * p);
    e as f32 + ln_m * LOG2_E
}

/// `e^x`.
#[inline]
pub fn exp(x: f32) -> f32 {
    exp2(x * LOG2_E)
}

/// Natural logarithm (same special cases as [`log2`]).
#[inline]
pub fn ln(x: f32) -> f32 {
    log2(x) * LN_2
}

/// `x^y` for `x >= 0`: `0^y` is 0 for `y > 0` and 1 for `y == 0`; a negative `x` is treated as
/// zero (the renderer never raises a negative number to a power).
pub fn powf(x: f32, y: f32) -> f32 {
    if y == 0.0 {
        return 1.0;
    }
    if x <= 0.0 {
        return if y > 0.0 { 0.0 } else { f32::INFINITY };
    }
    if x == 1.0 {
        return 1.0;
    }
    exp2(y * log2(x))
}

/// `atan(u)` for `|u| <= tan(π / 8)`: Taylor series to `u^17` (truncation below 3e-9).
#[inline]
fn atan_poly(u: f32) -> f32 {
    let u2 = u * u;
    let p = 1.0 / 17.0;
    let p = -p * u2 + 1.0 / 15.0;
    let p = -p * u2 + 1.0 / 13.0;
    let p = -p * u2 + 1.0 / 11.0;
    let p = -p * u2 + 1.0 / 9.0;
    let p = -p * u2 + 1.0 / 7.0;
    let p = -p * u2 + 1.0 / 5.0;
    let p = -p * u2 + 1.0 / 3.0;
    u - u * u2 * p
}

/// Arctangent, in `[-π/2, π/2]`.
pub fn atan(x: f32) -> f32 {
    if x.is_nan() {
        return x;
    }
    let a = x.abs();
    // Reduce to [0, 1] with atan(a) = π/2 - atan(1/a), then to |u| <= tan(π/8) with
    // atan(t) = π/4 + atan((t - 1) / (t + 1)).
    let (t, flip) = if a > 1.0 { (1.0 / a, true) } else { (a, false) };
    let r = if t > 0.414_213_57 {
        FRAC_PI_4 + atan_poly((t - 1.0) / (t + 1.0))
    } else {
        atan_poly(t)
    };
    let r = if flip { FRAC_PI_2 - r } else { r };
    if x < 0.0 {
        -r
    } else {
        r
    }
}

/// Four-quadrant arctangent of `y / x`, in `[-π, π]`. `atan2(0, 0)` is 0.
pub fn atan2(y: f32, x: f32) -> f32 {
    if x.is_nan() || y.is_nan() {
        return f32::NAN;
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
    // Keep the argument of `atan` in [-1, 1] for accuracy.
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

/// Arccosine, in `[0, π]`; the argument is clamped to `[-1, 1]`.
pub fn acos(x: f32) -> f32 {
    let x = x.clamp(-1.0, 1.0);
    atan2(((1.0 - x) * (1.0 + x)).sqrt(), x)
}

/// Arcsine, in `[-π/2, π/2]`; the argument is clamped to `[-1, 1]`.
pub fn asin(x: f32) -> f32 {
    let x = x.clamp(-1.0, 1.0);
    atan2(x, ((1.0 - x) * (1.0 + x)).sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Relative error, with an absolute floor for values near zero.
    fn err(got: f32, want: f64, floor: f64) -> f64 {
        (got as f64 - want).abs() / want.abs().max(floor)
    }

    fn sweep(lo: f32, hi: f32, n: usize) -> impl Iterator<Item = f32> {
        (0..=n).map(move |i| lo + (hi - lo) * i as f32 / n as f32)
    }

    #[test]
    fn sin_and_cos_match_std() {
        let mut worst = 0.0f64;
        for x in sweep(-50.0, 50.0, 200_000) {
            let (s, c) = sin_cos(x);
            worst = worst.max(err(s, (x as f64).sin(), 1.0));
            worst = worst.max(err(c, (x as f64).cos(), 1.0));
        }
        assert!(worst < 2.0e-7, "worst error {worst}");
        assert_eq!(sin_cos(0.0), (0.0, 1.0));
        assert_eq!(sin_cos(f32::NAN), (0.0, 1.0));
        assert!((sin(FRAC_PI_2) - 1.0).abs() < 1.0e-7);
        assert!((cos(PI) + 1.0).abs() < 1.0e-7);
        // Small angles keep their relative precision.
        assert!(err(sin(1.0e-5), 1.0e-5f64.sin(), 0.0) < 1.0e-7);
    }

    #[test]
    fn exp2_and_log2_match_std() {
        let mut worst = 0.0f64;
        for x in sweep(-30.0, 30.0, 100_000) {
            worst = worst.max(err(exp2(x), (x as f64).exp2(), 0.0));
        }
        assert!(worst < 4.0e-7, "exp2 worst {worst}");
        for x in [0.0f32, 1.0, 2.0, 10.0, -1.0, -10.0, 127.0, -126.0] {
            assert_eq!(exp2(x), (x as f64).exp2() as f32, "2^{x} must be exact");
        }
        assert_eq!(exp2(200.0), f32::INFINITY);
        assert_eq!(exp2(-200.0), 0.0);
        assert!(exp2(-140.0) > 0.0); // subnormal

        let mut worst = 0.0f64;
        for i in 0..100_000 {
            let x = exp2(-40.0 + 80.0 * i as f32 / 100_000.0);
            worst = worst.max(err(log2(x), (x as f64).log2(), 1.0));
        }
        assert!(worst < 3.0e-7, "log2 worst {worst}");
        for e in -20..20 {
            let x = (e as f32).exp2();
            assert_eq!(log2(x), e as f32);
        }
        assert_eq!(log2(0.0), f32::NEG_INFINITY);
        assert_eq!(log2(-1.0), f32::NEG_INFINITY);
        assert!((log2(1.0e-40) - (1.0e-40f64).log2() as f32).abs() < 1.0e-4);
    }

    #[test]
    fn pow_exp_ln_match_std() {
        for &(x, y) in &[
            (0.5f32, 2.4f32),
            (0.18, 1.0 / 2.4),
            (2.0, 10.0),
            (0.9, 50.0),
            (0.999, 7000.0),
            (3.7, -1.5),
        ] {
            let want = (x as f64).powf(y as f64);
            assert!(err(powf(x, y), want, 1.0e-30) < 5.0e-6, "{x}^{y}");
        }
        assert_eq!(powf(0.0, 2.0), 0.0);
        assert_eq!(powf(0.0, 0.0), 1.0);
        assert_eq!(powf(1.0, 123.0), 1.0);
        assert!(err(exp(1.0), std::f64::consts::E, 0.0) < 2.0e-7);
        assert!(err(ln(10.0), 10.0f64.ln(), 0.0) < 2.0e-7);
    }

    #[test]
    fn inverse_trigonometry_matches_std() {
        let mut worst = 0.0f64;
        for x in sweep(-100.0, 100.0, 100_000) {
            worst = worst.max(err(atan(x), (x as f64).atan(), 1.0));
        }
        for x in sweep(-1.0, 1.0, 100_000) {
            worst = worst.max(err(acos(x), (x as f64).acos(), 1.0));
            worst = worst.max(err(asin(x), (x as f64).asin(), 1.0));
        }
        assert!(worst < 3.0e-7, "worst {worst}");
        for i in 0..3600 {
            let a = i as f32 * 0.1 * DEG_TO_RAD - PI;
            let (s, c) = sin_cos(a);
            for r in [0.001f32, 1.0, 1000.0] {
                let got = atan2(s * r, c * r);
                let want = (s as f64 * r as f64).atan2(c as f64 * r as f64);
                assert!((got as f64 - want).abs() < 1.0e-6, "atan2 at {a}");
            }
        }
        assert_eq!(atan2(0.0, 0.0), 0.0);
        assert_eq!(atan2(1.0, 0.0), FRAC_PI_2);
        assert_eq!(atan2(-1.0, 0.0), -FRAC_PI_2);
        assert!((atan2(0.0, -1.0) - PI).abs() < 1.0e-7);
        assert_eq!(acos(2.0), 0.0);
    }
}

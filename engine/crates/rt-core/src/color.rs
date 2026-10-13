//! Linear RGB colour, exposure, the tone curves (linear, ACES, filmic, AgX, standard) and sRGB
//! encoding. Everything uses the deterministic [`crate::fmath`] functions, so a film converts to
//! the same 8-bit pixels on every platform.

use crate::fmath;
use std::ops::{Add, AddAssign, Div, Mul};

/// A linear-light RGB colour.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rgb {
    /// Red channel.
    pub r: f32,
    /// Green channel.
    pub g: f32,
    /// Blue channel.
    pub b: f32,
}

impl Rgb {
    /// Black.
    pub const BLACK: Rgb = Rgb::new(0.0, 0.0, 0.0);
    /// White (1, 1, 1).
    pub const WHITE: Rgb = Rgb::new(1.0, 1.0, 1.0);

    /// Creates a colour from its channels.
    #[inline]
    pub const fn new(r: f32, g: f32, b: f32) -> Rgb {
        Rgb { r, g, b }
    }

    /// Creates a grey with the same value in all channels.
    #[inline]
    pub const fn splat(v: f32) -> Rgb {
        Rgb::new(v, v, v)
    }

    /// Applies `f` to each channel.
    #[inline]
    pub fn map(self, f: impl Fn(f32) -> f32) -> Rgb {
        Rgb::new(f(self.r), f(self.g), f(self.b))
    }

    /// Rec. 709 luminance of a linear colour.
    #[inline]
    pub fn luminance(self) -> f32 {
        0.2126 * self.r + 0.7152 * self.g + 0.0722 * self.b
    }
}

impl Add for Rgb {
    type Output = Rgb;
    #[inline]
    fn add(self, o: Rgb) -> Rgb {
        Rgb::new(self.r + o.r, self.g + o.g, self.b + o.b)
    }
}

impl AddAssign for Rgb {
    #[inline]
    fn add_assign(&mut self, o: Rgb) {
        *self = *self + o;
    }
}

/// Channel-wise product.
impl Mul for Rgb {
    type Output = Rgb;
    #[inline]
    fn mul(self, o: Rgb) -> Rgb {
        Rgb::new(self.r * o.r, self.g * o.g, self.b * o.b)
    }
}

impl Mul<f32> for Rgb {
    type Output = Rgb;
    #[inline]
    fn mul(self, s: f32) -> Rgb {
        Rgb::new(self.r * s, self.g * s, self.b * s)
    }
}

impl Div<f32> for Rgb {
    type Output = Rgb;
    #[inline]
    fn div(self, s: f32) -> Rgb {
        Rgb::new(self.r / s, self.g / s, self.b / s)
    }
}

/// Tone mapping operator selected by the `tonemap` field of the RSB `RNDR` section.
///
/// Every operator maps scene-linear radiance (after exposure) to display-linear values in
/// `[0, 1]`; [`srgb_encode`] then applies the sRGB transfer function.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tonemap {
    /// 0: no curve; values are clipped to `[0, 1]` when quantised (a float output keeps them).
    Linear,
    /// 1: the ACES filmic fit of [`aces_tonemap`].
    Aces,
    /// 2: a Blender-like filmic curve, [`filmic_tonemap`].
    Filmic,
    /// 3: AgX, [`agx_tonemap`].
    Agx,
    /// 4: standard sRGB: clip to `[0, 1]` (the interface's "Standard").
    Standard,
}

impl Tonemap {
    /// Decodes the RSB value (0 linear, 1 ACES, 2 filmic, 3 AgX, 4 standard). Unknown values
    /// fall back to ACES.
    pub fn from_u32(value: u32) -> Tonemap {
        match value {
            0 => Tonemap::Linear,
            2 => Tonemap::Filmic,
            3 => Tonemap::Agx,
            4 => Tonemap::Standard,
            _ => Tonemap::Aces,
        }
    }

    /// The RSB value of this operator.
    pub fn to_u32(self) -> u32 {
        match self {
            Tonemap::Linear => 0,
            Tonemap::Aces => 1,
            Tonemap::Filmic => 2,
            Tonemap::Agx => 3,
            Tonemap::Standard => 4,
        }
    }

    /// Applies the operator to one pixel, giving display-linear values.
    pub fn apply(self, c: Rgb) -> Rgb {
        match self {
            Tonemap::Linear => c,
            Tonemap::Aces => aces_tonemap(c),
            Tonemap::Filmic => filmic_tonemap(c),
            Tonemap::Agx => agx_tonemap(c),
            Tonemap::Standard => c.map(|v| v.clamp(0.0, 1.0)),
        }
    }
}

/// Exposure multiplier for `ev` stops: `2^ev` (exact for whole stops).
#[inline]
pub fn exposure(ev: f32) -> f32 {
    fmath::exp2(ev)
}

/// ACES filmic curve (K. Narkowicz, "ACES Filmic Tone Mapping Curve", 2016), applied per
/// channel. Maps `[0, inf)` to `[0, 1]`.
pub fn aces_tonemap(c: Rgb) -> Rgb {
    c.map(|x| {
        let x = x.max(0.0);
        ((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)).clamp(0.0, 1.0)
    })
}

/// Lower end of the log2 shaper shared by [`filmic_tonemap`] and [`agx_tonemap`]: 10 stops
/// below middle grey (0.18), the range of T. Sobotka's Filmic Blender (2017) and AgX (2022).
pub const SHAPER_MIN_EV: f32 = -12.473_931;
/// Upper end of the log2 shaper: 6.5 stops above middle grey.
pub const SHAPER_MAX_EV: f32 = 4.026_069;

/// The log2 shaper: scene-linear `x` to `[0, 1]` over [`SHAPER_MIN_EV`, `SHAPER_MAX_EV`].
#[inline]
fn log_shaper(x: f32) -> f32 {
    let ev = fmath::log2(x.max(1.0e-10));
    ((ev - SHAPER_MIN_EV) / (SHAPER_MAX_EV - SHAPER_MIN_EV)).clamp(0.0, 1.0)
}

/// The S-curve applied in log space (input in `[0, 1]`): the sixth-order polynomial fit of the
/// AgX base contrast published by B. Wrensch ("Minimal AgX Implementation", iolite engine blog,
/// 2023), which approximates Sobotka's curve. Its output is display-encoded (about gamma 2.2).
#[inline]
pub fn base_contrast(x: f32) -> f32 {
    let x2 = x * x;
    let x4 = x2 * x2;
    15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x
        - 0.002_32
}

/// Display-encoded `[0, 1]` back to display-linear with the 2.2 power of the sRGB reference
/// display, as AgX and Filmic do before handing their result to an sRGB output.
#[inline]
fn display_decode(y: f32) -> f32 {
    fmath::powf(y.clamp(0.0, 1.0), 2.2)
}

/// A Blender-like filmic curve, per channel: the log2 shaper of Filmic Blender (Sobotka 2017;
/// 16.5 stops, middle grey at 0.606 of the range) followed by the base-contrast S-curve fit
/// ([`base_contrast`]). Middle grey 0.18 maps to about 0.5 display-encoded. Being per channel,
/// bright saturated colours skew towards the primaries and clip to white, as in Blender's Filmic;
/// [`agx_tonemap`] avoids that with its inset.
pub fn filmic_tonemap(c: Rgb) -> Rgb {
    c.map(|v| display_decode(base_contrast(log_shaper(v))))
}

/// AgX inset matrix (rows), from Sobotka's AgX as given by Wrensch (2023): pulls the primaries
/// slightly inwards so that bright saturated colours desaturate towards white smoothly.
const AGX_INSET: [[f32; 3]; 3] = [
    [0.842_479_06, 0.078_433_6, 0.079_223_745],
    [0.042_328_242, 0.878_468_6, 0.079_166_13],
    [0.042_375_655, 0.078_433_6, 0.879_143],
];

/// Inverse of a 3x3 matrix by cofactors (compile time).
const fn invert3(m: [[f32; 3]; 3]) -> [[f32; 3]; 3] {
    let c00 = m[1][1] * m[2][2] - m[1][2] * m[2][1];
    let c01 = m[1][2] * m[2][0] - m[1][0] * m[2][2];
    let c02 = m[1][0] * m[2][1] - m[1][1] * m[2][0];
    let det = m[0][0] * c00 + m[0][1] * c01 + m[0][2] * c02;
    let inv = 1.0 / det;
    [
        [
            c00 * inv,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv,
        ],
        [
            c01 * inv,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv,
        ],
        [
            c02 * inv,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv,
        ],
    ]
}

/// AgX outset: the inverse of the inset (the "default look" of the minimal implementation).
const AGX_OUTSET: [[f32; 3]; 3] = invert3(AGX_INSET);

#[inline]
fn mul3(m: &[[f32; 3]; 3], c: Rgb) -> Rgb {
    Rgb::new(
        m[0][0] * c.r + m[0][1] * c.g + m[0][2] * c.b,
        m[1][0] * c.r + m[1][1] * c.g + m[1][2] * c.b,
        m[2][0] * c.r + m[2][1] * c.g + m[2][2] * c.b,
    )
}

/// AgX (T. Sobotka, 2022, <https://github.com/sobotka/AgX>) with its default look: inset
/// matrix, the log2 shaper over 16.5 stops, the base-contrast S-curve ([`base_contrast`]),
/// outset (inverse inset), then the 2.2 display power. Output in `[0, 1]`.
pub fn agx_tonemap(c: Rgb) -> Rgb {
    let inset = mul3(&AGX_INSET, c.map(|v| v.max(0.0)));
    let curved = inset.map(|v| base_contrast(log_shaper(v)));
    mul3(&AGX_OUTSET, curved).map(display_decode)
}

/// Encodes one linear value (clamped to `[0, 1]`) with the sRGB transfer function.
pub fn srgb_encode(linear: f32) -> f32 {
    let l = linear.clamp(0.0, 1.0);
    if l <= 0.003_130_8 {
        l * 12.92
    } else {
        1.055 * fmath::powf(l, 1.0 / 2.4) - 0.055
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposure_is_a_power_of_two() {
        assert_eq!(exposure(0.0), 1.0);
        assert_eq!(exposure(1.0), 2.0);
        assert_eq!(exposure(-1.0), 0.5);
        assert_eq!(exposure(3.0), 8.0);
    }

    #[test]
    fn aces_maps_zero_to_zero_and_one_to_the_known_value() {
        assert_eq!(aces_tonemap(Rgb::BLACK), Rgb::BLACK);
        // 2.54 / 3.16 for the Narkowicz fit at x = 1.
        let v = aces_tonemap(Rgb::WHITE).g;
        assert!((v - 0.803_797).abs() < 1.0e-4, "aces(1) = {v}");
    }

    #[test]
    fn aces_is_monotonic_bounded_and_clamps_negatives() {
        let mut prev = 0.0;
        for i in 0..200 {
            let x = i as f32 * 0.25;
            let y = aces_tonemap(Rgb::splat(x)).r;
            assert!((0.0..=1.0).contains(&y));
            assert!(y >= prev);
            prev = y;
        }
        assert_eq!(aces_tonemap(Rgb::splat(-3.0)), Rgb::BLACK);
    }

    #[test]
    fn srgb_encode_matches_the_standard() {
        assert_eq!(srgb_encode(0.0), 0.0);
        assert!((srgb_encode(1.0) - 1.0).abs() < 1.0e-6);
        // Linear 0.5 encodes to about 0.7354.
        assert!((srgb_encode(0.5) - 0.735_357).abs() < 1.0e-4);
        // The linear segment near black.
        assert!((srgb_encode(0.002) - 0.002 * 12.92).abs() < 1.0e-7);
        // Out of range input is clamped.
        assert_eq!(srgb_encode(-1.0), 0.0);
        assert!((srgb_encode(5.0) - 1.0).abs() < 1.0e-6);
    }

    #[test]
    fn rgb_arithmetic_and_tonemap_selection() {
        let a = Rgb::new(0.1, 0.2, 0.3);
        assert_eq!(a + a, Rgb::new(0.2, 0.4, 0.6));
        assert_eq!(a * 2.0, Rgb::new(0.2, 0.4, 0.6));
        assert_eq!(a * Rgb::splat(0.5), Rgb::new(0.05, 0.1, 0.15));
        assert_eq!(a / 2.0, Rgb::new(0.05, 0.1, 0.15));
        assert!((Rgb::WHITE.luminance() - 1.0).abs() < 1.0e-6);
        for t in [
            Tonemap::Linear,
            Tonemap::Aces,
            Tonemap::Filmic,
            Tonemap::Agx,
            Tonemap::Standard,
        ] {
            assert_eq!(Tonemap::from_u32(t.to_u32()), t);
        }
        assert_eq!(Tonemap::from_u32(99), Tonemap::Aces);
        assert_eq!(Tonemap::Linear.apply(a), a);
        assert_eq!(Tonemap::Aces.apply(a), aces_tonemap(a));
        assert_eq!(
            Tonemap::Standard.apply(Rgb::new(-1.0, 0.5, 3.0)),
            Rgb::new(0.0, 0.5, 1.0)
        );
    }

    #[test]
    fn every_curve_is_monotonic_and_bounded() {
        for t in [
            Tonemap::Linear,
            Tonemap::Aces,
            Tonemap::Filmic,
            Tonemap::Agx,
            Tonemap::Standard,
        ] {
            let mut prev = Rgb::splat(-1.0);
            for i in 0..4000 {
                // From black through 2^-14 up to 2^12 (4096), plus exact zero.
                let x = if i == 0 {
                    0.0
                } else {
                    fmath::exp2(-14.0 + 26.0 * i as f32 / 4000.0)
                };
                let y = t.apply(Rgb::splat(x));
                let y = if t == Tonemap::Linear {
                    y.map(|v| v.clamp(0.0, 1.0))
                } else {
                    y
                };
                for (v, p) in [(y.r, prev.r), (y.g, prev.g), (y.b, prev.b)] {
                    assert!((0.0..=1.0).contains(&v), "{t:?}({x}) = {v}");
                    assert!(v >= p, "{t:?} decreases at {x}: {p} -> {v}");
                }
                prev = y;
            }
            // Negative input never escapes [0, 1] either.
            let y = t.apply(Rgb::new(-5.0, 0.5, 1.0e9));
            if t != Tonemap::Linear {
                for v in [y.r, y.g, y.b] {
                    assert!((0.0..=1.0).contains(&v), "{t:?}: {v}");
                }
            }
        }
    }

    #[test]
    fn filmic_and_agx_put_middle_grey_mid_scale_and_keep_greys_neutral() {
        for t in [Tonemap::Filmic, Tonemap::Agx] {
            let grey = t.apply(Rgb::splat(0.18));
            // Display-encoded about one half: sRGB of the display-linear output.
            let encoded = srgb_encode(grey.g);
            assert!((0.42..0.56).contains(&encoded), "{t:?}: grey -> {encoded}");
            assert!((grey.r - grey.g).abs() < 2.0e-3 && (grey.b - grey.g).abs() < 2.0e-3);
            // Highlights roll off: 16x middle grey is not yet white, 2^7 x is nearly.
            assert!(t.apply(Rgb::splat(0.18 * 16.0)).g < 0.97);
            assert!(t.apply(Rgb::splat(0.18 * 128.0)).g > 0.9);
            assert_eq!(t.apply(Rgb::BLACK).g, 0.0);
        }
        // The outset really is the inverse of the inset.
        let id = mul3(&AGX_OUTSET, mul3(&AGX_INSET, Rgb::new(0.3, 0.6, 0.9)));
        assert!((id.r - 0.3).abs() < 1.0e-5 && (id.g - 0.6).abs() < 1.0e-5);
        // A saturated highlight desaturates towards white with AgX more than with Filmic.
        let hot = Rgb::new(40.0, 4.0, 0.4);
        let spread = |c: Rgb| c.r - c.b;
        assert!(spread(agx_tonemap(hot)) < spread(filmic_tonemap(hot)));
    }
}

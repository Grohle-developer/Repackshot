//! Linear RGB colour, exposure, the ACES tone curve and sRGB encoding.

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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tonemap {
    /// No curve: values are clamped to `[0, 1]` after exposure.
    Linear,
    /// The ACES filmic fit of [`aces_tonemap`].
    Aces,
}

impl Tonemap {
    /// Decodes the RSB value (0 = linear, 1 = ACES). Unknown values fall back to ACES.
    pub fn from_u32(value: u32) -> Tonemap {
        if value == 0 {
            Tonemap::Linear
        } else {
            Tonemap::Aces
        }
    }

    /// Applies the operator to one pixel.
    pub fn apply(self, c: Rgb) -> Rgb {
        match self {
            Tonemap::Linear => c,
            Tonemap::Aces => aces_tonemap(c),
        }
    }
}

/// Exposure multiplier for `ev` stops: `2^ev`.
#[inline]
pub fn exposure(ev: f32) -> f32 {
    ev.exp2()
}

/// ACES filmic curve (Narkowicz fit), applied per channel. Maps `[0, inf)` to `[0, 1]`.
pub fn aces_tonemap(c: Rgb) -> Rgb {
    c.map(|x| {
        let x = x.max(0.0);
        ((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)).clamp(0.0, 1.0)
    })
}

/// Encodes one linear value (clamped to `[0, 1]`) with the sRGB transfer function.
pub fn srgb_encode(linear: f32) -> f32 {
    let l = linear.clamp(0.0, 1.0);
    if l <= 0.003_130_8 {
        l * 12.92
    } else {
        1.055 * l.powf(1.0 / 2.4) - 0.055
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
        assert_eq!(Tonemap::from_u32(0), Tonemap::Linear);
        assert_eq!(Tonemap::from_u32(1), Tonemap::Aces);
        assert_eq!(Tonemap::Linear.apply(a), a);
        assert_eq!(Tonemap::Aces.apply(a), aces_tonemap(a));
    }
}

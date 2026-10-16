//! Procedural cloth (E6): the recipe of `src/data/materials.ts` (family `FABRIC`) as a shading
//! function of a point of the cloth's plane, in millimetres.
//!
//! Warp threads (`warp`, `threadColor1`) run along `v`, weft threads (`weft`, `threadColor2`)
//! along `u`, `pitch_mm` apart. At every crossing one of them is on top, as the weave says:
//!
//! * **plain** (tafetán): every other crossing;
//! * **twill** (sarga) 2/2: two up, two down, shifted by one each row: diagonals;
//! * **twill 3/1** (denim): three up, one down, shifted by one each row: a warp-faced twill, the
//!   warp on three quarters of the face;
//! * **satin** (raso), five-shaft, warp-faced: the weft shows at one crossing in five, never two
//!   side by side;
//! * **canvas** (lona): a 2 × 2 basket weave;
//! * **knit** (punto): jersey stitches, `pitch_mm` wide and high, each a V of two plump legs
//!   pointing down, the rows overlapping, each stitch a random mix of the two colours (a
//!   heathered yarn);
//! * **felt** (fieltro): no threads, matted fibres of `pitch_mm`.
//!
//! A thread is round across (its height is a half circle, with small gaps between threads), along
//! its length rises where it floats over and falls where it goes under, smoothly from one
//! crossing to the next, so a float of several crossings stays up, and shows the slanted ridges
//! of its yarn's twist. The surface is the higher of
//! the two threads; its height, scaled by `relief` (`weaveDepth`) and half a pitch, is the bump
//! of the shading normal. Each thread varies its colour and roughness a little (±6 % and ±10 %);
//! the crowns of the threads are lighter and the gaps darker, so that the mean colour is the
//! threads' own, mixed by the share each covers ([`Cloth::mean_color`]): the preview's.

use super::noise::{fbm, hash01};
use super::wood::smoothstep;
use crate::color::Rgb;
use crate::math::Vec3;

/// A weave (`MATL`'s pattern `variant`; `weave` of the recipe).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Weave {
    /// 0: plain.
    Plain,
    /// 1: 2/2 twill.
    Twill,
    /// 2: five-shaft satin.
    Satin,
    /// 3: 2 × 2 basket (canvas).
    Canvas,
    /// 4: jersey knit.
    Knit,
    /// 5: felt.
    Felt,
    /// 6: 3/1 twill (warp-faced: denim).
    Twill31,
}

impl Weave {
    /// Decodes the RSB value (unknown values are plain).
    pub fn from_u32(v: u32) -> Weave {
        match v {
            1 => Weave::Twill,
            2 => Weave::Satin,
            3 => Weave::Canvas,
            4 => Weave::Knit,
            5 => Weave::Felt,
            6 => Weave::Twill31,
            _ => Weave::Plain,
        }
    }

    /// The share of the surface the warp covers (the rest is weft), as the mean colour uses it.
    /// Measured (the test pins it): satin shows its weft at one crossing in five, and a little
    /// around it where the warps dip under, so 0.72 rather than 0.8; the 3/1 twill, 0.685 rather
    /// than 0.75 (its warp floats are also the lighter, higher threads, which these shares count).
    pub fn warp_share(self) -> f32 {
        match self {
            Weave::Satin => 0.72,
            Weave::Twill31 => 0.685,
            _ => 0.5,
        }
    }

    /// The mean of the threads' shading (crowns light, flanks and gaps dark) over the weave,
    /// which the colour is divided by so that its mean stays the threads' own. Measured over
    /// 12 x 12 mm (the test pins it): floats stay up longer in twill and satin, felt has no gaps.
    fn mean_shade(self) -> f32 {
        match self {
            Weave::Plain => 0.892,
            Weave::Twill => 0.902,
            Weave::Satin => 0.907,
            Weave::Canvas => 0.900,
            Weave::Knit => 0.881,
            Weave::Felt => 0.861,
            Weave::Twill31 => 0.907,
        }
    }

    /// True when the warp is on top at crossing `(i, j)` (column `i` of the warp, row `j` of the
    /// weft).
    fn warp_up(self, i: i32, j: i32) -> bool {
        match self {
            Weave::Twill => (i + j).rem_euclid(4) < 2,
            Weave::Twill31 => (i + j).rem_euclid(4) < 3,
            Weave::Satin => (j - 2 * i).rem_euclid(5) != 0,
            Weave::Canvas => (i.div_euclid(2) + j.div_euclid(2)).rem_euclid(2) == 0,
            _ => (i + j).rem_euclid(2) == 0,
        }
    }
}

/// Width of a thread, in pitches (the rest is the gap between two).
const THREAD: f32 = 0.86;
/// Ridges of a yarn's twist per pitch along a thread (a whole number: the weaves keep their
/// period).
const TWIST_PER_PITCH: f32 = 2.0;
/// How deep the twist's grooves are, as a share of the thread's height.
const TWIST_DEPTH: f32 = 0.12;
/// A knit's legs lean out from the wale's middle by 15°: its sine and cosine.
const KNIT_LEAN: (f32, f32) = (0.258_819, 0.965_926);
/// A knit leg: its centre's distance from the wale's middle, its half-length and half-width, in
/// stitches.
const KNIT_LEG: (f32, f32, f32) = (0.19, 0.62, 0.24);

/// A cloth recipe in physical units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cloth {
    /// Warp colour (`threadColor1`).
    pub warp: Rgb,
    /// Weft colour (`threadColor2`).
    pub weft: Rgb,
    /// Distance between threads, millimetres.
    pub pitch_mm: f32,
    /// Relief, 0..1 (`weaveDepth`).
    pub relief: f32,
    /// How much the yarn's twist shows, 0 (smooth filaments: carbon tows) to 1 (`yarnTwist`).
    pub twist: f32,
    /// The weave.
    pub weave: Weave,
}

/// What the cloth is at a point.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClothSample {
    /// Albedo.
    pub color: Rgb,
    /// Multiplier of the material's roughness (about 1 on average).
    pub roughness: f32,
    /// Height of the surface, millimetres.
    pub height: f32,
    /// 1 where the warp is on top, 0 for the weft; felt and knit mix the two colours by it.
    pub warp: f32,
    /// True where the thread on top runs along `v` (the warp; a knit's legs, nearly upright).
    pub along_v: bool,
}

/// The relief of a yarn's twist at `s` along a thread and `c` across it (pitches): ridges
/// slanted about 35° to the thread, [`TWIST_PER_PITCH`] of them per pitch along it, `1 − depth`
/// in the grooves and 1 on the ridges.
#[inline]
fn twist(s: f32, c: f32, depth: f32) -> f32 {
    let t = s * TWIST_PER_PITCH + c * (TWIST_PER_PITCH * 1.4);
    let tri = (2.0 * (t - t.floor()) - 1.0).abs();
    1.0 - depth * (1.0 - smoothstep(0.0, 1.0, tri))
}

/// Height of a round thread `w` wide at `c` from its axis (both in pitches): a half circle.
#[inline]
fn round(c: f32, w: f32) -> f32 {
    let t = 2.0 * c / w;
    if t.abs() >= 1.0 {
        0.0
    } else {
        (1.0 - t * t).sqrt()
    }
}

impl Cloth {
    /// True when its threads stretch the highlights across them (all but felt, which has none).
    pub fn has_threads(&self) -> bool {
        self.weave != Weave::Felt
    }

    /// The colour the preview shows: the mean of the pattern.
    pub fn mean_color(&self) -> Rgb {
        let w = self.weave.warp_share();
        self.warp * w + self.weft * (1.0 - w)
    }

    /// The cloth at `(u, v)` of its plane, millimetres.
    pub fn sample(&self, u: f32, v: f32) -> ClothSample {
        let p = self.pitch_mm.max(1.0e-3);
        let (x, y) = (u / p, v / p);
        let (z, warp, i, j) = match self.weave {
            Weave::Felt => {
                let n = fbm(Vec3::new(x, y, 0.5), 4);
                let z = 0.5 + 0.5 * n;
                let mix = smoothstep(-0.3, 0.3, fbm(Vec3::new(x * 0.37, y * 0.37, 9.5), 2));
                (z, mix, x.floor() as i32, y.floor() as i32)
            }
            Weave::Knit => {
                let (i, j) = (x.floor() as i32, y.floor() as i32);
                let (fx, fy) = (x - x.floor(), y - y.floor());
                // Each stitch is a V of two plump legs (ellipses, round across and along),
                // pointing down and leaning out by KNIT_LEAN, a little longer than the stitch so
                // that the rows overlap and a wale's legs touch its neighbours' at the top.
                let (sin, cos) = KNIT_LEAN;
                let (mut z, mut at) = (0.0f32, (i, j));
                for dj in -1..=1 {
                    for di in -1..=1 {
                        let (lx, ly) = (fx - di as f32, fy - dj as f32);
                        for side in [-1.0f32, 1.0] {
                            let (dx, dy) = (lx - (0.5 + side * KNIT_LEG.0), ly - 0.5);
                            let along = (dx * side * sin + dy * cos) / KNIT_LEG.1;
                            let across = (dx * cos - dy * side * sin) / KNIT_LEG.2;
                            let e = along * along + across * across;
                            if e < 1.0 {
                                let h = (1.0 - e).sqrt();
                                if h > z {
                                    (z, at) = (h, (i + di, j + dj));
                                }
                            }
                        }
                    }
                }
                (z, hash01(at.0, at.1, 11), at.0, at.1)
            }
            weave => {
                let state = |a: i32, b: i32| if weave.warp_up(a, b) { 1.0f32 } else { 0.0 };
                let (i, j) = (x.floor() as i32, y.floor() as i32);
                let (cx, cy) = (x - x.floor() - 0.5, y - y.floor() - 0.5);
                // Along its length a thread rises and falls between the crossings' states.
                let (ky, ty) = ((y - 0.5).floor() as i32, (y - 0.5) - (y - 0.5).floor());
                let lift_warp =
                    state(i, ky) + (state(i, ky + 1) - state(i, ky)) * smoothstep(0.0, 1.0, ty);
                let (kx, tx) = ((x - 0.5).floor() as i32, (x - 0.5) - (x - 0.5).floor());
                let lift_weft = (1.0 - state(kx, j))
                    + ((1.0 - state(kx + 1, j)) - (1.0 - state(kx, j))) * smoothstep(0.0, 1.0, tx);
                // The yarn's twist: slanted ridges along each thread.
                let depth = TWIST_DEPTH * self.twist;
                let zw = (0.35 + 0.65 * lift_warp) * round(cx, THREAD) * twist(y, cx, depth);
                let zf = (0.35 + 0.65 * lift_weft) * round(cy, THREAD) * twist(x, cy, depth);
                if zw >= zf {
                    (zw, 1.0, i, j)
                } else {
                    (zf, 0.0, i, j)
                }
            }
        };
        // The thread's own variation: by column for the warp, by row for the weft.
        let (thread, salt) = if warp > 0.5 { (i, 1) } else { (j, 2) };
        let h = hash01(thread, salt, self.weave as u32);
        let base = self.warp * warp + self.weft * (1.0 - warp);
        // Gaps and the flanks of round threads are darker, the crowns lighter.
        let shade = (0.7 + 0.3 * z.clamp(0.0, 1.0) * (1.0 / 0.95)) / self.weave.mean_shade();
        let color = base * (shade * (0.94 + 0.12 * h));
        ClothSample {
            color: color.map(|c| c.clamp(0.0, 1.0)),
            roughness: 0.9 + 0.2 * hash01(thread, salt + 7, 3),
            height: z * self.relief * 0.5 * p,
            warp,
            along_v: warp > 0.5 || self.weave == Weave::Knit,
        }
    }

    /// The height at `(u, v)` (for the bump's finite differences).
    pub fn height(&self, u: f32, v: f32) -> f32 {
        self.sample(u, v).height
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cloth(weave: Weave) -> Cloth {
        Cloth {
            warp: Rgb::new(0.7, 0.2, 0.1),
            weft: Rgb::new(0.1, 0.3, 0.7),
            pitch_mm: 0.8,
            relief: 0.5,
            twist: 1.0,
            weave,
        }
    }

    /// Mean over a 12 x 12 mm patch: colour, warp share, roughness multiplier.
    fn means(c: &Cloth) -> (Rgb, f32, f32) {
        let (mut col, mut warp, mut rough, mut n) = (Rgb::BLACK, 0.0f32, 0.0f32, 0);
        for a in 0..300 {
            for b in 0..300 {
                let s = c.sample(a as f32 * 0.0403 + 0.011, b as f32 * 0.0397 + 0.007);
                col += s.color;
                warp += s.warp;
                rough += s.roughness;
                n += 1;
            }
        }
        let k = 1.0 / n as f32;
        (col * k, warp * k, rough * k)
    }

    #[test]
    fn weaves_cover_with_their_warp_share_and_average_to_the_preview_colour() {
        for weave in [
            Weave::Plain,
            Weave::Twill,
            Weave::Satin,
            Weave::Canvas,
            Weave::Knit,
            Weave::Felt,
            Weave::Twill31,
        ] {
            let c = cloth(weave);
            let (mean, warp, rough) = means(&c);
            let want = c.mean_color();
            eprintln!("{weave:?}: warp {warp}, mean {mean:?} vs {want:?}, roughness x{rough}");
            assert!(
                (warp - weave.warp_share()).abs() < 0.035,
                "{weave:?} warp {warp}"
            );
            // Felt mixes its colours over a few millimetres: a 12 mm patch holds few of them; a
            // knit's stitches are heathered at random.
            let tolerance = match weave {
                Weave::Felt => 0.06,
                Weave::Knit => 0.025,
                _ => 0.02,
            };
            for (m, w) in [(mean.r, want.r), (mean.g, want.g), (mean.b, want.b)] {
                assert!((m / w - 1.0).abs() < tolerance, "{weave:?}: {m} vs {w}");
            }
            assert!((rough - 1.0).abs() < 0.03, "{weave:?} roughness {rough}");
        }
    }

    #[test]
    fn threads_repeat_at_the_pitch_and_the_weave_has_its_period() {
        // Plain repeats every two threads, twill and canvas every four, satin every five.
        for (weave, period) in [
            (Weave::Plain, 2),
            (Weave::Twill, 4),
            (Weave::Twill31, 4),
            (Weave::Canvas, 4),
            (Weave::Satin, 5),
        ] {
            let c = cloth(weave);
            for (a, b) in [(0.13f32, 0.41f32), (2.2, 0.9), (0.55, 3.1)] {
                let s = c.sample(a, b);
                let p = period as f32 * c.pitch_mm;
                let t = c.sample(a + p, b + p);
                assert_eq!(s.warp, t.warp, "{weave:?}");
                assert!((s.height - t.height).abs() < 1.0e-4, "{weave:?}");
            }
            // And the warp is on top at some crossings and not at others.
            let ups = (0..period)
                .flat_map(|i| (0..period).map(move |j| (i, j)))
                .filter(|&(i, j)| weave.warp_up(i, j))
                .count();
            assert!(ups > 0 && ups < (period * period) as usize);
        }
        // Twill's diagonal: the pattern shifted by one thread both ways is the same.
        assert_eq!(Weave::Twill.warp_up(3, 5), Weave::Twill.warp_up(4, 4));
        // Satin never shows the weft at two neighbouring crossings, not even diagonally (a
        // five-shaft twill would); canvas moves its threads in pairs.
        let weft = |i, j| !Weave::Satin.warp_up(i, j);
        for i in 0..10 {
            for j in 0..10 {
                assert!(!(weft(i, j) && (weft(i + 1, j) || weft(i, j + 1))));
                assert!(!(weft(i, j) && (weft(i + 1, j + 1) || weft(i + 1, j - 1))));
                let c = Weave::Canvas;
                assert_eq!(c.warp_up(2 * i, j), c.warp_up(2 * i + 1, j));
                assert_eq!(c.warp_up(i, 2 * j), c.warp_up(i, 2 * j + 1));
                assert_ne!(c.warp_up(2 * i, j), c.warp_up(2 * i + 2, j));
            }
        }
        // The 3/1 twill: three up, one down along a warp.
        assert_eq!((0..4).filter(|&j| Weave::Twill31.warp_up(2, j)).count(), 3);
    }

    #[test]
    fn each_thread_varies_a_little_and_its_yarn_shows_its_twist() {
        // At the crown of every warp crossing of a plain weave, column by column: the colour
        // varies ±6 % and the roughness ±10 % from thread to thread, never more.
        let c = cloth(Weave::Plain);
        let (mut lo, mut hi, mut rlo, mut rhi) = (f32::MAX, 0.0f32, f32::MAX, 0.0f32);
        for i in 0..60 {
            let j = i % 2; // (i + j) even: the warp is up
            let s = c.sample((i as f32 + 0.5) * 0.8, (j as f32 + 0.5) * 0.8);
            assert_eq!(s.warp, 1.0);
            let k = s.color.g / c.warp.g;
            (lo, hi) = (lo.min(k), hi.max(k));
            (rlo, rhi) = (rlo.min(s.roughness), rhi.max(s.roughness));
        }
        assert!(hi / lo > 1.08 && hi / lo < 1.13, "colour {lo}..{hi}");
        assert!(
            rlo < 0.93 && rhi > 1.07 && rlo >= 0.9 && rhi <= 1.1,
            "{rlo}..{rhi}"
        );
        // Along the crown of a satin float (warp 0 floats from crossing 1 to 4): ridges every
        // half pitch, 12 % deep.
        let c = cloth(Weave::Satin);
        let hs: Vec<f32> = (0..100)
            .map(|k| c.height(0.4, (1.6 + k as f32 * 0.02) * 0.8))
            .collect();
        let (lo, hi) = hs
            .iter()
            .fold((f32::MAX, 0.0f32), |(a, b), &h| (a.min(h), b.max(h)));
        assert!((1.0 - lo / hi - 0.12).abs() < 0.01, "{lo}..{hi}");
        for k in 0..75 {
            assert!((hs[k] - hs[k + 25]).abs() < 1.0e-5, "the twist's period");
        }
        // Smooth filaments (carbon's tows): no ridges.
        let smooth = Cloth { twist: 0.0, ..c };
        let h0 = smooth.height(0.4, 1.6 * 0.8);
        assert!((0..100).all(|k| smooth.height(0.4, (1.6 + k as f32 * 0.02) * 0.8) == h0));
    }

    #[test]
    fn a_knit_stitch_is_a_v_pointing_down() {
        // In the middle of a wale, low in the stitch both legs are there (they meet at the
        // bottom), high up they have parted: a groove.
        let c = cloth(Weave::Knit);
        for (i, j) in [(0, 0), (3, 1), (-2, 5)] {
            let at = |fx: f32, fy: f32| c.height((i as f32 + fx) * 0.8, (j as f32 + fy) * 0.8);
            assert!(at(0.5, 0.2) > 0.7 * c.relief * 0.4, "bottom of the V");
            assert!(at(0.5, 0.75) < 0.2 * at(0.5, 0.2), "top of the V");
            // The legs, either side of the middle up high.
            assert!(at(0.22, 0.75) > 0.5 * at(0.5, 0.2) && at(0.78, 0.75) > 0.5 * at(0.5, 0.2));
        }
    }

    #[test]
    fn the_relief_is_half_a_pitch_at_one_and_flat_at_zero() {
        let mut c = cloth(Weave::Plain);
        let top = (0..400)
            .map(|k| c.height((k % 20) as f32 * 0.04, (k / 20) as f32 * 0.04))
            .fold(0.0f32, f32::max);
        assert!((top - 0.5 * 0.5 * 0.8).abs() < 0.02, "{top}");
        c.relief = 0.0;
        assert_eq!(c.height(0.3, 0.2), 0.0);
        // Felt has no threads but still a relief.
        let felt = cloth(Weave::Felt);
        let hs: Vec<f32> = (0..100).map(|k| felt.height(k as f32 * 0.1, 0.3)).collect();
        assert!(hs.iter().any(|&h| h > 0.12) && hs.iter().any(|&h| h < 0.08));
    }
}

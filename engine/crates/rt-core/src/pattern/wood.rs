//! Procedural wood (E6): the recipe of `src/data/materials.ts` (family `WOOD`) as a shading
//! function of the point in the wood's own frame (millimetres, the pith along `z`).
//!
//! Every size is physical (rule of the lead, E6): rings, pores and fibres are as wide on a ring
//! box as on a table. The figure (`variant`):
//!
//! * **0 rings**: the tree's annual rings, cylinders around the pith `ring_mm` apart. Inside a
//!   ring the colour rises gradually from the spring wood to the summer wood over 70 % of it and
//!   falls back sharply over its last 5 % (a sawtooth, not a sine). The two colours are pulled towards
//!   their mean `0.6 light + 0.4 dark` until their contrast (Michelson, on luminance) is the
//!   species' `contrast`; the summer wood takes 40 % of a ring on average, so the mean colour is
//!   still `0.6 light + 0.4 dark`, what the preview shows. `ring_noise` makes the rings wander
//!   (half a ring at the presets' 0.35, over about 25 mm), `ring_variation` changes their spacing
//!   from ring to ring, `axial_noise` shifts them along the trunk.
//! * **1 strips** (bamboo, a grass): parallel strips `ring_mm` wide along the trunk, each its own
//!   mix of the two colours, with a darker seam between two; the vascular bundles as dark flecks
//!   along the strip (0.4 × 3 mm, −10 %, about 15 per cm² on a face along the strips) and a node
//!   every 150 ± 30 mm of each strip (a 2 mm band across it, −15 %, raised 0.02 mm).
//! * **2 speckle** (fibreboard): no figure, a fine homogeneous speckle of the two colours.
//! * **3 streaked** (ebony): faint rings and dark streaks along the grain.
//!
//! Everywhere: **fibres**, a ±5 % variation of the colour about 0.3 mm across and 30 mm along the
//! grain (`fibre` 1), and `color_noise`, a slow variation of brightness. **Pores** `pore_mm` wide
//! and ten times as long, `pore_depth` times 0.15 of their width deep (a vessel cut open along its
//! length, partly filled by the finish: 0.0225 mm for oak's 0.3 mm pores at 0.5): spread through
//! the wood (diffuse-porous, `pore_band` 0) or only in the spring-wood band of each ring, where
//! they draw lines (ring-porous, `pore_band` 1). The band fades in over the first 4 % of the ring
//! and out from 12 to 24 %, so the pores never line up into a step along a ring. They darken the
//! colour and dip the surface (the rings have no relief; they live in the colour).
//!
//! **Knots** ([`super::knots`], figure 0 only): the rings and fibres flow around them, and inside
//! each one its own end grain.

use super::knots::{Flow, Inside, Knots, BARK_MM, CRACK_HALF_MM, DISH_MM};
use super::noise::{fbm, hash01, noise3};
use crate::color::Rgb;
use crate::math::Vec3;

/// Mean share of the dark summer wood (the preview's flat colour is `0.6 light + 0.4 dark`).
pub const MEAN_DARK: f32 = 0.4;
/// Depth of the pores over their width at `pore_depth` 1.
pub const PORE_DEPTH: f32 = 0.15;
/// Length over width of a pore.
pub const PORE_STRETCH: f32 = 10.0;
/// Wavelength of the rings' wander, millimetres.
pub const WANDER_MM: f32 = 25.0;
/// The fibres' size across and along the grain, millimetres.
pub const FIBRE_MM: (f32, f32) = (0.3, 30.0);
/// Bamboo's vascular bundles: cells of this size across and along the strip (one fleck each:
/// 15 per cm² on a face along the strips).
const BUNDLE_CELL_MM: (f32, f32) = (0.816, 4.0);
/// A bundle's half sizes across and along the strip, millimetres.
const BUNDLE_HALF_MM: (f32, f32) = (0.2, 1.5);
/// Distance between two nodes of a bamboo strip, and its variation (±), millimetres.
const NODE_MM: (f32, f32) = (150.0, 30.0);
/// Height of a bamboo node, millimetres.
const NODE_HEIGHT_MM: f32 = 0.02;

/// The wood's figure (`PATN.variant`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Figure {
    /// 0: annual rings.
    Rings,
    /// 1: parallel strips (bamboo).
    Strips,
    /// 2: a fine speckle (fibreboard).
    Speckle,
    /// 3: faint rings and dark streaks (ebony).
    Streaked,
}

impl Figure {
    /// Decodes the RSB value (unknown values are rings).
    pub fn from_u32(v: u32) -> Figure {
        match v {
            1 => Figure::Strips,
            2 => Figure::Speckle,
            3 => Figure::Streaked,
            _ => Figure::Rings,
        }
    }
}

/// A wood recipe in physical units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wood {
    /// Spring wood (light).
    pub light: Rgb,
    /// Summer wood (dark).
    pub dark: Rgb,
    /// Ring spacing (strip width for bamboo), millimetres.
    pub ring_mm: f32,
    /// Ring to ring variation of the spacing, 0..1.
    pub ring_variation: f32,
    /// Wander of the rings, 0..1.
    pub ring_noise: f32,
    /// Shifts of the rings along the trunk, 0..1.
    pub axial_noise: f32,
    /// Slow variation of brightness, 0..1.
    pub color_noise: f32,
    /// Contrast between spring and summer wood (Michelson, on luminance); 0: the colours as given.
    pub contrast: f32,
    /// Width of a pore, millimetres (0: no pores).
    pub pore_mm: f32,
    /// Depth of the pores, 0..1.
    pub pore_depth: f32,
    /// 0: pores everywhere (diffuse-porous); 1: only in the spring wood (ring-porous).
    pub pore_band: f32,
    /// Amount of the fibres' colour variation (1: ±5 %).
    pub fibre: f32,
    /// The figure.
    pub figure: Figure,
}

/// What the wood is at a point.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WoodSample {
    /// Albedo.
    pub color: Rgb,
    /// Share of summer wood, 0..1 (before pores, fibres and colour noise).
    pub dark: f32,
    /// Height of the surface, millimetres (below 0: pores and knots; above: bamboo's nodes).
    pub height: f32,
    /// Added to the roughness (a knot's end grain), on top of the recipe's multiplier.
    pub rough_add: f32,
    /// The ring fraction there where banded pores need it for [`Wood::height`] (what
    /// [`Wood::ring_fraction`] gives, without computing the rings again).
    pub ring: Option<f32>,
}

/// `smoothstep(e0, e1, x)`.
#[inline]
pub(crate) fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The summer wood's share at the fraction `f` of a ring: a sawtooth, rising over 70 % of the
/// ring and falling sharply at its end (over its last 5 %). Its mean is [`MEAN_DARK`].
#[inline]
pub(crate) fn ring_profile(f: f32) -> f32 {
    let rise = ((f - 0.225) / 0.7).clamp(0.0, 1.0);
    rise * (1.0 - smoothstep(0.95, 1.0, f))
}

/// Michelson contrast of two luminances.
#[cfg(test)]
fn michelson(a: f32, b: f32) -> f32 {
    let (hi, lo) = (a.max(b), a.min(b));
    if hi + lo > 0.0 {
        (hi - lo) / (hi + lo)
    } else {
        0.0
    }
}

impl Wood {
    /// The two colours pulled about their mean `0.6 light + 0.4 dark` (which stays) until the
    /// Michelson contrast of their luminances is the recipe's (at most 1.5 times as far apart as
    /// given), or as given when the recipe's contrast is 0.
    pub fn colors(&self) -> (Rgb, Rgb) {
        let mean = self.light * (1.0 - MEAN_DARK) + self.dark * MEAN_DARK;
        let (la, lb) = (self.light.luminance(), self.dark.luminance());
        let lm = mean.luminance();
        let c = self.contrast;
        // With a' = m + k (a - m): c = k |a - b| / (2 m + k (a + b - 2 m)), solved for k.
        let den = (la - lb).abs() - c * (la + lb - 2.0 * lm) * if la >= lb { 1.0 } else { -1.0 };
        if c <= 0.0 || (la - lb).abs() <= 0.0 || den <= 0.0 {
            return (self.light, self.dark);
        }
        let k = (2.0 * lm * c / den).min(1.5);
        let pull = |v: Rgb| (mean * (1.0 - k) + v * k).map(|x| x.clamp(0.0, 1.0));
        (pull(self.light), pull(self.dark))
    }

    /// The ring coordinate at `q`, its rings pushed outwards by `bulge` millimetres: rings are
    /// its integer steps.
    fn ring_phase(&self, q: Vec3, bulge: f32) -> f32 {
        let s = self.ring_mm.max(1.0e-3);
        // Wander: the radial coordinates pushed by a slow noise (slower along the axis).
        let slow = Vec3::new(q.x / WANDER_MM, q.y / WANDER_MM, q.z / (4.0 * WANDER_MM));
        let push = 1.5 * s * self.ring_noise;
        let x = q.x + push * fbm(slow, 2);
        let y = q.y + push * fbm(slow + Vec3::new(41.3, 17.9, 5.1), 2);
        let mut rho = (x * x + y * y).sqrt();
        // Along the trunk the rings shift.
        let along = Vec3::new(
            q.x / (2.0 * WANDER_MM),
            q.y / (2.0 * WANDER_MM),
            q.z / 150.0,
        );
        rho += self.axial_noise * s * fbm(along + Vec3::new(3.7, 91.1, 12.5), 2);
        if bulge != 0.0 {
            rho -= bulge;
        }
        let phase = rho / s;
        // Ring to ring, the spacing varies.
        phase + 0.6 * self.ring_variation * noise3(Vec3::new(phase * 0.37, 7.31, 2.9))
    }

    /// The summer wood's share at `q` for the figure (its rings pushed out by `bulge`), and the
    /// ring fraction (spring wood near 0; `None` without rings).
    fn figure(&self, q: Vec3, bulge: f32) -> (f32, Option<f32>) {
        match self.figure {
            Figure::Rings | Figure::Streaked => {
                let phase = self.ring_phase(q, bulge);
                let f = phase - phase.floor();
                let mut dark = ring_profile(f);
                if self.figure == Figure::Streaked {
                    // Faint rings under dark streaks along the grain.
                    let streak =
                        noise3(Vec3::new(q.x / 2.0, q.y / 2.0, q.z / 40.0) + Vec3::splat(5.5));
                    let s = smoothstep(0.05, 0.35, streak);
                    dark = 0.1 + 0.4 * dark + 0.9 * s;
                    dark = dark.clamp(0.0, 1.0);
                }
                (dark, Some(f))
            }
            Figure::Strips => {
                let s = self.ring_mm.max(1.0e-3);
                let strip = (q.x / s).floor() as i32;
                let k = hash01(strip, (q.y / (8.0 * s)).floor() as i32, 41);
                // A darker line where two strips meet.
                let edge = (q.x / s) - (q.x / s).floor();
                let seam = 1.0 - smoothstep(0.0, 0.04, edge.min(1.0 - edge));
                ((0.24 + 0.3 * k + 0.35 * seam).min(1.0), None)
            }
            Figure::Speckle => {
                let n = noise3(q * (1.0 / 0.15) + Vec3::splat(17.0));
                let m = noise3(q * (1.0 / 0.6) + Vec3::splat(3.0));
                (((MEAN_DARK + 1.1 * n + 0.6 * m).clamp(0.0, 1.0)), None)
            }
        }
    }

    /// Bamboo's marks at `q`: the darkening of its vascular bundles and nodes (a factor of the
    /// colour) and the height of its nodes.
    fn bamboo(&self, q: Vec3) -> (f32, f32) {
        let s = self.ring_mm.max(1.0e-3);
        let strip = (q.x / s).floor() as i32;
        // A fleck per cell, anywhere across it (so every plane along the strips cuts as many),
        // within its cell along it: the nearest of the nine cells around decides.
        let (cell, len) = BUNDLE_CELL_MM;
        let (half, long) = BUNDLE_HALF_MM;
        let (ci, cj, k) = (
            (q.x / cell).floor() as i32,
            (q.y / cell).floor() as i32,
            (q.z / len).floor() as i32,
        );
        let mut e = f32::INFINITY;
        for i in ci - 1..=ci + 1 {
            for j in cj - 1..=cj + 1 {
                let id = i.wrapping_mul(7919).wrapping_add(j.wrapping_mul(104_729));
                let at = |c: u32| hash01(id, k, 60 + c);
                let d = q - Vec3::new(
                    (i as f32 + at(0)) * cell,
                    (j as f32 + at(1)) * cell,
                    k as f32 * len + long + (len - 2.0 * long) * at(2),
                );
                e = e.min((d.x / half).powi(2) + (d.y / half).powi(2) + (d.z / long).powi(2));
            }
        }
        let fleck = 1.0 - smoothstep(0.5, 1.0, e);
        // The nodes of this strip: one near the start of every NODE_MM along it.
        let (step, wiggle) = NODE_MM;
        let shift = step * hash01(strip, 0, 51);
        let n = ((q.z - shift) / step).floor() as i32;
        let centre_of =
            |m: i32| shift + m as f32 * step + wiggle * (2.0 * hash01(strip, m, 52) - 1.0);
        let gap = (q.z - centre_of(n))
            .abs()
            .min((q.z - centre_of(n + 1)).abs());
        let node = 1.0 - smoothstep(0.8, 1.2, gap);
        let factor = (1.0 - 0.1 * fleck) * (1.0 - 0.15 * node);
        (factor, NODE_HEIGHT_MM * (1.0 - smoothstep(0.0, 1.5, gap)))
    }

    /// The pores at `q` (0 none to 1), given the ring fraction there.
    fn pores(&self, q: Vec3, ring: Option<f32>) -> f32 {
        if self.pore_mm <= 0.0 || self.pore_depth <= 0.0 {
            return 0.0;
        }
        let w = self.pore_mm;
        let p = Vec3::new(q.x / w, q.y / w, q.z / (w * PORE_STRETCH));
        let n = noise3(p + Vec3::new(13.1, 5.7, 77.7));
        // Ring-porous wood packs them densely in the spring wood, at the start of each ring;
        // diffuse-porous wood spreads fewer everywhere.
        let (band, banded) = match ring {
            Some(f) => (
                smoothstep(0.0, 0.04, f) * (1.0 - smoothstep(0.12, 0.24, f)),
                self.pore_band,
            ),
            None => (1.0, 0.0),
        };
        let lo = 0.25 - 0.2 * banded;
        smoothstep(lo, lo + 0.2, n) * (1.0 - banded * (1.0 - band))
    }

    /// The wood at `q`, a point of its frame in millimetres (the pith along `z`), with `knots`.
    pub fn sample(&self, q: Vec3, knots: &Knots) -> WoodSample {
        let (point, bulge) = match knots.flow(q) {
            Flow::In(inside) => return self.knot(q, knots, &inside),
            Flow::Around { point, bulge } => (point, bulge),
        };
        let q = point;
        let (light, dark_color) = self.colors();
        let (dark, ring) = self.figure(q, bulge);
        let mut color = light * (1.0 - dark) + dark_color * dark;
        let fibre = noise3(Vec3::new(
            q.x / FIBRE_MM.0,
            q.y / FIBRE_MM.0,
            q.z / FIBRE_MM.1,
        ));
        let k = 1.0 + 0.12 * self.fibre * fibre + 0.5 * self.color_noise * self.slow(q);
        color = color * k.max(0.0);
        let pore = self.pores(q, ring);
        if pore > 0.0 {
            color = color * (1.0 - 0.6 * self.pore_depth.min(1.0) * pore);
        }
        let mut height = -self.pore_depth_mm() * pore;
        if self.figure == Figure::Strips {
            let (factor, node) = self.bamboo(q);
            color = color * factor;
            height += node;
        }
        let banded = self.pore_mm > 0.0 && self.pore_depth > 0.0 && self.pore_band > 0.0;
        WoodSample {
            color: color.map(|c| c.clamp(0.0, 1.0)),
            dark,
            height,
            rough_add: 0.0,
            ring: if banded { ring } else { None },
        }
    }

    /// The slow variation of brightness at `q`, about -1..1.
    fn slow(&self, q: Vec3) -> f32 {
        fbm(
            Vec3::new(q.x / 60.0, q.y / 60.0, q.z / 180.0) + Vec3::splat(57.0),
            3,
        )
    }

    /// Inside a knot: its own end grain.
    fn knot(&self, q: Vec3, knots: &Knots, at: &Inside) -> WoodSample {
        let (light, dark_color) = self.colors();
        let fine = (self.ring_mm / 3.0).max(1.0e-3);
        let phase = at.rho / fine + 0.3 * noise3(q * (1.0 / 3.0) + Vec3::splat(29.0));
        let dark = ring_profile(phase - phase.floor());
        let mut color = light * (1.0 - dark) + dark_color * dark;
        color =
            color * ((1.0 - 0.35 * knots.darkness) * (1.0 + 0.5 * self.color_noise * self.slow(q)));
        // The bark pocket round its edge.
        let edge = at.radius - at.rho;
        let pocket = 1.0 - smoothstep(BARK_MM - 0.1, BARK_MM, edge);
        color = color * (1.0 - 0.5 * pocket);
        // A crack from the centre.
        if let Some(angle) = knots.list[at.knot].crack {
            let (sin, cos) = crate::fmath::sin_cos(angle);
            let along = at.a * cos + at.b * sin;
            let off = (at.b * cos - at.a * sin).abs();
            if along > 0.0 {
                let crack = 1.0 - smoothstep(CRACK_HALF_MM - 0.05, CRACK_HALF_MM, off);
                color = color * (1.0 - 0.2 * crack);
            }
        }
        let t = at.rho / at.radius;
        WoodSample {
            color: color.map(|c| c.clamp(0.0, 1.0)),
            dark,
            height: -DISH_MM * (1.0 - t * t),
            rough_add: 0.1,
            ring: None,
        }
    }

    /// True when the wood has a relief to bump the normal with (pores, bamboo's nodes, knots).
    pub fn has_relief(&self, knots: &Knots) -> bool {
        (self.pore_mm > 0.0 && self.pore_depth > 0.0)
            || self.figure == Figure::Strips
            || !knots.is_empty()
    }

    /// The height of the surface at `q` (pores, bamboo's nodes, knots; for the bump's finite
    /// differences). `ring` is the ring fraction near `q` ([`Wood::ring_fraction`]: pores sit in
    /// bands far wider than the step).
    pub fn height(&self, q: Vec3, ring: Option<f32>, knots: &Knots) -> f32 {
        let q = match knots.flow(q) {
            Flow::In(at) => {
                let t = at.rho / at.radius;
                return -DISH_MM * (1.0 - t * t);
            }
            Flow::Around { point, .. } => point,
        };
        let mut h = -self.pore_depth_mm() * self.pores(q, ring);
        if self.figure == Figure::Strips {
            h += self.bamboo(q).1;
        }
        h
    }

    /// The depth of a pore, millimetres.
    pub fn pore_depth_mm(&self) -> f32 {
        PORE_DEPTH * self.pore_depth * self.pore_mm
    }

    /// The ring fraction at `q` (`None` without rings, or where no pores need it), for
    /// [`Wood::height`].
    pub fn ring_fraction(&self, q: Vec3, knots: &Knots) -> Option<f32> {
        if self.pore_mm <= 0.0 || self.pore_depth <= 0.0 || self.pore_band <= 0.0 {
            return None;
        }
        match knots.flow(q) {
            Flow::In(_) => None,
            Flow::Around { point, bulge } => self.figure(point, bulge).1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    impl Wood {
        /// The wood at `q` without knots.
        fn at(&self, q: Vec3) -> WoodSample {
            self.sample(q, &Knots::none())
        }
    }

    /// Oak as the catalogue sends it (3 mm rings, ring-porous).
    pub(crate) fn oak() -> Wood {
        Wood {
            light: Rgb::new(0.56, 0.38, 0.21),
            dark: Rgb::new(0.3, 0.18, 0.09),
            ring_mm: 3.0,
            ring_variation: 0.45,
            ring_noise: 0.35,
            axial_noise: 0.25,
            color_noise: 0.2,
            contrast: 0.35,
            pore_mm: 0.3,
            pore_depth: 0.5,
            pore_band: 1.0,
            fibre: 1.0,
            figure: Figure::Rings,
        }
    }

    #[test]
    fn the_ring_profile_is_a_sawtooth_with_the_mean_dark_share() {
        let n = 100_000;
        let mean: f32 = (0..n)
            .map(|i| ring_profile(i as f32 / n as f32))
            .sum::<f32>()
            / n as f32;
        assert!((mean - MEAN_DARK).abs() < 0.003, "{mean}");
        assert_eq!(ring_profile(0.0), 0.0);
        // A slow rise over 70 % of the ring, a fall over its last 5 %.
        assert!(ring_profile(0.5) > ring_profile(0.4) && ring_profile(0.9) > 0.9);
        assert!(ring_profile(0.6) - ring_profile(0.5) < 0.15);
        assert!(ring_profile(0.949) > 0.99);
        assert!((ring_profile(0.975) - 0.5).abs() < 0.02);
        assert!(ring_profile(0.999) < 0.01);
    }

    #[test]
    fn plain_rings_repeat_at_the_ring_spacing() {
        // Without noise the rings are exact: along a radius the summer wood repeats every
        // ring_mm.
        let wood = Wood {
            ring_variation: 0.0,
            ring_noise: 0.0,
            axial_noise: 0.0,
            ..oak()
        };
        let darks: Vec<f32> = (0..4000)
            .map(|i| wood.at(Vec3::new(10.0 + i as f32 * 0.005, 0.0, 3.0)).dark)
            .collect();
        let starts: Vec<usize> = (1..darks.len())
            .filter(|&i| darks[i - 1] > 0.5 && darks[i] < 0.5)
            .collect();
        assert!(starts.len() >= 5, "{starts:?}");
        for w in starts.windows(2) {
            let period = (w[1] - w[0]) as f32 * 0.005;
            assert!((period - 3.0).abs() < 0.02, "{period}");
        }
    }

    #[test]
    fn the_contrast_is_the_species_and_the_mean_stays_the_previews() {
        for contrast in [0.15f32, 0.25, 0.35] {
            let wood = Wood { contrast, ..oak() };
            let (l, d) = wood.colors();
            let got = michelson(l.luminance(), d.luminance());
            assert!((got - contrast).abs() < 1.0e-3, "{contrast}: {got}");
            let mean = l * 0.6 + d * 0.4;
            let want = wood.light * 0.6 + wood.dark * 0.4;
            assert!((mean.r - want.r).abs() < 1.0e-5 && (mean.b - want.b).abs() < 1.0e-5);
        }
        // 0 keeps the recipe's colours.
        let given = Wood {
            contrast: 0.0,
            ..oak()
        };
        assert_eq!(given.colors(), (given.light, given.dark));
    }

    #[test]
    fn across_many_rings_the_summer_wood_takes_its_mean_share() {
        // Along radii, through 300 rings of the full recipe (wander, variation, axial noise).
        let wood = oak();
        let (mut dark, mut n) = (0.0f64, 0);
        for k in 0..64 {
            let a = k as f32 * 0.098;
            for i in 0..3000 {
                let r = 20.0 + i as f32 * 0.3;
                dark += f64::from(
                    wood.at(Vec3::new(r * a.cos(), r * a.sin(), k as f32 * 7.0))
                        .dark,
                );
                n += 1;
            }
        }
        let share = dark / f64::from(n);
        assert!((share - f64::from(MEAN_DARK)).abs() < 0.03, "{share}");
    }

    #[test]
    fn every_figure_keeps_the_previews_mean_colour_on_a_plank() {
        // Over a plank face (a plane parallel to the pith, 60 mm off it): the mean colour is the
        // preview's 0.6 light + 0.4 dark within 8 %, for rings, strips, speckle and streaks.
        for figure in [
            Figure::Rings,
            Figure::Strips,
            Figure::Speckle,
            Figure::Streaked,
        ] {
            let wood = Wood {
                figure,
                ring_mm: if figure == Figure::Strips { 7.0 } else { 3.0 },
                ..oak()
            };
            let (mut sum, mut n) = (Rgb::BLACK, 0);
            for i in 0..400 {
                for j in 0..100 {
                    let q = Vec3::new(i as f32 * 0.37 - 70.0, 60.0, j as f32 * 1.3);
                    sum += wood.at(q).color;
                    n += 1;
                }
            }
            let mean = sum * (1.0 / n as f32);
            let want = wood.light * 0.6 + wood.dark * 0.4;
            for (m, w) in [(mean.r, want.r), (mean.g, want.g), (mean.b, want.b)] {
                assert!((m / w - 1.0).abs() < 0.08, "{figure:?}: {m} vs {w}");
            }
        }
    }

    #[test]
    fn ring_porous_pores_sit_in_the_spring_wood_and_dip_the_surface() {
        let wood = oak();
        let (mut early, mut late, mut n_early, mut n_late) = (0.0f32, 0.0f32, 0, 0);
        for i in 0..40_000 {
            let q = Vec3::new(30.0 + (i % 400) as f32 * 0.02, 1.0, (i / 400) as f32 * 0.4);
            let s = wood.at(q);
            assert!((-wood.pore_depth_mm()..=0.0).contains(&s.height));
            let f = wood.ring_fraction(q, &Knots::none()).expect("rings");
            assert_eq!(s.ring, Some(f), "the sample carries it");
            if f < 0.12 {
                early += -s.height;
                n_early += 1;
            } else if f > 0.3 {
                late += -s.height;
                n_late += 1;
            }
        }
        assert!(
            early / n_early as f32 > 3.0e-3,
            "{}",
            early / n_early as f32
        );
        assert_eq!(late, 0.0, "no pores in the summer wood");
        assert!(n_late > 0);
        // As deep as 0.15 of their width at pore_depth 1: oak's 0.3 mm pores at 0.5, 0.0225 mm;
        // maple's 0.08 mm at 0.15, 0.0018 mm.
        assert!((wood.pore_depth_mm() - 0.0225).abs() < 1.0e-6);
        let maple = Wood {
            pore_mm: 0.08,
            pore_depth: 0.15,
            ..oak()
        };
        assert!((maple.pore_depth_mm() - 0.0018).abs() < 1.0e-6);
        // No pores, no relief: pine.
        let pine = Wood {
            pore_mm: 0.0,
            ..oak()
        };
        assert_eq!(pine.at(Vec3::new(30.0, 1.0, 2.0)).height, 0.0);
        assert_eq!(
            pine.ring_fraction(Vec3::new(30.0, 1.0, 2.0), &Knots::none()),
            None
        );
    }

    #[test]
    fn the_pores_of_a_ring_do_not_add_up_to_a_step() {
        // The relief averaged along exact rings (no wander), as a function of the radius: the
        // band of ring-porous pores fades in and out, so the mean height never jumps between
        // two radii 0.01 mm apart (a step there was a terrace on every ring).
        let wood = Wood {
            ring_noise: 0.0,
            ring_variation: 0.0,
            axial_noise: 0.0,
            ..oak()
        };
        let profile: Vec<f32> = (0..1200)
            .map(|i| {
                let r = 30.0 + i as f32 * 0.01;
                let mut sum = 0.0f32;
                for k in 0..400 {
                    let a = k as f32 * 0.0157;
                    sum += wood
                        .at(Vec3::new(r * a.cos(), r * a.sin(), (k % 20) as f32 * 3.1))
                        .height;
                }
                sum / 400.0
            })
            .collect();
        let deepest = profile.iter().fold(0.0f32, |a, &h| a.min(h));
        assert!(
            deepest < -0.25 * wood.pore_depth_mm(),
            "the pores are there: {deepest}"
        );
        let jump = profile
            .windows(2)
            .fold(0.0f32, |a, w| a.max((w[1] - w[0]).abs()));
        assert!(jump < 0.08 * wood.pore_depth_mm(), "{jump} mm in 0.01 mm");
    }

    fn bamboo() -> Wood {
        Wood {
            ring_mm: 7.0,
            pore_mm: 0.0,
            figure: Figure::Strips,
            ..oak()
        }
    }

    #[test]
    fn bamboo_has_a_node_every_150_mm_of_a_strip() {
        // Along the middle of one strip, 6 m: the raised bands, their spacing and their width.
        let wood = bamboo();
        let (mut nodes, mut inside, mut start) = (Vec::new(), false, 0.0f32);
        for i in 0..60_000 {
            let z = i as f32 * 0.1;
            let (factor, h) = wood.bamboo(Vec3::new(3.5, 2.0, z));
            let on = h > 0.5 * NODE_HEIGHT_MM;
            if on && !inside {
                start = z;
            }
            if !on && inside {
                nodes.push((start, z));
                // A band about 2 mm wide, raised 0.02 mm, 15 % darker in its middle.
                let mid = 0.5 * (start + z);
                let (f, top) = wood.bamboo(Vec3::new(3.5, 2.0, mid));
                assert!((z - start - 1.6).abs() < 0.5, "{}", z - start);
                assert!(
                    (top - NODE_HEIGHT_MM).abs() < 2.0e-3 && f < 0.88,
                    "{top} {f}"
                );
                assert!(factor >= 0.0);
            }
            inside = on;
        }
        let gaps: Vec<f32> = nodes.windows(2).map(|w| w[1].0 - w[0].0).collect();
        assert!((38..=42).contains(&nodes.len()), "{}", nodes.len());
        assert!(
            gaps.iter().all(|&g| (90.0..=210.0).contains(&g)),
            "{gaps:?}"
        );
        let mean = gaps.iter().sum::<f32>() / gaps.len() as f32;
        assert!((mean - 150.0).abs() < 10.0, "{mean}");
        // The next strip has its nodes elsewhere.
        let next: Vec<f32> = (0..6000)
            .map(|i| i as f32)
            .filter(|&z| wood.bamboo(Vec3::new(10.5, 2.0, z)).1 > 0.5 * NODE_HEIGHT_MM)
            .collect();
        assert!(next.first() != Some(&nodes[0].0.round()));
    }

    #[test]
    fn bamboo_flecks_are_its_bundles_along_the_strip() {
        // A 20 x 40 mm patch of a face along the strips (y constant) at 0.05 mm: the dark flecks,
        // counted as connected regions, about 15 per cm², each longer along the strip than across;
        // on planes through the middle and near the edge of a row of cells alike.
        let wood = bamboo();
        // Faces y = c and x = c (both run along the strips), through and near the cells' edges.
        let point = |face: u8, c: f32, u: f32, v: f32| match face {
            0 => Vec3::new(u, c, v),
            _ => Vec3::new(c, u, v),
        };
        for (face, plane) in [(0u8, 2.03f32), (0, 1.64), (0, 0.41), (1, 1.64), (1, 3.3)] {
            let (w, h) = (400usize, 800usize);
            let dark: Vec<bool> = (0..w * h)
                .map(|i| {
                    let q = point(face, plane, (i % w) as f32 * 0.05, (i / w) as f32 * 0.05);
                    wood.bamboo(q).0 < 0.97 && wood.bamboo(q).1 < 0.5 * NODE_HEIGHT_MM
                })
                .collect();
            let mut seen = vec![false; w * h];
            let mut flecks = Vec::new();
            for start in 0..w * h {
                if !dark[start] || seen[start] {
                    continue;
                }
                let (mut stack, mut lo, mut hi) = (vec![start], (w, h), (0usize, 0usize));
                seen[start] = true;
                while let Some(i) = stack.pop() {
                    let (x, y) = (i % w, i / w);
                    lo = (lo.0.min(x), lo.1.min(y));
                    hi = (hi.0.max(x), hi.1.max(y));
                    for (dx, dy) in [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)] {
                        let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                        if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                            let j = ny as usize * w + nx as usize;
                            if dark[j] && !seen[j] {
                                seen[j] = true;
                                stack.push(j);
                            }
                        }
                    }
                }
                flecks.push((hi.0 - lo.0 + 1, hi.1 - lo.1 + 1));
            }
            let per_cm2 = flecks.len() as f32 / 8.0;
            assert!(
                (11.0..=19.0).contains(&per_cm2),
                "{plane}: {per_cm2} per cm²"
            );
            let long = flecks.iter().filter(|&&(a, b)| b > 3 * a).count();
            assert!(
                long * 10 > flecks.len() * 7,
                "{long} of {} along the strip",
                flecks.len()
            );
            // And they darken by about 10 % at their middle.
            // And they darken by 10 % at their middle (off the nodes).
            let darkest = (0..w * h)
                .map(|i| {
                    wood.bamboo(point(
                        face,
                        plane,
                        (i % w) as f32 * 0.05,
                        (i / w) as f32 * 0.05,
                    ))
                })
                .filter(|&(_, node)| node < 0.5 * NODE_HEIGHT_MM)
                .fold(1.0f32, |a, (f, _)| a.min(f));
            assert!((darkest - 0.9).abs() < 0.01, "{darkest}");
        }
    }

    #[test]
    fn inside_a_knot_its_end_grain_is_darker_dished_and_rougher() {
        use super::super::knots::{KnotSpec, CRACK_FROM_MM};
        // One colour, no noise: the knot's own marks are all that changes.
        let wood = Wood {
            dark: oak().light,
            contrast: 0.0,
            color_noise: 0.0,
            fibre: 0.0,
            pore_mm: 0.0,
            ..oak()
        };
        let base = wood.at(Vec3::new(70.0, 160.0, 0.0)).color.luminance();
        for (d, darkness) in [(16.0f32, 1.0f32), (24.0, 0.5)] {
            let spec = KnotSpec {
                count: 1,
                diameter_mm: d,
                variation: 0.0,
                darkness,
                seed: 3,
            };
            let knots = Knots::place(
                &spec,
                Vec3::new(70.0, 160.0, 0.0),
                Vec3::new(60.0, 10.0, 200.0),
                |_, _, _| true,
            );
            let k = knots.list[0];
            let at = |a: f32, b: f32| {
                let mid = k.origin + k.axis * k.middle;
                wood.sample(mid + k.across * a + k.flow * b, &knots)
            };
            // Off the crack, between the centre and the bark pocket: 35 % darker at darkness 1.
            let (sin, cos) = crate::fmath::sin_cos(k.crack.unwrap_or(0.0) + 1.5);
            let r = k.radius;
            let s = at(0.5 * r * cos, 0.5 * r * sin);
            assert!(
                (s.color.luminance() / base - (1.0 - 0.35 * darkness)).abs() < 0.01,
                "{d}"
            );
            assert_eq!(s.rough_add, 0.1);
            assert!((s.height + DISH_MM * 0.75).abs() < 1.0e-4, "{}", s.height);
            // The bark pocket: half as light again.
            let pocket = at((r - 0.2) * cos, (r - 0.2) * sin);
            assert!((pocket.color.luminance() / s.color.luminance() - 0.5).abs() < 0.01);
            // The crack, on the knots that have one.
            assert_eq!(k.crack.is_some(), d >= CRACK_FROM_MM);
            if let Some(angle) = k.crack {
                let (sin, cos) = crate::fmath::sin_cos(angle);
                let c = at(0.5 * r * cos, 0.5 * r * sin);
                assert!((c.color.luminance() / s.color.luminance() - 0.8).abs() < 0.01);
                // Only on its side of the centre.
                let other = at(-0.5 * r * cos, -0.5 * r * sin);
                assert!((other.color.luminance() / s.color.luminance() - 1.0).abs() < 0.01);
            }
            // Outside, no roughness added, no dish.
            let out = at(1.5 * r, 0.0);
            assert_eq!((out.rough_add, out.height), (0.0, 0.0));
        }
    }

    #[test]
    fn fibres_vary_the_colour_by_about_five_percent() {
        let wood = Wood {
            ring_noise: 0.0,
            ring_variation: 0.0,
            axial_noise: 0.0,
            color_noise: 0.0,
            pore_mm: 0.0,
            figure: Figure::Speckle,
            ..oak()
        };
        let plain = Wood { fibre: 0.0, ..wood };
        let (mut dev, mut n) = (0.0f32, 0);
        for i in 0..20_000 {
            let q = Vec3::new((i % 200) as f32 * 0.05, 20.0, (i / 200) as f32 * 0.7);
            let (a, b) = (wood.at(q).color.luminance(), plain.at(q).color.luminance());
            dev += (a / b - 1.0).abs();
            n += 1;
        }
        let mean = dev / n as f32;
        assert!(mean > 0.015 && mean < 0.06, "{mean}");
    }
}

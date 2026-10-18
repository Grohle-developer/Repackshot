//! The front glass (phase S3): a pane in front of the camera, at the distance of the lens's front
//! element, that rain and dust fall on (`GLAS`, [`GlassParams`]).
//!
//! **The pane** is an ideal thin sheet across the view axis, `distance` in front of the camera's
//! position (its lens's centre, the entrance pupil of a traced lens). It neither bends nor dims a
//! ray (a coated cover glass): with no drop and no dust on it, every camera ray goes on as it came,
//! bit for bit, and the image is the image without the glass. What lies on it does the work, as
//! real geometry the camera rays cross before they reach the scene ([`FrontGlass::cross`]):
//!
//! * **Drops** are spherical caps of water on the pane's outer face (the side of the scene): the
//!   ball of radius `R = a / sin θ` whose centre lies `R cos θ` behind the pane, cut by it, for a
//!   contact circle of radius `a` and the contact angle `θ` of water on the glass. A ray enters a
//!   drop through its flat base (refracted from air into water, the thin glass between changing
//!   nothing of the direction) or through its dome, and leaves through the dome (Snell's law, the
//!   exact Fresnel transmittance of the interface as the ray's weight) or, by total internal
//!   reflection, bounces inside first; one that leaves back through the base heads for the camera
//!   and brings nothing, as one that bounces more than [`MAX_BOUNCES`] times. A drop is a strong
//!   lens a few centimetres in front of the sensor: through a lens focused far away it is a large
//!   soft disc with the scene inside it upside down, and its rim, where the light reaches the
//!   camera by total internal reflection or not at all, is dark: what a drop on a real lens looks
//!   like. The light a drop reflects (a few per cent at each face) is not followed: it would mostly
//!   go back into the lens, and the weight leaves it out.
//! * **Dust** is motes on the pane: discs lying on its outer face that let `1 − opacity` of a ray
//!   through. Out of focus as everything on the pane, they are soft dark spots.
//!
//! **Where they are.** The pane is cut into square cells of four mean drop diameters (and, for the
//! dust, of its own size) in its own coordinates (millimetres to the camera's right and up), and
//! each cell draws its drops from counter hashes of (seed, cell, index): the number from the
//! coverage asked for (`coverage × cell area / mean area`, the fraction by a Bernoulli draw), the
//! positions uniform in the cell, the sizes within `± size_var` of the mean. Only the cells the
//! camera's rays can cross are drawn ([`FrontGlass::half_extent`]: the view's half angle along the
//! longer side, at least 45°, times the distance, plus the aperture's radius and the lens shift),
//! so changing the focal length or the image size neither moves a drop nor reshuffles them, and a
//! viewport's image shows the drops of the render's frame. Drops that touch
//! **merge** ([`merge_drops`]): the two become one with their volumes summed (a cap's volume at a
//! fixed contact angle is `a³` times a constant, so the new contact radius is `∛(a₁³ + a₂³)`) at
//! their centre of mass, until no two touch. Everything is `+ − × ÷ sqrt` and [`crate::fmath`]:
//! the same drops on every platform.
//!
//! **A pane given drop by drop** (S3b). A `GLAS` payload longer than [`GLAS_BYTES`] whose word 48 is
//! [`GLAS_LAYOUT_VERSION`] carries its drops and motes one by one ([`GlassLayout`]): what the
//! simulation of rain and dust on the pane left there (`rt_phys::wet`, the page's physics worker),
//! instead of the scattered ones. They are taken as they come (neither scattered nor merged again:
//! the simulation merged them), with the pane's contact angle, index and dust opacity; the coverage
//! fields are then 0, so an engine of before S3b, which stops reading at byte 48, draws a clean pane.
//!
//! **What sees it.** The image's camera rays (and the albedo and alpha of their samples), through
//! a standard or an orthographic camera; not the exact passes (their rays go through the centre of
//! each pixel and the lens, to the scene), not the focus picks, and not a panoramic camera, which
//! has no front element.

use crate::bsdf::fresnel_dielectric;
use crate::fmath;
use crate::math::{Ray, Vec3};
use crate::optics::traced::refract;
use crate::rng::mix64;
use crate::scene::Camera;

/// Bytes of a `GLAS` payload.
pub const GLAS_BYTES: usize = 48;
/// S3b: word 48 of a `GLAS` payload that carries its drops and motes one by one ([`GlassLayout`]).
/// Any other value there (a newer writer's field) is not a layout.
pub const GLAS_LAYOUT_VERSION: u32 = 1;
/// The distance from the camera's position of a pane in front of a simple lens with distance 0
/// (automatic), mm: where a front element sits (S3; a proposal for the lead's verdict, rule 11).
pub const SIMPLE_LENS_GAP_MM: f32 = 25.0;
/// How far in front of a traced lens's front vertex the pane sits with distance 0 (automatic), and
/// at the least with any other, mm (a proposal, rule 11).
pub const TRACED_LENS_GAP_MM: f32 = 5.0;
/// The most drops a pane holds (the outer ones are left out past it).
pub const MAX_DROPS: usize = 20_000;
/// The most motes of dust.
pub const MAX_MOTES: usize = 50_000;
/// Total internal reflections followed inside a drop before the ray is given up.
pub const MAX_BOUNCES: u32 = 8;
/// Drops a ray may cross one after the other.
const MAX_DROPS_CROSSED: u32 = 4;
/// Most cells of the lookup grids per side.
const MAX_GRID: i32 = 512;
// Salts of the counter hashes (fixed forever).
const SALT_DROPS: u64 = 0x6a55_0000_0000_0001;
const SALT_MOTES: u64 = 0x6a55_0000_0000_0002;

/// The parameters of the front glass, the payload of the RSB `GLAS` section.
///
/// ```text
/// off  type  field              meaning
///   0  u32   flags              0 (unknown bits are kept and ignored)
///   4  f32   distance_mm        from the camera's position along the view axis; 0: automatic
///                               (SIMPLE_LENS_GAP_MM, or TRACED_LENS_GAP_MM past a traced lens's
///                               front vertex, which is also the least)
///   8  u32   seed
///  12  f32   drop_coverage      share of the pane the drops cover before they merge, 0..0.9
///  16  f32   drop_size_mm       mean diameter of a drop's contact circle, 0..50
///  20  f32   drop_size_var      relative variation, 0..1
///  24  f32   contact_angle_deg  of water on the glass, 5..175
///  28  f32   ior                of the drops, 1..3
///  32  f32   dust_coverage      share of the pane the motes cover, 0..0.5
///  36  f32   dust_size_mm       mean diameter of a mote, 0..10
///  40  f32   dust_size_var      relative variation, 0..1
///  44  f32   dust_opacity       what a mote stops of a ray, 0..1
/// ```
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlassParams {
    /// Flag bits (none defined; kept).
    pub flags: u32,
    /// Distance of the pane from the camera's position, mm (0: automatic).
    pub distance_mm: f32,
    /// Seed of every random choice.
    pub seed: u32,
    /// Share of the pane covered by drops before they merge.
    pub drop_coverage: f32,
    /// Mean diameter of a drop's contact circle, mm.
    pub drop_size_mm: f32,
    /// Its relative variation.
    pub drop_size_var: f32,
    /// Contact angle of the drops on the glass, degrees.
    pub contact_angle_deg: f32,
    /// Index of refraction of the drops.
    pub ior: f32,
    /// Share of the pane covered by motes of dust.
    pub dust_coverage: f32,
    /// Mean diameter of a mote, mm.
    pub dust_size_mm: f32,
    /// Its relative variation.
    pub dust_size_var: f32,
    /// What a mote stops of a ray, 0..1.
    pub dust_opacity: f32,
}

impl Default for GlassParams {
    /// A clean pane at the automatic distance; the drops and the dust it would have are the
    /// interface's proposals (S3, rule 11).
    fn default() -> GlassParams {
        GlassParams {
            flags: 0,
            distance_mm: 0.0,
            seed: 1,
            drop_coverage: 0.0,
            drop_size_mm: 2.0,
            drop_size_var: 0.6,
            contact_angle_deg: 60.0,
            ior: 1.333,
            dust_coverage: 0.0,
            dust_size_mm: 0.3,
            dust_size_var: 0.6,
            dust_opacity: 1.0,
        }
    }
}

impl GlassParams {
    /// Reads a `GLAS` payload; a longer one (a newer writer's) is read as far as this version
    /// knows it. Fails on a short payload, a non-finite number or a value out of its range.
    pub fn decode(payload: &[u8]) -> Result<GlassParams, &'static str> {
        if payload.len() < GLAS_BYTES {
            return Err("GLAS: payload shorter than 48 bytes");
        }
        let word = |i: usize| {
            u32::from_le_bytes([
                payload[4 * i],
                payload[4 * i + 1],
                payload[4 * i + 2],
                payload[4 * i + 3],
            ])
        };
        let float = |i: usize| f32::from_bits(word(i));
        let p = GlassParams {
            flags: word(0),
            distance_mm: float(1),
            seed: word(2),
            drop_coverage: float(3),
            drop_size_mm: float(4),
            drop_size_var: float(5),
            contact_angle_deg: float(6),
            ior: float(7),
            dust_coverage: float(8),
            dust_size_mm: float(9),
            dust_size_var: float(10),
            dust_opacity: float(11),
        };
        let floats = [
            p.distance_mm,
            p.drop_coverage,
            p.drop_size_mm,
            p.drop_size_var,
            p.contact_angle_deg,
            p.ior,
            p.dust_coverage,
            p.dust_size_mm,
            p.dust_size_var,
            p.dust_opacity,
        ];
        if floats.iter().any(|v| !v.is_finite()) {
            return Err("GLAS: non-finite number");
        }
        let within = |v: f32, lo: f32, hi: f32| (lo..=hi).contains(&v);
        if !within(p.distance_mm, 0.0, 10_000.0)
            || !within(p.drop_coverage, 0.0, 0.9)
            || !within(p.drop_size_mm, 0.0, 50.0)
            || !within(p.drop_size_var, 0.0, 1.0)
            || !within(p.contact_angle_deg, 5.0, 175.0)
            || !within(p.ior, 1.0, 3.0)
            || !within(p.dust_coverage, 0.0, 0.5)
            || !within(p.dust_size_mm, 0.0, 10.0)
            || !within(p.dust_size_var, 0.0, 1.0)
            || !within(p.dust_opacity, 0.0, 1.0)
        {
            return Err("GLAS: a value out of its range");
        }
        Ok(p)
    }

    /// The `GLAS` payload of these parameters ([`GLAS_BYTES`] bytes).
    pub fn encode(&self) -> Vec<u8> {
        let words = [
            self.flags,
            self.distance_mm.to_bits(),
            self.seed,
            self.drop_coverage.to_bits(),
            self.drop_size_mm.to_bits(),
            self.drop_size_var.to_bits(),
            self.contact_angle_deg.to_bits(),
            self.ior.to_bits(),
            self.dust_coverage.to_bits(),
            self.dust_size_mm.to_bits(),
            self.dust_size_var.to_bits(),
            self.dust_opacity.to_bits(),
        ];
        words.iter().flat_map(|w| w.to_le_bytes()).collect()
    }

    /// True when the pane has drops to draw.
    pub fn has_drops(&self) -> bool {
        self.drop_coverage > 0.0 && self.drop_size_mm > 0.0
    }

    /// True when the pane has dust to draw.
    pub fn has_dust(&self) -> bool {
        self.dust_coverage > 0.0 && self.dust_size_mm > 0.0 && self.dust_opacity > 0.0
    }
}

/// A drop on the pane: its contact circle's centre (mm, to the camera's right and up) and radius.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlassDrop {
    /// Centre, to the right.
    pub x: f32,
    /// Centre, up.
    pub y: f32,
    /// Radius of the contact circle, mm.
    pub a: f32,
}

/// A mote of dust on the pane: its centre and radius, mm.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlassMote {
    /// Centre, to the right.
    pub x: f32,
    /// Centre, up.
    pub y: f32,
    /// Radius, mm.
    pub r: f32,
}

/// S3b: the drops and motes of a pane listed one by one (a simulated pane), the tail of a `GLAS`
/// payload from byte 48:
///
/// ```text
/// u32 layout (GLAS_LAYOUT_VERSION); u32 drop_count mote_count;
/// f32 (x y a)[drop_count]   contact circle: centre to the camera's right and up, radius, mm
/// f32 (x y r)[mote_count]   mote: centre, radius, mm
/// ```
///
/// Every number finite, a centre within 10 m of the axis, a drop's radius in `(0, 50]` and a mote's
/// in `(0, 10]`, at most [`MAX_DROPS`] drops and [`MAX_MOTES`] motes.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GlassLayout {
    /// The drops, as they are (not merged again).
    pub drops: Vec<GlassDrop>,
    /// The motes.
    pub motes: Vec<GlassMote>,
}

impl GlassLayout {
    /// The layout a `GLAS` payload carries after its [`GLAS_BYTES`]: `None` when it has none (48
    /// bytes, or a word 48 that is not [`GLAS_LAYOUT_VERSION`]). Fails on a truncated list, a count
    /// past the limits or a value out of its range.
    pub fn decode(payload: &[u8]) -> Result<Option<GlassLayout>, &'static str> {
        let tail = payload.get(GLAS_BYTES..).unwrap_or(&[]);
        let word = |i: usize| -> Option<u32> {
            tail.get(4 * i..4 * i + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        };
        if word(0) != Some(GLAS_LAYOUT_VERSION) {
            return Ok(None);
        }
        let (Some(drops), Some(motes)) = (word(1), word(2)) else {
            return Err("GLAS: layout without its counts");
        };
        let (drops, motes) = (drops as usize, motes as usize);
        if drops > MAX_DROPS || motes > MAX_MOTES {
            return Err("GLAS: more drops or motes than the pane holds");
        }
        if tail.len() < 4 * (3 + 3 * (drops + motes)) {
            return Err("GLAS: layout shorter than its counts");
        }
        let float = |i: usize| f32::from_bits(word(i).unwrap_or(0));
        let near = |v: f32| v.is_finite() && v.abs() <= 10_000.0;
        let mut out = GlassLayout {
            drops: Vec::with_capacity(drops),
            motes: Vec::with_capacity(motes),
        };
        for k in 0..drops {
            let at = 3 + 3 * k;
            let d = GlassDrop {
                x: float(at),
                y: float(at + 1),
                a: float(at + 2),
            };
            if !near(d.x) || !near(d.y) || !(d.a > 0.0 && d.a <= 50.0) {
                return Err("GLAS: a drop out of its range");
            }
            out.drops.push(d);
        }
        for k in 0..motes {
            let at = 3 + 3 * (drops + k);
            let m = GlassMote {
                x: float(at),
                y: float(at + 1),
                r: float(at + 2),
            };
            if !near(m.x) || !near(m.y) || !(m.r > 0.0 && m.r <= 10.0) {
                return Err("GLAS: a mote out of its range");
            }
            out.motes.push(m);
        }
        Ok(Some(out))
    }

    /// The tail of the `GLAS` payload that carries this layout (to append after the 48 bytes).
    pub fn encode(&self) -> Vec<u8> {
        let mut words = Vec::with_capacity(3 + 3 * (self.drops.len() + self.motes.len()));
        words.push(GLAS_LAYOUT_VERSION);
        words.push(self.drops.len() as u32);
        words.push(self.motes.len() as u32);
        for d in &self.drops {
            words.extend_from_slice(&[d.x.to_bits(), d.y.to_bits(), d.a.to_bits()]);
        }
        for m in &self.motes {
            words.extend_from_slice(&[m.x.to_bits(), m.y.to_bits(), m.r.to_bits()]);
        }
        words.iter().flat_map(|w| w.to_le_bytes()).collect()
    }
}

/// A spherical cap's volume over the cube of its contact radius, at contact angle `θ` given by its
/// sine and cosine: `π (2 − 3 cos θ + cos³ θ) / (3 sin³ θ)`.
pub fn cap_volume_factor(sin_t: f32, cos_t: f32) -> f32 {
    fmath::PI * (2.0 - 3.0 * cos_t + cos_t * cos_t * cos_t) / (3.0 * sin_t * sin_t * sin_t)
}

/// The volume of a drop of contact radius `a` at contact angle `θ` (its sine and cosine), mm³.
pub fn cap_volume(a: f32, sin_t: f32, cos_t: f32) -> f32 {
    cap_volume_factor(sin_t, cos_t) * a * a * a
}

/// The cube root of `v >= 0` with `fmath` (the same bits everywhere).
fn cbrt(v: f32) -> f32 {
    if v <= 0.0 {
        0.0
    } else {
        fmath::powf(v, 1.0 / 3.0)
    }
}

/// A uniform number in `[0, 1)` from the top 24 bits of a hash.
#[inline]
fn unit(h: u64) -> f32 {
    (h >> 40) as f32 * (1.0 / 16_777_216.0)
}

/// Merges every pair of drops whose contact circles overlap into one drop of their summed volume at
/// their centre of mass, until no two overlap. The order is fixed (by index, the survivor the lower
/// one), so the result is the same everywhere. The volume of a cap at a fixed contact angle is `a³`
/// times a constant: the merged drop's `a` is `∛(a₁³ + a₂³)`.
pub fn merge_drops(drops: &mut Vec<GlassDrop>) {
    loop {
        let largest = drops.iter().fold(0.0f32, |m, d| m.max(d.a));
        if drops.len() < 2 || largest <= 0.0 {
            return;
        }
        let grid = Grid::of(drops.iter().map(|d| (d.x, d.y, d.a)), 2.0 * largest);
        let mut alive = vec![true; drops.len()];
        let mut merged = false;
        let mut near = Vec::new();
        for i in 0..drops.len() {
            if !alive[i] {
                continue;
            }
            // The cells around where drop `i` was when the grid was built.
            grid.around(drops[i].x, drops[i].y, drops[i].a + largest, &mut near);
            for &j in near.iter() {
                let j = j as usize;
                if j <= i || !alive[j] {
                    continue;
                }
                let (p, q) = (drops[i], drops[j]);
                let (dx, dy) = (q.x - p.x, q.y - p.y);
                let reach = p.a + q.a;
                if dx * dx + dy * dy < reach * reach {
                    let (vp, vq) = (p.a * p.a * p.a, q.a * q.a * q.a);
                    let v = vp + vq;
                    drops[i] = GlassDrop {
                        x: (p.x * vp + q.x * vq) / v,
                        y: (p.y * vp + q.y * vq) / v,
                        a: cbrt(v),
                    };
                    alive[j] = false;
                    merged = true;
                }
            }
        }
        if !merged {
            return;
        }
        let mut k = 0;
        drops.retain(|_| {
            let keep = alive[k];
            k += 1;
            keep
        });
    }
}

/// A uniform grid of square cells over the pane: per cell, the indices of the discs whose box
/// overlaps it.
#[derive(Clone, Debug, PartialEq)]
struct Grid {
    cell: f32,
    x0: f32,
    y0: f32,
    cols: i32,
    rows: i32,
    starts: Vec<u32>,
    items: Vec<u32>,
}

impl Grid {
    /// The grid of the discs `(x, y, reach)` with cells of about `cell` (more when it would hold
    /// more than [`MAX_GRID`] per side).
    fn of(discs: impl Iterator<Item = (f32, f32, f32)> + Clone, cell: f32) -> Grid {
        let (mut lo, mut hi) = ((f32::MAX, f32::MAX), (f32::MIN, f32::MIN));
        for (x, y, r) in discs.clone() {
            lo = (lo.0.min(x - r), lo.1.min(y - r));
            hi = (hi.0.max(x + r), hi.1.max(y + r));
        }
        if lo.0 > hi.0 {
            return Grid {
                cell: 1.0,
                x0: 0.0,
                y0: 0.0,
                cols: 1,
                rows: 1,
                starts: vec![0, 0],
                items: Vec::new(),
            };
        }
        let span = (hi.0 - lo.0).max(hi.1 - lo.1).max(1.0e-3);
        let cell = cell.max(span / MAX_GRID as f32).max(1.0e-4);
        let cols = (((hi.0 - lo.0) / cell).floor() as i32 + 1).clamp(1, MAX_GRID + 1);
        let rows = (((hi.1 - lo.1) / cell).floor() as i32 + 1).clamp(1, MAX_GRID + 1);
        let mut grid = Grid {
            cell,
            x0: lo.0,
            y0: lo.1,
            cols,
            rows,
            starts: Vec::new(),
            items: Vec::new(),
        };
        let n = (cols * rows) as usize;
        let mut counts = vec![0u32; n + 1];
        let mut each: Vec<(u32, u32)> = Vec::new();
        for (k, (x, y, r)) in discs.enumerate() {
            let (c0, r0) = grid.cell_of(x - r, y - r);
            let (c1, r1) = grid.cell_of(x + r, y + r);
            for row in r0..=r1 {
                for col in c0..=c1 {
                    let c = (row * cols + col) as u32;
                    counts[c as usize + 1] += 1;
                    each.push((c, k as u32));
                }
            }
        }
        for i in 0..n {
            counts[i + 1] += counts[i];
        }
        let mut next = counts.clone();
        let mut items = vec![0u32; each.len()];
        for &(c, k) in &each {
            items[next[c as usize] as usize] = k;
            next[c as usize] += 1;
        }
        grid.starts = counts;
        grid.items = items;
        grid
    }

    #[inline]
    fn cell_of(&self, x: f32, y: f32) -> (i32, i32) {
        let col = ((x - self.x0) / self.cell).floor();
        let row = ((y - self.y0) / self.cell).floor();
        let clamp = |v: f32, n: i32| {
            if v.is_nan() {
                0
            } else {
                v.clamp(0.0, (n - 1) as f32) as i32
            }
        };
        (clamp(col, self.cols), clamp(row, self.rows))
    }

    /// The discs whose cells meet the square of half size `reach` around `(x, y)`, in cell order
    /// (an index may come more than once), into `out`.
    fn around(&self, x: f32, y: f32, reach: f32, out: &mut Vec<u32>) {
        self.rect(x - reach, y - reach, x + reach, y + reach, out);
    }

    /// The discs whose cells meet the rectangle `[x0, x1] × [y0, y1]`, into `out`.
    fn rect(&self, x0: f32, y0: f32, x1: f32, y1: f32, out: &mut Vec<u32>) {
        out.clear();
        if self.items.is_empty()
            || x1 < self.x0
            || y1 < self.y0
            || x0 > self.x0 + self.cell * self.cols as f32
            || y0 > self.y0 + self.cell * self.rows as f32
        {
            return;
        }
        let (c0, r0) = self.cell_of(x0, y0);
        let (c1, r1) = self.cell_of(x1, y1);
        for row in r0..=r1 {
            for col in c0..=c1 {
                let c = (row * self.cols + col) as usize;
                let (a, b) = (self.starts[c] as usize, self.starts[c + 1] as usize);
                out.extend_from_slice(&self.items[a..b]);
            }
        }
    }
}

/// What the pane did to a camera ray ([`FrontGlass::cross`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Crossed {
    /// Nothing on the pane is in its way: it goes on unchanged.
    Unchanged,
    /// A mote stopped it, or it went back towards the camera: it brings nothing.
    Blocked,
    /// It went through drops or past motes: the ray it goes on as (from the pane) and the share of
    /// its light that reaches the camera.
    Through {
        /// The ray beyond the pane.
        ray: Ray,
        /// Its weight, 0..1.
        weight: f32,
        /// True when a drop bent it (its screen position is no longer its own).
        bent: bool,
    },
}

/// The front glass prepared for a camera: its drops and motes, and the grids that find them.
#[derive(Clone, Debug, PartialEq)]
pub struct FrontGlass {
    params: GlassParams,
    /// S3b: the drops and motes given one by one, when they were (then neither scattered nor merged).
    layout: Option<GlassLayout>,
    /// Distance of the pane from the camera's position, mm (the automatic one resolved).
    distance: f32,
    /// Half the side of the square of the pane that camera rays can cross, mm.
    half_extent: f32,
    drops: Vec<GlassDrop>,
    motes: Vec<GlassMote>,
    drop_grid: Grid,
    mote_grid: Grid,
    /// Sine and cosine of the contact angle.
    sin_t: f32,
    cos_t: f32,
    /// The highest a drop rises above the pane, mm.
    top: f32,
    /// The widest a drop reaches from its centre across the pane, over its contact radius.
    reach: f32,
}

impl FrontGlass {
    /// The front glass of `params` in front of `camera` (prepared: its traced lens, if any, knows
    /// where its front vertex is): the pane's distance, the square its rays can cross, the drops
    /// (merged) and the motes there.
    pub fn new(params: GlassParams, camera: &Camera) -> FrontGlass {
        FrontGlass::laid_out(params, None, camera)
    }

    /// The front glass of `params` in front of `camera` with the drops and motes of `layout` as they
    /// are (S3b: a simulated pane), or scattered and merged as [`FrontGlass::new`] does without one.
    pub fn laid_out(
        params: GlassParams,
        layout: Option<GlassLayout>,
        camera: &Camera,
    ) -> FrontGlass {
        let front = camera
            .lens
            .as_ref()
            .and_then(|l| l.traced())
            .filter(|_| camera.through_lens())
            .map(|t| t.pupil_z().max(0.0) + TRACED_LENS_GAP_MM);
        let distance = match (params.distance_mm > 0.0, front) {
            (true, Some(least)) => params.distance_mm.max(least),
            (true, None) => params.distance_mm,
            (false, Some(least)) => least,
            (false, None) => SIMPLE_LENS_GAP_MM,
        };
        let half_extent = Self::half_extent_of(camera, distance);
        let theta = params.contact_angle_deg.clamp(5.0, 175.0) * fmath::DEG_TO_RAD;
        let (sin_t, cos_t) = fmath::sin_cos(theta);
        let mut drops = if let Some(l) = &layout {
            l.drops.clone()
        } else if params.has_drops() {
            scatter(
                params.seed,
                SALT_DROPS,
                half_extent,
                params.drop_coverage,
                params.drop_size_mm,
                params.drop_size_var,
                MAX_DROPS,
            )
            .into_iter()
            .map(|(x, y, a)| GlassDrop { x, y, a })
            .collect()
        } else {
            Vec::new()
        };
        if layout.is_none() {
            merge_drops(&mut drops);
        }
        let motes: Vec<GlassMote> = if let Some(l) = &layout {
            l.motes.clone()
        } else if params.has_dust() {
            scatter(
                params.seed,
                SALT_MOTES,
                half_extent,
                params.dust_coverage,
                params.dust_size_mm,
                params.dust_size_var,
                MAX_MOTES,
            )
            .into_iter()
            .map(|(x, y, r)| GlassMote { x, y, r })
            .collect()
        } else {
            Vec::new()
        };
        // A cap wider than its contact circle (θ > 90°) reaches out to its ball's radius.
        let reach = if cos_t < 0.0 { 1.0 / sin_t } else { 1.0 };
        let largest = drops.iter().fold(0.0f32, |m, d| m.max(d.a));
        let top = largest * (1.0 - cos_t) / sin_t;
        let drop_grid = Grid::of(
            drops.iter().map(|d| (d.x, d.y, d.a * reach)),
            2.0 * largest * reach,
        );
        let mote_size = motes.iter().fold(0.0f32, |m, d| m.max(d.r));
        let mote_grid = Grid::of(motes.iter().map(|m| (m.x, m.y, m.r)), 4.0 * mote_size);
        FrontGlass {
            params,
            layout,
            distance,
            half_extent,
            drops,
            motes,
            drop_grid,
            mote_grid,
            sin_t,
            cos_t,
            top,
            reach,
        }
    }

    /// Tests: the pane of `params` in front of `camera` with exactly the drops `drops` (neither
    /// scattered nor merged) and no dust.
    #[cfg(test)]
    pub(crate) fn with_drops(
        params: GlassParams,
        camera: &Camera,
        drops: Vec<GlassDrop>,
    ) -> FrontGlass {
        let mut g = FrontGlass::new(
            GlassParams {
                drop_coverage: 0.0,
                dust_coverage: 0.0,
                ..params
            },
            camera,
        );
        let largest = drops.iter().fold(0.0f32, |m, d| m.max(d.a));
        g.top = largest * (1.0 - g.cos_t) / g.sin_t;
        g.drop_grid = Grid::of(
            drops.iter().map(|d| (d.x, d.y, d.a * g.reach)),
            2.0 * largest * g.reach,
        );
        g.drops = drops;
        g
    }

    /// Half the side of the square of a pane `distance` in front of `camera` that its rays can
    /// cross, mm: the view's half angle along the longer side (the sensor's, and at least 45°, so
    /// that a viewport's wider image and the render's frame lay out the same drops) times the
    /// distance, plus the aperture's radius and the lens shift's share, and a tenth more; for an
    /// orthographic camera half its width.
    pub fn half_extent_of(camera: &Camera, distance: f32) -> f32 {
        if camera.ortho {
            return 0.55 * camera.ortho_width.max(0.0);
        }
        let f = camera.focal_mm.max(1.0e-3);
        let (shift_x, shift_y) = camera.lens.as_ref().map_or((0.0, 0.0), |l| {
            (l.params().shift_x_mm, l.params().shift_y_mm)
        });
        let shift = shift_x.abs().max(shift_y.abs());
        let tan = ((0.5 * camera.sensor_mm + shift) / f).max(1.0);
        let aperture = if camera.fstop > 0.0 {
            0.5 * f / camera.fstop
        } else {
            0.0
        };
        1.1 * (distance * tan + aperture) + 1.0
    }

    /// The parameters.
    pub fn params(&self) -> &GlassParams {
        &self.params
    }

    /// S3b: the drops and motes it was given one by one, if it was.
    pub fn layout(&self) -> Option<&GlassLayout> {
        self.layout.as_ref()
    }

    /// The `GLAS` payload of this pane: its parameters and, when it has one, its layout.
    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = self.params.encode();
        if let Some(l) = &self.layout {
            bytes.extend_from_slice(&l.encode());
        }
        bytes
    }

    /// The pane's distance from the camera's position, mm.
    pub fn distance(&self) -> f32 {
        self.distance
    }

    /// Half the side of the square of the pane where its drops and motes are, mm.
    pub fn half_extent(&self) -> f32 {
        self.half_extent
    }

    /// The drops, merged.
    pub fn drops(&self) -> &[GlassDrop] {
        &self.drops
    }

    /// The motes.
    pub fn motes(&self) -> &[GlassMote] {
        &self.motes
    }

    /// True when nothing lies on the pane: every ray goes on unchanged.
    pub fn is_clear(&self) -> bool {
        self.drops.is_empty() && self.motes.is_empty()
    }

    /// The share of the square of the pane the drops cover (after merging; the drops whose centre
    /// lies in it).
    pub fn drop_cover(&self) -> f32 {
        let h = self.half_extent;
        let area: f32 = self
            .drops
            .iter()
            .filter(|d| d.x.abs() <= h && d.y.abs() <= h)
            .map(|d| fmath::PI * d.a * d.a)
            .sum();
        area / (4.0 * h * h)
    }

    /// The radius and the height of the centre of drop `d`'s ball (mm; negative: behind the pane).
    #[inline]
    fn ball(&self, d: &GlassDrop) -> (f32, f32) {
        let radius = d.a / self.sin_t;
        (radius, -radius * self.cos_t)
    }

    /// The camera ray `ray` of `camera` through the pane: unchanged when nothing is in its way,
    /// blocked, or the ray it goes on as beyond the drops it crossed, with its weight
    /// (see the [module](self) documentation).
    pub fn cross(&self, camera: &Camera, ray: &Ray) -> Crossed {
        if self.is_clear() || camera.panoramic() {
            return Crossed::Unchanged;
        }
        let (forward, right, up) = camera.basis();
        let centre = camera.position + forward * self.distance;
        let to_local = |v: Vec3| Vec3::new(v.dot(right), v.dot(up), v.dot(forward));
        let o = to_local(ray.origin - centre);
        let len = ray.dir.length();
        if len.is_nan() || len <= 0.0 {
            return Crossed::Unchanged;
        }
        let d = to_local(ray.dir) * (1.0 / len);
        if d.z.is_nan() || d.z <= 0.0 || o.z.is_nan() || o.z >= 0.0 {
            return Crossed::Unchanged;
        }
        // Where it crosses the pane.
        let t_pane = -o.z / d.z;
        let at_pane = Vec3::new(o.x + d.x * t_pane, o.y + d.y * t_pane, 0.0);
        let mut weight = 1.0f32;
        let mut near = Vec::new();
        if !self.motes.is_empty() {
            self.mote_grid.around(at_pane.x, at_pane.y, 0.0, &mut near);
            near.sort_unstable();
            near.dedup();
            for &k in &near {
                let m = self.motes[k as usize];
                let (dx, dy) = (at_pane.x - m.x, at_pane.y - m.y);
                if dx * dx + dy * dy <= m.r * m.r {
                    weight *= 1.0 - self.params.dust_opacity;
                }
            }
            if weight <= 0.0 {
                return Crossed::Blocked;
            }
        }
        let mut p = at_pane;
        let mut dir = d;
        let mut bent = false;
        let mut crossed = 0;
        while crossed < MAX_DROPS_CROSSED {
            let Some((index, t_in, base)) = self.next_drop(p, dir, &mut near) else {
                break;
            };
            crossed += 1;
            bent = true;
            let drop = self.drops[index as usize];
            let (radius, cz) = self.ball(&drop);
            let ball = Vec3::new(drop.x, drop.y, cz);
            let ior = self.params.ior;
            let entry = p + dir * t_in;
            // Into the water: through the base (the thin glass changes no direction) or the dome.
            let into = if base {
                refract(dir, Vec3::new(0.0, 0.0, -1.0), 1.0 / ior)
            } else {
                let n = (entry - ball) * (1.0 / radius);
                weight *= 1.0 - fresnel_dielectric(-dir.dot(n), ior);
                refract(dir, n, 1.0 / ior)
            };
            let Some(into) = into else {
                return Crossed::Blocked;
            };
            dir = into.normalize();
            p = entry;
            let mut out = None;
            for _ in 0..=MAX_BOUNCES {
                let far = sphere_far(p, dir, ball, radius);
                let to_base = if dir.z < 0.0 {
                    -p.z / dir.z
                } else {
                    f32::INFINITY
                };
                if to_base < far {
                    // Back at the base, towards the camera: total internal reflection at the
                    // glass's inner face, or it leaves for the camera's side and brings nothing.
                    let sin2 = 1.0 - dir.z * dir.z;
                    if ior * ior * sin2 <= 1.0 {
                        return Crossed::Blocked;
                    }
                    p = Vec3::new(p.x + dir.x * to_base, p.y + dir.y * to_base, 0.0);
                    dir = Vec3::new(dir.x, dir.y, -dir.z);
                    continue;
                }
                if !far.is_finite() {
                    return Crossed::Blocked;
                }
                let q = p + dir * far;
                let n = (q - ball) * (1.0 / radius);
                let cos_i = dir.dot(n).clamp(0.0, 1.0);
                match refract(dir, n, ior) {
                    Some(t) => {
                        weight *= 1.0 - fresnel_dielectric(cos_i, 1.0 / ior);
                        // A hair outside the dome.
                        out = Some((q + n * (1.0e-4 * radius.max(1.0e-2)), t.normalize()));
                        break;
                    }
                    None => {
                        dir = (dir - n * (2.0 * dir.dot(n))).normalize();
                        p = q;
                    }
                }
            }
            let Some((q, t)) = out else {
                return Crossed::Blocked;
            };
            p = q;
            dir = t;
        }
        if !bent {
            return if weight >= 1.0 {
                Crossed::Unchanged
            } else {
                Crossed::Through {
                    ray: *ray,
                    weight,
                    bent: false,
                }
            };
        }
        if dir.z <= 0.0 {
            // It turned back towards the pane and no drop took it: it heads for the camera.
            return Crossed::Blocked;
        }
        let origin = centre + right * p.x + up * p.y + forward * p.z;
        let out_dir = (right * dir.x + up * dir.y + forward * dir.z).normalize();
        Crossed::Through {
            ray: Ray::new(origin, out_dir),
            weight,
            bent: true,
        }
    }

    /// The nearest drop a ray from `p` (on or above the pane, outside every drop) along `dir` (unit)
    /// enters, how far along it, and whether through its base: `(index, t, base)`.
    fn next_drop(&self, p: Vec3, dir: Vec3, near: &mut Vec<u32>) -> Option<(u32, f32, bool)> {
        if self.drops.is_empty() {
            return None;
        }
        // The stretch of the ray inside the layer of the drops, `0 <= z <= top`, across the pane.
        let t_end = if dir.z > 0.0 {
            ((self.top - p.z) / dir.z).max(0.0)
        } else if dir.z < 0.0 {
            (-p.z / dir.z).max(0.0)
        } else {
            4.0 * self.half_extent
        };
        let t_end = t_end.min(4.0 * self.half_extent);
        let (x1, y1) = (p.x + dir.x * t_end, p.y + dir.y * t_end);
        self.drop_grid
            .rect(p.x.min(x1), p.y.min(y1), p.x.max(x1), p.y.max(y1), near);
        near.sort_unstable();
        near.dedup();
        // Where the ray is beyond the pane (z >= 0), the half space the drops are cut to.
        let (h0, h1) = if dir.z > 0.0 {
            (-p.z / dir.z, f32::INFINITY)
        } else if dir.z < 0.0 {
            (f32::NEG_INFINITY, -p.z / dir.z)
        } else if p.z >= 0.0 {
            (f32::NEG_INFINITY, f32::INFINITY)
        } else {
            return None;
        };
        let mut best: Option<(u32, f32, bool)> = None;
        for &k in near.iter() {
            let drop = &self.drops[k as usize];
            let (radius, cz) = self.ball(drop);
            let ball = Vec3::new(drop.x, drop.y, cz);
            let Some((t0, t1)) = sphere_both(p, dir, ball, radius) else {
                continue;
            };
            let entry = t0.max(h0);
            let exit = t1.min(h1);
            // A stretch inside, ahead: from the pane itself (its base) or from outside the drop
            // (its dome; a ray that left a drop starts a hair outside it).
            if entry.is_nan() || entry >= exit || exit <= 0.0 || entry < -1.0e-6 * radius.max(1.0) {
                continue;
            }
            let base = h0 >= t0;
            let entry = entry.max(0.0);
            if best.is_none_or(|(_, t, _)| entry < t) {
                best = Some((k, entry, base));
            }
        }
        best
    }
}

/// The two roots `t0 <= t1` of the ray `p + t dir` (unit `dir`) against the ball of centre `c` and
/// radius `r`, from the closest point of the ray to the centre (no cancellation for a small ball).
#[inline]
fn sphere_both(p: Vec3, dir: Vec3, c: Vec3, r: f32) -> Option<(f32, f32)> {
    let f = p - c;
    let b = f.dot(dir);
    let l = f - dir * b;
    let disc = r * r - l.dot(l);
    if disc.is_nan() || disc < 0.0 {
        return None;
    }
    let s = disc.sqrt();
    Some((-b - s, -b + s))
}

/// Where the ray `p + t dir` from inside the ball (centre `c`, radius `r`) leaves it.
#[inline]
fn sphere_far(p: Vec3, dir: Vec3, c: Vec3, r: f32) -> f32 {
    match sphere_both(p, dir, c, r) {
        Some((_, t1)) => t1.max(0.0),
        // Rounding put the point a hair outside: it leaves where it is.
        None => 0.0,
    }
}

/// Discs scattered over the square `[−half, half]²` of the pane: per cell of four mean diameters,
/// a number of them for `coverage` (the fraction by a Bernoulli draw), uniform in the cell, of
/// diameter `size × (1 ± var)`; `(x, y, radius)`, cells in rings from the centre (so that a pane
/// with more than `max` loses its outer ones), at most `max`.
fn scatter(
    seed: u32,
    salt: u64,
    half: f32,
    coverage: f32,
    size: f32,
    var: f32,
    max: usize,
) -> Vec<(f32, f32, f32)> {
    let mean_r = 0.5 * size;
    let var = var.clamp(0.0, 1.0);
    let positive = |v: f32| v > 0.0;
    if !positive(mean_r) || !positive(coverage) || !positive(half) {
        return Vec::new();
    }
    let cell = (4.0 * size).max(1.0e-3);
    // The mean area of a disc whose radius is uniform in mean_r (1 ± var).
    let mean_area = fmath::PI * mean_r * mean_r * (1.0 + var * var / 3.0);
    let lambda = coverage * cell * cell / mean_area;
    let n = ((half / cell).ceil() as i32).clamp(1, 4096);
    let mut cells: Vec<(i32, i32)> = Vec::with_capacity((4 * n * n) as usize);
    for iy in -n..n {
        for ix in -n..n {
            cells.push((ix, iy));
        }
    }
    // Rings from the centre: by the cell's distance (Chebyshev), then row, then column.
    cells.sort_by_key(|&(ix, iy)| {
        let ring = (2 * ix + 1).abs().max((2 * iy + 1).abs());
        (ring, iy, ix)
    });
    let mut out = Vec::new();
    let base = mix64((u64::from(seed) << 32) ^ salt);
    for (ix, iy) in cells {
        let key = (u64::from(ix as u32) << 32) | u64::from(iy as u32);
        let mut h = mix64(base ^ key.wrapping_mul(0x9E37_79B9_7F4A_7C15));
        let mut draw = || {
            h = mix64(h);
            unit(h)
        };
        let whole = lambda.floor();
        let count = whole as u32 + u32::from(draw() < lambda - whole);
        for _ in 0..count {
            if out.len() >= max {
                return out;
            }
            let x = (ix as f32 + draw()) * cell;
            let y = (iy as f32 + draw()) * cell;
            let s = (1.0 + var * (2.0 * draw() - 1.0)).max(0.05);
            // Inside the square, or near enough for the disc to reach into it.
            let reach = half + mean_r * (1.0 + var);
            if x.abs() <= reach && y.abs() <= reach {
                out.push((x, y, mean_r * s));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;

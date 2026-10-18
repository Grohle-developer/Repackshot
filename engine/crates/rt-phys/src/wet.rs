//! Rain and dust on a pane (phase S3b): what the ambient effects of a scene leave on the front
//! glass of a camera, simulated at the fixed step of the rigid bodies ([`STEP`]), deterministic,
//! `f32`, `+ − × ÷ sqrt` and `rt_core::fmath` only.
//!
//! **The pane** is the square `[−h, h]²` of the front glass ([`rt_core::optics::glass`]), in its own
//! millimetres: `x` to the camera's right, `y` up, the outer face (the one the scene sees) towards
//! `+n`. Gravity comes in those axes ([`WetSpec::gravity`]): its part along the pane makes drops
//! slide (with the camera's *up*: a camera rolled 90° sends them sideways in the picture), its part
//! along the normal says how steep the face is for the dust.
//!
//! **What arrives.** Each source ([`WetSource`]) is an effect of the scene as a number density of
//! particles and their mean velocity: the particles that cross the outer face per unit area and time
//! are `density × max(0, −v·n)` (none reach a face that looks away from their motion: a camera
//! looking down under vertical rain keeps a dry lens; wind blowing at it wets it). Each step draws
//! how many land from a Poisson law of that mean (by inversion, from counter hashes of the seed, the
//! step and the source), uniformly over the pane, each with the source's size `± size_var`.
//!
//! **Drops** ([`SourceKind::Drops`]). A landing particle of diameter `D` becomes a spherical cap of
//! its volume `π D³ / 6` at the mean of the material's advancing and receding contact angles
//! `θ̄ = (θ_A + θ_R) / 2` (the cap of [`rt_core::optics::glass::cap_volume`]: contact radius
//! `a = ∛(V / K(θ̄))`). Drops that touch **merge** with their volumes summed at their centre of mass
//! ([`rt_core::optics::glass::merge_drops`]). A drop stays **pinned** while the hysteresis of its
//! contact line holds it (Furmidge, "Studies at phase interfaces. I. The sliding of liquid drops on
//! solid surfaces and a theory for spray retention", J. Colloid Sci. 17 (1962)):
//!
//! ```text
//! ρ g V sin α  ≤  γ w (cos θ_R − cos θ_A),     w = 2a
//! ```
//!
//! so its critical contact radius on a face `α` from the horizontal is
//! `a_c = √(2 γ (cos θ_R − cos θ_A) / (ρ g K(θ̄) sin α))` ([`critical_radius`]). Past it the drop
//! **slides** down the pane's slope at the speed where the excess force meets the contact line's
//! viscous drag, `v = (ρ g V sin α − 2 γ a Δ) / (C μ a)` ([`SLIDE_DRAG`], at most
//! [`MAX_SLIDE_SPEED`]), leaving a **wet trail**: a film [`TRAIL_FILM_MM`] thick and as wide as the
//! drop, whose water it loses (so a drop that runs long enough shrinks and stops), and which carries
//! away the dust it crosses: every mote whose centre is within the drop's radius of its path. A drop
//! whose centre leaves the pane has run off it.
//!
//! **Dust** ([`SourceKind::Dust`]). A landing mote stays where the face is flat enough for it to
//! rest: always below the **angle of repose** less [`REPOSE_SPREAD_DEG`], never above it plus that,
//! with a smooth step between (by a hash of its own), and never on a face looking down.
//!
//! **What it gives.** [`WetPane::layout`] is the pane as the renderer takes it (the drops and the
//! motes still there, a [`GlassLayout`]); [`WetPane::frame`] is the same as the page's record of a
//! frame (the drops, the motes added and the motes carried away since the last frame);
//! [`WetPane::hash`] the check the native and WebAssembly builds are compared by.
//!
//! The constants of the liquid are water's at 20 °C; [`SLIDE_DRAG`], [`MAX_SLIDE_SPEED`],
//! [`TRAIL_FILM_MM`] and [`REPOSE_SPREAD_DEG`] are this phase's proposals (rule 11, ◆ in the
//! roadmap's S3b), like the wettability of each material family (the page's
//! `src/data/wettability.ts`).

use crate::world::{STEP, STEPS_PER_SECOND};
use rt_core::fmath;
use rt_core::optics::glass::{
    cap_volume_factor, merge_drops, GlassDrop, GlassLayout, GlassMote, MAX_DROPS, MAX_MOTES,
};
use rt_core::rng::mix64;

/// The magic number of a `WET1` spec.
pub const WET_MAGIC: &[u8; 4] = b"WET1";
/// The version this reader understands.
pub const WET_VERSION: u32 = 1;
/// Surface tension of water, N/mm (72 mN/m).
pub const SURFACE_TENSION: f32 = 7.2e-5;
/// Weight per volume of water, `ρ g`, N/mm³ (1000 kg/m³ × 9.81 m/s²).
pub const WATER_WEIGHT: f32 = 9.81e-6;
/// Viscosity of water, N·s/mm² (1 mPa·s).
pub const WATER_VISCOSITY: f32 = 1.0e-9;
/// The drag of a sliding drop's contact line over `μ a v` (◆ a proposal: about 40 mm/s for a drop
/// half again past its critical size on vertical glass).
pub const SLIDE_DRAG: f32 = 300.0;
/// The fastest a drop slides, mm/s (◆).
pub const MAX_SLIDE_SPEED: f32 = 250.0;
/// Thickness of the film a sliding drop leaves behind, mm (◆ 2 µm).
pub const TRAIL_FILM_MM: f32 = 0.002;
/// Half the width of the smooth step around the angle of repose, degrees (◆).
pub const REPOSE_SPREAD_DEG: f32 = 5.0;
/// Most particles one source lands in one step (a mean past it is drawn in parts of at most
/// [`POISSON_PART`] each, so the sum is still Poisson).
const MAX_LANDINGS: u32 = 4096;
/// Largest mean of one Poisson draw (`e^-λ` stays a normal `f32`).
const POISSON_PART: f32 = 32.0;
/// Side of the cells of the grid the motes are found in, mm (at least: a pane of more than
/// [`MOTE_GRID_MAX`] cells per side gets wider cells).
const MOTE_CELL_MM: f32 = 2.0;
const MOTE_GRID_MAX: i32 = 256;
// Salts of the counter hashes (fixed forever).
const SALT_COUNT: u64 = 0x3e70_0000_0000_0001;
const SALT_PLACE: u64 = 0x3e70_0000_0000_0002;
const SALT_KEEP: u64 = 0x3e70_0000_0000_0003;

/// What a source leaves on the pane.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceKind {
    /// Water: each particle a drop (rain, falling drops).
    Drops,
    /// Dust: each particle a mote (dust, pollen, ash).
    Dust,
}

impl SourceKind {
    /// The code in a `WET1` spec.
    pub fn to_u32(self) -> u32 {
        match self {
            SourceKind::Drops => 0,
            SourceKind::Dust => 1,
        }
    }

    /// The kind of a code, or `None`.
    pub fn from_u32(v: u32) -> Option<SourceKind> {
        match v {
            0 => Some(SourceKind::Drops),
            1 => Some(SourceKind::Dust),
            _ => None,
        }
    }
}

/// An effect of the scene as the pane sees it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WetSource {
    /// Drops or dust.
    pub kind: SourceKind,
    /// Particles per cubic millimetre.
    pub density: f32,
    /// Their mean velocity in the pane's axes (right, up, out of the outer face), mm/s.
    pub velocity: [f32; 3],
    /// Mean diameter, mm.
    pub size_mm: f32,
    /// Its relative variation, 0..1.
    pub size_var: f32,
}

/// Everything the simulation of a pane is given (the `WET1` bytes):
///
/// ```text
/// "WET1"  u32 version (1); u32 seed; f32 half_extent (mm); f32 gravity[3] (unit, pane axes);
/// f32 advancing_deg receding_deg repose_deg; u32 sources;
/// per source: u32 kind (0 drops, 1 dust); f32 density (per mm³); f32 velocity[3] (mm/s, pane axes);
///             f32 size_mm size_var
/// ```
#[derive(Clone, Debug, PartialEq)]
pub struct WetSpec {
    /// Seed of every random choice.
    pub seed: u32,
    /// Half the side of the pane's square, mm.
    pub half_extent: f32,
    /// The direction of gravity in the pane's axes (right, up, out); normalised when read.
    pub gravity: [f32; 3],
    /// Advancing contact angle of water on the pane, degrees.
    pub advancing_deg: f32,
    /// Receding contact angle, degrees (at most the advancing one).
    pub receding_deg: f32,
    /// Angle of repose of the dust, degrees from the horizontal.
    pub repose_deg: f32,
    /// What falls on it.
    pub sources: Vec<WetSource>,
}

/// Little-endian words of a spec being read.
struct Words<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Words<'_> {
    fn u32(&mut self) -> Result<u32, String> {
        let b = self
            .bytes
            .get(self.at..self.at + 4)
            .ok_or_else(|| "WET1: truncated".to_string())?;
        self.at += 4;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn f32(&mut self) -> Result<f32, String> {
        let v = f32::from_bits(self.u32()?);
        if v.is_finite() {
            Ok(v)
        } else {
            Err("WET1: a number that is not finite".to_string())
        }
    }
}

impl WetSpec {
    /// Reads `WET1` bytes. Fails on another magic or version, a truncated spec, a number that is not
    /// finite or out of its range, or an unknown kind of source.
    pub fn parse(bytes: &[u8]) -> Result<WetSpec, String> {
        if bytes.len() < 8 || &bytes[..4] != WET_MAGIC {
            return Err("WET1: not a wet pane spec".to_string());
        }
        let mut w = Words { bytes, at: 4 };
        let version = w.u32()?;
        if version != WET_VERSION {
            return Err(format!("WET1: version {version} is not {WET_VERSION}"));
        }
        let seed = w.u32()?;
        let half_extent = w.f32()?;
        let gravity = [w.f32()?, w.f32()?, w.f32()?];
        let (advancing_deg, receding_deg, repose_deg) = (w.f32()?, w.f32()?, w.f32()?);
        let count = w.u32()?;
        if !(half_extent > 0.0 && half_extent <= 10_000.0) {
            return Err("WET1: the pane's size is out of its range".to_string());
        }
        let g2 = gravity.iter().map(|v| v * v).sum::<f32>();
        if g2.is_nan() || g2 <= 0.0 {
            return Err("WET1: gravity has no direction".to_string());
        }
        let ok_angle = |v: f32| (0.0..=180.0).contains(&v);
        if !ok_angle(advancing_deg)
            || !ok_angle(receding_deg)
            || !(0.0..=90.0).contains(&repose_deg)
        {
            return Err("WET1: an angle out of its range".to_string());
        }
        if count > 64 {
            return Err("WET1: more than 64 sources".to_string());
        }
        let mut sources = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let kind = SourceKind::from_u32(w.u32()?)
                .ok_or_else(|| "WET1: an unknown kind of source".to_string())?;
            let source = WetSource {
                kind,
                density: w.f32()?,
                velocity: [w.f32()?, w.f32()?, w.f32()?],
                size_mm: w.f32()?,
                size_var: w.f32()?,
            };
            if source.density < 0.0
                || !(0.0..=50.0).contains(&source.size_mm)
                || !(0.0..=1.0).contains(&source.size_var)
                || source.velocity.iter().any(|v| v.abs() > 1.0e6)
            {
                return Err("WET1: a source out of its range".to_string());
            }
            sources.push(source);
        }
        let len = g2.sqrt();
        Ok(WetSpec {
            seed,
            half_extent,
            gravity: [gravity[0] / len, gravity[1] / len, gravity[2] / len],
            advancing_deg,
            receding_deg: receding_deg.min(advancing_deg),
            repose_deg,
            sources,
        })
    }

    /// The `WET1` bytes of this spec.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(48 + 28 * self.sources.len());
        out.extend_from_slice(WET_MAGIC);
        let mut word = |w: u32| out.extend_from_slice(&w.to_le_bytes());
        word(WET_VERSION);
        word(self.seed);
        word(self.half_extent.to_bits());
        for g in self.gravity {
            word(g.to_bits());
        }
        word(self.advancing_deg.to_bits());
        word(self.receding_deg.to_bits());
        word(self.repose_deg.to_bits());
        word(self.sources.len() as u32);
        for s in &self.sources {
            word(s.kind.to_u32());
            word(s.density.to_bits());
            for v in s.velocity {
                word(v.to_bits());
            }
            word(s.size_mm.to_bits());
            word(s.size_var.to_bits());
        }
        out
    }

    /// The contact angle of the drops' caps, degrees: the mean of the advancing and receding ones.
    pub fn cap_angle_deg(&self) -> f32 {
        0.5 * (self.advancing_deg + self.receding_deg)
    }
}

/// The critical contact radius of a drop (mm) on a face `sin α` steep, for contact angles
/// `θ_A ≥ θ_R` (degrees) and a cap at their mean: past it, its weight along the face beats the
/// hysteresis of its contact line (see the [module](self) documentation). Infinite on a level face.
pub fn critical_radius(advancing_deg: f32, receding_deg: f32, sin_alpha: f32) -> f32 {
    let (k, hysteresis) = cap_constants(advancing_deg, receding_deg);
    let s = sin_alpha.abs();
    if s <= 0.0 || hysteresis <= 0.0 {
        return if hysteresis <= 0.0 {
            0.0
        } else {
            f32::INFINITY
        };
    }
    (2.0 * SURFACE_TENSION * hysteresis / (WATER_WEIGHT * k * s)).sqrt()
}

/// `K(θ̄)` (a cap's volume over the cube of its contact radius) and `cos θ_R − cos θ_A`.
fn cap_constants(advancing_deg: f32, receding_deg: f32) -> (f32, f32) {
    let mean = (0.5 * (advancing_deg + receding_deg)).clamp(1.0, 179.0) * fmath::DEG_TO_RAD;
    let (s, c) = fmath::sin_cos(mean);
    let hysteresis = fmath::cos(receding_deg * fmath::DEG_TO_RAD)
        - fmath::cos(advancing_deg * fmath::DEG_TO_RAD);
    (cap_volume_factor(s, c), hysteresis.max(0.0))
}

/// The cube root of `v >= 0` with `fmath`.
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

/// A mote on the pane, alive or carried away.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Mote {
    x: f32,
    y: f32,
    r: f32,
    alive: bool,
}

/// The motes by cell of a uniform grid over the pane (indices into the motes, in the order they
/// landed).
#[derive(Clone, Debug)]
struct MoteGrid {
    cell: f32,
    half: f32,
    side: i32,
    cells: Vec<Vec<u32>>,
}

impl MoteGrid {
    fn new(half: f32) -> MoteGrid {
        let cell = MOTE_CELL_MM.max(2.0 * half / MOTE_GRID_MAX as f32);
        let side = ((2.0 * half / cell).ceil() as i32).clamp(1, MOTE_GRID_MAX);
        MoteGrid {
            cell,
            half,
            side,
            cells: vec![Vec::new(); (side * side) as usize],
        }
    }

    fn index(&self, v: f32) -> i32 {
        let i = ((v + self.half) / self.cell).floor();
        if i.is_nan() {
            0
        } else {
            i.clamp(0.0, (self.side - 1) as f32) as i32
        }
    }

    fn insert(&mut self, x: f32, y: f32, id: u32) {
        let c = (self.index(y) * self.side + self.index(x)) as usize;
        self.cells[c].push(id);
    }
}

/// The state of a pane under its sources.
#[derive(Clone, Debug)]
pub struct WetPane {
    spec: WetSpec,
    steps: u32,
    drops: Vec<GlassDrop>,
    motes: Vec<Mote>,
    alive: usize,
    grid: MoteGrid,
    /// `K(θ̄)` and the hysteresis `cos θ_R − cos θ_A`.
    k: f32,
    hysteresis: f32,
    /// The size of gravity along the pane, and its unit direction there (zero on a level pane).
    slope: f32,
    downhill: [f32; 2],
    /// The share of the motes that land and stay (from the angle of repose).
    keep: f32,
    /// Since the last [`WetPane::frame`]: the first mote added, and the motes carried away.
    first_new: usize,
    removed: Vec<u32>,
    /// Water lost to trails and drops run off, mm³ (a measure for the tests).
    shed: f32,
    run_off: u32,
    /// Drops were put by hand since the last merge.
    dirty: bool,
}

impl WetPane {
    /// A dry, clean pane under `spec`.
    pub fn new(spec: WetSpec) -> WetPane {
        let (k, hysteresis) = cap_constants(spec.advancing_deg, spec.receding_deg);
        let [gx, gy, gn] = spec.gravity;
        let slope = (gx * gx + gy * gy).sqrt();
        let downhill = if slope > 1.0e-6 {
            [gx / slope, gy / slope]
        } else {
            [0.0, 0.0]
        };
        // The face's angle from the horizontal: 0 looking straight up (gravity into the face).
        let alpha = fmath::acos((-gn).clamp(-1.0, 1.0)) / fmath::DEG_TO_RAD;
        let lo = spec.repose_deg - REPOSE_SPREAD_DEG;
        let hi = spec.repose_deg + REPOSE_SPREAD_DEG;
        let keep = if alpha <= lo {
            1.0
        } else if alpha >= hi {
            0.0
        } else {
            let t = (alpha - lo) / (hi - lo);
            1.0 - t * t * (3.0 - 2.0 * t)
        };
        let grid = MoteGrid::new(spec.half_extent);
        WetPane {
            spec,
            steps: 0,
            drops: Vec::new(),
            motes: Vec::new(),
            alive: 0,
            grid,
            k,
            hysteresis,
            slope,
            downhill,
            keep,
            first_new: 0,
            removed: Vec::new(),
            shed: 0.0,
            run_off: 0,
            dirty: false,
        }
    }

    /// The spec.
    pub fn spec(&self) -> &WetSpec {
        &self.spec
    }

    /// Steps simulated (the time is this over [`STEPS_PER_SECOND`]).
    pub fn steps(&self) -> u32 {
        self.steps
    }

    /// Simulated seconds.
    pub fn seconds(&self) -> f32 {
        self.steps as f32 / STEPS_PER_SECOND as f32
    }

    /// The drops on the pane, merged.
    pub fn drops(&self) -> &[GlassDrop] {
        &self.drops
    }

    /// The motes still on the pane, in the order they landed.
    pub fn motes(&self) -> Vec<GlassMote> {
        self.motes
            .iter()
            .filter(|m| m.alive)
            .map(|m| GlassMote {
                x: m.x,
                y: m.y,
                r: m.r,
            })
            .collect()
    }

    /// The motes that ever landed (alive or not).
    pub fn motes_landed(&self) -> usize {
        self.motes.len()
    }

    /// The share of the pane the motes still there cover (their areas summed over the square's).
    pub fn dust_cover(&self) -> f32 {
        let area: f32 = self
            .motes
            .iter()
            .filter(|m| m.alive)
            .map(|m| fmath::PI * m.r * m.r)
            .sum();
        area / (4.0 * self.spec.half_extent * self.spec.half_extent)
    }

    /// The volume of a drop, mm³.
    pub fn volume(&self, d: &GlassDrop) -> f32 {
        self.k * d.a * d.a * d.a
    }

    /// The water on the pane, mm³.
    pub fn water(&self) -> f32 {
        self.drops.iter().map(|d| self.volume(d)).sum()
    }

    /// Water left in trails so far, mm³.
    pub fn water_shed(&self) -> f32 {
        self.shed
    }

    /// Drops that ran off the pane so far.
    pub fn run_off(&self) -> u32 {
        self.run_off
    }

    /// The critical contact radius on this pane (infinite when it is level).
    pub fn critical_radius(&self) -> f32 {
        critical_radius(self.spec.advancing_deg, self.spec.receding_deg, self.slope)
    }

    /// The share of landing motes that stay (1 below the angle of repose, 0 above it).
    pub fn dust_kept(&self) -> f32 {
        self.keep
    }

    /// Puts a drop of contact radius `a` at `(x, y)` (tests and still pictures; merged at the next
    /// step).
    pub fn add_drop(&mut self, x: f32, y: f32, a: f32) {
        if a > 0.0 && self.drops.len() < MAX_DROPS {
            self.drops.push(GlassDrop { x, y, a });
            self.dirty = true;
        }
    }

    /// Puts a mote of radius `r` at `(x, y)` (tests).
    pub fn add_mote(&mut self, x: f32, y: f32, r: f32) {
        if r > 0.0 && self.motes.len() < MAX_MOTES {
            let id = self.motes.len() as u32;
            self.motes.push(Mote {
                x,
                y,
                r,
                alive: true,
            });
            self.grid.insert(x, y, id);
            self.alive += 1;
        }
    }

    /// Simulates `n` steps.
    pub fn step(&mut self, n: u32) {
        for _ in 0..n {
            self.step_once();
        }
    }

    fn step_once(&mut self) {
        let step = self.steps;
        self.steps += 1;
        let mut changed = std::mem::take(&mut self.dirty);
        for index in 0..self.spec.sources.len() {
            let source = self.spec.sources[index];
            changed |= self.land(step, index as u64, &source);
        }
        changed |= self.slide();
        if changed && self.drops.len() > 1 {
            merge_drops(&mut self.drops);
        }
    }

    /// The particles of `source` that land in step `step`; true when a drop came.
    fn land(&mut self, step: u32, index: u64, source: &WetSource) -> bool {
        let towards = -source.velocity[2];
        if !(source.density > 0.0 && towards > 0.0 && source.size_mm > 0.0) {
            return false;
        }
        let h = self.spec.half_extent;
        let lambda = source.density * towards * 4.0 * h * h * STEP;
        let base = mix64(
            (u64::from(self.spec.seed) << 32)
                ^ u64::from(step).wrapping_mul(0x9E37_79B9_7F4A_7C15)
                ^ index.wrapping_mul(0xD1B5_4A32_D192_ED03),
        );
        let parts = (lambda / POISSON_PART).ceil().max(1.0) as u32;
        let mean = lambda / parts as f32;
        let mut count = 0u32;
        for part in 0..parts {
            count += poisson(mean, unit(mix64(base ^ SALT_COUNT ^ u64::from(part))));
            if count >= MAX_LANDINGS {
                count = MAX_LANDINGS;
                break;
            }
        }
        let mut drop_came = false;
        let var = source.size_var.clamp(0.0, 1.0);
        for k in 0..count {
            let mut hh = mix64(base ^ SALT_PLACE ^ (u64::from(k) << 20));
            let mut draw = || {
                hh = mix64(hh);
                unit(hh)
            };
            let x = (2.0 * draw() - 1.0) * h;
            let y = (2.0 * draw() - 1.0) * h;
            let d = source.size_mm * (1.0 + var * (2.0 * draw() - 1.0)).max(0.05);
            match source.kind {
                SourceKind::Drops => {
                    if self.drops.len() >= MAX_DROPS {
                        continue;
                    }
                    let volume = fmath::PI / 6.0 * d * d * d;
                    self.drops.push(GlassDrop {
                        x,
                        y,
                        a: cbrt(volume / self.k),
                    });
                    drop_came = true;
                }
                SourceKind::Dust => {
                    let stays = unit(mix64(base ^ SALT_KEEP ^ (u64::from(k) << 20))) < self.keep;
                    if stays {
                        self.add_mote(x, y, 0.5 * d);
                    }
                }
            }
        }
        drop_came
    }

    /// Moves the drops past their critical size down the slope, leaving their trails; true when one
    /// moved.
    fn slide(&mut self) -> bool {
        if self.slope <= 0.0 || self.drops.is_empty() {
            return false;
        }
        let pin = 2.0 * SURFACE_TENSION * self.hysteresis;
        let weight = WATER_WEIGHT * self.k * self.slope;
        let h = self.spec.half_extent;
        let mut moved = false;
        let mut gone = false;
        let mut sweeps: Vec<(f32, f32, f32, f32, f32)> = Vec::new();
        for d in self.drops.iter_mut() {
            let a = d.a;
            // Furmidge: the weight along the face against the contact line's hold, per unit a.
            let excess = weight * a * a * a - pin * a;
            if excess <= 0.0 {
                continue;
            }
            let speed = (excess / (SLIDE_DRAG * WATER_VISCOSITY * a)).min(MAX_SLIDE_SPEED);
            let dist = speed * STEP;
            let (x0, y0) = (d.x, d.y);
            d.x += self.downhill[0] * dist;
            d.y += self.downhill[1] * dist;
            // The film it leaves behind.
            let film = TRAIL_FILM_MM * 2.0 * a * dist;
            let volume = self.k * a * a * a;
            let left = volume - film;
            self.shed += film.min(volume);
            d.a = if left > 0.0 { cbrt(left / self.k) } else { 0.0 };
            sweeps.push((x0, y0, d.x, d.y, a));
            moved = true;
            if d.a <= 0.0 || d.x.abs() > h + d.a || d.y.abs() > h + d.a {
                gone = true;
            }
        }
        for (x0, y0, x1, y1, a) in sweeps {
            self.wipe(x0, y0, x1, y1, a);
        }
        if gone {
            let before = self.drops.len();
            self.drops
                .retain(|d| d.a > 0.0 && d.x.abs() <= h + d.a && d.y.abs() <= h + d.a);
            self.run_off += (before - self.drops.len()) as u32;
        }
        moved
    }

    /// Carries away the motes whose centre is within `a` of the segment from `(x0, y0)` to `(x1, y1)`.
    fn wipe(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, a: f32) {
        if self.alive == 0 {
            return;
        }
        let g = &self.grid;
        let (c0, c1) = (g.index(x0.min(x1) - a), g.index(x0.max(x1) + a));
        let (r0, r1) = (g.index(y0.min(y1) - a), g.index(y0.max(y1) + a));
        let (dx, dy) = (x1 - x0, y1 - y0);
        let len2 = dx * dx + dy * dy;
        for row in r0..=r1 {
            for col in c0..=c1 {
                let c = (row * g.side + col) as usize;
                for &id in &self.grid.cells[c] {
                    let m = &mut self.motes[id as usize];
                    if !m.alive {
                        continue;
                    }
                    let (px, py) = (m.x - x0, m.y - y0);
                    let t = if len2 > 0.0 {
                        ((px * dx + py * dy) / len2).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    let (qx, qy) = (px - t * dx, py - t * dy);
                    if qx * qx + qy * qy <= a * a {
                        m.alive = false;
                        self.alive -= 1;
                        self.removed.push(id);
                    }
                }
            }
        }
    }

    /// The pane as the renderer takes it: the drops and the motes still there.
    pub fn layout(&self) -> GlassLayout {
        GlassLayout {
            drops: self.drops.clone(),
            motes: self.motes(),
        }
    }

    /// The record of a frame, and the start of the next one: little-endian words
    ///
    /// ```text
    /// u32 drops; f32 (x y a)[drops];
    /// u32 first (the index of the first mote added since the last frame); u32 added;
    /// f32 (x y r)[added]; u32 removed; u32 ids[removed] (motes carried away since the last frame)
    /// ```
    ///
    /// A mote's index is the order it landed in; the page keeps every mote with the frames it was
    /// on the pane in.
    pub fn frame(&mut self) -> Vec<u8> {
        let added = &self.motes[self.first_new..];
        let mut words: Vec<u32> =
            Vec::with_capacity(4 + 3 * (self.drops.len() + added.len()) + self.removed.len());
        words.push(self.drops.len() as u32);
        for d in &self.drops {
            words.extend_from_slice(&[d.x.to_bits(), d.y.to_bits(), d.a.to_bits()]);
        }
        words.push(self.first_new as u32);
        words.push(added.len() as u32);
        for m in added {
            words.extend_from_slice(&[m.x.to_bits(), m.y.to_bits(), m.r.to_bits()]);
        }
        words.push(self.removed.len() as u32);
        words.extend_from_slice(&self.removed);
        self.first_new = self.motes.len();
        self.removed.clear();
        words.iter().flat_map(|w| w.to_le_bytes()).collect()
    }

    /// FNV-1a (32 bits) of the steps, the drops and the motes still there, in order: what the
    /// native and WebAssembly builds are compared by.
    pub fn hash(&self) -> u32 {
        let mut h: u32 = 0x811c_9dc5;
        let mut eat = |w: u32| {
            for b in w.to_le_bytes() {
                h ^= u32::from(b);
                h = h.wrapping_mul(0x0100_0193);
            }
        };
        eat(self.steps);
        eat(self.drops.len() as u32);
        for d in &self.drops {
            eat(d.x.to_bits());
            eat(d.y.to_bits());
            eat(d.a.to_bits());
        }
        for (i, m) in self.motes.iter().enumerate() {
            if m.alive {
                eat(i as u32);
                eat(m.x.to_bits());
                eat(m.y.to_bits());
                eat(m.r.to_bits());
            }
        }
        h
    }
}

/// A Poisson count of mean `lambda` (at most [`POISSON_PART`]) by inversion of its distribution at
/// the uniform number `u`.
fn poisson(lambda: f32, u: f32) -> u32 {
    if lambda <= 0.0 {
        return 0;
    }
    let mut p = fmath::exp(-lambda);
    let mut sum = p;
    let mut k = 0u32;
    while u > sum && k < MAX_LANDINGS {
        k += 1;
        p *= lambda / k as f32;
        sum += p;
        if p <= 0.0 {
            break;
        }
    }
    k
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn poisson_draws_have_their_mean() {
        for lambda in [0.05f32, 0.7, 3.0, 20.0] {
            let n = 20_000;
            let total: u64 = (0..n)
                .map(|i| u64::from(poisson(lambda, unit(mix64(i as u64)))))
                .sum();
            let mean = total as f32 / n as f32;
            assert!(
                (mean - lambda).abs() < 0.03 * lambda.max(1.0),
                "{lambda}: {mean}"
            );
        }
    }

    #[test]
    fn a_spec_round_trips_and_bad_ones_are_refused() {
        let spec = WetSpec {
            seed: 9,
            half_extent: 30.0,
            gravity: [0.0, -1.0, 0.0],
            advancing_deg: 70.0,
            receding_deg: 50.0,
            repose_deg: 35.0,
            sources: vec![WetSource {
                kind: SourceKind::Dust,
                density: 1.0e-4,
                velocity: [0.0, 0.0, -300.0],
                size_mm: 0.2,
                size_var: 0.5,
            }],
        };
        let bytes = spec.to_bytes();
        assert_eq!(WetSpec::parse(&bytes), Ok(spec.clone()));
        assert!(WetSpec::parse(&bytes[..bytes.len() - 1]).is_err());
        assert!(WetSpec::parse(b"WET2").is_err());
        let mut bad = spec.clone();
        bad.gravity = [0.0; 3];
        assert!(WetSpec::parse(&bad.to_bytes()).is_err());
        let mut bad = spec.clone();
        bad.sources[0].size_var = 2.0;
        assert!(WetSpec::parse(&bad.to_bytes()).is_err());
        let mut bad = spec;
        bad.half_extent = -1.0;
        assert!(WetSpec::parse(&bad.to_bytes()).is_err());
    }
}

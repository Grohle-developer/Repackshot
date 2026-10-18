//! Rain, dust and snow on the parts (phase S3c): what the ambient effects of a scene leave on the
//! meshes of its parts, simulated at the fixed step of the rigid bodies ([`STEP`]), deterministic,
//! `f32`, `+ − × ÷ sqrt` and `rt_core::fmath` only. It is the model of the front glass
//! ([`crate::wet`], S3b) carried from a flat pane onto curved surfaces: the same caps, the same
//! Furmidge balance, the same trail; here they follow the triangles of a mesh, drip off its edges
//! and splash.
//!
//! **The parts** are triangle meshes in world space (millimetres, Z up, gravity along −Z), each with
//! the wettability of its material (the advancing and receding contact angles of water on it, and
//! how fast a porous one soaks a drop in). They do not move during a run: they are wetted where
//! they stand.
//!
//! **The surface's samples.** Every triangle carries a regular grid of `R` steps per side, the
//! samples `(i, j)`, `i + j ≤ R`, at the barycentric weights `(1 − (i + j)/R, i/R, j/R)` of its
//! corners (`(R + 1)(R + 2)/2` of them, row `j` after row `j − 1`: [`sample_index`]). `R` is the
//! triangle's longest edge over the cell size, but no more than twice the side of the square of its
//! area over it (a sliver's samples follow its area: [`resolution_of`]), at least 1 and at most
//! [`MAX_RESOLUTION`]; the cell grows until the scene keeps under its budget of samples, of which
//! the film parts (below) take a third at most when there are parts that take drops. The samples
//! hold what the renderer shades (the RSB `WETP` section, `rt_core::weather`): when each was first
//! wet, when the rain last wiped its dust, how fast dust and snow pile on it.
//!
//! **What arrives.** Each source ([`PartsSource`]) is an effect of the scene as a number density of
//! particles and their mean velocity `v`. Through a surface whose normal is `n` pass
//! `density × |v| × max(0, −v̂·n)` per unit area and time, where nothing else of the scene is in the
//! way upstream (a ray from the point against `v̂`). Drops land one by one: each step draws how many
//! from a Poisson law of the mean over every triangle of the parts that take drops, picks the
//! triangle by its share of that flux and a uniform point on it, and keeps the landing when the
//! point is in the open. Dust and snow are fields: the share of a sample under motes grows as
//! `1 − exp(−k t)` and the snow on it by a depth per second, both from the same flux, both only
//! where the face is flat enough for them to rest (the angle of repose, with a smooth step of
//! [`crate::wet::REPOSE_SPREAD_DEG`] either side) and in the open.
//!
//! **Drops.** A landing drop of diameter `D` is a cap of its volume `π D³ / 6` at the mean of the
//! contact angles, in the tangent plane of its point. Fast enough, it **splashes** (Mundo, Sommerfeld
//! and Tropea, "Droplet-wall collisions: experimental studies of the deformation and breakup
//! process", Int. J. Multiphase Flow 21 (1995): past `K = We^½ Re^¼ = 57.7` a drop breaks up on
//! impact): a share of its volume ([`SPLASH_SHARE`] at most) goes as [`SPLASH_DROPS`] smaller drops
//! thrown along the surface; the impact wets a circle [`LANDING_SPREAD`] times the drop wide. Drops
//! that touch on the same part **merge** into the volume of both at their centre of mass. A drop
//! stays **pinned** while the hysteresis of its contact line holds it against its weight along the
//! face (Furmidge, as on the glass) and otherwise **slides** down the face's slope, from triangle
//! to triangle over the edges it crosses (down a crease, along the crease), at the speed of
//! [`crate::wet`], leaving a wet trail that takes its water and wipes the dust it crosses. On a face
//! that looks down a drop **hangs** until its weight pulls harder than its contact line can hold,
//! `ρ g V (ĝ·n) > 2π a γ sin θ̄` ([`PENDANT_HOLD`]), and drips; one that slides off an open edge of
//! the mesh drips there, at the speed it slid. A porous material soaks its drops in at
//! `soak × π a²` mm³ per second.
//!
//! **Drops in the air** (S3d). A drip and the drops a splash throws are spheres of their volume that
//! fly: each step gravity and the drag of the air (held over the step; quadratic, so that a drop falls at most at its
//! terminal speed: [`terminal_speed`], Atlas, Srivastava and Sekhon, "Doppler radar characteristics
//! of precipitation at vertical incidence", Rev. Geophys. 11 (1973), above 0.6 mm, linear in the
//! diameter below it) change their velocity, and the segment they cross is cast against the
//! triangles: the first face they meet from its front takes them as a drop (an impact at the speed
//! along its normal: it may splash again). A splash throws its drops off the surface at
//! [`SPLASH_ELEVATION_DEG`], at the speed that would carry them up to [`SPLASH_REACH`] diameters on
//! a level face. A drop that falls below the lowest of the parts and the studio floor (`z = 0`) is
//! gone. None lands in the step it left: they are in the frames while they fly.
//!
//! **Organic drops** (S3f). A drop that keeps receiving rain grows by merging with what lands on it
//! and with the drops it touches, and stays pinned until its weight along the face beats the hold of
//! its contact line (Furmidge: the critical size of its tilt and of the wettability of its part).
//! A drop that slides **gathers the drops on its path**: the merge looks along the segment it swept
//! in the step, not only where it stopped, so it takes every drop it crossed and none beside it; it
//! grows, and grows faster. **A merge keeps the volume** (the sum) and does not teleport: the survivor
//! stays where it was and relaxes to the centre of volume of the two over a few capillary times
//! (`√(ρ a³ / γ)` × [`MERGE_TIMES`]), its outline first spanning both with a neck between them. Its
//! **shape** ([`rt_core::weather::DropShape`], [`WetParts::shapes`]) follows its physics: a pinned
//! drop on a tilted face bulges downhill as its front contact angle climbs from the mean towards the
//! advancing one and its rear one falls towards the receding one (by its load, the weight along the
//! face over the hold); a sliding drop has the dynamic angles of Cox and Voinov (`θ³ = θ_A³ + 9 Ca Λ`
//! at its front, `θ_R³ − 9 Ca Λ` at its rear, `Ca = μ v / γ`: Voinov, "Hydrodynamics of wetting",
//! Fluid Dyn. 11 (1976); Cox, J. Fluid Mech. 168 (1986)), and stretches along its motion with a
//! thinner tail as its rear angle falls (the corner of Podgorski, Flesselles and Limat, "Corners,
//! cusps, and pearls in running drops", Phys. Rev. Lett. 87 (2001)). S3g: a runner leaves its
//! continuous wet trail behind it, and only past the **pearling** transition, once its dynamic
//! receding angle has fallen to [`PEARL_REAR_DEG`] (a capillary number of
//! `(θ_R³ − θ_p³) / 9Λ`, far above what rain runners reach on the surfaces of a product), does its
//! cusped tail shed pearls: sparse ([`PEARL_SPACING`] contact diameters apart on average, the
//! distances drawn from an exponential law), small (up to [`PEARL_RADIUS`] of its contact radius),
//! round, pinned where they fall, and gathered by the next drop down the same path. The outline a
//! drop is drawn with keeps its physical contact area in every state (a merge's outline spanning the
//! two drops and a hanging drop's stretch along gravity are brought back to it, see
//! [`WetParts::shapes`]). A drop that **hangs** (under a
//! face that looks down, or held at an open edge of the mesh, where it now stops instead of running
//! off) stretches along gravity as its weight nears what its contact line holds; past it, it necks
//! over [`PINCH_TIMES`] capillary times and lets go of [`PINCH_OFF_SHARE`] of its water as one drop
//! in the air (Harkins and Brown, "The determination of surface tension and the weight of falling
//! drops", J. Am. Chem. Soc. 41 (1919): about 60 % of a pendant drop falls), the rest staying to grow
//! again.
//!
//! **Parts as a film.** A part flagged [`PART_FILM`] (a set's backdrop, floor and cards: too large for
//! drops one by one) takes no drops: each of its samples is wet at the first landing near it, a
//! time drawn once from the exponential law of its share of the flux. Dust and snow are the same.
//!
//! **What it gives.** [`WetParts::layout`] once (the samples of each triangle, the rates of dust and
//! snow), [`WetParts::frame`] per frame (the drops, the samples wet and wiped since the frame
//! before, the drips), [`WetParts::weather`] the state at the last step as the renderer takes it,
//! and [`WetParts::hash`] the check the native and WebAssembly builds are compared by.
//!
//! The constants of the liquid are water's at 20 °C ([`crate::wet`]); [`SPLASH_SHARE`],
//! [`SPLASH_DROPS`], [`SPLASH_REACH`], [`LANDING_SPREAD`], [`PENDANT_HOLD`], [`SNOW_PACKING`] and the
//! budgets are this phase's proposals (rule 11, ◆ in the roadmap's S3c).

use crate::math::above;
use crate::wet::{
    cap_constants, cbrt, poisson, unit, MAX_LANDINGS, MAX_SLIDE_SPEED, POISSON_PART,
    REPOSE_SPREAD_DEG, SLIDE_DRAG, SURFACE_TENSION, TRAIL_FILM_MM, WATER_VISCOSITY, WATER_WEIGHT,
};
use crate::world::{Pose, Transform, STEP, STEPS_PER_SECOND};
use rt_core::fmath;
use rt_core::math::{Aabb, Vec3};
use rt_core::rng::mix64;
use rt_core::weather::DropShape;

/// The magic number of a `WPT1` spec.
pub const PARTS_MAGIC: &[u8; 4] = b"WPT1";
/// The version this writer writes when the spec needs it (S3e: moving parts, the wind, the studio
/// floor, the set's fine samples); a spec without any of them is written as version 1, and both are
/// read.
pub const PARTS_VERSION: u32 = 2;
/// S3e: [`WetPartSpec::body`] of a part that does not move.
pub const NO_BODY: u32 = u32::MAX;
/// S3e: most steps of a film triangle's grid per side when the shadow edge refines it (its
/// resolution is two bytes then: `rt_core::weather`'s `WTP2`).
pub const MAX_FINE_RESOLUTION: u32 = rt_core::weather::MAX_FINE_RESOLUTION;
/// Most parts in a spec.
pub const MAX_PARTS: usize = 1024;
/// Most sources in a spec.
pub const MAX_SOURCES: usize = 64;
/// Most drops on all the parts together (◆: each is a cap the renderer meshes).
pub const MAX_PART_DROPS: usize = 4096;
/// Most steps of a triangle's grid of samples per side.
pub const MAX_RESOLUTION: u32 = 255;
/// Most samples a spec may ask for.
pub const MAX_SAMPLE_BUDGET: u32 = 4_000_000;
/// A step that has not come (a sample never wet).
pub const NEVER: u32 = u32::MAX;
/// `WetPartSpec::flags` bit 0: the part takes no drops one by one, its samples wet as a film.
pub const PART_FILM: u32 = 1;
/// Mundo, Sommerfeld and Tropea's splashing threshold of `K = We^½ Re^¼`.
pub const SPLASH_K: f32 = 57.7;
/// The most of a drop's volume a splash throws (at `K ≥ 2 × SPLASH_K`, from none at the threshold).
/// ◆ a proposal.
pub const SPLASH_SHARE: f32 = 0.3;
/// Drops a splash throws (◆).
pub const SPLASH_DROPS: u32 = 2;
/// The farthest a splash throws them, in diameters of the drop that splashed (◆).
pub const SPLASH_REACH: f32 = 4.0;
/// The diameter an impact wets, in diameters of the drop (◆: its spreading before it recedes).
pub const LANDING_SPREAD: f32 = 2.0;
/// The hold of a hanging drop's contact line over `2π a γ sin θ̄` (◆).
pub const PENDANT_HOLD: f32 = 1.0;
/// The share of a snow layer that is flakes (◆): a flake adds its own volume over this to the
/// depth.
pub const SNOW_PACKING: f32 = 0.5;
/// S3d: how far off the surface a splash throws its drops, degrees (◆).
pub const SPLASH_ELEVATION_DEG: f32 = 30.0;
/// S3d: most drops in the air at once (◆: each is a sphere the renderer meshes); past it a drip or
/// a splash's drop is lost.
pub const MAX_FALLING_DROPS: usize = 1024;
/// S3d: the longest a drop flies, steps (10 s): past it, it is gone.
pub const MAX_FLIGHT_STEPS: u32 = 2400;
/// S3f: Cox–Voinov's `Λ = ln(L / l)`, the log of a drop's size over the microscopic length where its
/// moving contact line's dissipation is cut off (◆: about 12 for millimetre drops and a nanometre).
pub const COX_VOINOV_LOG: f32 = 12.0;
/// S3f: how long a pinned drop grows along its downhill axis at its critical size, per unit of
/// hysteresis `cos θ_R − cos θ_A` (◆ the shapes' exaggeration).
pub const PIN_STRETCH: f32 = 1.0;
/// S3f: how much longer a sliding drop grows as its rear contact angle falls from the receding one to
/// 0 (◆).
pub const SLIDE_STRETCH: f32 = 2.0;
/// S3f: how much thinner its tail gets on the way (◆).
pub const SLIDE_TAPER: f32 = 0.45;
/// S3f: the most a drop is stretched along its axis, length over width (◆).
pub const MAX_ASPECT: f32 = 4.0;
/// S3g: a sliding drop pearls once its dynamic receding angle (Cox–Voinov, [`dynamic_angles`]) has
/// fallen to this, degrees: its trailing edge, cornered and then cusped, sheds small drops (Podgorski,
/// Flesselles and Limat 2001). On rigid surfaces the trailing angle just before pearling is about 10°
/// (Le Grand, Daerr and Limat, J. Fluid Mech. 541 (2005), as Oléron, Limat, Dervaux and Roché report
/// it, arXiv:2304.04925 (2023)); ◆. Below it a runner leaves its continuous wet trail and nothing
/// else.
pub const PEARL_REAR_DEG: f32 = 10.0;
/// S3g: the largest a pearl's contact radius is, over its runner's (◆: the literature says "smaller
/// drops", Podgorski et al. 2001; "of considerably smaller volume", Engelnkemper, Wilczek, Gurevich
/// and Thiele, Phys. Rev. Fluids 1 (2016); "tiny satellite droplets", Li et al., Nat. Commun. 14
/// (2023)); each pearl draws its own between half of it and all of it.
pub const PEARL_RADIUS: f32 = 0.25;
/// S3g: the mean distance between a runner's pearls, in its contact diameters (◆: sparse; Liang and
/// Tietze, Sci. Rep. 7 (2017), saw at most two, once three, over 200 mm of a water drop's run). Each
/// distance is drawn from an exponential law by a hash of the run, so they are irregular.
pub const PEARL_SPACING: f32 = 12.0;
/// S3f: how long a merge takes to relax, capillary times `√(ρ a³ / γ)` (◆ the neck's duration).
pub const MERGE_TIMES: f32 = 4.0;
/// S3f: the depth of the neck between two equal drops that just merged, a share of the width (◆; a
/// smaller one into a larger, by their ratio of radii).
pub const NECK_DEPTH: f32 = 0.5;
/// S3f: how far a hanging drop stretches along gravity when its weight reaches its hold (◆).
pub const HANG_SAG: f32 = 0.6;
/// S3f: the neck under a hanging drop's contact line as it pinches off (◆).
pub const HANG_PINCH: f32 = 0.6;
/// S3f: how long a hanging drop past its hold takes to pinch off, capillary times (◆).
pub const PINCH_TIMES: f32 = 3.0;
/// S3f: the share of a hanging drop that falls when it pinches off (Harkins and Brown 1919); the rest
/// stays.
pub const PINCH_OFF_SHARE: f32 = 0.6;
/// S3f: a face looks down (its drops hang) when gravity along its normal is more than this (a
/// vertical face's rounding is not).
const HANG_MIN: f32 = 1.0e-4;
/// S3g: the points of the outline a drop's shape is measured by (`rt_core::weather::outline_area`)
/// to keep its contact area.
const OUTLINE_POINTS: u32 = 32;
/// S3f: below this share left of a merge, it is over.
const RELAXED: f32 = 0.01;
/// S3f: `ρ / γ` of water, s²/mm³ (the capillary time is `√(ρ a³ / γ)`).
const CAPILLARY: f32 = RHO_SI / GAMMA_SI * 1.0e-9;
/// Gravity, mm/s².
const GRAVITY_MM: f32 = 9810.0;
/// Density and viscosity of water in SI units for the splashing numbers (kg/m³, Pa·s), and its
/// surface tension (N/m).
const RHO_SI: f32 = 1000.0;
const MU_SI: f32 = 1.0e-3;
const GAMMA_SI: f32 = 0.072;
/// How far a ray starts off a surface, mm.
const RAY_OFFSET: f32 = 0.01;
/// Drops of less than this volume are gone (soaked in, run dry), mm³.
const MIN_VOLUME: f32 = 1.0e-4;
/// Most triangles a walk crosses in one step.
const MAX_CROSSINGS: u32 = 64;
/// S3e: the most steps per side of the grid of points a film triangle is probed at for a shadow
/// edge.
const EDGE_PROBES: u32 = 24;
// Salts of the counter hashes (fixed forever).
const SALT_STEP: u64 = 0x53c0_0000_0000_0001;
const SALT_COUNT: u64 = 0x53c0_0000_0000_0002;
const SALT_PLACE: u64 = 0x53c0_0000_0000_0003;
const SALT_SPLASH: u64 = 0x53c0_0000_0000_0004;
const SALT_FILM: u64 = 0x53c0_0000_0000_0005;
const SALT_FLIGHT: u64 = 0x53d0_0000_0000_0001;
const SALT_FLOOR: u64 = 0x53e0_0000_0000_0001;
const SALT_PEARL: u64 = 0x5390_0000_0000_0001;

/// What a source leaves on the parts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PartsSourceKind {
    /// Water: each particle a drop.
    Drops,
    /// Dust: a field of coverage.
    Dust,
    /// Snow: a layer that piles up and does not slide.
    Snow,
}

impl PartsSourceKind {
    /// The code in a `WPT1` spec.
    pub fn to_u32(self) -> u32 {
        match self {
            PartsSourceKind::Drops => 0,
            PartsSourceKind::Dust => 1,
            PartsSourceKind::Snow => 2,
        }
    }

    /// The kind of a code, or `None`.
    pub fn from_u32(v: u32) -> Option<PartsSourceKind> {
        match v {
            0 => Some(PartsSourceKind::Drops),
            1 => Some(PartsSourceKind::Dust),
            2 => Some(PartsSourceKind::Snow),
            _ => None,
        }
    }
}

/// An effect of the scene as the parts see it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PartsSource {
    /// Drops, dust or snow.
    pub kind: PartsSourceKind,
    /// Particles per cubic millimetre.
    pub density: f32,
    /// Their mean velocity, world, mm/s.
    pub velocity: Vec3,
    /// Mean diameter, mm.
    pub size_mm: f32,
    /// Its relative variation, 0..1.
    pub size_var: f32,
}

/// A mesh of the spec, in its part's object space.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PartsMesh {
    /// Vertex positions.
    pub positions: Vec<Vec3>,
    /// Three per triangle.
    pub indices: Vec<u32>,
}

/// A part: a mesh where it stands and how water sits on it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WetPartSpec {
    /// Index into the meshes.
    pub mesh: u32,
    /// Object to world.
    pub transform: Transform,
    /// Advancing contact angle of water on it, degrees.
    pub advancing_deg: f32,
    /// Receding contact angle, degrees (at most the advancing one).
    pub receding_deg: f32,
    /// How fast a porous material soaks a drop in, mm³ per mm² of contact per second (0: never).
    pub soak_mm_s: f32,
    /// [`PART_FILM`]; other bits are kept and ignored.
    pub flags: u32,
    /// S3e: the dynamic body of the rigid-body scene (`PHY1`) it moves with, by its order among the
    /// scene's dynamic bodies, or [`NO_BODY`]: it stays where it stands.
    pub body: u32,
}

/// S3e: the studio floor (the plane `z`, which is not a mesh) as the simulation takes it: a film of
/// square cells over the rectangle `min..max` (world XY, mm), the cell growing from `cell_mm` until
/// there are at most `max_cells`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FloorSpec {
    /// Height of the plane, mm.
    pub z: f32,
    /// The corner of the rectangle with the lower X and Y.
    pub min: [f32; 2],
    /// The opposite corner.
    pub max: [f32; 2],
    /// The side of a cell, mm (the least).
    pub cell_mm: f32,
    /// The most cells.
    pub max_cells: u32,
}

/// S3e: what version 2 of the spec adds after the sources (all of it absent in version 1).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PartsExtras {
    /// The air the drops in the air are in (the effects' wind), world, mm/s.
    pub wind: Vec3,
    /// The studio floor, or none.
    pub floor: Option<FloorSpec>,
    /// The cell of a film triangle that a shadow edge crosses, mm (0: no refinement).
    pub edge_cell_mm: f32,
    /// The most samples the refined triangles may take together.
    pub edge_budget: u32,
}

/// Everything the simulation of the parts is given (the `WPT1` bytes):
///
/// ```text
/// "WPT1"  u32 version (1 or 2); u32 seed; f32 cell_mm; u32 max_samples; f32 repose_deg snow_repose_deg;
/// u32 meshes; per mesh: u32 vertices indices; f32 positions[3 × vertices]; u32 indices[]
/// u32 parts; per part: u32 mesh; f32 rows[12] (the 3 × 4 object-to-world matrix by rows);
///            f32 advancing_deg receding_deg soak_mm_s; u32 flags (1: a film);
///            v2: u32 body (the PHY1 dynamic body it moves with; 0xffffffff: it stays)
/// u32 sources; per source: u32 kind (0 drops, 1 dust, 2 snow); f32 density (per mm³);
///              f32 velocity[3] (world, mm/s); f32 size_mm size_var
/// v2: f32 wind[3] (world, mm/s); u32 floor (0, 1); [f32 z x0 y0 x1 y1 cell_mm; u32 max_cells];
///     f32 edge_cell_mm; u32 edge_budget
/// ```
#[derive(Clone, Debug, PartialEq)]
pub struct PartsSpec {
    /// Seed of every random choice.
    pub seed: u32,
    /// The side of a cell of the samples, mm (the least: it grows to keep under `max_samples`).
    pub cell_mm: f32,
    /// The most samples of all the parts together.
    pub max_samples: u32,
    /// Angle of repose of the dust, degrees from the horizontal.
    pub repose_deg: f32,
    /// Angle of repose of the snow.
    pub snow_repose_deg: f32,
    /// The meshes.
    pub meshes: Vec<PartsMesh>,
    /// The parts.
    pub parts: Vec<WetPartSpec>,
    /// What falls on them.
    pub sources: Vec<PartsSource>,
    /// S3e: the wind on the drops in the air, the studio floor and the set's fine samples.
    pub extras: PartsExtras,
}

struct Words<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Words<'_> {
    fn u32(&mut self) -> Result<u32, String> {
        let b = self
            .bytes
            .get(self.at..self.at + 4)
            .ok_or_else(|| "WPT1: truncated".to_string())?;
        self.at += 4;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn f32(&mut self) -> Result<f32, String> {
        let v = f32::from_bits(self.u32()?);
        if v.is_finite() {
            Ok(v)
        } else {
            Err("WPT1: a number that is not finite".to_string())
        }
    }

    /// A count of items of `bytes` each that must fit in what is left.
    fn count(&mut self, bytes: usize) -> Result<usize, String> {
        let n = self.u32()? as usize;
        if n.saturating_mul(bytes) > self.bytes.len().saturating_sub(self.at) {
            return Err(format!("WPT1: a count of {n} does not fit in the spec"));
        }
        Ok(n)
    }
}

impl PartsSpec {
    /// Reads `WPT1` bytes. Fails on another magic or version, a truncated spec, trailing bytes, a
    /// number that is not finite or out of its range, an index out of its mesh, or an unknown kind
    /// of source.
    pub fn parse(bytes: &[u8]) -> Result<PartsSpec, String> {
        if bytes.len() < 8 || &bytes[..4] != PARTS_MAGIC {
            return Err("WPT1: not a spec of wet parts".to_string());
        }
        let mut w = Words { bytes, at: 4 };
        let version = w.u32()?;
        if version != 1 && version != PARTS_VERSION {
            return Err(format!(
                "WPT1: version {version} is not 1 or {PARTS_VERSION}"
            ));
        }
        let v2 = version == PARTS_VERSION;
        let seed = w.u32()?;
        let cell_mm = w.f32()?;
        let max_samples = w.u32()?;
        let repose_deg = w.f32()?;
        let snow_repose_deg = w.f32()?;
        if !(0.01..=1000.0).contains(&cell_mm)
            || max_samples == 0
            || max_samples > MAX_SAMPLE_BUDGET
        {
            return Err("WPT1: the cells are out of their range".to_string());
        }
        if !(0.0..=90.0).contains(&repose_deg) || !(0.0..=90.0).contains(&snow_repose_deg) {
            return Err("WPT1: an angle of repose out of its range".to_string());
        }
        let mesh_count = w.count(8)?;
        let mut meshes = Vec::with_capacity(mesh_count);
        for _ in 0..mesh_count {
            let nv = w.u32()? as usize;
            let ni = w.u32()? as usize;
            if nv.saturating_mul(12).saturating_add(ni.saturating_mul(4))
                > bytes.len().saturating_sub(w.at)
                || !ni.is_multiple_of(3)
            {
                return Err("WPT1: a mesh does not fit in the spec".to_string());
            }
            let mut positions = Vec::with_capacity(nv);
            for _ in 0..nv {
                positions.push(Vec3::new(w.f32()?, w.f32()?, w.f32()?));
            }
            let mut indices = Vec::with_capacity(ni);
            for _ in 0..ni {
                let i = w.u32()?;
                if i as usize >= nv {
                    return Err("WPT1: an index out of its mesh".to_string());
                }
                indices.push(i);
            }
            meshes.push(PartsMesh { positions, indices });
        }
        let part_count = w.count(if v2 { 72 } else { 68 })?;
        if part_count > MAX_PARTS {
            return Err(format!("WPT1: more than {MAX_PARTS} parts"));
        }
        let mut parts = Vec::with_capacity(part_count);
        for _ in 0..part_count {
            let mesh = w.u32()?;
            let mut rows = [[0.0f32; 4]; 3];
            for row in rows.iter_mut() {
                for v in row.iter_mut() {
                    *v = w.f32()?;
                }
            }
            let part = WetPartSpec {
                mesh,
                transform: Transform { rows },
                advancing_deg: w.f32()?,
                receding_deg: w.f32()?,
                soak_mm_s: w.f32()?,
                flags: w.u32()?,
                body: if v2 { w.u32()? } else { NO_BODY },
            };
            let ok_angle = |v: f32| (0.0..=180.0).contains(&v);
            if mesh as usize >= meshes.len()
                || !ok_angle(part.advancing_deg)
                || !ok_angle(part.receding_deg)
                || !(0.0..=100.0).contains(&part.soak_mm_s)
            {
                return Err("WPT1: a part out of its range".to_string());
            }
            parts.push(WetPartSpec {
                receding_deg: part.receding_deg.min(part.advancing_deg),
                ..part
            });
        }
        let source_count = w.count(28)?;
        if source_count > MAX_SOURCES {
            return Err(format!("WPT1: more than {MAX_SOURCES} sources"));
        }
        let mut sources = Vec::with_capacity(source_count);
        for _ in 0..source_count {
            let kind = PartsSourceKind::from_u32(w.u32()?)
                .ok_or_else(|| "WPT1: an unknown kind of source".to_string())?;
            let source = PartsSource {
                kind,
                density: w.f32()?,
                velocity: Vec3::new(w.f32()?, w.f32()?, w.f32()?),
                size_mm: w.f32()?,
                size_var: w.f32()?,
            };
            let v = source.velocity;
            if source.density < 0.0
                || !(0.0..=50.0).contains(&source.size_mm)
                || !(0.0..=1.0).contains(&source.size_var)
                || v.x.abs().max(v.y.abs()).max(v.z.abs()) > 1.0e6
            {
                return Err("WPT1: a source out of its range".to_string());
            }
            sources.push(source);
        }
        let mut extras = PartsExtras::default();
        if v2 {
            extras.wind = Vec3::new(w.f32()?, w.f32()?, w.f32()?);
            if extras.wind.abs().max_component() > 1.0e6 {
                return Err("WPT1: the wind is out of its range".to_string());
            }
            extras.floor = match w.u32()? {
                0 => None,
                1 => {
                    let f = FloorSpec {
                        z: w.f32()?,
                        min: [w.f32()?, w.f32()?],
                        max: [w.f32()?, w.f32()?],
                        cell_mm: w.f32()?,
                        max_cells: w.u32()?,
                    };
                    if !(f.max[0] > f.min[0] && f.max[1] > f.min[1])
                        || f.min
                            .iter()
                            .chain(&f.max)
                            .chain([&f.z])
                            .any(|v| v.abs() > 1.0e6)
                        || !(0.01..=1000.0).contains(&f.cell_mm)
                        || f.max_cells == 0
                        || f.max_cells > MAX_SAMPLE_BUDGET
                    {
                        return Err("WPT1: the floor is out of its range".to_string());
                    }
                    Some(f)
                }
                _ => return Err("WPT1: an unknown kind of floor".to_string()),
            };
            extras.edge_cell_mm = w.f32()?;
            extras.edge_budget = w.u32()?;
            if !(extras.edge_cell_mm == 0.0 || (0.01..=1000.0).contains(&extras.edge_cell_mm))
                || extras.edge_budget > MAX_SAMPLE_BUDGET
            {
                return Err("WPT1: the fine samples are out of their range".to_string());
            }
        }
        if w.at != bytes.len() {
            return Err("WPT1: bytes after the end".to_string());
        }
        Ok(PartsSpec {
            seed,
            cell_mm,
            max_samples,
            repose_deg,
            snow_repose_deg,
            meshes,
            parts,
            sources,
            extras,
        })
    }

    /// S3e: true when the spec needs version 2 (a part that moves, or any of the extras).
    pub fn needs_v2(&self) -> bool {
        self.parts.iter().any(|p| p.body != NO_BODY) || self.extras != PartsExtras::default()
    }

    /// The `WPT1` bytes of this spec: version 1 when it does not need 2 ([`PartsSpec::needs_v2`]),
    /// so a spec of before keeps its bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let v2 = self.needs_v2();
        let mut words: Vec<u32> = vec![
            if v2 { PARTS_VERSION } else { 1 },
            self.seed,
            self.cell_mm.to_bits(),
            self.max_samples,
            self.repose_deg.to_bits(),
            self.snow_repose_deg.to_bits(),
            self.meshes.len() as u32,
        ];
        for m in &self.meshes {
            words.push(m.positions.len() as u32);
            words.push(m.indices.len() as u32);
            for p in &m.positions {
                words.extend_from_slice(&[p.x.to_bits(), p.y.to_bits(), p.z.to_bits()]);
            }
            words.extend_from_slice(&m.indices);
        }
        words.push(self.parts.len() as u32);
        for p in &self.parts {
            words.push(p.mesh);
            for row in &p.transform.rows {
                for v in row {
                    words.push(v.to_bits());
                }
            }
            words.extend_from_slice(&[
                p.advancing_deg.to_bits(),
                p.receding_deg.to_bits(),
                p.soak_mm_s.to_bits(),
                p.flags,
            ]);
            if v2 {
                words.push(p.body);
            }
        }
        words.push(self.sources.len() as u32);
        for s in &self.sources {
            words.extend_from_slice(&[
                s.kind.to_u32(),
                s.density.to_bits(),
                s.velocity.x.to_bits(),
                s.velocity.y.to_bits(),
                s.velocity.z.to_bits(),
                s.size_mm.to_bits(),
                s.size_var.to_bits(),
            ]);
        }
        if v2 {
            let e = &self.extras;
            words.extend_from_slice(&[e.wind.x.to_bits(), e.wind.y.to_bits(), e.wind.z.to_bits()]);
            match e.floor {
                None => words.push(0),
                Some(f) => words.extend_from_slice(&[
                    1,
                    f.z.to_bits(),
                    f.min[0].to_bits(),
                    f.min[1].to_bits(),
                    f.max[0].to_bits(),
                    f.max[1].to_bits(),
                    f.cell_mm.to_bits(),
                    f.max_cells,
                ]),
            }
            words.push(e.edge_cell_mm.to_bits());
            words.push(e.edge_budget);
        }
        let mut out = Vec::with_capacity(4 + 4 * words.len());
        out.extend_from_slice(PARTS_MAGIC);
        for w in words {
            out.extend_from_slice(&w.to_le_bytes());
        }
        out
    }
}

/// The index of sample `(i, j)` of a triangle of resolution `r` among its samples: row `j` after
/// the rows before it (`(r + 1 − k)` samples each), `i` along it.
pub fn sample_index(r: u32, i: u32, j: u32) -> u32 {
    j * (r + 1) - j * j.saturating_sub(1) / 2 + i
}

/// Samples of a triangle of resolution `r`.
pub fn samples_of(r: u32) -> u32 {
    (r + 1) * (r + 2) / 2
}

/// The steps per side of a triangle whose longest edge is `longest` mm and whose area is `area`
/// mm², at a cell of `cell` mm: the longest edge over the cell, but no more than twice the side of
/// the square of the triangle's area over it (a sliver, a long thin strip of a backdrop's cove,
/// would otherwise spend thousands of samples on a band a millimetre wide); at least 1 and at most
/// [`MAX_RESOLUTION`].
pub fn resolution_of(longest: f32, area: f32, cell: f32) -> u32 {
    let r = (longest / cell)
        .ceil()
        .min((2.0 * area.max(0.0).sqrt() / cell).ceil());
    if r.is_nan() || r < 1.0 {
        1
    } else {
        (r as u32).min(MAX_RESOLUTION)
    }
}

/// The share of particles that rest on a face `alpha_deg` from the horizontal under an angle of
/// repose `repose_deg`: 1 below it less [`REPOSE_SPREAD_DEG`], 0 above it plus that, a smooth step
/// between (the rule of the front glass, [`crate::wet`]).
pub fn kept_at(alpha_deg: f32, repose_deg: f32) -> f32 {
    let lo = repose_deg - REPOSE_SPREAD_DEG;
    let hi = repose_deg + REPOSE_SPREAD_DEG;
    if alpha_deg <= lo {
        1.0
    } else if alpha_deg >= hi {
        0.0
    } else {
        let t = (alpha_deg - lo) / (hi - lo);
        1.0 - t * t * (3.0 - 2.0 * t)
    }
}

/// The inverse of an object-to-world transform (the identity for a singular one).
fn inverse(t: &Transform) -> Transform {
    let r = &t.rows;
    let (a, b, c) = (r[0][0], r[0][1], r[0][2]);
    let (d, e, f) = (r[1][0], r[1][1], r[1][2]);
    let (g, h, i) = (r[2][0], r[2][1], r[2][2]);
    let co = [
        e * i - f * h,
        f * g - d * i,
        d * h - e * g,
        c * h - b * i,
        a * i - c * g,
        b * g - a * h,
        b * f - c * e,
        c * d - a * f,
        a * e - b * d,
    ];
    let det = a * co[0] + b * co[1] + c * co[2];
    if !above(det.abs(), 1.0e-20) || !det.is_finite() {
        return Transform::IDENTITY;
    }
    let k = 1.0 / det;
    let m = [
        [co[0] * k, co[3] * k, co[6] * k],
        [co[1] * k, co[4] * k, co[7] * k],
        [co[2] * k, co[5] * k, co[8] * k],
    ];
    let tr = [r[0][3], r[1][3], r[2][3]];
    let mut rows = [[0.0f32; 4]; 3];
    for (row, mi) in rows.iter_mut().zip(m.iter()) {
        row[0] = mi[0];
        row[1] = mi[1];
        row[2] = mi[2];
        row[3] = -(mi[0] * tr[0] + mi[1] * tr[1] + mi[2] * tr[2]);
    }
    Transform { rows }
}

/// A triangle of a part, world space.
#[derive(Clone, Copy, Debug)]
struct Tri {
    v: [Vec3; 3],
    /// Unit normal (counter-clockwise), zero for a degenerate triangle.
    n: Vec3,
    area: f32,
    /// The triangle across edge `k` (from corner `k` to corner `k + 1`), or [`NEVER`].
    nb: [u32; 3],
    part: u32,
    res: u32,
    /// Its first sample (global index).
    first: u32,
}

/// A part as the simulation holds it.
#[derive(Clone, Copy, Debug)]
struct Part {
    first_tri: u32,
    tris: u32,
    first_sample: u32,
    samples: u32,
    /// `K(θ̄)`, the hysteresis `cos θ_R − cos θ_A`, `sin θ̄`, `θ̄` in degrees.
    k: f32,
    hysteresis: f32,
    sin_cap: f32,
    cap_deg: f32,
    /// S3f: the advancing and receding contact angles, radians.
    advancing: f32,
    receding: f32,
    soak: f32,
    film: bool,
    /// World to object: S3e: where a part that moves stands now.
    to_object: Transform,
    /// S3e: the effective gravity on its drops over `g` (−Z for a part that stays; for one that
    /// moves, less the acceleration of its centre: in free fall it is nothing).
    gravity: Vec3,
    /// S3e: its index among the parts that move, or none.
    mover: Option<u32>,
}

/// A drop on a part.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Drop {
    /// Its number, in the order drops came (a merge keeps the lower index's).
    id: u32,
    /// Changed since the last frame.
    touched: bool,
    part: u32,
    tri: u32,
    p: Vec3,
    volume: f32,
    /// Its contact radius (of `volume` at its part's cap).
    a: f32,
    /// New or moved since the last merge: it may touch another.
    fresh: bool,
    /// S3f: where it was when this step's slide began: it swept the segment from there (world).
    from: Vec3,
    /// S3f: its velocity along the surface in its last slide, mm/s (zero when pinned).
    vel: Vec3,
    /// S3f: pinned, its weight along the face over the hold of its contact line (0..1).
    load: f32,
    /// S3f: sliding, its capillary number `μ v / γ` (0 when pinned).
    ca: f32,
    /// S3f: the merge it relaxes from.
    merging: Merging,
    /// S3f: hanging, its weight over what its contact line holds (0 when it does not hang).
    hang: f32,
    /// S3f: how far it has pinched off, 0..1.
    pinch: f32,
    /// S3f: held at an open edge of its mesh.
    edge: bool,
    /// S3g: pearling, how far it has still to run until its next pearl, mm (0: it does not pearl).
    run: f32,
    /// S3e: the open edge it is held at (`3 × triangle + k`, the edge from corner `k` to `k + 1`), or
    /// [`NEVER`].
    edge_at: u32,
}

/// S3f: a merge a drop relaxes from (see [`WetParts::merge`]): its outline first spans the two drops
/// along `axis`, stretched by `along` and `across` with a neck between them and off its centre by
/// `shift` contact radii, all of it relaxing by the share `left`; `pull` is what is left of the way
/// to the centre of volume of the two (world).
#[derive(Clone, Copy, Debug, PartialEq)]
struct Merging {
    axis: Vec3,
    along: f32,
    across: f32,
    neck: f32,
    shift: f32,
    left: f32,
    pull: Vec3,
}

impl Merging {
    const NONE: Merging = Merging {
        axis: Vec3::ZERO,
        along: 1.0,
        across: 1.0,
        neck: 0.0,
        shift: 0.0,
        left: 0.0,
        pull: Vec3::ZERO,
    };
}

impl Drop {
    fn new(id: u32, part: u32, tri: u32, p: Vec3, volume: f32, k: f32) -> Drop {
        Drop {
            id,
            touched: true,
            part,
            tri,
            p,
            volume,
            a: cbrt(volume / k),
            fresh: true,
            from: p,
            vel: Vec3::ZERO,
            load: 0.0,
            ca: 0.0,
            merging: Merging::NONE,
            hang: 0.0,
            pinch: 0.0,
            edge: false,
            run: 0.0,
            edge_at: NEVER,
        }
    }
}

/// S3f: what the tests see of a drop on a part.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DropState {
    /// Its number.
    pub id: u32,
    /// Its part.
    pub part: u32,
    /// Its centre, world.
    pub p: Vec3,
    /// Its volume, mm³, and contact radius, mm.
    pub volume: f32,
    /// See [`DropState::volume`].
    pub a: f32,
    /// Its velocity along the surface in its last slide, mm/s (zero when pinned).
    pub velocity: Vec3,
    /// Held at an open edge.
    pub edge: bool,
    /// How far it has pinched off, 0..1 (hanging).
    pub pinch: f32,
    /// The share of a merge it has still to relax (0: none).
    pub merging: f32,
    /// The way left to the centre of volume of its last merge, world.
    pub pull: Vec3,
    /// S3g: hanging, its weight over what its contact line holds (0 when it does not hang).
    pub hang: f32,
}

/// S3f: the capillary time of a drop of contact radius `a` mm, `√(ρ a³ / γ)`, seconds.
fn capillary_time(a: f32) -> f32 {
    (CAPILLARY * a * a * a).max(0.0).sqrt()
}

/// S3f: the distance from `q` to the segment `a b`.
fn to_segment(q: Vec3, a: Vec3, b: Vec3) -> f32 {
    let ab = b - a;
    let l2 = ab.length_squared();
    let t = if l2 > 0.0 {
        ((q - a).dot(ab) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (q - a - ab * t).length()
}

/// S3f: Cox–Voinov's dynamic contact angles of a drop sliding at capillary number `ca` on a surface
/// of advancing and receding angles `advancing` and `receding` (radians): its front's and its
/// rear's, `∛(θ_A³ + 9 Ca Λ)` and `∛(max(0, θ_R³ − 9 Ca Λ))`.
pub fn dynamic_angles(advancing: f32, receding: f32, ca: f32) -> (f32, f32) {
    let cv = 9.0 * ca.max(0.0) * COX_VOINOV_LOG;
    (
        cbrt(advancing * advancing * advancing + cv),
        cbrt((receding * receding * receding - cv).max(0.0)),
    )
}

/// S3f: the shape of a drop along its axis (left zero: the caller's) on a surface of contact angles
/// `advancing_deg ≥ receding_deg`, from its physics: pinned (`ca` 0) with its weight along the face
/// over the hold of its contact line `load` (0..1), or sliding at capillary number `ca`. Its front and
/// rear contact angles (the mean moved by the load towards the advancing and the receding ones, or
/// Cox–Voinov's dynamic ones, [`dynamic_angles`]) shear its top downhill by
/// `q tan(θ̄/2) / tan θ̄`, `q = (θ_f − θ_b) / (θ_f + θ_b)` (the shear of a cap whose front and rear
/// slopes are those angles, in the small-slope limit); it is longer by [`PIN_STRETCH`] × the
/// hysteresis × the load, and sliding by [`SLIDE_STRETCH`] and thinner at its tail by
/// [`SLIDE_TAPER`] as its rear angle falls from the receding one to 0.
pub fn base_shape(advancing_deg: f32, receding_deg: f32, load: f32, ca: f32) -> DropShape {
    let adv = advancing_deg.clamp(1.0, 179.0) * fmath::DEG_TO_RAD;
    let rec = receding_deg.clamp(0.0, 179.0).min(advancing_deg) * fmath::DEG_TO_RAD;
    let mean = 0.5 * (adv + rec);
    let hysteresis = (fmath::cos(rec) - fmath::cos(adv)).max(0.0);
    let (front, rear, aspect, taper) = if ca > 0.0 {
        let (front, rear) = dynamic_angles(adv, rec, ca);
        let fall = if rec > 0.0 {
            (1.0 - rear / rec).clamp(0.0, 1.0)
        } else {
            1.0
        };
        (
            front,
            rear,
            1.0 + PIN_STRETCH * hysteresis + SLIDE_STRETCH * fall,
            SLIDE_TAPER * fall,
        )
    } else {
        let l = load.clamp(0.0, 1.0);
        (
            mean + l * (adv - mean),
            mean - l * (mean - rec),
            1.0 + PIN_STRETCH * hysteresis * l,
            0.0,
        )
    };
    let q = if front + rear > 0.0 {
        (front - rear) / (front + rear)
    } else {
        0.0
    };
    let m = mean.clamp(1.0 * fmath::DEG_TO_RAD, 85.0 * fmath::DEG_TO_RAD);
    let (sh, ch) = fmath::sin_cos(0.5 * m);
    let (sm, cm) = fmath::sin_cos(m);
    DropShape {
        aspect: aspect.clamp(1.0, MAX_ASPECT),
        bulge: (q * (sh / ch) / (sm / cm)).clamp(-2.0, 2.0),
        taper: taper.clamp(-0.95, 0.95),
        ..DropShape::ROUND
    }
}

/// S3g: a unit vector in the plane of normal `n` (the world axis least along it, crossed with it).
fn tangent_of(n: Vec3) -> Vec3 {
    let pick = if n.x.abs() <= n.y.abs() && n.x.abs() <= n.z.abs() {
        Vec3::new(1.0, 0.0, 0.0)
    } else if n.y.abs() <= n.z.abs() {
        Vec3::new(0.0, 1.0, 0.0)
    } else {
        Vec3::new(0.0, 0.0, 1.0)
    };
    n.cross(pick).normalize()
}

/// The linear part of `t` applied to `v`.
fn vector(t: &Transform, v: Vec3) -> Vec3 {
    let r = &t.rows;
    Vec3::new(
        r[0][0] * v.x + r[0][1] * v.y + r[0][2] * v.z,
        r[1][0] * v.x + r[1][1] * v.y + r[1][2] * v.z,
        r[2][0] * v.x + r[2][1] * v.y + r[2][2] * v.z,
    )
}

/// S3d: a drop in the air (a drip, a splash's drop), world space.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Falling {
    /// Its number (the drops' numbering: it came after the drops before it).
    id: u32,
    /// The part it left.
    part: u32,
    p: Vec3,
    /// Velocity, mm/s.
    v: Vec3,
    volume: f32,
    /// Steps in the air.
    steps: u32,
}

/// The diameter of a sphere of `volume` mm³, mm.
fn diameter_of(volume: f32) -> f32 {
    cbrt(6.0 * volume / fmath::PI)
}

/// S3d: the terminal speed of a drop of water of diameter `d` mm in still air, mm/s: Atlas,
/// Srivastava and Sekhon (1973), `9.65 − 10.3 e^(−0.6 D)` m/s, above 0.6 mm; below it, linear in
/// the diameter down to 0 (the measurements of small drops are close to a line there).
pub fn terminal_speed(d: f32) -> f32 {
    const D0: f32 = 0.6;
    let atlas = |d: f32| (9.65 - 10.3 * fmath::exp(-0.6 * d)) * 1000.0;
    if d >= D0 {
        atlas(d)
    } else {
        atlas(D0) * d.max(0.0) / D0
    }
}

/// A binary tree of boxes over the triangles for rays (median split of the longest axis of the
/// centroids, ties by index: the same everywhere).
#[derive(Clone, Debug, Default)]
struct RayTree {
    /// (bounds, first, count): count 0 is an inner node whose children are `first` and `first + 1`.
    nodes: Vec<(Aabb, u32, u32)>,
    /// Triangle indices in leaf order.
    order: Vec<u32>,
}

const RAY_LEAF: usize = 4;

impl RayTree {
    fn build(tris: &[Tri]) -> RayTree {
        RayTree::build_where(tris, |_| true)
    }

    /// The tree over the triangles `keep` takes (S3e: the parts that stay).
    fn build_where(tris: &[Tri], keep: impl Fn(&Tri) -> bool) -> RayTree {
        let mut order: Vec<u32> = (0..tris.len() as u32)
            .filter(|&i| tris[i as usize].area > 0.0 && keep(&tris[i as usize]))
            .collect();
        let mut nodes = Vec::new();
        if order.is_empty() {
            return RayTree { nodes, order };
        }
        let centroid = |i: u32| {
            let t = &tris[i as usize];
            (t.v[0] + t.v[1] + t.v[2]) * (1.0 / 3.0)
        };
        nodes.push((Aabb::EMPTY, 0, 0));
        let mut stack = vec![(0usize, 0usize, order.len())];
        while let Some((node, start, end)) = stack.pop() {
            let mut b = Aabb::EMPTY;
            let mut cb = Aabb::EMPTY;
            for &i in &order[start..end] {
                let t = &tris[i as usize];
                b = b.union(Aabb::new(
                    t.v[0].min(t.v[1]).min(t.v[2]),
                    t.v[0].max(t.v[1]).max(t.v[2]),
                ));
                cb = cb.extend(centroid(i));
            }
            if end - start <= RAY_LEAF {
                nodes[node] = (b, start as u32, (end - start) as u32);
                continue;
            }
            let size = cb.max - cb.min;
            let axis = if size.x >= size.y && size.x >= size.z {
                0
            } else if size.y >= size.z {
                1
            } else {
                2
            };
            let key = |i: u32| {
                let c = centroid(i);
                match axis {
                    0 => c.x,
                    1 => c.y,
                    _ => c.z,
                }
            };
            order[start..end].sort_by(|&a, &b| key(a).total_cmp(&key(b)).then(a.cmp(&b)));
            let mid = (start + end) / 2;
            let left = nodes.len();
            nodes.push((Aabb::EMPTY, 0, 0));
            nodes.push((Aabb::EMPTY, 0, 0));
            nodes[node] = (b, left as u32, 0);
            stack.push((left + 1, mid, end));
            stack.push((left, start, mid));
        }
        RayTree { nodes, order }
    }

    /// The nearest triangle `ray` meets within `(0, t_max)` that `accept` takes: its index and
    /// distance. With `any`, the first one found.
    fn cast(
        &self,
        tris: &[Tri],
        origin: Vec3,
        dir: Vec3,
        t_max: f32,
        any: bool,
        accept: impl Fn(u32) -> bool,
    ) -> Option<(u32, f32)> {
        if self.nodes.is_empty() {
            return None;
        }
        let inv = Vec3::new(1.0 / dir.x, 1.0 / dir.y, 1.0 / dir.z);
        let mut best: Option<(u32, f32)> = None;
        let mut limit = t_max;
        let mut stack = vec![0u32];
        while let Some(n) = stack.pop() {
            let (b, first, count) = self.nodes[n as usize];
            if !slab(&b, origin, inv, limit) {
                continue;
            }
            if count == 0 {
                stack.push(first + 1);
                stack.push(first);
                continue;
            }
            for &i in &self.order[first as usize..(first + count) as usize] {
                if let Some(t) = ray_triangle(&tris[i as usize], origin, dir) {
                    if t < limit && accept(i) {
                        limit = t;
                        best = Some((i, t));
                        if any {
                            return best;
                        }
                    }
                }
            }
        }
        best
    }
}

/// True when the ray meets the box before `t_max`.
fn slab(b: &Aabb, o: Vec3, inv: Vec3, t_max: f32) -> bool {
    let mut t0 = 0.0f32;
    let mut t1 = t_max;
    for (lo, hi, o, inv) in [
        (b.min.x, b.max.x, o.x, inv.x),
        (b.min.y, b.max.y, o.y, inv.y),
        (b.min.z, b.max.z, o.z, inv.z),
    ] {
        let (a, c) = ((lo - o) * inv, (hi - o) * inv);
        let (near, far) = if a <= c { (a, c) } else { (c, a) };
        // NaN (a zero direction on a box face) leaves the bounds as they are.
        if near > t0 {
            t0 = near;
        }
        if far < t1 {
            t1 = far;
        }
        if t0 > t1 {
            return false;
        }
    }
    true
}

/// Möller–Trumbore: the distance along `dir` where the ray meets the triangle (either face).
fn ray_triangle(t: &Tri, o: Vec3, d: Vec3) -> Option<f32> {
    let e1 = t.v[1] - t.v[0];
    let e2 = t.v[2] - t.v[0];
    let p = d.cross(e2);
    let det = e1.dot(p);
    if det.abs() < 1.0e-12 {
        return None;
    }
    let inv = 1.0 / det;
    let s = o - t.v[0];
    let u = s.dot(p) * inv;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = s.cross(e1);
    let v = d.dot(q) * inv;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let dist = e2.dot(q) * inv;
    (dist > 1.0e-4).then_some(dist)
}

/// The samples by cell of a uniform grid, sorted by (cell, sample): a range of a cell is found by
/// binary search.
#[derive(Clone, Debug, Default)]
struct SampleGrid {
    origin: Vec3,
    cell: f32,
    dims: [u64; 3],
    entries: Vec<(u64, u32)>,
}

impl SampleGrid {
    fn new(pos: &[Vec3], cell: f32) -> SampleGrid {
        let mut b = Aabb::EMPTY;
        for &p in pos {
            b = b.extend(p);
        }
        if pos.is_empty() {
            return SampleGrid::default();
        }
        let size = b.max - b.min;
        let dim = |s: f32| ((s / cell).floor() as u64 + 1).clamp(1, 1 << 20);
        let mut g = SampleGrid {
            origin: b.min,
            cell,
            dims: [dim(size.x), dim(size.y), dim(size.z)],
            entries: Vec::with_capacity(pos.len()),
        };
        for (i, &p) in pos.iter().enumerate() {
            let c = g.cell_of(p);
            g.entries.push((g.key(c), i as u32));
        }
        g.entries.sort_unstable();
        g
    }

    fn cell_of(&self, p: Vec3) -> [u64; 3] {
        let f = |v: f32, o: f32, d: u64| {
            let i = ((v - o) / self.cell).floor();
            if i.is_nan() || i < 0.0 {
                0
            } else {
                (i as u64).min(d - 1)
            }
        };
        [
            f(p.x, self.origin.x, self.dims[0]),
            f(p.y, self.origin.y, self.dims[1]),
            f(p.z, self.origin.z, self.dims[2]),
        ]
    }

    fn key(&self, c: [u64; 3]) -> u64 {
        (c[2] * self.dims[1] + c[1]) * self.dims[0] + c[0]
    }

    /// Appends the samples in the cells the box `[lo, hi]` touches.
    fn query(&self, lo: Vec3, hi: Vec3, out: &mut Vec<u32>) {
        if self.entries.is_empty() {
            return;
        }
        let (a, b) = (self.cell_of(lo), self.cell_of(hi));
        for z in a[2]..=b[2] {
            for y in a[1]..=b[1] {
                let k0 = self.key([a[0], y, z]);
                let k1 = self.key([b[0], y, z]);
                let start = self.entries.partition_point(|e| e.0 < k0);
                for e in &self.entries[start..] {
                    if e.0 > k1 {
                        break;
                    }
                    out.push(e.1);
                }
            }
        }
    }
}

/// A source as the simulation holds it.
#[derive(Clone, Debug, Default)]
struct SourceState {
    /// Triangles that take its drops (global), and their running sum of `cos × area`.
    tris: Vec<u32>,
    cdf: Vec<f32>,
    /// The mean landings per step.
    lambda: f32,
}

/// What [`WetParts::walk`] does with a drop's direction.
#[derive(Clone, Copy, Debug)]
enum Course {
    /// Down the slope of each triangle it is on, under the gravity given (S3e: a part that moves
    /// has its own).
    Downhill(Vec3),
    /// Straight on along the surface (a splash, a merge).
    Straight(Vec3),
}

/// Where a walk ended.
#[derive(Clone, Copy, Debug)]
struct WalkEnd {
    tri: u32,
    p: Vec3,
    /// It left the mesh over an open edge, there.
    off: bool,
    /// S3e: that edge (`3 × triangle + k`), or [`NEVER`].
    edge: u32,
    moved: f32,
}

/// S3e: a part that moves with a body of the rigid-body scene: its geometry where it stood at the
/// start (its rest, world), with its own trees for rays and samples there, and where it stands now.
#[derive(Clone, Debug)]
struct Mover {
    part: u32,
    /// The dynamic body of the `PHY1` scene it moves with (its order among the dynamic bodies).
    body: u32,
    /// Its triangles at rest (indices local to the part) and a tree over them.
    rest_tris: Vec<Tri>,
    tree: RayTree,
    /// Its samples at rest, and a grid over them.
    rest_pos: Vec<Vec3>,
    grid: SampleGrid,
    /// The centre of its triangles at rest (the point whose acceleration its drops feel).
    centre: Vec3,
    /// Rest to now, now and the two steps before; now to rest.
    now: Transform,
    prev: Transform,
    prev2: Transform,
    now_inv: Transform,
    /// Object to rest (its spec's transform) inverted: world to object at rest.
    to_object0: Transform,
    /// The pose of its body at the start, inverted (rest = start), once the poses began.
    start_inv: Option<Transform>,
}

/// S3e: the studio floor as a film of square cells (see [`FloorSpec`]).
#[derive(Clone, Debug)]
struct FloorGrid {
    z: f32,
    x0: f32,
    y0: f32,
    cell: f32,
    nx: u32,
    ny: u32,
    /// The step each cell was first wet in ([`NEVER`]).
    wet: Vec<u32>,
    dust_rate: Vec<f32>,
    snow_rate: Vec<f32>,
    /// The cells by the step the rain wets them in (the film), and how many are done.
    film: Vec<(u32, u32)>,
    film_done: usize,
    /// First wet since the last frame.
    new_wet: Vec<u32>,
    /// Water that landed on it from the air, mm³, and how many drops.
    water: f32,
    landed: u32,
}

impl FloorGrid {
    fn cells(&self) -> usize {
        (self.nx * self.ny) as usize
    }

    /// The centre of cell `c`, world.
    fn centre(&self, c: u32) -> Vec3 {
        let (i, j) = (c % self.nx, c / self.nx);
        Vec3::new(
            self.x0 + (i as f32 + 0.5) * self.cell,
            self.y0 + (j as f32 + 0.5) * self.cell,
            self.z,
        )
    }

    /// The cells whose centre is within `r` of `(x, y)`.
    fn disc(&self, x: f32, y: f32, r: f32, out: &mut Vec<u32>) {
        out.clear();
        let lo = |v: f32, o: f32, n: u32| {
            (((v - r - o) / self.cell - 0.5).ceil().max(0.0) as u32).min(n)
        };
        let hi = |v: f32, o: f32, n: u32| {
            let k = ((v + r - o) / self.cell - 0.5).floor();
            if k < 0.0 {
                None
            } else {
                Some((k as u32).min(n - 1))
            }
        };
        let (Some(i1), Some(j1)) = (hi(x, self.x0, self.nx), hi(y, self.y0, self.ny)) else {
            return;
        };
        let (i0, j0) = (lo(x, self.x0, self.nx), lo(y, self.y0, self.ny));
        for j in j0..=j1 {
            for i in i0..=i1 {
                let c = j * self.nx + i;
                let q = self.centre(c);
                let (dx, dy) = (q.x - x, q.y - y);
                if dx * dx + dy * dy <= r * r {
                    out.push(c);
                }
            }
        }
    }

    /// True when `(x, y)` is over the floor's rectangle.
    fn covers(&self, x: f32, y: f32) -> bool {
        x >= self.x0
            && y >= self.y0
            && x <= self.x0 + self.nx as f32 * self.cell
            && y <= self.y0 + self.ny as f32 * self.cell
    }
}

/// `a` after `b` (`a ∘ b`).
fn compose(a: &Transform, b: &Transform) -> Transform {
    let (ra, rb) = (&a.rows, &b.rows);
    let mut rows = [[0.0f32; 4]; 3];
    for (i, row) in rows.iter_mut().enumerate() {
        for (j, v) in row.iter_mut().enumerate() {
            *v = ra[i][0] * rb[0][j] + ra[i][1] * rb[1][j] + ra[i][2] * rb[2][j];
        }
        row[3] += ra[i][3];
    }
    Transform { rows }
}

/// The state of the parts under their sources.
#[derive(Clone, Debug)]
pub struct WetParts {
    spec: PartsSpec,
    steps: u32,
    cell: f32,
    parts: Vec<Part>,
    tris: Vec<Tri>,
    pos: Vec<Vec3>,
    /// The triangle of each sample.
    sample_tri: Vec<u32>,
    /// The step each sample was first wet in ([`NEVER`]), and the last one the rain wiped it in
    /// (0: never, the dust piles from the start).
    wet: Vec<u32>,
    wiped: Vec<u32>,
    dust_rate: Vec<f32>,
    snow_rate: Vec<f32>,
    has_dust: bool,
    has_snow: bool,
    grid: SampleGrid,
    /// Rays: the triangles of the parts that stay (S3e: each part that moves has its own).
    tree: RayTree,
    sources: Vec<SourceState>,
    drops: Vec<Drop>,
    /// The film's samples by the step they get wet in, and how many of them are done.
    film: Vec<(u32, u32)>,
    film_done: usize,
    /// Since the last frame: samples first wet, samples wiped, drips.
    new_wet: Vec<u32>,
    new_wiped: Vec<u32>,
    wiped_mark: Vec<u32>,
    frame_no: u32,
    drips_since: u32,
    /// Totals (measures for the tests and the meter).
    landed: u32,
    splashes: u32,
    drips: u32,
    shed: f32,
    lost_water: f32,
    scratch: Vec<u32>,
    /// Drops were put by hand since the last merge.
    dirty: bool,
    /// The number of the next drop, and the drops gone since the last frame.
    next_id: u32,
    gone_ids: Vec<u32>,
    /// S3d: the drops in the air, by number; below `floor_z` they are gone.
    falling: Vec<Falling>,
    floor_z: f32,
    /// Drops that landed from the air so far.
    flown: u32,
    /// S3e: the air the drops in the air are in, and whether it moves.
    wind: Vec3,
    windy: bool,
    /// S3e: the parts that move, and whether their poses began.
    movers: Vec<Mover>,
    posed: bool,
    /// S3e: for each open edge (`3 × triangle + k`), the open edge of the same part at its first
    /// corner and at its second ([`NEVER`]: none, or the edge is not open).
    edge_next: Vec<[u32; 2]>,
    /// S3e: the studio floor, or none.
    floor: Option<FloorGrid>,
    /// S3e: film triangles a shadow edge refined.
    refined: u32,
    /// S3g: the drops that started to slide from rest, as they were then (at most [`MAX_DEPINS`]).
    depins: Vec<Depin>,
    /// S3g: the pearls the runners left behind them.
    pearls: u32,
}

/// S3g: most depinnings [`WetParts::depins`] keeps.
pub const MAX_DEPINS: usize = 1 << 16;

/// S3g: a drop that started to slide from rest: its part, its contact radius (mm) and volume (mm³)
/// then, and the slope of its face (gravity along the face over gravity: `sin α`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Depin {
    /// Its part.
    pub part: u32,
    /// Its contact radius, mm.
    pub a: f32,
    /// Its volume, mm³.
    pub volume: f32,
    /// `sin α` of its face.
    pub slope: f32,
}

impl WetParts {
    /// Dry, clean parts under `spec`.
    pub fn new(spec: PartsSpec) -> WetParts {
        // The triangles, world space.
        let mut parts = Vec::with_capacity(spec.parts.len());
        let mut tris: Vec<Tri> = Vec::new();
        let mut movers: Vec<Mover> = Vec::new();
        for (pi, ps) in spec.parts.iter().enumerate() {
            let mesh = &spec.meshes[ps.mesh as usize];
            let first_tri = tris.len() as u32;
            let world: Vec<Vec3> = mesh
                .positions
                .iter()
                .map(|&p| ps.transform.apply(p))
                .collect();
            for t in mesh.indices.chunks_exact(3) {
                let v = [
                    world[t[0] as usize],
                    world[t[1] as usize],
                    world[t[2] as usize],
                ];
                let c = (v[1] - v[0]).cross(v[2] - v[0]);
                let len = c.length();
                let ok = len > 0.0 && len.is_finite();
                tris.push(Tri {
                    v,
                    n: if ok { c / len } else { Vec3::ZERO },
                    area: if ok { 0.5 * len } else { 0.0 },
                    nb: [NEVER; 3],
                    part: pi as u32,
                    res: 1,
                    first: 0,
                });
            }
            link(&mut tris[first_tri as usize..], first_tri, mesh);
            let (k, hysteresis) = cap_constants(ps.advancing_deg, ps.receding_deg);
            let cap_deg = (0.5 * (ps.advancing_deg + ps.receding_deg)).clamp(1.0, 179.0);
            let moves = ps.body != NO_BODY;
            let to_object = inverse(&ps.transform);
            let mover = if moves {
                let rest_tris: Vec<Tri> = tris[first_tri as usize..].to_vec();
                let tree = RayTree::build(&rest_tris);
                let mut centre = Vec3::ZERO;
                for t in &rest_tris {
                    centre += (t.v[0] + t.v[1] + t.v[2]) * (1.0 / 3.0);
                }
                if !rest_tris.is_empty() {
                    centre *= 1.0 / rest_tris.len() as f32;
                }
                movers.push(Mover {
                    part: pi as u32,
                    body: ps.body,
                    rest_tris,
                    tree,
                    rest_pos: Vec::new(),
                    grid: SampleGrid::default(),
                    centre,
                    now: Transform::IDENTITY,
                    prev: Transform::IDENTITY,
                    prev2: Transform::IDENTITY,
                    now_inv: Transform::IDENTITY,
                    to_object0: to_object,
                    start_inv: None,
                });
                Some(movers.len() as u32 - 1)
            } else {
                None
            };
            parts.push(Part {
                first_tri,
                tris: tris.len() as u32 - first_tri,
                first_sample: 0,
                samples: 0,
                k,
                hysteresis,
                sin_cap: fmath::sin(cap_deg * fmath::DEG_TO_RAD),
                cap_deg,
                advancing: ps.advancing_deg.clamp(1.0, 179.0) * fmath::DEG_TO_RAD,
                receding: ps.receding_deg.clamp(0.0, 179.0) * fmath::DEG_TO_RAD,
                soak: ps.soak_mm_s,
                // S3e: a part that moves takes its drops one by one.
                film: ps.flags & PART_FILM != 0 && !moves,
                to_object,
                gravity: Vec3::new(0.0, 0.0, -1.0),
                mover,
            });
        }
        // Rays: the parts that stay (each part that moves has its own tree, at rest).
        let tree = RayTree::build_where(&tris, |t| parts[t.part as usize].mover.is_none());
        let edge_next = open_edges(&tris);
        let wind = spec.extras.wind;
        let mut this = WetParts {
            steps: 0,
            cell: spec.cell_mm,
            parts,
            tris,
            pos: Vec::new(),
            sample_tri: Vec::new(),
            wet: Vec::new(),
            wiped: Vec::new(),
            dust_rate: Vec::new(),
            snow_rate: Vec::new(),
            has_dust: false,
            has_snow: false,
            grid: SampleGrid::default(),
            tree,
            sources: Vec::new(),
            drops: Vec::new(),
            film: Vec::new(),
            film_done: 0,
            new_wet: Vec::new(),
            new_wiped: Vec::new(),
            wiped_mark: Vec::new(),
            frame_no: 0,
            drips_since: 0,
            landed: 0,
            splashes: 0,
            drips: 0,
            shed: 0.0,
            lost_water: 0.0,
            scratch: Vec::new(),
            dirty: false,
            next_id: 0,
            gone_ids: Vec::new(),
            falling: Vec::new(),
            floor_z: 0.0,
            flown: 0,
            wind,
            windy: wind != Vec3::ZERO,
            movers,
            posed: false,
            edge_next,
            floor: None,
            refined: 0,
            depins: Vec::new(),
            pearls: 0,
            spec,
        };
        this.place_samples();
        this.place_floor();
        this.prepare_sources();
        this
    }

    /// The samples of every triangle: the cells that keep every triangle's grid under the budget
    /// (the film parts, a set: large, flat, shaded, never walked, take a third of it at most when
    /// there are parts that take drops, which take the rest; a sliver's steps follow its area, not
    /// its longest edge); S3e: the film triangles a shadow edge crosses, finer.
    fn place_samples(&mut self) {
        let spec = &self.spec;
        let tris = &self.tris;
        let parts = &self.parts;
        let longest = |t: &Tri| {
            let e = [t.v[1] - t.v[0], t.v[2] - t.v[1], t.v[0] - t.v[2]];
            e[0].length().max(e[1].length()).max(e[2].length())
        };
        let res_of = |t: &Tri, cell: f32| resolution_of(longest(t), t.area, cell);
        let is_film = |t: &Tri| parts[t.part as usize].film;
        let fit = |film: bool, budget: u64| {
            let mut cell = spec.cell_mm;
            for _ in 0..200 {
                let total: u64 = tris
                    .iter()
                    .filter(|t| is_film(t) == film)
                    .map(|t| u64::from(samples_of(res_of(t, cell))))
                    .sum();
                if total <= budget {
                    return (cell, total);
                }
                cell *= 1.25;
            }
            (cell, budget)
        };
        let budget = u64::from(spec.max_samples);
        let any_drops = tris.iter().any(|t| !is_film(t));
        let (film_cell, film_total) = fit(true, if any_drops { budget / 3 } else { budget });
        let (cell, _) = fit(false, budget.saturating_sub(film_total));
        let mut res: Vec<u32> = tris
            .iter()
            .map(|t| res_of(t, if is_film(t) { film_cell } else { cell }))
            .collect();
        // S3e: a film triangle whose coarse grid sees a source's shadow edge (some of its points in
        // the open, some under something) takes the fine cell, as long as the refined ones keep to
        // their budget.
        let edge_cell = spec.extras.edge_cell_mm;
        if edge_cell > 0.0 && spec.extras.edge_budget > 0 {
            let dirs: Vec<Vec3> = spec
                .sources
                .iter()
                .filter(|s| s.density > 0.0 && s.size_mm > 0.0 && s.velocity.length() > 0.0)
                .map(|s| s.velocity / s.velocity.length())
                .collect();
            let mut edge = Vec::new();
            for (ti, t) in tris.iter().enumerate() {
                if !is_film(t) || !above(t.area, 0.0) {
                    continue;
                }
                let r = res[ti].clamp(1, EDGE_PROBES);
                let inv = 1.0 / r as f32;
                let (e1, e2) = (t.v[1] - t.v[0], t.v[2] - t.v[0]);
                let crossed = dirs.iter().any(|&dir| {
                    if !above(-dir.dot(t.n), 0.0) {
                        return false;
                    }
                    let (mut open, mut shut) = (false, false);
                    for j in 0..=r {
                        for i in 0..=r - j {
                            let p = t.v[0] + e1 * (i as f32 * inv) + e2 * (j as f32 * inv);
                            if self.blocked(p + t.n * RAY_OFFSET, -dir) {
                                shut = true;
                            } else {
                                open = true;
                            }
                            if open && shut {
                                return true;
                            }
                        }
                    }
                    false
                });
                if crossed {
                    edge.push(ti);
                }
            }
            let fine = |t: &Tri, c: f32, coarse: u32| {
                let r = (longest(t) / c)
                    .ceil()
                    .min((2.0 * t.area.max(0.0).sqrt() / c).ceil());
                let r = if r.is_nan() || r < 1.0 {
                    1
                } else {
                    (r as u32).min(MAX_FINE_RESOLUTION)
                };
                r.max(coarse)
            };
            let mut c = edge_cell;
            for _ in 0..200 {
                let total: u64 = edge
                    .iter()
                    .map(|&ti| u64::from(samples_of(fine(&tris[ti], c, res[ti]))))
                    .sum();
                if total <= u64::from(spec.extras.edge_budget) {
                    break;
                }
                c *= 1.25;
            }
            let mut refined = 0;
            for &ti in &edge {
                let r = fine(&tris[ti], c, res[ti]);
                if r > res[ti] {
                    res[ti] = r;
                    refined += 1;
                }
            }
            self.refined = refined;
        }
        // The samples.
        let mut pos = Vec::new();
        let mut sample_tri = Vec::new();
        for (ti, t) in self.tris.iter_mut().enumerate() {
            t.res = res[ti];
            t.first = pos.len() as u32;
            let r = t.res;
            let inv = 1.0 / r as f32;
            let (e1, e2) = (t.v[1] - t.v[0], t.v[2] - t.v[0]);
            for j in 0..=r {
                for i in 0..=r - j {
                    pos.push(t.v[0] + e1 * (i as f32 * inv) + e2 * (j as f32 * inv));
                    sample_tri.push(ti as u32);
                }
            }
        }
        for p in self.parts.iter_mut() {
            p.first_sample = self
                .tris
                .get(p.first_tri as usize)
                .map_or(pos.len() as u32, |t| t.first);
            let end = self
                .tris
                .get((p.first_tri + p.tris) as usize)
                .map_or(pos.len() as u32, |t| t.first);
            p.samples = end - p.first_sample;
        }
        // S3e: the samples of the parts that move, at rest, with a grid of their own.
        let grid_cell = (2.0 * cell).max(4.0);
        for m in self.movers.iter_mut() {
            let p = &self.parts[m.part as usize];
            let range = p.first_sample as usize..(p.first_sample + p.samples) as usize;
            m.rest_pos = pos[range].to_vec();
            m.grid = SampleGrid::new(&m.rest_pos, grid_cell);
            for (rt, t) in m
                .rest_tris
                .iter_mut()
                .zip(&self.tris[p.first_tri as usize..])
            {
                rt.res = t.res;
                rt.first = t.first;
            }
        }
        let n = pos.len();
        self.floor_z = self
            .tris
            .iter()
            .flat_map(|t| t.v)
            .fold(0.0f32, |m, v| m.min(v.z))
            - 1.0;
        if !self.movers.is_empty() {
            // S3e: a part that moves may come down to the studio floor.
            self.floor_z = self.floor_z.min(-1.0);
        }
        self.grid = SampleGrid::new(&pos, grid_cell);
        self.cell = cell;
        self.pos = pos;
        self.sample_tri = sample_tri;
        self.wet = vec![NEVER; n];
        self.wiped = vec![0; n];
        self.dust_rate = vec![0.0; n];
        self.snow_rate = vec![0.0; n];
        self.wiped_mark = vec![NEVER; n];
    }

    /// S3e: the studio floor's cells, when the spec has a floor.
    fn place_floor(&mut self) {
        let Some(f) = self.spec.extras.floor else {
            return;
        };
        let (w, h) = (f.max[0] - f.min[0], f.max[1] - f.min[1]);
        let mut cell = f.cell_mm;
        let dims = |c: f32| {
            (
                ((w / c).ceil() as u32).clamp(1, 1 << 16),
                ((h / c).ceil() as u32).clamp(1, 1 << 16),
            )
        };
        let (mut nx, mut ny) = dims(cell);
        for _ in 0..200 {
            if u64::from(nx) * u64::from(ny) <= u64::from(f.max_cells) {
                break;
            }
            cell *= 1.25;
            (nx, ny) = dims(cell);
        }
        let n = (nx * ny) as usize;
        self.floor = Some(FloorGrid {
            z: f.z,
            x0: f.min[0],
            y0: f.min[1],
            cell,
            nx,
            ny,
            wet: vec![NEVER; n],
            dust_rate: vec![0.0; n],
            snow_rate: vec![0.0; n],
            film: Vec::new(),
            film_done: 0,
            new_wet: Vec::new(),
            water: 0.0,
            landed: 0,
        });
        // The drops in the air are gone below it.
        self.floor_z = self.floor_z.min(f.z - 1.0);
    }

    /// The flux of every source: the drops' landing tables, the film's wet times, the rates of
    /// dust and snow.
    fn prepare_sources(&mut self) {
        let sources = self.spec.sources.clone();
        for (si, s) in sources.iter().enumerate() {
            let speed = s.velocity.length();
            let mut state = SourceState::default();
            if !(s.density > 0.0 && speed > 0.0 && s.size_mm > 0.0) {
                self.sources.push(state);
                continue;
            }
            let dir = s.velocity / speed;
            let var = s.size_var.clamp(0.0, 1.0);
            match s.kind {
                PartsSourceKind::Drops => {
                    let mut sum = 0.0f32;
                    for (ti, t) in self.tris.iter().enumerate() {
                        let cos = -dir.dot(t.n);
                        // S3e: a part that moves takes its share step by step, where it stands.
                        let p = &self.parts[t.part as usize];
                        if !(cos > 0.0 && t.area > 0.0) || p.film || p.mover.is_some() {
                            continue;
                        }
                        sum += cos * t.area;
                        state.tris.push(ti as u32);
                        state.cdf.push(sum);
                    }
                    state.lambda = s.density * speed * sum * STEP;
                    // The film parts: each sample wet at its first landing (an exponential time).
                    let spread = 0.5 * LANDING_SPREAD * s.size_mm;
                    let reach = fmath::PI * spread * spread * (1.0 + var * var / 3.0);
                    for pi in 0..self.parts.len() {
                        if !self.parts[pi].film {
                            continue;
                        }
                        let (a, b) = (
                            self.parts[pi].first_sample,
                            self.parts[pi].first_sample + self.parts[pi].samples,
                        );
                        for smp in a..b {
                            let n = self.tris[self.sample_tri[smp as usize] as usize].n;
                            let cos = -dir.dot(n);
                            if !above(cos, 0.0) || !self.open(smp, dir) {
                                continue;
                            }
                            let rate = s.density * speed * cos * reach;
                            let u = unit(mix64(
                                u64::from(self.spec.seed) << 32
                                    ^ SALT_FILM
                                    ^ (u64::from(smp) << 8)
                                    ^ si as u64,
                            ));
                            let seconds = -fmath::ln(1.0 - u) / rate;
                            let step = (seconds * STEPS_PER_SECOND as f32).ceil();
                            if step.is_finite() && step < 1.0e9 {
                                self.film.push(((step as u32).max(1), smp));
                            }
                        }
                    }
                }
                PartsSourceKind::Dust | PartsSourceKind::Snow => {
                    let dust = s.kind == PartsSourceKind::Dust;
                    let r = 0.5 * s.size_mm;
                    // Per particle: the area of a mote, or the depth a flake adds per unit area.
                    let each = if dust {
                        fmath::PI * r * r * (1.0 + var * var / 3.0)
                    } else {
                        fmath::PI / 6.0 * s.size_mm * s.size_mm * s.size_mm * (1.0 + var * var)
                            / SNOW_PACKING
                    };
                    let repose = if dust {
                        self.spec.repose_deg
                    } else {
                        self.spec.snow_repose_deg
                    };
                    for smp in 0..self.pos.len() as u32 {
                        let t = &self.tris[self.sample_tri[smp as usize] as usize];
                        let n = t.n;
                        let cos = -dir.dot(n);
                        // S3e: dust and snow settle on the parts that stay.
                        if !above(cos, 0.0)
                            || n.z <= 0.0
                            || self.parts[t.part as usize].mover.is_some()
                        {
                            continue;
                        }
                        let alpha = fmath::acos(n.z.clamp(-1.0, 1.0)) / fmath::DEG_TO_RAD;
                        let keep = kept_at(alpha, repose);
                        if keep <= 0.0 || !self.open(smp, dir) {
                            continue;
                        }
                        let rate = s.density * speed * cos * keep * each;
                        if dust {
                            self.dust_rate[smp as usize] += rate;
                            self.has_dust = true;
                        } else {
                            self.snow_rate[smp as usize] += rate;
                            self.has_snow = true;
                        }
                    }
                }
            }
            self.sources.push(state);
            self.prepare_floor(si, s);
        }
        self.film.sort_unstable();
        if let Some(f) = self.floor.as_mut() {
            f.film.sort_unstable();
        }
    }

    /// S3e: what source `si` leaves on the studio floor's cells in the open (it is level: dust and
    /// snow rest on all of it): the rain as a film (each cell wet at its first landing, an
    /// exponential time), the rates of dust and snow.
    fn prepare_floor(&mut self, si: usize, s: &PartsSource) {
        let Some(mut f) = self.floor.take() else {
            return;
        };
        let speed = s.velocity.length();
        if s.density > 0.0 && speed > 0.0 && s.size_mm > 0.0 {
            let dir = s.velocity / speed;
            let cos = -dir.z;
            let var = s.size_var.clamp(0.0, 1.0);
            if above(cos, 0.0) {
                let each = match s.kind {
                    PartsSourceKind::Drops => {
                        let spread = 0.5 * LANDING_SPREAD * s.size_mm;
                        fmath::PI * spread * spread * (1.0 + var * var / 3.0)
                    }
                    PartsSourceKind::Dust => {
                        let r = 0.5 * s.size_mm;
                        fmath::PI * r * r * (1.0 + var * var / 3.0)
                    }
                    PartsSourceKind::Snow => {
                        fmath::PI / 6.0 * s.size_mm * s.size_mm * s.size_mm * (1.0 + var * var)
                            / SNOW_PACKING
                    }
                };
                let keep = match s.kind {
                    PartsSourceKind::Drops => 1.0,
                    PartsSourceKind::Dust => kept_at(0.0, self.spec.repose_deg),
                    PartsSourceKind::Snow => kept_at(0.0, self.spec.snow_repose_deg),
                };
                let rate = s.density * speed * cos * keep * each;
                for c in 0..f.cells() as u32 {
                    let origin = f.centre(c) + Vec3::new(0.0, 0.0, RAY_OFFSET);
                    if !above(rate, 0.0) || self.blocked(origin, -dir) {
                        continue;
                    }
                    match s.kind {
                        PartsSourceKind::Drops => {
                            let u = unit(mix64(
                                u64::from(self.spec.seed) << 32
                                    ^ SALT_FLOOR
                                    ^ (u64::from(c) << 8)
                                    ^ si as u64,
                            ));
                            let seconds = -fmath::ln(1.0 - u) / rate;
                            let step = (seconds * STEPS_PER_SECOND as f32).ceil();
                            if step.is_finite() && step < 1.0e9 {
                                f.film.push(((step as u32).max(1), c));
                            }
                        }
                        PartsSourceKind::Dust => f.dust_rate[c as usize] += rate,
                        PartsSourceKind::Snow => f.snow_rate[c as usize] += rate,
                    }
                }
            }
        }
        self.floor = Some(f);
    }

    /// True when nothing of the parts is in the way of sample `smp` upstream of `dir`.
    fn open(&self, smp: u32, dir: Vec3) -> bool {
        let n = self.tris[self.sample_tri[smp as usize] as usize].n;
        let origin = self.pos[smp as usize] + n * RAY_OFFSET;
        !self.blocked(origin, -dir)
    }

    /// True when the ray from `origin` along `dir` meets a part.
    fn blocked(&self, origin: Vec3, dir: Vec3) -> bool {
        self.cast(origin, dir, f32::INFINITY, true, |_| true)
            .is_some()
    }

    /// The nearest triangle of the parts the ray meets within `(0, t_max)` that `accept` takes: its
    /// index and distance; with `any`, the first one found. S3e: the parts that stay, then each part
    /// that moves where it stands now (its tree at rest, the ray carried there: the motion is rigid,
    /// so the distances are the world's).
    fn cast(
        &self,
        origin: Vec3,
        dir: Vec3,
        t_max: f32,
        any: bool,
        accept: impl Fn(u32) -> bool,
    ) -> Option<(u32, f32)> {
        let mut best = self.tree.cast(&self.tris, origin, dir, t_max, any, &accept);
        if self.movers.is_empty() || (any && best.is_some()) {
            return best;
        }
        for m in &self.movers {
            let first = self.parts[m.part as usize].first_tri;
            let o = m.now_inv.apply(origin);
            let d = vector(&m.now_inv, dir);
            let limit = best.map_or(t_max, |b| b.1);
            if let Some((li, t)) = m
                .tree
                .cast(&m.rest_tris, o, d, limit, any, |li| accept(first + li))
            {
                best = Some((first + li, t));
                if any {
                    return best;
                }
            }
        }
        best
    }

    /// The spec.
    pub fn spec(&self) -> &PartsSpec {
        &self.spec
    }

    /// Steps simulated (the time is this over [`STEPS_PER_SECOND`]).
    pub fn steps(&self) -> u32 {
        self.steps
    }

    /// The cell of the samples, mm (the spec's, or larger to keep under its budget).
    pub fn cell_mm(&self) -> f32 {
        self.cell
    }

    /// Samples of all the parts.
    pub fn sample_count(&self) -> usize {
        self.pos.len()
    }

    /// The resolution of a part's triangle (`tri`, its index in the part's mesh).
    pub fn resolution(&self, part: usize, tri: usize) -> u32 {
        self.tris[self.parts[part].first_tri as usize + tri].res
    }

    /// The world position of a sample.
    pub fn sample_position(&self, smp: usize) -> Vec3 {
        self.pos[smp]
    }

    /// The part a sample belongs to.
    pub fn sample_part(&self, smp: usize) -> usize {
        self.tris[self.sample_tri[smp] as usize].part as usize
    }

    /// The step a sample was first wet in ([`NEVER`]).
    pub fn wet_step(&self, smp: usize) -> u32 {
        self.wet[smp]
    }

    /// The share of a sample under dust now.
    pub fn dust_at(&self, smp: usize) -> f32 {
        let t = (self.steps - self.wiped[smp].min(self.steps)) as f32 / STEPS_PER_SECOND as f32;
        1.0 - fmath::exp(-self.dust_rate[smp] * t)
    }

    /// The depth of snow on a sample now, mm.
    pub fn snow_at(&self, smp: usize) -> f32 {
        self.snow_rate[smp] * self.seconds()
    }

    /// Simulated seconds.
    pub fn seconds(&self) -> f32 {
        self.steps as f32 / STEPS_PER_SECOND as f32
    }

    /// The drops: part, the triangle (its index in the part's mesh), the world position and the
    /// contact radius.
    pub fn drops(&self) -> Vec<(u32, u32, Vec3, f32)> {
        self.drops
            .iter()
            .map(|d| {
                (
                    d.part,
                    d.tri - self.parts[d.part as usize].first_tri,
                    d.p,
                    d.a,
                )
            })
            .collect()
    }

    /// The water in drops, mm³.
    pub fn water(&self) -> f32 {
        self.drops.iter().map(|d| d.volume).sum()
    }

    /// S3d: the drops in the air, by number: the part each left, its centre (world) and the radius
    /// of its sphere.
    pub fn falling(&self) -> Vec<(u32, Vec3, f32)> {
        self.falling
            .iter()
            .map(|f| (f.part, f.p, 0.5 * diameter_of(f.volume)))
            .collect()
    }

    /// S3d: the velocities of the drops in the air, mm/s, in the order of [`WetParts::falling`].
    pub fn falling_velocities(&self) -> Vec<Vec3> {
        self.falling.iter().map(|f| f.v).collect()
    }

    /// S3d: the water in the air, mm³.
    pub fn water_in_air(&self) -> f32 {
        self.falling.iter().map(|f| f.volume).sum()
    }

    /// S3d: the drops that landed from the air so far (drips and splashes' drops).
    pub fn landed_from_air(&self) -> u32 {
        self.flown
    }

    /// S3d: puts a drop of `volume` mm³ in the air at `p` (world) with velocity `v` mm/s, as if it
    /// left part `part` (tests and still pictures).
    pub fn add_falling(&mut self, part: usize, p: Vec3, v: Vec3, volume: f32) {
        self.launch(part as u32, p, v, volume);
    }

    /// Water left in trails so far, mm³.
    pub fn water_shed(&self) -> f32 {
        self.shed
    }

    /// Water dripped off, soaked in or thrown off the parts so far, mm³.
    pub fn water_lost(&self) -> f32 {
        self.lost_water
    }

    /// Drops that landed (from the sky), splashes, and drips so far.
    pub fn counts(&self) -> (u32, u32, u32) {
        (self.landed, self.splashes, self.drips)
    }

    /// The critical contact radius of part `part` on a face `sin α` steep.
    pub fn critical_radius(&self, part: usize, sin_alpha: f32) -> f32 {
        let s = &self.spec.parts[part];
        crate::wet::critical_radius(s.advancing_deg, s.receding_deg, sin_alpha)
    }

    /// Puts a drop of `volume` mm³ on part `part`'s triangle `tri` (its index in the mesh) at the
    /// point of barycentric weights `(1 − u − v, u, v)` (tests and still pictures).
    pub fn add_drop(&mut self, part: usize, tri: usize, u: f32, v: f32, volume: f32) {
        let ti = self.parts[part].first_tri + tri as u32;
        let t = self.tris[ti as usize];
        let p = t.v[0] + (t.v[1] - t.v[0]) * u + (t.v[2] - t.v[0]) * v;
        if volume > 0.0 && self.drops.len() < MAX_PART_DROPS {
            let k = self.parts[part].k;
            let id = self.take_id();
            self.drops
                .push(Drop::new(id, part as u32, ti, p, volume, k));
            self.dirty = true;
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
        // S3d: the drops in the air first: those that left in the steps before this one.
        changed |= self.fly();
        for si in 0..self.sources.len() {
            if self.spec.sources[si].kind == PartsSourceKind::Drops {
                changed |= self.land(step, si);
            }
        }
        // The film's samples whose time has come.
        while let Some(&(due, smp)) = self.film.get(self.film_done) {
            if due > self.steps {
                break;
            }
            self.film_done += 1;
            self.mark_wet(smp);
        }
        // S3e: the studio floor's cells whose time has come.
        if let Some(f) = self.floor.as_mut() {
            while let Some(&(due, c)) = f.film.get(f.film_done) {
                if due > self.steps {
                    break;
                }
                f.film_done += 1;
                if f.wet[c as usize] == NEVER {
                    f.wet[c as usize] = self.steps;
                    f.new_wet.push(c);
                }
            }
        }
        changed |= self.soak();
        changed |= self.slide();
        if changed && self.drops.len() > 1 {
            self.merge();
        }
    }

    /// S3e: the velocity of the centre of triangle `ti`, mm/s (nothing for a part that stays).
    fn tri_velocity(&self, ti: u32) -> Vec3 {
        let t = &self.tris[ti as usize];
        let part = &self.parts[t.part as usize];
        let Some(mi) = part.mover else {
            return Vec3::ZERO;
        };
        let m = &self.movers[mi as usize];
        let rest = &m.rest_tris[(ti - part.first_tri) as usize];
        let c = (rest.v[0] + rest.v[1] + rest.v[2]) * (1.0 / 3.0);
        (m.now.apply(c) - m.prev.apply(c)) * STEPS_PER_SECOND as f32
    }

    /// The drops of source `si` that land in step `step`; true when one came. S3e: on a part that
    /// moves, under the rain as it sees it (the rain's velocity less its own) where it stands now.
    fn land(&mut self, step: u32, si: usize) -> bool {
        let s = self.spec.sources[si];
        let speed = s.velocity.length();
        let still = self.sources[si].cdf.last().copied().unwrap_or(0.0);
        // S3e: the triangles of the parts that move, by their share of the flux they see.
        let mut moving: Vec<(u32, f32, Vec3)> = Vec::new();
        let mut moving_total = 0.0f32;
        if !self.movers.is_empty() && s.density > 0.0 && speed > 0.0 && s.size_mm > 0.0 {
            for m in &self.movers {
                let p = &self.parts[m.part as usize];
                for ti in p.first_tri..p.first_tri + p.tris {
                    let t = &self.tris[ti as usize];
                    let rel = s.velocity - self.tri_velocity(ti);
                    let sp = rel.length();
                    if !(above(t.area, 0.0) && above(sp, 0.0)) {
                        continue;
                    }
                    let cos = -(rel / sp).dot(t.n);
                    if !above(cos, 0.0) {
                        continue;
                    }
                    moving_total += sp * cos * t.area;
                    moving.push((ti, moving_total, rel));
                }
            }
        }
        let (lambda, total) = if moving.is_empty() {
            (self.sources[si].lambda, still)
        } else {
            let total = speed * still + moving_total;
            (s.density * total * STEP, total)
        };
        if !(lambda > 0.0 && total > 0.0) {
            return false;
        }
        let dir = s.velocity / speed;
        let base = mix64(
            (u64::from(self.spec.seed) << 32)
                ^ SALT_STEP
                ^ u64::from(step).wrapping_mul(0x9E37_79B9_7F4A_7C15)
                ^ (si as u64).wrapping_mul(0xD1B5_4A32_D192_ED03),
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
        let var = s.size_var.clamp(0.0, 1.0);
        let mut came = false;
        for k in 0..count {
            let mut h = mix64(base ^ SALT_PLACE ^ (u64::from(k) << 20));
            let mut draw = || {
                h = mix64(h);
                unit(h)
            };
            let pick = draw() * total;
            let (ti, along, rate) = if moving.is_empty() || pick < speed * still {
                let state = &self.sources[si];
                let pick = if moving.is_empty() {
                    pick
                } else {
                    pick / speed
                };
                let at = state
                    .cdf
                    .partition_point(|&c| c <= pick)
                    .min(state.cdf.len() - 1);
                (state.tris[at], dir, speed)
            } else {
                let q = pick - speed * still;
                let at = moving.partition_point(|e| e.1 <= q).min(moving.len() - 1);
                let (ti, _, rel) = moving[at];
                let sp = rel.length();
                (ti, rel / sp, sp)
            };
            let t = self.tris[ti as usize];
            let (r1, r2) = (draw().sqrt(), draw());
            let p = t.v[0] * (1.0 - r1) + t.v[1] * (r1 * (1.0 - r2)) + t.v[2] * (r1 * r2);
            let d = s.size_mm * (1.0 + var * (2.0 * draw() - 1.0)).max(0.05);
            let seed = h;
            // In the open, or something else of the scene took it first.
            let origin = p + t.n * RAY_OFFSET;
            if self.blocked(origin, -along) {
                continue;
            }
            self.landed += 1;
            let normal_speed = rate * (-along.dot(t.n)).max(0.0);
            came |= self.impact(ti, p, d, normal_speed, seed);
        }
        came
    }

    /// A drop of diameter `d` meets triangle `ti` at `p` at `speed` mm/s along the normal: it
    /// wets where it spreads, may splash, and stays as a drop of what is left. True when a drop
    /// was added.
    fn impact(&mut self, ti: u32, p: Vec3, d: f32, speed: f32, seed: u64) -> bool {
        let t = self.tris[ti as usize];
        let part_index = t.part as usize;
        let mut volume = fmath::PI / 6.0 * d * d * d;
        self.wet_disc(t.part, p, t.n, 0.5 * LANDING_SPREAD * d, false);
        if self.parts[part_index].film {
            return false;
        }
        // Mundo et al.: K = We^½ Re^¼, SI units.
        let (dm, um) = (d * 1.0e-3, speed * 1.0e-3);
        let we = RHO_SI * dm * um * um / GAMMA_SI;
        let re = RHO_SI * dm * um / MU_SI;
        let k = we.max(0.0).sqrt() * fmath::powf(re.max(0.0), 0.25);
        let mut added = false;
        if k > SPLASH_K {
            let share = SPLASH_SHARE * ((k - SPLASH_K) / SPLASH_K).min(1.0);
            let thrown = volume * share;
            volume -= thrown;
            self.splashes += 1;
            let each = thrown / SPLASH_DROPS as f32;
            let (u_axis, v_axis) = tangent_basis(t.n);
            let (se, ce) = fmath::sin_cos(SPLASH_ELEVATION_DEG * fmath::DEG_TO_RAD);
            for n in 0..SPLASH_DROPS {
                let h = mix64(seed ^ SALT_SPLASH ^ u64::from(n));
                let angle = unit(h) * 2.0 * fmath::PI;
                let reach = d * (1.0 + (SPLASH_REACH - 1.0) * unit(mix64(h)));
                let (sa, ca) = fmath::sin_cos(angle);
                let dir = u_axis * ca + v_axis * sa;
                // S3d: into the air, at the speed that reaches `reach` on a level face
                // (`v² sin 2θ / g`).
                let speed = (reach * GRAVITY_MM / (2.0 * se * ce)).sqrt();
                self.launch(
                    t.part,
                    p + t.n * RAY_OFFSET,
                    (dir * ce + t.n * se) * speed,
                    each,
                );
            }
        }
        if self.drops.len() < MAX_PART_DROPS {
            let k = self.parts[part_index].k;
            let id = self.take_id();
            self.drops.push(Drop::new(id, t.part, ti, p, volume, k));
            added = true;
        } else {
            self.lost_water += volume;
        }
        added
    }

    /// S3d: a drop of `volume` leaves part `part` at `p` with velocity `v`: it is in the air from
    /// the next step (or lost, past [`MAX_FALLING_DROPS`]).
    fn launch(&mut self, part: u32, p: Vec3, v: Vec3, volume: f32) {
        if self.falling.len() >= MAX_FALLING_DROPS || volume.is_nan() || volume < MIN_VOLUME {
            self.lost_water += volume.max(0.0);
            return;
        }
        let id = self.take_id();
        self.falling.push(Falling {
            id,
            part,
            p,
            v,
            volume,
            steps: 0,
        });
    }

    /// S3d: one step of the drops in the air: gravity and the drag of the air, then the first face
    /// the step crosses from its front takes the drop (an impact); below the floor, or too long in
    /// the air, it is gone. The drops a landing throws fly from the next step. True when a drop
    /// landed on a part that takes drops.
    fn fly(&mut self) -> bool {
        if self.falling.is_empty() {
            return false;
        }
        let flying = std::mem::take(&mut self.falling);
        let mut kept = Vec::with_capacity(flying.len());
        let mut came = false;
        for f in flying {
            let d = diameter_of(f.volume);
            let vt = terminal_speed(d);
            // S3e: the drag is against the air, which the wind moves.
            let rel = if self.windy { f.v - self.wind } else { f.v };
            let speed = rel.length();
            let drag = if above(vt, 0.0) {
                GRAVITY_MM * speed / (vt * vt)
            } else {
                0.0
            };
            // The acceleration held over the step (exact for gravity alone).
            let accel = Vec3::new(0.0, 0.0, -GRAVITY_MM) - rel * drag;
            let v = f.v + accel * STEP;
            let mv = f.v * STEP + accel * (0.5 * STEP * STEP);
            let len = mv.length();
            if above(len, 0.0) {
                let dir = mv / len;
                // S3e: the studio floor takes what crosses its plane over its rectangle, unless a
                // part does first.
                let mut limit = len;
                let mut floor_at = None;
                if let Some(fl) = &self.floor {
                    let end = f.p + mv;
                    if f.p.z > fl.z && end.z <= fl.z {
                        let share = (f.p.z - fl.z) / (f.p.z - end.z);
                        let at = f.p + mv * share;
                        if fl.covers(at.x, at.y) {
                            limit = len * share;
                            floor_at = Some(at);
                        }
                    }
                }
                let tris = &self.tris;
                let hit = self.cast(f.p, dir, limit, false, |i| {
                    tris[i as usize].n.dot(dir) < 0.0
                });
                if let Some((ti, t)) = hit {
                    let at = f.p + dir * t;
                    let n = self.tris[ti as usize].n;
                    let seed = mix64(
                        (u64::from(self.spec.seed) << 32)
                            ^ SALT_FLIGHT
                            ^ (u64::from(f.id) << 8)
                            ^ u64::from(self.steps).wrapping_mul(0x9E37_79B9_7F4A_7C15),
                    );
                    self.flown += 1;
                    // S3e: against a part that moves, at the speed between them.
                    let vn = if self.movers.is_empty() {
                        v
                    } else {
                        v - self.tri_velocity(ti)
                    };
                    came |= self.impact(ti, at, d, (-vn.dot(n)).max(0.0), seed);
                    continue;
                }
                if let Some(at) = floor_at {
                    self.on_floor(at, d, f.volume);
                    continue;
                }
            }
            let p = f.p + mv;
            if p.z < self.floor_z || f.steps + 1 > MAX_FLIGHT_STEPS {
                self.lost_water += f.volume;
                continue;
            }
            kept.push(Falling {
                p,
                v,
                steps: f.steps + 1,
                ..f
            });
        }
        // The survivors, then what the landings threw (all numbered after them).
        kept.append(&mut self.falling);
        self.falling = kept;
        came
    }

    /// S3e: a drop of diameter `d` and `volume` lands on the studio floor at `at`: it wets the cells
    /// where it spreads, and its water stays there (the floor is a film: no drop, no splash).
    fn on_floor(&mut self, at: Vec3, d: f32, volume: f32) {
        let Some(mut f) = self.floor.take() else {
            return;
        };
        let mut cells = std::mem::take(&mut self.scratch);
        f.disc(at.x, at.y, 0.5 * LANDING_SPREAD * d, &mut cells);
        for &c in &cells {
            if f.wet[c as usize] == NEVER {
                f.wet[c as usize] = self.steps;
                f.new_wet.push(c);
            }
        }
        f.water += volume;
        f.landed += 1;
        self.scratch = cells;
        self.floor = Some(f);
    }

    /// The number of a new drop.
    fn take_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        id
    }

    /// Keeps the drops whose flag is set, in order; the others are gone (the frame says so).
    fn keep_drops(&mut self, keep: &[bool]) {
        for (d, &k) in self.drops.iter().zip(keep) {
            if !k {
                self.gone_ids.push(d.id);
            }
        }
        let mut it = keep.iter();
        self.drops.retain(|_| *it.next().unwrap_or(&true));
    }

    /// Porous parts soak their drops in; true when one changed.
    fn soak(&mut self) -> bool {
        let mut changed = false;
        let mut gone = false;
        for i in 0..self.drops.len() {
            let d = self.drops[i];
            let part = self.parts[d.part as usize];
            if part.soak <= 0.0 {
                continue;
            }
            let lost = (part.soak * fmath::PI * d.a * d.a * STEP).min(d.volume);
            let left = d.volume - lost;
            self.drops[i].volume = left;
            self.drops[i].a = cbrt(left / part.k);
            self.drops[i].touched = true;
            self.lost_water += lost;
            let n = self.tris[d.tri as usize].n;
            self.wet_disc(d.part, d.p, n, d.a, false);
            changed = true;
            gone |= left < MIN_VOLUME;
        }
        if gone {
            let keep: Vec<bool> = self.drops.iter().map(|d| d.volume >= MIN_VOLUME).collect();
            self.keep_drops(&keep);
        }
        changed
    }

    /// Drops past their critical size slide down, hanging ones drip; true when one moved. S3f: a merge
    /// relaxes first (the centre moves on towards the merged centre of volume); a hanging drop (under
    /// a face that looks down, or held at an open edge) past its hold necks and lets go of
    /// [`PINCH_OFF_SHARE`] of its water, the rest staying; a sliding drop that reaches an open edge
    /// stops there and hangs; S3g: one fast enough for its rear angle to fall to [`PEARL_REAR_DEG`]
    /// sheds sparse small pearls behind it.
    fn slide(&mut self) -> bool {
        if self.drops.is_empty() {
            return false;
        }
        let mut moved = false;
        let mut keep = vec![true; self.drops.len()];
        let mut drips: Vec<(u32, Vec3, Vec3, f32)> = Vec::new();
        let mut pearls: Vec<(u32, u32, Vec3, f32)> = Vec::new();
        let mut path = Vec::new();
        for (i, kept) in keep.iter_mut().enumerate() {
            let was = self.drops[i];
            let mut d = was;
            d.from = d.p;
            let part = self.parts[d.part as usize];
            // S3e: the gravity its part feels (−Z, or on a part that moves, less its acceleration).
            let gravity = part.gravity;
            let gk = gravity.length();
            let down = if above(gk, 0.0) {
                gravity / gk
            } else {
                Vec3::new(0.0, 0.0, -1.0)
            };
            // S3f: a merge relaxes: on towards the centre of volume, the neck filling.
            if d.merging.left > 0.0 {
                let decay = fmath::exp(-STEP / (MERGE_TIMES * capillary_time(d.a)).max(STEP));
                let go = d.merging.pull * (1.0 - decay);
                let len = go.length();
                if above(len, 1.0e-6) {
                    let end =
                        self.walk(d.tri, d.p, Course::Straight(go / len), len, &mut Vec::new());
                    d.tri = end.tri;
                    d.p = end.p;
                }
                d.merging.pull *= decay;
                d.merging.left *= decay;
                if d.merging.left < RELAXED {
                    d.merging = Merging::NONE;
                }
                d.touched = true;
                d.fresh = true;
                moved = true;
            }
            let t = self.tris[d.tri as usize];
            let a = d.a;
            let gn = gravity.dot(t.n);
            // S3e: held at a sloping open edge, it runs along it while its weight along the edge
            // beats the hold of its contact line; a level edge, or the lowest corner, holds it, and
            // there it hangs as below.
            if d.edge {
                if let Some((p, edge, run, speed)) = self.run_edge(&d, gravity, &part, &mut path) {
                    moved = true;
                    let film = (TRAIL_FILM_MM * 2.0 * a * run).min(d.volume);
                    self.shed += film;
                    let left = d.volume - film;
                    for w in path.windows(2) {
                        self.wipe(d.part, w[0], w[1], a, t.n);
                    }
                    d.vel = (p - d.p) * STEPS_PER_SECOND as f32;
                    d.ca = WATER_VISCOSITY * speed / SURFACE_TENSION;
                    d.load = 1.0;
                    d.hang = 0.0;
                    d.pinch = 0.0;
                    d.p = p;
                    d.edge_at = edge;
                    d.tri = edge / 3;
                    d.volume = left;
                    d.a = cbrt(left / part.k);
                    d.touched = true;
                    d.fresh = true;
                    if left < MIN_VOLUME {
                        *kept = false;
                        continue;
                    }
                    self.put(i, d, &was);
                    continue;
                }
            }
            // A drop on a face that looks down, or held at an open edge, hangs until its weight beats
            // its contact line; S3f: then it necks and lets go of a share of its water.
            if gn > HANG_MIN || d.edge {
                let pull = WATER_WEIGHT * d.volume * if d.edge { gk } else { gn };
                let hold = PENDANT_HOLD * 2.0 * fmath::PI * a * SURFACE_TENSION * part.sin_cap;
                d.hang = if hold > 0.0 { pull / hold } else { 2.0 };
                if d.hang > 1.0 {
                    d.pinch += STEP / (PINCH_TIMES * capillary_time(a)).max(STEP);
                    d.touched = true;
                    moved = true;
                    if d.pinch >= 1.0 {
                        let off = d.volume * PINCH_OFF_SHARE;
                        let left = d.volume - off;
                        let tip = if d.edge {
                            d.p + down * a + t.n * RAY_OFFSET
                        } else {
                            d.p + t.n * a
                        };
                        drips.push((d.part, tip, Vec3::ZERO, off));
                        d.volume = left;
                        d.a = cbrt(left / part.k);
                        d.pinch = 0.0;
                        d.hang *= (1.0 - PINCH_OFF_SHARE) * a / d.a.max(1.0e-6);
                        d.fresh = true;
                        *kept = left >= MIN_VOLUME;
                    }
                    self.put(i, d, &was);
                    continue;
                }
                if d.pinch > 0.0 {
                    d.pinch =
                        (d.pinch - STEP / (PINCH_TIMES * capillary_time(a)).max(STEP)).max(0.0);
                    d.touched = true;
                }
                if d.edge {
                    if d.ca > 0.0 {
                        // It came to the lowest point of its edge: at rest there.
                        d.ca = 0.0;
                        d.vel = Vec3::ZERO;
                        d.touched = true;
                    }
                    self.put(i, d, &was);
                    continue;
                }
            } else if d.hang > 0.0 || d.pinch > 0.0 {
                d.hang = 0.0;
                d.pinch = 0.0;
                d.touched = true;
            }
            let along = gravity - t.n * gn;
            let slope = along.length();
            if !above(slope, 1.0e-6) {
                if d.ca > 0.0 || d.load > 0.0 {
                    d.touched = true;
                }
                d.load = 0.0;
                d.ca = 0.0;
                d.vel = Vec3::ZERO;
                self.put(i, d, &was);
                continue;
            }
            // Furmidge: the weight along the face against the contact line's hold.
            let weight = WATER_WEIGHT * d.volume * slope;
            let hold = 2.0 * SURFACE_TENSION * part.hysteresis * a;
            let excess = weight - hold;
            if excess <= 0.0 {
                if d.ca > 0.0 {
                    d.touched = true;
                }
                d.load = if hold > 0.0 { weight / hold } else { 0.0 };
                d.ca = 0.0;
                d.vel = Vec3::ZERO;
                self.put(i, d, &was);
                continue;
            }
            // S3g: a drop that was at rest starts to slide: as it is now.
            if was.ca <= 0.0 && self.depins.len() < MAX_DEPINS {
                self.depins.push(Depin {
                    part: d.part,
                    a,
                    volume: d.volume,
                    slope: if above(gk, 0.0) { slope / gk } else { 0.0 },
                });
            }
            let speed = (excess / (SLIDE_DRAG * WATER_VISCOSITY * a)).min(MAX_SLIDE_SPEED);
            path.clear();
            path.push(d.p);
            let end = self.walk(
                d.tri,
                d.p,
                Course::Downhill(gravity),
                speed * STEP,
                &mut path,
            );
            path.push(end.p);
            moved = true;
            // The film it leaves behind, and the dust it takes.
            let film = (TRAIL_FILM_MM * 2.0 * a * end.moved).min(d.volume);
            self.shed += film;
            let mut left = d.volume - film;
            for w in path.windows(2) {
                self.wipe(d.part, w[0], w[1], a, t.n);
            }
            let first = path[1] - path[0];
            let dir = if above(first.length(), 0.0) {
                first.normalize()
            } else {
                along / slope
            };
            d.vel = (end.p - d.p) * STEPS_PER_SECOND as f32;
            d.ca = WATER_VISCOSITY * speed / SURFACE_TENSION;
            d.load = 1.0;
            d.touched = true;
            d.fresh = true;
            if end.off {
                // S3f: it stops at the open edge and hangs there (S3c: it ran off it, a drip).
                d.tri = end.tri;
                d.p = end.p;
                d.volume = left;
                d.a = cbrt(left / part.k);
                d.edge = true;
                d.edge_at = end.edge;
                d.vel = Vec3::ZERO;
                d.ca = 0.0;
                d.run = 0.0;
                *kept = left >= MIN_VOLUME;
                self.put(i, d, &was);
                continue;
            }
            // S3g: past the pearling transition its trailing edge sheds pearls behind it, sparse and
            // small, at distances drawn from an exponential law; below it, only its trail.
            let (_, rear) = dynamic_angles(part.advancing, part.receding, d.ca);
            if rear <= PEARL_REAR_DEG * fmath::DEG_TO_RAD {
                if d.run <= 0.0 {
                    d.run = self.pearl_gap(d.id, a, 0);
                }
                d.run -= end.moved;
                if d.run <= 0.0 {
                    let h = self.pearl_hash(d.id, 1);
                    let ap = a * PEARL_RADIUS * (0.5 + 0.5 * unit(h));
                    let vp = part.k * ap * ap * ap;
                    if vp < 0.5 * left && vp >= MIN_VOLUME {
                        let back = self.walk(
                            d.tri,
                            d.from,
                            Course::Straight(-dir),
                            1.02 * (a + ap),
                            &mut Vec::new(),
                        );
                        if !back.off {
                            pearls.push((d.part, back.tri, back.p, vp));
                            left -= vp;
                        }
                    }
                    d.run = self.pearl_gap(d.id, a, 2);
                }
            } else {
                d.run = 0.0;
            }
            if left < MIN_VOLUME {
                *kept = false;
                continue;
            }
            d.tri = end.tri;
            d.p = end.p;
            d.volume = left;
            d.a = cbrt(left / part.k);
            self.put(i, d, &was);
        }
        if keep.iter().any(|k| !k) {
            self.keep_drops(&keep);
        }
        for (part, tri, p, volume) in pearls {
            if self.drops.len() >= MAX_PART_DROPS {
                // No room for the pearl: its water stays lost with the run.
                self.lost_water += volume;
                continue;
            }
            let k = self.parts[part as usize].k;
            let id = self.take_id();
            self.drops.push(Drop::new(id, part, tri, p, volume, k));
            self.pearls += 1;
            moved = true;
        }
        for (part, p, v, volume) in drips {
            self.drip(part, p, v, volume);
        }
        moved
    }

    /// S3g: a hash of drop `id`'s pearling at this step (`k` tells its draws apart).
    fn pearl_hash(&self, id: u32, k: u64) -> u64 {
        mix64(
            u64::from(self.spec.seed) << 32
                ^ SALT_PEARL
                ^ u64::from(id) << 24
                ^ u64::from(self.steps) << 2
                ^ k,
        )
    }

    /// S3g: the distance a pearling drop of contact radius `a` runs until its next pearl: an
    /// exponential law of mean [`PEARL_SPACING`] contact diameters, at least its own radius.
    fn pearl_gap(&self, id: u32, a: f32, k: u64) -> f32 {
        let u = unit(self.pearl_hash(id, k));
        (-PEARL_SPACING * 2.0 * a * fmath::ln(1.0 - u)).max(a)
    }

    /// S3e: drop `d`, held at an open edge, runs along it when its weight along the edge beats the
    /// hold of its contact line (Furmidge's balance with the component of its weight along the edge
    /// instead of along the face; a level edge holds it), down, at the speed a drop slides with that
    /// excess, from edge to edge of its part's open boundary, and stops at a corner past which the
    /// boundary rises (the lowest point of the edge), where it hangs and lets go from rest as S3f's
    /// drops do. Its new point, its edge, how far it went and its speed, with its way in `path`;
    /// `None` when it holds.
    fn run_edge(
        &self,
        d: &Drop,
        gravity: Vec3,
        part: &Part,
        path: &mut Vec<Vec3>,
    ) -> Option<(Vec3, u32, f32, f32)> {
        if d.edge_at == NEVER {
            return None;
        }
        let ends = |e: u32| {
            let t = &self.tris[(e / 3) as usize];
            let k = (e % 3) as usize;
            (t.v[k], t.v[(k + 1) % 3])
        };
        let (a0, b0) = ends(d.edge_at);
        let ab = b0 - a0;
        let len = ab.length();
        if !above(len, 0.0) {
            return None;
        }
        let e = ab / len;
        let weight = WATER_WEIGHT * d.volume * gravity.dot(e).abs();
        let hold = 2.0 * SURFACE_TENSION * part.hysteresis * d.a;
        if weight <= hold {
            return None;
        }
        let speed = ((weight - hold) / (SLIDE_DRAG * WATER_VISCOSITY * d.a)).min(MAX_SLIDE_SPEED);
        let mut left = speed * STEP;
        // On the edge (a merge may have left its centre off it).
        let mut p = a0 + e * (d.p - a0).dot(e).clamp(0.0, len);
        path.clear();
        path.push(d.p);
        path.push(p);
        let mut cur = d.edge_at;
        let mut went = 0.0f32;
        for _ in 0..MAX_CROSSINGS {
            let (a, b) = ends(cur);
            let to_b = gravity.dot(b - a) >= 0.0;
            let end = if to_b { b } else { a };
            let room = (end - p).length();
            if left <= room {
                if above(room, 0.0) {
                    p += (end - p) * (left / room);
                }
                went += left;
                break;
            }
            went += room;
            left -= room;
            p = end;
            path.push(p);
            let next = self.edge_next[cur as usize][usize::from(to_b)];
            if next == NEVER {
                break;
            }
            let (na, nb) = ends(next);
            let far = if na == end { nb } else { na };
            if gravity.dot(far - end) <= 0.0 {
                // A corner the boundary rises from on both sides: the lowest point.
                break;
            }
            cur = next;
        }
        path.push(p);
        above(went, 1.0e-6).then_some((p, cur, went, speed))
    }

    /// S3f: puts drop `d` back at `i`, changed (for the frame) when what makes its shape changed from
    /// `was`.
    fn put(&mut self, i: usize, mut d: Drop, was: &Drop) {
        let same = |x: f32, y: f32| x.to_bits() == y.to_bits();
        if !(same(d.load, was.load)
            && same(d.ca, was.ca)
            && same(d.hang, was.hang)
            && same(d.pinch, was.pinch)
            && same(d.vel.x, was.vel.x)
            && same(d.vel.y, was.vel.y)
            && same(d.vel.z, was.vel.z))
        {
            d.touched = true;
        }
        self.drops[i] = d;
    }

    /// A drop of `volume` leaves part `part` at `p` with velocity `v` and falls (S3d: through the
    /// air, from the next step).
    fn drip(&mut self, part: u32, p: Vec3, v: Vec3, volume: f32) {
        self.drips += 1;
        self.drips_since += 1;
        self.launch(part, p, v, volume);
    }

    /// Walks a point of triangle `ti` along the surface by `dist`, from triangle to triangle,
    /// appending the corners of its path (the edges it crosses) to `path`.
    fn walk(&self, ti: u32, p: Vec3, course: Course, dist: f32, path: &mut Vec<Vec3>) -> WalkEnd {
        let gravity = match course {
            Course::Downhill(g) => g,
            Course::Straight(_) => Vec3::new(0.0, 0.0, -1.0),
        };
        let mut tri = ti;
        let mut p = p;
        let mut left = dist;
        let mut moved = 0.0f32;
        let mut stalls = 0;
        let dir_on = |t: &Tri| -> Option<Vec3> {
            let want = match course {
                Course::Downhill(g) => g,
                Course::Straight(d) => d,
            };
            let d = want - t.n * want.dot(t.n);
            let len = d.length();
            (len > 1.0e-6).then(|| d / len)
        };
        for _ in 0..MAX_CROSSINGS {
            let t = self.tris[tri as usize];
            let Some(d) = dir_on(&t) else { break };
            // The first edge the line crosses.
            let mut exit: Option<(f32, usize)> = None;
            for k in 0..3 {
                let (a, b) = (t.v[k], t.v[(k + 1) % 3]);
                let m = t.n.cross(b - a);
                let ml = m.length();
                if !above(ml, 0.0) {
                    continue;
                }
                let m = m / ml;
                let rate = d.dot(m);
                if rate < -1.0e-7 {
                    let s = ((p - a).dot(m)).max(0.0) / -rate;
                    if exit.is_none_or(|(best, _)| s < best) {
                        exit = Some((s, k));
                    }
                }
            }
            let Some((s, k)) = exit else {
                p += d * left;
                moved += left;
                break;
            };
            if left <= s {
                p += d * left;
                moved += left;
                break;
            }
            let at = p + d * s;
            moved += s;
            left -= s;
            stalls = if s <= 1.0e-6 { stalls + 1 } else { 0 };
            if stalls > 6 {
                p = at;
                break;
            }
            path.push(at);
            let next = t.nb[k];
            if next == NEVER {
                return WalkEnd {
                    tri,
                    p: at,
                    off: true,
                    edge: 3 * tri + k as u32,
                    moved,
                };
            }
            let t2 = self.tris[next as usize];
            let (a, b) = (t.v[k], t.v[(k + 1) % 3]);
            // Does the course go on into the next triangle, or back over the edge (a crease)?
            let into = dir_on(&t2).map(|d2| {
                let k2 = (0..3).find(|&j| t2.nb[j] == tri).unwrap_or(0);
                let (x, y) = (t2.v[k2], t2.v[(k2 + 1) % 3]);
                d2.dot(t2.n.cross(y - x)) > 0.0
            });
            if into == Some(true) {
                tri = next;
                p = onto(&t2, at);
                continue;
            }
            p = at;
            if let (Course::Downhill(_), Some(false)) = (course, into) {
                // Down the crease, as far as its end.
                let e = (b - a).normalize();
                let g = gravity.dot(e);
                if g.abs() > 1.0e-4 {
                    let (dir, room) = if g > 0.0 {
                        (e, (b - at).length())
                    } else {
                        (-e, (a - at).length())
                    };
                    let go = left.min(room);
                    p = at + dir * go;
                    moved += go;
                }
            }
            break;
        }
        WalkEnd {
            tri,
            p,
            off: false,
            edge: NEVER,
            moved,
        }
    }

    /// Marks sample `smp` wet now (once).
    fn mark_wet(&mut self, smp: u32) {
        if self.wet[smp as usize] == NEVER {
            self.wet[smp as usize] = self.steps;
            self.new_wet.push(smp);
        }
    }

    /// Wets the samples of `part` within `r` of `p` on the side `n` faces.
    fn wet_disc(&mut self, part: u32, p: Vec3, n: Vec3, r: f32, wipe: bool) {
        self.near(part, p, p, r, n);
        let found = std::mem::take(&mut self.scratch);
        for &smp in &found {
            self.mark_wet(smp);
            if wipe {
                self.wipe_sample(smp);
            }
        }
        self.scratch = found;
    }

    /// The trail of a drop of radius `a` from `p0` to `p1`: wet, and the dust wiped.
    fn wipe(&mut self, part: u32, p0: Vec3, p1: Vec3, a: f32, n: Vec3) {
        self.near(part, p0, p1, a, n);
        let found = std::mem::take(&mut self.scratch);
        for &smp in &found {
            self.mark_wet(smp);
            self.wipe_sample(smp);
        }
        self.scratch = found;
    }

    fn wipe_sample(&mut self, smp: u32) {
        self.wiped[smp as usize] = self.steps;
        if self.wiped_mark[smp as usize] != self.frame_no {
            self.wiped_mark[smp as usize] = self.frame_no;
            self.new_wiped.push(smp);
        }
    }

    /// Puts in `scratch` the samples of `part` within `r` of the segment `p0 p1` whose face looks
    /// the way `n` does.
    fn near(&mut self, part: u32, p0: Vec3, p1: Vec3, r: f32, n: Vec3) {
        if let Some(mi) = self.parts[part as usize].mover {
            self.near_moving(mi as usize, part, p0, p1, r, n);
            return;
        }
        let mut found = std::mem::take(&mut self.scratch);
        found.clear();
        let pad = Vec3::new(r, r, r);
        let mut cands = Vec::new();
        self.grid
            .query(p0.min(p1) - pad, p0.max(p1) + pad, &mut cands);
        let seg = p1 - p0;
        let len2 = seg.length_squared();
        let range = {
            let pr = &self.parts[part as usize];
            pr.first_sample..pr.first_sample + pr.samples
        };
        for smp in cands {
            if !range.contains(&smp) {
                continue;
            }
            let q = self.pos[smp as usize];
            if self.tris[self.sample_tri[smp as usize] as usize].n.dot(n) <= 0.3 {
                continue;
            }
            let w = q - p0;
            let s = if len2 > 0.0 {
                (w.dot(seg) / len2).clamp(0.0, 1.0)
            } else {
                0.0
            };
            if (w - seg * s).length_squared() <= r * r {
                found.push(smp);
            }
        }
        self.scratch = found;
    }

    /// S3e: [`WetParts::near`] on a part that moves: the segment and the normal carried to its rest,
    /// where its samples and their grid are.
    fn near_moving(&mut self, mi: usize, part: u32, p0: Vec3, p1: Vec3, r: f32, n: Vec3) {
        let mut found = std::mem::take(&mut self.scratch);
        found.clear();
        let m = &self.movers[mi];
        let (q0, q1) = (m.now_inv.apply(p0), m.now_inv.apply(p1));
        let nn = vector(&m.now_inv, n);
        let pad = Vec3::new(r, r, r);
        let mut cands = Vec::new();
        m.grid.query(q0.min(q1) - pad, q0.max(q1) + pad, &mut cands);
        let pr = &self.parts[part as usize];
        let seg = q1 - q0;
        let len2 = seg.length_squared();
        for local in cands {
            let smp = pr.first_sample + local;
            let rest = &m.rest_tris[(self.sample_tri[smp as usize] - pr.first_tri) as usize];
            if rest.n.dot(nn) <= 0.3 {
                continue;
            }
            let w = m.rest_pos[local as usize] - q0;
            let s = if len2 > 0.0 {
                (w.dot(seg) / len2).clamp(0.0, 1.0)
            } else {
                0.0
            };
            if (w - seg * s).length_squared() <= r * r {
                found.push(smp);
            }
        }
        self.scratch = found;
    }

    /// S3e: the parts that move.
    pub fn moving_parts(&self) -> usize {
        self.movers.len()
    }

    /// S3e: the poses the bodies start from: the pose of each dynamic body of the `PHY1` scene, by
    /// their order (`None` for one without a pose: it stays). [`WetParts::step_posed`] takes the
    /// first poses it is given as these when it was not called; [`WetParts::step_with`] calls it.
    pub fn begin_poses(&mut self, poses: &[Option<Pose>]) {
        for m in self.movers.iter_mut() {
            m.start_inv = poses
                .get(m.body as usize)
                .copied()
                .flatten()
                .map(|p| inverse(&Transform::from_pose(p.translation, p.rotation)));
        }
        self.posed = true;
    }

    /// S3e: one step with the bodies where `poses` puts them (after the bodies' step): each part
    /// that moves stands where its body takes it, with its drops on it, then the step.
    pub fn step_posed(&mut self, poses: &[Option<Pose>]) {
        if !self.posed {
            self.begin_poses(poses);
        }
        self.move_parts(poses);
        self.step_once();
    }

    /// S3e: `n` steps of `world`'s bodies and of these parts together, one after the other (`ids`:
    /// the pose of each dynamic body of the world's scene, `crate::scene::Scene::build`'s).
    pub fn step_with(&mut self, world: &mut crate::world::World, ids: &[Option<u32>], n: u32) {
        let poses = |w: &crate::world::World| -> Vec<Option<Pose>> {
            ids.iter().map(|id| id.and_then(|i| w.pose(i))).collect()
        };
        if !self.posed {
            let p = poses(world);
            self.begin_poses(&p);
        }
        for _ in 0..n {
            world.step(1);
            let p = poses(world);
            self.move_parts(&p);
            self.step_once();
        }
    }

    /// S3e: every part that moves where its body is now (rest to now: the body's pose after its pose
    /// at the start), its triangles, samples and drops with it; the gravity its drops feel, less the
    /// acceleration of its centre.
    fn move_parts(&mut self, poses: &[Option<Pose>]) {
        for mi in 0..self.movers.len() {
            let m = &self.movers[mi];
            let now = match (m.start_inv, poses.get(m.body as usize).copied().flatten()) {
                (Some(start), Some(p)) => {
                    compose(&Transform::from_pose(p.translation, p.rotation), &start)
                }
                _ => m.now,
            };
            let delta = compose(&now, &m.now_inv);
            let m = &mut self.movers[mi];
            m.prev2 = m.prev;
            m.prev = m.now;
            m.now = now;
            m.now_inv = inverse(&now);
            let c = m.centre;
            let k = (STEPS_PER_SECOND * STEPS_PER_SECOND) as f32;
            let accel =
                (m.now.apply(c) - m.prev.apply(c) * 2.0 + m.prev2.apply(c)) * (k / GRAVITY_MM);
            let pi = m.part as usize;
            let part = &mut self.parts[pi];
            part.gravity = Vec3::new(0.0, 0.0, -1.0) - accel;
            part.to_object = compose(&m.to_object0, &m.now_inv);
            let (t0, s0) = (part.first_tri as usize, part.first_sample as usize);
            for (li, rest) in m.rest_tris.iter().enumerate() {
                let t = &mut self.tris[t0 + li];
                t.v = [
                    now.apply(rest.v[0]),
                    now.apply(rest.v[1]),
                    now.apply(rest.v[2]),
                ];
                let n = vector(&now, rest.n);
                t.n = if above(n.length(), 0.0) {
                    n.normalize()
                } else {
                    n
                };
            }
            for (ls, &q) in m.rest_pos.iter().enumerate() {
                self.pos[s0 + ls] = now.apply(q);
            }
            for d in self.drops.iter_mut().filter(|d| d.part as usize == pi) {
                let t = &self.tris[d.tri as usize];
                d.p = onto(t, delta.apply(d.p));
                d.from = delta.apply(d.from);
                d.vel = vector(&delta, d.vel);
                d.merging.pull = vector(&delta, d.merging.pull);
                d.merging.axis = vector(&delta, d.merging.axis);
            }
        }
    }

    /// Merges the drops of a part that touch into one of their volume, until none touch. Only a drop
    /// that is new or moved since the last merge can touch another (the others were apart then), so
    /// each pass looks around those, in index order: S3f: along the segment each swept in this step
    /// (a sliding drop takes every drop it crossed, and none beside its path). The survivor takes the
    /// lower index and stays where it was: its centre relaxes to the centre of volume of the two over
    /// the next steps ([`Merging`]: the centres they were relaxing to themselves count), its outline
    /// first spanning both with a neck between them; it is new again for the next pass.
    fn merge(&mut self) {
        for _ in 0..256 {
            if !self.drops.iter().any(|d| d.fresh) {
                return;
            }
            let largest = self.drops.iter().fold(0.0f32, |m, d| m.max(d.a));
            if self.drops.len() < 2 || !above(largest, 0.0) {
                for d in self.drops.iter_mut() {
                    d.fresh = false;
                }
                return;
            }
            let pos: Vec<Vec3> = self.drops.iter().map(|d| d.p).collect();
            let grid = SampleGrid::new(&pos, 2.0 * largest);
            let mut alive = vec![true; self.drops.len()];
            let mut merged = false;
            let mut near = Vec::new();
            for i in 0..self.drops.len() {
                if !alive[i] || !self.drops[i].fresh {
                    continue;
                }
                let (from, to) = (self.drops[i].from, self.drops[i].p);
                let reach = self.drops[i].a + largest;
                let pad = Vec3::new(reach, reach, reach);
                near.clear();
                grid.query(from.min(to) - pad, from.max(to) + pad, &mut near);
                near.sort_unstable();
                let mut other = None;
                for &j in near.iter() {
                    let j = j as usize;
                    if j == i || !alive[j] {
                        continue;
                    }
                    let (p, q) = (self.drops[i], self.drops[j]);
                    if p.part == q.part && to_segment(q.p, from, to) < p.a + q.a {
                        other = Some(j);
                        break;
                    }
                }
                let Some(j) = other else {
                    self.drops[i].fresh = false;
                    continue;
                };
                let (keep, gone) = (i.min(j), i.max(j));
                let (k, g) = (self.drops[keep], self.drops[gone]);
                self.drops[keep] = self.merged(k, g);
                alive[gone] = false;
                merged = true;
            }
            if merged {
                self.keep_drops(&alive);
            }
        }
    }

    /// S3f: drop `k` having taken drop `g`: their volume (the sum), where `k` was, relaxing to the
    /// centre of volume of the two.
    fn merged(&self, k: Drop, g: Drop) -> Drop {
        let volume = k.volume + g.volume;
        let part = &self.parts[k.part as usize];
        let n = self.tris[k.tri as usize].n;
        let tangent = |v: Vec3| v - n * v.dot(n);
        // The centres each was relaxing to, and the centre of volume of the two.
        let (ck, cg) = (k.p + k.merging.pull, g.p + g.merging.pull);
        let centre = ck * (k.volume / volume) + cg * (g.volume / volume);
        let mut out = Drop::new(k.id, k.part, k.tri, k.p, volume, part.k);
        let a = out.a;
        let line = tangent(cg - ck);
        let d = line.length();
        let pull = tangent(centre - k.p);
        out.merging = if above(d, 1.0e-6) && above(a, 0.0) {
            let e = line / d;
            // Its outline: from the back of the one to the front of the other along the line.
            let back = (ck - k.p).dot(e) - k.a;
            let front = (cg - k.p).dot(e) + g.a;
            let (small, big) = if k.a < g.a { (k.a, g.a) } else { (g.a, k.a) };
            Merging {
                axis: e,
                along: (0.5 * (front - back) / a).clamp(0.1, 16.0),
                across: (big / a).clamp(0.1, 16.0),
                neck: if big > 0.0 {
                    (NECK_DEPTH * small / big).clamp(0.0, 0.95)
                } else {
                    0.0
                },
                shift: (0.5 * (front + back) / a).clamp(-16.0, 16.0),
                left: 1.0,
                pull,
            }
        } else if above(pull.length(), 1.0e-6) {
            Merging {
                left: 1.0,
                pull,
                ..Merging::NONE
            }
        } else {
            Merging::NONE
        };
        let lead = if g.volume > k.volume { g } else { k };
        out.from = k.from;
        out.vel = lead.vel;
        out.ca = lead.ca;
        out.load = lead.load;
        out.edge = k.edge || g.edge;
        out.edge_at = if k.edge { k.edge_at } else { g.edge_at };
        out.run = lead.run;
        out
    }

    /// S3f: the shape of drop `d` (axes in world space) from its physics: [`base_shape`] along its
    /// motion when it slides, downhill when it is pinned on a slope; the merge it relaxes from; the
    /// stretch and the neck of a hanging drop. S3g: its outline keeps the drop's contact area `π a²`:
    /// the steps of the shape that change it (a merge's span, its neck, the stretch along gravity of
    /// a hanging drop in the plane of its surface) are followed by a uniform stretch in that plane
    /// (the merge's along and across alike, its height keeping the volume) that brings the area of
    /// the outline the renderer draws (`rt_core::weather::outline_area`) back to it.
    fn shape_of(&self, d: &Drop) -> DropShape {
        let part = &self.parts[d.part as usize];
        let n = self.tris[d.tri as usize].n;
        let (adv, rec) = (
            part.advancing / fmath::DEG_TO_RAD,
            part.receding / fmath::DEG_TO_RAD,
        );
        let mut s = DropShape::ROUND;
        let gravity = part.gravity;
        let downhill = gravity - n * gravity.dot(n);
        let axis = if d.ca > 0.0 {
            d.vel
        } else if d.load > 0.0 {
            downhill
        } else {
            Vec3::ZERO
        };
        if above(axis.length(), 1.0e-6) {
            s = DropShape {
                axis: axis.normalize(),
                ..base_shape(adv, rec, d.load, d.ca)
            };
        }
        let m = d.merging.left;
        if m > 0.0 && above(d.merging.axis.length(), 0.0) {
            s.merge_axis = d.merging.axis;
            s.merge_along = (1.0 + (d.merging.along - 1.0) * m).clamp(0.1, 16.0);
            s.merge_across = (1.0 + (d.merging.across - 1.0) * m).clamp(0.1, 16.0);
            s.neck = (d.merging.neck * m).clamp(0.0, 0.95);
            s.shift = (d.merging.shift * m).clamp(-16.0, 16.0);
        }
        if d.hang > 0.0 {
            s.sag = (HANG_SAG * (d.hang.min(1.0) + d.pinch)).clamp(0.0, 8.0);
            s.pinch = (HANG_PINCH * d.pinch).clamp(0.0, 0.95);
        }
        // S3g: the outline back to the contact area.
        if s.neck > 0.0
            || s.merge_along != 1.0
            || s.merge_across != 1.0
            || s.sag > 0.0
            || s.pinch > 0.0
        {
            let frame = rt_core::weather::ShapeFrame::new(n, &s, d.a, part.cap_deg);
            let round = fmath::PI * d.a * d.a;
            let ratio = if above(round, 0.0) {
                rt_core::weather::outline_area(&frame, &s, OUTLINE_POINTS) / round
            } else {
                1.0
            };
            if above(ratio, 0.0) && ratio.is_finite() {
                let l = 1.0 / ratio.sqrt();
                if frame.merge.is_none() {
                    s.merge_axis = tangent_of(n);
                    s.merge_along = 1.0;
                    s.merge_across = 1.0;
                }
                s.merge_along = (s.merge_along * l).clamp(0.1, 16.0);
                s.merge_across = (s.merge_across * l).clamp(0.1, 16.0);
            }
        }
        s
    }

    /// S3f: the shapes of the drops, in the order of [`WetParts::drops`], axes in world space.
    pub fn shapes(&self) -> Vec<DropShape> {
        self.drops.iter().map(|d| self.shape_of(d)).collect()
    }

    /// S3g: the area of each drop's outline as the renderer draws it ([`WetParts::shapes`],
    /// `rt_core::weather::outline_area` with `points` points) over its physical contact area
    /// `π a²`, in the order of [`WetParts::drops`].
    pub fn outline_ratios(&self, points: u32) -> Vec<f32> {
        self.drops
            .iter()
            .map(|d| {
                let part = &self.parts[d.part as usize];
                let shape = self.shape_of(d);
                let n = self.tris[d.tri as usize].n;
                let frame = rt_core::weather::ShapeFrame::new(n, &shape, d.a, part.cap_deg);
                let round = fmath::PI * d.a * d.a;
                if above(round, 0.0) {
                    rt_core::weather::outline_area(&frame, &shape, points) / round
                } else {
                    1.0
                }
            })
            .collect()
    }

    /// S3g: the drops that started to slide from rest so far (the first [`MAX_DEPINS`]).
    pub fn depins(&self) -> &[Depin] {
        &self.depins
    }

    /// S3g: how many drops the runners have left behind them so far.
    pub fn pearls(&self) -> u32 {
        self.pearls
    }

    /// S3f: the drops as the tests see them, in the order of [`WetParts::drops`].
    pub fn drop_states(&self) -> Vec<DropState> {
        self.drops
            .iter()
            .map(|d| DropState {
                id: d.id,
                part: d.part,
                p: d.p,
                volume: d.volume,
                a: d.a,
                velocity: d.vel,
                edge: d.edge,
                pinch: d.pinch,
                merging: d.merging.left,
                pull: d.merging.pull,
                hang: d.hang,
            })
            .collect()
    }

    /// S3f: the shape of a drop in its part's object space.
    fn object_shape(&self, d: &Drop) -> DropShape {
        let to_object = &self.parts[d.part as usize].to_object;
        self.shape_of(d).map_axes(|v| vector(to_object, v))
    }

    /// The layout of the samples, once per run: little-endian words
    ///
    /// ```text
    /// u32 parts; f32 cell_mm;
    /// per part: u32 triangles samples; u32 flags (1: dust rates follow, 2: snow rates follow,
    ///           4: S3e, the resolutions take two bytes); f32 cap_angle_deg;
    ///           u8 resolution[triangles] (flag 4: u16), zero padding to 4;
    ///           [f32 dust_rate[samples] (per second)] [f32 snow_rate[samples] (mm per second)]
    /// S3e, with the studio floor: u32 nx ny; f32 x0 y0 cell z; u32 flags (1 dust, 2 snow);
    ///           [f32 dust_rate[nx × ny]] [f32 snow_rate[nx × ny]]
    /// ```
    ///
    /// A sample's global index (the frames') is its part's first sample (the samples of the parts
    /// before it) plus its index in the part: its triangle's first (the triangles before it, each
    /// [`samples_of`] its resolution) plus [`sample_index`].
    pub fn layout(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let word = |w: u32, out: &mut Vec<u8>| out.extend_from_slice(&w.to_le_bytes());
        word(self.parts.len() as u32, &mut out);
        word(self.cell.to_bits(), &mut out);
        for p in &self.parts {
            let (s0, s1) = (
                p.first_sample as usize,
                (p.first_sample + p.samples) as usize,
            );
            let dust = self.dust_rate[s0..s1].iter().any(|&r| r > 0.0);
            let snow = self.snow_rate[s0..s1].iter().any(|&r| r > 0.0);
            let tris = &self.tris[p.first_tri as usize..(p.first_tri + p.tris) as usize];
            let wide = tris.iter().any(|t| t.res > MAX_RESOLUTION);
            word(p.tris, &mut out);
            word(p.samples, &mut out);
            word(
                u32::from(dust) | u32::from(snow) << 1 | u32::from(wide) << 2,
                &mut out,
            );
            word(p.cap_deg.to_bits(), &mut out);
            for t in tris {
                if wide {
                    out.extend_from_slice(&(t.res as u16).to_le_bytes());
                } else {
                    out.push(t.res as u8);
                }
            }
            while out.len() % 4 != 0 {
                out.push(0);
            }
            if dust {
                for &r in &self.dust_rate[s0..s1] {
                    word(r.to_bits(), &mut out);
                }
            }
            if snow {
                for &r in &self.snow_rate[s0..s1] {
                    word(r.to_bits(), &mut out);
                }
            }
        }
        // S3e: the studio floor.
        if let Some(f) = &self.floor {
            let dust = f.dust_rate.iter().any(|&r| r > 0.0);
            let snow = f.snow_rate.iter().any(|&r| r > 0.0);
            for w in [
                f.nx,
                f.ny,
                f.x0.to_bits(),
                f.y0.to_bits(),
                f.cell.to_bits(),
                f.z.to_bits(),
                u32::from(dust) | u32::from(snow) << 1,
            ] {
                word(w, &mut out);
            }
            if dust {
                for &r in &f.dust_rate {
                    word(r.to_bits(), &mut out);
                }
            }
            if snow {
                for &r in &f.snow_rate {
                    word(r.to_bits(), &mut out);
                }
            }
        }
        out
    }

    /// The record of a frame, and the start of the next one: little-endian words
    ///
    /// ```text
    /// u32 changed; per drop new or changed since the last frame, by number:
    ///              u32 id part triangle (its index in the part's mesh);
    ///              f32 x y z (the part's object space) a (contact radius, mm)
    /// u32 gone;    u32 ids[gone]        (drops gone since the last frame, ascending)
    /// u32 wetted;  u32 samples[wetted]  (first wet since the last frame, ascending)
    /// u32 wiped;   u32 samples[wiped]   (wiped since the last frame, ascending)
    /// u32 drips                         (since the last frame)
    /// u32 drops                         (on the parts now)
    /// u32 falling; per drop in the air now, by number:
    ///              u32 id part (the part it left); f32 x y z (world) r (the radius of its sphere)
    /// u32 shaped (S3f: = changed); per changed drop, in the order above:
    ///              f32 shape[15] (rt_core::weather::DropShape, axes in the part's object space)
    /// S3e, with the studio floor: u32 floor_wetted; u32 cells[floor_wetted] (first wet since the
    ///              last frame, ascending)
    /// ```
    ///
    /// A drop's number is the order it came in; one that came and went between two frames is in
    /// `gone` only. The drops of a frame, by number, are what [`WetParts::weather`] gives. The drops
    /// in the air (S3d) are listed whole in every frame (they all move), with numbers of their own
    /// that no drop on a part has; they are what [`WetParts::falling`] gives. The shapes (S3f) are
    /// those of the changed drops: a drop whose shape changes (it slides, relaxes from a merge,
    /// hangs) is changed.
    pub fn frame(&mut self) -> Vec<u8> {
        let mut changed: Vec<usize> = (0..self.drops.len())
            .filter(|&i| self.drops[i].touched)
            .collect();
        changed.sort_unstable_by_key(|&i| self.drops[i].id);
        let mut words: Vec<u32> = Vec::with_capacity(
            6 + 7 * changed.len() + self.gone_ids.len() + self.new_wet.len() + self.new_wiped.len(),
        );
        words.push(changed.len() as u32);
        for &i in &changed {
            let d = self.drops[i];
            let part = &self.parts[d.part as usize];
            let o = part.to_object.apply(d.p);
            words.extend_from_slice(&[
                d.id,
                d.part,
                d.tri - part.first_tri,
                o.x.to_bits(),
                o.y.to_bits(),
                o.z.to_bits(),
                d.a.to_bits(),
            ]);
        }
        let shapes: Vec<DropShape> = changed
            .iter()
            .map(|&i| self.object_shape(&self.drops[i]))
            .collect();
        for d in self.drops.iter_mut() {
            d.touched = false;
        }
        self.gone_ids.sort_unstable();
        self.new_wet.sort_unstable();
        self.new_wiped.sort_unstable();
        for list in [&self.gone_ids, &self.new_wet, &self.new_wiped] {
            words.push(list.len() as u32);
            words.extend_from_slice(list);
        }
        words.push(self.drips_since);
        words.push(self.drops.len() as u32);
        words.push(self.falling.len() as u32);
        for f in &self.falling {
            let r = 0.5 * diameter_of(f.volume);
            words.extend_from_slice(&[
                f.id,
                f.part,
                f.p.x.to_bits(),
                f.p.y.to_bits(),
                f.p.z.to_bits(),
                r.to_bits(),
            ]);
        }
        // S3f: the shapes of the changed drops.
        words.push(shapes.len() as u32);
        for shape in &shapes {
            words.extend(shape.to_floats().iter().map(|v| v.to_bits()));
        }
        // S3e: the studio floor's cells first wet since the last frame.
        if let Some(f) = self.floor.as_mut() {
            f.new_wet.sort_unstable();
            words.push(f.new_wet.len() as u32);
            words.extend_from_slice(&f.new_wet);
            f.new_wet.clear();
        }
        self.gone_ids.clear();
        self.new_wet.clear();
        self.new_wiped.clear();
        self.drips_since = 0;
        self.frame_no += 1;
        words.iter().flat_map(|w| w.to_le_bytes()).collect()
    }

    /// The parts as the renderer takes them now ([`Weather`]): per part its samples' wetness (0 or
    /// 1), share under dust and depth of snow, and its drops in its object space, by number.
    pub fn weather(&self) -> Vec<Weather> {
        self.parts
            .iter()
            .enumerate()
            .map(|(pi, p)| {
                let (s0, s1) = (
                    p.first_sample as usize,
                    (p.first_sample + p.samples) as usize,
                );
                Weather {
                    resolution: self.tris[p.first_tri as usize..(p.first_tri + p.tris) as usize]
                        .iter()
                        .map(|t| t.res as u16)
                        .collect(),
                    wet: (s0..s1).map(|s| self.wet[s] <= self.steps).collect(),
                    dust: (s0..s1).map(|s| self.dust_at(s)).collect(),
                    snow_mm: (s0..s1).map(|s| self.snow_at(s)).collect(),
                    cap_angle_deg: p.cap_deg,
                    drops: self
                        .mine(pi)
                        .iter()
                        .map(|d| (d.tri - p.first_tri, p.to_object.apply(d.p), d.a))
                        .collect(),
                    shapes: self.mine(pi).iter().map(|d| self.object_shape(d)).collect(),
                }
            })
            .collect()
    }

    /// The drops of part `pi`, by number.
    fn mine(&self, pi: usize) -> Vec<&Drop> {
        let mut mine: Vec<&Drop> = self
            .drops
            .iter()
            .filter(|d| d.part as usize == pi)
            .collect();
        mine.sort_unstable_by_key(|d| d.id);
        mine
    }

    /// FNV-1a (32 bits) of the steps, the drops in order (S3f: with what makes their shapes), every
    /// sample's wet and wiped steps and rates, and the drops in the air (S3d): what the native and
    /// WebAssembly builds are compared by.
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
            eat(d.part);
            eat(d.tri);
            eat(d.p.x.to_bits());
            eat(d.p.y.to_bits());
            eat(d.p.z.to_bits());
            eat(d.volume.to_bits());
            // S3f: what makes its shape, and what it relaxes from.
            let m = &d.merging;
            // S3g: the five words of S3f's bead of a rivulet (gone: always none) stay, so a run
            // without one keeps its hash.
            for v in [
                d.vel.x, d.vel.y, d.vel.z, d.load, d.ca, m.axis.x, m.axis.y, m.axis.z, m.along,
                m.across, m.neck, m.shift, m.left, m.pull.x, m.pull.y, m.pull.z, 0.0, 0.0, 0.0,
                1.0, 0.0, d.hang, d.pinch, d.run,
            ] {
                eat(v.to_bits());
            }
            eat(u32::from(d.edge));
        }
        for (&w, &x) in self.wet.iter().zip(&self.wiped) {
            eat(w);
            eat(x);
        }
        for (&d, &s) in self.dust_rate.iter().zip(&self.snow_rate) {
            eat(d.to_bits());
            eat(s.to_bits());
        }
        // S3d: the drops in the air.
        eat(self.falling.len() as u32);
        for f in &self.falling {
            eat(f.id);
            eat(f.part);
            for v in [f.p.x, f.p.y, f.p.z, f.v.x, f.v.y, f.v.z, f.volume] {
                eat(v.to_bits());
            }
        }
        // S3e: where the parts that move stand, and the studio floor.
        for m in &self.movers {
            for v in m.now.rows.iter().flatten() {
                eat(v.to_bits());
            }
        }
        if let Some(f) = &self.floor {
            eat(f.nx);
            eat(f.ny);
            for (k, &w) in f.wet.iter().enumerate() {
                eat(w);
                eat(f.dust_rate[k].to_bits());
                eat(f.snow_rate[k].to_bits());
            }
            eat(f.water.to_bits());
        }
        h
    }

    /// S3e: the studio floor as the renderer takes it now (its cells' wetness, dust and snow), for
    /// a floor whose wet film darkens it by `porosity`; none without a floor.
    pub fn floor_weather(&self, porosity: f32) -> Option<rt_core::weather::FloorWeather> {
        let f = self.floor.as_ref()?;
        let t = self.seconds();
        let values = (0..f.cells())
            .map(|c| {
                [
                    wet_byte(f.wet[c] <= self.steps),
                    dust_byte(1.0 - fmath::exp(-f.dust_rate[c] * t)),
                    snow_byte(f.snow_rate[c] * t),
                ]
            })
            .collect();
        Some(rt_core::weather::FloorWeather {
            nx: f.nx,
            ny: f.ny,
            x0: f.x0,
            y0: f.y0,
            cell: f.cell,
            z: f.z,
            porosity: porosity.clamp(0.0, 1.0),
            values,
        })
    }

    /// S3e: the studio floor's cells (along X and Y) and their side, mm; none without a floor.
    pub fn floor_cells(&self) -> Option<(u32, u32, f32)> {
        self.floor.as_ref().map(|f| (f.nx, f.ny, f.cell))
    }

    /// S3e: the step a cell of the studio floor was first wet in ([`NEVER`]).
    pub fn floor_wet_step(&self, cell: usize) -> u32 {
        self.floor.as_ref().map_or(NEVER, |f| f.wet[cell])
    }

    /// S3e: the water that landed on the studio floor from the air, mm³, and how many drops.
    pub fn floor_water(&self) -> (f32, u32) {
        self.floor
            .as_ref()
            .map_or((0.0, 0), |f| (f.water, f.landed))
    }

    /// S3e: the film triangles a shadow edge refined.
    pub fn refined_triangles(&self) -> u32 {
        self.refined
    }

    /// S3e: where part `part` stands now, object to world (its spec's transform; for a part that
    /// moves, carried where its body took it).
    pub fn placement(&self, part: usize) -> Transform {
        let t = self.spec.parts[part].transform;
        match self.parts[part].mover {
            Some(mi) => compose(&self.movers[mi as usize].now, &t),
            None => t,
        }
    }

    /// S3e: the effective gravity the drops of part `part` feel, over `g`.
    pub fn part_gravity(&self, part: usize) -> Vec3 {
        self.parts[part].gravity
    }
}

/// A part as the renderer takes it: the samples of each triangle (`resolution`, the order of
/// [`sample_index`]) and their state, its drops.
#[derive(Clone, Debug, PartialEq)]
pub struct Weather {
    /// The resolution of each triangle, in the mesh's order (S3e: up to [`MAX_FINE_RESOLUTION`]).
    pub resolution: Vec<u16>,
    /// Wet now.
    pub wet: Vec<bool>,
    /// The share under dust.
    pub dust: Vec<f32>,
    /// The depth of snow, mm.
    pub snow_mm: Vec<f32>,
    /// The contact angle its drops are capped at, degrees.
    pub cap_angle_deg: f32,
    /// Its drops: the triangle (in the mesh), the point (object space), the contact radius.
    pub drops: Vec<(u32, Vec3, f32)>,
    /// S3f: their shapes (axes in object space), in the same order.
    pub shapes: Vec<DropShape>,
}

/// The byte of a sample's wetness in a `WETP` section (`rt_core::weather`): 255 when wet.
pub fn wet_byte(wet: bool) -> u8 {
    if wet {
        255
    } else {
        0
    }
}

/// The byte of a share under dust, `round(255 × share)`.
pub fn dust_byte(share: f32) -> u8 {
    (share.clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u8
}

/// The byte of a depth of snow, in steps of `rt_core::weather::SNOW_STEP_MM` (at most 255).
pub fn snow_byte(depth_mm: f32) -> u8 {
    (depth_mm.max(0.0) / rt_core::weather::SNOW_STEP_MM + 0.5)
        .floor()
        .min(255.0) as u8
}

impl Weather {
    /// The `WETP` of this part as the renderer reads it, for instance `instance` whose material
    /// darkens by `porosity` when wet.
    pub fn part_weather(
        &self,
        instance: u32,
        porosity: f32,
    ) -> Result<rt_core::weather::PartWeather, &'static str> {
        let values = (0..self.wet.len())
            .map(|s| {
                [
                    wet_byte(self.wet[s]),
                    dust_byte(self.dust[s]),
                    snow_byte(self.snow_mm[s]),
                ]
            })
            .collect();
        let drops = self
            .drops
            .iter()
            .map(|&(triangle, position, radius)| rt_core::weather::WetDrop {
                triangle,
                position,
                radius,
            })
            .collect();
        rt_core::weather::PartWeather::new(
            instance,
            self.resolution.clone(),
            values,
            self.cap_angle_deg,
            porosity,
            drops,
        )
    }

    /// S3f: [`Weather::part_weather`] with the shapes of its drops (the shape tail), as an engine
    /// with bit 10 reads it.
    pub fn part_weather_shaped(
        &self,
        instance: u32,
        porosity: f32,
    ) -> Result<rt_core::weather::PartWeather, &'static str> {
        self.part_weather(instance, porosity)?
            .with_shapes(self.shapes.clone())
    }
}

/// Two unit vectors that make an orthonormal basis of the plane normal to `n`.
fn tangent_basis(n: Vec3) -> (Vec3, Vec3) {
    let helper = if n.z.abs() < 0.9 {
        Vec3::new(0.0, 0.0, 1.0)
    } else {
        Vec3::new(1.0, 0.0, 0.0)
    };
    let u = helper.cross(n).normalize();
    (u, n.cross(u))
}

/// The point of triangle `t` nearest `p`, clamped inside it (its plane, barycentric weights at
/// least 0).
fn onto(t: &Tri, p: Vec3) -> Vec3 {
    let (e1, e2) = (t.v[1] - t.v[0], t.v[2] - t.v[0]);
    let w = p - t.v[0];
    let (d11, d12, d22) = (e1.dot(e1), e1.dot(e2), e2.dot(e2));
    let (w1, w2) = (w.dot(e1), w.dot(e2));
    let det = d11 * d22 - d12 * d12;
    if !above(det, 0.0) {
        return p;
    }
    let mut u = (w1 * d22 - w2 * d12) / det;
    let mut v = (w2 * d11 - w1 * d12) / det;
    u = u.max(0.0);
    v = v.max(0.0);
    let s = u + v;
    if s > 1.0 {
        u /= s;
        v /= s;
    }
    t.v[0] + e1 * u + e2 * v
}

/// Finds the neighbours of the triangles of one part (`tris`, numbered from `first`): two
/// triangles that share an edge (the same two positions, in the mesh's object space, run the other
/// way round) are linked across it; an edge with one triangle, more than two, or two that do not
/// agree on their winding is open.
fn link(tris: &mut [Tri], first: u32, mesh: &PartsMesh) {
    // Positions welded by their bits.
    let mut order: Vec<u32> = (0..mesh.positions.len() as u32).collect();
    let bits = |i: u32| {
        let p = mesh.positions[i as usize];
        (p.x.to_bits(), p.y.to_bits(), p.z.to_bits())
    };
    order.sort_by(|&a, &b| bits(a).cmp(&bits(b)).then(a.cmp(&b)));
    let mut weld = vec![0u32; mesh.positions.len()];
    let mut id = 0u32;
    for (k, &i) in order.iter().enumerate() {
        if k > 0 && bits(order[k - 1]) != bits(i) {
            id += 1;
        }
        weld[i as usize] = id;
    }
    // Every edge: (low, high, triangle, edge, forward).
    let mut edges: Vec<(u32, u32, u32, u8, bool)> = Vec::with_capacity(mesh.indices.len());
    for (t, idx) in mesh.indices.chunks_exact(3).enumerate() {
        for k in 0..3 {
            let (a, b) = (weld[idx[k] as usize], weld[idx[(k + 1) % 3] as usize]);
            if a != b {
                edges.push((a.min(b), a.max(b), t as u32, k as u8, a < b));
            }
        }
    }
    edges.sort_unstable();
    let mut s = 0;
    while s < edges.len() {
        let mut e = s + 1;
        while e < edges.len() && edges[e].0 == edges[s].0 && edges[e].1 == edges[s].1 {
            e += 1;
        }
        if e - s == 2 && edges[s].4 != edges[s + 1].4 {
            let (x, y) = (edges[s], edges[s + 1]);
            tris[x.2 as usize].nb[x.3 as usize] = first + y.2;
            tris[y.2 as usize].nb[y.3 as usize] = first + x.2;
        }
        s = e;
    }
}

/// S3e: for each open edge of `tris` (`3 × triangle + k`: no neighbour across it), the open edge of
/// the same part that shares its first corner and the one that shares its second (positions equal
/// by their bits), [`NEVER`] where there is none; the lowest index wins where there are more.
fn open_edges(tris: &[Tri]) -> Vec<[u32; 2]> {
    let mut out = vec![[NEVER; 2]; 3 * tris.len()];
    let bits = |v: Vec3| (v.x.to_bits(), v.y.to_bits(), v.z.to_bits());
    /// An end of an open edge: its part, its corner's bits, the edge, which end.
    type End = (u32, (u32, u32, u32), u32, u8);
    let mut ends: Vec<End> = Vec::new();
    for (ti, t) in tris.iter().enumerate() {
        for k in 0..3 {
            if t.nb[k] == NEVER && above(t.area, 0.0) {
                let e = 3 * ti as u32 + k as u32;
                ends.push((t.part, bits(t.v[k]), e, 0));
                ends.push((t.part, bits(t.v[(k + 1) % 3]), e, 1));
            }
        }
    }
    ends.sort_unstable();
    let mut s = 0;
    while s < ends.len() {
        let mut e = s + 1;
        while e < ends.len() && ends[e].0 == ends[s].0 && ends[e].1 == ends[s].1 {
            e += 1;
        }
        for a in s..e {
            let other = (s..e).find(|&b| ends[b].2 != ends[a].2);
            if let Some(b) = other {
                out[ends[a].2 as usize][ends[a].3 as usize] = ends[b].2;
            }
        }
        s = e;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_samples_of_a_triangle_are_numbered_row_after_row() {
        for r in 1..10 {
            let mut k = 0;
            for j in 0..=r {
                for i in 0..=r - j {
                    assert_eq!(sample_index(r, i, j), k, "{r} {i} {j}");
                    k += 1;
                }
            }
            assert_eq!(k, samples_of(r));
        }
    }

    #[test]
    fn a_transform_and_its_inverse_undo_each_other() {
        let t = Transform {
            rows: [
                [0.0, -2.0, 0.0, 5.0],
                [1.5, 0.0, 0.0, -3.0],
                [0.0, 0.0, 0.5, 7.0],
            ],
        };
        let inv = inverse(&t);
        let p = Vec3::new(1.0, 2.0, 3.0);
        let q = inv.apply(t.apply(p));
        assert!((q - p).length() < 1.0e-5, "{q:?}");
    }
}
